const test = require('node:test');
const assert = require('node:assert');
const { createProjector, POLL_MS, COMMAND_TIMEOUT_MS } = require('../renderer/js/projector.js');

// A very simple clock: tasks are worked off in order of when they fall due.
function fakeClock() {
    let time = 0;
    let nextId = 1;
    const tasks = new Map();

    return {
        now: () => time,
        schedule: (fn, ms) => {
            const id = nextId++;
            tasks.set(id, { fn, due: time + ms });
            return id;
        },
        cancel: (id) => { tasks.delete(id); },
        // Runs on to `ms` and carries out everything that falls due.
        async advance(ms) {
            const target = time + ms;
            let guard = 0;
            for (;;) {
                let next = null;
                for (const [id, task] of tasks) {
                    if (task.due <= target && (!next || task.due < next.task.due)) {
                        next = { id, task };
                    }
                }
                if (!next) break;
                if (++guard > 500) throw new Error('endless loop in the test clock');
                time = next.task.due;
                tasks.delete(next.id);
                await next.task.fn();
                await Promise.resolve();
            }
            time = target;
        }
    };
}

function fakeApi(initial) {
    return {
        state: Object.assign({ power: 0, input: { code: '31', name: 'DIGITAL - 1' }, mute: { video: false, audio: false }, freeze: false, pjlinkClass: 1 }, initial || {}),
        failing: false,
        calls: [],
        async connect() { this.calls.push('connect'); if (this.failing) throw new Error('offline'); return { success: true, pjlinkClass: this.state.pjlinkClass }; },
        polls: 0,
        async getPowerState() {
            this.polls++;
            if (this.failing) throw new Error('Connection timeout');
            const texts = { 0: 'Off', 1: 'On', 2: 'Cooling down', 3: 'Warming up' };
            return { state: this.state.power, description: texts[this.state.power] };
        },
        async getCurrentInput() { if (this.failing) throw new Error('Connection timeout'); return this.state.input; },
        async getMuteState() { if (this.failing) throw new Error('Connection timeout'); return this.state.mute; },
        async powerOn() { this.calls.push('powerOn'); },
        async powerOff() { this.calls.push('powerOff'); },
        async setInput(code) { this.calls.push('setInput:' + code); },
        async setMute(m) { this.calls.push('setMute:' + m.video + ',' + m.audio); },
        async getFreeze() { this.calls.push('getFreeze'); if (this.failing) throw new Error('Connection timeout'); return this.state.freeze; },
        async setFreeze(on) { this.calls.push('setFreeze:' + on); },
        async speakerVolumeUp() { this.calls.push('speakerVolumeUp'); },
        async speakerVolumeDown() { this.calls.push('speakerVolumeDown'); },
        async microphoneVolumeUp() { this.calls.push('microphoneVolumeUp'); },
        async microphoneVolumeDown() { this.calls.push('microphoneVolumeDown'); }
    };
}

// Leaving `features` out means: the state machine gets no information about
// enabled features at all — the way it was built before the Class 2 extension.
function build(initial, features) {
    const clock = fakeClock();
    const api = fakeApi(initial);
    const deps = { api, schedule: clock.schedule, cancel: clock.cancel, now: clock.now };
    if (features) {
        deps.isFeatureEnabled = function (key) { return features.indexOf(key) !== -1; };
    }
    const b = createProjector(deps);
    return { clock, api, b };
}

test('the first poll brings the state to online', async () => {
    const { clock, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
    assert.strictEqual(b.getState().sourceCode, '31');
});

test('the connection is built before the first poll', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(api.calls[0], 'connect', 'connecting has to come first');
});

test('while the connection stands, it is not built again', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    const afterStart = api.calls.filter(function (r) { return r === 'connect'; }).length;
    await clock.advance(POLL_MS * 3);
    const later = api.calls.filter(function (r) { return r === 'connect'; }).length;
    assert.strictEqual(later, afterStart, 'no further connecting during normal operation');
});

test('after losing the connection, every attempt connects again', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    api.failing = true;
    await clock.advance(POLL_MS * 3);
    assert.strictEqual(b.getState().link, 'offline');

    const before = api.calls.filter(function (r) { return r === 'connect'; }).length;
    await clock.advance(30000);
    const after = api.calls.filter(function (r) { return r === 'connect'; }).length;
    assert.ok(after > before, 'while offline, connecting has to keep going');
});

