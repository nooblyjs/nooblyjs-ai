// Development tools, mounted only when NOOBLY_DEV_LOGIN=true (which config.js refuses in production). The dev clock
// (/dev/clock) moves "now" forward so approval targets, reminders and escalations can be tested without waiting.
// The Teams simulator (/dev/teams) is a stand-in meeting chat for the NooblyJS bot (teams/simulator.js).
import { HttpError } from '../util/errors.js';

export function devRoutes({ express, clock, events, requireSignIn, simulator = null, deliver = null }) {
  const router = express.Router();
  const view = () => ({ now: clock.iso(), realNow: new Date().toISOString(), offsetMs: clock.offsetMs, moved: clock.offsetMs !== 0 });

  router.get('/api/v1/dev/clock', requireSignIn, (req, res) => res.json(view()));

  router.post('/api/v1/dev/clock', requireSignIn, async (req, res, next) => {
    try {
      const { hours, workingDays, reset } = req.body ?? {};
      const from = clock.iso();
      if (reset === true) await clock.reset();
      else {
        try {
          await clock.advance({ hours, workingDays });
        } catch (err) {
          if (err instanceof RangeError) throw new HttpError(400, 'bad_request', err.message);
          throw err;
        }
      }
      res.locals.audit = { action: 'clock.moved', target: 'dev-clock', from, to: clock.iso() };
      // Apps that keep time-based rules (the lifecycle engine reminders) react to this straight away.
      await events.emit('clock.moved', { from, to: clock.iso(), reset: reset === true }, { actor: req.person.id });
      res.json(view());
    } catch (err) {
      next(err);
    }
  });

  if (!simulator) return router;
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  router.get('/api/v1/dev/teams', requireSignIn, wrap(async (req, res) => {
    res.json({ meetings: (await simulator.meetings()).map((m) => ({ id: m.id, title: m.title, subtitle: m.subtitle ?? '' })) });
  }));

  router.get('/api/v1/dev/teams/:id', requireSignIn, wrap(async (req, res) => {
    res.json(await simulator.view(req.params.id));
  }));

  // What the signed-in person types in the stand-in chat. It is shown, then sent to the bot as Teams would send it.
  router.post('/api/v1/dev/teams/:id/messages', requireSignIn, wrap(async (req, res) => {
    const activity = await simulator.activityFor(req.params.id, req.person, { text: req.body?.text });
    res.locals.audit = { action: 'dev.teams_message', target: req.params.id };
    await simulator.said(req.params.id, req.person, req.body.text);
    const { result } = await deliver(activity);
    res.status(201).json({ did: result.did, reason: result.reason ?? null });
  }));

  // A button on one of the bot's cards (Action.Submit): Teams sends the button's data back as the activity's value.
  router.post('/api/v1/dev/teams/:id/actions', requireSignIn, wrap(async (req, res) => {
    const value = req.body?.data && typeof req.body.data === 'object' ? req.body.data : null;
    if (!value) throw new HttpError(400, 'bad_request', 'A card action needs its data.');
    const activity = await simulator.activityFor(req.params.id, req.person, { value });
    res.locals.audit = { action: 'dev.teams_card_action', target: req.params.id, which: value.noobly ?? null };
    const { result } = await deliver(activity);
    res.status(201).json({ did: result.did, reason: result.reason ?? null });
  }));

  router.post('/api/v1/dev/teams/:id/reset', requireSignIn, wrap(async (req, res) => {
    res.locals.audit = { action: 'dev.teams_reset', target: req.params.id };
    await simulator.reset(req.params.id);
    res.json(await simulator.view(req.params.id));
  }));

  return router;
}
