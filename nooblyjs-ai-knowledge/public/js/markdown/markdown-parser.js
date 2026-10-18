/**
* @fileoverview Custom Markdown Parser
* Extends marked.js with support for custom block types:
* - container (left/right sections)
* - hero-banner (title, subtitle, hero-image, hero-image-align properties)
*
* @author noobly Team
* @version 1.0.0
*/

class MarkdownParser {
constructor() {
this.customBlockTypes = ['header', 'footer', 'swagger', 'mermaid', 'three-column', 'two-col-3-1', 'two-col-1-3', 'container', 'hero-banner', 'landing-hero', 'cards', 'news', 'tiles', 'stories', 'cta', 'wiki-link', 'wiki-links', 'summary', 'accordion', 'tabs', 'menu', 'comments', 'annotation', 'user-content', 'reviews', 'sharedlinkvisits', 'liked', 'document', 'visualisation', 'pane', 'linked-documents', 'recent-changes', 'pinned-recent-changes', 'process-model'];
this.badgeVariants = new Set(['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark']);
MarkdownParser.installLinkRenderer_();
}

/**
* Install a marked.js renderer override (once per page) that styles every
* inline link with a small "open in" icon and a visible annotation showing
* where it points (destination filename for internal links, hostname for
* external URLs). Bare numeric or `[N]` link texts (footnote markers) are
* rendered as an icon-only pill so they read as a "jump" affordance
* instead of a meaningless number.
* @private
*/
static installLinkRenderer_() {
if (MarkdownParser._linkRendererInstalled) return;
if (typeof marked === 'undefined' || !marked.Renderer) return;

const renderer = new marked.Renderer();
const escape = (s) => String(s ?? '')
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Build the short annotation shown next to a link. For absolute URLs
// (http/https/mailto/tel) we show the host; for in-app paths we show the
// last path segment with any .md extension stripped.
const annotationFor = (href) => {
if (!href) return '';
const trimmed = String(href).trim();
if (!trimmed || trimmed.startsWith('#')) return '';
if (/^mailto:/i.test(trimmed)) return trimmed.slice(7).split('?')[0];
if (/^tel:/i.test(trimmed)) return trimmed.slice(4);
if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
try { return new URL(trimmed).host.replace(/^www\./, ''); }
catch (_) { /* fall through */ }
}
// Treat as a path; take the last segment.
const cleaned = trimmed.split('#')[0].split('?')[0].replace(/\/+$/, '');
const seg = cleaned.split('/').filter(Boolean).pop() || cleaned;
try { return decodeURIComponent(seg).replace(/\.md$/i, ''); }
catch (_) { return seg.replace(/\.md$/i, ''); }
};

renderer.link = function (href, title, text) {
const safeHref = escape(href || '');
const tooltip = title ? title : (href || '');
const safeTitle = escape(tooltip);

// Strip any HTML marked already produced (e.g. <em>) for the marker check.
const plain = String(text || '').replace(/<[^>]+>/g, '').trim();
const isFootnoteMarker = /^\d{1,3}$/.test(plain) || /^\[\s*\d{1,3}\s*\]$/.test(plain);

const icon = '<i class="bi bi-box-arrow-up-right kr-md-link-icon" aria-hidden="true"></i>';

if (isFootnoteMarker) {
return `<a class="kr-md-link kr-md-link-iconly" href="${safeHref}" title="${safeTitle}" aria-label="${escape(plain || tooltip)}">${icon}</a>`;
}

const annotation = annotationFor(href);
// Hide the annotation if it would just echo the visible link text.
const showAnnotation = annotation && annotation.toLowerCase() !== plain.toLowerCase();
const annotationHtml = showAnnotation
? `<span class="kr-md-link-annotation" aria-hidden="true">${escape(annotation)}</span>`
: '';

return `<a class="kr-md-link" href="${safeHref}" title="${safeTitle}"><span class="kr-md-link-text">${text}</span>${annotationHtml}${icon}</a>`;
};

// Embedded (base64 data-URI) images render at their natural size inside a
// scroll/zoom canvas — the same chrome mermaid diagrams get — so large
// solution screenshots stay readable instead of being squashed to fit the
// page. Ordinary linked images keep marked's default inline rendering.
renderer.image = function (href, title, text) {
const safeHref = escape(href || '');
const safeAlt = escape(text || '');
const titleAttr = title ? ` title="${escape(title)}"` : '';
const raw = String(href || '').trim();
const isEmbedded = /^data:image\//i.test(raw);
if (!isEmbedded) {
return `<img src="${safeHref}" alt="${safeAlt}"${titleAttr}>`;
}
// Short format badge from the data-URI mime (image/png -> PNG).
const mime = /^data:image\/([a-z0-9.+-]+)/i.exec(raw);
const fmt = mime
? mime[1].toUpperCase().replace('SVG+XML', 'SVG').replace('JPEG', 'JPG')
: 'IMG';
const caption = (text && text.trim())
? `<figcaption class="ki-caption">${safeAlt}</figcaption>`
: '';
return '<figure class="kr-image">'
+ '<div class="ki-head"><span class="lab"><i class="bi bi-image" aria-hidden="true"></i> '
+ `Embedded image <span class="badge">${escape(fmt)}</span></span></div>`
+ '<div class="ki-canvas">'
+ `<img class="ki-img" src="${safeHref}" alt="${safeAlt}"${titleAttr} draggable="false">`
+ '</div>'
+ caption
+ '</figure>';
};

marked.use({ renderer });
MarkdownParser._linkRendererInstalled = true;
}

/**
* Parse markdown text with custom blocks and standard markdown
* @param {string} markdown - Raw markdown text
* @returns {string} - Rendered HTML
*/
parse(markdown) {
if (!markdown) return '';

// Split content into blocks
const blocks = this.coalesceSharedLinkVisits(this.splitIntoBlocks(markdown));

// Process each block
let html = '';
blocks.forEach(block => {
if (block.type === 'custom') {
html += this.processCustomBlock(block.content, block.blockType);
} else if (block.type === 'markdown') {
// Pre-process inline badges before standard markdown so our spans
// survive marked's HTML pass-through.
const preprocessed = this.processBadges(block.content);
html += marked.parse(preprocessed);
}
});

// Wrap in .md-doc so the KR-Modern theme styles standard markdown elements
// (h1-h6, p, ul/ol, table, code, blockquote, hr, a, etc.). Custom blocks
// emit their own KR classes and aren't affected by the wrapper.
let wrapped = '<div class="md-doc">\n' + html + '\n</div>';

// A base64 image alone on its line becomes <p><figure class="kr-image">…</p>,
// but a block-level <figure> can't live inside a <p> — the browser would
// auto-close the paragraph and leave an empty one (extra gap). Lift any
// image figures out of the paragraph that wraps only them.
wrapped = wrapped.replace(
  /<p>(\s*(?:<figure class="kr-image">[\s\S]*?<\/figure>\s*)+)<\/p>/g,
  '$1'
);

// Final pass: assign anchor ids to headings, then expand any menu/TOC
// placeholders using the collected headings.
wrapped = this.processHeadingsAndMenu(wrapped);

return wrapped;
}

/**
* Collapse EVERY ```SharedLinkVisits``` block in a document into ONE, rendered
* at the position of the first.
*
* The append route (backend documentRoutes.js `share-visit`) intends a single
* rolling block, but a wholesale rewrite by a content workflow — or a hand
* edit — leaves extras behind, and the page then shows a stack of identical
* collapsed "Shared link visits" strips instead of one audit trail.
*
* Merging HERE as well as in the writer is deliberate: the page reads
* correctly while the duplicates are still on disk, and it also covers a
* document nothing has written to since. Entries are de-duplicated on the
* whole line, so two blocks holding the same visit (the observed shape —
* byte-identical timestamps repeated) collapse to one row, not two.
*
* @param {Array} blocks - Output of splitIntoBlocks
* @returns {Array} - Blocks with the visits blocks merged into the first
*/
coalesceSharedLinkVisits(blocks) {
const isVisits = (b) => b && b.type === 'custom' && b.blockType === 'sharedlinkvisits';

let firstIndex = -1;
let total = 0;
const seen = new Set();
const entries = [];

for (let i = 0; i < blocks.length; i++) {
if (!isVisits(blocks[i])) continue;
if (firstIndex === -1) firstIndex = i;
total++;
for (const raw of String(blocks[i].content || '').split(/\r?\n/)) {
const line = raw.trim();
if (!line || seen.has(line)) continue;
seen.add(line);
entries.push(line);
}
}

// Nothing to do for the overwhelmingly common single-block document.
if (total < 2) return blocks;

const out = [];
for (let i = 0; i < blocks.length; i++) {
if (!isVisits(blocks[i])) {
out.push(blocks[i]);
} else if (i === firstIndex) {
out.push(Object.assign({}, blocks[i], { content: entries.join('\n') }));
}
// Later visits blocks are dropped — their entries are already merged in.
}
return out;
}

/**
* Replace inline badge syntax `[badge:variant text]` with a Bootstrap 5
* `<span class="badge text-bg-{variant}">…</span>`. Unknown variants are
* left untouched. Runs before marked.parse, so badges work inside
* paragraphs, table cells, list items, etc.
* @param {string} text - Raw markdown text
* @returns {string} - Text with badge tokens replaced
*/
processBadges(text) {
if (!text) return text;
return text.replace(/\[badge:([a-z]+)\s+([^\]\n]+?)\]/gi, (match, variant, label) => {
const v = variant.toLowerCase();
if (!this.badgeVariants.has(v)) return match;
return `<span class="badge text-bg-${v} kr-inline-badge">${this.escapeHtml(label.trim())}</span>`;
});
}

/**
* Inject anchor ids on h1-h6 elements (slug from text) and replace any
* menu placeholders (emitted by renderMenu) with a hierarchical TOC built
* from the collected heading list. Works on the already-rendered HTML
* string so it sees BOTH standard-markdown headings AND any headings
* inside custom blocks.
* @param {string} html - Fully rendered HTML
* @returns {string} - HTML with heading ids and expanded TOCs
*/
processHeadingsAndMenu(html) {
const headings = [];
const slugCounts = new Map();

const slugify = (text) => {
const stripped = text.replace(/<[^>]+>/g, '').replace(/&[#\w]+;/g, ' ').trim().toLowerCase();
let slug = stripped.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
if (!slug) slug = 'section';
const count = (slugCounts.get(slug) || 0) + 1;
slugCounts.set(slug, count);
return count > 1 ? `${slug}-${count}` : slug;
};

html = html.replace(/<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
const text = inner.replace(/<[^>]+>/g, '').trim();
if (!text) return m;
const idMatch = attrs.match(/\bid\s*=\s*"([^"]+)"/i);
let id;
if (idMatch) {
id = idMatch[1];
slugCounts.set(id, (slugCounts.get(id) || 0) + 1);
} else {
id = slugify(text);
attrs = ` id="${id}"` + attrs;
}
headings.push({ level: parseInt(tag[1], 10), text, id });
return `<${tag}${attrs}>${inner}</${tag}>`;
});

html = html.replace(/<div class="menu-toc-placeholder"[^>]*><\/div>/g, () =>
this.buildMenuHtml(headings)
);

return html;
}

/**
* Build the TOC HTML from a list of {level, text, id} entries. Levels
* below the smallest are indented relative to the smallest seen.
* @param {Array} headings
* @returns {string}
*/
buildMenuHtml(headings) {
if (!headings || headings.length === 0) {
return '<aside class="menu-toc"><div class="menu-toc-title">On this page</div><div class="menu-toc-empty">No headings found</div></aside>';
}
const baseLevel = Math.min(...headings.map(h => h.level));
const items = headings.map(h => {
const indent = Math.max(0, h.level - baseLevel);
return `    <li class="menu-toc-item menu-toc-indent-${indent}"><a href="#${h.id}">${this.escapeHtml(h.text)}</a></li>`;
}).join('\n');
return `<aside class="menu-toc">
  <div class="menu-toc-title">On this page</div>
  <ul class="menu-toc-list">
${items}
  </ul>
</aside>`;
}

/**
* Split markdown into blocks (custom and standard markdown)
* Supports both indentation-based syntax and code fence syntax (```blockType)
* @param {string} markdown - Raw markdown text
* @returns {Array} - Array of block objects {type, content, blockType}
*/
splitIntoBlocks(markdown) {
const blocks = [];
const lines = markdown.split('\n');
let currentBlock = '';
let blockType = null;
let isCustomBlock = false;

for (let i = 0; i < lines.length; i++) {
const line = lines[i];
const trimmedLine = line.trim();

// Check if line starts a code fence with a custom block type
const codeFenceMatch = this.isCodeFenceStart(trimmedLine);
if (codeFenceMatch) {
// Save previous markdown block if exists
if (currentBlock.trim()) {
blocks.push({
type: 'markdown',
content: currentBlock.trim()
});
currentBlock = '';
}

// Extract code fence block
const codeFenceContent = this.extractCodeFenceBlock(lines, i);

if (codeFenceContent.isCustomBlock) {
// This is a custom block
blocks.push({
type: 'custom',
content: codeFenceContent.content,
blockType: codeFenceContent.blockType
});
} else {
// Regular code block - include the fence in markdown
currentBlock += line + '\n';
// Add content until closing fence
for (let j = i + 1; j <= codeFenceContent.endLine; j++) {
currentBlock += lines[j] + '\n';
}
}

// Skip lines that were part of code fence
i = codeFenceContent.endLine;
continue;
}

// Check if line starts an indentation-based custom block
const customBlockMatch = this.isCustomBlockStart(trimmedLine);
if (customBlockMatch) {
// Save previous markdown block if exists
if (currentBlock.trim()) {
blocks.push({
type: 'markdown',
content: currentBlock.trim()
});
currentBlock = '';
}

// Start custom block
isCustomBlock = true;
blockType = customBlockMatch;
const customContent = this.extractCustomBlock(lines, i);

blocks.push({
type: 'custom',
content: customContent.content,
blockType: blockType
});

// Skip lines that were part of custom block
i = customContent.endLine;
} else {
// Regular markdown line
currentBlock += line + '\n';
}
}

// Save remaining markdown block
if (currentBlock.trim()) {
blocks.push({
type: 'markdown',
content: currentBlock.trim()
});
}

return this.stripFrontmatterDelimiters(blocks);
}

/**
* Strip `---` lines that are acting as YAML-frontmatter delimiters
* immediately before or after a custom block. Authors often wrap
* header/hero-banner/footer custom blocks like:
*
*   ---
*   header:
*     ...
*   hero-banner:
*     ...
*   ---
*
* Without stripping, marked.parse emits an <hr> for each `---`. We
* only strip delimiters that are adjacent to a custom block — standalone
* `---` lines in the middle of body content are left intact and will
* still render as horizontal rules per CommonMark.
* @param {Array} blocks
* @returns {Array}
*/
stripFrontmatterDelimiters(blocks) {
const isHrLine = (l) => /^\s*---+\s*$/.test(l);
for (let i = 0; i < blocks.length; i++) {
const b = blocks[i];
if (b.type !== 'markdown') continue;
const prev = blocks[i - 1];
const next = blocks[i + 1];
let lines = b.content.split('\n');
// Trailing edge: about to enter a custom block.
if (next && next.type === 'custom') {
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
if (lines.length && isHrLine(lines[lines.length - 1])) {
lines.pop();
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
}
}
// Leading edge: just exited a custom block.
if (prev && prev.type === 'custom') {
while (lines.length && lines[0].trim() === '') lines.shift();
if (lines.length && isHrLine(lines[0])) {
lines.shift();
while (lines.length && lines[0].trim() === '') lines.shift();
}
}
b.content = lines.join('\n').trim();
}
return blocks.filter(b => b.type !== 'markdown' || b.content);
}

