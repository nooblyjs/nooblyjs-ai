/**
 * @fileoverview Visualisation block controller
 *
 * Hydrates ```visualisation``` block placeholders (emitted by
 * markdown-parser.js) into an interactive canvas that lays out the
 * document's own heading sections as movable cards.
 *
 * The block body holds ONLY layout data — the document text stays the single
 * source of truth for content:
 *
 *   ```visualisation
 *   @canvas height:520 grid:20
 *   @item "Auth Service" top:120 left:40 width:260
 *   @item "API Gateway" top:120 left:380
 *   @connect "Auth Service" -> "API Gateway" label:"calls"
 *   ```
 *
 * - `@item` references a heading in the document (by text, or by slug).
 *   Sections without an `@item` line are auto-placed in a grid, so an empty
 *   block instantly visualises every section.
 * - In view mode the canvas is read-only (pan/zoom only). The "Arrange"
 *   toggle unlocks dragging (snap-to-grid), connecting cards (drag the port
 *   dot onto another card) and labelling/deleting connections.
 * - Every change rewrites just the block body inside the document source and
 *   saves through the same endpoints the editor uses. Lines it doesn't
 *   understand (or @items whose heading no longer exists) are preserved
 *   verbatim at the end of the block — never destroyed.
 *
 * @author noobly Team
 * @version 1.0.0
 */

const DEFAULT_CANVAS_HEIGHT = 480;
const DEFAULT_GRID = 20;
// Cards size to their content (CSS min/max bounds); the auto-placement grid
// uses the max card width plus a gutter so columns never overlap.
const AUTO_PITCH_X = 360;
const AUTO_PITCH_Y = 260;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const SAVE_DEBOUNCE_MS = 800;

/** Fallback list when the parser global isn't available. */
const CUSTOM_BLOCK_TYPES_FALLBACK = [
    'header', 'footer', 'swagger', 'mermaid', 'three-column', 'two-col-3-1',
    'two-col-1-3', 'container', 'hero-banner', 'cards', 'wiki-link',
    'wiki-links', 'summary', 'accordion', 'tabs', 'menu', 'comments',
    'annotation', 'reviews', 'sharedlinkvisits', 'liked', 'document',
    'visualisation', 'landing-hero', 'news', 'tiles', 'stories', 'cta'
];

let instanceCounter = 0;

export const visualisationController = {
    app: null,

    init(app) {
        this.app = app;
    },

    /**
     * Hydrate every visualisation placeholder inside a freshly rendered
     * document. Placeholders are matched to ```visualisation``` fences in the
     * source by document order.
     * @param {HTMLElement} rootEl - The just-inserted content wrapper
     * @param {Object} doc - The wiki document ({path, spaceId, spaceName, content})
     */
    hydrate(rootEl, doc) {
        if (!rootEl || !doc || typeof doc.content !== 'string') return;
        const placeholders = rootEl.querySelectorAll('.kr-visualisation[data-vis-placeholder]');
        if (!placeholders.length) return;

        const blocks = findVisualisationBlocks(doc.content);
        placeholders.forEach((el, i) => {
            if (i >= blocks.length) return; // source/DOM mismatch — leave the inert placeholder
            try {
                buildCanvas(el, doc, i, blocks[i].body, this.app);
            } catch (error) {
                console.error('[VisualisationController] Failed to build canvas:', error);
            }
        });
    },

    /**
     * Insert an empty ```visualisation``` block into a document and save it.
     * The block goes before any trailing comments/SharedLinkVisits/liked
     * blocks (the backend appends those at the end of the source) so the
     * canvas renders above the comments section. No-ops if the source
     * already has a visualisation block.
     * @param {Object} doc - The wiki document ({path, spaceId, spaceName, content})
     * @returns {Promise<string|null>} the updated source, or null on failure
     */
    async addBlockToDocument(doc) {
        if (!doc || !doc.path) return null;
        const state = { doc, app: this.app };
        try {
            const latest = (await fetchLatestContent(state)) ?? currentContent(state);
            let newContent = latest;
            if (!findVisualisationBlocks(latest).length) {
                newContent = insertBlockBeforeTail(latest);
                await writeContent(state, newContent);
            }
            doc.content = newContent;
            if (this.app && this.app.currentDocument
                && this.app.currentDocument.path === doc.path) {
                this.app.currentDocument.content = newContent;
            }
            return newContent;
        } catch (error) {
            console.error('[VisualisationController] Failed to add block:', error);
            if (this.app && this.app.showNotification) {
                this.app.showNotification('Failed to add visualisation: ' + error.message, 'error');
            }
            return null;
        }
    }
};

/* ============================================================================
   Source scanning
   ============================================================================ */

/**
 * Find every top-level ```visualisation``` fence in a markdown source.
 * Mirrors the parser's fence rules (``` or ~~~, closing fence of the same
 * char and at least the same length) so other fenced blocks are skipped and
 * a ```visualisation appearing inside e.g. a ```text example is ignored.
 * @param {string} content
 * @returns {Array<{startLine:number, endLine:number, body:string}>} - line
 *   indices of the opening/closing fences plus the body between them
 */
