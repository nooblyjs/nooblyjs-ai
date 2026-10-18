// Small helpers the Product Factory pages share. Everything that goes into HTML goes through the kit's html``,
// which escapes it.
import { html } from '/ui/js/html.js';
import { statusPill, notice, button } from '/ui/js/components/index.js';

/** A link inside this app: href('/specs/PRD-031') → '/product/specs/PRD-031'. The frame turns it into navigation. */
export const hrefFor = (ctx, rel) => `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}${rel}`;

/** The tone of a spec's status pill. The words always come from the API (statusText); colour is only a second signal. */
export const SPEC_TONE = { 'awaiting-brief': 'warning', drafting: 'info', 'in-review': 'info', 'changes-requested': 'warning', approved: 'success' };
export const specPill = (s) => statusPill({ text: s.statusText, tone: SPEC_TONE[s.status] ?? 'neutral' });

/** The text of an error, said plainly. AbortError (the person left the page) is not an error to show. */
export const isAbort = (err) => err?.name === 'AbortError';

/** A card that says what went wrong, with a Try again button wired by the caller (data-action="reload"). */
export const errorCard = (err, what) => notice({
  title: `Couldn't load ${what}`,
  text: err?.message ?? String(err),
  tone: 'error',
  actions: button({ label: 'Try again', kind: 'secondary', small: true, attrs: { 'data-action': 'reload' } }),
});

/** Renders `view` with `draw()` and re-runs it on data-action="reload" until the page is left. */
export function reloadable(view, ctx, draw) {
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reload"]')) draw();
  }, { signal: ctx.signal });
  return draw();
}

/** A one-line message in an aria-live region, so screen readers hear what an action did. */
export function say(el, text, tone = 'info') {
  if (!el) return;
  el.className = `pf-message pf-message--${tone}`;
  el.textContent = text;
}

/**
 * Follows a drafting job until it is done or failed, calling onProgress(job) on each poll. Stops when the person
 * leaves the page (ctx.signal). Resolves with the last job.
 */
export async function followDraft(ctx, draftId, onProgress, { everyMs = 700 } = {}) {
  for (;;) {
    const job = await ctx.api.get(`drafts/${draftId}`);
    onProgress(job);
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, everyMs);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Left the page', 'AbortError'));
      }, { once: true });
    });
  }
}

/**
 * Who drafts a stage (one stage of GET /drafters): their first name, or null when no teammate can. Then the "Ask …"
 * buttons are left out and the page offers the person a way to do the work themselves.
 */
export const drafterName = (d) => d?.teammate?.name?.split(' ')[0] ?? null;

/**
 * Why no teammate can draft here, then how to do it yourself (`yourself` starts lower case: "write it yourself").
 * With nobody hired, a link to hire one; with several and none chosen, the API's reason says to choose.
 */
export function nobodyDrafts(d, yourself) {
  if (!d) return html`<p class="muted">No agent teammate can draft yet. You can ${yourself}</p>`;
  if (!d.options?.length) return html`<p class="muted">No agent teammate is hired yet. <a href="/teammates/hire">Hire a teammate</a>, or ${yourself}</p>`;
  return html`<p class="muted">${d.reason} Or ${yourself}</p>`;
}

/** "26 min ago", "3 days ago": for "updated …" lines. */
export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export { html };
