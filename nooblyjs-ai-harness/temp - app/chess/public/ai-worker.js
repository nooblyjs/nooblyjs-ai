import { chooseMove } from './chess.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ move: chooseMove(data.state, data.difficulty, data.history) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
