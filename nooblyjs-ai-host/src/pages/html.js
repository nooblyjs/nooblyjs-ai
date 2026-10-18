// A tagged template that escapes every interpolated value unless it is already SafeHtml (tech.md §5:
// never put untrusted text into HTML unescaped). Arrays are joined; null and undefined render as nothing.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class SafeHtml {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }
}

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const render = (value) => {
  if (value instanceof SafeHtml) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
};

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/** A whole page outside the frame (sign-in): the UI kit's styles plus login.css, and no scripts. */
export const page = ({ title, body }) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · NooblyJS</title>
<link rel="icon" href="/ui/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/ui/css/tokens.css">
<link rel="stylesheet" href="/ui/css/base.css">
<link rel="stylesheet" href="/ui/css/components.css">
<link rel="stylesheet" href="/css/login.css">
</head>
<body>
<main class="login" id="main">
${body}
</main>
</body>
</html>`;

/** Work role ids as people read them. */
export const WORK_ROLES = {
  'product-manager': 'Product manager',
  architect: 'Architect',
  developer: 'Developer',
  designer: 'Designer',
  'engineering-lead': 'Engineering lead',
  'platform-engineer': 'Platform engineer',
};
