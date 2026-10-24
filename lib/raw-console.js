// The PJLink console's one round trip: check the typed line, send it over the
// app's connection, and say what came back — as a plain object, because it
// crosses the IPC boundary, and an error thrown there only turns into
// "Error occurred in handler" in the log.
const reference = require('./pjlink-reference');

function reasonFor(error) {
    const message = (error && error.message) || '';
    if (/timeout/i.test(message)) return 'timeout';
    if (/Authorization failed/.test(message)) return 'auth';
    return 'connection';
}

function runRaw(link, text, now) {
    const clock = now || Date.now;
    const parts = reference.parseLine(text);

    if (parts.error) {
        return Promise.resolve({
            ok: false, sent: String(text == null ? '' : text).trim(),
            reason: 'invalid', invalid: parts.error, changes: false, ms: 0
        });
    }

    const sent = reference.toLine(parts);

    if (!link) {
        return Promise.resolve({ ok: false, sent: sent, reason: 'not-connected', changes: false, ms: 0 });
    }

    // Anything but a query may have changed the projector, and the operating
    // screen should look again — answer or not, since some devices carry a
    // command out without acknowledging it.
    const changes = parts.param.charAt(0) !== '?';
    const started = clock();

    return new Promise(function (resolve) {
        link.sendRaw(parts, function (err, received) {
            const ms = clock() - started;
            if (err) {
                resolve({ ok: false, sent: sent, reason: reasonFor(err), detail: err.message, changes: changes, ms: ms });
            } else {
                resolve({ ok: true, sent: sent, received: received, meaning: reference.describeLine(received), changes: changes, ms: ms });
            }
        });
    });
}

module.exports = { runRaw };
