/**
 * @fileoverview Notification Controller
 * Manages the notification center UI, badge updates, and notification history
 * Integrates with Socket.IO for real-time notification delivery
 *
 * @author noobly Team
 * @since 2026-04-08
 */

class NotificationController {
  constructor() {
    this.notifications = [];
    this.subscriptions = [];
    this.unreadCount = 0;
    this.panelOpen = false;
    this.activeTab = 'notifications'; // 'notifications' or 'subscriptions'
    this.bellBtn = null;
    this.badge = null;
    this.panel = null;
    this.notificationList = null;
    this.subscriptionList = null;
    this.maxHistoryDisplay = 50;
    this.documentController = null;
  }

  /**
   * Set document controller reference for navigation
   */
  setDocumentController(dc) {
    this.documentController = dc;
  }

  /** Current space — notifications/subscriptions are space-scoped. */
  currentSpaceName() {
    return this.documentController?.app?.currentSpace?.name || null;
  }
  spaceQS() {
    const sp = this.currentSpaceName();
    return sp ? `?space=${encodeURIComponent(sp)}` : '';
  }

  /**
   * Initialize the notification center
   */
  async init() {
    this.bellBtn = document.getElementById('notificationBellBtn');
    this.badge = document.getElementById('notificationBadge');
    this.panel = document.getElementById('notificationPanel');
    this.notificationList = document.getElementById('notificationList');
    this.subscriptionList = document.getElementById('subscriptionList');

    if (!this.bellBtn || !this.panel) {
      console.warn('NotificationController: Required UI elements not found');
      return;
    }

    // Set up event listeners
    this.bellBtn.addEventListener('click', () => this.togglePanel());
    document.getElementById('closeNotificationPanel')?.addEventListener('click', () => this.closePanel());
    document.getElementById('markAllReadBtn')?.addEventListener('click', () => this.markAllRead());
    document.getElementById('clearReadBtn')?.addEventListener('click', () => this.clearReadNotifications());

    // Tab switching
    document.getElementById('notificationsTab')?.addEventListener('click', () => this.switchTab('notifications'));
    document.getElementById('subscriptionsTab')?.addEventListener('click', () => this.switchTab('subscriptions'));

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      if (this.panelOpen && !this.panel.contains(e.target) && !this.bellBtn.contains(e.target)) {
        this.closePanel();
      }
    });

    // Notifications and subscriptions are SPACE-SCOPED, and this runs during
    // app boot — before the space auto-select has resolved. A request with no
    // `?space=` reads `history[null]` server-side, which is always empty, so
    // this first pass exists only to clear the UI; `spaceChanged` below is what
    // actually populates it.
    await this.refresh();

    // Re-read whenever the user switches space (dispatched by
    // spacesController.selectSpace). Without this the bell kept whatever the
    // space-less boot request returned — i.e. nothing, forever.
    window.addEventListener('spaceChanged', () => {
      this.refresh().catch(err => console.warn('[Notifications] refresh failed:', err));
    });

    // Refresh the subscriptions list whenever a pin toggle (or anything else)
    // changes the user's subscriptions — see pinController.syncSubscription.
    window.addEventListener('kr:subscriptions-changed', async () => {
      await this.loadSubscriptions();
      if (this.panelOpen && this.activeTab === 'subscriptions') {
        this.renderPanel();
      }
    });
  }

  /**
   * Re-read history + subscriptions for the CURRENT space and repaint.
   *
   * The single entry point for "what I'm showing may be out of date": boot,
   * a space switch, and opening the panel all come through here.
   */
  async refresh() {
    await Promise.all([
      this.loadNotifications(),
      this.loadSubscriptions()
    ]);
    this.updateBadge();
    if (this.panelOpen) this.renderPanel();
  }

  /**
   * Load notification history from server
   */
  async loadNotifications() {
    try {
      const response = await fetch(`/applications/wiki/api/notifications/${this.spaceQS()}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        this.notifications = result.data || [];
        this.unreadCount = result.unreadCount || 0;
        this.renderPanel();
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  }

  /**
   * Toggle notification panel visibility
   */
  togglePanel() {
    if (this.panelOpen) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  /**
   * Open notification panel
   */
  openPanel() {
    if (!this.panel) return;
    this.panelOpen = true;
    this.panel.classList.remove('hidden');
    this.panel.style.display = 'block';
    // Opening the bell used to show whatever was fetched at boot. Pull fresh —
    // the panel is on screen either way, so this fills in behind it.
    this.refresh().catch(err => console.warn('[Notifications] refresh failed:', err));
  }

  /**
   * Close notification panel
   */
  closePanel() {
    if (!this.panel) return;
    this.panelOpen = false;
    this.panel.classList.add('hidden');
    this.panel.style.display = 'none';
  }

  /**
   * Update badge with unread count
   */
  updateBadge() {
    if (!this.badge) return;

    // `hidden`, not Bootstrap's `d-none` — this app loads Bootstrap's JS but
    // not its CSS, so `d-none` matched no rule and the badge could never be
    // hidden. Styling is `.kr-bell-badge` in wiki.css.
    if (this.unreadCount > 0) {
      this.badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      this.badge.hidden = false;
    } else {
      this.badge.hidden = true;
    }
  }

  /**
   * Render notification list in panel
   */
  renderPanel() {
    if (this.activeTab === 'notifications') {
      this.renderNotifications();
    } else {
      this.renderSubscriptions();
    }
  }

  /**
   * Render notifications tab
   */
  renderNotifications() {
    if (!this.notificationList) return;

    this.notificationList.innerHTML = '';

    const unreadCount = this.notifications.filter(n => !n.read).length;
    const hasContent = this.notifications.length > 0;

    // Header with action buttons
    if (hasContent) {
      const header = document.createElement('div');
      header.className = 'p-2 d-flex justify-content-between align-items-center border-bottom';
      header.innerHTML = `
        <span>${unreadCount} unread</span>
        <div class="btn-group btn-group-sm" role="group">
          <button id="markAllReadBtn" type="button" class="btn btn-outline-secondary" title="Mark all as read">
            <i class="bi bi-check2-all"></i> Read
          </button>
          <button id="clearReadBtn" type="button" class="btn btn-outline-secondary" title="Clear read items">
            <i class="bi bi-trash"></i> Clear
          </button>
        </div>
      `;
      this.notificationList.appendChild(header);

      // Re-attach event listeners
      document.getElementById('markAllReadBtn')?.removeEventListener('click', () => {});
      document.getElementById('markAllReadBtn')?.addEventListener('click', () => this.markAllRead());
      document.getElementById('clearReadBtn')?.removeEventListener('click', () => {});
      document.getElementById('clearReadBtn')?.addEventListener('click', () => this.clearReadNotifications());
    }

    if (this.notifications.length === 0) {
      this.notificationList.innerHTML = '<div class="p-3 text-muted text-center">No notifications</div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    this.notifications.slice(0, this.maxHistoryDisplay).forEach(notif => {
      const item = document.createElement('div');
      item.className = 'notification-item';
      if (!notif.read) item.classList.add('unread');

      const timestamp = new Date(notif.addedAt || notif.timestamp);
      const timeStr = this.getTimeString(timestamp);
      const operation = notif.operation || 'modified';

      const icon = operation === 'delete' ? 'bi-file-x' : operation === 'create' ? 'bi-file-plus' : 'bi-file-text';
      const spaceLabel = notif.spaceName ? `<small class="text-muted d-block"><i class="bi bi-folder2 me-1"></i>${notif.spaceName}</small>` : '';

      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1" style="min-width: 0;">
            <div style="font-weight: 600;">
              <i class="bi ${icon} me-1"></i>${notif.name}
            </div>
            <small class="text-muted d-block text-truncate">${notif.path}</small>
            ${spaceLabel}
            <small class="text-muted">${timeStr} &middot; ${operation}</small>
          </div>
          <div class="d-flex align-items-center ms-2">
            ${!notif.read ? `<span class="badge bg-primary me-1">New</span>` : ''}
            <i class="bi bi-chevron-right text-muted" style="font-size: 10.5px;"></i>
          </div>
        </div>
      `;

      item.addEventListener('click', () => this.handleNotificationClick(notif));

      fragment.appendChild(item);
    });

    this.notificationList.appendChild(fragment);
  }

  /**
   * Render subscriptions tab
   */
  renderSubscriptions() {
    if (!this.notificationList) return;

    this.notificationList.innerHTML = '';

    if (this.subscriptions.length === 0) {
      this.notificationList.innerHTML = '<div class="p-3 text-muted text-center">No active subscriptions</div>';
      return;
    }

    const header = document.createElement('div');
    header.className = 'p-2 border-bottom';
    header.innerHTML = `<div class="text-muted"><small>${this.subscriptions.length} subscription(s)</small></div>`;
    this.notificationList.appendChild(header);

    const fragment = document.createDocumentFragment();

    this.subscriptions.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'notification-item';

      const typeIcon = sub.type === 'folder' ? 'bi-folder2' : 'bi-file-text';
      const createdDate = new Date(sub.createdAt);
      const createdStr = this.getTimeString(createdDate);

      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div class="flex-grow-1" style="min-width: 0;">
            <div style="font-weight: 600;">
              <i class="bi ${typeIcon} me-1"></i>${sub.path}
            </div>
            <small class="text-muted">${sub.type} &middot; subscribed ${createdStr}</small>
          </div>
          <button class="btn btn-sm btn-outline-danger ms-2" title="Unsubscribe">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      `;

      item.querySelector('button').addEventListener('click', () => {
        this.unsubscribe(sub.id, sub.type, sub.path);
      });

      fragment.appendChild(item);
    });

    this.notificationList.appendChild(fragment);
  }

  /**
   * Get human-readable time string
   */
  getTimeString(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }

  /**
   * Mark a single notification as read
   */
  async markRead(notificationId) {
    try {
      const response = await fetch(`/applications/wiki/api/notifications/${notificationId}/read${this.spaceQS()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        this.unreadCount = result.unreadCount;

        // Update local notification
        const notif = this.notifications.find(n => n.id === notificationId);
        if (notif) notif.read = true;

        this.updateBadge();
        this.renderPanel();
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllRead() {
    try {
      const response = await fetch(`/applications/wiki/api/notifications/read-all${this.spaceQS()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        this.unreadCount = 0;
        this.notifications.forEach(n => n.read = true);

        this.updateBadge();
        this.renderPanel();
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  }

  /**
   * Clear all read notifications from view (remove them from the list)
   */
  clearReadNotifications() {
    this.notifications = this.notifications.filter(n => !n.read);
    this.renderPanel();
  }

  /**
   * Switch between notifications and subscriptions tab
   */
  switchTab(tab) {
    this.activeTab = tab;
    document.getElementById('notificationsTab')?.classList.toggle('active', tab === 'notifications');
    document.getElementById('subscriptionsTab')?.classList.toggle('active', tab === 'subscriptions');
    // Pull fresh subscriptions when opening that tab — the in-memory list is
    // only authoritative if no pin toggles have happened since the last load.
    if (tab === 'subscriptions') {
      this.loadSubscriptions().then(() => this.renderPanel()).catch(() => this.renderPanel());
    } else {
      this.renderPanel();
    }
  }

  /**
   * Load subscriptions from server
   */
  async loadSubscriptions() {
    try {
      const response = await fetch(`/applications/wiki/api/notifications/subscriptions${this.spaceQS()}`, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const result = await response.json();
        this.subscriptions = result.data || [];
      }
    } catch (error) {
      console.error('Failed to load subscriptions:', error);
    }
  }

  /**
   * Unsubscribe from a document or folder
   */
  async unsubscribe(subscriptionId, type, path) {
    try {
      const response = await fetch('/applications/wiki/api/notifications/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, path, spaceName: this.currentSpaceName() })
      });

      if (response.ok) {
        this.subscriptions = this.subscriptions.filter(s => s.id !== subscriptionId);
        this.renderPanel();
      }
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
    }
  }

  /**
   * Handle click on a notification item — mark as read and navigate to the document
   */
  async handleNotificationClick(notif) {
    // Mark as read if unread
    if (!notif.read) {
      await this.markRead(notif.id);
    }

    // Navigate to the document if we have a path and document controller
    if (notif.path && this.documentController) {
      const spaceName = notif.spaceName || null;

      if (spaceName) {
        this.documentController.openDocumentByPath(notif.path, spaceName);
      } else {
        // No space info — try using the current space
        const currentSpaceName = this.documentController.app?.currentSpace?.name;
        if (currentSpaceName) {
          this.documentController.openDocumentByPath(notif.path, currentSpaceName);
        } else {
          console.warn('Cannot navigate: no space name available for notification', notif.path);
        }
      }

      // Close the notification panel after navigation
      this.closePanel();
    }
  }

  /**
   * Handle incoming real-time notification from Socket.IO
   */
  handleIncomingNotification(notification) {
    // Add to top of notifications list
    const notifWithMeta = {
      ...notification,
      id: Math.random().toString(36),
      read: false,
      addedAt: new Date().toISOString()
    };

    this.notifications.unshift(notifWithMeta);

    // Cap history
    if (this.notifications.length > this.maxHistoryDisplay * 2) {
      this.notifications = this.notifications.slice(0, this.maxHistoryDisplay * 2);
    }

    // Update badge
    this.unreadCount = notification.unreadCount || (this.unreadCount + 1);
    this.updateBadge();

    // Refresh panel if open
    if (this.panelOpen) {
      this.renderPanel();
    }
  }
}

// Export as singleton
export const notificationController = new NotificationController();
