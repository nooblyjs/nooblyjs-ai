// Phase 15: the Skill tool. Loads a skill's full instructions when the model needs them.
// (See skills/loader.js for why skills arrive in stages.)
import { readSkill } from '../skills/loader.js';
import { defineTool, ToolError } from './tool.js';

export const skillTool = defineTool({
  name: 'Skill',
  isReadOnly: true,
  description: [
    'Load a skill: detailed instructions (and helper files) for a particular kind of task.',
    'The available skills are listed in the system prompt under "Skills", each with a description saying when to use it. When the user\'s request matches one, call this FIRST, before starting the work, then follow the instructions it returns.',
    'If no skills are listed, don\'t use this tool.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'The skill name, e.g. "release-notes"' },
      args: { type: 'string', description: 'Optional details for the skill, e.g. what the user asked for' },
    },
    required: ['skill'],
    additionalProperties: false,
  },

  summarize: ({ skill }) => skill,

  async call({ skill: name, args }, ctx) {
    const skills = ctx.session.skills ?? [];
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      throw new ToolError(
        skills.length ? `There is no skill called "${name}". Available skills: ${skills.map((s) => s.name).join(', ')}.` : 'No skills are installed.',
      );
    }
    let loaded;
    try {
      loaded = readSkill(skill);
    } catch (error) {
      throw new ToolError(`The skill "${name}" could not be read: ${error.message}`);
    }
    return { content: formatSkill(skill, loaded, args), display: `loaded ${loaded.body.split('\n').length} lines${loaded.files.length ? ` · ${loaded.files.length} file(s)` : ''}` };
  },
});

/** What the model receives: the instructions, where the skill lives, and its files. */
export function formatSkill(skill, { body, files }, args) {
  return [
    `<skill name="${skill.name}" folder="${skill.dir}">`,
    body.replaceAll('$ARGUMENTS', args ?? ''),
    '</skill>',
    files.length
      ? `Supporting files in the skill folder (Read them with their full path, e.g. ${skill.dir}/${files[0]}, only when the instructions need them):\n${files.map((f) => `- ${f}`).join('\n')}`
      : '',
    args && !body.includes('$ARGUMENTS') ? `Details for this use: ${args}` : '',
    'Follow these instructions for the current task.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
