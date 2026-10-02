// Phase 28: images. The model can look at a screenshot, a diagram, a UI mockup.
//
// An image travels as a content block, the same way text does:
//   { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0…" } }
// It can be part of YOUR message (a path you typed or dragged in), or of a tool
// result (Read on a .png). Each provider gets it in its own shape (see providers/).
import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// Anthropic accepts up to 5 MB of base64 per image, which is ~3.75 MB of file.
export const MAX_IMAGE_BYTES = 3_750_000;
// What an image costs in the context window, roughly (~1,600 tokens). Defined in nooblyjs-ai-common's tokens.js.
export { IMAGE_TOKENS } from 'nooblyjs-ai-common/tokens';

export const isImagePath = (file) => Boolean(IMAGE_TYPES[path.extname(file).toLowerCase()]);

/** An image file → a content block. Throws a message for the model if it's too big. */
export function imageBlock(file) {
  const size = fs.statSync(file).size;
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`${path.basename(file)} is ${(size / 1e6).toFixed(1)} MB; images can be at most ${MAX_IMAGE_BYTES / 1e6} MB. Make a smaller copy first (e.g. \`convert in.png -resize 50% out.png\` or, on macOS, \`sips -Z 1600 in.png --out out.png\`).`);
  }
  return { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[path.extname(file).toLowerCase()], data: fs.readFileSync(file).toString('base64') } };
}

/**
 * Image files named in a message you typed: dragging a file into most terminals
 * pastes its path, quoted or with escaped spaces. Only files that exist count.
 */
export function imagePathsIn(text, cwd) {
  const candidates = [...text.matchAll(/'([^']+)'|"([^"]+)"|((?:\\ |[^\s'"])+)/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\\ /g, ' '));
  const found = [];
  for (const raw of candidates) {
    const candidate = raw.replace(/[,;:!?)\]]+$|\.+$/, ''); // "look at ui.jpg, please" / "…in shot.png?"
    if (!isImagePath(candidate)) continue;
    const full = path.resolve(cwd, candidate.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
    if (fs.existsSync(full) && !found.includes(full)) found.push(full);
  }
  return found;
}

// The images inside a message's content (also inside tool results), and the data: URL
// form OpenAI's APIs take. The provider adapters use them, so they live in nooblyjs-ai-common.
export { dataUrl, imagesIn } from 'nooblyjs-ai-common/providers/images';
