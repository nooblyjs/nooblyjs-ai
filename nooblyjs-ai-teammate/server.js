import path from 'node:path';
import { createApp } from './src/app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');

const { app } = await createApp({ dataDir });
app.listen(port, host, () => {
  console.log(`Teammates running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (data: ${dataDir})`);
});
