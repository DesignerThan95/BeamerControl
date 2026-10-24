// The device search of PJLink Class 2 (spec 3.2).
//
// The other search in this app knocks on 254 addresses per subnet, one TCP
// connection each, and takes as long as the slowest of them. This one is a
// single UDP packet to the broadcast address: "%2SRCH". Every projector that
// hears it answers with "%2ACKN=<MAC address>", and the address it came from
// is where it lives.
//
// It does not replace the other one. Only Class 2 devices know this question —
// a Class 1 projector says nothing at all, and there are plenty of those. So
// the two run side by side and what they find is put together.
//
// The spec has the devices wait a random 0 to 10 seconds before answering, so
// that a hall full of projectors does not answer in the same millisecond. That
// is why this takes ten seconds and cannot be hurried: an answer that has not
// arrived is not the same as no projector.

const dgramDefault = require('node:dgram');

const SEARCH_COMMAND = '%2SRCH\r';

// "%2ACKN=xx:xx:xx:xx:xx:xx" (3.2.2)
const ANSWER = /^%2ACKN=(.*)$/i;

// The window the spec gives the devices to answer in.
const WAIT_MS = 10000;

// Everything that touches the machine is handed in, which keeps the tests off
// the network: `broadcastAddresses` says where to shout, `dgram` is the socket
// library, `wait` is the clock.
function createSearch(deps) {
    const dgram = (deps && deps.dgram) || dgramDefault;
    const broadcastAddresses = deps.broadcastAddresses;
    const port = (deps && deps.port) || 4352;
    // Where we listen for the answers. Projectors answer to the address and
    // port the question came from; binding 4352 rather than a random port is
    // what the devices that answer to 4352 regardless expect.
    const listenPort = (deps && deps.listenPort !== undefined) ? deps.listenPort : 4352;
    const waitMs = (deps && deps.waitMs) || WAIT_MS;
    const wait = (deps && deps.wait) || function (ms) {
        return new Promise((r) => setTimeout(r, ms));
    };

    // Binding the well-known port is a wish, not a requirement: something else
    // on this machine may already have it. A random port still receives every
    // answer that goes back to where the question came from.
    function bind(socket) {
        return new Promise((resolve) => {
            const fallback = () => {
                socket.removeListener('error', onError);
                socket.bind(0, () => resolve());
            };
            const onError = () => fallback();

            socket.once('error', onError);
            socket.bind(listenPort, () => {
                socket.removeListener('error', onError);
                resolve();
            });
        });
    }

    async function search() {
        const targets = broadcastAddresses();
        const found = new Map();
        const failures = {};

        if (targets.length === 0) {
            return { devices: [], failures, problem: 'no-network' };
        }

        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        // A socket without an error listener turns its next error into an
        // uncaught exception, and in Electron that is a dialog box in front of
        // somebody who only wanted to find a projector.
        socket.on('error', (error) => {
            const code = error.code || 'ERROR';
            failures[code] = (failures[code] || 0) + 1;
        });

        socket.on('message', (message, from) => {
            const parts = ANSWER.exec(message.toString().trim());
            if (!parts) return; // not an answer to this question

            // The same projector may be reached over two interfaces. It is one
            // projector, and its address is where it answered from.
            found.set(from.address, {
                host: from.address,
                port: port,
                mac: parts[1].trim() || null,
                name: null
            });
        });

        await bind(socket);

        try {
            socket.setBroadcast(true);
        } catch (error) {
            // Some systems refuse broadcast without permission. Then the
            // question does not go out, and that is what gets reported.
            failures[error.code || 'ERROR'] = (failures[error.code || 'ERROR'] || 0) + 1;
        }

        for (const target of targets) {
            socket.send(SEARCH_COMMAND, port, target, (error) => {
                if (!error) return;
                const code = error.code || 'ERROR';
                failures[code] = (failures[code] || 0) + 1;
            });
        }

        await wait(waitMs);

        try {
            socket.close();
        } catch (error) {
            // Already gone. Nothing to do.
        }

        return { devices: [...found.values()], failures, problem: null };
    }

    return { search };
}

module.exports = { createSearch, SEARCH_COMMAND, WAIT_MS };
