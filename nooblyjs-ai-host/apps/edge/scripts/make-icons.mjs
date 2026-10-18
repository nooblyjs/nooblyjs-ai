// node apps/edge/scripts/make-icons.mjs (from noobly): renders icons/icon.svg (NooblyJS's mark, the same as
// nooblyjs-core/public/ui/img/favicon.svg) into the PNG sizes the extension manifest asks for, with Playwright's Chromium.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];

const svg = await fs.readFile(path.join(ICONS, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(ICONS, `icon-${size}.png`), omitBackground: true });
    console.log(`icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
