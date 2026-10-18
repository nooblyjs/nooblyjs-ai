// The Team board's fixed vocabulary (.claude/specs/team-board/): the kinds of post and what each is for, the states
// each kind moves through, the signals, the default settings, and the scripted replies a mentioned teammate plays when
// no model is configured.

/** Each kind of post, in the order the board lists its filters. `states[0]` is where a new post starts. */
export const KINDS = {
  'working-on': { label: 'Working on', help: "I'm on this, for this item, until about then.", states: ['active', 'done', 'stale'], tone: 'info' },
  done: { label: 'Done', help: 'Finished: what came out of it and what it cost.', states: ['closed'], tone: 'success' },
  finding: { label: 'Finding', help: 'Something I learned that others should know, with its sources.', states: ['open', 'promoted'], tone: 'navy' },
  ask: { label: 'Ask', help: 'A question to the team, or to someone named.', states: ['open', 'answered'], tone: 'warning' },
  'heads-up': { label: 'Heads-up', help: 'I changed something that affects your work.', states: ['open', 'acknowledged'], tone: 'warning' },
  'needs-person': { label: 'Needs a person', help: "I'm blocked on something only a person may do: approve, merge, decide, grant or spend.", states: ['open', 'resolved'], tone: 'danger' },
  note: { label: 'Note', help: 'Anything else: announcements, context, links.', states: ['closed'], tone: 'neutral' },
};
export const KIND_IDS = Object.keys(KINDS);

/** States in words (status is never colour alone). */
export const STATE_LABEL = {
  active: 'Active', done: 'Done', stale: 'Stale', closed: '', open: 'Open', promoted: 'Promoted to team memory',
  answered: 'Answered', acknowledged: 'Acknowledged', resolved: 'Resolved',
};
/** States that still want someone's attention. */
export const OPEN_STATES = new Set(['active', 'open']);

/** What a teammate may post with the board_post tool. Working on, Done and Note are posted automatically. */
export const AGENT_KINDS = ['finding', 'ask', 'heads-up', 'needs-person'];

export const SIGNALS = {
  useful: { label: 'Useful', kinds: null },
  seen: { label: 'Seen', kinds: null },
  take: { label: "I'll take it", kinds: ['ask', 'heads-up'] },
  same: { label: 'Same here', kinds: ['ask'] },
};

/** Where a person says they acted when they resolve a Needs-a-person post. */
export const WHERE_KINDS = ['approval', 'pr', 'item', 'other'];

export const BOARD_DEFAULTS = {
  standupTime: '09:00',
  digestTeammate: null,
  briefingTokens: 1500,
  agentPostsPerDay: 20,
  agentRepliesPerDay: 40,
  restAfterAgentReplies: 4,
  staleClaimHours: 24,
};

export const LIMITS = {
  body: 4000,
  reply: 2000,
  topics: 5,
  sources: 10,
  wakesPerMessage: 3,
  wakeHops: 2,
  threadForAgent: 20,
  briefingDays: 30,
  readLimit: 20,
  claimAfterMs: 2 * 60 * 1000, // tasks shorter than this never post a Working on (chat and Teams answers)
};

/** Scripted replies for a mentioned teammate when no model is configured, by the kind of post they were woken on. */
export const SCRIPTS = {
  ask: 'From what I have on this, here is my best answer: the details are in the item and the most useful findings on the board. I have not checked anything outside them, so treat this as a starting point.',
  'heads-up': 'Thanks for the heads-up. I will take it into account in my next task on this topic.',
  'needs-person': 'Noted. This needs a person: I cannot approve, merge or decide it. I will carry on with the parts I can do.',
  finding: 'Useful, thank you. I will use this in my next task on this topic.',
  default: 'Thanks. I have read the thread and will take it into account in my next task on this topic.',
};