function findVisualisationBlocks(content) {
    const lines = content.split('\n');
    const blocks = [];
    let fence = null; // { char, len, lang, startLine }

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (fence) {
            const closeRe = new RegExp('^' + fence.char + '{' + fence.len + ',}$');
            if (closeRe.test(trimmed)) {
                if (fence.lang === 'visualisation') {
                    blocks.push({
                        startLine: fence.startLine,
                        endLine: i,
                        body: lines.slice(fence.startLine + 1, i).join('\n')
                    });
                }
                fence = null;
            }
            continue;
        }
        const m = trimmed.match(/^(`{3,}|~{3,})([a-zA-Z0-9\-_]*)$/);
        if (m) {
            fence = {
                char: m[1][0],
                len: m[1].length,
                lang: (m[2] || '').toLowerCase(),
                startLine: i
            };
        }
    }
    return blocks;
}

/** Blocks the backend keeps at the end of the source — insert above these. */
const TAIL_BLOCK_TYPES = new Set(['comments', 'sharedlinkvisits', 'liked']);

/**
 * Insert an empty ```visualisation``` fence into a markdown source, just
 * above the first trailing tail block (comments etc.) or at the very end.
 * @param {string} content
 * @returns {string}
 */
function insertBlockBeforeTail(content) {
    const lines = String(content || '').split('\n');
    let insertAt = lines.length;
    let fence = null;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (fence) {
            const closeRe = new RegExp('^' + fence.char + '{' + fence.len + ',}$');
            if (closeRe.test(trimmed)) fence = null;
            continue;
        }
        const m = trimmed.match(/^(`{3,}|~{3,})([a-zA-Z0-9\-_]*)$/);
        if (m) {
            if (TAIL_BLOCK_TYPES.has((m[2] || '').toLowerCase())) {
                insertAt = i;
                break;
            }
            fence = { char: m[1][0], len: m[1].length };
        }
    }

    // Trim blank lines at the insertion point so we emit exactly one
    // separating blank line on each side of the new fence.
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
    lines.splice(insertAt, 0, '', '```visualisation', '```', '');
    return lines.join('\n');
}

/**
 * Extract the document's heading sections. A section starts at an ATX
 * heading and ends at the next heading of ANY level (so cards never overlap
 * in content). Headings inside fenced blocks are ignored.
 * @param {string} content
 * @returns {Array<{key:string, text:string, level:number, bodyMarkdown:string}>}
 */
