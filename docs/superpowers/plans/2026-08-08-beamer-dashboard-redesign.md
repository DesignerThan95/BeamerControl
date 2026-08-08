# Beamer-Steuerung: Neugestaltung der Oberfläche — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Electron-App bekommt eine Oberfläche, die von ungeschulten Personen bedient werden kann — Bedien-Bildschirm ohne jede Technik, Technik-Seite hinter dem Zahnrad, Einrichtungsassistent beim ersten Start.

**Architecture:** `dashboard.html` (743 Zeilen, alles in einer Datei) wird durch einen `renderer/`-Ordner mit getrennten Zuständigkeiten ersetzt. Die Netzwerklogik sitzt in einer DOM-freien Zustandsmaschine (`beamer.js`), die Persistenz in `store.js`; beide werden mit Nodes eingebautem Test-Runner getestet. Die Views lesen Zustand und schreiben DOM, sonst nichts.

**Tech Stack:** Electron 27, reines JavaScript ohne Bundler, CSS-Variablen für die Themes, `node:test` für Tests. Keine neuen Abhängigkeiten.

## Global Constraints

- Keine neuen npm-Abhängigkeiten. `package.json` bekommt nur ein `test`-Skript.
- Keine ES-Module im Renderer: Electron lädt über `file://`, dort scheitert `<script type="module">`. Alle Renderer-Dateien sind klassische Skripte und hängen sich an den globalen Namensraum `App`.
- `store.js` und `beamer.js` müssen zusätzlich in Node ladbar sein (für die Tests). Beide nutzen dafür das UMD-Muster aus Task 1.
- Alle Texte der Oberfläche sind auf Deutsch, in Sie-freier Alltagssprache ohne Fachbegriffe. Auf dem Bedien-Bildschirm erscheint niemals ein technischer Fehlertext.
- Einstellungsdatei: `version: 2`. Alles andere wird ignoriert, es findet **keine** Migration alter Dateien statt.
- Farben ausschließlich über die Variablen aus `renderer/css/tokens.css`. Keine festen Farbwerte in `app.css` oder im JavaScript.
- Rot ist ausschließlich dem Ausschalten vorbehalten.
- Commit-Nachrichten auf Deutsch, im Imperativ.

## Datenformate der vorhandenen PJLink-Hülle

Diese Formate sind aus `lib/command.js` verifiziert und gelten für alle Tasks:

- `getPowerState()` → `{ state: 0|1|2|3, description: 'Aus'|'Ein'|'Wird abgekühlt'|'Wird aufgewärmt' }` (aufbereitet in `main.js`)
- `getCurrentInput()` → `{ source: 3, channel: 1, code: '31', name: 'DIGITAL - 1' }`
- `getAvailableInputs()` → `{ inputs: [ { source, channel, code, name }, … ] }`
- `getMuteState()` → `{ video: bool, audio: bool }`
- Die Quellen-Kennung ist immer zweistellig: erste Ziffer Art (1 RGB, 2 Video, 3 Digital, 4 Speicher, 5 Netzwerk), zweite Ziffer Kanal.

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `renderer/index.html` | Grundgerüst, Kopfzeile, drei leere Bereiche, Skript-Einbindung |
| `renderer/css/tokens.css` | Farb-, Abstands- und Schriftgrößenvariablen für hell, dunkel, hoher Kontrast |
| `renderer/css/app.css` | Bausteine: Kopfzeile, Kacheln, Chips, Schalter, Dialog, Assistent |
| `renderer/js/api.js` | dünne Hülle um `window.pjlinkAPI`, einziger Ort mit IPC-Wissen |
| `renderer/js/store.js` | Einstellungen prüfen, laden, speichern (DOM-frei, testbar) |
| `renderer/js/beamer.js` | Zustandsmaschine und Abfrage-Schleife (DOM-frei, testbar) |
| `renderer/js/theme.js` | hell/dunkel/System und hoher Kontrast |
| `renderer/js/ui.js` | winzige DOM-Helfer (`el`, `clear`) und der Bestätigungsdialog |
| `renderer/js/view-operate.js` | Bedien-Bildschirm |
| `renderer/js/view-tech.js` | Technik-Seite |
| `renderer/js/view-setup.js` | Einrichtungsassistent |
| `renderer/js/app.js` | verdrahtet Store, Beamer, Theme und Views |
| `test/store.test.js` | Tests für `store.js` |
| `test/beamer.test.js` | Tests für `beamer.js` |
| `main.js` | + Suchlauf-Fortschritt, + Betriebssystem-Farbschema, + Video/Ton getrennt schalten, lädt `renderer/index.html` |
| `preload.js` | + die drei neuen Kanäle |
| `lib/pjlink.js` | + `setMuteRaw` für unabhängige Video-/Ton-Stummschaltung |
| `dashboard.html` | wird gelöscht |

---

### Task 1: Testgerüst und `store.js`

**Files:**
- Create: `renderer/js/store.js`
- Create: `test/store.test.js`
- Modify: `package.json` (Abschnitt `scripts`)

**Interfaces:**
- Consumes: nichts
- Produces: `App.store.createStore(io)` → `{ load(), save(settings), get(), isSetupComplete(), setConnection(c), setSources(list), setAppearance(a), markSetupComplete() }`. `io` ist `{ load(): Promise<any|null>, save(obj): Promise<void> }`. `App.store.DEFAULTS`, `App.store.normalize(raw)`.

- [ ] **Step 1: `package.json` um das Test-Skript erweitern**

In `scripts` ergänzen:

```json
"test": "node --test test/"
```

- [ ] **Step 2: Die fehlschlagenden Tests schreiben**

`test/store.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createStore, normalize, DEFAULTS } = require('../renderer/js/store.js');

function fakeIo(initial) {
    let stored = initial;
    return {
        load: async () => stored,
        save: async (obj) => { stored = JSON.parse(JSON.stringify(obj)); },
        peek: () => stored
    };
}

test('fehlende Datei führt zur Einrichtung', async () => {
    const store = createStore(fakeIo(null));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
    assert.strictEqual(store.get().connection.port, 4352);
});

test('Datei ohne version 2 wird ignoriert', async () => {
    const alt = { host: '192.168.1.50', port: 4352, password: null, lastInputCode: '31' };
    const store = createStore(fakeIo(alt));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
    assert.strictEqual(store.get().connection.host, '');
});

test('unlesbare Datei führt zur Einrichtung', async () => {
    const io = { load: async () => { throw new Error('kaputt'); }, save: async () => {} };
    const store = createStore(io);
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
});

test('gültige Datei wird gelesen', async () => {
    const gueltig = {
        version: 2,
        connection: { host: '192.168.1.100', port: 4352, password: null },
        sources: [{ code: '31', label: 'Laptop', visible: true }],
        appearance: { theme: 'dark', highContrast: false },
        setupCompleted: true
    };
    const store = createStore(fakeIo(gueltig));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), true);
    assert.strictEqual(store.get().connection.host, '192.168.1.100');
    assert.strictEqual(store.get().sources[0].label, 'Laptop');
    assert.strictEqual(store.get().appearance.theme, 'dark');
});

test('Speichern und Lesen ergeben denselben Inhalt', async () => {
    const io = fakeIo(null);
    const store = createStore(io);
    await store.load();
    store.setConnection({ host: '10.0.0.5', port: 4352, password: 'geheim' });
    store.setSources([{ code: '32', label: 'Kanzel', visible: true }]);
    store.markSetupComplete();
    await store.save();

    const zweiter = createStore({ load: async () => io.peek(), save: async () => {} });
    await zweiter.load();
    assert.strictEqual(zweiter.get().connection.host, '10.0.0.5');
    assert.strictEqual(zweiter.get().sources[0].label, 'Kanzel');
    assert.strictEqual(zweiter.isSetupComplete(), true);
});

test('normalize ergänzt fehlende Felder und wirft Unbekanntes weg', () => {
    const roh = { version: 2, connection: { host: '1.2.3.4' }, sonstwas: 42 };
    const n = normalize(roh);
    assert.strictEqual(n.connection.host, '1.2.3.4');
    assert.strictEqual(n.connection.port, 4352);
    assert.deepStrictEqual(n.sources, []);
    assert.strictEqual(n.appearance.theme, 'system');
    assert.strictEqual(n.sonstwas, undefined);
});

test('unbekannter theme-Wert fällt auf system zurück', () => {
    const n = normalize({ version: 2, appearance: { theme: 'lila' } });
    assert.strictEqual(n.appearance.theme, 'system');
});

test('DEFAULTS werden nicht von normalize verändert', () => {
    normalize({ version: 2, connection: { host: 'x' } });
    assert.strictEqual(DEFAULTS.connection.host, '');
});
```

- [ ] **Step 3: Tests laufen lassen und Scheitern bestätigen**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/store.js'`

- [ ] **Step 4: `renderer/js/store.js` schreiben**

```js
// Einstellungen der Anwendung: prüfen, laden, im Speicher halten, schreiben.
// Kennt weder DOM noch Beamer. Läuft im Renderer und in Node (für die Tests).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.App = root.App || {};
        root.App.store = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const SCHEMA_VERSION = 2;
    const THEMES = ['system', 'light', 'dark'];

    const DEFAULTS = {
        version: SCHEMA_VERSION,
        connection: { host: '', port: 4352, password: null },
        sources: [],
        appearance: { theme: 'system', highContrast: false },
        setupCompleted: false
    };

    function copyDefaults() {
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    // Baut aus beliebigem Eingang ein vollständiges, gültiges Einstellungsobjekt.
    function normalize(raw) {
        const out = copyDefaults();
        if (!raw || typeof raw !== 'object') return out;

        const c = raw.connection;
        if (c && typeof c === 'object') {
            if (typeof c.host === 'string') out.connection.host = c.host;
            if (Number.isInteger(c.port) && c.port > 0) out.connection.port = c.port;
            out.connection.password = typeof c.password === 'string' && c.password ? c.password : null;
        }

        if (Array.isArray(raw.sources)) {
            out.sources = raw.sources
                .filter((s) => s && typeof s.code === 'string' && s.code.length === 2)
                .map((s) => ({
                    code: s.code,
                    label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : s.code,
                    visible: s.visible !== false
                }));
        }

        const a = raw.appearance;
        if (a && typeof a === 'object') {
            if (THEMES.indexOf(a.theme) !== -1) out.appearance.theme = a.theme;
            out.appearance.highContrast = a.highContrast === true;
        }

        out.setupCompleted = raw.setupCompleted === true;
        return out;
    }

    // Nur Dateien mit passender Version gelten. Alles andere heißt: neu einrichten.
    function isUsable(raw) {
        return !!raw && typeof raw === 'object' && raw.version === SCHEMA_VERSION;
    }

    function createStore(io) {
        let settings = copyDefaults();

        return {
            async load() {
                let raw = null;
                try {
                    raw = await io.load();
                } catch (e) {
                    raw = null;
                }
                settings = isUsable(raw) ? normalize(raw) : copyDefaults();
                return settings;
            },

            async save() {
                await io.save(JSON.parse(JSON.stringify(settings)));
            },

            get() {
                return settings;
            },

            isSetupComplete() {
                return settings.setupCompleted === true && !!settings.connection.host;
            },

            setConnection(connection) {
                settings.connection = normalize({ version: SCHEMA_VERSION, connection }).connection;
            },

            setSources(list) {
                settings.sources = normalize({ version: SCHEMA_VERSION, sources: list }).sources;
            },

            setAppearance(appearance) {
                settings.appearance = normalize({ version: SCHEMA_VERSION, appearance }).appearance;
            },

            markSetupComplete() {
                settings.setupCompleted = true;
            }
        };
    }

    return { createStore, normalize, DEFAULTS, SCHEMA_VERSION };
});
```

- [ ] **Step 5: Tests laufen lassen und Erfolg bestätigen**

Run: `npm test`
Expected: PASS, 8 Tests

- [ ] **Step 6: Commit**

```bash
git add package.json renderer/js/store.js test/store.test.js
git commit -m "Füge Einstellungsspeicher mit Schema Version 2 hinzu"
```

---

### Task 2: Zustandsmaschine `beamer.js`

**Files:**
- Create: `renderer/js/beamer.js`
- Create: `test/beamer.test.js`

