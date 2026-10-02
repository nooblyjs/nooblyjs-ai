const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError(`Out of range: ${n}`);
  let out = '';
  for (const [v, r] of TABLE) while (n >= v) (out += r), (n -= v);
  return out;
}
