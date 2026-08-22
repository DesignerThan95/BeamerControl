// main.js for the Electron desktop app
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const PJLink = require('./index'); // PJLink library
// Only for normalizing the language: which languages exist is the translation
// helper's business, and that list should live nowhere else.
const i18n = require('./renderer/js/i18n');

let mainWindow;
let projector = null;

// Where the last settings are kept (in the user profile, not in the app folder,
// so they survive an app update)
const settingsPath = path.join(app.getPath('userData'), 'beamer-settings.json');

function loadSettingsFromDisk() {
    try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        return null; // No saved settings yet
    }
}

function saveSettingsToDisk(settings) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('renderer/index.html');

    // Optional: hide the developer tools in production
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

// Quit completely on macOS as well: this is an operating device for a
// projector, not a document program — a program that keeps running invisibly
// in the dock confuses more than it helps.
app.on('window-all-closed', () => {
    if (projector) {
        projector.disconnect();
    }
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Helper function for promise-based PJLink calls
function promisifyPJLinkCall(method, ...args) {
    return new Promise((resolve, reject) => {
        const callback = (err, ...results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results.length <= 1 ? results[0] : results);
            }
        };

        method.call(projector, ...args, callback);
    });
}

// IPC handlers for the PJLink functions
ipcMain.handle('connect', async (event, { host, port, password }) => {
    try {
        // Without a timeout, an unreachable host hangs until the operating
        // system gives up (over a minute) and the interface stands still.
        projector = new PJLink({ host, port, password: password || null, timeout: 6000 });

        // Test connection
        await promisifyPJLinkCall(projector.getPowerState.bind(projector));

        const projectorClass = await determineClass();

        return {
            success: true,
            message: 'Connected',
            pjlinkClass: projectorClass.pjlinkClass,
            pjlinkClassSource: projectorClass.pjlinkClassSource,
            pjlinkClassDetail: projectorClass.pjlinkClassDetail
        };
    } catch (error) {
        projector = null;
        throw new Error(error.message || 'Connection failed');
    }
});

// Which PJLink level does the projector report? Class 2 knows the extra
// commands (volume, freeze, maintenance readings), Class 1 does not. The query
// itself is a Class 1 command and therefore works everywhere.
//
// The query must not be allowed to fail the connection — when in doubt Class 1
// applies, and the extra features simply stay away. What matters is recording
// WHY Class 1 applies: "the projector answered Class 1" and "the query went
// unanswered" lead to the same value but mean different things. Without that
// distinction a timeout reads like a statement about the device.
async function determineClass() {
    let response;

    try {
        response = await promisifyPJLinkCall(projector.getClass.bind(projector));
    } catch (error) {
        return {
            pjlinkClass: 1,
            pjlinkClassSource: 'unanswered',
            pjlinkClassDetail: error.message || 'no reason given'
        };
    }

    // getClass returns {cls, raw}: the class that was read and the wording of
    // the answer. Digging out the digit is lib/command.js's job — that is also
    // where the leniency towards devices lives that answer "Class 1" rather
    // than "1".
    if (response && (response.cls === 1 || response.cls === 2)) {
        return {
            pjlinkClass: response.cls,
            pjlinkClassSource: 'reported',
            pjlinkClassDetail: response.raw
        };
    }

    // It did answer, but without a recognizable class.
    return {
        pjlinkClass: 1,
        pjlinkClassSource: 'unclear',
        pjlinkClassDetail: (response && response.raw) || 'empty answer'
    };
}

ipcMain.handle('disconnect', async () => {
    try {
        if (projector) {
            projector.disconnect();
            projector = null;
        }
        return { success: true, message: 'Disconnected' };
    } catch (error) {
        throw new Error(error.message || 'Disconnect failed');
    }
});

ipcMain.handle('power-on', async () => {
    if (!projector) throw new Error('Not connected');
    await promisifyPJLinkCall(projector.powerOn.bind(projector));
    return { success: true };
});

ipcMain.handle('power-off', async () => {
    if (!projector) throw new Error('Not connected');
    await promisifyPJLinkCall(projector.powerOff.bind(projector));
    return { success: true };
});

ipcMain.handle('get-power-state', async () => {
    if (!projector) throw new Error('Not connected');
    const state = await promisifyPJLinkCall(projector.getPowerState.bind(projector));
    const states = { 0: 'Off', 1: 'On', 2: 'Cooling down', 3: 'Warming up' };
    return { state, description: states[state] || `Unknown (${state})` };
});

ipcMain.handle('set-input', async (event, inputCode) => {
    if (!projector) throw new Error('Not connected');
    const source = parseInt(inputCode.charAt(0));
    const channel = parseInt(inputCode.charAt(1));
    await promisifyPJLinkCall(projector.setInput.bind(projector), { source, channel });
    return { success: true };
});

ipcMain.handle('get-current-input', async () => {
    if (!projector) throw new Error('Not connected');
    return await promisifyPJLinkCall(projector.getInput.bind(projector));
});

