import { Box, Text } from 'ink';
import { Markdown } from '../markdown.jsx';
import { theme } from '../theme.js';

/**
 * One entry in the transcript.
 * kind: 'user' | 'assistant' | 'thinking' | 'info' | 'error' | 'divider'
 * Assistant extras: `continued` (a later paragraph of the same reply: no ● bullet),
 * `meta` (the stats line), `warn` (show the stats line in yellow, e.g. interrupted).
 */
export function Message({ item }) {
  switch (item.kind) {
    case 'user':
      return (
        <Box marginBottom={1}>
          <Text color={theme.user} bold>❯ </Text>
          <Text color={theme.user}>{item.text}</Text>
        </Box>
      );

    case 'assistant': {
      const showText = item.text || !item.continued;
      return (
        <Box flexDirection="column" marginBottom={1}>
          {showText && (
            <Box>
              <Text color={theme.brand}>{item.continued ? '  ' : '● '}</Text>
              <Box flexGrow={1}>
                {item.text ? <Markdown>{item.text}</Markdown> : <Text color={theme.dim}>(empty reply)</Text>}
              </Box>
            </Box>
          )}
          {item.meta && <Text color={item.warn ? theme.info : theme.dim}>  ⎿ {item.meta}</Text>}
        </Box>
      );
    }

    // Phase 18: a summary of the model's thinking, dim, before its answer.
    case 'thinking':
      return (
        <Box marginBottom={1} flexDirection="column">
          <Text color={theme.dim} italic>
            ✻ Thinking…
          </Text>
          <Box paddingLeft={2}>
            <Text color={theme.dim} italic>
              {item.text}
            </Text>
          </Box>
        </Box>
      );

    case 'error':
      return (
        <Box marginBottom={1}>
          <Text color={theme.error}>✗ {item.text}</Text>
        </Box>
      );

    case 'divider':
      return (
        <Box marginBottom={1}>
          <Text color={theme.dim}>──── {item.text} ────</Text>
        </Box>
      );

    default:
      return (
        <Box marginBottom={1} paddingLeft={2}>
          <Text color={theme.info}>{item.text}</Text>
        </Box>
      );
  }
}
