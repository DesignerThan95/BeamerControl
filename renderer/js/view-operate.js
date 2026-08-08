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
    // Läuft ein Befehl, wird gesperrt — sonst klickt jemand dreimal hintereinander.
    let sperre = false;

    function sichtbareQuellen() {
        return ctx.store.get().sources.filter(function (s) { return s.visible; });
    }

    async function mitSperre(fn, meldung) {
        if (sperre) return;
        sperre = true;
        render();
        try {
            await fn();
            if (meldung) ctx.log.add(meldung, 'ok');
        } catch (e) {
            ctx.log.add('Befehl fehlgeschlagen: ' + e.message, 'fehler');
        } finally {
            sperre = false;
            render();
        }
    }

    // ---------- Bausteine ----------

    function statuszeile(zustand) {
        const chipVideo = el('button', {
            class: 'chip' + (zustand.mute.video ? ' aktiv' : ''),
            onclick: function () {
                mitSperre(function () {
                    return ctx.beamer.setMute({ video: !zustand.mute.video, audio: zustand.mute.audio });
                }, zustand.mute.video ? 'Bild wieder eingeblendet' : 'Bild ausgeblendet');
            },
            disabled: sperre
        }, ['🚫 Bild ausblenden']);

        const chipTon = el('button', {
            class: 'chip' + (zustand.mute.audio ? ' aktiv' : ''),
            onclick: function () {
                mitSperre(function () {
                    return ctx.beamer.setMute({ video: zustand.mute.video, audio: !zustand.mute.audio });
                }, zustand.mute.audio ? 'Ton wieder an' : 'Ton stummgeschaltet');
            },
            disabled: sperre
        }, ['🔇 Ton stumm']);

        return el('div', { class: 'statuszeile' }, [
            el('div', { class: 'status' }, [
                el('span', { class: 'punkt an' }),
                'Beamer läuft'
            ]),
            el('div', { class: 'chips' }, [chipVideo, chipTon])
        ]);
    }

    function quellenBereich(zustand) {
        const quellen = sichtbareQuellen();

        if (quellen.length === 0) {
            return el('div', {}, [
                el('div', { class: 'feldname', text: 'Was soll gezeigt werden?' }),
                el('p', { class: 'mitte-text', text: 'Es ist noch keine Bildquelle eingerichtet. Über das Zahnrad oben rechts lässt sich das nachholen.' })
            ]);
        }

        const kacheln = quellen.map(function (q) {
            const aktiv = zustand.sourceCode === q.code;
            return el('button', {
                class: 'kachel' + (aktiv ? ' aktiv' : ''),
                disabled: sperre,
                onclick: function () {
                    if (aktiv) return;
                    mitSperre(function () { return ctx.beamer.selectSource(q.code); }, 'Bildquelle gewechselt auf ' + q.label);
                }
            }, [
                q.label,
                el('span', { class: 'unter', text: anschlussName(q.code) })
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

    function ausschaltKnopf() {
        return el('button', {
            class: 'knopf aus',
            disabled: sperre,
            onclick: async function () {
                const ja = await ui.confirmDialog({
                    titel: 'Beamer ausschalten?',
                    text: 'Nach dem Ausschalten braucht der Beamer einige Minuten, bevor er sich wieder einschalten lässt.',
                    bestaetigen: 'Ja, ausschalten',
                    abbrechen: 'Abbrechen'
                });
                if (ja) mitSperre(function () { return ctx.beamer.powerOff(); }, 'Ausschalten angefordert');
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

        if (zustand.pendingTimedOut) {
            return mitte(
                'Der Beamer antwortet nicht wie erwartet',
                'Der Befehl wurde gesendet, aber der Beamer hat den neuen Zustand nicht gemeldet. Schau kurz zur Leinwand — oft hat es trotzdem geklappt.',
                el('button', { class: 'knopf haupt', onclick: function () { ctx.beamer.refreshNow(); } }, ['Zustand neu abfragen'])
            );
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
                    disabled: sperre,
                    onclick: function () { mitSperre(function () { return ctx.beamer.powerOn(); }, 'Einschalten angefordert'); }
                }, [sperre ? 'wird eingeschaltet …' : 'Beamer einschalten'])
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
                    disabled: sperre,
                    onclick: function () {
                        mitSperre(function () {
                            return ctx.beamer.setMute({ video: false, audio: zustand.mute.audio });
                        }, 'Bild wieder eingeblendet');
                    }
                }, ['Bild wieder zeigen'])
            ]));
        }

        teile.push(statuszeile(zustand), quellenBereich(zustand), ausschaltKnopf());

        return el('div', {}, teile);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-operate');
        const zustand = ctx.beamer.getState();
        ui.clear(wurzel);
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [inhaltFuer(zustand)]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        anschlussName: anschlussName
    };
})();
