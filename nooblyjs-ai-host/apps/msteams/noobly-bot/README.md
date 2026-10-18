# The NooblyJS Teams app

The Microsoft Teams side of NooblyJS (Phase 12): the app manifest and package, and the Microsoft 365 Agents Toolkit
setup that registers the bot and runs it locally. **The bot itself runs inside NooblyJS**, at
`POST /api/teams/messages` (`noobly/src/teams/`): Microsoft's token is checked there, and every flow lives there
(adding a teammate, answers with sources and cost, meeting notes, approval messages).

This project's server (`index.js`, port 3978) is only a **forwarder**: the toolkit's dev tunnel, F5 and the Agents
Playground all expect a bot on 3978, so it passes each activity, with its Authorization header untouched, to NooblyJS
and hands NooblyJS's answer back. Set `NOOBLY_BOT_URL` if NooblyJS is not at `https://localhost:11001/api/teams/messages`.

## Try it in the Agents Playground (no tenant, no registration)

1. In `noobly/.env` set `NOOBLY_DEV_LOGIN=true` and `TEAMS_BOT_DEV_UNSIGNED=true` (development only: NooblyJS refuses it in
   production). The Playground's mock user acts as `TEAMS_BOT_DEV_PERSON` (default `stevie`). Start NooblyJS: `npm start`.
2. Here: `npm start` (the forwarder on 3978).
3. Start the Playground: `npx @microsoft/m365agentsplayground start -e http://localhost:3978/api/messages -c msteams -p 56150`
   and open http://localhost:56150. Or press F5 in VS Code and choose **Debug in Microsoft 365 Agents Playground**.
4. The bot asks which teammate to add. Press **Add** on Ada, ask `@Ada what is blocking us?`, then
   `@NooblyJS post meeting notes to PRD-031`.

## In Teams (your tenant)

1. Open this folder in VS Code, sign in to Microsoft 365 in the Agents Toolkit, and run **Provision** for `local`
   (or press F5 → **Debug in Teams**). The toolkit registers the bot (Entra app + Bot Framework, Teams channel on),
   opens a dev tunnel to 3978, and writes `BOT_ID`, `SECRET_BOT_PASSWORD` and `TEAMS_APP_TENANT_ID` into
   `env/.env.local` and `env/.env.local.user`.
2. Give NooblyJS the same bot, in `noobly/.env`:

   | NooblyJS setting | From the toolkit |
   | --- | --- |
   | `TEAMS_BOT_APP_ID` | `BOT_ID` |
   | `TEAMS_BOT_APP_SECRET` | `SECRET_BOT_PASSWORD` |
   | `TEAMS_BOT_TENANT_ID` | leave empty for the toolkit's multi-tenant bot; your tenant id for a single-tenant one |

   and turn `TEAMS_BOT_DEV_UNSIGNED` off. Restart NooblyJS.
3. Build and upload the package: `npm run package -- --env local`, then in Teams **Apps → Manage your apps → Upload
   an app** (F5 does this for you).
4. People must have signed in to NooblyJS with Microsoft once: that is how NooblyJS knows them in Teams (their Entra id).

## Approval emails

Approvals also go out by email through Microsoft Graph (app-only). In `noobly/.env`: `MS_GRAPH_TENANT_ID`,
`MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` and `MS_GRAPH_SENDER` (the mailbox it sends from). The Graph app
needs the `Mail.Send` application permission with admin consent. Platform · Settings · Integrations shows what is set up.

## Files

| File | What |
| --- | --- |
| `appPackage/manifest.json` | The NooblyJS app manifest; `${{NAME}}` values come from `env/.env.<env>` |
| `appPackage/color.png`, `outline.png` | NooblyJS's icons (192 × 192, and 32 × 32 white on transparent) |
| `scripts/package.mjs` | `npm run package -- --env <env>`: fills the manifest, checks it as Teams does, writes `appPackage/build/appPackage.<env>.zip` |
| `index.js` | The forwarder to NooblyJS |
| `m365agents*.yml`, `env/`, `infra/` | The Agents Toolkit's provisioning and environments |
