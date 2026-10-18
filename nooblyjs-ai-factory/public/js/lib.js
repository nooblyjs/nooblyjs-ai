// Phase F26: what every factory page in the NooblyJS frame shares. Plain modules, no framework.
//
//   h()      builds elements from text nodes, never from markup: agent output and issue text are
//            untrusted, and these pages have buttons that act
//   page()   turns a view (a function that returns nodes) into the frame's page contract,
//            render(view, { params, ctx }), and keeps it fresh while it is open
//
// The frame owns the document. A page draws only into its own root element (.fx-root), reaches
// the API through ctx.api (bound to <mountPath>/api/v1, with the CSRF token) and navigates with
// plain links, which the frame routes without a reload.

import { notice } from '/ui/js/components/index.js';

/** h('div.card', { onclick }, 'text', child…): an element, safely. */
export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'className') el.className += ` ${v}`;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
/**
 * A UI kit component as an element. The kit's components return SafeHtml: every value in it was escaped
 * by the kit's html tag, so this is the one place a page parses markup, and never from text of its own.
 */
export const kit = (safe) => document.createRange().createContextualFragment(String(safe)).firstElementChild;
/** An SVG element (icons, avatars). Attributes only, no text. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children.flat().filter(Boolean));
  return el;
}

export const money = (n) => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 4)}`;
export const since = (iso) => {
  if (!iso) return '';
  const t = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return t < 60 ? `${t}s` : t < 3600 ? `${Math.round(t / 60)}m` : t < 86400 ? `${Math.round(t / 3600)}h` : `${Math.round(t / 86400)}d`;
};
export const ago = (iso) => (iso ? `${since(iso)} ago` : '');
export const fmtDur = (ms) => (ms == null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
export const secs = (a, b) => (a ? `${Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000)}s` : '');
export const clock = (a) => {
  const t = Math.max(0, Math.round((Date.now() - Date.parse(a)) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
export const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
export const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
export const human = (id) => cap(String(id ?? '').replace(/[-_]/g, ' '));
export const shortId = (id) => String(id).slice(-10);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const word = (n) => WORDS[n] ?? String(n);
export const plural = (n, one, many = `${one}s`) => `${word(n)} ${n === 1 ? one : many}`;

export const ACTIVE = ['queued', 'running', 'parked', 'paused'];
export const DELIVERED = ['delivered', 'merged'];
export const isStopped = (r) => !ACTIVE.includes(r.status) && !DELIVERED.includes(r.status);

// Runs that stopped and that this person has looked at (kept in this browser only).
let dismissed = new Set();
try {
  dismissed = new Set(JSON.parse(localStorage.getItem('factory-dismissed') ?? '[]'));
} catch {}
const dismissKey = (r) => `${r.id}#${r.attempt ?? 1}`;
export function dismiss(r) {
  dismissed.add(dismissKey(r));
  try {
    localStorage.setItem('factory-dismissed', JSON.stringify([...dismissed].slice(-200)));
  } catch {}
}
/** Runs that stopped in the last day and nobody has looked at: the inbox shows them too. */
export const stoppedToReview = (runs) => runs.filter((r) => isStopped(r) && r.status !== 'cancelled' && r.endedAt && Date.now() - Date.parse(r.endedAt) < 86_400_000 && !dismissed.has(dismissKey(r)));

const POLL_MS = 4000;
const LIVE = ['run.started', 'run.finished', 'run.asked']; // what the factory tells the host's event stream

/**
 * A frame page from a view. `draw(p)` returns the page's nodes; `p` is what a view works with:
 *   p.get(path) / p.post(path, body)   the factory API
 *   p.href('/runs/x')                   a link inside the app, under whatever mount path it has
 *   p.act(fn)                           a click handler: run fn, then draw again; say so if it fails
 *   p.redraw()                          draw again now
 *   p.system()                          { s, runs, waiting }: the status and recent runs most views start from
 *   p.dialog(...nodes)                  show a modal dialog
 *   p.can(permission)                   a hint about what this person may do (the API enforces it)
 */
export function page(draw) {
  return async function render(view, { params, ctx }) {
    const body = h('div');
    const dialog = h('dialog');
    const root = h('div.fx-root', {}, body, dialog);
    view.replaceChildren(root);
    let seq = null;
    let busy = false;
    let again = false;

    const p = {
      ctx, params, root,
      get: (path) => ctx.api.get(path),
      post: (path, data = {}) => ctx.api.post(path, data),
      href: (path) => `${ctx.app.mountPath}${path}`,
      can: (permission) => ctx.can(permission),
      redraw: (options) => redraw(options),
      act: (fn) => async (e) => {
        e.preventDefault();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await fn();
          await redraw({ force: true });
        } catch (error) {
          if (error.name !== 'AbortError') alert(error.message);
        } finally {
          btn.disabled = false;
        }
      },
      async system() {
        const [status, { runs }] = await Promise.all([p.get('status'), p.get('runs?limit=100')]);
        seq = status.seq;
        return { s: status, runs, waiting: status.inbox + stoppedToReview(runs).length };
      },
      dialog(...nodes) {
        dialog.replaceChildren(...nodes, h('div.btns', {}, h('button.primary', { onclick: () => dialog.close() }, 'Done')));
        dialog.showModal();
      },
    };

    async function paint({ force = false } = {}) {
      // Don't throw away what someone is typing in a form.
      if (!force && [...body.querySelectorAll('textarea')].some((t) => t.value)) return;
      // Keep focus, the caret and the agent output's scroll position across live re-draws.
      const focused = root.contains(document.activeElement) ? document.activeElement.id : null;
      const caret = document.activeElement?.selectionStart;
      const term = body.querySelector('.terminal');
      const termAtEnd = !term || term.scrollTop + term.clientHeight >= term.scrollHeight - 24;
      const termTop = term?.scrollTop;
      let nodes;
      try {
        nodes = await draw(p);
      } catch (error) {
        if (error.name === 'AbortError') return;
        nodes = kit(notice({ title: 'Something went wrong', text: error.message, tone: 'error' }));
      }
      if (!ctx.isCurrent()) return;
      body.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
      const back = focused && body.querySelector(`#${CSS.escape(focused)}`);
      if (back) {
        back.focus();
        if (caret != null && back.setSelectionRange) back.setSelectionRange(caret, caret);
      }
      const t = body.querySelector('.terminal');
      if (t) t.scrollTop = termAtEnd ? t.scrollHeight : termTop;
    }
    /** One draw at a time; a request that arrives meanwhile draws once more afterwards. */
    async function redraw(options) {
      if (!ctx.isCurrent()) return;
      if (busy) return void (again = true);
      busy = true;
      try {
        await paint(options);
      } finally {
        busy = false;
      }
      if (again) {
        again = false;
        return redraw();
      }
    }

    await redraw({ force: true });

    // Live: the host's event stream says when a run starts, finishes or asks. Work done by other
    // processes (factory serve) shows up as a new seq on the log, which we look for while visible.
    let soon = null;
    for (const topic of LIVE) ctx.sse.on(topic, () => (clearTimeout(soon), (soon = setTimeout(redraw, 300))));
    const poll = setInterval(async () => {
      if (document.hidden || busy) return;
      try {
        if ((await p.get('status')).seq !== seq) redraw();
      } catch {}
    }, POLL_MS);
    ctx.signal.addEventListener('abort', () => (clearInterval(poll), clearTimeout(soon), dialog.open && dialog.close()), { once: true });
  };
}
