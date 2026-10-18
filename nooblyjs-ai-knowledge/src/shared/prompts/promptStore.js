/**
 * @fileoverview Prompt Store — the single source of truth for reusable AI prompts.
 *
 * Prompts are authored and edited in the datasources app (AI → Prompts) and read
 * back by application code and workflow steps by KEY:
 *
 *     const { prompts } = require('.../shared/prompts/promptStore');
 *     const system = prompts.get('document-processing-pdf');
 *     const answer = await expert.prompt(system, userContent);
 *
 * Design constraints that shaped this module:
 *
 *  - **Worker-thread safe.** Workflow steps run in isolated worker threads where
 *    `global.*` from the backend bootstrap does NOT exist (see
 *    `workflow-step-execution-model`). So this module has zero app dependencies
 *    and resolves everything off the file system, exactly like the workflows
 *    repo's `folderExpert` does for `settings-agents.json`.
 *  - **Reads are synchronous** so step code can call `prompts.get(key)` inline
 *    without threading async through a call chain. The file is small and cached
 *    by mtime, so a repeat `get()` costs one `statSync`.
 *  - **Edits take effect immediately.** The cache is invalidated by mtime, so a
 *    prompt saved in the UI is picked up by the next `get()` — no restart.
 *
 * Storage: `<appBaseDir>/configuration/prompts/prompts.json`
 *   { "version": 1, "prompts": [ { id, key, name, ..., content } ] }
 *
 * A missing file is seeded with DEFAULT_PROMPTS on first read so a fresh install
 * has something to run and edit.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Schema version written into the store file. */
const STORE_VERSION = 1;

/** Prompt lifecycle labels. `status` is metadata — `get()` returns drafts too. */
const STATUSES = ['draft', 'published'];

/**
 * Built-in prompts. Written when no store file exists yet, and backfilled into an
 * existing store by `ensureDefaults()` so a release can add a key that code
 * relies on. They double as worked examples of the `{{variable}}` syntax.
 *
 * Most of these are LOAD-BEARING: the workflow steps in the sibling
 * `noobly-app-wiki-workflows` repo read them by key, and `get()`
 * throws on a missing key. Edit them freely in the UI — but deleting one is
 * undone at the next boot, because the code that reads it would otherwise fail.
 *
 * @type {Array<Object>}
 */
