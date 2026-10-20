// NooblyJS started with the fake Jira and Bitbucket (test/fixtures/atlassian.js), for the Phase 13 tests. One at a time:
// nooblyjs-core's sign-in store is one per process.
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';
import { fakeAtlassian, WRITE_TOKEN, READ_TOKEN } from './atlassian.js';

export const REPOS = ['web-storefront', 'design-system', 'mobile-app', 'slots-api'];
const TOKENS = {
  JIRA_SITE: 'example.atlassian.net', JIRA_USERNAME: 'noobly@example.com', JIRA_API_TOKEN: READ_TOKEN, JIRA_WRITE_API_TOKEN: WRITE_TOKEN,
  BITBUCKET_WORKSPACE: 'examplews', BITBUCKET_EMAIL: 'noobly@example.com', BITBUCKET_API_TOKEN: READ_TOKEN, BITBUCKET_WRITE_API_TOKEN: WRITE_TOKEN,
};
export const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
export const patch = (c, url, json = {}) => c.request(url, { method: 'PATCH', json });
export const issuePosts = (fetch) => fetch.writes().filter((c) => c.path.endsWith('/rest/api/3/issue'));

/** `env` adds to the tokens (DEVTOOLS_WRITES: 'true' opens the deployment's lock). */
export async function start(env = {}) {
  const fetch = fakeAtlassian({ repositories: REPOS });
  const app = await startApp({ devtoolsFetch: fetch, env: { ...TOKENS, ...env } });
  await app.store.writeYaml(['config', 'devtools.yaml'], { bitbucket: { projects: [], repositories: REPOS }, jira: { projects: ['DTE'] } });
  const [stevie, priya, viewer] = [app.client(), app.client(), app.client()];
  await stevie.signIn('stevie');
  await priya.signIn('priya-s');
  await viewer.signIn('naledi-k');
  /**
   * Stevie gives the seed's Design handoff of PRD-028 (six work items across four repositories), then the Engineering
   * sign-off, which sends the work to the Software Factory (lifecycle v3, Phase 16b).
   */
  const approveHandoff = async () => {
    const res = await post(stevie, '/workflows/api/v1/approvals/apr_slotpickerdesign/decision', { decision: 'approve' });
    assert.equal(res.status, 200);
    const signed = await post(stevie, '/workflows/api/v1/items/PRD-028/advance', {});
    assert.equal(signed.status, 200);
    await app.noobly.syncSettled();
  };
  return { app, fetch, stevie, priya, viewer, approveHandoff, writes: async (c = stevie) => (await c.json('/api/v1/devtools/writes')).body, work: async () => (await priya.json('/api/v1/devtools/work/PRD-028')).body };
}
