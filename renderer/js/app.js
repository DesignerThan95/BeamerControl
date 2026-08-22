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
    let muteHinweisGezeigt = false;

    function featureName(key) {
        const f = App.viewTech.FEATURES.find(function (x) { return x.key === key; });
        return f ? f.titel : key;
    }

    // Kennt der Beamer einen Class-2-Befehl nicht, antwortet er mit ERR1.
    // Dann wird die zugehörige Funktion dauerhaft abgeschaltet, statt bei
    // jedem Druck dieselbe Fehlermeldung zu erzeugen. Das Ergebnis wird
    // ausgepackt, damit der Rest der App nur den Wert sieht.
    async function class2(key, fn) {
        const erg = await fn();
        if (erg && erg.supported === false) {
            const rest = store.get().enabledClass2Features.filter(function (k) { return k !== key; });
            store.setClass2Features(rest);
            await store.save();
            log.add('Der Beamer kennt „' + featureName(key) + '" nicht — die Funktion wurde abgeschaltet.', 'info');
            zeichnen();
            throw new Error('Undefined command');
        }
        return erg ? erg.value : undefined;
    }

    App.class2 = class2;

    // Was der Beamer zuletzt über seinen PJLink-Stand gesagt hat. Nur um
    // dieselbe Meldung nicht bei jedem Verbindungsversuch zu wiederholen.
    let klassenMeldung = null;

    // „Class 1" kann zweierlei heißen: der Beamer hat es gesagt, oder die
    // Frage blieb offen. Das gehört ins Protokoll, sonst liest sich ein
    // Zeitablauf später wie eine Feststellung über das Gerät.
    function protokolliereKlasse(erg) {
        if (!erg || typeof erg.pjlinkClass !== 'number') return;

        const kennung = erg.pjlinkClassSource + '|' + erg.pjlinkClass + '|' + (erg.pjlinkClassDetail || '');
        if (kennung === klassenMeldung) return;
        klassenMeldung = kennung;

        if (erg.pjlinkClassSource === 'gemeldet') {
            log.add('Der Beamer meldet PJLink Class ' + erg.pjlinkClass + '.', 'ok');
        } else if (erg.pjlinkClassSource === 'unbeantwortet') {
            log.add('Die Frage nach dem PJLink-Stand (CLSS) blieb unbeantwortet: ' + erg.pjlinkClassDetail + '. Es gelten vorsichtshalber die Regeln von Class 1 — ob der Beamer wirklich nur Class 1 kann, ist damit nicht gesagt.', 'fehler');
        } else if (erg.pjlinkClassSource === 'unklar') {
            log.add('Auf die Frage nach dem PJLink-Stand (CLSS) kam „' + erg.pjlinkClassDetail + '" zurück — damit lässt sich nichts anfangen. Es gelten vorsichtshalber die Regeln von Class 1.', 'fehler');
        }
    }

    const beamer = App.beamer.createBeamer({
        isFeatureEnabled: function (key) { return store.isClass2FeatureEnabled(key); },
        api: {
            connect: async function () {
                const c = store.get().connection;
                const erg = await api.connect({ host: c.host, port: c.port, password: c.password });
                protokolliereKlasse(erg);
                return erg;
            },
            getPowerState: api.getPowerState,
            getCurrentInput: api.getCurrentInput,
            getMuteState: api.getMuteState,
            powerOn: api.powerOn,
            powerOff: api.powerOff,
            setInput: api.setInput,
            setMute: async function (m) {
                const erg = await api.setMute(m);
                // Kann der Beamer Bild und Ton nur gemeinsam stummschalten,
                // gehört das ins Protokoll — sonst wundert sich die Technik,
                // warum beide Schalter gemeinsam umspringen.
                if (erg && erg.mode === 'gemeinsam' && !muteHinweisGezeigt) {
                    muteHinweisGezeigt = true;
                    log.add('Dieser Beamer kann Bild und Ton nur gemeinsam stummschalten — beide Schalter wirken deshalb zusammen.', 'info');
                }
                return erg;
            },

            // ---- PJLink Class 2 ----
            getFreeze: function () { return class2('freeze', function () { return api.getFreeze(); }); },
            setFreeze: function (an) { return class2('freeze', function () { return api.setFreeze(an); }); },
            speakerVolumeUp: function () { return class2('volume', function () { return api.speakerVolume('up'); }); },
            speakerVolumeDown: function () { return class2('volume', function () { return api.speakerVolume('down'); }); },
            microphoneVolumeUp: function () { return class2('volume', function () { return api.microphoneVolume('up'); }); },
            microphoneVolumeDown: function () { return class2('volume', function () { return api.microphoneVolume('down'); }); }
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
            // Nur die Bedienung folgt dem Beamer. Die Technik-Seite würde sonst
            // mitten im Tippen neu gezeichnet und der Fokus ginge verloren.
            if (aktiveAnsicht === 'operate') zeichnen();
        });

        if (!store.isSetupComplete()) {
            log.add('Keine gültigen Einstellungen gefunden — Einrichtung wird gestartet', 'info');
            showView('setup');
            return;
        }

        // Erst zeigen, dann verbinden: der Verbindungsaufbau kann Sekunden dauern,
        // und ein leeres Fenster ist das Schlimmste, was hier stehen kann.
        // Den Aufbau übernimmt die Zustandsmaschine selbst.
        const c = store.get().connection;
        log.add('Verbinde mit ' + c.host + ':' + c.port, 'info');
        showView('operate');
        beamer.start();
    }

    window.addEventListener('load', start);
})(window.App);
