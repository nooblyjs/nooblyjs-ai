/* Settings screen — the core secure settings store (/services/settings).
 *
 * This screen is a single panel. It previously carried three tabs (General,
 * Preferences and Secure store) backed by /api/settings; the General and
 * Preferences forms were removed along with their local defaults, so the
 * grouped key/value store — encrypted at rest — is now the whole screen.
 */
(function () {
  const { escapeHtml, toast } = window.DS.util;

  const local = { panel: null };

  function renderBody() {
    // Mounted after render by mountSettings(); the core settings service owns
    // everything inside this container.
    return `<div class="card"><div class="card-pad"><div id="secureStorePanel"></div></div></div>`;
  }

  /**
   * Mounts the core settings console.
   * Safe to call after every repaint: the previous instance is torn down first
   * so listeners are not left behind on detached nodes.
   */
  function mountSettings() {
    if (local.panel) {
      try { local.panel.destroy(); } catch (err) { /* already detached */ }
      local.panel = null;
    }

    const container = document.getElementById('secureStorePanel');
    if (!container) return;

    if (typeof SettingsUIManager === 'undefined') {
      container.innerHTML = `<div class="empty-state"><div style="font-size:13px">
        Settings console unavailable &mdash; /services/settings/scripts did not load.</div></div>`;
      return;
    }

    local.panel = new SettingsUIManager({
      container,
      title: 'Settings',
      subtitle: 'Grouped key/value settings, encrypted at rest with AES-256-GCM',
      onError: (err) => toast(err.message, 'danger'),
    });

    local.panel.initialize().catch((err) => {
      container.innerHTML = `<div class="empty-state"><div style="font-size:13px">
        Couldn't load the settings store: ${escapeHtml(err.message)}</div></div>`;
    });
  }

  function html() {
    return `${pageHead('settings', '')}<div data-region="body"></div>`;
  }

  function init(root) {
    // No screen-level data to fetch — the settings console loads its own groups
    // and values. loadRegion still owns the render + onRendered lifecycle.
    window.DS.util.loadRegion(root, async () => true, () => renderBody(), { onRendered: mountSettings });
  }

  async function handle(action) {
    if (action === 'retry') return rerenderScreen();
  }

  window.Router.register('settings', { html, init, handle }, {
    title: 'Settings',
    sub: 'Workspace configuration.',
    crumb: ['System', 'Settings'],
  });
})();
