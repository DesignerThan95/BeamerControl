// Translation helper. Knows no DOM and no projector, so it runs in the renderer
// and in Node (for the tests) alike.
//
// The texts live in locales/*.json — plain data, so that translating this app
// never means editing JavaScript. Adding a language means adding one file;
// nothing in here has to change.
//
// The JSON is never read by the renderer itself: under file:// with context
// isolation, fetch() cannot reach a local file. Node reads it — the main
// process and the tests do so directly, and the renderer gets the parsed
// catalogs over the context bridge. The preload script cannot read them
// either: it runs sandboxed, where require() has no fs.
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.App = root.App || {};
        root.App.i18n = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {

    // The language every lookup falls back to: the one language guaranteed to
    // carry a value for every key.
    const FALLBACK_LANGUAGE = 'en';

    let currentLanguage = FALLBACK_LANGUAGE;

    // Reads every locales/*.json in a directory. The file name is the language
    // code: de.json becomes "de".
    //
    // Node only. Nothing in here throws: a locale file that is missing or
    // malformed — a contributor's bad pull request, someone editing by hand —
    // costs that one language and nothing else. The app still starts, and
    // whoever picked the broken language lands on English through
    // setLanguage(), which only accepts a language that actually loaded.
    function loadCatalogsFrom(directory) {
        const fs = require('fs');
        const path = require('path');
        const loaded = {};

        let files;
        try {
            files = fs.readdirSync(directory).filter(function (name) { return name.endsWith('.json'); });
        } catch (error) {
            console.error('[i18n] cannot read the locales directory ' + directory + ': ' + error.message);
            return loaded;
        }

        files.forEach(function (name) {
            const code = name.slice(0, -'.json'.length);
            try {
                loaded[code] = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf-8'));
            } catch (error) {
                console.error('[i18n] skipping locales/' + name + ': ' + error.message);
            }
        });

        return loaded;
    }

    // Under Node — the tests and the main process — the catalogs come straight
    // off disk. In the renderer they are already sitting on `translations`,
    // put there by the context bridge.
    if (typeof module === 'object' && module.exports) {
        const path = require('path');
        root.translations = Object.assign(
            root.translations || {},
            loadCatalogsFrom(path.join(__dirname, '..', '..', '..', 'locales'))
        );
    }

    function catalogs() {
        return root.translations || {};
    }

    function supportedLanguages() {
        return Object.keys(catalogs()).sort();
    }

    // The name of a language, written in that language ("Deutsch", "English").
    // It comes out of that language's own catalog, never out of the one in use:
    // someone who cannot read the current language still has to find their own.
    function languageName(language) {
        const own = lookup(catalogs()[language], 'languageName');
        return own !== undefined ? own : language;
    }

    // The shipped languages, sorted by the name each one calls itself — that is
    // the order they appear in on screen, so it is the order that matters.
    function languagesByName() {
        return supportedLanguages().sort(function (a, b) {
            return languageName(a).localeCompare(languageName(b));
        });
    }

    function isSupported(language) {
        return Object.prototype.hasOwnProperty.call(catalogs(), language);
    }

    // Walks a dotted key ("operate.powerOn") through a nested catalog.
    function lookup(catalog, key) {
        if (!catalog) return undefined;

        const parts = key.split('.');
        let node = catalog;

        for (let i = 0; i < parts.length; i++) {
            if (node === null || typeof node !== 'object') return undefined;
            node = node[parts[i]];
        }

        return typeof node === 'string' ? node : undefined;
    }

    // Fills {placeholders} from `values`. A placeholder without a value stays
    // as it is — that way a missing value shows up instead of vanishing.
    function interpolate(text, values) {
        if (!values) return text;

        return text.replace(/\{(\w+)\}/g, function (whole, name) {
            return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole;
        });
    }

    // t('operate.powerOn') — the current language, then the fallback language,
    // then the key itself. A key showing up on screen is a missing translation,
    // which is easier to spot and to fix than an empty label.
    function t(key, values, language) {
        if (typeof key !== 'string' || key === '') return '';

        const wanted = language || currentLanguage;
        const text = lookup(catalogs()[wanted], key);
        if (text !== undefined) return interpolate(text, values);

        const fallback = lookup(catalogs()[FALLBACK_LANGUAGE], key);
        if (fallback !== undefined) return interpolate(fallback, values);

        return key;
    }

    function setLanguage(language) {
        currentLanguage = isSupported(language) ? language : FALLBACK_LANGUAGE;
        return currentLanguage;
    }

    function getCurrentLanguage() {
        return currentLanguage;
    }

    // Turns an operating system locale ("de-CH", "en_US", "fr") into one of the
    // languages this app ships. Anything else becomes the fallback language:
    // a French Windows gets English, not a half-translated screen.
    function normalizeLanguage(locale) {
        if (typeof locale !== 'string') return FALLBACK_LANGUAGE;

        const base = locale.toLowerCase().split(/[-_]/)[0];
        return isSupported(base) ? base : FALLBACK_LANGUAGE;
    }

    return {
        t: t,
        setLanguage: setLanguage,
        getCurrentLanguage: getCurrentLanguage,
        normalizeLanguage: normalizeLanguage,
        isSupported: isSupported,
        supportedLanguages: supportedLanguages,
        languageName: languageName,
        languagesByName: languagesByName,
        // The parsed catalogs, for the main process to hand to the renderer.
        catalogs: catalogs,
        // Node only: reading a locale directory. Used by the tests.
        loadCatalogsFrom: loadCatalogsFrom,
        FALLBACK_LANGUAGE: FALLBACK_LANGUAGE
    };
});
