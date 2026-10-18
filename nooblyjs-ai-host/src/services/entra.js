// After someone signs in with Microsoft (Phase 12): what Entra and Microsoft Graph say about them goes on their NooblyJS
// record. Their Entra object id is how the Teams bot knows them; their job title is what onboarding suggests a work
// role from (data/access/job-title-roles.yaml). nooblyjs-core's Entra sign-in reports each sign-in ('auth:azure-login')
// and keeps the person's token. The Entra id comes from the sign-in itself. The job title needs Microsoft Graph's
// User.Read permission, which some tenants only give with admin consent, so it is read (GET /me, once per sign-in)
// only when AZURE_AD_READ_PROFILE=true; without it sign-in works and the job title is simply not known.

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me?$select=id,jobTitle,displayName';

/**
 * @param {object} o
 * @param {{ getByEmail, setFromEntra }} o.people
 * @param {{ getUser: (email: string) => Promise<object> }} o.authservice  nooblyjs-core's user store
 * @param {(coreUser: object) => Promise<object>} o.onNewPerson  makes the NooblyJS record on first sign-in
 */
export function createEntraSignIn({ people, authservice, onNewPerson, auditLog, fetch: fetchImpl = globalThis.fetch, log, readProfile = false }) {
  /** What Graph says about the signed-in person, or {} when it can't be read (no User.Read, no token, offline). */
  async function me(accessToken) {
    if (!accessToken) return {};
    try {
      const res = await fetchImpl(GRAPH_ME, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        log?.warn?.(`entra: Microsoft Graph /me answered ${res.status}; the job title is not read (the sign-in needs the User.Read permission)`);
        return {};
      }
      return await res.json();
    } catch (err) {
      log?.warn?.(`entra: Microsoft Graph /me could not be read: ${err.message}`);
      return {};
    }
  }

  /** Called with the email of someone who has just signed in with Microsoft. Resolves with their updated record. */
  async function signedIn(email) {
    const wanted = String(email ?? '').trim().toLowerCase();
    if (!wanted) return null;
    const coreUser = await authservice.getUser(wanted).catch(() => null);
    if (!coreUser) return null;
    const person = (await people.getByEmail(wanted)) ?? (await onNewPerson({ email: wanted, fullName: coreUser.fullName }));
    if (!person) return null;
    const graph = readProfile ? await me(coreUser.accessToken) : {};
    const updated = await people.setFromEntra(person.id, { entraId: coreUser.azureId ?? graph.id ?? null, jobTitle: graph.jobTitle ?? null });
    if (updated) {
      await auditLog?.record?.({ actor: person.id, action: 'person.entra_updated', target: person.id, entraId: updated.entraId, jobTitle: updated.jobTitle });
      log?.info?.(`entra: ${person.email} is ${updated.entraId ?? 'no Entra id'}${updated.jobTitle ? `, ${updated.jobTitle}` : ''}`);
    }
    return updated ?? person;
  }

  return { signedIn, me };
}
