const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function mergeDeep(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) out[k] = isPlain(v) && isPlain(target[k]) ? mergeDeep(target[k], v) : isPlain(v) ? mergeDeep({}, v) : v;
  return out;
}