const DEFAULT_PROMPTS = [
  {
    key: 'document-processing-pdf',
    name: 'PDF document processing',
    description: 'Turns raw text extracted from a PDF into clean, structured markdown.',
    category: 'Document Processing',
    tags: ['pdf', 'markdown'],
    status: 'published',
    content: [
      'You are a document conversion assistant.',
      '',
      'You receive the raw text extracted from a PDF. Rewrite it as clean markdown:',
      '- Preserve the document\'s heading hierarchy.',
      '- Rebuild tables as markdown tables where the layout makes that possible.',
      '- Drop page furniture: page numbers, running headers and footers, watermarks.',
      '- Never invent content that is not present in the source.',
      '',
      'Return only the markdown — no preamble, no commentary.'
    ].join('\n')
  },
  {
    key: 'document-summary',
    name: 'Document summary',
    description: 'Compact retrieval summary of a single document. Uses {{maxChars}}. '
      + 'Read by the build-context workflow for each file sidecar.',
    category: 'Document Processing',
    tags: ['summary', 'context', 'workflow'],
    status: 'published',
    content: [
      'You are a helpful assistant. Summarise the document into compact context for retrieval.',
      'Output a plain-text summary of at most {{maxChars}} characters.',
      'No markdown, no preamble, no quotes, no line breaks.'
    ].join('\n')
  },
  {
    key: 'folder-context-overview',
    name: 'Folder context overview',
    description: 'Folder-level roll-up synthesised from its file and subfolder summaries. '
      + 'Uses {{maxChars}}. Read by the build-context workflow for each `_folder.md`.',
    category: 'Folder Processing',
    tags: ['context', 'folder', 'workflow'],
    status: 'published',
    content: 'You are a documentation indexer creating a folder-level context summary. '
      + 'Write a cohesive overview of at most {{maxChars}} characters describing what this '
      + 'folder covers as a whole, based on the file and subfolder summaries provided. '
      + 'Plain text, no markdown headings, no preamble.'
  },
  {
    key: 'document-cleaning',
    name: 'Document cleaning',
    description: 'Strips cover pages, TOCs, sign-off sections and page furniture from markdown '
      + 'converted out of Word/PDF. Read by the "Design: Process File" workflow.',
    category: 'Document Processing',
    tags: ['cleaning', 'docx', 'pdf', 'workflow'],
    status: 'published',
    content: [
      'You are a document processing expert. Your task is to clean and extract the main content '
        + 'from markdown document sections that were converted from Word documents (DOCX/PDF).',
      'When processing document sections, you should:',
      '1. Remove cover pages and title pages with logos/metadata',
      '2. Remove tables of contents and document outlines',
      '3. Remove document information sections (version, dates, authors, stakeholders)',
      '4. Remove approval/sign-off sections',
      '5. Remove reference documentation and link sections',
      '6. Remove footer and header information',
      'Keep all the actual content and section structure intact. Return only the cleaned markdown.'
    ].join('\n')
  },
  {
    key: 'code-documentation',
    name: 'Code documentation',
    description: 'Persona for documenting a code directory into a knowledge-repository page. '
      + 'Read by the engineering-code (application-design) workflow.',
    category: 'Code Processing',
    tags: ['code', 'documentation', 'workflow'],
    status: 'published',
    content: 'You are an Application Architect and Functional Designer documenting a codebase '
      + 'for an engineering wiki. You write precise, substantial documentation '
      + 'grounded strictly in the code provided — never generic filler. You output raw Markdown only.'
  },
  {
    key: 'code-documentation-renderer-rules',
    name: 'Code documentation renderer rules',
    description: 'Formatting rules appended to every code-documentation request. Encodes the '
      + 'gotchas of the custom wiki markdown parser — change with care.',
    category: 'Code Processing',
    tags: ['code', 'formatting', 'workflow'],
    status: 'published',
    content: [
      'FORMATTING RULES (follow exactly — the output renders in a custom wiki Markdown parser):',
      '- Output raw GitHub-flavoured Markdown. Do NOT wrap the whole response in a code fence.',
      '- Begin with a single H1 line that is EXACTLY the folder name and nothing else: "# <folder name>". '
        + 'Do NOT append a role, persona or descriptor (no "— Application Architect", no "— Functional '
        + 'Designer"). The reader knows what they are looking at; the persona shapes how you write, it is '
        + 'not part of the document.',
      '- Use the section headings you are given VERBATIM and nothing more. A heading is just its name '
        + '(e.g. "## Key Concepts"). Never copy the brief describing what a section should contain into '
        + 'the heading, and never restate the brief as body text — write the section it asked for.',
      '- Write substantial, specific content grounded ONLY in the code provided. No generic filler.',
      '- Mermaid diagrams: open with a line that is exactly ```mermaid and close with a line that is '
        + 'exactly ```. Use "graph TD". Write EVERY diagram line FLUSH-LEFT with no leading spaces. '
        + 'Do NOT use any "---" lines. Keep node labels free of parentheses, commas and colons (use plain words).',
      '- Never begin a line with any of these reserved words, they are parsed as layout blocks: header, '
        + 'footer, summary, container, cards, tabs, menu, comments, accordion, liked, mermaid, swagger, '
        + 'three-column, hero-banner, wiki-link. (## headings, **bold** and "-" bullets are safe.)'
    ].join('\n')
  }
];

/**
 * Turn a name into a stable lookup key, e.g. "PDF document processing" ->
 * "pdf-document-processing". Matches the slug rules used by aiInstances.js so
 * agent and prompt keys read the same way.
 * @param {string} value
 * @returns {string}
 */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve the application base directory the same way the backend bootstrap and
 * the workflow steps do, so all three agree without being wired together.
 * @param {string} [explicit] - Caller-supplied base dir (wins when set).
 * @returns {string} Normalised absolute path.
 */
function resolveAppBaseDir(explicit) {
  const dir = explicit
    || process.env.APP_BASE_DIR
    // shared/prompts -> shared -> src -> backend -> repo root
    || path.resolve(__dirname, '../../..', '.application');
  return path.normalize(path.resolve(dir));
}

/** Substitute `{{name}}` placeholders. Unknown placeholders are left in place. */
function applyVariables(text, variables) {
  if (!variables || typeof variables !== 'object') return text;
  return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(variables, name) && variables[name] != null
      ? String(variables[name])
      : match
  ));
}

/** Extract the distinct `{{variable}}` names referenced by a prompt body. */
function extractVariables(text) {
  const found = new Set();
  const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) found.add(match[1]);
  return Array.from(found);
}

/**
 * File-backed store of reusable prompts.
 */
class PromptStore {

