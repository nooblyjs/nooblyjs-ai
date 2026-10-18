// Settings and the NooblyJS connection, shared by the side panel, the options page and the service worker.
// The extension talks only to NooblyJS. It never holds Jira or Bitbucket credentials and never calls their APIs.

export const DEFAULT_NOOBLY_URL = 'https://localhost:11001';

/** The NooblyJS address the person set on the options page (no trailing slash). */
export async function nooblyUrl() {
  const { nooblyUrl: url } = await chrome.storage.sync.get({ nooblyUrl: DEFAULT_NOOBLY_URL });
  return String(url).replace(/\/+$/, '');
}

export async function setNooblyUrl(url) {
  await chrome.storage.sync.set({ nooblyUrl: String(url).replace(/\/+$/, '') });
}

/**
 * Is NooblyJS reachable? `GET /healthz` needs no sign-in, so this never touches a session.
 * @returns {Promise<{ ok: boolean, url: string, version?: string, reason?: string }>}
 */
export async function checkNoobly() {
  const url = await nooblyUrl();
  try {
    const res = await fetch(`${url}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, url, reason: `NooblyJS answered ${res.status}` };
    const body = await res.json().catch(() => ({}));
    return { ok: body.status === 'ok', url, version: body.version };
  } catch (err) {
    return { ok: false, url, reason: err?.name === 'TimeoutError' ? 'NooblyJS did not answer in time' : 'NooblyJS is not reachable' };
  }
}

/**
 * Who is signed in to NooblyJS in this browser. The extension has no sign-in of its own: it uses the NooblyJS session the
 * person already has (nooblyjs-core's authservice: Entra in production, the dev picker in development). The browser
 * sends that session's cookie because the extension has host permission for NooblyJS. A person who isn't signed in
 * opens NooblyJS's /login in a tab; with Entra single sign-on in Edge that usually completes without a prompt.
 * @returns {Promise<{ signedIn: boolean, person?: { id: string, name: string, accessRole: string }, onboarding?: boolean, reason?: string }>}
 */
export async function whoAmI() {
  const url = await nooblyUrl();
  try {
    const res = await fetch(`${url}/api/v1/shell`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (res.status === 401) return { signedIn: false };
    if (!res.ok) return { signedIn: false, reason: `NooblyJS answered ${res.status}` };
    const body = await res.json();
    if (body.redirect) return { signedIn: true, onboarding: true };
    const { id, name, accessRole } = body.person ?? {};
    return id ? { signedIn: true, person: { id, name, accessRole } } : { signedIn: false };
  } catch {
    return { signedIn: false, reason: 'NooblyJS is not reachable' };
  }
}
