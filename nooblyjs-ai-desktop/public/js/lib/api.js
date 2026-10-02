export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error?.message || `Request failed (${res.status})`;
    const err = new Error(message);
    err.code = payload?.error?.code;
    err.details = payload?.error?.details;
    throw err;
  }
  return payload;
}

export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.querySelector('[data-toast-body]').textContent = message;
  window.bootstrap.Toast.getOrCreateInstance(el, { delay: 3200 }).show();
}

export function showFormError(form, message) {
  const el = form.querySelector('[data-form-error]');
  if (!el) return toast(message);
  el.textContent = message;
  el.hidden = !message;
}

const RELATIVE = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [604800, 'day', 86400],
  [2629800, 'week', 604800],
  [31557600, 'month', 2629800]
];

export function renderRelativeTimes(root = document) {
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const el of root.querySelectorAll('[data-relative-time]')) {
    const then = new Date(el.dataset.relativeTime);
    if (Number.isNaN(then.getTime())) continue;
    const seconds = (then.getTime() - Date.now()) / 1000;
    const abs = Math.abs(seconds);
    const [, unit, divisor] = RELATIVE.find(([limit]) => abs < limit) || [null, 'year', 31557600];
    el.textContent = fmt.format(Math.round(seconds / divisor), unit);
    el.title = then.toLocaleString();
  }
}
