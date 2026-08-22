const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const i18next = require('i18next');

const resources = require('../renderer/js/i18n/resources');
const appI18n = require('../renderer/js/i18n');

const LOCALES = resources.LOCALES_DIR;
// Whatever is in the folder — a new locales/xx.json must not force a change
// to this file, that is the promise made in locales/README.md.
const SHIPPED = fs.readdirSync(LOCALES)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
const de = JSON.parse(fs.readFileSync(path.join(LOCALES, 'de.json'), 'utf-8'));
const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en.json'), 'utf-8'));

// A throwaway locales directory built from {name: contents}, cleaned up after.
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

// An i18next of its own, so a test cannot disturb the next one. This is
// i18next's documented way of running more than one configuration.
async function instanceWith(options) {
    const instance = i18next.createInstance();
    await instance.init(Object.assign({ fallbackLng: 'en' }, options));
    return instance;
}

// ---------- Reading the locale files ----------

// Every file in the folder has to parse — that is what stops a broken
// translation from reaching a release.
test('every shipped locale file is valid JSON', () => {
    const loaded = resources.loadResources(LOCALES);
    assert.deepStrictEqual(Object.keys(loaded).sort(), SHIPPED, 'none of them was skipped');
});

// The shape i18next expects on init, per
// https://www.i18next.com/how-to/add-or-load-translations#pass-in-translations-on-init
test('the loader produces i18next resources, namespaced', () => {
    const loaded = resources.loadResources(LOCALES);
    assert.deepStrictEqual(Object.keys(loaded.de), [resources.NAMESPACE]);
    assert.strictEqual(loaded.de[resources.NAMESPACE].operate.powerOn, 'Beamer einschalten');
    assert.strictEqual(loaded.en[resources.NAMESPACE].operate.powerOn, 'Turn projector on');
});

test('the file name is the language code', () => {
    withLocaleFiles({ 'pt.json': JSON.stringify({ languageName: 'Português' }) }, (dir) => {
        assert.deepStrictEqual(Object.keys(resources.loadResources(dir)), ['pt']);
    });
});

// ---------- A broken locale file must not take the app down ----------

// A contributor's bad pull request, or a non-developer editing a file by hand,
// may cost that one language — never the app's ability to start.
test('a malformed locale file is skipped and reported, the rest loads', () => {
    withLocaleFiles({
        'en.json': JSON.stringify(en),
        'de.json': '{ "common": { "cancel": "Abbrechen"'   // truncated on purpose
    }, (dir, reported) => {
        const loaded = resources.loadResources(dir);

        assert.deepStrictEqual(Object.keys(loaded), ['en'], 'the broken language is dropped, the good one stays');
        assert.strictEqual(reported.length, 1, 'and the reason is reported');
        assert.match(reported[0], /de\.json/, 'naming the file that is broken');
    });
});

// The fallback is i18next's own fallbackLng now, not something we do by hand:
// asking for a language that never loaded still yields English text.
test('a language whose file is broken falls back to English on screen', async () => {
    const loaded = withLocaleFiles({
        'en.json': JSON.stringify(en),
        'de.json': 'this is not JSON at all'
    }, (dir) => resources.loadResources(dir));

    const instance = await instanceWith({ lng: 'de', resources: loaded });

    assert.strictEqual(instance.t('operate.powerOn'), 'Turn projector on', 'real text, not keys');
    assert.strictEqual(instance.resolvedLanguage, 'en', 'English is what is actually on screen');
    assert.strictEqual(instance.hasResourceBundle('de', resources.NAMESPACE), false);
    // The intent is kept: once the file is repaired, German comes back by itself.
    assert.strictEqual(instance.language, 'de', 'the chosen language is remembered');
});

test('the operating system locale only yields a language that loaded', () => {
    const loaded = withLocaleFiles({
        'en.json': JSON.stringify(en),
        'de.json': 'broken'
    }, (dir) => resources.loadResources(dir));

    assert.strictEqual(resources.normalizeLanguage('de-CH', loaded), 'en', 'German did not load, so English');
    assert.strictEqual(resources.normalizeLanguage('en-US', loaded), 'en');
});

