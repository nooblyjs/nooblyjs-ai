// People: data/people/<id>/PERSON.md (who they are and their access role) and profile.md (work role, teams).
// The access role is the only source of permissions; the work role only shapes their home (product.md §2).
import crypto from 'node:crypto';
import { ID } from '../util/ids.js';

export function createPeople({ store }) {
  async function get(id) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    const doc = await store.readDoc(['people', id, 'PERSON.md']);
    if (!doc) return null;
    const profile = (await store.readDoc(['people', id, 'profile.md']))?.data ?? null;
    const p = doc.data;
    return {
      id: p.id ?? id,
      name: p.name,
      email: String(p.email ?? '').toLowerCase(),
      accessRole: p.accessRole,
      jobTitle: p.jobTitle ?? null,
      // The Entra object id (Phase 12): how a Teams message is matched to a person. Set when they sign in with Microsoft.
      entraId: p.entraId ?? null,
      active: p.active !== false,
      workRole: profile?.workRole ?? null,
      teams: profile?.teams ?? [],
      hasProfile: Boolean(profile),
    };
  }

  async function list() {
    const ids = await store.list(['people'], { dirs: true });
    return (await Promise.all(ids.map(get))).filter(Boolean);
  }

  async function getByEntraId(entraId) {
    const wanted = String(entraId ?? '').toLowerCase();
    if (!wanted) return null;
    return (await list()).find((p) => String(p.entraId ?? '').toLowerCase() === wanted) ?? null;
  }

  /**
   * What Microsoft says about a person who signed in: their Entra object id, and their job title when Graph gave
   * one (which onboarding uses to suggest a work role). An empty value never overwrites one NooblyJS has.
   */
  async function setFromEntra(id, { entraId = null, jobTitle = null } = {}) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    let changed = false;
    await store.updateDoc(['people', id, 'PERSON.md'], (doc) => {
      if (!doc) return null;
      const data = { ...doc.data };
      if (entraId && data.entraId !== entraId) { data.entraId = entraId; changed = true; }
      const title = String(jobTitle ?? '').trim().slice(0, 120);
      if (title && data.jobTitle !== title) { data.jobTitle = title; changed = true; }
      return changed ? { data, body: doc.body } : null;
    });
    return changed ? get(id) : null;
  }

  async function getByEmail(email) {
    const wanted = String(email ?? '').toLowerCase();
    return (await list()).find((p) => p.email === wanted) ?? null;
  }

  // Creating people is serialised, so two first requests from one new person can't make two records.
  let provisioning = Promise.resolve();

  /**
   * Creates the NooblyJS record for someone who signed in (nooblyjs-core account, e.g. from Microsoft Entra ID) but has
   * none yet. Returns the existing person if one appeared meanwhile. No profile.md is written: work role and teams
   * come from onboarding (Phase 3). The id is the email's local part as a slug, made unique with -2, -3, ….
   */
  function provision({ email, fullName }, { accessRole, source = 'sign-in', now = new Date().toISOString() }) {
    const run = provisioning.then(async () => {
      const wanted = String(email ?? '').trim().toLowerCase();
      if (!wanted.includes('@')) throw new Error('A person needs an email address.');
      const existing = await getByEmail(wanted);
      if (existing) return { person: existing, created: false };
      const base = wanted.split('@')[0].replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'person';
      let id = base;
      for (let n = 2; await store.exists(['people', id]); n++) id = `${base}-${n}`;
      await store.writeDoc(['people', id, 'PERSON.md'], {
        id,
        name: String(fullName ?? '').trim() || wanted.split('@')[0],
        email: wanted,
        accessRole,
        jobTitle: null,
        active: true,
        source,
        createdAt: now,
      }, `Created on first ${source === 'sign-in' ? 'sign-in' : source}. Work role and teams are set during onboarding.`);
      return { person: await get(id), created: true };
    });
    provisioning = run.catch(() => {});
    return run;
  }

  /** Changes a person's access role (Platform · Members). Returns { before, person }. Rules are the caller's. */
  async function setAccessRole(id, accessRole) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    let before = null;
    const updated = await store.updateDoc(['people', id, 'PERSON.md'], (doc) => {
      if (!doc) return null;
      before = doc.data.accessRole;
      return { data: { ...doc.data, accessRole }, body: doc.body };
    });
    return updated ? { before, person: await get(id) } : null;
  }

  return { get, list, getByEmail, getByEntraId, setFromEntra, provision, setAccessRole };
}

/**
 * Makes sure every active person has an nooblyjs-core authservice account, so core's Passport can sign them in.
 * Owners get core's `admin` role (the /services dashboards); everyone else `user`. The password is random and
 * never used: people sign in through the dev picker now and Microsoft Entra ID later.
 */
export async function ensureCoreAccounts({ authservice, people }) {
  const created = [];
  for (const person of await people.list()) {
    if (!person.active || !person.email) continue;
    const existing = await authservice.getUser(person.email).catch(() => null);
    if (existing) continue;
    await authservice.createUser({
      email: person.email,
      fullName: person.name,
      // Core's strength check wants upper and lower case, a digit and a special character.
      password: `${crypto.randomBytes(24).toString('base64url')}Aa9!`,
      role: person.accessRole === 'Owner' ? 'admin' : 'user',
    });
    created.push(person.email);
  }
  return created;
}
