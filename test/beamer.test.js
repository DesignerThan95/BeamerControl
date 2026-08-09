const test = require('node:test');
const assert = require('node:assert');
const { createBeamer, POLL_MS, COMMAND_TIMEOUT_MS } = require('../renderer/js/beamer.js');

// Sehr einfache Uhr: Aufgaben werden nach Fälligkeit sortiert abgearbeitet.
function fakeClock() {
    let zeit = 0;
    let naechsteId = 1;
    const aufgaben = new Map();

    return {
        now: () => zeit,
        schedule: (fn, ms) => {
            const id = naechsteId++;
            aufgaben.set(id, { fn, faellig: zeit + ms });
            return id;
        },
        cancel: (id) => { aufgaben.delete(id); },
        // Läuft bis `ms` weiter und führt alles aus, was fällig wird.
        async advance(ms) {
            const ziel = zeit + ms;
            let schutz = 0;
            for (;;) {
                let naechste = null;
                for (const [id, a] of aufgaben) {
                    if (a.faellig <= ziel && (!naechste || a.faellig < naechste.a.faellig)) {
                        naechste = { id, a };
                    }
                }
                if (!naechste) break;
                if (++schutz > 500) throw new Error('Endlosschleife in der Testuhr');
                zeit = naechste.a.faellig;
                aufgaben.delete(naechste.id);
                await naechste.a.fn();
                await Promise.resolve();
            }
            zeit = ziel;
        }
    };
}

function fakeApi(anfang) {
    return {
        zustand: Object.assign({ power: 0, input: { code: '31', name: 'DIGITAL - 1' }, mute: { video: false, audio: false } }, anfang || {}),
        fehler: false,
        rufe: [],
        async connect() { this.rufe.push('connect'); if (this.fehler) throw new Error('offline'); return { success: true }; },
        abfragen: 0,
        async getPowerState() {
            this.abfragen++;
            if (this.fehler) throw new Error('Zeitüberschreitung');
            const texte = { 0: 'Aus', 1: 'Ein', 2: 'Wird abgekühlt', 3: 'Wird aufgewärmt' };
            return { state: this.zustand.power, description: texte[this.zustand.power] };
        },
        async getCurrentInput() { if (this.fehler) throw new Error('Zeitüberschreitung'); return this.zustand.input; },
        async getMuteState() { if (this.fehler) throw new Error('Zeitüberschreitung'); return this.zustand.mute; },
        async powerOn() { this.rufe.push('powerOn'); },
        async powerOff() { this.rufe.push('powerOff'); },
        async setInput(code) { this.rufe.push('setInput:' + code); },
        async setMute(m) { this.rufe.push('setMute:' + m.video + ',' + m.audio); }
    };
}

function bauen(anfang) {
    const uhr = fakeClock();
    const api = fakeApi(anfang);
    const b = createBeamer({ api, schedule: uhr.schedule, cancel: uhr.cancel, now: uhr.now });
    return { uhr, api, b };
}

test('erste Abfrage bringt den Zustand auf online', async () => {
    const { uhr, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
    assert.strictEqual(b.getState().sourceCode, '31');
});

test('die Verbindung wird vor der ersten Abfrage aufgebaut', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(api.rufe[0], 'connect', 'zuerst muss verbunden werden');
});

test('steht die Verbindung, wird nicht erneut verbunden', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    const nachStart = api.rufe.filter(function (r) { return r === 'connect'; }).length;
    await uhr.advance(POLL_MS * 3);
    const spaeter = api.rufe.filter(function (r) { return r === 'connect'; }).length;
    assert.strictEqual(spaeter, nachStart, 'im laufenden Betrieb kein weiterer Verbindungsaufbau');
});

test('nach Verbindungsverlust wird bei jedem Versuch neu verbunden', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    api.fehler = true;
    await uhr.advance(POLL_MS * 3);
    assert.strictEqual(b.getState().link, 'offline');

    const vorher = api.rufe.filter(function (r) { return r === 'connect'; }).length;
    await uhr.advance(30000);
    const nachher = api.rufe.filter(function (r) { return r === 'connect'; }).length;
    assert.ok(nachher > vorher, 'im Offline-Zustand muss weiter verbunden werden');
});

test('Aufwärmen führt zum Zustand ein', async () => {
    const { uhr, api, b } = bauen({ power: 3 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().power, 'warming');

    api.zustand.power = 1;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'on');
});

test('Abkühlen bleibt bis der Beamer aus meldet', async () => {
    const { uhr, api, b } = bauen({ power: 2 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().power, 'cooling');

    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'cooling');

    api.zustand.power = 0;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'off');
});

test('drei fehlgeschlagene Abfragen lösen kein Kontakt aus', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    assert.strictEqual(b.getState().link, 'online');

    api.fehler = true;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'online', 'ein Fehler reicht nicht');
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'online', 'zwei Fehler reichen nicht');
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'offline', 'beim dritten Fehler gilt die Verbindung als weg');
});

test('nach Verbindungsverlust stellt eine erfolgreiche Abfrage den Normalzustand her', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    api.fehler = true;
    await uhr.advance(POLL_MS * 3);
    assert.strictEqual(b.getState().link, 'offline');

    api.fehler = false;
    await uhr.advance(60000);
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
});

