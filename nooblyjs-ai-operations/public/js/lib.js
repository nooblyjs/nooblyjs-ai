// Small helpers the Operations pages share. Everything that goes into HTML goes through the kit's html``, which escapes it.
import { html } from '/ui/js/html.js';
import { statusPill, notice, button } from '/ui/js/components/index.js';

/** A link inside this app: hrefFor(ctx, '/releases/REL-001') → '/operations/releases/REL-001'. */
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
  el.className = `ops-message ops-message--${tone}`;
  el.textContent = text;
}
export const messageRegion = () => html`<p class="ops-message" data-message role="status" aria-live="polite"></p>`;

/** A release's state: the word is the signal; the colour repeats it. */
const STATUS_TONE = { draft: 'neutral', 'waiting-approval': 'warning', 'changes-requested': 'danger', approved: 'info', piloting: 'info', complete: 'success', 'rolled-back': 'danger' };
export const statusOf = (r) => statusPill({ text: r.statusText, tone: STATUS_TONE[r.status] ?? 'neutral' });

/** The line every page shows while the deployer is the mock: nothing pretends to be a real deployment. */
export const mockNote = () => html`<p class="ops-mock">Deployments go through the mock deployer: Infrastructure's records change, nothing real is deployed.</p>`;

/** Versions in words: "api 0.9.4 · web 4.12.0". */
export const versions = (list) => (list ?? []).map((d) => `${d.service} ${d.version}`).join(' · ') || 'nothing';

export { html };
