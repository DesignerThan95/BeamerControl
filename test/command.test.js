const test = require('node:test');
const assert = require('node:assert');
const Command = require('../lib/command.js');

// ---------- Kern: Header pro Befehl statt pro Verbindung ----------

test('ein Befehl ohne cls bekommt den Header der Verbindung', () => {
    const cmd = new Command.PowerCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%1POWR ?');
});

test('ein Befehl mit cls 2 bekommt seinen eigenen Header', () => {
    const cmd = new Command('FREZ', '?', null);
    cmd.cls = 2;
    assert.strictEqual(cmd.toWire(1), '%2FREZ ?');
});

// Das ist die eigentliche Zusicherung dieser Erweiterung: kein bestehender
// Befehl darf durch Class 2 ein anderes Byte auf die Leitung legen als vorher.
test('alle bestehenden Befehle bleiben Class 1', () => {
    const bestehend = [
        'PowerCommand', 'InputCommand', 'MuteCommand', 'ErrorsCommand',
        'LampCommand', 'InputsCommand', 'NameCommand', 'ManufacturerCommand',
        'ModelCommand', 'InfoCommand', 'ClassCommand'
    ];

    bestehend.forEach(function (name) {
        const cmd = new Command[name](function () {});
        assert.strictEqual(cmd.cls, undefined, name + ' darf kein cls setzen');
        assert.ok(cmd.toWire(1).indexOf('%1') === 0, name + ' muss mit %1 senden');
    });
});

// ---------- Lautstärke (SVOL / MVOL) ----------

test('Lautsprecher lauter sendet SVOL 1', () => {
    const cmd = new Command.SVOLCommand(Command.VOLUME.UP, function () {});
    assert.strictEqual(cmd.toWire(1), '%2SVOL 1');
});

test('Lautsprecher leiser sendet SVOL 0', () => {
    const cmd = new Command.SVOLCommand(Command.VOLUME.DOWN, function () {});
    assert.strictEqual(cmd.toWire(1), '%2SVOL 0');
});

test('Mikrofon lauter sendet MVOL 1', () => {
    const cmd = new Command.MVOLCommand(Command.VOLUME.UP, function () {});
    assert.strictEqual(cmd.toWire(1), '%2MVOL 1');
});

test('Lautstärke versteht auch up und down als Wort', () => {
    assert.strictEqual(new Command.SVOLCommand('up').toWire(1), '%2SVOL 1');
    assert.strictEqual(new Command.MVOLCommand('down').toWire(1), '%2MVOL 0');
});

// Ohne Richtung wäre die Zeile "%2SVOL" — der Beamer antwortete mit ERR2.
// Lieber hier scheitern, wo der Fehler im Aufruf steht.
test('Lautstärke ohne Richtung wird abgelehnt', () => {
    assert.throws(() => new Command.SVOLCommand(function () {}), /Richtung/);
    assert.throws(() => new Command.MVOLCommand('lauter'), /Richtung/);
});

// ---------- Standbild (FREZ) ----------

test('Standbild einschalten sendet FREZ 1', () => {
    const cmd = new Command.FreezeCommand(true, function () {});
    assert.strictEqual(cmd.toWire(1), '%2FREZ 1');
});

test('Standbild ausschalten sendet FREZ 0', () => {
    const cmd = new Command.FreezeCommand(false, function () {});
    assert.strictEqual(cmd.toWire(1), '%2FREZ 0');
});

test('Standbild ohne Wert fragt ab', () => {
    const cmd = new Command.FreezeCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2FREZ ?');
});

test('Antwort auf die Standbild-Abfrage wird zu wahr oder falsch', () => {
    const cmd = new Command.FreezeCommand(function () {});
    assert.strictEqual(cmd.formatResult(['1']), true);
    assert.strictEqual(cmd.formatResult(['0']), false);
});

// Auf einen Schaltbefehl antwortet der Beamer mit OK, nicht mit 0 oder 1.
// Daraus darf kein "Standbild ist aus" werden.
test('die Quittung OK gilt nicht als Standbild-Zustand', () => {
    const cmd = new Command.FreezeCommand(true, function () {});
    assert.strictEqual(cmd.formatResult(['OK']), undefined);
});

// ---------- Seriennummer und Softwareversion ----------

test('Seriennummer wird abgefragt', () => {
    const cmd = new Command.SerialNumberCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2SNUM ?');
});

test('Softwareversion wird abgefragt', () => {
    const cmd = new Command.SoftwareVersionCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2SVER ?');
});

// Antworten dürfen Leerzeichen enthalten. Ohne Zusammenfügen käme beim
// Aufrufer nur der erste Teil an.
test('eine mehrteilige Softwareversion bleibt ein Text', () => {
    const cmd = new Command.SoftwareVersionCommand(function () {});
    assert.strictEqual(cmd.formatResult(['FW', '1.20']), 'FW 1.20');
});

// ---------- Name eines Eingangs (INNM) ----------

