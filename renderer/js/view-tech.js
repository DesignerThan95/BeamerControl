// Technik-Seite: eine durchgehende Seite mit Verbindung, Bildquellen,
// Darstellung und Protokoll. Nur über das Zahnrad erreichbar.
window.App = window.App || {};
window.App.viewTech = (function () {
    const ui = window.App.ui;
    const el = ui.el;

    let ctx = null;
    let wurzel = null;

    // Nur für diese Ansicht: Ergebnisse und Stand des Netzwerk-Suchlaufs.
    let suchlauf = { laeuft: false, checked: 0, total: 0, devices: [] };
    let verbindungstext = '';
    let verbindungsArt = 'info';

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
            ])
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
            darstellungsBlock(),
            protokollBlock()
        ]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render
    };
})();
