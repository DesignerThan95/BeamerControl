// Which AVMT value carries out a mute wish — and when a failed attempt says
// something about the projector rather than about the network.
//
// PJLink knows six values: 11/10 hide and show the picture, 21/20 mute and
// unmute the sound, 31/30 do both at once. That is the whole vocabulary.
//
// This used to be two commands in a row: first the picture, then the sound,
// both on every press. It cost nothing on a device that answers, and
// everything on one that does not — a projector that closes the connection
// after the first command leaves the second one hanging until the timeout,
// and the timeout then reported a failure for a command the projector had
// carried out. So: one press, one command, for the half that was switched.

var SEPARATE = {
    video: { on: '11', off: '10' },
    audio: { on: '21', off: '20' }
};

var BOTH = { on: '31', off: '30' };

// `only` says which half the user moved — that is the half that gets a
// command. Nothing else is asked for, so nothing else is sent.
function avmtCodeFor(wish) {
    var half = SEPARATE[wish.only];
    if (half) return wish[wish.only] ? half.on : half.off;

    return combinedCodeFor(wish);
}

// The one value a projector without separate switches understands. Whoever
// asked for one of the two gets both — that is all a combined switch can do,
// and it keeps the wish instead of quietly dropping it.
function combinedCodeFor(wish) {
    return (wish.video || wish.audio) ? BOTH.on : BOTH.off;
}

// "The projector does not know this" — ERR1 and ERR2 in the standard, and the
// only two answers that justify trying the combined value instead.
//
// Everything else means the attempt never got through: a timeout, a connection
// that had already gone, a projector busy warming up. Sending a different mute
// value after one of those is guesswork against a device that may well have
// carried out the first one — which is how a command meant for the sound ends
// up blanking the screen in the middle of a service.
var REFUSALS = ['Undefined command', 'Out of parameter'];

function meansTheDeviceCannot(message) {
    return REFUSALS.indexOf(message) !== -1;
}

function isCombined(code) {
    return code === BOTH.on || code === BOTH.off;
}

function isTimeout(error) {
    return /timeout/i.test((error && error.message) || '');
}

// How long a device that never answers the combined value gets before the
// command counts as sent. Long enough for one that does answer after all —
// the Optoma answers everything else within 50 ms — and short enough that the
// queries queued behind it are not held up.
var QUIET_ANSWER_MS = 1500;

// Carries one mute wish out on a device that behaves as `behaviour` says (see
// lib/device-profiles.js). `send(code, options)` sends one AVMT value and
// resolves or rejects with the projector's answer.
//
// The result says what happened, and — under `learned` — what the attempt
// revealed about the device, so the next press does not have to find out again.
//
// `query()` reads the current mute state ({video, audio}). It is only needed
// for a device whose AVMT values toggle (behaviour.toggles): there the value
// sent says nothing, only the moment does — so a command may only go out when
// the device is really in the other state, or it switches the wrong way.
function carryOut(send, wish, behaviour, query) {
    var b = behaviour || { picture: 'separate', combinedAcknowledged: true, audioWhileCombined: true, toggles: false };

    if (b.toggles && query) {
        return query().then(function (current) {
            // The half that decides: the sound for a sound wish, the picture
            // for everything else (a combined mute reports both as muted).
            var half = wish.only === 'audio' ? 'audio' : 'video';
            if (current && current[half] === wish[half]) {
                return { success: true, mode: 'none', already: true };
            }
            return carryOut(send, wish, Object.assign({}, b, { toggles: false }));
        });
    }

    // A device without a separate picture switch gets the combined value for
    // the picture straight away. Asking for 11 first would only fetch the
    // refusal it is known to give.
    var code = (b.picture === 'combined' && wish.only === 'video') ? combinedCodeFor(wish) : avmtCodeFor(wish);

    function optionsFor(value) {
        return isCombined(value) && b.combinedAcknowledged === false ? { answerTimeout: QUIET_ANSWER_MS } : null;
    }

    // Silence after a combined value from a device known to keep quiet about
    // it is what was expected, not a failure.
    function expectedSilence(value, error) {
        return isCombined(value) && b.combinedAcknowledged === false && isTimeout(error);
    }

    return send(code, optionsFor(code)).then(function () {
        return { success: true, mode: isCombined(code) ? 'combined' : 'separate' };
    }, function (error) {
        if (expectedSilence(code, error)) {
            return { success: true, mode: 'combined', unanswered: true, expected: true };
        }
        // Not even the combined value: there is nothing left to try.
        if (isCombined(code) && meansTheDeviceCannot(error.message)) throw error;

        if (!meansTheDeviceCannot(error.message)) {
            return { success: true, unanswered: true, reason: error.message };
        }

        // Refused: this device does not know the separate value. If it was the
        // picture, that is worth remembering — it is the half PJLink devices
        // most often leave out.
        var learned = wish.only === 'video' ? { picture: 'combined' } : null;
        var fallback = combinedCodeFor(wish);

        return send(fallback, optionsFor(fallback)).then(function () {
            return { success: true, mode: 'combined', reason: error.message, learned: learned };
        }, function (second) {
            if (isTimeout(second)) {
                return { success: true, mode: 'combined', unanswered: true, reason: second.message, learned: learned };
            }
            throw second;
        });
    });
}

module.exports = {
    avmtCodeFor: avmtCodeFor,
    combinedCodeFor: combinedCodeFor,
    meansTheDeviceCannot: meansTheDeviceCannot,
    carryOut: carryOut,
    QUIET_ANSWER_MS: QUIET_ANSWER_MS
};
