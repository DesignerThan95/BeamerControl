// Operating screen. In every projector state, shows only what makes sense now.
//
// The CSS class names stay German: they belong to app.css, which is not part
// of this translation pass.
window.App = window.App || {};
window.App.viewOperate = (function () {
    const ui = window.App.ui;
    const el = ui.el;
    const t = window.App.i18n.t;

    // The raw PJLink names (RGB, DIGITAL, …) mean nothing to anyone.
    // The first digit of the code is the kind of connector.
    const CONNECTOR_TYPES = { '1': 'vga', '2': 'video', '3': 'hdmi', '4': 'usb', '5': 'network' };

    function connectorName(code) {
        const type = CONNECTOR_TYPES[code.charAt(0)] || 'other';
        return t('operate.connectorName', { type: t('operate.connector.' + type), channel: code.charAt(1) });
    }

    let ctx = null;
    let root = null;

    function visibleSources() {
        return ctx.store.get().sources.filter(function (s) { return s.visible; });
    }

    // While a command is running, nothing else is clickable — otherwise someone
    // clicks three times in a row because the projector answers sluggishly.
    function isBusy(state) {
        return state.pending !== null;
    }

    async function run(fn, logMessage) {
        try {
            await fn();
            if (logMessage) ctx.log.add(logMessage, 'ok');
        } catch (e) {
            ctx.log.add('Command failed: ' + e.message, 'error');
        }
    }

    function spinner() {
        return el('span', { class: 'spinner-klein' });
    }

    // The PJLink library hands us raw English wording. None of it belongs on
    // this screen — the raw text stays in the activity log. The keys of this
    // table are the library's wording and must not change; only what they turn
    // into is translated.
    const ERROR_TEXT_KEYS = {
        'Undefined command': 'operate.errors.undefinedCommand',
        'Out of parameter': 'operate.errors.outOfParameter',
        'Unavailable time': 'operate.errors.unavailableTime',
        'Projector/Display failure': 'operate.errors.projectorFailure',
        'Authorization failed': 'operate.errors.authorizationFailed',
        'Command reply mismatch': 'operate.errors.replyMismatch',
        'Not connected': 'operate.errors.notConnected',
        'Connection timeout': 'operate.errors.connectionTimeout',
        // The state machine sets no finished sentences, only these codes —
        // that is the only way its message can be translated here.
        'command-not-confirmed': 'operate.errors.notConfirmed',
        'command-failed': 'operate.errors.commandFailed'
    };

    function errorText(raw) {
        const key = ERROR_TEXT_KEYS[raw];
        if (key) return t(key);
        return raw || t('operate.errors.generic');
    }

    // ---------- Building blocks ----------

    function errorBanner(state) {
        return el('div', { class: 'streifen fehler' }, [
            el('div', {}, [
                el('div', { class: 'streifen-titel', text: t('operate.commandFailedTitle') }),
                el('div', { class: 'streifen-text', text: errorText(state.commandError) })
            ]),
            el('button', {
                class: 'streifen-knopf',
                onclick: function () { ctx.projector.dismissError(); }
            }, [t('operate.gotIt')])
        ]);
    }

    function statusRow(state) {
        const locked = isBusy(state);
        const mutePending = state.pending && state.pending.kind === 'mute';

        function chip(label, icon, active, target) {
            const showsSpinner = mutePending
                && state.pending.target.video === target.video
                && state.pending.target.audio === target.audio;

            return el('button', {
                class: 'chip' + (active ? ' aktiv' : ''),
                disabled: locked,
                onclick: function () {
                    run(function () { return ctx.projector.setMute(target); },
                        active ? label + ' lifted' : label + ' switched on');
                }
            }, [showsSpinner ? spinner() : icon + ' ', label]);
        }

        const chips = [
            chip(t('operate.hideVideo'), '🚫', state.mute.video, { video: !state.mute.video, audio: state.mute.audio }),
            chip(t('operate.muteAudio'), '🔇', state.mute.audio, { video: state.mute.video, audio: !state.mute.audio })
        ];

        // Freeze — unlike volume — does have a query and therefore runs through
        // the same confirmation route as muting.
        if (ctx.store.isClass2FeatureEnabled('freeze')) {
            const pending = state.pending && state.pending.kind === 'freeze';
            chips.push(el('button', {
                class: 'chip' + (state.freeze ? ' aktiv' : ''),
                disabled: locked,
                onclick: function () {
                    run(function () { return ctx.projector.setFreeze(!state.freeze); },
                        state.freeze ? 'Freeze lifted' : 'Freeze switched on');
                }
            }, [pending ? spinner() : '❄ ', t('operate.freeze')]));
        }

        return el('div', { class: 'statuszeile' }, [
            el('div', { class: 'status' }, [
                el('span', { class: 'punkt an' }),
                t('operate.running')
            ]),
            el('div', { class: 'chips' }, chips)
        ]);
    }

    // For volume, PJLink hands out no current level and knows no query for it
    // either — there are only steps up and down. So no slider, no number and no
    // confirmation display: the press goes out, done.
    // For the same reason nothing locks itself here; pressing several times in
    // quick succession is the normal case.
    function volumeSection(state) {
        if (!ctx.store.isClass2FeatureEnabled('volume')) return null;

        const locked = isBusy(state);

        function pair(label, down, up) {
            return el('div', { class: 'lautstaerke-paar' }, [
                el('div', { class: 'feld-lab', text: label }),
                el('div', { class: 'lautstaerke-knoepfe' }, [
                    el('button', {
                        class: 'knopf lautstaerke',
                        disabled: locked,
                        title: t('operate.volumeDownTitle', { label: label }),
                        onclick: function () { run(down); }
                    }, [t('operate.volumeDown')]),
                    el('button', {
                        class: 'knopf lautstaerke',
                        disabled: locked,
                        title: t('operate.volumeUpTitle', { label: label }),
                        onclick: function () { run(up); }
                    }, [t('operate.volumeUp')])
                ])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'feldname', text: t('operate.volumeHeading') }),
            el('div', { class: 'lautstaerke' }, [
                pair(t('operate.audio'),
                    function () { return ctx.projector.speakerVolumeDown(); },
                    function () { return ctx.projector.speakerVolumeUp(); }),
                pair(t('operate.microphone'),
                    function () { return ctx.projector.microphoneVolumeDown(); },
                    function () { return ctx.projector.microphoneVolumeUp(); })
            ]),
            el('p', { class: 'hinweis', text: t('operate.volumeHint') })
        ]);
    }

    function sourceSection(state) {
        const sources = visibleSources();
        const locked = isBusy(state);
        const switchingTo = state.pending && state.pending.kind === 'source' ? state.pending.target : null;

        if (sources.length === 0) {
            return el('div', {}, [
                el('div', { class: 'feldname', text: t('operate.sourceHeading') }),
                el('p', { class: 'mitte-text', text: t('operate.noSources') })
            ]);
        }

        const tiles = sources.map(function (q) {
            const active = state.sourceCode === q.code;
            const switching = switchingTo === q.code;

            return el('button', {
                class: 'kachel' + (active ? ' aktiv' : '') + (switching ? ' wechselt' : ''),
                disabled: locked,
                onclick: function () {
                    if (active) return;
                    run(function () { return ctx.projector.selectSource(q.code); }, 'Picture source changed to ' + q.label);
                }
            }, [
                q.label,
                switching
                    ? el('span', { class: 'unter' }, [spinner(), t('operate.switching')])
                    : el('span', { class: 'unter', text: connectorName(q.code) })
            ]);
        });

        // If the projector reports a source that is not set up here (someone
        // picked it with the remote), it is shown anyway — otherwise it would
        // look as if nothing were running. That tile is display only, not a button.
        const known = sources.some(function (q) { return q.code === state.sourceCode; });
        if (state.sourceCode && !known) {
            tiles.push(el('div', { class: 'kachel aktiv' }, [
                state.sourceName || connectorName(state.sourceCode),
                el('span', { class: 'unter', text: t('operate.notConfigured') })
            ]));
        }

        return el('div', {}, [
            el('div', { class: 'feldname', text: t('operate.sourceHeading') }),
            el('div', { class: 'kacheln' }, tiles)
        ]);
    }

    function powerOffButton(state) {
        return el('button', {
            class: 'knopf aus',
            disabled: isBusy(state),
            onclick: async function () {
                const confirmed = await ui.confirmDialog({
                    title: t('operate.powerOffConfirmTitle'),
                    text: t('operate.powerOffConfirmText'),
                    confirm: t('operate.powerOffConfirmYes'),
                    cancel: t('common.cancel')
                });
                if (confirmed) run(function () { return ctx.projector.powerOff(); }, 'Switch-off requested');
            }
        }, [t('operate.powerOff')]);
    }

    function centered(title, text, button) {
        return el('div', { class: 'mitte' }, [
            el('div', { class: 'mitte-titel', text: title }),
            text ? el('div', { class: 'mitte-text', text: text }) : null,
            button || null
        ]);
    }

    function waiting(title, text) {
        return el('div', { class: 'mitte' }, [
            el('div', { class: 'pulsen' }),
            el('div', { class: 'mitte-titel', text: title }),
            text ? el('div', { class: 'mitte-text', text: text }) : null
        ]);
    }

    // ---------- The individual states ----------

    function contentFor(state) {
        if (state.link === 'connecting') {
            return waiting(t('operate.connectingTitle'), t('operate.connectingText'));
        }

        if (state.link === 'offline') {
            return centered(
                t('operate.offlineTitle'),
                t('operate.offlineText'),
                el('button', {
                    class: 'knopf',
                    onclick: function () { ctx.projector.refreshNow(); }
                }, [t('operate.retry')])
            );
        }

        // A running switch-on or switch-off command takes over the screen until
        // the projector reports the new state. Otherwise the switch-on button
        // would still be sitting there while the projector is already starting up.
        if (state.pending && state.pending.kind === 'power-on') {
            return waiting(t('operate.poweringOnTitle'), t('operate.poweringOnText'));
        }

        if (state.pending && state.pending.kind === 'power-off') {
            return waiting(t('operate.poweringOffTitle'), t('operate.poweringOffText'));
        }

        if (state.power === 'warming') {
            return waiting(t('operate.warmingTitle'), t('operate.warmingText'));
        }

        if (state.power === 'cooling') {
            return waiting(t('operate.coolingTitle'), t('operate.coolingText'));
        }

        if (state.power === 'off' || state.power === 'unknown') {
            return centered(
                t('operate.offTitle'),
                null,
                el('button', {
                    class: 'knopf haupt gross',
                    onclick: function () { run(function () { return ctx.projector.powerOn(); }, 'Switch-on requested'); }
                }, [t('operate.powerOn')])
            );
        }

        // From here on: the projector is running.
        const parts = [];

        if (state.mute.video) {
            parts.push(el('div', { class: 'streifen' }, [
                el('div', {}, [
                    el('div', { class: 'streifen-titel', text: t('operate.videoMutedTitle') }),
                    el('div', { class: 'streifen-text', text: t('operate.videoMutedText') })
                ]),
                el('button', {
                    class: 'streifen-knopf',
                    disabled: isBusy(state),
                    onclick: function () {
                        run(function () {
                            return ctx.projector.setMute({ video: false, audio: state.mute.audio });
                        }, 'Picture shown again');
                    }
                }, [t('operate.showVideo')])
            ]));
        }

        parts.push(statusRow(state), sourceSection(state));

        const volume = volumeSection(state);
        if (volume) parts.push(volume);

        parts.push(powerOffButton(state));

        return el('div', {}, parts);
    }

    function render() {
        if (!root) root = document.getElementById('ansicht-operate');
        const state = ctx.projector.getState();
        ui.clear(root);

        // A failed command appears as a banner above the normal controls — they
        // stay usable. A screen you can only get out of by restarting must not
        // exist here.
        const parts = [];
        if (state.commandError) parts.push(errorBanner(state));
        parts.push(contentFor(state));

        root.appendChild(el('div', { class: 'ansicht-innen' }, parts));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        connectorName: connectorName
    };
})();
