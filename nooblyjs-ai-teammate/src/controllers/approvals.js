// Tasks waiting for approval (estimated over a teammate's approval threshold), and timesheet entry approval.
import { recorder } from '../utils/request.js';

export function approvalsController({ invocation, team, audit }) {
  const record = recorder(audit);
  return {
    async list(req, res) {
      const status = ['pending', 'approved', 'declined'].includes(req.query.status) ? req.query.status : undefined;
      res.json({ approvals: await invocation.repos.approvals.list({ status }) });
    },
    async approve(req, res) {
      const approval = await invocation.approve(req.params.id, req.actor);
      await record(req, 'approval.approve', approval.teammateId, { work: approval.id, estimate: approval.estimate?.amount });
      res.status(202).json(approval);
    },
    async decline(req, res) {
      const approval = await invocation.decline(req.params.id, req.actor, req.body?.reason);
      await record(req, 'approval.decline', approval.teammateId, { work: approval.id, reason: approval.reason });
      res.json(approval);
    },
    async approveTimesheetEntry(req, res) {
      const entry = await team.approve(req.params.id, req.params.entryId);
      await record(req, 'timesheet.approve', req.params.id, { entry: entry.id, amount: entry.amount });
      res.json(entry);
    },
  };
}
