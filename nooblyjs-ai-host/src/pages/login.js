// /login. With NOOBLY_DEV_LOGIN=true it is a person picker over the seeded people (no password). Without it,
// Microsoft Entra ID sign-in arrives in Phase 12; until then core's own sign-in page is the way in.
import { html, page, WORK_ROLES } from './html.js';

const initials = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export function loginPage({ people, csrfToken, next = '/', devLogin }) {
  if (!devLogin) {
    return page({
      title: 'Sign in',
      body: html`
<div class="login__brand" aria-hidden="true"><span></span><span></span></div>
<p class="eyebrow">NooblyJS</p>
<h1 class="page-title">Sign in</h1>
<p class="lead">Sign in with your Microsoft account is turned on with <code>AUTH_METHOD=azure</code>.</p>
<section class="card">
  <p>For local development, start NooblyJS with <code>NOOBLY_DEV_LOGIN=true</code> to pick a seeded person.</p>
  <p class="card__meta">Administrators can use <a href="/services/authservice/views/login.html">the nooblyjs-core sign-in page</a>.</p>
</section>`,
    });
  }
  const rows = people.map((p) => {
    const role = p.workRole ? WORK_ROLES[p.workRole] ?? p.workRole : 'New joiner · no profile yet';
    return html`
  <button class="login__person" type="submit" name="personId" value="${p.id}">
    <span class="avatar" aria-hidden="true">${initials(p.name)}</span>
    <span class="login__who"><strong>${p.name}</strong><span>${role} · ${p.jobTitle ?? ''}</span></span>
    <span class="pill pill--info">${p.accessRole}</span>
  </button>`;
  });
  return page({
    title: 'Sign in',
    body: html`
<div class="login__brand" aria-hidden="true"><span></span><span></span></div>
<p class="eyebrow">NooblyJS · Development sign-in</p>
<h1 class="page-title">Who are you today?</h1>
<p class="lead">Pick a seeded person to sign in as them. This page only exists when <code>NOOBLY_DEV_LOGIN=true</code>.</p>
<form method="post" action="/login" class="login__people">
  <input type="hidden" name="_csrf" value="${csrfToken}">
  <input type="hidden" name="next" value="${next}">
  ${rows}
</form>`,
  });
}
