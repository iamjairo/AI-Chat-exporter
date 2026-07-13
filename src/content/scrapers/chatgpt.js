import {
  cleanClone,
  extractMath,
  convertLatexDelimiters,
  removeImages,
  extractUserImages,
  getChatTitle,
} from './base.js';
import { marked } from 'marked';

export const PLATFORM = {
  id: 'chatgpt',
  name: 'ChatGPT',
  host: 'chatgpt.com',
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Small on-page indicator so progress is visible and diagnosable.
function makeOverlay() {
  const el = document.createElement('div');
  el.id = '__ai_exporter_progress';
  el.style.cssText =
    'position:fixed;z-index:2147483647;bottom:22px;left:50%;transform:translateX(-50%);' +
    'background:#111;color:#fff;padding:10px 16px;border-radius:10px;' +
    "font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    'box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none;';
  (document.body || document.documentElement).appendChild(el);
  return {
    set: (t) => { el.textContent = t; },
    done: (n) => { el.textContent = `Exported ${n} messages ✓`; setTimeout(() => el.remove(), 1800); },
    remove: () => el.remove(),
  };
}

// ===========================================================================
// Primary path: ChatGPT's own backend API. Returns the ENTIRE conversation as
// JSON in one request — no virtualization, no scrolling, correct order — which
// is the only reliable way to export very large (hundreds of pages) chats.
// ===========================================================================

function conversationId() {
  const m = location.pathname.match(/\/c\/([0-9a-fA-F-]{8,})/);
  return m ? m[1] : null;
}

async function getAccessToken() {
  try {
    const r = await fetch('/api/auth/session', { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.accessToken ? j.accessToken : null;
  } catch {
    return null;
  }
}

// Flatten a message's content into markdown text.
function messageMarkdown(msg) {
  const c = msg && msg.content;
  if (!c) return '';
  if (c.content_type === 'text') return (c.parts || []).join('\n\n');
  if (c.content_type === 'code') return '```\n' + (c.text || '') + '\n```';
  if (c.content_type === 'multimodal_text') {
    return (c.parts || [])
      .map((p) => (typeof p === 'string' ? p : '')) // skip image/audio parts
      .filter(Boolean)
      .join('\n\n');
  }
  return (c.parts || []).filter((p) => typeof p === 'string').join('\n\n');
}

// Render markdown -> HTML while protecting LaTeX from the markdown parser, and
// emit the same `.math-tex` spans the preview's KaTeX step already understands.
function renderMarkdown(md) {
  const math = [];
  const stash = (raw) => `%%MATHTEX${math.push(raw) - 1}%%`;
  md = md
    .replace(/\\\[[\s\S]*?\\\]/g, (s) => stash(s))
    .replace(/\\\([\s\S]*?\\\)/g, (s) => stash(s))
    .replace(/\$\$[\s\S]*?\$\$/g, (s) => stash(s))
    .replace(/(^|[^$])\$(?!\s)([^\n$]+?)\$(?!\d)/g, (m0, pre, body) => pre + stash('$' + body + '$'));

  let html = marked.parse(md, { gfm: true, breaks: true });

  html = html.replace(/%%MATHTEX(\d+)%%/g, (_, i) => {
    const raw = math[Number(i)] || '';
    const display = /^\\\[|^\$\$/.test(raw);
    const tex = raw
      .replace(/^\\\[|\\\]$/g, '')
      .replace(/^\\\(|\\\)$/g, '')
      .replace(/^\$\$|\$\$$/g, '')
      .replace(/^\$|\$$/g, '')
      .trim();
    const cls = display ? 'math-tex math-display' : 'math-tex';
    const attr = tex.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const shown = tex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span class="${cls}" data-tex="${attr}">${shown}</span>`;
  });

  return html;
}

async function scrapeViaApi(convId, overlay) {
  overlay.set('Fetching conversation…');
  const token = await getAccessToken();
  const res = await fetch('/backend-api/conversation/' + convId, {
    credentials: 'include',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  if (!res.ok) throw new Error('conversation fetch HTTP ' + res.status);
  const data = await res.json();
  const mapping = data.mapping;
  if (!mapping) throw new Error('no mapping in conversation payload');

  // Walk the active branch: current_node -> parent -> ... -> root, then reverse.
  const chain = [];
  let id = data.current_node;
  const guardMax = 100000;
  let guard = 0;
  while (id && guard++ < guardMax) {
    const node = mapping[id];
    if (!node) break;
    if (node.message) chain.push(node.message);
    id = node.parent;
  }
  chain.reverse();

  const messages = [];
  for (const m of chain) {
    const role = m.author && m.author.role;
    if (role !== 'user' && role !== 'assistant') continue; // drop system/tool
    if (role === 'assistant' && m.recipient && m.recipient !== 'all') continue; // drop tool calls
    if (m.metadata && m.metadata.is_visually_hidden_from_conversation) continue;
    const md = messageMarkdown(m);
    if (!md || !md.trim()) continue;
    messages.push({ role: role === 'user' ? 'user' : 'model', htmlContent: renderMarkdown(md), markdown: md });
    if (messages.length % 10 === 0) overlay.set(`Fetching conversation… ${messages.length} messages`);
  }

  if (messages.length === 0) throw new Error('API returned no renderable messages');

  const title =
    data.title ||
    getChatTitle(['\\s*-\\s*ChatGPT\\s*$', '\\s*\\|\\s*ChatGPT\\s*$'], 'Exported ChatGPT Chat');
  return { title, messages, platform: PLATFORM.id };
}

// ===========================================================================
// Fallback path: DOM scrape (used only if the API path fails). Drives scrolling
// via scrollIntoView so it works regardless of which element scrolls.
// ===========================================================================

function messageKey(node) {
  let id = node.getAttribute('data-message-id');
  if (!id) {
    const holder = node.closest('[data-message-id]');
    if (holder) id = holder.getAttribute('data-message-id');
  }
  if (id) return id;
  const role = node.getAttribute('data-message-author-role') || 'x';
  return role + ':' + (node.textContent || '').trim().slice(0, 80);
}

function scrollHeightNow() {
  let max = document.documentElement.scrollHeight;
  const anchor = document.querySelector('[data-message-author-role]');
  let el = anchor ? anchor.parentElement : null;
  while (el && el !== document.body) {
    if (el.scrollHeight > max) max = el.scrollHeight;
    el = el.parentElement;
  }
  return max;
}

async function extractMessageHtml(node, role) {
  const contentNode =
    node.querySelector('.markdown, .whitespace-pre-wrap, [data-message-content]') || node;
  const clone = cleanClone(contentNode);
  extractMath(clone);
  removeImages(clone);
  let htmlString = clone.innerHTML.trim();
  htmlString = convertLatexDelimiters(htmlString);
  if (role === 'user') {
    const imagesHtml = await extractUserImages(node);
    if (imagesHtml) htmlString = imagesHtml + htmlString;
  }
  return htmlString;
}

async function scrapeViaDom(overlay) {
  const collected = new Map();
  const nodesNow = () => document.querySelectorAll('[data-message-author-role]');

  const collectVisible = async () => {
    for (const node of nodesNow()) {
      const key = messageKey(node);
      if (collected.has(key)) continue;
      const role = node.getAttribute('data-message-author-role') === 'user' ? 'user' : 'model';
      const html = await extractMessageHtml(node, role);
      if (html) collected.set(key, { role, htmlContent: html });
    }
    overlay.set(`Collecting messages… ${collected.size}`);
  };

  const restoreY = window.scrollY;
  try {
    overlay.set('Loading history…');
    let prevH = -1;
    let noGrow = 0;
    for (let i = 0; i < 80; i++) {
      const nodes = nodesNow();
      if (nodes.length) nodes[0].scrollIntoView({ block: 'start' });
      await delay(180);
      const h = scrollHeightNow();
      if (h <= prevH) { if (++noGrow >= 3) break; } else noGrow = 0;
      if (h > prevH) prevH = h;
    }
    { const nodes = nodesNow(); if (nodes.length) nodes[0].scrollIntoView({ block: 'start' }); }
    await delay(200);
    let lastCount = -1;
    let still = 0;
    for (let i = 0; i < 1500; i++) {
      await collectVisible();
      if (collected.size === lastCount) { if (++still >= 4) break; } else still = 0;
      lastCount = collected.size;
      const nodes = nodesNow();
      if (nodes.length) nodes[nodes.length - 1].scrollIntoView({ block: 'end' });
      await delay(150);
    }
    await collectVisible();
  } finally {
    try { window.scrollTo(0, restoreY); } catch { /* ignore */ }
  }

  const messages = Array.from(collected.values());
  const chatTitle = getChatTitle(
    ['\\s*-\\s*ChatGPT\\s*$', '\\s*\\|\\s*ChatGPT\\s*$'],
    'Exported ChatGPT Chat'
  );
  return { title: chatTitle, messages, platform: PLATFORM.id };
}

// ===========================================================================

export async function scrape() {
  const overlay = makeOverlay();
  try {
    const convId = conversationId();
    if (convId) {
      try {
        const result = await scrapeViaApi(convId, overlay);
        overlay.done(result.messages.length);
        return result;
      } catch (e) {
        console.warn('[AI Exporter] API export failed, falling back to DOM scrape:', e);
      }
    }
    const result = await scrapeViaDom(overlay);
    overlay.done(result.messages.length);
    return result;
  } catch (e) {
    overlay.remove();
    throw e;
  }
}
