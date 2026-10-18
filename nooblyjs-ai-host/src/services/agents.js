// The one place NooblyJS reads agent teammates from (product.md §5.5). Digital Teammates (nooblyjs-ai-teammate) is the
// source: who they are, whether they can take work, and the task every agent action runs as. When it is switched
// off NooblyJS still starts: agents are then the ids listed on the teams (data/teams/*.md), and none of them can work.
import { HttpError } from '../util/errors.js';
import { agentName } from './teams.js';

const NOT_RUNNING = { ok: false, code: 'teammates_unavailable', message: 'Digital Teammates is not running here, so no agent can answer.' };

export function createAgents({ services, teams }) {
  const service = () => {
    const s = services.get('teammates');
    return typeof s?.runTask === 'function' ? s : null;
  };

  /** The agents on the NooblyJS teams, by id, for when Teammates isn't there to describe them. */
  async function listed() {
    const ids = [...new Set((await teams.list()).flatMap((t) => t.agents.map((a) => a.id)))];
    return ids.map((id) => ({ id, name: agentName(id), role: null, status: null, statusText: null, canWork: false, model: null, rate: null, avatar: null }));
  }

  /** Every agent teammate: name, role, status, model and rate. */
  async function roster() {
    const s = service();
    if (!s) return listed();
    try {
      return await s.roster();
    } catch {
      return listed();
    }
  }

  return {
    /** Whether Digital Teammates is running in this NooblyJS. */
    running: () => Boolean(service()),
    /** 'mock' when no model is configured (answers are scripted), else the provider's name; null when not running. */
    provider: () => service()?.provider?.() ?? null,
    roster,
    get: async (id) => (await roster()).find((a) => a.id === id) ?? null,
    /** { ok: true }, or { ok: false, code, message } with a reason a person can read. */
    async availability(id) {
      const s = service();
      return s ? s.availability(id) : NOT_RUNNING;
    },
    /**
     * The NooblyJS team that pays for an agent's work: the one named (an item's team, a meeting's), else the first
     * team the agent is on. Null bills the teammate's own cost centre.
     */
    async teamFor(agentId, teamId = null) {
      const all = await teams.list();
      const team = all.find((t) => t.id === teamId) ?? all.find((t) => t.agents.some((a) => a.id === agentId));
      return team ? { teamId: team.id, teamName: team.name } : null;
    },
    /** Runs one task as a teammate (nooblyjs-ai-teammate' runTask). Throws the teammate's refusal as it is. */
    async runTask(request) {
      const s = service();
      if (!s) throw new HttpError(503, NOT_RUNNING.code, NOT_RUNNING.message);
      return s.runTask(request);
    },
  };
}
