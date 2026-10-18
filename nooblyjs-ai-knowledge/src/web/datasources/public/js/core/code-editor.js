/* Code editor — a CodeMirror editor inside a kr-ds modal.
   Used by the workflow editor to edit file-based step modules.

   DS.codeEditor.open({ title, value, mode?, readOnly?, onSave })
     onSave(code) may return a promise; the modal closes on success.

   Unlike the legacy Bootstrap step editors, the kr-ds modal is visible
   the moment it mounts, so CodeMirror measures its layout correctly. */
(function () {
  const { escapeHtml, toast } = window.DS.util;

  function modalHtml(title) {
    return `
      <div class="modal-card" style="width:min(980px,96vw);height:84vh">
        <div class="card-head">
          <div class="card-title">${icon('code', 16)} ${escapeHtml(title || 'Code editor')}</div>
          <button class="btn btn-icon-sm" data-action="modal-close" title="Close">${icon('x', 14)}</button>
        </div>
        <div class="modal-body" style="flex:1;display:flex;flex-direction:column;min-height:0;padding:0">
          <div id="dsCodeEditorArea" style="flex:1;min-height:0"></div>
        </div>
        <div class="row" style="justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--line-2)">
          <button class="btn" data-action="modal-close">Cancel</button>
          <button class="btn btn-primary" id="dsCodeEditorSave">${icon('save', 13)} Save</button>
        </div>
      </div>`;
  }

  function open(opts = {}) {
    if (typeof window.CodeMirror === 'undefined') {
      toast('Code editor component (CodeMirror) is not available', 'danger');
      return;
    }
    window.openModal(modalHtml(opts.title));

    const area = document.getElementById('dsCodeEditorArea');
    const cm = window.CodeMirror(area, {
      value: opts.value != null ? String(opts.value) : '',
      mode: opts.mode || 'javascript',
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      readOnly: !!opts.readOnly,
    });
    // The modal is already on-screen; nudge a refresh once layout settles.
    requestAnimationFrame(() => { cm.refresh(); if (!opts.readOnly) cm.focus(); });
    setTimeout(() => cm.refresh(), 140);

    const saveBtn = document.getElementById('dsCodeEditorSave');
    if (opts.readOnly) {
      if (saveBtn) saveBtn.style.display = 'none';
      return;
    }
    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (typeof opts.onSave !== 'function') { window.closeModal(); return; }
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
        try {
          await opts.onSave(cm.getValue());
          window.closeModal();
        } catch (err) {
          console.error('[code-editor] save failed:', err);
          saveBtn.disabled = false;
          saveBtn.innerHTML = `${icon('save', 13)} Save`;
          toast('Save failed: ' + (err && err.message || 'error'), 'danger');
        }
      };
    }
  }

  window.DS = window.DS || {};
  window.DS.codeEditor = { open };
})();
