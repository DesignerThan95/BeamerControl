const test = require('node:test');
const assert = require('node:assert');
const { avmtCodeFor, combinedCodeFor, meansTheDeviceCannot } = require('../lib/mute');

// One press, one command. Whoever mutes the sound has said nothing about the
// picture — and a second command is a second chance to run into a projector
// that has closed the connection after the first one.
test('only the half that was switched goes out', () => {
    assert.strictEqual(avmtCodeFor({ video: false, audio: true, only: 'audio' }), '21');
    assert.strictEqual(avmtCodeFor({ video: false, audio: false, only: 'audio' }), '20');
    assert.strictEqual(avmtCodeFor({ video: true, audio: false, only: 'video' }), '11');
    assert.strictEqual(avmtCodeFor({ video: false, audio: false, only: 'video' }), '10');
});

// The merged switch on a projector that couples the two moves both halves at
// once. That is the one case PJLink has a single value for.
test('if both halves move, the combined value carries it', () => {
    assert.strictEqual(avmtCodeFor({ video: true, audio: true, only: null }), '31');
    assert.strictEqual(avmtCodeFor({ video: false, audio: false, only: null }), '30');
});

// A wish for one of the two, carried out by a projector that only knows the
// combined switch: it takes both. Asking about the picture alone here would
// drop "sound off" on the floor — it would send 30, unmute everything, and
// report success for a command that did nothing.
test('the combined fallback keeps the wish rather than the picture', () => {
    assert.strictEqual(combinedCodeFor({ video: false, audio: true }), '31');
    assert.strictEqual(combinedCodeFor({ video: true, audio: false }), '31');
    assert.strictEqual(combinedCodeFor({ video: false, audio: false }), '30');
});

// This is the distinction the whole fallback hangs on. "The projector does not
// know this command" is a reason to try the combined value. "The projector did
// not answer" is not: sending a different mute value to a device that may not
// have heard the first one is how a sound command ends up blanking the screen.
test('only a refusal counts as "the device cannot do this"', () => {
    assert.strictEqual(meansTheDeviceCannot('Undefined command'), true);
    assert.strictEqual(meansTheDeviceCannot('Out of parameter'), true);

    assert.strictEqual(meansTheDeviceCannot('Connection timeout'), false);
    assert.strictEqual(meansTheDeviceCannot('Not connected'), false);
    assert.strictEqual(meansTheDeviceCannot('Unavailable time'), false);
    assert.strictEqual(meansTheDeviceCannot('Projector/Display failure'), false);
    assert.strictEqual(meansTheDeviceCannot(undefined), false);
});

// ---------------------------------------------------------------------------
// carryOut: one wish, on a device that behaves as its profile says
// ---------------------------------------------------------------------------

const { carryOut, QUIET_ANSWER_MS } = require('../lib/mute');

const STANDARD = { picture: 'separate', combinedAcknowledged: true, audioWhileCombined: true };
const OPTOMA = { picture: 'combined', combinedAcknowledged: false, audioWhileCombined: false, toggles: false };
const TOGGLING = Object.assign({}, OPTOMA, { toggles: true });

// Plays a projector: `answers` maps an AVMT value to what comes back — 'OK',
// or the message of the error it is refused or lost with.
function device(answers) {
    const sent = [];
    return {
        sent,
        send(code, options) {
            sent.push({ code, options });
            const answer = answers[code] || 'OK';
            return answer === 'OK' ? Promise.resolve() : Promise.reject(new Error(answer));
        }
    };
}

test('on a standard device the picture goes out as 11', async () => {
    const d = device({});
    const result = await carryOut(d.send, { video: true, audio: false, only: 'video' }, STANDARD);
    assert.deepStrictEqual(d.sent, [{ code: '11', options: null }]);
    assert.deepStrictEqual(result, { success: true, mode: 'separate' });
});

