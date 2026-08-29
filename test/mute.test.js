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
