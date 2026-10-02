import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';

/**
 * The bordered input box at the bottom of the screen.
 *
 * Phase 17:
 * - ↑ / ↓ go through what you sent before (`history`, oldest first).
 * - A line ending in \ continues on the next line (Enter adds a new line instead of sending).
 *   Pasted text with line breaks is kept as it is.
 */
export function PromptInput({ value, onChange, onSubmit, history = [] }) {
  const [lines, setLines] = useState([]); // finished lines of a multi-line message
  const [back, setBack] = useState(-1); // -1 = not browsing; 0 = the last thing you sent, 1 = the one before…

  const show = (entry) => {
    const parts = entry.split('\n');
    setLines(parts.slice(0, -1));
    onChange(parts.at(-1));
  };

  useInput((ch, key) => {
    if (key.upArrow && history.length) {
      const next = Math.min(back + 1, history.length - 1);
      setBack(next);
      show(history[history.length - 1 - next]);
    } else if (key.downArrow && back >= 0) {
      const next = back - 1;
      setBack(next);
      show(next >= 0 ? history[history.length - 1 - next] : '');
    }
  });

  const submit = (text) => {
    if (text.endsWith('\\')) {
      setLines([...lines, text.slice(0, -1)]);
      onChange('');
      return;
    }
    const message = [...lines, text].join('\n');
    setLines([]);
    setBack(-1);
    onSubmit(message);
  };

  return (
    <Box borderStyle="round" borderColor={theme.dim} paddingX={1} flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>
          <Text color={theme.brand} bold>{i === 0 ? '❯ ' : '  '}</Text>
          {line}
        </Text>
      ))}
      <Box>
        <Text color={theme.brand} bold>{lines.length ? '  ' : '❯ '}</Text>
        <TextInput value={value} onChange={onChange} onSubmit={submit} placeholder={lines.length ? '' : 'Ask noobly anything… (\\ + Enter for a new line)'} />
      </Box>
    </Box>
  );
}
