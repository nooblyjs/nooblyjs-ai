// Seed content written to the data directory on first run. Matches the design mockups.
import { getModel } from 'nooblyjs-ai-common/models';

/** A model's list price and when it was checked, from the shared catalogue in nooblyjs-ai-common. */
const listPrice = (modelId) => {
  const { pricing, pricingReviewedAt } = getModel(modelId);
  return { pricing: { ...pricing }, pricingReviewedAt };
};

export const SETTINGS = {
  owner: { id: 'stevie', name: 'Stevie', title: 'Team owner' },
  budgets: { week: 2100, month: 9000, quarter: 26000 },
  costCentres: ['Support', 'Growth', 'Sales', 'Sales ops', 'Web', 'Platform', 'Operations'],
  billing: {
    currency: 'USD',
    tokensPerHour: 300000, // tokens processed that count as one billable hour
    billingIncrementHours: 0.1, // bill in 6-minute increments
    estimateHoursPerMonth: 80,
    estimateOutputTokens: 4000, // typical output used to estimate a task before it runs
    invoiceDueDay: 15,
  },
  alerts: {
    warnAtPct: 80, // warn when a cap or budget passes this share
  },
};

export const SETTINGS_BODY = `# Settings

Global settings for the Teammates workspace.

- **budgets** are the spend limits per billing period, in USD.
- **billing.tokensPerHour** converts the tokens a teammate processes into billable hours. Hours are rounded up to **billing.billingIncrementHours**, then multiplied by the teammate's hourly rate.
- **billing.estimateOutputTokens** is the typical output used to estimate a task's cost before it runs, for approval thresholds.
- **alerts.warnAtPct** raises a warning when a teammate's monthly cap or a budget passes this share. **alerts.webhookUrl** (optional) receives the alerts as JSON.

Edit these on the Settings screen.
`;

export const MODELS = {
  reflection: 'haiku',
  models: {
    haiku: {
      name: 'Claude Haiku',
      tier: 'LIGHT',
      symbol: '$',
      description: 'Fast and cheap. Routine, high-volume work.',
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5',
      baseRate: 4,
      computePerHour: 2.5,
      toolsPerHour: 0.5,
      color: '#F2A27E',
      maxTokens: 16000,
      ...listPrice('claude-haiku-4-5'),
    },
    sonnet: {
      name: 'Claude Sonnet',
      tier: 'BALANCED',
      symbol: '$$',
      description: 'The everyday choice for most roles.',
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      baseRate: 16,
      computePerHour: 10,
      toolsPerHour: 2,
      color: '#C2471F',
      effort: 'medium',
      fallbacks: true,
      maxTokens: 32000,
      ...listPrice('claude-sonnet-5-5'),
    },
    opus: {
      name: 'Claude Opus',
      tier: 'PREMIUM',
      symbol: '$$$',
      description: 'Deep reasoning and long, complex tasks.',
      provider: 'anthropic',
      modelId: 'claude-opus-5-5',
      baseRate: 50,
      computePerHour: 31,
      toolsPerHour: 5,
      color: '#241C1A',
      effort: 'high',
      fallbacks: true,
      maxTokens: 64000,
      ...listPrice('claude-opus-5-5'),
    },
  },
};

export const MODELS_BODY = `# Models

The model catalogue offered when hiring a teammate.

- **baseRate** is the suggested hourly billing rate for a new hire on this model.
- **computePerHour** and **toolsPerHour** make up the cost breakdown on a teammate's profile. Margin is the hourly rate minus both.
- **pricing** is the provider's list price in USD per million tokens. It is used to record the actual API cost of each task. These values are Anthropic's first-party list prices as of 2026-09-25; check them against current pricing before relying on them.
- **pricingReviewedAt** is when the prices were last checked. Edit prices on Settings → Models & pricing.
- **reflection** is the model a teammate uses to write memory after a task.
`;

const skill = (name, description, instructions, featured = false) => ({ name, description, instructions, featured });