function extractSections(content) {
    const lines = content.split('\n');
    const sections = [];
    const slugCounts = Object.create(null);
    let fence = null;
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        if (fence) {
            const closeRe = new RegExp('^' + fence.char + '{' + fence.len + ',}$');
            if (closeRe.test(trimmed)) fence = null;
            if (current) current.body.push(raw);
            continue;
        }
        const fm = trimmed.match(/^(`{3,}|~{3,})([a-zA-Z0-9\-_]*)$/);
        if (fm) {
            fence = { char: fm[1][0], len: fm[1].length };
            if (current) current.body.push(raw);
            continue;
        }

        const hm = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (hm) {
            if (current) sections.push(current);
            const text = hm[2].trim();
            let slug = slugify(text) || 'section';
            if (slugCounts[slug]) {
                slugCounts[slug]++;
                slug = slug + '-' + slugCounts[slug];
            } else {
                slugCounts[slug] = 1;
            }
            current = { key: slug, text, level: hm[1].length, body: [] };
            continue;
        }
        if (current) current.body.push(raw);
    }
    if (current) sections.push(current);

    sections.forEach(s => {
        s.bodyMarkdown = s.body.join('\n').trim();
        delete s.body;
    });
    return sections;
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/* ============================================================================
   Layout (de)serialisation
   ============================================================================ */

/**
 * Parse a visualisation block body into layout data. Unrecognised lines are
 * collected verbatim so write-back never destroys them.
 * @param {string} body
 */
function parseLayout(body) {
    const layout = {
        canvas: { height: DEFAULT_CANVAS_HEIGHT, grid: DEFAULT_GRID },
        items: [],    // { ref, top, left, width, raw }
        connects: [], // { fromRef, toRef, label, raw }
        extras: []    // verbatim lines we don't understand
    };

    String(body || '').split('\n').forEach(line => {
        const t = line.trim();
        if (!t) return;

        if (/^@canvas\b/i.test(t)) {
            const props = parseProps(t.replace(/^@canvas\b/i, ''));
            layout.canvas.height = clamp(numProp(props.height, DEFAULT_CANVAS_HEIGHT), 200, 2000);
            layout.canvas.grid = clamp(numProp(props.grid, DEFAULT_GRID), 1, 100);
            return;
        }

        if (/^@item\b/i.test(t)) {
            const m = t.match(/^@item\s+(?:"([^"]*)"|(\S+))\s*(.*)$/i);
            if (m) {
                const props = parseProps(m[3] || '');
                // Cards auto-size to content; a legacy width: prop is
                // tolerated here but ignored and dropped on write-back.
                layout.items.push({
                    ref: (m[1] != null ? m[1] : m[2]) || '',
                    top: numProp(props.top, 20),
                    left: numProp(props.left, 20),
                    raw: line
                });
                return;
            }
            layout.extras.push(line);
            return;
        }

        if (/^@connect\b/i.test(t)) {
            const m = t.match(/^@connect\s+"([^"]*)"\s*(?:->|→)\s*"([^"]*)"\s*(.*)$/i);
            if (m) {
                const props = parseProps(m[3] || '');
                layout.connects.push({
                    fromRef: m[1],
                    toRef: m[2],
                    label: stripQuotes(props.label || ''),
                    raw: line
                });
                return;
            }
            layout.extras.push(line);
            return;
        }

        layout.extras.push(line);
    });

    return layout;
}

/** Parse `key:value` tokens. Values may be quoted or carry a px suffix. */
function parseProps(s) {
    const props = {};
    const re = /([a-zA-Z-]+)\s*:\s*("[^"]*"|[^\s]+)/g;
    let m;
    while ((m = re.exec(String(s || '')))) {
        props[m[1].toLowerCase()] = m[2];
    }
    return props;
}

function stripQuotes(v) {
    return String(v == null ? '' : v).replace(/^"|"$/g, '');
}

function numProp(v, fallback) {
    if (v == null) return fallback;
    const n = parseFloat(stripQuotes(v).replace(/px$/i, ''));
    return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

/** Quote a heading reference, downgrading embedded double quotes. */
function quoteRef(text) {
    return '"' + String(text || '').replace(/"/g, "'") + '"';
}

/**
 * Serialise the canvas state back into a block body. Items are written in
 * document order; orphan/unknown lines come last, untouched.
 */
function serializeLayout(state) {
    const lines = [];
    lines.push(`@canvas height:${Math.round(state.canvas.height)} grid:${Math.round(state.canvas.grid)}`);

    state.sections.forEach(sec => {
        const it = state.items.get(sec.key);
        if (!it || it.auto) return;
        lines.push(`@item ${quoteRef(sec.text)} top:${Math.round(it.top)} left:${Math.round(it.left)}`);
    });

    state.connects.forEach(c => {
        const from = state.sectionsByKey.get(c.from);
        const to = state.sectionsByKey.get(c.to);
        if (!from || !to) return;
        let line = `@connect ${quoteRef(from.text)} -> ${quoteRef(to.text)}`;
        if (c.label) line += ` label:"${String(c.label).replace(/"/g, "'")}"`;
        lines.push(line);
    });

    state.extras.forEach(l => lines.push(l));
    return lines.join('\n');
}

/* ============================================================================
   Canvas construction
   ============================================================================ */

