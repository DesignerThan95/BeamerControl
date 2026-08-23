// Reads locales/*.json and shapes it the way i18next wants its resources
// passed in on init:
//
//   { en: { translation: { … } }, de: { translation: { … } } }
//
// See https://www.i18next.com/how-to/add-or-load-translations#pass-in-translations-on-init
//
// Node only, and on purpose. i18next's own way of loading files is a backend
// plugin built on fetch/XHR, which cannot work here: the renderer runs on
// file:// with context isolation, where fetch() cannot reach a local file and
// there is no fs. The preload script cannot read them either — it runs
// sandboxed, where require() serves only a handful of Electron modules. So the
// main process reads them and hands them to the renderer over IPC.
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', '..', '..', 'locales');

// The namespace i18next uses when none is given. Our keys carry no namespace,
// so everything lives in this one.
const NAMESPACE = 'translation';

// Nothing in here throws. A locale file that is missing or malformed — a
// contributor's bad pull request, someone editing by hand — costs that one
// language and nothing else. i18next then falls back to `fallbackLng` for it,
// so the app still starts and still has words on screen.
function loadResources(directory) {
    const dir = directory || LOCALES_DIR;
    const resources = {};

    let files;
    try {
        files = fs.readdirSync(dir).filter(function (name) { return name.endsWith('.json'); });
    } catch (error) {
        console.error('[i18n] cannot read the locales directory ' + dir + ': ' + error.message);
        return resources;
    }

    files.forEach(function (name) {
        const language = name.slice(0, -'.json'.length);
        try {
            const catalog = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
            resources[language] = {};
            resources[language][NAMESPACE] = catalog;
        } catch (error) {
            console.error('[i18n] skipping locales/' + name + ': ' + error.message);
        }
    });

    return resources;
}

// Turns an operating system locale ("de-CH", "en_US", "fr") into one of the
// languages that actually loaded. Anything else becomes English.
//
// This is our business, not i18next's: i18next would happily accept "fr" and
// fall back at lookup time, but we want to hand init() a language we know we
// have, so that the language dropdown and the stored setting agree with what
// is on screen.
function normalizeLanguage(locale, resources) {
    const available = resources || {};
    if (typeof locale !== 'string') return FALLBACK_LANGUAGE;

    const base = locale.toLowerCase().split(/[-_]/)[0];
    return Object.prototype.hasOwnProperty.call(available, base) ? base : FALLBACK_LANGUAGE;
}

// The language i18next falls back to, and the one language guaranteed to carry
// a value for every key.
const FALLBACK_LANGUAGE = 'en';

module.exports = {
    loadResources: loadResources,
    normalizeLanguage: normalizeLanguage,
    LOCALES_DIR: LOCALES_DIR,
    NAMESPACE: NAMESPACE,
    FALLBACK_LANGUAGE: FALLBACK_LANGUAGE
};
