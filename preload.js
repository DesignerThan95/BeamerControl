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

    // Einstellungen speichern/laden
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

    // Netzwerk-Scanner
    scanNetwork: () => ipcRenderer.invoke('scan-network')
});
