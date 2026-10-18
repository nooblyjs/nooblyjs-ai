// @ts-check
// The AWS event-stream format: how Bedrock streams a reply. Binary frames, not SSE:
//
//   total length (4 bytes, big-endian) · headers length (4) · prelude CRC32 (4)
//   headers · payload · message CRC32 (4)
//
// Each header is: name length (1), name, value type (1), value. Bedrock's headers are strings (type 7: a 2-byte
// length, then the text). As with SSE, the network hands over chunks of any size, so bytes are buffered until a
// whole frame is there. Both CRCs are checked: a damaged frame is an error, never half a reply.
// https://docs.aws.amazon.com/transcribe/latest/dg/event-stream.html
import { crc32 } from 'node:zlib';

const PRELUDE = 12;

export class EventStreamError extends Error {}

/**
 * Turns a stream of bytes into frames: { headers: Record<string, string | number | boolean>, payload: Uint8Array }.
 * @param {AsyncIterable<Uint8Array>} byteStream
 */
export async function* parseEventStream(byteStream) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of byteStream) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
    while (buffer.length >= PRELUDE) {
      const total = buffer.readUInt32BE(0);
      if (total < PRELUDE + 4) throw new EventStreamError(`Invalid event-stream frame length ${total}`);
      if (buffer.length < total) break;
      yield decodeFrame(buffer.subarray(0, total));
      buffer = buffer.subarray(total);
    }
  }
  if (buffer.length) throw new EventStreamError('The event stream ended in the middle of a frame');
}

/**
 * One whole frame. Exported for tests.
 * @param {Buffer} frame
 */
export function decodeFrame(frame) {
  const total = frame.readUInt32BE(0);
  const headersLength = frame.readUInt32BE(4);
  if (crc32(frame.subarray(0, 8)) !== frame.readUInt32BE(8)) throw new EventStreamError('Event-stream prelude checksum mismatch');
  if (crc32(frame.subarray(0, total - 4)) !== frame.readUInt32BE(total - 4)) throw new EventStreamError('Event-stream message checksum mismatch');
  const headers = readHeaders(frame.subarray(PRELUDE, PRELUDE + headersLength));
  return { headers, payload: frame.subarray(PRELUDE + headersLength, total - 4) };
}

/** @param {Buffer} bytes */
function readHeaders(bytes) {
  /** @type {Record<string, any>} */
  const headers = {};
  let i = 0;
  while (i < bytes.length) {
    const nameLength = bytes.readUInt8(i);
    const name = bytes.subarray(i + 1, i + 1 + nameLength).toString('utf8');
    i += 1 + nameLength;
    const type = bytes.readUInt8(i++);
    switch (type) {
      case 0: headers[name] = true; break;
      case 1: headers[name] = false; break;
      case 2: headers[name] = bytes.readInt8(i); i += 1; break;
      case 3: headers[name] = bytes.readInt16BE(i); i += 2; break;
      case 4: headers[name] = bytes.readInt32BE(i); i += 4; break;
      case 5: case 8: headers[name] = Number(bytes.readBigInt64BE(i)); i += 8; break;
      case 6: case 7: {
        const length = bytes.readUInt16BE(i);
        const value = bytes.subarray(i + 2, i + 2 + length);
        headers[name] = type === 7 ? value.toString('utf8') : value;
        i += 2 + length;
        break;
      }
      case 9: headers[name] = bytes.subarray(i, i + 16).toString('hex'); i += 16; break;
      default: throw new EventStreamError(`Unknown event-stream header type ${type}`);
    }
  }
  return headers;
}

/**
 * Builds a frame with string headers. For tests and fakes: the inverse of decodeFrame.
 * @param {Record<string, string>} headers
 * @param {Uint8Array | string} payload
 */
export function encodeFrame(headers, payload) {
  const parts = Object.entries(headers).map(([name, value]) => {
    const n = Buffer.from(name, 'utf8');
    const v = Buffer.from(String(value), 'utf8');
    const h = Buffer.alloc(1 + n.length + 1 + 2 + v.length);
    h.writeUInt8(n.length, 0);
    n.copy(h, 1);
    h.writeUInt8(7, 1 + n.length);
    h.writeUInt16BE(v.length, 2 + n.length);
    v.copy(h, 4 + n.length);
    return h;
  });
  const headerBytes = Buffer.concat(parts);
  const body = Buffer.from(payload);
  const total = PRELUDE + headerBytes.length + body.length + 4;
  const frame = Buffer.alloc(total);
  frame.writeUInt32BE(total, 0);
  frame.writeUInt32BE(headerBytes.length, 4);
  frame.writeUInt32BE(crc32(frame.subarray(0, 8)), 8);
  headerBytes.copy(frame, PRELUDE);
  body.copy(frame, PRELUDE + headerBytes.length);
  frame.writeUInt32BE(crc32(frame.subarray(0, total - 4)), total - 4);
  return frame;
}
