// LIVE and READ-ONLY: real GET requests to Jira and Bitbucket with the credentials in .env (npm run test:live:devtools).
// The connectors cannot send anything else (test/services/devtools.test.js). Prints names and counts, no content.
// JIRA_LIVE_PROJECT (a project key) adds a search; without it only the account and the project list are read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJira } from '../../src/services/devtools/jira.js';
import { createBitbucket } from '../../src/services/devtools/bitbucket.js';

const e = process.env;
const email = e.BITBUCKET_EMAIL || (String(e.BITBUCKET_USERNAME ?? '').includes('@') ? e.BITBUCKET_USERNAME : e.JIRA_USERNAME);
const REPO = e.BITBUCKET_LIVE_REPO || 'nooblyjs-ai-harness';

test('Jira: the account, what it may do, the projects it sees, and whether sprints are readable', { skip: !e.JIRA_API_TOKEN && 'JIRA_API_TOKEN is not set' }, async () => {
  const project = e.JIRA_LIVE_PROJECT ?? null;
  const jira = createJira({ site: e.JIRA_SITE, email: e.JIRA_USERNAME, token: e.JIRA_API_TOKEN, projects: () => (project ? [project] : []) });
  const account = await jira.account();
  assert.equal(account.ok, true, account.message);
  const permissions = await jira.permissions();
  const projects = await jira.projects({ limit: 5 });
  assert.equal(projects.ok, true, projects.message);
  const sprints = await jira.canReadSprints();
  console.log(`  Jira ${jira.site}: account active=${account.active}, can read=${permissions.canRead}, CAN WRITE=${permissions.canWrite}, ${projects.total} projects, sprints readable=${sprints.ok}${sprints.ok ? '' : ` (${sprints.reason})`}`);
  if (project) {
    const found = await jira.search({ limit: 3 });
    assert.equal(found.ok, true, found.message);
    console.log(`  ${project}: ${found.issues.length} issues read, e.g. ${found.issues.map((i) => `${i.key} [${i.type} · ${i.status}]`).join(', ')}`);
    assert.ok(found.issues.every((i) => i.project === project.toUpperCase()));
  }
});

test(`Bitbucket: the repository ${REPO}, its branches, commits and a file; pull requests when the token allows`, { skip: !e.BITBUCKET_API_TOKEN && 'BITBUCKET_API_TOKEN is not set' }, async () => {
  const bitbucket = createBitbucket({ workspace: e.BITBUCKET_WORKSPACE || 'acme', email, token: e.BITBUCKET_API_TOKEN });
  const check = await bitbucket.check();
  assert.equal(check.ok, true, check.message);
  const { ok, repository, message } = await bitbucket.repository(REPO);
  assert.equal(ok, true, message);
  const branches = await bitbucket.branches(REPO);
  const commits = await bitbucket.commits(REPO, { limit: 3 });
  assert.equal(commits.ok, true, commits.message);
  const file = await bitbucket.file(REPO, 'package.json', { ref: repository.branch });
  assert.equal(file.ok, true, file.message);
  const scopes = await bitbucket.scopes(REPO);
  const say = (s) => (s.ok ? 'readable' : `not readable (${s.scope ?? s.reason})`);
  console.log(`  ${repository.name} [${repository.project?.key}] branch ${repository.branch}, ${branches.branches?.length ?? 0} branches, last commit ${commits.commits[0]?.at?.slice(0, 10)}, package.json ${file.text.length} chars`);
  console.log(`  pull requests ${say(scopes.pullRequests)} · pipelines ${say(scopes.pipelines)}`);
});
