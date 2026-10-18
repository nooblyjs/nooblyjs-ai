// The wiki, in the NooblyJS frame (noobly docs/hosted-apps/porting-an-app.md §2, "the bridge").
//
// The wiki's UI was one page: a single block of markup whose views it shows and hides itself, driven by ~60
// modules that hold their state for the life of the tab. It moves in whole. This page puts that markup into the
// frame's view and starts the app ONCE per tab; when the person goes to another NooblyJS app and comes back, the same
// DOM is put back, so their place, open document and unsaved text are still there (and nothing is bound twice).
//
// The app's files in ../../app are generated from the standalone UI by scripts/port-wiki-ui.mjs.
import { env, MOUNT, loadScript } from '../hosted/env.js';

// Classic scripts, in the order the standalone page loaded them: each defines a global the next ones use.
const SCRIPTS = [
  'vendor/bootstrap/bootstrap.bundle.min.js',
  'vendor/marked/marked.min.js',
  'app/shared/markdown-editor.js',
  'app/shared/markdown-editor-blocks.js',
  'vendor/prism/components/prism-core.min.js',
  'vendor/prism/plugins/autoloader/prism-autoloader.min.js',
  'app/shared/markdown-parser.js',
];

let root = null; // the wiki's DOM, kept between visits
let started = null; // the one start-up, as a promise

/**
 * The way to the datasources screens (workflows, repositories, spaces, agents, prompts, users, settings). The wiki
 * takes the whole area beside the rail (layout: 'full'), so the frame's sidebar, where those screens are listed,
 * is not on screen here: this link in the wiki's own top bar is how a person gets to them. A plain link: the
 * frame routes it without reloading the page.
 */
function adminLink() {
  const link = document.createElement('a');
  link.className = 'wk-admin-link';
  link.href = `${MOUNT}/datasources`;
  link.title = 'Workflows, repositories, spaces, agents, prompts, users and settings';
  const icon = document.createElement('i');
  icon.className = 'bi bi-gear-wide-connected';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = 'Administration';
  link.append(icon, label);
  return link;
}

async function start() {
  const { default: markup } = await import('../../app/markup.js');
  root = document.createElement('div');
  root.className = 'wk-root';
  root.innerHTML = markup;
  root.querySelector('.kr-topbar-actions')?.prepend(adminLink());
  // The page's one inline handler (the "page not found" view's Home button).
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-wk-action="home"]')) window.wikiApp?.showHome();
  });
  for (const host of [root, env.portal]) bindInlineHandlers(host);
  return root;
}

/**
 * The frame's policy runs no inline script, so the on…="" attributes the wiki's modules write into their HTML are
 * dead. There are eight, of three kinds, and each is done here from what the attribute says. A new kind would do
 * nothing: write new handlers with addEventListener.
 */
function bindInlineHandlers(host) {
  // <img onerror>: a picture that did not load (no avatar, no preview) steps aside for what sits behind it.
  host.addEventListener('error', (event) => {
    const img = event.target;
    const code = img instanceof HTMLImageElement ? img.getAttribute('onerror') : null;
    if (!code) return;
    if (code.includes('this.remove()')) return img.remove();
    img.style.display = 'none';
    if (code.includes('nextElementSibling') && img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
    return undefined;
  }, true);
  host.addEventListener('click', (event) => {
    const el = event.target.closest('[onclick]');
    const code = el?.getAttribute('onclick') ?? '';
    const open = /^window\.open\('([^']+)',\s*'_blank'\)$/.exec(code);
    if (open) return void window.open(open[1], '_blank', 'noopener');
    // A wiki-link card: loadWikiLinkDocument('<encoded path>', '<title>').
    const link = /^loadWikiLinkDocument\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/.exec(code);
    if (link && typeof window.loadWikiLinkDocument === 'function') window.loadWikiLinkDocument(...link.slice(1, 3).map((arg) => arg.replace(/\\(.)/g, '$1')));
    return undefined;
  });
}

async function boot() {
  // The app awaits this at module scope before it reads a cached tree (feature flags and the client cache epoch).
  window.__wikiConfigPromise = env.fetch(`${MOUNT}/api/v1/config`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  for (const src of SCRIPTS) await loadScript(src);
  // Prism loads a language the first time a code block needs it: from this app's copy, not a CDN.
  if (window.Prism?.plugins?.autoloader) window.Prism.plugins.autoloader.languages_path = `${MOUNT}/vendor/prism/components/`;
  env.ready();
  await import('../../app/inline.js');
  await import('../../app/js/app.js');
}

export async function render(view, { params, ctx }) {
  // A path under the mount (a shared link, a link in a document) is the wiki's own location: move it into the
  // hash, where the wiki navigates without the frame redrawing the page.
  const segments = Object.values(params ?? {});
  if (segments.length) {
    ctx.navigate(`/#/${segments.map(encodeURIComponent).join('/')}${window.location.search}`, { replace: true });
    return;
  }
  env.attach(ctx);
  env.portal.hidden = false;
  const first = !started;
  if (first) started = start();
  view.append(await started);
  if (first) await boot();
}

/**
 * Leaving for another page (another app, or this app's datasources screens): take the wiki's DOM out of the frame,
 * and keep it. Its dialogs live outside the frame's view (the portal), so they are put away with it: an open one
 * would otherwise lie over the page the person went to.
 */
export function destroy() {
  root?.remove();
  env.portal.hidden = true;
}