**Interfaces:**
- Consumes: nichts aus Task 1
- Produces: `App.beamer.createBeamer({ api, schedule, cancel, now })` → `{ start(), stop(), getState(), onChange(fn), powerOn(), powerOff(), selectSource(code), setMute({video,audio}), refreshNow() }`.
  `api` muss bieten: `connect(cfg)`, `getPowerState()`, `getCurrentInput()`, `getMuteState()`, `powerOn()`, `powerOff()`, `setInput(code)`, `setMute({video,audio})`.
  Zustand: `{ link: 'connecting'|'online'|'offline', power: 'unknown'|'off'|'warming'|'on'|'cooling', sourceCode: string|null, sourceName: string|null, mute: {video,audio}, pending: null|{kind,startedAt}, pendingTimedOut: bool }`.
  Konstanten: `App.beamer.POLL_MS = 5000`, `App.beamer.COMMAND_TIMEOUT_MS = 30000`, `App.beamer.BACKOFF_MS = [5000, 10000, 20000, 30000]`.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

`test/beamer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { createBeamer, POLL_MS, COMMAND_TIMEOUT_MS } = require('../renderer/js/beamer.js');

// Sehr einfache Uhr: Aufgaben werden nach Fälligkeit sortiert abgearbeitet.
function fakeClock() {
    let zeit = 0;
    let naechsteId = 1;
    const aufgaben = new Map();

    return {
        now: () => zeit,
        schedule: (fn, ms) => {
            const id = naechsteId++;
            aufgaben.set(id, { fn, faellig: zeit + ms });
            return id;
        },
        cancel: (id) => { aufgaben.delete(id); },
        // Läuft bis `ms` weiter und führt alles aus, was fällig wird.
        async advance(ms) {
            const ziel = zeit + ms;
            let schutz = 0;
            for (;;) {
                let naechste = null;
                for (const [id, a] of aufgaben) {
                    if (a.faellig <= ziel && (!naechste || a.faellig < naechste.a.faellig)) {
                        naechste = { id, a };
                    }
                }
                if (!naechste) break;
                if (++schutz > 500) throw new Error('Endlosschleife in der Testuhr');
                zeit = naechste.a.faellig;
                aufgaben.delete(naechste.id);
                await naechste.a.fn();
                await Promise.resolve();
            }
            zeit = ziel;
        }
    };
}

function fakeApi(anfang) {
    return {
        zustand: Object.assign({ power: 0, input: { code: '31', name: 'DIGITAL - 1' }, mute: { video: false, audio: false } }, anfang || {}),
        fehler: false,
        rufe: [],
        async connect() { if (this.fehler) throw new Error('offline'); return { success: true }; },
        async getPowerState() {
            if (this.fehler) throw new Error('Zeitüberschreitung');
            const texte = { 0: 'Aus', 1: 'Ein', 2: 'Wird abgekühlt', 3: 'Wird aufgewärmt' };
            return { state: this.zustand.power, description: texte[this.zustand.power] };
        },
        async getCurrentInput() { if (this.fehler) throw new Error('Zeitüberschreitung'); return this.zustand.input; },
        async getMuteState() { if (this.fehler) throw new Error('Zeitüberschreitung'); return this.zustand.mute; },
        async powerOn() { this.rufe.push('powerOn'); },
        async powerOff() { this.rufe.push('powerOff'); },
        async setInput(code) { this.rufe.push('setInput:' + code); },
        async setMute(m) { this.rufe.push('setMute:' + m.video + ',' + m.audio); }
    };
}

function bauen(anfang) {
    const uhr = fakeClock();
    const api = fakeApi(anfang);
    const b = createBeamer({ api, schedule: uhr.schedule, cancel: uhr.cancel, now: uhr.now });
    return { uhr, api, b };
}

test('erste Abfrage bringt den Zustand auf online', async () => {
    const { uhr, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
    assert.strictEqual(b.getState().sourceCode, '31');
});

test('Aufwärmen führt zum Zustand ein', async () => {
    const { uhr, api, b } = bauen({ power: 3 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().power, 'warming');

    api.zustand.power = 1;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'on');
});

test('Abkühlen bleibt bis der Beamer aus meldet', async () => {
    const { uhr, api, b } = bauen({ power: 2 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().power, 'cooling');

    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'cooling');

    api.zustand.power = 0;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'off');
});

test('drei fehlgeschlagene Abfragen lösen kein Kontakt aus', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().link, 'online');

    api.fehler = true;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'online', 'ein Fehler reicht nicht');
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'online', 'zwei Fehler reichen nicht');
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'offline', 'beim dritten Fehler gilt die Verbindung als weg');
});

test('nach Verbindungsverlust stellt eine erfolgreiche Abfrage den Normalzustand her', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    api.fehler = true;
    await uhr.advance(POLL_MS * 3);
    assert.strictEqual(b.getState().link, 'offline');

    api.fehler = false;
    await uhr.advance(60000);
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
});

test('Einschalten wartet auf die Bestätigung des Beamers', async () => {
    const { uhr, api, b } = bauen({ power: 0 });
    b.start();
    await uhr.advance(1);

    await b.powerOn();
    assert.deepStrictEqual(api.rufe, ['powerOn']);
    assert.strictEqual(b.getState().pending.kind, 'power-on');

    api.zustand.power = 3;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().pending.kind, 'power-on', 'beim Aufwärmen noch nicht fertig');

    api.zustand.power = 1;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().pending, null, 'mit dem Zustand ein ist der Befehl erledigt');
});

test('ein Befehl ohne Bestätigung läuft nach 30 Sekunden ab', async () => {
    const { uhr, b } = bauen({ power: 0 });
    b.start();
    await uhr.advance(1);

    await b.powerOn();
    await uhr.advance(COMMAND_TIMEOUT_MS + POLL_MS);
    assert.strictEqual(b.getState().pendingTimedOut, true);
    assert.strictEqual(b.getState().pending, null);
});

test('Quelle wählen meldet den Wechsel nach der Bestätigung', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    await b.selectSource('32');
    assert.ok(api.rufe.indexOf('setInput:32') !== -1);
    api.zustand.input = { code: '32', name: 'DIGITAL - 2' };
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().sourceCode, '32');
    assert.strictEqual(b.getState().pending, null);
});

test('Stummschaltung wird übernommen', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    await b.setMute({ video: true, audio: false });
    assert.ok(api.rufe.indexOf('setMute:true,false') !== -1);
    api.zustand.mute = { video: true, audio: false };
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().mute.video, true);
});

test('onChange meldet jede Zustandsänderung', async () => {
    const { uhr, api, b } = bauen({ power: 0 });
    let zaehler = 0;
    b.onChange(() => { zaehler++; });
    b.start();
    await uhr.advance(1);
    const nachStart = zaehler;
    assert.ok(nachStart > 0, 'die erste Abfrage muss melden');

    api.zustand.power = 3;
    await uhr.advance(POLL_MS);
    assert.ok(zaehler > nachStart, 'eine Änderung muss melden');
});

test('stop beendet die Abfrage-Schleife', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    b.stop();
    const vorher = api.rufe.length;
    await uhr.advance(POLL_MS * 5);
    assert.strictEqual(api.rufe.length, vorher);
});
```

- [ ] **Step 2: Tests laufen lassen und Scheitern bestätigen**

Run: `npm test`
Expected: FAIL — `Cannot find module '../renderer/js/beamer.js'`

- [ ] **Step 3: `renderer/js/beamer.js` schreiben**

```js
// Zustandsmaschine des Beamers: fragt regelmäßig ab, sendet Befehle und wartet
// auf deren Bestätigung. Kennt kein DOM — deshalb ohne Fenster testbar.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.App = root.App || {};
        root.App.beamer = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const POLL_MS = 5000;
    const COMMAND_TIMEOUT_MS = 30000;
    const BACKOFF_MS = [5000, 10000, 20000, 30000];
    const MAX_FEHLER = 3;

    const POWER_NAMEN = { 0: 'off', 1: 'on', 2: 'cooling', 3: 'warming' };

    function createBeamer(deps) {
        const api = deps.api;
        const schedule = deps.schedule;
        const cancel = deps.cancel;
        const now = deps.now;

        let state = {
            link: 'connecting',
            power: 'unknown',
            sourceCode: null,
            sourceName: null,
            mute: { video: false, audio: false },
            pending: null,
            pendingTimedOut: false
        };

        let hoerer = [];
        let timer = null;
        let laeuft = false;
        let fehlerInFolge = 0;
        let offlineVersuche = 0;

        function melden() {
            const kopie = JSON.parse(JSON.stringify(state));
            hoerer.forEach(function (fn) { fn(kopie); });
        }

        function aendern(teil) {
            const vorher = JSON.stringify(state);
            state = Object.assign({}, state, teil);
            if (JSON.stringify(state) !== vorher) melden();
        }

        // Ist der laufende Befehl durch den gemeldeten Zustand erfüllt?
        function befehlErfuellt(neu) {
            const p = state.pending;
            if (!p) return false;
            if (p.kind === 'power-on') return neu.power === 'on';
            if (p.kind === 'power-off') return neu.power === 'off';
            if (p.kind === 'source') return neu.sourceCode === p.target;
            if (p.kind === 'mute') {
                return neu.mute.video === p.target.video && neu.mute.audio === p.target.audio;
            }
            return false;
        }

        async function abfragen() {
            const power = await api.getPowerState();
            const neu = {
                link: 'online',
                power: POWER_NAMEN[power.state] || 'unknown',
                sourceCode: state.sourceCode,
                sourceName: state.sourceName,
                mute: state.mute
            };

            // Quelle und Stummschaltung nur abfragen, wenn der Beamer läuft —
            // im ausgeschalteten Zustand antworten viele Geräte darauf gar nicht.
            if (neu.power === 'on') {
                try {
                    const quelle = await api.getCurrentInput();
                    if (quelle && quelle.code) {
                        neu.sourceCode = quelle.code;
                        neu.sourceName = quelle.name || null;
                    }
                } catch (e) { /* nicht schlimm, der Rest zählt */ }

                try {
                    const m = await api.getMuteState();
                    if (m) neu.mute = { video: m.video === true, audio: m.audio === true };
                } catch (e) { /* siehe oben */ }
            }

            return neu;
        }

        async function tick() {
            if (!laeuft) return;

            try {
                const neu = await abfragen();
                fehlerInFolge = 0;
                offlineVersuche = 0;

                const teil = {
                    link: 'online',
                    power: neu.power,
                    sourceCode: neu.sourceCode,
                    sourceName: neu.sourceName,
                    mute: neu.mute
                };

                if (state.pending) {
                    if (befehlErfuellt(neu)) {
                        teil.pending = null;
                        teil.pendingTimedOut = false;
                    } else if (now() - state.pending.startedAt >= COMMAND_TIMEOUT_MS) {
                        teil.pending = null;
                        teil.pendingTimedOut = true;
                    }
                }

                aendern(teil);
            } catch (e) {
                fehlerInFolge++;
                if (fehlerInFolge >= MAX_FEHLER && state.link !== 'offline') {
                    aendern({ link: 'offline', pending: null });
                }
                if (state.link === 'offline') {
                    // Nach Verbindungsverlust neu aufbauen, bevor wieder gefragt wird.
                    try { await api.connect(); } catch (e2) { /* beim nächsten Mal wieder */ }
                }
            }

            planen();
        }

        function planen() {
            if (!laeuft) return;
            let wartezeit = POLL_MS;
            if (state.link === 'offline') {
                const i = Math.min(offlineVersuche, BACKOFF_MS.length - 1);
                wartezeit = BACKOFF_MS[i];
                offlineVersuche++;
            }
            timer = schedule(tick, wartezeit);
        }

        function befehlStarten(kind, target) {
            aendern({
                pending: { kind: kind, target: target === undefined ? null : target, startedAt: now() },
                pendingTimedOut: false
            });
        }

        async function senden(kind, target, fn) {
            befehlStarten(kind, target);
            try {
                await fn();
            } catch (e) {
                aendern({ pending: null, pendingTimedOut: true });
                throw e;
            }
        }

        return {
            start: function () {
                if (laeuft) return;
                laeuft = true;
                fehlerInFolge = 0;
                offlineVersuche = 0;
                timer = schedule(tick, 0);
            },

            stop: function () {
                laeuft = false;
                if (timer !== null) cancel(timer);
                timer = null;
            },

            getState: function () {
                return JSON.parse(JSON.stringify(state));
            },

            onChange: function (fn) {
                hoerer.push(fn);
                return function () { hoerer = hoerer.filter(function (h) { return h !== fn; }); };
            },

            refreshNow: function () {
                if (timer !== null) cancel(timer);
                return tick();
            },

            powerOn: function () {
                return senden('power-on', null, function () { return api.powerOn(); });
            },

            powerOff: function () {
                return senden('power-off', null, function () { return api.powerOff(); });
            },

            selectSource: function (code) {
                return senden('source', code, function () { return api.setInput(code); });
            },

            setMute: function (m) {
                const ziel = { video: m.video === true, audio: m.audio === true };
                return senden('mute', ziel, function () { return api.setMute(ziel); });
            }
        };
    }

    return { createBeamer, POLL_MS, COMMAND_TIMEOUT_MS, BACKOFF_MS };
});
```

