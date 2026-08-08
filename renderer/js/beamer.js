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
