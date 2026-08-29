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

module.exports = { avmtCodeFor: avmtCodeFor, combinedCodeFor: combinedCodeFor, meansTheDeviceCannot: meansTheDeviceCannot };
