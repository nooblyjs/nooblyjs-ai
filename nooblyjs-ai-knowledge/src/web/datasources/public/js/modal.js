/**
 * Modal Dialog Component (Task 7.1.3)
 *
 * Reusable modal component with:
 * - Configurable title, body, and actions
 * - Confirm/cancel pattern
 * - Form modal variant
 * - Close on backdrop click
 * - Keyboard shortcuts (Escape to close)
 */

class Modal {
  constructor(options = {}) {
    this.id = options.id || `modal-${Date.now()}`;
    this.title = options.title || 'Dialog';
    this.body = options.body || '';
    this.actions = options.actions || [];
    this.size = options.size || 'md'; // sm, md, lg, xl
    this.closeOnBackdrop = options.closeOnBackdrop !== false;
    this.closeOnEscape = options.closeOnEscape !== false;
    this.backdrop = options.backdrop !== false;
    this.onClose = options.onClose || (() => {});
    this.element = null;
  }

  /**
   * Show modal
   */
  show() {
    // Remove existing modal with same ID
    const existing = document.getElementById(this.id);
    if (existing) {
      existing.remove();
    }

    // Create modal HTML
    this.element = document.createElement('div');
    this.element.id = this.id;
    this.element.className = 'modal fade show d-block';
    this.element.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    this.element.style.zIndex = '1050';

    const sizeClass = {
      sm: 'modal-sm',
      md: '',
      lg: 'modal-lg',
      xl: 'modal-xl'
    }[this.size] || '';

    let actionsHTML = '';
    if (this.actions.length > 0) {
      actionsHTML = this.actions.map(action => {
        const btnClass = action.class || 'btn-secondary';
        return `
          <button type="button" class="btn ${btnClass}"
                  onclick="event.target.closest('.modal').modalInstance.handleAction('${action.id}')">
            ${action.text || 'Action'}
          </button>
        `;
      }).join('');
    }

    this.element.innerHTML = `
      <div class="modal-dialog ${sizeClass}">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">${this.title}</h5>
            <button type="button" class="btn-close"
                    onclick="event.target.closest('.modal').modalInstance.close()"
                    aria-label="Close"></button>
          </div>
          <div class="modal-body">
            ${typeof this.body === 'string' ? this.body : ''}
          </div>
          ${actionsHTML ? `
            <div class="modal-footer">
              ${actionsHTML}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Store reference to this instance
    this.element.modalInstance = this;

    // Add to DOM
    document.body.appendChild(this.element);

    // Handle backdrop click
    if (this.closeOnBackdrop) {
      this.element.addEventListener('click', (e) => {
        if (e.target === this.element) {
          this.close();
        }
      });
    }

    // Handle Escape key
    if (this.closeOnEscape) {
      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          this.close();
          document.removeEventListener('keydown', escapeHandler);
        }
      };
      document.addEventListener('keydown', escapeHandler);
    }

    // Focus management
    setTimeout(() => {
      const closeBtn = this.element.querySelector('.btn-close');
      if (closeBtn) closeBtn.focus();
    }, 100);
  }

  /**
   * Close modal
   */
  close() {
    if (this.element) {
      this.element.remove();
    }
    this.onClose();
  }

  /**
   * Handle action button click
   */
  handleAction(actionId) {
    const action = this.actions.find(a => a.id === actionId);
    if (action && action.onClick) {
      action.onClick();
    }
  }

  /**
   * Update body content
   */
  setBody(body) {
    this.body = body;
    if (this.element) {
      const bodyEl = this.element.querySelector('.modal-body');
      if (bodyEl) {
        bodyEl.innerHTML = typeof body === 'string' ? body : '';
      }
    }
  }

  /**
   * Add or update action
   */
  addAction(action) {
    this.actions.push(action);
  }

  /**
   * Remove action by ID
   */
  removeAction(actionId) {
    this.actions = this.actions.filter(a => a.id !== actionId);
  }
}

/**
 * Convenience function: Show confirmation dialog
 */
function showConfirmDialog(options = {}) {
  const modal = new Modal({
    title: options.title || 'Confirm',
    body: options.message || 'Are you sure?',
    size: options.size || 'sm',
    actions: [
      {
        id: 'cancel',
        text: options.cancelText || 'Cancel',
        class: 'btn-secondary',
        onClick: () => {
          modal.close();
          if (options.onCancel) options.onCancel();
        }
      },
      {
        id: 'confirm',
        text: options.confirmText || 'Confirm',
        class: options.confirmClass || 'btn-danger',
        onClick: () => {
          modal.close();
          if (options.onConfirm) options.onConfirm();
        }
      }
    ],
    closeOnBackdrop: true,
    closeOnEscape: true
  });

  modal.show();
  return modal;
}

/**
 * Convenience function: Show alert dialog
 */
function showAlertDialog(options = {}) {
  const modal = new Modal({
    title: options.title || 'Alert',
    body: options.message || 'Information',
    size: options.size || 'sm',
    actions: [
      {
        id: 'ok',
        text: options.buttonText || 'OK',
        class: 'btn-primary',
        onClick: () => {
          modal.close();
          if (options.onOK) options.onOK();
        }
      }
    ],
    closeOnBackdrop: true,
    closeOnEscape: true
  });

  modal.show();
  return modal;
}

/**
 * Convenience function: Show form dialog
 */
function showFormDialog(options = {}) {
  const formHTML = `
    <form id="dialogForm" onsubmit="return false;">
      ${options.fields ? options.fields.map(field => `
        <div class="mb-3">
          <label for="${field.id}" class="form-label">${field.label || field.id}</label>
          ${field.type === 'textarea' ? `
            <textarea class="form-control" id="${field.id}" name="${field.id}"
                      placeholder="${field.placeholder || ''}">${field.value || ''}</textarea>
          ` : `
            <input type="${field.type || 'text'}" class="form-control" id="${field.id}"
                   name="${field.id}" placeholder="${field.placeholder || ''}"
                   value="${field.value || ''}" ${field.required ? 'required' : ''}>
          `}
          ${field.help ? `<small class="form-text text-muted">${field.help}</small>` : ''}
        </div>
      `).join('') : ''}
    </form>
  `;

  const modal = new Modal({
    title: options.title || 'Form',
    body: formHTML,
    size: options.size || 'md',
    actions: [
      {
        id: 'cancel',
        text: 'Cancel',
        class: 'btn-secondary',
        onClick: () => {
          modal.close();
          if (options.onCancel) options.onCancel();
        }
      },
      {
        id: 'submit',
        text: options.submitText || 'Submit',
        class: 'btn-primary',
        onClick: () => {
          const form = document.getElementById('dialogForm');
          if (form && form.checkValidity()) {
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            modal.close();
            if (options.onSubmit) options.onSubmit(data);
          }
        }
      }
    ],
    closeOnBackdrop: false,
    closeOnEscape: true
  });

  modal.show();
  return modal;
}
