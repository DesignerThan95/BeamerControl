// Wires up settings, projector state, appearance, language and the three views.
window.App = window.App || {};

(function (App) {
    const api = App.api;
    const log = App.log;
    const i18n = App.i18n;

    const store = App.store.createStore({
        load: function () { return api.loadSettings(); },
        save: function (obj) { return api.saveSettings(obj); }
    });

    const theme = App.theme.createTheme(store);
    let muteHintLogged = false;

    // The activity log is meant for the technical staff and stays English —
    // including the names of the extra features in it. Otherwise an English
    // line would suddenly carry a German word.
    function featureName(key) {
        return i18n.t('tech.features.' + key + '.title', null, i18n.FALLBACK_LANGUAGE);
    }

    // If the projector does not know a Class 2 command, it answers with ERR1.
    // The feature is then switched off for good instead of producing the same
    // error message on every press. The result is unwrapped so the rest of the
    // app only sees the value.
    async function class2(key, fn) {
        const result = await fn();
        if (result && result.supported === false) {
            const remaining = store.get().enabledClass2Features.filter(function (k) { return k !== key; });
            store.setClass2Features(remaining);
            await store.save();
            log.add('The projector does not know "' + featureName(key) + '" — the feature has been switched off.', 'info');
            render();
            throw new Error('Undefined command');
        }
        return result ? result.value : undefined;
    }

    App.class2 = class2;

    // What the projector last said about its PJLink level. Only so the same
    // message is not repeated on every connection attempt.
    let lastClassMessage = null;

    // "Class 1" can mean two things: the projector said so, or the question
    // went unanswered. That belongs in the activity log, otherwise a timeout
    // later reads like a finding about the device.
    function logProjectorClass(result) {
        if (!result || typeof result.pjlinkClass !== 'number') return;

        const signature = result.pjlinkClassSource + '|' + result.pjlinkClass + '|' + (result.pjlinkClassDetail || '');
        if (signature === lastClassMessage) return;
        lastClassMessage = signature;

        if (result.pjlinkClassSource === 'reported') {
            log.add('The projector reports PJLink Class ' + result.pjlinkClass + '.', 'ok');
        } else if (result.pjlinkClassSource === 'unanswered') {
            log.add('The question about the PJLink level (CLSS) went unanswered: ' + result.pjlinkClassDetail + '. The Class 1 rules apply as a precaution — that does not mean the projector is really limited to Class 1.', 'error');
        } else if (result.pjlinkClassSource === 'unclear') {
            log.add('The question about the PJLink level (CLSS) came back as "' + result.pjlinkClassDetail + '" — nothing can be made of that. The Class 1 rules apply as a precaution.', 'error');
        }
    }

    const projector = App.projector.createProjector({
        isFeatureEnabled: function (key) { return store.isClass2FeatureEnabled(key); },
        api: {
            connect: async function () {
                const c = store.get().connection;
                const result = await api.connect({ host: c.host, port: c.port, password: c.password });
                logProjectorClass(result);
                return result;
            },
            getPowerState: api.getPowerState,
            getCurrentInput: api.getCurrentInput,
            getMuteState: api.getMuteState,
            powerOn: api.powerOn,
            powerOff: api.powerOff,
            setInput: api.setInput,
            setMute: async function (m) {
                const result = await api.setMute(m);
                // If the projector can only mute picture and sound together,
                // that belongs in the activity log — otherwise the technical
                // staff wonder why both switches move at once.
                if (result && result.mode === 'combined' && !muteHintLogged) {
                    muteHintLogged = true;
                    log.add('This projector can only mute picture and sound together — both switches therefore act as one.', 'info');
                }
                return result;
            },

            // ---- PJLink Class 2 ----
            getFreeze: function () { return class2('freeze', function () { return api.getFreeze(); }); },
            setFreeze: function (on) { return class2('freeze', function () { return api.setFreeze(on); }); },
            speakerVolumeUp: function () { return class2('volume', function () { return api.speakerVolume('up'); }); },
            speakerVolumeDown: function () { return class2('volume', function () { return api.speakerVolume('down'); }); },
            microphoneVolumeUp: function () { return class2('volume', function () { return api.microphoneVolume('up'); }); },
            microphoneVolumeDown: function () { return class2('volume', function () { return api.microphoneVolume('down'); }); }
        },
        schedule: function (fn, ms) { return window.setTimeout(fn, ms); },
        cancel: function (id) { window.clearTimeout(id); },
        now: function () { return Date.now(); }
    });

    let activeView = null;

    function showView(name) {
        activeView = name;
        ['operate', 'tech', 'setup'].forEach(function (n) {
            const node = document.getElementById('ansicht-' + n);
            node.classList.toggle('aktiv', n === name);
        });
        document.getElementById('technikKnopf').style.display = (name === 'setup') ? 'none' : '';
        render();
    }

    function render() {
        if (activeView === 'operate' && App.viewOperate) App.viewOperate.render();
        if (activeView === 'tech' && App.viewTech) App.viewTech.render();
        if (activeView === 'setup' && App.viewSetup) App.viewSetup.render();
    }

    // ---------- Language ----------

    // Which language the operating system reports. If no usable answer comes
    // back, the fallback language stands — a missing answer must not keep the
    // app from starting.
    async function osLanguage() {
        try {
            return await api.getOsLocale();
        } catch (e) {
            return i18n.FALLBACK_LANGUAGE;
        }
    }

    // An explicitly chosen language beats the operating system, on every
    // further start, until it is changed again. null means: no choice made,
    // then the operating system decides.
    async function applyLanguage(choice) {
        i18n.setLanguage(choice || await osLanguage());
        labelHeader();
    }

    // The header is fixed scaffolding in index.html and therefore not redrawn
    // with the views — it has to be caught up separately.
    function labelHeader() {
        const title = i18n.t('common.appTitle');
        document.documentElement.lang = i18n.getCurrentLanguage();
        document.title = title;
        document.querySelector('.kopf-titel').textContent = title;
        document.getElementById('themaKnopf').title = i18n.t('common.toggleThemeTitle');
        document.getElementById('technikKnopf').title = i18n.t('common.techTitle');
    }

    App.showView = showView;
    App.ctx = { store: store, projector: projector, theme: theme, api: api, log: log };

    // Called by the technical page and by the setup wizard.
    App.setLanguage = async function (choice) {
        store.setLanguage(choice);
        await store.save();
        await applyLanguage(choice);
        log.add('Language set to ' + i18n.getCurrentLanguage() + (choice ? '' : ' (operating system)'), 'info');
        render();
    };

    async function start() {
        await store.load();
        await applyLanguage(store.getLanguage());
        theme.init(function () { render(); });

        if (App.viewOperate) App.viewOperate.init(App.ctx);
        if (App.viewTech) App.viewTech.init(App.ctx);
        if (App.viewSetup) App.viewSetup.init(App.ctx);

        document.getElementById('themaKnopf').addEventListener('click', async function () {
            const next = await theme.toggleAsync();
            log.add('Appearance set to ' + (next === 'dark' ? 'dark' : 'light'), 'info');
            render();
        });

        document.getElementById('technikKnopf').addEventListener('click', function () {
            showView(activeView === 'tech' ? 'operate' : 'tech');
        });

        projector.onChange(function () {
            // Only the controls follow the projector. The technical page would
            // otherwise be redrawn mid-typing and the focus would be lost.
            if (activeView === 'operate') render();
        });

        if (!store.isSetupComplete()) {
            log.add('No valid settings found — starting setup', 'info');
            showView('setup');
            return;
        }

        // Show first, connect second: building the connection can take seconds,
        // and an empty window is the worst thing that could stand here.
        // The state machine takes care of connecting by itself.
        const c = store.get().connection;
        log.add('Connecting to ' + c.host + ':' + c.port, 'info');
        showView('operate');
        projector.start();
    }

    window.addEventListener('load', start);
})(window.App);
