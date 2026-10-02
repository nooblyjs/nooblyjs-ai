// Phase 06: permission modes. Shift+Tab cycles through the first three.

export const MODES = {
  default: {
    label: 'default',
    status: null,
    explain: 'Read-only tools run freely. Anything that changes files or runs commands asks the user first.',
  },
  acceptEdits: {
    label: 'accept edits',
    status: '⏵⏵ accept edits on',
    explain: 'File edits (Edit, Write) inside the project are allowed without asking. Bash commands still ask.',
  },
  plan: {
    label: 'plan',
    status: '⏸ plan mode on',
    explain:
      'Plan mode: you may only read and search. Do not try to edit files or run commands. Investigate, then call ExitPlanMode with your plan so the user can approve it. (For a question that needs no changes, just answer.)',
  },
  bypass: {
    label: 'bypass permissions',
    status: '⚠ bypass permissions on',
    explain: 'Nothing asks for permission (deny rules still apply). Only enabled with --dangerously-skip-permissions.',
  },
};

const CYCLE = ['default', 'acceptEdits', 'plan'];

/** The mode after `mode` when Shift+Tab is pressed. Bypass is never entered by cycling; from bypass it goes back to default. */
export function nextMode(mode) {
  const index = CYCLE.indexOf(mode);
  return CYCLE[(index + 1) % CYCLE.length];
}
