---
name: run-app
description: Launch and drive the Beamer Steuerung Electron app against a fake projector. Use when asked to run or start the app, take a screenshot of it, click through its screens, or check that a change works in the real app rather than only in the tests.
---

# Running the Beamer Steuerung app

Drive it through the REPL at `.claude/skills/run-app/driver.mjs`. It starts a
**fake PJLink projector on 127.0.0.1** and launches Electron against it.

## Never point this at the real projector

There is a real projector in a church on the same network. Do not connect to
it, and do not run the app's network scan — it sweeps 254 addresses per subnet
and will reach it. Everything here talks to 127.0.0.1 only. The driver's
settings file always points there; leave it that way.

## Run it

```bash
npm install     # once — needs devDependency playwright-core
```

The commands run one at a time, so a script can simply be piped in:

```bash
printf '%s\n' \
  'launch' \
  'wait-text Kein Kontakt zum Beamer 60' \
  'ss offline' \
  'beamer answers' \
  'click-text Jetzt noch einmal versuchen' \
  'wait-text Beamer läuft 40' \
  'ss running' \
  'app-log' \
  'main-log' \
  'quit' | node .claude/skills/run-app/driver.mjs
```

Interactively (this machine has no `tmux` and no GNU `timeout`, so the piped
form above is usually the one you want):

```bash
node .claude/skills/run-app/driver.mjs
```

Then **look at the screenshots** in `/tmp/beamer-shots/` (override with
`SCREENSHOT_DIR`). A blank frame means the app did not come up.

## Commands

| command | what it does |
|---|---|
| `launch` | start the fake projector and the app, wait for the first screen |
| `launch fresh` | same, but wipes the settings so the setup wizard runs |
| `beamer answers\|silent\|resets` | change how the fake projector behaves, live |
| `beamerstats` | connections the projector saw, and how many are still open |
| `ss [name]` | screenshot → `$SCREENSHOT_DIR/<name>.png` |
| `click-text <text>` | click the button containing that text (the usual way in) |
| `click <css-sel>` | click by selector |
| `text [css-sel]` | print the visible text, newlines flattened to ` \| ` |
| `wait-text <text> [seconds]` | wait for text to appear; prints how long it took |
| `app-log` | the app's own activity log (what the gear icon shows) |
| `projector-state` | the state machine's state as JSON |
| `main-log` | everything the main process wrote + count of native dialogs |
| `eval <js>` | evaluate in the page, print JSON |
| `type` / `press` | keyboard input |
| `quit` | close app and projector, exit |

### The fake projector's three behaviours

They are the three the app has to survive:

- `answers` — a normal PJLink device
- `silent` (the default) — accepts the connection and then says nothing. This
  is a projector in standby, and what an unreachable projector looks like to
  the app: every attempt runs into its 6 s timeout.
- `resets` — throws the connection away mid-conversation. This used to make
  Electron show a native error dialog; `main-log` reports whether any dialog
  appeared.

## Gotchas

- **Connecting takes ~28 s to give up.** Three attempts at a 6 s timeout with
  5 s between them, then the screen switches to "Kein Kontakt zum Beamer". Give
  `wait-text` at least 60 s, or you will time out on a working app.
- **`ELECTRON_RUN_AS_NODE` starts plain node instead of the app.** The driver
  strips it from the environment; if you launch Electron by hand, use
  `env -u ELECTRON_RUN_AS_NODE`.
- **`--user-data-dir`** keeps the test settings out of the real profile — the
  app stores `beamer-settings.json` under `app.getPath('userData')`.
- **The settings keys are easy to get wrong.** It is `setupCompleted` (not
  `setupComplete`), and the theme lives under `appearance: { theme,
  highContrast }`. Get one wrong and the app silently starts the setup wizard
  instead of the operating screen. `renderer/js/store.js` is the authority.
- **The UI is German and has almost no ids.** `click-text` with the visible
  German label is the reliable route; DOM click, not coordinates.
- **`Error occurred in handler for 'connect'` in `main-log` is normal.** That
  is Electron logging a rejected `ipcMain.handle` — the renderer catches it. An
  actual unhandled error would show as `[uncaughtException]` and, before the
  fix, as an extra window.

## The other half: unit tests

Most logic is testable without the app — the state machine, the settings store,
the PJLink wire format and the connection lifecycle all run in plain node:

```bash
npm test
```

Use those for logic. Use this driver for "does it actually work on screen".
