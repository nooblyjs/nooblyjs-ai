import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';

/**
 * Spinner shown while the model is working.
 * `streaming`: text has started arriving. `note`: e.g. a retry message.
 */
export function Thinking({ streaming = false, note = null }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.brand}>
          <Spinner type="dots" />
        </Text>
        <Text color={theme.dim}>
          {' '}
          {streaming ? 'Responding' : 'Thinking'}… {seconds}s · esc to interrupt
        </Text>
      </Box>
      {note && <Text color={theme.info}>  {note}</Text>}
    </Box>
  );
}
