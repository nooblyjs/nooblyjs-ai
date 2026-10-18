// The teammate endpoint: call a teammate with a task (JSON by default, Server-Sent Events when asked), and see
// where a task stands.
import { HttpError } from '../utils/errors.js';

export function tasksController({ invocation }) {
  return {
    async assign(req, res) {
      const caller = { type: req.actor.type, id: req.actor.id, name: req.actor.name };
      const body = req.body ?? {};
      const wantsStream = body.stream === true || (req.get('accept') ?? '').includes('text/event-stream');
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) controller.abort();
      });

      // `input` is accepted as an alias for `task`; `thread` continues a conversation, `project` scopes knowledge and
      // memory, and `skill` forces one skill instead of automatic selection.
      // `confirmCost` lets the owner go ahead with a task estimated over the teammate's approval threshold.
      const job = {
        task: body.task ?? body.input, costCentre: body.costCentre, thread: body.thread, project: body.project, skill: body.skill, caller, signal: controller.signal,
        confirmCost: caller.type === 'user' && body.confirmCost === true,
      };
      if (!wantsStream) {
        const result = await invocation.assign(req.params.id, job);
        return res.status(result.status === 'awaiting_approval' ? 202 : 200).json(result);
      }

      let opened = false;
      const send = (event, data) => {
        if (!opened) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          opened = true;
        }
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      try {
        const result = await invocation.assign(req.params.id, { ...job, onEvent: send });
        // Waiting for approval: nothing streamed yet, so answer with plain JSON like the non-streaming call.
        if (result.status === 'awaiting_approval' && !opened) return res.status(202).json(result);
        send('done', result);
      } catch (err) {
        if (!opened) throw err; // let the JSON error handler respond
        if (err.status !== 499) send('error', { code: err.code ?? 'error', message: err.message });
      }
      res.end();
    },

    // For callers that got 202 (waiting for approval). Keys only see the tasks they asked for.
    async status(req, res) {
      const status = await invocation.taskStatus(req.params.id, req.params.workId);
      if (req.actor.type === 'key' && status.caller?.id !== req.actor.id) throw new HttpError(404, 'not_found', 'Task not found');
      res.json(status);
    },
  };
}
