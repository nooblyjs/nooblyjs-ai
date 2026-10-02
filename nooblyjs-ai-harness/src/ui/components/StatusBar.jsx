import { Box, Text } from 'ink';
import { contextUsage } from '../../context/tokens.js';
import { formatCost, hasPrice } from '../../core/cost.js';
import { MODES } from '../../permissions/modes.js';
import { theme } from '../theme.js';

/**
 * Under the input: the permission mode (Phase 06) when it isn't "default",
 * then provider, model, messages, tokens and cost. `hint` replaces "/help" briefly.
 */
export function StatusBar({ session, hint }) {
  const { usage } = session;
  const mode = session.permissions.mode;
  const modeStatus = MODES[mode].status;
  const context = contextUsage(session); // Phase 08: how full the context window is
  const contextColor = context.fraction >= session.settings.compactThreshold ? theme.error : context.fraction >= 0.5 ? theme.info : theme.dim;
  return (
    <Box flexDirection="column" paddingX={1}>
      {modeStatus && (
        <Text color={mode === 'bypass' ? theme.error : mode === 'plan' ? theme.user : theme.info}>
          {modeStatus}
          <Text color={theme.dim}>{mode === 'bypass' ? ' (shift+tab to turn off)' : ' (shift+tab to cycle)'}</Text>
        </Text>
      )}
      <Box justifyContent="space-between">
        <Text color={theme.dim}>
          {session.provider.name} · {session.model} · {session.history.length} msgs ·{' '}
          <Text color={contextColor}>ctx {Math.max(0, Math.round(context.fraction * 100))}%</Text> · in {usage.input_tokens.toLocaleString()} / out{' '}
          {usage.output_tokens.toLocaleString()} · {formatCost(session.cost)}
          {hasPrice(session.model) ? '' : ' (price unknown)'}
        </Text>
        <Text color={hint ? theme.info : theme.dim}>
          {/* Phase 22: running background tasks */}
          {!hint && session.tasks?.running().length ? <Text color={theme.info}>⚙ {session.tasks.running().length} background · /tasks · </Text> : null}
          {hint ?? '/help'}
        </Text>
      </Box>
    </Box>
  );
}
