/**
 * Avatar Cropper
 *
 * A modal dialog that lets the user position and zoom an image inside a
 * circular mask before it is uploaded as their profile picture. Drag (or
 * touch) to reposition, scroll / pinch / slider to zoom. Resolves with a
 * square PNG blob of the circled region, or null when cancelled.
 *
 * Usage:
 *   const blob = await openAvatarCropper(file);
 *   if (blob) upload(blob);
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-11
 */

const CANVAS_SIZE = 320;      // on-screen editing canvas (CSS pixels)
const CIRCLE_DIAMETER = 280;  // visible circle within the canvas
const EXPORT_SIZE = 512;      // exported square PNG side
const MAX_ZOOM = 4;           // multiplier over the minimum (cover) scale

export function openAvatarCropper(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => {
            URL.revokeObjectURL(url);
            alert('Could not read that image.');
            resolve(null);
        };
        img.onload = () => buildDialog(img, url, resolve);
        img.src = url;
    });
}

function buildDialog(img, url, resolve) {
    const overlay = document.createElement('div');
    overlay.className = 'pf-crop-overlay';
    overlay.innerHTML = `
      <div class="pf-crop-dialog" role="dialog" aria-modal="true" aria-label="Crop profile picture">
        <div class="pf-crop-head">
          <span class="ico"><i class="bi bi-crop"></i></span>
          <div>
            <h3>Position your photo</h3>
            <p>Drag to reposition — scroll, pinch or use the slider to zoom.</p>
          </div>
        </div>
        <canvas class="pf-crop-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}"></canvas>
        <div class="pf-crop-zoom">
          <i class="bi bi-dash-lg"></i>
          <input type="range" min="0" max="100" value="0" step="1" aria-label="Zoom">
          <i class="bi bi-plus-lg"></i>
        </div>
        <div class="pf-crop-actions">
          <button type="button" class="pf-btn" data-crop-cancel>Cancel</button>
          <button type="button" class="pf-btn solid" data-crop-save><i class="bi bi-check2"></i> Use photo</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.pf-crop-canvas');
    const slider = overlay.querySelector('input[type="range"]');
    const ctx = canvas.getContext('2d');

    // Render at device resolution so the preview stays crisp on hi-DPI screens.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
    canvas.style.width = `${CANVAS_SIZE}px`;
    canvas.style.height = `${CANVAS_SIZE}px`;
    ctx.scale(dpr, dpr);

    const center = CANVAS_SIZE / 2;
    const radius = CIRCLE_DIAMETER / 2;

    // The image is drawn centred at (center + ox, center + oy) at `scale`.
    // minScale is the smallest scale at which the image still covers the circle.
    const minScale = CIRCLE_DIAMETER / Math.min(img.naturalWidth, img.naturalHeight);
    let scale = minScale;
    let ox = 0;
    let oy = 0;

    const clampOffsets = () => {
        const maxOx = Math.max(0, (img.naturalWidth * scale - CIRCLE_DIAMETER) / 2);
        const maxOy = Math.max(0, (img.naturalHeight * scale - CIRCLE_DIAMETER) / 2);
        ox = Math.min(maxOx, Math.max(-maxOx, ox));
        oy = Math.min(maxOy, Math.max(-maxOy, oy));
    };

    const render = () => {
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, center + ox - w / 2, center + oy - h / 2, w, h);

        // Dim everything outside the circle, then trace the ring.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, .55)';
        ctx.fill('evenodd');
        ctx.restore();
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
        ctx.lineWidth = 2;
        ctx.stroke();
    };

    // Zoom about the circle centre: offsets grow with the image so the point
    // under the centre stays put. Slider position maps exponentially so each
    // step feels equally strong across the range.
    const setScale = (next) => {
        const clamped = Math.min(minScale * MAX_ZOOM, Math.max(minScale, next));
        const ratio = clamped / scale;
        scale = clamped;
        ox *= ratio;
        oy *= ratio;
        clampOffsets();
        slider.value = Math.round(100 * Math.log(scale / minScale) / Math.log(MAX_ZOOM));
        render();
    };

    slider.addEventListener('input', () => {
        const next = minScale * Math.pow(MAX_ZOOM, Number(slider.value) / 100);
        setScale(next);
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        setScale(scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    }, { passive: false });

    // Pointer drag, plus two-finger pinch zoom on touch screens.
    const pointers = new Map();
    let lastPinchDist = 0;

    const pinchDist = () => {
        const [a, b] = [...pointers.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) lastPinchDist = pinchDist();
        canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (e) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
            const dist = pinchDist();
            if (lastPinchDist > 0) setScale(scale * (dist / lastPinchDist));
            lastPinchDist = dist;
            return;
        }

        ox += e.clientX - prev.x;
        oy += e.clientY - prev.y;
        clampOffsets();
        render();
    });

    const releasePointer = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) lastPinchDist = 0;
        if (pointers.size === 0) canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);

    const cleanup = () => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        URL.revokeObjectURL(url);
    };

    const cancel = () => { cleanup(); resolve(null); };

    const save = () => {
        // Map the circle's bounding square back into image coordinates and
        // re-draw that region at full export resolution.
        const out = document.createElement('canvas');
        out.width = EXPORT_SIZE;
        out.height = EXPORT_SIZE;
        const srcSize = CIRCLE_DIAMETER / scale;
        const srcX = img.naturalWidth / 2 - ox / scale - srcSize / 2;
        const srcY = img.naturalHeight / 2 - oy / scale - srcSize / 2;
        out.getContext('2d').drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
        out.toBlob((blob) => {
            cleanup();
            resolve(blob); // null here means export failed — caller treats as cancel
        }, 'image/png');
    };

    const onKeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    };
    document.addEventListener('keydown', onKeydown);

    overlay.querySelector('[data-crop-cancel]').addEventListener('click', cancel);
    overlay.querySelector('[data-crop-save]').addEventListener('click', save);

    render();
    overlay.querySelector('[data-crop-save]').focus();
}
