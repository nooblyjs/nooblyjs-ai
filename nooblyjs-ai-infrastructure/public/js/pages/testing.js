// Testing in environments: what ran where, and what is failing. No mockup yet. Data: GET /environments.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, kindPill, toned } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let environments;
    try {
      ({ environments } = await ctx.api.get('environments'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the test results'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const failing = environments.flatMap((e) => e.tests.suites.filter((s) => !s.ok).map((s) => ({ env: e, suite: s })));
    view.innerHTML = String(html`${pageHead({ eyebrow: 'NooblyJS · Infrastructure', title: 'Testing in environments', lead: "The tests that ran against real infrastructure. A build moves right only when that environment's tests pass." })}
      <section class="card" aria-label="Failing tests">
        <div class="card__head"><h2 class="card__title">Failing now</h2><span class="card__meta">${failing.length ? `${failing.length} suite${failing.length === 1 ? '' : 's'}` : 'Nothing is failing'}</span></div>
        ${failing.length
          ? html`<ul class="inf-suites">${failing.map(({ env, suite }) => html`<li><a class="inf-mono" href="${env.href}">${env.name}</a> ${toned(`${suite.suite}: ${suite.total - suite.passed} of ${suite.total} failing`, 'warning')}
            ${suite.failing.length ? html`<ul class="inf-suite__failing">${suite.failing.map((name) => html`<li>Failing: ${name}</li>`)}</ul>` : ''}</li>`)}</ul>`
          : html`<p class="inf-muted">Every suite that has run is passing.</p>`}
      </section>
      <section class="card" aria-label="Tests by environment">
        <div class="card__head"><h2 class="card__title">By environment</h2></div>
        ${dataTable({
          caption: 'Tests by environment',
          empty: 'No environments yet.',
          rows: environments,
          columns: [
            { key: 'name', label: 'Environment', render: (e) => html`<a class="inf-mono inf-env" href="${e.href}">${e.name}</a>` },
            { key: 'kind', label: 'Kind', render: (e) => kindPill(e) },
            { key: 'deployed', label: 'Deployed', render: (e) => e.deployed },
            { key: 'tests', label: 'Tests here', render: (e) => toned(e.tests.text, e.tests.tone) },
          ],
        })}
      </section>`);
    return 0;
  });
}
