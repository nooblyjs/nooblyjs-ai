// App shell: sidebar, router (History API), sign-in state and shared state.
import { html } from './html.js';
import { icons } from './icons.js';
import { api, setCsrf, whenSignedOut } from './api.js';
import { money } from './format.js';
import { loadingView, errorView, toast } from './ui.js';
import * as roster from './pages/roster.js';
import * as profile from './pages/profile.js';
import * as billing from './pages/billing.js';
import * as hire from './pages/hire.js';
import * as login from './pages/login.js';
import * as admin from './pages/admin.js';
import * as teamMemory from './pages/team-memory.js';
import * as settings from './pages/settings.js';
import * as timeline from './pages/timeline.js';
import { openDialog } from './ui.js';

const NAV = [
  { key: 'team', href: '/team', label: 'Team roster', icon: icons.team },
  { key: 'profiles', href: '/profiles', label: 'Profiles', icon: icons.profile },
  { key: 'timeline', href: '/timeline', label: 'Work timeline', icon: icons.clock },
  { key: 'billing', href: '/billing', label: 'Billing & timesheets', icon: icons.billing },
  { key: 'hire', href: '/hire', label: 'Hire a teammate', icon: icons.hire, role: 'manager' },
  { key: 'team-memory', href: '/team-memory', label: 'Team memory', icon: icons.memory },
  { key: 'settings', href: '/settings', label: 'Settings', icon: icons.settings, role: 'owner' },
  { key: 'admin', href: '/admin', label: 'Admin', icon: icons.key, role: 'owner' },
];

// Roles: viewer < manager < owner. The server enforces them; the UI hides what you can't use.
const RANK = { viewer: 1, manager: 2, owner: 3 };
const ROLE_LABEL = { viewer: 'Viewer', manager: 'Manager', owner: 'Owner' };
export const can = (role) => (RANK[ctx.session?.user?.role] ?? 0) >= RANK[role];

const ROUTES = [
  { pattern: /^\/(?:team)?\/?$/, nav: 'team', key: 'roster', page: roster, title: 'Team roster' },
  { pattern: /^\/team\/([a-z0-9-]+)\/?$/, nav: 'profiles', key: 'profile', page: profile, title: 'Profile' },
  { pattern: /^\/billing\/?$/, nav: 'billing', key: 'billing', page: billing, title: 'Billing & timesheets' },
  { pattern: /^\/hire\/?$/, nav: 'hire', key: 'hire', page: hire, title: 'Hire a teammate', role: 'manager' },
  { pattern: /^\/team-memory\/?$/, nav: 'team-memory', key: 'team-memory', page: teamMemory, title: 'Team memory' },
  { pattern: /^\/timeline\/?$/, nav: 'timeline', key: 'timeline', page: timeline, title: 'Work timeline' },
  { pattern: /^\/settings\/?$/, nav: 'settings', key: 'settings', page: settings, title: 'Settings', role: 'owner' },
  { pattern: /^\/admin\/?$/, nav: 'admin', key: 'admin', page: admin, title: 'Admin', role: 'owner' },
  { pattern: /^\/login\/?$/, nav: null, key: 'login', page: login, title: 'Sign in', public: true },
];

const LAST_PROFILE = 'teammates.lastProfile';
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

// One EventSource for the whole app; pages subscribe with ctx.on(type, handler).
const listeners = new Map();
let source = null;
function connectEvents() {
  if (source || !('EventSource' in window)) return;
  source = new EventSource('/api/events');
  for (const type of ['teammate', 'timesheet', 'alert', 'approval', 'work', 'schedule']) {
    source.addEventListener(type, (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      for (const fn of listeners.get(type) ?? []) fn(data);
    });
  }
}

let metaTimer = null;
const refreshMetaSoon = () => {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => ctx.refreshMeta(), 400);
};

const signedIn = () => Boolean(ctx.session?.authenticated);

function applyRole() {
  const role = ctx.session?.user?.role ?? 'viewer';
  for (const r of Object.keys(RANK)) document.body.classList.toggle(`role-${r}`, r === role);
  document.body.classList.toggle('can-manage', can('manager'));
  document.body.classList.toggle('can-own', can('owner'));
}

function startSession() {
  document.body.classList.remove('signed-out');
  applyRole();
  connectEvents();
  ctx.refreshMeta();
}

function endSession() {
  ctx.session = { ...ctx.session, authenticated: false };
  ctx.meta = null;
  setCsrf('');
  source?.close();
  source = null;
  document.body.classList.add('signed-out');
}

