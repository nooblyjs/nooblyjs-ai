import express from 'express';
import { fileURLToPath } from 'node:url';
import { SENTENCES, pickSentence } from './lib/sentences.js';
import { DATA_FILE, addScore, readScores, summarize, validateScore } from './lib/scores.js';

/** Build the app. Tests pass their own data file so they never touch your real scores. */
export function createApp({ dataFile = DATA_FILE, sentences = SENTENCES } = {}) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));

  // A new sentence. Pass ?avoid=<the one just shown> to avoid repeats.
  app.get('/api/sentence', (req, res) => {
    const avoid = typeof req.query.avoid === 'string' ? req.query.avoid : '';
    res.json({ text: pickSentence(sentences, Math.random, avoid) });
  });

  // Saved runs (newest last) plus the progress summary.
  app.get('/api/scores', async (req, res) => {
    try {
      const scores = await readScores(dataFile);
      res.json({ scores: scores.slice(-50), summary: summarize(scores) });
    } catch {
      res.status(500).json({ error: 'Could not read your scores' });
    }
  });

  // Save a finished run.
  app.post('/api/scores', async (req, res) => {
    const { value, error } = validateScore(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const scores = await addScore(dataFile, value);
      res.status(201).json({ saved: value, summary: summarize(scores) });
    } catch {
      res.status(500).json({ error: 'Could not save your score' });
    }
  });

  return app;
}

// Only listen when run directly (`node server.js`), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`TypeTest running at http://localhost:${port}`));
}
