const test = require('node:test');
const assert = require('node:assert');
const { runRaw } = require('../lib/raw-console.js');

// A stand-in for the PJLink connection: it hands every line to `answer` and
// remembers what it was given.
function fakeLink(answer) {
    const sent = [];
    return {
        sent,
        sendRaw(parts, cb) {
            sent.push(parts);
            setImmediate(function () { answer(parts, cb); });
        }
    };
}

// A clock that moves on by 25 ms every time it is read.
function steppingClock() {
    let t = 1000;
    return function () { t += 25; return t; };
}

test('an answer comes back with its meaning and how long it took', async () => {
    const link = fakeLink(function (parts, cb) { cb(null, '%1AVMT=31'); });
    const result = await runRaw(link, '%1AVMT ?', steppingClock());
    assert.deepStrictEqual(result, {
        ok: true, sent: '%1AVMT ?', received: '%1AVMT=31',
        meaning: { key: 'avmt31' }, changes: false, ms: 25
    });
});

test('what is sent is the line the projector gets, not what was typed', async () => {
    const link = fakeLink(function (parts, cb) { cb(null, '%1AVMT=OK'); });
    const result = await runRaw(link, '  %1avmt 21 ', steppingClock());
    assert.strictEqual(result.sent, '%1AVMT 21');
    assert.deepStrictEqual(link.sent, [{ cls: 1, cmd: 'AVMT', param: '21' }]);
});

test('a command that sets something asks for the screen to catch up', async () => {
    const link = fakeLink(function (parts, cb) { cb(null, '%1AVMT=OK'); });
    assert.strictEqual((await runRaw(link, '%1AVMT 21')).changes, true);
    assert.strictEqual((await runRaw(link, '%2INNM ?31')).changes, false);
});

test('an invalid line is not sent', async () => {
    const link = fakeLink(function () { assert.fail('must not be sent'); });
    const result = await runRaw(link, '%1AVMT?');
    assert.deepStrictEqual(result, { ok: false, sent: '%1AVMT?', reason: 'invalid', invalid: 'separator', changes: false, ms: 0 });
    assert.strictEqual(link.sent.length, 0);
});

test('without a connection nothing is sent', async () => {
    const result = await runRaw(null, '%1POWR ?');
    assert.deepStrictEqual(result, { ok: false, sent: '%1POWR ?', reason: 'not-connected', changes: false, ms: 0 });
});

test('no answer is a timeout — and a set command may still have worked', async () => {
    const link = fakeLink(function (parts, cb) { cb(new Error('Connection timeout')); });
    const result = await runRaw(link, '%1AVMT 21', steppingClock());
    assert.deepStrictEqual(result, {
        ok: false, sent: '%1AVMT 21', reason: 'timeout', detail: 'Connection timeout', changes: true, ms: 25
    });
});

test('a refused password and a dropped connection are told apart', async () => {
    const refused = fakeLink(function (parts, cb) { cb(new Error('Authorization failed')); });
    assert.strictEqual((await runRaw(refused, '%1POWR ?')).reason, 'auth');

    const dropped = fakeLink(function (parts, cb) { cb(new Error('read ECONNRESET')); });
    assert.strictEqual((await runRaw(dropped, '%1POWR ?')).reason, 'connection');
});
