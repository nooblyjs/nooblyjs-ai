/**
 * @fileoverview Wiki Context Loader
 *
 * Resolves a project's `wikiContext` selections (an array of
 * { spaceId, folderPath, ... }) into actual Markdown content that the
 * AI orchestrator can fold into its prompts as grounding.
 *
 * A selection names EITHER a folder (walked) or a single file (read on its
 * own) — the picker offers both, and which one it is comes from stat'ing the
 * path rather than from the entry's `kind`, so a selection stored before that
 * field existed still resolves.
 *
 * ORDER MATTERS: entries are read in array order and the total-byte budget is
 * spent as we go, so what the user put first is what the AI is guaranteed to
 * see. Never reorder them here.
 *
 * Design constraints:
 *   - Do not blow up the prompt with the entire wiki. We cap total bytes,
 *     per-file bytes, and recursion depth.
 *   - Skip non-text files when WALKING a folder. A file picked BY NAME is
 *     different: a PDF or office document picked deliberately falls back to
 *     its folder-local derived sidecar, which is the same text search indexes
 *     for it — otherwise picking the one document you care about silently
 *     contributes nothing.
 *   - Stay quiet on per-file failures — the user shouldn't lose generation
 *     because one wiki doc has bad permissions.
 *
 * Returns a single string formatted as:
 *
 *   # Knowledge context
 *
 *   ## <space> / <folder>/<file>
 *   <truncated content>
 *
 *   ...
 *
 * Empty string if no context selected or nothing readable.
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { toDerivedRelPath, needsMarkdownSidecar } = require('../../shared/utils/filePolicy');

const TEXT_EXTS = new Set(['.md', '.markdown', '.txt']);
const DEFAULT_LIMITS = {
  maxBytesPerFile: 8 * 1024,    // 8 KB
  maxTotalBytes: 60 * 1024,     // 60 KB across all files
  maxFilesPerFolder: 25,
  maxDepth: 4
};

class WikiContextLoader {
  constructor({ app, log, limits }) {
    this.app = app;
    this.log = log || console;
    this.limits = { ...DEFAULT_LIMITS, ...(limits || {}) };
  }

  _spaceManager() { return this.app.get('spaceManager'); }

  /**
   * @param {Array<{spaceId,folderPath,name,spaceName,kind}>} wikiContext
   * @returns {Promise<{ digest: string, files: Array<{space, path, bytes}>, truncated: boolean }>}
   */
  async load(wikiContext) {
    if (!Array.isArray(wikiContext) || !wikiContext.length) {
      return { digest: '', files: [], truncated: false };
    }
    const sm = this._spaceManager();
    if (!sm) return { digest: '', files: [], truncated: false };

    const sections = [];
    const files = [];
    let totalBytes = 0;
    let truncated = false;

    for (const ctx of wikiContext) {
      const space = sm.getSpaceById(Number(ctx.spaceId));
      if (!space) continue;
      const spaceBase = space.path
        || (space.configuration && space.configuration.filing && space.configuration.filing.baseDir);
      if (!spaceBase) continue;

      const rel = (ctx.folderPath || '').replace(/^\/+|\/+$/g, '');
      const absRoot = rel ? path.join(spaceBase, rel) : spaceBase;
      // Containment check — keep us inside the space.
      const normRoot = path.resolve(absRoot);
      const normBase = path.resolve(spaceBase);
      if (!normRoot.startsWith(normBase)) continue;

      try {
        // Folder or file? Ask the filesystem — `ctx.kind` is only the UI's hint
        // and pre-dates file selections entirely.
        let stat = null;
        try {
          stat = await fs.stat(normRoot);
        } catch {
          this.log.warn(`[continuous-exploration] wiki context: ${absRoot} no longer exists`);
          continue;
        }

        const collected = stat.isDirectory()
          ? await this._walk(normRoot, normBase, 0, { spaceBase: normBase })
          : await this._readOne(normRoot, normBase);

        for (const entry of collected) {
          if (totalBytes >= this.limits.maxTotalBytes) { truncated = true; break; }

          const remaining = this.limits.maxTotalBytes - totalBytes;
          const chunkSize = Math.min(entry.content.length, this.limits.maxBytesPerFile, remaining);
          const chunk = entry.content.slice(0, chunkSize);

          sections.push(`## ${space.name} / ${entry.rel}\n\n${chunk}${entry.content.length > chunkSize ? '\n\n…(truncated)' : ''}`);
          files.push({ space: space.name, path: entry.rel, bytes: chunkSize });
          totalBytes += chunkSize;
        }
        if (totalBytes >= this.limits.maxTotalBytes) truncated = true;
      } catch (err) {
        this.log.warn(`[continuous-exploration] wiki context: could not walk ${absRoot}: ${err.message}`);
      }

      if (totalBytes >= this.limits.maxTotalBytes) break;
    }

    if (!sections.length) return { digest: '', files: [], truncated };
    const digest = `# Knowledge context\n\nThe following excerpts are from the wiki folders and documents selected for this project, most important first. Treat them as authoritative background — prefer them over generic guidance.\n\n${sections.join('\n\n')}`;
    return { digest, files, truncated };
  }

  /**
   * Read ONE explicitly picked file.
   *
   * Text is read as-is. Anything else (PDF, .docx, …) has no text of its own,
   * so we read the folder-local derived sidecar — `<dir>/.system/derived/
   * <name>.<ext>.md`, the same extraction that feeds search. If there is no
   * sidecar yet the file contributes nothing, which is the honest answer: the
   * text does not exist anywhere on disk to give.
   *
   * `rel` is reported as the ORIGINAL's path, never the sidecar's, so the
   * digest cites the document the user actually chose.
   *
   * @param {string} full - absolute path to the picked file
   * @param {string} spaceBase - absolute space content root
   * @returns {Promise<Array<{full: string, rel: string, content: string}>>}
   */
  async _readOne(full, spaceBase) {
    const rel = path.relative(spaceBase, full).split(path.sep).join('/');
    const ext = path.extname(full).toLowerCase();

    let source = full;
    if (!TEXT_EXTS.has(ext)) {
      if (!needsMarkdownSidecar(full)) return [];   // image, video, unknown binary
      source = path.join(spaceBase, toDerivedRelPath(rel).split('/').join(path.sep));
    }

    try {
      const content = await fs.readFile(source, 'utf8');
      return [{ full, rel, content }];
    } catch {
      if (source !== full) {
        this.log.warn(`[continuous-exploration] wiki context: no extracted text for ${rel} — skipped`);
      }
      return [];
    }
  }

  async _walk(dir, spaceBase, depth, state) {
    if (depth > this.limits.maxDepth) return [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const out = [];
    let filesInFolder = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this._walk(full, spaceBase, depth + 1, state);
        out.push(...nested);
        continue;
      }
      if (!entry.isFile()) continue;
      if (filesInFolder >= this.limits.maxFilesPerFolder) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTS.has(ext)) continue;

      let content = '';
      try {
        content = await fs.readFile(full, 'utf8');
      } catch {
        continue;
      }
      filesInFolder++;
      out.push({
        full,
        rel: path.relative(spaceBase, full).split(path.sep).join('/'),
        content
      });
    }
    return out;
  }
}

module.exports = WikiContextLoader;
