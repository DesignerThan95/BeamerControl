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
