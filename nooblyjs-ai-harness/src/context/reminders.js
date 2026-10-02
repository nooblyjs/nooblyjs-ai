// Phase 07: system reminders, small notes from the harness to the model.
//
// Some things change DURING a session: you edit a file the model read, or you
// switch to plan mode. We could rewrite the system prompt, but that would change
// the start of every request (bad for caching, Phase 09). Instead we attach a
// short note to YOUR next message, wrapped in <system-reminder> tags, which the
// system prompt tells the model to trust as coming from noobly.
import fs from 'node:fs';
import path from 'node:path';
import { MODES } from '../permissions/modes.js';
import { finishedReminder } from '../tasks/registry.js';
import { todoReminder } from '../tools/todo.js';

/**
 * Collect reminders for the next user message, and remember what was said so
 * each change is only mentioned once.
 * @returns {string[]}
 */
export function collectReminders(session) {
  const reminders = [];
  session.reminderState ??= { mode: session.permissions?.mode, noticedMtimes: new Map() };
  const state = session.reminderState;

  // 1. The permission mode changed (e.g. Shift+Tab into plan mode).
  const mode = session.permissions?.mode;
  if (mode && mode !== state.mode) {
    reminders.push(`The permission mode is now "${MODES[mode].label}". ${MODES[mode].explain}`);
    state.mode = mode;
  }

  // 2. A file the model read has changed on disk since (edited by the user, or by a command).
  for (const [file, readMtime] of session.readFiles ?? []) {
    let mtime;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      mtime = null; // deleted
    }
    if (mtime === readMtime || state.noticedMtimes.get(file) === mtime) continue;
    state.noticedMtimes.set(file, mtime);
    const shown = path.relative(session.cwd, file) || file;
    reminders.push(
      mtime === null
        ? `${shown} was deleted since you last read it.`
        : `${shown} was modified since you last read it (by the user or a command). Read it again before relying on its contents or editing it.`,
    );
  }

  // Phase 21: the user rewound the files (but not the conversation): what you remember of them is out of date.
  if (state.rewound) {
    const { turn, restored, deleted, notRestorable } = state.rewound;
    state.rewound = null;
    const show = (files) => files.map((file) => path.relative(session.cwd, file) || file).join(', ');
    reminders.push(
      [
        `The user rewound the project's files to how they were before this earlier request of theirs: "${turn.prompt}". The conversation was kept, but the file changes made since then are undone.`,
        restored.length && `Restored: ${show(restored)}.`,
        deleted.length && `Deleted (they didn't exist then): ${show(deleted)}.`,
        notRestorable.length && `Changed by commands, so NOT restored: ${show(notRestorable)}.`,
        'Read files again before relying on them or editing them.',
      ].filter(Boolean).join('\n'),
    );
  }

  // Phase 22: background tasks that ended since the model last heard.
  const finished = session.tasks?.takeFinished() ?? [];
  if (finished.length) reminders.push(finishedReminder(finished));

  // 3. Phase 11: the conversation was summarized; repeat the todo list so the plan isn't lost.
  if (state.todosAfterCompact) {
    state.todosAfterCompact = false;
    if (session.todos?.length) reminders.push(todoReminder(session.todos));
  }

  return reminders;
}

/** The user's text plus reminders, as message content. */
export function withReminders(text, reminders) {
  if (reminders.length === 0) return text;
  return [
    { type: 'text', text },
    ...reminders.map((reminder) => ({ type: 'text', text: `<system-reminder>\n${reminder}\n</system-reminder>` })),
  ];
}