/**
* Check if a line starts a code fence (``` or ~~~)
* Returns the language identifier if it's a known custom block type
* @param {string} line - Line to check
* @returns {string|null} - Language identifier or null
*/
isCodeFenceStart(line) {
const codeFenceRegex = /^(`{3,}|~{3,})([a-zA-Z0-9\-_]*)$/;
const match = line.match(codeFenceRegex);
if (match) {
return match[2] || ''; // Return the language identifier
}
return null;
}

/**
* Extract content from a code fence block
* @param {Array} lines - All lines
* @param {number} startLine - Starting line index
* @returns {Object} - {content, endLine, blockType, isCustomBlock}
*/
extractCodeFenceBlock(lines, startLine) {
const fenceLine = lines[startLine].trim();
const fenceChar = fenceLine[0]; // ` or ~
const fenceLength = fenceLine.match(/^(`+|~+)/)[0].length;
const languageId = fenceLine.substring(fenceLength).trim();

const isCustomBlock = this.customBlockTypes.includes(languageId.toLowerCase());

const blockLines = [];
let endLine = startLine;
let closed = false;

// Extract lines until closing fence
for (let i = startLine + 1; i < lines.length; i++) {
const line = lines[i];
const trimmed = line.trim();

// Check for closing fence
if (trimmed.match(new RegExp(`^${fenceChar}{${fenceLength},}$`))) {
endLine = i;
closed = true;
break;
}

blockLines.push(line);
endLine = i;
}

// If the fence was never closed (malformed / truncated document), the block
// body still runs to the end of the document. endLine now points at the last
// consumed line so the main parse loop skips the body instead of re-emitting
// it as plain markdown (which produced the raw, unstyled text output).
if (!closed && typeof console !== 'undefined' && console.warn) {
console.warn(
`Unterminated \`\`\`${languageId} fence starting at line ${startLine + 1}; ` +
`treating the rest of the document as the block body.`
);
}

const content = blockLines.join('\n');

return {
content: content,
endLine: endLine,
blockType: languageId.toLowerCase(),
isCustomBlock: isCustomBlock,
closed: closed
};
}

/**
* Block types that are recognised ONLY as a ```fence, never by the
* indentation-based prefix rule. Their names are ordinary English words, so
* prefix detection would swallow any paragraph that happens to open with
* "Document…", "News…", "Stories…" or similar and silently delete it from
* the rendered page.
* @type {Set<string>}
*/
static FENCE_ONLY_BLOCKS = new Set([
'document', 'visualisation', 'pane', 'linked-documents',
'recent-changes', 'pinned-recent-changes',
'landing-hero', 'news', 'tiles', 'stories', 'cta',
'process-model'
]);

/**
* Check if a line starts a custom block
* @param {string} line - Line to check
* @returns {string|null} - Block type or null
*/
isCustomBlockStart(line) {
for (const blockType of this.customBlockTypes) {
if (MarkdownParser.FENCE_ONLY_BLOCKS.has(blockType)) continue;
if (line.toLowerCase().startsWith(blockType)) {
return blockType;
}
}
return null;
}

/**
* Extract custom block content from lines
* @param {Array} lines - All lines
* @param {number} startLine - Starting line index
* @returns {Object} - {content, endLine}
*/
extractCustomBlock(lines, startLine) {
const blockLines = [lines[startLine].trim()];
let endLine = startLine;

// Extract indented content following the block type
for (let i = startLine + 1; i < lines.length; i++) {
const line = lines[i];

// Stop if we hit a line that's not indented and not empty
if (line.trim() === '') {
// Empty line might be part of block or separator
if (i + 1 < lines.length && !lines[i + 1].match(/^\s+/)) {
endLine = i;
break;
}
blockLines.push('');
} else if (line.match(/^\s+/)) {
// Indented line - part of the block
blockLines.push(line);
endLine = i;
} else {
// Non-indented, non-empty line - end of block
endLine = i - 1;
break;
}
}

return {
content: blockLines.join('\n'),
endLine: endLine
};
}

/**
* Process custom block types
* @param {string} content - Block content
* @param {string} blockType - Type of block
* @returns {string} - Rendered HTML
*/
processCustomBlock(content, blockType) {
if (blockType === 'header') {
return this.renderHeader(content);
} else if (blockType === 'footer') {
return this.renderFooter(content);
} else if (blockType === 'swagger') {
return this.renderSwagger(content);
} else if (blockType === 'mermaid') {
return this.renderMermaid(content);
} else if (blockType === 'three-column') {
return this.renderThreeColumn(content);
} else if (blockType === 'two-col-3-1') {
return this.renderTwoCol3_1(content);
} else if (blockType === 'two-col-1-3') {
return this.renderTwoCol1_3(content);
} else if (blockType === 'container') {
return this.renderContainer(content);
} else if (blockType === 'hero-banner') {
return this.renderHeroBanner(content);
} else if (blockType === 'landing-hero') {
return this.renderLandingHero(content);
} else if (blockType === 'cards') {
return this.renderCards(content);
} else if (blockType === 'news') {
return this.renderNews(content);
} else if (blockType === 'tiles') {
return this.renderTiles(content);
} else if (blockType === 'stories') {
return this.renderStories(content);
} else if (blockType === 'cta') {
return this.renderCta(content);
} else if (blockType === 'wiki-link' || blockType === 'wiki-links') {
return this.renderWikiLink(content);
} else if (blockType === 'summary') {
return this.renderSummary(content);
} else if (blockType === 'accordion') {
return this.renderAccordion(content);
} else if (blockType === 'tabs') {
return this.renderTabs(content);
} else if (blockType === 'menu') {
return this.renderMenu(content);
} else if (blockType === 'comments') {
return this.renderComments(content);
} else if (blockType === 'annotation') {
return this.renderAnnotation(content);
} else if (blockType === 'user-content') {
return this.renderUserContent(content);
} else if (blockType === 'reviews') {
return this.renderReviews(content);
} else if (blockType === 'sharedlinkvisits') {
return this.renderSharedLinkVisits(content);
} else if (blockType === 'liked') {
return this.renderLiked(content);
} else if (blockType === 'document') {
return this.renderDocument(content);
} else if (blockType === 'visualisation') {
return this.renderVisualisation(content);
} else if (blockType === 'pane') {
return this.renderPane(content);
} else if (blockType === 'linked-documents') {
return this.renderLinkedDocuments(content);
} else if (blockType === 'recent-changes') {
return this.renderRecentChanges(content);
} else if (blockType === 'pinned-recent-changes') {
return this.renderPinnedRecentChanges(content);
} else if (blockType === 'process-model') {
return this.renderProcessModel(content);
}
return '';
}

/**
* Render a `process-model` block (NooblyJS Phase 8). The block's key/value lines say
* where the page sits in the enterprise process model (level, code, band,
* parent). The model itself — its bands, this page's parents and children, and
* the NooblyJS items that use it — is drawn by processModelController, which asks
* the server for it: the picture depends on OTHER pages, and on which of them
* the reader may open. Only the level and the code are shown until then.
* @param {string} content - Block body
* @returns {string} HTML placeholder
*/
renderProcessModel(content) {
let level = '';
let code = '';
String(content || '').split('\n').forEach(line => {
const m = line.trim().match(/^([\w-]+)\s*:\s*(.*)$/);
if (!m) return;
const key = m[1].toLowerCase();
if (key === 'level') level = m[2].trim();
if (key === 'code') code = m[2].trim();
});
const label = [level, code].filter(Boolean).map(v => this.escapeHtml(v)).join(' · ') || 'Process model';
return '<section class="kr-process-model" data-process-model-placeholder aria-label="Process model">\n' +
'  <p class="kr-process-model-loading">' + label + '</p>\n' +
'</section>\n';
}

/**
* Render a `document` block. The document block describes the document object
* itself (name, space, path, owner, …) as editable key/value metadata. It is
* deliberately NOT rendered into the reading view — readers should never see
* the raw metadata. Use {@link extractDocumentMeta} to read the values out for
* programmatic use (breadcrumbs, ownership badges, etc.).
* @param {string} _content - Block content (ignored for rendering)
* @returns {string} - Always an empty string
*/
renderDocument(_content) {
return '';
}

/**
* Render a `visualisation` block. The block body holds ONLY layout data
* (@canvas / @item / @connect lines) that references the document's own
* heading sections — the parser emits an inert placeholder and the wiki's
* visualisationController hydrates it into an interactive canvas after the
* document HTML is inserted (it needs the raw document source for section
* extraction and write-back, which the parser doesn't have). In contexts
* without a hydrator (e.g. folder previews) the placeholder stays as a
* quiet labelled box instead of leaking raw layout lines.
* @param {string} _content - Block content (read by the hydrator from source)
* @returns {string} - Placeholder HTML
*/
renderVisualisation(_content) {
return '<div class="kr-visualisation" data-vis-placeholder>\n' +
'  <div class="vis-placeholder"><i class="bi bi-diagram-3"></i> Visualisation</div>\n' +
'</div>\n';
}

/**
* Render a `pane` block. A pane embeds another wiki document inline:
*
*   ```pane
*   source: [Space Name]/path/to/file.md
*   clickout: true
*   ```
*
* The parser has no access to other documents, so it emits an inert
* placeholder carrying the source/clickout props as data attributes; the
* wiki's paneController fetches the source markdown and hydrates it after
* the host document HTML is inserted. In contexts without a hydrator
* (folder previews) the placeholder stays as a quiet labelled box.
* @param {string} content - Block body (`source:` / `clickout:` lines)
* @returns {string} - Placeholder HTML
*/
renderPane(content) {
let source = '';
let clickout = false;
String(content || '').split('\n').forEach(line => {
const m = line.trim().match(/^([\w-]+)\s*:\s*(.*)$/);
if (!m) return;
const key = m[1].toLowerCase();
if (key === 'source') source = m[2].trim();
if (key === 'clickout') clickout = /^true$/i.test(m[2].trim());
});
const label = source ? this.escapeHtml(source) : 'No source set';
return '<div class="kr-pane" data-pane-placeholder' +
' data-pane-source="' + this.escapeHtml(source) + '"' +
' data-pane-clickout="' + (clickout ? 'true' : 'false') + '">\n' +
'  <div class="pane-placeholder"><i class="bi bi-layout-text-window-reverse"></i> Pane <code>' + label + '</code></div>\n' +
'</div>\n';
}

/**
* Parse a `linked-documents` block body.
*
*   ```linked-documents
*   title: Related landscapes
*   across: 4
*    - [Engineering Space]/Solution Design/Application Landscapes
*    - Sell/Promotions/overview.md | Promotions overview
*   ```
*
* Block-level `key: value` lines configure the section; every line opening
* with `-` is one linked item. An item is a reference — `[Space]/path` or a
* bare space-relative path — with an optional display label after ` | `.
* Anything else is kept in `extras` so a write-back never eats a line it
* did not understand.
*
* @param {string} content - Block body
* @returns {{title:string, across:number, items:Array<{ref:string,label:string}>, extras:Array<string>}}
*/
parseLinkedDocuments(content) {
const result = { title: '', across: 0, items: [], extras: [] };
String(content || '').split('\n').forEach(line => {
const trimmed = line.trim();
if (!trimmed || trimmed.toLowerCase() === 'linked-documents') return;
if (trimmed.startsWith('-')) {
const body = trimmed.replace(/^-\s*/, '').trim();
if (!body) return;
const bar = body.indexOf('|');
const ref = (bar === -1 ? body : body.slice(0, bar)).trim();
const label = bar === -1 ? '' : body.slice(bar + 1).trim();
if (ref) result.items.push({ ref, label });
return;
}
const m = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
if (!m) { result.extras.push(line); return; }
const key = m[1].toLowerCase();
if (key === 'title') { result.title = m[2].trim(); return; }
if (key === 'across') { result.across = parseInt(m[2], 10) || 0; return; }
result.extras.push(line);
});
return result;
}

/**
* Render a `linked-documents` block — the relationship section: a titled
* band of cards, one per linked wiki document or folder.
*
* Like `pane`, the parser cannot reach other documents, so it emits the
* refs as markup the wiki's linkedDocumentsController hydrates into real
* cards (cover preview, title, item count, updated date) after the host
* document's HTML is inserted. The un-hydrated markup is deliberately a
* readable list of links rather than an inert box, because contexts with no
* hydrator — the Chrome extension side panel, folder card previews — render
* the parser's output as-is and would otherwise show nothing at all.
*
* @param {string} content - Block body (see {@link parseLinkedDocuments})
* @returns {string} - Placeholder HTML
*/
renderLinkedDocuments(content) {
const parsed = this.parseLinkedDocuments(content);
const heading = parsed.title || 'Linked documents';
const collapseId = 'linkedDocsSection_' + Math.random().toString(36).substr(2, 9);
if (!parsed.items.length) {
return '<section class="kr-linked-docs is-empty" data-linked-docs-placeholder>\n'
+ '  <h2 class="kr-linked-docs-title" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px;">'
+ this.escapeHtml(heading)
+ ' <i class="bi bi-chevron-down" style="margin-left: auto; font-size: 12px; transition: transform 0.3s;"></i></h2>\n'
+ '  <div id="' + collapseId + '" class="collapse">\n'
+ '    <div class="kr-linked-docs-note">Nothing linked yet.</div>\n'
+ '  </div>\n'
+ '</section>\n';
}
const cards = parsed.items.map((item, index) => {
// Fallback label: the last path segment, which is the folder or file
// name a reader would recognise.
const bare = item.ref.replace(/\\/g, '/').replace(/^\[[^\]]*\]\s*\/?\s*/, '');
const name = item.label || bare.split('/').filter(Boolean).pop() || item.ref;
return '  <article class="kr-linked-doc" data-linked-ref="' + this.escapeHtml(item.ref) + '"'
+ ' data-linked-label="' + this.escapeHtml(item.label) + '"'
+ ' data-linked-index="' + index + '">\n'
+ '    <div class="kr-linked-doc-fallback">' + this.escapeHtml(name)
+ ' <span class="kr-linked-doc-ref">' + this.escapeHtml(item.ref) + '</span></div>\n'
+ '  </article>';
}).join('\n');
const style = parsed.across > 0 ? ' style="--kr-linked-cols:' + parsed.across + '"' : '';
return '<section class="kr-linked-docs" data-linked-docs-placeholder'
+ (parsed.across > 0 ? ' data-linked-across="' + parsed.across + '"' : '') + '>\n'
+ '  <h2 class="kr-linked-docs-title" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px;">'
+ this.escapeHtml(heading)
+ ' <i class="bi bi-chevron-down" style="margin-left: auto; font-size: 12px; transition: transform 0.3s;"></i></h2>\n'
+ '  <div id="' + collapseId + '" class="collapse">\n'
+ '    <div class="kr-linked-docs-grid"' + style + '>\n' + cards + '\n    </div>\n'
+ '  </div>\n'
+ '</section>\n';
}

/**
* Extract the first `linked-documents` block of a markdown string without
* rendering the page. Mirrors {@link extractDocumentMeta}; returns null when
* the document has no such block.
* @param {string} markdown - Raw markdown text
* @returns {{title:string, across:number, items:Array, extras:Array}|null}
*/
extractLinkedDocuments(markdown) {
if (!markdown) return null;
const blocks = this.splitIntoBlocks(markdown);
for (const block of blocks) {
if (block.type === 'custom' && block.blockType === 'linked-documents') {
return this.parseLinkedDocuments(block.content);
}
}
return null;
}

/**
* Defaults for a `recent-changes` block, shared with the block editor so a
* value the author never typed reads the same on both sides.
* @type {{days:number, limit:number, maxLimit:number}}
*/
static RECENT_DEFAULTS = { days: 30, limit: 8, maxLimit: 60 };

/**
* Turn a `days:` / `period:` value into a whole number of days.
*
* Accepts a bare number (days), a number with a unit suffix — `14d`, `4w`,
* `6m`, `1y` — or `all` for no time limit at all (returned as 0). Anything
* unparseable falls back rather than throwing: a typo in a landing page
* should show the default window, not break the page.
*
* @param {string|number} raw
* @param {number} [fallback=30]
* @returns {number} days, or 0 for "all time"
*/
static periodToDays(raw, fallback = MarkdownParser.RECENT_DEFAULTS.days) {
const s = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
if (!s) return fallback;
if (s === 'all' || s === 'any' || s === 'ever') return 0;
const m = s.match(/^(\d+(?:\.\d+)?)\s*(d|w|m|y)?(?:ay|eek|onth|ear)?s?$/);
if (!m) return fallback;
const n = parseFloat(m[1]);
if (!Number.isFinite(n) || n < 0) return fallback;
// Zero is a choice, not a typo: it is how "all time" is written numerically,
// and it round-trips with the `all` keyword above.
if (n === 0) return 0;
const unit = m[2] || 'd';
const multiplier = unit === 'w' ? 7 : unit === 'm' ? 30 : unit === 'y' ? 365 : 1;
return Math.max(1, Math.round(n * multiplier));
}

