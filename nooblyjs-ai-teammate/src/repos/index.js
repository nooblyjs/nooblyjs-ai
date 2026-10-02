import { ConfigRepo } from './config.js';
import { SkillsRepo } from './skills.js';
import { TeammatesRepo } from './teammates.js';
import { MemoryRepo } from './memory.js';
import { TimesheetsRepo } from './timesheets.js';
import { WorkRepo } from './work.js';
import { InvoicesRepo } from './invoices.js';
import { DraftsRepo } from './drafts.js';
import { KnowledgeRepo } from './knowledge.js';
import { ThreadsRepo } from './threads.js';
import { ApprovalsRepo } from './approvals.js';
import { SchedulesRepo } from './schedules.js';

export function createRepos(store) {
  return {
    config: new ConfigRepo(store),
    skills: new SkillsRepo(store),
    teammates: new TeammatesRepo(store),
    memory: new MemoryRepo(store),
    timesheets: new TimesheetsRepo(store),
    work: new WorkRepo(store),
    invoices: new InvoicesRepo(store),
    drafts: new DraftsRepo(store),
    knowledge: new KnowledgeRepo(store),
    threads: new ThreadsRepo(store),
    approvals: new ApprovalsRepo(store),
    schedules: new SchedulesRepo(store),
  };
}