test('a profile with a combined picture sends 31 straight away, with a short wait', async () => {
    const d = device({ '31': 'Connection timeout' });
    const result = await carryOut(d.send, { video: true, audio: true, only: 'video' }, OPTOMA);
    assert.deepStrictEqual(d.sent, [{ code: '31', options: { answerTimeout: QUIET_ANSWER_MS } }]);
    assert.deepStrictEqual(result, { success: true, mode: 'combined', unanswered: true, expected: true });
});

test('the sound keeps its own value on a device with a combined picture', async () => {
    const d = device({});
    await carryOut(d.send, { video: false, audio: true, only: 'audio' }, OPTOMA);
    assert.deepStrictEqual(d.sent, [{ code: '21', options: null }]);
});

test('a refused 11 falls back to 31 and is remembered as learned', async () => {
    const d = device({ '11': 'Undefined command', '31': 'Connection timeout' });
    const result = await carryOut(d.send, { video: true, audio: false, only: 'video' }, STANDARD);
    assert.deepStrictEqual(d.sent.map(function (s) { return s.code; }), ['11', '31']);
    assert.deepStrictEqual(result, {
        success: true, mode: 'combined', unanswered: true, reason: 'Connection timeout', learned: { picture: 'combined' }
    });
});

test('a refused sound value falls back too, but teaches nothing about the picture', async () => {
    const d = device({ '21': 'Undefined command' });
    const result = await carryOut(d.send, { video: false, audio: true, only: 'audio' }, STANDARD);
    assert.deepStrictEqual(d.sent.map(function (s) { return s.code; }), ['21', '31']);
    assert.strictEqual(result.learned, null);
});

test('silence after a separate value is not taken for a refusal', async () => {
    const d = device({ '11': 'Connection timeout' });
    const result = await carryOut(d.send, { video: true, audio: false, only: 'video' }, STANDARD);
    assert.deepStrictEqual(d.sent.map(function (s) { return s.code; }), ['11']);
    assert.deepStrictEqual(result, { success: true, unanswered: true, reason: 'Connection timeout' });
});

test('a device that refuses even the combined value gets an error', async () => {
    const d = device({ '31': 'Undefined command' });
    await assert.rejects(() => carryOut(d.send, { video: true, audio: true, only: 'video' }, OPTOMA), /Undefined command/);
});

// A device that only reads the first digit and toggles: the value sent means
// nothing, only whether the device is in the other state right now.
function reports(state) {
    return function () { return Promise.resolve(state); };
}

test('a toggling device gets no command when it is already where the wish wants it', async () => {
    const d = device({});
    const result = await carryOut(d.send, { video: true, audio: true, only: 'video' }, TOGGLING, reports({ video: true, audio: true }));
    assert.deepStrictEqual(d.sent, []);
    assert.deepStrictEqual(result, { success: true, mode: 'none', already: true });
});

test('a toggling device gets the command when it is in the other state', async () => {
    const d = device({ '31': 'Connection timeout' });
    const result = await carryOut(d.send, { video: true, audio: true, only: 'video' }, TOGGLING, reports({ video: false, audio: true }));
    assert.deepStrictEqual(d.sent.map(function (s) { return s.code; }), ['31']);
    assert.strictEqual(result.expected, true);
});

test('for the sound a toggling device is judged by the sound alone', async () => {
    const d = device({});
    await carryOut(d.send, { video: false, audio: false, only: 'audio' }, TOGGLING, reports({ video: false, audio: false }));
    assert.deepStrictEqual(d.sent, []);
    await carryOut(d.send, { video: false, audio: false, only: 'audio' }, TOGGLING, reports({ video: false, audio: true }));
    assert.deepStrictEqual(d.sent.map(function (s) { return s.code; }), ['20']);
});

test('a failed state query on a toggling device is an error, not a guess', async () => {
    const d = device({});
    const failing = function () { return Promise.reject(new Error('Connection timeout')); };
    await assert.rejects(() => carryOut(d.send, { video: true, audio: true, only: 'video' }, TOGGLING, failing), /Connection timeout/);
    assert.deepStrictEqual(d.sent, []);
});