/**
* Parse a `recent-changes` block body.
*
*   ```recent-changes
*   title: Recently updated
*   folder: Business Processes
*   days: 30
*   limit: 8
*   across: 4
*   ```
*
* Block-level `key: value` lines only — there are no authored items, because
* the items ARE the answer the server gives. `folder:` is required and may
* carry a `[Space Name]/` prefix (which is what the editor's folder picker
* writes), so the space can be named either there or in its own `space:`
* line. Lines this does not understand survive in `extras` so a write-back
* never eats something hand-authored.
*
* @param {string} content - Block body
* @param {string} [keyword='recent-changes'] - block name to ignore as a line
* @returns {{title:string, folder:string, space:string, days:number,
*            limit:number, across:number, extras:Array<string>}}
*/
parseRecentChanges(content, keyword = 'recent-changes') {
const defaults = MarkdownParser.RECENT_DEFAULTS;
const result = {
title: '', folder: '', space: '',
days: defaults.days, limit: defaults.limit, across: 0, extras: []
};

const setFolder = (value) => {
let ref = String(value || '').trim().replace(/\\/g, '/');
const spaced = ref.match(/^\[([^\]]*)\]\s*\/?\s*(.*)$/);
if (spaced) {
result.space = spaced[1].trim();
ref = spaced[2];
}
result.folder = ref.replace(/^\/+|\/+$/g, '').trim();
};

String(content || '').split(/\r?\n/).forEach(line => {
const trimmed = line.trim();
if (!trimmed || trimmed.toLowerCase() === keyword) return;
const m = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
if (!m) { result.extras.push(line); return; }
const key = m[1].toLowerCase();
const value = m[2].trim();
if (key === 'title') { result.title = value; return; }
if (key === 'folder') { setFolder(value); return; }
if (key === 'space') { result.space = value.replace(/^\[|\]$/g, '').trim(); return; }
if (key === 'days' || key === 'period') {
result.days = MarkdownParser.periodToDays(value, defaults.days);
return;
}
if (key === 'limit') {
const n = parseInt(value, 10);
result.limit = Number.isFinite(n) && n > 0
? Math.min(n, defaults.maxLimit)
: defaults.limit;
return;
}
if (key === 'across') { result.across = parseInt(value, 10) || 0; return; }
result.extras.push(line);
});

return result;
}

/**
* Render a `recent-changes` block — a grid of whatever changed most recently
* in one folder and everything beneath it.
*
* Like `pane` and `linked-documents`, the parser has no way to read the file
* system, so it emits the block's settings as data attributes and the wiki's
* recentChangesController fetches the answer and paints the cards. The
* un-hydrated markup is a readable sentence rather than an inert box,
* because contexts with no hydrator — the Chrome extension side panel,
* folder card previews — render the parser's output as-is.
*
* @param {string} content - Block body (see {@link parseRecentChanges})
* @returns {string} - Placeholder HTML
*/
renderRecentChanges(content) {
const cfg = this.parseRecentChanges(content, 'recent-changes');
const where = cfg.space ? `[${cfg.space}]/${cfg.folder}` : cfg.folder;
return this.recentChangesPlaceholder_(cfg, {
source: 'folder',
heading: cfg.title || 'Recent changes',
note: cfg.folder
? `The ${cfg.limit} most recently changed items in ${where}, over ${this.recentPeriodLabel_(cfg.days)}.`
: 'No folder set — edit this block and choose a folder.'
});
}

/**
* Render a `pinned-recent-changes` block — the same activity grid, but scoped
* to whatever the READER has pinned rather than to a folder the author named.
*
*   ```pinned-recent-changes
*   title: Changes in your interests
*   days: 30
*   limit: 8
*   ```
*
* Deliberately has no `folder:` — that is the entire difference between the
* two blocks, and it makes this one PER-READER: the same page shows each
* person their own pins. It follows that the block cannot be cached or
* pre-rendered per page, and that it is slower (several folder subtrees
* instead of one), which is why its hydrator paints skeleton cards rather
* than a line of text while it waits.
*
* @param {string} content - Block body (see {@link parseRecentChanges})
* @returns {string} - Placeholder HTML
*/
renderPinnedRecentChanges(content) {
const cfg = this.parseRecentChanges(content, 'pinned-recent-changes');
return this.recentChangesPlaceholder_(cfg, {
source: 'pins',
heading: cfg.title || 'Changes in your interests',
note: `The ${cfg.limit} most recently changed items in your pinned folders, `
+ `over ${this.recentPeriodLabel_(cfg.days)}.`
});
}

/**
* "the last 30 days" / "all time" — the period as a reader would say it.
* @param {number} days - 0 means no window
* @returns {string}
* @private
*/
recentPeriodLabel_(days) {
return days > 0 ? `the last ${days} day${days === 1 ? '' : 's'}` : 'all time';
}

/**
* The shared placeholder both activity blocks emit.
*
* Neither can be rendered here — one needs the file system, the other needs
* the reader's own pins — so the parser's job is to hand the settings to
* recentChangesController as data attributes. `data-recent-source` is what
* tells the hydrator which of the two it is holding.
*
* The visible content is a readable sentence rather than an inert box,
* because contexts with no hydrator (the Chrome extension side panel, folder
* cover previews) render this output as-is.
*
* @param {Object} cfg - parsed block settings
* @param {Object} opts - {source, heading, note}
* @returns {string} - Placeholder HTML
* @private
*/
recentChangesPlaceholder_(cfg, opts) {
const style = cfg.across > 0 ? ` style="--kr-recent-cols:${cfg.across}"` : '';
const pinned = opts.source === 'pins';

return '<section class="kr-recent' + (pinned ? ' kr-recent-pinned' : '') + '" data-recent-placeholder'
+ ' data-recent-source="' + this.escapeHtml(opts.source) + '"'
+ ' data-recent-folder="' + this.escapeHtml(cfg.folder) + '"'
+ ' data-recent-space="' + this.escapeHtml(cfg.space) + '"'
+ ' data-recent-days="' + cfg.days + '"'
+ ' data-recent-limit="' + cfg.limit + '"'
+ (cfg.across > 0 ? ' data-recent-across="' + cfg.across + '"' : '')
+ '>\n'
+ '  <h2 class="kr-recent-title">' + this.escapeHtml(opts.heading) + '</h2>\n'
+ '  <div class="kr-recent-grid"' + style + '>\n'
+ '    <div class="kr-recent-note">' + this.escapeHtml(opts.note) + '</div>\n'
+ '  </div>\n'
+ '</section>\n';
}

/**
* Parse a `document` block body into an ordered list of {key, value} pairs.
* Each non-empty line is split on the first colon, e.g. `owner: a@b` →
* { key: 'owner', value: 'a@b' }. Lines without a colon are ignored.
* @param {string} content
* @returns {Array<{key:string, value:string}>}
*/
parseDocumentProperties(content) {
const pairs = [];
if (!content) return pairs;
content.split('\n').forEach(line => {
const trimmed = line.trim();
if (!trimmed || trimmed.toLowerCase() === 'document') return;
const idx = trimmed.indexOf(':');
if (idx === -1) return;
const key = trimmed.slice(0, idx).trim();
const value = trimmed.slice(idx + 1).trim();
if (key) pairs.push({ key, value });
});
return pairs;
}

/**
* Extract the metadata of the first `document` block in a markdown string as a
* plain object keyed by (lower-cased) property name. Returns null if there is
* no document block. Mirrors {@link extractSummary} so hosts can pull document
* metadata without rendering the page.
* @param {string} markdown - Raw markdown text
* @returns {Object<string,string>|null}
*/
extractDocumentMeta(markdown) {
if (!markdown) return null;
const blocks = this.splitIntoBlocks(markdown);
for (const block of blocks) {
if (block.type === 'custom' && block.blockType === 'document') {
const meta = {};
this.parseDocumentProperties(block.content).forEach(({ key, value }) => {
meta[key.toLowerCase()] = value;
});
return meta;
}
}
return null;
}

/**
* Parse a `comments` block body into a list of {comment, commentor, date}
* entries. Entries are separated by a line containing only "---".
* Within each entry, lines like "Comment: ...", "Commentor: ...", and
* "Date: ..." set the corresponding fields. The Comment field can span
* multiple lines until the next field or separator is reached.
* @param {string} content
* @returns {Array<{comment:string, commentor:string, date:string}>}
*/
parseCommentEntries(content) {
const entries = [];
if (!content) return entries;
const lines = content.split('\n');
let current = null;
let activeField = null;

const isSeparator = (line) => /^\s*---+\s*$/.test(line);
const startEntry = () => { current = { comment: '', commentor: '', date: '' }; activeField = 'comment'; };

for (const line of lines) {
if (isSeparator(line)) {
if (current && (current.comment || current.commentor || current.date)) {
entries.push(current);
}
current = null;
activeField = null;
continue;
}

const fieldMatch = line.match(/^\s*(Comment|Commentor|Date)\s*:\s*(.*)$/i);
if (fieldMatch) {
if (!current) startEntry();
const field = fieldMatch[1].toLowerCase();
const value = fieldMatch[2];
if (field === 'comment') { current.comment = value; activeField = 'comment'; }
else if (field === 'commentor') { current.commentor = value.trim(); activeField = 'commentor'; }
else if (field === 'date') { current.date = value.trim(); activeField = 'date'; }
continue;
}

// Continuation line — append to the active field (only meaningful for
// multi-line comment text).
if (current && activeField === 'comment') {
current.comment = current.comment ? current.comment + '\n' + line : line;
}
}

if (current && (current.comment || current.commentor || current.date)) {
entries.push(current);
}
return entries;
}

/**
* Render a comments block as a comments panel with an add-comment form.
* The form is marked with `data-comments-form` so the host wiki can wire
* the submit handler at runtime (the parser doesn't know how to persist).
* @param {string} content
* @returns {string}
*/
renderComments(content) {
const entries = this.parseCommentEntries(content);
const collapseId = 'commentsSection_' + Math.random().toString(36).substr(2, 9);
let html = '<section class="kr-comments" data-comments-block>\n';
html += '  <header class="kr-comments-head" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" style="cursor: pointer; user-select: none; display: flex; align-items: center; gap: 8px;">\n';
html += '    <i class="bi bi-chat-left-text"></i>\n';
html += '    <strong>Comments</strong>\n';
html += `    <span class="kr-comments-count">${entries.length}</span>\n`;
html += '    <i class="bi bi-chevron-down" style="margin-left: auto; font-size: 12px; transition: transform 0.3s;"></i>\n';
html += '  </header>\n';
html += '  <div id="' + collapseId + '" class="collapse" data-comments-content>\n';
html += '    <form class="kr-comments-form" data-comments-form>\n';
html += '      <textarea class="kr-comments-input" data-comments-input rows="3" placeholder="Write a comment…" required></textarea>\n';
html += '      <div class="kr-comments-form-row">\n';
html += '        <small class="kr-comments-help">Posted as the logged-in user. Newest comment appears first.</small>\n';
html += '        <button type="submit" class="btn btn-primary btn-sm" data-comments-submit><i class="bi bi-send"></i> Post comment</button>\n';
html += '      </div>\n';
html += '      <div class="kr-comments-status" data-comments-status></div>\n';
html += '    </form>\n';

if (entries.length === 0) {
html += '    <div class="kr-comments-empty">No comments yet. Be the first to add one.</div>\n';
} else {
html += '    <ul class="kr-comments-list">\n';
for (const e of entries) {
const who = String(e.commentor || '').trim();
const initial = (who || '?').charAt(0).toUpperCase();
// Commentors are stored as emails — try their uploaded profile picture and
// fall back to the initial when none exists (the 404 removes the img).
const avatarImg = who.indexOf('@') > 0
? `<img src="/applications/wiki/avatars/${encodeURIComponent(who)}" alt="" onerror="this.remove()">`
: '';
html += '      <li class="kr-comment">\n';
html += '        <div class="kr-comment-meta">\n';
html += `          <span class="kr-comment-avatar" aria-hidden="true">${this.escapeHtml(initial)}${avatarImg}</span>\n`;
html += `          <span class="kr-comment-author">${this.escapeHtml(e.commentor || 'Unknown')}</span>\n`;
html += `          <span class="kr-comment-date">${this.escapeHtml(e.date || '')}</span>\n`;
html += '        </div>\n';
html += `        <div class="kr-comment-body">${this.escapeHtml(e.comment || '').replace(/\n/g, '<br>')}</div>\n`;
html += '      </li>\n';
}
html += '    </ul>\n';
}

html += '  </div>\n';
html += '</section>\n';
return html;
}

/**
* Parse an ```annotation``` block body into its fields.
* @param {string} content
* @returns {Object} { targetRaw, annotation, annotator, date, id }
*/
parseAnnotationEntry(content) {
let targetRaw = '', type = '', annotation = null, annotator = '', date = '', id = '', collecting = false;
for (const line of String(content || '').split(/\r?\n/)) {
const mt = line.match(/^Target:\s?(.*)$/);
const mty = line.match(/^Type:\s?(.*)$/);
const ma = line.match(/^Annotation:\s?(.*)$/);
const mu = line.match(/^Annotator:\s?(.*)$/);
const md = line.match(/^Date:\s?(.*)$/);
const mi = line.match(/^Id:\s?(.*)$/);
if (mt) { targetRaw = mt[1].trim(); collecting = false; }
else if (mty) { type = mty[1].trim(); collecting = false; }
else if (ma) { annotation = ma[1]; collecting = true; }
else if (mu) { annotator = mu[1].trim(); collecting = false; }
else if (md) { date = md[1].trim(); collecting = false; }
else if (mi) { id = mi[1].trim(); collecting = false; }
else if (collecting && annotation !== null) { annotation += '\n' + line; }
}
return { targetRaw, type: (type || 'note').toLowerCase(), annotation: (annotation || '').trim(), annotator, date, id };
}

/**
* Render an annotation as a distinct highlighted callout, placed inline next
* to the content it annotates. The author/date and id are exposed as data
* attributes so the viewer can wire author-only edit/delete affordances.
* @param {string} content - Block body
* @returns {string} - Rendered HTML
*/
renderAnnotation(content) {
const e = this.parseAnnotationEntry(content);
const initial = (e.annotator || '?').trim().charAt(0).toUpperCase();
const body = this.escapeHtml(e.annotation || '').replace(/\n/g, '<br>');
const ref = this.annotationTargetLabel(e.targetRaw);
const isReview = e.type === 'review';
const typeClass = isReview ? ' kr-annotation--review' : '';
const headIcon = isReview ? 'bi-clipboard-check-fill' : 'bi-pin-angle-fill';
let html = `<aside class="kr-annotation${typeClass}" data-annotation-block data-annotation-type="${this.escapeHtml(e.type)}" data-annotation-id="${this.escapeHtml(e.id)}" data-annotation-author="${this.escapeHtml(e.annotator)}" data-annotation-target="${this.escapeHtml(e.targetRaw)}">\n`;
html += '  <div class="kr-annotation-bar" aria-hidden="true"></div>\n';
html += '  <div class="kr-annotation-main">\n';
html += '    <div class="kr-annotation-head">\n';
html += `      <i class="bi ${headIcon} kr-annotation-icon"></i>\n`;
if (isReview) html += '      <span class="kr-annotation-tag">Review</span>\n';
html += `      <span class="kr-annotation-avatar" aria-hidden="true">${this.escapeHtml(initial)}</span>\n`;
html += `      <span class="kr-annotation-author">${this.escapeHtml(e.annotator || 'Unknown')}</span>\n`;
html += `      <span class="kr-annotation-date">${this.escapeHtml(e.date || '')}</span>\n`;
html += '      <span class="kr-annotation-actions">\n';
html += '        <button type="button" class="kr-annotation-edit" data-annotation-edit title="Edit annotation"><i class="bi bi-pencil"></i></button>\n';
html += '        <button type="button" class="kr-annotation-delete" data-annotation-delete title="Delete annotation"><i class="bi bi-trash"></i></button>\n';
html += '      </span>\n';
html += '    </div>\n';
if (ref && ref.label) {
html += `    <div class="kr-annotation-ref" title="What this annotation refers to"><i class="bi ${ref.icon}"></i> <span>${this.escapeHtml(ref.label)}</span></div>\n`;
}
html += `    <div class="kr-annotation-body" data-annotation-text>${body}</div>\n`;
html += '  </div>\n';
html += '</aside>\n';
return html;
}

