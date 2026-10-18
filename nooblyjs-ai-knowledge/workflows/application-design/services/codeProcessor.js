/**
 * @fileoverview This activity will review a code repository and create markdown foles
 *   
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';
const fs = require('fs');
const path = require('path');
const wikiBlocks = require('../../common/content/wikiBlocks.js');
const { prompts } = require('../../common/prompts/prompts');
// Shared with system-context's FolderExpert: wall-clock budget + bounded
// retries around an AI prompt call. This class previously called
// expert.prompt() with no timeout at all — a stalled/slow provider call would
// hang analyzeDirectory() (and therefore the whole bottom-up sweep) forever,
// since the try/catch around it only handles a REJECTION, never a hang.
const { retry } = require('../../system-context/utilities/retry');

// Supported code file extensions
/*const SUPPORTED_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sql', '.json', '.xml', '.yaml', '.yml', '.xml',
    '.html', '.css', '.scss', '.less', '.vue'
];*/

const SUPPORTED_EXTENSIONS = [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sql', '.json', '.vue'
];
// Folders to ignore during traversal
const IGNORED_FOLDERS = [
    'node_modules', '.git', '.gitignore', 'dist', 'build', 'coverage', '.next', '.nuxt', 'out', '.cache', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache',
    '.tox', 'egg-info', '.eggs', 'target', 'bin', 'obj', '.vscode', '.idea', '.gradle', 'vendor', 'composer.lock', '.DS_Store', 'Thumbs.db'
];

/**
 * Normalise a relative path to forward slashes for comparison.
 *
 * The affected-directory filter compares two paths that are built by different
 * means: the filter list comes from git (always '/', via GitService.toPosix),
 * while the traversal builds its own relative path with path.join (on Windows,
 * '\'). Comparing them raw made every directory below the first level fail to
 * match, so an incremental run skipped everything, wrote nothing, and still
 * reported success — after which record-state advanced the processed-commit
 * marker past work that never happened. Both sides are normalised here.
 *
 * @param {string} p
 * @returns {string}
 */
function toPosixPath(p) {
    return String(p == null ? '' : p).replace(/\\/g, '/');
}

/**
 * This class processes manages the inventory of business solutions
 * 
 * @constructor - Receive the settings 
 * @method isCodeFile - Check if a file should be analyzed
 * @method hasCodeFiles - Check if a directory has any code files (non-recursive)
 * @method readFileSafely - Read file safely with size limit
 * @method getCodeFilesInDirectory - Get all code files in a directory (non-recursive)
 * @method analyzeDirectory - Analyze a directory's files plus its child summaries
 * @method readExistingSummary - Read a previously generated .home.md if present
 * @method processDirectory - Recursively process directories bottom-up and create .home.md files
 * @method process - Main entry point
 */
class CodeProcessorClass {

    /**
     * Receive the settings 
     * 
     * @async
     * @function run
     * @param {Object} settings - The data passed
     * @param {Object} settings.sourceFolder - The source folder to process
     * @param {Object} settings.markdownFolder - The destination folder to put the markdown
     * @param {Object} settings.expert - AI expert exposing prompt(systemContent, userContent)
     * @param {Object} [settings.prompts] - Prompt library (see common/prompts/prompts.js).
     *        Defaults to the shared library resolved off APP_BASE_DIR.
     * @param {number} [settings.aiTimeoutMs=120000] - Per-attempt wall-clock budget for
     *        the directory-analysis prompt; 0 = no timeout. Unlike system-context's
     *        FolderExpert, this class has no "slow local Ollama" use case to protect,
     *        so it defaults to a bounded value rather than 0.
     * @param {number} [settings.aiRetries=3] - Attempts per directory before giving up
     *        and leaving that directory undocumented (analyzeDirectory already treats
     *        a failure as non-fatal — it returns null and processing continues).
     */
    constructor(settings) {
        this.settings = settings;
        // If affectedDirectories is provided, only these directories will be processed
        this.affectedDirectories = settings.affectedDirectories || null;
        // The architect persona and the renderer rules live in the platform's
        // prompt library (datasources → AI → Prompts) so they can be tuned
        // without a code change; the step binds this to its own appBaseDir.
        this.prompts = settings.prompts || prompts;
        this.aiTimeoutMs = settings.aiTimeoutMs != null ? settings.aiTimeoutMs : 120000;
        this.aiRetries = settings.aiRetries || 3;
        // Directories whose documentation could not be produced this run.
        // A failure here is deliberately NON-FATAL to the traversal — one bad
        // directory must not abort a whole repository — but it MUST be visible
        // to the caller, because the workflow's record-state step advances the
        // processed-commit marker on success and those commits are then never
        // revisited. Collected here and reported by process().
        this.failedDirectories = [];
    }

