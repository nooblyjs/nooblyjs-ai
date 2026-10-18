// Platform · Secrets: the secrets mapped to each repository, as references only (vault:staging/REDIS_URL), never
// values (tech.md §3.4). Agents and previews get staging values only: a production reference is refused by the
// server. Adding or removing one needs change-repo-access (Owner).
import { html } from '/ui/js/html.js';
import { button, dataTable } from '/ui/js/components/index.js';
import { head, flash, errorText, onChange } from './lib.js';

export async function render(view, { ctx }) {
  const api = ctx.hostApi;
  let message = null;

  async function draw() {
    const [{ secrets }, { repositories }] = await Promise.all([api.get('platform/secrets'), api.get('platform/repositories')]);
    if (!ctx.isCurrent()) return;
    const canChange = ctx.can('change-repo-access');
    view.innerHTML = String(html`${head('Secrets', 'References to the vault, mapped to repositories. NooblyJS never stores a secret\'s value.')}
    <p class="note">Agents never see production secrets. Preview environments get staging values only.</p>
    ${flash(message)}
    ${canChange ? html`<section class="card" aria-label="Map a secret">
      <div class="card__head"><h2 class="card__title">Map a secret</h2></div>
      <form class="form form--inline" data-form="add">
        <label class="field">Repository<select name="repo" required>${repositories.map((r) => html`<option value="${r.name}">${r.name}</option>`)}</select></label>
        <label class="field">Name<input name="name" required maxlength="64" pattern="[A-Z][A-Z0-9_]*" placeholder="REDIS_URL" autocomplete="off"></label>
        <label class="field">Reference<input name="ref" required maxlength="120" placeholder="vault:staging/REDIS_URL" autocomplete="off"></label>
        <div class="actions">${button({ label: 'Map secret', type: 'submit' })}</div>
      </form>
    </section>` : ''}
    <section class="card card--flush" aria-label="Mapped secrets">${dataTable({
      caption: 'Mapped secrets',
      empty: 'No secrets are mapped.',
      rows: secrets,
      columns: [
        { key: 'repo', label: 'Repository', render: (s) => html`<a class="repo-link" href="/platform/repositories/${s.repo.replace('/', '__')}">${s.repo}</a>` },
        { key: 'name', label: 'Name', render: (s) => html`<span class="mono">${s.name}</span>` },
        { key: 'ref', label: 'Reference', render: (s) => html`<span class="mono">${s.ref}</span>` },
        { key: 'scope', label: 'Values' },
        ...(canChange ? [{ key: 'remove', label: 'Actions', render: (s) => html`<button class="link-button" type="button" data-remove="${s.repo}|${s.name}">Remove<span class="visually-hidden"> ${s.name} from ${s.repo}</span></button>` }] : []),
      ],
    })}</section>`);
  }

  view.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    const [repo, name] = remove.dataset.remove.split('|');
    try {
      await api.del('platform/secrets', { query: { repo, name } });
      message = { tone: 'ok', text: `${name} is no longer mapped to ${repo}.` };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="add"]');
    if (!form) return;
    event.preventDefault();
    try {
      const { secret } = await api.post('platform/secrets', Object.fromEntries(new FormData(form)));
      message = { tone: 'ok', text: `${secret.name} on ${secret.repo} now reads ${secret.ref}.` };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }, { signal: ctx.signal });

  onChange(ctx, draw, { types: ['secret.'] });
  await draw();
}