/**
* Turn a Target descriptor into a human-readable "re:" label + icon so the
* callout shows what content it is attached to (the highlighted text, the
* row, the section, …). Prefers the captured `quote` (the user's selection).
* @param {string} targetRaw
* @returns {{icon: string, label: string}}
*/
annotationTargetLabel(targetRaw) {
if (!targetRaw) return { icon: '', label: '' };
const parts = String(targetRaw).split('|').map((s) => s.trim()).filter(Boolean);
const kind = (parts.shift() || '').toLowerCase();
const attrs = {};
for (const p of parts) {
const m = p.match(/^([a-zA-Z][\w-]*)\s*=\s*"([\s\S]*)"$/);
if (m) attrs[m[1]] = m[2];
}
const quote = attrs.quote;
if (quote) return { icon: 'bi-quote', label: `"${quote}"` };
if (kind === 'cell') return { icon: 'bi-table', label: attrs.text ? `"${attrs.text}"` : 'Cell' };
if (kind === 'row') return { icon: 'bi-table', label: `Row: ${attrs.match || ''}` };
if (kind === 'section') return { icon: 'bi-hash', label: `Section: ${attrs.heading || ''}` };
if (kind === 'table') return { icon: 'bi-table', label: `Table: ${attrs.caption || attrs.table || ''}` };
if (kind === 'text') return { icon: 'bi-quote', label: `"${attrs.quote || ''}"` };
return { icon: 'bi-pin-angle', label: targetRaw };
}

/**
* Parse a ```user-content``` block body into its fields. The Content field can
* span multiple lines (markdown) until the next known field is reached.
* @param {string} content
* @returns {Object} { targetRaw, content, author, date, id }
*/
parseUserContentEntry(content) {
let targetRaw = '', body = null, author = '', date = '', id = '', collecting = false;
for (const line of String(content || '').split(/\r?\n/)) {
const mt = line.match(/^Target:\s?(.*)$/);
const mc = line.match(/^Content:\s?(.*)$/);
const mu = line.match(/^Author:\s?(.*)$/);
const md = line.match(/^Date:\s?(.*)$/);
const mi = line.match(/^Id:\s?(.*)$/);
if (mt) { targetRaw = mt[1].trim(); collecting = false; }
else if (mc) { body = mc[1]; collecting = true; }
else if (mu) { author = mu[1].trim(); collecting = false; }
else if (md) { date = md[1].trim(); collecting = false; }
else if (mi) { id = mi[1].trim(); collecting = false; }
else if (collecting && body !== null) { body += '\n' + line; }
}
return { targetRaw, content: (body || '').trim(), author, date, id };
}

/**
* Render a ```user-content``` block ("Add Content") as ordinary body prose,
* deliberately NOT as a callout — a user's contribution should read as part of
* the document text. The author/id are exposed as data attributes so the viewer
* can wire author-only edit/delete affordances (which surface only on hover).
* @param {string} content - Block body
* @returns {string} - Rendered HTML
*/
renderUserContent(content) {
const e = this.parseUserContentEntry(content);
const bodyHtml = marked.parse(String(e.content || '').trim() || '');
const rawAttr = this.escapeHtml(String(e.content || '')).replace(/\n/g, '&#10;');
let html = `<div class="kr-user-content" data-user-content-block data-user-content-id="${this.escapeHtml(e.id)}" data-user-content-author="${this.escapeHtml(e.author)}" data-user-content-target="${this.escapeHtml(e.targetRaw)}" data-user-content-raw="${rawAttr}">\n`;
html += '  <span class="kr-user-content-actions" contenteditable="false">\n';
html += `    <span class="kr-user-content-tag" title="Added by ${this.escapeHtml(e.author || 'a contributor')}${e.date ? ' · ' + this.escapeHtml(e.date) : ''}"><i class="bi bi-pencil-square"></i> Added</span>\n`;
html += '    <button type="button" class="kr-user-content-edit" data-user-content-edit title="Edit content"><i class="bi bi-pencil"></i></button>\n';
html += '    <button type="button" class="kr-user-content-delete" data-user-content-delete title="Delete content"><i class="bi bi-trash"></i></button>\n';
html += '  </span>\n';
html += `  <div class="kr-user-content-body" data-user-content-text>${bodyHtml}</div>\n`;
html += '</div>\n';
return html;
}

/**
* Parse a ```reviews``` block body into review entries. Entries are separated
* by a blank line; each is a set of `key: value` lines. Mirrors the backend
* components/reviewBlocks.js parser.
* @param {string} content - Block body
* @returns {Array<Object>}
*/
parseReviewsBlock(content) {
return String(content || '')
.split(/\n\s*\n/)
.map((c) => c.trim())
.filter(Boolean)
.map((chunk) => {
const e = {};
for (const line of chunk.split(/\r?\n/)) {
const m = line.match(/^([a-zA-Z][\w-]*)\s*:\s?(.*)$/);
if (m) e[m[1].toLowerCase()] = m[2].trim();
}
return {
id: e.id || '',
review: (e.review || 'inprogress').toLowerCase(),
requested: e.requested || '',
reviewer: e.reviewer || '',
annotations: e.annotations || '',
stars: e.stars || '',
comment: e.comment || '',
startdate: e.startdate || '',
enddate: e.enddate || ''
};
});
}

/** Render a static 1–5 star display for a completed review. */
renderStars(n) {
const filled = Math.max(0, Math.min(5, parseInt(n, 10) || 0));
let s = `<span class="kr-stars" aria-label="${filled} out of 5">`;
for (let i = 1; i <= 5; i++) s += `<i class="bi ${i <= filled ? 'bi-star-fill' : 'bi-star'}"></i>`;
return s + '</span>';
}

/**
* Render the ```reviews``` block: a panel listing each requested review with
* its status, participants, dates, star rating and comment. In-progress
* reviews carry a hidden inline "Complete review" form (a star picker +
* comment) that reviewController reveals only for the assigned reviewer.
* @param {string} content - Block body
* @returns {string} - Rendered HTML
*/
renderReviews(content) {
const entries = this.parseReviewsBlock(content);
if (!entries.length) return '<section class="kr-reviews" data-reviews-block></section>\n';

let html = '<section class="kr-reviews" data-reviews-block>\n';
html += '  <header class="kr-reviews-head"><i class="bi bi-clipboard-check"></i> <span>Reviews</span></header>\n';
html += '  <ul class="kr-reviews-list">\n';

for (const e of entries) {
const done = e.review === 'complete';
const reviewer = this.escapeHtml(e.reviewer || '');
const requested = this.escapeHtml(e.requested || '');
html += `    <li class="kr-review ${done ? 'kr-review--complete' : 'kr-review--inprogress'}" data-review-id="${this.escapeHtml(e.id)}" data-review-reviewer="${reviewer}">\n`;
html += '      <div class="kr-review-row">\n';
html += `        <span class="kr-review-badge ${done ? 'is-complete' : 'is-inprogress'}">${done ? 'Complete' : 'In progress'}</span>\n`;
html += `        <span class="kr-review-people"><i class="bi bi-person-check"></i> ${reviewer || 'Unassigned'}</span>\n`;
if (requested) html += `        <span class="kr-review-meta">requested by ${requested}</span>\n`;
if (e.annotations && e.annotations !== '0') html += `        <span class="kr-review-meta" title="Review annotations on this page"><i class="bi bi-chat-square-dots"></i> ${this.escapeHtml(e.annotations)}</span>\n`;
html += '      </div>\n';

if (e.startdate || e.enddate) {
html += '      <div class="kr-review-dates">';
if (e.startdate) html += `<span>Started ${this.escapeHtml(e.startdate)}</span>`;
if (e.enddate) html += `<span>Completed ${this.escapeHtml(e.enddate)}</span>`;
html += '</div>\n';
}

if (done) {
if (e.stars) html += `      <div class="kr-review-rating">${this.renderStars(e.stars)}</div>\n`;
if (e.comment) html += `      <div class="kr-review-comment">${this.escapeHtml(e.comment)}</div>\n`;
} else {
// Completion control — hidden until reviewController confirms the viewer
// is the assigned reviewer (mirrors annotation author-only affordances).
html += `      <form class="kr-review-complete" data-review-complete data-review-id="${this.escapeHtml(e.id)}" data-review-reviewer="${reviewer}" style="display:none;">\n`;
html += '        <div class="kr-star-input" data-star-input>\n';
for (let i = 1; i <= 5; i++) html += `          <button type="button" class="kr-star-btn" data-star="${i}" aria-label="${i} star${i > 1 ? 's' : ''}"><i class="bi bi-star"></i></button>\n`;
html += '        </div>\n';
html += '        <input type="hidden" data-star-value value="">\n';
html += '        <textarea class="kr-review-comment-input" data-review-comment rows="2" placeholder="Add a comment…"></textarea>\n';
html += '        <div class="kr-review-complete-actions">\n';
html += '          <button type="submit" class="btn btn-primary btn-sm" data-review-submit>Complete review</button>\n';
html += '          <span class="kr-review-status" data-review-status></span>\n';
html += '        </div>\n';
html += '      </form>\n';
}
html += '    </li>\n';
}

html += '  </ul>\n';
html += '</section>\n';
return html;
}

/**
* Render a menu/TOC placeholder. The actual TOC HTML is injected in the
* final processHeadingsAndMenu pass after every heading id is known.
* Block content is currently unused but reserved for future options
* (e.g. min-level, max-level, title override).
* @param {string} _content
* @returns {string}
*/
renderMenu(_content) {
return '<div class="menu-toc-placeholder"></div>\n';
}

/**
* Render header/navbar block
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderHeader(content) {
const properties = this.parseBlockProperties(content);

const icon = properties.icon || '';
const title = properties.title || 'Knowledge Platform';
const linksStr = properties.links || '';

// Parse links in markdown format [text](url)
const links = this.parseMarkdownLinks(linksStr);

// Build navbar HTML
let html = '<nav class="navbar navbar-expand-lg navbar-light bg-light sticky-top" id="header">\n';
html += '  <div class="container">\n';

// Navbar brand with icon and title
html += '    <a class="navbar-brand d-flex align-items-center" href="index.html">\n';
if (icon) {
html += `      <img src="${this.escapeHtml(icon)}" alt="Logo" width="32" class="rounded me-2">\n`;
}
html += `      <span class="fw-semibold">${this.escapeHtml(title)}</span>\n`;
html += '    </a>\n';

// Navbar toggler for mobile
html += '    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">\n';
html += '      <span class="navbar-toggler-icon"></span>\n';
html += '    </button>\n';

// Navbar links
html += '    <div class="collapse navbar-collapse" id="navbarNav">\n';
html += '      <ul class="navbar-nav ms-auto">\n';

// Add links from header
if (links.length > 0) {
links.forEach(link => {
html += '        <li class="nav-item">\n';
html += `          <a class="nav-link" href="${this.escapeHtml(link.url)}">${this.escapeHtml(link.text)}</a>\n`;
html += '        </li>\n';
});
}

html += '      </ul>\n';
html += '    </div>\n';
html += '  </div>\n';
html += '</nav>\n';

return html;
}

/**
* Render swagger/OpenAPI documentation block
* @param {string} content - Block content (contains url property OR inline JSON)
* @returns {string} - Rendered HTML
*/
renderSwagger(content) {
const properties = this.parseBlockProperties(content);
const url = properties.url || '';
const title = properties.title || 'API Documentation';

// Generate a unique ID for the swagger container
const swaggerId = 'swagger-' + Math.random().toString(36).substr(2, 9);

// Build HTML with swagger container
let html = '<div class="swagger-documentation my-4">\n';
html += `  <div id="${swaggerId}" class="swagger-ui"></div>\n`;
html += '</div>\n';

// Add inline script to initialize Swagger UI for this specific container
html += '<script>\n';
html += `  (function() {\n`;
html += `    console.log('Initializing Swagger UI for container: ${swaggerId}');\n`;
html += `    if (window.SwaggerUIBundle) {\n`;
html += `      console.log('SwaggerUIBundle is available');\n`;
html += `      const swaggerConfig = {\n`;
html += `        dom_id: '#${swaggerId}',\n`;
html += `        presets: [\n`;
html += `          SwaggerUIBundle.presets.apis,\n`;
html += `          SwaggerUIBundle.SwaggerUIStandalonePreset\n`;
html += `        ],\n`;
html += `        layout: "BaseLayout",\n`;
html += `        requestInterceptor: (request) => {\n`;
html += `          request.headers['X-Requested-With'] = 'XMLHttpRequest';\n`;
html += `          return request;\n`;
html += `        }\n`;
html += `      };\n`;

if (url) {
// Use URL if provided
html += `      console.log('Loading Swagger from URL:', "${this.escapeHtml(url)}");\n`;
html += `      swaggerConfig.url = "${this.escapeHtml(url)}";\n`;
} else {
// Use inline YAML spec
const specContent = this.extractYamlFromContent(content);
if (specContent) {
html += `      console.log('Loading inline Swagger spec');\n`;
html += `      if (!window.jsyaml) {\n`;
html += `        console.error('jsyaml library not loaded');\n`;
html += `        return;\n`;
html += `      }\n`;
html += `      try {\n`;
html += `        const spec = jsyaml.load(\`${specContent.replace(/`/g, '\\`')}\`);\n`;
html += `        console.log('Parsed YAML spec:', spec);\n`;
html += `        swaggerConfig.spec = spec;\n`;
html += `      } catch (e) {\n`;
html += `        console.error('Failed to parse YAML in swagger block:', e);\n`;
html += `        console.error('YAML content was:', \`${specContent.replace(/`/g, '\\`')}\`);\n`;
html += `        return;\n`;
html += `      }\n`;
} else {
html += `      console.error('Swagger block: No url or YAML spec provided');\n`;
html += `      return;\n`;
}
}

html += `      try {\n`;
html += `        const ui = SwaggerUIBundle(swaggerConfig);\n`;
html += `        console.log('Swagger UI initialized successfully');\n`;
html += `      } catch (e) {\n`;
html += `        console.error('Error initializing Swagger UI:', e);\n`;
html += `      }\n`;
html += `    } else {\n`;
html += `      console.error('SwaggerUIBundle not available');\n`;
html += `    }\n`;
html += `  })();\n`;
html += '</script>\n';

return html;
}

/**
* Extract YAML from swagger block content
* Extracts all lines that are not the "swagger" keyword or block properties
* @param {string} content - Block content
* @returns {string|null} - YAML content or null
*/
extractYamlFromContent(content) {
const lines = content.split('\n');
const yamlLines = [];
let minIndent = Infinity;
let foundContent = false;

// First pass: find minimum indentation and identify YAML content
for (const line of lines) {
const trimmed = line.trim();

// Skip the "swagger" keyword
if (trimmed.toLowerCase() === 'swagger') continue;

// Skip empty lines before content starts
if (!foundContent && !trimmed) continue;

// Skip property lines that look like metadata (like "url: /path" or "title: MyAPI")
// But NOT YAML content (which may have colons in values)
if (!foundContent && trimmed && trimmed.includes(':')) {
const colonIndex = trimmed.indexOf(':');
const key = trimmed.substring(0, colonIndex).trim();

// Check if this is a known property keyword
if (['url', 'title'].includes(key.toLowerCase())) {
continue; // Skip property lines
}
}

// This line is part of the YAML spec
if (trimmed) {
foundContent = true;
const leadingSpaces = line.match(/^\s*/)[0].length;
// Track the smallest indent across ALL non-empty lines, including
// top-level keys at column 0. Excluding 0-indent lines here would let
// minIndent stay high and slice real characters off top-level keys.
minIndent = Math.min(minIndent, leadingSpaces);
yamlLines.push(line);
}
}

if (yamlLines.length === 0) {
return null;
}

// If no common indent was found (e.g. spec already flush-left), don't strip
// anything. Never slice more than a line's own leading whitespace.
if (minIndent === Infinity) {
minIndent = 0;
}

// Second pass: remove the common indentation and return YAML
const processedLines = yamlLines.map(line => {
if (!line.trim()) {
return ''; // normalise blank lines
}
const leadingSpaces = line.match(/^\s*/)[0].length;
const strip = Math.min(minIndent, leadingSpaces);
return line.substring(strip);
});

let yamlContent = processedLines.join('\n').trim();

// Validate that it looks like YAML
if (!yamlContent) {
return null;
}

// Remove trailing markdown block separators (---)
yamlContent = yamlContent.replace(/\s*---\s*$/, '').trim();

console.log('Extracted YAML for swagger block:', yamlContent);
return yamlContent;
}

