// Phase 21: Esc Esc on an empty prompt. Pick a turn, then what to rewind.
//
//   step 1: ↑/↓ through your earlier messages (newest at the bottom), Enter to pick one
//   step 2: 1 code and conversation · 2 conversation only · 3 code only
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import path from 'node:path';
import { theme } from '../theme.js';

const CHOICES = [
  { label: 'Code and conversation', what: 'both' },
  { label: 'Conversation only (keep the files as they are)', what: 'conversation' },
  { label: 'Code only (keep the conversation)', what: 'code' },
];
const VISIBLE = 8;

export function RewindDialog({ turns, cwd, onChoose, onCancel }) {
  const [selected, setSelected] = useState(turns.length - 1);
  const [turn, setTurn] = useState(null); // step 2 once chosen
  const [choice, setChoice] = useState(0);

  useInput((ch, key) => {
    if (key.escape) return turn ? setTurn(null) : onCancel();
    const count = turn ? CHOICES.length : turns.length;
    const move = (delta) => (turn ? setChoice((i) => (i + delta + count) % count) : setSelected((i) => Math.min(count - 1, Math.max(0, i + delta))));
    if (key.upArrow) move(-1);
    if (key.downArrow) move(1);
    if (turn && ['1', '2', '3'].includes(ch)) return onChoose(turn, CHOICES[Number(ch) - 1].what);
    if (key.return) return turn ? onChoose(turn, CHOICES[choice].what) : setTurn(turns[selected]);
  });

  const rel = (file) => path.relative(cwd, file) || file;
  const start = Math.max(0, Math.min(selected - VISIBLE + 1, turns.length - VISIBLE));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1} marginBottom={1}>
      {turn ? (
        <>
          <Text bold>Rewind to before "{turn.prompt.slice(0, 60)}"</Text>
          {turn.historyLength === null && <Text color={theme.dim}>(The conversation was compacted since: only the code can go back.)</Text>}
          {CHOICES.map((c, i) => (
            <Text key={c.what} color={i === choice ? theme.brand : undefined}>
              {i === choice ? '❯ ' : '  '}
              {i + 1}. {c.label}
            </Text>
          ))}
          <Text color={theme.dim}>Enter to rewind · Esc to go back</Text>
        </>
      ) : (
        <>
          <Text bold>Rewind: go back to before which message?</Text>
          {turns.slice(start, start + VISIBLE).map((t, i) => {
            const index = start + i;
            const changes = [...t.files.map(rel), ...(t.bashFiles.length ? [`${t.bashFiles.length} by commands`] : [])];
            return (
              <Text key={t.id} color={index === selected ? theme.brand : undefined}>
                {index === selected ? '❯ ' : '  '}
                {t.prompt.replace(/\s+/g, ' ').slice(0, 60)}
                <Text color={theme.dim}>{changes.length ? `  (${changes.slice(0, 3).join(', ')}${changes.length > 3 ? '…' : ''})` : ''}</Text>
              </Text>
            );
          })}
          <Text color={theme.dim}>↑↓ to choose · Enter to pick · Esc to cancel</Text>
        </>
      )}
    </Box>
  );
}
