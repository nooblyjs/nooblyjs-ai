// The tools noobly ships with.
import { applyPatchTool } from './apply-patch.js';
import { taskOutputTool, taskStopTool } from './background.js';
import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { multiEditTool } from './multi-edit.js';
import { repoMapTool } from './repo-map.js';
import { grepTool } from './grep.js';
import { exitPlanModeTool } from './plan.js';
import { readTool } from './read.js';
import { ToolRegistry } from './registry.js';
import { skillTool } from './skill.js';
import { taskTool } from './task.js';
import { todoWriteTool } from './todo.js';
import { webFetchTool } from './web-fetch.js';
import { writeTool } from './write.js';

/**
 * Phase 25: `editTools` picks HOW the model edits files:
 *   "edit"  Edit + MultiEdit (exact text replacement): Claude and most models
 *   "patch" ApplyPatch (the format OpenAI's models are trained on)
 * Write is in both. Chosen once per conversation: changing tools mid-conversation breaks prompt caching (Phase 09).
 */
export function createDefaultTools({ editTools = 'edit' } = {}) {
  const editing = editTools === 'patch' ? [applyPatchTool] : [editTool, multiEditTool];
  return new ToolRegistry([readTool, globTool, grepTool, ...editing, writeTool, bashTool, todoWriteTool, exitPlanModeTool, taskTool, skillTool, webFetchTool, taskOutputTool, taskStopTool, repoMapTool]);
}

/** "auto": ApplyPatch for OpenAI's own API, Edit for everything else. */
export function editToolsFor(setting, providerId) {
  if (setting === 'edit' || setting === 'patch') return setting;
  return providerId === 'openai' ? 'patch' : 'edit';
}
