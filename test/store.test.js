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

test('fehlende Datei führt zur Einrichtung', async () => {
    const store = createStore(fakeIo(null));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
    assert.strictEqual(store.get().connection.port, 4352);
});

test('Datei ohne version 2 wird ignoriert', async () => {
    const alt = { host: '192.168.1.50', port: 4352, password: null, lastInputCode: '31' };
    const store = createStore(fakeIo(alt));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
    assert.strictEqual(store.get().connection.host, '');
});

test('unlesbare Datei führt zur Einrichtung', async () => {
    const io = { load: async () => { throw new Error('kaputt'); }, save: async () => {} };
    const store = createStore(io);
    await store.load();
    assert.strictEqual(store.isSetupComplete(), false);
});

test('gültige Datei wird gelesen', async () => {
    const gueltig = {
        version: 2,
        connection: { host: '192.168.1.100', port: 4352, password: null },
        sources: [{ code: '31', label: 'Laptop', visible: true }],
        appearance: { theme: 'dark', highContrast: false },
        setupCompleted: true
    };
    const store = createStore(fakeIo(gueltig));
    await store.load();
    assert.strictEqual(store.isSetupComplete(), true);
    assert.strictEqual(store.get().connection.host, '192.168.1.100');
    assert.strictEqual(store.get().sources[0].label, 'Laptop');
    assert.strictEqual(store.get().appearance.theme, 'dark');
});

test('Speichern und Lesen ergeben denselben Inhalt', async () => {
    const io = fakeIo(null);
    const store = createStore(io);
    await store.load();
    store.setConnection({ host: '10.0.0.5', port: 4352, password: 'geheim' });
    store.setSources([{ code: '32', label: 'Kanzel', visible: true }]);
    store.markSetupComplete();
    await store.save();

    const zweiter = createStore({ load: async () => io.peek(), save: async () => {} });
    await zweiter.load();
    assert.strictEqual(zweiter.get().connection.host, '10.0.0.5');
    assert.strictEqual(zweiter.get().sources[0].label, 'Kanzel');
    assert.strictEqual(zweiter.isSetupComplete(), true);
});

test('normalize ergänzt fehlende Felder und wirft Unbekanntes weg', () => {
    const roh = { version: 2, connection: { host: '1.2.3.4' }, sonstwas: 42 };
    const n = normalize(roh);
    assert.strictEqual(n.connection.host, '1.2.3.4');
    assert.strictEqual(n.connection.port, 4352);
    assert.deepStrictEqual(n.sources, []);
    assert.strictEqual(n.appearance.theme, 'system');
    assert.strictEqual(n.sonstwas, undefined);
});

test('unbekannter theme-Wert fällt auf system zurück', () => {
    const n = normalize({ version: 2, appearance: { theme: 'lila' } });
    assert.strictEqual(n.appearance.theme, 'system');
});

test('DEFAULTS werden nicht von normalize verändert', () => {
    normalize({ version: 2, connection: { host: 'x' } });
    assert.strictEqual(DEFAULTS.connection.host, '');
});

test('resetSetup nimmt die Einrichtung zurück', async () => {
    const store = createStore(fakeIo(null));
    await store.load();
    store.setConnection({ host: '10.0.0.9', port: 4352, password: null });
    store.markSetupComplete();
    assert.strictEqual(store.isSetupComplete(), true);
    store.resetSetup();
    assert.strictEqual(store.isSetupComplete(), false);
});