// Even with nothing readable at all, i18next has to keep answering so that
// whatever calls it keeps running. Keys on screen are a broken UI, not a dead app.
test('with no locale files at all the app still gets answers', async () => {
    const loaded = withLocaleFiles({}, (dir) => resources.loadResources(dir));
    assert.deepStrictEqual(loaded, {});

    const instance = await instanceWith({ lng: 'de', resources: loaded });
    assert.strictEqual(instance.t('operate.powerOn'), 'operate.powerOn');
});

test('a missing locales directory is reported, not thrown', () => {
    withLocaleFiles({}, (dir, reported) => {
        assert.deepStrictEqual(resources.loadResources(path.join(dir, 'does-not-exist')), {});
        assert.strictEqual(reported.length, 1);
    });
});

// ---------- Normalizing the operating system locale ----------

test('a supported locale passes through', () => {
    const loaded = resources.loadResources(LOCALES);
    assert.strictEqual(resources.normalizeLanguage('de', loaded), 'de');
    assert.strictEqual(resources.normalizeLanguage('en', loaded), 'en');
});

test('region and script are cut off', () => {
    const loaded = resources.loadResources(LOCALES);
    assert.strictEqual(resources.normalizeLanguage('de-CH', loaded), 'de');
    assert.strictEqual(resources.normalizeLanguage('de_DE', loaded), 'de');
    assert.strictEqual(resources.normalizeLanguage('DE-AT', loaded), 'de');
});

// A French Windows gets English, not a half-translated screen.
test('an unsupported or missing locale falls back to English', () => {
    const loaded = resources.loadResources(LOCALES);
    assert.strictEqual(resources.normalizeLanguage('fr-FR', loaded), 'en');
    assert.strictEqual(resources.normalizeLanguage('ja', loaded), 'en');
    assert.strictEqual(resources.normalizeLanguage('', loaded), 'en');
    assert.strictEqual(resources.normalizeLanguage(undefined, loaded), 'en');
    assert.strictEqual(resources.normalizeLanguage(null, loaded), 'en');
    assert.strictEqual(resources.normalizeLanguage(42, loaded), 'en');
});

// ---------- Looking texts up through i18next ----------

test('t returns the text of the current language', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    assert.strictEqual(instance.t('operate.powerOn'), 'Beamer einschalten');

    await instance.changeLanguage('en');
    assert.strictEqual(instance.t('operate.powerOn'), 'Turn projector on');
    assert.strictEqual(instance.language, 'en');
});

// Our keys are grouped by view and resolve through i18next's default
// keySeparator of '.', so nothing about the JSON had to be flattened.
test('nested keys resolve with the default key separator', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    assert.strictEqual(instance.t('tech.features.freeze.title'), 'Standbild');
    assert.strictEqual(instance.t('operate.connector.network'), 'Netzwerk');
});

test('a language can be asked for explicitly', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    assert.strictEqual(instance.t('operate.powerOn', { lng: 'en' }), 'Turn projector on');
    assert.strictEqual(instance.language, 'de', 'that must not change the setting');
});

test('placeholders are filled in', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    assert.strictEqual(
        instance.t('tech.connectedWith', { manufacturer: 'Optoma', model: 'EH412' }),
        'Verbunden — Optoma EH412'
    );
    assert.strictEqual(instance.t('tech.hours', { count: 1234 }), '1234 Stunden');
});

// The singular/plural branch used to sit in view-setup.js. i18next picks the
// form from `count`, which is why the keys are named found_one / found_other.
test('singular and plural come from the count', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    assert.strictEqual(instance.t('setup.found', { count: 1 }), 'Ein Gerät gefunden');
    assert.strictEqual(instance.t('setup.found', { count: 3 }), '3 Geräte gefunden');

    await instance.changeLanguage('en');
    assert.strictEqual(instance.t('setup.found', { count: 1 }), 'One device found');
    assert.strictEqual(instance.t('setup.found', { count: 3 }), '3 devices found');
});

