// Phase 27: RepoMap. The most relevant files and what they define, within a token budget.
import { buildRepoMap } from '../context/repo-map.js';
import { defineTool } from './tool.js';

export const repoMapTool = defineTool({
  name: 'RepoMap',
  isReadOnly: true,
  description: [
    'Get a compact map of the codebase: the most important source files and the functions, classes and types each defines (one line each, no bodies).',
    'Files are ranked by how much the rest of the code uses them; `focus` (file paths, symbol names or words from the task) ranks related files first.',
    'Use it to get your bearings in an unfamiliar or large repository before searching; then Read the files you need.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      focus: { type: 'array', items: { type: 'string' }, description: 'Files, symbols or words to rank first, e.g. ["src/parser.js", "parseArgs"]' },
      max_tokens: { type: 'integer', description: 'Size of the map (default 2000, max 8000)' },
    },
    additionalProperties: false,
  },
  summarize: ({ focus }) => (focus?.length ? `focus: ${focus.slice(0, 3).join(', ')}` : 'whole repo'),

  async call({ focus = [], max_tokens = 2_000 }, ctx) {
    const map = await buildRepoMap(ctx.cwd, { focus, maxTokens: Math.min(Math.max(max_tokens, 200), 8_000) });
    if (!map.files) return { content: 'No source files found (the map covers JavaScript/TypeScript, Python, Go and Rust).', display: 'no source files' };
    return {
      content: `${map.text}\n\n(${map.shown} of ${map.files} source files shown, most relevant first.)`,
      display: `${map.shown} of ${map.files} files`,
    };
  },
});
