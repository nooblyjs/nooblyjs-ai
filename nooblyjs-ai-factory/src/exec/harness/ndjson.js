// @ts-check
// Phase F01: reading newline-delimited JSON (NDJSON / "JSON Lines") from a stream.
//
// `noobly --output-format stream-json` writes one JSON object per line. But a
// pipe delivers CHUNKS, not lines: a chunk can end in the middle of a line, or
// even in the middle of a multi-byte UTF-8 character ("é" is 2 bytes).
//
//   chunk 1: {"type":"text_delta","text":"caf\xC3
//   chunk 2: \xA9"}\n{"type":"turn_end",...
//
// So: decode with `stream: true` (keeps half a character for next time), keep
// the unfinished last line in a buffer, and only parse complete lines. It's
// the same problem the harness solved for SSE in its Phase 03.

/**
 * @param {(value: any) => void} onValue       called for each parsed line
 * @param {(line: string, error: Error) => void} [onBadLine]  a line that isn't JSON (e.g. a stray console.log)
 */
export function createNdjsonParser(onValue, onBadLine = () => {}) {
  const decoder = new TextDecoder();
  let buffer = '';

  const emit = (/** @type {string} */ line) => {
    if (!line.trim()) return;
    try {
      onValue(JSON.parse(line));
    } catch (error) {
      onBadLine(line, /** @type {Error} */ (error));
    }
  };

  return {
    /** @param {Uint8Array | string} chunk */
    push(chunk) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        emit(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    },
    /** The stream ended: whatever is left is the last line (if the writer forgot the final newline). */
    end() {
      buffer += decoder.decode();
      emit(buffer);
      buffer = '';
    },
  };
}
