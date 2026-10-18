// The stub app's one page, rendered by the NooblyJS frame (roadmap Phase 1, step 5).
import { html } from '/ui/js/html.js';
import { pageHead, card } from '/ui/js/components/index.js';

export async function render(view, { ctx }) {
  view.innerHTML = String(html`${pageHead({ eyebrow: 'Stub hosted app', title: `Hello, ${ctx.person?.name ?? 'stranger'}`, lead: 'This page comes from test/fixtures/hello-app, loaded into the NooblyJS frame.' })}${card({ title: 'Mounted at /hello', body: html`<p class="hello-note">The rail and sidebar around this page are drawn by NooblyJS.</p>` })}`);
}
