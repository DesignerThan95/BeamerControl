// The application's settings: validate, load, hold in memory, write out.
// Knows neither DOM nor projector. Runs in the renderer and in Node (for the tests).
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

    // Extra features from PJLink Class 2. Each entry is one thing the technical
    // staff can enable — not a single PJLink command. Which commands are behind
    // them is documented in main.js.
    const CLASS2_FEATURES = [
        'volume',        // speaker and microphone volume (SVOL, MVOL)
        'freeze',        // freeze picture (FREZ)
        'deviceDetails', // serial number and software version (SNUM, SVER)
        'inputNames',    // input names from the projector (INNM)
        'resolution',    // incoming and recommended resolution (IRES, RRES)
        'maintenance'    // filter hours and replacement part numbers (FILT, RLMP, RFIL)
    ];

    const DEFAULTS = {
        version: SCHEMA_VERSION,
        connection: { host: '', port: 4352, password: null },
        sources: [],
        appearance: { theme: 'system', highContrast: false },
        // null means: no choice made yet — then the operating system's language
        // applies. An existing file without this field lands exactly here,
        // without any migration.
        language: null,
        setupCompleted: false,
        // Nothing is on by itself: a button with no command behind it is worse
        // than a missing button.
        enabledClass2Features: []
    };

    function copyDefaults() {
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    // Builds a complete, valid settings object out of any input.
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

        // Only the shape is checked here, not whether the language exists:
        // which languages the app ships is the translation helper's business.
        // Otherwise this file would need changing for every new language.
        if (typeof raw.language === 'string' && /^[a-z]{2}$/.test(raw.language)) {
            out.language = raw.language;
        }

        if (Array.isArray(raw.enabledClass2Features)) {
            out.enabledClass2Features = CLASS2_FEATURES.filter(function (key) {
                return raw.enabledClass2Features.indexOf(key) !== -1;
            });
        }

        out.setupCompleted = raw.setupCompleted === true;
        return out;
    }

    // Only files with a matching version count. Anything else means: set up again.
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

            setClass2Features(list) {
                settings.enabledClass2Features = normalize({
                    version: SCHEMA_VERSION,
                    enabledClass2Features: list
                }).enabledClass2Features;
            },

            isClass2FeatureEnabled(key) {
                return settings.enabledClass2Features.indexOf(key) !== -1;
            },

            // null takes the choice back: the operating system decides again.
            setLanguage(language) {
                settings.language = normalize({ version: SCHEMA_VERSION, language }).language;
            },

            getLanguage() {
                return settings.language;
            },

            setAppearance(appearance) {
                settings.appearance = normalize({ version: SCHEMA_VERSION, appearance }).appearance;
            },

            markSetupComplete() {
                settings.setupCompleted = true;
            },

            resetSetup() {
                settings.setupCompleted = false;
            }
        };
    }

    return { createStore, normalize, DEFAULTS, SCHEMA_VERSION, CLASS2_FEATURES };
});
