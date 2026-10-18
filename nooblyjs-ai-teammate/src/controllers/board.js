// The Team board over HTTP (.claude/specs/team-board/design.md §7). The rules, the audit and the events are the
// board's (services/board.js); a person calling here is always the actor `{ kind: 'person' }`.
const person = (req) => ({ kind: 'person', id: req.actor.id, name: req.actor.name, accessRole: req.actor.accessRole });
const viewer = (req) => `person:${req.actor.id}`;

export function boardController({ board }) {
  return {
    async list(req, res) {
      res.json(await board.list(req.query, viewer(req)));
    },
    async now(req, res) {
      res.json(await board.now());
    },
    async suggestions(req, res) {
      res.json({ posts: await board.suggestions() });
    },
    async topics(req, res) {
      res.json({ topics: await board.topics(req.query.q ?? '') });
    },
    async show(req, res) {
      res.json(await board.get(req.params.id, viewer(req)));
    },
    async create(req, res) {
      res.status(201).json(await board.post(person(req), req.body ?? {}));
    },
    async reply(req, res) {
      const { body, correctionOf, mentions } = req.body ?? {};
      res.status(201).json(await board.reply(person(req), req.params.id, { body, correctionOf, mentions }));
    },
    async signalOn(req, res) {
      res.json(await board.signal(person(req), req.params.id, req.params.signal, true));
    },
    async signalOff(req, res) {
      res.json(await board.signal(person(req), req.params.id, req.params.signal, false));
    },
    async answer(req, res) {
      res.json(await board.answer(person(req), req.params.id, req.body?.replyId));
    },
    async acknowledge(req, res) {
      res.json(await board.acknowledge(person(req), req.params.id));
    },
    async resolve(req, res) {
      res.json(await board.resolve(person(req), req.params.id, req.body?.where ?? req.body ?? {}));
    },
    async promote(req, res) {
      res.json(await board.promote(person(req), req.params.id));
    },
    async pin(req, res) {
      res.json(await board.pin(person(req), req.params.id, req.body?.pinned));
    },
    async hide(req, res) {
      res.json(await board.hide(person(req), req.params.id, { reason: req.body?.reason }));
    },
    async hideReply(req, res) {
      res.json(await board.hide(person(req), req.params.id, { reason: req.body?.reason, replyId: req.params.replyId }));
    },
  };
}
