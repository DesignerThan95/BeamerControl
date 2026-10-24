const test = require('node:test');
const assert = require('node:assert');
const Command = require('../lib/command.js');

// ---------- The core: a header per command instead of per connection ----------

test('a command without cls gets the connection header', () => {
    const cmd = new Command.PowerCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%1POWR ?');
});

test('a command with cls 2 gets its own header', () => {
    const cmd = new Command('FREZ', '?', null);
    cmd.cls = 2;
    assert.strictEqual(cmd.toWire(1), '%2FREZ ?');
});

// This is the actual guarantee of the Class 2 extension: no existing command
// may put a different byte on the wire than it did before.
test('every existing command stays Class 1', () => {
    const existing = [
        'PowerCommand', 'InputCommand', 'MuteCommand', 'ErrorsCommand',
        'LampCommand', 'InputsCommand', 'NameCommand', 'ManufacturerCommand',
        'ModelCommand', 'InfoCommand', 'ClassCommand'
    ];

    existing.forEach(function (name) {
        const cmd = new Command[name](function () {});
        assert.strictEqual(cmd.cls, undefined, name + ' must not set cls');
        assert.ok(cmd.toWire(1).indexOf('%1') === 0, name + ' must send with %1');
    });
});

// ---------- Volume (SVOL / MVOL) ----------

test('speaker louder sends SVOL 1', () => {
    const cmd = new Command.SVOLCommand(Command.VOLUME.UP, function () {});
    assert.strictEqual(cmd.toWire(1), '%2SVOL 1');
});

test('speaker quieter sends SVOL 0', () => {
    const cmd = new Command.SVOLCommand(Command.VOLUME.DOWN, function () {});
    assert.strictEqual(cmd.toWire(1), '%2SVOL 0');
});

test('microphone louder sends MVOL 1', () => {
    const cmd = new Command.MVOLCommand(Command.VOLUME.UP, function () {});
    assert.strictEqual(cmd.toWire(1), '%2MVOL 1');
});

test('volume also understands up and down as words', () => {
    assert.strictEqual(new Command.SVOLCommand('up').toWire(1), '%2SVOL 1');
    assert.strictEqual(new Command.MVOLCommand('down').toWire(1), '%2MVOL 0');
});

// Without a direction the line would be "%2SVOL" — and the projector would
// answer with ERR2. Better to fail here, where the mistake is in the call.
test('volume without a direction is refused', () => {
    assert.throws(() => new Command.SVOLCommand(function () {}), /Direction/);
    assert.throws(() => new Command.MVOLCommand('louder'), /Direction/);
});

// ---------- Freeze (FREZ) ----------

test('switching freeze on sends FREZ 1', () => {
    const cmd = new Command.FreezeCommand(true, function () {});
    assert.strictEqual(cmd.toWire(1), '%2FREZ 1');
});

test('switching freeze off sends FREZ 0', () => {
    const cmd = new Command.FreezeCommand(false, function () {});
    assert.strictEqual(cmd.toWire(1), '%2FREZ 0');
});

test('freeze without a value queries instead', () => {
    const cmd = new Command.FreezeCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2FREZ ?');
});

test('the answer to a freeze query becomes true or false', () => {
    const cmd = new Command.FreezeCommand(function () {});
    assert.strictEqual(cmd.formatResult(['1']), true);
    assert.strictEqual(cmd.formatResult(['0']), false);
});

// A projector answers a switching command with OK, not with 0 or 1. That must
// never turn into "freeze is off".
test('the OK acknowledgement does not count as a freeze state', () => {
    const cmd = new Command.FreezeCommand(true, function () {});
    assert.strictEqual(cmd.formatResult(['OK']), undefined);
});

// ---------- Serial number and software version ----------

test('the serial number is queried', () => {
    const cmd = new Command.SerialNumberCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2SNUM ?');
});

test('the software version is queried', () => {
    const cmd = new Command.SoftwareVersionCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2SVER ?');
});

// Answers may contain spaces. Without putting them back together, only the
// first part would reach the caller.
test('a multi-part software version stays one text', () => {
    const cmd = new Command.SoftwareVersionCommand(function () {});
    assert.strictEqual(cmd.formatResult(['FW', '1.20']), 'FW 1.20');
});

// ---------- Name of an input (INNM) ----------