// Everything reaches the page through textContent, which does not parse
// markup. If i18next escaped for HTML — its default — a projector calling
// itself "Sanyo & Co" would appear on screen as "Sanyo &amp; Co".
test('interpolated values are not HTML-escaped', async () => {
    await appI18n.init('de', resources.loadResources(LOCALES));

    assert.strictEqual(
        i18next.t('tech.connectedWith', { manufacturer: 'Sanyo & Co', model: '<PLC-XU>' }),
        'Verbunden — Sanyo & Co <PLC-XU>'
    );
    assert.strictEqual(
        i18next.t('common.connectionFailed', { message: 'port "4352" refused' }),
        'Keine Verbindung: port "4352" refused'
    );
});

// ---------- Falling back ----------

test('a key missing in one language comes from the fallback language', async () => {
    const loaded = resources.loadResources(LOCALES);
    loaded.testonly = {};
    loaded.testonly[resources.NAMESPACE] = { common: { cancel: 'Nope' } };

    const instance = await instanceWith({ lng: 'testonly', resources: loaded });
    assert.strictEqual(instance.t('common.cancel'), 'Nope', 'its own value wins');
    assert.strictEqual(instance.t('operate.powerOn'), en.operate.powerOn, 'the rest comes from English');
});

// A key on screen is a missing translation — easier to spot than a blank label.
test('an unknown key returns itself', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    assert.strictEqual(instance.t('operate.doesNotExist'), 'operate.doesNotExist');
    assert.strictEqual(instance.t('nonsense'), 'nonsense');
});

test('a key pointing at a group rather than a text does not return an object', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });
    const value = instance.t('operate.connector');
    assert.strictEqual(typeof value, 'string');
    assert.match(value, /operate\.connector/);
});

// ---------- Changing the language ----------

// The one trigger the app redraws on, per
// https://www.i18next.com/overview/api#onlanguagechanged
test('changeLanguage emits languageChanged', async () => {
    const instance = await instanceWith({ lng: 'de', resources: resources.loadResources(LOCALES) });

    const seen = [];
    instance.on('languageChanged', function (language) { seen.push(language); });

    await instance.changeLanguage('en');
    await instance.changeLanguage('de');

    assert.deepStrictEqual(seen, ['en', 'de']);
    assert.strictEqual(instance.t('operate.powerOn'), 'Beamer einschalten');
});

// ---------- What i18next does not do: the names of the languages ----------

test('the app helper reports the languages that loaded', async () => {
    await appI18n.init('de', resources.loadResources(LOCALES));
    assert.deepStrictEqual(appI18n.supportedLanguages(), SHIPPED);
});

test('a language is named in its own language', async () => {
    await appI18n.init('en', resources.loadResources(LOCALES));
    assert.strictEqual(appI18n.languageName('de'), 'Deutsch');
    assert.strictEqual(appI18n.languageName('en'), 'English');
});

// The whole point: the picker has to stay readable for someone who cannot read
// the language currently set — so this must not follow the current language,
// and must not borrow the English name for a catalog that has none.
test('the name is read from that language alone, never through the fallback', async () => {
    const loaded = resources.loadResources(LOCALES);
    loaded.xx = {};
    loaded.xx[resources.NAMESPACE] = { common: { cancel: 'x' } };   // no languageName

    await appI18n.init('en', loaded);
    assert.strictEqual(appI18n.languageName('de'), 'Deutsch', 'not "German"');
    assert.strictEqual(appI18n.languageName('xx'), 'xx', 'not "English"');
});

test('the languages come sorted by the name they call themselves', async () => {
    await appI18n.init('de', resources.loadResources(LOCALES));

    const expected = SHIPPED.slice().sort(function (a, b) {
        return appI18n.languageName(a).localeCompare(appI18n.languageName(b));
    });
    assert.deepStrictEqual(appI18n.languagesByName(), expected);
    assert.ok(appI18n.languagesByName().indexOf('de') < appI18n.languagesByName().indexOf('en'),
        'Deutsch before English');
});

