const test = require('node:test');
const assert = require('node:assert');
const { createConnection } = require('../lib/connection.js');

// A stand-in for a PJLink object. It only records whether it was let go of,
// and it lets the test decide when — and whether — the handshake succeeds.
function fakeLink(name) {
    return { name, disconnected: false, disconnect() { this.disconnected = true; } };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise(function (a, b) { resolve = a; reject = b; });
    return { promise, resolve, reject };
}

test('a successful connection becomes the current one', async () => {
    const link = fakeLink('a');
    const connection = createConnection(function () { return link; });

    const result = await connection.connect({}, async function () { return { success: true }; });

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(connection.current(), link);
    assert.strictEqual(connection.require(), link);
});

test('without a connection, require() says so instead of handing out null', async () => {
    const connection = createConnection(function () { return fakeLink('a'); });
    assert.throws(() => connection.require(), /Not connected/);
});

test('a failed attempt lets go of its own link', async () => {
    const link = fakeLink('a');
    const connection = createConnection(function () { return link; });

    await assert.rejects(
        () => connection.connect({}, async function () { throw new Error('Connection timeout'); }),
        /Connection timeout/
    );

    assert.strictEqual(connection.current(), null);
    assert.strictEqual(link.disconnected, true, 'a link nobody uses has to be let go of');
});

// Two connection attempts used to run side by side — the poll loop's beat and
// someone pressing "try again". Both wrote into the same variable.
test('overlapping requests share one attempt', async () => {
    const links = [];
    const connection = createConnection(function () {
        const link = fakeLink('link' + links.length);
        links.push(link);
        return link;
    });

    const gate = deferred();
    const handshake = async function () { await gate.promise; return { success: true }; };

    const first = connection.connect({}, handshake);
    const second = connection.connect({}, handshake);

    gate.resolve();
    await Promise.all([first, second]);

    assert.strictEqual(links.length, 1, 'only one connection may be opened');
    assert.strictEqual(connection.current(), links[0]);
});

// The bug behind "trying again runs straight into an error": an attempt that
// had been hanging for its full timeout finished after a later attempt had
// already built a working connection — and cleared it on its way out. Every
// command after that failed instantly with "Not connected" although the
// projector was answering.
test('a late failure does not tear down a connection made since', async () => {
    const links = [];
    const connection = createConnection(function () {
        const link = fakeLink('link' + links.length);
        links.push(link);
        return link;
    });

    // The attempt from the time the projector was still asleep. It hangs.
    const slow = deferred();
    const hanging = connection.connect({}, function () { return slow.promise; });

    // The user lets go of the old attempt and tries again — the projector is
    // awake now and answers at once.
    connection.disconnect();
    await connection.connect({}, async function () { return { success: true }; });
    const good = connection.current();
    assert.ok(good, 'the fresh connection stands');

    // Only now does the old attempt run into its timeout.
    slow.reject(new Error('Connection timeout'));
    await assert.rejects(() => hanging, /Connection timeout/);

    assert.strictEqual(connection.current(), good, 'the working connection has to survive');
    assert.strictEqual(links[0].disconnected, true, 'the abandoned attempt lets go of its own link');
});

test('disconnect lets go of the connection', async () => {
    const link = fakeLink('a');
    const connection = createConnection(function () { return link; });

    await connection.connect({}, async function () { return { success: true }; });
    connection.disconnect();

    assert.strictEqual(connection.current(), null);
    assert.strictEqual(link.disconnected, true);
});

// Sharing an attempt is right for the same projector and wrong for another
// one: someone typing a new address on the technical page has to be told
// about THAT device, not about the one the poll loop is still waiting for.
test('a request for a different address does not join the running attempt', async () => {
    const opened = [];
    const connection = createConnection(function (settings) {
        const link = fakeLink(settings.host);
        opened.push(link);
        return link;
    });

    const slow = deferred();
    const hanging = connection.connect({ host: '10.0.0.1' }, function () { return slow.promise; });

    await connection.connect({ host: '10.0.0.2' }, async function () { return { success: true }; });

    assert.deepStrictEqual(opened.map((l) => l.name), ['10.0.0.1', '10.0.0.2']);
    assert.strictEqual(connection.current().name, '10.0.0.2');

    // The abandoned attempt answers late — and is ignored, whatever it says.
    slow.resolve({ success: true });
    await assert.rejects(() => hanging, /Not connected/);

    assert.strictEqual(connection.current().name, '10.0.0.2', 'the address that was asked for stands');
    assert.strictEqual(opened[0].disconnected, true, 'the abandoned attempt lets go of its link');
});
