// preload.js - secure bridge between renderer and main process
const { contextBridge, ipcRenderer } = require('electron');

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
