// Phase 22: BACKGROUND TASKS. Commands that keep running while the agent works.
//
// A normal Bash call waits for its command to finish. Dev servers and watchers
// never finish, and a 5-minute build blocks the whole turn. So Bash can start a
// command in the BACKGROUND instead: it gets a task id at once, and the agent
// carries on. Later it can read the new output (TaskOutput) or stop it (TaskStop).
//
// Three questions every design has to answer:
//   - How does the model learn a task ended, without polling in a loop?
//     → the next request carries a one-time note (a system reminder)
//   - How much output to keep?
//     → the last MAX_BUFFER characters; each read returns only what's NEW
//   - When do tasks die?
//     → TaskStop, /clear, or when noobly exits (never left behind)
import { EventEmitter } from 'node:events';
import { startProcess, stopProcess } from '../tools/bash.js';

const MAX_BUFFER = 1_000_000; // characters of output kept per task (the newest)
const MAX_READ = 30_000; // characters one TaskOutput returns (the newest, if there's more)

const everyTask = new Set(); // across sessions, so all can be stopped when noobly exits
process.once('exit', () => {
  for (const task of everyTask) if (task.status === 'running') task.kill('SIGKILL');
});

export function createTaskRegistry() {
  const tasks = new Map();
  const events = new EventEmitter(); // 'change' for the UI (status bar, notices)
  let nextId = 1;

  return {
    events,

    /**
     * Start `command` in the background (in the sandbox, if there is one).
     * @returns {Promise<object>} the task
     */
    async start(command, { cwd, sandbox = null, description = '' }) {
      const child = await startProcess(command, { cwd, sandbox });
      const task = {
        id: nextId++,
        command,
        description,
        status: 'running', // running · exited · stopped
        exitCode: null,
        startedAt: Date.now(),
        endedAt: null,
        output: '', // the newest MAX_BUFFER characters
        dropped: 0, // characters removed from the front of `output`
        readUpTo: 0, // absolute position the model has read up to
        notified: false, // has the model been told it ended?
        kill: (signal) => child.killGroup(signal),
        stop: () => stopProcess(child),
      };
      const append = (chunk) => {
        task.output += chunk;
        if (task.output.length > MAX_BUFFER) {
          const cut = task.output.length - MAX_BUFFER;
          task.output = task.output.slice(cut);
          task.dropped += cut;
        }
        events.emit('output', task);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.on('error', (error) => append(`Failed to start: ${error.message}\n`));
      child.on('close', (code) => {
        if (task.status === 'running') task.status = 'exited';
        task.exitCode = code;
        task.endedAt = Date.now();
        everyTask.delete(task);
        events.emit('change', task);
      });
      tasks.set(task.id, task);
      everyTask.add(task);
      events.emit('change', task);
      return task;
    },

    get: (id) => tasks.get(id),
    list: () => [...tasks.values()],
    running: () => [...tasks.values()].filter((t) => t.status === 'running'),

    /** Output the model hasn't seen yet (only the newest MAX_READ characters of it). */
    read(id) {
      const task = tasks.get(id);
      const total = task.dropped + task.output.length;
      let text = task.output.slice(Math.max(0, task.readUpTo - task.dropped));
      const notes = [];
      if (task.readUpTo < task.dropped) notes.push(`(${(task.dropped - task.readUpTo).toLocaleString()} older characters were no longer kept)`);
      if (text.length > MAX_READ) {
        notes.push(`(${(text.length - MAX_READ).toLocaleString()} characters skipped; showing the newest)`);
        text = text.slice(-MAX_READ);
      }
      task.readUpTo = total;
      return { text, notes };
    },

    /**
     * Wait until the task ends, `until` (a regex) appears in new output, or `ms` pass.
     * Lets the model say "wait for the server to be ready" instead of polling.
     */
    wait(id, { ms, until, signal }) {
      const task = tasks.get(id);
      const pattern = until ? new RegExp(until, 'm') : null;
      const matches = () => pattern?.test(task.output.slice(Math.max(0, task.readUpTo - task.dropped)));
      if (task.status !== 'running' || matches()) return Promise.resolve('ready');
      return new Promise((resolve) => {
        const done = (why) => {
          clearTimeout(timer);
          events.off('output', onOutput);
          events.off('change', onChange);
          signal?.removeEventListener('abort', onAbort);
          resolve(why);
        };
        const onOutput = (t) => t === task && matches() && done('matched');
        const onChange = (t) => t === task && t.status !== 'running' && done('ended');
        const onAbort = () => done('interrupted');
        const timer = setTimeout(() => done('timeout'), ms);
        events.on('output', onOutput);
        events.on('change', onChange);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },

    /** Stop a task (SIGTERM, then SIGKILL). The model asked for it, so it isn't told again. */
    stop(id) {
      const task = tasks.get(id);
      if (task.status !== 'running') return false;
      task.status = 'stopped';
      task.notified = true;
      task.stop();
      events.emit('change', task);
      return true;
    },

    stopAll() {
      for (const task of tasks.values()) if (task.status === 'running') this.stop(task.id);
    },

    /** Tasks that ended since the model was last told: each is returned once. */
    takeFinished() {
      const finished = [...tasks.values()].filter((t) => t.status === 'exited' && !t.notified);
      for (const task of finished) task.notified = true;
      return finished;
    },
  };
}

/** The one-time note for the model when tasks end. */
export function finishedReminder(tasks) {
  return tasks
    .map((task) => {
      const unread = task.dropped + task.output.length - task.readUpTo;
      const lines = unread > 0 ? task.output.slice(-unread).split('\n').filter(Boolean).length : 0;
      return `Background task ${task.id} (\`${task.command.split('\n')[0].slice(0, 80)}\`) exited with code ${task.exitCode ?? 'none (killed)'}.${lines ? ` It has ${lines} line(s) of output you haven't read: use TaskOutput with task_id ${task.id}.` : ''}`;
    })
    .join('\n');
}
