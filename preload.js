// preload.js - secure bridge between renderer and main process
const { contextBridge, ipcRenderer } = require('electron');

// The translations reach the renderer from here. The renderer cannot read them
// itself: under file:// with context isolation fetch() cannot reach a local
// file, and there is no fs in the renderer.
//
// They are not read in this file either. This preload runs sandboxed, where
// require() only serves a handful of Electron modules — no fs, no local files.
// So the main process reads locales/*.json (it needs them anyway, to match the
// operating system's locale) and hands them over here.
//
// sendSync on purpose: this has to be done before the first paint, and going
// asynchronous would mean every screen could render before it had its texts.
// It blocks this preload once, for one small object, before any script runs.
//
// Handed to the renderer as plain data rather than as a function on pjlinkAPI:
// the context bridge copies its arguments on every call, so a getter would
// clone the whole catalog every time. This object goes straight into
// i18next.init({ resources }) on the other side.
//
// A locale file that is missing or malformed was already dropped by the
// loader, with the reason on the console. Whatever loaded, ships — i18next
// falls back to English for the rest.
contextBridge.exposeInMainWorld('i18nResources', ipcRenderer.sendSync('get-translations'));

contextBridge.exposeInMainWorld('pjlinkAPI', {
    // Connection
    connect: (config) => ipcRenderer.invoke('connect', config),
    disconnect: () => ipcRenderer.invoke('disconnect'),

    // Power control
    powerOn: () => ipcRenderer.invoke('power-on'),
    powerOff: () => ipcRenderer.invoke('power-off'),
    getPowerState: () => ipcRenderer.invoke('get-power-state'),

    // Input control
    setInput: (inputCode) => ipcRenderer.invoke('set-input', inputCode),
    getCurrentInput: () => ipcRenderer.invoke('get-current-input'),
    getAvailableInputs: () => ipcRenderer.invoke('get-available-inputs'),

    // Mute control
    setMute: (config) => ipcRenderer.invoke('set-mute', config),
    getMuteState: () => ipcRenderer.invoke('get-mute-state'),

    // Device info
    getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

    // PJLink Class 2 — extra features that not every projector supports
    speakerVolume: (direction) => ipcRenderer.invoke('speaker-volume', direction),
    microphoneVolume: (direction) => ipcRenderer.invoke('microphone-volume', direction),
    setFreeze: (on) => ipcRenderer.invoke('set-freeze', on),
    getFreeze: () => ipcRenderer.invoke('get-freeze'),
    getDeviceDetails: () => ipcRenderer.invoke('get-device-details'),
    getInputName: (code) => ipcRenderer.invoke('get-input-name', code),
    getResolutions: () => ipcRenderer.invoke('get-resolutions'),
    getMaintenance: () => ipcRenderer.invoke('get-maintenance'),

    // PJLink console (expert tools on the technical page)
    sendRaw: (line) => ipcRenderer.invoke('send-raw', line),
    getRawTemplates: () => ipcRenderer.invoke('get-raw-templates'),

    // Saving and loading settings
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

    // Network scanner
    scanNetwork: () => ipcRenderer.invoke('scan-network'),

    // Progress of the network scan
    onScanProgress: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('scan-progress', handler);
        return () => ipcRenderer.removeListener('scan-progress', handler);
    },

    // Mishaps in the main process that nobody caught. They land in the
    // activity log instead of in Electron's system dialog — see main.js.
    onMishap: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('app-mishap', handler);
        return () => ipcRenderer.removeListener('app-mishap', handler);
    },

    // Language of the operating system
    getOsLocale: () => ipcRenderer.invoke('get-os-locale'),

    // Colour scheme of the operating system
    getOsTheme: () => ipcRenderer.invoke('get-os-theme'),
    onOsThemeChange: (cb) => {
        const handler = (_event, value) => cb(value);
        ipcRenderer.on('os-theme-changed', handler);
        return () => ipcRenderer.removeListener('os-theme-changed', handler);
    }
});
