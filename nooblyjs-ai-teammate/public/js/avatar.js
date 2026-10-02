// Generated SVG faces (design brief §3) or uploaded images.
import { html, raw } from './html.js';

export const HAIR = {
  bob: 'M15 31 C15 18 22 12 32 12 C42 12 49 18 49 31 L49 40 L44 40 L44 26 C40 23 24 23 20 26 L20 40 L15 40 Z',
  antenna: 'M17 27 C18 18 25 14 32 14 C39 14 46 18 47 27 C40 22 24 22 17 27 Z M31 14 L31 7 L33 7 L33 14 Z M29.5 5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 Z',
  bun: 'M18 26 C19 18 25 15 32 15 C39 15 45 18 46 26 C39 21 25 21 18 26 Z M27 10 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z',
  quiff: 'M16 29 C15 18 24 12 34 13 C43 14 49 21 48 29 C42 21 30 19 22 25 C20 26 18 28 16 29 Z',
  crop: 'M17 28 C17 19 24 14 32 14 C40 14 47 19 47 28 C44 22 38 20 32 20 C26 20 20 22 17 28 Z',
};

export const PALETTE = [
  { name: 'peach', bg: '#FFD7C2', deep: '#7A2E14' },
  { name: 'mint', bg: '#CDE7E4', deep: '#1E5E63' },
  { name: 'lilac', bg: '#E5DAF5', deep: '#4B2E83' },
  { name: 'butter', bg: '#FBE6A6', deep: '#6B4E00' },
  { name: 'rose', bg: '#F6CFD8', deep: '#8A2440' },
  { name: 'sky', bg: '#D6E4FA', deep: '#1F4A8A' },
  { name: 'sage', bg: '#DCE8C8', deep: '#3D5A1E' },
  { name: 'sand', bg: '#EED9C4', deep: '#6A3F1F' },
];

const INK = '#241C1A';

function face({ bg, deep, hair }, cheeks) {
  return raw(`<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
<path d="M10 64 C12 51 21 46 32 46 C43 46 52 51 54 64 Z" fill="${deep}"/>
<circle cx="32" cy="31" r="15" fill="#FFF8F2"/>
<path d="${HAIR[hair] ?? HAIR.crop}" fill="${deep}"/>
<circle cx="27" cy="32" r="1.8" fill="${INK}"/><circle cx="37" cy="32" r="1.8" fill="${INK}"/>
${cheeks ? `<circle cx="23.5" cy="36.5" r="2.4" fill="${bg}"/><circle cx="40.5" cy="36.5" r="2.4" fill="${bg}"/>` : ''}
<path d="M27.5 37.5 Q32 41 36.5 37.5" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`);
}

const safeColor = (c, fallback) => (/^#[0-9a-fA-F]{6}$/.test(c ?? '') ? c : fallback);

/** Decorative avatar; the teammate's name should always appear next to it. */
export function avatar(config = {}, size = 40) {
  const bg = safeColor(config.bg, '#ECE6E1');
  const style = `width:${size}px;height:${size}px;background:${bg}`;
  if (config.type === 'upload' && config.url) {
    return html`<span class="avatar" style="${style}"><img src="${config.url}" alt="" loading="lazy"></span>`;
  }
  const cfg = { bg, deep: safeColor(config.deep, '#5E534D'), hair: config.hair };
  return html`<span class="avatar" style="${style}">${face(cfg, size >= 48)}</span>`;
}

export const bandColor = (config = {}) => safeColor(config.bg, '#ECE6E1');
export const deepColor = (config = {}) => safeColor(config.deep, INK);
