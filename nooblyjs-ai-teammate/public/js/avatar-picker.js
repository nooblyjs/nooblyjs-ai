// Avatar picker: six generated faces plus an image upload. Shared by Hire and Edit profile.
import { api } from './api.js';
import { html } from './html.js';
import { icons } from './icons.js';
import { avatar, PALETTE } from './avatar.js';
import { toast } from './ui.js';

export const AVATAR_OPTIONS = [
  { ...PALETTE[1], hair: 'crop' },
  { ...PALETTE[0], hair: 'bun' },
  { ...PALETTE[2], hair: 'antenna' },
  { ...PALETTE[3], hair: 'quiff' },
  { ...PALETTE[5], hair: 'bob' },
  { ...PALETTE[4], hair: 'crop' },
].map(({ bg, deep, hair }) => ({ type: 'generated', bg, deep, hair }));

const same = (a, b) => a.type === b.type && a.bg === b.bg && a.deep === b.deep && a.hair === b.hair && a.url === b.url;

/** Renders into `container`; calls onChange(avatar) whenever the selection changes. */
export function mountAvatarPicker(container, { value, onChange }) {
  let current = value;
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  container.after(fileInput);

  const draw = (focusIndex) => {
    // Keep the teammate's current face selectable even if it isn't one of the six presets.
    const extra = AVATAR_OPTIONS.some((a) => same(a, current)) ? null : current;
    container.innerHTML = String(html`
      ${AVATAR_OPTIONS.map((a, i) => html`<button type="button" class="avatar-option" data-avatar="${i}" aria-pressed="${same(a, current)}" aria-label="Avatar option ${i + 1}">${avatar(a, 64)}</button>`)}
      ${extra ? html`<button type="button" class="avatar-option" aria-pressed="true" aria-label="${extra.type === 'upload' ? 'Uploaded image' : 'Current avatar'}">${avatar(extra, 64)}</button>` : ''}
      <button type="button" class="avatar-upload" data-upload aria-label="Upload an image">${icons.upload}</button>`);
    if (focusIndex != null) container.querySelector(`[data-avatar="${focusIndex}"]`)?.focus();
  };

  container.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-avatar]');
    if (opt) {
      current = AVATAR_OPTIONS[Number(opt.dataset.avatar)];
      draw(opt.dataset.avatar);
      onChange(current);
    } else if (e.target.closest('[data-upload]')) fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) return toast('Images must be 1 MB or smaller', { error: true });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const { url } = await api.post('/api/uploads', { dataUrl });
      current = { type: 'upload', url, bg: current.bg };
      draw();
      onChange(current);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  draw();
  return { get value() { return current; } };
}
