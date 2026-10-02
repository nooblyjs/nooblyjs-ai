# Extra: Rendering Markdown in the terminal

**The problem you spotted:** models write their answers in **Markdown**, but noobly printed them as plain text, so you saw the raw symbols:

```
**`.claude/docs/`** (11)
- 00-project-setup.md
```

**Now:** bold is bold, `code` is coloured, lists get bullets, tables get borders, code blocks get a box.

This was planned for Phase 17 ("terminal polish") and pulled forward because it makes every answer easier to read.

---

## 1. Two jobs: parsing and drawing

Turning Markdown into something on screen is two separate problems:

| Job | Difficulty | Who does it |
|---|---|---|
| **Parsing**: working out that `**x**` is bold, which lines belong to a list, where a code block ends, how `` `a**b` `` differs from `**a`b**`… | Genuinely hard: dozens of edge cases, a whole spec (CommonMark + GitHub's extensions) | The **`marked`** library |
| **Drawing**: turning "this is bold" into bold text in a terminal | Easy once parsed | **Us**, in `src/ui/markdown.jsx` |

This is a good rule for any project: **use a library for the hard, well-defined part; write the part that's specific to you.** `marked` is small, fast, has no dependencies of its own, and is used by millions of projects.

## 2. What the parser gives us: tokens

```js
marked.lexer('**Hi** there\n\n- one\n- two')
```

```js
[
  { type: 'paragraph', tokens: [
      { type: 'strong', tokens: [{ type: 'text', text: 'Hi' }] },
      { type: 'text', text: ' there' },
  ]},
  { type: 'space' },
  { type: 'list', ordered: false, items: [
      { type: 'list_item', tokens: [{ type: 'text', text: 'one' }] },
      { type: 'list_item', tokens: [{ type: 'text', text: 'two' }] },
  ]},
]
```

That's a **token tree**. There are two kinds of token:

- **Block tokens** stack vertically: `paragraph`, `heading`, `list`, `code`, `table`, `blockquote`, `hr`.
- **Inline tokens** sit inside a line: `text`, `strong`, `em`, `codespan`, `link`, `del`.

## 3. Drawing tokens as Ink components

Each token type maps to a small component:

| Token | Drawn as |
|---|---|
| `strong` / `em` / `del` | `<Text bold>` / `<Text italic>` / `<Text strikethrough>` |
| `codespan` | `<Text color="magentaBright">` |
| `link` | underlined text + dim `(url)` (terminals can't click normal text) |
| `heading` | bold (and coloured / underlined for `#` and `##`) |
| `list` | a marker column (`•`, `◦` when nested, `1.`, `☑`/`☐`) + the item's content |
| `code` | a rounded box with the language name on top |
| `table` | box-drawing characters `┌─┬─┐`, columns sized to the widest cell, honouring `:--:` / `--:` alignment |
| `blockquote` | a left border line |
| `hr` | a dim line `────` |

Inline tokens can **nest**: `**bold with `code` inside**` is a `strong` token containing a `codespan` token. So the `<Inline>` component calls itself for the children. That's *recursion*, and it's how nearly every tree gets drawn.

Tables need the **visible** width of each cell, not the raw text (`**done**` is 8 characters but shows as 4). `plainText()` walks the tokens and collects just the visible text.

## 4. Streaming made it trickier

Since Phase 03, replies stream in, and each **finished paragraph** (text up to a blank line) is moved into Ink's `<Static>` area so the live area stays small.

But a blank line inside a code block **isn't** the end of a paragraph:

````
```js
const a = 1;
                   ← cutting here would split the code block in two:
const b = 2;          the first half shown as an unfinished block,
```                   the second half as plain text ending in ```
````

`safeSplitPoint()` fixes it. It looks for the last blank line where the number of ```` ``` ```` fences before it is **even**, meaning we're not inside a code block. An odd count means a block is still open, so it keeps looking further back. The tests in `test/markdown.test.jsx` cover the cases.

While a paragraph is still arriving it's rendered live too. An unfinished `**bol` might show its asterisks for a moment, until the closing `**` arrives. Claude Code has the same brief effect.

## 5. Where it's used, and where it isn't

| Place | Markdown rendered? | Why |
|---|---|---|
| Assistant replies in the chat | ✅ | That's the point |
| Your own messages | ❌ | You typed plain text; `*` shouldn't vanish |
| Slash command output (`/context`, `/permissions`…) | ❌ | Already formatted for the terminal |
| Print mode `noobly -p "…"` | ❌ **on purpose** | Output is often piped into a file or another program, which wants the real Markdown |

## 6. Try it

```bash
noobly --echo
❯ markdown        # the echo provider replies with a sample of everything above
```

With a real model, ask for something list- or table-shaped:

```
❯ Compare Read, Edit and Bash in a table: read-only?, phase, one-line purpose
❯ Show me a JavaScript example of an async generator with a short explanation
```

## 7. Files

| File | What |
|---|---|
| `src/ui/markdown.jsx` | **New.** `<Markdown>`, block and inline renderers, `plainText()`, `safeSplitPoint()` |
| `src/ui/components/Message.jsx` | Assistant text goes through `<Markdown>` |
| `src/ui/App.jsx` | Paragraph flushing uses `safeSplitPoint()` |
| `src/ui/theme.js` | New `code` colour |
| `src/providers/echo.js` | `markdown` demo command |
| `test/markdown.test.jsx` | Rendering and splitting tests |
| `package.json` | New dependency: `marked` |

## What we learned

- **Parsing vs rendering:** use a library for the hard, standard part; write the part that's yours.
- Parsers produce **token trees**; drawing a tree is naturally **recursive**.
- Terminal layout needs **visible** widths, not raw string lengths.
- **Streaming changes the problem:** you have to know when a chunk is safe to finalise (never inside a code block).
- Different outputs want different things: **rendered for humans, raw for pipes.**
