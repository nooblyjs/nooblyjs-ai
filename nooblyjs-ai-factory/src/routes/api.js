// @ts-check
// Phase F17: the dashboard's JSON API, as a ROUTE TABLE. Which URL reaches which handler;
// the handlers themselves are in src/controllers/api.js.
//
//   GET  /api/status                 stopped? spend today, running, queued (and why), the line
//   GET  /api/runs                   recent runs, with the station each is at
//   GET  /api/runs/:id               one run: its steps, its story, agent output, evidence
//   GET  /api/inbox                  what's waiting for a person
//   GET  /api/events                 SSE: the event log, live (src/services/sse.js)
//   GET  /api/runs/:id/artifacts/:sha  one artifact's text, to download
//   GET  /api/metrics, /api/campaigns
//   POST /api/inbox/:id              { decision, answer?, feedback? }
//   POST /api/runs/:id/:action       cancel | pause | resume | retry ({ from })
//   POST /api/stop-all, /api/resume-all
import { createApiController } from '../controllers/api.js';

/**
 * @param {{ store: import('../models/store/events.js').Store, env?: NodeJS.ProcessEnv, extra?: Array<[string, string, Function]> }} options
 * @returns {Array<[string, string, (ctx: any) => any]>}
 */
export function apiRoutes({ store, env = process.env, extra = [] }) {
  const api = createApiController({ store, env });
  return [
    ['GET', '/api/status', api.status],
    ['GET', '/api/runs', api.listRuns],
    ['GET', '/api/runs/:id', api.getRun],
    ['GET', '/api/runs/:id/artifacts/:sha', api.getArtifact],
    ['GET', '/api/metrics', api.metrics],
    ['GET', '/api/campaigns', api.campaigns],
    ['GET', '/api/inbox', api.inbox],
    ['POST', '/api/inbox/:id', api.answerInbox],
    ['POST', '/api/runs/:id/:action', api.runAction],
    ['POST', '/api/stop-all', api.stopAll],
    ['POST', '/api/resume-all', api.resumeAll],
    ['GET', '/api/events', api.events],
    ...extra,
  ];
}