- [ ] **Step 4: Tests laufen lassen und Erfolg bestätigen**

Run: `npm test`
Expected: PASS, alle Tests aus beiden Dateien

- [ ] **Step 5: Commit**

```bash
git add renderer/js/beamer.js test/beamer.test.js
git commit -m "Füge Zustandsmaschine mit Abfrage-Schleife und Befehlsbestätigung hinzu"
```

---

### Task 3: Hauptprozess erweitern

**Files:**
- Modify: `lib/pjlink.js` (neue Methode `setMuteRaw`)
- Modify: `main.js:143-147` (`set-mute`), `main.js:245-277` (`scan-network`), neue Handler
- Modify: `preload.js`

**Interfaces:**
- Consumes: nichts
- Produces: `window.pjlinkAPI` zusätzlich mit
  `setVideoMute(bool)`, `setAudioMute(bool)`,
  `onScanProgress(cb)` → `unsubscribe`, cb bekommt `{ checked, total, devices }`,
  `getOsTheme()` → `Promise<'dark'|'light'>`, `onOsThemeChange(cb)` → `unsubscribe`.

**Warum `setMuteRaw`:** `lib/command.js:154-190` bildet den Wunsch „Video stumm, Ton nicht“ auf den PJLink-Wert `11` ab. Damit lässt sich Video-Stummschaltung einschalten, aber nicht wieder ausschalten, ohne gleichzeitig den Ton zu entstummen (`30` schaltet beides ab). Für zwei getrennte Schalter brauchen wir die vier Einzelwerte `10`, `11`, `20`, `21`.

- [ ] **Step 1: `lib/pjlink.js` um `setMuteRaw` erweitern**

Direkt nach `PJLink.prototype.getMute` (Zeile 94) einfügen:

```js
// Setzt die Stummschaltung mit einem rohen PJLink-AVMT-Wert.
// 11/10 = Video stumm ein/aus, 21/20 = Ton stumm ein/aus.
// Nötig, weil MuteCommand Video und Ton nicht unabhängig abschalten kann.
PJLink.prototype.setMuteRaw = function(code, cb){
	this._addCommand(new pjcommand('AVMT', code, cb));
}
```

- [ ] **Step 2: `main.js` — `set-mute` auf Einzelwerte umstellen**

Den Handler `ipcMain.handle('set-mute', …)` (Zeilen 143-147) ersetzen durch:

```js
// Video und Ton werden einzeln geschaltet, damit sich beide unabhängig
// voneinander an- und abschalten lassen.
ipcMain.handle('set-mute', async (event, { video, audio }) => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), video ? '11' : '10');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), audio ? '21' : '20');
    return { success: true };
});
```

- [ ] **Step 3: `main.js` — Fortschritt beim Netzwerk-Suchlauf**

Den Handler `ipcMain.handle('scan-network', …)` (Zeilen 245-277) ersetzen durch:

```js
ipcMain.handle('scan-network', async (event) => {
    const PORT = 4352; // PJLink Standardport
    const TIMEOUT = 400; // ms pro Host
    const subnets = getLocalSubnets();

    if (subnets.length === 0) {
        throw new Error('Kein aktives Netzwerk gefunden');
    }

    const total = subnets.length * 254;
    let checked = 0;
    const openHosts = [];
    const devices = [];

    // Meldet den Fortschritt an das Fenster, damit der Assistent einen Balken zeigen kann.
    const melden = () => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('scan-progress', { checked, total, devices: devices.slice() });
        }
    };

    for (const subnet of subnets) {
        const checks = [];
        for (let i = 1; i <= 254; i++) {
            const host = `${subnet}.${i}`;
            checks.push(
                checkPort(host, PORT, TIMEOUT).then((open) => {
                    checked++;
                    if (open) openHosts.push(host);
                    if (checked % 10 === 0) melden();
                })
            );
        }
        await Promise.all(checks);
    }
    melden();

    // Für jeden gefundenen Host best-effort den Gerätenamen holen
    for (const host of openHosts) {
        const name = await getDeviceNameQuick(host, PORT);
        devices.push({ host, port: PORT, name: name || null });
        melden();
    }

    return { devices };
});
```

- [ ] **Step 4: `main.js` — Betriebssystem-Farbschema weiterreichen**

`nativeTheme` in die `require`-Zeile 2 aufnehmen:

```js
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
```

Und am Ende der Datei ergänzen:

```js
// ============ FARBSCHEMA DES BETRIEBSSYSTEMS ============

ipcMain.handle('get-os-theme', async () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('os-theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
});
```

- [ ] **Step 5: `preload.js` um die neuen Kanäle erweitern**

Innerhalb von `contextBridge.exposeInMainWorld('pjlinkAPI', { … })` ergänzen:

```js
    // Stummschaltung einzeln
    setVideoMute: (an) => ipcRenderer.invoke('set-mute-video', an),
    setAudioMute: (an) => ipcRenderer.invoke('set-mute-audio', an),

    // Fortschritt des Netzwerk-Suchlaufs
    onScanProgress: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('scan-progress', handler);
        return () => ipcRenderer.removeListener('scan-progress', handler);
    },

    // Farbschema des Betriebssystems
    getOsTheme: () => ipcRenderer.invoke('get-os-theme'),
    onOsThemeChange: (cb) => {
        const handler = (_event, wert) => cb(wert);
        ipcRenderer.on('os-theme-changed', handler);
        return () => ipcRenderer.removeListener('os-theme-changed', handler);
    }
```

- [ ] **Step 6: `main.js` — die beiden Einzel-Handler ergänzen**

Direkt nach dem `set-mute`-Handler einfügen:

```js
ipcMain.handle('set-mute-video', async (event, an) => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), an ? '11' : '10');
    return { success: true };
});

ipcMain.handle('set-mute-audio', async (event, an) => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), an ? '21' : '20');
    return { success: true };
});
```

- [ ] **Step 7: Prüfen, dass die alte App weiterhin startet**

Run: `npm start`
Expected: Die bisherige Oberfläche erscheint unverändert und lässt sich bedienen. Diese Task ändert nur den Hauptprozess; `dashboard.html` ist noch aktiv. Fenster wieder schließen.

- [ ] **Step 8: Commit**

```bash
git add lib/pjlink.js main.js preload.js
git commit -m "Erweitere Hauptprozess um Suchlauf-Fortschritt, Farbschema und getrennte Stummschaltung"
```

---

### Task 4: Grundgerüst, Themes und Ansichtswechsel

**Files:**
- Create: `renderer/index.html`, `renderer/css/tokens.css`, `renderer/css/app.css`
- Create: `renderer/js/api.js`, `renderer/js/theme.js`, `renderer/js/ui.js`, `renderer/js/app.js`
- Modify: `main.js:40` (`loadFile`)
- Modify: `package.json` (`build.files`)
- Delete: `dashboard.html`

**Interfaces:**
- Consumes: `App.store` (Task 1), `App.beamer` (Task 2), die neuen preload-Kanäle (Task 3)
- Produces:
  `App.api` — `{ connect, disconnect, powerOn, powerOff, getPowerState, setInput, getCurrentInput, getAvailableInputs, setMute, setVideoMute, setAudioMute, getMuteState, getDeviceInfo, loadSettings, saveSettings, scanNetwork, onScanProgress, getOsTheme, onOsThemeChange }`
  `App.theme.createTheme(store)` → `{ init(beiWechsel), setTheme('system'|'light'|'dark'), setHighContrast(bool), getTheme(), getHighContrast(), toggleAsync() → Promise<'light'|'dark'> }`
  `App.ui` — `{ el(tag, attrs, kinder), clear(node), confirmDialog({titel, text, bestaetigen, abbrechen}) → Promise<bool> }`
  `App.log` — `{ add(text, art), all() → [{zeit, text, art}], onChange(fn) }`, `art` ist `'info'|'ok'|'fehler'`
  `App.showView(name)` mit `name` aus `'operate'|'tech'|'setup'`

- [ ] **Step 1: `renderer/css/tokens.css` schreiben**

```css
/* Farb- und Größenvariablen.
   :root ist hell. [data-theme="dark"] überschreibt, [data-contrast="high"]
   überschreibt beide. Steht kein data-theme, entscheidet prefers-color-scheme. */

:root {
    --bg:            #faf8f5;
    --bg-raised:     #f1ece5;
    --surface:       #ffffff;
    --surface-hover: #f6f2ec;
    --border:        #ddd5c9;
    --border-width:  1px;
    --text:          #2b2926;
    --text-dim:      #7a736a;

    --accent:        #2f6fb5;
    --accent-soft:   #e8f0f9;
    --accent-border: #2f6fb5;
    --accent-text:   #1c4f86;

    --ok:            #2e9e6b;
    --warn:          #b07d10;
    --warn-soft:     #fdf4dd;
    --warn-border:   #e0bd63;
    --warn-text:     #6d4f06;
    --danger:        #b03a2c;
    --danger-text:   #ffffff;

    --radius:        12px;
    --radius-sm:     8px;
    --shadow:        0 1px 2px rgba(70, 55, 35, .07);

    --fs-hero:       28px;
    --fs-status:     19px;
    --fs-tile:       16px;
    --fs-body:       14px;
    --fs-small:      12px;
    --fs-label:      11px;

    --tile-pad:      22px 12px;
    --gap:           12px;
}

@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        --bg:            #15171c;
        --bg-raised:     #1c1f26;
        --surface:       #22262e;
        --surface-hover: #2a2f38;
        --border:        #30353e;
        --text:          #e6e8ec;
        --text-dim:      #8b929c;

        --accent:        #3f7ab5;
        --accent-soft:   #1b2a3c;
        --accent-border: #3f7ab5;
        --accent-text:   #94c2ee;

        --ok:            #3ecf8e;
        --warn:          #e8b13a;
        --warn-soft:     #3a2f14;
        --warn-border:   #6b571c;
        --warn-text:     #f0cd77;
        --danger:        #b03a2c;

        --shadow:        none;
    }
}

:root[data-theme="dark"] {
    --bg:            #15171c;
    --bg-raised:     #1c1f26;
    --surface:       #22262e;
    --surface-hover: #2a2f38;
    --border:        #30353e;
    --text:          #e6e8ec;
    --text-dim:      #8b929c;

    --accent:        #3f7ab5;
    --accent-soft:   #1b2a3c;
    --accent-border: #3f7ab5;
    --accent-text:   #94c2ee;

    --ok:            #3ecf8e;
    --warn:          #e8b13a;
    --warn-soft:     #3a2f14;
    --warn-border:   #6b571c;
    --warn-text:     #f0cd77;
    --danger:        #b03a2c;

    --shadow:        none;
}

/* Hoher Kontrast wirkt in beiden Modi: kräftigere Ränder, größere Schrift,
   maximale Helligkeitsunterschiede. */
:root[data-contrast="high"] {
    --bg:            #000000;
    --bg-raised:     #000000;
    --surface:       #1a1a1a;
    --surface-hover: #262626;
    --border:        #6a6a6a;
    --border-width:  2px;
    --text:          #ffffff;
    --text-dim:      #c8c8c8;

    --accent:        #4da3ff;
    --accent-soft:   #002d5c;
    --accent-border: #4da3ff;
    --accent-text:   #9ecdff;

    --ok:            #00e07a;
    --warn:          #ffc94d;
    --warn-soft:     #3a2c00;
    --warn-border:   #ffc94d;
    --warn-text:     #ffdb85;
    --danger:        #e02020;

    --fs-hero:       34px;
    --fs-status:     25px;
    --fs-tile:       20px;
    --fs-body:       17px;
    --fs-small:      14px;
    --fs-label:      13px;

    --tile-pad:      28px 12px;
    --shadow:        none;
}

:root[data-contrast="high"][data-theme="light"],
:root[data-contrast="high"]:not([data-theme="dark"]) {
    --bg:            #ffffff;
    --bg-raised:     #ffffff;
    --surface:       #ffffff;
    --surface-hover: #ededed;
    --border:        #000000;
    --text:          #000000;
    --text-dim:      #333333;
    --accent:        #004a99;
    --accent-soft:   #d6e6f8;
    --accent-border: #004a99;
    --accent-text:   #003467;
    --ok:            #006b3c;
    --warn:          #7a5200;
    --warn-soft:     #fff0c9;
    --warn-border:   #7a5200;
    --warn-text:     #4a3200;
    --danger:        #a80000;
}

:root[data-contrast="high"][data-theme="dark"] {
    --bg:            #000000;
    --bg-raised:     #000000;
    --surface:       #1a1a1a;
    --border:        #6a6a6a;
    --text:          #ffffff;
    --text-dim:      #c8c8c8;
    --accent:        #4da3ff;
    --accent-soft:   #002d5c;
    --accent-text:   #9ecdff;
    --ok:            #00e07a;
    --danger:        #e02020;
}
```

