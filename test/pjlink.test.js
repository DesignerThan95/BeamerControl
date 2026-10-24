const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const PJLink = require('../index.js');

// A very small PJLink projector you can touch. It announces itself without a
// password prompt, remembers every line it receives and answers it. That makes
// it possible to check what really goes onto the wire — which is exactly what
// the class in the header is about.
function fakeProjector(values) {
    const lines = [];
    const sockets = [];
    const answers = Object.assign({
        POWR: '1', SNUM: 'SN-4711', SVER: 'FW 1.20', FREZ: '0',
        IRES: '1920x1080', RRES: '1920x1080', FILT: '1234',
        RLMP: 'ET-LAV400', RFIL: 'ET-RFV400', INNM: 'HDMI front'
    }, values || {});

    const server = net.createServer(function (sock) {
        sockets.push(sock);
        sock.write('PJLINK 0\r');
        let buffer = '';

        sock.on('data', function (d) {
            buffer += d.toString();
            let i;
            while ((i = buffer.indexOf('\r')) !== -1) {
                const line = buffer.slice(0, i);
                buffer = buffer.slice(i + 1);
                lines.push(line);

                const header = line.slice(0, 2);
                const command = line.slice(2, 6);
                const parameter = line.slice(7);
                const value = parameter.charAt(0) === '?' ? (answers[command] || 'OK') : 'OK';
                sock.write(header + command + '=' + value + '\r');
            }
        });
        sock.on('error', function () { /* connection dropped at the end of the test */ });
    });

    return {
        lines,
        sockets,
        async start() {
            await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
            return server.address().port;
        },
        stop() { server.close(); }
    };
}

// Calls a method of the library as a promise.
function call(projector, method) {
    const rest = Array.prototype.slice.call(arguments, 2);
    return new Promise(function (resolve, reject) {
        projector[method].apply(projector, rest.concat([function (err, result) {
            if (err) reject(err); else resolve(result);
        }]));
    });
}

async function withProjector(fn, values) {
    const fake = fakeProjector(values);
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 4000 });
    try {
        await fn(projector, fake);
    } finally {
        projector.disconnect();
        fake.stop();
    }
}

test('a Class 1 command goes onto the wire unchanged with %1', async () => {
    await withProjector(async function (projector, fake) {
        const state = await call(projector, 'getPowerState');
        assert.strictEqual(state, 1);
        assert.deepStrictEqual(fake.lines, ['%1POWR ?']);
    });
});

test('a Class 2 command goes onto the wire with %2', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'getSerialNumber');
        assert.deepStrictEqual(fake.lines, ['%2SNUM ?']);
    });
});

// The heart of the extension: both classes share one connection and one queue.
// The class belongs to the individual command.
test('Class 1 and Class 2 run mixed through the same queue', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'getPowerState');
        await call(projector, 'getSerialNumber');
        await call(projector, 'getPowerState');
        await call(projector, 'getSoftwareVersion');

        assert.deepStrictEqual(fake.lines, [
            '%1POWR ?', '%2SNUM ?', '%1POWR ?', '%2SVER ?'
        ]);
    });
});

// Spec 5.4: "The CONTROLLER must terminate the TCP connection as soon as the
// required command transmission is completed."
//
// This is not pedantry. A connection held open across a pause is a connection
// the projector may have thrown away in the meantime — the spec gives it 30
// seconds and real devices are quicker. Writing into it costs no error, only
// silence, and the command that went into it is reported as failed although
// nobody ever heard it. A fresh connection per exchange cannot be stale.
test('every exchange gets its own connection, and it is closed afterwards', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'getPowerState');
        assert.strictEqual(fake.sockets.length, 1);

        await call(projector, 'getPowerState');
        await call(projector, 'getPowerState');
        assert.strictEqual(fake.sockets.length, 3, 'one connection per exchange');

        await wait(50);
        const open = fake.sockets.filter(function (s) { return !s.destroyed; });
        assert.strictEqual(open.length, 0, 'and none of them is left open');
    });
});

test('serial number and software version arrive as text', async () => {
    await withProjector(async function (projector) {
        assert.strictEqual(await call(projector, 'getSerialNumber'), 'SN-4711');
        assert.strictEqual(await call(projector, 'getSoftwareVersion'), 'FW 1.20');
    });
});