/**
* Parse markdown links from text
* Extracts links in format [text](url) or [text](url) [text](url)
* @param {string} text - Text containing markdown links
* @returns {Array} - Array of {text, url} objects
*/
parseMarkdownLinks(text) {
const links = [];
const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
let match;

while ((match = linkRegex.exec(text)) !== null) {
links.push({
text: match[1],
url: match[2]
});
}

return links;
}

/**
* Render footer block
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderFooter(content) {
const properties = this.parseBlockProperties(content);

const icon = properties.icon || '';
const title = properties.title || 'noobly Wiki Platform';
const subtitle = properties.subtitle || '';
const linksStr = properties.links || '';

// Parse links in markdown format [text](url)
const links = this.parseMarkdownLinks(linksStr);

// Build footer HTML
let html = '<footer class="footer py-5">\n';
html += '  <div class="container">\n';
html += '    <div class="row align-items-center">\n';

// Left column: logo and subtitle
html += '      <div class="col-md-6">\n';
html += '        <div class="d-flex align-items-center gap-3">\n';
html += '          <a href="index.html" class="text-decoration-none d-flex align-items-center">\n';

if (icon) {
html += `            <img src="${this.escapeHtml(icon)}" alt="Logo" width="24" height="24" class="rounded me-2">\n`;
}

html += `            <span class="fw-semibold text-dark">${this.escapeHtml(title)}</span>\n`;
html += '          </a>\n';
html += '        </div>\n';

if (subtitle) {
html += `        <p class="text-muted small mt-2">${this.escapeHtml(subtitle)}</p>\n`;
}

html += '      </div>\n';

// Right column: links
html += '      <div class="col-md-6 text-md-end">\n';
html += '        <div class="d-flex gap-3 justify-content-md-end">\n';

// Add links from footer
if (links.length > 0) {
links.forEach(link => {
html += `          <a href="${this.escapeHtml(link.url)}" class="text-decoration-none text-muted small">${this.escapeHtml(link.text)}</a>\n`;
});
}

html += '        </div>\n';
html += '      </div>\n';
html += '    </div>\n';
html += '  </div>\n';
html += '</footer>\n';

return html;
}

/**
* Render mermaid diagram block
* Wraps mermaid diagram syntax in a div that mermaidjs will process.
* Mermaid syntax can contain "---" which won't conflict with block separators.
* @param {string} content - Block content (mermaid diagram syntax)
* @returns {string} - Rendered HTML
*/
renderMermaid(content) {
// Extract the diagram content, removing the 'mermaid' keyword and any properties
const lines = content.split('\n');
const diagramLines = [];
let minIndent = Infinity;

// First pass: collect lines and find minimum indentation
for (const line of lines) {
const trimmed = line.trim();

// Skip the "mermaid" keyword itself
if (trimmed.toLowerCase() === 'mermaid') continue;

// Skip empty lines
if (!trimmed) continue;

// Track minimum indentation for non-empty lines
const leadingSpaces = line.match(/^\s*/)[0].length;
if (leadingSpaces > 0) {
minIndent = Math.min(minIndent, leadingSpaces);
}
}

// Reset minIndent if no indented lines found
if (minIndent === Infinity) {
minIndent = 0;
}

// Second pass: collect lines while preserving relative indentation
let startCapturing = false;
for (const line of lines) {
const trimmed = line.trim();

// Skip the "mermaid" keyword itself
if (trimmed.toLowerCase() === 'mermaid') continue;

// Start capturing after we skip the keyword
if (!startCapturing && trimmed) {
startCapturing = true;
}

if (!startCapturing) continue;

// For empty lines, just add them as empty
if (!trimmed) {
diagramLines.push('');
} else {
// Remove only the minimum indentation, preserving relative indentation
const processed = line.substring(minIndent);
diagramLines.push(processed);
}
}

let diagramContent = diagramLines.join('\n').trim();

if (!diagramContent) {
return '';
}

// Remove any trailing markdown block separators (---)
// These are block separators in our markdown format, not mermaid syntax
// Match --- at the very end with optional whitespace before/after
diagramContent = diagramContent.replace(/\s*---\s*$/, '').trim();

// Generate a unique ID for the diagram
const diagramId = 'mermaid-' + Math.random().toString(36).substr(2, 9);

// KR Modern: wrap mermaid in .kr-mermaid chrome with header label + canvas.
// The inner .mermaid div is what mermaid.js actually renders into; the
// wrapper just provides the KR-styled header (label + diagram-type badge).
// Detect diagram type from first non-empty line for the badge.
const firstLine = (diagramContent.split('\n').find(l => l.trim()) || '').trim();
const typeBadge = firstLine.split(/\s+/)[0] || 'graph';

let html = '<div class="kr-mermaid">\n';
html += '  <div class="mm-head">\n';
html += '    <div class="lab"><i class="bi bi-diagram-2-fill"></i> Mermaid diagram';
html += ` <span class="badge">${this.escapeHtml(typeBadge)}</span></div>\n`;
html += '  </div>\n';
html += '  <div class="mm-canvas">\n';
html += '    <div class="mermaid" id="' + diagramId + '">\n';
html += diagramContent + '\n';
html += '    </div>\n';
html += '  </div>\n';
html += '</div>\n';

return html;
}

/**
* Render three-column layout (equal width columns)
* @param {string} content - Block content with left, middle, right sections
* @returns {string} - Rendered HTML
*/
renderThreeColumn(content) {
const lines = content.split('\n');
const sections = {
left: [],
middle: [],
right: []
};

let currentSection = null;

for (const line of lines) {
const trimmed = line.trim();

// Skip the "three-column" keyword itself
if (trimmed.toLowerCase() === 'three-column') continue;

// Check for section markers (with or without colon)
if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
currentSection = 'left';
continue;
} else if (trimmed.toLowerCase() === 'middle' || trimmed.toLowerCase() === 'middle:') {
currentSection = 'middle';
continue;
} else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
currentSection = 'right';
continue;
}

// Add content to current section
if (currentSection && trimmed) {
sections[currentSection].push(line);
}
}

// Build HTML with 3 equal columns
let html = '<div class="row g-4 plain-text-columns">\n';

if (sections.left.length > 0) {
const leftContent = sections.left.join('\n');
const leftMarkdown = marked.parse(leftContent);
html += '<div class="col-lg-4">\n' + leftMarkdown + '\n</div>\n';
}

if (sections.middle.length > 0) {
const middleContent = sections.middle.join('\n');
const middleMarkdown = marked.parse(middleContent);
html += '<div class="col-lg-4">\n' + middleMarkdown + '\n</div>\n';
}

if (sections.right.length > 0) {
const rightContent = sections.right.join('\n');
const rightMarkdown = marked.parse(rightContent);
html += '<div class="col-lg-4">\n' + rightMarkdown + '\n</div>\n';
}

html += '</div>\n';
return html;
}

/**
* Render two-column layout (75% / 25% split)
* @param {string} content - Block content with left and right sections
* @returns {string} - Rendered HTML
*/
renderTwoCol3_1(content) {
const lines = content.split('\n');
const sections = {
left: [],
right: []
};

let currentSection = null;

for (const line of lines) {
const trimmed = line.trim();

if (trimmed.toLowerCase() === 'two-col-3-1') continue;

if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
currentSection = 'left';
continue;
} else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
currentSection = 'right';
continue;
}

if (currentSection && trimmed) {
sections[currentSection].push(line);
}
}

// Build HTML with 75/25 split
let html = '<div class="row g-4 plain-text-columns">\n';

if (sections.left.length > 0) {
const leftContent = sections.left.join('\n');
const leftMarkdown = marked.parse(leftContent);
html += '<div class="col-lg-9">\n' + leftMarkdown + '\n</div>\n';
}

if (sections.right.length > 0) {
const rightContent = sections.right.join('\n');
const rightMarkdown = marked.parse(rightContent);
html += '<div class="col-lg-3">\n' + rightMarkdown + '\n</div>\n';
}

html += '</div>\n';
return html;
}

/**
* Render two-column layout (25% / 75% split)
* @param {string} content - Block content with left and right sections
* @returns {string} - Rendered HTML
*/
renderTwoCol1_3(content) {
const lines = content.split('\n');
const sections = {
left: [],
right: []
};

let currentSection = null;

for (const line of lines) {
const trimmed = line.trim();

if (trimmed.toLowerCase() === 'two-col-1-3') continue;

if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
currentSection = 'left';
continue;
} else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
currentSection = 'right';
continue;
}

if (currentSection && trimmed) {
sections[currentSection].push(line);
}
}

// Build HTML with 25/75 split
let html = '<div class="row g-4 plain-text-columns">\n';

if (sections.left.length > 0) {
const leftContent = sections.left.join('\n');
const leftMarkdown = marked.parse(leftContent);
html += '<div class="col-lg-3">\n' + leftMarkdown + '\n</div>\n';
}

if (sections.right.length > 0) {
const rightContent = sections.right.join('\n');
const rightMarkdown = marked.parse(rightContent);
html += '<div class="col-lg-9">\n' + rightMarkdown + '\n</div>\n';
}

html += '</div>\n';
return html;
}

/**
* Render container block (left/right columns - 50/50 split)
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderContainer(content) {
const lines = content.split('\n');
const sections = {
left: [],
right: []
};

let currentSection = null;

for (const line of lines) {
const trimmed = line.trim();

// Skip the "container" keyword itself
if (trimmed.toLowerCase() === 'container') continue;

// Check for section markers (with or without colon)
if (trimmed.toLowerCase() === 'left' || trimmed.toLowerCase() === 'left:') {
currentSection = 'left';
continue;
} else if (trimmed.toLowerCase() === 'right' || trimmed.toLowerCase() === 'right:') {
currentSection = 'right';
continue;
}

// Add content to current section
if (currentSection && trimmed) {
sections[currentSection].push(line);
}
}

// Build HTML — KR Modern: .container-block > .col-card grid
let html = '<section class="container-block">\n';

if (sections.left.length > 0) {
const leftContent = sections.left.join('\n');
const leftMarkdown = marked.parse(leftContent);
html += '<div class="col-card">\n' + leftMarkdown + '\n</div>\n';
}

if (sections.right.length > 0) {
const rightContent = sections.right.join('\n');
const rightMarkdown = marked.parse(rightContent);
html += '<div class="col-card">\n' + rightMarkdown + '\n</div>\n';
}

html += '</section>\n';

return html;
}

/**
* Render hero-banner block
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderHeroBanner(content) {
const properties = this.parseBlockProperties(content);

const title = properties.title || '';
const subtitle = properties.subtitle || '';
const heroImage = properties['hero-image'] || properties['hero_image'] || '';

// KR Modern: gradient hero-banner-section.
let html;
if (heroImage) {
// With an image: content on the left, image on the right.
html = '<section class="hero-banner-section">\n';
html += '<div class="hero-content" style="display: block; max-width: none; margin: 0; padding: 0;">\n';
if (title) {
html += `<h1 class="display-5">${this.escapeHtml(title)}</h1>\n`;
}
if (subtitle) {
html += `<p class="lead">${this.escapeHtml(subtitle)}</p>\n`;
}
html += '</div>\n';
html += `<div class="robot-hero-img" aria-label="Hero illustration"><img src="${this.escapeHtml(heroImage)}" alt="${this.escapeHtml(title || 'Hero')}"></div>\n`;
html += '</section>\n';
} else {
// No image: stack the heading on top and the description below it, both
// full-width and top-aligned (the `hero-banner-stacked` modifier turns the
// section's grid into a block). This keeps the banner height = title + text
// instead of the old 50/50 split, where a long description ballooned one
// column and left the title floating in the vertical centre.
html = '<section class="hero-banner-section hero-banner-stacked">\n';
html += '<div class="hero-content" style="display: block; max-width: none; margin: 0; padding: 0; width: 100%;">\n';
if (title) {
html += `<h1 class="display-5">${this.escapeHtml(title)}</h1>\n`;
}
if (subtitle) {
html += `<p class="lead">${this.escapeHtml(subtitle)}</p>\n`;
}
html += '</div>\n';
html += '</section>\n';
}

return html;
}

/**
* Render cards block with Bootstrap grid
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderCards(content) {
const properties = this.parseBlockProperties(content);
const across = parseInt(properties.across) || 3;

// Calculate Bootstrap column class based on 'across' value
const colClassMap = {
1: 'col-lg-12',
2: 'col-lg-6',
3: 'col-lg-4',
4: 'col-lg-3',
6: 'col-lg-2'
};
const colClass = colClassMap[across] || 'col-lg-4';

// Extract list items from content
const lines = content.split('\n');
const cards = [];
let currentCard = '';

for (const line of lines) {
const trimmed = line.trim();

// Skip the "cards" keyword and properties
if (trimmed.toLowerCase() === 'cards' || trimmed.startsWith('across:')) continue;

// Check if this is a list item (starts with -)
if (trimmed.startsWith('-')) {
// Save previous card if it exists
if (currentCard.trim()) {
cards.push(currentCard.trim());
}
// Start new card (remove the - and leading space)
currentCard = trimmed.substring(1).trim();
} else if (trimmed && currentCard) {
// Add to current card
currentCard += '\n' + line;
} else if (trimmed && !currentCard && !trimmed.startsWith('across:')) {
// Handle case where content doesn't start with -
currentCard = trimmed;
}
}

// Save last card
if (currentCard.trim()) {
cards.push(currentCard.trim());
}

// Build HTML
let html = '<div class="cards-section row g-4 my-4">\n';

cards.forEach(cardContent => {
// Extract heading and description
const { heading, description } = this.extractHeadingAndDescription(cardContent);

html += `<div class="${colClass} col-md-6 mb-4">\n`;
html += '<div class="card h-100 shadow-sm">\n';

// Add card header if heading exists
if (heading) {
html += `<div class="card-header border-0 bg-white">\n`;
html += `<h5 class="mb-0">${this.escapeHtml(heading)}</h5>\n`;
html += '</div>\n';
}

html += '<div class="card-body">\n';

// Parse the description content (markdown)
if (description) {
const descMarkdown = marked.parse(description);
html += descMarkdown;
}

html += '</div>\n';
html += '</div>\n';
html += '</div>\n';
});

html += '</div>\n';

return html;
}

/**
* Split a landing-page block body into block-level properties and a list of
* repeated items. This is the shared grammar behind `landing-hero`, `news`,
* `tiles`, `stories` and `cta` — one parser so every landing block is
* authored the same way:
*
*   title: Featured news          <- block property (before the first `-`)
*   across: 4
*   - tag: Standards              <- `- key: value` opens a new item
*     title: New API policy       <- plain `key: value` adds to that item
*     excerpt: All new interfaces
*     must declare a version.     <- a bare line continues the previous value
*
* Keys are lower-cased. A `- bare text` item (no `key:`) is stored under
* `defaultKey` so short lists stay terse.
* @param {string} content - Block body
* @param {string} keyword - Block keyword to ignore if it appears as a line
* @param {string} [defaultKey='title'] - Key for `- bare text` items
* @returns {{props: Object, items: Object[]}}
*/
parseBlockItems(content, keyword, defaultKey = 'title') {
const props = {};
const items = [];
let current = null;
let lastKey = null;

for (const raw of String(content || '').split(/\r?\n/)) {
const line = raw.trim();
if (!line) { lastKey = null; continue; }
if (keyword && line.toLowerCase() === keyword) continue;

// `- key: value` (or `- bare text`) starts a new item.
const itemStart = line.match(/^-\s+(.*)$/);
if (itemStart) {
current = {};
items.push(current);
const rest = itemStart[1].trim();
const kv = rest.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
if (kv) {
lastKey = kv[1].toLowerCase();
current[lastKey] = kv[2].trim();
} else {
lastKey = defaultKey;
current[defaultKey] = rest;
}
continue;
}

// `key: value` — an item property once an item is open, otherwise a
// block-level property.
const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
if (kv) {
lastKey = kv[1].toLowerCase();
(current || props)[lastKey] = kv[2].trim();
continue;
}

// A bare line continues whatever value came before it (lets long
// excerpts and quotes wrap across lines in the source).
if (lastKey) {
const bag = current || props;
bag[lastKey] = (bag[lastKey] ? bag[lastKey] + ' ' : '') + line;
}
}

return { props, items };
}

