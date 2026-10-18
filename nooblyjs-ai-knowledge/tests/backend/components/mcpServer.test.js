'use strict';

/**
 * The wiki's MCP server — the runtime counterpart to the OpenAPI spec.
 *
 * MCP is where an AI client connects and is handed a tool list; OpenAPI is a
 * document a developer reads. The failures worth pinning here are the ones that
 * are SILENT — an MCP tool that misbehaves does not throw, it just makes the
 * model answer confidently from nothing:
 *
 *   1. **Paths must survive the round trip.** The document routes are declared
 *      `:documentPath(*)`, so `/` separators have to stay literal while spaces
 *      and `#` get escaped. Encode the whole path in one call and every
 *      separator becomes `%2F`, the route stops matching, and every read 404s.
 *
 *   2. **Windowing must report itself.** A document silently cut at 40k
 *      characters looks complete to the model, which then answers from half a
 *      page. A truncated read must say so AND say where to resume.
 *
 *   3. **A PDF must fall back to its derived sidecar.** `file-content` streams a
 *      PDF as raw bytes; the text only exists in `.system/derived/<name>.pdf.md`.
 *      Without the fallback the tool hands back a Buffer, or worse, base64.
 *
 *   4. **404 and 403 must read the same.** A curated-away path answers 404 by
 *      design — a 403 would confirm the document exists, which is exactly what
 *      the curation hides. The tool must not undo that by phrasing them
 *      differently.
 *
 *   5. **Search results must be SHAPED, not forwarded.** The endpoint answers
 *      with facet axes, tags, relevance, size and ids for the filter rail. None
 *      of it changes what the model does next and all of it costs tokens on
 *      every hit.
 *
 * The tools are exercised against a stub API client rather than a live server —
 * these assert the shaping and the branch decisions, which is where the silent
 * failures live.
 */

const searchKnowledge = require('../../../src/wiki/mcp/tools/searchKnowledge');
const readDocument = require('../../../src/wiki/mcp/tools/readDocument');
const { encodePath, originFor } = require('../../../src/wiki/mcp/internalApi');
const { createKnowledgeServer, TOOLS, INSTRUCTIONS } = require('../../../src/wiki/mcp/server');

/**
 * Stub API client. `routes` maps a matcher to a canned response; every call is
 * recorded so a test can assert what the tool actually asked for.
 */
function stubApi(routes) {
  const calls = [];
  return {
    calls,
    get: async (path) => {
      calls.push(path);
      for (const [match, response] of routes) {
        if (typeof match === 'string' ? path.startsWith(match) : match.test(path)) {
          return { status: 200, contentType: 'application/json', buffer: Buffer.alloc(0), text: '', ...response };
        }
      }
      return { status: 404, contentType: 'application/json', buffer: Buffer.alloc(0), text: '', json: null };
    }
  };
}

const text = (result) => result.content.map((block) => block.text).join('\n');

describe('internalApi path handling', () => {
  test('encodes each segment but keeps the separators the route needs', () => {
    expect(encodePath('Platform/Streaming/kafka.md')).toBe('Platform/Streaming/kafka.md');
    expect(encodePath('Commercial Services/Q3 review.md')).toBe('Commercial%20Services/Q3%20review.md');
    // A whole-path encode would produce `%2F` here and the route would not match.
    expect(encodePath('a/b/c.md')).not.toContain('%2F');
  });

  test('normalises Windows separators and drops empty segments', () => {
    expect(encodePath('Platform\\Streaming\\kafka.md')).toBe('Platform/Streaming/kafka.md');
    expect(encodePath('/leading/and/trailing/')).toBe('leading/and/trailing');
  });

  test('derives the loopback origin from the socket the request arrived on', () => {
    delete process.env.WIKI_MCP_INTERNAL_ORIGIN;
    // app.js binds HTTPS on PORT and only 301-redirects from the HTTP port, so a
    // hardcoded http:// origin would silently follow a redirect in production.
    expect(originFor({ socket: { encrypted: true, localPort: 9101 } })).toBe('https://127.0.0.1:9101');
    expect(originFor({ socket: { encrypted: false, localPort: 3000 } })).toBe('http://127.0.0.1:3000');
    // Never the public hostname — that path goes back through the Entra guard.
    expect(originFor({ socket: { encrypted: true, localPort: 443 } })).toContain('127.0.0.1');
  });
});

