// @ts-check
// Phase F15: a GitHub API client. Plain fetch, no SDK: every request is visible.
//
//   REST     https://api.github.com/repos/{owner}/{repo}/…   (almost everything)
//   GraphQL  https://api.github.com/graphql                 (what REST can't do: draft ⇄ ready)
//
// Being a good API citizen, and surviving it:
//
//   rate limited   403/429 with x-ratelimit-remaining: 0 → wait until x-ratelimit-reset
//                  (or `retry-after` seconds). If the wait is longer than maxWaitMs, fail
//                  with a clear message instead of hanging a worker for an hour.
//   5xx / network  retry with backoff (1s, 2s, 4s…), up to `retries` times
//   4xx            a real error: fail at once, with GitHub's own message
//
// The token (a fine-grained PAT, or a GitHub App installation token) lives in the
// CONTROL PLANE only. No agent ever sees it (Architecture §7).

/**
 * @param {{ token: string, apiUrl?: string, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>,
 *           retries?: number, maxWaitMs?: number, now?: () => number }} options
 */
export function createGitHubClient({ token, apiUrl = 'https://api.github.com', fetch: doFetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 3, maxWaitMs = 60_000, now = Date.now }) {
  if (!token) throw new Error('A GitHub token is needed (set it in the env variable your config names: github.tokenEnv, default GITHUB_TOKEN).');
  const base = apiUrl.replace(/\/+$/, '');

  async function send(method, url, body) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await doFetch(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'nooblyjs-learn-factory',
            ...(body !== undefined && { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        if (attempt >= retries) throw new Error(`GitHub ${method} ${url}: ${error instanceof Error ? error.message : error}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      // Rate limited: wait for the window to reset, if that's reasonable.
      const remaining = res.headers.get('x-ratelimit-remaining');
      if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.headers.get('retry-after'))) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        const wait = retryAfter ? retryAfter * 1000 : Math.max(0, reset - now()) + 1000;
        if (attempt >= retries || wait > maxWaitMs) throw new Error(`GitHub rate limit: next request allowed in ${Math.round(wait / 1000)}s (more than the ${Math.round(maxWaitMs / 1000)}s this client waits).`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw Object.assign(new Error(`GitHub ${method} ${url.replace(base, '')} → ${res.status}: ${data?.message ?? text}`), { status: res.status });
      return data;
    }
  }

  return {
    /** REST: request('GET', '/repos/o/r/issues/3') */
    request: (method, path, body) => send(method, `${base}${path}`, body),
    /** GraphQL: errors become exceptions. */
    async graphql(query, variables = {}) {
      const out = await send('POST', `${base}/graphql`, { query, variables });
      if (out?.errors?.length) throw new Error(`GitHub GraphQL: ${out.errors.map((e) => e.message).join('; ')}`);
      return out?.data;
    },
  };
}