export const SKILLS = [
  skill('Deep research', 'Multi-source investigation with a cited summary', 'Break the question into sub-questions, consult several independent sources, and finish with a summary where every claim carries a citation. Flag low-confidence findings explicitly.'),
  skill('Source checking', 'Verifies claims and flags weak or paywalled sources', 'For each claim, find the primary source. Rate it strong, weak or unverifiable, and say why. Never cite a source you could not read.'),
  skill('Market sizing', 'Top-down and bottom-up TAM estimates', 'Produce a top-down and a bottom-up estimate, show every assumption in a table, and reconcile the two numbers.'),
  skill('Spreadsheet modelling', 'Builds simple forecast models', 'Lay out inputs, calculations and outputs separately. Name every assumption and keep formulas simple enough to audit.'),
  skill('Ticket triage', 'Sorts incoming tickets by urgency and owner', 'Classify each ticket by urgency (P1–P4), product area and owner. Draft a one-line summary and the next action.', true),
  skill('Refund policy', 'Applies the refund policy consistently', 'Check the request against the refund policy, quote the clause that applies, and recommend approve, deny or escalate.'),
  skill('Tone matching', "Replies in the customer's register", "Mirror the customer's formality and length. Stay warm, never sarcastic, and avoid jargon."),
  skill('React', 'Builds and fixes React components', 'Prefer small, accessible function components. Explain state and effects, and include tests for behaviour changes.'),
  skill('Accessibility', 'WCAG 2.1 AA audits and fixes', 'Audit against WCAG 2.1 AA: semantics, labels, focus order, contrast and keyboard access. Give the failing criterion and a concrete fix for each issue.'),
  skill('Test writing', 'Unit and integration tests for changed behaviour', 'Write tests that describe behaviour, cover edge cases, and fail for the right reason.'),
  skill('CSV cleanup', 'Normalises messy CSV exports', 'Detect the delimiter, encoding and header row. Normalise dates, phone numbers and casing, and report every row you changed or dropped.'),
  skill('SQL', 'Writes and explains SQL queries', 'Write readable, ANSI-style SQL with CTEs. Explain what the query returns and note any performance concerns.'),
  skill('Deduplication', 'Finds and merges duplicate records', 'Define match rules (exact, then fuzzy), show the candidate pairs with a confidence score, and never merge low-confidence pairs without asking.'),
  skill('Brand voice', 'Writes in the house brand voice', 'Clear, confident and friendly. Short sentences, active voice, no buzzwords.'),
  skill('Email campaigns', 'Plans and drafts email campaigns', 'Draft a subject line with two variants, preview text, the body and a single clear call to action.'),
  skill('Headlines', 'Writes headline options', 'Offer five headline options of different lengths and angles, and recommend one.'),
  skill('Scheduling', 'Finds times and books meetings', 'Propose three slots that respect everyone’s working hours and time zones, and hold them in priority order.', true),
  skill('Reminders', 'Keeps follow-ups from slipping', 'Track open commitments, then send short, polite reminders with the original context.'),
  skill('Meeting notes', 'Turns meetings into decisions and actions', 'Capture decisions, actions (owner and date) and open questions. Leave out the chatter.', true),
  skill('Threat modelling', 'STRIDE threat models for new features', 'Draw the data flow, apply STRIDE to each element, and rank the threats by likelihood and impact, with mitigations.'),
  skill('Dependency audit', 'Reviews third-party dependencies for risk', 'List the direct dependencies with their version, licence, maintenance status and known CVEs. Recommend upgrade, replace or accept for each.'),
  skill('Code review', 'Reviews diffs for correctness and clarity', 'Look for correctness bugs first, then security, then clarity. Be specific and kind, and suggest the fix.', true),
  skill('Lead enrichment', 'Fills in missing firmographic data on leads', 'Add the company size, industry, region and a relevant recent event to each lead, and cite where each fact came from.'),
  skill('Account briefs', 'One-page briefs on target accounts', 'Cover what the company does, recent news, likely priorities, the key people, and a suggested opening line.'),
  skill('CRM updates', 'Keeps CRM records tidy and current', 'Update the stage, next step and notes after every interaction. Never overwrite a field without recording the old value.', true),
  skill('Email drafting', 'Clear, friendly emails ready to send', 'Lead with the point, keep it under 150 words where possible, and end with a clear ask.', true),
  skill('Research', 'Quick, well-sourced answers to questions', 'Answer the question directly, then give the supporting evidence with sources.', true),
  skill('Spreadsheet work', 'Formulas, pivots and tidy sheets', 'Explain the formulas you use, keep raw data separate from analysis, and label everything.', true),
  skill('Architecture decision records', 'Writes ADRs that capture context and trade-offs', 'Use the ADR format: context, decision, options considered, consequences. Be explicit about trade-offs.'),
  skill('Plain-language explanation', 'Explains complex topics clearly and warmly', 'Explain for a smart reader who is new to the topic. Use one concrete example, short paragraphs, and define each term the first time it appears.'),
];

