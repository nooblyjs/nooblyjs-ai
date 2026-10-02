import { render } from 'ink';
import { App } from './App.jsx';

/** Mount the Ink app. Ink takes over the terminal until the app exits. */
export function startApp({ session, version }) {
  // exitOnCtrlC: false, because App handles Ctrl+C itself (interrupt first, quit on a second press).
  const app = render(<App session={session} version={version} />, { exitOnCtrlC: false });
  // Phase 14: stop the MCP servers (child processes) when the chat ends, or noobly would never exit.
  app.waitUntilExit().finally(() => session.mcp?.close());
}