    /**
     * Record a directory that could not be documented this run.
     * @param {string} relativePath - Path relative to the source root ('' = root)
     * @param {string} reason - Error message
     */
    recordFailure(relativePath, reason) {
        this.failedDirectories.push({
            directory: relativePath === '' ? '<root>' : relativePath,
            reason: reason
        });
    }

    /**
     * Check if a file should be analyzed
     * @param {*} filePath
     * @returns 
     */
    isCodeFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    }

    /**
     * Check if a directory has any code files (non-recursive)
     * @param {*} dirPath 
     * @returns 
     */
    hasCodeFiles(dirPath) {
        try {
            const files = fs.readdirSync(dirPath);
            return files.some(file => {
                const fullPath = path.join(dirPath, file);
                const isDir = fs.statSync(fullPath).isDirectory();
                return !isDir && this.isCodeFile(fullPath);
            });
        } catch (err) {
            return false;
        }
    }

    /**
     * Read file safely with size limit
     * @param {*} filePath 
     * @param {*} maxSize 
     * @returns 
     */
    readFileSafely(filePath, maxSize = 50000) {
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > maxSize) {
                return `[File too large (${stats.size} bytes), showing first ${maxSize} bytes]\n` +
                    fs.readFileSync(filePath, 'utf-8').substring(0, maxSize);
            }
            return fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            return `[Error reading file: ${err.message}]`;
        }
    }

    /**
     * Get all code files in a directory (non-recursive)
     * @param {*} dirPath 
     * @returns 
     */
    getCodeFilesInDirectory(dirPath) {
        try {
            const files = fs.readdirSync(dirPath);
            return files
                .filter(file => {
                    const fullPath = path.join(dirPath, file);
                    const isDir = fs.statSync(fullPath).isDirectory();
                    return !isDir && this.isCodeFile(fullPath);
                })
                .map(file => ({
                    name: file,
                    path: path.join(dirPath, file)
                }));
        } catch (err) {
            console.error(`Error reading directory ${dirPath}:`, err.message);
            return [];
        }
    }

    /**
     * Heuristic: does this directory expose an HTTP API? Used to decide whether
     * the generated doc should include a Swagger/OpenAPI block. True when the
     * folder is named like an API layer, a file is named like one, or any file
     * registers Express-style routes (app.get / router.post / ...).
     * @param {string} dirPath
     * @param {Array<{name:string, path:string}>} files
     * @returns {boolean}
     */
    directoryExposesApi(dirPath, files) {
        const apiNameRe = /(route|api|controller|endpoint|swagger)/i;
        if (apiNameRe.test(path.basename(dirPath))) return true;
        for (const f of files) {
            if (apiNameRe.test(f.name)) return true;
            try {
                const txt = fs.readFileSync(f.path, 'utf-8');
                if (/\b(app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(/.test(txt)) {
                    return true;
                }
            } catch (_) { /* ignore unreadable file */ }
        }
        return false;
    }

    /**
     * Formatting rules shared by every prompt, read from the prompt library
     * (key "code-documentation-renderer-rules"). These encode the conventions of
     * our knowledge-repository docs AND the gotchas of the custom wiki Markdown
     * parser (public/js/markdown/markdown-parser.js): Mermaid must be flush-left,
     * Swagger YAML must be uniformly indented, and prose lines must not start
     * with a reserved layout-block keyword.
     * @returns {string}
     */
    rendererRules() {
        return this.prompts.get('code-documentation-renderer-rules');
    }

    /**
     * Strip the brief back out of a generated document.
     *
     * The prompt now names the headings and briefs them separately, which is the
     * real fix — but a model asked for `## Key Concepts` still sometimes emits
     * `## Key Concepts — define and explain the key concepts these files
     * expose…`, i.e. the instruction it was given, as the heading. That is not a
     * cosmetic wart: it is the first thing a reader sees on every page, it tells
     * them nothing about the code, and once a repository is documented the only
     * way to remove it is to re-run every AI call.
     *
     * So the output is normalised on the way out. Two transforms, both narrow
     * enough that they cannot damage genuine prose:
     *
     *   1. An H1 loses any ` — <role>` tail. The persona shapes how the document
     *      is written; it is not part of the document. (`api\dev — Application
     *      Architect` becomes `api\dev`.)
     *   2. An H2 that starts with one of OUR four section names is cut back to
     *      exactly that name. Only these four are touched, and only when the
     *      heading STARTS with one — a heading the model invented for its own
     *      subsection is left alone.
     *
     * @param {string} markdown - raw model output
     * @returns {string}
     */
    static stripPromptEcho(markdown) {
        if (!markdown) return markdown;

        const SECTIONS = ['Key Concepts', 'Detailed Design', 'Application Flow', 'APIs'];

        return String(markdown).split('\n').map((line) => {
            const h1 = /^#\s+(.*)$/.exec(line);
            if (h1) {
                // Cut at the first em/en dash or " - " separator: everything after
                // it is the role the H1 rule asks the model not to add.
                const title = h1[1].split(/\s+[—–]\s+|\s+-\s+/)[0].trim();
                return title ? `# ${title}` : line;
            }

            const h2 = /^##\s+(.*)$/.exec(line);
            if (!h2) return line;

            const text = h2[1].trim();
            const match = SECTIONS.find(
                (s) => text.toLowerCase().startsWith(s.toLowerCase())
            );
            if (!match) return line;

            // Only rewrite when there IS a tail, so an already-correct heading is
            // returned byte-for-byte.
            const tail = text.slice(match.length).trim();
            return tail ? `## ${match}` : line;
        }).join('\n');
    }

    /**
     * Analyze a directory into a four-section knowledge-repository doc
     * (Key Concepts / Detailed Design / Application Flow / APIs), written from
     * an application-architect and functional-designer perspective. The doc is
     * grounded in this directory's own code files PLUS the already-generated
     * summaries of its immediate subdirectories, so a parent's documentation
     * builds on the documentation of its children.
     *
     * @param {string} dirPath - Directory to analyze
     * @param {Array<{name: string, summary: string}>} childSummaries - The
     *        .home.md content of each immediate subdirectory
     * @param {string} relativePath - Path of dirPath relative to the input root
     * @returns {Promise<string|null>} Markdown doc, or null if nothing to document
     */
    async analyzeDirectory(dirPath, childSummaries = [], relativePath = '') {
        const files = this.getCodeFilesInDirectory(dirPath);

        if (files.length === 0 && childSummaries.length === 0) {
            return null;
        }

        const folderLabel = relativePath || path.basename(dirPath);

        // Concatenate this directory's own code files
        let fileContents = '';
        for (const file of files) {
            fileContents += `\n\n=== FILE: ${file.name} ===\n`;
            fileContents += this.readFileSafely(file.path);
        }

        // Concatenate the summaries of the immediate subdirectories
        let childContext = '';
        for (const child of childSummaries) {
            childContext += `\n\n=== SUBDIRECTORY: ${child.name} ===\n`;
            childContext += child.summary;
        }

        const systemContent = this.prompts.get('code-documentation');

        let userContent;
        if (files.length > 0) {
            const fileNames = files.map(f => f.name).join(', ');
            const exposesApi = this.directoryExposesApi(dirPath, files);

            const apiBrief = exposesApi
                ? 'This directory exposes HTTP endpoints. Provide an OpenAPI 3.0 spec inside a fenced block '
                  + 'whose opening line is exactly ```swagger and closing line is exactly ```. CRITICAL: indent the ENTIRE '
                  + 'YAML body by exactly 2 spaces on every line (the renderer strips the smallest indent, which would '
                  + 'otherwise corrupt the top-level keys). Derive the real paths, HTTP methods and summaries from the '
                  + 'route code above — do not invent endpoints.'
                : 'This directory exposes no HTTP API directly. Write a single short sentence stating that and '
                  + "pointing to the service's routes documentation. Do not invent endpoints and do not include a swagger block.";

            // THE HEADINGS AND THEIR BRIEFS ARE KEPT APART, DELIBERATELY.
            //
            // These used to be one line each — `## Key Concepts — define and
            // explain the key concepts…` — which reads to a model as the heading
            // it should emit, so it copied the whole instruction into the page
            // and wrote the real content underneath it. Every generated document
            // opened with a paragraph of prompt. Naming the four headings once,
            // then briefing them separately, removes the ambiguity at source;
            // `stripPromptEcho` below is the safety net for a model that echoes
            // anyway.
            userContent = [
                `Document the directory "${folderLabel}" for our engineering knowledge repository.`,
                '',
                this.rendererRules(),
                '',
                'Produce EXACTLY these four H2 headings, in this order, written exactly as shown '
                  + 'with nothing appended to them:',
                '',
                '## Key Concepts',
                '## Detailed Design',
                '## Application Flow',
                '## APIs',
                '',
                'What each section must contain (this is your brief — do NOT reproduce any of it in '
                  + 'the document):',
                '',
                'Key Concepts: define and explain the key concepts these files expose and summarise how they '
                  + 'work. Cover BOTH an application-architect lens (where this fits, its dependencies, the '
                  + 'patterns and trade-offs) and a functional-designer lens (what it does for users/consumers, '
                  + 'the flows and behaviour). Several substantial paragraphs. Start straight into the '
                  + 'explanation — no preamble about what the section is for.',
                '',
                'Detailed Design: for EACH code file write a bold filename lead-in followed by an analyst-level '
                  + 'explanation of what it does and how, grounded in the actual code. Format each entry as: '
                  + '**`filename`** — explanation. Cover every file: ' + fileNames + '. Do not list the '
                  + 'filenames anywhere else.',
                '',
                'Application Flow: a Mermaid diagram (per the rules above) showing the flow and dependencies '
                  + 'within this directory and to its collaborators. The diagram is the section — no sentence '
                  + 'introducing it.',
                '',
                'APIs: ' + apiBrief,
                '',
                'CODE FILES IN THIS DIRECTORY:',
                fileContents
            ].join('\n');

            if (childContext) {
                userContent +=
                    '\n\nSUBDIRECTORY SUMMARIES (already-generated docs of the immediate child folders — use them so this '
                    + "directory's documentation builds on its children):\n" + childContext;
            }
        } else {
            // No code files of its own — an overview synthesised purely from children.
            userContent = [
                `Document the directory "${folderLabel}" for our engineering knowledge repository. `
                  + 'It contains no code files of its own, only subdirectories.',
                '',
                this.rendererRules(),
                '',
                'Produce EXACTLY these two H2 headings, in this order, written exactly as shown with '
                  + 'nothing appended to them:',
                '',
                '## Key Concepts',
                '## Application Flow',
                '',
                'What each section must contain (this is your brief — do NOT reproduce any of it in '
                  + 'the document):',
                '',
                'Key Concepts: synthesise what this area contains as a whole and how its subdirectories relate '
                  + 'to one another. Start straight into the explanation.',
                '',
                'Application Flow: a Mermaid diagram (per the rules above) showing how the subdirectories fit '
                  + 'together. The diagram is the section — no sentence introducing it.',
                '',
                'Omit "## Detailed Design" and "## APIs" entirely — there are no direct code files.',
                '',
                'SUBDIRECTORY SUMMARIES:',
                childContext
            ].join('\n');
        }

        try {
            const analysis = await retry(
                () => this.settings.expert.prompt(systemContent, userContent),
                {
                    retries: this.aiRetries,
                    timeoutMs: this.aiTimeoutMs,
                    label: `code documentation (${folderLabel})`,
                    logger: console,
                }
            );
            return CodeProcessorClass.stripPromptEcho(analysis);
        } catch (err) {
            console.error(`Error analyzing directory ${dirPath}:`, err.message);
            // Non-fatal for the traversal, but recorded so process() can report
            // it and the step can refuse to advance the processed-commit marker.
            this.recordFailure(relativePath, err.message);
            return null;
        }
    }

    /**
     * Read a previously generated .home.md summary if it exists. Used so that
     * an unchanged directory can still pass its summary up to its parent.
     * @param {string} readmePath - Path to the .home.md file
     * @returns {string|null} File content, or null if not present
     */
    readExistingSummary(readmePath) {
        try {
            if (fs.existsSync(readmePath)) {
                return fs.readFileSync(readmePath, 'utf-8');
            }
        } catch (err) {
            console.error(`Error reading existing summary ${readmePath}:`, err.message);
        }
        return null;
    }

    /**
     * Check if a directory should be processed based on the affected directories filter.
     * If no filter is set (affectedDirectories is null), all directories are processed.
     *
     * Both sides are compared as forward-slashed paths (see toPosixPath): the
     * filter list is git-derived and the relative path is path.join-derived, so
     * on Windows they would otherwise never match below the first level.
     * '' means the repository root itself changed — it matches only the root,
     * not every directory.
     *
     * @param {string} relativePath - The relative path of the directory being checked
     * @returns {boolean}
     */
    isAffectedDirectory(relativePath) {
        if (!this.affectedDirectories) {
            return true; // No filter — process everything
        }
        const normalised = toPosixPath(relativePath);
        return this.affectedDirectories.some(dir => {
            const normDir = toPosixPath(dir);
            return normalised === normDir || normalised.startsWith(normDir + '/');
        });
    }

    /**
     * Recursively process directories bottom-up. The deepest directories are
     * analysed first; each parent is then analysed using its own files plus
     * the freshly generated .home.md summaries of its subdirectories. This
     * way a folder's documentation is informed by everything beneath it.
     *
     * @param {string} inputDir - Directory being processed
     * @param {string} outputDir - Root output folder for .home.md files
     * @param {string} relativePath - Path of inputDir relative to the input root
     * @returns {Promise<{summary: string|null, changed: boolean}>}
     *          summary - the .home.md content for this directory (for the parent's context);
     *          changed - whether this directory or any descendant was re-analysed this run
     */
    async processDirectory(inputDir, outputDir, relativePath = '') {
        try {
            // 1. Process subdirectories FIRST (post-order / bottom-up traversal)
            const childSummaries = [];
            let anyChildChanged = false;

            const items = fs.readdirSync(inputDir);
            for (const item of items) {
                const fullPath = path.join(inputDir, item);
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory() && !item.startsWith('.') && !IGNORED_FOLDERS.includes(item)) {
                    const childRelativePath = relativePath ? path.join(relativePath, item) : item;
                    const childResult = await this.processDirectory(fullPath, outputDir, childRelativePath);

                    if (childResult.summary) {
                        childSummaries.push({ name: item, summary: childResult.summary });
                    }
                    if (childResult.changed) {
                        anyChildChanged = true;
                    }
                }
            }

            // 2. Nothing to document here if there are no files and no child summaries
            const hasFiles = this.hasCodeFiles(inputDir);
            if (!hasFiles && childSummaries.length === 0) {
                return { summary: null, changed: false };
            }

            const currentOutputDir = path.join(outputDir, relativePath);
            const readmePath = path.join(currentOutputDir, '.home.md');

            // 3. Re-analyse if this directory is directly affected, OR if a
            //    descendant changed (which makes our aggregated summary stale).
            const shouldProcess = this.isAffectedDirectory(relativePath) || anyChildChanged;

            if (!shouldProcess) {
                // Unchanged — reuse the existing .home.md so the parent still
                // receives this directory's summary as context.
                console.log(`Skipping (unchanged): ${inputDir}`);
                return { summary: this.readExistingSummary(readmePath), changed: false };
            }

            // 4. Analyse this directory using its own files + child summaries.
            //    The summary is always returned to the parent for context; whether
            //    a .home.md is actually WRITTEN is decided next.
            console.log(`\nAnalyzing: ${inputDir}`);
            const summary = await this.analyzeDirectory(inputDir, childSummaries, relativePath);

            // 5. Code-only write rule (matches our knowledge-repo convention):
            //    only emit a .home.md for folders that DIRECTLY contain code files.
            //    Pure path-containers (sub-folders only) are skipped so the tree
            //    isn't littered with thin docs — except the root, which is always
            //    kept as the area overview/landing page. Disable by setting
            //    settings.documentCodeOnly = false to document every folder.
            const isRoot = relativePath === '';
            const documentCodeOnly = this.settings.documentCodeOnly !== false;
            const shouldWrite = summary && (!documentCodeOnly || hasFiles || isRoot);

            if (shouldWrite) {
                if (!fs.existsSync(currentOutputDir)) {
                    fs.mkdirSync(currentOutputDir, { recursive: true });
                }
                // Preserve any wiki blocks a reader added to this folder doc.
                wikiBlocks.writeMarkdownPreserving(readmePath, summary);
                console.log(`Created: ${readmePath}`);
            } else if (summary) {
                console.log(`Skipping (path-container, no direct code files): ${inputDir}`);
            }

            return { summary, changed: true };
        } catch (err) {
            console.error(`Error processing directory ${inputDir}:`, err.message);
            this.recordFailure(relativePath, err.message);
            return { summary: null, changed: false };
        }
    }

    /**
     * Remove output docs whose source directory no longer exists.
     *
     * The bottom-up processor only walks directories that are still present in
     * the working tree, so when a source directory is deleted its previously
     * generated `.home.md` (and any nested docs) are left orphaned in the output
     * folder. This reconciles the output against the source: every output
     * subdirectory whose mirrored source path is gone is removed wholesale.
     *
     * @param {string} inputFolder - Source root being documented
     * @param {string} outputFolder - Output root holding the .home.md tree
     * @returns {number} Count of orphaned output directories removed
     */
    pruneOrphanedDocs(inputFolder, outputFolder) {
        let pruned = 0;
        // Walk output top-down; when a dir's source counterpart is missing,
        // remove the whole subtree and don't descend into it.
        const stack = [''];
        while (stack.length > 0) {
            const relativePath = stack.pop();
            const outputDir = path.join(outputFolder, relativePath);

            let entries;
            try {
                entries = fs.readdirSync(outputDir, { withFileTypes: true });
            } catch (err) {
                continue; // disappeared mid-walk — nothing to prune here
            }

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
                const sourceDir = path.join(inputFolder, childRelative);

                if (fs.existsSync(sourceDir)) {
                    stack.push(childRelative); // still present — keep descending
                } else {
                    const orphan = path.join(outputFolder, childRelative);
                    try {
                        fs.rmSync(orphan, { recursive: true, force: true });
                        pruned++;
                        console.log(`Pruned (source removed): ${orphan}`);
                    } catch (err) {
                        console.error(`Error pruning ${orphan}:`, err.message);
                    }
                }
            }
        }
        return pruned;
    }

    /**
     * Main service function.
     *
     * @returns {Promise<Object>} result
     * @returns {boolean} result.success - false when the run could not be
     *          completed at all (bad folders, unwritable output). NOTE this is
     *          NOT the only failure signal: a run that completes the traversal
     *          but could not document some directories returns success:true
     *          with a non-empty `failedDirectories`. Callers that gate anything
     *          on the run having genuinely succeeded — notably the step that
     *          advances the processed-commit marker — must check BOTH.
     * @returns {Array<{directory:string, reason:string}>} result.failedDirectories
     * @returns {number} result.failedCount
     */
    async process() {

        // Handle the folders
        let inputFolder = this.settings.sourceFolder
        let outputFolder = this.settings.markdownFolder

        // Fresh tally per run — the same instance could be reused.
        this.failedDirectories = [];

        try {
            // Validate input folder exists
            if (!fs.existsSync(inputFolder)) {
                throw new Error(`Input folder not found: ${inputFolder}`);
            }

            // Extract the input folder name and append to output path
            const inputFolderName = path.basename(inputFolder);
            const finalOutputFolder = path.join(outputFolder, inputFolderName);

            // Create output folder
            if (!fs.existsSync(finalOutputFolder)) {
                fs.mkdirSync(finalOutputFolder, { recursive: true });
            }

            console.log('Starting code documentation generation...');
            console.log(`Input folder: ${inputFolder}`);
            console.log(`Output folder: ${finalOutputFolder}`);

            // Start recursive processing (bottom-up: leaves first, then parents)
            await this.processDirectory(inputFolder, finalOutputFolder);

            // Reconcile the output against the source: drop docs for any source
            // directory that was deleted since the last run.
            const prunedDocs = this.pruneOrphanedDocs(inputFolder, finalOutputFolder);

            const failedCount = this.failedDirectories.length;
            if (failedCount > 0) {
                console.error(`\n! Documentation generation finished with ${failedCount} failed directory(ies):`);
                for (const f of this.failedDirectories) {
                    console.error(`  - ${f.directory}: ${f.reason}`);
                }
            } else {
                console.log('\n✓ Documentation generation complete!');
            }

            return {
                success: true,
                inputFolder,
                outputFolder: finalOutputFolder,
                prunedDocs,
                failedDirectories: this.failedDirectories,
                failedCount,
                message: failedCount === 0
                    ? 'READMEs generated successfully for all directories'
                    : `READMEs generated, but ${failedCount} directory(ies) could not be documented`
            };
        } catch (err) {
            console.error('Error in buildCodeDocumentation:', err.message);
            return {
                success: false,
                error: err.message,
                failedDirectories: this.failedDirectories,
                failedCount: this.failedDirectories.length
            };
        }
    };
}

module.exports = CodeProcessorClass;