const sk = (name, level, description) => ({ name, level, ...(description ? { description } : {}) });

// hours30d: total billed hours to generate over the last 30 days.
// explicit: entries pinned to specific days (offset from today, 0 = today).
// Filler entries use `tasks` to reach the hour total.
export const TEAMMATES = [
  {
    name: 'Ada Quill', role: 'Research Analyst', status: 'task', currentTask: 'Q4 competitor scan',
    model: 'opus', rate: 48, monthlyCap: 3000, costCentre: 'Growth', hiredAt: '2026-03-14',
    avatar: { type: 'generated', bg: '#FFD7C2', deep: '#7A2E14', hair: 'bob' },
    about: 'Methodical researcher who cites every claim. Works best from a written brief with one clear question and a deadline. Flags low-confidence findings instead of guessing, and asks before spending more than two hours on a single question.',
    traits: ['Tone: plain & precise', 'Works 07:00–19:00 SAST', 'Needs approval over $200 / task'],
    approvalThreshold: 200,
    skills: [sk('Deep research', 3), sk('Source checking', 3), sk('Market sizing', 2), sk('Spreadsheet modelling', 1, 'Builds simple forecast models · in training')],
    memory: [
      { kind: 'preference', text: 'Summaries for Stevie stay under 300 words, bullets first.', daysAgo: 2 },
      { kind: 'fact', text: 'Q4 scan covers the 12 accounts in the Competitors sheet only.', daysAgo: 3 },
      { kind: 'preference', text: 'Skip paywalled analyst reports unless the licence is on file.', daysAgo: 9 },
      { kind: 'source', text: 'Company filings on the SEC EDGAR full-text search are the preferred primary source for US competitors.', daysAgo: 16 },
      { kind: 'fact', text: 'Growth team defines a competitor as any vendor in the last two lost-deal reports.', daysAgo: 24 },
    ],
    hours30d: 42,
    explicit: [
      { weekday: 0, task: 'Q4 competitor scan · scoping', hours: 3, tokens: 800000 },
      { weekday: 1, task: 'Q4 competitor scan · 12 accounts', hours: 5.5, tokens: 1700000 },
      { weekday: 2, task: 'Pricing page teardown', hours: 2, tokens: 600000 },
      { weekday: 3, task: 'Q4 competitor scan · summary', hours: 4, tokens: 1200000 },
      { daysAgo: 6, task: 'Q4 competitor scan', hours: 6.5, tokens: 1900000, status: 'pending' },
    ],
    tasks: ['Win/loss interview synthesis', 'Analyst report digest', 'Market sizing · EMEA', 'Feature comparison matrix'],
  },
  {
    name: 'Milo Brightwater', role: 'Support Lead', status: 'task', currentTask: 'Refund queue · 23 open',
    model: 'sonnet', rate: 14, monthlyCap: 1800, costCentre: 'Support', hiredAt: '2026-03-21',
    avatar: { type: 'generated', bg: '#CDE7E4', deep: '#1E5E63', hair: 'quiff' },
    about: 'Calm under pressure and relentlessly fair. Works the refund and escalation queues, writes replies that customers thank him for, and hands anything legal to a human straight away.',
    traits: ['Tone: warm & direct', 'Works 06:00–22:00 SAST', 'Escalates legal threats'],
    skills: [sk('Ticket triage', 3), sk('Refund policy', 3), sk('Tone matching', 2)],
    memory: [
      { kind: 'preference', text: 'Always offer store credit before a refund when the policy allows both.', daysAgo: 1 },
      { kind: 'fact', text: 'Refunds over $500 need sign-off from the Support manager.', daysAgo: 8 },
      { kind: 'source', text: 'The current refund policy is the July 2026 revision in the help centre.', daysAgo: 20 },
    ],
    hours30d: 96,
    explicit: [{ daysAgo: 2, task: 'Refund queue', hours: 11, tokens: 2400000 }],
    tasks: ['Refund queue', 'Escalations review', 'Macro updates', 'Ticket triage'],
  },
  {
    name: 'Juno Park', role: 'Frontend Engineer', status: 'task', currentTask: 'Checkout accessibility fixes',
    model: 'opus', rate: 52, monthlyCap: 2500, costCentre: 'Web', hiredAt: '2026-04-02',
    avatar: { type: 'generated', bg: '#E5DAF5', deep: '#4B2E83', hair: 'bun' },
    about: 'Careful, test-first engineer with a sharp eye for accessibility. Prefers small pull requests and explains every trade-off in the description.',
    traits: ['Tone: concise & technical', 'Opens draft PRs early', 'Needs approval over $300 / task'],
    approvalThreshold: 300,
    skills: [sk('React', 3), sk('Accessibility', 3), sk('Test writing', 2)],
    memory: [
      { kind: 'preference', text: 'Web team wants one PR per component, never a mega-PR.', daysAgo: 4 },
      { kind: 'fact', text: 'Checkout must pass WCAG 2.1 AA before the November release.', daysAgo: 5 },
    ],
    hours30d: 38,
    explicit: [{ daysAgo: 1, task: 'Checkout accessibility fixes', hours: 7, tokens: 2800000, status: 'pending' }],
    tasks: ['Checkout accessibility fixes', 'Design system tokens', 'Form validation refactor'],
  },
  {
    name: 'Otis Fern', role: 'Data Wrangler', status: 'task', currentTask: 'Dedupe CRM export',
    model: 'haiku', rate: 4, monthlyCap: 400, costCentre: 'Sales ops', hiredAt: '2026-05-11',
    avatar: { type: 'generated', bg: '#FBE6A6', deep: '#6B4E00', hair: 'antenna' },
    about: 'Tireless with messy data. Cleans, normalises and deduplicates exports, and always leaves a change log so you can see exactly what was touched.',
    traits: ['Tone: matter-of-fact', 'Batch jobs overnight'],
    skills: [sk('CSV cleanup', 3), sk('SQL', 2), sk('Deduplication', 3)],
    memory: [{ kind: 'fact', text: 'CRM export dates are in MM/DD/YYYY; convert to ISO.', daysAgo: 6 }],
    hours30d: 61,
    explicit: [{ daysAgo: 3, task: 'Dedupe CRM export', hours: 9.5, tokens: 3100000 }],
    tasks: ['Dedupe CRM export', 'Normalise lead sources', 'Weekly pipeline extract'],
  },
  {
    name: 'Sable Reyes', role: 'Copywriter', status: 'paused', currentTask: 'Paused · awaiting brief',
    model: 'sonnet', rate: 16, monthlyCap: 800, costCentre: 'Growth', hiredAt: '2026-05-30',
    avatar: { type: 'generated', bg: '#F6CFD8', deep: '#8A2440', hair: 'crop' },
    about: 'Punchy, on-brand writer. Gives you options, explains the angle behind each one, and never ships copy without a second read.',
    traits: ['Tone: lively & on-brand', 'Always sends 3 options'],
    skills: [sk('Brand voice', 3), sk('Email campaigns', 2), sk('Headlines', 3)],
    memory: [{ kind: 'preference', text: 'No exclamation marks in subject lines.', daysAgo: 12 }],
    hours30d: 22,
    explicit: [],
    tasks: ['October newsletter', 'Landing page headlines', 'Webinar invite sequence'],
  },
  {
    name: 'Pip Okafor', role: 'Operations Coordinator', status: 'available', currentTask: 'Ready for work',
    model: 'haiku', rate: 3, monthlyCap: 300, costCentre: 'Operations', hiredAt: '2026-06-01',
    avatar: { type: 'generated', bg: '#D6E4FA', deep: '#1F4A8A', hair: 'antenna' },
    about: 'Keeps the trains running: meetings booked, notes sent and reminders chased. Cheerful, quick and hard to faze.',
    traits: ['Tone: cheerful & brief', 'Works 08:00–17:00 SAST'],
    skills: [sk('Scheduling', 3), sk('Reminders', 2), sk('Meeting notes', 2)],
    memory: [{ kind: 'preference', text: 'Never book anything before 09:00 for Stevie.', daysAgo: 5 }],
    hours30d: 30,
    explicit: [],
    tasks: ['Weekly team sync notes', 'Offsite scheduling', 'Vendor follow-ups'],
  },
  {
    name: 'Rook Vale', role: 'Security Reviewer', status: 'off', currentTask: 'Back Monday 08:00',
    model: 'opus', rate: 60, monthlyCap: 1500, costCentre: 'Platform', hiredAt: '2026-07-19',
    avatar: { type: 'generated', bg: '#DCE8C8', deep: '#3D5A1E', hair: 'quiff' },
    about: 'Thorough and sceptical. Reviews designs and dependencies for risk, explains each finding in plain terms, and ranks fixes by impact.',
    traits: ['Tone: precise & sober', 'Weekdays only'],
    skills: [sk('Threat modelling', 3), sk('Dependency audit', 3), sk('Code review', 2)],
    memory: [{ kind: 'fact', text: 'Platform uses Node 22 LTS across all services.', daysAgo: 10 }],
    hours30d: 9,
    explicit: [{ daysAgo: 4, task: 'Dependency audit', hours: 3, tokens: 900000 }],
    tasks: ['Threat model · payments webhook', 'Dependency audit'],
  },
  {
    name: 'Wren Sato', role: 'Sales Researcher', status: 'available', currentTask: 'Ready for work',
    model: 'sonnet', rate: 18, monthlyCap: 900, costCentre: 'Sales', hiredAt: '2026-08-03',
    avatar: { type: 'generated', bg: '#EED9C4', deep: '#6A3F1F', hair: 'bob' },
    about: 'Articulate, curious and quick. Turns a list of company names into briefs a rep can read in two minutes, with an opening line that actually lands.',
    traits: ['Tone: clear & articulate', 'Briefs fit on one page'],
    skills: [sk('Lead enrichment', 2), sk('Account briefs', 3), sk('CRM updates', 2)],
    memory: [{ kind: 'preference', text: 'Reps want the opening line at the top of each brief.', daysAgo: 7 }],
    hours30d: 14,
    explicit: [{ daysAgo: 0, task: 'Account briefs · 12 accounts', hours: 4, tokens: 1100000, status: 'pending' }],
    tasks: ['Account briefs', 'Lead enrichment · fintech list'],
  },
];

// Historical invoices before the seeded timesheets begin.
export const PAST_INVOICES = [
  { monthsAgo: 2, amount: 6410 },
  { monthsAgo: 3, amount: 6156 },
  { monthsAgo: 4, amount: 5120 },
];

// Example automation: tools and handoffs on one teammate, and a schedule that starts paused (it would spend money).
export const AUTOMATION = {
  'ada-quill': { tools: ['fetch_url'], delegatesTo: ['wren-sato'] },
};
export const SCHEDULES = [
  { teammate: 'wren-sato', name: 'Weekly account briefs', task: 'Write one-page briefs for the five accounts with renewals coming up in the next 30 days: what they bought, open issues, and one talking point each.', cadence: { days: [1], time: '08:00' }, enabled: false },
];
