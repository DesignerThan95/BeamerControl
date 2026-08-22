// The only place that knows the preload bridge. Every other file calls App.api.
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
        getMuteState: () => p.getMuteState(),
        getDeviceInfo: () => p.getDeviceInfo(),
        speakerVolume: (direction) => p.speakerVolume(direction),
        microphoneVolume: (direction) => p.microphoneVolume(direction),
        setFreeze: (on) => p.setFreeze(on),
        getFreeze: () => p.getFreeze(),
        getDeviceDetails: () => p.getDeviceDetails(),
        getInputName: (code) => p.getInputName(code),
        getResolutions: () => p.getResolutions(),
        getMaintenance: () => p.getMaintenance(),
        loadSettings: () => p.loadSettings(),
        saveSettings: (s) => p.saveSettings(s),
        scanNetwork: () => p.scanNetwork(),
        onScanProgress: (cb) => p.onScanProgress(cb),
        getOsLocale: () => p.getOsLocale(),
        getOsTheme: () => p.getOsTheme(),
        onOsThemeChange: (cb) => p.onOsThemeChange(cb)
    };
})();