/**
* Render the optional heading strip that `news`/`tiles`/`stories` show above
* their grid: a section title on the left and an optional call-to-action link
* on the right, with an optional lead paragraph underneath.
* @param {Object} props - Block-level properties
* @returns {string} - Rendered HTML (empty string when there is no title)
* @private
*/
renderSectionHead_(props) {
const title = props.title || '';
const subtitle = props.subtitle || '';
const linkText = props['link-text'] || (props.link ? 'View all →' : '');
if (!title && !subtitle && !linkText) return '';

let html = '  <header class="kr-section-head">\n';
html += '    <div class="kr-section-head-text">\n';
if (title) html += `      <h2 class="kr-section-title">${this.escapeHtml(title)}</h2>\n`;
if (subtitle) html += `      <p class="kr-section-sub">${this.escapeHtml(subtitle)}</p>\n`;
html += '    </div>\n';
if (linkText) {
html += `    ${this.renderBlockLink_(props, `<span class="kr-section-link">${this.escapeHtml(linkText)}</span>`)}\n`;
}
html += '  </header>\n';
return html;
}

/**
* Wrap `inner` in whatever navigation affordance the item asked for.
*
* Two link forms, deliberately distinct so authors never have to guess how a
* value will be interpreted:
*   folder: Business Processes   -> `<a data-doc-rel>`, SPA-navigated to a
*                                   child folder of the page being viewed
*                                   (documentcontroller.initializeDocLinks)
*   link:   /applications/wiki/… -> a plain `<a href>`
* With neither, the content is returned unwrapped so the caller's markup
* stays inert rather than becoming a dead link.
* @param {Object} item - Item or block properties
* @param {string} inner - HTML to wrap
* @param {string} [cls] - Class for the anchor
* @returns {string} - Rendered HTML
* @private
*/
renderBlockLink_(item, inner, cls) {
const classAttr = cls ? ` class="${cls}"` : '';
if (item.folder) {
return `<a${classAttr} href="#" data-doc-rel="${this.escapeHtml(item.folder)}">${inner}</a>`;
}
if (item.link) {
const external = /^https?:\/\//i.test(item.link);
const target = external ? ' target="_blank" rel="noopener"' : '';
return `<a${classAttr} href="${this.escapeHtml(item.link)}"${target}>${inner}</a>`;
}
return cls ? `<span class="${cls}">${inner}</span>` : inner;
}

/**
* First character of a label, used for the round "initial" chips on tiles and
* story avatars so authors don't have to repeat it in the source.
* @param {string} text
* @returns {string}
* @private
*/
initialOf_(text) {
const s = String(text || '').trim();
return s ? s[0].toUpperCase() : '•';
}

/**
* Render a `landing-hero` block — the full-bleed dark gradient banner that
* opens a space landing page. Unlike `hero-banner` (a compact in-page title
* card) this is a section: eyebrow, display heading, lead, an optional search
* affordance, and a row of headline statistics.
*
*   ```landing-hero
*   eyebrow: noobly Wiki
*   title: One home for how we build.
*   subtitle: Product management, the business processes we've modelled…
*   search: Ask anything about our ecosystems, products, or standards…
*   action: Search
*   - value: 12,480
*     label: Documents
*   ```
*
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderLandingHero(content) {
const { props, items } = this.parseBlockItems(content, 'landing-hero', 'value');

let html = '<section class="kr-landing kr-landing-hero">\n';
html += '  <div class="kr-landing-hero-inner">\n';

if (props.eyebrow) {
html += `    <div class="kr-landing-hero-eyebrow">${this.escapeHtml(props.eyebrow)}</div>\n`;
}
if (props.title) {
html += `    <h1 class="kr-landing-hero-title">${this.escapeHtml(props.title)}</h1>\n`;
}
if (props.subtitle) {
html += `    <p class="kr-landing-hero-lead">${this.escapeHtml(props.subtitle)}</p>\n`;
}

// A real <form>, so Enter submits it without any JS of our own. The host
// app listens for the submit on [data-landing-search] and runs the query
// through its own search (searchController). Somewhere with no host, it
// degrades to an inert text box rather than a dead-looking button.
if (props.search) {
html += '    <form class="kr-landing-hero-search" data-landing-search role="search">\n';
html += `      <input type="search" class="kr-landing-hero-search-input" name="q" autocomplete="off" placeholder="${this.escapeHtml(props.search)}" aria-label="${this.escapeHtml(props.search)}">\n`;
html += `      <button type="submit" class="kr-landing-hero-search-btn">${this.escapeHtml(props.action || 'Search')}</button>\n`;
html += '    </form>\n';
}

const stats = items.filter(s => s.value || s.label);
if (stats.length) {
html += '    <div class="kr-landing-hero-stats">\n';
for (const s of stats) {
html += '      <div class="kr-landing-stat">\n';
html += `        <strong class="kr-landing-stat-value">${this.escapeHtml(s.value || '')}</strong>\n`;
html += `        <span class="kr-landing-stat-label">${this.escapeHtml(s.label || '')}</span>\n`;
html += '      </div>\n';
}
html += '    </div>\n';
}

html += '  </div>\n';
html += '</section>\n';
return html;
}

/**
* Render a `news` block — a grid of announcement cards, each with a coloured
* category pill, headline, excerpt and date.
*
*   ```news
*   title: Featured news
*   link-text: View all updates →
*   across: 4
*   - tag: Standards
*     tone: orange
*     title: New API versioning policy is now mandatory
*     date: 2 days ago
*     excerpt: All new interfaces must declare a version header.
*     folder: Standards
*   ```
*
* `tone` picks the pill colour (teal | orange | sand); omitted, it is derived
* from the tag text so the same category always gets the same colour.
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderNews(content) {
const { props, items } = this.parseBlockItems(content, 'news');
const across = Math.min(Math.max(parseInt(props.across, 10) || 3, 1), 6);

let html = '<section class="kr-landing kr-news">\n';
html += this.renderSectionHead_(props);
html += `  <div class="kr-news-grid" style="--kr-grid-cols:${across};">\n`;

for (const n of items) {
const tone = this.toneFor_(n.tone, n.tag);
const card = [];
card.push('      <article class="kr-news-card">\n');
if (n.tag) {
card.push(`        <span class="kr-news-tag kr-tone-${tone}">${this.escapeHtml(n.tag)}</span>\n`);
}
if (n.title) {
card.push(`        <h3 class="kr-news-title">${this.escapeHtml(n.title)}</h3>\n`);
}
if (n.excerpt) {
card.push(`        <p class="kr-news-excerpt">${this.escapeHtml(n.excerpt)}</p>\n`);
}
card.push('        <footer class="kr-news-foot">\n');
card.push(`          <span class="kr-news-date">${this.escapeHtml(n.date || '')}</span>\n`);
if (n.folder || n.link) {
card.push(`          ${this.renderBlockLink_(n, this.escapeHtml(n['link-text'] || 'Read more →'), 'kr-news-more')}\n`);
}
card.push('        </footer>\n');
card.push('      </article>\n');
html += '    ' + card.join('').trim() + '\n';
}

html += '  </div>\n';
html += '</section>\n';
return html;
}

/**
* Map a `tone` value (or, failing that, a label) onto one of the three
* landing-page accent tones. Deriving from the label keeps a given category
* the same colour everywhere without the author repeating themselves.
* @param {string} explicit - Author-supplied tone
* @param {string} label - Text to derive a tone from
* @returns {string} - 'teal' | 'orange' | 'sand'
* @private
*/
toneFor_(explicit, label) {
const TONES = ['teal', 'orange', 'sand'];
const want = String(explicit || '').trim().toLowerCase();
if (TONES.includes(want)) return want;
const text = String(label || '');
if (!text) return 'teal';
let hash = 0;
for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
return TONES[Math.abs(hash) % TONES.length];
}

/**
* Render a `tiles` block — the browse grid used for "find X by Y" sections.
* Each tile is an initial chip, a name, a blurb and a meta line, and the whole
* tile is clickable when it carries a `folder:` or `link:`.
*
*   ```tiles
*   title: Find solutions by ecosystem
*   subtitle: Browse the content for each part of the business.
*   across: 3
*   accent: teal
*   - title: Business Processes
*     blurb: The modelled end-to-end processes behind how each product runs.
*     meta: 210 documents →
*     folder: Business Processes
*   ```
*
* `accent` (teal | orange) colours the initial chips and the hover border, so
* one block type covers both the "ecosystem" and "content type" grids.
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderTiles(content) {
const { props, items } = this.parseBlockItems(content, 'tiles');
const across = Math.min(Math.max(parseInt(props.across, 10) || 3, 1), 6);
const accent = props.accent === 'orange' ? 'orange' : 'teal';

let html = '<section class="kr-landing kr-tiles">\n';
html += this.renderSectionHead_(props);
html += `  <div class="kr-tiles-grid kr-accent-${accent}" style="--kr-grid-cols:${across};">\n`;

for (const t of items) {
const initial = t.initial || this.initialOf_(t.title);
let inner = '';
inner += `      <span class="kr-tile-initial">${this.escapeHtml(initial)}</span>\n`;
if (t.title) inner += `      <h3 class="kr-tile-title">${this.escapeHtml(t.title)}</h3>\n`;
if (t.blurb) inner += `      <p class="kr-tile-blurb">${this.escapeHtml(t.blurb)}</p>\n`;
if (t.meta) inner += `      <span class="kr-tile-meta">${this.escapeHtml(t.meta)}</span>\n`;
html += '    ' + this.renderBlockLink_(t, '\n' + inner + '    ', 'kr-tile') + '\n';
}

html += '  </div>\n';
html += '</section>\n';
return html;
}

/**
* Render a `stories` block — pull-quote cards with an attributed author.
*
*   ```stories
*   title: Team stories
*   - quote: Having one modelled process meant every new engineer could see
*     the whole journey on day one.
*     name: Priya N.
*     role: Staff Engineer, Customer Onboarding
*   ```
*
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderStories(content) {
const { props, items } = this.parseBlockItems(content, 'stories', 'quote');
const across = Math.min(Math.max(parseInt(props.across, 10) || 3, 1), 6);

let html = '<section class="kr-landing kr-stories">\n';
html += this.renderSectionHead_(props);
html += `  <div class="kr-stories-grid" style="--kr-grid-cols:${across};">\n`;

for (const s of items) {
html += '    <figure class="kr-story">\n';
if (s.quote) {
html += `      <blockquote class="kr-story-quote">${this.escapeHtml(s.quote)}</blockquote>\n`;
}
html += '      <figcaption class="kr-story-by">\n';
html += `        <span class="kr-story-avatar">${this.escapeHtml(s.initial || this.initialOf_(s.name))}</span>\n`;
html += '        <span class="kr-story-who">\n';
html += `          <strong class="kr-story-name">${this.escapeHtml(s.name || '')}</strong>\n`;
html += `          <span class="kr-story-role">${this.escapeHtml(s.role || '')}</span>\n`;
html += '        </span>\n';
html += '      </figcaption>\n';
html += '    </figure>\n';
}

html += '  </div>\n';
html += '</section>\n';
return html;
}

/**
* Render a `cta` block — the dark closing band of a landing page, holding a
* centred heading and a row of "way in" cards, each with its own button.
*
*   ```cta
*   title: Get started
*   subtitle: Three ways into the repository.
*   - title: Take the tour
*     text: A five-minute walk through the ecosystems and search.
*     action: Start tour
*     style: primary
*     link: /applications/wiki/Engineering/tour.md
*   ```
*
* `style: primary` gives the solid accent button; anything else is the ghost
* outline variant.
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderCta(content) {
const { props, items } = this.parseBlockItems(content, 'cta');
const across = Math.min(Math.max(parseInt(props.across, 10) || items.length || 3, 1), 6);

let html = '<section class="kr-landing kr-cta">\n';
html += '  <div class="kr-cta-inner">\n';
if (props.title) {
html += `    <h2 class="kr-cta-title">${this.escapeHtml(props.title)}</h2>\n`;
}
if (props.subtitle) {
html += `    <p class="kr-cta-sub">${this.escapeHtml(props.subtitle)}</p>\n`;
}
html += `    <div class="kr-cta-grid" style="--kr-grid-cols:${across};">\n`;

for (const c of items) {
html += '      <div class="kr-cta-card">\n';
if (c.title) html += `        <h3 class="kr-cta-card-title">${this.escapeHtml(c.title)}</h3>\n`;
if (c.text) html += `        <p class="kr-cta-card-text">${this.escapeHtml(c.text)}</p>\n`;
if (c.action) {
const variant = c.style === 'primary' ? 'kr-cta-btn kr-cta-btn-primary' : 'kr-cta-btn kr-cta-btn-ghost';
html += `        ${this.renderBlockLink_(c, this.escapeHtml(c.action), variant)}\n`;
}
html += '      </div>\n';
}

html += '    </div>\n';
html += '  </div>\n';
html += '</section>\n';
return html;
}

/**
* Render summary block - styled callout section with a "Summary" label
* @param {string} content - Block content (markdown text)
* @returns {string} - Rendered HTML
*/
renderSummary(content) {
// Remove the "summary" keyword line if present
const lines = content.split('\n');
const contentLines = [];
let minIndent = Infinity;

// First pass: skip keyword, find min indentation
for (const line of lines) {
const trimmed = line.trim();
if (trimmed.toLowerCase() === 'summary') continue;
if (trimmed) {
const leadingSpaces = line.match(/^\s*/)[0].length;
if (leadingSpaces > 0) {
minIndent = Math.min(minIndent, leadingSpaces);
}
}
contentLines.push(line);
}

if (minIndent === Infinity) minIndent = 0;

// Second pass: remove minimum indentation
const processed = contentLines.map(line => {
if (line.trim()) {
return line.substring(Math.min(minIndent, line.match(/^\s*/)[0].length));
}
return '';
}).join('\n').trim();

if (!processed) return '';

const innerHtml = marked.parse(processed);

let html = '<div class="summary-block">\n';
html += '<div class="summary-block-label">Summary</div>\n';
html += '<div class="summary-block-content">\n';
html += innerHtml;
html += '</div>\n';
html += '</div>\n';

return html;
}

/**
* Render accordion block with collapsible items
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderAccordion(content) {
const lines = content.split('\n');
const items = [];
let currentItem = { title: '', content: '', isExpanded: false };
let expandedIndices = [];

for (let i = 0; i < lines.length; i++) {
const line = lines[i];
const trimmed = line.trim();

if (trimmed.toLowerCase() === 'accordion') continue;

if (trimmed.toLowerCase().startsWith('expanded:')) {
const expandedStr = trimmed.substring('expanded:'.length).trim();
if (expandedStr) {
expandedIndices = expandedStr.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x));
} else {
expandedIndices = [0];
}
continue;
}

if (trimmed.startsWith('##')) {
if (currentItem.title) {
items.push(currentItem);
}
const title = trimmed.replace(/^#+\s*/, '').trim();
currentItem = {
title: title,
content: '',
isExpanded: false
};
} else if (currentItem.title) {
if (line.trim()) {
currentItem.content += line + '\n';
} else if (currentItem.content) {
currentItem.content += '\n';
}
}
}

if (currentItem.title) {
items.push(currentItem);
}

expandedIndices.forEach(idx => {
if (idx >= 0 && idx < items.length) {
items[idx].isExpanded = true;
}
});

// KR Modern: .kr-concertina with native <details>/<summary> — no Bootstrap JS needed
let html = '<div class="kr-concertina">\n';

items.forEach((item, index) => {
const isOpen = item.isExpanded ? ' open' : '';
html += `  <details${isOpen}>\n`;
html += `    <summary>\n`;
html += `      <span class="ico"><i class="bi bi-chevron-double-right"></i></span>\n`;
html += `      <div>${this.escapeHtml(item.title)}</div>\n`;
html += `      <span class="chev"><i class="bi bi-chevron-down"></i></span>\n`;
html += `    </summary>\n`;
html += `    <div class="acc-body">\n`;
html += marked.parse(item.content.trim());
html += `    </div>\n`;
html += `  </details>\n`;
});

html += '</div>\n';
return html;
}

