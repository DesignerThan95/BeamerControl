// Sets i18next up and adds the two things it does not concern itself with:
// what a language calls itself, and which languages we ship.
//
// Everything else goes straight through i18next — i18next.t() for lookups,
// i18next.changeLanguage() for switching, fallbackLng for missing keys and for
// languages that failed to load. There is no lookup logic of our own left.
//
// The resources are not loaded here either. i18next's own loading is a backend
// plugin built on fetch/XHR, which cannot reach a file:// path from a
// context-isolated renderer. They are read by the main process (see
// resources.js) and arrive over the context bridge as `window.i18nResources`.
(function (root, factory) {
    // In the renderer i18next is the global from vendor/i18next.min.js; under
    // Node (the tests) it comes from node_modules.
    const i18next = (typeof module === 'object' && module.exports) ? require('i18next') : root.i18next;
    const api = factory(i18next);

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.App = root.App || {};
        root.App.i18n = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (i18next) {

    const FALLBACK_LANGUAGE = 'en';
    const NAMESPACE = 'translation';

    // What was handed to init(). i18next keeps its own copy, but which
    // languages this app ships is our question to answer, not one of its.
    let resources = {};

    // https://www.i18next.com/overview/getting-started
    //
    // `lng` is worked out by the app before this is called: the choice stored
    // in beamer-settings.json, or else the operating system's locale. That is
    // our business logic, which is why it arrives ready-made.
    function init(language, initialResources) {
        resources = initialResources || {};

        return new Promise(function (resolve, reject) {
            i18next.init({
                lng: language,
                fallbackLng: FALLBACK_LANGUAGE,
                resources: resources,

                // The one default that is deliberately overridden.
                //
                // i18next escapes interpolated values for HTML, which is right
                // when the result is written into innerHTML. Nothing here does
                // that: every text goes onto the page through textContent (see
                // ui.js), which does not parse markup. Left on, a projector
                // reporting itself as "Sanyo & Co" would show up on screen as
                // "Sanyo &amp; Co", and so would any error message containing
                // a quote or an angle bracket.
                //
                // https://www.i18next.com/translation-function/interpolation#unescape
                interpolation: { escapeValue: false },

                // Off by default; switch it on while working on translations
                // and i18next reports missing keys on the console.
                debug: false
            }, function (error) {
                if (error) reject(error); else resolve(i18next);
            });
        });
    }

    // The languages that actually loaded. A locale file that failed to parse
    // never made it into the resources, so it is offered nowhere.
    function supportedLanguages() {
        return Object.keys(resources).sort();
    }

    // The name of a language, written in that language ("Deutsch", "English").
    //
    // getResource() rather than t(): it reads one language's own bundle and
    // does not fall back. That is the whole point — the language picker has to
    // stay readable for someone who cannot read the language currently set, so
    // borrowing the English name for a catalog that forgot `languageName`
    // would be exactly wrong. Falling back to the code makes the omission
    // visible instead.
    function languageName(language) {
        const own = i18next.getResource(language, NAMESPACE, 'languageName');
        return typeof own === 'string' && own ? own : language;
    }

    // The shipped languages, sorted by the name each one calls itself — that is
    // the order they appear in on screen, so it is the order that matters.
    function languagesByName() {
        return supportedLanguages().sort(function (a, b) {
            return languageName(a).localeCompare(languageName(b));
        });
    }

    return {
        init: init,
        supportedLanguages: supportedLanguages,
        languageName: languageName,
        languagesByName: languagesByName,
        FALLBACK_LANGUAGE: FALLBACK_LANGUAGE,
        NAMESPACE: NAMESPACE
    };
});
