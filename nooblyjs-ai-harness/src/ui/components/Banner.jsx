import { Box, Text } from 'ink';
import { theme } from '../theme.js';

/** The welcome box shown once at the top of the session. */
export function Banner({ version, model, provider, cwd, mode, instructionFiles = 0, settingsFiles = [], notices = [], resumed = null }) {
  return (
    <Box borderStyle="round" borderColor={theme.brand} paddingX={1} flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={theme.brand} bold>✻ noobly</Text>
        <Text color={theme.dim}> v{version} · a learning AI harness</Text>
      </Text>
      <Text color={theme.dim}>model: {model} · provider: {provider}</Text>
      <Text color={theme.dim}>cwd: {cwd}</Text>
      <Text color={theme.dim}>Type a message and press Enter. /help for commands, Ctrl+C to quit.</Text>
      <Text color={theme.dim}>
        {instructionFiles ? `${instructionFiles} instruction file(s) loaded (/context)` : 'No NOOBLY.md yet: /init creates one'} · Shift+Tab: permission mode
      </Text>
      {settingsFiles.length > 0 && <Text color={theme.dim}>settings: {settingsFiles.join(', ')} (/config)</Text>}
      {notices.map((notice) => (
        <Text key={notice} color={theme.info}>• {notice}</Text>
      ))}
      {resumed && <Text color={theme.info}>Resumed "{resumed.title}" ({resumed.messages} messages). /clear starts a new one.</Text>}
      {mode === 'bypass' && <Text color={theme.error}>⚠ Bypass mode: tools run WITHOUT asking. Deny rules still apply.</Text>}
    </Box>
  );
}
