// Einrichtungsassistent. Läuft einmal, wenn keine gültigen Einstellungen da sind.
window.App = window.App || {};
window.App.viewSetup = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    let ctx = null;
    let wurzel = null;

    let schritt = 1;
    let suchlauf = { laeuft: false, checked: 0, total: 0, devices: [], fertig: false };
    let auswahl = null;      // { host, port, name }
    let passwort = '';
    let pruefText = '';
    let pruefArt = 'info';
    let entwuerfe = [];      // Bildquellen im Aufbau

    function neuZeichnen() { render(); }

    function schrittleiste() {
        const punkte = [1, 2, 3, 4].map(function (n) {
            let klasse = 'schritt';
            if (n < schritt) klasse = 'schritt fertig';
            else if (n === schritt) klasse = 'schritt jetzt';
            return el('span', { class: klasse, text: n < schritt ? '✓' : String(n) });
        });
        return el('div', { class: 'schritte' }, punkte.concat([
            el('span', { class: 'feld-lab', text: 'Einrichtung' })
        ]));
    }

    // ---------- Schritt 1: finden ----------

    async function suchen() {
        suchlauf = { laeuft: true, checked: 0, total: 0, devices: [], fertig: false };
        neuZeichnen();

        const ab = ctx.api.onScanProgress(function (p) {
            suchlauf.checked = p.checked;
            suchlauf.total = p.total;
            suchlauf.devices = p.devices;
            neuZeichnen();
        });

        try {
            const erg = await ctx.api.scanNetwork();
            suchlauf.devices = erg.devices;
            ctx.log.add('Einrichtung: ' + erg.devices.length + ' Gerät(e) gefunden', 'info');
        } catch (e) {
            ctx.log.add('Einrichtung: Suche fehlgeschlagen — ' + e.message, 'fehler');
        } finally {
            ab();
            suchlauf.laeuft = false;
            suchlauf.fertig = true;
            neuZeichnen();
        }
    }

    function selbstEingeben() {
        auswahl = { host: '', port: 4352, name: null };
        schritt = 2;
        pruefText = '';
        neuZeichnen();
    }

    function trefferliste() {
        if (suchlauf.devices.length === 0) return null;
        return el('div', { class: 'trefferliste' }, suchlauf.devices.map(function (d) {
            return el('div', { class: 'treffer' }, [
                el('span', {}, [
                    el('strong', { text: d.name || 'PJLink-Gerät' }),
                    el('span', { class: 'treffer-host', text: '   ' + d.host })
                ]),
                el('button', {
                    class: 'knopf text',
                    text: 'auswählen',
                    onclick: function () { auswahl = d; schritt = 2; pruefText = ''; neuZeichnen(); }
                })
            ]);
        }));
    }

    function schritt1() {
        if (suchlauf.laeuft) {
            const anteil = suchlauf.total ? Math.round((suchlauf.checked / suchlauf.total) * 100) : 0;
            const balken = el('div', { class: 'balken' }, [el('i')]);
            balken.firstChild.style.width = anteil + '%';

            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: 'Suche läuft …' }),
                el('div', { class: 'assistent-text', text: 'Das dauert bis zu einer halben Minute.' }),
                balken,
                el('div', { class: 'feld-lab', text: suchlauf.checked + ' von ' + suchlauf.total + ' Adressen geprüft · ' + suchlauf.devices.length + ' gefunden' }),
                trefferliste()
            ]);
        }

        if (suchlauf.fertig && suchlauf.devices.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: 'Kein Beamer gefunden' }),
                el('div', { class: 'assistent-text', text: 'Das hat meist einen dieser Gründe:' }),
                el('ul', { class: 'pruefliste' }, [
                    el('li', { text: 'Der Beamer ist ganz aus. Er muss laufen oder im Netzwerk-Standby sein.' }),
                    el('li', { text: 'Im Beamer-Menü ist PJLink nicht eingeschaltet.' }),
                    el('li', { text: 'Beamer und dieser Rechner hängen in verschiedenen Netzwerken.' })
                ]),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf haupt', onclick: suchen }, ['Noch einmal suchen']),
                    el('button', { class: 'knopf text', onclick: selbstEingeben }, ['IP-Adresse selbst eingeben'])
                ])
            ]);
        }

        if (suchlauf.fertig) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: suchlauf.devices.length === 1 ? 'Ein Gerät gefunden' : suchlauf.devices.length + ' Geräte gefunden' }),
                el('div', { class: 'assistent-text', text: 'Wähle den Beamer aus, der gesteuert werden soll.' }),
                trefferliste(),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf', onclick: suchen }, ['Noch einmal suchen']),
                    el('button', { class: 'knopf text', onclick: selbstEingeben }, ['IP-Adresse selbst eingeben'])
                ])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: 'Wo steht der Beamer?' }),
            el('div', { class: 'assistent-text', text: 'Die App sucht im Netzwerk nach Beamern. Der Beamer muss dafür eingeschaltet oder im Netzwerk-Standby sein.' }),
            el('div', { class: 'knopfzeile' }, [
                el('button', { class: 'knopf haupt', onclick: suchen }, ['Beamer suchen'])
            ]),
            el('button', { class: 'knopf text', onclick: selbstEingeben }, ['IP-Adresse stattdessen selbst eingeben'])
        ]);
    }

    // ---------- Schritt 2: prüfen ----------

    async function eingaengeLaden() {
        try {
            const erg = await ctx.api.getAvailableInputs();
            entwuerfe = erg.inputs.map(function (i) {
                return { code: i.code, label: window.App.viewOperate.anschlussName(i.code), visible: true };
            });
            ctx.log.add('Einrichtung: ' + entwuerfe.length + ' Eingänge gelesen', 'ok');
        } catch (e) {
            entwuerfe = [];
            ctx.log.add('Einrichtung: Eingänge nicht lesbar — ' + e.message, 'fehler');
        }
    }

    function schritt2() {
        const hostFeld = el('input', { class: 'eingabe', value: auswahl.host, type: 'text', placeholder: 'z. B. 192.168.1.100' });
        const passFeld = el('input', { class: 'eingabe', value: passwort, type: 'password', placeholder: 'meistens leer' });

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: auswahl.name ? auswahl.name + ' gefunden' : 'IP-Adresse eingeben' }),
            el('div', { class: 'assistent-text', text: 'Falls im Beamer ein PJLink-Passwort eingerichtet ist, trag es hier ein — sonst einfach weiter.' }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: 'IP-Adresse' }), hostFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Port' }), el('input', { class: 'eingabe', value: String(auswahl.port || 4352), type: 'number', disabled: true })]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Passwort' }), passFeld])
            ]),
            pruefText ? el('div', { class: 'knopfzeile' }, [
                el('span', { class: 'verbindungsstand' }, [el('span', { class: 'punkt' + (pruefArt === 'ok' ? ' an' : '') }), pruefText])
            ]) : null,
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf haupt',
                    onclick: async function () {
                        auswahl.host = hostFeld.value.trim();
                        passwort = passFeld.value.trim();
                        if (!auswahl.host) {
                            pruefText = 'Bitte zuerst eine IP-Adresse eintragen.';
                            pruefArt = 'fehler';
                            neuZeichnen();
                            return;
                        }
                        pruefText = 'Verbinde …';
                        pruefArt = 'info';
                        neuZeichnen();
                        try {
                            await ctx.api.connect({ host: auswahl.host, port: auswahl.port || 4352, password: passwort || null });
                            ctx.store.setConnection({ host: auswahl.host, port: auswahl.port || 4352, password: passwort || null });
                            await ctx.store.save();
                            await eingaengeLaden();
                            schritt = 3;
                        } catch (e) {
                            pruefText = 'Keine Verbindung: ' + e.message;
                            pruefArt = 'fehler';
                        }
                        neuZeichnen();
                    }
                }, ['Weiter']),
                el('button', { class: 'knopf', onclick: function () { schritt = 1; pruefText = ''; neuZeichnen(); } }, ['Zurück zur Suche'])
            ])
        ]);
    }

    // ---------- Schritt 3: benennen ----------

    async function quellenUebernehmen() {
        ctx.store.setSources(entwuerfe);
        await ctx.store.save();
        schritt = 4;
        neuZeichnen();
    }

    function schritt3() {
        const weiter = el('button', { class: 'knopf haupt', onclick: quellenUebernehmen }, ['Weiter']);

        if (entwuerfe.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: 'Keine Eingänge gemeldet' }),
                el('div', { class: 'assistent-text', text: 'Der Beamer hat seine Anschlüsse nicht verraten. Das lässt sich später auf der Technik-Seite nachholen — die Bedienung funktioniert auch so, nur ohne Auswahl der Bildquelle.' }),
                el('div', { class: 'knopfzeile' }, [weiter])
            ]);
        }

        const zeilen = entwuerfe.map(function (q, i) {
            return el('div', { class: 'quellzeile' }, [
                el('span'),
                el('span', { class: 'quellcode', text: q.code + ' · ' + window.App.viewOperate.anschlussName(q.code) }),
                el('input', {
                    class: 'eingabe',
                    value: q.label,
                    onchange: function (e) { entwuerfe[i].label = e.target.value; }
                }),
                el('span', { class: 'haken' }, [
                    el('input', {
                        type: 'checkbox',
                        checked: q.visible,
                        onchange: function (e) { entwuerfe[i].visible = e.target.checked; }
                    })
                ])
            ]);
        });

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: 'Wie heißen die Anschlüsse bei euch?' }),
            el('div', { class: 'assistent-text', text: 'Der Beamer meldet diese Eingänge. Gib ihnen Namen, die jeder versteht — und nimm den Haken weg bei allem, was ihr nie benutzt.' }),
            el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: 'Eingang' }),
                el('span', { text: 'Name' }),
                el('span', { class: 'haken', text: 'Zeigen' })
            ])
        ].concat(zeilen).concat([
            el('div', { class: 'knopfzeile' }, [weiter])
        ]));
    }

    // ---------- Schritt 4: fertig ----------

    function schritt4() {
        const sichtbar = ctx.store.get().sources.filter(function (s) { return s.visible; });
        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: 'Fertig' }),
            el('div', { class: 'assistent-text', text: 'Die Bedienung zeigt ab jetzt ' + (sichtbar.length ? sichtbar.length + ' Bildquelle(n)' : 'keine Bildquellen') + ' und den Ein/Aus-Schalter. Alles Technische liegt hinter dem Zahnrad oben rechts.' }),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf haupt',
                    onclick: async function () {
                        ctx.store.markSetupComplete();
                        await ctx.store.save();
                        ctx.beamer.start();
                        ctx.beamer.refreshNow();
                        window.App.showView('operate');
                    }
                }, ['Zur Bedienung'])
            ])
        ]);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-setup');
        ui.clear(wurzel);
        let inhalt;
        if (schritt === 1) inhalt = schritt1();
        else if (schritt === 2) inhalt = schritt2();
        else if (schritt === 3) inhalt = schritt3();
        else inhalt = schritt4();
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [schrittleiste(), inhalt]));
    }

    return {
        init: function (c) {
            ctx = c;
            // Wurde die Verbindung schon gespeichert, aber die Einrichtung nicht
            // beendet, geht es beim Prüfen weiter statt wieder beim Suchen.
            const verb = ctx.store.get().connection;
            if (verb.host) {
                auswahl = { host: verb.host, port: verb.port, name: null };
                passwort = verb.password || '';
                schritt = 2;
            }
        },

        // Wird von der Technik-Seite gerufen, wenn jemand neu einrichten will.
        neuBeginnen: function () {
            schritt = 1;
            suchlauf = { laeuft: false, checked: 0, total: 0, devices: [], fertig: false };
            auswahl = null;
            passwort = '';
            pruefText = '';
            entwuerfe = [];
        },

        render: render
    };
})();
