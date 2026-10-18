/**
 * @fileoverview DOCX to Structured JSON Converter
 * Parses DOCX files via Mammoth's HTML output, then walks the HTML to produce
 * a structured JSON representation that preserves headings, paragraphs, lists,
 * and — critically — table structure (rows, columns, headers).
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const mammoth = require('mammoth');
const path = require('node:path');

/**
 * Lightweight HTML-to-structured-JSON parser.
 * No external HTML parser needed — Mammoth produces clean, predictable HTML.
 *
 * Strategy:
 *   1. Convert DOCX → HTML via Mammoth (preserves tables, headings, lists)
 *   2. Walk the HTML string with a simple tag-aware state machine
 *   3. Emit structured JSON nodes for each content block
 */

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Strip HTML tags and decode basic entities
 */
function stripTags(html) {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
}

/**
 * Extract inner HTML content between opening and closing tags at the same nesting depth.
 * Returns array of inner-HTML strings for every occurrence of `tagName`.
 */
function extractTag(html, tagName) {
    const results = [];
    const openPattern = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'gi');
    let match;

    while ((match = openPattern.exec(html)) !== null) {
        const startInner = match.index + match[0].length;
        let depth = 1;
        let i = startInner;
        const closeTag = `</${tagName}>`;
        const openTag = `<${tagName}`;

        while (i < html.length && depth > 0) {
            if (html.slice(i).toLowerCase().startsWith(closeTag.toLowerCase())) {
                depth--;
                if (depth === 0) break;
                i += closeTag.length;
            } else if (html.slice(i).toLowerCase().startsWith(openTag.toLowerCase())) {
                depth++;
                // skip past the full opening tag
                const end = html.indexOf('>', i);
                i = end !== -1 ? end + 1 : i + 1;
            } else {
                i++;
            }
        }

        results.push(html.slice(startInner, i));
    }

    return results;
}

// ─── table parser ───────────────────────────────────────────────────────────

/**
 * Parse an HTML <table> block into a structured object.
 *
 * Returns: { headers: string[], rows: string[][] }
 *   - If the table contains <th> elements, they become headers
 *   - Otherwise the first row is promoted to headers
 */
function parseTable(tableHtml) {
    const allRows = [];

    const trBlocks = extractTag(tableHtml, 'tr');

    for (const tr of trBlocks) {
        const ths = extractTag(tr, 'th').map(stripTags);
        const tds = extractTag(tr, 'td').map(stripTags);

        // Mammoth often renders all cells as <th> (inside <thead>),
        // so treat each <tr> as a row regardless of th vs td
        const cells = ths.length > 0 ? ths : tds;
        if (cells.length > 0) {
            allRows.push(cells);
        }
    }

    if (allRows.length === 0) {
        return { headers: [], rows: [] };
    }

    // First row becomes headers, rest become data rows
    const headers = allRows[0];
    const rows = allRows.slice(1);

    return { headers, rows };
}

// ─── list parser ────────────────────────────────────────────────────────────

function parseList(listHtml, ordered) {
    const items = extractTag(listHtml, 'li').map(stripTags);
    return { type: ordered ? 'ordered-list' : 'unordered-list', items };
}

// ─── main parser ────────────────────────────────────────────────────────────

/**
 * Extract all <img> tags from an HTML block.
 * Returns array of { src, contentType, alt } objects.
 */
function extractImages(html) {
    const images = [];
    const imgPattern = /<img\s[^>]*>/gi;
    let match;

    while ((match = imgPattern.exec(html)) !== null) {
        const tag = match[0];
        const srcMatch = tag.match(/src="([^"]+)"/i);
        const altMatch = tag.match(/alt="([^"]+)"/i);

        if (srcMatch) {
            const src = srcMatch[1];
            // Extract content type from data URI
            const typeMatch = src.match(/^data:([^;]+);base64,/);
            images.push({
                src,
                contentType: typeMatch ? typeMatch[1] : 'image/png',
                alt: altMatch ? altMatch[1] : ''
            });
        }
    }

    return images;
}

/**
 * Parse Mammoth HTML into an array of structured content nodes.
 *
 * Node types:
 *   { type: 'heading',  level: 1-6, text: string }
 *   { type: 'paragraph', text: string }
 *   { type: 'image',     src: string (base64 data URI), contentType: string, alt: string }
 *   { type: 'table',     headers: string[], rows: string[][] }
 *   { type: 'ordered-list',   items: string[] }
 *   { type: 'unordered-list', items: string[] }
 */
