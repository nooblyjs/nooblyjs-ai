/**
 * @fileoverview Shared markdown rendering helpers used when turning a formatted
 * ARIS model into wiki content. These are the small, domain-agnostic primitives
 * every architecture domain (solutions, processes, landscapes, infrastructure)
 * repeats: rendering a field value with a missing-value placeholder, building a
 * GitHub-flavoured table, and deriving an object's display title.
 *
 * Kept as pure functions (no `this`) so they can be used directly or exposed as
 * thin instance methods on {@link ArchitectureModel}.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

/**
 * Render a field value for a table cell, showing a placeholder for missing
 * values (mirrors the `_undefined_` convention used in the sample markdown).
 * @param {*} value
 * @returns {string}
 */
function field(value) {
    return (value === undefined || value === null || value === '') ? '_undefined_' : String(value);
}

/**
 * Build a GitHub-flavoured markdown table. No trailing newline. The first
 * column of every data row is rendered bold.
 * @param {string[]} headers - Column header cells
 * @param {Array<string[]>} rows - Row cells
 * @returns {string}
 */
function buildTable(headers, rows) {
    const lines = [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => {
            const cells = row.map((cell, index) => (index === 0 ? `**${cell}**` : cell));
            return `| ${cells.join(' | ')} |`;
        }),
    ];
    return lines.join('\n');
}

/**
 * Get the display title for a model object: its Name attribute, else its symbol,
 * else the supplied fallback. Domains pass a fallback that suits their content
 * (e.g. "Process" for business processes, the default "Object" elsewhere).
 * @param {object} object - A formatted model object
 * @param {string} [fallback='Object'] - Used when there is no Name or symbol
 * @returns {string}
 */
function objectTitle(object, fallback = 'Object') {
    const name = (object && object.attributes && object.attributes.Name || '').trim();
    return name || (object && object.symbol) || fallback;
}

/**
 * Indent every non-empty line by two spaces. Custom-block content (e.g. an
 * accordion item body) must be indented 1-3 spaces: enough to stay inside the
 * block, but below the four-space threshold that `marked` treats as an indented
 * code block.
 * @param {string} text
 * @returns {string}
 */
function indentBlock(text) {
    return String(text == null ? '' : text)
        .split('\n')
        .map((line) => (line.trim() === '' ? '' : '  ' + line))
        .join('\n');
}

/**
 * Build an `accordion` custom block of collapsible items. Each item's title is
 * rendered as a `## ` heading (which the wiki markdown parser reads as an
 * accordion item header) and its body is indented into the block. Section
 * captions inside a body must therefore be bold text, not `##`, or the parser
 * would read them as new items.
 * @param {Array<{title:string, body:string}>} items
 * @param {number} [expandedIndex=0] - Index of the item that starts open
 * @returns {string}
 */
function buildAccordion(items, expandedIndex = 0) {
    const parts = ['accordion', '', `  expanded: ${expandedIndex}`];
    for (const item of items) {
        parts.push('', `  ## ${item.title}`, indentBlock(item.body));
    }
    return parts.join('\n');
}

module.exports = { field, buildTable, objectTitle, indentBlock, buildAccordion };