test('Einschalten wartet auf die Bestätigung des Beamers', async () => {
    const { uhr, api, b } = bauen({ power: 0 });
    b.start();
    await uhr.advance(1);

    await b.powerOn();
    assert.strictEqual(api.rufe[api.rufe.length - 1], 'powerOn');
    assert.strictEqual(b.getState().pending.kind, 'power-on');

    api.zustand.power = 3;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().pending.kind, 'power-on', 'beim Aufwärmen noch nicht fertig');

    api.zustand.power = 1;
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().pending, null, 'mit dem Zustand ein ist der Befehl erledigt');
});

test('ein Befehl ohne Bestätigung läuft nach 30 Sekunden ab', async () => {
    const { uhr, b } = bauen({ power: 0 });
    b.start();
    await uhr.advance(1);

    await b.powerOn();
    await uhr.advance(COMMAND_TIMEOUT_MS + POLL_MS * 2);
    assert.ok(b.getState().commandError, 'es muss eine Meldung im Klartext geben');
    assert.strictEqual(b.getState().pending, null);
});

test('ein abgelehnter Befehl blockiert die Bedienung nicht dauerhaft', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    // Der Beamer lehnt die Stummschaltung ab (kennt den Befehl nicht).
    api.setMute = async () => { throw new Error('Undefined command'); };
    await assert.rejects(() => b.setMute({ video: true, audio: false }));

    assert.ok(b.getState().commandError, 'der Fehler muss sichtbar werden');
    assert.strictEqual(b.getState().pending, null);

    // Entscheidend: die Zustandsmaschine muss danach normal weiterlaufen.
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on', 'der Beamer läuft weiter und das muss man sehen');

    // Und der Hinweis lässt sich wegklicken, ohne die App neu zu starten.
    b.dismissError();
    assert.strictEqual(b.getState().commandError, null);
});

test('ein erfolgreicher Befehl räumt eine alte Fehlermeldung weg', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    const echtesSetMute = api.setMute.bind(api);
    api.setMute = async () => { throw new Error('Undefined command'); };
    await assert.rejects(() => b.setMute({ video: true, audio: false }));
    assert.ok(b.getState().commandError);

    api.setMute = echtesSetMute;
    await b.setMute({ video: true, audio: false });
    assert.strictEqual(b.getState().commandError, null, 'der neue Versuch beginnt ohne alte Meldung');
});

test('nach einem Befehl wird eine Weile schneller nachgefragt', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    const ruhig = api.abfragen;
    await uhr.advance(POLL_MS);
    const imRuhetakt = api.abfragen - ruhig;

    await b.selectSource('32');
    const vorher = api.abfragen;
    await uhr.advance(POLL_MS);
    const nachBefehl = api.abfragen - vorher;

    assert.ok(nachBefehl > imRuhetakt, 'im gleichen Zeitraum muss öfter abgefragt werden (' + nachBefehl + ' statt ' + imRuhetakt + ')');
});

test('Quelle wählen meldet den Wechsel nach der Bestätigung', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    await b.selectSource('32');
    assert.ok(api.rufe.indexOf('setInput:32') !== -1);
    api.zustand.input = { code: '32', name: 'DIGITAL - 2' };
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().sourceCode, '32');
    assert.strictEqual(b.getState().pending, null);
});

test('Stummschaltung wird übernommen', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    await b.setMute({ video: true, audio: false });
    assert.ok(api.rufe.indexOf('setMute:true,false') !== -1);
    api.zustand.mute = { video: true, audio: false };
    await uhr.advance(POLL_MS);
    assert.strictEqual(b.getState().mute.video, true);
});

test('koppelt der Beamer Bild und Ton, gilt der Befehl trotzdem als erledigt', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    // Gewünscht: nur das Bild ausblenden. Der Beamer kann das nicht getrennt
    // und schaltet beides stumm — der Wunsch ist damit sinngemäß erfüllt.
    await b.setMute({ video: true, audio: false });
    api.zustand.mute = { video: true, audio: true };
    await uhr.advance(POLL_MS);

    assert.strictEqual(b.getState().pending, null, 'kein ewig laufender Befehl');
    assert.strictEqual(b.getState().commandError, null, 'und keine Fehlermeldung');
});

test('stimmt das Bild nicht, gilt der Befehl nicht als erledigt', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);

    await b.setMute({ video: true, audio: false });
    api.zustand.mute = { video: false, audio: false };
    await uhr.advance(POLL_MS);

    assert.ok(b.getState().pending, 'der Befehl läuft weiter');
});

test('onChange meldet jede Zustandsänderung', async () => {
    const { uhr, api, b } = bauen({ power: 0 });
    let zaehler = 0;
    b.onChange(() => { zaehler++; });
    b.start();
    await uhr.advance(1);
    const nachStart = zaehler;
    assert.ok(nachStart > 0, 'die erste Abfrage muss melden');

    api.zustand.power = 3;
    await uhr.advance(POLL_MS);
    assert.ok(zaehler > nachStart, 'eine Änderung muss melden');
});

test('stop beendet die Abfrage-Schleife', async () => {
    const { uhr, api, b } = bauen({ power: 1 });
    b.start();
    await uhr.advance(1);
    b.stop();
    const vorher = api.rufe.length;
    await uhr.advance(POLL_MS * 5);
    assert.strictEqual(api.rufe.length, vorher);
});
