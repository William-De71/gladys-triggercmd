# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **TRIGGERcmd**: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the TRIGGERcmd API
(<https://docs.triggercmd.com>, base `https://www.triggercmd.com/api`) with the
token of the user's account as a Bearer. `type: "device"`, Gladys 5.3.0+,
`transports: ["cloud"]`. Not affiliated with TRIGGERcmd. **Never tested with a
real account**: the endpoints come from the documentation (`command/list`,
`run/trigger`) and from the official agent, MCP server and Mission Control
client of TRIGGERcmd (`computer/list`, `computer/save`, `command/save`,
`command/delete2`, `run/save`, the Sails socket). Checked live on 2026-10-26: a
wrong token answers 401 `{"err":"Invalid Token!"}` over HTTP and over the
socket; the socket speaks Engine.IO 3 (`0{…}`, `40`, `2`/`3`, `42…`, `43<n>…`).

## Commands

```bash
npm install
npm test                                  # node --test; a fake TRIGGERcmd (in-memory fetch, fake socket), never the network
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                 SDK wiring only (new GladysIntegration + createApp)
src/app.js               every handler; the timer (the list every 15 min), devices, runs,
                         scene events, scene actions, widget, configuration buttons, status,
                         the Gladys computer set-up
src/triggercmd-api.js    HTTP client: Bearer, JSON for run/trigger, forms for the agent
                         endpoints, statuses -> kinds, one request at a time, the pause of a 429
src/computers.js         the answers made safe (computers and commands), devices and features
src/gladys-computer.js   the Gladys computer: find or create it, align its commands, and a
                         minimal socket.io 2 client over the WebSocket of Node.js
src/events.js            triggers, scene action keys and outputs
src/widgets.js           the "commands" widget and its form
src/time.js              local times (Intl only)
src/store.js             /data/triggercmd.json (mode 0600)
src/config.js            token, Gladys computer, its name and commands
src/i18n.js              helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-triggercmd.js   the fake TRIGGERcmd (HTTP and socket)
.github/scripts/release.mjs       version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:computer:<id>` (the id of the computer in TRIGGERcmd),
  features `…:cmd_<12 hex>` (a SHA-256 of the command NAME: the agent deletes
  and re-adds a command when it is edited, its id changes; it is run by name),
  feature `category` / `type` / `min` / `max`, the keys of `config_schema` and
  `actions`, widgets and settings, triggers (fields, options, variables), scene
  actions (fields, outputs). `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Category pairs**: a command without parameters is `button` / `push`
  (writable, pressing runs it); a command with parameters is `switch` / `binary`
  (on → params `on`, off → `off`, the "Off Command" of the agent). Both
  `has_feedback: false`: TRIGGERcmd never tells the state; the switch publishes
  what Gladys sent.
- **No loop**: a socket event whose `sender` is "Gladys Assistant" (the sender
  of every run of the integration) is ignored; `run_command` refuses the Gladys
  computer; the Gladys computer is never a device nor a widget option. Scene
  actions never fire a scene event (`run_failed` comes from devices and the
  widget only).
- **The Gladys computer** is opt-in. It is created once (computer/save), found
  again by its id, else by its name; a 403 means a plan with a single computer
  (state `subscription`, tried again after 6 h or a configuration change).
  Turning it off closes the socket and deletes nothing in TRIGGERcmd. Only its
  own commands are ever added or removed.
- **No runtime dependency but the SDK**: socket.io-client 2 (the protocol of the
  server) carries an unfixed advisory; the socket is a small client over the
  global WebSocket of Node.js. Keep it so.
- **The pace.** Every request goes through the client queue. The list every 15
  minutes; a manual refresh (scan, widget, scene action, unknown command) at
  most once every 10 seconds. The free plan runs one command a minute: never
  retry a run by itself.
- **The token** is a `secret`, never logged, never in /data, sent to
  triggercmd.com only. /data keeps a fingerprint of the user id of the token.
  Test tokens are made-up JWTs signed "not-a-real-signature": the push
  protection of GitHub would block anything real-looking.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted". Computer and command names come from
  TRIGGERcmd, never translated.
- **Widget images.** After any change to the widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- `run/trigger`: the documentation says `trigger` for the command name, the
  newer official clients `command`: both are sent.
- `command/list` populates `computer` (`{ id, name }`); when a record gives an
  id only, the names come from `computer/list`.
- The agent can leave the same command name twice for a moment (it adds
  before the server deletes): the first one is kept.
- The socket answer of a request is `43<n>[{ body, statusCode, headers }]`; a
  run arrives as `42["message",{ trigger, id, params, sender }]`.
- The free plan drops a second run in the same minute silently: the
  integration cannot tell; the docs say so.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
