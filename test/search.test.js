const test = require('node:test');
const assert = require('node:assert');
const dgram = require('node:dgram');
const { createSearch, SEARCH_COMMAND } = require('../lib/search');

// A projector that listens on the PJLink UDP port and answers the search.
// `answer` is what it puts on the wire — a device that says something else, or
// nothing, is a case of its own.
function fakeProjector(options) {
    const opts = options || {};
    const socket = dgram.createSocket('udp4');
    const heard = [];
    const timers = [];
    let closed = false;

    socket.on('message', (message, from) => {
        heard.push(message.toString());
        if (opts.silent) return;

        const reply = opts.answer !== undefined ? opts.answer : '%2ACKN=aa:bb:cc:dd:ee:ff';
        // A late answer may fall after the end of the test — then the socket
        // it would go out on is already gone.
        const send = () => { if (!closed) socket.send(reply, from.port, from.address); };
        if (opts.delay) timers.push(setTimeout(send, opts.delay)); else send();
    });

    return {
        heard,
        async start() {
            await new Promise((r) => socket.bind(0, '127.0.0.1', r));
            return socket.address().port;
        },
        stop() {
            closed = true;
            timers.forEach(clearTimeout);
            try { socket.close(); } catch (e) { /* already gone */ }
        }
    };
}

function build(port, extra) {
    return createSearch(Object.assign({
        broadcastAddresses: () => ['127.0.0.1'],
        port: port,
        listenPort: 0, // a real search binds 4352; a test must not fight for it
        waitMs: 300
    }, extra || {}));
}

// Spec 3.2.2: the search is one command, and it is these seven bytes.
test('the search command is the one from the specification', async () => {
    const projector = fakeProjector();
    const port = await projector.start();

    await build(port).search();

    assert.deepStrictEqual(projector.heard, ['%2SRCH\r']);
    assert.strictEqual(Buffer.from(SEARCH_COMMAND).toString('hex'), '25325352434808'.replace('08', '0d'));

    projector.stop();
});

test('a projector that answers is found, with its MAC address', async () => {
    const projector = fakeProjector();
    const port = await projector.start();

    const result = await build(port).search();

    assert.strictEqual(result.devices.length, 1);
    assert.strictEqual(result.devices[0].host, '127.0.0.1');
    assert.strictEqual(result.devices[0].port, port);
    assert.strictEqual(result.devices[0].mac, 'aa:bb:cc:dd:ee:ff');

    projector.stop();
});

// The same device can be reached over two interfaces and answer twice. It is
// still one projector.
test('the same projector twice is one projector', async () => {
    const projector = fakeProjector();
    const port = await projector.start();

    const search = createSearch({
        broadcastAddresses: () => ['127.0.0.1', '127.0.0.1'],
        port: port, listenPort: 0, waitMs: 300
    });
    const result = await search.search();

    assert.strictEqual(projector.heard.length, 2, 'asked twice');
    assert.strictEqual(result.devices.length, 1, 'answered as one');

    projector.stop();
});

// The UDP port is shared with the status notifications of 3.3, and anything at
// all can arrive on a broadcast port. Only an answer to this question counts.
test('anything that is not an answer is ignored', async () => {
    const projector = fakeProjector({ answer: '%2POWR=1' });
    const port = await projector.start();

    const result = await build(port).search();
    assert.deepStrictEqual(result.devices, []);

    projector.stop();
});

// Spec 3.2.1: the devices wait a random 0 to 10 seconds. Whoever cuts the
// window short does not get a faster search, only a smaller one — so an answer
// that comes after it is a projector this search did not find, and that has to
// stay visible as such rather than turning up half a screen later.
test('an answer after the window does not arrive any more', async () => {
    const projector = fakeProjector({ delay: 500 });
    const port = await projector.start();

    const result = await build(port, { waitMs: 100 }).search();
    assert.deepStrictEqual(result.devices, []);

    projector.stop();
});

test('a projector that says nothing is not a projector', async () => {
    const projector = fakeProjector({ silent: true });
    const port = await projector.start();

    const result = await build(port).search();
    assert.deepStrictEqual(result.devices, []);
    assert.strictEqual(result.problem, null);

    projector.stop();
});

// A laptop with its Wi-Fi off is an ordinary situation, not an exception. It
// has its own answer, the same one the other search gives.
test('without a network there is nothing to shout at', async () => {
    const search = createSearch({ broadcastAddresses: () => [], waitMs: 50 });
    const result = await search.search();

    assert.strictEqual(result.problem, 'no-network');
    assert.deepStrictEqual(result.devices, []);
});