- [ ] **Step 2: `renderer/css/app.css` schreiben**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
    font-family: 'Segoe UI', -apple-system, system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: var(--fs-body);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

button { font: inherit; cursor: pointer; color: inherit; }
input  { font: inherit; }

/* ---------- Kopfzeile ---------- */

.kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 18px;
    background: var(--bg-raised);
    border-bottom: var(--border-width) solid var(--border);
    color: var(--text-dim);
    font-size: var(--fs-small);
    flex: none;
}

.kopf-titel { letter-spacing: .3px; }
.kopf-knoepfe { display: flex; gap: 4px; }

.kopf-knopf {
    background: none;
    border: none;
    padding: 6px 9px;
    border-radius: var(--radius-sm);
    font-size: 16px;
    line-height: 1;
    color: var(--text-dim);
}
.kopf-knopf:hover { background: var(--surface-hover); color: var(--text); }

/* ---------- Bereiche ---------- */

.ansicht { flex: 1; overflow-y: auto; padding: 24px; display: none; }
.ansicht.aktiv { display: block; }
.ansicht-innen { max-width: 900px; margin: 0 auto; }

/* ---------- Statuszeile und Chips ---------- */

.statuszeile {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
}

.status { display: flex; align-items: center; gap: 11px; font-size: var(--fs-status); font-weight: 600; }
.punkt { width: 11px; height: 11px; border-radius: 50%; background: var(--text-dim); flex: none; }
.punkt.an { background: var(--ok); }
.punkt.warten { background: var(--warn); }

.chips { display: flex; gap: 9px; }

.chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: 99px;
    padding: 9px 15px;
    font-size: var(--fs-small);
    color: var(--text-dim);
    white-space: nowrap;
}
.chip:hover { background: var(--surface-hover); }
.chip.aktiv {
    background: var(--warn-soft);
    border-color: var(--warn-border);
    color: var(--warn-text);
    font-weight: 600;
}

/* ---------- Bildquellen ---------- */

.feldname {
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-dim);
    margin: 22px 0 11px;
}

.kacheln { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gap); }

.kachel {
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius);
    padding: var(--tile-pad);
    text-align: center;
    font-size: var(--fs-tile);
    font-weight: 600;
    box-shadow: var(--shadow);
}
.kachel:hover { background: var(--surface-hover); }
.kachel .unter { display: block; font-size: var(--fs-small); font-weight: 400; color: var(--text-dim); margin-top: 5px; }
.kachel.aktiv {
    background: var(--accent-soft);
    border-color: var(--accent-border);
    color: var(--accent-text);
}
.kachel.aktiv .unter { color: var(--accent-text); opacity: .8; }

/* ---------- Knöpfe ---------- */

.knopf {
    background: var(--surface);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px 20px;
    font-size: var(--fs-body);
}
.knopf:hover { background: var(--surface-hover); }
.knopf.haupt { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.knopf.gross { padding: 26px; font-size: var(--fs-hero); width: 100%; border-radius: var(--radius); }
.knopf.aus { background: var(--danger); border-color: var(--danger); color: var(--danger-text); font-weight: 600; width: 100%; margin-top: 24px; padding: 15px; }
.knopf.text { background: none; border: none; color: var(--accent-text); padding: 10px 0; }
.knopf:disabled { opacity: .45; cursor: not-allowed; }

/* ---------- Große Mitte (aus / wartet / kein Kontakt) ---------- */

.mitte { text-align: center; padding: 44px 20px; }
.mitte-titel { font-size: var(--fs-hero); font-weight: 600; margin-bottom: 10px; }
.mitte-text { color: var(--text-dim); margin-bottom: 26px; line-height: 1.6; }

.pulsen { display: inline-block; width: 46px; height: 46px; border-radius: 50%; border: 4px solid var(--border); border-top-color: var(--accent); animation: dreh 1.1s linear infinite; margin-bottom: 20px; }
@keyframes dreh { to { transform: rotate(360deg); } }

/* ---------- Hinweisstreifen ---------- */

.streifen {
    background: var(--warn-soft);
    border: var(--border-width) solid var(--warn-border);
    border-radius: var(--radius);
    padding: 18px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
}
.streifen-titel { font-size: var(--fs-status); font-weight: 600; color: var(--warn-text); }
.streifen-text { font-size: var(--fs-small); color: var(--warn-text); opacity: .85; margin-top: 3px; }
.streifen-knopf { background: var(--warn-border); color: var(--warn-text); border: none; border-radius: var(--radius-sm); padding: 13px 20px; font-weight: 700; flex: none; }

/* ---------- Dialog ---------- */

.dialog-grund { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 50; }
.dialog { background: var(--bg-raised); border: var(--border-width) solid var(--border); border-radius: var(--radius); padding: 26px; max-width: 420px; }
.dialog h2 { font-size: var(--fs-status); margin-bottom: 10px; }
.dialog p { color: var(--text-dim); line-height: 1.6; margin-bottom: 22px; }
.dialog-knoepfe { display: flex; gap: 10px; justify-content: flex-end; }

/* ---------- Technik-Seite ---------- */

.block { margin-bottom: 34px; }
.block-titel { font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); padding-bottom: 9px; border-bottom: var(--border-width) solid var(--border); margin-bottom: 16px; }

.felder { display: grid; grid-template-columns: 2fr 1fr 1.4fr; gap: var(--gap); }
.feld-lab { font-size: var(--fs-label); color: var(--text-dim); margin-bottom: 6px; }
.eingabe { width: 100%; background: var(--surface); border: var(--border-width) solid var(--border); border-radius: var(--radius-sm); padding: 11px 12px; color: var(--text); }

.knopfzeile { display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
.verbindungsstand { margin-left: auto; font-size: var(--fs-small); display: flex; align-items: center; gap: 8px; }

.trefferliste { margin-top: 12px; border: var(--border-width) solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.treffer { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: var(--border-width) solid var(--border); font-size: var(--fs-small); background: var(--surface); }
.treffer:last-child { border-bottom: none; }
.treffer-host { font-family: ui-monospace, 'Consolas', monospace; color: var(--accent-text); }

.quellzeile { display: grid; grid-template-columns: 26px 150px 1fr 80px; gap: var(--gap); align-items: center; padding: 9px 0; border-bottom: var(--border-width) solid var(--border); font-size: var(--fs-small); }
.quellzeile.kopf { color: var(--text-dim); text-transform: uppercase; letter-spacing: .9px; font-size: var(--fs-label); }
.quellzeile:last-child { border-bottom: none; }
.griff { text-align: center; color: var(--text-dim); cursor: grab; user-select: none; }
.quellcode { color: var(--text-dim); font-family: ui-monospace, 'Consolas', monospace; }
.quellzeile input[type="checkbox"] { width: 18px; height: 18px; }
.quellzeile .haken { text-align: center; }
.quellzeile.zieht { opacity: .4; }

.wahl { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.wahl label { display: flex; gap: 7px; align-items: center; }

.protokoll { background: var(--bg); border: var(--border-width) solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; font-family: ui-monospace, 'Consolas', monospace; font-size: var(--fs-small); line-height: 1.9; max-height: 220px; overflow-y: auto; color: var(--text-dim); }
.protokoll .ok { color: var(--ok); }
.protokoll .fehler { color: var(--danger); }

/* ---------- Assistent ---------- */

.schritte { display: flex; gap: 8px; align-items: center; margin-bottom: 26px; }
.schritt { width: 24px; height: 24px; border-radius: 50%; background: var(--surface); border: var(--border-width) solid var(--border); color: var(--text-dim); display: inline-flex; align-items: center; justify-content: center; font-size: var(--fs-small); }
.schritt.jetzt { background: var(--accent); border-color: var(--accent); color: #fff; }
.schritt.fertig { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent-text); }

.assistent-titel { font-size: var(--fs-hero); font-weight: 600; margin-bottom: 10px; }
.assistent-text { color: var(--text-dim); line-height: 1.6; margin-bottom: 24px; }

.balken { height: 6px; background: var(--surface); border-radius: 99px; overflow: hidden; margin: 20px 0 10px; }
.balken > i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 99px; transition: width .3s; }

.pruefliste { list-style: none; }
.pruefliste li { padding: 7px 0 7px 24px; position: relative; color: var(--text-dim); line-height: 1.5; }
.pruefliste li::before { content: '•'; position: absolute; left: 6px; color: var(--accent); }
```

- [ ] **Step 3: `renderer/index.html` schreiben**

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'">
    <title>Beamer Steuerung</title>
    <link rel="stylesheet" href="css/tokens.css">
    <link rel="stylesheet" href="css/app.css">
</head>
<body>
    <header class="kopf">
        <span class="kopf-titel">Beamer Steuerung</span>
        <span class="kopf-knoepfe">
            <button class="kopf-knopf" id="themaKnopf" title="Hell / Dunkel umschalten">◐</button>
            <button class="kopf-knopf" id="technikKnopf" title="Technik">⚙</button>
        </span>
    </header>

    <main class="ansicht" id="ansicht-operate"></main>
    <main class="ansicht" id="ansicht-tech"></main>
    <main class="ansicht" id="ansicht-setup"></main>

    <script src="js/api.js"></script>
    <script src="js/ui.js"></script>
    <script src="js/store.js"></script>
    <script src="js/beamer.js"></script>
    <script src="js/theme.js"></script>
    <script src="js/view-operate.js"></script>
    <script src="js/view-tech.js"></script>
    <script src="js/view-setup.js"></script>
    <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: `renderer/js/api.js` schreiben**

```js
// Einziger Ort, der die preload-Brücke kennt. Alle anderen Dateien rufen App.api.
window.App = window.App || {};
window.App.api = (function () {
    const p = window.pjlinkAPI;
    return {
        connect: (cfg) => p.connect(cfg),
        disconnect: () => p.disconnect(),
        powerOn: () => p.powerOn(),
        powerOff: () => p.powerOff(),
        getPowerState: () => p.getPowerState(),
        setInput: (code) => p.setInput(code),
        getCurrentInput: () => p.getCurrentInput(),
        getAvailableInputs: () => p.getAvailableInputs(),
        setMute: (m) => p.setMute(m),
        setVideoMute: (an) => p.setVideoMute(an),
        setAudioMute: (an) => p.setAudioMute(an),
        getMuteState: () => p.getMuteState(),
        getDeviceInfo: () => p.getDeviceInfo(),
        loadSettings: () => p.loadSettings(),
        saveSettings: (s) => p.saveSettings(s),
        scanNetwork: () => p.scanNetwork(),
        onScanProgress: (cb) => p.onScanProgress(cb),
        getOsTheme: () => p.getOsTheme(),
        onOsThemeChange: (cb) => p.onOsThemeChange(cb)
    };
})();
```

- [ ] **Step 5: `renderer/js/ui.js` schreiben**

```js
// Winzige DOM-Helfer und der Bestätigungsdialog. Kein Zustand, keine Netzwerklogik.
window.App = window.App || {};
window.App.ui = (function () {

    // el('div', {class:'x', onclick:fn}, ['Text', andererKnoten])
    function el(tag, attrs, kinder) {
        const knoten = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                const v = attrs[k];
                if (v === null || v === undefined || v === false) return;
                if (k.indexOf('on') === 0 && typeof v === 'function') {
                    knoten.addEventListener(k.slice(2), v);
                } else if (k === 'text') {
                    knoten.textContent = v;
                } else if (k === 'checked' || k === 'disabled' || k === 'draggable') {
                    knoten[k] = v;
                } else if (k === 'value') {
                    knoten.value = v;
                } else {
                    knoten.setAttribute(k, v);
                }
            });
        }
        (kinder || []).forEach(function (kind) {
            if (kind === null || kind === undefined || kind === false) return;
            knoten.appendChild(typeof kind === 'string' ? document.createTextNode(kind) : kind);
        });
        return knoten;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    // Eigener Dialog statt confirm(): passt zum Erscheinungsbild und blockiert nicht.
    function confirmDialog(opt) {
        return new Promise(function (resolve) {
            const schliessen = function (antwort) {
                document.body.removeChild(grund);
                document.removeEventListener('keydown', taste);
                resolve(antwort);
            };
            const taste = function (e) {
                if (e.key === 'Escape') schliessen(false);
                if (e.key === 'Enter') schliessen(true);
            };

            const box = el('div', { class: 'dialog' }, [
                el('h2', { text: opt.titel }),
                el('p', { text: opt.text }),
                el('div', { class: 'dialog-knoepfe' }, [
                    el('button', { class: 'knopf', text: opt.abbrechen || 'Abbrechen', onclick: function () { schliessen(false); } }),
                    el('button', { class: 'knopf haupt', text: opt.bestaetigen || 'Ja', onclick: function () { schliessen(true); } })
                ])
            ]);

            const grund = el('div', { class: 'dialog-grund', onclick: function (e) { if (e.target === grund) schliessen(false); } }, [box]);
            document.body.appendChild(grund);
            document.addEventListener('keydown', taste);
        });
    }

    return { el: el, clear: clear, confirmDialog: confirmDialog };
})();

