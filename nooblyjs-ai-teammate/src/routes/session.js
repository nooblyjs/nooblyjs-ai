// /api/v1/session: who is signed in, and signing out (the app's own page, "document" mode).
import { requireUser } from '../middleware/auth.js';
import { sessionController } from '../controllers/session.js';

export function sessionRouter({ express, audit, repos, signOut }) {
  const r = express.Router();
  const c = sessionController({ audit, repos, signOut });
  r.get('/', c.show);
  r.delete('/', requireUser, c.signOut);
  return r;
}