/**
* Render tabs block with switchable panes
* @param {string} content - Block content
* @returns {string} - Rendered HTML
*/
renderTabs(content) {
const lines = content.split('\n');
const tabs = [];
let currentTab = { title: '', content: '' };

for (let i = 0; i < lines.length; i++) {
const line = lines[i];
const trimmed = line.trim();

if (trimmed.toLowerCase() === 'tabs') continue;

if (trimmed.startsWith('##')) {
if (currentTab.title) {
tabs.push(currentTab);
}
const title = trimmed.replace(/^#+\s*/, '').trim();
currentTab = {
title: title,
content: ''
};
} else if (currentTab.title) {
if (line.trim()) {
currentTab.content += line + '\n';
} else if (currentTab.content) {
currentTab.content += '\n';
}
}
}

if (currentTab.title) {
tabs.push(currentTab);
}

// KR Modern: .kr-tabs with .tab-strip / .tab-btn / .tab-pane — wired up
// at runtime via the inline script appended below. No Bootstrap dependency.
const tabsId = 'tabs-' + Math.random().toString(36).substr(2, 9);
let html = `<div class="kr-tabs" id="${tabsId}">\n`;
html += '  <div class="tab-strip">\n';

tabs.forEach((tab, index) => {
const paneKey = `${tabsId}-p${index}`;
html += `    <button class="tab-btn${index === 0 ? ' active' : ''}" data-tab="${paneKey}">${this.escapeHtml(tab.title)}</button>\n`;
});

html += '  </div>\n';

tabs.forEach((tab, index) => {
const paneKey = `${tabsId}-p${index}`;
html += `  <div class="tab-pane${index === 0 ? ' active' : ''}" data-pane="${paneKey}">\n`;
html += marked.parse(tab.content.trim());
html += `  </div>\n`;
});

// Self-wiring click handler so tabs work in any host page (wiki, datasources,
// extension preview) without requiring app-level JS to bind them.
html += `  <script>(function(){let g=document.getElementById('${tabsId}');if(!g)return;`;
html += `let b=g.querySelectorAll('.tab-btn'),p=g.querySelectorAll('.tab-pane');`;
html += `b.forEach(function(x){x.addEventListener('click',function(){`;
html += `b.forEach(function(y){y.classList.remove('active')});`;
html += `p.forEach(function(y){y.classList.remove('active')});`;
html += `x.classList.add('active');`;
html += `let t=g.querySelector('[data-pane="'+x.dataset.tab+'"]');if(t)t.classList.add('active');`;
html += `})})})();</script>\n`;

html += '</div>\n';
return html;
}

/**
* Extract the raw text content of the first summary block from markdown
* @param {string} markdown - Raw markdown text
* @returns {string|null} - Raw summary text content, or null if none found
*/
extractSummary(markdown) {
if (!markdown) return null;

const blocks = this.splitIntoBlocks(markdown);

for (const block of blocks) {
if (block.type === 'custom' && block.blockType === 'summary') {
// Clean the content: remove keyword line and dedent
const lines = block.content.split('\n');
const contentLines = [];
let minIndent = Infinity;

for (const line of lines) {
const trimmed = line.trim();
if (trimmed.toLowerCase() === 'summary') continue;
if (trimmed) {
const leadingSpaces = line.match(/^\s*/)[0].length;
if (leadingSpaces > 0) {
minIndent = Math.min(minIndent, leadingSpaces);
}
}
contentLines.push(line);
}

if (minIndent === Infinity) minIndent = 0;

const processed = contentLines.map(line => {
if (line.trim()) {
return line.substring(Math.min(minIndent, line.match(/^\s*/)[0].length));
}
return '';
}).join('\n').trim();

return processed || null;
}
}

return null;
}

/**
* Render wiki-link block - clickable cards that load markdown in a modal
* Supports both single and multiple wiki-links
* @param {string} content - Block content with path, title, subtitle, content properties
* @returns {string} - Rendered HTML
*/
renderWikiLink(content) {
// Parse the content to extract individual wiki-links
const lines = content.split('\n');
const wikiLinks = [];
let currentLink = '';

for (const line of lines) {
const trimmed = line.trim();

// Skip the "wiki-link" or "wiki-links" keyword and empty lines at start
if (trimmed.toLowerCase() === 'wiki-link' || trimmed.toLowerCase() === 'wiki-links' || trimmed === '') {
if (currentLink && trimmed !== '') {
continue;
}
// Save previous wiki-link if it exists and we're starting a new one
if (currentLink && trimmed === '') {
wikiLinks.push(this.parseWikiLinkProperties(currentLink));
currentLink = '';
}
continue;
}

// Accumulate lines for current wiki-link
currentLink += line + '\n';

// Check if we're at a separator (---) or end of content - marks end of a wiki-link
if (trimmed === '---') {
wikiLinks.push(this.parseWikiLinkProperties(currentLink.replace('---', '')));
currentLink = '';
}
}

// Save last wiki-link if exists
if (currentLink.trim()) {
wikiLinks.push(this.parseWikiLinkProperties(currentLink));
}

// Build HTML
let html = '<div class="wiki-links-section row g-4 my-4">\n';

wikiLinks.forEach((link, index) => {
if (!link.path || !link.title) return; // Skip invalid entries

const linkId = 'wiki-link-' + Math.random().toString(36).substr(2, 9);
const encodedPath = encodeURIComponent(link.path);

html += '<div class="col-lg-4 col-md-6 mb-4">\n';
html += '<div class="wiki-link-card h-100" data-wiki-path="' + this.escapeHtml(link.path) + '" onclick="loadWikiLinkDocument(\'' + encodedPath.replace(/'/g, "\\'") + '\', \'' + link.title.replace(/'/g, "\\'") + '\')" style="cursor: pointer;">\n';

html += '<div class="wiki-link-card-header">\n';
html += `<h5 class="wiki-link-card-title">${this.escapeHtml(link.title)}</h5>\n`;
if (link.subtitle) {
html += `<p class="wiki-link-card-subtitle">${this.escapeHtml(link.subtitle)}</p>\n`;
}
html += '</div>\n';

html += '<div class="wiki-link-card-body">\n';
if (link.content) {
html += `<p class="wiki-link-card-content">${this.escapeHtml(link.content)}</p>\n`;
} else {
html += '<p class="wiki-link-card-content wiki-link-card-loading"></p>\n';
}
html += '</div>\n';

html += '<div class="wiki-link-card-footer">\n';
html += '<span class="wiki-link-read-more">Read More <i class="bi bi-arrow-right"></i></span>\n';
html += '</div>\n';

html += '</div>\n';
html += '</div>\n';
});

html += '</div>\n';

return html;
}

/**
* Parse wiki-link properties from content
* @param {string} content - Wiki-link content
* @returns {Object} - {path, title, subtitle, content}
*/
parseWikiLinkProperties(content) {
const properties = {};
const lines = content.split('\n');

for (const line of lines) {
const trimmed = line.trim();

// Skip empty lines
if (!trimmed) continue;

// Parse key: value format
if (trimmed.includes(':')) {
const colonIndex = trimmed.indexOf(':');
const key = trimmed.substring(0, colonIndex).trim();
const value = trimmed.substring(colonIndex + 1).trim();

if (key && value) {
properties[key.toLowerCase()] = value;
}
}
}

return properties;
}

/**
* Extract heading and description from card content
* @param {string} content - Card content
* @returns {Object} - {heading, description}
*/
extractHeadingAndDescription(content) {
const lines = content.split('\n');
let heading = '';
let descriptionLines = [];
let foundHeading = false;

for (const line of lines) {
const trimmed = line.trim();

// Check if this is a heading (###, ##, #)
if (!foundHeading && trimmed.match(/^#+\s+/)) {
// Extract heading text (remove # symbols)
heading = trimmed.replace(/^#+\s+/, '').trim();
foundHeading = true;
} else if (foundHeading || !trimmed.match(/^#+\s+/)) {
// Add all other lines to description
if (trimmed) {
descriptionLines.push(line);
}
}
}

return {
heading: heading,
description: descriptionLines.join('\n').trim()
};
}

/**
* Parse key-value properties from block content
* @param {string} content - Block content
* @returns {Object} - Properties object
*/
parseBlockProperties(content) {
const properties = {};
const lines = content.split('\n');

for (const line of lines) {
const trimmed = line.trim();

// Skip empty lines and block type line
if (!trimmed || trimmed.toLowerCase() === 'hero-banner') continue;

// Parse key: value format
if (trimmed.includes(':')) {
const [key, ...valueParts] = trimmed.split(':');
const keyTrimmed = key.trim();
const valueTrimmed = valueParts.join(':').trim();

if (keyTrimmed && valueTrimmed) {
properties[keyTrimmed] = valueTrimmed;
}
}
}

return properties;
}

/**
* Render a ```liked``` block as a clickable like badge. Each line is:
*   <ISO timestamp>  <email>
* The badge stores the comma-joined list of liker emails on data-likers so
* the host app can flip the heart-fill icon for the current user (the
* parser doesn't know who's logged in).
* @param {string} content
* @returns {string}
*/
renderLiked(content) {
const likers = [];
for (const raw of String(content || '').split(/\r?\n/)) {
const line = raw.trim();
if (!line) continue;
const m = line.match(/^(\S+)\s+(\S+)\s*$/);
if (m) likers.push(m[2].toLowerCase());
else likers.push(line.toLowerCase());
}
const count = likers.length;
const formatted = this.formatLikeCount(count);
const dataLikers = likers.join(',');
const label = count === 1 ? 'like' : 'likes';
return (
'<div class="kr-likes-bar" data-liked-block>\n' +
`  <button type="button" class="kr-like-btn" data-like-toggle data-likers="${this.escapeHtml(dataLikers)}" aria-pressed="false" title="Like this document">\n` +
'    <i class="bi bi-heart" data-like-icon></i>\n' +
`    <span class="kr-like-count" data-like-count>${this.escapeHtml(formatted)}</span>\n` +
`    <span class="kr-like-label" data-like-label>${label}</span>\n` +
'  </button>\n' +
'</div>\n'
);
}

formatLikeCount(n) {
const v = Number(n) || 0;
if (v < 1000) return String(v);
if (v < 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
if (v < 1000000) return Math.round(v / 1000) + 'k';
if (v < 10000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
return Math.round(v / 1000000) + 'M';
}

/**
* Render a ```sharedlinkvisits``` block. Each line is:
*   <ISO timestamp>  <visitor email>  (sharedBy: <source>)
* (See src/wiki/routes/documentRoutes.js share-visit.)
* @param {string} content
* @returns {string}
*/
renderSharedLinkVisits(content) {
const lines = String(content || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const entries = [];
const lineRe = /^(\S+)\s+(\S+)\s+\(sharedBy:\s*(.+)\)\s*$/;
for (const line of lines) {
const m = line.match(lineRe);
if (m) {
entries.push({ timestamp: m[1], visitor: m[2], sharedBy: m[3].trim() });
} else {
entries.push({ timestamp: '', visitor: line, sharedBy: '' });
}
}
// Newest first
entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

// COLLAPSED BY DEFAULT. This is an audit trail, not content — on a landing
// page it ran to dozens of rows below the fold and buried the end of the page.
//
// Native <details>/<summary>, NOT the Bootstrap `.collapse` the comments and
// linked-documents blocks use: this app loads Bootstrap's JS bundle but not
// its stylesheet, so a JS-driven collapse fails OPEN here (and, once the
// missing `.collapse` rules are supplied, would fail CLOSED-and-unreachable if
// the bundle ever went away). <details> needs neither, so the block also
// collapses correctly in the Chrome extension, which ships no Bootstrap JS.
let html = '<section class="kr-shared-visits" data-shared-visits-block>\n';
html += '  <details class="kr-shared-visits-details">\n';
html += '    <summary class="kr-shared-visits-head">\n';
html += '      <i class="bi bi-link-45deg"></i>\n';
html += '      <strong>Shared link visits</strong>\n';
html += `      <span class="kr-shared-visits-count">${entries.length}</span>\n`;
html += '      <i class="bi bi-chevron-down kr-shared-visits-chevron" aria-hidden="true"></i>\n';
html += '    </summary>\n';

if (entries.length === 0) {
html += '    <div class="kr-shared-visits-empty">No deep-link visits recorded yet.</div>\n';
} else {
html += '    <ul class="kr-shared-visits-list">\n';
for (const e of entries) {
const when = this.formatVisitTimestamp(e.timestamp);
html += '      <li class="kr-shared-visit">\n';
html += `        <span class="kr-shared-visit-when" title="${this.escapeHtml(e.timestamp)}">${this.escapeHtml(when)}</span>\n`;
html += `        <span class="kr-shared-visit-visitor"><i class="bi bi-person-circle"></i> ${this.escapeHtml(e.visitor)}</span>\n`;
html += `        <span class="kr-shared-visit-source">via ${this.escapeHtml(e.sharedBy || '(direct)')}</span>\n`;
html += '      </li>\n';
}
html += '    </ul>\n';
}

html += '  </details>\n';
html += '</section>\n';
return html;
}

formatVisitTimestamp(iso) {
if (!iso) return '';
const d = new Date(iso);
if (isNaN(d.getTime())) return iso;
return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
* Escape HTML special characters
* @param {string} text - Text to escape
* @returns {string} - Escaped text
*/
escapeHtml(text) {
const map = {
'&': '&amp;',
'<': '&lt;',
'>': '&gt;',
'"': '&quot;',
"'": '&#039;'
};
return text.replace(/[&<>"']/g, m => map[m]);
}
}

// Create global instance
const markdownParser = new MarkdownParser();

/**
* Parse markdown with custom blocks
* @param {string} markdown - Raw markdown text
* @returns {string} - Rendered HTML
*/
function parseMarkdown(markdown) {
return markdownParser.parse(markdown);
}

/* ============================================================================
   TOC scroll-spy
   Watches the document for `.menu-toc` elements and toggles `.is-active` on
   the matching `.menu-toc-item` based on which heading is currently in view.
   Auto-attaches once on DOMContentLoaded; re-runs whenever new TOCs are
   added (e.g. after switching documents in a SPA), so callers don't have to
   wire anything per render.
   ============================================================================ */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Map of menu-toc element -> { observer, links }
  const wired = new WeakMap();

  function wireOneToc(tocEl) {
    if (wired.has(tocEl)) return;

    const links = Array.from(tocEl.querySelectorAll('.menu-toc-item a[href^="#"]'));
    if (links.length === 0) return;

    // Build id -> item element map for O(1) updates.
    const itemById = new Map();
    const headings = [];
    for (const a of links) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const heading = id ? document.getElementById(id) : null;
      if (!heading) continue;
      itemById.set(id, a.closest('.menu-toc-item'));
      headings.push(heading);
    }
    if (headings.length === 0) return;

    let lastActiveId = null;
    const setActive = (id) => {
      if (id === lastActiveId) return;
      if (lastActiveId) {
        const prev = itemById.get(lastActiveId);
        if (prev) prev.classList.remove('is-active');
      }
      const next = itemById.get(id);
      if (next) next.classList.add('is-active');
      lastActiveId = id;
    };

    // Track every observed heading's most recent intersectionRatio so we can
    // pick the most prominent one after each batch of entries. Pure
    // top-of-viewport heuristics break on short pages and within nested
    // scroll containers.
    const ratios = new Map();
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        ratios.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      }
      // Pick the top-most heading currently visible. Falls back to the
      // last heading scrolled past when nothing is on screen.
      let bestId = null;
      let bestTop = Infinity;
      for (const h of headings) {
        const r = ratios.get(h.id) || 0;
        if (r <= 0) continue;
        const top = h.getBoundingClientRect().top;
        if (top < bestTop) { bestTop = top; bestId = h.id; }
      }
      if (!bestId) {
        // Nothing visible — find the last heading whose top is above viewport.
        let lastAbove = null;
        for (const h of headings) {
          if (h.getBoundingClientRect().top < 100) lastAbove = h.id;
        }
        if (lastAbove) bestId = lastAbove;
      }
      if (bestId) setActive(bestId);
    }, {
      rootMargin: '-80px 0px -60% 0px',
      threshold: [0, 0.25, 0.5, 1]
    });

    headings.forEach(h => observer.observe(h));
    wired.set(tocEl, { observer });
  }

  function scanAndWire(root = document) {
    const tocs = root.querySelectorAll ? root.querySelectorAll('.menu-toc') : [];
    tocs.forEach(wireOneToc);
  }

  function attachTocScrollSpy() {
    scanAndWire(document);
    // Catch TOCs added later (SPA navigation, document switch, etc.)
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList && node.classList.contains('menu-toc')) {
            wireOneToc(node);
          } else if (node.querySelectorAll) {
            scanAndWire(node);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Expose for callers that want to trigger manually.
  if (typeof MarkdownParser !== 'undefined') {
    MarkdownParser.attachTocScrollSpy = attachTocScrollSpy;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachTocScrollSpy, { once: true });
  } else {
    attachTocScrollSpy();
  }
})();


/* ============================================================================
   Mermaid auto-render
   renderMermaid() emits `<div class="mermaid">` nodes inside a `.kr-mermaid`
   wrapper. Host pages insert the parser's HTML via innerHTML, which neither
   executes scripts nor triggers mermaid — so without this the diagram source
   shows as raw text. This runtime lazily loads mermaid.js (if the host page
   didn't already provide it) and renders any unprocessed `.kr-mermaid .mermaid`
   nodes, including ones added later (SPA navigation, document switches,
   modals). Scoped to `.kr-mermaid` so it never touches the editor's own
   mermaid blocks. Idempotent: processed nodes carry data-processed and are
   skipped, so re-scans and mermaid's own DOM mutations don't loop.
   ============================================================================ */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // Match the version the editor loads so both code paths render identically.
  const MERMAID_SRC = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
  let injected = false;
  let readyCallbacks = [];

  function mermaidUsable() {
    return !!(window.mermaid && typeof window.mermaid.run === 'function');
  }

  // Ensure mermaid is available, then invoke cb. If the host page already
  // loaded mermaid we use it as-is; otherwise inject the CDN script once.
  function ensureMermaid(cb) {
    if (mermaidUsable()) { cb(); return; }
    readyCallbacks.push(cb);
    if (injected) return;
    injected = true;
    try {
      const s = document.createElement('script');
      s.src = MERMAID_SRC;
      s.onload = function () {
        try {
          if (window.mermaid && typeof window.mermaid.initialize === 'function') {
            // useMaxWidth:false makes mermaid emit SVGs at their natural size
            // (rather than width:100%, which scales large diagrams down until
            // they are unreadable). The .mm-canvas container handles scrolling.
            window.mermaid.initialize({
              startOnLoad: false,
              theme: 'default',
              securityLevel: 'loose',
              flowchart: { useMaxWidth: false },
              sequence: { useMaxWidth: false },
              gantt: { useMaxWidth: false },
              class: { useMaxWidth: false },
              state: { useMaxWidth: false },
              er: { useMaxWidth: false },
              journey: { useMaxWidth: false },
              pie: { useMaxWidth: false },
            });
          }
        } catch (e) { /* initialize is best-effort */ }
        const cbs = readyCallbacks; readyCallbacks = [];
        cbs.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
      };
      s.onerror = function () {
        // CSP-restricted contexts (e.g. some extensions) may block the CDN —
        // fail quietly so the rest of the document still renders.
        injected = false; readyCallbacks = [];
      };
      document.head.appendChild(s);
    } catch (e) { injected = false; }
  }

  function pendingNodes() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.kr-mermaid .mermaid:not([data-processed="true"])'))
      .filter(n => n.textContent && n.textContent.trim());
  }

  // Singleton fullscreen lightbox for mermaid diagrams — mirrors the image
  // lightbox (app.js initImageLightbox): a dark backdrop showing the diagram
  // centred at full size, closed via backdrop click, the × button, or Escape.
  // A diagram is an <svg> (not an <img>), so we clone the rendered SVG into the
  // overlay and let its own viewBox scale the drawing to fill the viewport.
  let lightbox = null;
  function ensureLightbox() {
    if (lightbox) return lightbox;

    const overlay = document.createElement('div');
    overlay.id = 'kr-mermaid-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out;';

    // White "sheet" filling the viewport; the SVG scales to fit inside it via
    // preserveAspectRatio. Mermaid diagrams have dark text/borders on a
    // transparent background, so they need a light surface to be readable
    // (unlike images, which carry their own opaque pixels).
    const stage = document.createElement('div');
    stage.style.cssText = 'box-sizing:border-box;width:95vw;height:95vh;padding:28px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);';
    overlay.appendChild(stage);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'position:absolute;top:18px;right:24px;background:rgba(0,0,0,.4);color:#fff;border:none;font-size:32px;line-height:1;width:44px;height:44px;border-radius:50%;cursor:pointer;';
    overlay.appendChild(closeBtn);

    document.body.appendChild(overlay);

    const close = () => {
      overlay.style.display = 'none';
      stage.innerHTML = '';
      document.body.style.overflow = '';
    };
    overlay.addEventListener('click', close);
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    // Capture phase + stopImmediatePropagation so Escape closes only the
    // lightbox, without also reaching the page's document-modal Escape handler.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') {
        e.stopImmediatePropagation();
        close();
      }
    }, true);

    lightbox = { overlay, stage };
    return lightbox;
  }

  function openMermaidLightbox(node) {
    const svg = node && node.querySelector('svg');
    if (!svg) return;
    const lb = ensureLightbox();

    const clone = svg.cloneNode(true);
    // Keep the id: mermaid scopes its <style> rules with `#<svgId> .node …`, so
    // stripping the id would drop every fill/stroke and render solid-black shapes.
    // Drop any inline pan/zoom sizing so the diagram fills the stage; its own
    // viewBox + preserveAspectRatio scales the drawing to fit (no distortion).
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    clone.style.width = '100%';
    clone.style.height = '100%';
    clone.style.maxWidth = 'none';
    clone.style.maxHeight = 'none';

    lb.stage.innerHTML = '';
    lb.stage.appendChild(clone);
    lb.overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // Make a rendered mermaid diagram pan/zoomable inside its own canvas:
  // ctrl/cmd + wheel zooms toward the cursor (without zooming the page), and
  // dragging pans via the scrollable canvas. A small toolbar (−, %, +, fit)
  // is added to the diagram header. Idempotent per diagram.
  function enhanceMermaidPanZoom(node) {
    const canvas = node && node.closest('.mm-canvas');
    const svg = node && node.querySelector('svg');
    if (!canvas || !svg || node.dataset.pzInit === 'true') return;
    node.dataset.pzInit = 'true';

    const ZOOM_MIN = 0.2, ZOOM_MAX = 6;
    // Natural width from the rendered SVG (useMaxWidth:false gives a viewBox).
    const baseWidth = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width)
      || svg.getBoundingClientRect().width || 600;
    let zoom = 1;

    const clamp = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    // Assigned once the toolbar (which holds the label) is built below.
    let label = null;

    function apply() {
      svg.style.maxWidth = 'none';
      svg.style.width = (baseWidth * zoom) + 'px';
      svg.style.height = 'auto';
      if (label) label.textContent = Math.round(zoom * 100) + '%';
    }

    // Zoom keeping the point under (clientX,clientY) — or the canvas centre —
    // fixed on screen.
    function zoomTo(next, clientX, clientY) {
      next = clamp(next);
      if (next === zoom) return;
      const rect = canvas.getBoundingClientRect();
      const px = (clientX != null ? clientX - rect.left : rect.width / 2);
      const py = (clientY != null ? clientY - rect.top : rect.height / 2);
      const contentX = canvas.scrollLeft + px;
      const contentY = canvas.scrollTop + py;
      const ratio = next / zoom;
      zoom = next;
      apply();
      canvas.scrollLeft = contentX * ratio - px;
      canvas.scrollTop = contentY * ratio - py;
    }

    function fit() {
      const avail = canvas.clientWidth - 48; // minus padding
      zoom = clamp(avail > 0 ? avail / baseWidth : 1);
      apply();
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
    }

    canvas.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll still scrolls the page
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
    }, { passive: false });

    // Drag anywhere (except on a clickable node) to pan.
    let pan = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('a')) return;
      pan = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop };
      canvas.classList.add('is-grabbing');
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pan) return;
      canvas.scrollLeft = pan.sl - (e.clientX - pan.x);
      canvas.scrollTop = pan.st - (e.clientY - pan.y);
    });
    const endPan = (e) => {
      if (!pan) return;
      pan = null;
      canvas.classList.remove('is-grabbing');
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', endPan);
    canvas.addEventListener('pointerleave', endPan);

    // Toolbar in the diagram header.
    const head = node.closest('.kr-mermaid')?.querySelector('.mm-head');
    if (head && !head.querySelector('.mm-zoom')) {
      const tools = document.createElement('div');
      tools.className = 'mm-zoom';
      tools.innerHTML =
        '<button type="button" data-mm-zoom-out title="Zoom out"><i class="bi bi-dash-lg"></i></button>' +
        '<span data-mm-zoom-label>100%</span>' +
        '<button type="button" data-mm-zoom-in title="Zoom in"><i class="bi bi-plus-lg"></i></button>' +
        '<button type="button" data-mm-zoom-fit title="Fit to width"><i class="bi bi-arrows-angle-contract"></i></button>' +
        '<button type="button" data-mm-zoom-full title="View full size"><i class="bi bi-arrows-fullscreen"></i></button>';
      head.appendChild(tools);
      label = tools.querySelector('[data-mm-zoom-label]');
      const center = () => {
        const rect = canvas.getBoundingClientRect();
        return [rect.left + rect.width / 2, rect.top + rect.height / 2];
      };
      tools.querySelector('[data-mm-zoom-in]').addEventListener('click', () => zoomTo(zoom * 1.2, ...center()));
      tools.querySelector('[data-mm-zoom-out]').addEventListener('click', () => zoomTo(zoom / 1.2, ...center()));
      tools.querySelector('[data-mm-zoom-fit]').addEventListener('click', fit);
      tools.querySelector('[data-mm-zoom-full]').addEventListener('click', () => openMermaidLightbox(node));
    }

    // Open fit-to-width by default (same as the fit button) rather than at 100%,
    // so wide diagrams are readable without the reader having to zoom out first.
    fit();
  }

  let scheduled = false;
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (pendingNodes().length === 0) return;
      ensureMermaid(() => {
        const nodes = pendingNodes();
        if (nodes.length === 0) return;
        try {
          const r = window.mermaid.run({ nodes });
          // Once the SVG is in place, make each diagram pan/zoomable.
          Promise.resolve(r).then(
            () => { nodes.forEach(n => { try { enhanceMermaidPanZoom(n); } catch (e) { /* ignore */ } }); },
            err => console.error('Mermaid render error:', err)
          );
        } catch (err) {
          console.error('Mermaid render error:', err);
        }
      });
    }, 0);
  }

  function attachMermaid() {
    scheduleRender();
    // Catch diagrams inserted after load (document switch, modal open, etc.).
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if ((node.classList && node.classList.contains('kr-mermaid')) ||
              (node.querySelector && node.querySelector('.kr-mermaid .mermaid'))) {
            scheduleRender();
            return;
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Expose for callers that want to trigger manually after a render.
  if (typeof MarkdownParser !== 'undefined') {
    MarkdownParser.renderPendingMermaid = scheduleRender;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachMermaid, { once: true });
  } else {
    attachMermaid();
  }
})();


