// Phase 11: "Here is my plan. Shall I go ahead?"
//
// Shown when the model calls ExitPlanMode. Approving switches the permission
// mode (so the model can start changing files); rejecting keeps plan mode and
// sends your feedback back to the model.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Markdown } from '../markdown.jsx';
import { theme } from '../theme.js';

const OPTIONS = [
  { label: 'Yes, and auto-accept edits', answer: { behavior: 'approve', mode: 'acceptEdits' } },
  { label: 'Yes, and ask before each edit', answer: { behavior: 'approve', mode: 'default' } },
  { label: 'No, keep planning (tell noobly what to change)', answer: null },
];

export function PlanDialog({ request, onAnswer, onInterrupt }) {
  const [selected, setSelected] = useState(0);
  const [typing, setTyping] = useState(false);
  const [feedback, setFeedback] = useState('');

  const choose = (index) => (OPTIONS[index].answer ? onAnswer(OPTIONS[index].answer) : setTyping(true));

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') return onInterrupt();
    if (key.escape) return onAnswer({ behavior: 'reject' });
    if (typing) return;
    if (key.upArrow) setSelected((i) => (i + OPTIONS.length - 1) % OPTIONS.length);
    if (key.downArrow) setSelected((i) => (i + 1) % OPTIONS.length);
    if (['1', '2', '3'].includes(ch)) choose(Number(ch) - 1);
    if (key.return) choose(selected);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.user} paddingX={1} marginBottom={1}>
      <Text bold color={theme.user}>
        Ready to code? Here is noobly's plan:
      </Text>
      <Box marginY={1} paddingLeft={1}>
        <Markdown>{request.plan}</Markdown>
      </Box>
      {OPTIONS.map((option, i) => (
        <Text key={i} color={i === selected ? theme.brand : undefined}>
          {i === selected ? '❯ ' : '  '}
          {i + 1}. {option.label}
        </Text>
      ))}
      {typing ? (
        <Box marginTop={1}>
          <Text color={theme.brand}>What should change? </Text>
          <TextInput value={feedback} onChange={setFeedback} onSubmit={(text) => onAnswer({ behavior: 'reject', message: text.trim() || undefined })} />
        </Box>
      ) : (
        <Text color={theme.dim}>Esc to keep planning · ↑↓ or 1-3 to choose · Enter to confirm</Text>
      )}
    </Box>
  );
}