// Der einzige Abfragebefehl mit Parameter: gefragt wird nach einem
// bestimmten Eingang, nicht nach allen.
test('der Name eines Eingangs wird mit dessen Kennung abgefragt', () => {
    const cmd = new Command.InputNameCommand('31', function () {});
    assert.strictEqual(cmd.toWire(1), '%2INNM ?31');
});

test('der Eingangsname darf Leerzeichen enthalten', () => {
    const cmd = new Command.InputNameCommand('31', function () {});
    assert.strictEqual(cmd.formatResult(['HDMI', '1', 'vorne']), 'HDMI 1 vorne');
});

test('ohne Eingangskennung wird die Namensabfrage abgelehnt', () => {
    assert.throws(() => new Command.InputNameCommand(function () {}), /Eingang/);
    assert.throws(() => new Command.InputNameCommand('3'), /Eingang/);
});

// ---------- Auflösung (IRES / RRES) ----------

test('die anliegende Auflösung wird abgefragt', () => {
    const cmd = new Command.InputResolutionCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2IRES ?');
});

test('die empfohlene Auflösung wird abgefragt', () => {
    const cmd = new Command.RecommendResolutionCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2RRES ?');
});

test('eine Auflösung wird in Breite und Höhe zerlegt', () => {
    const cmd = new Command.InputResolutionCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['1920x1080']), {
        code: '1920x1080', width: 1920, height: 1080
    });
});

// PJLink meldet "-" für kein Signal und "*" für ein Signal, das der Beamer
// nicht einordnen kann. Beides sind gültige Antworten, keine Fehler — die
// Deutung in Klartext gehört nicht in die Protokollschicht.
test('kein anliegendes Signal bleibt als Sonderfall erkennbar', () => {
    const cmd = new Command.InputResolutionCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['-']), {
        code: '-', width: null, height: null
    });
    assert.deepStrictEqual(cmd.formatResult(['*']), {
        code: '*', width: null, height: null
    });
});

// ---------- Wartung (FILT / RLMP / RFIL) ----------

test('die Filter-Betriebsstunden werden abgefragt', () => {
    const cmd = new Command.FilterUsageCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2FILT ?');
});

// FILT ist — anders als LAMP — ein einzelner Wert: die aufsummierten
// Betriebsstunden des Filters. Es gibt hier keine Paare aus Stunden und
// Zustand, die zu zerlegen wären.
test('die Filter-Betriebsstunden sind eine einzelne Zahl', () => {
    const cmd = new Command.FilterUsageCommand(function () {});
    assert.strictEqual(cmd.formatResult(['1234']), 1234);
});

test('die Ersatzlampen-Nummern werden abgefragt', () => {
    const cmd = new Command.LampReplacementCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2RLMP ?');
});

test('die Ersatzfilter-Nummern werden abgefragt', () => {
    const cmd = new Command.FilterReplacementCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2RFIL ?');
});

// Ein Beamer mit mehreren Lampen nennt mehrere Modellnummern, durch
// Leerzeichen getrennt. Beim Aufrufer muss die vollständige Liste ankommen.
test('mehrere Ersatzlampen kommen als Liste an', () => {
    const cmd = new Command.LampReplacementCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['ET-LAV400', 'ET-LAV401']), [['ET-LAV400', 'ET-LAV401']]);
});

// Laserprojektoren haben keine Wechsellampe und antworten mit leerer Liste.
// Das ist kein Fehler und darf keiner werden.
test('kein Ersatzteil ergibt eine leere Liste', () => {
    const cmd = new Command.LampReplacementCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult([]), [[]]);
});

// ---------- Klassenabfrage (CLSS) ----------

// Die Spezifikation sieht auf %1CLSS ? nur die nackte Ziffer vor. Optoma
// antwortet stattdessen "Class 1" — nachgemessen an einem echten Gerät.
// response.js zerlegt am Leerzeichen, die Antwort kommt also als zwei Teile
// an. Wer hier eine einzelne Ziffer erwartet, bekommt bei solchen Geräten
// nichts Brauchbares.
test('die spec-konforme Antwort wird gelesen', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['1']), { cls: 1, raw: '1' });
    assert.deepStrictEqual(cmd.formatResult(['2']), { cls: 2, raw: '2' });
});

test('die Optoma-Schreibweise mit Wort davor wird ebenso gelesen', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['Class', '1']), { cls: 1, raw: 'Class 1' });
    assert.deepStrictEqual(cmd.formatResult(['Class', '2']), { cls: 2, raw: 'Class 2' });
});

// Der Rohtext muss erhalten bleiben: nur damit lässt sich später im Protokoll
// nachvollziehen, was das Gerät tatsächlich gesagt hat.
test('eine unbrauchbare Antwort behält ihren Wortlaut', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['Quatsch']), { cls: null, raw: 'Quatsch' });
    assert.deepStrictEqual(cmd.formatResult([]), { cls: null, raw: '' });
});

// PJLink kennt nur Class 1 und 2. Alles andere ist keine Klassenangabe.
test('eine Ziffer außerhalb von 1 und 2 gilt nicht als Klasse', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['Class', '7']), { cls: null, raw: 'Class 7' });
});
