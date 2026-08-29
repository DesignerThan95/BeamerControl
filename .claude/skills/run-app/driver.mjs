// REPL driver for the Beamer Steuerung Electron app.
//
// Designed for agents: run it in tmux, send-keys commands, capture-pane the
// output. It launches the app against a FAKE projector on 127.0.0.1 — never
// against the projector in the church. See SKILL.md.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(os.tmpdir(), 'beamer-shots');
const USER_DATA = process.env.USER_DATA_DIR || path.join(os.tmpdir(), 'beamer-userdata');
const PORT = Number(process.env.FAKE_PORT || 14352);

fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_BIN = process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');

// ---------------------------------------------------------------------------
// The fake projector
// ---------------------------------------------------------------------------
// The behaviours the app has to survive:
//   answers  — a normal PJLink device, picture and sound switchable apart
//   coupled  — answers just as politely, but switches picture and sound
//              together whatever it is told. Plenty of real devices do this,
//              and they announce it nowhere.
//   silent   — accepts the connection and says nothing (standby). The app runs
//              into its 6 s timeout on every attempt.
//   resets   — throws the connection away mid-conversation. This is what used
//              to produce Electron's error dialog.
//   refuses  — nothing listening at all (instant ECONNREFUSED)
let mode = 'silent';
let connectionCount = 0;
const openSockets = new Set();

const ANSWERS = {
    POWR: '1', INPT: '31', INST: '31 11 21', CLSS: '1',
    NAME: 'Fake Beamer', INF1: 'Testhersteller', INF2: 'Modell X',
    SNUM: 'SN-4711', SVER: 'FW 1.20', FREZ: '0'
};

// Mute is the one thing this fake really remembers, because the app waits for
// it to come back changed. In "coupled" mode it behaves like the devices that
// gave rise to all this: it accepts %1AVMT 21 with an OK and then switches
// picture AND sound. Nothing in PJLink announces that — it only shows.
let avmt = '30';

function answerAVMT(param) {
    if (param === '?') return avmt;
    if (mode === 'coupled') {
        avmt = param.endsWith('1') ? '31' : '30';
    } else {
        const on = param.endsWith('1');
        const video = avmt === '31' || avmt === '11';
        const audio = avmt === '31' || avmt === '21';
        const next = { video: video, audio: audio };
        if (param[0] === '1') next.video = on;
        if (param[0] === '2') next.audio = on;
        if (param[0] === '3') next.video = next.audio = on;
        avmt = next.video && next.audio ? '31' : (next.video ? '11' : (next.audio ? '21' : '30'));
    }
    return 'OK';
}

const server = net.createServer((sock) => {
    connectionCount++;
    openSockets.add(sock);
    sock.on('close', () => openSockets.delete(sock));
    sock.on('error', () => {});

    if (mode === 'silent') return;
    if (mode === 'resets') {
        setTimeout(() => { if (!sock.destroyed) sock.resetAndDestroy(); }, 150);
        return;
    }

    sock.write('PJLINK 0\r');
    sock.on('data', (d) => {
        for (const line of d.toString().split('\r').filter(Boolean)) {
            const command = line.slice(2, 6);
            const param = line.slice(7);
            const answer = command === 'AVMT'
                ? answerAVMT(param)
                : (ANSWERS[command] ?? 'OK');

            // "swallows" carries the mute out and then says nothing about it.
            // The command took effect; the app is left to find that out for
            // itself. Queries it still answers, or nothing would work at all.
            if (mode === 'swallows' && command === 'AVMT' && param !== '?') continue;

            sock.write(line.slice(0, 2) + command + '=' + answer + '\r');
        }
    });
});

// Settings that skip the setup wizard and point at the fake projector.
// The keys have to match renderer/js/store.js — `setupCompleted`, and the
// theme lives under `appearance`.
function writeSettings(extra) {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA, 'beamer-settings.json'), JSON.stringify(Object.assign({
        version: 2,
        connection: { host: '127.0.0.1', port: PORT, password: null },
        sources: [{ code: '31', label: 'Laptop', visible: true }],
        appearance: { theme: 'light', highContrast: false },
        language: 'de',
        setupCompleted: true,
        enabledClass2Features: []
    }, extra || {}), null, 2));
}

let app = null;
let page = null;
let extraWindows = 0;
const mainOutput = [];