// Protokoll: sammelt Meldungen für die Technik-Seite. Erscheint nie in der Bedienung.
window.App.log = (function () {
    const eintraege = [];
    let hoerer = [];

    return {
        add: function (text, art) {
            eintraege.push({
                zeit: new Date().toLocaleTimeString('de-DE'),
                text: text,
                art: art || 'info'
            });
            while (eintraege.length > 200) eintraege.shift();
            hoerer.forEach(function (fn) { fn(); });
        },
        all: function () { return eintraege.slice(); },
        onChange: function (fn) { hoerer.push(fn); }
    };
})();
```

- [ ] **Step 6: `renderer/js/theme.js` schreiben**

```js
// Hell / Dunkel / Systemeinstellung und hoher Kontrast.
// Setzt data-theme und data-contrast am <html>-Element; die Farben stehen in tokens.css.
window.App = window.App || {};
window.App.theme = (function () {

    function createTheme(store) {
        const wurzel = document.documentElement;
        let abmelden = null;

        function anwenden() {
            const a = store.get().appearance;

            if (a.theme === 'system') {
                wurzel.removeAttribute('data-theme');
            } else {
                wurzel.setAttribute('data-theme', a.theme);
            }

            if (a.highContrast) {
                wurzel.setAttribute('data-contrast', 'high');
            } else {
                wurzel.removeAttribute('data-contrast');
            }
        }

        // Im Modus "system" muss die App mitlaufen, wenn Windows abends umschaltet.
        // prefers-color-scheme in tokens.css erledigt das von allein; der Hörer
        // dient nur dazu, das Symbol in der Kopfzeile aktuell zu halten.
        function systemBeobachten(beiWechsel) {
            if (abmelden) { abmelden(); abmelden = null; }
            abmelden = window.App.api.onOsThemeChange(function () {
                if (store.get().appearance.theme === 'system' && beiWechsel) beiWechsel();
            });
        }

        return {
            init: function (beiWechsel) {
                anwenden();
                systemBeobachten(beiWechsel);
            },

            setTheme: function (wert) {
                store.setAppearance(Object.assign({}, store.get().appearance, { theme: wert }));
                anwenden();
                store.save();
            },

            setHighContrast: function (an) {
                store.setAppearance(Object.assign({}, store.get().appearance, { highContrast: an === true }));
                anwenden();
                store.save();
            },

            getTheme: function () { return store.get().appearance.theme; },
            getHighContrast: function () { return store.get().appearance.highContrast; },

            // Der Knopf in der Kopfzeile schaltet stur zwischen hell und dunkel.
            // Aus "system" heraus wird das Gegenteil dessen gewählt, was gerade zu sehen ist.
            toggleAsync: async function () {
                const jetzt = store.get().appearance.theme;
                let neu;
                if (jetzt === 'dark') {
                    neu = 'light';
                } else if (jetzt === 'light') {
                    neu = 'dark';
                } else {
                    const os = await window.App.api.getOsTheme();
                    neu = os === 'dark' ? 'light' : 'dark';
                }
                this.setTheme(neu);
                return neu;
            }
        };
    }

    return { createTheme: createTheme };
})();
```

- [ ] **Step 7: `renderer/js/app.js` schreiben**

Die Views existieren noch nicht — deshalb werden sie hier defensiv aufgerufen. Die Tasks 5-7 füllen sie.

```js
// Verdrahtet Einstellungen, Beamer-Zustand, Erscheinungsbild und die drei Ansichten.
window.App = window.App || {};

(function (App) {
    const api = App.api;
    const log = App.log;

    const store = App.store.createStore({
        load: function () { return api.loadSettings(); },
        save: function (obj) { return api.saveSettings(obj); }
    });

    const theme = App.theme.createTheme(store);

    const beamer = App.beamer.createBeamer({
        api: {
            connect: function () {
                const c = store.get().connection;
                return api.connect({ host: c.host, port: c.port, password: c.password });
            },
            getPowerState: api.getPowerState,
            getCurrentInput: api.getCurrentInput,
            getMuteState: api.getMuteState,
            powerOn: api.powerOn,
            powerOff: api.powerOff,
            setInput: api.setInput,
            setMute: function (m) { return api.setMute(m); }
        },
        schedule: function (fn, ms) { return window.setTimeout(fn, ms); },
        cancel: function (id) { window.clearTimeout(id); },
        now: function () { return Date.now(); }
    });

    let aktiveAnsicht = null;

    function showView(name) {
        aktiveAnsicht = name;
        ['operate', 'tech', 'setup'].forEach(function (n) {
            const knoten = document.getElementById('ansicht-' + n);
            knoten.classList.toggle('aktiv', n === name);
        });
        document.getElementById('technikKnopf').style.display = (name === 'setup') ? 'none' : '';
        zeichnen();
    }

    function zeichnen() {
        if (aktiveAnsicht === 'operate' && App.viewOperate) App.viewOperate.render();
        if (aktiveAnsicht === 'tech' && App.viewTech) App.viewTech.render();
        if (aktiveAnsicht === 'setup' && App.viewSetup) App.viewSetup.render();
    }

    App.showView = showView;
    App.ctx = { store: store, beamer: beamer, theme: theme, api: api, log: log };

    async function start() {
        await store.load();
        theme.init(function () { zeichnen(); });

        if (App.viewOperate) App.viewOperate.init(App.ctx);
        if (App.viewTech) App.viewTech.init(App.ctx);
        if (App.viewSetup) App.viewSetup.init(App.ctx);

        document.getElementById('themaKnopf').addEventListener('click', async function () {
            const neu = await theme.toggleAsync();
            log.add('Erscheinungsbild auf ' + (neu === 'dark' ? 'dunkel' : 'hell') + ' gestellt', 'info');
            zeichnen();
        });

        document.getElementById('technikKnopf').addEventListener('click', function () {
            showView(aktiveAnsicht === 'tech' ? 'operate' : 'tech');
        });

        beamer.onChange(function () {
            if (aktiveAnsicht === 'operate' || aktiveAnsicht === 'tech') zeichnen();
        });

        if (!store.isSetupComplete()) {
            log.add('Keine gültigen Einstellungen gefunden — Einrichtung wird gestartet', 'info');
            showView('setup');
            return;
        }

        const c = store.get().connection;
        log.add('Verbinde mit ' + c.host + ':' + c.port, 'info');
        try {
            await api.connect({ host: c.host, port: c.port, password: c.password });
            log.add('Verbunden', 'ok');
        } catch (e) {
            log.add('Verbindung fehlgeschlagen: ' + e.message, 'fehler');
        }
        beamer.start();
        showView('operate');
    }

    window.addEventListener('load', start);
})(window.App);
```

- [ ] **Step 8: Vorläufige Platzhalter für die drei Views anlegen**

Damit die App zwischen dieser und Task 7 startfähig bleibt. `renderer/js/view-operate.js`:

```js
window.App = window.App || {};
window.App.viewOperate = {
    init: function (ctx) { this.ctx = ctx; },
    render: function () {
        document.getElementById('ansicht-operate').textContent = 'Bedienung folgt in Task 5';
    }
};
```

`renderer/js/view-tech.js` und `renderer/js/view-setup.js` analog mit `viewTech` / `ansicht-tech` / `'Technik folgt in Task 6'` und `viewSetup` / `ansicht-setup` / `'Einrichtung folgt in Task 7'`.

- [ ] **Step 9: `main.js` auf die neue Oberfläche umstellen**

Zeile 40 ersetzen:

```js
    mainWindow.loadFile('renderer/index.html');
```

- [ ] **Step 10: `package.json` — Dateiliste anpassen**

Im Abschnitt `build.files` `"dashboard.html"` durch `"renderer/**/*"` ersetzen.

- [ ] **Step 11: Alte Oberfläche löschen**

```bash
git rm dashboard.html
```

- [ ] **Step 12: App starten und prüfen**

Run: `npm start`
Expected: Fenster mit der neuen Kopfzeile (Titel links, ◐ und ⚙ rechts). Ohne gespeicherte Einstellungen erscheint „Einrichtung folgt in Task 7“. Das ◐-Symbol schaltet zwischen hell und dunkel um, und die Wahl bleibt nach einem Neustart erhalten. Das ⚙ wechselt zur Technik-Ansicht und zurück.

- [ ] **Step 13: Tests laufen lassen**

Run: `npm test`
Expected: PASS — die Logikmodule sind unverändert

- [ ] **Step 14: Commit**

```bash
git add -A renderer main.js package.json
git commit -m "Ersetze dashboard.html durch renderer-Grundgerüst mit Themes"
```

---

### Task 5: Bedien-Bildschirm

**Files:**
- Modify: `renderer/js/view-operate.js` (ersetzt den Platzhalter)

**Interfaces:**
- Consumes: `App.ctx` aus Task 4, `App.ui.el/clear/confirmDialog`, Beamer-Zustand aus Task 2
- Produces: `App.viewOperate = { init(ctx), render() }`

- [ ] **Step 1: Anzeigenamen für Quellen ergänzen**

Der Beamer meldet Rohnamen wie `DIGITAL - 1`. Die Übersetzungstabelle wird von der Bedienung und der Technik-Seite gebraucht, deshalb lebt sie in `view-operate.js` und wird exportiert.

```js
// Die PJLink-Rohnamen (RGB, DIGITAL, …) sagen niemandem etwas.
// Erste Ziffer der Kennung ist die Art des Anschlusses.
const ANSCHLUSS_ART = {
    '1': 'VGA',
    '2': 'Video',
    '3': 'HDMI',
    '4': 'USB',
    '5': 'Netzwerk'
};

