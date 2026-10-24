// What a finished network search gets written into the activity log.
//
// Stays English, like the rest of the log: it is written for whoever maintains
// the installation, not for the congregation. The congregation gets the
// screens, which are translated.
//
// The point of this file is that a search which found nothing now says why the
// addresses stayed silent. "0 devices found" is the same sentence whether the
// projector is switched off or whether the operating system quietly refused
// every connection — and that is precisely the pair somebody standing in front
// of the app has to tell apart.
//
// Knows neither DOM nor projector. Runs in the renderer and in Node (for the
// tests).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.App = root.App || {};
        root.App.scanReport = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    // { EHOSTUNREACH: 252, TIMEOUT: 3 } -> "EHOSTUNREACH 252, TIMEOUT 3"
    // Most frequent first: the one code that covers a whole subnet is the
    // diagnosis, a stray single one is noise.
    function failureSummary(failures) {
        return Object.keys(failures ?? {})
            .sort((a, b) => failures[b] - failures[a])
            .map((code) => code + ' ' + failures[code])
            .join(', ');
    }

    // Returns { text, level } ready for App.log.add.
    function scanLogLine(result) {
        const devices = result?.devices ?? [];
        const checked = result?.checked ?? 0;

        if (result?.problem === 'no-network') {
            return {
                text: 'Network scan: this computer is on no network — nothing to search',
                level: 'error'
            };
        }

        if (devices.length > 0) {
            // The addresses with nothing behind them are the normal case here
            // and would only bury the one line that matters.
            return {
                text: 'Network scan: ' + devices.length + ' device(s) found, '
                    + checked + ' addresses checked',
                level: 'ok'
            };
        }

        const reasons = failureSummary(result?.failures);
        return {
            text: 'Network scan: no device found, ' + checked + ' addresses checked'
                + (reasons ? ' (' + reasons + ')' : ''),
            // Not an error: a projector that is switched off is the everyday
            // reason for this, and it is nothing the app can put right.
            level: 'info'
        };
    }

    return { failureSummary, scanLogLine };
});