// Sorting by code and sorting by name are not the same thing.
test('sorting follows the name, not the code', async () => {
    const loaded = {};
    loaded.zz = {}; loaded.zz[resources.NAMESPACE] = { languageName: 'Alemannisch' };
    loaded.aa = {}; loaded.aa[resources.NAMESPACE] = { languageName: 'Zulu' };

    await appI18n.init('zz', loaded);
    assert.deepStrictEqual(appI18n.languagesByName(), ['zz', 'aa'], 'by name');
    assert.deepStrictEqual(appI18n.supportedLanguages(), ['aa', 'zz'], 'by code it is the other way round');
});

// ---------- The catalogs themselves ----------

// i18next's plural suffixes. A language may carry more of them than English
// does — Polish needs _few and _many where English gets by with _other — so
// they are folded away before the key sets are compared.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flattenKeys(node, prefix) {
    return Object.keys(node).reduce((keys, name) => {
        const keyPath = prefix ? prefix + '.' + name : name;
        const value = node[name];
        return keys.concat(typeof value === 'string' ? [keyPath] : flattenKeys(value, keyPath));
    }, []);
}

function keySet(catalog) {
    const keys = flattenKeys(catalog, '').map((key) => key.replace(PLURAL_SUFFIX, '_PLURAL'));
    return [...new Set(keys)].sort();
}

// The one check that catches drift: a key added to one language and forgotten
// in another shows up here instead of on someone's screen. Measured against
// en.json, because that is the fallback every lookup ends up in.
test('every language carries exactly the keys of the fallback language', () => {
    const expected = keySet(en);
    const loaded = resources.loadResources(LOCALES);

    SHIPPED.forEach(function (code) {
        assert.deepStrictEqual(keySet(loaded[code][resources.NAMESPACE]), expected,
            code + '.json differs from en.json');
    });
});

// The promise made in locales/README.md: a language may add the plural forms
// its grammar needs without the parity check turning on it.
test('a language may carry extra plural forms', () => {
    const polish = JSON.parse(JSON.stringify(en));
    polish.setup.found_few = 'Znaleziono {{count}} urzadzenia';
    polish.setup.found_many = 'Znaleziono {{count}} urzadzen';

    assert.deepStrictEqual(keySet(polish), keySet(en), 'extra plural forms are not a difference');

    // But a genuinely missing key still is.
    const luecke = JSON.parse(JSON.stringify(en));
    delete luecke.operate.powerOn;
    assert.notDeepStrictEqual(keySet(luecke), keySet(en), 'a missing key must still be caught');
});

test('German really is a full translation, not a stub', () => {
    assert.strictEqual(Object.keys(de).length, Object.keys(en).length);
    assert.notStrictEqual(de.operate.powerOn, en.operate.powerOn);
});

// Every placeholder must use i18next's double-brace syntax; a single brace
// would silently ship untouched to the screen.
test('placeholders use i18next syntax everywhere', () => {
    const check = (node, code, prefix) => {
        Object.keys(node).forEach((name) => {
            const keyPath = prefix ? prefix + '.' + name : name;
            const value = node[name];
            if (typeof value !== 'string') return check(value, code, keyPath);
            const single = value.replace(/\{\{\w+\}\}/g, '').match(/[{}]/);
            assert.strictEqual(single, null, code + '.json ' + keyPath + ' has a stray brace: ' + value);
        });
    };
    check(de, 'de', '');
    check(en, 'en', '');
});

// ---------- The vendored copy of i18next ----------

// The renderer loads renderer/vendor/i18next.min.js, the tests load
// node_modules/i18next. If someone bumps the dependency without re-copying the
// file, the app would quietly run a different version than the tests do. This
// is the guard; renderer/vendor/README.md has the two-line update recipe.
test('the vendored i18next matches the installed one', () => {
    const vendored = path.join(__dirname, '..', 'renderer', 'vendor', 'i18next.min.js');
    const installed = path.join(__dirname, '..', 'node_modules', 'i18next', 'dist', 'umd', 'i18next.min.js');

    assert.ok(fs.existsSync(vendored), 'renderer/vendor/i18next.min.js is missing — the app cannot start without it');
    assert.strictEqual(
        fs.readFileSync(vendored, 'utf-8'),
        fs.readFileSync(installed, 'utf-8'),
        'renderer/vendor/i18next.min.js is out of date — see renderer/vendor/README.md'
    );
});
