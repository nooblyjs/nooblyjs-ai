// Render Markdown in the terminal.
//
// Models write Markdown: **bold**, `code`, lists, tables, ```code blocks```.
// Printed as-is, the user sees the raw symbols. Parsing Markdown correctly is
// genuinely hard (nesting, escaping, edge cases), so we let the `marked`
// library do it: `marked.lexer(text)` turns the text into a tree of TOKENS:
//
//   "**Hi** there"  →  [{ type: 'paragraph', tokens: [
//                         { type: 'strong', tokens: [{ type: 'text', text: 'Hi' }] },
//                         { type: 'text', text: ' there' } ] }]
//
// DRAWING the tokens is the part we write ourselves, as Ink components:
//   block tokens (paragraph, heading, list, code, table…) → <Box>es stacked vertically
//   inline tokens (text, strong, em, codespan, link…)     → nested <Text> with styles
import { marked } from 'marked';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

export function Markdown({ children: text }) {
  const blocks = marked.lexer(text ?? '', { gfm: true }).filter((token) => token.type !== 'space');
  return (
    <Box flexDirection="column" rowGap={1}>
      {blocks.map((token, i) => (
        <Block key={i} token={token} />
      ))}
    </Box>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────

function Block({ token }) {
  switch (token.type) {
    case 'heading':
      return (
        <Text bold color={token.depth <= 2 ? theme.brand : undefined} underline={token.depth === 1}>
          <Inline tokens={token.tokens} />
        </Text>
      );

    case 'paragraph':
    case 'text': // loose text, e.g. inside a list item
      return (
        <Text>
          <Inline tokens={token.tokens ?? [{ type: 'text', text: token.text }]} />
        </Text>
      );

    case 'code':
      return <CodeBlock code={token.text} language={token.lang} />;

    case 'list':
      return <List token={token} />;

    case 'blockquote':
      return (
        <Box borderStyle="single" borderColor={theme.dim} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1}>
          <Box flexDirection="column" rowGap={1}>
            {token.tokens.filter((t) => t.type !== 'space').map((child, i) => (
              <Block key={i} token={child} />
            ))}
          </Box>
        </Box>
      );

    case 'table':
      return <Table token={token} />;

    case 'hr':
      return <Text color={theme.dim}>{'─'.repeat(40)}</Text>;

    default:
      // html and anything unexpected: show the raw text rather than hide it
      return <Text>{token.raw?.trimEnd() ?? ''}</Text>;
  }
}

function CodeBlock({ code, language }) {
  return (
    <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={theme.dim} paddingX={1}>
      {language && <Text color={theme.dim}>{language}</Text>}
      <Text color={theme.code}>{code}</Text>
    </Box>
  );
}

function List({ token, depth = 0 }) {
  const start = Number(token.start) || 1;
  const marker = (i) => (token.ordered ? `${start + i}.` : depth % 2 === 0 ? '•' : '◦');
  const width = token.ordered ? String(start + token.items.length - 1).length + 2 : 2;

  return (
    <Box flexDirection="column">
      {token.items.map((item, i) => (
        <Box key={i}>
          <Box width={width} flexShrink={0}>
            <Text color={theme.dim}>{item.task ? (item.checked ? '☑' : '☐') : marker(i)}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {item.tokens
              .filter((child) => child.type !== 'space' && child.type !== 'checkbox') // the ☑/☐ marker already shows it
              .map((child, j) => (child.type === 'list' ? <List key={j} token={child} depth={depth + 1} /> : <Block key={j} token={child} />))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function Table({ token }) {
  const header = token.header.map((cell) => plainText(cell.tokens));
  const rows = token.rows.map((row) => row.map((cell) => plainText(cell.tokens)));
  const widths = header.map((h, col) => Math.max(h.length, ...rows.map((row) => (row[col] ?? '').length)));

  const pad = (text, col) => {
    const space = widths[col] - text.length;
    if (token.align[col] === 'right') return ' '.repeat(space) + text;
    if (token.align[col] === 'center') return ' '.repeat(Math.floor(space / 2)) + text + ' '.repeat(Math.ceil(space / 2));
    return text + ' '.repeat(space);
  };
  const line = (left, mid, right) => left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  return (
    <Box flexDirection="column">
      <Text color={theme.dim}>{line('┌', '┬', '┐')}</Text>
      <Text>
        <Text color={theme.dim}>│</Text>
        {header.map((cell, col) => (
          <Text key={col}>
            {' '}
            <Text bold>{pad(cell, col)}</Text> <Text color={theme.dim}>│</Text>
          </Text>
        ))}
      </Text>
      <Text color={theme.dim}>{line('├', '┼', '┤')}</Text>
      {rows.map((row, r) => (
        <Text key={r}>
          <Text color={theme.dim}>│</Text>
          {header.map((_, col) => (
            <Text key={col}>
              {' '}
              {pad(row[col] ?? '', col)} <Text color={theme.dim}>│</Text>
            </Text>
          ))}
        </Text>
      ))}
      <Text color={theme.dim}>{line('└', '┴', '┘')}</Text>
    </Box>
  );
}

// ── Inline ──────────────────────────────────────────────────────────────

function Inline({ tokens = [] }) {
  return tokens.map((token, i) => <InlineToken key={i} token={token} />);
}

function InlineToken({ token }) {
  switch (token.type) {
    case 'strong':
      return (
        <Text bold>
          <Inline tokens={token.tokens} />
        </Text>
      );
    case 'em':
      return (
        <Text italic>
          <Inline tokens={token.tokens} />
        </Text>
      );
    case 'del':
      return (
        <Text strikethrough>
          <Inline tokens={token.tokens} />
        </Text>
      );
    case 'codespan':
      return <Text color={theme.code}>{token.text}</Text>;
    case 'link': {
      const label = plainText(token.tokens);
      return (
        <Text>
          <Text color={theme.user} underline>
            <Inline tokens={token.tokens} />
          </Text>
          {label !== token.href && <Text color={theme.dim}> ({token.href})</Text>}
        </Text>
      );
    }
    case 'image':
      return <Text color={theme.dim}>[image: {token.text || token.href}]</Text>;
    case 'br':
      return '\n';
    case 'text':
      return token.tokens ? <Inline tokens={token.tokens} /> : token.text;
    default: // escape, html…
      return token.text ?? token.raw ?? '';
  }
}

/** The visible text of inline tokens, without any formatting (for measuring table columns). */
export function plainText(tokens = []) {
  return tokens
    .map((token) => {
      if (token.type === 'link') return plainText(token.tokens) + (plainText(token.tokens) !== token.href ? ` (${token.href})` : '');
      if (token.tokens) return plainText(token.tokens);
      return token.type === 'br' ? ' ' : (token.text ?? '');
    })
    .join('');
}

// ── Streaming helper ────────────────────────────────────────────────────

/**
 * While a reply streams in, finished paragraphs are moved into Ink's <Static>
 * (see App.jsx). A blank line normally ends a paragraph, but NOT inside a
 * ``` code block, where cutting would break the block in two. This returns
 * where it's safe to cut (the index of the last blank line outside a code
 * block), or -1.
 */
export function safeSplitPoint(text) {
  for (let cut = text.lastIndexOf('\n\n'); cut !== -1; cut = text.lastIndexOf('\n\n', cut - 1)) {
    const fences = (text.slice(0, cut).match(/^\s*(```|~~~)/gm) ?? []).length;
    if (fences % 2 === 0) return cut;
    if (cut === 0) break;
  }
  return -1;
}
