/**
 * MarkdownEditor — A self-contained Notion-like block editor for markdown.
 *
 * Usage:
 *   const editor = new MarkdownEditor('mycontentdiv');
 *   editor.load('# Hello\n\nSome **bold** text');
 *   const md = editor.content();
 *
 * All CSS is injected automatically and scoped under `.we-root` to avoid
 * conflicts with the host application.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarkdownEditor = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Capture this script's URL during parse so injectCSS can resolve a sibling stylesheet.
  // document.currentScript is only valid during synchronous execution of the script.
  const _moduleScriptSrc = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  /* ===================================================================
   *  CSS — injected once into <head>, scoped under .we-root
   * =================================================================*/
  const HLJS_INJECTED_KEY = '__markdownEditorHljsInjected';
  let hljsReady = false;
  let hljsCallbacks = [];

  function injectHighlightJS() {
    if (document[HLJS_INJECTED_KEY]) return;
    document[HLJS_INJECTED_KEY] = true;

    // Theme CSS — atom-one-dark matches our dark code container
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/atom-one-dark.min.css';
    document.head.appendChild(link);

    // Override hljs background to match our container
    const patch = document.createElement('style');
    patch.textContent = `.we-root .editor-code-body code.hljs { background: transparent; padding: 0; }
.we-root .preview-code code.hljs { background: transparent; padding: 0; }`;
    document.head.appendChild(patch);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js';
    script.onload = function () {
      hljsReady = true;
      hljsCallbacks.forEach(fn => fn());
      hljsCallbacks = [];
    };
    document.head.appendChild(script);
  }

  function whenHljsReady(fn) {
    if (hljsReady) fn();
    else hljsCallbacks.push(fn);
  }

  /* ------- Mermaid.js CDN Loader ------- */
  const MERMAID_INJECTED_KEY = '__markdownEditorMermaidInjected';
  let mermaidReady = false;
  let mermaidCallbacks = [];

  function injectMermaidJS() {
    if (document[MERMAID_INJECTED_KEY]) return;
    document[MERMAID_INJECTED_KEY] = true;

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = function () {
      window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
      mermaidReady = true;
      mermaidCallbacks.forEach(fn => fn());
      mermaidCallbacks = [];
    };
    document.head.appendChild(script);
  }

  function whenMermaidReady(fn) {
    if (mermaidReady) fn();
    else mermaidCallbacks.push(fn);
  }

  /* ------- Swagger UI CDN Loader ------- */
  const SWAGGER_INJECTED_KEY = '__markdownEditorSwaggerInjected';
  let swaggerReady = false;
  let swaggerCallbacks = [];

  function injectSwaggerUI() {
    if (document[SWAGGER_INJECTED_KEY]) return;
    document[SWAGGER_INJECTED_KEY] = true;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css';
    document.head.appendChild(link);

    // Scope swagger styles to avoid conflicts
    const patch = document.createElement('style');
    patch.textContent = `.we-root .editor-swagger-ui-wrapper .swagger-ui { font-size: 14px; }
.we-root .editor-swagger-ui-wrapper .swagger-ui .wrapper { padding: 0; }
.we-root .editor-swagger-ui-wrapper .swagger-ui .info { margin: 10px 0; }`;
    document.head.appendChild(patch);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js';
    script.onload = function () {
      swaggerReady = true;
      swaggerCallbacks.forEach(fn => fn());
      swaggerCallbacks = [];
    };
    document.head.appendChild(script);
  }

  function whenSwaggerReady(fn) {
    if (swaggerReady) fn();
    else swaggerCallbacks.push(fn);
  }

  const CSS_INJECTED_KEY = '__markdownEditorCssInjected';

  function injectCSS() {
    if (document[CSS_INJECTED_KEY]) return;
    document[CSS_INJECTED_KEY] = true;

    // Resolve the stylesheet URL: explicit window override > derived from script src > fallback
    let cssUrl = (typeof window !== 'undefined' && window.MarkdownEditorCssUrl) || '';
    if (!cssUrl && _moduleScriptSrc) {
      // Preserve the script's ?v= cache-busting query (and any #hash) on the
      // derived CSS URL so bumping the editor's version in the page busts the
      // stylesheet too — otherwise new editor styles can be served stale.
      if (/\/js\/markdown-editor\.js(\?|#|$)/.test(_moduleScriptSrc)) {
        // "/js/markdown-editor.js" -> "/css/markdown-editor.css"
        cssUrl = _moduleScriptSrc.replace(/\/js\/markdown-editor\.js(\?[^#]*)?(#.*)?$/, (m, q, h) => '/css/markdown-editor.css' + (q || '') + (h || ''));
      } else {
        // Fallback: CSS sits next to JS
        cssUrl = _moduleScriptSrc.replace(/markdown-editor\.js(\?[^#]*)?(#.*)?$/, (m, q, h) => 'markdown-editor.css' + (q || '') + (h || ''));
      }
    }
    if (!cssUrl) cssUrl = 'markdown-editor.css';

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-markdown-editor', '');
    link.href = cssUrl;
    document.head.appendChild(link);
  }

  /* ===================================================================
   *  Slash-menu HTML template (created once per instance, appended to body)
   * =================================================================*/
  function createSlashMenuHTML() {
    const el = document.createElement('div');
    el.className = 'we-slash-menu hidden';
    el.innerHTML = `
      <div class="slash-command-list" data-panel="main">
        <div class="slash-command-item" data-action="open-headings">
          <div class="slash-command-icon">H</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Heading</div>
            <div class="slash-command-desc">Section heading</div>
          </div>
          <div class="slash-command-arrow">\u203A</div>
        </div>
        <div class="slash-command-item" data-action="open-emphasis">
          <div class="slash-command-icon">B</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Emphasis</div>
            <div class="slash-command-desc">Bold, italic, underline</div>
          </div>
          <div class="slash-command-arrow">\u203A</div>
        </div>
        <div class="slash-command-item" data-type="paragraph">
          <div class="slash-command-icon">\u00B6</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Paragraph</div>
            <div class="slash-command-desc">Start with plain text</div>
          </div>
        </div>
        <div class="slash-command-item" data-action="open-lists">
          <div class="slash-command-icon">\u2261</div>
          <div class="slash-command-text">
            <div class="slash-command-title">List</div>
            <div class="slash-command-desc">Bulleted or numbered list</div>
          </div>
          <div class="slash-command-arrow">\u203A</div>
        </div>
        <div class="slash-command-item" data-action="open-code-advanced">
          <div class="slash-command-icon">&lt;&gt;</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Code</div>
            <div class="slash-command-desc">Code, Mermaid, Swagger</div>
          </div>
          <div class="slash-command-arrow">\u203A</div>
        </div>
        <div class="slash-command-item" data-type="quote">
          <div class="slash-command-icon">\u275D</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Quote</div>
            <div class="slash-command-desc">Highlight a quote</div>
          </div>
        </div>
        <div class="slash-command-item" data-type="checklist">
          <div class="slash-command-icon">\u2611</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Checklist</div>
            <div class="slash-command-desc">Task list with checkboxes</div>
          </div>
        </div>
        <div class="slash-command-item" data-type="delimiter">
          <div class="slash-command-icon">\u2014</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Divider</div>
            <div class="slash-command-desc">Horizontal line separator</div>
          </div>
        </div>
        <div class="slash-command-item" data-type="image">
          <div class="slash-command-icon">\uD83D\uDDBC</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Image</div>
            <div class="slash-command-desc">Embed an image</div>
          </div>
        </div>
        <div class="slash-command-item" data-type="table">
          <div class="slash-command-icon">\u25A6</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Table</div>
            <div class="slash-command-desc">Insert a data table</div>
          </div>
        </div>
        <div class="slash-command-item" data-type="link">
          <div class="slash-command-icon">\uD83D\uDD17</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Link</div>
            <div class="slash-command-desc">Add a bookmark link</div>
          </div>
        </div>
        <div class="slash-command-item" data-action="open-layout">
          <div class="slash-command-icon">\u2B1A</div>
          <div class="slash-command-text">
            <div class="slash-command-title">Layout</div>
            <div class="slash-command-desc">Columns, cards, header, footer</div>
          </div>
          <div class="slash-command-arrow">\u203A</div>
        </div>
      </div>
      <!-- Headings panel -->
      <div class="slash-command-list hidden" data-panel="headings">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">\u2039</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-type="header-1"><div class="slash-command-icon">H1</div><div class="slash-command-text"><div class="slash-command-title">Heading 1</div><div class="slash-command-desc">Page title</div></div></div>
        <div class="slash-command-item" data-type="header-2"><div class="slash-command-icon">H2</div><div class="slash-command-text"><div class="slash-command-title">Heading 2</div><div class="slash-command-desc">Section heading</div></div></div>
        <div class="slash-command-item" data-type="header-3"><div class="slash-command-icon">H3</div><div class="slash-command-text"><div class="slash-command-title">Heading 3</div><div class="slash-command-desc">Subsection heading</div></div></div>
        <div class="slash-command-item" data-type="header-4"><div class="slash-command-icon">H4</div><div class="slash-command-text"><div class="slash-command-title">Heading 4</div><div class="slash-command-desc">Small heading</div></div></div>
        <div class="slash-command-item" data-type="header-5"><div class="slash-command-icon">H5</div><div class="slash-command-text"><div class="slash-command-title">Heading 5</div><div class="slash-command-desc">Minor heading</div></div></div>
        <div class="slash-command-item" data-type="header-6"><div class="slash-command-icon">H6</div><div class="slash-command-text"><div class="slash-command-title">Heading 6</div><div class="slash-command-desc">Smallest heading</div></div></div>
      </div>
      <!-- Emphasis panel -->
      <div class="slash-command-list hidden" data-panel="emphasis">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">\u2039</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-format="bold"><div class="slash-command-icon"><strong>B</strong></div><div class="slash-command-text"><div class="slash-command-title">Bold</div><div class="slash-command-desc">Strong emphasis</div></div></div>
        <div class="slash-command-item" data-format="italic"><div class="slash-command-icon"><em>I</em></div><div class="slash-command-text"><div class="slash-command-title">Italic</div><div class="slash-command-desc">Subtle emphasis</div></div></div>
        <div class="slash-command-item" data-format="underline"><div class="slash-command-icon" style="text-decoration:underline;">U</div><div class="slash-command-text"><div class="slash-command-title">Underline</div><div class="slash-command-desc">Underline text</div></div></div>
        <div class="slash-command-item" data-action="open-badges"><div class="slash-command-icon">●</div><div class="slash-command-text"><div class="slash-command-title">Badge</div><div class="slash-command-desc">Coloured pill (primary, success, danger, …)</div></div><div class="slash-command-arrow">›</div></div>
      </div>
      <!-- Badges panel -->
      <div class="slash-command-list hidden" data-panel="badges">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">‹</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-format="badge-primary"><div class="slash-command-icon"><span class="badge text-bg-primary">A</span></div><div class="slash-command-text"><div class="slash-command-title">Primary</div><div class="slash-command-desc">Brand-coloured badge</div></div></div>
        <div class="slash-command-item" data-format="badge-secondary"><div class="slash-command-icon"><span class="badge text-bg-secondary">A</span></div><div class="slash-command-text"><div class="slash-command-title">Secondary</div><div class="slash-command-desc">Muted neutral badge</div></div></div>
        <div class="slash-command-item" data-format="badge-success"><div class="slash-command-icon"><span class="badge text-bg-success">A</span></div><div class="slash-command-text"><div class="slash-command-title">Success</div><div class="slash-command-desc">Green status badge</div></div></div>
        <div class="slash-command-item" data-format="badge-danger"><div class="slash-command-icon"><span class="badge text-bg-danger">A</span></div><div class="slash-command-text"><div class="slash-command-title">Danger</div><div class="slash-command-desc">Red alert badge</div></div></div>
        <div class="slash-command-item" data-format="badge-warning"><div class="slash-command-icon"><span class="badge text-bg-warning">A</span></div><div class="slash-command-text"><div class="slash-command-title">Warning</div><div class="slash-command-desc">Amber attention badge</div></div></div>
        <div class="slash-command-item" data-format="badge-info"><div class="slash-command-icon"><span class="badge text-bg-info">A</span></div><div class="slash-command-text"><div class="slash-command-title">Info</div><div class="slash-command-desc">Cyan informational badge</div></div></div>
        <div class="slash-command-item" data-format="badge-light"><div class="slash-command-icon"><span class="badge text-bg-light">A</span></div><div class="slash-command-text"><div class="slash-command-title">Light</div><div class="slash-command-desc">Light surface badge</div></div></div>
        <div class="slash-command-item" data-format="badge-dark"><div class="slash-command-icon"><span class="badge text-bg-dark">A</span></div><div class="slash-command-text"><div class="slash-command-title">Dark</div><div class="slash-command-desc">Dark surface badge</div></div></div>
      </div>
      <!-- Lists panel -->
      <div class="slash-command-list hidden" data-panel="lists">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">\u2039</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-type="list-unordered"><div class="slash-command-icon">\u2022</div><div class="slash-command-text"><div class="slash-command-title">Bulleted List</div><div class="slash-command-desc">Unordered list with bullets</div></div></div>
        <div class="slash-command-item" data-type="list-ordered"><div class="slash-command-icon">1.</div><div class="slash-command-text"><div class="slash-command-title">Numbered List</div><div class="slash-command-desc">Ordered list with numbers</div></div></div>
      </div>
      <!-- Code Advanced panel -->
      <div class="slash-command-list hidden" data-panel="code-advanced">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">\u2039</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-type="code"><div class="slash-command-icon">&lt;&gt;</div><div class="slash-command-text"><div class="slash-command-title">Code</div><div class="slash-command-desc">Code snippet with syntax highlighting</div></div></div>
        <div class="slash-command-item" data-type="mermaid"><div class="slash-command-icon">\u2B21</div><div class="slash-command-text"><div class="slash-command-title">Mermaid Diagram</div><div class="slash-command-desc">Flowcharts, sequences, etc.</div></div></div>
        <div class="slash-command-item" data-type="swagger"><div class="slash-command-icon">\u2B13</div><div class="slash-command-text"><div class="slash-command-title">Swagger / API</div><div class="slash-command-desc">OpenAPI documentation</div></div></div>
      </div>
      <!-- Layout panel -->
      <div class="slash-command-list hidden" data-panel="layout">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">\u2039</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-type="columns"><div class="slash-command-icon">\u2225</div><div class="slash-command-text"><div class="slash-command-title">Columns</div><div class="slash-command-desc">Multi-column layout</div></div></div>
        <div class="slash-command-item" data-type="cards"><div class="slash-command-icon">\u25A3</div><div class="slash-command-text"><div class="slash-command-title">Cards</div><div class="slash-command-desc">Grid of content cards</div></div></div>
        <div class="slash-command-item" data-type="summary"><div class="slash-command-icon">\uD83D\uDCCB</div><div class="slash-command-text"><div class="slash-command-title">Summary</div><div class="slash-command-desc">Highlighted callout box</div></div></div>
        <div class="slash-command-item" data-type="document"><div class="slash-command-icon">\uD83D\uDCC4</div><div class="slash-command-text"><div class="slash-command-title">Document</div><div class="slash-command-desc">Metadata fields (hidden in view)</div></div></div>
        <div class="slash-command-item" data-type="pane"><div class="slash-command-icon">\u29C9</div><div class="slash-command-text"><div class="slash-command-title">Pane</div><div class="slash-command-desc">Embed another document inline</div></div></div>
        <div class="slash-command-item" data-type="linked-documents"><div class="slash-command-icon">\u21C4</div><div class="slash-command-text"><div class="slash-command-title">Linked documents</div><div class="slash-command-desc">Cards for related documents and folders</div></div></div>
        <div class="slash-command-item" data-type="recent-changes"><div class="slash-command-icon">\u21BB</div><div class="slash-command-text"><div class="slash-command-title">Recent changes</div><div class="slash-command-desc">Grid of what changed lately in a folder</div></div></div>
        <div class="slash-command-item" data-type="pinned-recent-changes"><div class="slash-command-icon">\u2605</div><div class="slash-command-text"><div class="slash-command-title">Changes in your interests</div><div class="slash-command-desc">The same grid, from each reader's pins</div></div></div>
        <div class="slash-command-item" data-type="site-header"><div class="slash-command-icon">\u2302</div><div class="slash-command-text"><div class="slash-command-title">Header</div><div class="slash-command-desc">Site navigation header</div></div></div>
        <div class="slash-command-item" data-type="site-footer"><div class="slash-command-icon">\u2584</div><div class="slash-command-text"><div class="slash-command-title">Footer</div><div class="slash-command-desc">Site footer with links</div></div></div>
        <div class="slash-command-item" data-action="open-landing"><div class="slash-command-icon">\u25a4</div><div class="slash-command-text"><div class="slash-command-title">Landing page</div><div class="slash-command-desc">Hero, news, tiles, stories, CTA</div></div><div class="slash-command-arrow">\u203a</div></div>
      </div>
      <!-- Landing panel -->
      <div class="slash-command-list hidden" data-panel="landing">
        <div class="slash-command-item slash-back-item" data-action="back">
          <div class="slash-command-icon">\u2039</div>
          <div class="slash-command-text"><div class="slash-command-title">Back</div></div>
        </div>
        <div class="slash-command-item" data-type="landing-hero"><div class="slash-command-icon">\u2588</div><div class="slash-command-text"><div class="slash-command-title">Landing Hero</div><div class="slash-command-desc">Full-width banner with headline stats</div></div></div>
        <div class="slash-command-item" data-type="news"><div class="slash-command-icon">\u2637</div><div class="slash-command-text"><div class="slash-command-title">News</div><div class="slash-command-desc">Announcement cards with category tags</div></div></div>
        <div class="slash-command-item" data-type="tiles"><div class="slash-command-icon">\u25a6</div><div class="slash-command-text"><div class="slash-command-title">Tiles</div><div class="slash-command-desc">Clickable browse grid</div></div></div>
        <div class="slash-command-item" data-type="stories"><div class="slash-command-icon">\u275d</div><div class="slash-command-text"><div class="slash-command-title">Stories</div><div class="slash-command-desc">Pull quotes with attribution</div></div></div>
        <div class="slash-command-item" data-type="cta"><div class="slash-command-icon">\u2723</div><div class="slash-command-text"><div class="slash-command-title">Call to Action</div><div class="slash-command-desc">Closing band with action cards</div></div></div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function createBlockAddMenuHTML() {
    const menu = document.createElement('div');
    menu.className = 'we-block-add-menu hidden';
    menu.innerHTML = `
      <div class="block-add-panel" data-panel="main">
        <div class="block-add-menu-item" data-action="open-headings"><div class="block-add-menu-icon">H</div><div class="block-add-menu-title">Heading</div><div class="block-add-menu-arrow">\u203A</div></div>
        <div class="block-add-menu-item" data-action="open-emphasis"><div class="block-add-menu-icon"><strong>B</strong></div><div class="block-add-menu-title">Emphasis</div><div class="block-add-menu-arrow">\u203A</div></div>
        <div class="block-add-menu-item" data-type="paragraph"><div class="block-add-menu-icon">\u00B6</div><div class="block-add-menu-title">Paragraph</div></div>
        <div class="block-add-menu-item" data-action="open-lists"><div class="block-add-menu-icon">\u2261</div><div class="block-add-menu-title">List</div><div class="block-add-menu-arrow">\u203A</div></div>
        <div class="block-add-menu-item" data-action="open-code-advanced"><div class="block-add-menu-icon">&lt;&gt;</div><div class="block-add-menu-title">Code</div><div class="block-add-menu-arrow">\u203A</div></div>
        <div class="block-add-menu-item" data-type="quote"><div class="block-add-menu-icon">\u275D</div><div class="block-add-menu-title">Quote</div></div>
        <div class="block-add-menu-item" data-type="checklist"><div class="block-add-menu-icon">\u2611</div><div class="block-add-menu-title">Checklist</div></div>
        <div class="block-add-menu-item" data-type="delimiter"><div class="block-add-menu-icon">\u2014</div><div class="block-add-menu-title">Divider</div></div>
        <div class="block-add-menu-item" data-type="image"><div class="block-add-menu-icon">\uD83D\uDDBC</div><div class="block-add-menu-title">Image</div></div>
        <div class="block-add-menu-item" data-type="table"><div class="block-add-menu-icon">\u25A6</div><div class="block-add-menu-title">Table</div></div>
        <div class="block-add-menu-item" data-type="link"><div class="block-add-menu-icon">\uD83D\uDD17</div><div class="block-add-menu-title">Link</div></div>
        <div class="block-add-menu-item" data-action="open-layout"><div class="block-add-menu-icon">\u2B1A</div><div class="block-add-menu-title">Layout</div><div class="block-add-menu-arrow">\u203A</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="headings">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">\u2039</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-type="header-1"><div class="block-add-menu-icon">H1</div><div class="block-add-menu-title">Heading 1</div></div>
        <div class="block-add-menu-item" data-type="header-2"><div class="block-add-menu-icon">H2</div><div class="block-add-menu-title">Heading 2</div></div>
        <div class="block-add-menu-item" data-type="header-3"><div class="block-add-menu-icon">H3</div><div class="block-add-menu-title">Heading 3</div></div>
        <div class="block-add-menu-item" data-type="header-4"><div class="block-add-menu-icon">H4</div><div class="block-add-menu-title">Heading 4</div></div>
        <div class="block-add-menu-item" data-type="header-5"><div class="block-add-menu-icon">H5</div><div class="block-add-menu-title">Heading 5</div></div>
        <div class="block-add-menu-item" data-type="header-6"><div class="block-add-menu-icon">H6</div><div class="block-add-menu-title">Heading 6</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="emphasis">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">\u2039</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-format="bold"><div class="block-add-menu-icon"><strong>B</strong></div><div class="block-add-menu-title">Bold</div></div>
        <div class="block-add-menu-item" data-format="italic"><div class="block-add-menu-icon"><em>I</em></div><div class="block-add-menu-title">Italic</div></div>
        <div class="block-add-menu-item" data-format="underline"><div class="block-add-menu-icon" style="text-decoration:underline;">U</div><div class="block-add-menu-title">Underline</div></div>
        <div class="block-add-menu-item" data-action="open-badges"><div class="block-add-menu-icon">●</div><div class="block-add-menu-title">Badge</div><div class="block-add-menu-arrow">›</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="badges">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">‹</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-format="badge-primary"><div class="block-add-menu-icon"><span class="badge text-bg-primary">A</span></div><div class="block-add-menu-title">Primary</div></div>
        <div class="block-add-menu-item" data-format="badge-secondary"><div class="block-add-menu-icon"><span class="badge text-bg-secondary">A</span></div><div class="block-add-menu-title">Secondary</div></div>
        <div class="block-add-menu-item" data-format="badge-success"><div class="block-add-menu-icon"><span class="badge text-bg-success">A</span></div><div class="block-add-menu-title">Success</div></div>
        <div class="block-add-menu-item" data-format="badge-danger"><div class="block-add-menu-icon"><span class="badge text-bg-danger">A</span></div><div class="block-add-menu-title">Danger</div></div>
        <div class="block-add-menu-item" data-format="badge-warning"><div class="block-add-menu-icon"><span class="badge text-bg-warning">A</span></div><div class="block-add-menu-title">Warning</div></div>
        <div class="block-add-menu-item" data-format="badge-info"><div class="block-add-menu-icon"><span class="badge text-bg-info">A</span></div><div class="block-add-menu-title">Info</div></div>
        <div class="block-add-menu-item" data-format="badge-light"><div class="block-add-menu-icon"><span class="badge text-bg-light">A</span></div><div class="block-add-menu-title">Light</div></div>
        <div class="block-add-menu-item" data-format="badge-dark"><div class="block-add-menu-icon"><span class="badge text-bg-dark">A</span></div><div class="block-add-menu-title">Dark</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="lists">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">\u2039</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-type="list-unordered"><div class="block-add-menu-icon">\u2022</div><div class="block-add-menu-title">Bulleted List</div></div>
        <div class="block-add-menu-item" data-type="list-ordered"><div class="block-add-menu-icon">1.</div><div class="block-add-menu-title">Numbered List</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="code-advanced">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">\u2039</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-type="code"><div class="block-add-menu-icon">&lt;&gt;</div><div class="block-add-menu-title">Code</div></div>
        <div class="block-add-menu-item" data-type="mermaid"><div class="block-add-menu-icon">\u2B21</div><div class="block-add-menu-title">Mermaid Diagram</div></div>
        <div class="block-add-menu-item" data-type="swagger"><div class="block-add-menu-icon">\u2B13</div><div class="block-add-menu-title">Swagger / API</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="layout">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">\u2039</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-type="columns"><div class="block-add-menu-icon">\u2225</div><div class="block-add-menu-title">Columns</div></div>
        <div class="block-add-menu-item" data-type="cards"><div class="block-add-menu-icon">\u25A3</div><div class="block-add-menu-title">Cards</div></div>
        <div class="block-add-menu-item" data-type="tabs"><div class="block-add-menu-icon">\u1405</div><div class="block-add-menu-title">Tabs</div></div>
        <div class="block-add-menu-item" data-type="accordion"><div class="block-add-menu-icon">\u25BD</div><div class="block-add-menu-title">Accordion</div></div>
        <div class="block-add-menu-item" data-type="summary"><div class="block-add-menu-icon">\uD83D\uDCCB</div><div class="block-add-menu-title">Summary</div></div>
        <div class="block-add-menu-item" data-type="document"><div class="block-add-menu-icon">\uD83D\uDCC4</div><div class="block-add-menu-title">Document</div></div>
        <div class="block-add-menu-item" data-type="pane"><div class="block-add-menu-icon">\u29C9</div><div class="block-add-menu-title">Pane</div></div>
        <div class="block-add-menu-item" data-type="linked-documents"><div class="block-add-menu-icon">\u21C4</div><div class="block-add-menu-title">Linked documents</div></div>
        <div class="block-add-menu-item" data-type="recent-changes"><div class="block-add-menu-icon">\u21BB</div><div class="block-add-menu-title">Recent changes</div></div>
        <div class="block-add-menu-item" data-type="pinned-recent-changes"><div class="block-add-menu-icon">\u2605</div><div class="block-add-menu-title">Changes in your interests</div></div>
        <div class="block-add-menu-item" data-type="site-header"><div class="block-add-menu-icon">\u2302</div><div class="block-add-menu-title">Header</div></div>
        <div class="block-add-menu-item" data-type="site-footer"><div class="block-add-menu-icon">\u2584</div><div class="block-add-menu-title">Footer</div></div>
        <div class="block-add-menu-item" data-action="open-landing"><div class="block-add-menu-icon">\u25a4</div><div class="block-add-menu-title">Landing page</div><div class="block-add-menu-arrow">\u203a</div></div>
      </div>
      <div class="block-add-panel hidden" data-panel="landing">
        <div class="block-add-menu-item" data-action="back"><div class="block-add-menu-icon">\u2039</div><div class="block-add-menu-title">Back</div></div>
        <div class="block-add-menu-item" data-type="landing-hero"><div class="block-add-menu-icon">\u2588</div><div class="block-add-menu-title">Landing Hero</div></div>
        <div class="block-add-menu-item" data-type="news"><div class="block-add-menu-icon">\u2637</div><div class="block-add-menu-title">News</div></div>
        <div class="block-add-menu-item" data-type="tiles"><div class="block-add-menu-icon">\u25a6</div><div class="block-add-menu-title">Tiles</div></div>
        <div class="block-add-menu-item" data-type="stories"><div class="block-add-menu-icon">\u275d</div><div class="block-add-menu-title">Stories</div></div>
        <div class="block-add-menu-item" data-type="cta"><div class="block-add-menu-icon">\u2723</div><div class="block-add-menu-title">Call to Action</div></div>
      </div>
    `;
    document.body.appendChild(menu);
    return menu;
  }

  /* ===================================================================
   *  MarkdownEditor class
   * =================================================================*/
  class MarkdownEditor {
    /**
     * Create a new MarkdownEditor instance.
     * @param {string} containerId - The id of the container element
     * @param {object} [options] - Optional settings
     * @param {function} [options.onChange] - Callback when content changes
     * @param {function} [options.resolveImageSrc] - Custom image src resolver
     * @param {Array<string|{url:string,label?:string,description?:string}>} [options.urls] - URL suggestions for autocomplete in URL/image input fields
     * @param {function():(Array|Promise<Array>)} [options.getUrls] - Lazy URL suggestion provider; called the first time a URL field is focused
     * @param {function(string, string):(Array|Promise<Array>)} [options.getDocumentSuggestions] - Dynamic document suggestion provider for wiki-reference fields (pane source, linked-documents source); called with the typed query and the field's `data-role`, returns {url,label,description} items
     * @param {function(File):Promise<string>} [options.uploadImage] - Host image-upload provider; given a picked File it stores the image and resolves to a reference the document can use (a path relative to the document, or an absolute/external URL). Enables the document block's "Upload cover" control; omit it and that control is hidden.
     */
    constructor(containerId, options) {
      injectCSS();
      injectHighlightJS();
      injectMermaidJS();

      this._options = options || {};
      this._container = document.getElementById(containerId);
      if (!this._container) {
        throw new Error(`MarkdownEditor: element with id "${containerId}" not found`);
      }

      this._abortController = new AbortController();
      this._blocks = [];
      this._data = { blocks: [], version: '1.0' };
      this._currentBlockIndex = -1;
      this._dragSourceIndex = null;
      this._isPreviewMode = false;
      this._onChange = this._options.onChange || (() => {});
      this._resolveImageSrcFn = this._options.resolveImageSrc || null;

      // Image block that is currently "armed" to receive a pasted image as an
      // inline base64 data URI (set when its drop zone is focused). Lets a
      // host-level paste handler route the file here instead of uploading it
      // to a folder. See consumePastedImageFile() / hasArmedImageBlock().
      this._pasteTargetImageBlockEl = null;
      // The image drop zone currently highlighted during an OS file drag-over.
      this._dragHoverImageZone = null;
      // Soft ceiling on inline-embedded image size (raw bytes, before base64
      // inflates ~33%). Larger images bloat the markdown file, so block them.
      this._maxInlineImageBytes = this._options.maxInlineImageBytes || 12 * 1024 * 1024;

      // URL autocomplete state
      this._urlSuggestions = this._normalizeUrlSuggestions(this._options.urls);
      this._getUrlSuggestionsFn = typeof this._options.getUrls === 'function' ? this._options.getUrls : null;
      this._urlSuggestionsLoaded = !this._getUrlSuggestionsFn;
      this._urlAutocomplete = { dropdown: null, activeInput: null, items: [], selectedIndex: 0, visible: false };

      // Dynamic document autocomplete (pane source fields) — unlike the
      // static URL list, every keystroke re-queries the provider.
      this._getDocSuggestionsFn = typeof this._options.getDocumentSuggestions === 'function' ? this._options.getDocumentSuggestions : null;
      this._docSuggestTimer = null;
      this._docSuggestToken = 0;

      // Host-provided image upload (document block "Upload cover"). Without it
      // the control is hidden, since the editor itself has no way to store a
      // file — only the host knows the space/folder it belongs in.
      this._uploadImageFn = typeof this._options.uploadImage === 'function' ? this._options.uploadImage : null;

      // Slash menu state
      this._slashMenuOpen = false;
      this._slashMenuSelectedIndex = 0;
      this._slashCurrentPanel = 'main';
      this._savedSelection = null;

      // Build DOM
      this._container.classList.add('we-root');
      this._container.innerHTML = '';

      // Hints bar
      this._hints = document.createElement('div');
      this._hints.className = 'we-hints';
      this._hints.innerHTML = '<p>\uD83D\uDCA1 <strong>Tip:</strong> Type <kbd>/</kbd> to see block options. <kbd>Ctrl+B</kbd> Bold, <kbd>Ctrl+I</kbd> Italic, <kbd>Ctrl+U</kbd> Underline.</p>';
      this._container.appendChild(this._hints);

      // Editor area (holds blocks)
      this._holder = document.createElement('div');
      this._holder.className = 'we-editor-area';
      this._container.appendChild(this._holder);

      // Preview area
      this._previewPane = document.createElement('div');
      this._previewPane.className = 'we-preview hidden';
      this._container.appendChild(this._previewPane);

      // Menus (appended to body for fixed positioning)
      this._slashMenu = createSlashMenuHTML();
      this._blockAddMenu = createBlockAddMenuHTML();

      // Initial render
      this._render();
      this._attachEventListeners();
      this._setupPlaceholders();
      this._initSlashCommands();
      this._initUrlAutocomplete();
    }

    /**
     * Replace the URL suggestion list at runtime.
     * @param {Array<string|{url:string,label?:string,description?:string}>} urls
     */
    setUrlSuggestions(urls) {
      this._urlSuggestions = this._normalizeUrlSuggestions(urls);
      this._urlSuggestionsLoaded = true;
      if (this._urlAutocomplete && this._urlAutocomplete.activeInput) {
        this._refreshUrlAutocompleteItems();
      }
    }

    /* ---------------------------------------------------------------
     *  Public API
     * -------------------------------------------------------------*/

    /**
     * Load markdown content into the editor.
     * @param {string} markdown
     */
    load(markdown) {
      this._fromMarkdown(markdown || '');
    }

    /**
     * Retrieve the current editor content as a markdown string.
     * @returns {string}
     */
    content() {
      // Commit any in-progress block edits (e.g. table cells the user typed
      // into but never clicked the inline Save for) back into block.data, so
      // the markdown serializer sees the latest values.
      this._flushPendingEdits();
      return this._toMarkdown();
    }

    /**
     * Walk live block DOM and push any unsaved input/textarea values back into
     * the corresponding block.data. Today this only matters for the table
     * block — its data is only updated when the user clicks its inline Save
     * button, so a top-level document save (Ctrl+S or the Save toolbar) would
     * otherwise drop any cell edits made since the last inline Save.
     *
     * Intentionally silent: does NOT collapse the table or fire _onChange so
     * the user's in-progress UI state isn't disturbed.
     */
    _flushPendingEdits() {
      if (!this._holder) return;
      const blockEls = this._holder.querySelectorAll('.editor-block[data-type="table"]');
      blockEls.forEach(blockEl => {
        const index = parseInt(blockEl.dataset.index);
        const block = this._blocks[index];
        if (!block || block.type !== 'table') return;
        const grid = blockEl.querySelector('.editor-table-grid');
        if (!grid) return;
        const headerRow = grid.querySelector('.header-row');
        if (!headerRow) return;
        const headers = Array.from(headerRow.querySelectorAll('input')).map(inp => inp.value);
        const rows = Array.from(grid.querySelectorAll('.editor-table-row:not(.header-row)'))
          .map(row => Array.from(row.querySelectorAll('input')).map(inp => inp.value));
        block.data.headers = headers;
        block.data.rows = rows;
      });
    }

    /**
     * Get structured block data (for advanced use).
     * @returns {Promise<object>}
     */
    save() {
      return Promise.resolve({
        blocks: this._blocks.map(b => ({ type: b.type, data: b.data })),
        version: '1.0'
      });
    }

    /**
     * Toggle preview mode.
     */
    togglePreview() {
      this._isPreviewMode = !this._isPreviewMode;
      if (this._isPreviewMode) {
        this._previewPane.innerHTML = this._blocks.map(b => this._renderBlockPreview(b)).join('');
        this._holder.style.display = 'none';
        this._hints.style.display = 'none';
        this._previewPane.classList.remove('hidden');
        // Highlight code in preview
        whenHljsReady(() => {
          this._previewPane.querySelectorAll('pre code[class*="language-"]').forEach(el => {
            window.hljs.highlightElement(el);
          });
        });
      } else {
        this._holder.style.display = '';
        this._hints.style.display = '';
        this._previewPane.classList.add('hidden');
        this._previewPane.innerHTML = '';
      }
    }

    /**
     * Destroy the editor and clean up event listeners / DOM nodes.
     */
    destroy() {
      this._abortController.abort();
      this._container.innerHTML = '';
      this._container.classList.remove('we-root');
      this._blocks = [];
      if (this._slashMenu && this._slashMenu.parentNode) {
        this._slashMenu.parentNode.removeChild(this._slashMenu);
      }
      if (this._blockAddMenu && this._blockAddMenu.parentNode) {
        this._blockAddMenu.parentNode.removeChild(this._blockAddMenu);
      }
      if (this._urlAutocomplete && this._urlAutocomplete.dropdown && this._urlAutocomplete.dropdown.parentNode) {
        this._urlAutocomplete.dropdown.parentNode.removeChild(this._urlAutocomplete.dropdown);
      }
      clearTimeout(this._docSuggestTimer);
    }

    /* ---------------------------------------------------------------
     *  Internal — Rendering
     * -------------------------------------------------------------*/

    _render() {
      this._holder.innerHTML = '';
      this._blocks = [];

      if (this._data.blocks && this._data.blocks.length > 0) {
        this._data.blocks.forEach((blockData, index) => {
          this._createBlockElement(blockData, index);
        });
      }

      if (this._blocks.length === 0) {
        this._createBlockElement({ type: 'paragraph', data: { text: '' } }, 0);
      }

      this._highlightAllCode();
      this._renderAllMermaid();
      this._renderAllSwagger();
    }

    _createBlockElement(blockData, index) {
      const blockEl = document.createElement('div');
      blockEl.className = 'editor-block';
      blockEl.dataset.type = blockData.type;
      blockEl.dataset.index = index;

      this._renderBlockContent(blockEl, blockData.type, blockData.data);
      this._holder.appendChild(blockEl);
      this._blocks.push({
        index,
        type: blockData.type,
        data: blockData.data,
        element: blockEl,
        contentElement: blockEl.querySelector('[contenteditable], textarea, code, input, span')
      });
    }

    _renderBlockContent(blockEl, type, data) {
      const blockDef = window.MarkdownEditor && window.MarkdownEditor.getBlock && window.MarkdownEditor.getBlock(type);
      const content = blockDef && blockDef.render
        ? blockDef.render(data, this)
        : `<p class="editor-paragraph" contenteditable="true">${this._escapeHtml(data?.text || '')}</p>`;

      const editable = blockDef && blockDef.editable;
      const editBtn = editable ? `<button class="block-edit-btn" title="Edit block" data-role="${type}-edit">\u270E</button>` : '';
      const controls = `
        <div class="block-controls">
          <button class="block-drag-handle" title="Drag to reorder" draggable="false">\u2807</button>
          <button class="block-add-btn" title="Add block below">+</button>
          ${editBtn}
          <button class="block-delete-btn" title="Delete block">\u2715</button>
        </div>
      `;

      blockEl.innerHTML = controls + content;
    }

    _renderBlockPreview(block) {
      const blockDef = window.MarkdownEditor && window.MarkdownEditor.getBlock && window.MarkdownEditor.getBlock(block.type);
      if (blockDef && blockDef.renderPreview) return blockDef.renderPreview(block.data, this);
      return `<p>${block.data.text || ''}</p>`;
    }

    /* ---------------------------------------------------------------
     *  Internal — Event Listeners
     * -------------------------------------------------------------*/

    _attachEventListeners() {
      const opts = { signal: this._abortController.signal };

      this._holder.addEventListener('click', (e) => this._handleBlockClick(e), opts);
      this._holder.addEventListener('keydown', (e) => this._handleKeyDown(e), opts);
      this._holder.addEventListener('input', (e) => this._handleInput(e), opts);
      this._holder.addEventListener('change', (e) => this._handleChange(e), opts);

      // Drag and drop
      this._holder.addEventListener('dragstart', (e) => this._handleDragStart(e), opts);
      this._holder.addEventListener('dragover', (e) => this._handleDragOver(e), opts);
      this._holder.addEventListener('dragleave', (e) => this._handleDragLeave(e), opts);
      this._holder.addEventListener('drop', (e) => this._handleDrop(e), opts);
      this._holder.addEventListener('dragend', (e) => this._handleDragEnd(e), opts);

      this._holder.addEventListener('mousedown', (e) => this._handleControlsMouseDown(e), opts);
      this._holder.addEventListener('click', (e) => this._handleBlockAddClick(e), opts);

      // Arm/disarm an image block's inline-paste drop zone as it gains/loses
      // focus, so a pasted image lands inline (base64) rather than as a folder
      // upload. Drop is handled separately in _handleDrop.
      this._holder.addEventListener('focusin', (e) => this._handleImageDropzoneFocus(e), opts);
      this._holder.addEventListener('focusout', (e) => this._handleImageDropzoneBlur(e), opts);

      // Close menus on outside click
      document.addEventListener('click', (e) => {
        if (!this._blockAddMenu.contains(e.target) && !e.target.closest('.block-add-btn')) {
          this._closeBlockAddMenu();
        }
        if (this._slashMenuOpen && !this._slashMenu.contains(e.target) && !e.target.closest('[contenteditable]')) {
          this._closeSlashMenu();
        }
      }, opts);
    }

    /* ---------------------------------------------------------------
     *  URL autocomplete
     * -------------------------------------------------------------*/

    _normalizeUrlSuggestions(input) {
      if (!Array.isArray(input)) return [];
      const out = [];
      for (const item of input) {
        if (typeof item === 'string' && item) {
          out.push({ url: item, label: item, description: '' });
        } else if (item && typeof item === 'object' && item.url) {
          out.push({
            url: String(item.url),
            label: String(item.label || item.title || item.url),
            description: String(item.description || item.subtitle || '')
          });
        }
      }
      return out;
    }

    _isUrlInput(el) {
      if (!el || el.tagName !== 'INPUT') return false;
      const role = el.dataset && el.dataset.role;
      return role === 'link-url'
        || role === 'image-src'
        || role === 'swagger-url'
        || role === 'hero-banner-image'
        || role === 'site-header-icon'
        || role === 'site-footer-icon';
    }

    // Inputs whose suggestions come from the dynamic document provider
    // rather than the static URL list. The ROLE is handed to the provider so a
    // host can widen (or narrow) what it offers per field — the
    // linked-documents block accepts folders as well as documents, the pane
    // block only documents, and recent-changes only folders.
    _isDocSuggestInput(el) {
      if (!el || el.tagName !== 'INPUT') return false;
      const role = el.dataset && el.dataset.role;
      return role === 'pane-source'
        || role === 'linked-docs-source'
        || role === 'recent-folder';
    }

    _isAutocompleteInput(el) {
      return this._isUrlInput(el) || this._isDocSuggestInput(el);
    }

    _initUrlAutocomplete() {
      const dd = document.createElement('div');
      dd.className = 'we-url-autocomplete';
      dd.style.display = 'none';
      document.body.appendChild(dd);
      this._urlAutocomplete.dropdown = dd;

      const opts = { signal: this._abortController.signal };

      this._holder.addEventListener('focusin', (e) => {
        if (this._isAutocompleteInput(e.target)) this._showUrlAutocomplete(e.target);
      }, opts);

      this._holder.addEventListener('focusout', (e) => {
        if (this._isAutocompleteInput(e.target)) {
          // Defer so that mousedown on a suggestion can trigger selection first
          setTimeout(() => {
            if (this._urlAutocomplete.activeInput === e.target) this._hideUrlAutocomplete();
          }, 150);
        }
      }, opts);

      this._holder.addEventListener('input', (e) => {
        if (this._isAutocompleteInput(e.target) && this._urlAutocomplete.activeInput === e.target) {
          this._refreshUrlAutocompleteItems();
        }
      }, opts);

      this._holder.addEventListener('keydown', (e) => {
        if (!this._urlAutocomplete.visible) return;
        if (this._urlAutocomplete.activeInput !== e.target) return;
        const a = this._urlAutocomplete;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          a.selectedIndex = Math.min(a.selectedIndex + 1, a.items.length - 1);
          this._renderUrlAutocompleteList();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          a.selectedIndex = Math.max(a.selectedIndex - 1, 0);
          this._renderUrlAutocompleteList();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (a.items.length > 0) {
            e.preventDefault();
            this._selectUrlAutocompleteItem(a.selectedIndex);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this._hideUrlAutocomplete();
        }
      }, opts);

      // Use mousedown so the input doesn't blur before the click registers
      dd.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.we-url-autocomplete-item');
        if (!item) return;
        e.preventDefault();
        const idx = parseInt(item.dataset.index, 10);
        if (!isNaN(idx)) this._selectUrlAutocompleteItem(idx);
      });

      // Close when scrolling/resizing — position would otherwise drift
      window.addEventListener('scroll', () => this._hideUrlAutocomplete(), { passive: true, signal: this._abortController.signal });
      window.addEventListener('resize', () => this._hideUrlAutocomplete(), opts);
    }

    async _showUrlAutocomplete(input) {
      this._urlAutocomplete.activeInput = input;
      this._urlAutocomplete.selectedIndex = 0;

      // Lazy-load suggestions the first time a URL field is focused
      if (!this._isDocSuggestInput(input) && !this._urlSuggestionsLoaded && this._getUrlSuggestionsFn) {
        this._urlSuggestionsLoaded = true; // mark first to avoid duplicate concurrent loads
        try {
          const fetched = await this._getUrlSuggestionsFn();
          const merged = (this._urlSuggestions || []).concat(this._normalizeUrlSuggestions(fetched));
          // Dedupe on url
          const seen = new Set();
          this._urlSuggestions = merged.filter(s => {
            if (seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
          });
        } catch (err) {
          console.warn('[MarkdownEditor] getUrls failed:', err);
        }
      }

      this._refreshUrlAutocompleteItems();
    }

    _refreshUrlAutocompleteItems() {
      const input = this._urlAutocomplete.activeInput;
      if (!input) return;
      if (this._isDocSuggestInput(input)) { this._refreshDocSuggestItems(input); return; }
      const all = this._urlSuggestions || [];
      const query = (input.value || '').toLowerCase().trim();

      let items;
      if (!query) {
        items = all.slice(0, 50);
      } else {
        items = all.filter(s =>
          s.url.toLowerCase().includes(query) ||
          (s.label || '').toLowerCase().includes(query) ||
          (s.description || '').toLowerCase().includes(query)
        );
        // Hide entirely if the only match is the exact value already typed — nothing useful left to suggest
        if (items.length === 1 && items[0].url.toLowerCase() === query) items = [];
      }

      this._urlAutocomplete.items = items;
      this._urlAutocomplete.selectedIndex = Math.min(this._urlAutocomplete.selectedIndex, Math.max(0, items.length - 1));
      this._renderUrlAutocompleteList();
    }

    // Debounced re-query of the dynamic document provider. A token guards
    // against a slow earlier response landing after a newer one.
    _refreshDocSuggestItems(input) {
      if (!this._getDocSuggestionsFn) return;
      clearTimeout(this._docSuggestTimer);
      const query = (input.value || '').trim();
      this._docSuggestTimer = setTimeout(async () => {
        const token = ++this._docSuggestToken;
        let items = [];
        try {
          // The role is a second argument, not a new provider: a host written
          // before this existed simply ignores it and keeps working.
          const role = (input.dataset && input.dataset.role) || '';
          items = this._normalizeUrlSuggestions(await this._getDocSuggestionsFn(query, role));
        } catch (err) {
          console.warn('[MarkdownEditor] getDocumentSuggestions failed:', err);
        }
        if (token !== this._docSuggestToken || this._urlAutocomplete.activeInput !== input) return;
        this._urlAutocomplete.items = items;
        this._urlAutocomplete.selectedIndex = 0;
        this._renderUrlAutocompleteList();
      }, query ? 200 : 0);
    }

    _renderUrlAutocompleteList() {
      const a = this._urlAutocomplete;
      const dd = a.dropdown;
      if (!dd) return;

      if (!a.items || a.items.length === 0) {
        dd.style.display = 'none';
        a.visible = false;
        return;
      }

      dd.innerHTML = a.items.map((item, idx) => {
        const sel = idx === a.selectedIndex ? ' selected' : '';
        const desc = item.description
          ? `<div class="we-url-autocomplete-desc">${this._escapeHtml(item.description)}</div>`
          : '';
        const labelLine = item.label && item.label !== item.url
          ? `<div class="we-url-autocomplete-label">${this._escapeHtml(item.label)}</div>`
          : '';
        return `<div class="we-url-autocomplete-item${sel}" data-index="${idx}">
          ${labelLine}
          <div class="we-url-autocomplete-url">${this._escapeHtml(item.url)}</div>
          ${desc}
        </div>`;
      }).join('');

      const r = a.activeInput.getBoundingClientRect();
      dd.style.top = (r.bottom + window.scrollY + 4) + 'px';
      dd.style.left = (r.left + window.scrollX) + 'px';
      dd.style.minWidth = Math.max(r.width, 240) + 'px';
      dd.style.display = 'block';
      a.visible = true;

      const selEl = dd.querySelector('.we-url-autocomplete-item.selected');
      if (selEl) selEl.scrollIntoView({ block: 'nearest' });
    }

    _selectUrlAutocompleteItem(idx) {
      const a = this._urlAutocomplete;
      const item = a.items[idx];
      if (!item || !a.activeInput) return;
      a.activeInput.value = item.url;
      a.activeInput.dispatchEvent(new Event('input', { bubbles: true }));
      a.activeInput.dispatchEvent(new Event('change', { bubbles: true }));
      this._hideUrlAutocomplete();
      // Keep focus so the user can keep typing or tab to next field
      a.activeInput && a.activeInput.focus();
    }

    _hideUrlAutocomplete() {
      const a = this._urlAutocomplete;
      if (!a || !a.dropdown) return;
      a.dropdown.style.display = 'none';
      a.visible = false;
      a.activeInput = null;
      a.items = [];
      a.selectedIndex = 0;
    }

    _handleBlockClick(e) {
      const directRole = e.target.dataset && e.target.dataset.role;
      const ancestorEl = e.target.closest && e.target.closest('[data-role]');
      const ancestorRole = ancestorEl && ancestorEl.dataset.role;
      const blocks = (window.MarkdownEditor && window.MarkdownEditor._blocks) || [];

      // Try direct role match first
      if (directRole) {
        for (const blockDef of blocks) {
          if (blockDef.handlers && blockDef.handlers[directRole]) {
            blockDef.handlers[directRole](e, this);
            return;
          }
        }
      }
      // Fall back to nearest-ancestor role (handles clicks on children of role-bearing elements)
      if (ancestorRole && ancestorRole !== directRole) {
        for (const blockDef of blocks) {
          if (blockDef.handlers && blockDef.handlers[ancestorRole]) {
            blockDef.handlers[ancestorRole](e, this);
            return;
          }
        }
      }

      // No role matched — treat as block selection
      const blockEl = e.target.closest('.editor-block');
      if (blockEl) {
        const index = parseInt(blockEl.dataset.index);
        this._currentBlockIndex = index;
        this._selectBlock(blockEl);
      }
    }

    _selectBlock(blockEl) {
      this._holder.querySelectorAll('.editor-block').forEach(b => b.classList.remove('selected'));
      blockEl.classList.add('selected');
    }

    _handleKeyDown(e) {
      const blockEl = e.target.closest('.editor-block');
      if (!blockEl) return;

      const blockIndex = parseInt(blockEl.dataset.index);
      const blockType = blockEl.dataset.type;
      const target = e.target;

      // Code textarea: allow all default key behavior, only handle Tab for indentation
      if (target.dataset.role === 'code-textarea') {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = target.selectionStart;
          const end = target.selectionEnd;
          target.value = target.value.substring(0, start) + '  ' + target.value.substring(end);
          target.selectionStart = target.selectionEnd = start + 2;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }

      // Inline formatting shortcuts
      if ((e.ctrlKey || e.metaKey) && target.isContentEditable) {
        if (e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); target.dispatchEvent(new Event('input', { bubbles: true })); return; }
        if (e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); target.dispatchEvent(new Event('input', { bubbles: true })); return; }
        if (e.key === 'u') { e.preventDefault(); document.execCommand('underline', false, null); target.dispatchEvent(new Event('input', { bubbles: true })); return; }
      }

      // Slash command
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && target.isContentEditable) {
        if (target.textContent.trim() === '' || this._getCaretPosition(target) === 0) {
          e.preventDefault();
          this._showSlashMenu(e, blockIndex);
          return;
        }
      }

      // List item handling
      if (blockType === 'list' && target.classList.contains('editor-list-item')) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const itemIndex = parseInt(target.dataset.index);
          const newItem = document.createElement('li');
          newItem.className = 'editor-list-item';
          newItem.contentEditable = 'true';
          newItem.dataset.index = itemIndex + 1;
          newItem.textContent = '';
          const items = blockEl.querySelectorAll('.editor-list-item');
          items.forEach((item, i) => { if (i > itemIndex) item.dataset.index = parseInt(item.dataset.index) + 1; });
          target.parentNode.insertBefore(newItem, target.nextSibling);
          newItem.focus();
          return;
        }
        if (e.key === 'Backspace') {
          const isEmpty = !target.textContent.trim();
          const isAtStart = this._getCaretPosition(target) === 0;
          const items = blockEl.querySelectorAll('.editor-list-item');
          if (isEmpty && items.length > 1 && isAtStart) {
            e.preventDefault();
            target.remove();
            blockEl.querySelectorAll('.editor-list-item').forEach((item, i) => { item.dataset.index = i; });
            this._handleInput({ target: blockEl });
            return;
          }
        }
        return;
      }

      // Don't intercept keys on input/textarea/select inside block editors (link, image, table, code)
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

      // Enter — new block
      if (e.key === 'Enter' && !e.shiftKey) {
        if (blockType === 'code' || blockType === 'table') return;
        if (blockType === 'checklist' && target.classList.contains('editor-checkbox')) return;
        e.preventDefault();
        const newIndex = blockIndex + 1;
        this._insertBlock('paragraph', { text: '' }, newIndex);
        setTimeout(() => {
          const newBlock = this._blocks.find(b => b.index === newIndex);
          if (newBlock && newBlock.contentElement) newBlock.contentElement.focus();
        }, 0);
        return;
      }

      // Backspace
      if (e.key === 'Backspace') {
        const isEmpty = !target.textContent.trim();
        const isAtStart = this._getCaretPosition(target) === 0;
        if (isEmpty && this._blocks.length > 1) { e.preventDefault(); this._deleteBlock(blockIndex); return; }
        if (isAtStart && blockIndex > 0 && blockType === 'paragraph') { e.preventDefault(); this._mergeWithPrevious(blockIndex); return; }
      }

      // Tab
      if (e.key === 'Tab') {
        e.preventDefault();
        const direction = e.shiftKey ? -1 : 1;
        const nextIndex = blockIndex + direction;
        if (nextIndex >= 0 && nextIndex < this._blocks.length) {
          const nb = this._blocks[nextIndex];
          if (nb.contentElement) nb.contentElement.focus();
        }
        return;
      }

      // Delete empty
      if (e.key === 'Delete' && blockType === 'paragraph') {
        if (!target.textContent.trim() && this._blocks.length > 1) { e.preventDefault(); this._deleteBlock(blockIndex); return; }
      }
    }

    _handleInput(e) {
      const blockEl = e.target.closest('.editor-block');
      if (!blockEl) return;
      const blockIndex = parseInt(blockEl.dataset.index);
      const block = this._blocks[blockIndex];
      if (!block) return;

      const blockType = blockEl.dataset.type;
      const blockDef = window.MarkdownEditor && window.MarkdownEditor.getBlock && window.MarkdownEditor.getBlock(blockType);
      if (blockDef && blockDef.onInput) {
        blockDef.onInput(e, blockEl, block, this);
      }
      this._onChange();
    }

    _handleChange(e) {
      const blockEl = e.target.closest('.editor-block');
      if (!blockEl) return;
      const blockIndex = parseInt(blockEl.dataset.index);
      const block = this._blocks[blockIndex];
      if (!block) return;

      const blockType = blockEl.dataset.type;
      const blockDef = window.MarkdownEditor && window.MarkdownEditor.getBlock && window.MarkdownEditor.getBlock(blockType);
      if (blockDef && blockDef.onChange) {
        blockDef.onChange(e, blockEl, block, this);
        this._onChange();
      }
    }

    /* ---------------------------------------------------------------
     *  Internal — Block operations
     * -------------------------------------------------------------*/

    _insertBlock(type, data, index) {
      if (index === null || index === undefined) index = this._blocks.length;

      this._blocks.slice(index).forEach(block => {
        block.index++;
        block.element.dataset.index = block.index;
      });

      const newBlock = { index, type, data };
      const blockEl = document.createElement('div');
      blockEl.className = 'editor-block';
      blockEl.dataset.type = type;
      blockEl.dataset.index = index;
      this._renderBlockContent(blockEl, type, data);

      if (index < this._blocks.length) {
        this._blocks[index].element.parentNode.insertBefore(blockEl, this._blocks[index].element);
      } else {
        this._holder.appendChild(blockEl);
      }

      newBlock.element = blockEl;
      newBlock.contentElement = blockEl.querySelector('[contenteditable], textarea, code, input, span');
      this._blocks.splice(index, 0, newBlock);
      this._data.blocks.splice(index, 0, { type, data });
      this._onChange();
    }

    _deleteBlock(index) {
      if (this._blocks.length <= 1) return;
      const block = this._blocks[index];
      if (block && block.element) block.element.remove();
      this._blocks.splice(index, 1);
      this._data.blocks.splice(index, 1);
      this._blocks.slice(index).forEach((b, i) => { b.index = index + i; b.element.dataset.index = b.index; });
      const focusIndex = Math.min(index, this._blocks.length - 1);
      const focusBlock = this._blocks[focusIndex];
      if (focusBlock && focusBlock.contentElement) focusBlock.contentElement.focus();
      this._onChange();
    }

    _convertBlock(fromIndex, toType, preserveText) {
      const fromBlock = this._blocks[fromIndex];
      if (!fromBlock) return;

      let newData = this._getDefaultData(toType);
      if (preserveText && fromBlock.data.text) {
        if (toType === 'list') newData = { items: [fromBlock.data.text], style: 'unordered' };
        else if (toType === 'code') newData = { code: fromBlock.data.text, language: 'plain' };
        else if (toType === 'header') newData = { text: fromBlock.data.text, level: 2 };
        else if (toType === 'table') newData = { headers: ['Column 1', 'Column 2'], rows: [[fromBlock.data.text, '']] };
        else if (toType === 'hero-banner') newData = { title: fromBlock.data.text, subtitle: '', image: '', imageAlign: 'right' };
        else if (toType === 'cards') newData = { across: 3, cards: [{ heading: fromBlock.data.text, description: '' }] };
        else if (toType === 'site-header') newData = { icon: '', title: fromBlock.data.text, links: '' };
        else if (toType === 'site-footer') newData = { icon: '', title: fromBlock.data.text, subtitle: '', links: '' };
        else if (toType === 'columns') newData = { layout: 'container', left: fromBlock.data.text || '', middle: '', right: '' };
        // Only carry the text across when the target block actually has a
        // `text` field. Everything else has its own data shape — {code} for
        // mermaid, {props, items} for the landing blocks, {tabs} for tabs —
        // and replacing it wholesale with {text} renders the block empty and
        // saves a shape its toMarkdown() can't read. Keep the block's own
        // defaults instead; the typed text is dropped, which is what already
        // happened visually.
        else if ('text' in newData) newData = { text: fromBlock.data.text };
      }

      fromBlock.element.remove();
      fromBlock.type = toType;
      fromBlock.data = newData;

      const blockEl = document.createElement('div');
      blockEl.className = 'editor-block';
      blockEl.dataset.type = toType;
      blockEl.dataset.index = fromIndex;
      this._renderBlockContent(blockEl, toType, newData);

      if (fromIndex < this._blocks.length - 1) {
        this._blocks[fromIndex + 1].element.parentNode.insertBefore(blockEl, this._blocks[fromIndex + 1].element);
      } else {
        this._holder.appendChild(blockEl);
      }

      fromBlock.element = blockEl;
      fromBlock.contentElement = blockEl.querySelector('[contenteditable], textarea, code, input, span');
      this._data.blocks[fromIndex] = { type: toType, data: newData };
      this._onChange();
    }

    _mergeWithPrevious(index) {
      if (index === 0) return;
      const currentBlock = this._blocks[index];
      const previousBlock = this._blocks[index - 1];
      if (previousBlock.type === 'paragraph' && currentBlock.type === 'paragraph') {
        previousBlock.data.text = (previousBlock.data.text || '') + currentBlock.data.text;
        previousBlock.contentElement.textContent = previousBlock.data.text;
        this._deleteBlock(index);
        if (previousBlock.contentElement) previousBlock.contentElement.focus();
      }
    }

    _getDefaultData(type) {
      switch (type) {
        case 'header': return { text: '', level: 2 };
        case 'list': return { items: [''], style: 'unordered' };
        case 'code': return { code: '', language: 'plain' };
        case 'checklist': return { items: [{ text: '', checked: false }] };
        case 'quote': return { text: '' };
        case 'image': return { src: '', alt: '' };
        case 'link': return { url: '', text: '' };
        case 'summary': return { text: '' };
        case 'mermaid': return { code: '' };
        case 'swagger': return { url: '', title: '' };
        case 'hero-banner': return { title: '', subtitle: '', image: '', imageAlign: 'right' };
        case 'cards': return { across: 3, cards: [{ heading: '', description: '' }] };
        case 'tabs': return { tabs: [{ name: 'Tab 1', content: '' }, { name: 'Tab 2', content: '' }], activeTab: 0, editingIndex: 0 };
        case 'accordion': return { items: [{ title: 'Item 1', content: '' }, { title: 'Item 2', content: '' }], expandedItems: [0], editingIndex: 0 };
        case 'site-header': return { icon: '', title: '', links: '' };
        case 'site-footer': return { icon: '', title: '', subtitle: '', links: '' };
        case 'columns': return { layout: 'container', left: '', middle: '', right: '' };
        case 'table': return { headers: ['Column 1', 'Column 2'], rows: [['', '']] };
        case 'paragraph': return { text: '' };
        default: {
          // Fall back to the registered block's own factory so custom blocks
          // (e.g. document) insert with their correct default data shape.
          const def = window.MarkdownEditor && window.MarkdownEditor.getBlock && window.MarkdownEditor.getBlock(type);
          if (def && typeof def.defaultData === 'function') return def.defaultData();
          return { text: '' };
        }
      }
    }

    /* ---------------------------------------------------------------
     *  Internal — Drag & Drop
     * -------------------------------------------------------------*/

    _handleControlsMouseDown(e) {
      if (e.target.classList.contains('block-drag-handle')) {
        const blockEl = e.target.closest('.editor-block');
        if (blockEl) { blockEl.draggable = true; blockEl.style.cursor = 'grabbing'; }
      }
    }

    _handleDragStart(e) {
      const blockEl = e.target.closest('.editor-block');
      if (blockEl && blockEl.draggable) {
        this._dragSourceIndex = parseInt(blockEl.dataset.index);
        blockEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', blockEl.innerHTML);
      }
    }

    _handleDragOver(e) {
      // External OS file dragged over an image block -> show it as an inline
      // (base64) drop target. Internal block reordering uses _dragSourceIndex.
      if (this._dragSourceIndex === null) {
        const zone = this._imageDropTargetFromEvent(e);
        if (zone) {
          e.preventDefault();
          // Keep the page's folder-upload drag overlay from appearing over an
          // inline image drop target.
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          if (this._dragHoverImageZone && this._dragHoverImageZone !== zone) {
            this._dragHoverImageZone.classList.remove('drag-target');
          }
          zone.classList.add('drag-target');
          this._dragHoverImageZone = zone;
        } else if (this._dragHoverImageZone) {
          this._dragHoverImageZone.classList.remove('drag-target');
          this._dragHoverImageZone = null;
        }
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const blockEl = e.target.closest('.editor-block');
      if (blockEl && blockEl !== this._blocks[this._dragSourceIndex].element) {
        const rect = blockEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        this._blocks.forEach(b => b.element.classList.remove('drag-over-above', 'drag-over-below'));
        if (e.clientY < midpoint) blockEl.classList.add('drag-over-above');
        else blockEl.classList.add('drag-over-below');
      }
    }

    _handleDragLeave(e) {
      const blockEl = e.target.closest('.editor-block');
      if (blockEl) blockEl.classList.remove('drag-over-above', 'drag-over-below');
      const zone = e.target.closest && e.target.closest('.editor-image-dropzone');
      if (zone && this._dragHoverImageZone === zone) {
        // Only clear when actually leaving the zone (not when moving onto a child).
        if (!zone.contains(e.relatedTarget)) {
          zone.classList.remove('drag-target');
          this._dragHoverImageZone = null;
        }
      }
    }

    _handleDrop(e) {
      // External OS image file dropped onto an image block -> embed it inline
      // as a base64 data URI. stopPropagation keeps the page's folder-upload
      // drag-drop manager from also grabbing the file.
      if (this._dragSourceIndex === null) {
        const zone = this._imageDropTargetFromEvent(e);
        if (zone) {
          e.preventDefault();
          e.stopPropagation();
          if (this._dragHoverImageZone) {
            this._dragHoverImageZone.classList.remove('drag-target');
            this._dragHoverImageZone = null;
          }
          zone.classList.remove('drag-target');
          const blockEl = zone.closest('.editor-block');
          const file = this._firstImageFile(e.dataTransfer);
          if (file) this._applyImageFileToBlock(blockEl, file);
          else this._flashImageDropzoneMessage(blockEl, 'That file is not an image.', true);
        }
        return;
      }
      e.preventDefault();
      const blockEl = e.target.closest('.editor-block');
      if (blockEl) {
        const targetIndex = parseInt(blockEl.dataset.index);
        const rect = blockEl.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        let newIndex = targetIndex;
        if (e.clientY >= midpoint && targetIndex < this._blocks.length - 1) newIndex = targetIndex + 1;
        if (newIndex !== this._dragSourceIndex) this._moveBlock(this._dragSourceIndex, newIndex);
      }
      this._dragSourceIndex = null;
    }

    _handleDragEnd() {
      this._blocks.forEach(block => {
        block.element.draggable = false;
        block.element.classList.remove('dragging', 'drag-over-above', 'drag-over-below');
        block.element.style.cursor = 'auto';
      });
      this._dragSourceIndex = null;
    }

    _moveBlock(fromIndex, toIndex) {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= this._blocks.length || toIndex > this._blocks.length) return;
      const [movedBlock] = this._blocks.splice(fromIndex, 1);
      this._blocks.splice(toIndex, 0, movedBlock);
      const [movedData] = this._data.blocks.splice(fromIndex, 1);
      this._data.blocks.splice(toIndex, 0, movedData);
      const blockElements = this._blocks.map(b => b.element);
      this._holder.innerHTML = '';
      blockElements.forEach((el, i) => {
        el.dataset.index = i;
        const block = this._blocks.find(b => b.element === el);
        if (block) block.index = i;
        this._holder.appendChild(el);
      });
      this._onChange();
    }

    /* ---------------------------------------------------------------
     *  Internal — Block Add Menu
     * -------------------------------------------------------------*/

    _showBlockAddMenu(button, blockIndex) {
      const rect = button.getBoundingClientRect();
      // Reset panels first so we can measure correct height
      this._blockAddMenu.querySelectorAll('.block-add-panel').forEach(p => p.classList.add('hidden'));
      this._blockAddMenu.querySelector('.block-add-panel[data-panel="main"]').classList.remove('hidden');
      this._blockAddMenu.classList.remove('hidden');
      this._blockAddMenu.dataset.blockIndex = blockIndex;

      // Measure the menu and decide direction
      const menuRect = this._blockAddMenu.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 10;
      const spaceAbove = rect.top - 10;

      let top;
      if (spaceBelow >= menuRect.height || spaceBelow >= spaceAbove) {
        // Place below
        top = rect.bottom + 5;
      } else {
        // Place above
        top = rect.top - menuRect.height - 5;
      }

      let left = rect.left;
      if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 10;

      this._blockAddMenu.style.top = Math.max(5, top) + 'px';
      this._blockAddMenu.style.left = Math.max(5, left) + 'px';
    }

    _closeBlockAddMenu() {
      this._blockAddMenu.classList.add('hidden');
    }

    _switchBlockAddPanel(panelName) {
      this._blockAddMenu.querySelectorAll('.block-add-panel').forEach(p => p.classList.add('hidden'));
      const panel = this._blockAddMenu.querySelector(`.block-add-panel[data-panel="${panelName}"]`);
      if (panel) panel.classList.remove('hidden');
    }

    _handleBlockAddClick(e) {
      if (e.target.classList.contains('block-add-btn')) {
        e.preventDefault();
        e.stopPropagation();
        const blockEl = e.target.closest('.editor-block');
        if (blockEl) {
          const blockIndex = parseInt(blockEl.dataset.index);
          this._showBlockAddMenu(e.target, blockIndex);

          this._blockAddMenu.querySelectorAll('.block-add-menu-item').forEach(item => {
            item.onclick = (evt) => {
              evt.stopPropagation();
              const action = item.dataset.action;
              if (action === 'back') { this._switchBlockAddPanel('main'); return; }
              // `open-<panel>` opens the panel of that name, so a new submenu
              // is a markup change only.
              if (action && action.startsWith('open-')) {
                this._switchBlockAddPanel(action.slice('open-'.length));
                return;
              }
              if (item.dataset.format) { this._applyInlineFormat(item.dataset.format); this._closeBlockAddMenu(); return; }

              let type = item.dataset.type;
              if (!type) return;
              let data;
              const headerMatch = type.match(/^header-(\d)$/);
              if (headerMatch) { type = 'header'; data = { text: '', level: parseInt(headerMatch[1]) }; }
              else if (type === 'list-ordered') { type = 'list'; data = { items: [''], style: 'ordered' }; }
              else if (type === 'list-unordered') { type = 'list'; data = { items: [''], style: 'unordered' }; }
              else { data = this._getDefaultData(type); }

              const newIndex = blockIndex + 1;
              this._insertBlock(type, data, newIndex);
              this._closeBlockAddMenu();
              setTimeout(() => {
                const newBlock = this._blocks.find(b => b.index === newIndex);
                if (newBlock && newBlock.contentElement) newBlock.contentElement.focus();
              }, 0);
            };
          });
        }
      }

      if (e.target.classList.contains('block-delete-btn')) {
        e.preventDefault();
        e.stopPropagation();
        const blockEl = e.target.closest('.editor-block');
        if (blockEl) this._deleteBlock(parseInt(blockEl.dataset.index));
      }
    }

    /* ---------------------------------------------------------------
     *  Internal — Slash Commands
     * -------------------------------------------------------------*/

    _initSlashCommands() {
      const opts = { signal: this._abortController.signal };
      const slashMenu = this._slashMenu;

      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (!this._slashMenuOpen) return;

        const items = this._getSlashActiveItems();
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this._slashMenuSelectedIndex = (this._slashMenuSelectedIndex + 1) % items.length;
          this._updateSlashMenuSelection(items);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this._slashMenuSelectedIndex = (this._slashMenuSelectedIndex - 1 + items.length) % items.length;
          this._updateSlashMenuSelection(items);
        } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
          e.preventDefault();
          const selected = items[this._slashMenuSelectedIndex];
          if (selected) this._activateSlashItem(selected);
        } else if (e.key === 'ArrowLeft' || (e.key === 'Escape' && this._slashCurrentPanel !== 'main')) {
          e.preventDefault();
          this._switchSlashPanel('main');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this._closeSlashMenu();
        }
      }, opts);

      // Click handling
      slashMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.slash-command-item');
        if (item) this._activateSlashItem(item);
      }, opts);

      // Mouse hover
      slashMenu.addEventListener('mouseenter', (e) => {
        const panel = slashMenu.querySelector(`.slash-command-list[data-panel="${this._slashCurrentPanel}"]`);
        if (!panel) return;
        const item = e.target.closest('.slash-command-item');
        if (item && panel.contains(item)) {
          const items = this._getSlashActiveItems();
          this._slashMenuSelectedIndex = Array.from(items).indexOf(item);
          this._updateSlashMenuSelection(items);
        }
      }, { capture: true, ...opts });
    }

    /**
     * Act on a slash-menu item, whichever way it was chosen (click, or Enter /
     * ArrowRight on the keyboard selection). `data-action="open-<panel>"` opens
     * the panel of that name, so adding a submenu is a markup change only.
     * @param {HTMLElement} item - the `.slash-command-item` that was activated
     */
    _activateSlashItem(item) {
      const action = item.dataset.action;
      if (action === 'back') { this._switchSlashPanel('main'); return; }
      if (action && action.startsWith('open-')) {
        this._switchSlashPanel(action.slice('open-'.length));
        return;
      }
      if (item.dataset.format) {
        this._applyInlineFormat(item.dataset.format);
        this._closeSlashMenu();
        return;
      }
      if (item.dataset.type) this._selectSlashCommand(item.dataset.type);
    }

    _getSlashActiveItems() {
      const panel = this._slashMenu.querySelector(`.slash-command-list[data-panel="${this._slashCurrentPanel}"]`);
      return panel ? panel.querySelectorAll(':scope > .slash-command-item') : [];
    }

    _switchSlashPanel(panelName) {
      this._slashMenu.querySelectorAll('.slash-command-list').forEach(p => p.classList.add('hidden'));
      const panel = this._slashMenu.querySelector(`.slash-command-list[data-panel="${panelName}"]`);
      if (panel) panel.classList.remove('hidden');
      this._slashCurrentPanel = panelName;
      this._slashMenuSelectedIndex = 0;
      this._updateSlashMenuSelection(this._getSlashActiveItems());
    }

    _updateSlashMenuSelection(items) {
      items.forEach((item, index) => {
        if (index === this._slashMenuSelectedIndex) item.classList.add('active');
        else item.classList.remove('active');
      });
    }

    _showSlashMenu(e, blockIndex) {
      this._saveSelection();
      this._slashMenuOpen = true;
      this._slashMenuSelectedIndex = 0;
      this._slashCurrentPanel = 'main';

      this._slashMenu.querySelectorAll('.slash-command-list').forEach(p => p.classList.add('hidden'));
      this._slashMenu.querySelector('.slash-command-list[data-panel="main"]').classList.remove('hidden');
      this._slashMenu.classList.remove('hidden');

      const blockEl = this._holder.querySelector(`.editor-block[data-index="${blockIndex}"]`);
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        const menuRect = this._slashMenu.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 10;
        const spaceAbove = rect.top - 10;

        let top;
        if (spaceBelow >= menuRect.height || spaceBelow >= spaceAbove) {
          top = rect.bottom + 5;
        } else {
          top = rect.top - menuRect.height - 5;
        }

        let left = rect.left;
        if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 10;

        this._slashMenu.style.top = Math.max(5, top) + 'px';
        this._slashMenu.style.left = Math.max(5, left) + 'px';
      }
      this._updateSlashMenuSelection(this._slashMenu.querySelectorAll('.slash-command-list[data-panel="main"] > .slash-command-item'));
    }

    _closeSlashMenu() {
      this._slashMenu.classList.add('hidden');
      this._slashMenuOpen = false;
    }

    _selectSlashCommand(blockType) {
      let headerLevel = null;
      const headerMatch = blockType.match(/^header-(\d)$/);
      if (headerMatch) { headerLevel = parseInt(headerMatch[1]); blockType = 'header'; }

      let listStyle = null;
      if (blockType === 'list-ordered') { listStyle = 'ordered'; blockType = 'list'; }
      else if (blockType === 'list-unordered') { listStyle = 'unordered'; blockType = 'list'; }

      const selectedBlock = this._holder.querySelector('.editor-block.selected');
      let blockIndex = -1;
      if (selectedBlock) blockIndex = parseInt(selectedBlock.dataset.index);
      else {
        const contentEditables = this._holder.querySelectorAll('[contenteditable]');
        for (let el of contentEditables) {
          const be = el.closest('.editor-block');
          if (be) { blockIndex = parseInt(be.dataset.index); break; }
        }
      }

      this._closeSlashMenu();
      if (blockIndex < 0 || !this._blocks[blockIndex]) return;

      const currentBlock = this._blocks[blockIndex];
      const blockEl = currentBlock.element;
      const contentEl = blockEl.querySelector('[contenteditable], code, input, span');
      const text = contentEl ? contentEl.textContent : '';
      const cleanText = text.trim();

      if (blockType === currentBlock.type && !headerLevel && !listStyle) {
        currentBlock.data.text = cleanText;
        if (contentEl) contentEl.textContent = cleanText;
      } else {
        this._convertBlock(blockIndex, blockType, cleanText !== '');
        const convertedBlock = this._blocks[blockIndex];
        if (blockType === 'header' && headerLevel) {
          convertedBlock.data.level = headerLevel;
          convertedBlock.data.text = cleanText;
          this._renderBlockContent(convertedBlock.element, 'header', convertedBlock.data);
        } else if (blockType === 'list') {
          convertedBlock.data.items = cleanText ? [cleanText] : [];
          if (listStyle) {
            convertedBlock.data.style = listStyle;
            this._renderBlockContent(convertedBlock.element, 'list', convertedBlock.data);
          }
        } else if (blockType === 'code') {
          convertedBlock.data.code = cleanText;
          if (!convertedBlock.data.language) convertedBlock.data.language = 'plain';
          this._renderBlockContent(convertedBlock.element, 'code', convertedBlock.data);
        } else if (blockType === 'checklist') {
          convertedBlock.data.items = cleanText ? [{ text: cleanText, checked: false }] : [];
        } else if (blockType === 'table') {
          convertedBlock.data = { headers: ['Column 1', 'Column 2'], rows: [[cleanText || '', '']] };
          this._renderBlockContent(convertedBlock.element, 'table', convertedBlock.data);
        } else if (blockType === 'link') {
          convertedBlock.data = { url: cleanText || '', text: '' };
          this._renderBlockContent(convertedBlock.element, 'link', convertedBlock.data);
        } else if (blockType === 'summary') {
          convertedBlock.data = { text: cleanText || '' };
          this._renderBlockContent(convertedBlock.element, 'summary', convertedBlock.data);
        } else if (blockType === 'mermaid') {
          convertedBlock.data = { code: cleanText || '' };
          this._renderBlockContent(convertedBlock.element, 'mermaid', convertedBlock.data);
        } else if (blockType === 'swagger') {
          convertedBlock.data = { url: cleanText || '', title: '' };
          this._renderBlockContent(convertedBlock.element, 'swagger', convertedBlock.data);
        } else if (blockType === 'columns') {
          convertedBlock.data = { layout: 'container', left: cleanText || '', middle: '', right: '' };
          this._renderBlockContent(convertedBlock.element, 'columns', convertedBlock.data);
        } else {
          convertedBlock.data.text = cleanText;
        }

        setTimeout(() => {
          const newContentEl = convertedBlock.element.querySelector('[contenteditable], textarea, code, input, span');
          if (newContentEl) newContentEl.focus();
        }, 0);
      }
    }

    /* ---------------------------------------------------------------
     *  Internal — Inline formatting & selection
     * -------------------------------------------------------------*/

    _saveSelection() {
      const sel = window.getSelection();
      if (sel.rangeCount > 0) this._savedSelection = sel.getRangeAt(0).cloneRange();
    }

    _restoreSelection() {
      if (this._savedSelection) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(this._savedSelection);
        this._savedSelection = null;
      }
    }

    _applyInlineFormat(format) {
      this._restoreSelection();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      const target = el?.closest('[contenteditable="true"]');
      if (!target) return;
      target.focus();
      sel.removeAllRanges();
      sel.addRange(range);
      switch (format) {
        case 'bold': document.execCommand('bold', false, null); break;
        case 'italic': document.execCommand('italic', false, null); break;
        case 'underline': document.execCommand('underline', false, null); break;
        default:
          // Badges arrive as 'badge-primary', 'badge-success', etc.
          if (format.startsWith('badge-')) {
            const variant = format.slice('badge-'.length);
            const selectedText = sel.toString().trim() || 'label';
            const snippet = `[badge:${variant} ${selectedText}]`;
            document.execCommand('insertText', false, snippet);
          }
          break;
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /* ---------------------------------------------------------------
     *  Internal — Placeholders
     * -------------------------------------------------------------*/

    _setupPlaceholders() {
      const opts = { capture: true, signal: this._abortController.signal };

      this._holder.addEventListener('focus', (e) => {
        const el = e.target;
        if (el.contentEditable === 'true' && !el.textContent.trim()) el.classList.add('empty');
      }, opts);

      this._holder.addEventListener('blur', (e) => {
        const el = e.target;
        if (el.contentEditable === 'true') {
          if (el.textContent.trim()) el.classList.remove('empty');
          else el.classList.add('empty');
        }
      }, opts);

      this._holder.addEventListener('input', (e) => {
        const el = e.target;
        if (el.contentEditable === 'true') {
          if (el.textContent.trim()) el.classList.remove('empty');
          else el.classList.add('empty');
        }
      }, opts);
    }

    /* ---------------------------------------------------------------
     *  Internal — Utilities
     * -------------------------------------------------------------*/

    _getCaretPosition(element) {
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return 0;
      const range = selection.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(element);
      preRange.setEnd(range.endContainer, range.endOffset);
      return preRange.toString().length;
    }

    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    _highlightCode(blockEl) {
      if (!blockEl) return;
      const codeEl = blockEl.querySelector('.editor-code-body code');
      if (!codeEl) return;
      whenHljsReady(() => {
        // hljs modifies the element in place; remove previous highlight data
        codeEl.removeAttribute('data-highlighted');
        codeEl.classList.forEach(c => { if (c.startsWith('hljs')) codeEl.classList.remove(c); });
        window.hljs.highlightElement(codeEl);
      });
    }

    _highlightAllCode() {
      this._holder.querySelectorAll('.editor-block[data-type="code"]').forEach(el => this._highlightCode(el));
    }

    _renderMermaidPreview(blockEl, code) {
      if (!blockEl) return;
      const previewEl = blockEl.querySelector('.editor-mermaid-preview');
      const placeholderEl = blockEl.querySelector('.editor-mermaid-placeholder');
      if (!code) {
        if (previewEl) previewEl.style.display = 'none';
        if (placeholderEl) placeholderEl.style.display = '';
        return;
      }
      if (previewEl) previewEl.style.display = '';
      if (placeholderEl) placeholderEl.style.display = 'none';
      if (!previewEl) return;
      injectMermaidJS();
      whenMermaidReady(() => {
        const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
        try {
          window.mermaid.render(id, code).then(({ svg }) => {
            previewEl.innerHTML = svg;
          }).catch(() => {
            previewEl.innerHTML = '<div style="color:#d9534f;font-size:0.85em;padding:8px;">Invalid mermaid syntax</div>';
          });
        } catch (err) {
          previewEl.innerHTML = '<div style="color:#d9534f;font-size:0.85em;padding:8px;">Invalid mermaid syntax</div>';
        }
      });
    }

    _renderAllMermaid() {
      this._holder.querySelectorAll('.editor-block[data-type="mermaid"]').forEach(el => {
        const idx = parseInt(el.dataset.index);
        const block = this._blocks[idx];
        if (block && block.data.code) this._renderMermaidPreview(el, block.data.code);
      });
    }

    _renderSwaggerPreview(blockEl, url) {
      if (!blockEl) return;
      const wrapperEl = blockEl.querySelector('.editor-swagger-ui-wrapper');
      const placeholderEl = blockEl.querySelector('.editor-swagger-placeholder');
      if (!url) {
        if (wrapperEl) { wrapperEl.innerHTML = ''; wrapperEl.style.display = 'none'; }
        if (placeholderEl) placeholderEl.style.display = '';
        return;
      }
      if (placeholderEl) placeholderEl.style.display = 'none';
      if (!wrapperEl) return;
      wrapperEl.style.display = '';
      injectSwaggerUI();
      whenSwaggerReady(() => {
        try {
          window.SwaggerUIBundle({
            url: url,
            dom_id: '#' + wrapperEl.id,
            presets: [
              window.SwaggerUIBundle.presets.apis,
              window.SwaggerUIBundle.SwaggerUIStandalonePreset
            ],
            layout: 'BaseLayout'
          });
        } catch (err) {
          wrapperEl.innerHTML = '<div style="color:#d9534f;font-size:0.85em;padding:12px;">Failed to load Swagger UI</div>';
        }
      });
    }

    _renderAllSwagger() {
      this._holder.querySelectorAll('.editor-block[data-type="swagger"]').forEach(el => {
        const idx = parseInt(el.dataset.index);
        const block = this._blocks[idx];
        if (block && block.data.url) this._renderSwaggerPreview(el, block.data.url);
      });
    }

    _saveTableFromGrid(blockEl, block) {
      const grid = blockEl.querySelector('.editor-table-grid');
      if (!grid) return;

      // Read headers
      const headerInputs = grid.querySelector('.header-row').querySelectorAll('input');
      const headers = Array.from(headerInputs).map(inp => inp.value);

      // Read rows
      const dataRows = grid.querySelectorAll('.editor-table-row:not(.header-row)');
      const rows = Array.from(dataRows).map(row => {
        return Array.from(row.querySelectorAll('input')).map(inp => inp.value);
      });

      block.data.headers = headers;
      block.data.rows = rows;

      // Rebuild the collapsed display table
      const display = blockEl.querySelector('.editor-table-display');
      if (display) {
        const thHtml = headers.map(h => `<th>${this._escapeHtml(h)}</th>`).join('');
        const trHtml = rows.map(row => {
          const tds = headers.map((_, ci) => `<td>${this._escapeHtml(row[ci] || '')}</td>`).join('');
          return `<tr>${tds}</tr>`;
        }).join('');
        display.innerHTML = `<table><thead><tr>${thHtml}</tr></thead><tbody>${trHtml}</tbody></table>`;
      }

      // Collapse
      const container = blockEl.querySelector('.editor-table-container');
      if (container) {
        container.classList.remove('editing');
        container.classList.add('collapsed');
      }
      this._onChange();
    }

    _getLanguageOptions(selected) {
      const languages = [
        'plain', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp',
        'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r',
        'html', 'css', 'scss', 'sql', 'graphql',
        'bash', 'powershell', 'dockerfile',
        'json', 'yaml', 'xml', 'toml', 'ini',
        'markdown', 'latex',
        'lua', 'perl', 'haskell', 'elixir', 'clojure', 'dart', 'zig'
      ];
      return languages.map(lang =>
        `<option value="${lang}"${lang === selected ? ' selected' : ''}>${lang}</option>`
      ).join('');
    }

    _markdownToHtml(text) {
      if (!text) return '';

      // Extract and process tables first (before other escaping)
      let tables = [];
      let tableIndex = 0;
      let lines = text.split('\n');
      let nonTableText = '';
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        // Check if this is a table header line
        if (line.trim().startsWith('|') && i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          // Check if next line is separator (dashes and pipes)
          if (/^\s*\|[\s\|:\-]+\|\s*$/.test(nextLine)) {
            // This is a table! Parse it
            const tableRows = [];
            tableRows.push(line); // header
            tableRows.push(nextLine); // separator
            i += 2;

            // Collect all table rows
            while (i < lines.length && lines[i].trim().startsWith('|')) {
              tableRows.push(lines[i]);
              i++;
            }

            // Parse table
            const headerCells = tableRows[0].split('|').map(c => c.trim()).filter(c => c);
            let tableHtml = '<table style="border-collapse: collapse; width: 100%; margin: 10px 0;"><thead><tr style="background: #f0f2f5; border-bottom: 2px solid #d0d0d0;">' +
              headerCells.map(c => `<th style="padding: 10px 14px; text-align: left; font-weight: 600; border-right: 1px solid #e0e0e0;">${this._escapeHtml(c)}</th>`).join('') +
              '</tr></thead><tbody>';

            for (let j = 2; j < tableRows.length; j++) {
              const row = tableRows[j];
              const cells = row.split('|').map(c => c.trim()).filter(c => c);
              tableHtml += '<tr style="border-bottom: 1px solid #e8e8e8;">' +
                cells.map(c => `<td style="padding: 9px 14px; border-right: 1px solid #e8e8e8;">${this._escapeHtml(c)}</td>`).join('') +
                '</tr>';
            }

            tableHtml += '</tbody></table>';
            tables[tableIndex] = tableHtml;
            nonTableText += `\n__TABLE_${tableIndex}__\n`;
            tableIndex++;
            continue;
          }
        }

        nonTableText += line + '\n';
        i++;
      }

      let html = this._escapeHtml(nonTableText);

      // Replace table placeholders with actual table HTML
      for (let j = 0; j < tables.length; j++) {
        html = html.replace(`__TABLE_${j}__`, tables[j]);
      }

      // Headings (must be at start of line)
      html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

      // Line breaks
      html = html.replace(/\n\n/g, '</p><p>');
      html = '<p>' + html + '</p>';
      html = html.replace(/<p><h[1-3]/g, '<h1'); // Fix nested p/h tags
      html = html.replace(/<\/h[1-3]><\/p>/g, '</h1>');

      // Links [text](url)
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#A63F1C;text-decoration:underline;">$1</a>');

      // Bold **text** or __text__
      html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

      // Italic *text* or _text_
      html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
      html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

      // Underline <u>text</u>
      html = html.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, '<u>$1</u>');

      // Code blocks ```language ... ```
      html = html.replace(/&lt;code&gt;([\s\S]*?)&lt;\/code&gt;/g, '<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;">$1</code>');

      // Inline code `text`
      html = html.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;font-family:monospace;">$1</code>');

      // Lists - unordered
      html = html.replace(/^[-•] (.*?)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)/s, '<ul style="margin-left:20px;margin-top:10px;">$1</ul>');

      // Blockquotes
      html = html.replace(/^&gt; (.*?)$/gm, '<blockquote style="border-left:4px solid #C2471F;padding-left:12px;margin-left:0;color:#666;">$1</blockquote>');

      // Remove duplicate p tags
      html = html.replace(/<p><\/p>/g, '');
      html = html.replace(/<p>(<ul>|<h[1-3]|<blockquote)/g, '$1');
      html = html.replace(/(<\/ul>|<\/h[1-3]>|<\/blockquote>)<\/p>/g, '$1');

      return html;
    }

    /**
     * Convert a single line/run of markdown into INLINE HTML — bold, italic,
     * underline, links, inline code only. Crucially, does NOT wrap the result
     * in <p>...</p> like _markdownToHtml does.
     *
     * Use this when storing converted content inside another block element
     * (e.g., paragraph, heading, list item). _markdownToHtml's <p> wrapping
     * causes invalid nesting (<p><p>x</p></p>, <h1><p>x</p></h1>) which
     * browsers auto-fix by closing the outer element early — splitting the
     * intended content out of the contenteditable and leaving an empty,
     * un-typeable shell behind.
     */
    _markdownToInlineHtml(text) {
      if (!text) return '';
      let html = this._escapeHtml(text);

      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#A63F1C;text-decoration:underline;">$1</a>');
      html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
      html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
      html = html.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, '<u>$1</u>');
      html = html.replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;font-family:monospace;">$1</code>');

      return html;
    }

    _htmlToMarkdown(html) {
      if (!html) return '';
      let text = html;
      text = text.replace(/<br\s*\/?>/gi, '');
      text = text.replace(/<(b|strong)>(.*?)<\/(b|strong)>/gi, '**$2**');
      text = text.replace(/<(i|em)>(.*?)<\/(i|em)>/gi, '*$2*');
      text = text.replace(/<u>/gi, '\x00U_OPEN\x00');
      text = text.replace(/<\/u>/gi, '\x00U_CLOSE\x00');
      text = text.replace(/<[^>]+>/g, '');
      text = text.replace(/\x00U_OPEN\x00/g, '<u>');
      text = text.replace(/\x00U_CLOSE\x00/g, '</u>');
      const el = document.createElement('textarea');
      el.innerHTML = text;
      return el.value;
    }

    _resolveImageSrc(src) {
      if (this._resolveImageSrcFn) return this._resolveImageSrcFn(src);
      if (!src) return '';
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/') || src.startsWith('data:')) return src;
      return '/content/' + src;
    }

    _updateImagePreview(blockEl, src, alt) {
      const img = blockEl.querySelector('.editor-image');
      const placeholder = blockEl.querySelector('.editor-image-placeholder');
      const error = blockEl.querySelector('.editor-image-error');
      if (src) {
        if (!img) {
          const preview = blockEl.querySelector('.editor-image-preview');
          if (preview) {
            preview.innerHTML = `<img src="${this._escapeHtml(this._resolveImageSrc(src))}" alt="${this._escapeHtml(alt)}" class="editor-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="editor-image-error" style="display: none;">Image failed to load: ${this._escapeHtml(src)}</div>`;
          }
        } else {
          img.style.display = 'block';
          img.src = this._resolveImageSrc(src);
          img.alt = alt;
        }
        if (placeholder) placeholder.style.display = 'none';
        if (error) error.style.display = 'none';
      } else {
        if (img) img.style.display = 'none';
        if (error) error.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
      }
    }

    /* ---------------------------------------------------------------
     *  Internal — Inline image paste / drop (base64 data URIs)
     *
     *  The image block's preview doubles as a drop zone. Dropping an OS image
     *  file onto it, or pasting an image while it is focused, embeds the image
     *  inline as `![alt](data:image/...;base64,...)`. This is deliberately
     *  separate from the page's clipboard/drag folder-upload flow: that path
     *  still handles pastes/drops everywhere else and remains the way to store
     *  an image as a file. Only the focused image drop zone opts into inline.
     * -------------------------------------------------------------*/

    /** True when `file` is an image we can embed inline. */
    _isInlineImageFile(file) {
      return !!(file && typeof file.type === 'string' && /^image\//i.test(file.type));
    }

    /** First image File on a DataTransfer (handles both files and items). */
    _firstImageFile(dataTransfer) {
      if (!dataTransfer) return null;
      if (dataTransfer.files && dataTransfer.files.length) {
        for (const f of dataTransfer.files) if (this._isInlineImageFile(f)) return f;
      }
      if (dataTransfer.items && dataTransfer.items.length) {
        for (const it of dataTransfer.items) {
          if (it.kind === 'file' && /^image\//i.test(it.type)) {
            const f = it.getAsFile();
            if (f) return f;
          }
        }
      }
      return null;
    }

    /**
     * Resolve the `.editor-image-dropzone` an OS file drag/drop is over, or
     * null if this isn't a file drag over an image block.
     */
    _imageDropTargetFromEvent(e) {
      const dt = e.dataTransfer;
      if (!dt) return null;
      const types = dt.types ? Array.from(dt.types) : [];
      if (!types.includes('Files')) return null; // ignore internal HTML/text drags
      const blockEl = e.target.closest && e.target.closest('.editor-block');
      if (!blockEl || blockEl.dataset.type !== 'image') return null;
      return blockEl.querySelector('.editor-image-dropzone') || null;
    }

    _handleImageDropzoneFocus(e) {
      const zone = e.target.closest && e.target.closest('.editor-image-dropzone');
      if (!zone) return;
      const blockEl = zone.closest('.editor-block');
      if (blockEl && blockEl.dataset.type === 'image') {
        this._pasteTargetImageBlockEl = blockEl;
        zone.classList.add('armed');
      }
    }

    _handleImageDropzoneBlur(e) {
      const zone = e.target.closest && e.target.closest('.editor-image-dropzone');
      if (!zone) return;
      zone.classList.remove('armed');
      if (this._pasteTargetImageBlockEl === zone.closest('.editor-block')) {
        this._pasteTargetImageBlockEl = null;
      }
    }

    /** The {index, block} record for a block element, or null. */
    _blockRecordForEl(blockEl) {
      if (!blockEl) return null;
      return this._blocks.find(b => b.element === blockEl) || null;
    }

    /** True if an image block is focused and waiting to receive a pasted image. */
    hasArmedImageBlock() {
      return !!(this._pasteTargetImageBlockEl && this._pasteTargetImageBlockEl.isConnected);
    }

    /**
     * Public hook for a host paste handler: if an image block is armed, embed
     * `file` into it inline (base64) and return true; otherwise return false so
     * the host can fall back to its normal (folder-upload) handling.
     */
    consumePastedImageFile(file) {
      const blockEl = this._pasteTargetImageBlockEl;
      if (!blockEl || !blockEl.isConnected) return false;
      if (!this._isInlineImageFile(file)) return false;
      this._applyImageFileToBlock(blockEl, file);
      return true;
    }

    /** Read `file` as a base64 data URI and set it as the image block's src. */
    _applyImageFileToBlock(blockEl, file) {
      const record = this._blockRecordForEl(blockEl);
      if (!record) return;
      if (file.size > this._maxInlineImageBytes) {
        const cap = Math.round(this._maxInlineImageBytes / (1024 * 1024));
        this._flashImageDropzoneMessage(
          blockEl,
          `Image is too large to embed inline (max ${cap} MB). Use the upload/path option instead.`,
          true
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (!/^data:image\//i.test(dataUrl)) {
          this._flashImageDropzoneMessage(blockEl, 'Could not read that image.', true);
          return;
        }
        record.data = record.data || {};
        record.data.src = dataUrl;
        if (!record.data.alt && file.name) {
          record.data.alt = file.name.replace(/\.[^.]+$/, '');
        }
        // Re-render the block so the data-URI shows the compact "embedded
        // image" chip rather than a giant string in the path field.
        this._renderBlockContent(blockEl, 'image', record.data);
        // Re-rendering drops focus from the drop zone; require an explicit
        // re-focus before another paste embeds again (so the next paste
        // elsewhere falls back to the normal folder upload).
        if (this._pasteTargetImageBlockEl === blockEl) this._pasteTargetImageBlockEl = null;
        this._onChange();
      };
      reader.onerror = () => this._flashImageDropzoneMessage(blockEl, 'Failed to read the image file.', true);
      reader.readAsDataURL(file);
    }

    /** Briefly show a message inside an image block's drop zone placeholder. */
    _flashImageDropzoneMessage(blockEl, message, isError) {
      if (!blockEl) return;
      const placeholder = blockEl.querySelector('.editor-image-placeholder');
      if (!placeholder) {
        // No empty placeholder visible (block already has an image) — surface
        // the message in the console rather than swallowing it.
        if (isError) console.warn('[MarkdownEditor] image:', message);
        return;
      }
      const prev = placeholder.innerHTML;
      placeholder.classList.toggle('is-error', !!isError);
      placeholder.textContent = message;
      setTimeout(() => {
        if (!placeholder.isConnected) return;
        placeholder.classList.remove('is-error');
        placeholder.innerHTML = prev;
      }, 3500);
    }

    /* ---------------------------------------------------------------
     *  Internal — Markdown serialization / parsing
     * -------------------------------------------------------------*/

    _toMarkdown() {
      return this._blocks.map(block => {
        const blockDef = window.MarkdownEditor && window.MarkdownEditor.getBlock && window.MarkdownEditor.getBlock(block.type);
        if (blockDef && blockDef.toMarkdown) return blockDef.toMarkdown(block.data, this);
        return block.data.text || '';
      }).join('\n\n');
    }

    _fromMarkdown(md) {
      const blocks = [];
      const lines = md.replace(/\r\n?/g, '\n').split('\n');
      const registry = (window.MarkdownEditor && window.MarkdownEditor._blocks) || [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') { i++; continue; }

        let matched = null;
        let matchedDef = null;
        for (const blockDef of registry) {
          if (blockDef.type === 'paragraph') continue; // paragraph is the fallback
          if (typeof blockDef.fromMarkdown !== 'function') continue;
          const result = blockDef.fromMarkdown(line, lines, i, this);
          if (result) { matched = result; matchedDef = blockDef; break; }
        }

        if (matched && matchedDef) {
          blocks.push({ type: matched.type || matchedDef.type, data: matched.data });
          i += matched.consumed || 1;
        } else {
          blocks.push({ type: 'paragraph', data: { text: this._markdownToInlineHtml(line) } });
          i++;
        }
      }

      if (blocks.length === 0) blocks.push({ type: 'paragraph', data: { text: '' } });
      this._data = { blocks, version: '1.0' };
      this._render();
    }
  }

  // Static block registry. The companion script markdown-editor-blocks.js (and any
  // user-supplied scripts) call MarkdownEditor.registerBlock(blockDef) to populate this.
  MarkdownEditor._blocks = [];
  MarkdownEditor.registerBlock = function (blockDef) {
    if (!blockDef || !blockDef.type) {
      console.warn('[MarkdownEditor.registerBlock] blockDef requires a `type` property');
      return;
    }
    const existing = MarkdownEditor._blocks.findIndex(b => b.type === blockDef.type);
    if (existing >= 0) MarkdownEditor._blocks[existing] = blockDef;
    else MarkdownEditor._blocks.push(blockDef);
  };
  MarkdownEditor.getBlock = function (type) {
    return MarkdownEditor._blocks.find(b => b.type === type) || null;
  };

  return MarkdownEditor;
}));
