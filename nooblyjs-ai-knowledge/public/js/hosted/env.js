// `__wikiEnv`: what the wiki's pages use in place of the browser globals a hosted page may not touch
// (noobly docs/hosted-apps/porting-an-app.md §2). scripts/port-wiki-ui.mjs rewrites every use in the generated UI
// (public/app) to a call here, so the app's own code is unchanged:
//
//   fetch / XMLHttpRequest   send the host's CSRF token with every change
//   location / history       the app thinks it is at <mount>/<Space>/<path>; the address bar says <mount>/#/<Space>/<path>.
//                            The frame owns the path and its router redraws the page on every path change, so the
//                            wiki's own navigation lives in the hash, which the frame leaves alone
//   onPopState               back/forward within the wiki (a hash change the wiki did not make itself)
//   onReady                  DOMContentLoaded: the page's markup is in the frame
//   windowEvents / documentEvents   addEventListener on window and document, heard only while the wiki is on screen
//   io                       the Socket.IO client's shape, fed from the frame's one event stream
//   portal                   where dialogs and toasts go instead of <body>: an element at the end of the page that
//                            carries data-module="wiki", so the app's scoped CSS still reaches them
//
// It is a global because half of the UI is classic scripts (the Markdown parser and editor), which cannot import.
import { csrfToken } from '/ui/js/api.js';

/** The mount path, from where this file was served: <mount>/js/hosted/env.js. */
export const MOUNT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const sameOrigin = (url) => new URL(url, window.location.href).origin === window.location.origin;

// ---------------------------------------------------------------------------- requests

function fetchWithToken(input, init = {}) {
  const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = input instanceof Request ? input.url : String(input);
  if (!CHANGES.has(method) || !sameOrigin(url)) return window.fetch(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', csrfToken());
  return window.fetch(input, { ...init, headers });
}

class TokenXhr extends window.XMLHttpRequest {
  open(method, url, ...rest) {
    this._needsToken = CHANGES.has(String(method).toUpperCase()) && sameOrigin(url);
    return super.open(method, url, ...rest);
  }

  send(body) {
    if (this._needsToken) this.setRequestHeader('X-CSRF-Token', csrfToken());
    return super.send(body);
  }
}

// ---------------------------------------------------------------------------- where the wiki is

/** The wiki's own location, read from the hash: '#/Space/a/b?q=x' → { path: '/Space/a/b', search: '?q=x' }. */
function inner() {
  const hash = window.location.hash.replace(/^#/, '');
  const q = hash.indexOf('?');
  const path = q === -1 ? hash : hash.slice(0, q);
  return { path: path.startsWith('/') ? path : `/${path}`, search: q === -1 ? '' : hash.slice(q) };
}

const states = new Map(); // hash → the state object the app pushed with it
let expected = null; // the hash this file just set: its hashchange is not a back/forward
const popListeners = new Set();

/** Goes to a URL the app asked for: inside the wiki it becomes the hash; anything else is a real navigation. */
function go(url, { replace = false, state = null } = {}) {
  const target = new URL(String(url), window.location.origin + location.pathname + location.search);
  const inside = target.origin === window.location.origin && (target.pathname === MOUNT || target.pathname.startsWith(`${MOUNT}/`));
  if (!inside) return window.location.assign(target.href);
  const hash = `#${target.pathname.slice(MOUNT.length) || '/'}${target.search}`;
  states.set(hash, state);
  if (hash === (window.location.hash || '#/')) return undefined;
  expected = hash;
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
  return undefined;
}

const location = {
  get pathname() { return MOUNT + inner().path; },
  get search() { return inner().search; },
  get hash() { return ''; },
  get origin() { return window.location.origin; },
  get host() { return window.location.host; },
  get hostname() { return window.location.hostname; },
  get protocol() { return window.location.protocol; },
  get href() { return this.origin + this.pathname + this.search; },
  set href(url) { go(url); },
  assign: (url) => go(url),
  replace: (url) => go(url, { replace: true }),
  reload: () => window.location.reload(),
  toString() { return this.href; },
};

const history = {
  pushState: (state, title, url) => (url == null ? undefined : go(url, { state })),
  replaceState: (state, title, url) => (url == null ? undefined : go(url, { replace: true, state })),
  get state() { return states.get(window.location.hash || '#/') ?? null; },
  get length() { return window.history.length; },
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  go: (n) => window.history.go(n),
};

window.addEventListener('hashchange', () => {
  const mine = expected !== null && window.location.hash === expected;
  expected = null;
  // Only while the wiki is on screen: the same listener would otherwise answer another app's anchors.
  if (mine || !env.attached) return;
  for (const fn of popListeners) fn({ state: history.state });
});

// ---------------------------------------------------------------------------- start-up and the page's lifetime

const scripts = new Map(); // src → the one load, so a library both sets of pages use (Bootstrap) runs once per tab

/** Loads a classic script from this app's files (a path under the mount), once. Scripts run in the order asked. */
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src.startsWith('/') ? src : `${MOUNT}/${src}`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`The wiki could not load ${src}.`));
      document.head.append(script);
    }));
  }
  return scripts.get(src);
}

let ready = false;
const readyQueue = [];

/** A place for dialogs and toasts that the scoped CSS still reaches. */
function portal() {
  let el = document.getElementById('wiki-portal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wiki-portal';
    el.dataset.module = 'wiki';
    document.body.append(el);
  }
  return el;
}

// ---------------------------------------------------------------------------- page-wide listeners