ipcMain.handle('get-available-inputs', async () => {
    if (!projector) throw new Error('Not connected');
    const inputs = await promisifyPJLinkCall(projector.getInputs.bind(projector));
    return { inputs };
});

// Picture and sound are switched separately first (AVMT 11/10 and 21/20).
// Many projectors — plenty of Optomas among them — only know the combined
// switch (AVMT 31/30) and answer the separate values with ERR1 "Undefined
// command". The combined value is then used as a fallback, with the picture
// deciding: that is what people notice in the room.
ipcMain.handle('set-mute', async (event, { video, audio }) => {
    if (!projector) throw new Error('Not connected');

    try {
        await promisifyPJLinkCall(projector.setMuteRaw.bind(projector), video ? '11' : '10');
        await promisifyPJLinkCall(projector.setMuteRaw.bind(projector), audio ? '21' : '20');
        return { success: true, mode: 'separate' };
    } catch (error) {
        await promisifyPJLinkCall(projector.setMuteRaw.bind(projector), video ? '31' : '30');
        return { success: true, mode: 'combined', reason: error.message };
    }
});

ipcMain.handle('get-mute-state', async () => {
    if (!projector) throw new Error('Not connected');
    return await promisifyPJLinkCall(projector.getMute.bind(projector));
});

ipcMain.handle('get-device-info', async () => {
    if (!projector) throw new Error('Not connected');

    try {
        const [name, manufacturer, model] = await Promise.allSettled([
            promisifyPJLinkCall(projector.getName.bind(projector)),
            promisifyPJLinkCall(projector.getManufacturer.bind(projector)),
            promisifyPJLinkCall(projector.getModel.bind(projector))
        ]);

        return {
            name: name.status === 'fulfilled' ? name.value : 'Unknown',
            manufacturer: manufacturer.status === 'fulfilled' ? manufacturer.value : 'Unknown',
            model: model.status === 'fulfilled' ? model.value : 'Unknown'
        };
    } catch (error) {
        return {
            name: 'Unknown',
            manufacturer: 'Unknown',
            model: 'Unknown'
        };
    }
});

// ============ PJLINK CLASS 2 ============

// A projector that does not know a Class 2 command answers with ERR1. That is
// not a fault of the app and not a fault of the connection — it only means
// this device does not have the feature. It is then greyed out in the
// interface rather than raising an error message.
// Everything else (timeout, password, device fault) stays a real error and
// reaches the caller unchanged.
const UNSUPPORTED_COMMAND = 'Undefined command';

async function class2(fn) {
    if (!projector) throw new Error('Not connected');

    try {
        return { supported: true, value: await fn() };
    } catch (error) {
        if (error.message === UNSUPPORTED_COMMAND) {
            return { supported: false, reason: error.message };
        }
        throw error;
    }
}

// ---- Volume (SVOL / MVOL) ----
// Purely relative: one step up or down. PJLink does not hand out a current
// level and there is no query for it either — that is what the spec says.

ipcMain.handle('speaker-volume', async (event, direction) => {
    return class2(() => promisifyPJLinkCall(projector.setSpeakerVolume.bind(projector), direction));
});

ipcMain.handle('microphone-volume', async (event, direction) => {
    return class2(() => promisifyPJLinkCall(projector.setMicrophoneVolume.bind(projector), direction));
});

// ---- Freeze (FREZ) ----

ipcMain.handle('set-freeze', async (event, on) => {
    return class2(() => promisifyPJLinkCall(projector.setFreeze.bind(projector), on === true));
});

ipcMain.handle('get-freeze', async () => {
    return class2(() => promisifyPJLinkCall(projector.getFreeze.bind(projector)));
});

// ---- Device data (SNUM / SVER) ----

ipcMain.handle('get-device-details', async () => {
    return class2(async () => {
        const [serialNumber, softwareVersion] = await Promise.all([
            promisifyPJLinkCall(projector.getSerialNumber.bind(projector)),
            promisifyPJLinkCall(projector.getSoftwareVersion.bind(projector))
        ]);
        return { serialNumber: serialNumber, softwareVersion: softwareVersion };
    });
});

// ---- Name of an input (INNM) ----
// The only Class 2 query command with a parameter: it asks per input.

ipcMain.handle('get-input-name', async (event, code) => {
    return class2(() => promisifyPJLinkCall(projector.getInputName.bind(projector), code));
});

// ---- Resolution (IRES / RRES) ----

ipcMain.handle('get-resolutions', async () => {
    return class2(async () => {
        const [incoming, recommended] = await Promise.all([
            promisifyPJLinkCall(projector.getInputResolution.bind(projector)),
            promisifyPJLinkCall(projector.getRecommendedResolution.bind(projector))
        ]);
        return { input: incoming, recommended: recommended };
    });
});

// ---- Maintenance (FILT / RLMP / RFIL) ----

