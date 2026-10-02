import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';

const MAX_PREVIEW_LINES = 8;

/**
 * One tool call, Claude Code style:
 *   ● Edit(src/cli.js)
 *     ⎿ −1 +2 lines
 *       - const x = 1;
 *       + const x = 2;
 * While it runs, the dot is a spinner. Errors show in red.
 */
export function ToolCall({ item }) {
  const running = item.status === 'running';
  const preview = item.preview ?? [];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={item.isError ? theme.error : theme.tool}>
          {running ? <Spinner type="dots" /> : '●'}{' '}
        </Text>
        <Text bold>{item.name}</Text>
        <Text color={theme.dim}>({item.summary})</Text>
      </Box>
      {!running && (
        <Text color={item.isError ? theme.error : theme.dim}>
          {'  ⎿ '}
          {item.display}
        </Text>
      )}
      {!running && !item.isError && preview.slice(0, MAX_PREVIEW_LINES).map((line, i) => <PreviewLine key={i} line={line} />)}
      {running && item.progress?.length > 0 && <SubagentProgress progress={item.progress} total={item.progressCount} />}
      {!running && preview.length > MAX_PREVIEW_LINES && (
        <Text color={theme.dim}>{'      '}… {preview.length - MAX_PREVIEW_LINES} more</Text>
      )}
    </Box>
  );
}

const MAX_PROGRESS_LINES = 4;

/** Phase 13: what a subagent is doing, under its Task call: the last few tool calls. */
function SubagentProgress({ progress, total }) {
  const hidden = total - Math.min(progress.length, MAX_PROGRESS_LINES);
  return (
    <Box flexDirection="column">
      {hidden > 0 && <Text color={theme.dim}>{'  ⎿ '}… {hidden} earlier tool use{hidden === 1 ? '' : 's'}</Text>}
      {progress.slice(-MAX_PROGRESS_LINES).map((line, i) => (
        <Text key={i} color={line.isError ? theme.error : theme.dim} wrap="truncate-end">
          {'  ⎿ '}
          {line.running ? '… ' : '● '}
          {line.name}({line.summary})
        </Text>
      ))}
    </Box>
  );
}

/** "- removed" in red, "+ added" in green, anything else dim. */
function PreviewLine({ line }) {
  const color = line.startsWith('- ') ? theme.error : line.startsWith('+ ') ? theme.tool : theme.dim;
  return (
    <Text color={color} wrap="truncate-end">
      {'      '}
      {line}
    </Text>
  );
}
