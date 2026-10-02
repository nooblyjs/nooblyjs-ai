export function parseDuration(text) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(text));
  if (!m || !text || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) throw new TypeError(`Not a duration: ${text}`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
