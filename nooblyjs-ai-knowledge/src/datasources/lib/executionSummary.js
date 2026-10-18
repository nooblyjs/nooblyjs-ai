/**
 * Execution record projection — the ONE place an execution is reduced to the
 * summary fields a list view needs.
 *
 * Execution records store the workflow's full `result` (and `steps`) payload,
 * which for heavy workflows can be many MB each. Returning fat records from a
 * list endpoint lets the aggregate JSON exceed the browser's maximum string
 * length (~512MB), which makes the client's `response.json()` throw
 * `RangeError: Invalid string length`. The full record is fetched on demand via
 * GET /api/executions/:id when a row is expanded, so a list only needs these
 * fields.
 *
 * NOTE: never stringify `result` to measure its size here — a >512MB result
 * would throw the same RangeError server-side; `hasResult` is a cheap null
 * check instead.
 *
 * Used by the executions routes (projecting on the way out) and by
 * WorkflowBridge.listWorkflowExecutions (projecting as each day file is walked,
 * so the peak memory of a multi-day scan stays bounded).
 */

const EXEC_LIST_FIELDS = [
  'id', 'executionId', 'workflowId', 'workflowName', 'name', 'group',
  'directoryName', 'startedAt', 'executedAt', 'timestamp', 'completedAt',
  'duration', 'outcome', 'status',
];

function summarizeExecution(e) {
  if (!e || typeof e !== 'object') return e;
  const slim = {};
  for (const k of EXEC_LIST_FIELDS) {
    if (e[k] !== undefined) slim[k] = e[k];
  }
  slim.hasResult = e.result != null;
  return slim;
}

function summarizeExecutions(list) {
  return Array.isArray(list) ? list.map(summarizeExecution) : list;
}

/**
 * Classify a record into the four outcomes the UI groups by. Records written by
 * different paths disagree on which field carries the verdict (`status` is
 * completed/failed/running, `outcome` is success/failed), so both are consulted.
 */
function classifyExecution(e) {
  const status = String((e && e.status) || '').toLowerCase();
  const outcome = String((e && e.outcome) || '').toLowerCase();
  if (status === 'running' || status === 'started') return 'running';
  if (status === 'failed' || outcome === 'failed' || outcome === 'error') return 'failed';
  if (status === 'completed' || outcome === 'success' || outcome === 'succeeded') return 'success';
  return 'other';
}

module.exports = { EXEC_LIST_FIELDS, summarizeExecution, summarizeExecutions, classifyExecution };
