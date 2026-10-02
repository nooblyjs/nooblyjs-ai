// @ts-check
// Phase F04: the useful part of a long failure.
//
// A failing `npm test` can print thousands of lines. The model (in the Stop
// hook) and the reviewer (in the PR) need the part that says WHAT failed.
// That's almost always near the END (the summary, the last stack trace), with
// a little of the START for context (which command, which runner). So: the
// head, a marker saying how much was cut, and the tail. The same shape as the
// harness's Phase 26 previews.

/**
 * @param {string} output
 * @param {{ head?: number, tail?: number, maxChars?: number }} [options]
 */
export function excerpt(output, { head = 10, tail = 40, maxChars = 4000 } = {}) {
  // eslint-disable-next-line no-control-regex
  const clean = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n').trimEnd(); // no colour codes
  const lines = clean.split('\n');
  let text = lines.length <= head + tail ? clean : [...lines.slice(0, head), `… (${lines.length - head - tail} lines cut) …`, ...lines.slice(-tail)].join('\n');
  if (text.length > maxChars) text = `… (cut) …\n${text.slice(-maxChars)}`;
  return text;
}
