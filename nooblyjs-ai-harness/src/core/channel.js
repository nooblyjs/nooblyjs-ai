// A tiny async queue: one side push()es events, the other `for await`s them.
//
// The agent loop is an async generator, so it can only yield while IT is
// running. While tools run (Promise.all), a subagent inside the Task tool
// (Phase 13) produces progress events. The tools push them here, and the loop
// yields them as they arrive, until the tools are done and close() the channel.
export function createChannel() {
  const queue = [];
  let wake = null;
  let closed = false;
  return {
    push(item) {
      if (closed) return;
      queue.push(item);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length) {
          yield queue.shift();
          continue;
        }
        if (closed) return;
        await new Promise((resolve) => (wake = resolve));
        wake = null;
      }
    },
  };
}
