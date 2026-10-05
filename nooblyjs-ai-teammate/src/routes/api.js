import express from 'express';
import { HttpError, badRequest } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { requireRole, requireUser, requireUserOrKey } from '../middleware/auth.js';

const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
const MAX_UPLOAD_BYTES = 1024 * 1024;

const TASKS_ROUTE = /^\/teammates\/[^/]+\/tasks\/?$/;
const TASK_STATUS_ROUTE = /^\/teammates\/[^/]+\/tasks\/wk_[\w]+\/?$/;

export function apiRouter({ team, invocation, repos, store, events, auth, audit, limiter, tools, scheduler, log = console }) {
  const r = express.Router();
  // Everything needs the owner's session, except calling a teammate (and checking on that task), which also accept an API key.
  const keyAllowed = (req) => (req.method === 'POST' && TASKS_ROUTE.test(req.path)) || (req.method === 'GET' && TASK_STATUS_ROUTE.test(req.path));
  // Viewers can read everything here; any change needs at least the manager role.
  const manager = requireRole('manager');
  r.use((req, res, next) => (keyAllowed(req) ? next() : requireUser(req, res, (err) => (err || req.method === 'GET' ? next(err) : manager(req, res, next)))));
  const record = (req, action, target, detail) => audit.record(req.actor, action, target, detail);
  const offsetOf = (q) => Math.max(-120, Math.min(120, Number.parseInt(q.offset ?? '0', 10) || 0));

  r.get('/meta', async (req, res) => res.json(await team.meta()));

  // Live updates for open browser tabs: teammate status changes and new/approved timesheet entries.
  r.get('/events', async (req, res) => {
    const onEvent = ({ type, data }) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    let unsubscribe;
    try {
      unsubscribe = await events.subscribe(onEvent);
    } catch (err) {
      log.warn?.(`[events] ${err.message}`);
      throw new HttpError(503, 'too_many_streams', 'Too many open live-update connections. Try again shortly.');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    const close = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };
    if (res.destroyed || req.socket.destroyed) return close();
    res.on('close', close);
  });

  // Teammates
  r.get('/teammates', async (req, res) => res.json(await team.roster()));
  r.post('/teammates', async (req, res) => {
    const t = await team.hire(req.body ?? {});
    await record(req, 'teammate.hire', t.id, { name: t.name, model: t.model, rate: t.rate });
    res.status(201).json(t);
  });
  r.get('/teammates/:id', async (req, res) => res.json(await team.profile(req.params.id)));
  r.patch('/teammates/:id', async (req, res) => {
    const t = await team.update(req.params.id, req.body ?? {});
    const fields = Object.keys(req.body ?? {});
    const summary = Object.fromEntries(fields.filter((f) => !['instructions', 'about', 'avatar'].includes(f)).map((f) => [f, req.body[f]]));
    await record(req, fields.length === 1 && fields[0] === 'instructions' ? 'teammate.persona_edit' : 'teammate.update', t.id, { fields, ...summary });
    res.json(t);
  });

  r.post('/teammates/:id/retire', async (req, res) => {
    const t = await team.retire(req.params.id);
    await record(req, 'teammate.retire', t.id);
    res.json(t);
  });
  r.post('/teammates/:id/reinstate', async (req, res) => {
    const t = await team.reinstate(req.params.id);
    await record(req, 'teammate.reinstate', t.id);
    res.json(t);
  });
  r.post('/teammates/:id/persona/reset', async (req, res) => {
    const t = await team.resetPersona(req.params.id);
    await record(req, 'teammate.persona_reset', t.id);
    res.json(t);
  });

  r.post('/teammates/:id/skills', async (req, res) => {
    const t = await team.addSkill(req.params.id, req.body ?? {});
    await record(req, 'teammate.skill_add', t.id, { skill: req.body?.skillId ?? req.body?.name, level: req.body?.level });
    res.json(t);
  });
  r.patch('/teammates/:id/skills/:skillId', async (req, res) => {
    const t = await team.setSkillLevel(req.params.id, req.params.skillId, req.body?.level);
    await record(req, 'teammate.skill_level', t.id, { skill: req.params.skillId, level: req.body?.level });
    res.json(t);
  });
  r.delete('/teammates/:id/skills/:skillId', async (req, res) => {
    const t = await team.removeSkill(req.params.id, req.params.skillId);
    await record(req, 'teammate.skill_remove', t.id, { skill: req.params.skillId });
    res.json(t);
  });

  r.get('/teammates/:id/memory', async (req, res) => res.json({ items: await team.memory(req.params.id) }));
  r.delete('/teammates/:id/memory', async (req, res) => {
    await team.resetMemory(req.params.id);
    await record(req, 'memory.reset', req.params.id);
    res.status(204).end();
  });
  r.delete('/teammates/:id/memory/:memoryId', async (req, res) => {
    await team.deleteMemory(req.params.id, req.params.memoryId);
    await record(req, 'memory.delete', req.params.id, { memory: req.params.memoryId });
    res.status(204).end();
  });
  r.patch('/teammates/:id/memory/:memoryId', async (req, res) => {
    const item = await team.pinMemory(req.params.id, req.params.memoryId, req.body?.pinned);
    await record(req, item.pinned ? 'memory.pin' : 'memory.unpin', req.params.id, { memory: item.id });
    res.json(item);
  });

  // Shared team memory (teammates in "team" memory mode read and add to it)
  r.get('/team-memory', async (req, res) => res.json(await team.teamMemory()));
  r.patch('/team-memory/:memoryId', async (req, res) => {
    const item = await team.pinTeamMemory(req.params.memoryId, req.body?.pinned);
    await record(req, item.pinned ? 'memory.pin' : 'memory.unpin', 'team-memory', { memory: item.id });
    res.json(item);
  });
  r.delete('/team-memory/:memoryId', async (req, res) => {
    await team.deleteTeamMemory(req.params.memoryId);
    await record(req, 'memory.delete', 'team-memory', { memory: req.params.memoryId });
    res.status(204).end();
  });

  // Knowledge documents
  r.get('/teammates/:id/knowledge', async (req, res) => res.json({ docs: await team.knowledge(req.params.id) }));
  r.post('/teammates/:id/knowledge', async (req, res) => {
    const doc = await team.addKnowledge(req.params.id, req.body ?? {});
    await record(req, 'knowledge.create', req.params.id, { doc: doc.id, title: doc.title, project: doc.project, chars: doc.chars });
    res.status(201).json(doc);
  });
  r.get('/teammates/:id/knowledge/:docId', async (req, res) => res.json(await team.knowledgeDoc(req.params.id, req.params.docId)));
  r.patch('/teammates/:id/knowledge/:docId', async (req, res) => {
    const doc = await team.updateKnowledge(req.params.id, req.params.docId, req.body ?? {});
    await record(req, 'knowledge.update', req.params.id, { doc: doc.id, fields: Object.keys(req.body ?? {}) });
    res.json(doc);
  });
  r.delete('/teammates/:id/knowledge/:docId', async (req, res) => {
    const doc = await team.removeKnowledge(req.params.id, req.params.docId);
    await record(req, 'knowledge.delete', req.params.id, { doc: doc.id, title: doc.title });
    res.status(204).end();
  });

  r.post('/teammates/:id/timesheet/:entryId/approve', async (req, res) => {
    const entry = await team.approve(req.params.id, req.params.entryId);
    await record(req, 'timesheet.approve', req.params.id, { entry: entry.id, amount: entry.amount });
    res.json(entry);
  });

  r.get('/teammates/:id/work/:workId', async (req, res) => {
    await team.teammateOr404(req.params.id);
    if (!/^wk_[\w]+$/.test(req.params.workId)) throw badRequest('Invalid work id');
    const work = await repos.work.get(req.params.id, req.params.workId);
    if (!work) throw new HttpError(404, 'not_found', 'Work item not found');
    res.json(work);
  });

  // The teammate endpoint: call a teammate with a task. JSON by default, Server-Sent Events when asked.
  r.post('/teammates/:id/tasks', requireUserOrKey({ auth, limiter }), async (req, res) => {
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
  });

  // Where a task stands: for callers that got 202 (waiting for approval). Keys only see the tasks they asked for.
  r.get('/teammates/:id/tasks/:workId', requireUserOrKey({ auth, limiter }), async (req, res) => {
    const status = await invocation.taskStatus(req.params.id, req.params.workId);
    if (req.actor.type === 'key' && status.caller?.id !== req.actor.id) throw new HttpError(404, 'not_found', 'Task not found');
    res.json(status);
  });

  // Work timeline: tasks, handoffs and outcomes over time
  r.get('/timeline', async (req, res) => res.json(await team.timeline({ teammate: req.query.teammate || null, days: req.query.days })));

  // Scheduled tasks
  r.get('/schedules', async (req, res) => res.json({ schedules: await scheduler.list({ teammateId: req.query.teammate || undefined }) }));
  r.post('/schedules', async (req, res) => {
    const s = await scheduler.create(req.body ?? {}, req.actor);
    await record(req, 'schedule.create', s.teammateId, { schedule: s.id, name: s.name, cadence: s.cadenceLabel });
    res.status(201).json(s);
  });
  r.patch('/schedules/:id', async (req, res) => {
    const s = await scheduler.update(req.params.id, req.body ?? {});
    await record(req, 'schedule.update', s.teammateId, { schedule: s.id, fields: Object.keys(req.body ?? {}) });
    res.json(s);
  });
  r.delete('/schedules/:id', async (req, res) => {
    const s = await scheduler.remove(req.params.id);
    await record(req, 'schedule.delete', s.teammateId, { schedule: s.id, name: s.name });
    res.status(204).end();
  });
  r.post('/schedules/:id/run', async (req, res) => {
    const s = await scheduler.runNow(req.params.id);
    await record(req, 'schedule.run', s.teammateId, { schedule: s.id });
    res.status(202).json(s);
  });

  // Tools teammates can be allowed, and the MCP servers behind some of them (owner only)
  const owner = requireRole('owner');
  r.get('/tools', async (req, res) => res.json({ tools: await tools.catalogue() }));
  r.get('/mcp-servers', owner, async (req, res) => res.json({ servers: await tools.listServers() }));
  r.post('/mcp-servers', owner, async (req, res) => {
    const server = await tools.addServer(req.body ?? {});
    await record(req, 'mcp.create', server.id, { name: server.name, url: server.url });
    res.status(201).json(server);
  });
  r.patch('/mcp-servers/:id', owner, async (req, res) => {
    const server = await tools.editServer(req.params.id, req.body ?? {});
    await record(req, 'mcp.update', server.id, { fields: Object.keys(req.body ?? {}).filter((k) => k !== 'authorization') });
    res.json(server);
  });
  r.delete('/mcp-servers/:id', owner, async (req, res) => {
    await tools.removeServer(req.params.id);
    await record(req, 'mcp.delete', req.params.id);
    res.status(204).end();
  });
  r.post('/mcp-servers/:id/check', owner, async (req, res) => res.json(await tools.checkServer(req.params.id)));

  // Billing
  r.get('/billing', async (req, res) => res.json(await team.billing(req.query.period ?? 'month', offsetOf(req.query))));
  r.get('/billing/export.csv', async (req, res) => {
    const { filename, csv } = await team.exportCsv(req.query.period ?? 'month', offsetOf(req.query));
    res.set('Content-Type', 'text/csv; charset=utf-8').attachment(filename).send(csv);
  });

  // Skill library + hire drafts
  r.post('/skills', async (req, res) => {
    const skill = await team.createSkill(req.body ?? {});
    await record(req, 'skill.create', skill.id);
    res.status(201).json(skill);
  });
  r.get('/skills/:id', async (req, res) => res.json(await team.skill(req.params.id)));
  r.patch('/skills/:id', async (req, res) => {
    const skill = await team.updateSkill(req.params.id, req.body ?? {});
    await record(req, 'skill.update', skill.id, { fields: Object.keys(req.body ?? {}) });
    res.json(skill);
  });
  r.post('/drafts', async (req, res) => res.status(201).json(await repos.drafts.save(req.body ?? {})));
  r.get('/drafts/:id', async (req, res) => {
    const draft = await repos.drafts.get(req.params.id);
    if (!draft) throw new HttpError(404, 'not_found', 'Draft not found');
    res.json(draft);
  });

  // Avatar uploads arrive as data URLs; only PNG, JPEG and WebP are accepted (no SVG).
  r.post('/uploads', async (req, res) => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.dataUrl ?? '');
    if (!match) throw badRequest('Upload a PNG, JPEG or WebP image');
    const type = IMAGE_TYPES[match[1]];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('Images must be 1 MB or smaller');
    if (!type.magic.every((b, i) => buffer[i] === b)) throw badRequest('That file is not a valid image');
    const name = `${newId('img')}.${type.ext}`;
    await store.writeBuffer(['uploads', name], buffer);
    log.info?.(`[upload] ${name} (${buffer.length} bytes)`);
    res.status(201).json({ url: `/uploads/${name}` });
  });

  r.use((req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such API route' } }));
  return r;
}
