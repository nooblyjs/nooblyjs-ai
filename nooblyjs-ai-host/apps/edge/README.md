# NooblyJS for Microsoft Edge

A browser extension that puts NooblyJS beside the page you're on. The plan (`product.md` §5.11, `roadmap.md` Phase 14):
open a Jira issue, ask an NooblyJS teammate about it in the side panel, and have it draft the description, acceptance
criteria, sub-tasks or a comment. You review the draft, put it into Jira's own field yourself, and press Jira's Save.

**This is the skeleton.** It has:
- the toolbar button and the NooblyJS side panel;
- a check that NooblyJS answers (`GET /healthz`, which needs no sign-in);
- **automatic sign-in**: the panel shows who you are in NooblyJS (`GET /api/v1/shell`), using the session you already
  have there (see below);
- a reader that shows the Jira issue you have open (key, summary, type and status), read from the page.

The chat box is there but switched off until Phase 14. Nothing is sent to NooblyJS, and nothing on the Jira page is
changed.

It is plain JavaScript (Manifest V3, ES modules), with no build step and no dependencies, like the rest of NooblyJS.

## Try it in Edge

1. Start NooblyJS (`npm start` in `nooblyjs-ai-host`). If NooblyJS runs on https with a development certificate, open it once in Edge
   and accept the certificate.
2. Open `edge://extensions`, turn on **Developer mode**, choose **Load unpacked**, and pick this folder
   (`noobly/apps/edge`).
3. Click the NooblyJS button in the toolbar (pin it from the puzzle-piece menu). The side panel opens and should say
   **Connected to NooblyJS**.
4. Open a Jira issue (`https://<site>.atlassian.net/browse/DTE-123`). The panel shows its key, summary, type and status.

To point it at another NooblyJS, use **Settings** in the panel. Any address other than localhost asks for your
permission for that one site.

After changing a file, press the reload button on the extension's card in `edge://extensions` (and reload the Jira tab
for `content/jira.js`).

## How it signs you in

The extension has **no sign-in of its own**. It uses the NooblyJS session you already have in Edge, which nooblyjs-core's
authservice made when you signed in to NooblyJS (Microsoft Entra in production, the people picker in development). The
extension has host permission for NooblyJS, so Edge sends that session with the panel's requests. If you aren't signed
in, the panel offers **Sign in to NooblyJS**, which opens NooblyJS's `/login` in a tab. With Entra single sign-on in an Edge
work profile, that usually finishes without a prompt. Come back to the panel and it shows your name.

The old Knowledge Repository extension (`digital-technologies-knowledge/applications/chrome/wiki`) did it
differently: it read the browser profile's email (`chrome.identity.getProfileUserInfo`) and sent it to
`POST /api/auth/identity`, which issued a 24-hour token for that email. The server never verified the email: the
domain check ran in the extension, so anyone who could reach the server could ask for a token as anyone. **NooblyJS does
not do this**, and NooblyJS's hosted wiki does not serve that endpoint. For writes (Phase 14) the plan is a short-lived
token from your NooblyJS session, or an Entra sign-in in the extension that NooblyJS checks (`roadmap.md` Phase 14).

## Checks

From `nooblyjs-ai-host`:

```bash
npm run test:edge                          # loads the extension into Playwright's Chromium: worker, panel, sign-in, Jira reader (a fake Jira page)
node --test test/edge-extension.test.js    # the manifest, icons and permissions; the Jira reader never writes
node apps/edge/scripts/make-icons.mjs   # re-renders icons/*.png from icons/icon.svg
```

## Files

| File | What |
| --- | --- |
| `manifest.json` | Manifest V3: the side panel, the service worker, the Jira reader on `*.atlassian.net`, and access to localhost only (other NooblyJS addresses are asked for) |
| `background.js` | The service worker: the toolbar button opens the side panel |
| `sidepanel/` | The panel: NooblyJS status, the page you're on, and the chat (off until Phase 14) |
| `content/jira.js` | Reads the open Jira issue when the panel asks. It never types, clicks or saves |
| `options/` | Settings: the NooblyJS address |
| `shared.js` | The NooblyJS address, the `/healthz` check, and who is signed in (`/api/v1/shell`) |
| `styles.css` | NooblyJS's tokens and the panel's styles (light and dark) |
| `icons/` | NooblyJS's mark (`icon.svg`, as in the UI kit's favicon) at 16, 32, 48 and 128 px |
| `scripts/` | `make-icons.mjs` and the `smoke.mjs` check |

## Rules it keeps

- **Agents propose, people decide.** The extension never presses Save, Create or Transition in Jira. In Phase 14 it
  will put a draft into a field only when you press **Put in the field**, and the save is yours, under your name.
- **It talks only to NooblyJS.** It holds no Jira or Bitbucket credentials and calls no Jira API. It reads only the page
  you have open, and only when the panel asks.
- **It asks for little:** `sidePanel` and `storage`, localhost, and Jira Cloud pages. No cookies, no web requests, no
  scripting of other sites.
