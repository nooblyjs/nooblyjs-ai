'use strict';

// Serialises writes per absolute path so concurrent saves to one file cannot
// interleave, while writes to distinct files still run in parallel.

const chains = new Map();

function enqueue(key, task) {
  const previous = chains.get(key) || Promise.resolve();
  const run = previous.then(task, task);
  const tracked = run.catch(() => {});
  chains.set(key, tracked);
  tracked.then(() => {
    if (chains.get(key) === tracked) chains.delete(key);
  });
  return run;
}

module.exports = { enqueue, pendingCount: () => chains.size };
