// Technik-Seite: eine durchgehende Seite mit Verbindung, Bildquellen,
// Darstellung und Protokoll. Nur über das Zahnrad erreichbar.
window.App = window.App || {};
window.App.viewTech = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    let ctx = null;
    let wurzel = null;

    // Zusatzfunktionen aus PJLink Class 2. Die Schlüssel müssen zu
    // CLASS2_FEATURES in store.js passen; welche PJLink-Befehle dahinterstehen,
    // steht in main.js.
    const FEATURES = [
        {
            key: 'volume',
            titel: 'Lautstärke',
            beschreibung: 'Knöpfe für lauter und leiser auf dem Bedien-Bildschirm. PJLink kennt hier nur Schritte auf und ab — einen Ist-Wert gibt der Beamer nicht heraus, es lässt sich also kein Balken anzeigen.'
        },
        {
            key: 'freeze',
            titel: 'Standbild',
            beschreibung: 'Hält das Bild an. Anders als „Bild ausblenden" bleibt die Leinwand hell — brauchbar, wenn am Rechner etwas vorbereitet wird.'
        },
        {
            key: 'deviceDetails',
            titel: 'Seriennummer und Softwarestand',
            beschreibung: 'Zeigt beides hier auf dieser Seite. Hilft bei Rückfragen an den Hersteller.'
        },
        {
            key: 'inputNames',
            titel: 'Eingangsnamen vom Beamer',
            beschreibung: 'Übernimmt die im Beamer hinterlegten Namen der Eingänge als Vorschlag für die Bildquellen weiter oben.'
        },
        {
            key: 'resolution',
            titel: 'Auflösung',
            beschreibung: 'Zeigt, welches Bild gerade anliegt und welche Auflösung der Beamer empfiehlt.'
        },
        {
            key: 'maintenance',
            titel: 'Wartung',
            beschreibung: 'Betriebsstunden des Filters und die Bestellnummern für Ersatzlampe und Ersatzfilter.'
        }
    ];

    // Nur für diese Ansicht: Ergebnisse und Stand des Netzwerk-Suchlaufs.
    let suchlauf = { laeuft: false, checked: 0, total: 0, devices: [] };
    let verbindungstext = '';
    let verbindungsArt = 'info';
    // Abgerufene Class-2-Werte. Werden nicht gespeichert und nicht von selbst
    // aktualisiert — sie stehen hier, weil jemand danach gefragt hat.
    let class2Werte = { details: null, aufloesung: null, wartung: null };
    let class2Laeuft = false;

    function neuZeichnen() { render(); }

    // ---------- Verbindung ----------

    function verbindungsBlock() {
        const c = ctx.store.get().connection;

        const hostFeld = el('input', { class: 'eingabe', value: c.host, type: 'text', placeholder: 'z. B. 192.168.1.100' });
        const portFeld = el('input', { class: 'eingabe', value: String(c.port), type: 'number' });
        const passFeld = el('input', { class: 'eingabe', value: c.password || '', type: 'password', placeholder: 'meistens leer' });

        function uebernehmen() {
            ctx.store.setConnection({
                host: hostFeld.value.trim(),
                port: parseInt(portFeld.value, 10) || 4352,
                password: passFeld.value.trim() || null
            });
            return ctx.store.save();
        }

        const testKnopf = el('button', {
            class: 'knopf haupt',
            onclick: async function () {
                await uebernehmen();
                const n = ctx.store.get().connection;
                verbindungstext = 'Verbinde …';
                verbindungsArt = 'info';
                neuZeichnen();
                try {
                    await ctx.api.connect({ host: n.host, port: n.port, password: n.password });
                    const info = await ctx.api.getDeviceInfo();
                    verbindungstext = 'Verbunden — ' + info.manufacturer + ' ' + info.model;
                    verbindungsArt = 'ok';
                    ctx.log.add('Verbindung geprüft: ' + n.host, 'ok');
                    ctx.beamer.start();
                    ctx.beamer.refreshNow();
                } catch (e) {
                    verbindungstext = 'Keine Verbindung: ' + e.message;
                    verbindungsArt = 'fehler';
                    ctx.log.add('Verbindung fehlgeschlagen: ' + e.message, 'fehler');
                }
                neuZeichnen();
            }
        }, ['Verbindung testen']);

        const suchKnopf = el('button', {
            class: 'knopf',
            disabled: suchlauf.laeuft,
            onclick: function () { suchen(); }
        }, [suchlauf.laeuft ? 'Suche läuft …' : 'Beamer im Netzwerk suchen']);

        const kinder = [
            el('div', { class: 'block-titel', text: 'Verbindung zum Beamer' }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: 'IP-Adresse' }), hostFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Port' }), portFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: 'Passwort (falls im Beamer eingerichtet)' }), passFeld])
            ]),
            el('div', { class: 'knopfzeile' }, [
                testKnopf,
                suchKnopf,
                verbindungstext ? el('span', { class: 'verbindungsstand' }, [
                    el('span', { class: 'punkt' + (verbindungsArt === 'ok' ? ' an' : '') }),
                    verbindungstext
                ]) : null
            ]),
            el('p', { class: 'hinweis', text: 'Die Suche findet nur Beamer, die gerade auf ihren Netzwerkanschluss antworten. Ein ausgeschalteter Beamer schaltet meist auch seine Netzwerkkarte ab. Damit er im Standby erreichbar bleibt — und sich von hier aus einschalten lässt —, muss im Beamer-Menü unter Netzwerk „Netzwerk-Standby" (teils „LAN im Standby" oder „Always On") aktiviert sein.' })
        ];

        if (suchlauf.laeuft) {
            const anteil = suchlauf.total ? Math.round((suchlauf.checked / suchlauf.total) * 100) : 0;
            const balken = el('div', { class: 'balken' }, [el('i')]);
            balken.firstChild.style.width = anteil + '%';
            kinder.push(balken, el('div', { class: 'feld-lab', text: suchlauf.checked + ' von ' + suchlauf.total + ' Adressen geprüft · ' + suchlauf.devices.length + ' gefunden' }));
        }

        if (suchlauf.devices.length > 0) {
            kinder.push(el('div', { class: 'trefferliste' }, suchlauf.devices.map(function (d) {
                return el('div', { class: 'treffer' }, [
                    el('span', { class: 'treffer-host', text: d.host }),
                    el('button', {
                        class: 'knopf text',
                        text: (d.name || 'PJLink-Gerät') + ' · übernehmen',
                        onclick: function () {
                            ctx.store.setConnection({ host: d.host, port: d.port, password: ctx.store.get().connection.password });
                            ctx.store.save();
                            neuZeichnen();
                        }
                    })
                ]);
            })));
        }

        return el('div', { class: 'block' }, kinder);
    }

    async function suchen() {
        suchlauf = { laeuft: true, checked: 0, total: 0, devices: [] };
        neuZeichnen();
        ctx.log.add('Netzwerksuche gestartet', 'info');

        const ab = ctx.api.onScanProgress(function (p) {
            suchlauf.checked = p.checked;
            suchlauf.total = p.total;
            suchlauf.devices = p.devices;
            neuZeichnen();
        });

        try {
            const erg = await ctx.api.scanNetwork();
            suchlauf.devices = erg.devices;
            ctx.log.add(erg.devices.length + ' Gerät(e) gefunden', erg.devices.length ? 'ok' : 'info');
        } catch (e) {
            ctx.log.add('Netzwerksuche fehlgeschlagen: ' + e.message, 'fehler');
        } finally {
            ab();
            suchlauf.laeuft = false;
            neuZeichnen();
        }
    }

    // ---------- Bildquellen ----------

    function quellenBlock() {
        const quellen = ctx.store.get().sources;

        const zeilen = quellen.map(function (q, i) {
            const zeile = el('div', { class: 'quellzeile', draggable: true }, [
                el('span', { class: 'griff', text: '⠿' }),
                el('span', { class: 'quellcode', text: q.code + ' · ' + window.App.viewOperate.anschlussName(q.code) }),
                el('input', {
                    class: 'eingabe',
                    value: q.label,
                    onchange: function (e) {
                        const neu = ctx.store.get().sources.slice();
                        neu[i] = Object.assign({}, neu[i], { label: e.target.value });
                        ctx.store.setSources(neu);
                        ctx.store.save();
                    }
                }),
                el('span', { class: 'haken' }, [
                    el('input', {
                        type: 'checkbox',
                        checked: q.visible,
                        onchange: function (e) {
                            const neu = ctx.store.get().sources.slice();
                            neu[i] = Object.assign({}, neu[i], { visible: e.target.checked });
                            ctx.store.setSources(neu);
                            ctx.store.save();
                        }
                    })
                ])
            ]);

            zeile.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', String(i));
                zeile.classList.add('zieht');
            });
            zeile.addEventListener('dragend', function () { zeile.classList.remove('zieht'); });
            zeile.addEventListener('dragover', function (e) { e.preventDefault(); });
            zeile.addEventListener('drop', function (e) {
                e.preventDefault();
                const von = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (Number.isNaN(von) || von === i) return;
                const neu = ctx.store.get().sources.slice();
                const bewegt = neu.splice(von, 1)[0];
                neu.splice(i, 0, bewegt);
                ctx.store.setSources(neu);
                ctx.store.save();
                neuZeichnen();
            });

            return zeile;
        });

        const einlesen = el('button', {
            class: 'knopf',
            onclick: async function () {
                try {
                    const erg = await ctx.api.getAvailableInputs();
                    const vorhanden = ctx.store.get().sources;
                    // Bekannte Namen behalten, neue Eingänge mit Vorschlag ergänzen.
                    const zusammen = erg.inputs.map(function (i) {
                        const alt = vorhanden.find(function (v) { return v.code === i.code; });
                        return alt || { code: i.code, label: window.App.viewOperate.anschlussName(i.code), visible: true };
                    });
                    ctx.store.setSources(zusammen);
                    await ctx.store.save();
                    ctx.log.add(erg.inputs.length + ' Eingänge vom Beamer eingelesen', 'ok');
                } catch (e) {
                    ctx.log.add('Eingänge konnten nicht gelesen werden: ' + e.message, 'fehler');
                }
                neuZeichnen();
            }
        }, ['Eingänge neu vom Beamer einlesen']);

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: 'Bildquellen' }),
            quellen.length > 0 ? el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: 'Eingang am Beamer' }),
                el('span', { text: 'Name für die Bedienung' }),
                el('span', { class: 'haken', text: 'Anzeigen' })
            ]) : null
        ].concat(zeilen).concat([
            quellen.length === 0 ? el('p', { class: 'assistent-text', text: 'Noch keine Eingänge bekannt. Der Knopf darunter fragt den Beamer.' }) : null,
            el('div', { class: 'knopfzeile' }, [einlesen])
        ]));
    }

    // ---------- Zusatzfunktionen (PJLink Class 2) ----------

    function aufloesungsText(a) {
        if (!a) return 'unbekannt';
        if (a.code === '-') return 'kein Signal';
        if (a.code === '*') return 'Signal nicht erkannt';
        return a.code;
    }

    function werteZeile(name, wert) {
        return el('div', { class: 'wertzeile' }, [
            el('span', { class: 'feld-lab', text: name }),
            el('span', { text: wert })
        ]);
    }

    // Holt genau die Werte, die freigeschaltet sind. Auf Knopfdruck, nicht von
    // selbst: jede Abfrage geht als eigener Befehl an den Beamer.
    async function class2Abrufen() {
        class2Laeuft = true;
        neuZeichnen();

        const holen = async function (key, fn, ziel) {
            if (!ctx.store.isClass2FeatureEnabled(key)) return;
            try {
                class2Werte[ziel] = await window.App.class2(key, fn);
            } catch (e) {
                class2Werte[ziel] = null;
                ctx.log.add('Abfrage fehlgeschlagen (' + key + '): ' + e.message, 'fehler');
            }
        };

        await holen('deviceDetails', function () { return ctx.api.getDeviceDetails(); }, 'details');
        await holen('resolution', function () { return ctx.api.getResolutions(); }, 'aufloesung');
        await holen('maintenance', function () { return ctx.api.getMaintenance(); }, 'wartung');

        class2Laeuft = false;
        neuZeichnen();
    }

    // Übernimmt die im Beamer hinterlegten Namen als Beschriftung der
    // Bildquellen. Bestehende eigene Namen werden dabei überschrieben —
    // deshalb steht das hinter einer Rückfrage.
    async function eingangsnamenUebernehmen() {
        const quellen = ctx.store.get().sources;
        if (quellen.length === 0) {
            ctx.log.add('Keine Bildquellen eingerichtet — erst Eingänge einlesen', 'info');
            return;
        }

        const ja = await ui.confirmDialog({
            titel: 'Namen vom Beamer übernehmen?',
            text: 'Die hier vergebenen Namen der Bildquellen werden durch die im Beamer hinterlegten ersetzt.',
            bestaetigen: 'Ja, übernehmen'
        });
        if (!ja) return;

        const neu = quellen.slice();
        let uebernommen = 0;

        for (let i = 0; i < neu.length; i++) {
            try {
                const name = await window.App.class2('inputNames', function () {
                    return ctx.api.getInputName(neu[i].code);
                });
                if (name) {
                    neu[i] = Object.assign({}, neu[i], { label: name });
                    uebernommen++;
                }
            } catch (e) {
                ctx.log.add('Name für Eingang ' + neu[i].code + ' nicht lesbar: ' + e.message, 'fehler');
                break; // Kennt der Beamer den Befehl nicht, bringen weitere Versuche nichts.
            }
        }

        ctx.store.setSources(neu);
        await ctx.store.save();
        ctx.log.add(uebernommen + ' Eingangsname(n) vom Beamer übernommen', uebernommen ? 'ok' : 'info');
        neuZeichnen();
    }

    function zusatzBlock() {
        const klasse = ctx.beamer.getState().pjlinkClass;

        const kinder = [el('div', { class: 'block-titel', text: 'Zusatzfunktionen des Beamers' })];

        // Solange nicht verbunden wurde, ist unbekannt, was das Gerät kann.
        // Dann hier gar nichts anzubieten ist ehrlicher als Kästchen, die
        // vielleicht ins Leere führen.
        if (klasse === null) {
            kinder.push(el('p', { class: 'hinweis', text: 'Noch nicht bekannt — die App fragt das beim Verbinden ab. Sobald die Verbindung steht, erscheint hier, was dieser Beamer zusätzlich kann.' }));
            return el('div', { class: 'block' }, kinder);
        }

        if (klasse !== 2) {
            kinder.push(el('p', { class: 'hinweis', text: 'Dieser Beamer meldet nur PJLink Class 1. Lautstärke, Standbild und Wartungswerte gehören zu Class 2 und stehen an diesem Gerät nicht zur Verfügung.' }));
            return el('div', { class: 'block' }, kinder);
        }

        kinder.push(el('p', { class: 'hinweis', text: 'Dieser Beamer meldet PJLink Class 2. Was davon er wirklich beherrscht, verrät PJLink nicht — das muss ausprobiert werden. Jede Funktion lässt sich hier einzeln einschalten. Antwortet der Beamer beim ersten Versuch, dass er den Befehl nicht kennt, schaltet sie sich von selbst wieder ab.' }));

        kinder.push(el('div', { class: 'funktionsliste' }, FEATURES.map(function (f) {
            const an = ctx.store.isClass2FeatureEnabled(f.key);

            return el('label', { class: 'funktion' }, [
                el('input', {
                    type: 'checkbox',
                    checked: an,
                    onchange: async function (e) {
                        const jetzt = ctx.store.get().enabledClass2Features.filter(function (k) { return k !== f.key; });
                        if (e.target.checked) jetzt.push(f.key);
                        ctx.store.setClass2Features(jetzt);
                        await ctx.store.save();
                        ctx.log.add(f.titel + (e.target.checked ? ' eingeschaltet' : ' ausgeschaltet'), 'info');
                        neuZeichnen();
                    }
                }),
                el('span', {}, [
                    el('span', { class: 'funktion-titel', text: f.titel }),
                    el('span', { class: 'funktion-text', text: f.beschreibung })
                ])
            ]);
        })));

        // Der Knopf für die Eingangsnamen gehört zu den Bildquellen und wird
        // deshalb nur gezeigt, wenn diese Funktion eingeschaltet ist.
        const knoepfe = [];
        const zeigtWerte = ['deviceDetails', 'resolution', 'maintenance'].some(function (k) {
            return ctx.store.isClass2FeatureEnabled(k);
        });

        if (zeigtWerte) {
            knoepfe.push(el('button', {
                class: 'knopf',
                disabled: class2Laeuft,
                onclick: function () { class2Abrufen(); }
            }, [class2Laeuft ? 'Wird abgefragt …' : 'Werte vom Beamer abrufen']));
        }

        if (ctx.store.isClass2FeatureEnabled('inputNames')) {
            knoepfe.push(el('button', {
                class: 'knopf',
                onclick: function () { eingangsnamenUebernehmen(); }
            }, ['Eingangsnamen vom Beamer übernehmen']));
        }

        if (knoepfe.length) kinder.push(el('div', { class: 'knopfzeile' }, knoepfe));

        const werte = [];

        if (class2Werte.details) {
            werte.push(werteZeile('Seriennummer', class2Werte.details.serialNumber || 'unbekannt'));
            werte.push(werteZeile('Softwarestand', class2Werte.details.softwareVersion || 'unbekannt'));
        }

        if (class2Werte.aufloesung) {
            werte.push(werteZeile('Anliegendes Bild', aufloesungsText(class2Werte.aufloesung.input)));
            werte.push(werteZeile('Vom Beamer empfohlen', aufloesungsText(class2Werte.aufloesung.recommended)));
        }

        if (class2Werte.wartung) {
            const w = class2Werte.wartung;
            werte.push(werteZeile('Filter in Betrieb seit', w.filterHours === null ? 'unbekannt' : w.filterHours + ' Stunden'));
            werte.push(werteZeile('Ersatzlampe', w.lampModels.length ? w.lampModels.join(', ') : 'keine angegeben'));
            werte.push(werteZeile('Ersatzfilter', w.filterModels.length ? w.filterModels.join(', ') : 'keine angegeben'));
        }

        if (werte.length) kinder.push(el('div', { class: 'werte' }, werte));

        return el('div', { class: 'block' }, kinder);
    }

    // ---------- Darstellung ----------

    function darstellungsBlock() {
        const t = ctx.theme.getTheme();

        function wahl(wert, beschriftung) {
            return el('label', {}, [
                el('input', {
                    type: 'radio',
                    name: 'thema',
                    checked: t === wert,
                    onchange: function () { ctx.theme.setTheme(wert); neuZeichnen(); }
                }),
                beschriftung
            ]);
        }

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: 'Darstellung' }),
            el('div', { class: 'wahl' }, [
                wahl('system', 'Wie das Betriebssystem'),
                wahl('light', 'Hell'),
                wahl('dark', 'Dunkel')
            ]),
            el('div', { class: 'knopfzeile' }, [
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        checked: ctx.theme.getHighContrast(),
                        onchange: function (e) { ctx.theme.setHighContrast(e.target.checked); neuZeichnen(); }
                    }),
                    ' Hoher Kontrast (größere Schrift, kräftigere Ränder)'
                ])
            ])
        ]);
    }

    // ---------- Protokoll ----------

    function protokollBlock() {
        const zeilen = ctx.log.all().map(function (e) {
            return el('div', { class: e.art }, ['[' + e.zeit + '] ' + e.text]);
        });

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: 'Protokoll' }),
            el('div', { class: 'protokoll' }, zeilen.length ? zeilen : [el('div', { text: 'Noch nichts passiert.' })]),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf',
                    onclick: function () {
                        const text = ctx.log.all().map(function (e) { return '[' + e.zeit + '] ' + e.text; }).join('\n');
                        navigator.clipboard.writeText(text);
                        ctx.log.add('Protokoll kopiert', 'info');
                        neuZeichnen();
                    }
                }, ['Protokoll kopieren']),
                el('button', {
                    class: 'knopf',
                    onclick: async function () {
                        const ja = await ui.confirmDialog({
                            titel: 'Einrichtung neu starten?',
                            text: 'Die gespeicherte Verbindung und die Namen der Bildquellen gehen dabei verloren.',
                            bestaetigen: 'Ja, neu einrichten'
                        });
                        if (!ja) return;
                        ctx.beamer.stop();
                        ctx.store.setConnection({ host: '', port: 4352, password: null });
                        ctx.store.setSources([]);
                        ctx.store.resetSetup();
                        await ctx.store.save();
                        window.App.viewSetup.neuBeginnen();
                        window.App.showView('setup');
                    }
                }, ['Einrichtung neu starten'])
            ])
        ]);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-tech');
        ui.clear(wurzel);
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [
            el('button', { class: 'knopf text zurueck', text: '← Zurück zur Bedienung', onclick: function () { window.App.showView('operate'); } }),
            verbindungsBlock(),
            quellenBlock(),
            zusatzBlock(),
            darstellungsBlock(),
            protokollBlock()
        ]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        FEATURES: FEATURES
    };
})();
