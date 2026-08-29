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
    // line would suddenly carry a German word. `lng` is i18next's documented
    // way of asking for one specific language regardless of the current one.
    function featureName(key) {
        return i18next.t('tech.features.' + key + '.title', { lng: i18n.FALLBACK_LANGUAGE });
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
    // then the operating system decides. Which language that ends up being is
    // our business logic; the switching itself is i18next's.
    async function resolveLanguage(choice) {
        return choice || await osLanguage();
    }

    // The header is fixed scaffolding in index.html and therefore not redrawn
    // with the views — it has to be caught up separately.
    function labelHeader() {
        const title = i18next.t('common.appTitle');
        // resolvedLanguage, not language: if the chosen language failed to load,
        // i18next is showing the fallback, and that is what the document is in.
        document.documentElement.lang = i18next.resolvedLanguage;
        document.title = title;
        document.querySelector('.kopf-titel').textContent = title;
        document.getElementById('themaKnopf').title = i18next.t('common.toggleThemeTitle');
        document.getElementById('technikKnopf').title = i18next.t('common.techTitle');
    }

    App.showView = showView;
    App.ctx = { store: store, projector: projector, theme: theme, api: api, log: log };

    // Called by the technical page and by the setup wizard. Persisting the
    // choice is ours; switching is i18next's. Redrawing is not done here — the
    // languageChanged listener below does that, for every source of a change.
    App.setLanguage = async function (choice) {
        store.setLanguage(choice);
        await store.save();
        await i18next.changeLanguage(await resolveLanguage(choice));
    };

    async function start() {
        await store.load();

        // The resources come from the main process through the context bridge;
        // see preload.js for why they cannot be read here.
        await i18n.init(await resolveLanguage(store.getLanguage()), window.i18nResources);
        labelHeader();

        // https://www.i18next.com/overview/api#onlanguagechanged — the one
        // trigger for redrawing after a language change, no matter who caused
        // it. Registered after init so the initial language does not fire it.
        i18next.on('languageChanged', function (language) {
            labelHeader();
            render();
            log.add('Language set to ' + language +
                (language === i18next.resolvedLanguage ? '' : ' (showing ' + i18next.resolvedLanguage + ', its file did not load)'), 'info');
        });

        // Errors nobody caught — in the main process and here in the window.
        // They belong in the activity log, where the technical staff can find
        // them, and nowhere else: the operating screen only shows what the
        // person in front of it can do something about.
        api.onMishap(function (mishap) {
            // The main process is Node and has a console of its own that this
            // window never sees. Its stack is written out here so that both
            // ends of the app end up in the one developer console.
            console.error('[main:' + mishap.where + ']', mishap.stack || mishap.message);
            log.add('Internal mishap (' + mishap.where + '): ' + mishap.message, 'error');
            if (activeView === 'tech') render();
        });

        window.addEventListener('unhandledrejection', function (e) {
            const reason = e.reason;
            console.error('[window:unhandledrejection]', (reason && reason.stack) || reason);
            log.add('Internal mishap (window): ' + ((reason && reason.message) || reason), 'error');
        });

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
