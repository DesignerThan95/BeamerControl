// The one connection to the projector, and the rules about who is allowed to
// throw it away.
//
// This used to be a single `let projector` in main.js, and two things went
// wrong with it once the projector was not answering:
//
//   * Two connection attempts could overlap — the poll loop's beat and someone
//     pressing "try again". Both wrote into the same variable, so a later
//     attempt quietly took the connection over from an earlier one that was
//     still running.
//
//   * A failed attempt cleared the variable. An attempt that had been hanging
//     for its full timeout therefore tore down a connection that had been
//     built successfully in the meantime — and every command after that failed
//     instantly with "Not connected", although the projector was answering.
//
// Hence the two rules kept here: at most one attempt at a time, and an attempt
// may only let go of the connection it opened itself.

// `open` is handed the settings and returns something that can talk PJLink —
// in the app that is a PJLink object, in the tests a stand-in.
function createConnection(open) {
    let link = null;
    let attempt = null;
    // Counts up whenever the picture changes underneath a running attempt.
    // An attempt that comes back to a different number knows it is no longer
    // the one that counts.
    let token = 0;

    function current() {
        return link;
    }

    // For the command handlers: either the connection, or the same wording the
    // library uses for it. No handler should ever see a null.
    function requireLink() {
        if (!link) throw new Error('Not connected');
        return link;
    }

    // Builds the connection, or joins the attempt already under way. The
    // handshake decides what "connected" means — in the app: the projector
    // answered a first query.
    function connect(settings, handshake) {
        const address = JSON.stringify(settings);

        if (attempt) {
            // The same projector: whoever asks second waits for the attempt
            // already running instead of opening a second connection to it.
            if (attempt.address === address) return attempt.promise;

            // A different one — somebody typed a new address on the technical
            // page. Then the running attempt is for a device nobody is asking
            // about any more.
            token++;
            attempt = null;
        }

        const mine = ++token;
        const candidate = open(settings);
        const record = { token: mine, address: address, promise: null };
        attempt = record;

        record.promise = (async () => {
            try {
                const result = await handshake(candidate);

                // Someone let go of this attempt while it was running. Then
                // its connection is not wanted either, whatever it may say.
                if (mine !== token) {
                    candidate.disconnect();
                    throw new Error('Not connected');
                }

                link = candidate;
                return result;
            } catch (error) {
                candidate.disconnect();
                // Only our own. By now this may be a connection that someone
                // else built successfully.
                if (mine === token) link = null;
                throw error;
            } finally {
                if (attempt === record) attempt = null;
            }
        })();

        return record.promise;
    }

    function disconnect() {
        // Invalidates an attempt that is still running: whatever it brings
        // back, nobody is waiting for it any more.
        token++;
        attempt = null;

        if (link) {
            link.disconnect();
            link = null;
        }
    }

    return { connect, current, require: requireLink, disconnect };
}

module.exports = { createConnection };
