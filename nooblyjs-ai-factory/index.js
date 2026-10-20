// @ts-check
// Library entry point: use the factory from your own Node code.
//
// Phase F00: nothing much to export yet. Each phase adds its building blocks here.
export { newId, idTime, slugify } from './src/utils/ids.js';
export { systemClock, createFakeClock } from './src/utils/clock.js';
export { factoryHome } from './src/utils/paths.js';

// Phase F01: drive a noobly agent.
export { createDriver, outcomeOf, OUTCOMES } from './src/services/exec/harness/driver.js';
export { inProcessDriver } from './src/services/exec/harness/in-process.js';
export { subprocessDriver } from './src/services/exec/harness/subprocess.js';
export { createLimits } from './src/services/exec/harness/limits.js';

// Phase F02: isolated workspaces and a step in one.
export { acquireWorkspace, releaseWorkspace, listWorkspaces, loadWorkspace, cleanWorkspaces } from './src/services/exec/workspace/worktree.js';
export { worktreeProvider } from './src/services/exec/workspace/provider.js';
export { ensureSetup } from './src/services/exec/workspace/setup-cache.js';
export { loadRepoConfig, parseRepoConfig } from './src/config/repo-config.js';
export { runCommand, sandboxStatus, isolationProblem } from './src/services/exec/sandbox.js';
export { runStep } from './src/services/exec/step-runner.js';

// Phase F03: the first job.
export { createLocalForge } from './src/services/forge/local.js';
export { runJob } from './src/services/job/run-job.js';
export { fenceUntrusted } from './src/services/job/prompt.js';

// Phase F04: deterministic gates.
export { runGates, formatGates } from './src/services/exec/gates/runner.js';
export { excerpt } from './src/services/exec/gates/excerpt.js';

// Phase F05: the event store.
export { openStore } from './src/models/store/events.js';
export { performEffect } from './src/models/store/effects.js';
export { recoverRuns } from './src/models/store/recovery.js';
export { putArtifact, getArtifact, recordArtifact } from './src/models/store/artifacts.js';
export { startJob, executeRun, retryRun } from './src/services/job/run-job.js';

// Phase F06: the scheduler.
export { createScheduler } from './src/services/scheduler/scheduler.js';
export { pickRuns } from './src/services/scheduler/pick.js';
export { canStart, spentToday } from './src/services/scheduler/budgets.js';
export { acquireLease, renewLease, holdsLease, releaseLease } from './src/services/scheduler/leases.js';
export { holdRun } from './src/services/scheduler/worker.js';
export { stopAll, resumeAll, cancelRun, isStopped } from './src/services/scheduler/kill-switch.js';
export { loadFactoryConfig } from './src/config/factory-config.js';
export { submitJob } from './src/services/job/run-job.js';

// Phase F07: lines and the engine.
export { loadLine, parseLine } from './src/models/line.js';
export { decide, contextOf } from './src/services/line/engine.js';
export { compileCondition } from './src/services/line/conditions.js';
export { executeLine, STATIONS } from './src/services/line/executor.js';
export { pauseRun, resumeRun } from './src/services/scheduler/kill-switch.js';

// Phase F08: specs and steering.
export { checkSpec, parseRequirements, parseTasks } from './src/models/spec.js';
export { coverage, formatCoverage } from './src/services/specs/trace.js';
export { readSteering, steeringSection } from './src/services/knowledge/steering.js';
export { initRepo, detect, draft } from './src/services/knowledge/init.js';

// Phase F09: roles.
export { loadRoles, builtInRoles, agentOptionsFor } from './src/roles/loader.js';
export { rolePrompt } from './src/roles/prompts.js';

// Phase F10: fan-out, fan-in.
export { nextWave, planWaves, overlaps } from './src/services/line/fanout.js';
export { integrateWave } from './src/services/line/integrate.js';

// Phase F11: review.
export { detectTampering, isTestFile } from './src/services/review/tampering.js';
export { parseReview, formatReview } from './src/models/findings.js';

// Phase F12: humans in the loop.
export { autonomyFor, gateMode, LEVELS } from './src/services/humans/autonomy.js';
export { openEntry, answerEntry, openEntries } from './src/models/inbox.js';
export { continueRun } from './src/services/job/run-job.js';