function buildCanvas(placeholderEl, doc, blockIndex, blockBody, app) {
    const instanceId = ++instanceCounter;
    const sections = extractSections(doc.content);
    const layout = parseLayout(blockBody);

    // --- Resolve @item / @connect heading references --------------------
    const sectionsByKey = new Map();
    const sectionsByText = new Map();
    sections.forEach(s => {
        sectionsByKey.set(s.key, s);
        const lower = s.text.toLowerCase();
        if (!sectionsByText.has(lower)) sectionsByText.set(lower, s); // first occurrence wins
    });
    const resolveRef = (ref) => {
        const t = String(ref || '').trim();
        if (!t) return null;
        return sectionsByText.get(t.toLowerCase()) || sectionsByKey.get(slugify(t)) || null;
    };

    const state = {
        doc, blockIndex, app, instanceId,
        canvas: layout.canvas,
        sections,
        sectionsByKey,
        items: new Map(),      // key -> { top, left, width, auto }
        connects: [],          // { from: key, to: key, label }
        extras: layout.extras.slice(),
        pan: { x: 0, y: 0 },
        zoom: 1,
        arranging: false,
        selectedLink: -1,
        cardEls: new Map()
    };

    layout.items.forEach(it => {
        const sec = resolveRef(it.ref);
        if (!sec) { state.extras.push(it.raw); return; }           // orphan — preserve verbatim
        if (state.items.has(sec.key)) return;                       // duplicate — first wins
        state.items.set(sec.key, {
            top: Math.max(0, it.top),
            left: Math.max(0, it.left),
            auto: false
        });
    });

    layout.connects.forEach(c => {
        const from = resolveRef(c.fromRef);
        const to = resolveRef(c.toRef);
        if (!from || !to || from.key === to.key) { state.extras.push(c.raw); return; }
        if (state.connects.some(x => x.from === from.key && x.to === to.key)) return;
        state.connects.push({ from: from.key, to: to.key, label: c.label || '' });
    });

    // Auto-place sections that have no explicit position: simple grid flow.
    let autoIdx = 0;
    sections.forEach(sec => {
        if (state.items.has(sec.key)) return;
        const col = autoIdx % 3;
        const row = Math.floor(autoIdx / 3);
        state.items.set(sec.key, {
            top: 20 + row * AUTO_PITCH_Y,
            left: 20 + col * AUTO_PITCH_X,
            auto: true
        });
        autoIdx++;
    });

    // --- DOM -------------------------------------------------------------
    placeholderEl.removeAttribute('data-vis-placeholder');
    placeholderEl.innerHTML = `
        <div class="vis-head">
            <div class="lab">
                <i class="bi bi-diagram-3-fill"></i> Visualisation
                <span class="badge">${sections.length} section${sections.length === 1 ? '' : 's'}</span>
                <span class="vis-save-status" aria-live="polite"></span>
            </div>
            <div class="vis-tools">
                <button type="button" class="vis-tool-btn" data-vis-zoom-out title="Zoom out"><i class="bi bi-dash-lg"></i></button>
                <span class="vis-zoom-label" data-vis-zoom-label>100%</span>
                <button type="button" class="vis-tool-btn" data-vis-zoom-in title="Zoom in"><i class="bi bi-plus-lg"></i></button>
                <button type="button" class="vis-tool-btn" data-vis-fit title="Fit to view"><i class="bi bi-aspect-ratio"></i></button>
                <button type="button" class="vis-arrange-btn" data-vis-arrange title="Move sections around">
                    <i class="bi bi-arrows-move"></i> <span>Arrange</span>
                </button>
            </div>
        </div>
        <div class="vis-stage" tabindex="0" style="height:${state.canvas.height}px">
            <div class="vis-world">
                <svg class="vis-links" width="10" height="10"></svg>
            </div>
            <div class="vis-hint">Drag cards to move them &middot; drag a card&rsquo;s <i class="bi bi-plus-circle-fill"></i> port onto another card to connect &middot; double-click a connection to label it</div>
            ${sections.length === 0 ? '<div class="vis-empty">No headings found in this document yet &mdash; add some sections to visualise them.</div>' : ''}
        </div>
    `;

    const stage = placeholderEl.querySelector('.vis-stage');
    const world = placeholderEl.querySelector('.vis-world');
    const svg = placeholderEl.querySelector('.vis-links');
    const zoomLabel = placeholderEl.querySelector('[data-vis-zoom-label]');
    const arrangeBtn = placeholderEl.querySelector('[data-vis-arrange]');
    const saveStatus = placeholderEl.querySelector('.vis-save-status');

    // --- Cards -------------------------------------------------------------
    sections.forEach(sec => {
        const it = state.items.get(sec.key);
        const card = document.createElement('div');
        card.className = 'vis-card';
        card.dataset.visKey = sec.key;
        card.style.left = it.left + 'px';
        card.style.top = it.top + 'px';
        card.innerHTML = `
            <div class="vis-card-head">
                <i class="bi bi-grip-vertical vis-card-grip"></i>
                <span class="vis-card-title" title="${escapeHtml(sec.text)}">${escapeHtml(sec.text)}</span>
                <span class="vis-port" data-vis-port title="Drag to connect"><i class="bi bi-plus-circle-fill"></i></span>
            </div>
            <div class="vis-card-body">${renderCardBody(sec.bodyMarkdown)}</div>
        `;
        world.appendChild(card);
        state.cardEls.set(sec.key, card);
    });

    /* --- Geometry helpers ------------------------------------------------ */

    const cardRect = (key) => {
        const it = state.items.get(key);
        const el = state.cardEls.get(key);
        if (!it || !el) return null;
        // offsetWidth/offsetHeight ignore the world's scale transform, so
        // this stays in world coordinates at any zoom level. Cards size to
        // their content, so both dimensions come from the DOM.
        return { x: it.left, y: it.top, w: el.offsetWidth || 260, h: el.offsetHeight || 120 };
    };

    const screenToWorld = (clientX, clientY) => {
        const rect = stage.getBoundingClientRect();
        return {
            x: (clientX - rect.left - state.pan.x) / state.zoom,
            y: (clientY - rect.top - state.pan.y) / state.zoom
        };
    };

    function applyTransform() {
        world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
        const gridPx = state.canvas.grid * state.zoom;
        stage.style.backgroundSize = `${gridPx}px ${gridPx}px`;
        stage.style.backgroundPosition = `${state.pan.x}px ${state.pan.y}px`;
        if (zoomLabel) zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    }

    function zoomAt(clientX, clientY, nextZoom) {
        closeLabelEditor(false); // its stage-space anchor is about to move
        const target = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
        const pivot = screenToWorld(clientX, clientY);
        const rect = stage.getBoundingClientRect();
        state.pan.x = (clientX - rect.left) - pivot.x * target;
        state.pan.y = (clientY - rect.top) - pivot.y * target;
        state.zoom = target;
        applyTransform();
    }

    function fitView() {
        closeLabelEditor(false); // its stage-space anchor is about to move
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        state.items.forEach((it, key) => {
            const r = cardRect(key);
            if (!r) return;
            minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
            maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
        });
        if (!Number.isFinite(minX)) { state.pan = { x: 0, y: 0 }; state.zoom = 1; applyTransform(); return; }
        const pad = 40;
        const bw = (maxX - minX) + pad * 2;
        const bh = (maxY - minY) + pad * 2;
        const sw = stage.clientWidth || 800;
        const sh = stage.clientHeight || state.canvas.height;
        state.zoom = clamp(Math.min(sw / bw, sh / bh, 1), ZOOM_MIN, ZOOM_MAX);
        state.pan.x = (sw - (maxX - minX) * state.zoom) / 2 - minX * state.zoom;
        state.pan.y = (sh - (maxY - minY) * state.zoom) / 2 - minY * state.zoom;
        applyTransform();
    }

    /* --- Connection rendering --------------------------------------------- */

    function linkGeometry(fromKey, toKey) {
        const a = cardRect(fromKey);
        const b = cardRect(toKey);
        if (!a || !b) return null;
        const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
        const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
        const horizontal = Math.abs(bcx - acx) >= Math.abs(bcy - acy);
        let p1, p2;
        if (horizontal) {
            p1 = { x: bcx >= acx ? a.x + a.w : a.x, y: acy };
            p2 = { x: bcx >= acx ? b.x : b.x + b.w, y: bcy };
        } else {
            p1 = { x: acx, y: bcy >= acy ? a.y + a.h : a.y };
            p2 = { x: bcx, y: bcy >= acy ? b.y : b.y + b.h };
        }
        return { p1, p2, horizontal };
    }

    function bezierPath(p1, p2, horizontal) {
        const span = horizontal ? Math.abs(p2.x - p1.x) : Math.abs(p2.y - p1.y);
        const k = clamp(span / 2, 40, 160);
        if (horizontal) {
            const s = p2.x >= p1.x ? 1 : -1;
            return `M ${p1.x} ${p1.y} C ${p1.x + s * k} ${p1.y}, ${p2.x - s * k} ${p2.y}, ${p2.x} ${p2.y}`;
        }
        const s = p2.y >= p1.y ? 1 : -1;
        return `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + s * k}, ${p2.x} ${p2.y - s * k}, ${p2.x} ${p2.y}`;
    }

    /**
     * Rebuild the SVG layer. `temp` is an in-progress connection drag:
     * { fromKey, x, y } in world coordinates.
     */
    function renderLinks(temp) {
        // Size the SVG to cover every card so paths are never clipped.
        let maxX = 400, maxY = 300;
        state.items.forEach((it, key) => {
            const r = cardRect(key);
            if (!r) return;
            maxX = Math.max(maxX, r.x + r.w);
            maxY = Math.max(maxY, r.y + r.h);
        });
        svg.setAttribute('width', maxX + 400);
        svg.setAttribute('height', maxY + 400);

        const arrowId = `vis-arrow-${instanceId}`;
        let html = `<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="vis-arrow-head"/></marker></defs>`;

        state.connects.forEach((c, i) => {
            const geo = linkGeometry(c.from, c.to);
            if (!geo) return;
            const d = bezierPath(geo.p1, geo.p2, geo.horizontal);
            const mx = (geo.p1.x + geo.p2.x) / 2;
            const my = (geo.p1.y + geo.p2.y) / 2;
            const selected = state.selectedLink === i;
            html += `<g class="vis-link${selected ? ' is-selected' : ''}" data-vis-link="${i}">`;
            html += `<path class="vis-link-line" d="${d}" marker-end="url(#${arrowId})"/>`;
            html += `<path class="vis-link-hit" d="${d}"/>`;
            if (c.label) {
                html += `<text class="vis-link-label" x="${mx}" y="${my - 8}" text-anchor="middle">${escapeHtml(c.label)}</text>`;
            }
            html += `</g>`;
        });

        if (temp) {
            const a = cardRect(temp.fromKey);
            if (a) {
                const p1 = { x: a.x + a.w, y: a.y + 18 };
                html += `<path class="vis-temp-link" d="${bezierPath(p1, { x: temp.x, y: temp.y }, true)}"/>`;
            }
        }

        svg.innerHTML = html;
    }

    /* --- Connection label editor ---------------------------------------------
       A small floating input anchored above a connection's midpoint. Opens on
       double-click (and automatically right after a connection is created).
       Enter / the check button / clicking away commits; Escape cancels; the
       trash button removes the whole connection. */

    const labelEditor = document.createElement('div');
    labelEditor.className = 'vis-label-editor';
    labelEditor.style.display = 'none';
    labelEditor.innerHTML = `
        <input type="text" class="vis-label-input" placeholder="Label this connection" maxlength="60">
        <button type="button" class="vis-tool-btn" data-vis-label-save title="Save label"><i class="bi bi-check-lg"></i></button>
        <button type="button" class="vis-tool-btn vis-label-trash" data-vis-label-trash title="Remove connection"><i class="bi bi-trash"></i></button>
    `;
    stage.appendChild(labelEditor);
    const labelInput = labelEditor.querySelector('.vis-label-input');
    let editingLink = -1;

    function openLabelEditor(idx) {
        const link = state.connects[idx];
        if (!link) return;
        const geo = linkGeometry(link.from, link.to);
        if (!geo) return;
        editingLink = idx;
        state.selectedLink = idx;
        renderLinks();
        // Anchor above the connection midpoint, in stage coordinates.
        const sx = state.pan.x + ((geo.p1.x + geo.p2.x) / 2) * state.zoom;
        const sy = state.pan.y + ((geo.p1.y + geo.p2.y) / 2) * state.zoom;
        labelEditor.style.display = 'flex';
        labelEditor.style.left = Math.round(sx) + 'px';
        labelEditor.style.top = Math.round(sy) + 'px';
        labelInput.value = link.label || '';
        labelInput.focus();
        labelInput.select();
    }

    function closeLabelEditor(commit) {
        if (editingLink === -1) return;
        const link = state.connects[editingLink];
        editingLink = -1;
        labelEditor.style.display = 'none';
        if (commit && link) {
            const value = labelInput.value.trim();
            if (value !== (link.label || '')) {
                link.label = value;
                renderLinks();
                markDirty();
            }
        }
    }

    labelEditor.querySelector('[data-vis-label-save]').addEventListener('click', () => {
        closeLabelEditor(true);
    });
    labelEditor.querySelector('[data-vis-label-trash]').addEventListener('click', () => {
        const idx = editingLink;
        closeLabelEditor(false);
        if (idx !== -1 && state.connects[idx]) {
            state.connects.splice(idx, 1);
            state.selectedLink = -1;
            renderLinks();
            markDirty();
        }
    });
    labelInput.addEventListener('keydown', (e) => {
        e.stopPropagation(); // keep Delete/Escape from acting on the canvas
        if (e.key === 'Enter') closeLabelEditor(true);
        else if (e.key === 'Escape') closeLabelEditor(false);
    });

    /* --- Persistence -------------------------------------------------------- */

    let saveTimer = null;

    function freezeLayout() {
        // First user mutation freezes every auto-placed card so the layout
        // becomes stable and fully explicit in the source.
        state.items.forEach(it => { it.auto = false; });
    }

    function markDirty() {
        freezeLayout();
        setSaveStatus('Saving…', false);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    }

    function flushSave() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            saveNow();
        }
    }

    function setSaveStatus(text, fade) {
        if (!saveStatus) return;
        saveStatus.textContent = text;
        saveStatus.classList.toggle('is-fading', !!fade);
    }

    async function saveNow() {
        saveTimer = null;
        const newBody = serializeLayout(state);
        try {
            const latest = await fetchLatestContent(state) ?? currentContent(state);
            const blocks = findVisualisationBlocks(latest);
            if (state.blockIndex >= blocks.length) {
                throw new Error('Visualisation block no longer present in the document');
            }
            const b = blocks[state.blockIndex];
            const lines = latest.split('\n');
            const newContent = lines.slice(0, b.startLine + 1)
                .concat(newBody.split('\n'), lines.slice(b.endLine))
                .join('\n');

            await writeContent(state, newContent);

            // Keep the in-memory document in sync so a later editor session
            // or re-render starts from what's on disk.
            state.doc.content = newContent;
            if (state.app && state.app.currentDocument
                && state.app.currentDocument.path === state.doc.path) {
                state.app.currentDocument.content = newContent;
            }
            setSaveStatus('Saved', true);
        } catch (error) {
            console.error('[VisualisationController] Save failed:', error);
            setSaveStatus('', false);
            if (state.app && state.app.showNotification) {
                state.app.showNotification('Failed to save visualisation layout: ' + error.message, 'error');
            }
        }
    }

    /* --- Interactions ------------------------------------------------------- */

    let gesture = null; // { type: 'pan'|'card'|'connect', ... }

    function setArranging(on) {
        state.arranging = !!on;
        placeholderEl.classList.toggle('is-arranging', state.arranging);
        if (arrangeBtn) {
            arrangeBtn.classList.toggle('is-active', state.arranging);
            const span = arrangeBtn.querySelector('span');
            if (span) span.textContent = state.arranging ? 'Done' : 'Arrange';
        }
        if (!state.arranging) {
            closeLabelEditor(false);
            state.selectedLink = -1;
            flushSave();
        }
        renderLinks();
    }

    placeholderEl.querySelector('[data-vis-zoom-in]').addEventListener('click', () => {
        const rect = stage.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state.zoom * 1.2);
    });
    placeholderEl.querySelector('[data-vis-zoom-out]').addEventListener('click', () => {
        const rect = stage.getBoundingClientRect();
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state.zoom / 1.2);
    });
    placeholderEl.querySelector('[data-vis-fit]').addEventListener('click', fitView);
    arrangeBtn.addEventListener('click', () => setArranging(!state.arranging));

    stage.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return; // plain scroll keeps scrolling the page
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });

    // In arrange mode links inside cards must not navigate when a drag ends
    // on them.
    stage.addEventListener('click', (e) => {
        if (state.arranging && e.target.closest('a')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // Clicks inside the label editor belong to it; clicking anywhere
        // else while it's open commits the edit (standard inline-edit feel).
        if (e.target.closest('.vis-label-editor')) return;
        if (editingLink !== -1) closeLabelEditor(true);

        const hit = e.target.closest('.vis-link-hit');
        if (hit && state.arranging) {
            const g = hit.closest('[data-vis-link]');
            const idx = g ? parseInt(g.getAttribute('data-vis-link'), 10) : -1;
            // Only rebuild the SVG when the selection actually changes —
            // rebuilding detaches the path mid-gesture and breaks the
            // browser's dblclick synthesis (the second click would land on a
            // replaced node).
            if (state.selectedLink !== idx) {
                state.selectedLink = idx;
                renderLinks();
            }
            e.preventDefault();
            return;
        }

        const port = e.target.closest('[data-vis-port]');
        if (port && state.arranging) {
            const card = port.closest('.vis-card');
            gesture = { type: 'connect', fromKey: card.dataset.visKey, pointerId: e.pointerId };
            stage.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        const card = e.target.closest('.vis-card');
        if (card && state.arranging) {
            const key = card.dataset.visKey;
            const it = state.items.get(key);
            if (!it) return;
            gesture = {
                type: 'card', key,
                startClientX: e.clientX, startClientY: e.clientY,
                origLeft: it.left, origTop: it.top,
                moved: false, pointerId: e.pointerId
            };
            card.classList.add('is-dragging');
            stage.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        if (!card) {
            // Background: pan (both modes). Deselect any selected link.
            if (state.selectedLink !== -1) { state.selectedLink = -1; renderLinks(); }
            gesture = {
                type: 'pan',
                startClientX: e.clientX, startClientY: e.clientY,
                origPanX: state.pan.x, origPanY: state.pan.y,
                pointerId: e.pointerId
            };
            stage.classList.add('is-panning');
            stage.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!gesture || e.pointerId !== gesture.pointerId) return;

        if (gesture.type === 'pan') {
            state.pan.x = gesture.origPanX + (e.clientX - gesture.startClientX);
            state.pan.y = gesture.origPanY + (e.clientY - gesture.startClientY);
            applyTransform();
            return;
        }

        if (gesture.type === 'card') {
            const dx = (e.clientX - gesture.startClientX) / state.zoom;
            const dy = (e.clientY - gesture.startClientY) / state.zoom;
            if (!gesture.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            gesture.moved = true;
            const it = state.items.get(gesture.key);
            const grid = state.canvas.grid || 1;
            it.left = Math.max(0, Math.round((gesture.origLeft + dx) / grid) * grid);
            it.top = Math.max(0, Math.round((gesture.origTop + dy) / grid) * grid);
            const el = state.cardEls.get(gesture.key);
            el.style.left = it.left + 'px';
            el.style.top = it.top + 'px';
            renderLinks();
            return;
        }

        if (gesture.type === 'connect') {
            const w = screenToWorld(e.clientX, e.clientY);
            // Highlight the card under the pointer as a drop target.
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const overCard = under && under.closest ? under.closest('.vis-card') : null;
            state.cardEls.forEach((el, key) => {
                el.classList.toggle('is-drop-target',
                    !!overCard && el === overCard && key !== gesture.fromKey);
            });
            renderLinks({ fromKey: gesture.fromKey, x: w.x, y: w.y });
        }
    });

    const endGesture = (e) => {
        if (!gesture || (e.pointerId !== undefined && e.pointerId !== gesture.pointerId)) return;
        const g = gesture;
        gesture = null;
        stage.classList.remove('is-panning');

        if (g.type === 'card') {
            const el = state.cardEls.get(g.key);
            if (el) el.classList.remove('is-dragging');
            if (g.moved) markDirty();
            return;
        }

        if (g.type === 'connect') {
            state.cardEls.forEach(el => el.classList.remove('is-drop-target'));
            const under = document.elementFromPoint(e.clientX, e.clientY);
            const targetCard = under && under.closest ? under.closest('.vis-card') : null;
            const toKey = targetCard ? targetCard.dataset.visKey : null;
            if (toKey && toKey !== g.fromKey
                && !state.connects.some(c => c.from === g.fromKey && c.to === toKey)) {
                state.connects.push({ from: g.fromKey, to: toKey, label: '' });
                markDirty();
                // Offer a label straight away — Escape keeps it unlabelled.
                openLabelEditor(state.connects.length - 1);
                return;
            }
            renderLinks();
        }
    };
    stage.addEventListener('pointerup', endGesture);
    stage.addEventListener('pointercancel', endGesture);

    stage.addEventListener('dblclick', (e) => {
        if (!state.arranging) return;
        const g = e.target.closest('[data-vis-link]');
        if (!g) return;
        const idx = parseInt(g.getAttribute('data-vis-link'), 10);
        if (state.connects[idx]) openLabelEditor(idx);
    });

    stage.addEventListener('keydown', (e) => {
        if (e.target.closest('.vis-label-editor')) return; // editor handles its own keys
        if (e.key === 'Escape' && state.arranging) {
            setArranging(false);
            return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace')
            && state.arranging && state.selectedLink !== -1) {
            state.connects.splice(state.selectedLink, 1);
            state.selectedLink = -1;
            renderLinks();
            markDirty();
            e.preventDefault();
        }
    });

    // Flush a pending layout save if the user leaves the page mid-debounce.
    window.addEventListener('pagehide', flushSave, { once: true });

    // Initial paint: wait one frame so card heights are measurable, then
    // draw connections and fit everything into view.
    requestAnimationFrame(() => {
        renderLinks();
        fitView();
    });
    applyTransform();
}

/* ============================================================================
   Card content rendering
   ============================================================================ */

/**
 * Render a section body for a card. Heavy custom blocks (mermaid, swagger,
 * tabs, nested visualisations, comment forms, …) are replaced with a small
 * placeholder — cards are too small for them and some are interactive.
 */
function renderCardBody(markdown) {
    const md = String(markdown || '').trim();
    if (!md) return '<div class="vis-card-empty">No content under this heading.</div>';

    const heavy = new Set(
        ((typeof markdownParser !== 'undefined' && markdownParser && markdownParser.customBlockTypes)
            ? markdownParser.customBlockTypes
            : CUSTOM_BLOCK_TYPES_FALLBACK).map(t => String(t).toLowerCase())
    );
    // Document-metadata blocks vanish without a trace (a card noting
    // "[visualisation block]" inside the visualisation itself is pure noise);
    // content-bearing heavy blocks leave a small placeholder.
    const silent = new Set(['visualisation', 'comments', 'sharedlinkvisits', 'liked', 'document']);
    // The closing-fence alternation tries the EMPTY-block case first
    // (```visualisation directly followed by ```) — otherwise the lazy
    // [\s\S]*? scans past the empty block's close and swallows the NEXT
    // block's opening fence, leaving its body to render as stray text.
    const stripped = md.replace(/```([\w-]+)[^\n]*\n(?:```|[\s\S]*?\n```)/g, (whole, lang) => {
        const l = String(lang).toLowerCase();
        if (silent.has(l)) return '';
        return heavy.has(l) ? `_[${lang} block]_` : whole;
    });

    try {
        if (typeof parseMarkdown === 'function') return parseMarkdown(stripped);
    } catch (error) {
        console.warn('[VisualisationController] Card render failed:', error);
    }
    return '<pre>' + escapeHtml(stripped) + '</pre>';
}

/* ============================================================================
   Content fetch / write (mirrors documentcontroller's save endpoints)
   ============================================================================ */

function currentContent(state) {
    if (state.app && state.app.currentDocument
        && state.app.currentDocument.path === state.doc.path
        && typeof state.app.currentDocument.content === 'string') {
        return state.app.currentDocument.content;
    }
    return state.doc.content;
}

/**
 * Re-fetch the freshest document source before writing, so we don't clobber
 * a comment (or other server-side change) that landed while viewing.
 * Returns null when the fetch fails — callers fall back to in-memory content.
 */
async function fetchLatestContent(state) {
    const doc = state.doc;
    let url = null;
    if (doc.spaceId) {
        url = `/applications/wiki/api/spaces/${doc.spaceId}/file-content/${encodeURIComponent(doc.path)}`;
    } else if (doc.spaceName) {
        url = `/applications/wiki/api/documents/content?path=${encodeURIComponent(doc.path)}&spaceName=${encodeURIComponent(doc.spaceName)}`;
    }
    if (!url) return null;
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            const data = await r.json();
            return typeof data.content === 'string' ? data.content : null;
        }
        return await r.text();
    } catch (_) {
        return null;
    }
}

async function writeContent(state, content) {
    const doc = state.doc;
    let response;
    if (doc.spaceId) {
        response = await fetch(
            `/applications/wiki/api/spaces/${doc.spaceId}/file-content/${encodeURIComponent(doc.path)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            }
        );
    } else if (doc.spaceName) {
        response = await fetch('/applications/wiki/api/documents/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: doc.path, spaceName: doc.spaceName, content })
        });
    } else {
        throw new Error('Invalid document location - missing spaceId and spaceName');
    }
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.message || result.error || 'Failed to save document');
    }
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text == null ? '' : text).replace(/[&<>"']/g, m => map[m]);
}
