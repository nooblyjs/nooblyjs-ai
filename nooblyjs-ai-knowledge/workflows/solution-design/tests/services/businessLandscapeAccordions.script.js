/**
 * @fileoverview Offline check of the landscape page's inventory accordions.
 *
 * Unlike the other runners in this folder this needs NO ARIS credentials and no
 * network: it builds pages from the models already cached under
 * design_solution_datafolder, so it can be run any time to confirm the markdown
 * contract still holds.
 *
 * What it guards is invisible at runtime. The accordion is not a component with
 * an API — it is a shape the wiki's markdown parser recognises, and every one of
 * these rules fails SILENTLY when broken: the block renders as literal text, or
 * one object's details split across two half-empty items, or a table shears off
 * mid-page. Nothing throws, and the workflow reports success either way.
 *
 * Run:  node solution-design/tests/services/businessLandscapeAccordions.script.js
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const DATA = path.resolve(__dirname, '../../../', process.env.design_solution_datafolder
    || '../.application/spaces/working/design-solution');

// ─── Stubs: no network, no writes ────────────────────────────────────────────
const graphicPath = require.resolve('../../../common/architecture/models/graphic.js');
require.cache[graphicPath] = {
    id: graphicPath, filename: graphicPath, loaded: true,
    exports: class GraphicStub { async retrievePNGDataCached() { return 'STUBPNG'; } },
};

const fsUtilPath = require.resolve('../../../common/architecture/filesystem/filesystem.js');
const realFsUtil = require(fsUtilPath);
const written = new Map();
require.cache[fsUtilPath].exports = Object.assign({}, realFsUtil, {
    writeFile: (file, content) => written.set(file, content),
});

const BusinessLandscapeClass = require('../../services/businessLandscape');

/** Serves the cached model JSON instead of calling ARIS. */
class CachedLandscape extends BusinessLandscapeClass {
    async retrieve(model) {
        return JSON.parse(fs.readFileSync(path.join(DATA, 'models', `${model}.json`), 'utf8'));
    }
}

// ─── Assertions ──────────────────────────────────────────────────────────────
const failures = [];
function check(condition, message) {
    if (!condition) failures.push(message);
    return condition;
}

/**
 * Verify one generated page against the parser's contract.
 * @param {string} name Model name, for failure messages
 * @param {string} content The generated markdown
 * @param {number} objectCount Objects in the source model
 */
