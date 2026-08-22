// Winzige DOM-Helfer und der Bestätigungsdialog. Kein Zustand, keine Netzwerklogik.
window.App = window.App || {};
window.App.ui = (function () {
    const t = window.App.i18n.t;

    // el('div', {class:'x', onclick:fn}, ['Text', andererKnoten])
    function el(tag, attrs, kinder) {
        const knoten = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                const v = attrs[k];
                if (v === null || v === undefined || v === false) return;
                if (k.indexOf('on') === 0 && typeof v === 'function') {
                    knoten.addEventListener(k.slice(2), v);
                } else if (k === 'text') {
                    knoten.textContent = v;
                } else if (k === 'checked' || k === 'disabled' || k === 'draggable') {
                    knoten[k] = v;
                } else if (k === 'value') {
                    knoten.value = v;
                } else {
                    knoten.setAttribute(k, v);
                }
            });
        }
        (kinder || []).forEach(function (kind) {
            if (kind === null || kind === undefined || kind === false) return;
            knoten.appendChild(typeof kind === 'string' ? document.createTextNode(kind) : kind);
        });
        return knoten;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    // Eigener Dialog statt confirm(): passt zum Erscheinungsbild und blockiert nicht.
    function confirmDialog(opt) {
        return new Promise(function (resolve) {
            const schliessen = function (antwort) {
                document.body.removeChild(grund);
                document.removeEventListener('keydown', taste);
                resolve(antwort);
            };
            const taste = function (e) {
                if (e.key === 'Escape') schliessen(false);
                if (e.key === 'Enter') schliessen(true);
            };

            const box = el('div', { class: 'dialog' }, [
                el('h2', { text: opt.titel }),
                el('p', { text: opt.text }),
                el('div', { class: 'dialog-knoepfe' }, [
                    el('button', { class: 'knopf', text: opt.abbrechen || t('common.cancel'), onclick: function () { schliessen(false); } }),
                    el('button', { class: 'knopf haupt', text: opt.bestaetigen || t('common.yes'), onclick: function () { schliessen(true); } })
                ])
            ]);

            const grund = el('div', { class: 'dialog-grund', onclick: function (e) { if (e.target === grund) schliessen(false); } }, [box]);
            document.body.appendChild(grund);
            document.addEventListener('keydown', taste);
        });
    }

    return { el: el, clear: clear, confirmDialog: confirmDialog };
})();

// Protokoll: sammelt Meldungen für die Technik-Seite. Erscheint nie in der Bedienung.
window.App.log = (function () {
    const eintraege = [];
    let hoerer = [];

    return {
        add: function (text, art) {
            eintraege.push({
                zeit: new Date().toLocaleTimeString('de-DE'),
                text: text,
                art: art || 'info'
            });
            while (eintraege.length > 200) eintraege.shift();
            hoerer.forEach(function (fn) { fn(); });
        },
        all: function () { return eintraege.slice(); },
        onChange: function (fn) { hoerer.push(fn); }
    };
})();
