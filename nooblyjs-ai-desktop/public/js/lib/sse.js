// EventSource is GET-only, so the message endpoint is consumed as a POST whose
// body we parse as an SSE stream ourselves.
export async function* streamSSE(url, { body, signal } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const err = new Error(payload?.error?.message || `Request failed (${res.status})`);
    err.code = payload?.error?.code;
    throw err;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        let event = 'message';
        const dataLines = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue; // heartbeat
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;

        try {
          yield { event, data: JSON.parse(dataLines.join('\n')) };
        } catch {
          // A malformed frame is not worth aborting the stream over.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
