/**
 * @fileoverview Unit test for CodeProcessor.pruneOrphanedDocs — verifies that
 * output docs whose source directory was deleted are removed, while docs whose
 * source still exists are left untouched. No AI agent or network is needed:
 * pruning is a pure filesystem reconciliation of output against source.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

const CodeProcessorClass = require('../../services/codeProcessor');

const TMP = path.join(__dirname, '.tmp-prune-test');
const SOURCE = path.join(TMP, 'src');
const OUTPUT = path.join(TMP, 'out');

let passed = 0;
let failed = 0;

/** Record an assertion result. */
function check(label, condition) {
    if (condition) {
        passed++;
        console.log(`  PASS  ${label}`);
    } else {
        failed++;
        console.error(`  FAIL  ${label}`);
    }
}

/** Remove a path, ignoring any error (best-effort cleanup). */
function rm(target) {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
        /* ignore */
    }
}

/** Create a directory and write a placeholder .home.md into it. */
function mkDoc(root, relativePath) {
    const dir = path.join(root, relativePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.home.md'), `# ${relativePath}\n`, 'utf-8');
}

function runTest() {
    console.log('CodeProcessor.pruneOrphanedDocs test');

    rm(TMP);

    // Source tree: keep/ survives, gone/ and gone/deep/ will be absent.
    fs.mkdirSync(path.join(SOURCE, 'keep'), { recursive: true });

    // Output tree mirrors a PREVIOUS run that documented keep/, gone/, gone/deep/.
    mkDoc(OUTPUT, '');             // root doc — source root always exists
    mkDoc(OUTPUT, 'keep');        // source still present -> keep
    mkDoc(OUTPUT, 'gone');        // source deleted        -> prune
    mkDoc(OUTPUT, path.join('gone', 'deep')); // nested orphan, pruned with parent

    const processor = new CodeProcessorClass({ sourceFolder: SOURCE, markdownFolder: OUTPUT });
    const pruned = processor.pruneOrphanedDocs(SOURCE, OUTPUT);

    check('reports one orphan directory removed (gone/, subtree included)', pruned === 1);
    check('root doc is preserved', fs.existsSync(path.join(OUTPUT, '.home.md')));
    check('doc for a surviving source dir is preserved',
        fs.existsSync(path.join(OUTPUT, 'keep', '.home.md')));
    check('orphaned doc is removed', !fs.existsSync(path.join(OUTPUT, 'gone')));
    check('nested orphaned doc is removed with its parent',
        !fs.existsSync(path.join(OUTPUT, 'gone', 'deep')));

    // A second prune is a no-op now that output and source agree.
    check('re-pruning a reconciled tree removes nothing',
        processor.pruneOrphanedDocs(SOURCE, OUTPUT) === 0);

    rm(TMP);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

try {
    runTest();
} catch (err) {
    console.error('Test execution error:', err.message);
    process.exit(1);
}
