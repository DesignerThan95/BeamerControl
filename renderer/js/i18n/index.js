// Translation helper. Knows no DOM and no projector, so it runs in the renderer
// and in Node (for the tests) alike.
//
// Catalogs are not loaded from here. Each language file registers itself on the
// shared `translations` namespace — in the browser through its own <script> tag,
// in Node by being required. Adding a language therefore means adding one file
// (plus its <script> tag in index.html); nothing in this file has to change.
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

    // Under Node there are no <script> tags, so the catalogs next to this file
    // are pulled in here. Reading the directory rather than listing the files
    // keeps the "one more file is a whole new language" promise on this side too.
    if (typeof module === 'object' && module.exports) {
        try {
            const fs = require('fs');
            const path = require('path');
            fs.readdirSync(__dirname)
                .filter(function (name) { return name.endsWith('.js') && name !== 'index.js'; })
                .forEach(function (name) { require(path.join(__dirname, name)); });
        } catch (error) {
            // No catalogs means every lookup returns its own key. That is a
            // visibly broken UI, not a crash — and never the case in the browser.
        }
    }

    function catalogs() {
        return root.translations || {};
    }

    function supportedLanguages() {
        return Object.keys(catalogs()).sort();
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
        FALLBACK_LANGUAGE: FALLBACK_LANGUAGE
    };
});
