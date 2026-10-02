export function isPalindrome(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const letters = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return letters === [...letters].reverse().join('');
}
