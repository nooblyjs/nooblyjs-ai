// @ts-check
// Phase F05: SIDE EFFECTS that are safe to retry.
//
// Appending events is atomic. The outside world is not: pushing a branch or
// writing a PR happens OUTSIDE the database. A crash can land between "did it"
// and "wrote down that I did it". Then a retry would do it twice: two PRs, two
// comments, two emails.
//
// The pattern: write down the INTENTION first, then act, then write down the RESULT.
//
//   effect.intended {key}  ──►  perform()  ──►  effect.done {key, result}
//
// On a retry, look up the key:
//
//   done        → skip it; return the saved result
//   intended    → we crashed in between: we DON'T KNOW if it happened.
//                 check() asks the outside world ("does the PR exist?"):
//                   yes → record done (reconciled) without doing it again
//                   no  → do it now
//   never seen  → do it
//
// The key names the effect AND its input (e.g. "pr:<run>:<sha>"): the same
// push of the same commit is one effect; a push of a NEW commit is a new one.

/**
 * @template T
 * @param {import('./events.js').Store} store
 * @param {{ key: string, kind: string, runId: string, data?: object,
 *           perform: () => Promise<T>, check: () => Promise<T | null> }} effect
 * @returns {Promise<{ result: T, how: 'performed' | 'skipped' | 'reconciled' }>}
 */
export async function performEffect(store, { key, kind, runId, data = {}, perform, check }) {
  const stream = `run:${runId}`;
  const row = store.get('effects', key);
  if (row?.status === 'done') return { result: row.result, how: 'skipped' };

  if (row?.status === 'intended') {
    const found = await check();
    if (found !== null && found !== undefined) {
      store.append(stream, 'effect.done', { key, runId, result: found, reconciled: true }, { key: `${key}:done` });
      return { result: found, how: 'reconciled' };
    }
  } else {
    store.append(stream, 'effect.intended', { key, kind, runId, ...data }, { key: `${key}:intended` });
  }

  const result = await perform();
  store.append(stream, 'effect.done', { key, runId, result }, { key: `${key}:done` });
  return { result, how: 'performed' };
}
