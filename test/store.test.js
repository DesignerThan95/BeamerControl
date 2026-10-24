const test = require('node:test');
const assert = require('node:assert');
const { createStore, normalize, DEFAULTS } = require('../renderer/js/store.js');

function fakeIo(initial) {
    let stored = initial;
    return {
        load: async () => stored,
        save: async (obj) => { stored = JSON.parse(JSON.stringify(obj)); },
        peek: () => stored
    };
}

test('a missing file leads to the setup', async () => {
    const store = createStore(fakeIo(null));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
    assert.strictEqual(store.get().connection.port, 4352);
});

test('a file without version 2 is ignored', async () => {
    const old = { host: '192.168.1.50', port: 4352, password: null, lastInputCode: '31' };
    const store = createStore(fakeIo(old));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
    assert.strictEqual(store.get().connection.host, '');
});

test('an unreadable file leads to the setup', async () => {
    const io = { load: async () => { throw new Error('broken'); }, save: async () => {} };
    const store = createStore(io);
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
});

test('a valid file is read', async () => {
    const valid = {
        version: 2,
        connection: { host: '192.168.1.100', port: 4352, password: null },
        sources: [{ code: '31', label: 'Laptop', visible: true }],
        appearance: { theme: 'dark', highContrast: false },
        setupCompleted: true
    };
    const store = createStore(fakeIo(valid));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), true);
    assert.strictEqual(store.get().connection.host, '192.168.1.100');
    assert.strictEqual(store.get().sources[0].label, 'Laptop');
    assert.strictEqual(store.get().appearance.theme, 'dark');
});

test('saving and reading give back the same content', async () => {
    const io = fakeIo(null);
    const store = createStore(io);
    await store.load();
    store.setConnection({ host: '10.0.0.5', port: 4352, password: 'secret' });
    store.setSources([{ code: '32', label: 'Pulpit', visible: true }]);
    store.markSetupComplete();
    await store.save();

    const second = createStore({ load: async () => io.peek(), save: async () => {} });
    await second.load();
    assert.strictEqual(second.get().connection.host, '10.0.0.5');
    assert.strictEqual(second.get().sources[0].label, 'Pulpit');
    assert.strictEqual(second.isSetupComplete(), true);
});

test('normalize fills in missing fields and throws away what it does not know', () => {
    const raw = { version: 2, connection: { host: '1.2.3.4' }, whatever: 42 };
    const n = normalize(raw);
    assert.strictEqual(n.connection.host, '1.2.3.4');
    assert.strictEqual(n.connection.port, 4352);
    assert.deepStrictEqual(n.sources, []);
    assert.strictEqual(n.appearance.theme, 'system');
    assert.strictEqual(n.whatever, undefined);
});

test('an unknown theme value falls back to system', () => {
    const n = normalize({ version: 2, appearance: { theme: 'purple' } });
    assert.strictEqual(n.appearance.theme, 'system');
});

test('DEFAULTS are not changed by normalize', () => {
    normalize({ version: 2, connection: { host: 'x' } });
    assert.strictEqual(DEFAULTS.connection.host, '');
});

test('resetSetup takes the setup back', async () => {
    const store = createStore(fakeIo(null));
    await store.load();
    store.setConnection({ host: '10.0.0.9', port: 4352, password: null });
    store.markSetupComplete();
    assert.strictEqual(store.isSetupComplete(), true);
    store.resetSetup();
    assert.strictEqual(store.isSetupComplete(), false);
});

// ---------- Language ----------

// The decisive one for existing installations: a settings file written before
// this feature must not lose anything, and must not force a language on anyone.
test('a settings file without the language field means no choice yet', async () => {
    const before = {
        version: 2,
        connection: { host: '192.168.1.100', port: 4352, password: null },
        sources: [{ code: '31', label: 'Laptop', visible: true }],
        appearance: { theme: 'system', highContrast: false },
        setupCompleted: true
    };
    const store = createStore(fakeIo(before));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), true, 'the setup stays done');
    assert.strictEqual(store.getLanguage(), null, 'no override, so the operating system decides');
});