function anschlussName(code) {
    const art = ANSCHLUSS_ART[code.charAt(0)] || 'Eingang';
    return art + ' ' + code.charAt(1);
}
```

- [ ] **Step 2: `renderer/js/view-operate.js` vollständig schreiben**

```js
// Bedien-Bildschirm. Zeigt in jedem Beamerzustand nur das, was gerade sinnvoll ist.
window.App = window.App || {};
window.App.viewOperate = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    // Die PJLink-Rohnamen (RGB, DIGITAL, …) sagen niemandem etwas.
    // Erste Ziffer der Kennung ist die Art des Anschlusses.
    const ANSCHLUSS_ART = { '1': 'VGA', '2': 'Video', '3': 'HDMI', '4': 'USB', '5': 'Netzwerk' };

    function anschlussName(code) {
        const art = ANSCHLUSS_ART[code.charAt(0)] || 'Eingang';
        return art + ' ' + code.charAt(1);
    }

    let ctx = null;
    let wurzel = null;
    // Läuft ein Befehl, wird gesperrt — sonst klickt jemand dreimal hintereinander.
    let sperre = false;

    function sichtbareQuellen() {
        return ctx.store.get().sources.filter(function (s) { return s.visible; });
    }

    async function mitSperre(fn, meldung) {
        if (sperre) return;
        sperre = true;
        render();
        try {
            await fn();
            if (meldung) ctx.log.add(meldung, 'ok');
        } catch (e) {
            ctx.log.add('Befehl fehlgeschlagen: ' + e.message, 'fehler');
        } finally {
            sperre = false;
            render();
        }
    }

    // ---------- Bausteine ----------

    function statuszeile(zustand) {
        const chipVideo = el('button', {
            class: 'chip' + (zustand.mute.video ? ' aktiv' : ''),
            onclick: function () {
                mitSperre(function () {
                    return ctx.beamer.setMute({ video: !zustand.mute.video, audio: zustand.mute.audio });
                }, zustand.mute.video ? 'Bild wieder eingeblendet' : 'Bild ausgeblendet');
            },
            disabled: sperre
        }, ['🚫 Bild ausblenden']);

        const chipTon = el('button', {
            class: 'chip' + (zustand.mute.audio ? ' aktiv' : ''),
            onclick: function () {
                mitSperre(function () {
                    return ctx.beamer.setMute({ video: zustand.mute.video, audio: !zustand.mute.audio });
                }, zustand.mute.audio ? 'Ton wieder an' : 'Ton stummgeschaltet');
            },
            disabled: sperre
        }, ['🔇 Ton stumm']);

        return el('div', { class: 'statuszeile' }, [
            el('div', { class: 'status' }, [
                el('span', { class: 'punkt an' }),
                'Beamer läuft'
            ]),
            el('div', { class: 'chips' }, [chipVideo, chipTon])
        ]);
    }

    function quellenBereich(zustand) {
        const quellen = sichtbareQuellen();

        if (quellen.length === 0) {
            return el('div', {}, [
                el('div', { class: 'feldname', text: 'Was soll gezeigt werden?' }),
                el('p', { class: 'mitte-text', text: 'Es ist noch keine Bildquelle eingerichtet. Über das Zahnrad oben rechts lässt sich das nachholen.' })
            ]);
        }

        const kacheln = quellen.map(function (q) {
            const aktiv = zustand.sourceCode === q.code;
            return el('button', {
                class: 'kachel' + (aktiv ? ' aktiv' : ''),
                disabled: sperre,
                onclick: function () {
                    if (aktiv) return;
                    mitSperre(function () { return ctx.beamer.selectSource(q.code); }, 'Bildquelle gewechselt auf ' + q.label);
                }
            }, [
                q.label,
                el('span', { class: 'unter', text: anschlussName(q.code) })
            ]);
        });

        // Meldet der Beamer eine Quelle, die hier nicht eingerichtet ist (jemand hat
        // sie per Fernbedienung gewählt), wird sie trotzdem gezeigt — sonst sähe es
        // aus, als liefe gar nichts. Diese Kachel ist nur Anzeige, kein Knopf.
        const bekannt = quellen.some(function (q) { return q.code === zustand.sourceCode; });
        if (zustand.sourceCode && !bekannt) {
            kacheln.push(el('div', { class: 'kachel aktiv' }, [
                zustand.sourceName || anschlussName(zustand.sourceCode),
                el('span', { class: 'unter', text: 'nicht eingerichtet' })
            ]));
        }

        return el('div', {}, [
            el('div', { class: 'feldname', text: 'Was soll gezeigt werden?' }),
            el('div', { class: 'kacheln' }, kacheln)
        ]);
    }

    function ausschaltKnopf() {
        return el('button', {
            class: 'knopf aus',
            disabled: sperre,
            onclick: async function () {
                const ja = await ui.confirmDialog({
                    titel: 'Beamer ausschalten?',
                    text: 'Nach dem Ausschalten braucht der Beamer einige Minuten, bevor er sich wieder einschalten lässt.',
                    bestaetigen: 'Ja, ausschalten',
                    abbrechen: 'Abbrechen'
                });
                if (ja) mitSperre(function () { return ctx.beamer.powerOff(); }, 'Ausschalten angefordert');
            }
        }, ['Beamer ausschalten']);
    }

    function mitte(titel, text, knopf) {
        return el('div', { class: 'mitte' }, [
            el('div', { class: 'mitte-titel', text: titel }),
            text ? el('div', { class: 'mitte-text', text: text }) : null,
            knopf || null
        ]);
    }

    function warten(titel, text) {
        return el('div', { class: 'mitte' }, [
            el('div', { class: 'pulsen' }),
            el('div', { class: 'mitte-titel', text: titel }),
            text ? el('div', { class: 'mitte-text', text: text }) : null
        ]);
    }

    // ---------- Die einzelnen Zustände ----------

    function inhaltFuer(zustand) {
        if (zustand.link === 'connecting') {
            return warten('Einen Moment …', 'Die App nimmt Kontakt zum Beamer auf.');
        }

        if (zustand.link === 'offline') {
            return mitte(
                'Kein Kontakt zum Beamer',
                'Die App versucht es weiter. Bleibt es dabei, hilft meist: Beamer einschalten oder Netzwerkkabel prüfen. Alles Weitere steht hinter dem Zahnrad oben rechts.',
                el('button', {
                    class: 'knopf',
                    onclick: function () { ctx.beamer.refreshNow(); }
                }, ['Jetzt noch einmal versuchen'])
            );
        }

        if (zustand.pendingTimedOut) {
            return mitte(
                'Der Beamer antwortet nicht wie erwartet',
                'Der Befehl wurde gesendet, aber der Beamer hat den neuen Zustand nicht gemeldet. Schau kurz zur Leinwand — oft hat es trotzdem geklappt.',
                el('button', { class: 'knopf haupt', onclick: function () { ctx.beamer.refreshNow(); } }, ['Zustand neu abfragen'])
            );
        }

        if (zustand.power === 'warming') {
            return warten('Der Beamer wärmt sich auf …', 'Das dauert meist eine halbe bis eine Minute.');
        }

        if (zustand.power === 'cooling') {
            return warten('Der Beamer kühlt ab …', 'Solange die Lampe abkühlt, lässt er sich nicht wieder einschalten.');
        }

        if (zustand.power === 'off' || zustand.power === 'unknown') {
            return mitte(
                'Der Beamer ist aus',
                null,
                el('button', {
                    class: 'knopf haupt gross',
                    disabled: sperre,
                    onclick: function () { mitSperre(function () { return ctx.beamer.powerOn(); }, 'Einschalten angefordert'); }
                }, [sperre ? 'wird eingeschaltet …' : 'Beamer einschalten'])
            );
        }

        // Ab hier: der Beamer läuft.
        const teile = [];

        if (zustand.mute.video) {
            teile.push(el('div', { class: 'streifen' }, [
                el('div', {}, [
                    el('div', { class: 'streifen-titel', text: 'Die Leinwand ist gerade schwarz' }),
                    el('div', { class: 'streifen-text', text: 'Der Beamer läuft weiter — das Bild ist nur ausgeblendet.' })
                ]),
                el('button', {
                    class: 'streifen-knopf',
                    disabled: sperre,
                    onclick: function () {
                        mitSperre(function () {
                            return ctx.beamer.setMute({ video: false, audio: zustand.mute.audio });
                        }, 'Bild wieder eingeblendet');
                    }
                }, ['Bild wieder zeigen'])
            ]));
        }

        teile.push(statuszeile(zustand));
        teile.push(quellenBereich(zustand));
        teile.push(ausschaltKnopf());

        return el('div', {}, teile);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-operate');
        const zustand = ctx.beamer.getState();
        ui.clear(wurzel);
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [inhaltFuer(zustand)]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        anschlussName: anschlussName
    };
})();
```

- [ ] **Step 3: Tests laufen lassen**

Run: `npm test`
Expected: PASS — die Logikmodule sind unverändert

- [ ] **Step 4: Von Hand prüfen**

Run: `npm start`
Expected: Ohne eingerichtete Verbindung zeigt die App noch die Einrichtungs-Platzhalterseite. Für diese Task von Hand eine gültige Datei anlegen — Pfad unter macOS: `~/Library/Application Support/beamer-steuerung/beamer-settings.json`:

```json
{
  "version": 2,
  "connection": { "host": "192.168.1.100", "port": 4352, "password": null },
  "sources": [
    { "code": "31", "label": "Laptop", "visible": true },
    { "code": "32", "label": "Kanzel-PC", "visible": true }
  ],
  "appearance": { "theme": "system", "highContrast": false },
  "setupCompleted": true
}
```

Danach `npm start`: Bei erreichbarem Beamer erscheint je nach Zustand der Einschalt-Knopf oder die Kacheln; ist kein Beamer erreichbar, erscheint nach etwa 15 Sekunden „Kein Kontakt zum Beamer“ — und zwar ohne technischen Fehlertext.

- [ ] **Step 5: Commit**

```bash
git add renderer/js/view-operate.js
git commit -m "Baue Bedien-Bildschirm mit zustandsabhängiger Anzeige"
```

---

### Task 6: Technik-Seite

**Files:**
- Modify: `renderer/js/view-tech.js` (ersetzt den Platzhalter)

**Interfaces:**
- Consumes: `App.ctx`, `App.viewOperate.anschlussName`, `App.log`
- Produces: `App.viewTech = { init(ctx), render() }`

- [ ] **Step 1: `renderer/js/view-tech.js` vollständig schreiben**

```js
// Technik-Seite: eine durchgehende Seite mit Verbindung, Bildquellen,
// Darstellung und Protokoll. Nur über das Zahnrad erreichbar.
window.App = window.App || {};
window.App.viewTech = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    let ctx = null;
    let wurzel = null;

    // Nur für diese Ansicht: Ergebnisse und Stand des Netzwerk-Suchlaufs.
    let suchlauf = { laeuft: false, checked: 0, total: 0, devices: [] };
    let verbindungstext = '';
    let verbindungsArt = 'info';

    function neuZeichnen() { render(); }

    // ---------- Verbindung ----------

    function verbindungsBlock() {
        const c = ctx.store.get().connection;

        const hostFeld = el('input', { class: 'eingabe', id: 'techHost', value: c.host, type: 'text' });
        const portFeld = el('input', { class: 'eingabe', id: 'techPort', value: String(c.port), type: 'number' });
        const passFeld = el('input', { class: 'eingabe', id: 'techPass', value: c.password || '', type: 'password', placeholder: 'meistens leer' });

        function uebernehmen() {
            ctx.store.setConnection({
                host: hostFeld.value.trim(),
                port: parseInt(portFeld.value, 10) || 4352,
                password: passFeld.value.trim() || null
            });
            return ctx.store.save();
        }

        const testKnopf = el('button', {
            class: 'knopf haupt',
            onclick: async function () {
                await uebernehmen();
                const n = ctx.store.get().connection;
                verbindungstext = 'Verbinde …';
                verbindungsArt = 'info';
                neuZeichnen();
                try {
                    await ctx.api.connect({ host: n.host, port: n.port, password: n.password });
                    const info = await ctx.api.getDeviceInfo();
                    verbindungstext = 'Verbunden — ' + info.manufacturer + ' ' + info.model;
                    verbindungsArt = 'ok';
                    ctx.log.add('Verbindung geprüft: ' + n.host, 'ok');
                    ctx.beamer.start();
                    ctx.beamer.refreshNow();
                } catch (e) {
                    verbindungstext = 'Keine Verbindung: ' + e.message;
                    verbindungsArt = 'fehler';
                    ctx.log.add('Verbindung fehlgeschlagen: ' + e.message, 'fehler');
                }
                neuZeichnen();
            }
        }, ['Verbindung testen']);

        const suchKnopf = el('button', {
            class: 'knopf',
            disabled: suchlauf.laeuft,
            onclick: function () { suchen(); }
        }, [suchlauf.laeuft ? 'Suche läuft …' : 'Beamer im Netzwerk suchen']);

        const kinder = [
            el('div', { class: 'block-titel', text: 'Verbindung zum Beamer' }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: 'IP-Adresse' }), hostFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Port' }), portFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Passwort (falls im Beamer eingerichtet)' }), passFeld])
            ]),
            el('div', { class: 'knopfzeile' }, [
                testKnopf,
                suchKnopf,
                verbindungstext ? el('span', { class: 'verbindungsstand' }, [
                    el('span', { class: 'punkt' + (verbindungsArt === 'ok' ? ' an' : '') }),
                    verbindungstext
                ]) : null
            ])
        ];

        if (suchlauf.laeuft || suchlauf.devices.length > 0) {
            const anteil = suchlauf.total ? Math.round((suchlauf.checked / suchlauf.total) * 100) : 0;
            if (suchlauf.laeuft) {
                const balken = el('div', { class: 'balken' }, [el('i')]);
                balken.firstChild.style.width = anteil + '%';
                kinder.push(balken);
                kinder.push(el('div', { class: 'feld-lab', text: suchlauf.checked + ' von ' + suchlauf.total + ' Adressen geprüft · ' + suchlauf.devices.length + ' gefunden' }));
            }
            if (suchlauf.devices.length > 0) {
                kinder.push(el('div', { class: 'trefferliste' }, suchlauf.devices.map(function (d) {
                    return el('div', { class: 'treffer' }, [
                        el('span', { class: 'treffer-host', text: d.host }),
                        el('button', {
                            class: 'knopf text',
                            text: (d.name || 'PJLink-Gerät') + ' · übernehmen',
                            onclick: function () {
                                ctx.store.setConnection({ host: d.host, port: d.port, password: ctx.store.get().connection.password });
                                ctx.store.save();
                                neuZeichnen();
                            }
                        })
                    ]);
                })));
            }
        }

        return el('div', { class: 'block' }, kinder);
    }

    async function suchen() {
        suchlauf = { laeuft: true, checked: 0, total: 0, devices: [] };
        neuZeichnen();
        ctx.log.add('Netzwerksuche gestartet', 'info');

        const ab = ctx.api.onScanProgress(function (p) {
            suchlauf.checked = p.checked;
            suchlauf.total = p.total;
            suchlauf.devices = p.devices;
            neuZeichnen();
        });

        try {
            const erg = await ctx.api.scanNetwork();
            suchlauf.devices = erg.devices;
            ctx.log.add(erg.devices.length + ' Gerät(e) gefunden', erg.devices.length ? 'ok' : 'info');
        } catch (e) {
            ctx.log.add('Netzwerksuche fehlgeschlagen: ' + e.message, 'fehler');
        } finally {
            ab();
            suchlauf.laeuft = false;
            neuZeichnen();
        }
    }

    // ---------- Bildquellen ----------

    function quellenBlock() {
        const quellen = ctx.store.get().sources;

        const zeilen = quellen.map(function (q, i) {
            const zeile = el('div', { class: 'quellzeile', draggable: true }, [
                el('span', { class: 'griff', text: '⠿' }),
                el('span', { class: 'quellcode', text: q.code + ' · ' + window.App.viewOperate.anschlussName(q.code) }),
                el('input', {
                    class: 'eingabe',
                    value: q.label,
                    onchange: function (e) {
                        const neu = ctx.store.get().sources.slice();
                        neu[i] = Object.assign({}, neu[i], { label: e.target.value });
                        ctx.store.setSources(neu);
                        ctx.store.save();
                    }
                }),
                el('span', { class: 'haken' }, [
                    el('input', {
                        type: 'checkbox',
                        checked: q.visible,
                        onchange: function (e) {
                            const neu = ctx.store.get().sources.slice();
                            neu[i] = Object.assign({}, neu[i], { visible: e.target.checked });
                            ctx.store.setSources(neu);
                            ctx.store.save();
                        }
                    })
                ])
            ]);

            zeile.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', String(i));
                zeile.classList.add('zieht');
            });
            zeile.addEventListener('dragend', function () { zeile.classList.remove('zieht'); });
            zeile.addEventListener('dragover', function (e) { e.preventDefault(); });
            zeile.addEventListener('drop', function (e) {
                e.preventDefault();
                const von = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (Number.isNaN(von) || von === i) return;
                const neu = ctx.store.get().sources.slice();
                const [bewegt] = neu.splice(von, 1);
                neu.splice(i, 0, bewegt);
                ctx.store.setSources(neu);
                ctx.store.save();
                neuZeichnen();
            });

            return zeile;
        });

        const einlesen = el('button', {
            class: 'knopf',
            onclick: async function () {
                try {
                    const erg = await ctx.api.getAvailableInputs();
                    const vorhanden = ctx.store.get().sources;
                    // Bekannte Namen behalten, neue Eingänge mit Vorschlag ergänzen.
                    const zusammen = erg.inputs.map(function (i) {
                        const alt = vorhanden.filter(function (v) { return v.code === i.code; })[0];
                        return alt || { code: i.code, label: window.App.viewOperate.anschlussName(i.code), visible: true };
                    });
                    ctx.store.setSources(zusammen);
                    await ctx.store.save();
                    ctx.log.add(erg.inputs.length + ' Eingänge vom Beamer eingelesen', 'ok');
                } catch (e) {
                    ctx.log.add('Eingänge konnten nicht gelesen werden: ' + e.message, 'fehler');
                }
                neuZeichnen();
            }
        }, ['Eingänge neu vom Beamer einlesen']);

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: 'Bildquellen' }),
            el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: 'Eingang am Beamer' }),
                el('span', { text: 'Name für die Bedienung' }),
                el('span', { class: 'haken', text: 'Anzeigen' })
            ])
        ].concat(zeilen).concat([
            quellen.length === 0 ? el('p', { class: 'assistent-text', text: 'Noch keine Eingänge bekannt. Der Knopf darunter fragt den Beamer.' }) : null,
            el('div', { class: 'knopfzeile' }, [einlesen])
        ]));
    }

    // ---------- Darstellung ----------

    function darstellungsBlock() {
        const t = ctx.theme.getTheme();

        function wahl(wert, beschriftung) {
            return el('label', {}, [
                el('input', {
                    type: 'radio',
                    name: 'thema',
                    checked: t === wert,
                    onchange: function () { ctx.theme.setTheme(wert); neuZeichnen(); }
                }),
                beschriftung
            ]);
        }

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: 'Darstellung' }),
            el('div', { class: 'wahl' }, [
                wahl('system', 'Wie das Betriebssystem'),
                wahl('light', 'Hell'),
                wahl('dark', 'Dunkel')
            ]),
            el('div', { class: 'knopfzeile' }, [
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        checked: ctx.theme.getHighContrast(),
                        onchange: function (e) { ctx.theme.setHighContrast(e.target.checked); neuZeichnen(); }
                    }),
                    ' Hoher Kontrast (größere Schrift, kräftigere Ränder)'
                ])
            ])
        ]);
    }

    // ---------- Protokoll ----------

    function protokollBlock() {
        const zeilen = ctx.log.all().map(function (e) {
            return el('div', { class: e.art }, ['[' + e.zeit + '] ' + e.text]);
        });

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: 'Protokoll' }),
            el('div', { class: 'protokoll' }, zeilen.length ? zeilen : [el('div', { text: 'Noch nichts passiert.' })]),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf',
                    onclick: function () {
                        const text = ctx.log.all().map(function (e) { return '[' + e.zeit + '] ' + e.text; }).join('\n');
                        navigator.clipboard.writeText(text);
                        ctx.log.add('Protokoll kopiert', 'info');
                        neuZeichnen();
                    }
                }, ['Protokoll kopieren']),
                el('button', {
                    class: 'knopf',
                    onclick: async function () {
                        const ja = await ui.confirmDialog({
                            titel: 'Einrichtung neu starten?',
                            text: 'Die gespeicherte Verbindung und die Namen der Bildquellen gehen dabei verloren.',
                            bestaetigen: 'Ja, neu einrichten'
                        });
                        if (!ja) return;
                        ctx.beamer.stop();
                        ctx.store.setConnection({ host: '', port: 4352, password: null });
                        ctx.store.setSources([]);
                        ctx.store.get().setupCompleted = false;
                        await ctx.store.save();
                        window.App.showView('setup');
                    }
                }, ['Einrichtung neu starten'])
            ])
        ]);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-tech');
        ui.clear(wurzel);
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [
            el('button', { class: 'knopf text', text: '← Zurück zur Bedienung', onclick: function () { window.App.showView('operate'); } }),
            verbindungsBlock(),
            quellenBlock(),
            darstellungsBlock(),
            protokollBlock()
        ]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render
    };
})();
```

- [ ] **Step 2: Bekannte Falle prüfen — Fokusverlust beim Tippen**

Die Ansicht zeichnet sich bei jeder Zustandsänderung neu. Da der Beamer alle fünf Sekunden abgefragt wird, würde ein Namensfeld mitten im Tippen den Fokus verlieren. `app.js` zeichnet die Technik-Ansicht deshalb nicht bei Beamer-Änderungen neu. In `renderer/js/app.js` den Hörer aus Task 4 ersetzen:

```js
        beamer.onChange(function () {
            // Nur die Bedienung folgt dem Beamer. Die Technik-Seite würde sonst
            // mitten im Tippen neu gezeichnet und der Fokus ginge verloren.
            if (aktiveAnsicht === 'operate') zeichnen();
        });
