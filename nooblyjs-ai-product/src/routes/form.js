// NooblyJS Phase 25a: the feedback form on a link, GET and POST <mountPath>/f/:token. Anyone who has the link can use
// it, signed in or not: it is mounted before the API and the frame, without host.auth. It is one server-rendered page
// with no script (the host's CSP allows inline styles and posting to itself), and it shows nothing of NooblyJS but the
// product's name. The host's CSRF check still applies: its cookie is set on this page's GET, and the form sends it
// back in `_csrf`. There is no limit on submissions (decided 2026-10-22). Every submission is audited by the host (a
// write) and by the feedback service (feedback.form_submitted, from an anonymous sender).
import { FORM_MAX } from '../services/feedback.js';
import { HttpError } from '../util/errors.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ title, body, status = 200 }, res) {
  res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #faf6f1; --card: #fff; --text: #2b2420; --muted: #6b5f57; --line: #e6ddd3; --accent: #b4532a; --error: #a3261b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1d1916; --card: #27221e; --text: #f1e9e1; --muted: #b9aca1; --line: #3d3530; --accent: #e08a5c; --error: #ff8a7a; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 48px 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: var(--muted); }
  label { display: block; font-weight: 600; margin: 16px 0 6px; }
  textarea, input[type=text] { width: 100%; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  textarea { min-height: 160px; resize: vertical; }
  textarea:focus, input:focus, button:focus { outline: 3px solid var(--accent); outline-offset: 2px; }
  .hint { font-size: .875rem; color: var(--muted); margin: 4px 0 0; }
  .error { color: var(--error); font-weight: 600; margin: 0 0 12px; }
  .trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  button { margin-top: 20px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; padding: 10px 20px; cursor: pointer; }
</style></head>
<body><main><div class="card">${body}</div></main></body></html>`);
}

function form(res, { product, csrf, text = '', name = '', error = null, status = 200 }) {
  page({
    title: `Feedback on ${product}`,
    status,
    body: `<h1>Feedback on ${esc(product)}</h1>
<p>Tell us what's working and what isn't. You don't need to sign in, and we won't contact you about it.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form method="post">
  <input type="hidden" name="_csrf" value="${esc(csrf ?? '')}">
  <label for="text">Your feedback</label>
  <textarea id="text" name="text" maxlength="${FORM_MAX}" required aria-describedby="text-hint">${esc(text)}</textarea>
  <p class="hint" id="text-hint">Up to ${FORM_MAX.toLocaleString('en-ZA')} characters. Please leave out phone numbers and other personal details.</p>
  <label for="name">Your name (optional)</label>
  <input type="text" id="name" name="name" maxlength="80" autocomplete="name" value="${esc(name)}">
  <div class="trap" aria-hidden="true"><label for="website">Leave this empty</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off"></div>
  <button type="submit">Send feedback</button>
</form>`,
  }, res);
}

const closed = (res) => page({ title: 'Feedback form closed', status: 404, body: '<h1>This feedback form is closed</h1><p>The link you followed has been switched off or replaced. Ask whoever sent it to you for the new one.</p>' }, res);

export function formRoutes({ host, feedback }) {
  const router = host.express.Router();
  // The host parses form bodies already; the stand-in host and a host that doesn't are covered here.
  const body = host.express.urlencoded({ extended: false, limit: '16kb' });

  router.get('/f/:token', async (req, res) => {
    const link = await feedback.openLink(req.params.token);
    if (!link) return closed(res);
    form(res, { product: link.product, csrf: req.csrfToken });
  });

  router.post('/f/:token', body, async (req, res) => {
    const link = await feedback.openLink(req.params.token);
    if (!link) return closed(res);
    try {
      await feedback.submitForm(req.params.token, req.body ?? {});
    } catch (err) {
      if (err instanceof HttpError && err.status === 422) return form(res, { product: link.product, csrf: req.csrfToken, text: req.body?.text, name: req.body?.name, error: err.message, status: 422 });
      if (err instanceof HttpError && err.status === 404) return closed(res);
      throw err;
    }
    page({ title: 'Thanks', body: `<h1>Thanks, we've got it</h1><p>Your feedback on ${esc(link.product)} goes to the team who look after it.</p><p><a href="">Send more feedback</a></p>` }, res);
  });

  return router;
}