test('warming up leads to the state on', async () => {
    const { clock, api, b } = build({ power: 3 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().power, 'warming');

    api.state.power = 1;
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'on');
});

test('cooling down lasts until the projector reports off', async () => {
    const { clock, api, b } = build({ power: 2 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().power, 'cooling');

    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'cooling');

    api.state.power = 0;
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().power, 'off');
});

test('three failed polls trigger no contact', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().link, 'online');

    api.failing = true;
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'online', 'one failure is not enough');
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'online', 'two failures are not enough');
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().link, 'offline', 'on the third failure the connection counts as gone');
});

test('after losing the connection, a successful poll restores normal operation', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    api.failing = true;
    await clock.advance(POLL_MS * 3);
    assert.strictEqual(b.getState().link, 'offline');

    api.failing = false;
    await clock.advance(60000);
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
});

test('switching on waits for the projector to confirm', async () => {
    const { clock, api, b } = build({ power: 0 });
    b.start();
    await clock.advance(1);

    await b.powerOn();
    assert.strictEqual(api.calls[api.calls.length - 1], 'powerOn');
    assert.strictEqual(b.getState().pending.kind, 'power-on');

    api.state.power = 3;
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().pending.kind, 'power-on', 'not done yet while warming up');

    api.state.power = 1;
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().pending, null, 'with the state on, the command is done');
});

test('a command without confirmation times out after 30 seconds', async () => {
    const { clock, b } = build({ power: 0 });
    b.start();
    await clock.advance(1);

    await b.powerOn();
    await clock.advance(COMMAND_TIMEOUT_MS + POLL_MS * 2);
    assert.strictEqual(b.getState().commandError, 'command-not-confirmed', 'the screen needs something to say');
    assert.strictEqual(b.getState().pending, null);
});

test('a refused command does not block the controls for good', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    // The projector refuses to mute (does not know the command).
    api.setMute = async () => { throw new Error('Undefined command'); };
    await assert.rejects(() => b.setMute({ video: true, audio: false }));

    assert.ok(b.getState().commandError, 'the error has to become visible');
    assert.strictEqual(b.getState().pending, null);

    // The decisive part: the state machine has to carry on normally afterwards.
    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on', 'the projector keeps running and that must be visible');

    // And the notice can be clicked away without restarting the app.
    b.dismissError();
    assert.strictEqual(b.getState().commandError, null);
});

test('a successful command clears an old error message away', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    const realSetMute = api.setMute.bind(api);
    api.setMute = async () => { throw new Error('Undefined command'); };
    await assert.rejects(() => b.setMute({ video: true, audio: false }));
    assert.ok(b.getState().commandError);

    api.setMute = realSetMute;
    await b.setMute({ video: true, audio: false });
    assert.strictEqual(b.getState().commandError, null, 'the new attempt starts without the old message');
});

test('after a command, polling gets faster for a while', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    const quiet = api.polls;
    await clock.advance(POLL_MS);
    const atRestingBeat = api.polls - quiet;

    await b.selectSource('32');
    const before = api.polls;
    await clock.advance(POLL_MS);
    const afterCommand = api.polls - before;

    assert.ok(afterCommand > atRestingBeat, 'in the same span it has to poll more often (' + afterCommand + ' instead of ' + atRestingBeat + ')');
});

test('choosing a source reports the change after the confirmation', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    await b.selectSource('32');
    assert.ok(api.calls.indexOf('setInput:32') !== -1);
    api.state.input = { code: '32', name: 'DIGITAL - 2' };
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().sourceCode, '32');
    assert.strictEqual(b.getState().pending, null);
});

test('muting is taken over', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    await b.setMute({ video: true, audio: false });
    assert.ok(api.calls.indexOf('setMute:true,false') !== -1);
    api.state.mute = { video: true, audio: false };
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().mute.video, true);
});