// The wiki's DOM is kept while the person is in another NooblyJS app, so its listeners on window and document are
// still bound there. They are held back until it is on screen again: a click in Teammates is not the wiki's.
// Leaving the tab is the exception: unsaved text is flushed on pagehide wherever the person is.
const ALWAYS = new Set(['pagehide', 'beforeunload', 'unload', 'visibilitychange']);
function gated(target, onScreen) {
  const wrapped = new WeakMap(); // the app's listener → what was actually bound, for removeEventListener
  return {
    addEventListener(type, fn, options) {
      if (typeof fn !== 'function' || ALWAYS.has(type)) return target.addEventListener(type, fn, options);
      if (!wrapped.has(fn)) wrapped.set(fn, function heardOnScreen(event) { return onScreen() ? fn.call(this, event) : undefined; });
      return target.addEventListener(type, wrapped.get(fn), options);
    },
    removeEventListener(type, fn, options) {
      return target.removeEventListener(type, (typeof fn === 'function' && wrapped.get(fn)) || fn, options);
    },
  };
}

// ---------------------------------------------------------------------------- live updates

const socketListeners = new Map(); // Socket.IO event name → Set<fn>
const dispatch = (event, payload) => {
  for (const fn of socketListeners.get(event) ?? []) fn(payload);
};

let changeCursor = null; // the newest change already handed to the app (the feed's own timestamp)
let pulling = null;
let pullAgain = false;

/** Fetches the changes since the cursor from GET changes and dispatches each. One request at a time. */
function pullChanges() {
  if (pulling) {
    pullAgain = true;
    return pulling;
  }
  pulling = (async () => {
    try {
      // The first call only finds where "now" is: what happened before the page opened is already on screen.
      const first = changeCursor === null;
      const query = first ? 'limit=1' : `since=${encodeURIComponent(changeCursor)}`;
      const res = await fetchWithToken(`${MOUNT}/api/v1/changes?${query}`, { cache: 'no-store' });
      if (!res.ok) return;
      const feed = await res.json();
      changeCursor = feed.cursor ?? changeCursor ?? feed.serverTime;
      if (!first) for (const change of feed.events ?? []) dispatch('wiki:file-change', change);
    } catch { /* the next signal tries again */ } finally {
      pulling = null;
      if (pullAgain) {
        pullAgain = false;
        pullChanges();
      }
    }
  })();
  return pulling;
}

/** The parts of a Socket.IO client the app uses. Events arrive from the frame's event stream (see attach()). */
function io() {
  const socket = {
    connected: true,
    id: 'noobly-sse',
    on(event, fn) {
      if (!socketListeners.has(event)) socketListeners.set(event, new Set());
      socketListeners.get(event).add(fn);
      if (event === 'connect') queueMicrotask(fn);
      return socket;
    },
    off(event, fn) {
      socketListeners.get(event)?.delete(fn);
      return socket;
    },
    emit: () => socket, // rooms are the server's concern here: the stream already knows who is signed in
    disconnect: () => socket,
    close: () => socket,
  };
  return socket;
}

export const env = {
  MOUNT,
  fetch: fetchWithToken,
  XMLHttpRequest: TokenXhr,
  location,
  history,
  io,
  windowEvents: gated(window, () => env.attached),
  documentEvents: gated(document, () => env.attached),
  attached: false,
  /**
   * The datasources screens (pages/datasources.js) are a second set of pages in the same app. Their page-wide
   * listeners and their dialogs are kept apart from the wiki's: a click in the wiki is not theirs (and the other
   * way round), and their stylesheet (css/wiki-ds.css) only reaches what sits under `.ds-root`.
   */
  ds: {
    attached: false,
    windowEvents: gated(window, () => env.ds.attached),
    documentEvents: gated(document, () => env.ds.attached),
    get portal() {
      let el = document.querySelector('#wiki-ds-portal > .ds-root');
      if (!el) {
        const scope = document.createElement('div');
        scope.id = 'wiki-ds-portal';
        scope.dataset.module = 'wiki';
        el = document.createElement('div');
        el.className = 'ds-root';
        scope.append(el);
        document.body.append(scope);
      }
      return el;
    },
    attach(ctx) {
      env.ds.attached = true;
      ctx.signal.addEventListener('abort', () => { env.ds.attached = false; }, { once: true });
    },
  },
  get portal() { return portal(); },
  onPopState(fn) { popListeners.add(fn); },
  onReady(fn) {
    if (ready) fn();
    else readyQueue.push(fn);
  },
  /** The markup is in the frame: run what waited for DOMContentLoaded. */
  ready() {
    ready = true;
    for (const fn of readyQueue.splice(0)) fn();
  },
  /**
   * The wiki is on screen with this page context. The frame's stream subscriptions end with the page (ctx.signal),
   * so they are made again on every visit.
   */
  attach(ctx) {
    env.attached = true;
    env.person = ctx.person;
    ctx.signal.addEventListener('abort', () => { env.attached = false; }, { once: true });
    // The frame's stream says THAT something changed, not what: it carries no payload. The wiki's own change feed
    // has the events, so each signal fetches what is new since the last one and hands it on as Socket.IO did.
    ctx.sse.on('wiki.file_changed', () => { pullChanges(); });
    if (changeCursor === null) pullChanges();
    // A notification for one person is announced without its content (index.mjs broadcast()): fetch it here.
    ctx.sse.on('wiki.user_notified', () => window.wikiApp?.notificationController?.refresh?.());
  },
};

window.__wikiEnv = env;
