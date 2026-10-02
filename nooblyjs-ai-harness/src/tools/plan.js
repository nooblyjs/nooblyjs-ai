// Phase 11: leaving plan mode, with the user's approval.
//
// In plan mode (Phase 06) the permission gate blocks every tool that changes
// something, so the model can only look around. When it has a plan it calls
// ExitPlanMode with it. That shows YOU the plan, and only if you approve does
// the mode switch, so the model can start changing files.
//
// Why a tool, and not just "write your plan and wait"? A tool call is
// STRUCTURED: the harness knows exactly when the plan is ready and what it
// says, can show an approval dialog, and can switch the mode itself. A plan in
// ordinary text is just text; nothing would change until you typed something.
import { MODES } from '../permissions/modes.js';
import { defineTool, ToolError } from './tool.js';

export const exitPlanModeTool = defineTool({
  name: 'ExitPlanMode',
  // Calling it changes nothing by itself: the user decides. So it's allowed in plan mode.
  isReadOnly: true,
  description: [
    'Use this ONLY in plan mode, when you have finished investigating and have a plan for a task that needs changes (edits or commands).',
    'Send the plan as Markdown: the steps, the files you will change and how, and how you will check the result (e.g. which tests to run). Be concise.',
    'The user sees the plan and approves or rejects it. If approved, plan mode ends and you can start. If rejected, you get their feedback: revise the plan and call this again.',
    'Do not use it for questions or research tasks where nothing needs changing: just answer. Do not ask "is this plan OK?" in text: call this tool instead.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'The plan, in Markdown' },
    },
    required: ['plan'],
    additionalProperties: false,
  },

  summarize: ({ plan }) => (typeof plan === 'string' ? `${plan.trim().split('\n').length} lines` : ''),

  async call({ plan }, ctx) {
    const session = ctx.session;
    if (session.permissions.mode !== 'plan') {
      throw new ToolError('You are not in plan mode, so there is nothing to exit. Go ahead with the task.');
    }
    if (!plan.trim()) throw new ToolError('The plan is empty. Describe the steps you will take.');

    const answer = await session.requestPlanApproval({ plan, signal: ctx.signal });
    if (answer.behavior !== 'approve') {
      const feedback = answer.message ? ` They said: "${answer.message}"` : '';
      throw new ToolError(
        answer.reason ?? `The user did not approve the plan.${feedback} You are still in plan mode: revise the plan (investigate more if needed) and call ExitPlanMode again, or ask what they want.`,
        { display: answer.message ? `Plan rejected: ${answer.message}` : 'Plan rejected' },
      );
    }

    const mode = answer.mode ?? 'default';
    session.permissions.mode = mode;
    // The tool result already tells the model about the new mode, so no reminder is needed as well.
    if (session.reminderState) session.reminderState.mode = mode;
    return {
      content: `The user approved your plan. Plan mode is off; the permission mode is now "${MODES[mode].label}". ${MODES[mode].explain}\nStart now. For a plan with several steps, write it into TodoWrite first and tick the items off as you go.`,
      display: `Plan approved (${MODES[mode].label})`,
    };
  },
});
