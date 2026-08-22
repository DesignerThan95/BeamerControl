const test = require('node:test');
const assert = require('node:assert');
const i18n = require('../renderer/js/i18n');
const de = require('../renderer/js/i18n/de.js');
const en = require('../renderer/js/i18n/en.js');

// The helper starts every test from the same place: requiring it once per file
// means the language survives between tests otherwise.
test.beforeEach(() => { i18n.setLanguage(i18n.FALLBACK_LANGUAGE); });

// ---------- Which languages are on board ----------

test('the shipped languages are found', () => {
    assert.deepStrictEqual(i18n.supportedLanguages(), ['de', 'en']);
    assert.strictEqual(i18n.isSupported('de'), true);
    assert.strictEqual(i18n.isSupported('en'), true);
    assert.strictEqual(i18n.isSupported('fr'), false);
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
// in the other shows up here instead of on someone's screen.
test('German and English carry exactly the same keys', () => {
    const flatten = (node, prefix) => {
        return Object.keys(node).reduce((keys, name) => {
            const path = prefix ? prefix + '.' + name : name;
            const value = node[name];
            return keys.concat(typeof value === 'string' ? [path] : flatten(value, path));
        }, []);
    };

    assert.deepStrictEqual(flatten(de, '').sort(), flatten(en, '').sort());
});
