// The datasources screens, in the NooblyJS frame: workflows, schedules, runs, spaces, repositories, agents, prompts,
// user activity and settings (standalone: /applications/datasources).
//
// Standalone, js/app.js drew a UIService shell (header, sidebar, sign-in) and handed every screen to the app's own
// Router, which renders into #mainContent. Here the frame draws the shell: the sidebar rows are the app's nav
// (index.mjs NAV), each row is a route (module.js) and this one page serves them all, by giving the Router its
// #mainContent and telling it which screen the route names. The screens themselves are the standalone ones,
// generated into ../../app/ds by scripts/port-wiki-ui.mjs.
//
// Like the wiki (pages/wiki.js) the screens start ONCE per tab and their DOM is kept between visits.
import { env, MOUNT, loadScript } from '../hosted/env.js';

// What the standalone page took from CDNs and from nooblyjs-core, before its own scripts.
const LIBRARIES = [
  'vendor/bootstrap/bootstrap.bundle.min.js',
  'vendor/codemirror/lib/codemirror.js',
  'vendor/codemirror/mode/javascript/javascript.js',
  'vendor/codemirror/addon/hint/show-hint.js',
  'vendor/codemirror/addon/hint/javascript-hint.js',
];
// The settings console is nooblyjs-core's, served by the host itself. Without it the Settings screen says so.
const SETTINGS_CONSOLE = '/services/settings/scripts/js/index.js';

// A screen the Router shows without a sidebar row of its own → the row (and the URL) it belongs to.
const ROW_OF = { workflowEdit: 'workflows', repository: 'repositories', 'user-activity-detail': 'user-activity' };
const pathOf = (screen) => (screen === 'dashboard' ? '/datasources' : `/datasources/${screen}`);

let root = null; // the screens' DOM, kept between visits
let started = null; // the one start-up, as a promise
let ctx = null; // the page context of the visit that is on screen
let shown = null; // the screen the address bar names
let arriving = null; // a screen the app itself opened, whose route is on its way: it is already drawn

/**
 * The frame's policy runs no inline script, so the on…="" attributes in the screens' HTML are dead. There are
 * two kinds, done here from what the attribute says: an avatar that did not load steps aside, and the step
 * editors' `window.<editor>Instance?.<method>(<arguments>)`. A new kind would do nothing: use addEventListener.
 */
function bindInlineHandlers(host) {
  host.addEventListener('error', (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.getAttribute('onerror') === 'this.remove()') img.remove();
  }, true);
  const call = (event) => {
    const el = event.target.closest(`[on${event.type}]`);
    const m = /^window\.(\w+Instance)\?\.(\w+)\((.*)\)$/.exec(el?.getAttribute(`on${event.type}`)?.trim() ?? '');
    if (!m || typeof window[m[1]]?.[m[2]] !== 'function') return;
    // The arguments are quoted strings, numbers and `this.value`: nothing is evaluated.
    const args = [...m[3].matchAll(/'((?:[^'\\]|\\.)*)'|(this\.value)|(-?\d+(?:\.\d+)?)/g)]
      .map(([, text, value, number]) => (value ? el.value : number !== undefined ? Number(number) : text.replace(/\\(.)/g, '$1')));
    window[m[1]][m[2]](...args);
  };
  host.addEventListener('click', call);
  host.addEventListener('change', call);
}

async function start() {
  root = document.createElement('div');
  root.className = 'ds-root';
  const main = document.createElement('div');
  main.id = 'mainContent'; // where the screens' Router renders
  root.append(main);
  for (const host of [root, env.ds.portal]) bindInlineHandlers(host);

  // Same origin, whatever the port: js/apiConfig.js would otherwise guess the standalone backend's.
  window.API_BASE_URL = window.location.origin;
  for (const src of LIBRARIES) await loadScript(src);
  await loadScript(SETTINGS_CONSOLE).catch(() => {});
  const { default: scripts } = await import('../../app/ds/scripts.js');
  for (const src of scripts) await loadScript(`app/ds/${src}`);
  // The step editors and the workflow editor report through the UIService shell's toasts.
  window.ui ??= { showToast: (o) => window.DS.util.toast(o?.message ?? String(o), o?.type) };

  // A screen opened from inside another one (a workflow's editor, "View all runs") moves the address bar and the
  // sidebar with it, so the frame's Back and its highlighted row stay true.
  window.Router.onNavigate = (id) => {
    const row = ROW_OF[id] ?? id;
    if (row === shown || !ctx?.isCurrent()) return;
    arriving = row;
    ctx.navigate(pathOf(row));
  };
}

export async function render(view, { route, ctx: pageCtx }) {
  const screen = route.meta.screen;
  if (!started) started = start();
  try {
    await started;
  } catch (err) {
    started = null; // a script that did not load: the next visit tries again
    throw err;
  }
  if (!pageCtx.isCurrent()) return;
  ctx = pageCtx;
  env.ds.attach(pageCtx);
  view.append(root);
  shown = screen;
  const drawn = arriving === screen;
  arriving = null;
  if (!drawn) window.Router.start(screen);
}

/** Leaving for another page: take the screens' DOM out of the frame, and keep it. */
export function destroy() {
  window.closeModal?.();
  root?.remove();
}
