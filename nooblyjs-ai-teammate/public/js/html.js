// Tagged template that HTML-escapes every interpolated value unless it is already safe markup.
class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escape(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(escape).join('');
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export const raw = (markup) => new SafeHtml(String(markup));

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += escape(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Render markup into a fresh element and return it. */
export function fragment(markup, tag = 'div', className = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.innerHTML = String(markup);
  return el;
}
