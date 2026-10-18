// Small helpers the Infrastructure pages share. Everything that goes into HTML goes through the kit's html``,
// which escapes it.
import { html } from '/ui/js/html.js';
import { statusPill, notice, button } from '/ui/js/components/index.js';

/** A link inside this app: hrefFor(ctx, '/designs/INF-031') → '/infrastructure/designs/INF-031'. */
export const hrefFor = (ctx, rel) => `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}${rel}`;

/** AbortError (the person left the page) is not an error to show. */
export const isAbort = (err) => err?.name === 'AbortError';

/** A card that says what went wrong, with a Try again button (data-action="reload"). */
export const errorCard = (err, what) => notice({
  title: `Couldn't load ${what}`,
  text: err?.message ?? String(err),
  tone: 'error',
  actions: button({ label: 'Try again', kind: 'secondary', small: true, attrs: { 'data-action': 'reload' } }),
});

export { reloadable } from './live.js';

/** A one-line message in the page's aria-live region, so screen readers hear what an action did. */
export function say(view, text, tone = 'info') {
  const el = view.querySelector('[data-message]');
  if (!el) return;
  el.className = `inf-message inf-message--${tone}`;
  el.textContent = text;
}
export const messageRegion = () => html`<p class="inf-message" data-message role="status" aria-live="polite"></p>`;

/** The pill of an environment's kind. The word is the signal; the colour repeats it. */
const KIND_TONE = { test: 'info', staging: 'info', production: 'navy' };
export const kindPill = (env) => statusPill({ text: env.kindLabel, tone: KIND_TONE[env.kind] ?? 'neutral', dot: false });

/** Text with a tone: a class for the colour, never the only signal. */
export const toned = (text, tone) => html`<span class="inf-tone inf-tone--${tone ?? 'neutral'}">${text}</span>`;

/** A labelled native progress bar (no inline styles): "Provisioning · 70%". */
export const progressBar = (label, percent) => html`<span class="inf-progress"><span class="inf-tone inf-tone--info">${label}</span><progress max="100" value="${percent}" aria-label="${label}"></progress></span>`;

/** Standalone only (no event stream): how often a page with a run in progress looks again. */
export const REFRESH_MS = 2000;

export { html };