  /**
   * @param {Object} [options]
   * @param {string} [options.appBaseDir] - Application base dir; defaults to
   *   APP_BASE_DIR / the repo's `.application`.
   * @param {boolean} [options.seed=true] - Write DEFAULT_PROMPTS when the store
   *   file does not exist yet.
   */
  constructor(options = {}) {
    this.appBaseDir = resolveAppBaseDir(options.appBaseDir);
    this.seedOnCreate = options.seed !== false;
    this.filePath = path.join(this.appBaseDir, 'configuration', 'prompts', 'prompts.json');
    /** @type {{mtimeMs:number, prompts:Array<Object>}|null} */
    this._cache = null;
    // True when the last read found a file it could not parse. Reads degrade to
    // an empty list; writers use this to refuse to overwrite a file whose
    // contents they could not see.
    this._unreadable = false;
  }

  // ---------------------------------------------------------------- reading

  /**
   * Read the store from disk, reusing the cache while the file is unchanged.
   * Never throws: an unreadable/corrupt file yields an empty list so a bad edit
   * cannot take the application down.
   * @returns {Array<Object>} The prompt records.
   */
  all() {
    let stat = null;
    try {
      stat = fs.statSync(this.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') return this._cache ? this._cache.prompts : [];
      // First run: seed the file so the UI and `get()` both have something.
      if (!this.seedOnCreate) return [];
      try {
        this._writeSync(DEFAULT_PROMPTS.map((p) => this._normalize(p)));
        stat = fs.statSync(this.filePath);
      } catch (writeError) {
        // Read-only deployment: serve the defaults from memory instead.
        return DEFAULT_PROMPTS.map((p) => this._normalize(p));
      }
    }

    if (this._cache && this._cache.mtimeMs === stat.mtimeMs) {
      return this._cache.prompts;
    }

    let prompts = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const list = Array.isArray(parsed) ? parsed : (parsed && parsed.prompts) || [];
      prompts = list.filter(Boolean).map((p) => this._normalize(p));
      this._unreadable = false;
    } catch (error) {
      prompts = [];
      this._unreadable = true;
    }

    this._cache = { mtimeMs: stat.mtimeMs, prompts };
    return prompts;
  }

  /**
   * List prompts with optional filtering.
   * @param {Object} [filter]
   * @param {string} [filter.category] - Exact category match.
   * @param {string} [filter.status] - 'draft' | 'published'.
   * @param {string} [filter.search] - Case-insensitive match on key/name/description.
   * @returns {Array<Object>}
   */
  list(filter = {}) {
    let prompts = this.all();
    if (filter.category && filter.category !== 'All Prompts') {
      prompts = prompts.filter((p) => p.category === filter.category);
    }
    if (filter.status) {
      prompts = prompts.filter((p) => p.status === filter.status);
    }
    if (filter.search) {
      const needle = String(filter.search).toLowerCase();
      prompts = prompts.filter((p) => (
        p.key.toLowerCase().includes(needle)
        || (p.name || '').toLowerCase().includes(needle)
        || (p.description || '').toLowerCase().includes(needle)
      ));
    }
    return prompts;
  }

  /**
   * Find a prompt by key (preferred) or id. Case-insensitive on the key.
   * @param {string} keyOrId
   * @returns {Object|null} The record, or null when not found.
   */
  find(keyOrId) {
    if (!keyOrId) return null;
    const wanted = String(keyOrId).trim();
    const slug = slugify(wanted);
    const prompts = this.all();
    return prompts.find((p) => p.key === slug)
      || prompts.find((p) => p.id === wanted)
      || null;
  }

  /**
   * Get a prompt's text by key — the primary read API.
   *
   * Throws when the key is unknown: a silent '' would be sent to the model as an
   * empty system prompt and the caller would get a plausible-looking but
   * ungrounded answer. Use `getOr()` when a missing prompt is acceptable.
   *
   * @param {string} key - Prompt key, e.g. 'document-processing-pdf'.
   * @param {Object} [variables] - Values for `{{placeholder}}` substitution.
   * @returns {string} The prompt text.
   * @throws {Error} When no prompt with that key exists.
   */
  get(key, variables) {
    const prompt = this.find(key);
    if (!prompt) {
      const known = this.all().map((p) => p.key).join(', ') || 'none';
      throw new Error(`Prompt "${key}" not found in ${this.filePath} (available: ${known})`);
    }
    return applyVariables(prompt.content, variables);
  }