```

- [ ] **Step 3: `setupCompleted` sauber zurücksetzen**

`ctx.store.get().setupCompleted = false` greift direkt in das Objekt. Sauberer ist eine eigene Methode. In `renderer/js/store.js` im Rückgabeobjekt von `createStore` ergänzen:

```js
            resetSetup() {
                settings.setupCompleted = false;
            },
```

Und in `view-tech.js` die Zeile ersetzen durch:

```js
                        ctx.store.resetSetup();
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Von Hand prüfen**

Run: `npm start`
Expected: Das Zahnrad öffnet die Technik-Seite mit vier Blöcken. „Verbindung testen“ meldet Erfolg oder Klartext-Fehler. „Beamer im Netzwerk suchen“ zeigt einen wachsenden Balken. „Eingänge neu vom Beamer einlesen“ füllt die Quellentabelle mit den echten Anschlüssen des Optoma. Umbenennen, Haken setzen und Umsortieren wirken sofort auf den Bedien-Bildschirm. Hell/Dunkel/System und hoher Kontrast schalten sichtbar um und überstehen einen Neustart.

- [ ] **Step 6: Commit**

```bash
git add renderer/js/view-tech.js renderer/js/store.js renderer/js/app.js
git commit -m "Baue Technik-Seite mit Verbindung, Bildquellen, Darstellung und Protokoll"
```

---

### Task 7: Einrichtungsassistent

**Files:**
- Modify: `renderer/js/view-setup.js` (ersetzt den Platzhalter)

**Interfaces:**
- Consumes: `App.ctx`, `App.viewOperate.anschlussName`, `App.showView`
- Produces: `App.viewSetup = { init(ctx), render() }`

- [ ] **Step 1: `renderer/js/view-setup.js` vollständig schreiben**

