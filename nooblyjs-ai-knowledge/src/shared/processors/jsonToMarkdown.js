/**
 * @fileoverview Structured JSON to Markdown Converter
 * Takes the structured JSON produced by docxToJson and renders it
 * as clean markdown with proper table formatting, heading hierarchy,
 * and list structure.
 *
 * Ported from noobly-app-wiki-workflows/design-documents/services
 * and extended with table cleanup for Word layout artifacts (see renderTable):
 * single-cell wrapper tables, colspan title rows, and pure single-column stacks.
 *
 * @author noobly Team
 * @version 1.1.0
 */

'use strict';

// ─── node renderers ─────────────────────────────────────────────────────────

/**
 * Render a markdown table from headers and rows.
 *
 * Word documents (especially design-spec templates) nest layout tables heavily:
 * a section's title bar is its own 1-cell table, and the real grid often sits
 * under a single colspan "title" row. Rendered naively these become 1-wide pipe
 * tables or stray title cells. This function normalises those cases first:
 *
 *   - a single-cell wrapper table  → its text (no table)
 *   - a colspan title above a grid → a **bold caption** + the promoted real header
 *   - a pure single-column stack   → plain lines (no 1-wide pipe table)
 *
 * Pads columns for alignment and handles missing/extra cells gracefully.
 */
function renderTable(headers, rows) {
    headers = headers || [];
    rows = rows || [];

    // Drop fully-empty tables
    const totalCells = headers.length + rows.reduce((n, r) => n + r.length, 0);
    if (totalCells === 0) return '';

    // Word layout artifact: a single-cell wrapper table — render as plain text.
    if (totalCells === 1) {
        const only = headers[0] != null ? headers[0] : (rows[0] && rows[0][0]);
        return String(only || '').trim();
    }

    // Colspan title row: one header cell sitting above wider data rows (Word wraps
    // a section's title bar in the same table). Lift it out as a bold caption and
    // promote the first data row to the real header.
    let caption = '';
    if (headers.length === 1 && rows.length > 0 && rows[0].length > 1) {
        caption = String(headers[0]).trim();
        headers = rows[0];
        rows = rows.slice(1);
    }

    if (!headers || headers.length === 0) return caption ? `**${caption}**` : '';

    // Use the max column count across headers and all rows
    // (handles colspan headers that span fewer cells than data rows)
    const colCount = Math.max(headers.length, ...rows.map(r => r.length));

    // Pure single-column table: a stacked list, not a grid. Render as plain lines
    // so it doesn't become a noisy 1-wide pipe table.
    if (colCount <= 1) {
        const lines = [headers[0], ...rows.map(r => r[0])]
            .map(c => String(c == null ? '' : c).trim())
            .filter(Boolean);
        const body = lines.join('\n\n');
        return caption ? `**${caption}**\n\n${body}` : body;
    }

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

    const table = [headerLine, sepLine, ...dataLines].join('\n');
    return caption ? `**${caption}**\n\n${table}` : table;
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
        const rendered = renderNode(node);
        if (rendered && rendered.trim()) parts.push(rendered);
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
