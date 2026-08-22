// Zustandsmaschine des Beamers: fragt regelmäßig ab, sendet Befehle und wartet
// auf deren Bestätigung. Kennt kein DOM — deshalb ohne Fenster testbar.
//
// commandError trägt entweder den Wortlaut der PJLink-Bibliothek oder eine
// eigene Kennung ('command-not-confirmed', 'command-failed'). Fertige Sätze
// stehen hier keine: übersetzt wird erst im Bedien-Bildschirm.
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
    const SCHNELL_POLL_MS = 1000;   // kurz nach einem Befehl
    const SCHNELL_DAUER_MS = 20000; // so lange bleibt es schnell
    const COMMAND_TIMEOUT_MS = 30000;
    const BACKOFF_MS = [5000, 10000, 20000, 30000];
    const MAX_FEHLER = 3;

    const POWER_NAMEN = { 0: 'off', 1: 'on', 2: 'cooling', 3: 'warming' };

    function createBeamer(deps) {
        const api = deps.api;
        const schedule = deps.schedule;
        const cancel = deps.cancel;
        const now = deps.now;
        // Welche Class-2-Zusatzfunktionen die Technik freigeschaltet hat.
        // Ohne Auskunft gilt: keine — dann verhält sich alles wie vorher.
        const isFeatureEnabled = deps.isFeatureEnabled || function () { return false; };

        let state = {
            link: 'connecting',
            power: 'unknown',
            sourceCode: null,
            sourceName: null,
            mute: { video: false, audio: false },
            // Was der Beamer beim Verbinden über seinen PJLink-Stand meldet.
            // null heißt: noch nicht gefragt.
            pjlinkClass: null,
            // Woher diese Angabe stammt: 'gemeldet' (der Beamer hat geantwortet),
            // 'unbeantwortet' (die Abfrage lief ins Leere) oder 'unklar' (die
            // Antwort war weder 1 noch 2). Beide letzteren führen zu Class 1 —
            // aber das ist dann eine Vorsichtsannahme, keine Feststellung.
            pjlinkClassSource: null,
            freeze: false,
            pending: null,
            commandError: null
        };

        let hoerer = [];
        let timer = null;
        let laeuft = false;
        let fehlerInFolge = 0;
        let offlineVersuche = 0;
        let schnellBis = 0;
        let inTick = false;

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
            if (p.kind === 'freeze') return neu.freeze === p.target;
            if (p.kind === 'mute') {
                const ziel = p.target;
                if (neu.mute.video === ziel.video && neu.mute.audio === ziel.audio) return true;
                // Viele Beamer können Bild und Ton nur gemeinsam stummschalten.
                // Dann zählt, dass das Bild stimmt — sonst liefe der Befehl ewig.
                return neu.mute.video === neu.mute.audio && neu.mute.video === ziel.video;
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
                mute: state.mute,
                freeze: state.freeze
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

                // Nur fragen, wenn das Standbild auch freigeschaltet ist: ein
                // Beamer ohne Class 2 antwortet auf jede Abfrage mit ERR1.
                if (isFeatureEnabled('freeze')) {
                    try {
                        neu.freeze = (await api.getFreeze()) === true;
                    } catch (e) { /* siehe oben */ }
                }
            }

            return neu;
        }

        async function tick() {
            if (!laeuft) return;
            inTick = true;

            try {
                // Die Zustandsmaschine baut die Verbindung selbst auf. Solange sie
                // nicht steht, wird vor jeder Abfrage ein neuer Versuch unternommen.
                let klasse = state.pjlinkClass;
                let klasseHer = state.pjlinkClassSource;
                if (state.link !== 'online') {
                    const erg = await api.connect();
                    // Beim Verbinden sagt der Beamer, welchen PJLink-Stand er
                    // beherrscht. Danach richtet sich, was die Technik-Seite
                    // überhaupt zum Freischalten anbietet.
                    if (erg && typeof erg.pjlinkClass === 'number') {
                        klasse = erg.pjlinkClass;
                        klasseHer = erg.pjlinkClassSource || null;
                    }
                }
                const neu = await abfragen();
                fehlerInFolge = 0;
                offlineVersuche = 0;

                const teil = {
                    link: 'online',
                    power: neu.power,
                    sourceCode: neu.sourceCode,
                    sourceName: neu.sourceName,
                    mute: neu.mute,
                    freeze: neu.freeze,
                    pjlinkClass: klasse,
                    pjlinkClassSource: klasseHer
                };

                if (state.pending) {
                    if (befehlErfuellt(neu)) {
                        teil.pending = null;
                        teil.commandError = null;
                    } else if (now() - state.pending.startedAt >= COMMAND_TIMEOUT_MS) {
                        teil.pending = null;
                        teil.commandError = 'command-not-confirmed';
                    }
                }

                aendern(teil);
            } catch (e) {
                fehlerInFolge++;
                if (fehlerInFolge >= MAX_FEHLER && state.link !== 'offline') {
                    aendern({ link: 'offline', pending: null });
                }
                // Der nächste Durchlauf baut die Verbindung von selbst neu auf.
            }

            inTick = false;
            planen();
        }

        function planen() {
            if (!laeuft) return;
            let wartezeit = POLL_MS;
            if (state.link === 'offline') {
                const i = Math.min(offlineVersuche, BACKOFF_MS.length - 1);
                wartezeit = BACKOFF_MS[i];
                offlineVersuche++;
            } else if (now() < schnellBis) {
                // Kurz nach einem Befehl öfter nachfragen, damit die Anzeige
                // zügig nachzieht statt bis zu fünf Sekunden hinterherzuhinken.
                wartezeit = SCHNELL_POLL_MS;
            }
            timer = schedule(tick, wartezeit);
        }

        async function senden(kind, target, fn) {
            schnellBis = now() + SCHNELL_DAUER_MS;
            // Sofort umplanen, sonst greift die schnelle Abfrage erst nach dem
            // bereits laufenden Fünf-Sekunden-Takt. Läuft gerade ein Durchlauf,
            // übernimmt dessen eigenes planen() den neuen Takt.
            if (laeuft && !inTick) {
                if (timer !== null) cancel(timer);
                timer = schedule(tick, SCHNELL_POLL_MS);
            }
            aendern({
                pending: { kind: kind, target: target === undefined ? null : target, startedAt: now() },
                commandError: null
            });
            try {
                await fn();
            } catch (e) {
                // Wichtig: der Befehl ist gescheitert, die Verbindung aber nicht.
                // Die Bedienung muss weiter benutzbar bleiben — deshalb nur eine
                // Meldung setzen, die sich wegklicken lässt.
                aendern({ pending: null, commandError: e.message || 'command-failed' });
                throw e;
            }
        }

        // SVOL und MVOL haben in PJLink kein Abfrage-Pendant: es gibt keinen
        // Ist-Wert und damit nichts, worauf sich warten ließe. Solche Befehle
        // laufen am Bestätigungsweg vorbei — liefen sie darüber, hinge nach
        // jedem Tipp auf "lauter" die ganze Bedienung dreißig Sekunden fest.
        async function ohneBestaetigung(fn) {
            aendern({ commandError: null });
            try {
                await fn();
            } catch (e) {
                aendern({ commandError: e.message || 'command-failed' });
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

            dismissError: function () {
                aendern({ commandError: null });
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
            },

            // Das Standbild hat eine Abfrage und läuft deshalb ganz normal
            // über den Bestätigungsweg wie Einschalten oder Quellenwechsel.
            setFreeze: function (an) {
                const ziel = an === true;
                return senden('freeze', ziel, function () { return api.setFreeze(ziel); });
            },

            speakerVolumeUp: function () {
                return ohneBestaetigung(function () { return api.speakerVolumeUp(); });
            },

            speakerVolumeDown: function () {
                return ohneBestaetigung(function () { return api.speakerVolumeDown(); });
            },

            microphoneVolumeUp: function () {
                return ohneBestaetigung(function () { return api.microphoneVolumeUp(); });
            },

            microphoneVolumeDown: function () {
                return ohneBestaetigung(function () { return api.microphoneVolumeDown(); });
            }
        };
    }

    return { createBeamer, POLL_MS, COMMAND_TIMEOUT_MS, BACKOFF_MS };
});
