import { Box, Text } from 'ink';
import { theme } from '../theme.js';

/**
 * Phase 11: the model's todo list, shown above the input while it works.
 *   ☒ Read the loop          (done: dim, struck through)
 *   ◐ Running the tests      (in progress: bold)
 *   ☐ Update the docs
 */
export function TodoList({ todos }) {
  if (!todos?.length) return null;
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      <Text color={theme.dim}>Todos</Text>
      {todos.map((todo, i) => {
        if (todo.status === 'completed') {
          return (
            <Text key={i} color={theme.dim} strikethrough>
              ☒ {todo.content}
            </Text>
          );
        }
        if (todo.status === 'in_progress') {
          return (
            <Text key={i} bold color={theme.info}>
              ◐ {todo.activeForm ?? todo.content}
            </Text>
          );
        }
        return <Text key={i}>☐ {todo.content}</Text>;
      })}
    </Box>
  );
}