const COMMANDS = {
    async launch(arg) {
        if (app) return console.log('already launched');

        // "launch fresh" wipes the settings so the setup wizard runs.
        if (arg === 'fresh') {
            fs.rmSync(USER_DATA, { recursive: true, force: true });
            fs.mkdirSync(USER_DATA, { recursive: true });
        } else {
            writeSettings();
        }

        if (!server.listening) {
            await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
        }
        console.log(`fake projector on 127.0.0.1:${PORT}, mode "${mode}"`);

        app = await electron.launch({
            executablePath: ELECTRON_BIN,
            // --user-data-dir keeps the test settings out of the real profile.
            args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
            cwd: APP_DIR,
            // ELECTRON_RUN_AS_NODE would start plain node instead of the app.
            env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')),
            timeout: 60_000
        });

        app.process().stdout.on('data', (d) => mainOutput.push(d.toString()));
        app.process().stderr.on('data', (d) => mainOutput.push(d.toString()));

        // A native error dialog shows up as an extra window. Counting them is
        // how "does the app still pop up errors?" gets answered.
        app.on('window', (w) => { extraWindows++; console.log('!! extra window:', w.url()); });

        page = await app.firstWindow();
        await page.waitForSelector('.ansicht-innen', { timeout: 20_000 });
        console.log('launched.');
    },

    // Switch the projector's behaviour while the app is running.
    async beamer(what) {
        if (!['answers', 'silent', 'resets', 'coupled', 'swallows'].includes(what)) {
            return console.log('usage: beamer answers|silent|resets|coupled|swallows   (now: ' + mode + ')');
        }
        mode = what;
        console.log('projector is now:', mode);
    },

    // Connections the fake projector saw, and how many are still open. A
    // projector only has one PJLink slot — leaked sockets show up here.
    async beamerstats() {
        console.log('connections since start:', connectionCount, '| currently open:', openSockets.size);
    },

    async ss(name) {
        if (!page) return console.log('ERROR: launch first');
        const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
        await page.screenshot({ path: f });
        console.log('screenshot:', f);
    },

    // Click via the DOM, not by coordinates — see SKILL.md.
    async click(sel) {
        if (!page) return console.log('ERROR: launch first');
        console.log('click', sel, '->', await page.evaluate((s) => {
            const el = document.querySelector(s);
            if (!el) return 'NOT_FOUND';
            el.click(); return 'OK';
        }, sel));
    },

    // The UI is German and has almost no ids, so this is the usual way in.
    async 'click-text'(text) {
        if (!page) return console.log('ERROR: launch first');
        console.log('click-text', JSON.stringify(text), '->', await page.evaluate((t) => {
            const els = [...document.querySelectorAll('button, a, [role="button"]')];
            const el = els.find((e) => e.textContent?.trim() === t)
                ?? els.find((e) => e.textContent?.includes(t));
            if (!el) return 'NOT_FOUND';
            el.click(); return 'OK: ' + el.textContent.trim().slice(0, 40);
        }, text));
    },

    async text(sel) {
        if (!page) return console.log('ERROR: launch first');
        console.log(await page.evaluate(
            (s) => ((s ? document.querySelector(s) : document.body)?.innerText ?? '(null)').replace(/\n+/g, ' | '),
            sel || null));
    },

    // Waits for a piece of text to show up. Connecting takes ~28 s before the
    // app gives up, so give it room: `wait-text Kein Kontakt 60`
    async 'wait-text'(rest) {
        if (!page) return console.log('ERROR: launch first');
        const parts = rest.split(/\s+/);
        const seconds = Number(parts[parts.length - 1]);
        const wanted = Number.isFinite(seconds) ? parts.slice(0, -1).join(' ') : rest;
        const started = Date.now();
        try {
            await page.waitForFunction(
                (t) => document.body.innerText.includes(t),
                wanted,
                { timeout: (Number.isFinite(seconds) ? seconds : 30) * 1000 });
            console.log(`found after ${Math.round((Date.now() - started) / 1000)}s:`, wanted);
        } catch {
            console.log('TIMEOUT waiting for:', wanted);
        }
    },

    // The app's own activity log — the same list the gear icon shows.
    async 'app-log'() {
        if (!page) return console.log('ERROR: launch first');
        const lines = await page.evaluate(() => (window.App.log.all() || []).map((e) => e.level + ': ' + e.text));
        for (const line of lines) console.log('  ', line);
    },

    async 'projector-state'() {
        if (!page) return console.log('ERROR: launch first');
        console.log(JSON.stringify(await page.evaluate(() => window.App.ctx.projector.getState())));
    },

    // Everything the main process wrote — uncaught errors land here.
    async 'main-log'() {
        const out = mainOutput.join('').split('\n').filter((l) => l && !l.includes('CoreText'));
        console.log(out.length ? out.join('\n') : '(nothing)');
        console.log('extra windows (native dialogs):', extraWindows);
    },

    async eval(expr) {
        if (!page) return console.log('ERROR: launch first');
        try { console.log(JSON.stringify(await page.evaluate(expr))); }
        catch (e) { console.log('ERROR:', e.message); }
    },

    async type(text) { if (page) await page.keyboard.type(text, { delay: 30 }); },
    async press(key) { if (page) await page.keyboard.press(key); },

    async quit() {
        if (app) await app.close().catch(() => {});
        app = null; page = null;
        if (server.listening) server.close();
    },

    help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); }
};

// Electron steals stdin — read the raw fd instead.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

// Commands run strictly one after another. readline hands lines over as fast
// as they arrive, so without this queue a piped script would start `ss` while
// `launch` was still booting Electron.
let queue = Promise.resolve();

rl.on('line', (line) => {
    queue = queue.then(async () => {
        const [cmd, ...rest] = line.trim().split(/\s+/);
        if (!cmd) return rl.prompt();
        const fn = COMMANDS[cmd];
        if (!fn) { console.log('unknown:', cmd, '- try: help'); return rl.prompt(); }
        console.log('$', line.trim());
        try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
        if (cmd === 'quit') { rl.close(); process.exit(0); }
        rl.prompt();
    });
});
// End of input is not "stop now": with a piped script, readline reaches the
// end of the file long before the commands in it have run. Let the queue
// finish first.
rl.on('close', async () => {
    await queue.catch(() => {});
    await COMMANDS.quit();
    process.exit(0);
});

console.log('Beamer Steuerung driver - "help" for commands, "launch" to start');
rl.prompt();