function parseHtmlToNodes(html) {
    const nodes = [];

    // First pass: extract standalone <img> tags (not inside block elements)
    // Mammoth places images as top-level elements, outside <p> tags
    const imgPattern = /<img\s[^>]*>/gi;
    const imgPositions = new Map(); // position → image node
    let imgMatch;
    while ((imgMatch = imgPattern.exec(html)) !== null) {
        const images = extractImages(imgMatch[0]);
        if (images.length > 0) {
            imgPositions.set(imgMatch.index, images[0]);
        }
    }

    // Second pass: match block elements and interleave images by position
    // Skip images that appear before the first heading (front page logo)
    const blockPattern = /<(h[1-6]|p|table|ul|ol)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
    let match;
    let lastEnd = 0;
    let seenHeading = false;

    while ((match = blockPattern.exec(html)) !== null) {
        // Emit any images that appear between the last block and this one
        for (const [pos, img] of imgPositions) {
            if (pos >= lastEnd && pos < match.index && seenHeading) {
                nodes.push({
                    type: 'image',
                    src: img.src,
                    contentType: img.contentType,
                    alt: img.alt || ''
                });
                imgPositions.delete(pos);
            }
        }
        lastEnd = match.index + match[0].length;

        const tag = match[1].toLowerCase();
        const block = match[0];

        if (/^h[1-6]$/.test(tag)) {
            seenHeading = true;
            const level = parseInt(tag[1], 10);
            const text = stripTags(block);
            if (text) nodes.push({ type: 'heading', level, text });
        } else if (tag === 'table') {
            const table = parseTable(block);
            if (table.headers.length > 0 || table.rows.length > 0) {
                nodes.push({ type: 'table', ...table });
            }
        } else if (tag === 'ul') {
            const list = parseList(block, false);
            if (list.items.length > 0) nodes.push(list);
        } else if (tag === 'ol') {
            const list = parseList(block, true);
            if (list.items.length > 0) nodes.push(list);
        } else if (tag === 'p') {
            // Check for embedded images in this paragraph
            const images = extractImages(block);
            const text = stripTags(block);

            // Emit text content before images (if any)
            if (text) nodes.push({ type: 'paragraph', text });

            // Emit each image as its own node
            for (const img of images) {
                nodes.push({
                    type: 'image',
                    src: img.src,
                    contentType: img.contentType,
                    alt: img.alt || text || ''
                });
            }
        }
    }

    // Emit any remaining images after the last block element
    for (const [pos, img] of imgPositions) {
        if (pos >= lastEnd && seenHeading) {
            nodes.push({
                type: 'image',
                src: img.src,
                contentType: img.contentType,
                alt: img.alt || ''
            });
        }
    }

    return nodes;
}

/**
 * Group flat nodes into a heading-based hierarchy.
 *
 * Returns an array of section objects:
 *   { heading: string, level: number, content: node[], children: section[] }
 */
function buildHierarchy(nodes) {
    const root = { heading: null, level: 0, content: [], children: [] };
    const stack = [root];

    for (const node of nodes) {
        if (node.type === 'heading') {
            const section = {
                heading: node.text,
                level: node.level,
                content: [],
                children: []
            };

            // Pop stack until we find a parent with a lower heading level
            while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
                stack.pop();
            }

            stack[stack.length - 1].children.push(section);
            stack.push(section);
        } else {
            // Attach content to the current section
            stack[stack.length - 1].content.push(node);
        }
    }

    if (root.children.length > 0) {
        // Include any content before the first heading as a preamble section
        if (root.content.length > 0) {
            return [{ heading: null, level: 0, content: root.content, children: [] }, ...root.children];
        }
        return root.children;
    }

    return [{ heading: null, level: 0, content: root.content, children: [] }];
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Convert a DOCX file to structured JSON.
 *
 * @param {string} filePath - Absolute path to the .docx file
 * @returns {Promise<Object>} Structured document:
 *   {
 *     fileName: string,
 *     convertedAt: ISO8601,
 *     nodeCount: number,
 *     nodes: node[],         // flat list of content nodes
 *     sections: section[]    // heading-based hierarchy
 *   }
 */
async function convertToJson(filePath) {
    // Use Mammoth's HTML output — preserves tables, headings, lists, and images
    const result = await mammoth.convertToHtml({ path: filePath }, {
        convertImage: mammoth.images.imgElement(function(image) {
            return image.read('base64').then(function(imageBase64) {
                return {
                    src: 'data:' + image.contentType + ';base64,' + imageBase64
                };
            });
        })
    });
    const html = result.value;
    const warnings = result.messages.filter(m => m.type === 'warning').map(m => m.message);

    const nodes = parseHtmlToNodes(html);
    const sections = buildHierarchy(nodes);

    return {
        fileName: path.basename(filePath),
        convertedAt: new Date().toISOString(),
        warnings: warnings.length > 0 ? warnings : undefined,
        nodeCount: nodes.length,
        nodes,
        sections
    };
}

/**
 * Check if a file is a DOCX file
 */
function isDocxFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.docx';
}

module.exports = {
    convertToJson,
    isDocxFile,
    // Expose internals for testing
    parseHtmlToNodes,
    buildHierarchy,
    parseTable,
    stripTags
};
