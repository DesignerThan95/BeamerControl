// Technik-Seite: eine durchgehende Seite mit Verbindung, Bildquellen,
// Darstellung und Protokoll. Nur über das Zahnrad erreichbar.
window.App = window.App || {};
window.App.viewTech = (function () {
    const ui = window.App.ui;
    const el = ui.el;
    const t = window.App.i18n.t;

    let ctx = null;
    let wurzel = null;

    // Zusatzfunktionen aus PJLink Class 2. Die Schlüssel müssen zu
    // CLASS2_FEATURES in store.js passen; welche PJLink-Befehle dahinterstehen,
    // steht in main.js. Titel und Beschreibung stehen in den Sprachdateien
    // unter tech.features.<key>.
    const FEATURES = [
        { key: 'volume' },
        { key: 'freeze' },
        { key: 'deviceDetails' },
        { key: 'inputNames' },
        { key: 'resolution' },
        { key: 'maintenance' }
    ];

    function featureTitel(key) {
        return t('tech.features.' + key + '.title');
    }

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

        const hostFeld = el('input', { class: 'eingabe', value: c.host, type: 'text', placeholder: t('common.hostPlaceholder') });
        const portFeld = el('input', { class: 'eingabe', value: String(c.port), type: 'number' });
        const passFeld = el('input', { class: 'eingabe', value: c.password || '', type: 'password', placeholder: t('common.passwordPlaceholder') });

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
                verbindungstext = t('common.connecting');
                verbindungsArt = 'info';
                neuZeichnen();
                try {
                    await ctx.api.connect({ host: n.host, port: n.port, password: n.password });
                    const info = await ctx.api.getDeviceInfo();
                    verbindungstext = t('tech.connectedWith', { manufacturer: info.manufacturer, model: info.model });
                    verbindungsArt = 'ok';
                    ctx.log.add('Verbindung geprüft: ' + n.host, 'ok');
                    ctx.beamer.start();
                    ctx.beamer.refreshNow();
                } catch (e) {
                    verbindungstext = t('common.connectionFailed', { message: e.message });
                    verbindungsArt = 'fehler';
                    ctx.log.add('Verbindung fehlgeschlagen: ' + e.message, 'fehler');
                }
                neuZeichnen();
            }
        }, [t('tech.testConnection')]);

        const suchKnopf = el('button', {
            class: 'knopf',
            disabled: suchlauf.laeuft,
            onclick: function () { suchen(); }
        }, [suchlauf.laeuft ? t('common.scanRunning') : t('tech.scanNetwork')]);

        const kinder = [
            el('div', { class: 'block-titel', text: t('tech.connectionHeading') }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.ipAddress') }), hostFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.port') }), portFeld]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('tech.passwordLabel') }), passFeld])
            ]),
            el('div', { class: 'knopfzeile' }, [
                testKnopf,
                suchKnopf,
                verbindungstext ? el('span', { class: 'verbindungsstand' }, [
                    el('span', { class: 'punkt' + (verbindungsArt === 'ok' ? ' an' : '') }),
                    verbindungstext
                ]) : null
            ]),
            el('p', { class: 'hinweis', text: t('tech.standbyHint') })
        ];

        if (suchlauf.laeuft) {
            const anteil = suchlauf.total ? Math.round((suchlauf.checked / suchlauf.total) * 100) : 0;
            const balken = el('div', { class: 'balken' }, [el('i')]);
            balken.firstChild.style.width = anteil + '%';
            kinder.push(balken, el('div', {
                class: 'feld-lab',
                text: t('common.scanProgress', { checked: suchlauf.checked, total: suchlauf.total, found: suchlauf.devices.length })
            }));
        }

        if (suchlauf.devices.length > 0) {
            kinder.push(el('div', { class: 'trefferliste' }, suchlauf.devices.map(function (d) {
                return el('div', { class: 'treffer' }, [
                    el('span', { class: 'treffer-host', text: d.host }),
                    el('button', {
                        class: 'knopf text',
                        text: t('tech.useDevice', { name: d.name || t('common.pjlinkDevice') }),
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
        }, [t('tech.reloadInputs')]);

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.sourcesHeading') }),
            quellen.length > 0 ? el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: t('tech.sourceInputColumn') }),
                el('span', { text: t('tech.sourceLabelColumn') }),
                el('span', { class: 'haken', text: t('tech.sourceVisibleColumn') })
            ]) : null
        ].concat(zeilen).concat([
            quellen.length === 0 ? el('p', { class: 'assistent-text', text: t('tech.noInputsYet') }) : null,
            el('div', { class: 'knopfzeile' }, [einlesen])
        ]));
    }

    // ---------- Zusatzfunktionen (PJLink Class 2) ----------

    function aufloesungsText(a) {
        if (!a) return t('common.unknown');
        if (a.code === '-') return t('tech.noSignal');
        if (a.code === '*') return t('tech.signalNotRecognized');
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
            titel: t('tech.applyInputNamesConfirmTitle'),
            text: t('tech.applyInputNamesConfirmText'),
            bestaetigen: t('tech.applyInputNamesConfirmYes')
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
        const zustand = ctx.beamer.getState();
        const klasse = zustand.pjlinkClass;
        const herkunft = zustand.pjlinkClassSource;

        const kinder = [el('div', { class: 'block-titel', text: t('tech.class2Heading') })];

        // Solange nicht verbunden wurde, ist unbekannt, was das Gerät kann.
        // Dann hier gar nichts anzubieten ist ehrlicher als Kästchen, die
        // vielleicht ins Leere führen.
        if (klasse === null) {
            kinder.push(el('p', { class: 'hinweis', text: t('tech.class2Unknown') }));
            return el('div', { class: 'block' }, kinder);
        }

        if (klasse !== 2) {
            // Zwei sehr verschiedene Gründe führen hierher. Sie dürfen nicht
            // gleich klingen: das eine ist eine Auskunft des Geräts, das
            // andere nur eine Vorsichtsannahme der App.
            if (herkunft === 'gemeldet') {
                kinder.push(el('p', { class: 'hinweis', text: t('tech.class1Reported') }));
            } else {
                kinder.push(el('p', { class: 'hinweis', text: t('tech.class1Assumed') }));
            }
            return el('div', { class: 'block' }, kinder);
        }

        kinder.push(el('p', { class: 'hinweis', text: t('tech.class2Available') }));

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
                        ctx.log.add(f.key + (e.target.checked ? ' eingeschaltet' : ' ausgeschaltet'), 'info');
                        neuZeichnen();
                    }
                }),
                el('span', {}, [
                    el('span', { class: 'funktion-titel', text: featureTitel(f.key) }),
                    el('span', { class: 'funktion-text', text: t('tech.features.' + f.key + '.description') })
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
            }, [class2Laeuft ? t('tech.querying') : t('tech.fetchValues')]));
        }

        if (ctx.store.isClass2FeatureEnabled('inputNames')) {
            knoepfe.push(el('button', {
                class: 'knopf',
                onclick: function () { eingangsnamenUebernehmen(); }
            }, [t('tech.applyInputNames')]));
        }

        if (knoepfe.length) kinder.push(el('div', { class: 'knopfzeile' }, knoepfe));

        const werte = [];

        if (class2Werte.details) {
            werte.push(werteZeile(t('tech.serialNumber'), class2Werte.details.serialNumber || t('common.unknown')));
            werte.push(werteZeile(t('tech.softwareVersion'), class2Werte.details.softwareVersion || t('common.unknown')));
        }

        if (class2Werte.aufloesung) {
            werte.push(werteZeile(t('tech.currentResolution'), aufloesungsText(class2Werte.aufloesung.input)));
            werte.push(werteZeile(t('tech.recommendedResolution'), aufloesungsText(class2Werte.aufloesung.recommended)));
        }

        if (class2Werte.wartung) {
            const w = class2Werte.wartung;
            werte.push(werteZeile(t('tech.filterHours'), w.filterHours === null ? t('common.unknown') : t('tech.hours', { count: w.filterHours })));
            werte.push(werteZeile(t('tech.replacementLamp'), w.lampModels.length ? w.lampModels.join(', ') : t('tech.noneSpecified')));
            werte.push(werteZeile(t('tech.replacementFilter'), w.filterModels.length ? w.filterModels.join(', ') : t('tech.noneSpecified')));
        }

        if (werte.length) kinder.push(el('div', { class: 'werte' }, werte));

        return el('div', { class: 'block' }, kinder);
    }

    // ---------- Darstellung ----------

    function darstellungsBlock() {
        const th = ctx.theme.getTheme();

        function wahl(wert, beschriftung) {
            return el('label', {}, [
                el('input', {
                    type: 'radio',
                    name: 'thema',
                    checked: th === wert,
                    onchange: function () { ctx.theme.setTheme(wert); neuZeichnen(); }
                }),
                beschriftung
            ]);
        }

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.appearanceHeading') }),
            el('div', { class: 'wahl' }, [
                wahl('system', t('tech.themeSystem')),
                wahl('light', t('tech.themeLight')),
                wahl('dark', t('tech.themeDark'))
            ]),
            el('div', { class: 'knopfzeile' }, [
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        checked: ctx.theme.getHighContrast(),
                        onchange: function (e) { ctx.theme.setHighContrast(e.target.checked); neuZeichnen(); }
                    }),
                    t('tech.highContrast')
                ])
            ])
        ]);
    }

    // ---------- Sprache ----------

    // Sprachnamen stehen absichtlich nicht in den Sprachdateien: „Deutsch"
    // heißt auf jedem Bildschirm „Deutsch", sonst findet es niemand wieder,
    // der die eingestellte Sprache gerade nicht lesen kann.
    const SPRACHNAMEN = { de: 'Deutsch', en: 'English' };

    function sprachBlock() {
        const gewaehlt = ctx.store.getLanguage();

        function wahl(wert, beschriftung) {
            return el('label', {}, [
                el('input', {
                    type: 'radio',
                    name: 'sprache',
                    checked: gewaehlt === wert,
                    onchange: function () { window.App.setLanguage(wert); }
                }),
                beschriftung
            ]);
        }

        const wahlen = [wahl(null, t('tech.languageSystem'))];
        window.App.i18n.supportedLanguages().forEach(function (code) {
            wahlen.push(wahl(code, SPRACHNAMEN[code] || code));
        });

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.languageHeading') }),
            el('div', { class: 'wahl' }, wahlen)
        ]);
    }

    // ---------- Protokoll ----------

    function protokollBlock() {
        const zeilen = ctx.log.all().map(function (e) {
            return el('div', { class: e.art }, ['[' + e.zeit + '] ' + e.text]);
        });

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.logHeading') }),
            el('div', { class: 'protokoll' }, zeilen.length ? zeilen : [el('div', { text: t('tech.logEmpty') })]),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf',
                    onclick: function () {
                        const text = ctx.log.all().map(function (e) { return '[' + e.zeit + '] ' + e.text; }).join('\n');
                        navigator.clipboard.writeText(text);
                        ctx.log.add('Protokoll kopiert', 'info');
                        neuZeichnen();
                    }
                }, [t('tech.copyLog')]),
                el('button', {
                    class: 'knopf',
                    onclick: async function () {
                        const ja = await ui.confirmDialog({
                            titel: t('tech.restartSetupConfirmTitle'),
                            text: t('tech.restartSetupConfirmText'),
                            bestaetigen: t('tech.restartSetupConfirmYes')
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
                }, [t('tech.restartSetup')])
            ])
        ]);
    }

    function render() {
        if (!wurzel) wurzel = document.getElementById('ansicht-tech');
        ui.clear(wurzel);
        wurzel.appendChild(el('div', { class: 'ansicht-innen' }, [
            el('button', { class: 'knopf text zurueck', text: t('tech.backToOperate'), onclick: function () { window.App.showView('operate'); } }),
            verbindungsBlock(),
            quellenBlock(),
            zusatzBlock(),
            darstellungsBlock(),
            sprachBlock(),
            protokollBlock()
        ]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        FEATURES: FEATURES
    };
})();
