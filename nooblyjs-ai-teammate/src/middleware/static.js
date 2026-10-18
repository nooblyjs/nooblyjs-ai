// The browser files in public/ (stylesheets, scripts, images), served under the mount path. There is no HTML page:
// the UI becomes a module (public/js/module.js) that the NooblyJS frame loads (NooblyJS roadmap, Phase 6).
import { PUBLIC_DIR } from '../config/app.js';

/** express.static defaults: max-age=0 plus ETag. */
export const serveStatic = ({ express }) => express.static(PUBLIC_DIR, { index: false, redirect: false });