```js
// Einrichtungsassistent. Läuft einmal, wenn keine gültigen Einstellungen da sind.
window.App = window.App || {};
window.App.viewSetup = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    let ctx = null;
    let wurzel = null;

    let schritt = 1;
    let suchlauf = { laeuft: false, checked: 0, total: 0, devices: [], fertig: false };
    let auswahl = null;      // { host, port, name }
    let passwort = '';
    let pruefText = '';
    let pruefArt = 'info';
    let entwuerfe = [];      // Bildquellen im Aufbau

    function neuZeichnen() { render(); }

    function schrittleiste() {
        const punkte = [1, 2, 3, 4].map(function (n) {
            const klasse = n < schritt ? 'schritt fertig' : (n === schritt ? 'schritt jetzt' : 'schritt');
            return el('span', { class: klasse, text: n < schritt ? '✓' : String(n) });
        });
        return el('div', { class: 'schritte' }, punkte.concat([
            el('span', { class: 'feld-lab', text: 'Einrichtung' })
        ]));
    }

    // ---------- Schritt 1: finden ----------

    async function suchen() {
        suchlauf = { laeuft: true, checked: 0, total: 0, devices: [], fertig: false };
        neuZeichnen();

        const ab = ctx.api.onScanProgress(function (p) {
            suchlauf.checked = p.checked;
            suchlauf.total = p.total;
            suchlauf.devices = p.devices;
            neuZeichnen();
        });

        try {
            const erg = await ctx.api.scanNetwork();
            suchlauf.devices = erg.devices;
            ctx.log.add('Einrichtung: ' + erg.devices.length + ' Gerät(e) gefunden', 'info');
        } catch (e) {
            ctx.log.add('Einrichtung: Suche fehlgeschlagen — ' + e.message, 'fehler');
        } finally {
            ab();
            suchlauf.laeuft = false;
            suchlauf.fertig = true;
            neuZeichnen();
        }
    }

    function schritt1() {
        if (suchlauf.laeuft) {
            const anteil = suchlauf.total ? Math.round((suchlauf.checked / suchlauf.total) * 100) : 0;
            const balken = el('div', { class: 'balken' }, [el('i')]);
            balken.firstChild.style.width = anteil + '%';

            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: 'Suche läuft …' }),
                el('div', { class: 'assistent-text', text: 'Das dauert bis zu einer halben Minute.' }),
                balken,
                el('div', { class: 'feld-lab', text: suchlauf.checked + ' von ' + suchlauf.total + ' Adressen geprüft · ' + suchlauf.devices.length + ' gefunden' }),
                trefferliste()
            ]);
        }

        if (suchlauf.fertig && suchlauf.devices.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: 'Kein Beamer gefunden' }),
                el('div', { class: 'assistent-text', text: 'Das hat meist einen dieser Gründe:' }),
                el('ul', { class: 'pruefliste' }, [
                    el('li', { text: 'Der Beamer ist ganz aus. Er muss laufen oder im Netzwerk-Standby sein.' }),
                    el('li', { text: 'Im Beamer-Menü ist PJLink nicht eingeschaltet.' }),
                    el('li', { text: 'Beamer und dieser Rechner hängen in verschiedenen Netzwerken.' })
                ]),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf haupt', onclick: suchen }, ['Noch einmal suchen']),
                    el('button', { class: 'knopf text', onclick: function () { auswahl = { host: '', port: 4352, name: null }; schritt = 2; neuZeichnen(); } }, ['IP-Adresse selbst eingeben'])
                ])
            ]);
        }

        if (suchlauf.fertig) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: suchlauf.devices.length === 1 ? 'Ein Gerät gefunden' : suchlauf.devices.length + ' Geräte gefunden' }),
                el('div', { class: 'assistent-text', text: 'Wähle den Beamer aus, der gesteuert werden soll.' }),
                trefferliste(),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf text', onclick: suchen }, ['Noch einmal suchen'])
                ])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: 'Wo steht der Beamer?' }),
            el('div', { class: 'assistent-text', text: 'Die App sucht im Netzwerk nach Beamern. Der Beamer muss dafür eingeschaltet oder im Netzwerk-Standby sein.' }),
            el('div', { class: 'knopfzeile' }, [
                el('button', { class: 'knopf haupt', onclick: suchen }, ['Beamer suchen'])
            ]),
            el('button', { class: 'knopf text', onclick: function () { auswahl = { host: '', port: 4352, name: null }; schritt = 2; neuZeichnen(); } }, ['IP-Adresse stattdessen selbst eingeben'])
        ]);
    }

    function trefferliste() {
        if (suchlauf.devices.length === 0) return null;
        return el('div', { class: 'trefferliste' }, suchlauf.devices.map(function (d) {
            return el('div', { class: 'treffer' }, [
                el('span', {}, [
                    el('strong', { text: d.name || 'PJLink-Gerät' }),
                    el('span', { class: 'treffer-host', text: '  ' + d.host })
                ]),
                el('button', {
                    class: 'knopf text',
                    text: 'auswählen',
                    onclick: function () { auswahl = d; schritt = 2; pruefText = ''; neuZeichnen(); }
                })
            ]);
        }));
    }

    // ---------- Schritt 2: prüfen ----------

    function schritt2() {
        const hostFeld = el('input', { class: 'eingabe', value: auswahl.host, type: 'text', placeholder: 'z. B. 192.168.1.100' });
        const passFeld = el('input', { class: 'eingabe', value: passwort, type: 'password', placeholder: 'meistens leer' });

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: auswahl.name ? auswahl.name + ' gefunden' : 'IP-Adresse eingeben' }),
            el('div', { class: 'assistent-text', text: 'Falls im Beamer ein PJLink-Passwort eingerichtet ist, trag es hier ein — sonst einfach weiter.' }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: 'IP-Adresse' }), hostFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Port' }), el('input', { class: 'eingabe', value: String(auswahl.port || 4352), type: 'number', disabled: true })]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Passwort' }), passFeld])
            ]),
            pruefText ? el('div', { class: 'knopfzeile' }, [
                el('span', { class: 'verbindungsstand' }, [el('span', { class: 'punkt' + (pruefArt === 'ok' ? ' an' : '') }), pruefText])
            ]) : null,
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf haupt',
                    onclick: async function () {
                        auswahl.host = hostFeld.value.trim();
                        passwort = passFeld.value.trim();
                        if (!auswahl.host) {
                            pruefText = 'Bitte zuerst eine IP-Adresse eintragen.';
                            pruefArt = 'fehler';
                            neuZeichnen();
                            return;
                        }
                        pruefText = 'Verbinde …';
                        pruefArt = 'info';
                        neuZeichnen();
                        try {
                            await ctx.api.connect({ host: auswahl.host, port: auswahl.port || 4352, password: passwort || null });
                            ctx.store.setConnection({ host: auswahl.host, port: auswahl.port || 4352, password: passwort || null });
                            await ctx.store.save();
                            await eingaengeLaden();
                            schritt = 3;
                        } catch (e) {
                            pruefText = 'Keine Verbindung: ' + e.message;
                            pruefArt = 'fehler';
                        }
                        neuZeichnen();
                    }
                }, ['Weiter']),
                el('button', { class: 'knopf', onclick: function () { schritt = 1; pruefText = ''; neuZeichnen(); } }, ['Zurück zur Suche'])
            ])
        ]);
    }

    async function eingaengeLaden() {
        try {
            const erg = await ctx.api.getAvailableInputs();
            entwuerfe = erg.inputs.map(function (i) {
                return { code: i.code, label: window.App.viewOperate.anschlussName(i.code), visible: true };
            });
            ctx.log.add('Einrichtung: ' + entwuerfe.length + ' Eingänge gelesen', 'ok');
        } catch (e) {
            entwuerfe = [];
            ctx.log.add('Einrichtung: Eingänge nicht lesbar — ' + e.message, 'fehler');
        }
    }

    // ---------- Schritt 3: benennen ----------

    function schritt3() {
        const zeilen = entwuerfe.map(function (q, i) {
            return el('div', { class: 'quellzeile' }, [
                el('span'),
                el('span', { class: 'quellcode', text: q.code + ' · ' + window.App.viewOperate.anschlussName(q.code) }),
                el('input', {
                    class: 'eingabe',
                    value: q.label,
                    onchange: function (e) { entwuerfe[i].label = e.target.value; }
                }),
                el('span', { class: 'haken' }, [
                    el('input', {
                        type: 'checkbox',
                        checked: q.visible,
                        onchange: function (e) { entwuerfe[i].visible = e.target.checked; }
                    })
                ])
            ]);
        });

        const weiter = el('button', {
            class: 'knopf haupt',
            onclick: async function () {
                ctx.store.setSources(entwuerfe);
                await ctx.store.save();
                schritt = 4;
                neuZeichnen();
            }
        }, ['Weiter']);

        if (entwuerfe.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: 'Keine Eingänge gemeldet' }),
                el('div', { class: 'assistent-text', text: 'Der Beamer hat seine Anschlüsse nicht verraten. Das lässt sich später auf der Technik-Seite nachholen — die Bedienung funktioniert auch so, nur ohne Auswahl der Bildquelle.' }),
                el('div', { class: 'knopfzeile' }, [weiter])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: 'Wie heißen die Anschlüsse bei euch?' }),
            el('div', { class: 'assistent-text', text: 'Der Beamer meldet diese Eingänge. Gib ihnen Namen, die jeder versteht — und nimm den Haken weg bei allem, was ihr nie benutzt.' }),
            el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: 'Eingang' }),
                el('span', { text: 'Name' }),
                el('span', { class: 'haken', text: 'Zeigen' })
            ])
        ].concat(zeilen).concat([
            el('div', { class: 'knopfzeile' }, [
                weiter,
                el('button', { class: 'knopf text', onclick: async function () { ctx.store.setSources(entwuerfe); await ctx.store.save(); schritt = 4; neuZeichnen(); } }, ['Später erledigen'])
            ])
        ]));
    }

    // ---------- Schritt 4: fertig ----------

    function schritt4() {
        const sichtbar = ctx.store.get().sources.filter(function (s) { return s.visible; });
        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: 'Fertig' }),
            el('div', { class: 'assistent-text', text: 'Die Bedienung zeigt ab jetzt ' + (sichtbar.length ? sichtbar.length + ' Bildquelle(n)' : 'keine Bildquellen') + ' und den Ein/Aus-Schalter. Alles Technische liegt hinter dem Zahnrad oben rechts.' }),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf haupt',
                    onclick: async function () {
                        ctx.store.markSetupComplete();
                        await ctx.store.save();
                        ctx.beamer.start();
                        ctx.beamer.refreshNow();
                        window.App.showView('operate');
                    }
                }, ['Zur Bedienung'])
            ])
        ]);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-setup');
        ui.clear(wurzel);
        const inhalt = schritt === 1 ? schritt1() : (schritt === 2 ? schritt2() : (schritt === 3 ? schritt3() : schritt4()));
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [schrittleiste(), inhalt]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render
    };
})();
```

- [ ] **Step 2: Abbruch mitten im Assistenten überstehen**

Die Verbindung wird in Schritt 2 bereits gespeichert, `setupCompleted` erst in Schritt 4. Wer die App in Schritt 3 schließt, startet beim nächsten Mal wieder im Assistenten — aber mit bereits eingetragener IP. Damit Schritt 1 dann übersprungen wird, in `view-setup.js` die `init`-Funktion ersetzen:

```js
        init: function (c) {
            ctx = c;
            // Wurde die Verbindung schon gespeichert, aber die Einrichtung nicht
            // beendet, geht es beim Benennen weiter statt wieder beim Suchen.
            const verb = ctx.store.get().connection;
            if (verb.host) {
                auswahl = { host: verb.host, port: verb.port, name: null };
                passwort = verb.password || '';
                schritt = 2;
            }
        },
```

- [ ] **Step 3: Tests laufen lassen**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Von Hand prüfen — Ersteinrichtung von null**

Die Einstellungsdatei löschen und die App starten:

```bash
rm -f ~/Library/Application\ Support/beamer-steuerung/beamer-settings.json
npm start
```

Expected: Der Assistent erscheint bei Schritt 1. „Beamer suchen“ zeigt einen wachsenden Balken und findet den Optoma. Auswählen → Schritt 2 zeigt den Gerätenamen → „Weiter“ verbindet und liest die Eingänge → Schritt 3 listet sie mit Vorschlagsnamen → „Weiter“ → Schritt 4 → „Zur Bedienung“. Danach zeigt die Bedienung den Zustand des echten Beamers. Ein Neustart der App führt direkt in die Bedienung, ohne Assistent.

- [ ] **Step 5: Commit**

```bash
git add renderer/js/view-setup.js
git commit -m "Baue Einrichtungsassistenten mit Netzwerksuche und Quellenbenennung"
```

---

### Task 8: Abnahme

**Files:**
- Modify: `package.json` (Version)
- Create: `docs/superpowers/plans/2026-08-08-abnahme.md`

**Interfaces:**
- Consumes: alles Vorherige
- Produces: nichts für den Code

- [ ] **Step 1: Vollständigen Testlauf**

Run: `npm test`
Expected: PASS, alle Tests aus `test/store.test.js` und `test/beamer.test.js`

- [ ] **Step 2: Prüfliste von Hand abarbeiten**

`docs/superpowers/plans/2026-08-08-abnahme.md` anlegen und beim Durchgehen abhaken:

```markdown
# Abnahme — Neugestaltung der Oberfläche

## Bedienung
- [ ] Beamer aus: genau ein Knopf, sonst nichts
- [ ] Einschalten: Knopf sperrt, Aufwärmen wird angezeigt, danach erscheinen die Kacheln
- [ ] Bildquelle wechseln: Kachel wird nach Bestätigung durch den Beamer hervorgehoben
- [ ] Bild ausblenden: Chip wird gelb, der Streifen erscheint, „Bild wieder zeigen“ funktioniert
- [ ] Ton stumm getrennt schaltbar — Video bleibt dabei unberührt
- [ ] Ausschalten: Rückfrage erscheint, Abbrechen tut nichts, Bestätigen schaltet aus
- [ ] Abkühlen: Einschalten ist gesperrt, bis der Beamer „Aus“ meldet
- [ ] Fernbedienung am Beamer benutzen: die Oberfläche zieht binnen ~5 Sekunden nach
- [ ] Netzwerkkabel ziehen: nach ~15 Sekunden „Kein Kontakt zum Beamer“, ohne technischen Fehlertext
- [ ] Kabel wieder einstecken: die App findet von allein zurück

## Technik-Seite
- [ ] Zahnrad öffnet und schließt die Seite
- [ ] Verbindung testen meldet Erfolg mit Gerätenamen
- [ ] Netzwerksuche zeigt Fortschritt und Treffer
- [ ] Eingänge einlesen füllt die Tabelle, vergebene Namen bleiben erhalten
- [ ] Umbenennen, Haken und Umsortieren wirken sofort auf die Bedienung
- [ ] Protokoll kopieren legt den Text in die Zwischenablage
- [ ] Einrichtung neu starten führt in den Assistenten

## Darstellung
- [ ] ◐ in der Kopfzeile schaltet hell/dunkel
- [ ] Auswahl übersteht einen Neustart
- [ ] „Wie das Betriebssystem“ folgt einem Wechsel des Systemdesigns
- [ ] Hoher Kontrast wirkt in hell und in dunkel
- [ ] Kein Text ist unlesbar, keine Farbe fest verdrahtet

## Einrichtung
- [ ] Ohne Einstellungsdatei startet der Assistent
- [ ] Abbruch in Schritt 3, Neustart: es geht bei Schritt 2 weiter
- [ ] Ohne gefundenen Beamer erscheint die Prüfliste, nicht eine Fehlermeldung
```

- [ ] **Step 3: Version anheben**

In `package.json` `"version": "1.0.0"` auf `"2.0.0"` ändern — die Oberfläche ist vollständig ersetzt und die alte Einstellungsdatei wird nicht mehr gelesen.

- [ ] **Step 4: Commit**

```bash
git add package.json docs/superpowers/plans/2026-08-08-abnahme.md
git commit -m "Hebe auf Version 2.0.0 und ergänze Abnahme-Prüfliste"
```
