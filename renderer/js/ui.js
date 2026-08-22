// Tiny DOM helpers and the confirmation dialog. No state, no network logic.
window.App = window.App || {};
window.App.ui = (function () {
    const t = window.App.i18n.t;

    // el('div', {class:'x', onclick:fn}, ['Text', otherNode])
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                const v = attrs[k];
                if (v === null || v === undefined || v === false) return;
                if (k.indexOf('on') === 0 && typeof v === 'function') {
                    node.addEventListener(k.slice(2), v);
                } else if (k === 'text') {
                    node.textContent = v;
                } else if (k === 'checked' || k === 'disabled' || k === 'draggable') {
                    node[k] = v;
                } else if (k === 'value') {
                    node.value = v;
                } else {
                    node.setAttribute(k, v);
                }
            });
        }
        (children || []).forEach(function (child) {
            if (child === null || child === undefined || child === false) return;
            node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    // Our own dialog instead of confirm(): it matches the look and does not block.
    function confirmDialog(opt) {
        return new Promise(function (resolve) {
            const close = function (answer) {
                document.body.removeChild(backdrop);
                document.removeEventListener('keydown', onKey);
                resolve(answer);
            };
            const onKey = function (e) {
                if (e.key === 'Escape') close(false);
                if (e.key === 'Enter') close(true);
            };

            const box = el('div', { class: 'dialog' }, [
                el('h2', { text: opt.title }),
                el('p', { text: opt.text }),
                el('div', { class: 'dialog-knoepfe' }, [
                    el('button', { class: 'knopf', text: opt.cancel || t('common.cancel'), onclick: function () { close(false); } }),
                    el('button', { class: 'knopf haupt', text: opt.confirm || t('common.yes'), onclick: function () { close(true); } })
                ])
            ]);

            const backdrop = el('div', { class: 'dialog-grund', onclick: function (e) { if (e.target === backdrop) close(false); } }, [box]);
            document.body.appendChild(backdrop);
            document.addEventListener('keydown', onKey);
        });
    }

    // The language picker, used on the technical page and in the setup wizard.
    // First entry is the operating system, then the shipped languages sorted by
    // the name each one calls itself. Nothing here knows the store: the caller
    // passes in the current choice and gets the new one back, where null means
    // "no choice of my own, follow the operating system".
    function languageSelect(opt) {
        const i18n = window.App.i18n;

        const options = [el('option', { value: '', text: t('tech.languageSystem') })];
        i18n.languagesByName().forEach(function (code) {
            options.push(el('option', { value: code, text: i18n.languageName(code) }));
        });

        const select = el('select', {
            class: 'eingabe auswahl',
            onchange: function (e) { opt.onChange(e.target.value || null); }
        }, options);

        select.value = opt.chosen || '';
        return select;
    }

    return { el: el, clear: clear, confirmDialog: confirmDialog, languageSelect: languageSelect };
})();

// Activity log: collects messages for the technical page. Never appears in the
// controls, and stays English — it is written for whoever maintains the
// installation, not for the congregation.
window.App.log = (function () {
    const entries = [];
    let listeners = [];

    return {
        // level is 'ok', 'info' or 'error'.
        add: function (text, level) {
            entries.push({
                // 'de-DE' is picked for its 24-hour clock, not for its language.
                time: new Date().toLocaleTimeString('de-DE'),
                text: text,
                level: level || 'info'
            });
            while (entries.length > 200) entries.shift();
            listeners.forEach(function (fn) { fn(); });
        },
        all: function () { return entries.slice(); },
        onChange: function (fn) { listeners.push(fn); }
    };
})();
