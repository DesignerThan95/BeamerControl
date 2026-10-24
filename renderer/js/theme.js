// Light / dark / operating system setting, and high contrast.
// Sets data-theme and data-contrast on the <html> element; the colours live in tokens.css.
window.App = window.App || {};
window.App.theme = (function () {

    function createTheme(store) {
        const root = document.documentElement;
        let unsubscribe = null;

        function apply() {
            const a = store.get().appearance;

            if (a.theme === 'system') {
                root.removeAttribute('data-theme');
            } else {
                root.setAttribute('data-theme', a.theme);
            }

            if (a.highContrast) {
                root.setAttribute('data-contrast', 'high');
            } else {
                root.removeAttribute('data-contrast');
            }
        }

        // In "system" mode the app has to follow along when Windows switches
        // over in the evening. prefers-color-scheme in tokens.css does that on
        // its own; the listener only exists to redraw the view afterwards.
        function watchSystem(onChange) {
            if (unsubscribe) { unsubscribe(); unsubscribe = null; }
            unsubscribe = window.App.api.onOsThemeChange(function () {
                if (store.get().appearance.theme === 'system' && onChange) onChange();
            });
        }

        return {
            init: function (onChange) {
                apply();
                watchSystem(onChange);
            },

            setTheme: function (value) {
                store.setAppearance(Object.assign({}, store.get().appearance, { theme: value }));
                apply();
                store.save();
            },

            setHighContrast: function (on) {
                store.setAppearance(Object.assign({}, store.get().appearance, { highContrast: on === true }));
                apply();
                store.save();
            },

            getTheme: function () { return store.get().appearance.theme; },
            getHighContrast: function () { return store.get().appearance.highContrast; },

            // The button in the header switches doggedly between light and dark.
            // Coming out of "system" it picks the opposite of what is on screen.
            toggleAsync: async function () {
                const current = store.get().appearance.theme;
                let next;
                if (current === 'dark') {
                    next = 'light';
                } else if (current === 'light') {
                    next = 'dark';
                } else {
                    const osTheme = await window.App.api.getOsTheme();
                    next = osTheme === 'dark' ? 'light' : 'dark';
                }
                this.setTheme(next);
                return next;
            }
        };
    }

    return { createTheme: createTheme };
})();
