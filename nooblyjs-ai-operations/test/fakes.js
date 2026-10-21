// Stand-ins for the apps Operations talks to, recording what it asks: the lifecycle engine (PRD-031's features, the
// merged pull request and its approvals, the deploy approval, the feature going to Operate), Infrastructure (the release
// candidate, the deploy and the rollback), Security (findings, the SBOM) and the devtools write gate.
export function fakes({ featureStage = 'release', open = [] } = {}) {
  const calls = [];
  const rec = (name, answer = { ok: true }) => async (input) => { calls.push({ name, input }); return typeof answer === 'function' ? answer(input) : answer; };
  const state = { open: [...open], accepted: [], prod: [{ service: 'web', version: '4.11.2' }] };
  return {
    calls,
    state,
    services: {
      workflows: {
        featuresOf: async () => [
          { id: 'FEAT-031-1', title: 'See which stores still have same-day capacity', stage: featureStage, stories: [{ id: 'STORY-031-1', ref: 'STORY-031-1', title: 'See which stores still have same-day capacity', stage: featureStage, status: 'active' }] },
          { id: 'FEAT-031-2', title: 'Hold a slot for 15 minutes', stage: 'build', stories: [{ id: 'STORY-031-2', ref: 'STORY-031-2', title: 'Hold a slot', stage: 'build', status: 'active' }] },
        ],
        pullRequests: async ({ storyId }) => (storyId === 'STORY-031-1' ? [{ id: 'PR-031-1-1', ref: 'web-storefront PR-031-1-1', title: 'See which stores', status: 'completed', mergedSha: 'abc1234def', mergedBy: { id: 'lerato-m', name: 'Lerato M.' }, pr: { repo: 'web-storefront', sha: 'abc1234def', evidence: { text: '10 of 10 required tests present, all passing' } } }] : []),
        pullRequest: async () => ({ given: [{ type: 'build-approval', by: 'lerato-m' }, { type: 'test-approval', by: 'naledi-k' }] }),
        requestAppApproval: rec('workflows.requestAppApproval', { approvalId: 'apr_deploy1' }),
        featureDeployed: rec('workflows.featureDeployed', { moved: ['STORY-031-1'] }),
      },
      infrastructure: {
        releaseCandidate: async () => ({ product: 'slots', release: { name: 'Slots 1.0', approvers: 2 }, from: { name: 'staging', deployed: [{ service: 'api', version: '0.9.4' }, { service: 'web', version: '4.12.0' }], testRunId: 'TRN-staging-1' }, production: { name: 'prod', deployed: state.prod } }),
        deployRelease: rec('infrastructure.deployRelease', (i) => ({ environment: 'prod', percent: i.percent, deployed: i.deployed, previous: state.prod })),
        rollbackRelease: rec('infrastructure.rollbackRelease', () => ({ environment: 'prod', deployed: state.prod })),
      },
      security: {
        riskFor: async ({ itemId }) => (itemId === 'PRD-031' ? { open: state.open, accepted: state.accepted } : { open: [], accepted: [] }),
        sbomFor: async () => ({ format: 'CycloneDX (simplified)', repos: [{ repo: 'web-storefront', components: [] }] }),
      },
      quality: {
        coverageOf: async () => ({ stories: [{ text: '1 of 1 criterion has a passing test (Build)' }] }),
        testRuns: async () => [{ id: 'TRN-031-1-1', level: 'build', status: 'passed', text: 'Passed: 6 of 6 gates passed' }],
        environmentRuns: async () => [{ id: 'TRN-staging-1', environment: 'staging', level: 'staging', status: 'passed', text: 'Passed in staging', storyIds: ['STORY-031-1'] }],
      },
      product: { designInputs: async () => ({ jiraProject: 'DTE' }) },
      devtools: { release: { record: rec('devtools.release.record', (i) => [{ kind: 'jira.fix-version', target: 'DTE', state: 'recorded', sent: false }, ...i.tags.map((t) => ({ kind: 'bitbucket.tag', target: t.slug, state: 'recorded', sent: false }))]) } },
    },
  };
}
