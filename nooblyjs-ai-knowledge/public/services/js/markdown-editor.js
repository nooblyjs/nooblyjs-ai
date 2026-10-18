/**
 * @fileoverview Simple Markdown Editor
 * Wraps a contentEditable div (or textarea) with markdown editing support,
 * keyboard shortcuts, and plain-text content management.
 *
 * @author noobly Team
 * @since 2026-04-08
 */

class MarkdownEditor {
  constructor(elementId, options = {}) {
    this.elementId = elementId;
    this.element = document.getElementById(elementId);
    this.options = options;
    this._isDirty = false;
    this.lastContent = '';
    this.isTextarea = false;

    if (!this.element) {
      console.error('MarkdownEditor: Element not found:', elementId);
      return;
    }

    this.isTextarea = this.element.tagName === 'TEXTAREA';

    if (!this.isTextarea) {
      // Make the div editable and behave like a code editor
      this.element.setAttribute('contenteditable', 'true');
      this.element.setAttribute('spellcheck', 'false');
      this.element.style.whiteSpace = 'pre-wrap';
      this.element.style.wordWrap = 'break-word';
      this.element.style.overflowY = 'auto';
      this.element.style.outline = 'none';
      this.element.style.minHeight = '300px';
    }

    // Common styling
    this.element.style.fontFamily = "'Consolas', 'Monaco', 'Courier New', monospace";
    this.element.style.fontSize = '14px';
    this.element.style.lineHeight = '1.6';
    this.element.style.padding = '12px';
    this.element.style.width = '100%';
    this.element.style.boxSizing = 'border-box';

    // Event listeners
    this.element.addEventListener('input', () => {
      this._isDirty = true;
      if (this.options.onChange) {
        this.options.onChange();
      }
    });

    this.element.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });

    // Paste as plain text in contentEditable mode
    if (!this.isTextarea) {
      this.element.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      });
    }
  }

  // ===========================================================================
  // Content API
  // ===========================================================================

  /** Load content into the editor */
  load(content) {
    const text = content || '';
    if (this.isTextarea) {
      this.element.value = text;
    } else {
      this.element.textContent = text;
    }
    this.lastContent = text;
    this._isDirty = false;
  }

  /** Get the current raw text content */
  content() {
    if (this.isTextarea) {
      return this.element.value;
    }
    return this.element.innerText || this.element.textContent || '';
  }

  /** Mark content as saved */
  save() {
    this.lastContent = this.content();
    this._isDirty = false;
  }

  /** Tear down the editor */
  destroy() {
    if (this.element) {
      if (this.isTextarea) {
        this.element.value = '';
      } else {
        this.element.textContent = '';
        this.element.removeAttribute('contenteditable');
      }
    }
  }

  /** Whether content has changed since last load/save */
  isDirty() {
    return this._isDirty;
  }

  /** Reset dirty flag */
  clearDirty() {
    this._isDirty = false;
  }

  // ===========================================================================
  // Keyboard shortcuts
  // ===========================================================================

  handleKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key === 'b') {
      e.preventDefault();
      this.wrapSelection('**', '**', 'bold text');
    } else if (mod && e.key === 'i') {
      e.preventDefault();
      this.wrapSelection('*', '*', 'italic text');
    } else if (mod && e.key === 'k') {
      e.preventDefault();
      this.wrapSelection('`', '`', 'code');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.insertAtCursor('  ');
    }
  }

  // ===========================================================================
  // Selection / insertion helpers
  // ===========================================================================

  /** Wrap the current selection (or insert placeholder) with before/after text */
  wrapSelection(before, after, placeholder) {
    if (this.isTextarea) {
      this._wrapTextarea(before, after, placeholder);
    } else {
      this._wrapContentEditable(before, after, placeholder);
    }
    this._isDirty = true;
    if (this.options.onChange) this.options.onChange();
  }

  /** Insert plain text at the cursor */
  insertAtCursor(text) {
    if (this.isTextarea) {
      const start = this.element.selectionStart;
      const end = this.element.selectionEnd;
      const val = this.element.value;
      this.element.value = val.substring(0, start) + text + val.substring(end);
      this.element.selectionStart = this.element.selectionEnd = start + text.length;
      this.element.focus();
    } else {
      document.execCommand('insertText', false, text);
    }
    this._isDirty = true;
    if (this.options.onChange) this.options.onChange();
  }

  // --- private helpers ---

  _wrapTextarea(before, after, placeholder) {
    const el = this.element;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.substring(start, end) || placeholder;
    const replacement = before + selected + after;
    el.value = el.value.substring(0, start) + replacement + el.value.substring(end);
    el.selectionStart = start + before.length;
    el.selectionEnd = start + before.length + selected.length;
    el.focus();
  }

  _wrapContentEditable(before, after, placeholder) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selected = range.toString() || placeholder;
    const replacement = before + selected + after;

    range.deleteContents();
    const textNode = document.createTextNode(replacement);
    range.insertNode(textNode);

    // Re-select just the inner text (between before/after markers)
    const newRange = document.createRange();
    newRange.setStart(textNode, before.length);
    newRange.setEnd(textNode, before.length + selected.length);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

// Make available globally
window.MarkdownEditor = MarkdownEditor;
