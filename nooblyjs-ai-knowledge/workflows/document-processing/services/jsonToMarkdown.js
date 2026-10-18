/**
 * @fileoverview Structured JSON to Markdown Converter
 * Takes the structured JSON produced by docxToJson and renders it
 * as clean markdown with proper table formatting, heading hierarchy,
 * and list structure.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

// ─── node renderers ─────────────────────────────────────────────────────────

/**
 * Render a markdown table from headers and rows.
 * Pads columns for alignment and handles missing/extra cells gracefully.
 */
function renderTable(headers, rows) {
    if (!headers || headers.length === 0) return '';

    // Use the max column count across headers and all rows
    // (handles colspan headers that span fewer cells than data rows)
    const colCount = Math.max(headers.length, ...rows.map(r => r.length));

    // Normalise headers to colCount (pad if colspan made it shorter)
    const normHeaders = [...headers];
    while (normHeaders.length < colCount) normHeaders.push('');

    // Normalise every row to the same column count
    const normRows = rows.map(row => {
        const r = row.slice(0, colCount);
        while (r.length < colCount) r.push('');
        return r;
    });

    // Calculate column widths (minimum 3 for the separator)
    const widths = normHeaders.map((h, i) => {
        const cells = [h, ...normRows.map(r => r[i] || '')];
        return Math.max(3, ...cells.map(c => String(c).length));
    });

    // Pad helper
    const pad = (text, width) => String(text).padEnd(width);

    // Header row
    const headerLine = '| ' + normHeaders.map((h, i) => pad(h, widths[i])).join(' | ') + ' |';

    // Separator row
    const sepLine = '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |';

    // Data rows
    const dataLines = normRows.map(row =>
        '| ' + row.map((cell, i) => pad(cell, widths[i])).join(' | ') + ' |'
    );

    return [headerLine, sepLine, ...dataLines].join('\n');
}

/**
 * Render a single flat content node to markdown.
 */
function renderNode(node) {
    switch (node.type) {
        case 'heading':
            return '#'.repeat(node.level) + ' ' + node.text;

        case 'paragraph':
            return node.text;

        case 'image':
            return `![${node.alt || 'image'}](${node.src})`;

        case 'table':
            return renderTable(node.headers, node.rows);

        case 'unordered-list':
            return node.items.map(item => `- ${item}`).join('\n');

        case 'ordered-list':
            return node.items.map((item, i) => `${i + 1}. ${item}`).join('\n');

        default:
            return node.text || '';
    }
}

// ─── section renderer ───────────────────────────────────────────────────────

/**
 * Render a section (heading + content + children) recursively.
 */
function renderSection(section) {
    const parts = [];

    // Section heading
    if (section.heading) {
        parts.push('#'.repeat(section.level) + ' ' + section.heading);
    }

    // Section content (paragraphs, tables, lists)
    for (const node of section.content) {
        parts.push(renderNode(node));
    }

    // Child sections
    for (const child of section.children) {
        parts.push(renderSection(child));
    }

    return parts.join('\n\n');
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Convert structured JSON document to markdown.
 *
 * Accepts either the full document object (with `sections`) or a flat `nodes` array.
 *
 * @param {Object} doc - Document produced by docxToJson.convertToJson()
 * @returns {string} Clean markdown
 */
function convert(doc) {
    // Prefer section-based rendering (preserves hierarchy)
    if (doc.sections && doc.sections.length > 0) {
        return doc.sections.map(renderSection).join('\n\n').trim() + '\n';
    }

    // Fallback: render flat nodes
    if (doc.nodes && doc.nodes.length > 0) {
        return doc.nodes.map(renderNode).join('\n\n').trim() + '\n';
    }

    return '';
}

/**
 * Convert structured JSON to markdown and return with statistics.
 *
 * @param {Object} doc - Document produced by docxToJson
 * @returns {{ markdown: string, stats: Object }}
 */
function convertWithStats(doc) {
    const markdown = convert(doc);

    const tableCount = (doc.nodes || []).filter(n => n.type === 'table').length;
    const headingCount = (doc.nodes || []).filter(n => n.type === 'heading').length;
    const listCount = (doc.nodes || []).filter(n => n.type === 'unordered-list' || n.type === 'ordered-list').length;
    const imageCount = (doc.nodes || []).filter(n => n.type === 'image').length;

    return {
        markdown,
        stats: {
            characters: markdown.length,
            lines: markdown.split('\n').length,
            nodes: doc.nodeCount || (doc.nodes || []).length,
            tables: tableCount,
            images: imageCount,
            headings: headingCount,
            lists: listCount
        }
    };
}

module.exports = {
    convert,
    convertWithStats,
    renderTable,
    renderNode,
    renderSection
};
