// Einziger Ort, der die preload-Brücke kennt. Alle anderen Dateien rufen App.api.
window.App = window.App || {};
window.App.api = (function () {
    const p = window.pjlinkAPI;
    return {
        connect: (cfg) => p.connect(cfg),
        disconnect: () => p.disconnect(),
        powerOn: () => p.powerOn(),
        powerOff: () => p.powerOff(),
        getPowerState: () => p.getPowerState(),
        setInput: (code) => p.setInput(code),
        getCurrentInput: () => p.getCurrentInput(),
        getAvailableInputs: () => p.getAvailableInputs(),
        setMute: (m) => p.setMute(m),
        setVideoMute: (an) => p.setVideoMute(an),
        setAudioMute: (an) => p.setAudioMute(an),
        getMuteState: () => p.getMuteState(),
        getDeviceInfo: () => p.getDeviceInfo(),
        loadSettings: () => p.loadSettings(),
        saveSettings: (s) => p.saveSettings(s),
        scanNetwork: () => p.scanNetwork(),
        onScanProgress: (cb) => p.onScanProgress(cb),
        getOsTheme: () => p.getOsTheme(),
        onOsThemeChange: (cb) => p.onOsThemeChange(cb)
    };
})();
