// A work queue on core's queueing service. Jobs are enqueued under a queue name and handled in this process by up
// to `concurrency` workers at a time. A job whose outcome `shouldRetry` is enqueued again after the next delay in
// `retryDelaysMs`. Queue contents are visible on /services/queueing/. With the memory provider, retries that are
// still waiting when the server stops are lost.
let seq = 0;

export class JobQueue {
  constructor({ queue, name, handler, shouldRetry = (result, error) => Boolean(error), concurrency = 4, retryDelaysMs = [], log = null, onRetry = null }) {
    this.queue = queue;
    this.name = name;
    this.handler = handler;
    this.shouldRetry = shouldRetry;
    this.concurrency = concurrency;
    this.retryDelaysMs = retryDelaysMs;
    this.log = log;
    this.onRetry = onRetry;
    this.running = 0;
    this.pending = 0; // queued + running (not retries waiting on a timer)
    this.waiters = new Map(); // job id -> { resolve, reject } for the first attempt
    this.retryTimers = new Set();
    this.idleWaiters = [];
    this.pumping = false;
    this.again = false;
    this.closed = false;
  }

  /** Queues `payload`. Resolves with the handler's result for the first attempt (retries carry on in the background). */
  push(payload) {
    const job = { id: `${this.name}-${Date.now().toString(36)}-${(++seq).toString(36)}`, payload, attempt: 1, queuedAt: new Date().toISOString() };
    const done = new Promise((resolve, reject) => this.waiters.set(job.id, { resolve, reject }));
    done.catch(() => {}); // callers may fire and forget
    this.enqueue(job);
    return done;
  }

  enqueue(job) {
    this.pending += 1;
    Promise.resolve(this.queue.enqueue(this.name, job))
      .then(() => this.pump())
      .catch((err) => this.finish(job, undefined, err));
  }

  async pump() {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        while (this.running < this.concurrency) {
          const job = await this.queue.dequeue(this.name);
          if (!job) break;
          this.running += 1;
          this.run(job);
        }
      } while (this.again);
    } catch (err) {
      this.log?.error?.(`[queue] ${this.name}: could not read the queue`, err);
    } finally {
      this.pumping = false;
    }
  }

  async run(job) {
    let result;
    let error;
    try {
      result = await this.handler(job.payload, { attempt: job.attempt, id: job.id });
    } catch (err) {
      error = err;
    }
    this.running -= 1;
    this.finish(job, result, error);
    this.pump();
  }

  finish(job, result, error) {
    const waiter = this.waiters.get(job.id);
    if (waiter) {
      this.waiters.delete(job.id);
      if (error) waiter.reject(error);
      else waiter.resolve(result);
    }
    let retry = false;
    try {
      retry = this.shouldRetry(result, error);
    } catch { /* treat as final */ }
    const delay = this.retryDelaysMs[job.attempt - 1];
    if (retry && delay !== undefined && !this.closed) {
      this.onRetry?.(job, delay);
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        if (!this.closed) this.enqueue({ ...job, attempt: job.attempt + 1 });
      }, delay);
      timer.unref?.();
      this.retryTimers.add(timer);
    } else if (error) {
      this.log?.warn?.(`[queue] ${this.name}: job ${job.id} failed after ${job.attempt} attempt(s): ${error.message}`);
    }
    this.pending -= 1;
    if (this.pending === 0) for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  /** Resolves once nothing is queued or running. Retries waiting on their delay don't count. */
  idle() {
    return this.pending === 0 ? Promise.resolve() : new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Waiting retries this process still holds. */
  get retrying() {
    return this.retryTimers.size;
  }

  async size() {
    return this.queue.size(this.name);
  }

  /** Cancels waiting retries. Jobs already queued or running still finish. */
  close() {
    this.closed = true;
    for (const t of this.retryTimers) clearTimeout(t);
    this.retryTimers.clear();
  }
}
