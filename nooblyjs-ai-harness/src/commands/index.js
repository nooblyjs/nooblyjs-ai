// Slash commands: input starting with "/" is handled by the harness itself
// and is never sent to the model.
//
//   built-in commands  src/commands/builtin.js  (/help, /clear, /compact, /resume…)
//   custom commands    .noobly/commands/*.md    (Phase 10, see custom.js)
//   skills             /<skill-name> loads that skill straight away (Phase 15)
//
// A command returns what the UI should do next:
//   { action: 'print', text }          show some text
//   { action: 'clear', text }          a new conversation started
//   { action: 'exit' }                 quit
//   { action: 'prompt', prompt, allow } send `prompt` to the model as if typed (/init, custom commands)
//   { action: 'resumed', text, last }  an old conversation was loaded
//   { action: 'rewound', text, prompt } Phase 21: gone back; `prompt` goes back into the input box
import { BUILTIN } from './builtin.js';
import { readSkill } from '../skills/loader.js';
import { formatSkill } from '../tools/skill.js';
import { expandArguments, loadCustomCommands } from './custom.js';

export function isCommand(input) {
  return input.trim().startsWith('/');
}

/** @returns {Promise<{ action: string, text?: string, prompt?: string, allow?: string[] }>} */
export async function runCommand(input, session) {
  const trimmed = input.trim();
  const [name, ...words] = trimmed.split(/\s+/);
  const argsText = trimmed.slice(name.length).trim();
  try {
    const builtin = BUILTIN[name.slice(1)] ?? Object.values(BUILTIN).find((c) => c.aliases?.includes(name.slice(1)));
    if (builtin) return await builtin.run(session, words, argsText);

    const custom = loadCustomCommands(session.cwd).get(name.slice(1));
    if (custom) {
      return {
        action: 'prompt',
        text: `Running /${custom.name} (${custom.scope} command)…`,
        prompt: expandArguments(custom.body, argsText),
        allow: custom.allowedTools,
      };
    }
    // Phase 15: /<skill-name> — you choose the skill, so its instructions go straight to the model.
    const skill = session.skills?.find((s) => s.name === name.slice(1));
    if (skill) {
      return {
        action: 'prompt',
        text: `Using the ${skill.name} skill…`,
        prompt: `${formatSkill(skill, readSkill(skill), argsText)}${argsText ? '' : '\n\n(The user started this skill without further details.)'}`,
      };
    }
    return { action: 'print', text: `Unknown command ${name}. Type /help to see the list.` };
  } catch (error) {
    return { action: 'print', text: `✗ ${error.message}` };
  }
}

export { BUILTIN, INIT_PROMPT } from './builtin.js';
