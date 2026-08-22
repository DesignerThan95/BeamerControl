const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const i18n = require('../renderer/js/i18n');

const LOCALES = path.join(__dirname, '..', 'locales');
// Whatever is in the folder — a new locales/xx.json must not force a change
// to this file, that is the whole promise made in locales/README.md.
const SHIPPED = fs.readdirSync(LOCALES)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
const de = JSON.parse(fs.readFileSync(path.join(LOCALES, 'de.json'), 'utf-8'));
const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en.json'), 'utf-8'));

// Builds a throwaway locales directory from {name: contents} and cleans it up.
function withLocaleFiles(files, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locales-'));
    Object.keys(files).forEach(function (name) {
        fs.writeFileSync(path.join(dir, name), files[name], 'utf-8');
    });

    // The loader reports broken files on the console. That is wanted in the
    // app and only noise here, so it is captured and handed to the test.
    const realError = console.error;
    const reported = [];
    console.error = function (message) { reported.push(String(message)); };

    try {
        return fn(dir, reported);
    } finally {
        console.error = realError;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Runs `fn` with `translations` swapped for something else, then puts the real
// catalogs back — the helper reads them from there, and the other tests in
// this file depend on the real ones.
function withCatalogs(replacement, fn) {
    const real = globalThis.translations;
    globalThis.translations = replacement;
    try {
        return fn();
    } finally {
        globalThis.translations = real;
        i18n.setLanguage(i18n.FALLBACK_LANGUAGE);
    }
}

// The helper starts every test from the same place: requiring it once per file
// means the language survives between tests otherwise.
test.beforeEach(() => { i18n.setLanguage(i18n.FALLBACK_LANGUAGE); });

// ---------- Reading the locale files ----------

// Every file in the folder has to parse — that is what stops a broken
// translation from reaching a release.
test('every shipped locale file is valid JSON', () => {
    const loaded = i18n.loadCatalogsFrom(LOCALES);
    assert.deepStrictEqual(Object.keys(loaded).sort(), SHIPPED, 'none of them was skipped');
});

test('the shipped locale files are read off disk', () => {
    const loaded = i18n.loadCatalogsFrom(LOCALES);
    assert.strictEqual(loaded.de.operate.powerOn, 'Beamer einschalten');
    assert.strictEqual(loaded.en.operate.powerOn, 'Turn projector on');
});

test('the file name is the language code', () => {
    withLocaleFiles({ 'pt.json': JSON.stringify({ languageName: 'Português' }) }, (dir) => {
        const loaded = i18n.loadCatalogsFrom(dir);
        assert.deepStrictEqual(Object.keys(loaded), ['pt']);
    });
});

// ---------- A broken locale file must not take the app down ----------

// The point of the whole exercise: a contributor's bad pull request, or a
// non-developer editing a file by hand, may cost that one language — never the
// app's ability to start.
test('a malformed locale file is skipped and reported, the rest loads', () => {
    withLocaleFiles({
        'en.json': JSON.stringify(en),
        'de.json': '{ "common": { "cancel": "Abbrechen"'   // truncated on purpose
    }, (dir, reported) => {
        const loaded = i18n.loadCatalogsFrom(dir);

        assert.deepStrictEqual(Object.keys(loaded), ['en'], 'the broken language is dropped, the good one stays');
        assert.strictEqual(reported.length, 1, 'and the reason is reported');
        assert.match(reported[0], /de\.json/, 'naming the file that is broken');
    });
});

test('a language whose file is broken falls back to English on screen', () => {
    withLocaleFiles({
        'en.json': JSON.stringify(en),
        'de.json': 'this is not JSON at all'
    }, (dir) => {
        withCatalogs(i18n.loadCatalogsFrom(dir), () => {
            assert.strictEqual(i18n.setLanguage('de'), 'en', 'German cannot be set, so English applies');
            assert.strictEqual(i18n.t('operate.powerOn'), 'Turn projector on', 'and real text is shown, not keys');
            assert.strictEqual(i18n.normalizeLanguage('de-CH'), 'en', 'a German operating system gets English too');
        });
    });
});

// Even with nothing readable at all the helper has to answer, so that whatever
// calls it keeps running. Keys on screen are a broken UI — not a dead app.
test('with no locale files at all the app still gets answers', () => {
    withLocaleFiles({}, (dir) => {
        withCatalogs(i18n.loadCatalogsFrom(dir), () => {
            assert.deepStrictEqual(i18n.supportedLanguages(), []);
            assert.strictEqual(i18n.setLanguage('de'), 'en');
            assert.strictEqual(i18n.t('operate.powerOn'), 'operate.powerOn');
            assert.strictEqual(i18n.languagesByName().length, 0);
        });
    });
});

test('a missing locales directory is reported, not thrown', () => {
    withLocaleFiles({}, (dir, reported) => {
        const loaded = i18n.loadCatalogsFrom(path.join(dir, 'does-not-exist'));
        assert.deepStrictEqual(loaded, {});
        assert.strictEqual(reported.length, 1);
    });
});

// ---------- Which languages are on board ----------

test('the shipped languages are found', () => {
    assert.deepStrictEqual(i18n.supportedLanguages(), SHIPPED);
    assert.strictEqual(i18n.isSupported('de'), true);
    assert.strictEqual(i18n.isSupported('en'), true);
    assert.strictEqual(i18n.isSupported('zz'), false);
});

// ---------- Names of the languages ----------

test('a language is named in its own language', () => {
    assert.strictEqual(i18n.languageName('de'), 'Deutsch');
    assert.strictEqual(i18n.languageName('en'), 'English');
});

// The whole point: the picker has to stay readable for someone who cannot read
// the language currently set.
test('the name does not follow the language in use', () => {
    i18n.setLanguage('en');
    assert.strictEqual(i18n.languageName('de'), 'Deutsch');
    i18n.setLanguage('de');
    assert.strictEqual(i18n.languageName('en'), 'English');
});

test('a language without a name of its own falls back to its code', () => {
    assert.strictEqual(i18n.languageName('fr'), 'fr');
});

test('the languages come sorted by the name they call themselves', () => {
    const expected = SHIPPED.slice().sort(function (a, b) {
        return i18n.languageName(a).localeCompare(i18n.languageName(b));
    });
    assert.deepStrictEqual(i18n.languagesByName(), expected);
    assert.ok(i18n.languagesByName().indexOf('de') < i18n.languagesByName().indexOf('en'),
        'Deutsch before English');
});

// Sorting by code and sorting by name are not the same thing. A language whose
// code sorts last but whose name sorts first has to come first on screen.
test('sorting follows the name, not the code', () => {
    withCatalogs({
        zz: { languageName: 'Alemannisch' },
        aa: { languageName: 'Zulu' }
    }, () => {
        assert.deepStrictEqual(i18n.languagesByName(), ['zz', 'aa'], 'by name');
        assert.deepStrictEqual(i18n.supportedLanguages(), ['aa', 'zz'], 'by code it is the other way round');
    });
});

// ---------- Looking texts up ----------

test('t returns the text of the current language', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('operate.powerOn'), 'Beamer einschalten');

    i18n.setLanguage('en');
    assert.strictEqual(i18n.t('operate.powerOn'), 'Turn projector on');
});