  /**
   * Like get(), but returns `fallback` instead of throwing when the key is unknown.
   * @param {string} key
   * @param {string} fallback
   * @param {Object} [variables]
   * @returns {string}
   */
  getOr(key, fallback, variables) {
    const prompt = this.find(key);
    return prompt ? applyVariables(prompt.content, variables) : applyVariables(fallback, variables);
  }

  /** Alias of get() that reads as intent when variables are involved. */
  render(key, variables) {
    return this.get(key, variables);
  }

  /** Distinct categories currently in use, sorted. */
  categories() {
    return Array.from(new Set(this.all().map((p) => p.category).filter(Boolean))).sort();
  }

  /** Roll-up counts for the library header. */
  stats() {
    const prompts = this.all();
    return {
      totalPrompts: prompts.length,
      published: prompts.filter((p) => p.status === 'published').length,
      drafts: prompts.filter((p) => p.status === 'draft').length,
      totalExecutions: prompts.reduce((sum, p) => sum + (Number(p.executions) || 0), 0)
    };
  }

  // ---------------------------------------------------------------- writing

  /**
   * Materialise the store and backfill any built-in prompt whose key is absent.
   *
   * `all()` only seeds when the file is MISSING, so a store written by an earlier
   * release keeps whatever it had — and a newer release that reads a new key by
   * `get()` would throw. This adds just the missing built-ins, leaving every
   * existing record (including edited built-ins) untouched. Deleting a built-in
   * in the UI is therefore undone at the next boot: the code that reads it by key
   * cannot run without it.
   *
   * Synchronous, so callers can run it inline during bootstrap. Refuses to write
   * over a file it could not parse — a corrupt store is a problem to look at, not
   * to silently replace.
   *
   * @returns {Array<string>} Keys that were added (empty when already complete).
   */
  ensureDefaults() {
    const existing = this.all();
    if (this._unreadable) return [];

    const known = new Set(existing.map((p) => p.key));
    const missing = DEFAULT_PROMPTS.filter((p) => !known.has(slugify(p.key || p.name)));
    if (missing.length === 0) return [];

    try {
      this._writeSync(existing.concat(missing.map((p) => this._normalize(p))));
    } catch (error) {
      // Read-only deployment: callers still get the defaults from memory via all().
      return [];
    }
    return missing.map((p) => slugify(p.key || p.name));
  }

  /**
   * Create a prompt. The key is derived from the name when not supplied and must
   * be unique — it is the identifier callers hard-code in workflow steps.
   * @param {Object} input
   * @returns {Promise<Object>} The created record.
   * @throws {Error} On a missing name/content or a duplicate key.
   */
  async create(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Name is required');
    const content = String(input.content || '');
    if (!content.trim()) throw new Error('Prompt content is required');

    const key = slugify(input.key || name);
    if (!key) throw new Error('Key must contain at least one letter or digit');

    const prompts = this.all().slice();
    if (prompts.some((p) => p.key === key)) {
      throw new Error(`A prompt with the key "${key}" already exists`);
    }

    const now = new Date().toISOString();
    const record = this._normalize({
      ...input,
      id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      key,
      name,
      content,
      version: 1,
      executions: 0,
      createdAt: now,
      updatedAt: now
    });

    prompts.push(record);
    await this._write(prompts);
    return record;
  }

  /**
   * Update a prompt in place. Only supplied fields change; `id`, `createdAt` and
   * the execution counter are preserved. Editing the body bumps `version`.
   * @param {string} id - Prompt id or key.
   * @param {Object} patch
   * @returns {Promise<Object>} The updated record.
   * @throws {Error} When the prompt does not exist or the new key collides.
   */
  async update(id, patch = {}) {
    const prompts = this.all().slice();
    const index = prompts.findIndex((p) => p.id === id || p.key === slugify(id));
    if (index === -1) throw new Error('Prompt not found');

    const current = prompts[index];
    const key = patch.key !== undefined ? slugify(patch.key) : current.key;
    if (!key) throw new Error('Key must contain at least one letter or digit');
    if (key !== current.key && prompts.some((p, i) => i !== index && p.key === key)) {
      throw new Error(`A prompt with the key "${key}" already exists`);
    }

    const content = patch.content !== undefined ? String(patch.content) : current.content;
    if (!content.trim()) throw new Error('Prompt content is required');

    const updated = this._normalize({
      ...current,
      ...patch,
      id: current.id,
      key,
      content,
      createdAt: current.createdAt,
      executions: current.executions,
      // A body change is a new revision; metadata-only edits are not.
      version: content === current.content ? current.version : (current.version || 1) + 1,
      updatedAt: new Date().toISOString()
    });

    prompts[index] = updated;
    await this._write(prompts);
    return updated;
  }