test('if the projector couples picture and sound, the command still counts as done', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    // Wanted: hide the picture only. The projector cannot do that separately
    // and mutes both — which fulfils the wish in spirit.
    await b.setMute({ video: true, audio: false });
    api.state.mute = { video: true, audio: true };
    await clock.advance(POLL_MS);

    assert.strictEqual(b.getState().pending, null, 'no command running forever');
    assert.strictEqual(b.getState().commandError, null, 'and no error message');
});

test('if the picture is wrong, the command does not count as done', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    await b.setMute({ video: true, audio: false });
    api.state.mute = { video: false, audio: false };
    await clock.advance(POLL_MS);

    assert.ok(b.getState().pending, 'the command carries on');
});

// The other way round, and this is the one people notice in the room: someone
// mutes the sound, and on a projector that couples the two the picture goes
// with it. That is the device's doing and cannot be undone from here — but it
// must not additionally produce "the projector did not confirm the command".
test('if the projector couples picture and sound, muting the sound counts as done too', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    await b.setMute({ video: false, audio: true });
    api.state.mute = { video: true, audio: true };
    await clock.advance(POLL_MS);

    assert.strictEqual(b.getState().pending, null, 'no command running forever');
    assert.strictEqual(b.getState().commandError, null, 'and no error message');
});

// Whether the projector couples them is not something it says — it is
// something it does. A wish for one of the two that comes back as both is the
// only evidence there is, and the operating screen needs it: only then can it
// stop offering two switches that are really one.
test('the coupling is noticed once the projector has shown it', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().muteCoupled, false, 'nothing is assumed beforehand');

    await b.setMute({ video: false, audio: true });
    api.state.mute = { video: true, audio: true };
    await clock.advance(POLL_MS);

    assert.strictEqual(b.getState().muteCoupled, true);
});

test('a projector that keeps picture and sound apart is not taken for a coupled one', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    await b.setMute({ video: false, audio: true });
    api.state.mute = { video: false, audio: true };
    await clock.advance(POLL_MS);

    assert.strictEqual(b.getState().muteCoupled, false);
    assert.strictEqual(b.getState().pending, null);
});

// The mirror image of "if the picture is wrong": the sound was the half the
// user moved, so it is the half that has to be right. A projector that reports
// both switched off has not carried out the command, coupled or not.
test('if the sound is wrong, the command does not count as done', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);

    await b.setMute({ video: false, audio: true });
    api.state.mute = { video: false, audio: false };
    await clock.advance(POLL_MS);

    assert.ok(b.getState().pending, 'the command carries on');
});

test('onChange reports every state change', async () => {
    const { clock, api, b } = build({ power: 0 });
    let count = 0;
    b.onChange(() => { count++; });
    b.start();
    await clock.advance(1);
    const afterStart = count;
    assert.ok(afterStart > 0, 'the first poll has to report');

    api.state.power = 3;
    await clock.advance(POLL_MS);
    assert.ok(count > afterStart, 'a change has to report');
});

test('stop ends the polling loop', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    b.stop();
    const before = api.calls.length;
    await clock.advance(POLL_MS * 5);
    assert.strictEqual(api.calls.length, before);
});

// ---------- PJLink Class 2 ----------

test('the PJLink class reported by the projector is in the state', async () => {
    const { clock, b } = build({ power: 1, pjlinkClass: 2 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().pjlinkClass, 2);
});

test('if the projector reports only Class 1, that is in the state too', async () => {
    const { clock, b } = build({ power: 1, pjlinkClass: 1 });
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().pjlinkClass, 1);
});

// If freeze is not enabled, it must not be queried either: a Class 1 projector
// answered every such query with ERR1.
test('without being enabled, freeze is not queried', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 }, []);
    b.start();
    await clock.advance(POLL_MS * 2);
    assert.strictEqual(api.calls.indexOf('getFreeze'), -1);
});

test('once enabled, freeze is queried', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2, freeze: true }, ['freeze']);
    b.start();
    await clock.advance(1);
    assert.ok(api.calls.indexOf('getFreeze') !== -1);
    assert.strictEqual(b.getState().freeze, true);
});

test('with the projector switched off, freeze is not queried', async () => {
    const { clock, api, b } = build({ power: 0, pjlinkClass: 2 }, ['freeze']);
    b.start();
    await clock.advance(POLL_MS * 2);
    assert.strictEqual(api.calls.indexOf('getFreeze'), -1);
});