describe('search_knowledge', () => {
  const hit = {
    id: 'abc',
    title: 'Kafka Introduction',
    path: 'Platform/Streaming/kafka.md',
    spaceId: 1,
    spaceName: 'Engineering Space',
    snippet: 'the <mark>kafka</mark> broker cluster',
    excerpt: 'static excerpt',
    type: 'markdown',
    modifiedAt: '2026-08-01T00:00:00Z',
    tags: ['streaming'],
    relevance: 0.91,
    size: 4096,
    folderL1: 'Platform',
    folderL2: 'Streaming',
    docType: 'markdown'
  };

  test('caps the result count well below the endpoint default of 200', async () => {
    const api = stubApi([['/applications/wiki/api/search', { json: [hit] }]]);
    await searchKnowledge.handler({ query: 'kafka', limit: 10 }, { api });
    expect(api.calls[0]).toContain('limit=10');
  });

  test('never asks for content — reading is read_document\'s job', async () => {
    const api = stubApi([['/applications/wiki/api/search', { json: [hit] }]]);
    await searchKnowledge.handler({ query: 'kafka', limit: 10 }, { api });
    expect(api.calls[0]).not.toContain('includeContent');
  });

  test('shapes a hit down to what the model can act on', () => {
    const shaped = searchKnowledge.shapeResult(hit);
    expect(shaped).toEqual({
      title: 'Kafka Introduction',
      spaceId: 1,
      spaceName: 'Engineering Space',
      path: 'Platform/Streaming/kafka.md',
      type: 'markdown',
      modifiedAt: '2026-08-01T00:00:00Z',
      snippet: 'the kafka broker cluster'
    });
    // The filter-rail fields must not ride along on every result.
    for (const noise of ['tags', 'relevance', 'size', 'folderL1', 'folderL2', 'docType', 'id']) {
      expect(shaped).not.toHaveProperty(noise);
    }
  });

  test('strips <mark> highlighting and truncates a long snippet', () => {
    expect(searchKnowledge.cleanSnippet('a <mark>hit</mark> here')).toBe('a hit here');
    expect(searchKnowledge.cleanSnippet('x'.repeat(900))).toHaveLength(401); // 400 + ellipsis
    expect(searchKnowledge.cleanSnippet('spaced   \n  out')).toBe('spaced out');
  });

  test('carries the spaceId and path a read needs', async () => {
    const api = stubApi([['/applications/wiki/api/search', { json: [hit] }]]);
    const out = await searchKnowledge.handler({ query: 'kafka', limit: 10 }, { api });
    expect(out.isError).toBeFalsy();
    expect(text(out)).toContain('Platform/Streaming/kafka.md');
    expect(text(out)).toContain('"spaceId": 1');
  });

  test('an empty result says so plainly rather than looking like a failure', async () => {
    const api = stubApi([['/applications/wiki/api/search', { json: [] }]]);
    const out = await searchKnowledge.handler({ query: 'nothing', limit: 10 }, { api });
    expect(out.isError).toBeFalsy();
    expect(text(out)).toMatch(/No documents matched/i);
  });

  test('401 names the fix instead of failing opaquely', async () => {
    const api = stubApi([['/applications/wiki/api/search', { status: 401, json: null }]]);
    const out = await searchKnowledge.handler({ query: 'kafka', limit: 10 }, { api });
    expect(out.isError).toBe(true);
    expect(text(out)).toMatch(/API Tokens/);
  });
});

