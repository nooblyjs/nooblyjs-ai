// /api/v1/board: the Team board. Everyone signed in reads it; posting, replying and signals need NooblyJS's `draft`
// (Contributor and up); pinning and hiding need `approve`. Resolving, promoting and acknowledging are a person's,
// which the board itself checks first (services/board.js). API keys can't reach the board.
import { requireRole, requireUser } from '../middleware/auth.js';
import { boardController } from '../controllers/board.js';

export function boardRouter({ express, board }) {
  const r = express.Router();
  r.use(requireUser);
  const post = requireRole('post');
  const manager = requireRole('manager');
  const c = boardController({ board });

  r.get('/posts', c.list);
  r.get('/now', c.now);
  r.get('/topics', c.topics);
  r.get('/suggestions', c.suggestions);
  r.get('/posts/:id', c.show);

  r.post('/posts', post, c.create);
  r.post('/posts/:id/replies', post, c.reply);
  r.put('/posts/:id/signals/:signal', post, c.signalOn);
  r.delete('/posts/:id/signals/:signal', post, c.signalOff);
  r.post('/posts/:id/answer', post, c.answer);
  r.post('/posts/:id/acknowledge', post, c.acknowledge);
  r.post('/posts/:id/resolve', post, c.resolve);
  r.post('/posts/:id/promote', post, c.promote);

  r.post('/posts/:id/pin', manager, c.pin);
  r.post('/posts/:id/hide', manager, c.hide);
  r.post('/posts/:id/replies/:replyId/hide', manager, c.hideReply);
  return r;
}
