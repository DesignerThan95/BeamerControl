// Hell / Dunkel / Systemeinstellung und hoher Kontrast.
// Setzt data-theme und data-contrast am <html>-Element; die Farben stehen in tokens.css.
window.App = window.App || {};
window.App.theme = (function () {

    function createTheme(store) {
        const wurzel = document.documentElement;
        let abmelden = null;

        function anwenden() {
            const a = store.get().appearance;

            if (a.theme === 'system') {
                wurzel.removeAttribute('data-theme');
            } else {
                wurzel.setAttribute('data-theme', a.theme);
            }

            if (a.highContrast) {
                wurzel.setAttribute('data-contrast', 'high');
            } else {
                wurzel.removeAttribute('data-contrast');
            }
        }

        // Im Modus "system" muss die App mitlaufen, wenn Windows abends umschaltet.
        // prefers-color-scheme in tokens.css erledigt das von allein; der Hörer
        // dient nur dazu, die Ansicht danach neu zu zeichnen.
        function systemBeobachten(beiWechsel) {
            if (abmelden) { abmelden(); abmelden = null; }
            abmelden = window.App.api.onOsThemeChange(function () {
                if (store.get().appearance.theme === 'system' && beiWechsel) beiWechsel();
            });
        }

        return {
            init: function (beiWechsel) {
                anwenden();
                systemBeobachten(beiWechsel);
            },

            setTheme: function (wert) {
                store.setAppearance(Object.assign({}, store.get().appearance, { theme: wert }));
                anwenden();
                store.save();
            },

            setHighContrast: function (an) {
                store.setAppearance(Object.assign({}, store.get().appearance, { highContrast: an === true }));
                anwenden();
                store.save();
            },

            getTheme: function () { return store.get().appearance.theme; },
            getHighContrast: function () { return store.get().appearance.highContrast; },

            // Der Knopf in der Kopfzeile schaltet stur zwischen hell und dunkel.
            // Aus "system" heraus wird das Gegenteil dessen gewählt, was gerade zu sehen ist.
            toggleAsync: async function () {
                const jetzt = store.get().appearance.theme;
                let neu;
                if (jetzt === 'dark') {
                    neu = 'light';
                } else if (jetzt === 'light') {
                    neu = 'dark';
                } else {
                    const os = await window.App.api.getOsTheme();
                    neu = os === 'dark' ? 'light' : 'dark';
                }
                this.setTheme(neu);
                return neu;
            }
        };
    }

    return { createTheme: createTheme };
})();