ipcMain.handle('get-maintenance', async () => {
    if (!projector) throw new Error('Not connected');

    // Each one guarded on its own: a laser projector has no replaceable lamp
    // and answers RLMP with ERR1, but it does know its filter hours.
    const [filterHours, lamps, filters] = await Promise.allSettled([
        promisifyPJLinkCall(projector.getFilterUsage.bind(projector)),
        promisifyPJLinkCall(projector.getLampReplacements.bind(projector)),
        promisifyPJLinkCall(projector.getFilterReplacements.bind(projector))
    ]);
    const all = [filterHours, lamps, filters];

    const isUnsupported = (e) => e.status === 'rejected' && e.reason.message === UNSUPPORTED_COMMAND;

    // If the projector knows none of these commands at all, it does not have
    // the feature — it is greyed out rather than showing three empty fields.
    if (all.every(isUnsupported)) {
        return { supported: false, reason: UNSUPPORTED_COMMAND };
    }

    // A real error (timeout, password, device fault) must not pass as "this
    // value happens to be missing".
    const realFailure = all.find((e) => e.status === 'rejected' && !isUnsupported(e));
    if (realFailure) throw new Error(realFailure.reason.message);

    return {
        supported: true,
        value: {
            filterHours: filterHours.status === 'fulfilled' ? filterHours.value : null,
            lampModels: lamps.status === 'fulfilled' ? (lamps.value || []) : [],
            filterModels: filters.status === 'fulfilled' ? (filters.value || []) : []
        }
    };
});

// ============ SAVING AND LOADING SETTINGS ============

ipcMain.handle('load-settings', async () => {
    return loadSettingsFromDisk();
});

ipcMain.handle('save-settings', async (event, settings) => {
    saveSettingsToDisk(settings);
    return { success: true };
});

// ============ NETWORK SCANNER ============

// Works out the local subnets (e.g. "192.168.1") from the network interfaces
function getLocalSubnets() {
    const interfaces = os.networkInterfaces();
    const subnets = [];
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family !== 'IPv4' || iface.internal) continue;
            // A device gives itself a 169.254.x.x address when it did not get
            // one. There is guaranteed to be no projector there — checking
            // those 254 addresses only costs time.
            if (iface.address.startsWith('169.254.')) continue;
            const parts = iface.address.split('.');
            subnets.push(parts.slice(0, 3).join('.'));
        }
    }
    return [...new Set(subnets)];
}

// Checks quickly whether a host is listening on a port (without speaking PJLink)
function checkPort(host, port, timeout) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;

        const finish = (result) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(timeout);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, host);
    });
}

// Tries best-effort to fetch the device name over PJLink (with a short timeout)
function getDeviceNameQuick(host, port) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        try {
            const testProjector = new PJLink(host, port, null);
            testProjector.getName((err, result) => {
                clearTimeout(timer);
                testProjector.disconnect();
                resolve(err ? null : result);
            });
        } catch (error) {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

ipcMain.handle('scan-network', async (event) => {
    const PORT = 4352; // PJLink default port
    const TIMEOUT = 900; // ms per host — projectors in standby answer sluggishly
    const subnets = getLocalSubnets();

    if (subnets.length === 0) {
        throw new Error('No active network found');
    }

    const total = subnets.length * 254;
    let checked = 0;
    const openHosts = [];
    const devices = [];

    // Reports progress to the window so the wizard can show a bar.
    const report = () => {
        if (!event.sender.isDestroyed()) {
            event.sender.send('scan-progress', { checked, total, devices: devices.slice() });
        }
    };

    for (const subnet of subnets) {
        const checks = [];
        for (let i = 1; i <= 254; i++) {
            const host = `${subnet}.${i}`;
            checks.push(
                checkPort(host, PORT, TIMEOUT).then((open) => {
                    checked++;
                    if (open) openHosts.push(host);
                    if (checked % 10 === 0) report();
                })
            );
        }
        await Promise.all(checks);
    }
    report();

    // For every host found, fetch the device name best-effort
    for (const host of openHosts) {
        const name = await getDeviceNameQuick(host, PORT);
        devices.push({ host, port: PORT, name: name || null });
        report();
    }

    return { devices };
});

// ============ COLOUR SCHEME OF THE OPERATING SYSTEM ============

ipcMain.handle('get-os-theme', async () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('os-theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
});

// ============ TRANSLATIONS ============

// The texts from locales/*.json, read once when this module loads. The
// renderer cannot read them itself — no fs there, and fetch() cannot reach a
// file:// path — and neither can the preload script, which runs sandboxed.
// So it is handed out from here.
//
// Synchronous by design: the preload script asks before the first paint, so
// that no screen can render before it has its texts. One small object, once.
ipcMain.on('get-translations', (event) => {
    event.returnValue = i18n.catalogs();
});

// ============ LANGUAGE OF THE OPERATING SYSTEM ============

// Same route as the colour scheme: the operating system is asked, the renderer
// gets the answer. Only a language the app actually speaks is handed out — a
// French Windows gets English, not a half-translated screen.
ipcMain.handle('get-os-locale', async () => {
    return i18n.normalizeLanguage(app.getLocale());
});
