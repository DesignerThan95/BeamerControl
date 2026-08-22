// Einrichtungsassistent. Läuft einmal, wenn keine gültigen Einstellungen da sind.
window.App = window.App || {};
window.App.viewSetup = (function () {
    const ui = window.App.ui;
    const el = ui.el;
    const t = window.App.i18n.t;

    // Wie auf der Technik-Seite: Sprachnamen bleiben unübersetzt, sonst findet
    // sie niemand wieder, der die eingestellte Sprache nicht lesen kann.
    const SPRACHNAMEN = { de: 'Deutsch', en: 'English' };

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

    // Die Sprachwahl steht in der Schrittleiste und damit auf jedem Schritt:
    // wer die Einrichtung in der falschen Sprache vor sich hat, soll das
    // sofort ändern können und nicht erst am Ende.
    function sprachwahl() {
        const gewaehlt = ctx.store.getLanguage();

        return el('span', { class: 'sprachwahl' }, window.App.i18n.supportedLanguages().map(function (code) {
            return el('button', {
                class: 'knopf text' + (gewaehlt === code ? ' aktiv' : ''),
                text: SPRACHNAMEN[code] || code,
                onclick: function () { window.App.setLanguage(code); }
            });
        }));
    }

    function schrittleiste() {
        const punkte = [1, 2, 3, 4].map(function (n) {
            let klasse = 'schritt';
            if (n < schritt) klasse = 'schritt fertig';
            else if (n === schritt) klasse = 'schritt jetzt';
            return el('span', { class: klasse, text: n < schritt ? '✓' : String(n) });
        });
        return el('div', { class: 'schritte' }, punkte.concat([
            el('span', { class: 'feld-lab', text: t('setup.wizardLabel') }),
            sprachwahl()
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
                    el('strong', { text: d.name || t('common.pjlinkDevice') }),
                    el('span', { class: 'treffer-host', text: '   ' + d.host })
                ]),
                el('button', {
                    class: 'knopf text',
                    text: t('setup.select'),
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
                el('div', { class: 'assistent-titel', text: t('common.scanRunning') }),
                el('div', { class: 'assistent-text', text: t('setup.scanDuration') }),
                balken,
                el('div', {
                    class: 'feld-lab',
                    text: t('common.scanProgress', { checked: suchlauf.checked, total: suchlauf.total, found: suchlauf.devices.length })
                }),
                trefferliste()
            ]);
        }

        if (suchlauf.fertig && suchlauf.devices.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: t('setup.noneFoundTitle') }),
                el('div', { class: 'assistent-text', text: t('setup.noneFoundIntro') }),
                el('ul', { class: 'pruefliste' }, [
                    el('li', { text: t('setup.noneFoundReasonOff') }),
                    el('li', { text: t('setup.noneFoundReasonStandby') }),
                    el('li', { text: t('setup.noneFoundReasonPjlink') }),
                    el('li', { text: t('setup.noneFoundReasonNetwork') })
                ]),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf haupt', onclick: suchen }, [t('common.searchAgain')]),
                    el('button', { class: 'knopf text', onclick: selbstEingeben }, [t('common.enterIpManually')])
                ])
            ]);
        }

        if (suchlauf.fertig) {
            return el('div', {}, [
                el('div', {
                    class: 'assistent-titel',
                    text: suchlauf.devices.length === 1
                        ? t('setup.foundOne')
                        : t('setup.foundMany', { count: suchlauf.devices.length })
                }),
                el('div', { class: 'assistent-text', text: t('setup.chooseDevice') }),
                trefferliste(),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf', onclick: suchen }, [t('common.searchAgain')]),
                    el('button', { class: 'knopf text', onclick: selbstEingeben }, [t('common.enterIpManually')])
                ])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: t('setup.whereTitle') }),
            el('div', { class: 'assistent-text', text: t('setup.whereText') }),
            el('div', { class: 'knopfzeile' }, [
                el('button', { class: 'knopf haupt', onclick: suchen }, [t('setup.searchProjectors')])
            ]),
            el('button', { class: 'knopf text', onclick: selbstEingeben }, [t('setup.enterIpInstead')])
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
        const hostFeld = el('input', { class: 'eingabe', value: auswahl.host, type: 'text', placeholder: t('common.hostPlaceholder') });
        const passFeld = el('input', { class: 'eingabe', value: passwort, type: 'password', placeholder: t('common.passwordPlaceholder') });

        return el('div', {}, [
            el('div', {
                class: 'assistent-titel',
                text: auswahl.name ? t('setup.deviceFound', { name: auswahl.name }) : t('setup.enterIpTitle')
            }),
            el('div', { class: 'assistent-text', text: t('setup.passwordHint') }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.ipAddress') }), hostFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.port') }), el('input', { class: 'eingabe', value: String(auswahl.port || 4352), type: 'number', disabled: true })]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.password') }), passFeld])
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
                            pruefText = t('setup.ipRequired');
                            pruefArt = 'fehler';
                            neuZeichnen();
                            return;
                        }
                        pruefText = t('common.connecting');
                        pruefArt = 'info';
                        neuZeichnen();
                        try {
                            await ctx.api.connect({ host: auswahl.host, port: auswahl.port || 4352, password: passwort || null });
                            ctx.store.setConnection({ host: auswahl.host, port: auswahl.port || 4352, password: passwort || null });
                            await ctx.store.save();
                            await eingaengeLaden();
                            schritt = 3;
                        } catch (e) {
                            pruefText = t('common.connectionFailed', { message: e.message });
                            pruefArt = 'fehler';
                        }
                        neuZeichnen();
                    }
                }, [t('common.next')]),
                el('button', { class: 'knopf', onclick: function () { schritt = 1; pruefText = ''; neuZeichnen(); } }, [t('setup.backToSearch')])
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
        const weiter = el('button', { class: 'knopf haupt', onclick: quellenUebernehmen }, [t('common.next')]);

        if (entwuerfe.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: t('setup.noInputsTitle') }),
                el('div', { class: 'assistent-text', text: t('setup.noInputsText') }),
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
            el('div', { class: 'assistent-titel', text: t('setup.nameInputsTitle') }),
            el('div', { class: 'assistent-text', text: t('setup.nameInputsText') }),
            el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: t('setup.inputColumn') }),
                el('span', { text: t('setup.nameColumn') }),
                el('span', { class: 'haken', text: t('setup.showColumn') })
            ])
        ].concat(zeilen).concat([
            el('div', { class: 'knopfzeile' }, [weiter])
        ]));
    }

    // ---------- Schritt 4: fertig ----------

    function schritt4() {
        const sichtbar = ctx.store.get().sources.filter(function (s) { return s.visible; });
        const quellentext = sichtbar.length
            ? t('setup.doneSourceCount', { count: sichtbar.length })
            : t('setup.doneNoSources');

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: t('setup.doneTitle') }),
            el('div', { class: 'assistent-text', text: t('setup.doneText', { sources: quellentext }) }),
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
                }, [t('setup.toOperate')])
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
