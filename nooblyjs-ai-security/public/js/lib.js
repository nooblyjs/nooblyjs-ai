// Small helpers the Security pages share. Everything that goes into HTML goes through the kit's html``, which escapes it.
import { html } from '/ui/js/html.js';
import { statusPill, notice, button } from '/ui/js/components/index.js';

/** A link inside this app: hrefFor(ctx, '/findings/FND-001') → '/security/findings/FND-001'. */
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
  el.className = `sec-message sec-message--${tone}`;
  el.textContent = text;
}
export const messageRegion = () => html`<p class="sec-message" data-message role="status" aria-live="polite"></p>`;

/** A severity's pill: the word is the signal; the colour repeats it. */
const SEVERITY_TONE = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' };
export const severityPill = (f) => statusPill({ text: f.severityLabel, tone: SEVERITY_TONE[f.severity] ?? 'neutral', dot: false });
const STATE_TONE = { open: 'warning', fixing: 'info', closed: 'success', accepted: 'neutral' };
export const statePill = (f) => statusPill({ text: f.stateText, tone: STATE_TONE[f.state] ?? 'neutral' });
const TM_TONE = { waiting: 'warning', accepted: 'success', 'changes-requested': 'danger' };
export const threatModelPill = (tm) => statusPill({ text: tm.statusText, tone: TM_TONE[tm.status] ?? 'neutral' });

/** The line every page shows while the scanner is the mock: nothing pretends to be a real scan. */
export const mockNote = () => html`<p class="sec-mock">Findings come from the mock scanner: sample rules, not a real scan.</p>`;

export { html };