test('freeze waits for the projector to confirm', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 }, ['freeze']);
    b.start();
    await clock.advance(1);

    await b.setFreeze(true);
    assert.ok(api.calls.indexOf('setFreeze:true') !== -1);
    assert.strictEqual(b.getState().pending.kind, 'freeze');

    api.state.freeze = true;
    await clock.advance(POLL_MS);
    assert.strictEqual(b.getState().pending, null, 'with freeze reported, the command is done');
    assert.strictEqual(b.getState().freeze, true);
});

// The actual reason for this special treatment: SVOL and MVOL have no query
// counterpart in PJLink. If volume went through the normal confirmation route,
// it would hang for 30 seconds and lock the entire interface in the meantime —
// on every single tap on "louder".
test('volume does not lock the controls', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 }, ['volume']);
    b.start();
    await clock.advance(1);

    await b.speakerVolumeUp();
    assert.ok(api.calls.indexOf('speakerVolumeUp') !== -1);
    assert.strictEqual(b.getState().pending, null, 'no waiting command');
});

test('volume does not run into the thirty-second timeout', async () => {
    const { clock, b } = build({ power: 1, pjlinkClass: 2 }, ['volume']);
    b.start();
    await clock.advance(1);

    await b.speakerVolumeUp();
    await clock.advance(COMMAND_TIMEOUT_MS + POLL_MS * 2);

    assert.strictEqual(b.getState().commandError, null, 'there must be no message about an unconfirmed command');
    assert.strictEqual(b.getState().pending, null);
});

test('several volume steps in a row are possible', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 }, ['volume']);
    b.start();
    await clock.advance(1);

    await b.speakerVolumeUp();
    await b.speakerVolumeUp();
    await b.speakerVolumeDown();
    await b.microphoneVolumeUp();
    await b.microphoneVolumeDown();

    const volume = api.calls.filter(function (r) { return r.indexOf('VolumeUp') !== -1 || r.indexOf('VolumeDown') !== -1; });
    assert.deepStrictEqual(volume, [
        'speakerVolumeUp', 'speakerVolumeUp', 'speakerVolumeDown',
        'microphoneVolumeUp', 'microphoneVolumeDown'
    ]);
});

// If the projector does not know SVOL, that has to become visible — but
// without stopping the controls.
test('a refused volume command is reported without locking anything', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 }, ['volume']);
    b.start();
    await clock.advance(1);

    api.speakerVolumeUp = async () => { throw new Error('Undefined command'); };
    await assert.rejects(() => b.speakerVolumeUp());

    assert.ok(b.getState().commandError, 'the error has to become visible');
    assert.strictEqual(b.getState().pending, null);
    assert.strictEqual(b.getState().link, 'online', 'the connection stays up');
});

// A Class 1 projector where something was enabled by accident must not lead to
// the network state or the picture source failing to arrive.
test('if the freeze query fails, the rest carries on', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 }, ['freeze']);
    api.getFreeze = async () => { throw new Error('Undefined command'); };
    b.start();
    await clock.advance(1);

    assert.strictEqual(b.getState().link, 'online');
    assert.strictEqual(b.getState().power, 'on');
    assert.strictEqual(b.getState().sourceCode, '31');
});

// ---------- Where the PJLink class comes from ----------

// Decisive for the technical page: "the projector says Class 1" and "the query
// went unanswered" look the same in the result (both lead to Class 1) but mean
// different things. Without that distinction a failed query reads like a
// finding about the device.
test('an answered class query is marked as reported', async () => {
    const { clock, api, b } = build({ power: 1, pjlinkClass: 2 });
    api.connect = async function () { return { success: true, pjlinkClass: 2, pjlinkClassSource: 'reported' }; };
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().pjlinkClass, 2);
    assert.strictEqual(b.getState().pjlinkClassSource, 'reported');
});

test('an unanswered class query is marked as such', async () => {
    const { clock, api, b } = build({ power: 1 });
    api.connect = async function () { return { success: true, pjlinkClass: 1, pjlinkClassSource: 'unanswered' }; };
    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().pjlinkClass, 1, 'Class 1 applies as a precaution');
    assert.strictEqual(b.getState().pjlinkClassSource, 'unanswered', 'but that is no statement about the device');
});

