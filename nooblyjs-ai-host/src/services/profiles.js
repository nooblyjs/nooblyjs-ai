// Profiles (product.md §5.8, tech.md §7.1): data/people/<id>/profile.md holds what a person chose in onboarding
// (work role, teams, tools, notification preferences) and their first-week checklist. The work role shapes the
// home and nothing else: no permission check ever reads a profile.
//
// The first-week checklist is driven by events. Each task names the event that completes it; when that event
// arrives with the person as its actor, the task is ticked here. No page marks a task done.
import { HttpError } from '../util/errors.js';
import { ID } from '../util/ids.js';

const TOOL = /^[a-z0-9][a-z0-9-]{0,60}$/;
export const toolKey = (name) => String(name).toLowerCase().replace(/\[.*?\]/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const invalid = (message, details) => new HttpError(422, 'invalid', message, details);

export function createProfiles({ store, workRoles, events, clock = Date }) {
  const file = (personId) => ['people', personId, 'profile.md'];
  const now = () => new Date(clock.now()).toISOString();

  async function teamIds() {
    return (await store.list(['teams'])).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3));
  }

  function view(personId, data) {
    return {
      person: personId,
      workRole: data.workRole ?? null,
      teams: Array.isArray(data.teams) ? data.teams : [],
      tools: data.tools ?? {},
      // Approvals in Teams are opt-in (they need the NooblyJS app); approval emails are on unless turned off (Phase 12).
      notifications: { approvalsInTeams: data.notifications?.approvalsInTeams === true, approvalsByEmail: data.notifications?.approvalsByEmail !== false },
      onboarding: { completed: data.onboarding?.completed === true, skipped: data.onboarding?.skipped === true, completedAt: data.onboarding?.completedAt ?? null },
      firstWeek: { hidden: data.firstWeek?.hidden === true, done: data.firstWeek?.done ?? {} },
      dismissedHints: Array.isArray(data.dismissedHints) ? data.dismissedHints : [],
    };
  }

  /** The person's profile, or null when they haven't been through (or skipped) onboarding. */
  async function get(personId) {
    if (!ID.test(personId ?? '')) return null;
    const doc = await store.readDoc(file(personId));
    return doc ? view(personId, doc.data) : null;
  }

  /** Checks a change and returns only the fields it may set. Throws a 422 that names what is wrong. */
  async function check(changes) {
    const out = {};
    if (changes.workRole !== undefined) {
      if (!(await workRoles.get(changes.workRole))) throw invalid('Pick one of the six work roles.', { workRole: 'unknown role' });
      out.workRole = changes.workRole;
    }
    if (changes.teams !== undefined) {
      const known = new Set(await teamIds());
      if (!Array.isArray(changes.teams) || changes.teams.some((t) => !known.has(t))) throw invalid('Pick teams from the list.', { teams: 'unknown team' });
      out.teams = [...new Set(changes.teams)];
    }
    if (changes.tools !== undefined) {
      if (!changes.tools || typeof changes.tools !== 'object' || Array.isArray(changes.tools)) throw invalid('tools is a map of tool to true or false.', { tools: 'invalid' });
      out.tools = Object.fromEntries(Object.entries(changes.tools).filter(([k]) => TOOL.test(k)).slice(0, 20).map(([k, v]) => [k, v === true]));
    }
    if (changes.notifications !== undefined) out.notifications = { approvalsByEmail: changes.notifications?.approvalsByEmail !== false, approvalsInTeams: changes.notifications?.approvalsInTeams === true };
    if (changes.firstWeek?.hidden !== undefined) out.firstWeekHidden = changes.firstWeek.hidden === true;
    if (changes.dismissedHints !== undefined) {
      if (!Array.isArray(changes.dismissedHints)) throw invalid('dismissedHints is a list.', { dismissedHints: 'invalid' });
      out.dismissedHints = changes.dismissedHints.filter((h) => typeof h === 'string' && TOOL.test(h)).slice(0, 100);
    }
    return out;
  }

  async function write(personId, fn) {
    let result;
    await store.updateDoc(file(personId), (doc) => {
      const data = fn({ ...(doc?.data ?? { person: personId }) });
      result = data;
      return { data: { ...data, updatedAt: now() }, body: doc?.body ?? '' };
    });
    return view(personId, result);
  }

  const apply = (data, f) => ({
    ...data,
    ...(f.workRole !== undefined ? { workRole: f.workRole } : {}),
    ...(f.teams !== undefined ? { teams: f.teams } : {}),
    ...(f.tools !== undefined ? { tools: { ...(data.tools ?? {}), ...f.tools } } : {}),
    ...(f.notifications !== undefined ? { notifications: f.notifications } : {}),
    ...(f.dismissedHints !== undefined ? { dismissedHints: f.dismissedHints } : {}),
    ...(f.firstWeekHidden !== undefined ? { firstWeek: { ...(data.firstWeek ?? {}), hidden: f.firstWeekHidden } } : {}),
  });

  /** PUT /me/profile: change the profile. A person with no profile yet goes through onboarding first. */
  async function update(personId, changes = {}) {
    const fields = await check(changes);
    if (!(await get(personId))) throw new HttpError(409, 'no_profile', 'Set up your role and teams in onboarding first.');
    const profile = await write(personId, (data) => apply(data, fields));
    await events.emit('profile.updated', { personId, fields: Object.keys(fields) }, { actor: personId });
    return profile;
  }

  /** The end of onboarding: role, teams, tools and the Teams toggle are saved and the profile is complete. */
  async function complete(personId, choices = {}) {
    if (!choices.workRole) throw invalid('Pick a work role.', { workRole: 'required' });
    const fields = await check({ workRole: choices.workRole, teams: choices.teams ?? [], tools: choices.tools ?? {}, notifications: choices.notifications ?? {} });
    const at = now();
    const before = await get(personId);
    const profile = await write(personId, (data) => ({
      ...apply(data, fields),
      onboarding: { completed: true, skipped: false, completedAt: data.onboarding?.completedAt ?? at },
    }));
    // The event ticks "Pick your role and teams" like any other task (below).
    await events.emit('profile.onboarded', { personId, workRole: profile.workRole, teams: profile.teams, changedRole: Boolean(before?.workRole && before.workRole !== profile.workRole) }, { actor: personId });
    return get(personId);
  }

  /** Skip for now: a profile exists (so the person isn't sent back to onboarding on every page) but isn't complete. */
  async function skip(personId, { suggestedRole = null } = {}) {
    const existing = await get(personId);
    if (existing?.onboarding.completed) return existing;
    const profile = await write(personId, (data) => ({
      ...data,
      workRole: data.workRole ?? suggestedRole ?? null,
      teams: data.teams ?? [],
      onboarding: { completed: false, skipped: true, skippedAt: now() },
    }));
    await events.emit('profile.onboarding_skipped', { personId }, { actor: personId });
    return profile;
  }

  /**
   * The first-week checklist: "Pick your role and teams" plus the role's first three things, with what is done.
   * `card` is true while there is something left and the person hasn't hidden it (the Getting started card).
   */
  async function firstWeek(personId) {
    const profile = await get(personId);
    if (!profile) return null;
    const tasks = (await workRoles.firstWeek(profile.workRole)).map((t) => ({ key: t.key, text: t.text, next: t.next ?? t.text, done: Boolean(profile.firstWeek.done[t.key]), doneAt: profile.firstWeek.done[t.key]?.at ?? null }));
    const done = tasks.filter((t) => t.done).length;
    const next = tasks.find((t) => !t.done) ?? null;
    return {
      tasks, done, total: tasks.length, hidden: profile.firstWeek.hidden,
      next: next ? next.next : null,
      onboardingOpen: !profile.onboarding.completed,
      card: done < tasks.length && !profile.firstWeek.hidden,
    };
  }

  const matches = (rule, event) => rule?.type === event.type
    && Object.entries(rule.where ?? {}).every(([key, value]) => String(event.payload?.[key] ?? '') === String(value));

  /** Ticks the actor's open first-week tasks that this event completes. Called for every event. */
  async function onEvent(event) {
    const personId = event?.actor;
    if (!personId || event.type === 'profile.first_week_progressed' || !ID.test(personId)) return;
    const profile = await get(personId);
    if (!profile) return;
    const open = (await workRoles.firstWeek(profile.workRole)).filter((t) => !profile.firstWeek.done[t.key] && matches(t.done, event));
    if (!open.length) return;
    await write(personId, (data) => ({
      ...data,
      firstWeek: { ...(data.firstWeek ?? {}), done: { ...(data.firstWeek?.done ?? {}), ...Object.fromEntries(open.map((t) => [t.key, { at: event.at ?? now(), event: event.type }])) } },
    }));
    const state = await firstWeek(personId);
    await events.emit('profile.first_week_progressed', { personId, tasks: open.map((t) => t.key), done: state.done, total: state.total }, { actor: personId });
  }

  return { get, update, complete, skip, firstWeek, onEvent };
}
