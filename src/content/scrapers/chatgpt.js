import {
  cleanClone,
  extractMath,
  convertLatexDelimiters,
  removeImages,
  extractUserImages,
  getChatTitle,
} from './base.js';

export const PLATFORM = {
  id: 'chatgpt',
  name: 'ChatGPT',
  host: 'chatgpt.com',
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// A stable key so a message is captured once even though virtualization mounts
// and unmounts it repeatedly as we scroll.
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

// Every element that could be the conversation scroller (overflow ancestors of a
// message + the document). We never rely on guessing THE one correctly.
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

// Small on-page indicator so the user can see it working (and so a wrong count
// is immediately diagnosable).
function makeOverlay() {
  const el = document.createElement('div');
  el.id = '__ai_exporter_progress';
  el.style.cssText =
    'position:fixed;z-index:2147483647;bottom:22px;left:50%;transform:translateX(-50%);' +
    'background:#111;color:#fff;padding:10px 16px;border-radius:10px;' +
    "font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    'box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none;';
  (document.body || document.documentElement).appendChild(el);
  const set = (text) => {
    el.textContent = text;
  };
  return {
    loading: () => set('Loading history…'),
    count: (n) => set(`Collecting messages… ${n}`),
    done: (n) => {
      set(`Collected ${n} messages ✓`);
      setTimeout(() => el.remove(), 1600);
    },
    remove: () => el.remove(),
  };
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

export async function scrape() {
  const chatTitle = getChatTitle(
    ['\\s*-\\s*ChatGPT\\s*$', '\\s*\\|\\s*ChatGPT\\s*$'],
    'Exported ChatGPT Chat'
  );

  // ChatGPT virtualizes long threads (off-screen messages are unmounted) AND
  // lazy-loads older history near the top. We therefore:
  //   1. load all history by repeatedly pulling the FIRST message into view,
  //   2. sweep top -> bottom by pulling the LAST message into view, collecting
  //      each message the moment it's mounted (deduped by data-message-id).
  // scrollIntoView() drives whichever element actually scrolls, so we never
  // depend on correctly identifying the scroll container.
  const collected = new Map(); // key -> { role, htmlContent }
  const overlay = makeOverlay();

  const nodesNow = () => document.querySelectorAll('[data-message-author-role]');

  const collectVisible = async () => {
    const nodes = nodesNow(); // DOM order (top -> bottom)
    for (const node of nodes) {
      const key = messageKey(node);
      if (collected.has(key)) continue;
      const role = node.getAttribute('data-message-author-role') === 'user' ? 'user' : 'model';
      const html = await extractMessageHtml(node, role);
      if (html) collected.set(key, { role, htmlContent: html });
    }
    overlay.count(collected.size);
  };

  const restoreY = window.scrollY;

  try {
    // Phase 1 — load all lazily-fetched history. Don't collect yet (scrolling
    // up would scramble insertion order); just grow the thread to full length.
    overlay.loading();
    let prevH = -1;
    let noGrow = 0;
    for (let i = 0; i < 80; i++) {
      const nodes = nodesNow();
      if (nodes.length) nodes[0].scrollIntoView({ block: 'start' });
      await delay(180);
      const h = scrollHeightNow();
      if (h <= prevH) {
        if (++noGrow >= 3) break;
      } else {
        noGrow = 0;
      }
      if (h > prevH) prevH = h;
    }

    // Back to the very top, then sweep downward collecting in conversation order.
    {
      const nodes = nodesNow();
      if (nodes.length) nodes[0].scrollIntoView({ block: 'start' });
    }
    await delay(200);

    let lastCount = -1;
    let still = 0;
    for (let i = 0; i < 1500; i++) {
      await collectVisible();
      if (collected.size === lastCount) {
        if (++still >= 4) break; // no new messages after several nudges -> done
      } else {
        still = 0;
      }
      lastCount = collected.size;
      const nodes = nodesNow();
      if (nodes.length) nodes[nodes.length - 1].scrollIntoView({ block: 'end' });
      await delay(150);
    }
    await collectVisible(); // final sweep
  } finally {
    try {
      window.scrollTo(0, restoreY);
    } catch {
      /* ignore */
    }
  }

  const messages = Array.from(collected.values());
  overlay.done(messages.length);

  // Fallback: if selectors changed entirely and we found nothing, dump main.
  if (messages.length === 0) {
    const mainChat = document.querySelector('main, [role="main"]');
    if (mainChat) {
      messages.push({
        role: 'model',
        htmlContent:
          '<p>Warning: ChatGPT DOM structure may have changed. Full page scrape executed.</p>' +
          mainChat.innerHTML,
      });
    }
  }

  return { title: chatTitle, messages, platform: PLATFORM.id };
}
