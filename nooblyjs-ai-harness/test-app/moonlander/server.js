import express from 'express';
import { fileURLToPath } from 'node:url';

export const app = express();
app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));

// Only listen when run directly (`node server.js`), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Moonlander ready at http://localhost:${port}`));
}
