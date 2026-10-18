/**
 * @fileoverview Fullscreen image lightbox for the public landing page.
 *
 * Mirrors the lightbox the wiki app installs (src/web/wiki/public/js/app.js
 * → initImageLightbox): click any <img> rendered inside a `.md-doc`,
 * `.markdown-content` or `.markdown-preview` block and it opens centered at
 * full size on a dark backdrop. Closes on backdrop click, the × button, or
 * Escape. Opt a single image out with `data-no-lightbox`.
 *
 * Self-contained (no dependencies) and idempotent — safe to load once on any
 * page that renders markdown with the custom parser.
 */
(function () {
  'use strict';

  function install() {
    if (window.__krImgLightboxInit) return;
    window.__krImgLightboxInit = true;

    // Dark backdrop overlay holding the enlarged image + a close button.
    const overlay = document.createElement('div');
    overlay.id = 'kr-img-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:99999;cursor:zoom-out;';

    const img = document.createElement('img');
    img.style.cssText = 'max-width:95vw;max-height:95vh;object-fit:contain;box-shadow:0 8px 32px rgba(0,0,0,.5);user-select:none;border-radius:8px;';
    overlay.appendChild(img);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'position:absolute;top:18px;right:24px;background:rgba(0,0,0,.4);color:#fff;border:none;font-size:32px;line-height:1;width:44px;height:44px;border-radius:50%;cursor:pointer;';
    overlay.appendChild(closeBtn);

    document.body.appendChild(overlay);

    // Cursor hint so readers know the image is clickable.
    const style = document.createElement('style');
    style.textContent = '.md-doc img:not([data-no-lightbox]),.markdown-content img:not([data-no-lightbox]),.markdown-preview img:not([data-no-lightbox]){cursor:zoom-in;}';
    document.head.appendChild(style);

    const open = (src, alt) => {
      img.src = src;
      img.alt = alt || '';
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      overlay.style.display = 'none';
      img.src = '';
      document.body.style.overflow = '';
    };

    overlay.addEventListener('click', close);
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });

    // Capture phase + stopImmediatePropagation so closing the lightbox with
    // Escape doesn't also bubble to the page's document-modal Escape handler.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display !== 'none') {
        e.stopImmediatePropagation();
        close();
      }
    }, true);

    // Event delegation: works for any <img> the parser injects, whenever the
    // HTML lands (initial render or inside the document-viewer modal).
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (t.hasAttribute('data-no-lightbox')) return;
      if (!t.closest('.md-doc, .markdown-content, .markdown-preview')) return;
      e.preventDefault();
      open(t.currentSrc || t.src, t.alt);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
