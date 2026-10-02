// Phase 04: what a tool is.
//
// The model can't touch your computer. It can only ASK us to run a tool by
// replying with a `tool_use` block. For the model to ask well, each tool
// describes itself: a name, a description written FOR THE MODEL, and a JSON
// Schema saying what input it takes. We run the tool and send back the result.

/**
 * @typedef {Object} ToolContext
 * @property {string} cwd              the project directory
 * @property {AbortSignal} [signal]    fires if the user interrupts
 * @property {object} session          the Session (e.g. session.readFiles)
 *
 * @typedef {Object} ToolOutput
 * @property {string} content          what the MODEL sees
 * @property {string} [display]        a short summary for the USER, e.g. "18 lines"
 * @property {string[]} [preview]      a few lines to show the user, e.g. the first lines of output, or "- old" / "+ new" for an edit
 *
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} description      tells the model what the tool does and when to use it
 * @property {object} inputSchema      JSON Schema for the input
 * @property {boolean} isReadOnly      true if it never changes anything (matters for permissions, Phase 06)
 * @property {(input: object, ctx: ToolContext) => Promise<ToolOutput>} call
 * @property {(input: object, ctx: ToolContext) => string} [summarize]  label for the UI, e.g. "package.json"
 */

/**
 * An expected failure, like "file not found". The message is sent to the model
 * as the tool result, so write it for the model: say what went wrong and what to do instead.
 */
export class ToolError extends Error {
  /** @param {string} message for the model  @param {{ display?: string }} [options] a shorter text for the user */
  constructor(message, { display } = {}) {
    super(message);
    this.name = 'ToolError';
    this.display = display;
  }
}

/** Check a tool object has everything it needs, and fill in defaults. */
export function defineTool(tool) {
  for (const field of ['name', 'description', 'inputSchema', 'call']) {
    if (!tool[field]) throw new Error(`Tool is missing "${field}"`);
  }
  return { isReadOnly: false, ...tool };
}

const typeChecks = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

/**
 * A very small JSON Schema checker: `required`, property `type`, `enum`, and
 * `additionalProperties: false`. Enough for our tools. Returns an error message, or null if valid.
 */
export function validateInput(schema, input) {
  if (!typeChecks.object(input)) return 'Input must be a JSON object.';

  for (const key of schema.required ?? []) {
    if (input[key] === undefined) return `Missing required field "${key}".`;
  }

  for (const [key, value] of Object.entries(input)) {
    const rule = schema.properties?.[key];
    if (!rule) {
      if (schema.additionalProperties === false) return `Unknown field "${key}".`;
      continue;
    }
    // Only check types we know; MCP servers (Phase 14) may send richer schemas, e.g. "type": ["string", "null"].
    if (typeChecks[rule.type] && !typeChecks[rule.type](value)) return `Field "${key}" must be of type ${rule.type}.`;
    if (rule.enum && !rule.enum.includes(value)) return `Field "${key}" must be one of: ${rule.enum.join(', ')}.`;
  }
  return null;
}
