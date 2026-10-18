// Phase F26: Campaigns. One change across many repos: done / open / failed per repo.
import { h, page, money, shortId } from '../lib.js';
import { icon, pill, pageHead, tableWrap, codeBlock, newCampaign, CAMPAIGN_CMD } from '../parts.js';

const HOW = [['file', '1 · Write a spec', 'One markdown file that says what to change and how to tell it worked.'], ['book', '2 · Pick repos', 'Each repo gets its own run, so one failure never blocks the rest.'], ['branch', '3 · Review the PRs', 'Track acceptance and merges across the whole campaign.']];
const STATE = { done: ['Done', 'teal'], open: ['Open', 'warn'], failed: ['Failed', 'danger'] };

async function campaignsView(p) {
  await p.system();
  const { campaigns } = await p.get('campaigns');
  const start = () => h('button.primary', { onclick: newCampaign(p) }, icon('plus'), 'Start a campaign');
  const head = pageHead('Campaigns', 'Run one change across many repos and watch every pull request in one place.', campaigns.length > 0 && start());
  if (!campaigns.length) {
    const how = h('div.how', {}, HOW.map(([i, t, text]) => h('div.card', {}, icon(i), h('h3', {}, t), h('p', {}, text))));
    return [
      head,
      h('div.card.hero-empty', {},
        h('div.rings', { 'aria-hidden': 'true' }, h('i'), h('i'), icon('flag')),
        h('h2', {}, 'No campaigns yet'),
        h('p', {}, 'Write the change once as a spec. The factory opens a run for each repo, sends each one down the line and gathers the results here.'),
        h('div.btns', {}, start(), h('button', { onclick: () => how.scrollIntoView({ behavior: 'smooth' }) }, 'How campaigns work')),
        h('div.cli', {}, h('div.label', {}, 'Or from the command line'), codeBlock(CAMPAIGN_CMD))),
      how,
    ];
  }
  return [
    head,
    h('div.stack', {}, campaigns.map((c) => h('section.card.campaign', { 'aria-label': c.name },
      h('div.card-head', {}, h('div', {}, h('h2', {}, c.name), h('p.muted', { style: 'margin-top:4px' }, c.title)), h('div.counts', {}, pill(`${c.done} done`, 'teal'), pill(`${c.open} open`, 'warn'), pill(`${c.failed} failed`, c.failed ? 'danger' : ''), h('span.chip.num', {}, money(c.costUsd)))),
      tableWrap(`Repos in ${c.name}`, { style: 'border-radius:var(--radius-md)' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Repo'), h('th', {}, 'State'), h('th', {}, 'Run'), h('th', {}, 'PR or reason'))),
        h('tbody', {}, c.repos.map((r) => h('tr', {}, h('td.mono', {}, r.repo), h('td', {}, pill(...STATE[r.state])), h('td.id', {}, r.runId ? h('a', { href: p.href(`/runs/${r.runId}`) }, `${shortId(r.runId)} · ${r.status}`) : h('span.muted', {}, r.status)), h('td.muted', {}, r.pr && /^https?:/.test(r.pr) ? h('a', { href: r.pr, target: '_blank', rel: 'noopener' }, r.pr) : r.reason ?? r.pr ?? '')))))))),
    ),
  ];
}

export const render = page(campaignsView);