/* ============================================================================
   Embedded image pan/zoom
   renderer.image (above) wraps base64 data-URI images in a `.kr-image` figure
   with a `.ki-canvas` scroll viewport, mirroring the mermaid chrome. This
   runtime makes each image pan/zoomable: it renders at the image's natural
   pixel size (so it stays crisp and at the size it was authored), the canvas
   scrolls when the image is larger than the container, ctrl/cmd + wheel zooms
   toward the cursor, and dragging pans. A small toolbar (−, %, +, fit) is
   added to the figure header. Idempotent per image; catches images inserted
   after load (SPA navigation, document switches, modals) via a MutationObserver.
   ============================================================================ */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const ZOOM_MIN = 0.1, ZOOM_MAX = 8;

  function enhanceImagePanZoom(img) {
    const canvas = img && img.closest('.ki-canvas');
    if (!canvas || img.dataset.pzInit === 'true') return;
    // Need the natural dimensions to size the zoom; wait for decode if the
    // (potentially large base64) image hasn't finished loading yet.
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', () => enhanceImagePanZoom(img), { once: true });
      return;
    }
    img.dataset.pzInit = 'true';

    const baseWidth = img.naturalWidth || img.getBoundingClientRect().width || 600;
    let zoom = 1;
    let label = null;
    const clamp = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

    function apply() {
      img.style.maxWidth = 'none';
      img.style.width = (baseWidth * zoom) + 'px';
      img.style.height = 'auto';
      if (label) label.textContent = Math.round(zoom * 100) + '%';
    }

    // Zoom keeping the point under (clientX,clientY) — or the canvas centre —
    // fixed on screen.
    function zoomTo(next, clientX, clientY) {
      next = clamp(next);
      if (next === zoom) return;
      const rect = canvas.getBoundingClientRect();
      const px = (clientX != null ? clientX - rect.left : rect.width / 2);
      const py = (clientY != null ? clientY - rect.top : rect.height / 2);
      const contentX = canvas.scrollLeft + px;
      const contentY = canvas.scrollTop + py;
      const ratio = next / zoom;
      zoom = next;
      apply();
      canvas.scrollLeft = contentX * ratio - px;
      canvas.scrollTop = contentY * ratio - py;
    }

    function fit() {
      const avail = canvas.clientWidth - 48; // minus padding
      zoom = clamp(avail > 0 ? avail / baseWidth : 1);
      apply();
      canvas.scrollLeft = 0;
      canvas.scrollTop = 0;
    }

    canvas.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll still scrolls the page
      e.preventDefault();
      zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY);
    }, { passive: false });

    // Drag anywhere to pan.
    let pan = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pan = { x: e.clientX, y: e.clientY, sl: canvas.scrollLeft, st: canvas.scrollTop };
      canvas.classList.add('is-grabbing');
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pan) return;
      canvas.scrollLeft = pan.sl - (e.clientX - pan.x);
      canvas.scrollTop = pan.st - (e.clientY - pan.y);
    });
    const endPan = (e) => {
      if (!pan) return;
      pan = null;
      canvas.classList.remove('is-grabbing');
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', endPan);
    canvas.addEventListener('pointerleave', endPan);

    // Toolbar in the figure header.
    const head = img.closest('.kr-image')?.querySelector('.ki-head');
    if (head && !head.querySelector('.ki-zoom')) {
      const tools = document.createElement('div');
      tools.className = 'ki-zoom';
      tools.innerHTML =
        '<button type="button" data-ki-zoom-out title="Zoom out"><i class="bi bi-dash-lg"></i></button>' +
        '<span data-ki-zoom-label>100%</span>' +
        '<button type="button" data-ki-zoom-in title="Zoom in"><i class="bi bi-plus-lg"></i></button>' +
        '<button type="button" data-ki-zoom-fit title="Fit to width"><i class="bi bi-arrows-angle-contract"></i></button>';
      head.appendChild(tools);
      label = tools.querySelector('[data-ki-zoom-label]');
      const center = () => {
        const rect = canvas.getBoundingClientRect();
        return [rect.left + rect.width / 2, rect.top + rect.height / 2];
      };
      tools.querySelector('[data-ki-zoom-in]').addEventListener('click', () => zoomTo(zoom * 1.2, ...center()));
      tools.querySelector('[data-ki-zoom-out]').addEventListener('click', () => zoomTo(zoom / 1.2, ...center()));
      tools.querySelector('[data-ki-zoom-fit]').addEventListener('click', fit);
    }

    // Open fit-to-width by default (same as the mermaid viewer) rather than at
    // 100%, so wide images are readable without the reader having to zoom out
    // first. fit() only shrinks oversized images down to the canvas width; a
    // small image whose natural width already fits stays at 100% (no upscaling
    // blur) because that is what best fits the width without exceeding it.
    if (baseWidth > canvas.clientWidth - 48) {
      fit();
    } else {
      apply();
    }
  }

  function pendingImages() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.kr-image .ki-img:not([data-pz-init="true"])'));
  }

  let scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      pendingImages().forEach((img) => {
        try { enhanceImagePanZoom(img); } catch (e) { /* ignore */ }
      });
    }, 0);
  }

  function attachImages() {
    scheduleEnhance();
    // Catch images inserted after load (document switch, modal open, etc.).
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if ((node.classList && node.classList.contains('kr-image')) ||
              (node.querySelector && node.querySelector('.kr-image .ki-img'))) {
            scheduleEnhance();
            return;
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // Expose for callers that want to trigger manually after a render.
  if (typeof MarkdownParser !== 'undefined') {
    MarkdownParser.enhancePendingImages = scheduleEnhance;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachImages, { once: true });
  } else {
    attachImages();
  }
})();






