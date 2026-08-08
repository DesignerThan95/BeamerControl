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
