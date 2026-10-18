// @ts-check
// Phase F15/F17: reading a request BODY, with a size cap. Too big → a 413 error and the
// connection is dropped, so a caller can't make the factory buffer an endless upload.

/**
 * The raw bytes of a request body.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ max: number }} options
 * @returns {Promise<Buffer>}
 */
export function readRaw(req, { max }) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Body too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * A JSON body (an empty body is {}). Not JSON → an error with status 400.
 * @param {import('node:http').IncomingMessage} req
 * @param {{ max?: number }} [options]
 */
export async function readJson(req, { max = 100_000 } = {}) {
  const text = (await readRaw(req, { max })).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error('The body must be JSON.'), { status: 400 });
  }
}