test('switching freeze and querying it', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'setFreeze', true);
        assert.strictEqual(fake.lines[0], '%2FREZ 1');

        await call(projector, 'setFreeze', false);
        assert.strictEqual(fake.lines[1], '%2FREZ 0');

        assert.strictEqual(await call(projector, 'getFreeze'), false);
        assert.strictEqual(fake.lines[2], '%2FREZ ?');
    }, { FREZ: '0' });
});

test('volume only goes up and down', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'speakerVolumeUp');
        await call(projector, 'speakerVolumeDown');
        await call(projector, 'microphoneVolumeUp');
        await call(projector, 'microphoneVolumeDown');

        assert.deepStrictEqual(fake.lines, [
            '%2SVOL 1', '%2SVOL 0', '%2MVOL 1', '%2MVOL 0'
        ]);
    });
});

test('the name of an input is asked for with its code', async () => {
    await withProjector(async function (projector, fake) {
        const name = await call(projector, 'getInputName', '31');
        assert.strictEqual(fake.lines[0], '%2INNM ?31');
        assert.strictEqual(name, 'HDMI front');
    });
});

test('resolutions arrive split up', async () => {
    await withProjector(async function (projector) {
        assert.deepStrictEqual(await call(projector, 'getInputResolution'), {
            code: '1920x1080', width: 1920, height: 1080
        });
        assert.deepStrictEqual(await call(projector, 'getRecommendedResolution'), {
            code: '1280x800', width: 1280, height: 800
        });
    }, { RRES: '1280x800' });
});

test('maintenance readings arrive', async () => {
    await withProjector(async function (projector) {
        assert.strictEqual(await call(projector, 'getFilterUsage'), 1234);
        assert.deepStrictEqual(await call(projector, 'getLampReplacements'), ['ET-LAV400']);
        assert.deepStrictEqual(await call(projector, 'getFilterReplacements'), ['ET-RFV400']);
    });
});

// A Class 1 projector answers Class 2 commands with ERR1. That has to reach
// the caller as an ordinary error and must not destroy the connection — the
// next Class 1 command has to keep working.
test('ERR1 on a Class 2 command leaves the connection intact', async () => {
    await withProjector(async function (projector) {
        await assert.rejects(() => call(projector, 'getSerialNumber'), /Undefined command/);
        assert.strictEqual(await call(projector, 'getPowerState'), 1);
    }, { SNUM: 'ERR1' });
});

// A real Optoma answers %1CLSS ? with "Class 1" instead of "1" (measured:
// PJLINK 0 / %1CLSS=Class 1). That has to survive the whole chain —
// response.js splits such an answer on the space.
test('the class figure arrives even with a word in front', async () => {
    await withProjector(async function (projector, fake) {
        const result = await call(projector, 'getClass');
        assert.strictEqual(fake.lines[0], '%1CLSS ?');
        assert.deepStrictEqual(result, { cls: 1, raw: 'Class 1' });
    }, { CLSS: 'Class 1' });
});

test('a Class 2 device is recognized with a word in front too', async () => {
    await withProjector(async function (projector) {
        assert.deepStrictEqual(await call(projector, 'getClass'), { cls: 2, raw: 'Class 2' });
    }, { CLSS: 'Class 2' });
});

test('the spec-conforming class figure arrives unchanged', async () => {
    await withProjector(async function (projector) {
        assert.deepStrictEqual(await call(projector, 'getClass'), { cls: 2, raw: '2' });
    }, { CLSS: '2' });
});

// ---------------------------------------------------------------------------
// What happens when the projector cannot be reached
// ---------------------------------------------------------------------------

// A projector that accepts the connection and then says nothing. That is what
// a device in standby looks like, and what the app runs into when the beamer
// is not there.
function silentProjector(onSocket) {
    const sockets = [];
    const server = net.createServer(function (sock) {
        sockets.push(sock);
        sock.on('error', function () { /* dropped at the end of the test */ });
        if (onSocket) onSocket(sock);
    });

    return {
        sockets,
        async start() {
            await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
            return server.address().port;
        },
        stop() { server.close(); }
    };
}

function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

