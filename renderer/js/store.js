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

    // Zusatzfunktionen aus PJLink Class 2. Jeder Eintrag ist eine Sache, die
    // die Technik freischalten kann — nicht ein einzelner PJLink-Befehl.
    // Welche Befehle dahinterstehen, steht in main.js.
    const CLASS2_FEATURES = [
        'volume',        // Lautstärke Lautsprecher und Mikrofon (SVOL, MVOL)
        'freeze',        // Standbild (FREZ)
        'deviceDetails', // Seriennummer und Softwarestand (SNUM, SVER)
        'inputNames',    // Eingangsnamen aus dem Beamer (INNM)
        'resolution',    // anliegende und empfohlene Auflösung (IRES, RRES)
        'maintenance'    // Filterstunden und Ersatzteilnummern (FILT, RLMP, RFIL)
    ];

    const DEFAULTS = {
        version: SCHEMA_VERSION,
        connection: { host: '', port: 4352, password: null },
        sources: [],
        appearance: { theme: 'system', highContrast: false },
        // null heißt: noch keine eigene Wahl getroffen — dann gilt die Sprache
        // des Betriebssystems. Eine bestehende Datei ohne dieses Feld landet
        // genau hier, ganz ohne Umstellung.
        language: null,
        setupCompleted: false,
        // Nichts ist von sich aus an: ein Knopf, hinter dem der Beamer keinen
        // Befehl kennt, ist schlimmer als ein fehlender Knopf.
        enabledClass2Features: []
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

        // Geprüft wird nur die Form, nicht ob es die Sprache gibt: welche
        // Sprachen die App mitbringt, weiß der Übersetzungs-Helfer. Sonst
        // müsste diese Datei bei jeder neuen Sprache mit geändert werden.
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

            setClass2Features(list) {
                settings.enabledClass2Features = normalize({
                    version: SCHEMA_VERSION,
                    enabledClass2Features: list
                }).enabledClass2Features;
            },

            isClass2FeatureEnabled(key) {
                return settings.enabledClass2Features.indexOf(key) !== -1;
            },

            // null nimmt die Wahl zurück: dann gilt wieder das Betriebssystem.
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