test('nested keys are walked through', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('tech.features.freeze.title'), 'Standbild');
    assert.strictEqual(i18n.t('operate.connector.network'), 'Netzwerk');
});

test('a language can be asked for explicitly', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('operate.powerOn', null, 'en'), 'Turn projector on');
    assert.strictEqual(i18n.getCurrentLanguage(), 'de', 'that must not change the setting');
});

// ---------- Placeholders ----------

test('placeholders are filled in', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('tech.hours', { count: 1234 }), '1234 Stunden');
    assert.strictEqual(
        i18n.t('tech.connectedWith', { manufacturer: 'Optoma', model: 'EH412' }),
        'Verbunden — Optoma EH412'
    );
});

// A placeholder without a value has to stay visible. Swallowing it silently
// would leave a sentence that reads fine and says the wrong thing.
test('a placeholder without a value stays as it is', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('tech.hours', {}), '{count} Stunden');
    assert.strictEqual(i18n.t('tech.hours'), '{count} Stunden');
});

// ---------- Falling back ----------

test('a key missing in one language comes from the fallback language', () => {
    globalThis.translations.testonly = { common: { cancel: 'Nope' } };
    try {
        i18n.setLanguage('testonly');
        assert.strictEqual(i18n.t('common.cancel'), 'Nope', 'its own value wins');
        assert.strictEqual(i18n.t('operate.powerOn'), en.operate.powerOn, 'the rest comes from English');
    } finally {
        delete globalThis.translations.testonly;
    }
});