function verifyPage(name, content, objectCount) {
    const lines = content.split('\n');

    // The diagram is the page. It must survive, and stay at the top.
    check(lines[0].startsWith('# '), `${name}: page must open with an H1`);
    const imageLine = lines.findIndex((l) => l.startsWith('!['));
    const detailsLine = lines.findIndex((l) => l === '## Landscape Details');
    check(imageLine > -1, `${name}: diagram image missing`);
    if (detailsLine > -1) {
        check(imageLine < detailsLine, `${name}: inventory must come AFTER the diagram`);
    }

    if (objectCount === 0) {
        check(detailsLine === -1, `${name}: a model with no objects must gain no empty scaffolding`);
        return;
    }
    if (!check(detailsLine > -1, `${name}: ${objectCount} objects but no inventory section`)) return;

    // Group headings, then one accordion each.
    const groups = lines.filter((l) => /^### /.test(l));
    const accordions = lines.filter((l) => l === 'accordion');
    check(groups.length > 0, `${name}: inventory has no groups`);
    check(groups.length === accordions.length,
        `${name}: ${groups.length} groups but ${accordions.length} accordions`);

    // Every accordion declares which item starts open.
    const expanded = lines.filter((l) => /^ {2}expanded: \d+$/.test(l));
    check(expanded.length === accordions.length,
        `${name}: ${accordions.length} accordions but ${expanded.length} expanded declarations`);

    // Item titles carry the 1-3 space indent that keeps them inside the block —
    // four or more and `marked` renders the whole body as a code block.
    const items = lines.filter((l) => /^ {2}## /.test(l));
    check(items.length === objectCount || items.length > 0,
        `${name}: no accordion items rendered`);
    check(!lines.some((l) => /^ {4,}## /.test(l)),
        `${name}: an item is indented 4+ spaces and would render as code`);

    // No heading inside an item BODY: the parser reads `## ` as a new item, so a
    // heading there splits one object's details into two half-empty entries.
    let insideAccordion = false;
    for (const line of lines) {
        if (line === 'accordion') { insideAccordion = true; continue; }
        if (/^#{1,3} /.test(line)) { insideAccordion = false; continue; }  // next section
        if (!insideAccordion) continue;
        if (/^ {2}## /.test(line)) continue;                               // an item title
        check(!/^\s+#{1,6} /.test(line),
            `${name}: heading inside an accordion body would split the item: ${line.trim().slice(0, 50)}`);
    }

    // Tables must not have been sheared by an unescaped pipe or newline.
    for (const line of lines) {
        if (!/^\s*\|/.test(line)) continue;
        const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/);
        check(cells.length === 2 || cells.length === 4,
            `${name}: malformed table row (${cells.length} cells): ${line.trim().slice(0, 60)}`);
    }

    // Every item body says something.
    check(content.includes('**Properties**'), `${name}: items carry no Properties table`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────
/**
 * BOTH landscape workflows, because they are the same step with different
 * config and their models share no object type at all — a check that only
 * covered Application Landscapes would say nothing about Reference ones.
 */
const INVENTORIES = ['businessLandscapes.json', 'referenceLandscapes.json'];

(async () => {
    const service = new CachedLandscape({ datafolder: DATA, contentfolder: '/tmp' });

    let pages = 0;
    let itemsTotal = 0;
    let unreadable = 0;
    const groupTally = new Map();

    for (const inventoryName of INVENTORIES) {
        const inventoryFile = path.join(DATA, 'cache', inventoryName);
        if (!fs.existsSync(inventoryFile)) {
            console.error(`No cached inventory at ${inventoryFile} — run the landscape workflow first.`);
            process.exit(1);
        }
        const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));

    for (const owner of Object.values(inventory.modelObjects)) {
        for (const assignment of owner.assignments || []) {
            const modelFile = path.join(DATA, 'models', `${assignment.model}.json`);
            if (!fs.existsSync(modelFile)) continue;

            let objectCount;
            try {
                const data = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
                if (!data.attributes) continue;   // nothing to publish; skipped upstream too
                objectCount = Object.keys(data.modelObjects || {}).length;
            } catch (error) {
                unreadable++;                      // a truncated cache entry, not our concern
                continue;
            }

            written.clear();
            await service.createBusinessLandscapeContent(assignment.model, { folder: '/tmp' }, true);
            const content = [...written.values()][0];
            if (!content) continue;

            pages++;
            itemsTotal += (content.match(/^ {2}## /gm) || []).length;
            for (const [, heading] of content.matchAll(/^### (.+)$/gm)) {
                groupTally.set(heading, (groupTally.get(heading) || 0) + 1);
            }
            verifyPage(assignment.name || assignment.model, content, objectCount);
        }
    }
    }

    console.log(`pages verified   : ${pages}`);
    console.log(`accordion items  : ${itemsTotal.toLocaleString()}`);
    console.log(`unreadable cache : ${unreadable}`);
    console.log('groups used      :');
    for (const [heading, count] of [...groupTally].sort((a, b) => b[1] - a[1])) {
        console.log(`   ${String(count).padStart(4)} pages  ${heading}`);
    }

    // "Other Objects" is the catch-all. It existing is fine; it being the ONLY
    // group on a page means the category list has no idea what that corpus
    // contains — which is exactly what happened to Reference Landscapes.
    const other = groupTally.get('Other Objects') || 0;
    check(other <= pages / 2,
        `"Other Objects" appears on ${other} of ${pages} pages — the categories do not fit this corpus`);

    if (failures.length > 0) {
        console.error(`\nFAILED (${failures.length}):`);
        failures.slice(0, 25).forEach((f) => console.error(`  - ${f}`));
        if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
        process.exit(1);
    }
    console.log('\nPASS — every page keeps its diagram and its accordions parse.');
})().catch((error) => { console.error(error); process.exit(1); });