// The only query command with a parameter: it asks about one specific input,
// not about all of them.
test('the name of an input is queried with its code', () => {
    const cmd = new Command.InputNameCommand('31', function () {});
    assert.strictEqual(cmd.toWire(1), '%2INNM ?31');
});

test('an input name may contain spaces', () => {
    const cmd = new Command.InputNameCommand('31', function () {});
    assert.strictEqual(cmd.formatResult(['HDMI', '1', 'front']), 'HDMI 1 front');
});

test('without an input code the name query is refused', () => {
    assert.throws(() => new Command.InputNameCommand(function () {}), /Input/);
    assert.throws(() => new Command.InputNameCommand('3'), /Input/);
});

// ---------- Resolution (IRES / RRES) ----------

test('the incoming resolution is queried', () => {
    const cmd = new Command.InputResolutionCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2IRES ?');
});

test('the recommended resolution is queried', () => {
    const cmd = new Command.RecommendResolutionCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2RRES ?');
});

test('a resolution is split into width and height', () => {
    const cmd = new Command.InputResolutionCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['1920x1080']), {
        code: '1920x1080', width: 1920, height: 1080
    });
});

// PJLink reports "-" for no signal and "*" for a signal the projector cannot
// classify. Both are valid answers, not errors — reading them as plain words
// does not belong in the protocol layer.
test('no incoming signal stays recognizable as a special case', () => {
    const cmd = new Command.InputResolutionCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['-']), {
        code: '-', width: null, height: null
    });
    assert.deepStrictEqual(cmd.formatResult(['*']), {
        code: '*', width: null, height: null
    });
});

// ---------- Maintenance (FILT / RLMP / RFIL) ----------

test('the filter operating hours are queried', () => {
    const cmd = new Command.FilterUsageCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2FILT ?');
});

// FILT is — unlike LAMP — a single value: the accumulated operating hours of
// the filter. There are no pairs of hours and state to split apart here.
test('the filter operating hours are a single number', () => {
    const cmd = new Command.FilterUsageCommand(function () {});
    assert.strictEqual(cmd.formatResult(['1234']), 1234);
});

test('the replacement lamp numbers are queried', () => {
    const cmd = new Command.LampReplacementCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2RLMP ?');
});

test('the replacement filter numbers are queried', () => {
    const cmd = new Command.FilterReplacementCommand(function () {});
    assert.strictEqual(cmd.toWire(1), '%2RFIL ?');
});

// A projector with several lamps names several model numbers, separated by
// spaces. The complete list has to reach the caller.
test('several replacement lamps arrive as a list', () => {
    const cmd = new Command.LampReplacementCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['ET-LAV400', 'ET-LAV401']), [['ET-LAV400', 'ET-LAV401']]);
});

// Laser projectors have no replaceable lamp and answer with an empty list.
// That is not an error and must not become one.
test('no replacement part gives an empty list', () => {
    const cmd = new Command.LampReplacementCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult([]), [[]]);
});

// ---------- Class query (CLSS) ----------

// The spec only foresees the bare digit in reply to %1CLSS ?. Optoma answers
// "Class 1" instead — measured on a real device. response.js splits on spaces,
// so the answer arrives in two parts. Anything expecting a single digit gets
// nothing usable out of such devices.
test('the spec-conforming answer is read', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['1']), { cls: 1, raw: '1' });
    assert.deepStrictEqual(cmd.formatResult(['2']), { cls: 2, raw: '2' });
});

test('the Optoma spelling with a word in front is read just as well', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['Class', '1']), { cls: 1, raw: 'Class 1' });
    assert.deepStrictEqual(cmd.formatResult(['Class', '2']), { cls: 2, raw: 'Class 2' });
});

// The raw wording has to survive: only that makes it possible to see later in
// the activity log what the device actually said.
test('an unusable answer keeps its wording', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['Nonsense']), { cls: null, raw: 'Nonsense' });
    assert.deepStrictEqual(cmd.formatResult([]), { cls: null, raw: '' });
});

// PJLink only knows Class 1 and 2. Anything else is not a class.
test('a digit outside 1 and 2 does not count as a class', () => {
    const cmd = new Command.ClassCommand(function () {});
    assert.deepStrictEqual(cmd.formatResult(['Class', '7']), { cls: null, raw: 'Class 7' });
});