  /**
   * Delete a prompt.
   * @param {string} id - Prompt id or key.
   * @returns {Promise<Object>} The deleted record.
   * @throws {Error} When the prompt does not exist.
   */
  async remove(id) {
    const prompts = this.all().slice();
    const index = prompts.findIndex((p) => p.id === id || p.key === slugify(id));
    if (index === -1) throw new Error('Prompt not found');
    const [deleted] = prompts.splice(index, 1);
    await this._write(prompts);
    return deleted;
  }

  /**
   * Record that a prompt was run (test or production use). Best-effort — a
   * failure here must never fail the run that triggered it.
   * @param {string} id - Prompt id or key.
   * @returns {Promise<void>}
   */
  async recordUsage(id) {
    try {
      const prompts = this.all().slice();
      const index = prompts.findIndex((p) => p.id === id || p.key === slugify(id));
      if (index === -1) return;
      prompts[index] = {
        ...prompts[index],
        executions: (Number(prompts[index].executions) || 0) + 1,
        lastUsedAt: new Date().toISOString()
      };
      await this._write(prompts);
    } catch (error) {
      // Usage stats are not worth failing a request over.
    }
  }

  // ---------------------------------------------------------------- internals

  /** Coerce a record to the full shape so consumers never guard on undefined. */
  _normalize(prompt) {
    const content = String(prompt.content != null ? prompt.content : '');
    const key = slugify(prompt.key || prompt.name);
    return {
      id: prompt.id || `prompt-${key}`,
      key,
      name: String(prompt.name || key),
      description: String(prompt.description || ''),
      category: String(prompt.category || 'General'),
      tags: Array.isArray(prompt.tags)
        ? prompt.tags.map((t) => String(t).trim()).filter(Boolean)
        : String(prompt.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      status: STATUSES.includes(prompt.status) ? prompt.status : 'published',
      // Default agent to test/run this prompt against; empty = usage-based pick.
      agent: String(prompt.agent || ''),
      content,
      variables: extractVariables(content),
      version: Number(prompt.version) || 1,
      executions: Number(prompt.executions) || 0,
      createdAt: prompt.createdAt || new Date().toISOString(),
      updatedAt: prompt.updatedAt || prompt.createdAt || new Date().toISOString(),
      lastUsedAt: prompt.lastUsedAt || null
    };
  }

  /** Serialise the store file (shared by the sync seed and the async writes). */
  _serialize(prompts) {
    return JSON.stringify({ version: STORE_VERSION, prompts }, null, 2);
  }

  /** Synchronous write, used only to seed a missing file from all(). */
  _writeSync(prompts) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, this._serialize(prompts), 'utf-8');
    this._cache = null;
  }

  /** Persist and invalidate the cache so the next read sees the new file. */
  async _write(prompts) {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, this._serialize(prompts), 'utf-8');
    this._cache = null;
  }
}

// The default instance every caller shares. Resolved lazily so APP_BASE_DIR set
// after require() (e.g. by a dotenv load) is still honoured.
let defaultStore = null;

/**
 * Point the default store at a specific base directory. Called once by the
 * datasources routes with the server's appBaseDir; workflow steps normally rely
 * on APP_BASE_DIR instead.
 * @param {Object} options - Same shape as the PromptStore constructor.
 * @returns {PromptStore}
 */
function configure(options = {}) {
  defaultStore = new PromptStore(options);
  return defaultStore;
}

/** The shared default store (created on first access). */
function store() {
  if (!defaultStore) defaultStore = new PromptStore();
  return defaultStore;
}

/**
 * Facade bound to the default store — the object application and workflow code
 * uses: `prompts.get('document-processing-pdf')`.
 */
const prompts = {
  get: (key, variables) => store().get(key, variables),
  getOr: (key, fallback, variables) => store().getOr(key, fallback, variables),
  render: (key, variables) => store().render(key, variables),
  find: (keyOrId) => store().find(keyOrId),
  list: (filter) => store().list(filter),
  all: () => store().all(),
  categories: () => store().categories(),
  stats: () => store().stats(),
  ensureDefaults: () => store().ensureDefaults(),
  recordUsage: (id) => store().recordUsage(id),
  get filePath() { return store().filePath; }
};

module.exports = {
  PromptStore,
  prompts,
  configure,
  store,
  slugify,
  extractVariables,
  applyVariables,
  resolveAppBaseDir,
  DEFAULT_PROMPTS,
  STATUSES
};
