// preload.js - Sichere Bridge zwischen Renderer und Main Process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pjlinkAPI', {
    // Verbindung
    connect: (config) => ipcRenderer.invoke('connect', config),
    disconnect: () => ipcRenderer.invoke('disconnect'),

    // Power Control
    powerOn: () => ipcRenderer.invoke('power-on'),
    powerOff: () => ipcRenderer.invoke('power-off'),
    getPowerState: () => ipcRenderer.invoke('get-power-state'),

    // Input Control
    setInput: (inputCode) => ipcRenderer.invoke('set-input', inputCode),
    getCurrentInput: () => ipcRenderer.invoke('get-current-input'),
    getAvailableInputs: () => ipcRenderer.invoke('get-available-inputs'),

    // Mute Control
    setMute: (config) => ipcRenderer.invoke('set-mute', config),
    getMuteState: () => ipcRenderer.invoke('get-mute-state'),

    // Device Info
    getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

    // PJLink Class 2 — Zusatzfunktionen, die nicht jeder Beamer beherrscht
    speakerVolume: (richtung) => ipcRenderer.invoke('speaker-volume', richtung),
    microphoneVolume: (richtung) => ipcRenderer.invoke('microphone-volume', richtung),
    setFreeze: (an) => ipcRenderer.invoke('set-freeze', an),
    getFreeze: () => ipcRenderer.invoke('get-freeze'),
    getDeviceDetails: () => ipcRenderer.invoke('get-device-details'),
    getInputName: (code) => ipcRenderer.invoke('get-input-name', code),
    getResolutions: () => ipcRenderer.invoke('get-resolutions'),
    getMaintenance: () => ipcRenderer.invoke('get-maintenance'),

    // Einstellungen speichern/laden
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

    // Netzwerk-Scanner
    scanNetwork: () => ipcRenderer.invoke('scan-network'),

    // Fortschritt des Netzwerk-Suchlaufs
    onScanProgress: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('scan-progress', handler);
        return () => ipcRenderer.removeListener('scan-progress', handler);
    },

    // Farbschema des Betriebssystems
    getOsTheme: () => ipcRenderer.invoke('get-os-theme'),
    onOsThemeChange: (cb) => {
        const handler = (_event, wert) => cb(wert);
        ipcRenderer.on('os-theme-changed', handler);
        return () => ipcRenderer.removeListener('os-theme-changed', handler);
    }
});
