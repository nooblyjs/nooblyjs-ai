// /api/v1/admin: owner-only administration (app.js puts the owner check in front of this router).
import { adminController } from '../controllers/admin.js';

export function adminRouter({ express, auth, audit, repos, system, people }) {
  const r = express.Router();
  const c = adminController({ auth, audit, repos, system, people });
  r.get('/system', c.system);
  r.get('/keys', c.listKeys);
  r.post('/keys', c.createKey);
  r.delete('/keys/:id', c.revokeKey);
  r.get('/audit', c.audit);
  r.get('/users', c.users);
  return r;
}
