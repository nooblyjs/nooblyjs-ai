// The side panel: is NooblyJS reachable, and what is on the page the person has open.
// The chat is a placeholder until Phase 14; nothing here sends page content anywhere yet.
import { checkNoobly, nooblyUrl, whoAmI } from '../shared.js';

const $ = (id) => document.getElementById(id);

/** Builds an element with text only (page content never goes through innerHTML). */
function el(tag, { text, className } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  node.append(...children);
  return node;
}

async function showStatus() {
  const status = $('status');
  const result = await checkNoobly();
  status.className = `pill ${result.ok ? 'pill-ok' : 'pill-danger'}`;
  status.textContent = result.ok ? 'Connected to NooblyJS' : result.reason || 'Not connected';
  status.title = result.url;
  $('open-noobly').href = result.url;
}

/**
 * Who you are in NooblyJS: the session you already have there (no separate sign-in). If you aren't signed in, the link
 * opens NooblyJS's /login in a tab; the panel checks again when you come back to it.
 */
async function showWho() {
  const who = $('who');
  const url = await nooblyUrl();
  const me = await whoAmI();
  if (me.person) {
    who.replaceChildren(el('span', { text: 'Signed in as ' }), el('strong', { text: me.person.name || me.person.id }),
      el('span', { className: 'muted-inline', text: ` · ${me.person.accessRole}` }));
    return;
  }
  if (me.onboarding) {
    const link = el('a', { text: 'Finish onboarding in NooblyJS' });
    link.href = `${url}/onboarding`; link.target = '_blank'; link.rel = 'noopener';
    who.replaceChildren(link);
    return;
  }
  if (me.reason) { who.replaceChildren(el('span', { className: 'muted-inline', text: me.reason })); return; }
  const link = el('a', { text: 'Sign in to NooblyJS' });
  link.href = `${url}/login`; link.target = '_blank'; link.rel = 'noopener';
  who.replaceChildren(link, el('span', { className: 'muted-inline', text: ' (in a tab, with your Microsoft account)' }));
}

/** Asks the Jira content script on the active tab; any other page has none and answers nothing. */
async function pageContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'noobly:context' });
  } catch {
    return null;
  }
}

async function showPage() {
  const page = $('page');
  const ctx = await pageContext();
  if (!ctx) {
    page.replaceChildren(el('p', { className: 'muted', text: 'Open a Jira issue to talk about it here.' }));
    return;
  }
  if (!ctx.key) {
    page.replaceChildren(el('p', { className: 'muted', text: `You're on Jira (${ctx.site}). Open an issue to talk about it.` }));
    return;
  }
  const rows = [['Issue', ctx.key], ['Summary', ctx.summary], ['Type', ctx.type], ['Status', ctx.status]]
    .filter(([, value]) => value)
    .flatMap(([label, value]) => [el('dt', { text: label }), el('dd', { text: value })]);
  page.replaceChildren(
    el('dl', { className: 'facts' }, ...rows),
    el('p', { className: 'muted', text: 'Read from the page you have open. Nothing has been sent to NooblyJS.' }),
  );
}

chrome.tabs.onActivated.addListener(() => { showPage(); showWho(); });
window.addEventListener('focus', () => showWho());
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'noobly:context-changed') showPage();
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.nooblyUrl) { showStatus(); showWho(); }
});

nooblyUrl().then((url) => { $('open-noobly').href = url; });
showStatus();
showWho();
showPage();