describe('read_document', () => {
  const markdown = [
    ['/applications/wiki/api/spaces/1/file-content/', { json: { success: true, content: '# Hello\n\nBody text.', metadata: {} } }]
  ];

  test('reads a markdown document and labels it with its path', async () => {
    const api = stubApi(markdown);
    const out = await readDocument.handler({ spaceId: 1, path: 'a/b.md', offset: 0, maxChars: 40000 }, { api });
    expect(out.isError).toBeFalsy();
    expect(text(out)).toContain('Body text.');
    expect(text(out)).toContain('a/b.md');
  });

  test('404 and 403 are indistinguishable — a 403 would confirm the doc exists', async () => {
    const notFound = await readDocument.handler(
      { spaceId: 1, path: 'gone.md', offset: 0, maxChars: 40000 },
      { api: stubApi([['/applications/wiki/api/spaces/1/file-content/', { status: 404, json: null }]]) }
    );
    const forbidden = await readDocument.handler(
      { spaceId: 1, path: 'hidden.md', offset: 0, maxChars: 40000 },
      { api: stubApi([['/applications/wiki/api/spaces/1/file-content/', { status: 403, json: null }]]) }
    );
    expect(notFound.isError).toBe(true);
    expect(forbidden.isError).toBe(true);
    // Same wording either way, bar the path itself.
    expect(text(notFound).replace('gone.md', 'X')).toBe(text(forbidden).replace('hidden.md', 'X'));
  });

  describe('windowing', () => {
    test('a truncated read reports where it stopped and how to resume', () => {
      const { text: slice, truncated, notice } = readDocument.windowContent('abcdefghij', 0, 4);
      expect(slice).toBe('abcd');
      expect(truncated).toBe(true);
      expect(notice).toContain('offset=4');
      expect(notice).toContain('of 10');
    });

    test('a complete read carries no resume instruction', () => {
      const { truncated, notice } = readDocument.windowContent('short', 0, 4000);
      expect(truncated).toBe(false);
      expect(notice).toBe('');
    });

    test('a continued read is marked as the end, not as a fresh document', () => {
      const { text: slice, notice } = readDocument.windowContent('abcdefghij', 4, 100);
      expect(slice).toBe('efghij');
      expect(notice).toContain('End of document');
    });

    test('an offset past the end degrades to empty rather than throwing', () => {
      expect(readDocument.windowContent('abc', 999, 10).text).toBe('');
    });
  });

  test('a PDF falls back to its derived sidecar instead of returning bytes', async () => {
    const api = stubApi([
      ['/applications/wiki/api/spaces/1/file-content/', { status: 200, contentType: 'application/pdf', json: null }],
      ['/applications/wiki/api/spaces', { json: [{ id: 1, name: 'Engineering Space' }] }],
      ['/applications/wiki/api/documents/derived', { json: { success: true, exists: true, content: 'Extracted PDF text.' } }]
    ]);

    const out = await readDocument.handler({ spaceId: 1, path: 'reports/q3.pdf', offset: 0, maxChars: 40000 }, { api });

    expect(out.isError).toBeFalsy();
    expect(text(out)).toContain('Extracted PDF text.');
    expect(text(out)).toContain('extracted text');
    // The sidecar is addressed by the ORIGINAL's path, via space NAME.
    const derivedCall = api.calls.find((call) => call.includes('/documents/derived'));
    expect(derivedCall).toContain('spaceName=Engineering+Space');
    expect(derivedCall).toContain('q3.pdf');
  });

  test('a PDF with no sidecar yet explains why, and how to fix it', async () => {
    const api = stubApi([
      ['/applications/wiki/api/spaces/1/file-content/', { status: 200, contentType: 'application/pdf', json: null }],
      ['/applications/wiki/api/spaces', { json: [{ id: 1, name: 'Engineering Space' }] }],
      ['/applications/wiki/api/documents/derived', { json: { success: true, exists: false, content: '' } }]
    ]);
    const out = await readDocument.handler({ spaceId: 1, path: 'reports/q3.pdf', offset: 0, maxChars: 40000 }, { api });
    expect(text(out)).toMatch(/not been extracted/i);
    expect(text(out)).toMatch(/search\/rebuild/);
  });

  test('an image is refused in words, not in base64', async () => {
    const api = stubApi([
      ['/applications/wiki/api/spaces/1/file-content/', { status: 200, contentType: 'image/png', json: null, buffer: Buffer.from('PNGDATA') }]
    ]);
    const out = await readDocument.handler({ spaceId: 1, path: 'diagram.png', offset: 0, maxChars: 40000 }, { api });
    expect(text(out)).toMatch(/binary asset/i);
    expect(text(out)).not.toContain('PNGDATA');
    // It never bothered resolving a space name — there is no sidecar to find.
    expect(api.calls.some((call) => call.includes('/documents/derived'))).toBe(false);
  });

  test('an office document is served by file-content directly, with no fallback', async () => {
    const api = stubApi([
      [
        '/applications/wiki/api/spaces/1/file-content/',
        { json: { success: true, content: 'Converted docx body.', metadata: { derivedFrom: 'notes.docx' } } }
      ]
    ]);
    const out = await readDocument.handler({ spaceId: 1, path: 'notes.docx', offset: 0, maxChars: 40000 }, { api });
    expect(text(out)).toContain('Converted docx body.');
    expect(text(out)).toContain('extracted text');
    expect(api.calls).toHaveLength(1);
  });
});

describe('server assembly', () => {
  test('registers both tools with schemas an MCP client can read', async () => {
    const server = await createKnowledgeServer({ api: stubApi([]), log: { error: () => {} } });
    const listed = await server.server._requestHandlers.get('tools/list')(
      { method: 'tools/list', params: {} },
      {}
    );

    const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName).sort()).toEqual(['read_document', 'search_knowledge']);

    // The schema is what the model actually sees — if zod stops producing one,
    // every call arrives with unvalidated arguments.
    expect(byName.search_knowledge.inputSchema.required).toEqual(['query']);
    expect(byName.read_document.inputSchema.required.sort()).toEqual(['path', 'spaceId']);
    expect(byName.read_document.inputSchema.properties.spaceId.type).toBe('integer');

    // Both are reads; the annotation is what lets a host skip an approval prompt.
    for (const tool of listed.tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
    }

    await server.close();
  });

  test('a tool that throws becomes a readable error, not a protocol failure', async () => {
    const exploding = {
      get: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:9101');
      }
    };
    const errors = [];
    const server = await createKnowledgeServer({ api: exploding, log: { error: (msg) => errors.push(msg) } });

    const out = await server.server._requestHandlers.get('tools/call')(
      { method: 'tools/call', params: { name: 'search_knowledge', arguments: { query: 'x' } } },
      { signal: new AbortController().signal }
    );

    expect(out.isError).toBe(true);
    expect(text(out)).toContain('ECONNREFUSED');
    expect(errors).toHaveLength(1); // the real stack still reached the log

    await server.close();
  });

  test('the session instructions teach search-then-read', () => {
    expect(INSTRUCTIONS).toMatch(/search_knowledge first/);
    expect(INSTRUCTIONS).toMatch(/read_document/);
    // Guessing paths is the single most common way this goes wrong.
    expect(INSTRUCTIONS).toMatch(/Do not guess document paths/);
    expect(TOOLS).toHaveLength(2);
  });
});
