// Bedien-Bildschirm. Zeigt in jedem Beamerzustand nur das, was gerade sinnvoll ist.
window.App = window.App || {};
window.App.viewOperate = (function () {
    const ui = window.App.ui;
    const el = ui.el;
    const t = window.App.i18n.t;

    // Die PJLink-Rohnamen (RGB, DIGITAL, …) sagen niemandem etwas.
    // Erste Ziffer der Kennung ist die Art des Anschlusses.
    const ANSCHLUSS_ART = { '1': 'vga', '2': 'video', '3': 'hdmi', '4': 'usb', '5': 'network' };

    function anschlussName(code) {
        const art = ANSCHLUSS_ART[code.charAt(0)] || 'other';
        return t('operate.connectorName', { type: t('operate.connector.' + art), channel: code.charAt(1) });
    }

    let ctx = null;
    let wurzel = null;

    function sichtbareQuellen() {
        return ctx.store.get().sources.filter(function (s) { return s.visible; });
    }

    // Solange ein Befehl läuft, ist nichts anderes anklickbar — sonst klickt
    // jemand dreimal hintereinander, weil der Beamer träge antwortet.
    function laeuftBefehl(zustand) {
        return zustand.pending !== null;
    }

    async function befehl(fn, meldung) {
        try {
            await fn();
            if (meldung) ctx.log.add(meldung, 'ok');
        } catch (e) {
            ctx.log.add('Befehl fehlgeschlagen: ' + e.message, 'fehler');
        }
    }

    function spinner() {
        return el('span', { class: 'spinner-klein' });
    }

    // Die PJLink-Bibliothek liefert englische Rohtexte. Auf diesem Bildschirm
    // darf nichts davon stehen — der Rohtext bleibt im Protokoll. Die Schlüssel
    // dieser Tabelle sind der Wortlaut der Bibliothek und dürfen sich nicht
    // ändern; übersetzt wird nur, was daraus wird.
    const FEHLERTEXTE = {
        'Undefined command': 'operate.errors.undefinedCommand',
        'Out of parameter': 'operate.errors.outOfParameter',
        'Unavailable time': 'operate.errors.unavailableTime',
        'Projector/Display failure': 'operate.errors.projectorFailure',
        'Authorization failed': 'operate.errors.authorizationFailed',
        'Command reply mismatch': 'operate.errors.replyMismatch',
        'Not connected': 'operate.errors.notConnected',
        'Connection timeout': 'operate.errors.connectionTimeout',
        'Nicht verbunden': 'operate.errors.notConnected',
        // Die Zustandsmaschine setzt keine fertigen Sätze, sondern diese
        // Kennungen — nur so lässt sich ihre Meldung hier übersetzen.
        'command-not-confirmed': 'operate.errors.notConfirmed',
        'command-failed': 'operate.errors.commandFailed'
    };

    function fehlerKlartext(roh) {
        const schluessel = FEHLERTEXTE[roh];
        if (schluessel) return t(schluessel);
        return roh || t('operate.errors.generic');
    }

    // ---------- Bausteine ----------

    function fehlerstreifen(zustand) {
        return el('div', { class: 'streifen fehler' }, [
            el('div', {}, [
                el('div', { class: 'streifen-titel', text: t('operate.commandFailedTitle') }),
                el('div', { class: 'streifen-text', text: fehlerKlartext(zustand.commandError) })
            ]),
            el('button', {
                class: 'streifen-knopf',
                onclick: function () { ctx.beamer.dismissError(); }
            }, [t('operate.gotIt')])
        ]);
    }

    function statuszeile(zustand) {
        const gesperrt = laeuftBefehl(zustand);
        const muteLaeuft = zustand.pending && zustand.pending.kind === 'mute';

        function chip(beschriftung, symbol, aktiv, ziel) {
            const zeigtSpinner = muteLaeuft
                && zustand.pending.target.video === ziel.video
                && zustand.pending.target.audio === ziel.audio;

            return el('button', {
                class: 'chip' + (aktiv ? ' aktiv' : ''),
                disabled: gesperrt,
                onclick: function () {
                    befehl(function () { return ctx.beamer.setMute(ziel); },
                        aktiv ? beschriftung + ' aufgehoben' : beschriftung + ' aktiviert');
                }
            }, [zeigtSpinner ? spinner() : symbol + ' ', beschriftung]);
        }

        const chips = [
            chip(t('operate.hideVideo'), '🚫', zustand.mute.video, { video: !zustand.mute.video, audio: zustand.mute.audio }),
            chip(t('operate.muteAudio'), '🔇', zustand.mute.audio, { video: zustand.mute.video, audio: !zustand.mute.audio })
        ];

        // Das Standbild hat — anders als die Lautstärke — eine Abfrage und
        // läuft deshalb über denselben Bestätigungsweg wie die Stummschaltung.
        if (ctx.store.isClass2FeatureEnabled('freeze')) {
            const laeuft = zustand.pending && zustand.pending.kind === 'freeze';
            chips.push(el('button', {
                class: 'chip' + (zustand.freeze ? ' aktiv' : ''),
                disabled: gesperrt,
                onclick: function () {
                    befehl(function () { return ctx.beamer.setFreeze(!zustand.freeze); },
                        zustand.freeze ? 'Standbild aufgehoben' : 'Standbild aktiviert');
                }
            }, [laeuft ? spinner() : '❄ ', t('operate.freeze')]));
        }

        return el('div', { class: 'statuszeile' }, [
            el('div', { class: 'status' }, [
                el('span', { class: 'punkt an' }),
                t('operate.running')
            ]),
            el('div', { class: 'chips' }, chips)
        ]);
    }

    // PJLink gibt bei der Lautstärke keinen Ist-Wert her und kennt auch keine
    // Abfrage dafür — es gibt nur Schritte auf und ab. Deshalb kein Balken,
    // keine Zahl und keine Bestätigungsanzeige: der Druck geht raus, fertig.
    // Aus demselben Grund sperrt sich hier nichts selbst; mehrmals kurz
    // hintereinander zu drücken ist der übliche Fall.
    function lautstaerkeBereich(zustand) {
        if (!ctx.store.isClass2FeatureEnabled('volume')) return null;

        const gesperrt = laeuftBefehl(zustand);

        function paar(beschriftung, runter, hoch) {
            return el('div', { class: 'lautstaerke-paar' }, [
                el('div', { class: 'feld-lab', text: beschriftung }),
                el('div', { class: 'lautstaerke-knoepfe' }, [
                    el('button', {
                        class: 'knopf lautstaerke',
                        disabled: gesperrt,
                        title: t('operate.volumeDownTitle', { label: beschriftung }),
                        onclick: function () { befehl(runter); }
                    }, [t('operate.volumeDown')]),
                    el('button', {
                        class: 'knopf lautstaerke',
                        disabled: gesperrt,
                        title: t('operate.volumeUpTitle', { label: beschriftung }),
                        onclick: function () { befehl(hoch); }
                    }, [t('operate.volumeUp')])
                ])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'feldname', text: t('operate.volumeHeading') }),
            el('div', { class: 'lautstaerke' }, [
                paar(t('operate.audio'),
                    function () { return ctx.beamer.speakerVolumeDown(); },
                    function () { return ctx.beamer.speakerVolumeUp(); }),
                paar(t('operate.microphone'),
                    function () { return ctx.beamer.microphoneVolumeDown(); },
                    function () { return ctx.beamer.microphoneVolumeUp(); })
            ]),
            el('p', { class: 'hinweis', text: t('operate.volumeHint') })
        ]);
    }

    function quellenBereich(zustand) {
        const quellen = sichtbareQuellen();
        const gesperrt = laeuftBefehl(zustand);
        const wechselZu = zustand.pending && zustand.pending.kind === 'source' ? zustand.pending.target : null;

        if (quellen.length === 0) {
            return el('div', {}, [
                el('div', { class: 'feldname', text: t('operate.sourceHeading') }),
                el('p', { class: 'mitte-text', text: t('operate.noSources') })
            ]);
        }

        const kacheln = quellen.map(function (q) {
            const aktiv = zustand.sourceCode === q.code;
            const wechselt = wechselZu === q.code;

            return el('button', {
                class: 'kachel' + (aktiv ? ' aktiv' : '') + (wechselt ? ' wechselt' : ''),
                disabled: gesperrt,
                onclick: function () {
                    if (aktiv) return;
                    befehl(function () { return ctx.beamer.selectSource(q.code); }, 'Bildquelle gewechselt auf ' + q.label);
                }
            }, [
                q.label,
                wechselt
                    ? el('span', { class: 'unter' }, [spinner(), t('operate.switching')])
                    : el('span', { class: 'unter', text: anschlussName(q.code) })
            ]);
        });

        // Meldet der Beamer eine Quelle, die hier nicht eingerichtet ist (jemand hat
        // sie per Fernbedienung gewählt), wird sie trotzdem gezeigt — sonst sähe es
        // aus, als liefe gar nichts. Diese Kachel ist nur Anzeige, kein Knopf.
        const bekannt = quellen.some(function (q) { return q.code === zustand.sourceCode; });
        if (zustand.sourceCode && !bekannt) {
            kacheln.push(el('div', { class: 'kachel aktiv' }, [
                zustand.sourceName || anschlussName(zustand.sourceCode),
                el('span', { class: 'unter', text: t('operate.notConfigured') })
            ]));
        }

        return el('div', {}, [
            el('div', { class: 'feldname', text: t('operate.sourceHeading') }),
            el('div', { class: 'kacheln' }, kacheln)
        ]);
    }

    function ausschaltKnopf(zustand) {
        return el('button', {
            class: 'knopf aus',
            disabled: laeuftBefehl(zustand),
            onclick: async function () {
                const ja = await ui.confirmDialog({
                    titel: t('operate.powerOffConfirmTitle'),
                    text: t('operate.powerOffConfirmText'),
                    bestaetigen: t('operate.powerOffConfirmYes'),
                    abbrechen: t('common.cancel')
                });
                if (ja) befehl(function () { return ctx.beamer.powerOff(); }, 'Ausschalten angefordert');
            }
        }, [t('operate.powerOff')]);
    }

    function mitte(titel, text, knopf) {
        return el('div', { class: 'mitte' }, [
            el('div', { class: 'mitte-titel', text: titel }),
            text ? el('div', { class: 'mitte-text', text: text }) : null,
            knopf || null
        ]);
    }

    function warten(titel, text) {
        return el('div', { class: 'mitte' }, [
            el('div', { class: 'pulsen' }),
            el('div', { class: 'mitte-titel', text: titel }),
            text ? el('div', { class: 'mitte-text', text: text }) : null
        ]);
    }

    // ---------- Die einzelnen Zustände ----------

    function inhaltFuer(zustand) {
        if (zustand.link === 'connecting') {
            return warten(t('operate.connectingTitle'), t('operate.connectingText'));
        }

        if (zustand.link === 'offline') {
            return mitte(
                t('operate.offlineTitle'),
                t('operate.offlineText'),
                el('button', {
                    class: 'knopf',
                    onclick: function () { ctx.beamer.refreshNow(); }
                }, [t('operate.retry')])
            );
        }

        // Ein laufender Ein- oder Ausschaltbefehl übernimmt den Bildschirm, bis
        // der Beamer den neuen Zustand meldet. Sonst stünde weiter der
        // Einschalten-Knopf da, obwohl der Beamer längst hochfährt.
        if (zustand.pending && zustand.pending.kind === 'power-on') {
            return warten(t('operate.poweringOnTitle'), t('operate.poweringOnText'));
        }

        if (zustand.pending && zustand.pending.kind === 'power-off') {
            return warten(t('operate.poweringOffTitle'), t('operate.poweringOffText'));
        }

        if (zustand.power === 'warming') {
            return warten(t('operate.warmingTitle'), t('operate.warmingText'));
        }

        if (zustand.power === 'cooling') {
            return warten(t('operate.coolingTitle'), t('operate.coolingText'));
        }

        if (zustand.power === 'off' || zustand.power === 'unknown') {
            return mitte(
                t('operate.offTitle'),
                null,
                el('button', {
                    class: 'knopf haupt gross',
                    onclick: function () { befehl(function () { return ctx.beamer.powerOn(); }, 'Einschalten angefordert'); }
                }, [t('operate.powerOn')])
            );
        }

        // Ab hier: der Beamer läuft.
        const teile = [];

        if (zustand.mute.video) {
            teile.push(el('div', { class: 'streifen' }, [
                el('div', {}, [
                    el('div', { class: 'streifen-titel', text: t('operate.videoMutedTitle') }),
                    el('div', { class: 'streifen-text', text: t('operate.videoMutedText') })
                ]),
                el('button', {
                    class: 'streifen-knopf',
                    disabled: laeuftBefehl(zustand),
                    onclick: function () {
                        befehl(function () {
                            return ctx.beamer.setMute({ video: false, audio: zustand.mute.audio });
                        }, 'Bild wieder eingeblendet');
                    }
                }, [t('operate.showVideo')])
            ]));
        }

        teile.push(statuszeile(zustand), quellenBereich(zustand));

        const lautstaerke = lautstaerkeBereich(zustand);
        if (lautstaerke) teile.push(lautstaerke);

        teile.push(ausschaltKnopf(zustand));

        return el('div', {}, teile);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-operate');
        const zustand = ctx.beamer.getState();
        ui.clear(wurzel);

        // Ein gescheiterter Befehl erscheint als Streifen über der normalen
        // Bedienung — sie bleibt benutzbar. Ein Bildschirm, aus dem man nur
        // durch Neustart herauskommt, darf es hier nicht geben.
        const teile = [];
        if (zustand.commandError) teile.push(fehlerstreifen(zustand));
        teile.push(inhaltFuer(zustand));

        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, teile));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        anschlussName: anschlussName
    };
})();
