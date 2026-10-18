/**
 * @fileoverview Markdown / KR custom-block builders shared by the Product
 * Design services. Output targets the KR custom-block parser used by the wiki
 * (hero-banner) plus standard GitHub-flavoured tables.
 *
 * Custom-block content is indented two spaces — inside the block, but under the
 * four-space threshold that `marked` would treat as a code block.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

/**
 * Render a value for a table cell, showing a placeholder for empties.
 * @param {*} value
 * @returns {string}
 */
function field(value) {
    return (value === undefined || value === null || String(value).trim() === '')
        ? '—'
        : String(value).replace(/\r?\n+/g, ' ').trim();
}

/**
 * Escape a value for safe placement in HTML text or a double-quoted attribute.
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * An external link that opens in a new browser tab. Safe for use inside a
 * GitHub-flavoured table cell — `marked` passes raw inline HTML through.
 * @param {string} text - Visible label.
 * @param {string} href - Absolute URL.
 * @returns {string}
 */
function externalLink(text, href) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

/**
 * Build a GitHub-flavoured markdown table. First column of each data row is bold.
 * No trailing newline.
 * @param {string[]} headers
 * @param {Array<string[]>} rows
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
 * Build a hero-banner KR block.
 * @param {string} title
 * @param {string} subtitle
 * @returns {string}
 */
function buildHero(title, subtitle) {
    return [
        'hero-banner',
        '',
        `  title: ${title}`,
        `  subtitle: ${(subtitle || '').replace(/\r?\n+/g, ' ').trim()}`,
    ].join('\n');
}

module.exports = {
    field,
    escapeHtml,
    externalLink,
    buildTable,
    buildHero,
};
