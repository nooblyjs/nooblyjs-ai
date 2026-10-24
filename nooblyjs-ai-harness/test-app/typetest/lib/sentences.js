// The sentences players type. Each uses a mix of letters, capitals and punctuation,
// so every finger gets some practice.

export const SENTENCES = Object.freeze([
  'The quick brown fox jumps over the lazy dog.',
  'Practice makes steady progress, not perfect speed.',
  'Keep your wrists relaxed and your eyes on the screen.',
  'Every finger has a home, and every key has a finger.',
  'Sam packed six jars of jam, pickles and bread.',
  'Can you type this sentence without looking down?',
  'Small steps every day add up to big gains.',
  'Her brother quickly wrote a long letter to Maya.',
  'Check the spelling, then press enter when you are done!',
  'Rain fell softly on the quiet village roofs.',
  'Good typists look ahead to the next word, not the key.',
  'Mix capitals, numbers 42 and punctuation; it is fun.',
  'Zebras and quails wandered across the dusty plain.',
  'Use the left hand for a, s, d, f and the right for j, k, l.',
  'The cat sat on the mat and watched the birds outside.',
  'Learning to type well is a skill that lasts a lifetime.',
  'Read slowly at first, then let your speed build naturally.',
  'Jack quickly moved the box of vivid yellow flowers.',
  'Is it better to be fast or to be accurate? Both, over time.',
  'Bright lights flicker over the harbour at midnight.',
]);

/**
 * Pick a random sentence, avoiding the one just shown so you don't get it twice in a row.
 * `random` can be replaced in tests to make the choice predictable.
 */
export function pickSentence(list = SENTENCES, random = Math.random, avoid = '') {
  const choices = list.filter((text) => text !== avoid);
  const pool = choices.length > 0 ? choices : list;
  return pool[Math.floor(random() * pool.length)];
}
