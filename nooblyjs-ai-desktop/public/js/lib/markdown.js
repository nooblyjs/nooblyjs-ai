import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text ?? ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'onerror', 'onload']
  });
}

/** Upgrades server-rendered plain-text assistant messages to rendered Markdown. */
export function hydrateMarkdown(root = document) {
  for (const el of root.querySelectorAll('[data-markdown]')) {
    el.innerHTML = renderMarkdown(el.textContent);
    el.removeAttribute('data-markdown');
  }
}
