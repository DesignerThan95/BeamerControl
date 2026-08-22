// Technical page: one continuous page with connection, picture sources,
// appearance, language and the activity log. Only reachable through the gear icon.
//
// The CSS class names stay German: they belong to app.css, which is not part
// of this translation pass.
window.App = window.App || {};
window.App.viewTech = (function () {
    const ui = window.App.ui;
    const el = ui.el;
    const t = window.App.i18n.t;

    let ctx = null;
    let root = null;

    // Extra features from PJLink Class 2. The keys must match CLASS2_FEATURES
    // in store.js; which PJLink commands are behind them is documented in
    // main.js. Title and description live in the language files under
    // tech.features.<key>.
    const FEATURES = [
        { key: 'volume' },
        { key: 'freeze' },
        { key: 'deviceDetails' },
        { key: 'inputNames' },
        { key: 'resolution' },
        { key: 'maintenance' }
    ];

    function featureTitle(key) {
        return t('tech.features.' + key + '.title');
    }

    // The activity log's severities are also the CSS classes it is rendered
    // with. app.css keeps its German names, so the mapping happens here.
    const LOG_CSS_CLASS = { ok: 'ok', info: 'info', error: 'fehler' };

    // For this view only: results and progress of the network scan.
    let scan = { running: false, checked: 0, total: 0, devices: [] };
    let connectionMessage = '';
    let connectionLevel = 'info';
    // Class 2 values that were fetched. They are not saved and do not refresh
    // by themselves — they are here because someone asked for them.
    let class2Values = { details: null, resolution: null, maintenance: null };
    let class2Loading = false;

    function redraw() { render(); }

    // ---------- Connection ----------

    function connectionBlock() {
        const c = ctx.store.get().connection;

        const hostField = el('input', { class: 'eingabe', value: c.host, type: 'text', placeholder: t('common.hostPlaceholder') });
        const portField = el('input', { class: 'eingabe', value: String(c.port), type: 'number' });
        const passwordField = el('input', { class: 'eingabe', value: c.password || '', type: 'password', placeholder: t('common.passwordPlaceholder') });

        function applyFields() {
            ctx.store.setConnection({
                host: hostField.value.trim(),
                port: parseInt(portField.value, 10) || 4352,
                password: passwordField.value.trim() || null
            });
            return ctx.store.save();
        }

        const testButton = el('button', {
            class: 'knopf haupt',
            onclick: async function () {
                await applyFields();
                const n = ctx.store.get().connection;
                connectionMessage = t('common.connecting');
                connectionLevel = 'info';
                redraw();
                try {
                    await ctx.api.connect({ host: n.host, port: n.port, password: n.password });
                    const info = await ctx.api.getDeviceInfo();
                    connectionMessage = t('tech.connectedWith', { manufacturer: info.manufacturer, model: info.model });
                    connectionLevel = 'ok';
                    ctx.log.add('Connection checked: ' + n.host, 'ok');
                    ctx.projector.start();
                    ctx.projector.refreshNow();
                } catch (e) {
                    connectionMessage = t('common.connectionFailed', { message: e.message });
                    connectionLevel = 'error';
                    ctx.log.add('Connection failed: ' + e.message, 'error');
                }
                redraw();
            }
        }, [t('tech.testConnection')]);

        const scanButton = el('button', {
            class: 'knopf',
            disabled: scan.running,
            onclick: function () { startScan(); }
        }, [scan.running ? t('common.scanRunning') : t('tech.scanNetwork')]);

        const children = [
            el('div', { class: 'block-titel', text: t('tech.connectionHeading') }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.ipAddress') }), hostField]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.port') }), portField]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('tech.passwordLabel') }), passwordField])
            ]),
            el('div', { class: 'knopfzeile' }, [
                testButton,
                scanButton,
                connectionMessage ? el('span', { class: 'verbindungsstand' }, [
                    el('span', { class: 'punkt' + (connectionLevel === 'ok' ? ' an' : '') }),
                    connectionMessage
                ]) : null
            ]),
            el('p', { class: 'hinweis', text: t('tech.standbyHint') })
        ];

        if (scan.running) {
            const percent = scan.total ? Math.round((scan.checked / scan.total) * 100) : 0;
            const bar = el('div', { class: 'balken' }, [el('i')]);
            bar.firstChild.style.width = percent + '%';
            children.push(bar, el('div', {
                class: 'feld-lab',
                text: t('common.scanProgress', { checked: scan.checked, total: scan.total, found: scan.devices.length })
            }));
        }

        if (scan.devices.length > 0) {
            children.push(el('div', { class: 'trefferliste' }, scan.devices.map(function (d) {
                return el('div', { class: 'treffer' }, [
                    el('span', { class: 'treffer-host', text: d.host }),
                    el('button', {
                        class: 'knopf text',
                        text: t('tech.useDevice', { name: d.name || t('common.pjlinkDevice') }),
                        onclick: function () {
                            ctx.store.setConnection({ host: d.host, port: d.port, password: ctx.store.get().connection.password });
                            ctx.store.save();
                            redraw();
                        }
                    })
                ]);
            })));
        }

        return el('div', { class: 'block' }, children);
    }

    async function startScan() {
        scan = { running: true, checked: 0, total: 0, devices: [] };
        redraw();
        ctx.log.add('Network scan started', 'info');

        const unsubscribe = ctx.api.onScanProgress(function (p) {
            scan.checked = p.checked;
            scan.total = p.total;
            scan.devices = p.devices;
            redraw();
        });

        try {
            const result = await ctx.api.scanNetwork();
            scan.devices = result.devices;
            ctx.log.add(result.devices.length + ' device(s) found', result.devices.length ? 'ok' : 'info');
        } catch (e) {
            ctx.log.add('Network scan failed: ' + e.message, 'error');
        } finally {
            unsubscribe();
            scan.running = false;
            redraw();
        }
    }

    // ---------- Picture sources ----------

    function sourcesBlock() {
        const sources = ctx.store.get().sources;

        const rows = sources.map(function (q, i) {
            const row = el('div', { class: 'quellzeile', draggable: true }, [
                el('span', { class: 'griff', text: '⠿' }),
                el('span', { class: 'quellcode', text: q.code + ' · ' + window.App.viewOperate.connectorName(q.code) }),
                el('input', {
                    class: 'eingabe',
                    value: q.label,
                    onchange: function (e) {
                        const next = ctx.store.get().sources.slice();
                        next[i] = Object.assign({}, next[i], { label: e.target.value });
                        ctx.store.setSources(next);
                        ctx.store.save();
                    }
                }),
                el('span', { class: 'haken' }, [
                    el('input', {
                        type: 'checkbox',
                        checked: q.visible,
                        onchange: function (e) {
                            const next = ctx.store.get().sources.slice();
                            next[i] = Object.assign({}, next[i], { visible: e.target.checked });
                            ctx.store.setSources(next);
                            ctx.store.save();
                        }
                    })
                ])
            ]);

            row.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', String(i));
                row.classList.add('zieht');
            });
            row.addEventListener('dragend', function () { row.classList.remove('zieht'); });
            row.addEventListener('dragover', function (e) { e.preventDefault(); });
            row.addEventListener('drop', function (e) {
                e.preventDefault();
                const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
                if (Number.isNaN(from) || from === i) return;
                const next = ctx.store.get().sources.slice();
                const moved = next.splice(from, 1)[0];
                next.splice(i, 0, moved);
                ctx.store.setSources(next);
                ctx.store.save();
                redraw();
            });

            return row;
        });

        const reloadButton = el('button', {
            class: 'knopf',
            onclick: async function () {
                try {
                    const result = await ctx.api.getAvailableInputs();
                    const existing = ctx.store.get().sources;
                    // Keep the names we know, add new inputs with a suggestion.
                    const merged = result.inputs.map(function (i) {
                        const known = existing.find(function (v) { return v.code === i.code; });
                        return known || { code: i.code, label: window.App.viewOperate.connectorName(i.code), visible: true };
                    });
                    ctx.store.setSources(merged);
                    await ctx.store.save();
                    ctx.log.add(result.inputs.length + ' inputs read from the projector', 'ok');
                } catch (e) {
                    ctx.log.add('Inputs could not be read: ' + e.message, 'error');
                }
                redraw();
            }
        }, [t('tech.reloadInputs')]);

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.sourcesHeading') }),
            sources.length > 0 ? el('div', { class: 'quellzeile kopf' }, [
                el('span'),
                el('span', { text: t('tech.sourceInputColumn') }),
                el('span', { text: t('tech.sourceLabelColumn') }),
                el('span', { class: 'haken', text: t('tech.sourceVisibleColumn') })
            ]) : null
        ].concat(rows).concat([
            sources.length === 0 ? el('p', { class: 'assistent-text', text: t('tech.noInputsYet') }) : null,
            el('div', { class: 'knopfzeile' }, [reloadButton])
        ]));
    }

    // ---------- Extra features (PJLink Class 2) ----------

    function resolutionText(a) {
        if (!a) return t('common.unknown');
        if (a.code === '-') return t('tech.noSignal');
        if (a.code === '*') return t('tech.signalNotRecognized');
        return a.code;
    }

    function valueRow(name, value) {
        return el('div', { class: 'wertzeile' }, [
            el('span', { class: 'feld-lab', text: name }),
            el('span', { text: value })
        ]);
    }

    // Fetches exactly the values that are enabled. On demand, not by itself:
    // every query goes to the projector as a command of its own.
    async function fetchClass2Values() {
        class2Loading = true;
        redraw();

        const fetchInto = async function (key, fn, slot) {
            if (!ctx.store.isClass2FeatureEnabled(key)) return;
            try {
                class2Values[slot] = await window.App.class2(key, fn);
            } catch (e) {
                class2Values[slot] = null;
                ctx.log.add('Query failed (' + key + '): ' + e.message, 'error');
            }
        };

        await fetchInto('deviceDetails', function () { return ctx.api.getDeviceDetails(); }, 'details');
        await fetchInto('resolution', function () { return ctx.api.getResolutions(); }, 'resolution');
        await fetchInto('maintenance', function () { return ctx.api.getMaintenance(); }, 'maintenance');

        class2Loading = false;
        redraw();
    }

    // Takes the names stored in the projector as labels for the picture
    // sources. Existing names of our own are overwritten in the process —
    // which is why this sits behind a confirmation.
    async function applyInputNames() {
        const sources = ctx.store.get().sources;
        if (sources.length === 0) {
            ctx.log.add('No picture sources set up — read the inputs first', 'info');
            return;
        }

        const confirmed = await ui.confirmDialog({
            title: t('tech.applyInputNamesConfirmTitle'),
            text: t('tech.applyInputNamesConfirmText'),
            confirm: t('tech.applyInputNamesConfirmYes')
        });
        if (!confirmed) return;

        const next = sources.slice();
        let applied = 0;

        for (let i = 0; i < next.length; i++) {
            try {
                const name = await window.App.class2('inputNames', function () {
                    return ctx.api.getInputName(next[i].code);
                });
                if (name) {
                    next[i] = Object.assign({}, next[i], { label: name });
                    applied++;
                }
            } catch (e) {
                ctx.log.add('Name for input ' + next[i].code + ' not readable: ' + e.message, 'error');
                break; // If the projector does not know the command, further tries are pointless.
            }
        }

        ctx.store.setSources(next);
        await ctx.store.save();
        ctx.log.add(applied + ' input name(s) taken from the projector', applied ? 'ok' : 'info');
        redraw();
    }

    function class2Block() {
        const state = ctx.projector.getState();
        const projectorClass = state.pjlinkClass;
        const classSource = state.pjlinkClassSource;

        const children = [el('div', { class: 'block-titel', text: t('tech.class2Heading') })];

        // As long as no connection has been made, what the device can do is
        // unknown. Offering nothing at all here is more honest than checkboxes
        // that might lead nowhere.
        if (projectorClass === null) {
            children.push(el('p', { class: 'hinweis', text: t('tech.class2Unknown') }));
            return el('div', { class: 'block' }, children);
        }

        if (projectorClass !== 2) {
            // Two very different reasons lead here. They must not sound the
            // same: one is information from the device, the other only a
            // precautionary assumption by the app.
            if (classSource === 'reported') {
                children.push(el('p', { class: 'hinweis', text: t('tech.class1Reported') }));
            } else {
                children.push(el('p', { class: 'hinweis', text: t('tech.class1Assumed') }));
            }
            return el('div', { class: 'block' }, children);
        }

        children.push(el('p', { class: 'hinweis', text: t('tech.class2Available') }));

        children.push(el('div', { class: 'funktionsliste' }, FEATURES.map(function (f) {
            const enabled = ctx.store.isClass2FeatureEnabled(f.key);

            return el('label', { class: 'funktion' }, [
                el('input', {
                    type: 'checkbox',
                    checked: enabled,
                    onchange: async function (e) {
                        const next = ctx.store.get().enabledClass2Features.filter(function (k) { return k !== f.key; });
                        if (e.target.checked) next.push(f.key);
                        ctx.store.setClass2Features(next);
                        await ctx.store.save();
                        ctx.log.add(f.key + (e.target.checked ? ' switched on' : ' switched off'), 'info');
                        redraw();
                    }
                }),
                el('span', {}, [
                    el('span', { class: 'funktion-titel', text: featureTitle(f.key) }),
                    el('span', { class: 'funktion-text', text: t('tech.features.' + f.key + '.description') })
                ])
            ]);
        })));

        // The button for the input names belongs to the picture sources and is
        // therefore only shown when that feature is switched on.
        const buttons = [];
        const showsValues = ['deviceDetails', 'resolution', 'maintenance'].some(function (k) {
            return ctx.store.isClass2FeatureEnabled(k);
        });

        if (showsValues) {
            buttons.push(el('button', {
                class: 'knopf',
                disabled: class2Loading,
                onclick: function () { fetchClass2Values(); }
            }, [class2Loading ? t('tech.querying') : t('tech.fetchValues')]));
        }

        if (ctx.store.isClass2FeatureEnabled('inputNames')) {
            buttons.push(el('button', {
                class: 'knopf',
                onclick: function () { applyInputNames(); }
            }, [t('tech.applyInputNames')]));
        }

        if (buttons.length) children.push(el('div', { class: 'knopfzeile' }, buttons));

        const values = [];

        if (class2Values.details) {
            values.push(valueRow(t('tech.serialNumber'), class2Values.details.serialNumber || t('common.unknown')));
            values.push(valueRow(t('tech.softwareVersion'), class2Values.details.softwareVersion || t('common.unknown')));
        }

        if (class2Values.resolution) {
            values.push(valueRow(t('tech.currentResolution'), resolutionText(class2Values.resolution.input)));
            values.push(valueRow(t('tech.recommendedResolution'), resolutionText(class2Values.resolution.recommended)));
        }

        if (class2Values.maintenance) {
            const m = class2Values.maintenance;
            values.push(valueRow(t('tech.filterHours'), m.filterHours === null ? t('common.unknown') : t('tech.hours', { count: m.filterHours })));
            values.push(valueRow(t('tech.replacementLamp'), m.lampModels.length ? m.lampModels.join(', ') : t('tech.noneSpecified')));
            values.push(valueRow(t('tech.replacementFilter'), m.filterModels.length ? m.filterModels.join(', ') : t('tech.noneSpecified')));
        }

        if (values.length) children.push(el('div', { class: 'werte' }, values));

        return el('div', { class: 'block' }, children);
    }

    // ---------- Appearance ----------

    function appearanceBlock() {
        const current = ctx.theme.getTheme();

        function choice(value, label) {
            return el('label', {}, [
                el('input', {
                    type: 'radio',
                    name: 'thema',
                    checked: current === value,
                    onchange: function () { ctx.theme.setTheme(value); redraw(); }
                }),
                label
            ]);
        }

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.appearanceHeading') }),
            el('div', { class: 'wahl' }, [
                choice('system', t('tech.themeSystem')),
                choice('light', t('tech.themeLight')),
                choice('dark', t('tech.themeDark'))
            ]),
            el('div', { class: 'knopfzeile' }, [
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        checked: ctx.theme.getHighContrast(),
                        onchange: function (e) { ctx.theme.setHighContrast(e.target.checked); redraw(); }
                    }),
                    t('tech.highContrast')
                ])
            ])
        ]);
    }

    // ---------- Language ----------

    // Language names deliberately do not live in the language files: "Deutsch"
    // reads "Deutsch" on every screen, otherwise nobody who cannot read the
    // current language would find their way back.
    const LANGUAGE_NAMES = { de: 'Deutsch', en: 'English' };

    function languageBlock() {
        const chosen = ctx.store.getLanguage();

        function choice(value, label) {
            return el('label', {}, [
                el('input', {
                    type: 'radio',
                    name: 'sprache',
                    checked: chosen === value,
                    onchange: function () { window.App.setLanguage(value); }
                }),
                label
            ]);
        }

        const choices = [choice(null, t('tech.languageSystem'))];
        window.App.i18n.supportedLanguages().forEach(function (code) {
            choices.push(choice(code, LANGUAGE_NAMES[code] || code));
        });

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.languageHeading') }),
            el('div', { class: 'wahl' }, choices)
        ]);
    }

    // ---------- Activity log ----------

    function logBlock() {
        const rows = ctx.log.all().map(function (e) {
            return el('div', { class: LOG_CSS_CLASS[e.level] || 'info' }, ['[' + e.time + '] ' + e.text]);
        });

        return el('div', { class: 'block' }, [
            el('div', { class: 'block-titel', text: t('tech.logHeading') }),
            el('div', { class: 'protokoll' }, rows.length ? rows : [el('div', { text: t('tech.logEmpty') })]),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf',
                    onclick: function () {
                        const text = ctx.log.all().map(function (e) { return '[' + e.time + '] ' + e.text; }).join('\n');
                        navigator.clipboard.writeText(text);
                        ctx.log.add('Activity log copied', 'info');
                        redraw();
                    }
                }, [t('tech.copyLog')]),
                el('button', {
                    class: 'knopf',
                    onclick: async function () {
                        const confirmed = await ui.confirmDialog({
                            title: t('tech.restartSetupConfirmTitle'),
                            text: t('tech.restartSetupConfirmText'),
                            confirm: t('tech.restartSetupConfirmYes')
                        });
                        if (!confirmed) return;
                        ctx.projector.stop();
                        ctx.store.setConnection({ host: '', port: 4352, password: null });
                        ctx.store.setSources([]);
                        ctx.store.resetSetup();
                        await ctx.store.save();
                        window.App.viewSetup.restart();
                        window.App.showView('setup');
                    }
                }, [t('tech.restartSetup')])
            ])
        ]);
    }

    function render() {
        if (!root) root = document.getElementById('ansicht-tech');
        ui.clear(root);
        root.appendChild(el('div', { class: 'ansicht-innen' }, [
            el('button', { class: 'knopf text zurueck', text: t('tech.backToOperate'), onclick: function () { window.App.showView('operate'); } }),
            connectionBlock(),
            sourcesBlock(),
            class2Block(),
            appearanceBlock(),
            languageBlock(),
            logBlock()
        ]));
    }

    return {
        init: function (c) { ctx = c; },
        render: render,
        FEATURES: FEATURES
    };
})();
