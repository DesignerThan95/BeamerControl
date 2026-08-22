const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const PJLink = require('../index.js');

// Ein sehr kleiner PJLink-Beamer zum Anfassen. Er meldet sich ohne
// Passwortabfrage, merkt sich jede empfangene Zeile und antwortet darauf.
// Damit lässt sich prüfen, was wirklich auf der Leitung steht — genau darum
// geht es bei der Klasse im Header.
function fakeBeamer(werte) {
    const zeilen = [];
    const antworten = Object.assign({
        POWR: '1', SNUM: 'SN-4711', SVER: 'FW 1.20', FREZ: '0',
        IRES: '1920x1080', RRES: '1920x1080', FILT: '1234',
        RLMP: 'ET-LAV400', RFIL: 'ET-RFV400', INNM: 'HDMI vorne'
    }, werte || {});

    const server = net.createServer(function (sock) {
        sock.write('PJLINK 0\r');
        let puffer = '';

        sock.on('data', function (d) {
            puffer += d.toString();
            let i;
            while ((i = puffer.indexOf('\r')) !== -1) {
                const zeile = puffer.slice(0, i);
                puffer = puffer.slice(i + 1);
                zeilen.push(zeile);

                const header = zeile.slice(0, 2);
                const befehl = zeile.slice(2, 6);
                const parameter = zeile.slice(7);
                const wert = parameter.charAt(0) === '?' ? (antworten[befehl] || 'OK') : 'OK';
                sock.write(header + befehl + '=' + wert + '\r');
            }
        });
        sock.on('error', function () { /* Verbindungsabbruch am Testende */ });
    });

    return {
        zeilen,
        async start() {
            await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
            return server.address().port;
        },
        stop() { server.close(); }
    };
}

// Ruft eine Methode der Bibliothek als Promise auf.
function rufen(beamer, methode) {
    const rest = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
        beamer[methode].apply(beamer, rest.concat([function (err, ergebnis) {
            if (err) reject(err); else resolve(ergebnis);
        }]));
    });
}

async function mitBeamer(fn, werte) {
    const fake = fakeBeamer(werte);
    const port = await fake.start();
    const beamer = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 4000 });
    try {
        await fn(beamer, fake);
    } finally {
        beamer.disconnect();
        fake.stop();
    }
}

test('ein Class-1-Befehl geht unverändert mit %1 auf die Leitung', async () => {
    await mitBeamer(async function (beamer, fake) {
        const zustand = await rufen(beamer, 'getPowerState');
        assert.strictEqual(zustand, 1);
        assert.deepStrictEqual(fake.zeilen, ['%1POWR ?']);
    });
});

test('ein Class-2-Befehl geht mit %2 auf die Leitung', async () => {
    await mitBeamer(async function (beamer, fake) {
        await rufen(beamer, 'getSerialNumber');
        assert.deepStrictEqual(fake.zeilen, ['%2SNUM ?']);
    });
});

// Der Kern der Erweiterung: beide Klassen teilen sich eine Verbindung und
// eine Warteschlange. Die Klasse hängt am einzelnen Befehl.
test('Class 1 und Class 2 laufen gemischt über dieselbe Verbindung', async () => {
    await mitBeamer(async function (beamer, fake) {
        await rufen(beamer, 'getPowerState');
        await rufen(beamer, 'getSerialNumber');
        await rufen(beamer, 'getPowerState');
        await rufen(beamer, 'getSoftwareVersion');

        assert.deepStrictEqual(fake.zeilen, [
            '%1POWR ?', '%2SNUM ?', '%1POWR ?', '%2SVER ?'
        ]);
    });
});

test('Seriennummer und Softwareversion kommen als Text an', async () => {
    await mitBeamer(async function (beamer) {
        assert.strictEqual(await rufen(beamer, 'getSerialNumber'), 'SN-4711');
        assert.strictEqual(await rufen(beamer, 'getSoftwareVersion'), 'FW 1.20');
    });
});

test('Standbild schalten und abfragen', async () => {
    await mitBeamer(async function (beamer, fake) {
        await rufen(beamer, 'setFreeze', true);
        assert.strictEqual(fake.zeilen[0], '%2FREZ 1');

        await rufen(beamer, 'setFreeze', false);
        assert.strictEqual(fake.zeilen[1], '%2FREZ 0');

        assert.strictEqual(await rufen(beamer, 'getFreeze'), false);
        assert.strictEqual(fake.zeilen[2], '%2FREZ ?');
    }, { FREZ: '0' });
});

test('Lautstärke geht nur auf und ab', async () => {
    await mitBeamer(async function (beamer, fake) {
        await rufen(beamer, 'speakerVolumeUp');
        await rufen(beamer, 'speakerVolumeDown');
        await rufen(beamer, 'microphoneVolumeUp');
        await rufen(beamer, 'microphoneVolumeDown');

        assert.deepStrictEqual(fake.zeilen, [
            '%2SVOL 1', '%2SVOL 0', '%2MVOL 1', '%2MVOL 0'
        ]);
    });
});

test('der Name eines Eingangs wird mit dessen Kennung erfragt', async () => {
    await mitBeamer(async function (beamer, fake) {
        const name = await rufen(beamer, 'getInputName', '31');
        assert.strictEqual(fake.zeilen[0], '%2INNM ?31');
        assert.strictEqual(name, 'HDMI vorne');
    });
});

test('Auflösungen kommen zerlegt an', async () => {
    await mitBeamer(async function (beamer) {
        assert.deepStrictEqual(await rufen(beamer, 'getInputResolution'), {
            code: '1920x1080', width: 1920, height: 1080
        });
        assert.deepStrictEqual(await rufen(beamer, 'getRecommendedResolution'), {
            code: '1280x800', width: 1280, height: 800
        });
    }, { RRES: '1280x800' });
});

test('Wartungswerte kommen an', async () => {
    await mitBeamer(async function (beamer) {
        assert.strictEqual(await rufen(beamer, 'getFilterUsage'), 1234);
        assert.deepStrictEqual(await rufen(beamer, 'getLampReplacements'), ['ET-LAV400']);
        assert.deepStrictEqual(await rufen(beamer, 'getFilterReplacements'), ['ET-RFV400']);
    });
});

// Ein Class-1-Beamer antwortet auf Class-2-Befehle mit ERR1. Das muss als
// normaler Fehler beim Aufrufer ankommen und darf die Verbindung nicht
// zerstören — der nächste Class-1-Befehl muss weiter funktionieren.
test('ERR1 auf einen Class-2-Befehl lässt die Verbindung heil', async () => {
    await mitBeamer(async function (beamer) {
        await assert.rejects(() => rufen(beamer, 'getSerialNumber'), /Undefined command/);
        assert.strictEqual(await rufen(beamer, 'getPowerState'), 1);
    }, { SNUM: 'ERR1' });
});