test('a chosen language is read back', async () => {
    const store = createStore(fakeIo({ version: 2, language: 'de' }));
    await store.load();
    assert.strictEqual(store.getLanguage(), 'de');
});

test('a chosen language survives a restart', async () => {
    const io = fakeIo(null);
    const store = createStore(io);
    await store.load();
    store.setLanguage('de');
    await store.save();
    assert.strictEqual(io.peek().language, 'de', 'the field is written to disk');

    const second = createStore({ load: async () => io.peek(), save: async () => {} });
    await second.load();
    assert.strictEqual(second.getLanguage(), 'de');
});

test('null takes the choice back so the operating system decides again', async () => {
    const store = createStore(fakeIo({ version: 2, language: 'de' }));
    await store.load();
    store.setLanguage(null);
    assert.strictEqual(store.getLanguage(), null);
});

// Only the shape is checked here. Whether a language actually ships is the
// translation helper's business — otherwise this file would need changing
// every time a language is added.
test('a value that is not a language code is thrown away', () => {
    assert.strictEqual(normalize({ version: 2, language: 'Deutsch' }).language, null);
    assert.strictEqual(normalize({ version: 2, language: 'de-CH' }).language, null);
    assert.strictEqual(normalize({ version: 2, language: 42 }).language, null);
    assert.strictEqual(normalize({ version: 2, language: '' }).language, null);
});

// ---------- Class 2 features ----------

test('without any statement, no Class 2 feature is enabled', async () => {
    const store = createStore(fakeIo(null));
    await store.load();
    assert.deepStrictEqual(store.get().enabledClass2Features, []);
    assert.strictEqual(store.isClass2FeatureEnabled('volume'), false);
});

// Decisive for what is already out there: an installation that is already set
// up must not fall back into the setup wizard because of the new field.
test('a saved file without the new field stays valid', async () => {
    const old = {
        version: 2,
        connection: { host: '192.168.1.100', port: 4352, password: null },
        sources: [{ code: '31', label: 'Laptop', visible: true }],
        appearance: { theme: 'system', highContrast: false },
        setupCompleted: true
    };
    const store = createStore(fakeIo(old));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), true, 'the setup stays done');
    assert.deepStrictEqual(store.get().enabledClass2Features, []);
});

test('enabled features are read', async () => {
    const valid = {
        version: 2,
        connection: { host: '192.168.1.100', port: 4352, password: null },
        sources: [],
        appearance: { theme: 'system', highContrast: false },
        setupCompleted: true,
        enabledClass2Features: ['volume', 'freeze']
    };
    const store = createStore(fakeIo(valid));
    await store.load();
    assert.strictEqual(store.isClass2FeatureEnabled('volume'), true);
    assert.strictEqual(store.isClass2FeatureEnabled('freeze'), true);
    assert.strictEqual(store.isClass2FeatureEnabled('maintenance'), false);
});

// An unknown entry in the file must nowhere turn into a button with no command
// behind it.
test('unknown feature names are discarded', () => {
    const n = normalize({ version: 2, enabledClass2Features: ['volume', 'makingcoffee', 42, null] });
    assert.deepStrictEqual(n.enabledClass2Features, ['volume']);
});

test('duplicate entries are collapsed', () => {
    const n = normalize({ version: 2, enabledClass2Features: ['freeze', 'freeze'] });
    assert.deepStrictEqual(n.enabledClass2Features, ['freeze']);
});

test('enabling and saving survives a restart', async () => {
    const io = fakeIo(null);
    const store = createStore(io);
    await store.load();
    store.setConnection({ host: '10.0.0.5', port: 4352, password: null });
    store.setClass2Features(['volume', 'resolution']);
    store.markSetupComplete();
    await store.save();

    const second = createStore({ load: async () => io.peek(), save: async () => {} });
    await second.load();
    assert.strictEqual(second.isClass2FeatureEnabled('volume'), true);
    assert.strictEqual(second.isClass2FeatureEnabled('resolution'), true);
    assert.strictEqual(second.isClass2FeatureEnabled('freeze'), false);
});