// The reason for the error box in the running app: after the timeout the
// library used to take its listeners off the socket but leave the socket
// open. Whatever the socket said afterwards — a reset by the projector, or
// the operating system giving up on an unreachable host a minute later —
// arrived as an 'error' event with nobody listening. In Electron that is an
// uncaught exception in the main process, and Electron shows it as a dialog.
test('a connection dropped after the timeout does not throw', async () => {
    const fake = silentProjector();
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 300 });

    await assert.rejects(() => call(projector, 'getPowerState'), /Connection timeout/);

    // The projector throws the connection away — a reset, not a polite close.
    fake.sockets.forEach(function (sock) {
        if (sock.resetAndDestroy) sock.resetAndDestroy();
        else sock.destroy(new Error('ECONNRESET'));
    });

    // If the socket is still unguarded, the error lands here and node:test
    // fails this test with an uncaught exception.
    await wait(200);
    fake.stop();
});

// ---------------------------------------------------------------------------
// Where a response ends
// ---------------------------------------------------------------------------

// TCP knows no lines. What the projector writes in one go can reach us in two
// pieces, and what it writes in two can reach us as one. The spec (2.2) names
// the carriage return as the terminator of a response — that, and nothing
// else, is where a response ends.
//
// Taking each arrival for a whole response gets this wrong twice over: half a
// response is read as a complete one (a power state that is neither on nor
// off), and the other half then turns up with nothing waiting for it.
test('a response split over two packets is still one response', async () => {
    const fake = silentProjector(function (sock) {
        sock.write('PJLINK 0\r');
        sock.on('data', function () {
            sock.write('%1POWR');
            setTimeout(function () { sock.write('=1\r'); }, 30);
        });
    });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 2000 });

    const state = await call(projector, 'getPowerState');
    assert.strictEqual(state, 1, 'the projector said it is on');

    projector.disconnect();
    fake.stop();
});

// And the half that never gets its second half. A projector that breaks off
// mid-response leaves a fragment behind; the next connection starts a new
// conversation, and the fragment must not be glued to the front of it.
test('half a response does not carry over to the next connection', async () => {
    let connections = 0;
    const fake = silentProjector(function (sock) {
        connections++;
        sock.write('PJLINK 0\r');
        if (connections === 1) {
            // First connection: half an answer, then away.
            sock.on('data', function () {
                sock.write('%1POWR');
                setTimeout(function () { sock.destroy(); }, 20);
            });
        } else {
            sock.on('data', function () { sock.write('%1POWR=1\r'); });
        }
    });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 2000 });

    await assert.rejects(() => call(projector, 'getPowerState'));

    // The fragment "%1POWR" is gone. If it were still in the buffer, the next
    // answer would be read as "%1POWR%1POWR=1".
    assert.strictEqual(await call(projector, 'getPowerState'), 1);

    projector.disconnect();
    fake.stop();
});

// After a timeout the object has to be usable again. It builds a fresh
// connection for the next command instead of waiting for one that is gone.
test('after a timeout the next command is sent again', async () => {
    const fake = silentProjector();
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 300 });

    await assert.rejects(() => call(projector, 'getPowerState'), /Connection timeout/);
    const opened = fake.sockets.length;

    await assert.rejects(() => call(projector, 'getPowerState'), /Connection timeout/);
    assert.strictEqual(fake.sockets.length, opened + 1, 'the second command has to open its own connection');

    projector.disconnect();
    fake.stop();
});

// ---------------------------------------------------------------------------
// Class 2 input codes
// ---------------------------------------------------------------------------

// Spec 4.3/4.4: Class 1 numbers its inputs 11 to 59 — a digit for the kind of
// connector, a digit for which one. Class 2 widened the second half to
// "1-9 and A~Z" and added a sixth kind (INTERNAL), so the codes run 11 to 6Z.
//
// Reading the second half as a number turns HDMI-A into "3NaN" — and a command
// that does not meet the format requirements is one a projector answers not
// with an error but with silence (spec 6, Response method). It would look
// exactly like an unreachable projector.
test('an input code with a letter goes onto the wire as it is', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'setInput', '3A');
        assert.deepStrictEqual(fake.lines, ['%1INPT 3A']);
    });
});

test('the internal source of Class 2 is a source like any other', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'setInput', '61');
        assert.deepStrictEqual(fake.lines, ['%1INPT 61']);
    });
});

test('an input code with a letter is read back as it is', async () => {
    await withProjector(async function (projector) {
        const input = await call(projector, 'getInput');
        assert.strictEqual(input.code, '3A');
        assert.strictEqual(input.channel, 'A');
        assert.strictEqual(input.source, 3);
    }, { INPT: '3A' });
});

