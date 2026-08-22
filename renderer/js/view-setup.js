// Setup wizard. Runs once, when there are no valid settings.
//
// The CSS class names stay German: they belong to app.css, which is not part
// of this translation pass.
window.App = window.App || {};
window.App.viewSetup = (function () {
    const ui = window.App.ui;
    const el = ui.el;
    const t = window.App.i18n.t;

    // As on the technical page: language names stay untranslated, otherwise
    // nobody who cannot read the current language would find their way back.
    const LANGUAGE_NAMES = { de: 'Deutsch', en: 'English' };

    let ctx = null;
    let root = null;

    let step = 1;
    let scan = { running: false, checked: 0, total: 0, devices: [], done: false };
    let selection = null;    // { host, port, name }
    let password = '';
    let checkMessage = '';
    let checkLevel = 'info';
    let draftSources = [];   // picture sources being built up

    function redraw() { render(); }

    // The language choice sits in the step bar and is therefore on every step:
    // anyone facing the setup in the wrong language should be able to change it
    // straight away, not only at the end.
    function languageChoice() {
        const chosen = ctx.store.getLanguage();

        return el('span', { class: 'sprachwahl' }, window.App.i18n.supportedLanguages().map(function (code) {
            return el('button', {
                class: 'knopf text' + (chosen === code ? ' aktiv' : ''),
                text: LANGUAGE_NAMES[code] || code,
                onclick: function () { window.App.setLanguage(code); }
            });
        }));
    }

    function stepBar() {
        const dots = [1, 2, 3, 4].map(function (n) {
            let cssClass = 'schritt';
            if (n < step) cssClass = 'schritt fertig';
            else if (n === step) cssClass = 'schritt jetzt';
            return el('span', { class: cssClass, text: n < step ? '✓' : String(n) });
        });
        return el('div', { class: 'schritte' }, dots.concat([
            el('span', { class: 'feld-lab', text: t('setup.wizardLabel') }),
            languageChoice()
        ]));
    }

    // ---------- Step 1: find ----------

    async function startScan() {
        scan = { running: true, checked: 0, total: 0, devices: [], done: false };
        redraw();

        const unsubscribe = ctx.api.onScanProgress(function (p) {
            scan.checked = p.checked;
            scan.total = p.total;
            scan.devices = p.devices;
            redraw();
        });

        try {
            const result = await ctx.api.scanNetwork();
            scan.devices = result.devices;
            ctx.log.add('Setup: ' + result.devices.length + ' device(s) found', 'info');
        } catch (e) {
            ctx.log.add('Setup: scan failed — ' + e.message, 'error');
        } finally {
            unsubscribe();
            scan.running = false;
            scan.done = true;
            redraw();
        }
    }

    function enterManually() {
        selection = { host: '', port: 4352, name: null };
        step = 2;
        checkMessage = '';
        redraw();
    }

    function resultList() {
        if (scan.devices.length === 0) return null;
        return el('div', { class: 'trefferliste' }, scan.devices.map(function (d) {
            return el('div', { class: 'treffer' }, [
                el('span', {}, [
                    el('strong', { text: d.name || t('common.pjlinkDevice') }),
                    el('span', { class: 'treffer-host', text: '   ' + d.host })
                ]),
                el('button', {
                    class: 'knopf text',
                    text: t('setup.select'),
                    onclick: function () { selection = d; step = 2; checkMessage = ''; redraw(); }
                })
            ]);
        }));
    }

    function step1() {
        if (scan.running) {
            const percent = scan.total ? Math.round((scan.checked / scan.total) * 100) : 0;
            const bar = el('div', { class: 'balken' }, [el('i')]);
            bar.firstChild.style.width = percent + '%';

            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: t('common.scanRunning') }),
                el('div', { class: 'assistent-text', text: t('setup.scanDuration') }),
                bar,
                el('div', {
                    class: 'feld-lab',
                    text: t('common.scanProgress', { checked: scan.checked, total: scan.total, found: scan.devices.length })
                }),
                resultList()
            ]);
        }

        if (scan.done && scan.devices.length === 0) {
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
                    el('button', { class: 'knopf haupt', onclick: startScan }, [t('common.searchAgain')]),
                    el('button', { class: 'knopf text', onclick: enterManually }, [t('common.enterIpManually')])
                ])
            ]);
        }

        if (scan.done) {
            return el('div', {}, [
                el('div', {
                    class: 'assistent-titel',
                    text: scan.devices.length === 1
                        ? t('setup.foundOne')
                        : t('setup.foundMany', { count: scan.devices.length })
                }),
                el('div', { class: 'assistent-text', text: t('setup.chooseDevice') }),
                resultList(),
                el('div', { class: 'knopfzeile' }, [
                    el('button', { class: 'knopf', onclick: startScan }, [t('common.searchAgain')]),
                    el('button', { class: 'knopf text', onclick: enterManually }, [t('common.enterIpManually')])
                ])
            ]);
        }

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: t('setup.whereTitle') }),
            el('div', { class: 'assistent-text', text: t('setup.whereText') }),
            el('div', { class: 'knopfzeile' }, [
                el('button', { class: 'knopf haupt', onclick: startScan }, [t('setup.searchProjectors')])
            ]),
            el('button', { class: 'knopf text', onclick: enterManually }, [t('setup.enterIpInstead')])
        ]);
    }

    // ---------- Step 2: check ----------

    async function loadInputs() {
        try {
            const result = await ctx.api.getAvailableInputs();
            draftSources = result.inputs.map(function (i) {
                return { code: i.code, label: window.App.viewOperate.connectorName(i.code), visible: true };
            });
            ctx.log.add('Setup: ' + draftSources.length + ' inputs read', 'ok');
        } catch (e) {
            draftSources = [];
            ctx.log.add('Setup: inputs not readable — ' + e.message, 'error');
        }
    }

    function step2() {
        const hostField = el('input', { class: 'eingabe', value: selection.host, type: 'text', placeholder: t('common.hostPlaceholder') });
        const passwordField = el('input', { class: 'eingabe', value: password, type: 'password', placeholder: t('common.passwordPlaceholder') });

        return el('div', {}, [
            el('div', {
                class: 'assistent-titel',
                text: selection.name ? t('setup.deviceFound', { name: selection.name }) : t('setup.enterIpTitle')
            }),
            el('div', { class: 'assistent-text', text: t('setup.passwordHint') }),
            el('div', { class: 'felder' }, [
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.ipAddress') }), hostField]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.port') }), el('input', { class: 'eingabe', value: String(selection.port || 4352), type: 'number', disabled: true })]),
                el('div', {}, [el('div', { class: 'feld-lab', text: t('common.password') }), passwordField])
            ]),
            checkMessage ? el('div', { class: 'knopfzeile' }, [
                el('span', { class: 'verbindungsstand' }, [el('span', { class: 'punkt' + (checkLevel === 'ok' ? ' an' : '') }), checkMessage])
            ]) : null,
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf haupt',
                    onclick: async function () {
                        selection.host = hostField.value.trim();
                        password = passwordField.value.trim();
                        if (!selection.host) {
                            checkMessage = t('setup.ipRequired');
                            checkLevel = 'error';
                            redraw();
                            return;
                        }
                        checkMessage = t('common.connecting');
                        checkLevel = 'info';
                        redraw();
                        try {
                            await ctx.api.connect({ host: selection.host, port: selection.port || 4352, password: password || null });
                            ctx.store.setConnection({ host: selection.host, port: selection.port || 4352, password: password || null });
                            await ctx.store.save();
                            await loadInputs();
                            step = 3;
                        } catch (e) {
                            checkMessage = t('common.connectionFailed', { message: e.message });
                            checkLevel = 'error';
                        }
                        redraw();
                    }
                }, [t('common.next')]),
                el('button', { class: 'knopf', onclick: function () { step = 1; checkMessage = ''; redraw(); } }, [t('setup.backToSearch')])
            ])
        ]);
    }

    // ---------- Step 3: name ----------

    async function applySources() {
        ctx.store.setSources(draftSources);
        await ctx.store.save();
        step = 4;
        redraw();
    }

    function step3() {
        const nextButton = el('button', { class: 'knopf haupt', onclick: applySources }, [t('common.next')]);

        if (draftSources.length === 0) {
            return el('div', {}, [
                el('div', { class: 'assistent-titel', text: t('setup.noInputsTitle') }),
                el('div', { class: 'assistent-text', text: t('setup.noInputsText') }),
                el('div', { class: 'knopfzeile' }, [nextButton])
            ]);
        }

        const rows = draftSources.map(function (q, i) {
            return el('div', { class: 'quellzeile' }, [
                el('span'),
                el('span', { class: 'quellcode', text: q.code + ' · ' + window.App.viewOperate.connectorName(q.code) }),
                el('input', {
                    class: 'eingabe',
                    value: q.label,
                    onchange: function (e) { draftSources[i].label = e.target.value; }
                }),
                el('span', { class: 'haken' }, [
                    el('input', {
                        type: 'checkbox',
                        checked: q.visible,
                        onchange: function (e) { draftSources[i].visible = e.target.checked; }
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
        ].concat(rows).concat([
            el('div', { class: 'knopfzeile' }, [nextButton])
        ]));
    }

    // ---------- Step 4: done ----------

    function step4() {
        const visible = ctx.store.get().sources.filter(function (s) { return s.visible; });
        const sourceText = visible.length
            ? t('setup.doneSourceCount', { count: visible.length })
            : t('setup.doneNoSources');

        return el('div', {}, [
            el('div', { class: 'assistent-titel', text: t('setup.doneTitle') }),
            el('div', { class: 'assistent-text', text: t('setup.doneText', { sources: sourceText }) }),
            el('div', { class: 'knopfzeile' }, [
                el('button', {
                    class: 'knopf haupt',
                    onclick: async function () {
                        ctx.store.markSetupComplete();
                        await ctx.store.save();
                        ctx.projector.start();
                        ctx.projector.refreshNow();
                        window.App.showView('operate');
                    }
                }, [t('setup.toOperate')])
            ])
        ]);
    }

    function render() {
        if (!root) root = document.getElementById('ansicht-setup');
        ui.clear(root);
        let content;
        if (step === 1) content = step1();
        else if (step === 2) content = step2();
        else if (step === 3) content = step3();
        else content = step4();
        root.appendChild(el('div', { class: 'ansicht-innen' }, [stepBar(), content]));
    }

    return {
        init: function (c) {
            ctx = c;
            // If the connection was already saved but the setup was not
            // finished, it carries on at the checking step instead of the search.
            const connection = ctx.store.get().connection;
            if (connection.host) {
                selection = { host: connection.host, port: connection.port, name: null };
                password = connection.password || '';
                step = 2;
            }
        },

        // Called by the technical page when someone wants to set up again.
        restart: function () {
            step = 1;
            scan = { running: false, checked: 0, total: 0, devices: [], done: false };
            selection = null;
            password = '';
            checkMessage = '';
            draftSources = [];
        },

        render: render
    };
})();