// A key on screen is a missing translation — easier to spot and to fix than
// an empty label.
test('an unknown key returns itself', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('operate.doesNotExist'), 'operate.doesNotExist');
    assert.strictEqual(i18n.t('nonsense'), 'nonsense');
});

test('a key pointing at a group rather than a text returns itself', () => {
    i18n.setLanguage('de');
    assert.strictEqual(i18n.t('operate.connector'), 'operate.connector');
});

test('an empty key returns an empty text', () => {
    assert.strictEqual(i18n.t(''), '');
    assert.strictEqual(i18n.t(null), '');
});

test('an unsupported language falls back instead of emptying the screen', () => {
    assert.strictEqual(i18n.setLanguage('fr'), 'en');
    assert.strictEqual(i18n.getCurrentLanguage(), 'en');
    assert.strictEqual(i18n.t('operate.powerOn'), 'Turn projector on');
});

// ---------- Locale of the operating system ----------

test('a supported locale passes through', () => {
    assert.strictEqual(i18n.normalizeLanguage('de'), 'de');
    assert.strictEqual(i18n.normalizeLanguage('en'), 'en');
});

test('region and script are cut off', () => {
    assert.strictEqual(i18n.normalizeLanguage('de-CH'), 'de');
    assert.strictEqual(i18n.normalizeLanguage('de_DE'), 'de');
    assert.strictEqual(i18n.normalizeLanguage('en-US'), 'en');
    assert.strictEqual(i18n.normalizeLanguage('DE-AT'), 'de');
});

// A French Windows gets English, not a half-translated screen.
test('an unsupported locale falls back to English', () => {
    assert.strictEqual(i18n.normalizeLanguage('fr-FR'), 'en');
    assert.strictEqual(i18n.normalizeLanguage('ja'), 'en');
    assert.strictEqual(i18n.normalizeLanguage(''), 'en');
});

test('a missing locale falls back to English', () => {
    assert.strictEqual(i18n.normalizeLanguage(undefined), 'en');
    assert.strictEqual(i18n.normalizeLanguage(null), 'en');
    assert.strictEqual(i18n.normalizeLanguage(42), 'en');
});

// ---------- The catalogs themselves ----------

// The one check that catches drift: a key added to one language and forgotten
// in another shows up here instead of on someone's screen. Measured against
// en.json, because that is the fallback every lookup ends up in.
test('every language carries exactly the keys of the fallback language', () => {
    const flatten = (node, prefix) => {
        return Object.keys(node).reduce((keys, name) => {
            const keyPath = prefix ? prefix + '.' + name : name;
            const value = node[name];
            return keys.concat(typeof value === 'string' ? [keyPath] : flatten(value, keyPath));
        }, []);
    };

    const expected = flatten(en, '').sort();
    const loaded = i18n.loadCatalogsFrom(LOCALES);

    SHIPPED.forEach(function (code) {
        assert.deepStrictEqual(flatten(loaded[code], '').sort(), expected, code + '.json differs from en.json');
    });
});

test('German really is a full translation, not a stub', () => {
    assert.strictEqual(Object.keys(de).length, Object.keys(en).length);
    assert.notStrictEqual(de.operate.powerOn, en.operate.powerOn);
});
