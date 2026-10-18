// Shared by the Home pages: the lifecycle engine API client, live refresh from the event stream, and how times,
// money and activity rows are written.
import { html } from '/ui/js/html.js';
import { createApi } from '/ui/js/api.js';
import { ago, money } from '/ui/js/format.js';
import { notice, pageHead, timelineRow } from '/ui/js/components/index.js';

/** the lifecycle engine API (items, approvals, rules). Requests are aborted when the person leaves the page. */
export const workflowsApi = (ctx) => createApi('/workflows/api/v1', { signal: ctx.signal });

/**
 * Calls `fn` whenever something happens in NooblyJS, so a page shows other people's changes without a refresh. Events
 * are gathered for `wait` ms, and `fn` runs at most once every `every` ms however busy NooblyJS is (each run refetches,
 * and the API is rate limited). `types` narrows it to event types starting with one of the prefixes.
 */
export function onChange(ctx, fn, { types = null, wait = 300, every = 2000 } = {}) {
  let timer = null;
  let last = 0;
  ctx.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  ctx.sse.on('*', (event) => {
    if (types && !types.some((t) => String(event.type ?? '').startsWith(t))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      last = Date.now();
      if (ctx.isCurrent()) Promise.resolve(fn(event)).catch((err) => err?.name !== 'AbortError' && console.error(err));
    }, Math.max(wait, last + every - Date.now()));
  });
}

/** The page shown when the lifecycle engine isn't running here (not listed, or it failed to start). */
export function engineMissing(view, head) {
  view.innerHTML = String(html`${pageHead(head)}${notice({
    title: 'The lifecycle engine is not running',
    text: 'Items, stages and approvals come from the lifecycle engine, which is part of NooblyJS. It did not start: check the NooblyJS log. The rest of NooblyJS works.',
    tone: 'error',
  })}`);
}

/** True for the API error a missing engine gives (its routes don't exist). */
export const isMissing = (err) => err?.status === 404 && err?.code === 'not_found' && /No such API route/.test(err.message);

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today", "Yesterday" or "8 Oct", against the server's now. */
export function dayLabel(iso, now) {
  const d = new Date(iso);
  const n = new Date(now);
  if (sameDay(d, n)) return 'Today';
  if (sameDay(d, new Date(n.getTime() - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "12 min ago" today, the time of day on earlier days. */
export function timeText(iso, now) {
  const d = new Date(iso);
  if (sameDay(d, new Date(now))) return ago(iso, new Date(now).getTime());
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** One Activity row from the API as a kit timeline row. "You" for the signed-in person. */
export function activityRow(row, { now, person }) {
  const name = row.actor.kind === 'person' && row.actor.id === person?.id ? 'You' : row.actor.name;
  const cost = row.costUsd === null ? null : `${money(row.costUsd)}${row.costNote ? ` ${row.costNote}` : ''}`;
  return timelineRow({
    actor: row.actor.name,
    kind: row.actor.kind,
    action: html`<strong>${name}</strong> ${row.action}`,
    detail: row.detail,
    system: row.systemLabel,
    time: timeText(row.at, now),
    cost,
    outcome: row.outcome,
  });
}

export { money, ago };
