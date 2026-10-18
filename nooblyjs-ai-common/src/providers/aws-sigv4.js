// @ts-check
// AWS Signature Version 4, with node:crypto only (no AWS SDK). Bedrock needs every request signed: a hash of a
// canonical form of the request, signed with a key derived from the secret key, the day, the region and the service.
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
import crypto from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';

/** @param {string} data */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
/** @param {crypto.BinaryLike} key @param {string} data */
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, which encodeURIComponent almost is (it leaves !'()* alone). */
export const uriEncode = (/** @type {string} */ s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** 20150830T123600Z */
export const amzDate = (/** @type {Date} */ date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * Signs a request. Returns the headers to send: the given ones plus host, x-amz-date, x-amz-security-token (with a
 * session token) and authorization.
 *
 * The URL's path must already be encoded once, as it goes on the wire. Every service but S3 encodes each path
 * segment once more in the canonical request, which is done here.
 *
 * @param {{ method: string, url: string, headers?: Record<string, string>, body?: string,
 *           region: string, service: string,
 *           credentials: { accessKeyId: string, secretAccessKey: string, sessionToken?: string },
 *           date?: Date }} request
 */
export function signRequest({ method, url, headers = {}, body = '', region, service, credentials, date = new Date() }) {
  const u = new URL(url);
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  /** @type {Record<string, string>} */
  const all = { ...lower(headers), host: u.host, 'x-amz-date': stamp };
  if (credentials.sessionToken) all['x-amz-security-token'] = credentials.sessionToken;

  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const path = u.pathname.split('/').map((segment) => uriEncode(segment)).join('/') || '/';
  const query = [...u.searchParams].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method.toUpperCase(), path, query, canonicalHeaders, signedHeaders, sha256(body)].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = [ALGORITHM, stamp, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');

  return {
    ...all,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * AWS credentials from the environment, or null: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and, for temporary
 * credentials, AWS_SESSION_TOKEN.
 * @param {Record<string, string | undefined>} env
 */
export function awsCredentials(env) {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) };
}

/** @param {Record<string, string>} headers */
function lower(headers) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}
