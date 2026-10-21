import { analyze, explainMove } from './chess.js';
self.onmessage = ({ data }) => {
  try {
    const analysis = analyze(data.state, data.difficulty, data.history);
    const explanation = analysis && explainMove(data.state, analysis.move, analysis);
    self.postMessage({ move: analysis?.move ?? null, explanation });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
