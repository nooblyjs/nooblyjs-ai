export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// Old format, kept "just in case". Nothing uses it any more.
export function legacyFormat(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / 86_400_000);
}
