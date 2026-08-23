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
    const answers = Object.assign({
        POWR: '1', SNUM: 'SN-4711', SVER: 'FW 1.20', FREZ: '0',
        IRES: '1920x1080', RRES: '1920x1080', FILT: '1234',
        RLMP: 'ET-LAV400', RFIL: 'ET-RFV400', INNM: 'HDMI front'
    }, values || {});

    const server = net.createServer(function (sock) {
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
test('Class 1 and Class 2 run mixed over the same connection', async () => {
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