test('the list of inputs keeps the Class 2 codes', async () => {
    await withProjector(async function (projector) {
        const inputs = await call(projector, 'getInputs');
        assert.deepStrictEqual(inputs.map(function (i) { return i.code; }), ['31', '3A', '61']);
    }, { INST: '31 3A 61' });
});

// The Class 1 codes must come through untouched — they are what every
// projector in use here speaks.
test('a Class 1 input code is unchanged', async () => {
    await withProjector(async function (projector, fake) {
        await call(projector, 'setInput', '32');
        assert.deepStrictEqual(fake.lines, ['%1INPT 32']);
    });
});

// ---------------------------------------------------------------------------
// Authentication (spec 5.1)
// ---------------------------------------------------------------------------

// A projector that wants a password. `level` is what it announces itself with:
// 1 is the procedure of the old specification, and a device that also knows the
// newer one answers the question "PJLINK 2" with a 16-byte random number.
function passwordProjector(options) {
    const opts = options || {};
    const lines = [];
    const connections = [];

    const server = net.createServer(function (sock) {
        const seen = { lines: [] };
        connections.push(seen);
        sock.on('error', function () { /* dropped at the end of the test */ });
        sock.write('PJLINK 1 ' + (opts.random4 || '498e4a67') + '\r');

        let buffer = '';
        sock.on('data', function (d) {
            buffer += d.toString();
            let i;
            while ((i = buffer.indexOf('\r')) !== -1) {
                const line = buffer.slice(0, i);
                buffer = buffer.slice(i + 1);
                lines.push(line);
                seen.lines.push(line);

                if (line === 'PJLINK 2') {
                    if (opts.sha256) sock.write('PJLINK 2 ' + opts.random16 + '\r');
                    else if (opts.refuseProbe) sock.write('PJLINK ERRA\r');
                    // otherwise: no answer at all, which the spec also allows
                    continue;
                }

                // Everything else is a command, possibly with authentication
                // data in front of it.
                sock.write('%1POWR=1\r');
            }
        });
    });

    return {
        lines,
        connections,
        async start() {
            await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
            return server.address().port;
        },
        stop() { server.close(); }
    };
}

// The worked example from spec 5.1 of the old specification, digit for digit:
// password "JBMIAProjectorLink", random number 498e4a67, MD5 digest
// 5d8409bc1c3fa39749434aa3a5c38682 in front of the command. This is what a
// projector checks against, so it is worth pinning to the character.
test('the digest of the old procedure is the one from the specification', async () => {
    const fake = passwordProjector({ refuseProbe: true });
    const port = await fake.start();
    const projector = new PJLink({
        host: '127.0.0.1', port: port, password: 'JBMIAProjectorLink',
        timeout: 4000, authTimeout: 2000
    });

    assert.strictEqual(await call(projector, 'getPowerState'), 1);
    assert.deepStrictEqual(fake.connections[1].lines, ['5d8409bc1c3fa39749434aa3a5c38682%1POWR ?']);

    projector.disconnect();
    fake.stop();
});

// Spec 5.1 of version 2.10: the controller asks "PJLINK 2" for the security
// level, the projector answers with a 16-byte random number, and the digest is
// SHA256 over the XOR of the two random numbers plus the password.
test('a projector that knows SHA256 is answered with SHA256', async () => {
    const crypto = require('node:crypto');
    const random16 = '3db25e10f69c47a85adb24cf361897e0';
    const fake = passwordProjector({ sha256: true, random16: random16 });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: 'JBMIAProjectorLink', timeout: 2000 });

    assert.strictEqual(await call(projector, 'getPowerState'), 1);

    assert.strictEqual(fake.lines[0], 'PJLINK 2', 'the security level is asked for first');

    const sent = fake.lines[1];
    const ours = sent.slice(0, 32);
    const hash = sent.slice(32, 96);
    assert.strictEqual(sent.slice(96), '%1POWR ?', 'the command follows the authentication data');
    assert.match(ours, /^[0-9a-f]{32}$/, 'our own random number, 16 bytes as hex');

    // The projector checks it exactly this way (5.1, 1-6).
    const mixed = Buffer.from(ours, 'hex').map((b, i) => b ^ Buffer.from(random16, 'hex')[i]);
    const expected = crypto.createHash('sha256')
        .update(mixed.toString('hex') + 'JBMIAProjectorLink').digest('hex');
    assert.strictEqual(hash, expected);

    projector.disconnect();
    fake.stop();
});

