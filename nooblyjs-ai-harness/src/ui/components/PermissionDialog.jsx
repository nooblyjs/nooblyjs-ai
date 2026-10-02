// Phase 06: "Allow noobly to …?" Shown when the permission gate says "ask".
//
//   ↑/↓ or 1/2/3 to choose, Enter to confirm, Esc to say no.
//   Option 3 lets you type what noobly should do instead; the model receives it.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { theme } from '../theme.js';

const MAX_PREVIEW = 10;

export function PermissionDialog({ request, onAnswer, onInterrupt }) {
  const { tool, input, suggestion } = request;
  const [selected, setSelected] = useState(0);
  const [typingReason, setTypingReason] = useState(false);
  const [reason, setReason] = useState('');

  const options = [
    { label: 'Yes', answer: { behavior: 'allow' } },
    { label: suggestion.label, answer: { behavior: 'allowAlways' } },
    { label: 'No, and tell noobly what to do instead', answer: null },
  ];

  const choose = (index) => {
    if (index === 2) return setTypingReason(true);
    onAnswer(options[index].answer);
  };

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') return onInterrupt();
    if (key.escape) return onAnswer({ behavior: 'deny' });
    if (typingReason) return; // the text box has the keyboard
    if (key.upArrow) setSelected((i) => (i + options.length - 1) % options.length);
    if (key.downArrow) setSelected((i) => (i + 1) % options.length);
    if (['1', '2', '3'].includes(ch)) choose(Number(ch) - 1);
    if (key.return) choose(selected);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1} marginBottom={1}>
      <Text bold>
        {title(tool.name)}
        {request.agent && <Text color={theme.dim}> (asked by the {request.agent} subagent)</Text>}
      </Text>
      {input?.dangerouslyDisableSandbox && (
        <Text color={theme.error}>⚠ Outside the sandbox: this command can write anywhere you can and use the network.</Text>
      )}
      <Details toolName={tool.name} input={input} summary={request.summary} />
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, i) => (
          <Text key={i} color={i === selected ? theme.brand : undefined}>
            {i === selected ? '❯ ' : '  '}
            {i + 1}. {option.label}
          </Text>
        ))}
      </Box>
      {typingReason ? (
        <Box marginTop={1}>
          <Text color={theme.brand}>What should noobly do instead? </Text>
          <TextInput value={reason} onChange={setReason} onSubmit={(text) => onAnswer({ behavior: 'deny', message: text.trim() || undefined })} />
        </Box>
      ) : (
        <Text color={theme.dim}>Esc to deny · ↑↓ or 1-3 to choose · Enter to confirm</Text>
      )}
    </Box>
  );
}

function title(toolName) {
  if (toolName === 'Bash') return 'Allow noobly to run this command?';
  if (toolName === 'Edit') return 'Allow noobly to make this edit?';
  if (toolName === 'Write') return 'Allow noobly to write this file?';
  if (toolName === 'WebFetch') return 'Allow noobly to fetch this page?';
  return `Allow noobly to use ${toolName}?`;
}

/** What exactly is being asked for: the command, or the file and the change. */
function Details({ toolName, input, summary }) {
  let lines;
  if (toolName === 'Bash') lines = input.command.split('\n').map((line) => ({ text: line }));
  else if (toolName === 'Edit') {
    lines = [
      ...input.old_string.split('\n').map((line) => ({ text: `- ${line}`, color: theme.error })),
      ...input.new_string.split('\n').map((line) => ({ text: `+ ${line}`, color: theme.tool })),
    ];
  } else if (toolName === 'MultiEdit') {
    lines = input.edits.flatMap((e) => [
      ...e.old_string.split('\n').map((line) => ({ text: `- ${line}`, color: theme.error })),
      ...e.new_string.split('\n').map((line) => ({ text: `+ ${line}`, color: theme.tool })),
    ]);
  } else if (toolName === 'ApplyPatch') {
    lines = input.patch.split('\n').map((line) => ({ text: line, color: line.startsWith('+') ? theme.tool : line.startsWith('-') ? theme.error : undefined }));
  } else if (toolName === 'Write') lines = input.content.split('\n').map((line) => ({ text: `+ ${line}`, color: theme.tool }));
  else lines = JSON.stringify(input, null, 2).split('\n').map((line) => ({ text: line }));

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2}>
      {toolName !== 'Bash' && <Text color={theme.dim}>{summary}</Text>}
      {lines.slice(0, MAX_PREVIEW).map((line, i) => (
        <Text key={i} color={line.color} wrap="truncate-end">
          {line.text}
        </Text>
      ))}
      {lines.length > MAX_PREVIEW && <Text color={theme.dim}>… {lines.length - MAX_PREVIEW} more lines</Text>}
    </Box>
  );
}
