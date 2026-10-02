# Phase 28: Seeing and searching

**Goal:** the model can look at a screenshot, and find a page it wasn't given.

---

## Images are just another content block (`src/tools/images.js`)

A message's content is a list of blocks (Phase 01). Text is one kind; an image is another:

```json
{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo…" } }
```

Two ways in:

| | How |
|---|---|
| **You** | type or drag an image file into your message. Most terminals paste a dragged file's path, quoted or with `\ ` for spaces; noobly finds paths ending in `.png .jpg .jpeg .gif .webp` that exist, and attaches them after your text. Trailing punctuation (`ui.jpg,`) is ignored. |
| **The model** | `Read` on an image file returns `[text "Image shot.png (84 KB):", image]` instead of refusing it as binary. |

A tool result can now be a **list of blocks**, not only a string. Two places in the loop that appended notes to results (PostToolUse hooks, background task reminders) had to learn that.

### Size and cost

- Anthropic takes up to 5 MB of base64 per image (~3.75 MB of file). Bigger: refused, with the command to make a smaller copy. (Resizing it ourselves would need an image library: our first binary dependency. Not worth it here.)
- The **token estimate** (Phase 08) counted base64 characters / 4: a 1 MB screenshot looked like 330,000 tokens and would have triggered compaction at once. An image now counts ~1,600 tokens, what the model actually pays.
- **Compaction** clears old images like old tool output: *"Old image cleared… Read it again if you need to see it."*

### Each provider its own shape

| Provider | Where images go |
|---|---|
| Anthropic | as they are: in your message, or inside the tool result |
| OpenAI Chat Completions (Grok…) | a `tool` message can only hold text, so the images **follow** in a user message as `image_url` parts with a `data:` URL |
| OpenAI Responses | the same idea, as `input_image` parts |
| Ollama, echo | marked as not seeing images: Read says so, and a pasted path becomes a note instead |

Translation at the edge (as in the multi-provider extra): the loop only knows our one format.

## WebSearch (`src/tools/web-search.js`)

WebFetch needs a URL. Search finds one. Search needs an engine, and each has its own API:

| Set up | Engine |
|---|---|
| `BRAVE_SEARCH_API_KEY` | Brave Search API |
| `TAVILY_API_KEY` | Tavily (built for AI agents) |
| `"webSearch": { "searxngUrl": "http://localhost:8888" }` | a SearXNG server you run, no key |

**No engine, no tool.** The tool is only registered when one is configured. A tool that can only fail wastes a round every time the model tries it.

Same safety as WebFetch (Phase 18):

- results are **untrusted**: framed in `<search-results>` with the untrusted-content note, and a result can't close the frame early
- it **asks** per search (`isReadOnly` + `needsPermission`): a query leaves your computer, and could carry data out
- the keys are removed from Bash's environment
- a **project's** `webSearch` setting waits for trust: a search server chosen by the repo would see your queries

## Deviations

- **No server-side search.** Anthropic offers a `web_search` tool that runs on their side; its results arrive as new block types (`server_tool_use`, `web_search_tool_result`) that the stream parser, history and translations would all need to handle, and it can't be tested without a key. The function tool works with every provider.
- **No resizing** (see above).

## What we learned

- **Multimodal = more block types**, and every place that assumed "content is a string" needs to know.
- **Estimate what you pay**, not what you send: base64 length is not image tokens.
- Translate at the edge: one internal shape, one converter per provider.
- **Don't offer a tool that can't work.**
- How Claude Code appears to do it: Read shows images, pasted/dragged images are attached, and web search uses Anthropic's server-side tool.