// Spec 5.1: "If the projector does not respond as specified in this document
// (ERR response, incorrect response, no response, session disconnection, etc.)
// ... after terminating the session, the connection will be made using the
// protocol defined in the old specification."
test('a projector that stays silent about the security level gets the old procedure', async () => {
    const fake = passwordProjector(); // answers PJLINK 2 with nothing
    const port = await fake.start();
    const projector = new PJLink({
        host: '127.0.0.1', port: port, password: 'JBMIAProjectorLink',
        timeout: 4000, authTimeout: 200
    });

    assert.strictEqual(await call(projector, 'getPowerState'), 1);

    assert.deepStrictEqual(fake.connections[0].lines, ['PJLINK 2'], 'the first session ends unanswered');
    assert.deepStrictEqual(fake.connections[1].lines, ['5d8409bc1c3fa39749434aa3a5c38682%1POWR ?']);

    projector.disconnect();
    fake.stop();
});

test('a projector that refuses the question gets the old procedure', async () => {
    const fake = passwordProjector({ refuseProbe: true });
    const port = await fake.start();
    const projector = new PJLink({
        host: '127.0.0.1', port: port, password: 'JBMIAProjectorLink',
        timeout: 4000, authTimeout: 2000
    });

    assert.strictEqual(await call(projector, 'getPowerState'), 1);
    assert.deepStrictEqual(fake.connections[1].lines, ['5d8409bc1c3fa39749434aa3a5c38682%1POWR ?']);

    projector.disconnect();
    fake.stop();
});

// Asking costs a round trip. It is the projector's property, not the
// command's, so it is asked once and then known.
test('the security level is asked for once, not before every command', async () => {
    const fake = passwordProjector({ refuseProbe: true });
    const port = await fake.start();
    const projector = new PJLink({
        host: '127.0.0.1', port: port, password: 'JBMIAProjectorLink',
        timeout: 4000, authTimeout: 2000
    });

    await call(projector, 'getPowerState');
    await call(projector, 'getPowerState');

    assert.strictEqual(fake.lines.filter(function (l) { return l === 'PJLINK 2'; }).length, 1);

    projector.disconnect();
    fake.stop();
});

// Without a password there is nothing to authenticate with, and asking about
// the security level would only cost a round trip on every connection.
test('without a password nothing is asked', async () => {
    const fake = passwordProjector();
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 2000 });

    await call(projector, 'getPowerState');
    assert.strictEqual(fake.lines.indexOf('PJLINK 2'), -1);

    projector.disconnect();
    fake.stop();
});

// Spec 5.1: "Without passing through the authentication procedure, the
// projector will not accept PJLINK commands." A command written before the
// greeting has arrived carries no authentication data - the projector answers
// it with ERRA, or with nothing.
test('no command goes out before the greeting', async () => {
    let greeted = null;
    const fake = silentProjector(function (sock) {
        sock.on('data', function (d) {
            if (greeted === null) greeted = false; // something arrived too early
            sock.write('%1POWR=1\r');
        });
        // The greeting takes its time — up to two seconds are allowed (spec 6).
        setTimeout(function () {
            if (greeted === null) greeted = true;
            sock.write('PJLINK 0\r');
        }, 120);
    });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 2000 });

    // The second command arrives in the window that matters: the connection
    // stands, the greeting has not come yet.
    const first = call(projector, 'getPowerState');
    await wait(50);
    const second = call(projector, 'getPowerState');
    await first;
    await second;

    assert.strictEqual(greeted, true, 'the greeting has to come first');

    projector.disconnect();
    fake.stop();
});

// ---------------------------------------------------------------------------
// What is not a response (spec 2.2)
// ---------------------------------------------------------------------------

// A response is header, class, four characters of command body, '=', parameter,
// CR. The '=' is not decoration: it is what separates the command from its
// answer, and its absence means the line is not a response to anything.
//
// Reading such a line as a response invents an answer that was never given.
// The command it was meant for is better off being told that nothing usable
// came back — the alternative is that it waits for the full timeout for a
// second answer that has already been thrown away.
test('a line without the separator is not taken for an answer', async () => {
    const fake = silentProjector(function (sock) {
        sock.write('PJLINK 0\r');
        sock.on('data', function () { sock.write('%1POWR 1\r'); });
    });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 4000 });

    await assert.rejects(() => call(projector, 'getPowerState'), /Malformed response/);

    projector.disconnect();
    fake.stop();
});

