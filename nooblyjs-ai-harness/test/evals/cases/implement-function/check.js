import { importFresh } from '../../checks.js';

const CASES = [['racecar', true], ['A man, a plan, a canal: Panama!', true], ['hello', false], ['', true], ['!!', true], ['No lemon, no melon', true], ['12321', true], ['123', false]];

export default async function check({ dir }) {
  let isPalindrome;
  try {
    ({ isPalindrome } = await importFresh(dir, 'strings.js'));
  } catch (error) {
    return { pass: false, message: `strings.js does not load: ${error.message}` };
  }
  for (const [input, expected] of CASES) {
    let actual;
    try {
      actual = isPalindrome(input);
    } catch (error) {
      return { pass: false, message: `isPalindrome(${JSON.stringify(input)}) threw ${error.message}` };
    }
    if (actual !== expected) return { pass: false, message: `isPalindrome(${JSON.stringify(input)}) returned ${actual}` };
  }
  try {
    isPalindrome(42);
    return { pass: false, message: 'isPalindrome(42) did not throw' };
  } catch (error) {
    return error instanceof TypeError ? { pass: true } : { pass: false, message: `isPalindrome(42) threw ${error.name}, not TypeError` };
  }
}