export const ctx = {
  meta: null,
  session: null,
  navigate,
  /** Subscribe to a live event type; returns an unsubscribe function. */
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },
  async refreshMeta() {
    try {
      ctx.meta = await api.get('/api/meta');
      renderSidebarFoot();
    } catch { /* sidebar keeps its last state */ }
    return ctx.meta;
  },
  rememberProfile: (id) => store.set(LAST_PROFILE, id),
  /** Called by the sign-in page with the session's CSRF token. */
  async signedIn(csrf, next = '/team') {
    setCsrf(csrf);
    try {
      ctx.session = await api.get('/api/session');
    } catch {
      ctx.session = { ...ctx.session, authenticated: true, setupRequired: false, csrf };
    }
    startSession();
    navigate(safeNext(next), { replace: true });
    if (ctx.session.user?.mustChangePassword) setTimeout(() => accountDialog({ first: true }), 300);
  },
  can,
  async signOut() {
    try { await api.del('/api/session'); } catch { /* already signed out */ }
    endSession();
    navigate('/login', { replace: true });
  },
  /** The server sign-out-everywhere clears our cookie too. */
  signedOutEverywhere() {
    endSession();
    navigate('/login', { replace: true });
  },
};

const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/team');

let cleanup = null;
let renderToken = 0;

function renderNav(active) {
  document.getElementById('nav').innerHTML = String(html`${NAV.filter((n) => !n.role || can(n.role)).map(
    (n) => html`<a href="${n.href}" class="nav-link${active === n.key ? ' active' : ''}" data-link ${active === n.key ? html`aria-current="page"` : ''}>${n.icon}<span>${n.label}</span></a>`,
  )}`);
}

function renderSidebarFoot() {
  const m = ctx.meta;
  if (!m) return;
  const b = m.sidebarBudget;
  const pct = Math.max(0, Math.min(100, Number(b.pct) || 0));
  const foot = document.getElementById('budget-mini');
  foot.classList.toggle('warn', b.pct >= (m.warnAtPct ?? 80));
  foot.innerHTML = String(html`
    <div class="budget-label">${b.label}</div>
    <div class="budget-meter" role="img" aria-label="${b.pct}% of budget used"><div class="budget-meter-fill" style="width:${pct}%"></div></div>
    <div class="budget-value">${money(b.used)} of ${money(b.budget)} used</div>
    ${b.pending ? html`<div class="budget-pending">incl. ${money(b.pending)} pending</div>` : ''}`);
  const u = ctx.session?.user ?? { name: m.owner?.name, role: 'owner' };
  document.getElementById('owner').innerHTML = String(html`
    <button type="button" class="owner-account" data-account aria-label="Your account: ${u.name}, ${ROLE_LABEL[u.role]}">
      <span class="owner-avatar" aria-hidden="true">${(u.name ?? '?').slice(0, 1)}</span>
      <span class="owner-info"><span class="owner-name">${u.name}</span><span class="owner-role">${u.role === 'owner' && m.owner?.title ? m.owner.title : ROLE_LABEL[u.role]}</span></span>
    </button>
    <button type="button" class="owner-signout" data-signout aria-label="Sign out" title="Sign out">${icons.signOut}</button>`);
}

function setNavOpen(open) {
  document.getElementById('shell').classList.toggle('nav-open', open);
  const toggle = document.getElementById('menu-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  toggle.innerHTML = String(open ? icons.close : icons.menu);
}

async function resolveProfilesRoute() {
  const last = store.get(LAST_PROFILE);
  if (last) return `/team/${last}`;
  try {
    const { teammates } = await api.get('/api/teammates');
    return teammates[0] ? `/team/${teammates[0].id}` : '/team';
  } catch {
    return '/team';
  }
}

async function render() {
  const token = ++renderToken;
  let path = location.pathname;
  let route = ROUTES.find((r) => r.pattern.test(path));
  // Signed-out visitors only ever see the sign-in page; it sends them back where they were going.
  if (!signedIn() && !route?.public) {
    const next = path + location.search;
    history.replaceState(null, '', `/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
    path = '/login';
    route = ROUTES.find((r) => r.key === 'login');
  } else if (signedIn() && route?.key === 'login') {
    path = safeNext(new URLSearchParams(location.search).get('next'));
    history.replaceState(null, '', path);
    route = ROUTES.find((r) => r.pattern.test(path));
  }
  if (path === '/profiles' || path === '/profiles/') {
    path = await resolveProfilesRoute();
    history.replaceState(null, '', path);
    route = ROUTES.find((r) => r.pattern.test(path));
  }
  const view = document.getElementById('view');
  cleanup?.();
  cleanup = null;
  setNavOpen(false);

  if (route?.role && signedIn() && !can(route.role)) {
    renderNav(route.nav);
    view.className = '';
    document.title = 'Not allowed · Teammates';
    view.innerHTML = String(html`<div class="error-state card"><h2>That page is for ${route.role === 'owner' ? 'owners' : 'managers and owners'}</h2><p>You are signed in as a ${ROLE_LABEL[ctx.session.user?.role] ?? 'viewer'}. Ask the owner if you need more access.</p><a class="btn btn-secondary" href="/team" data-link>Back to the roster</a></div>`);
    return;
  }
  if (!route) {
    renderNav(null);
    view.className = '';
    document.title = 'Not found · Teammates';
    view.innerHTML = String(html`<div class="error-state card"><h2>We couldn't find that page</h2><p>It may have moved, or the teammate may no longer be on the team.</p><a class="btn btn-secondary" href="/team" data-link>Back to the roster</a></div>`);
    return;
  }
  renderNav(route.nav);
  view.className = `page-${route.key}`;
  document.title = `${route.title} · Teammates`;
  view.innerHTML = String(loadingView());
  const params = route.pattern.exec(path).slice(1);
  try {
    const result = await route.page.render(view, { params, query: new URLSearchParams(location.search), ctx, isCurrent: () => token === renderToken });
    if (token !== renderToken) return result?.cleanup?.();
    cleanup = result?.cleanup ?? null;
  } catch (err) {
    if (token !== renderToken || !signedIn()) return;
    console.error(err);
    view.innerHTML = String(errorView(err));
    view.querySelector('[data-action="retry"]')?.addEventListener('click', render);
  }
}

export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  render().then(() => {
    window.scrollTo(0, 0);
    if (!location.hash) document.getElementById('main').focus({ preventScroll: true });
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-signout]')) {
    ctx.signOut();
    return;
  }
  if (e.target.closest('[data-account]')) {
    accountDialog();
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
  if (a.getAttribute('href').startsWith('#')) return; // in-page anchors
  if (a.pathname.startsWith('/api/')) return;
  e.preventDefault();
  if (a.pathname + a.search !== location.pathname + location.search) navigate(a.pathname + a.search);
  else setNavOpen(false);
});

window.addEventListener('popstate', render);
document.getElementById('menu-toggle').addEventListener('click', () => setNavOpen(!document.getElementById('shell').classList.contains('nav-open')));
document.getElementById('scrim').addEventListener('click', () => setNavOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('shell').classList.contains('nav-open')) setNavOpen(false);
});

