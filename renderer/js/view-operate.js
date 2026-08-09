// Bedien-Bildschirm. Zeigt in jedem Beamerzustand nur das, was gerade sinnvoll ist.
window.App = window.App || {};
window.App.viewOperate = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    // Die PJLink-Rohnamen (RGB, DIGITAL, …) sagen niemandem etwas.
    // Erste Ziffer der Kennung ist die Art des Anschlusses.
    const ANSCHLUSS_ART = { '1': 'VGA', '2': 'Video', '3': 'HDMI', '4': 'USB', '5': 'Netzwerk' };

    function anschlussName(code) {
        const art = ANSCHLUSS_ART[code.charAt(0)] || 'Eingang';
        return art + ' ' + code.charAt(1);
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
    // darf nichts davon stehen — der Rohtext bleibt im Protokoll.
    const FEHLERTEXTE = {
        'Undefined command': 'Der Beamer kennt diesen Befehl nicht.',
        'Out of parameter': 'Der Beamer hat diese Einstellung nicht angenommen.',
        'Unavailable time': 'Gerade nicht möglich — der Beamer ist beschäftigt, etwa beim Auf- oder Abwärmen.',
        'Projector/Display failure': 'Der Beamer meldet eine Störung an sich selbst.',
        'Authorization failed': 'Das Passwort stimmt nicht. Es lässt sich hinter dem Zahnrad ändern.',
        'Command reply mismatch': 'Der Beamer hat unerwartet geantwortet.',
        'Not connected': 'Gerade keine Verbindung zum Beamer.',
        'Connection timeout': 'Der Beamer hat nicht rechtzeitig geantwortet.',
        'Nicht verbunden': 'Gerade keine Verbindung zum Beamer.'
    };

    function fehlerKlartext(roh) {
        return FEHLERTEXTE[roh] || roh || 'Der Beamer hat den Befehl nicht ausgeführt.';
    }

    // ---------- Bausteine ----------

    function fehlerstreifen(zustand) {
        return el('div', { class: 'streifen fehler' }, [
            el('div', {}, [
                el('div', { class: 'streifen-titel', text: 'Das hat nicht geklappt' }),
                el('div', { class: 'streifen-text', text: fehlerKlartext(zustand.commandError) })
            ]),
            el('button', {
                class: 'streifen-knopf',
                onclick: function () { ctx.beamer.dismissError(); }
            }, ['Verstanden'])
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

        return el('div', { class: 'statuszeile' }, [
            el('div', { class: 'status' }, [
                el('span', { class: 'punkt an' }),
                'Beamer läuft'
            ]),
            el('div', { class: 'chips' }, [
                chip('Bild ausblenden', '🚫', zustand.mute.video, { video: !zustand.mute.video, audio: zustand.mute.audio }),
                chip('Ton stumm', '🔇', zustand.mute.audio, { video: zustand.mute.video, audio: !zustand.mute.audio })
            ])
        ]);
    }

    function quellenBereich(zustand) {
        const quellen = sichtbareQuellen();
        const gesperrt = laeuftBefehl(zustand);
        const wechselZu = zustand.pending && zustand.pending.kind === 'source' ? zustand.pending.target : null;

        if (quellen.length === 0) {
            return el('div', {}, [
                el('div', { class: 'feldname', text: 'Was soll gezeigt werden?' }),
                el('p', { class: 'mitte-text', text: 'Es ist noch keine Bildquelle eingerichtet. Über das Zahnrad oben rechts lässt sich das nachholen.' })
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
                    ? el('span', { class: 'unter' }, [spinner(), ' wird umgeschaltet …'])
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
                el('span', { class: 'unter', text: 'nicht eingerichtet' })
            ]));
        }

        return el('div', {}, [
            el('div', { class: 'feldname', text: 'Was soll gezeigt werden?' }),
            el('div', { class: 'kacheln' }, kacheln)
        ]);
    }

    function ausschaltKnopf(zustand) {
        return el('button', {
            class: 'knopf aus',
            disabled: laeuftBefehl(zustand),
            onclick: async function () {
                const ja = await ui.confirmDialog({
                    titel: 'Beamer ausschalten?',
                    text: 'Nach dem Ausschalten braucht der Beamer einige Minuten, bevor er sich wieder einschalten lässt.',
                    bestaetigen: 'Ja, ausschalten',
                    abbrechen: 'Abbrechen'
                });
                if (ja) befehl(function () { return ctx.beamer.powerOff(); }, 'Ausschalten angefordert');
            }
        }, ['Beamer ausschalten']);
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
            return warten('Einen Moment …', 'Die App nimmt Kontakt zum Beamer auf.');
        }

        if (zustand.link === 'offline') {
            return mitte(
                'Kein Kontakt zum Beamer',
                'Die App versucht es weiter. Bleibt es dabei, hilft meist: Beamer einschalten oder Netzwerkkabel prüfen. Alles Weitere steht hinter dem Zahnrad oben rechts.',
                el('button', {
                    class: 'knopf',
                    onclick: function () { ctx.beamer.refreshNow(); }
                }, ['Jetzt noch einmal versuchen'])
            );
        }

        // Ein laufender Ein- oder Ausschaltbefehl übernimmt den Bildschirm, bis
        // der Beamer den neuen Zustand meldet. Sonst stünde weiter der
        // Einschalten-Knopf da, obwohl der Beamer längst hochfährt.
        if (zustand.pending && zustand.pending.kind === 'power-on') {
            return warten('Der Beamer wird eingeschaltet …', 'Bitte einen Moment Geduld — das Hochfahren dauert meist eine halbe bis eine Minute.');
        }

        if (zustand.pending && zustand.pending.kind === 'power-off') {
            return warten('Der Beamer wird ausgeschaltet …', 'Danach kühlt die Lampe ab.');
        }

        if (zustand.power === 'warming') {
            return warten('Der Beamer wärmt sich auf …', 'Das dauert meist eine halbe bis eine Minute.');
        }

        if (zustand.power === 'cooling') {
            return warten('Der Beamer kühlt ab …', 'Solange die Lampe abkühlt, lässt er sich nicht wieder einschalten.');
        }

        if (zustand.power === 'off' || zustand.power === 'unknown') {
            return mitte(
                'Der Beamer ist aus',
                null,
                el('button', {
                    class: 'knopf haupt gross',
                    onclick: function () { befehl(function () { return ctx.beamer.powerOn(); }, 'Einschalten angefordert'); }
                }, ['Beamer einschalten'])
            );
        }

        // Ab hier: der Beamer läuft.
        const teile = [];

        if (zustand.mute.video) {
            teile.push(el('div', { class: 'streifen' }, [
                el('div', {}, [
                    el('div', { class: 'streifen-titel', text: 'Die Leinwand ist gerade schwarz' }),
                    el('div', { class: 'streifen-text', text: 'Der Beamer läuft weiter — das Bild ist nur ausgeblendet.' })
                ]),
                el('button', {
                    class: 'streifen-knopf',
                    disabled: laeuftBefehl(zustand),
                    onclick: function () {
                        befehl(function () {
                            return ctx.beamer.setMute({ video: false, audio: zustand.mute.audio });
                        }, 'Bild wieder eingeblendet');
                    }
                }, ['Bild wieder zeigen'])
            ]));
        }

        teile.push(statuszeile(zustand), quellenBereich(zustand), ausschaltKnopf(zustand));

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
