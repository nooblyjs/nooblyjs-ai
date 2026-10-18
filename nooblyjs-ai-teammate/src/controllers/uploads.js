// Avatar images: uploaded as data URLs (PNG, JPEG and WebP only, no SVG), served back to signed-in people.
import { badRequest } from '../utils/errors.js';
import { newId } from '../utils/ids.js';

const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
const MAX_UPLOAD_BYTES = 1024 * 1024;

export function uploadsController({ store, log = console }) {
  return {
    async upload(req, res) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.dataUrl ?? '');
      if (!match) throw badRequest('Upload a PNG, JPEG or WebP image');
      const type = IMAGE_TYPES[match[1]];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('Images must be 1 MB or smaller');
      if (!type.magic.every((b, i) => buffer[i] === b)) throw badRequest('That file is not a valid image');
      const name = `${newId('img')}.${type.ext}`;
      await store.writeBuffer(['uploads', name], buffer);
      log.info?.(`[upload] ${name} (${buffer.length} bytes)`);
      res.status(201).json({ url: `/uploads/${name}` });
    },

    async serve(req, res, next) {
      try {
        res.sendFile(store.resolve(['uploads', req.params.file]), { dotfiles: 'deny' }, (err) => err && next());
      } catch {
        next();
      }
    },
  };
}