test('before the first connection the source is unknown', () => {
    const { b } = build({ power: 1 });
    assert.strictEqual(b.getState().pjlinkClass, null);
    assert.strictEqual(b.getState().pjlinkClassSource, null);
});

// The offline screen offers "try again now", and that button stays clickable
// while the app is still waiting for the projector. Every press used to start
// its own round — and because every round schedules the next one at the end,
// each press left behind a poll loop of its own that ran for ever. Two presses
// and the app was talking to the projector three times over.
test('pressing retry while a round is running does not start a second loop', async () => {
    const { clock, api, b } = build({ power: 1 });

    // A connection attempt we hold open on purpose: that is the several
    // seconds the app waits for a projector that is not answering.
    let release;
    const hanging = new Promise(function (r) { release = r; });
    api.connect = async function () { await hanging; return { success: true, pjlinkClass: 1 }; };

    b.start();
    const firstRound = clock.advance(1); // the round starts and hangs on connecting
    await new Promise(function (r) { setImmediate(r); });

    b.refreshNow();
    b.refreshNow();

    release();
    await firstRound;
    await new Promise(function (r) { setImmediate(r); });

    api.polls = 0;
    await clock.advance(POLL_MS * 4);

    assert.ok(api.polls <= 4, 'one loop asks at most once per beat, got ' + api.polls + ' asks in 4 beats');
});

// The waiting screen wants to say something more honest once an attempt has
// actually gone wrong — not after a guessed number of seconds. So the count of
// failed rounds has to be part of the published state.
test('the state reports how many attempts have failed', async () => {
    const { clock, api, b } = build({ power: 1 });
    api.failing = true;

    b.start();
    await clock.advance(1);
    assert.strictEqual(b.getState().failedAttempts, 1, 'one round has gone wrong');
    assert.strictEqual(b.getState().link, 'connecting', 'it is still trying');

    await clock.advance(POLL_MS + 1);
    assert.strictEqual(b.getState().failedAttempts, 2);

    // Once the projector answers again, the count starts over — otherwise the
    // next short hiccup would show the pessimistic text straight away.
    api.failing = false;
    await clock.advance(POLL_MS * 4);
    assert.strictEqual(b.getState().failedAttempts, 0);
    assert.strictEqual(b.getState().link, 'online');
});

// ---------------------------------------------------------------------------
// Device profiles
// ---------------------------------------------------------------------------

const COMBINED_DEVICE = {
    manufacturer: 'Optoma', model: 'Optoma 1080p', profile: 'Optoma 1080p', learned: false,
    mute: { picture: 'combined', combinedAcknowledged: false, audioWhileCombined: false, toggles: true }
};

test('the device from the connection ends up in the state', async () => {
    const { clock, api, b } = build({ power: 1 });
    api.connect = async function () { return { success: true, pjlinkClass: 1, device: COMBINED_DEVICE }; };
    b.start();
    await clock.advance(1);
    assert.deepStrictEqual(b.getState().device, COMBINED_DEVICE);
});

test('what a mute command teaches about the device is taken over', async () => {
    const { clock, api, b } = build({ power: 1 });
    b.start();
    await clock.advance(1);
    api.setMute = async function () { return { success: true, mode: 'combined', device: COMBINED_DEVICE }; };
    await b.setMute({ video: true, audio: true });
    assert.deepStrictEqual(b.getState().device, COMBINED_DEVICE);
});

// The Optoma brings the sound back the way it was: showing the picture again
// after "picture & sound off" leaves a muted sound muted.
test('on a combined device the picture switch is confirmed by the picture alone', async () => {
    const { clock, api, b } = build({ power: 1, mute: { video: true, audio: true } });
    api.connect = async function () { return { success: true, pjlinkClass: 1, device: COMBINED_DEVICE }; };
    b.start();
    await clock.advance(1);

    await b.setMute({ video: false, audio: false });
    api.state.mute = { video: false, audio: true };
    await clock.advance(POLL_MS);

    assert.strictEqual(b.getState().pending, null);
    assert.strictEqual(b.getState().commandError, null);
});
