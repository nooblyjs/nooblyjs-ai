// /api/v1: teammates, their memory, knowledge, skills, tasks and schedules, the timeline, tools, uploads and live
// events. The handlers are in controllers/; this file says who may call what.
import { requireRole, requireUser, requireUserOrKey } from '../middleware/auth.js';
import { teammatesController } from '../controllers/teammates.js';
import { memoryController } from '../controllers/memory.js';
import { knowledgeController } from '../controllers/knowledge.js';
import { tasksController } from '../controllers/tasks.js';
import { schedulesController } from '../controllers/schedules.js';
import { toolsController } from '../controllers/tools.js';
import { skillsController } from '../controllers/skills.js';
import { uploadsController } from '../controllers/uploads.js';
import { approvalsController } from '../controllers/approvals.js';

const TASKS_ROUTE = /^\/teammates\/[^/]+\/tasks\/?$/;
const TASK_STATUS_ROUTE = /^\/teammates\/[^/]+\/tasks\/wk_[\w]+\/?$/;

export function apiRouter({ express, team, invocation, repos, store, events, auth, audit, limiter, tools, scheduler, log = console }) {
  const r = express.Router();
  // Everything needs a signed-in person, except calling a teammate (and checking on that task), which also accept an API key.
  const keyAllowed = (req) => (req.method === 'POST' && TASKS_ROUTE.test(req.path)) || (req.method === 'GET' && TASK_STATUS_ROUTE.test(req.path));
  // Viewers can read everything here; any change needs at least the manager role.
  const manager = requireRole('manager');
  r.use((req, res, next) => (keyAllowed(req) ? next() : requireUser(req, res, (err) => (err || req.method === 'GET' ? next(err) : manager(req, res, next)))));
  const owner = requireRole('owner');
  const userOrKey = requireUserOrKey({ auth, limiter });

  const teammates = teammatesController({ team, repos, audit });
  const memory = memoryController({ team, audit });
  const knowledge = knowledgeController({ team, audit });
  const tasks = tasksController({ invocation });
  const schedules = schedulesController({ scheduler, audit });
  const toolbox = toolsController({ tools, audit });
  const skills = skillsController({ team, repos, audit });
  const uploads = uploadsController({ store, log });
  const approvals = approvalsController({ invocation, team, audit });

  r.get('/meta', teammates.meta);

  // Teammates
  r.get('/teammates', teammates.roster);
  r.post('/teammates', requireRole('hire'), teammates.hire);
  r.get('/teammates/:id', teammates.profile);
  r.patch('/teammates/:id', teammates.update);
  r.post('/teammates/:id/retire', teammates.retire);
  r.post('/teammates/:id/reinstate', teammates.reinstate);
  r.post('/teammates/:id/persona/reset', teammates.resetPersona);
  r.post('/teammates/:id/skills', teammates.addSkill);
  r.patch('/teammates/:id/skills/:skillId', teammates.setSkillLevel);
  r.delete('/teammates/:id/skills/:skillId', teammates.removeSkill);
  r.get('/teammates/:id/work/:workId', teammates.workItem);
  r.post('/teammates/:id/timesheet/:entryId/approve', approvals.approveTimesheetEntry);

  // Memory, personal and shared
  r.get('/teammates/:id/memory', memory.list);
  r.delete('/teammates/:id/memory', memory.reset);
  r.delete('/teammates/:id/memory/:memoryId', memory.remove);
  r.patch('/teammates/:id/memory/:memoryId', memory.pin);
  r.get('/team-memory', memory.teamMemory);
  r.patch('/team-memory/:memoryId', memory.pinTeamMemory);
  r.delete('/team-memory/:memoryId', memory.removeTeamMemory);

  // Knowledge documents
  r.get('/teammates/:id/knowledge', knowledge.list);
  r.post('/teammates/:id/knowledge', knowledge.create);
  r.get('/teammates/:id/knowledge/:docId', knowledge.show);
  r.patch('/teammates/:id/knowledge/:docId', knowledge.update);
  r.delete('/teammates/:id/knowledge/:docId', knowledge.remove);

  // The teammate endpoint (people or API keys)
  r.post('/teammates/:id/tasks', userOrKey, tasks.assign);
  r.get('/teammates/:id/tasks/:workId', userOrKey, tasks.status);

  r.get('/timeline', teammates.timeline);

  // Scheduled tasks
  r.get('/schedules', schedules.list);
  r.post('/schedules', schedules.create);
  r.patch('/schedules/:id', schedules.update);
  r.delete('/schedules/:id', schedules.remove);
  r.post('/schedules/:id/run', schedules.runNow);

  // Tools teammates can be allowed, and the MCP servers behind some of them (owner only)
  r.get('/tools', toolbox.catalogue);
  r.get('/mcp-servers', owner, toolbox.listServers);
  r.post('/mcp-servers', owner, toolbox.addServer);
  r.patch('/mcp-servers/:id', owner, toolbox.editServer);
  r.delete('/mcp-servers/:id', owner, toolbox.removeServer);
  r.post('/mcp-servers/:id/check', owner, toolbox.checkServer);

  // Skill library and hire drafts
  r.post('/skills', skills.create);
  r.get('/skills/:id', skills.show);
  r.patch('/skills/:id', skills.update);
  r.post('/drafts', skills.saveDraft);
  r.get('/drafts/:id', skills.draft);

  r.post('/uploads', uploads.upload);

  return r;
}