// Phase F13: repair loops.
export { describeFailure } from './src/services/line/stations/repair.js';
export { headOf } from './src/services/line/stations/common.js';

// Phase F14: scope and evidence.
export { checkScope, scopeGate, PROTECTED } from './src/services/exec/gates/scope-guard.js';
export { buildEvidence, testLinks } from './src/services/evidence/bundle.js';

// Phase F15: the GitHub forge.
export { createGitHubClient } from './src/services/forge/github/client.js';
export { createGitHubForge, gitAuthEnv } from './src/services/forge/github/forge.js';
export { verifySignature, parseWebhook, handleWebhook } from './src/services/forge/github/webhooks.js';
export { forgeFor, githubSettings } from './src/services/forge/index.js';
export { createWebhookServer } from './src/routes/webhooks.js';

// Phase F16: factory tools for agents (MCP).
export { STEP_TOOLS } from './src/services/mcp/step-tools.js';
export { OPERATOR_TOOLS } from './src/services/mcp/operator-tools.js';
export { serveMcp } from './src/services/mcp/server.js';
export { stepToken, verifyStepToken } from './src/services/mcp/tokens.js';
export { factoryToolsFor } from './src/services/mcp/wire.js';

// Phase F17: the dashboard.
export { createHttpServer } from './src/routes/http.js';
export { streamEvents } from './src/services/sse.js';
export { apiRoutes } from './src/routes/api.js';
export { requeueFrom, stationOf } from './src/controllers/api.js';
export { startDashboard, dashboardToken } from './src/controllers/cli/dashboard.js';

// Phase F18: notifications and chatops.
export { createNotifier, DEFAULT_EVENTS } from './src/services/notify/notifier.js';
export { toNotification, formatBatch } from './src/services/notify/messages.js';
export { parseCommand, parseComment, handleComment } from './src/services/forge/github/commands.js';

// Phase F19: the factory bench.
export { loadCases, materialise, runHidden, verifyCase } from './src/services/bench/cases.js';
export { runCase, runBench } from './src/services/bench/runner.js';
export { summarise, compare } from './src/services/bench/compare.js';
export { mineCases } from './src/services/bench/miner.js';

// Phase F20: metrics.
export { runMetrics } from './src/services/metrics/run-metrics.js';
export { factoryMetrics, formatMetrics, parseSince } from './src/services/metrics/factory-metrics.js';
export { detectMerges } from './src/services/metrics/merges.js';

// Phase F21: the learning loop.
export { tokens, similarity, clusterLearnings, learningsFromRun } from './src/services/knowledge/learning.js';
export { runRetros, isSettled } from './src/services/knowledge/retro.js';
export { recurring, ruleFor, proposeRule, CONVENTIONS } from './src/services/knowledge/propose.js';

// Phase F22: cost-aware routing.
export { POLICIES, LADDER, SIGNALS, signalsFor, routeTier, policyFor } from './src/services/routing/policy.js';

// Phase F23: containers and remote workers.
export { containerArgs, containerRuntime, runInContainer } from './src/services/exec/container.js';
export { commandIsolation } from './src/services/exec/sandbox.js';
export { createDispatcher } from './src/services/remote/dispatcher.js';
export { remoteRunStep } from './src/services/remote/remote-step.js';
export { createWorker } from './src/services/remote/worker.js';
export { workerApi } from './src/routes/workers.js';
export { workersFrom, revokeWorker } from './src/models/workers.js';

// Phase F24: security.
export { scanLines, scanCommits, addedLines } from './src/services/security/secret-scan.js';
export { agentEnv, secretsInEnv, inProcessEnvProblem, PROVIDER_KEYS } from './src/services/security/agent-env.js';
export { exportAudit, verifyAudit, AUDIT_TYPES } from './src/services/security/audit.js';

// Phase F25: campaigns and schedules.
export { createCampaign, campaignStatus, campaignStartsToday } from './src/services/campaign/campaign.js';
export { parseCron, cronMatches, runSchedules } from './src/services/campaign/schedule.js';

// Phase F26: hosted in NooblyJS. NooblyJS imports this file and calls register().
export { register, NAV, ENGINEERING_NAV, TEST_NAV, PERMISSIONS } from './src/services/hosted.js';
export { toExpressRouter } from './src/services/to-express.js';
