/**
 * Loading Indicator Component (Task 7.1.4)
 *
 * Flexible loading display with:
 * - Spinner variant (animated rotate)
 * - Progress bar variant (0-100%)
 * - Skeleton loader variant (placeholder content)
 * - Full-page overlay option
 * - Customizable message
 */

class LoadingIndicator {
  constructor(options = {}) {
    this.id = options.id || `loading-${Date.now()}`;
    this.type = options.type || 'spinner'; // spinner, progress, skeleton
    this.message = options.message || 'Loading...';
    this.progress = options.progress || 0;
    this.fullScreen = options.fullScreen !== false;
    this.overlay = options.overlay !== false;
    this.container = options.container || document.body;
    this.element = null;
  }

  /**
   * Show loading indicator
   */
  show() {
    // Remove existing
    const existing = document.getElementById(this.id);
    if (existing) {
      existing.remove();
    }

    // Create element
    this.element = document.createElement('div');
    this.element.id = this.id;

    if (this.fullScreen) {
      this.element.className = 'fixed-top';
      this.element.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      `;
    }

    if (this.type === 'spinner') {
      this.element.innerHTML = this.getSpinnerHTML();
    } else if (this.type === 'progress') {
      this.element.innerHTML = this.getProgressHTML();
    } else if (this.type === 'skeleton') {
      this.element.innerHTML = this.getSkeletonHTML();
    }

    this.container.appendChild(this.element);
  }

  /**
   * Get spinner HTML
   */
  getSpinnerHTML() {
    return `
      <div class="text-center">
        <div class="spinner-border mb-3" role="status" style="width: 42px; height: 42px;">
          <span class="visually-hidden">Loading...</span>
        </div>
        <p class="text-muted">${this.message}</p>
      </div>
    `;
  }

  /**
   * Get progress HTML
   */
  getProgressHTML() {
    return `
      <div style="width: 300px;">
        <div class="progress mb-3" style="height: 8px;">
          <div id="${this.id}-bar" class="progress-bar progress-bar-striped progress-bar-animated"
               role="progressbar" style="width: ${this.progress}%"
               aria-valuenow="${this.progress}" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
        <p class="text-center text-muted">${this.message}</p>
        <p class="text-center"><strong>${this.progress}%</strong></p>
      </div>
    `;
  }

  /**
   * Get skeleton HTML
   */
  getSkeletonHTML() {
    return `
      <div style="width: 100%; max-width: 400px;">
        <div class="placeholder-glow">
          <span class="placeholder placeholder-lg mb-3" style="width: 100%;"></span>
          <span class="placeholder mb-2" style="width: 75%;"></span>
          <span class="placeholder mb-2" style="width: 100%;"></span>
          <span class="placeholder mb-2" style="width: 90%;"></span>
          <span class="placeholder mb-2" style="width: 85%;"></span>
        </div>
        <p class="text-center text-muted mt-3">${this.message}</p>
      </div>
    `;
  }

  /**
   * Update progress (for progress variant)
   */
  setProgress(value) {
    this.progress = Math.min(100, Math.max(0, value));

    const bar = document.getElementById(`${this.id}-bar`);
    if (bar) {
      bar.style.width = `${this.progress}%`;
      bar.setAttribute('aria-valuenow', this.progress);
    }
  }

  /**
   * Update message
   */
  setMessage(message) {
    this.message = message;
    if (this.element) {
      const p = this.element.querySelector('p');
      if (p) {
        p.textContent = message;
      }
    }
  }

  /**
   * Hide loading indicator
   */
  hide() {
    if (this.element) {
      this.element.style.opacity = '0';
      this.element.style.transition = 'opacity 0.3s ease';

      setTimeout(() => {
        if (this.element && this.element.parentNode) {
          this.element.remove();
        }
      }, 300);
    }
  }

  /**
   * Destroy (immediate removal)
   */
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.remove();
    }
  }
}

/**
 * Convenience function: Show spinner
 */
function showSpinner(options = {}) {
  const loading = new LoadingIndicator({
    ...options,
    type: 'spinner'
  });
  loading.show();
  return loading;
}

/**
 * Convenience function: Show progress bar
 */
function showProgress(options = {}) {
  const loading = new LoadingIndicator({
    ...options,
    type: 'progress'
  });
  loading.show();
  return loading;
}

/**
 * Convenience function: Show skeleton
 */
function showSkeleton(options = {}) {
  const loading = new LoadingIndicator({
    ...options,
    type: 'skeleton'
  });
  loading.show();
  return loading;
}

/**
 * Global loading state (use with async operations)
 */
class LoadingManager {
  constructor() {
    this.activeLoaders = new Map();
  }

  /**
   * Start loading with ID
   */
  start(id, options = {}) {
    if (this.activeLoaders.has(id)) {
      return this.activeLoaders.get(id);
    }

    const loader = new LoadingIndicator({
      id: `loading-${id}`,
      ...options
    });

    loader.show();
    this.activeLoaders.set(id, loader);
    return loader;
  }

  /**
   * Stop loading by ID
   */
  stop(id) {
    const loader = this.activeLoaders.get(id);
    if (loader) {
      loader.hide();
      this.activeLoaders.delete(id);
    }
  }

  /**
   * Get loader by ID
   */
  get(id) {
    return this.activeLoaders.get(id);
  }

  /**
   * Stop all loaders
   */
  stopAll() {
    for (const [id, loader] of this.activeLoaders) {
      loader.destroy();
    }
    this.activeLoaders.clear();
  }
}

/**
 * Global loading manager instance
 */
const loadingManager = new LoadingManager();

/**
 * Async operation wrapper with automatic loading
 */
async function withLoading(asyncFn, options = {}) {
  const id = options.id || `op-${Date.now()}`;
  const loader = loadingManager.start(id, {
    type: options.type || 'spinner',
    message: options.message || 'Loading...',
    fullScreen: options.fullScreen !== false
  });

  try {
    const result = await asyncFn(loader);
    loadingManager.stop(id);
    return result;
  } catch (error) {
    loadingManager.stop(id);
    throw error;
  }
}
