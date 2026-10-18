// Phase F26: the Inbox. What's waiting for a person: approvals, questions, and runs that
// stopped in the last day that nobody has looked at yet.
import { h, page, cap, plural, since, shortId, dismiss, stoppedToReview } from '../lib.js';
import { icon, pill, pageHead, whyStopped, entryCard } from '../parts.js';

async function inboxView(p) {
  const { runs } = await p.system();
  const { entries } = await p.get('inbox');
  const byId = new Map(runs.map((r) => [r.id, r]));
  const stopped = stoppedToReview(runs);
  const details = await Promise.all(stopped.slice(0, 6).map((r) => p.get(`runs/${encodeURIComponent(r.id)}`).catch(() => null)));
  const n = entries.length + stopped.length;

  const stoppedCard = (r, d) => {
    const step = d?.steps.find((st) => st.status === 'failed' || st.status === 'running') ?? d?.steps.find((st) => st.id === r.station);
    const at = step?.id ?? r.station;
    return h('article.card.entry', { 'aria-label': r.title },
      h('div.top', {}, pill('Run stopped', 'danger'), h('a.mono', { href: p.href(`/runs/${r.id}`), style: 'color:var(--muted)' }, shortId(r.id)), h('span.waiting', {}, `waiting ${since(r.endedAt)}`)),
      h('h2', {}, r.title),
      h('p.fx-lead', {}, whyStopped(r, step, d?.agent ?? [])),
      h('div.btns', {},
        p.can('draft') && h('button.primary', { onclick: p.act(async () => (await p.post(`runs/${r.id}/retry`, { from: at ?? undefined }), dismiss(r))) }, icon('retry'), at ? `Retry from ${at}` : 'Retry'),
        h('a.btn', { href: p.href(`/runs/${r.id}`) }, 'Open run'),
        h('button.ghost', { onclick: () => (dismiss(r), p.redraw({ force: true })) }, 'Dismiss')));
  };

  const sub = n ? `${cap(plural(n, 'run'))} ${n === 1 ? 'is' : 'are'} waiting for a person. Everything else is moving on its own.` : 'Nothing is waiting for a person. Everything is moving on its own.';
  return [
    pageHead('Inbox', sub),
    h('div.entries', {}, entries.map((e) => entryCard(p, e, byId.get(e.runId))), stopped.map((r, i) => stoppedCard(r, details[i]))),
    h('p.all-clear', {}, icon('check'), n ? 'When this list is empty, nothing on the line is waiting for a person.' : 'All clear.'),
  ];
}

export const render = page(inboxView);
