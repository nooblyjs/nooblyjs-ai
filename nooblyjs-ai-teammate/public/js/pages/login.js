// Sign in (/login). On first run the server prints a setup code in its log; the owner enters it here to choose a password.
import { api, ApiError } from '../api.js';
import { html } from '../html.js';

const MIN_PASSWORD = 10;

export async function render(view, { query, ctx }) {
  const next = query.get('next') ?? '/team';
  const setup = Boolean(ctx.session?.setupRequired);
  const ownerName = ctx.session?.owner?.name;

  view.innerHTML = String(html`
    <div class="auth-wrap">
      <div class="logo auth-logo"><span class="logo-circles" aria-hidden="true"><span class="logo-circle logo-circle-1"></span><span class="logo-circle logo-circle-2"></span></span><span>Teammates</span></div>
      <form class="form-section auth-card" id="auth-form" novalidate>
        <h1>${setup ? 'Set up Teammates' : ownerName ? `Welcome back, ${ownerName}` : 'Sign in'}</h1>
        <p class="header-subtitle">${setup
          ? 'Choose the owner password. The one-time setup code is printed in the terminal where the server is running.'
          : 'Sign in with your username and password.'}</p>
        <div class="form-banner" id="auth-error" role="alert" hidden></div>
        ${setup ? html`
          <div class="form-group">
            <label class="form-label" for="f-code">Setup code</label>
            <input class="form-input" id="f-code" name="code" autocomplete="one-time-code" placeholder="e.g. 5CVQ-JZMR" required aria-describedby="err-code">
            <span class="field-error" id="err-code"></span>
          </div>` : html`
          <div class="form-group">
            <label class="form-label" for="f-username">Username</label>
            <input class="form-input" id="f-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="username-help">
            <span class="help" id="username-help">The owner can leave this empty.</span>
          </div>`}
        <div class="form-group">
          <label class="form-label" for="f-password">${setup ? 'New password' : 'Password'}</label>
          <input class="form-input" id="f-password" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required aria-describedby="err-password${setup ? ' pw-help' : ''}">
          ${setup ? html`<span class="help" id="pw-help">At least ${MIN_PASSWORD} characters.</span>` : ''}
          <span class="field-error" id="err-password"></span>
        </div>
        ${setup ? html`
          <div class="form-group">
            <label class="form-label" for="f-confirm">Confirm password</label>
            <input class="form-input" id="f-confirm" name="confirm" type="password" autocomplete="new-password" required aria-describedby="err-confirm">
            <span class="field-error" id="err-confirm"></span>
          </div>` : ''}
        <button type="submit" class="btn btn-primary auth-submit" id="auth-submit">${setup ? 'Set password and sign in' : 'Sign in'}</button>
      </form>
    </div>`);

  const form = view.querySelector('#auth-form');
  const banner = view.querySelector('#auth-error');
  const submit = view.querySelector('#auth-submit');
  form.elements[setup ? 'code' : 'username'].focus();

  const showErrors = (errors = {}) => {
    for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const [key, message] of Object.entries(errors)) {
      const err = form.querySelector(`#err-${key}`);
      if (err) err.textContent = message;
      form.elements[key]?.setAttribute('aria-invalid', 'true');
    }
    const first = Object.keys(errors).find((k) => form.elements[k]);
    if (first) form.elements[first].focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    banner.hidden = true;
    const f = form.elements;
    const errors = {};
    if (setup && !f.code.value.trim()) errors.code = 'Enter the code from the server log';
    if (!f.password.value) errors.password = 'Enter a password';
    else if (setup && f.password.value.length < MIN_PASSWORD) errors.password = `At least ${MIN_PASSWORD} characters`;
    if (setup && f.confirm.value !== f.password.value) errors.confirm = 'The passwords do not match';
    showErrors(errors);
    if (Object.keys(errors).length) return;

    submit.disabled = true;
    try {
      const { csrf } = setup
        ? await api.post('/api/session/setup', { code: f.code.value.trim(), password: f.password.value })
        : await api.post('/api/session', { username: f.username.value.trim() || undefined, password: f.password.value });
      ctx.signedIn(csrf, next);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_setup_code') showErrors({ code: err.message });
      else if (err instanceof ApiError && err.details?.password) showErrors({ password: err.details.password });
      else {
        banner.textContent = err.message;
        banner.hidden = false;
        if (!setup) {
          f.password.select();
          f.password.focus();
        }
      }
      submit.disabled = false;
    }
  });
}
