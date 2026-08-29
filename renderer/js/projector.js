// State machine of the projector: polls regularly, sends commands and waits
// for them to be confirmed. Knows no DOM — which is why it is testable without
// a window.
//
// commandError carries either the wording of the PJLink library or one of our
// own codes ('command-not-confirmed', 'command-failed'). No finished sentences
// live here: the translating happens on the operating screen.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.App = root.App || {};
        root.App.projector = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const POLL_MS = 5000;
    const FAST_POLL_MS = 1000;    // shortly after a command
    const FAST_WINDOW_MS = 20000; // for this long it stays fast
    const COMMAND_TIMEOUT_MS = 30000;
    const BACKOFF_MS = [5000, 10000, 20000, 30000];
    const MAX_FAILURES = 3;

    const POWER_NAMES = { 0: 'off', 1: 'on', 2: 'cooling', 3: 'warming' };

    function createProjector(deps) {
        const api = deps.api;
        const schedule = deps.schedule;
        const cancel = deps.cancel;
        const now = deps.now;
        // Which Class 2 extra features the technical staff have enabled.
        // Without that information: none — then everything behaves as before.
        const isFeatureEnabled = deps.isFeatureEnabled || function () { return false; };

        let state = {
            link: 'connecting',
            power: 'unknown',
            sourceCode: null,
            sourceName: null,
            mute: { video: false, audio: false },
            // What the projector reports about its PJLink level when connecting.
            // null means: not asked yet.
            pjlinkClass: null,
            // Where that figure comes from: 'reported' (the projector answered),
            // 'unanswered' (the query went nowhere) or 'unclear' (the answer was
            // neither 1 nor 2). The latter two both lead to Class 1 — but as a
            // precaution, not as a finding.
            pjlinkClassSource: null,
            freeze: false,
            // How many rounds have gone wrong in a row. The waiting screen
            // reads it: after the first attempt has really failed it can say
            // something more honest than "one moment". A number, not a clock —
            // it changes when something actually went wrong, not after a
            // guessed few seconds.
            failedAttempts: 0,
            pending: null,
            commandError: null
        };

        let listeners = [];
        let timer = null;
        let running = false;
        let consecutiveFailures = 0;
        let offlineAttempts = 0;
        let fastUntil = 0;
        let inTick = false;
        // The round currently under way. There is at most one — see runNow().
        let inFlight = null;

        function notify() {
            const copy = JSON.parse(JSON.stringify(state));
            listeners.forEach(function (fn) { fn(copy); });
        }

        function update(patch) {
            const before = JSON.stringify(state);
            state = Object.assign({}, state, patch);
            if (JSON.stringify(state) !== before) notify();
        }

        // Is the running command fulfilled by the reported state?
        function isCommandFulfilled(next) {
            const p = state.pending;
            if (!p) return false;
            if (p.kind === 'power-on') return next.power === 'on';
            if (p.kind === 'power-off') return next.power === 'off';
            if (p.kind === 'source') return next.sourceCode === p.target;
            if (p.kind === 'freeze') return next.freeze === p.target;
            if (p.kind === 'mute') {
                const target = p.target;
                if (next.mute.video === target.video && next.mute.audio === target.audio) return true;
                // Many projectors can only mute picture and sound together.
                // Then what counts is that the picture is right — otherwise the
                // command would run forever.
                return next.mute.video === next.mute.audio && next.mute.video === target.video;
            }
            return false;
        }

        async function poll() {
            const power = await api.getPowerState();
            const next = {
                link: 'online',
                power: POWER_NAMES[power.state] || 'unknown',
                sourceCode: state.sourceCode,
                sourceName: state.sourceName,
                mute: state.mute,
                freeze: state.freeze
            };

            // Only ask for the source and the mute state while the projector is
            // running — switched off, many devices do not answer those at all.
            if (next.power === 'on') {
                try {
                    const input = await api.getCurrentInput();
                    if (input && input.code) {
                        next.sourceCode = input.code;
                        next.sourceName = input.name || null;
                    }
                } catch (e) { /* no harm done, the rest counts */ }

                try {
                    const m = await api.getMuteState();
                    if (m) next.mute = { video: m.video === true, audio: m.audio === true };
                } catch (e) { /* see above */ }

                // Only ask when freeze is enabled as well: a projector without
                // Class 2 answers every such query with ERR1.
                if (isFeatureEnabled('freeze')) {
                    try {
                        next.freeze = (await api.getFreeze()) === true;
                    } catch (e) { /* see above */ }
                }
            }

            return next;
        }

        async function tick() {
            if (!running) return;
            inTick = true;

            try {
                // The state machine builds the connection itself. As long as it
                // is not up, a fresh attempt is made before every poll.
                let projectorClass = state.pjlinkClass;
                let classSource = state.pjlinkClassSource;
                if (state.link !== 'online') {
                    const result = await api.connect();
                    // When connecting, the projector says which PJLink level it
                    // supports. What the technical page offers for enabling
                    // depends on that.
                    if (result && typeof result.pjlinkClass === 'number') {
                        projectorClass = result.pjlinkClass;
                        classSource = result.pjlinkClassSource || null;
                    }
                }
                const next = await poll();
                consecutiveFailures = 0;
                offlineAttempts = 0;

                const patch = {
                    link: 'online',
                    power: next.power,
                    sourceCode: next.sourceCode,
                    sourceName: next.sourceName,
                    mute: next.mute,
                    freeze: next.freeze,
                    pjlinkClass: projectorClass,
                    pjlinkClassSource: classSource,
                    failedAttempts: 0
                };

                if (state.pending) {
                    if (isCommandFulfilled(next)) {
                        patch.pending = null;
                        patch.commandError = null;
                    } else if (now() - state.pending.startedAt >= COMMAND_TIMEOUT_MS) {
                        patch.pending = null;
                        patch.commandError = 'command-not-confirmed';
                    }
                }

                update(patch);
            } catch (e) {
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_FAILURES && state.link !== 'offline') {
                    update({ link: 'offline', pending: null, failedAttempts: consecutiveFailures });
                } else {
                    update({ failedAttempts: consecutiveFailures });
                }
                // The next round builds the connection up again by itself.
            }

            inTick = false;
            scheduleNext();
        }

        // The one door into a round. Whoever wants one — the beat, a command,
        // the "try again" button — comes through here, and gets the round that
        // is already under way rather than a second one of their own.
        //
        // This matters because every round schedules the next one at its end:
        // a round started on the side does not merely run twice, it leaves
        // behind a poll loop of its own that keeps running for ever. Two
        // impatient presses on "try again" and the app was talking to the
        // projector three times over — with three connections competing for
        // the one that the main process keeps.
        function runNow() {
            if (inFlight) return inFlight;
            if (timer !== null) {
                cancel(timer);
                timer = null;
            }
            inFlight = Promise.resolve(tick()).then(function () {
                inFlight = null;
            }, function () {
                inFlight = null;
            });
            return inFlight;
        }

        function scheduleNext() {
            if (!running) return;
            let delay = POLL_MS;
            if (state.link === 'offline') {
                const i = Math.min(offlineAttempts, BACKOFF_MS.length - 1);
                delay = BACKOFF_MS[i];
                offlineAttempts++;
            } else if (now() < fastUntil) {
                // Shortly after a command, ask more often so the display keeps
                // up instead of lagging behind by as much as five seconds.
                delay = FAST_POLL_MS;
            }
            timer = schedule(runNow, delay);
        }

        async function send(kind, target, fn) {
            fastUntil = now() + FAST_WINDOW_MS;
            // Reschedule right away, otherwise the fast polling only kicks in
            // after the five-second beat already under way. If a round is
            // running, its own scheduleNext() takes over the new beat.
            if (running && !inTick) {
                if (timer !== null) cancel(timer);
                timer = schedule(runNow, FAST_POLL_MS);
            }
            update({
                pending: { kind: kind, target: target === undefined ? null : target, startedAt: now() },
                commandError: null
            });
            try {
                await fn();
            } catch (e) {
                // Important: the command failed, the connection did not. The
                // controls have to stay usable — so only set a message that can
                // be clicked away.
                update({ pending: null, commandError: e.message || 'command-failed' });
                throw e;
            }
        }

        // SVOL and MVOL have no query counterpart in PJLink: there is no current
        // level and therefore nothing to wait for. Commands like these bypass
        // the confirmation route — going through it would freeze the whole
        // interface for thirty seconds after every tap on "louder".
        async function withoutConfirmation(fn) {
            update({ commandError: null });
            try {
                await fn();
            } catch (e) {
                update({ commandError: e.message || 'command-failed' });
                throw e;
            }
        }

        return {
            start: function () {
                if (running) return;
                running = true;
                consecutiveFailures = 0;
                offlineAttempts = 0;
                timer = schedule(runNow, 0);
            },

            stop: function () {
                running = false;
                if (timer !== null) cancel(timer);
                timer = null;
            },

            getState: function () {
                return JSON.parse(JSON.stringify(state));
            },

            onChange: function (fn) {
                listeners.push(fn);
                return function () { listeners = listeners.filter(function (h) { return h !== fn; }); };
            },

            refreshNow: function () {
                return runNow();
            },

            dismissError: function () {
                update({ commandError: null });
            },

            powerOn: function () {
                return send('power-on', null, function () { return api.powerOn(); });
            },

            powerOff: function () {
                return send('power-off', null, function () { return api.powerOff(); });
            },

            selectSource: function (code) {
                return send('source', code, function () { return api.setInput(code); });
            },

            setMute: function (m) {
                const target = { video: m.video === true, audio: m.audio === true };
                return send('mute', target, function () { return api.setMute(target); });
            },

            // Freeze does have a query and therefore runs through the normal
            // confirmation route, like switching on or changing the source.
            setFreeze: function (on) {
                const target = on === true;
                return send('freeze', target, function () { return api.setFreeze(target); });
            },

            speakerVolumeUp: function () {
                return withoutConfirmation(function () { return api.speakerVolumeUp(); });
            },

            speakerVolumeDown: function () {
                return withoutConfirmation(function () { return api.speakerVolumeDown(); });
            },

            microphoneVolumeUp: function () {
                return withoutConfirmation(function () { return api.microphoneVolumeUp(); });
            },

            microphoneVolumeDown: function () {
                return withoutConfirmation(function () { return api.microphoneVolumeDown(); });
            }
        };
    }

    return { createProjector, POLL_MS, COMMAND_TIMEOUT_MS, BACKOFF_MS, MAX_FAILURES };
});
