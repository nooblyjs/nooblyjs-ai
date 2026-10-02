// @ts-check
// Library entry point: use the factory from your own Node code.
//
// Phase F00: nothing much to export yet. Each phase adds its building blocks here.
export { newId, idTime, slugify } from './util/ids.js';
export { systemClock, createFakeClock } from './util/clock.js';
export { factoryHome } from './util/paths.js';

// Phase F01: drive a noobly agent.
export { createDriver, outcomeOf, OUTCOMES } from './exec/harness/driver.js';
export { inProcessDriver } from './exec/harness/in-process.js';
export { subprocessDriver } from './exec/harness/subprocess.js';
export { createLimits } from './exec/harness/limits.js';

// Phase F02: isolated workspaces and a step in one.
export { acquireWorkspace, releaseWorkspace, listWorkspaces, loadWorkspace, cleanWorkspaces } from './exec/workspace/worktree.js';
export { worktreeProvider } from './exec/workspace/provider.js';
export { ensureSetup } from './exec/workspace/setup-cache.js';
export { loadRepoConfig, parseRepoConfig } from './exec/workspace/repo-config.js';
export { runCommand, sandboxStatus, isolationProblem } from './exec/sandbox.js';
export { runStep } from './exec/step-runner.js';

// Phase F03: the first job.
export { createLocalForge } from './forge/local.js';
export { runJob } from './job/run-job.js';
export { fenceUntrusted } from './job/prompt.js';

// Phase F04: deterministic gates.
export { runGates, formatGates } from './exec/gates/runner.js';
export { excerpt } from './exec/gates/excerpt.js';

// Phase F05: the event store.
export { openStore } from './store/events.js';
export { performEffect } from './store/effects.js';
export { recoverRuns } from './store/recovery.js';
export { putArtifact, getArtifact, recordArtifact } from './store/artifacts.js';
export { startJob, executeRun, retryRun } from './job/run-job.js';

// Phase F06: the scheduler.
export { createScheduler } from './scheduler/scheduler.js';
export { pickRuns } from './scheduler/pick.js';
export { canStart, spentToday } from './scheduler/budgets.js';
export { acquireLease, renewLease, holdsLease, releaseLease } from './scheduler/leases.js';
export { holdRun } from './scheduler/worker.js';
export { stopAll, resumeAll, cancelRun, isStopped } from './scheduler/kill-switch.js';
export { loadFactoryConfig } from './config/factory-config.js';
export { submitJob } from './job/run-job.js';

// Phase F07: lines and the engine.
export { loadLine, parseLine } from './line/line.js';
export { decide, contextOf } from './line/engine.js';
export { compileCondition } from './line/conditions.js';
export { executeLine, STATIONS } from './line/executor.js';
export { pauseRun, resumeRun } from './scheduler/kill-switch.js';

// Phase F08: specs and steering.
export { checkSpec, parseRequirements, parseTasks } from './specs/schema.js';
export { coverage, formatCoverage } from './specs/trace.js';
export { readSteering, steeringSection } from './knowledge/steering.js';
export { initRepo, detect, draft } from './knowledge/init.js';

// Phase F09: roles.
export { loadRoles, builtInRoles, agentOptionsFor } from './roles/loader.js';
export { rolePrompt } from './roles/prompts.js';

// Phase F10: fan-out, fan-in.
export { nextWave, planWaves, overlaps } from './line/fanout.js';
export { integrateWave } from './line/integrate.js';

// Phase F11: review.
export { detectTampering, isTestFile } from './review/tampering.js';
export { parseReview, formatReview } from './review/findings.js';

// Phase F12: humans in the loop.
export { autonomyFor, gateMode, LEVELS } from './humans/autonomy.js';
export { openEntry, answerEntry, openEntries } from './humans/inbox.js';
export { continueRun } from './job/run-job.js';

// Phase F13: repair loops.
export { describeFailure } from './line/stations/repair.js';
export { headOf } from './line/stations/common.js';

// Phase F14: scope and evidence.
export { checkScope, scopeGate, PROTECTED } from './exec/gates/scope-guard.js';
export { buildEvidence, testLinks } from './evidence/bundle.js';

// Phase F15: the GitHub forge.
export { createGitHubClient } from './forge/github/client.js';
export { createGitHubForge, gitAuthEnv } from './forge/github/forge.js';
export { verifySignature, parseWebhook, handleWebhook } from './forge/github/webhooks.js';
export { forgeFor, githubSettings } from './forge/index.js';
export { createWebhookServer } from './server/webhooks.js';

// Phase F16: factory tools for agents (MCP).
export { STEP_TOOLS } from './mcp/step-tools.js';
export { OPERATOR_TOOLS } from './mcp/operator-tools.js';
export { serveMcp } from './mcp/server.js';
export { stepToken, verifyStepToken } from './mcp/tokens.js';
export { factoryToolsFor } from './mcp/wire.js';

// Phase F17: the dashboard.
export { createHttpServer } from './server/http.js';
export { streamEvents } from './server/sse.js';
export { apiRoutes, requeueFrom, stationOf } from './server/api.js';
export { startDashboard, dashboardToken } from './commands/dashboard.js';

// Phase F18: notifications and chatops.
export { createNotifier, DEFAULT_EVENTS } from './notify/notifier.js';
export { toNotification, formatBatch } from './notify/messages.js';
export { parseCommand, parseComment, handleComment } from './forge/github/commands.js';

// Phase F19: the factory bench.
export { loadCases, materialise, runHidden, verifyCase } from './bench/cases.js';
export { runCase, runBench } from './bench/runner.js';
export { summarise, compare } from './bench/compare.js';
export { mineCases } from './bench/miner.js';

// Phase F20: metrics.
export { runMetrics } from './metrics/run-metrics.js';
export { factoryMetrics, formatMetrics, parseSince } from './metrics/factory-metrics.js';
export { detectMerges } from './metrics/merges.js';

// Phase F21: the learning loop.
export { tokens, similarity, clusterLearnings, learningsFromRun } from './knowledge/learning.js';
export { runRetros, isSettled } from './knowledge/retro.js';
export { recurring, ruleFor, proposeRule, CONVENTIONS } from './knowledge/propose.js';

// Phase F22: cost-aware routing.
export { POLICIES, LADDER, SIGNALS, signalsFor, routeTier, policyFor } from './routing/policy.js';

// Phase F23: containers and remote workers.
export { containerArgs, containerRuntime, runInContainer } from './exec/container.js';
export { commandIsolation } from './exec/sandbox.js';
export { createDispatcher } from './remote/dispatcher.js';
export { remoteRunStep } from './remote/remote-step.js';
export { createWorker } from './remote/worker.js';
export { workerApi, workersFrom, revokeWorker } from './server/workers-api.js';

// Phase F24: security.
export { scanLines, scanCommits, addedLines } from './security/secret-scan.js';
export { agentEnv, secretsInEnv, inProcessEnvProblem, PROVIDER_KEYS } from './security/agent-env.js';
export { exportAudit, verifyAudit, AUDIT_TYPES } from './security/audit.js';

// Phase F25: campaigns and schedules.
export { createCampaign, campaignStatus, campaignStartsToday } from './campaign/campaign.js';
export { parseCron, cronMatches, runSchedules } from './campaign/schedule.js';
