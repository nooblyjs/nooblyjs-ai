// What Teammates' pages share in the browser: where the app is mounted, its API client (the UI kit's, bound to the
// mount path), the reader for a streamed task, the app's meta and session, and what a page gets when it opens.
// Pages are called by the NooblyJS frame as render(view, { params, query, ctx, route }) and destroy()
// (noobly structure.md §2a). Live updates come over the frame's one event stream (ctx.sse): the app has none of its own.
import { createApi, csrfToken, ApiError } from '/ui/js/api.js';
import { toast } from './ui.js';
import { money } from './format.js';

export { ApiError };

/** Where the app is mounted on the site, e.g. /teammates, worked out from this file's own URL (<mountPath>/js/client.js). */
export const BASE = new URL('../', import.meta.url).pathname.replace(/\/$/, '');

/** '/team/ada' → '/teammates/team/ada'. Other URLs (https://…, #anchors) are left alone. */
export const appUrl = (path) => (typeof path === 'string' && /^\/(?![/\\])/.test(path) ? BASE + path : path);

/** Teammates roles → the NooblyJS permission behind each (same table as src/services/auth.js PERMISSION_FOR_ROLE). */
export const PERMISSION_FOR_ROLE = { viewer: 'read', manager: 'approve', owner: 'set-budgets', hire: 'hire-teammates', post: 'draft' };

/** The NooblyJS event each kind of live update arrives as (src/services/events.js HOST_EVENT). */
const LIVE = {
  teammate: 'teammates.teammate_changed',
  timesheet: 'teammates.timesheet_changed',
  work: 'teammates.work_changed',
  approval: 'teammates.approval_changed',
  schedule: 'teammates.schedule_changed',
  alert: 'teammates.alert_raised',
  board: 'teammates.board_changed',
};
const LAST_PROFILE = 'teammates.lastProfile';

// ---------------------------------------------------------------------------- the API

const kit = createApi(BASE);
/** A session that ended elsewhere: NooblyJS's sign-in brings the person back to this page. */
const call = (request) => request.catch((err) => {
  if (err?.status === 401 && err.code === 'unauthenticated') location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  throw err;
});

/** The app's JSON API. URLs are paths inside the app ('/api/v1/teammates'). */
export const api = {
  get: (url) => call(kit.get(url)),
  post: (url, body = {}) => call(kit.post(url, body)),
  patch: (url, body) => call(kit.patch(url, body)),
  put: (url, body) => call(kit.put(url, body)),
  del: (url, body) => call(kit.del(url, { body })),
};

/** POST a task and read its answer as it streams (text/event-stream). `on` maps event names to handlers. */
export async function stream(url, body, on, signal) {
  const res = await fetch(appUrl(url), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-CSRF-Token': csrfToken() },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'http_error', e.message ?? `Request failed (${res.status})`, e.details);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (data) on[event]?.(JSON.parse(data));
    }
  }
}

// ---------------------------------------------------------------------------- what the app knows

const shared = { session: null, meta: null, started: null };

const remember = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

export async function refreshMeta() {
  try {
    shared.meta = await api.get('/api/v1/meta');
  } catch { /* keep the last one */ }
  return shared.meta;
}

/** Once per tab, the first time Teammates opens: who you are here, and the app's meta (models, budgets). */
export function start() {
  shared.started ??= (async () => {
    shared.session = await api.get('/api/v1/session').catch(() => ({ authenticated: false }));
    await refreshMeta();
  })();
  return shared.started;
}

/** The profile looked at last (for /profiles), or null. */
export const lastProfile = () => remember.get(LAST_PROFILE);

/**
 * What a page of the app works with, on top of the frame's ctx: the app's meta and session, `on(kind, fn)` for live
 * updates (unsubscribed when the person leaves the page), and `can('manager')` in the app's own role names.
 */
export function appCtx(ctx) {
  return {
    get meta() { return shared.meta; },
    get session() { return shared.session; },
    signal: ctx.signal,
    isCurrent: ctx.isCurrent,
    navigate: (path, options) => ctx.navigate(path, options),
    on: (kind, fn) => ctx.sse.on(LIVE[kind] ?? kind, (event) => fn(event.live ?? {})),
    refreshMeta,
    rememberProfile: (id) => remember.set(LAST_PROFILE, id),
    /** A UI hint from the person's NooblyJS permissions. The API enforces the same rule. */
    can: (role) => ctx.can(PERMISSION_FOR_ROLE[role] ?? role),
  };
}

/** While a Teammates page is open: cap and budget warnings and tasks waiting for approval are announced, and the meta stays fresh. */
function announce(tm) {
  let timer = null;
  tm.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  tm.on('timesheet', () => {
    clearTimeout(timer);
    timer = setTimeout(refreshMeta, 400);
  });
  tm.on('alert', (a) => a.message && toast(a.message, { error: a.level === 'reached' }));
  tm.on('approval', (a) => {
    if (a.status === 'pending') toast(`${a.teammateName} has a task waiting for your approval (est. ${money(a.amount)}). See Billing.`);
    else if (a.outcome === 'failed') toast(`An approved task could not run: ${a.error}`, { error: true });
  });
}

/**
 * Opens a page: the app is started, and the page gets its element inside the frame's view and the app's ctx.
 * `key` is the page's CSS hook (.page-<key>). Pages not yet on the UI kit's components (`kit: false`) render inside
 * .tm-root, where the app's older component styles apply; a page on the kit renders inside .tm-kit, where they don't.
 */
export async function enter(frameView, ctx, key, { kit: onKit = false } = {}) {
  await start();
  const tm = appCtx(ctx);
  const root = document.createElement('div');
  root.className = onKit ? 'tm-kit' : 'tm-root';
  root.classList.toggle('can-manage', tm.can('manager'));
  root.classList.toggle('can-own', tm.can('owner'));
  const view = document.createElement('div');
  view.className = `page-${key}`;
  root.append(view);
  frameView.replaceChildren(root);
  announce(tm);
  return { view, ctx: tm };
}
