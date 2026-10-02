// The list of tools the model is allowed to use.

export class ToolRegistry {
  /** @param {import('./tool.js').Tool[]} tools */
  constructor(tools = []) {
    this.tools = new Map();
    for (const tool of tools) this.register(tool);
  }

  register(tool) {
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  list() {
    return [...this.tools.values()];
  }

  /** The `tools` field of an API request: just name, description and input schema. */
  toApiSchemas() {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }
}