test('noise on the line is not taken for an answer either', async () => {
    const fake = silentProjector(function (sock) {
        sock.write('PJLINK 0\r');
        sock.on('data', function () { sock.write('<html>404 not found</html>\r'); });
    });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 4000 });

    await assert.rejects(() => call(projector, 'getPowerState'), /Malformed response/);

    projector.disconnect();
    fake.stop();
});

// The greeting is the one line that carries a space instead of an '=' and is
// still perfectly in order (5.1, 5.2).
test('the greeting is not mistaken for a malformed response', async () => {
    await withProjector(async function (projector) {
        assert.strictEqual(await call(projector, 'getPowerState'), 1);
    });
});

// ---------------------------------------------------------------------------
// Raw lines from the PJLink console
// ---------------------------------------------------------------------------

test('a raw line goes onto the wire as given and its answer comes back raw', async () => {
    await withProjector(async function (projector, fake) {
        const answer = await call(projector, 'sendRaw', { cls: 1, cmd: 'AVMT', param: '?' });
        assert.strictEqual(answer, '%1AVMT=31');
        assert.deepStrictEqual(fake.lines, ['%1AVMT ?']);
    }, { AVMT: '31' });
});

test('ERR2 on a raw line is an answer, not an error', async () => {
    await withProjector(async function (projector) {
        const answer = await call(projector, 'sendRaw', { cls: 1, cmd: 'AVMT', param: '?' });
        assert.strictEqual(answer, '%1AVMT=ERR2');
    }, { AVMT: 'ERR2' });
});

test('a raw Class 2 line keeps its %2 on a Class 1 connection', async () => {
    await withProjector(async function (projector, fake) {
        assert.strictEqual(projector.class, 1);
        const answer = await call(projector, 'sendRaw', { cls: 2, cmd: 'SNUM', param: '?' });
        assert.strictEqual(answer, '%2SNUM=SN-4711');
        assert.deepStrictEqual(fake.lines, ['%2SNUM ?']);
    });
});

test('no answer to a raw line is an error', async () => {
    const fake = silentProjector();
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 300 });
    try {
        await assert.rejects(() => call(projector, 'sendRaw', { cls: 1, cmd: 'POWR', param: '?' }), /Connection timeout/);
    } finally {
        projector.disconnect();
        fake.stop();
    }
});

test('a refused password on a raw line is an error, not an answer', async () => {
    const fake = silentProjector(function (sock) {
        sock.write('PJLINK 1 1a2b3c4d\r');
        sock.on('data', function () { sock.write('PJLINK ERRA\r'); });
    });
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: 'wrong', timeout: 2000 });
    try {
        await assert.rejects(() => call(projector, 'sendRaw', { cls: 1, cmd: 'POWR', param: '?' }), /Authorization failed/);
    } finally {
        projector.disconnect();
        fake.stop();
    }
});

// ---------------------------------------------------------------------------
// A command with a short answer timeout of its own
// ---------------------------------------------------------------------------

// Answers everything except AVMT 31/30 — which it carries out without a word,
// like the Optoma 1080p.
function quietAboutCombinedMute() {
    return silentProjector(function (sock) {
        sock.write('PJLINK 0\r');
        sock.on('data', function (d) {
            for (const line of d.toString().split('\r').filter(Boolean)) {
                if (/^%1AVMT 3[01]$/.test(line)) continue;
                sock.write(line.slice(0, 6) + '=' + (line.slice(7) === '?' ? '1' : 'OK') + '\r');
            }
        });
    });
}

test('an unanswered command gives up after its own timeout, and the queue moves on', async () => {
    const fake = quietAboutCombinedMute();
    const port = await fake.start();
    const projector = new PJLink({ host: '127.0.0.1', port: port, password: null, timeout: 4000 });
    try {
        const started = Date.now();
        await assert.rejects(() => call(projector, 'setMuteRaw', '31', { answerTimeout: 200 }), /Connection timeout/);
        assert.ok(Date.now() - started < 1500, 'it must not wait out the connection timeout');

        // The next command gets a connection of its own and its own answer.
        assert.strictEqual(await call(projector, 'getPowerState'), 1);
    } finally {
        projector.disconnect();
        fake.stop();
    }
});

test('an answer before the short timeout counts as usual', async () => {
    await withProjector(async function (projector) {
        await call(projector, 'setMuteRaw', '21', { answerTimeout: 1000 });
        await call(projector, 'setMuteRaw', '20');
    });
});
