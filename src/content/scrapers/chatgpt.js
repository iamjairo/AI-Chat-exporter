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

// The scrollable ancestor that actually holds the conversation. ChatGPT scrolls
// an inner container, not the window, so we walk up from a message node.
function findScrollContainer() {
  const anchor = document.querySelector('[data-message-author-role]');
  let el = anchor ? anchor.parentElement : null;
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 40) {
      return el;
    }
    el = el.parentElement;
  }
  return null; // fall back to window scrolling
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

  // ChatGPT virtualizes long conversations: only the messages near the viewport
  // stay mounted in the DOM, so a single querySelectorAll misses everything
  // scrolled out of view. We walk the whole thread top -> bottom and capture
  // each message's content the moment it's mounted (keyed by data-message-id to
  // dedupe), so nothing is lost when a node unmounts. Insertion order of the Map
  // preserves conversation order because we only ever scroll downward.
  const collected = new Map(); // key -> { role, htmlContent }

  const collectVisible = async () => {
    const nodes = document.querySelectorAll('[data-message-author-role]');
    for (const node of nodes) {
      const key = messageKey(node);
      if (collected.has(key)) continue;
      const roleAttr = node.getAttribute('data-message-author-role');
      const role = roleAttr === 'user' ? 'user' : 'model';
      const htmlContent = await extractMessageHtml(node, role);
      if (htmlContent) collected.set(key, { role, htmlContent });
    }
  };

  const scroller = findScrollContainer();
  const getMetrics = () =>
    scroller
      ? { top: scroller.scrollTop, h: scroller.clientHeight, max: scroller.scrollHeight }
      : { top: window.scrollY, h: window.innerHeight, max: document.documentElement.scrollHeight };
  const scrollTo = (y) => {
    if (scroller) scroller.scrollTop = y;
    else window.scrollTo(0, y);
  };

  // Remember where the user was, so we can restore it afterwards.
  const restore = getMetrics().top;

  // Start at the very top so virtualization mounts from the beginning.
  scrollTo(0);
  await delay(250);
  await collectVisible();

  let lastMax = -1;
  let stable = 0;
  let guard = 0;
  const MAX_STEPS = 600; // safety cap for very long chats
  while (guard++ < MAX_STEPS) {
    const { top, h, max } = getMetrics();
    await collectVisible();

    if (top + h >= max - 4) {
      // At the bottom. Stop once the total height stops growing (lazy loads settled).
      if (max === lastMax) {
        if (++stable >= 2) break;
      } else {
        stable = 0;
      }
      lastMax = max;
      await delay(220);
      continue;
    }

    scrollTo(Math.min(top + Math.floor(h * 0.85), max));
    lastMax = max;
    await delay(180);
  }

  await collectVisible(); // final sweep at the bottom
  scrollTo(restore); // be polite: put the view back

  const messages = Array.from(collected.values());

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
