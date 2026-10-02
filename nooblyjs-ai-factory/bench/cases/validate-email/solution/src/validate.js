export const isNonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

export function isEmail(text) {
  if (typeof text !== 'string') return false;
  const parts = text.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || /\s/.test(local) || /\s/.test(domain)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((l) => l.length > 0);
}