// A request that comes back "Sign in to continue" means the session expired or was revoked elsewhere.
whenSignedOut(() => {
  if (!signedIn()) return;
  endSession();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  toast('Your session ended. Sign in again to carry on.', { error: true });
  const next = location.pathname + location.search;
  navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
});

/** Your own account: name, role, and changing your password (required after a temporary password). */
async function accountDialog({ first = false } = {}) {
  const u = ctx.session?.user;
  if (!u) return;
  await openDialog({
    title: first ? 'Choose your own password' : 'Your account',
    body: html`
      <form id="acct-form" class="modal-body" style="padding:0" novalidate>
        ${first ? html`<p class="notice">You signed in with a temporary password. Choose your own now; it signs out any other browser using the old one.</p>` : html`<p>${u.name} · <strong>${ROLE_LABEL[u.role]}</strong>${u.username ? html` · username <code>${u.username}</code>` : ''}</p>`}
        <div class="form-group"><label class="form-label" for="acct-current">${first ? 'Temporary password' : 'Current password'}</label><input class="form-input" id="acct-current" name="current" type="password" autocomplete="current-password" aria-describedby="acct-err-current"><span class="field-error" id="acct-err-current"></span></div>
        <div class="form-group"><label class="form-label" for="acct-next">New password</label><input class="form-input" id="acct-next" name="next" type="password" autocomplete="new-password" aria-describedby="acct-err-next"><span class="field-error" id="acct-err-next"></span></div>
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>${first ? 'Later' : 'Close'}</button><button type="submit" form="acct-form" class="btn btn-primary">Change password</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#acct-form');
      form.current.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
        if (form.next.value.length < 10) return (dialog.querySelector('#acct-err-next').textContent = 'At least 10 characters');
        try {
          const { csrf } = await api.post('/api/session/password', { current: form.current.value, next: form.next.value });
          setCsrf(csrf);
          ctx.session = { ...ctx.session, csrf, user: { ...u, mustChangePassword: false } };
          toast('Password changed');
          dialog.close('done');
        } catch (err) {
          if (err.details?.current) dialog.querySelector('#acct-err-current').textContent = err.details.current;
          else if (err.details?.next) dialog.querySelector('#acct-err-next').textContent = err.details.next;
          else toast(err.message, { error: true });
        }
      });
    },
  });
}

setNavOpen(false);
ctx.on('timesheet', refreshMetaSoon);
// Cap and budget warnings, and tasks waiting for approval, are announced wherever you are in the app.
ctx.on('alert', (a) => toast(a.message, { error: a.level === 'reached' }));
ctx.on('approval', (a) => {
  if (a.status === 'pending') toast(`${a.teammateName} has a task waiting for your approval (est. ${money(a.amount)}). See Billing.`);
  else if (a.outcome === 'failed') toast(`An approved task could not run: ${a.error}`, { error: true });
});

(async () => {
  try {
    ctx.session = await api.get('/api/session');
  } catch {
    ctx.session = { authenticated: false };
  }
  if (signedIn()) {
    setCsrf(ctx.session.csrf);
    startSession();
    if (ctx.session.user?.mustChangePassword) setTimeout(() => accountDialog({ first: true }), 600);
  } else {
    document.body.classList.add('signed-out');
  }
  render();
})();
