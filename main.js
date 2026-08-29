// main.js for the Electron desktop app
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const PJLink = require('./index'); // PJLink library
const { createConnection } = require('./lib/connection');
const { createScanner } = require('./lib/scanner');
const mute = require('./lib/mute');
// The translations, read once at startup. They are needed here because the
// renderer cannot read them itself and the preload script runs sandboxed.
const { loadResources, normalizeLanguage } = require('./renderer/js/i18n/resources');
const translationResources = loadResources();

let mainWindow;

// Without a timeout, an unreachable host hangs until the operating system
// gives up — over a minute — and the interface stands still all the while.
const CONNECT_TIMEOUT_MS = 6000;

// Who holds the connection to the projector, and who may throw it away, is
// lib/connection.js's business. The reasons are written down there.
const connection = createConnection((settings) => new PJLink(settings));

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

// ============ MISHAPS NOBODY CAUGHT ============
//
// Without a listener here, Electron shows an uncaught error in the main
// process as a system dialog: an English stack trace in front of someone who
// only wants to switch the projector on, in the middle of a service, and the
// app is barely usable afterwards either.
//
// This app answers for its own errors. A mishap goes into the activity log
// behind the gear icon and the operating screen carries on. Anything that
// really concerns the user reaches them on the proper route anyway — as a
// command that failed, or as "no contact with the projector".
//
// The price of this is that the app carries on after a fault it does not
// understand. For a device that has to keep the picture on the wall, that is
// the better bargain than a dialog nobody in the room can act on.
// Two consoles, not one: this process is Node, the window is Chromium, and
// neither sees the other's output. console.error here reaches the terminal the
// app was started from — which in an installed app is nobody. So the mishap
// takes the second route as well, over to the window: into the activity log
// for the technical staff, and into the developer console with its stack.
function reportMishap(where, error) {
    const message = (error && error.message) || String(error);
    const stack = (error && error.stack) || message;

    console.error('[' + where + ']', stack);

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app-mishap', { where, message, stack });
    }
}

process.on('uncaughtException', (error) => reportMishap('uncaughtException', error));
process.on('unhandledRejection', (reason) => reportMishap('unhandledRejection', reason));

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
    connection.disconnect();
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Turns one of the library's callback methods into a promise. The connection
// is passed in rather than read from somewhere: a command has to run on the
// connection it was started on, even if another one has taken over since.
function call(link, method, ...args) {
    return new Promise((resolve, reject) => {
        link[method](...args, (err, ...results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results.length <= 1 ? results[0] : results);
            }
        });
    });
}

// IPC handlers for the PJLink functions
ipcMain.handle('connect', async (event, { host, port, password }) => {
    try {
        return await connection.connect(
            { host, port, password: password || null, timeout: CONNECT_TIMEOUT_MS },
            async (link) => {
                // The connection counts as made once the projector has
                // answered something.
                await call(link, 'getPowerState');

                const projectorClass = await determineClass(link);

                return {
                    success: true,
                    message: 'Connected',
                    pjlinkClass: projectorClass.pjlinkClass,
                    pjlinkClassSource: projectorClass.pjlinkClassSource,
                    pjlinkClassDetail: projectorClass.pjlinkClassDetail
                };
            }
        );
    } catch (error) {
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
async function determineClass(link) {
    let response;

    try {
        response = await call(link, 'getClass');
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
        connection.disconnect();
        return { success: true, message: 'Disconnected' };
    } catch (error) {
        throw new Error(error.message || 'Disconnect failed');
    }
});

ipcMain.handle('power-on', async () => {
    await call(connection.require(), 'powerOn');
    return { success: true };
});

ipcMain.handle('power-off', async () => {
    await call(connection.require(), 'powerOff');
    return { success: true };
});

ipcMain.handle('get-power-state', async () => {
    const state = await call(connection.require(), 'getPowerState');
    const states = { 0: 'Off', 1: 'On', 2: 'Cooling down', 3: 'Warming up' };
    return { state, description: states[state] || `Unknown (${state})` };
});

// The code goes through whole. Taking it apart here and putting it back
// together in the library only created an opportunity to lose the Class 2
// codes, whose second character may be a letter (spec 4.3).
ipcMain.handle('set-input', async (event, inputCode) => {
    await call(connection.require(), 'setInput', inputCode);
    return { success: true };
});

ipcMain.handle('get-current-input', async () => {
    return await call(connection.require(), 'getInput');
});

ipcMain.handle('get-available-inputs', async () => {
    const inputs = await call(connection.require(), 'getInputs');
    return { inputs };
});

// One press, one command — which one is lib/mute.js's business, and the
// reasons are written down there.
//
// Two things must not be confused here, because they look the same from the
// outside and mean opposite things:
//
//   * The projector refuses the separate value (ERR1/ERR2). Then it only knows
//     the combined switch, and the combined value is worth trying.
//   * The projector does not answer at all. Then nobody knows whether it heard
//     the command. Sending it a different mute value on top is guesswork — and
//     the way a command meant for the sound blanks the screen. The silence is
//     reported instead, and whether it worked is decided by what the projector
//     reports about itself afterwards.
ipcMain.handle('set-mute', async (event, { video, audio, only }) => {
    const link = connection.require();
    const wish = { video, audio, only: only || null };

    try {
        await call(link, 'setMuteRaw', mute.avmtCodeFor(wish));
        return { success: true, mode: 'separate' };
    } catch (error) {
        if (!mute.meansTheDeviceCannot(error.message)) {
            return { success: true, unanswered: true, reason: error.message };
        }

        await call(link, 'setMuteRaw', mute.combinedCodeFor(wish));
        return { success: true, mode: 'combined', reason: error.message };
    }
});

ipcMain.handle('get-mute-state', async () => {
    return await call(connection.require(), 'getMute');
});

ipcMain.handle('get-device-info', async () => {
    const link = connection.require();

    try {
        const [name, manufacturer, model] = await Promise.allSettled([
            call(link, 'getName'),
            call(link, 'getManufacturer'),
            call(link, 'getModel')
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
    const link = connection.require();

    try {
        return { supported: true, value: await fn(link) };
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
    return class2((link) => call(link, 'setSpeakerVolume', direction));
});

ipcMain.handle('microphone-volume', async (event, direction) => {
    return class2((link) => call(link, 'setMicrophoneVolume', direction));
});

// ---- Freeze (FREZ) ----

ipcMain.handle('set-freeze', async (event, on) => {
    return class2((link) => call(link, 'setFreeze', on === true));
});

ipcMain.handle('get-freeze', async () => {
    return class2((link) => call(link, 'getFreeze'));
});

// ---- Device data (SNUM / SVER) ----

ipcMain.handle('get-device-details', async () => {
    return class2(async (link) => {
        const [serialNumber, softwareVersion] = await Promise.all([
            call(link, 'getSerialNumber'),
            call(link, 'getSoftwareVersion')
        ]);
        return { serialNumber: serialNumber, softwareVersion: softwareVersion };
    });
});

// ---- Name of an input (INNM) ----
// The only Class 2 query command with a parameter: it asks per input.

ipcMain.handle('get-input-name', async (event, code) => {
    return class2((link) => call(link, 'getInputName', code));
});

// ---- Resolution (IRES / RRES) ----

ipcMain.handle('get-resolutions', async () => {
    return class2(async (link) => {
        const [incoming, recommended] = await Promise.all([
            call(link, 'getInputResolution'),
            call(link, 'getRecommendedResolution')
        ]);
        return { input: incoming, recommended: recommended };
    });
});

// ---- Maintenance (FILT / RLMP / RFIL) ----

ipcMain.handle('get-maintenance', async () => {
    const link = connection.require();

    // Each one guarded on its own: a laser projector has no replaceable lamp
    // and answers RLMP with ERR1, but it does know its filter hours.
    const [filterHours, lamps, filters] = await Promise.allSettled([
        call(link, 'getFilterUsage'),
        call(link, 'getLampReplacements'),
        call(link, 'getFilterReplacements')
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
//
// Says why, not just whether. The reason used to be thrown away here, and that
// was the reason a failed search could not be told apart from an empty one: a
// subnet where every address answers "EHOSTUNREACH" — a macOS that has not been
// given permission for the local network, a cable that is not plugged in —
// looked exactly like a subnet with no projector in it.
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
        socket.once('connect', () => finish({ open: true }));
        socket.once('timeout', () => finish({ open: false, code: 'TIMEOUT' }));
        socket.once('error', (error) => finish({ open: false, code: error.code || 'ERROR' }));
        socket.connect(port, host);
    });
}

// Tries best-effort to fetch the device name over PJLink (with a short timeout).
//
// The connection is let go of in every case, including the one where the name
// never arrives. A device left hanging here would keep the projector's single
// PJLink connection slot occupied — and the app itself would then not get in
// any more.
function getDeviceNameQuick(host, port) {
    return new Promise((resolve) => {
        const NAME_TIMEOUT_MS = 2000;
        let testProjector = null;
        let done = false;

        const finish = (name) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (testProjector) testProjector.disconnect();
            resolve(name);
        };

        const timer = setTimeout(() => finish(null), NAME_TIMEOUT_MS);

        try {
            // With a timeout of its own: without one the library waits for
            // ever, and the guard above would resolve while the connection
            // quietly stayed open.
            testProjector = new PJLink({ host, port, password: null, timeout: NAME_TIMEOUT_MS });
            testProjector.getName((err, result) => finish(err ? null : result));
        } catch (error) {
            finish(null);
        }
    });
}

const PJLINK_PORT = 4352; // PJLink default port
const SCAN_TIMEOUT_MS = 900; // per host — projectors in standby answer sluggishly

// How the search is run is lib/scanner.js's business — the reasons are written
// down there. This is only where it is given the three things it needs that do
// touch the machine: the local subnets, a port check, and a device name.
const scanner = createScanner({
    subnets: getLocalSubnets,
    checkPort: (host, port) => checkPort(host, port, SCAN_TIMEOUT_MS),
    getName: getDeviceNameQuick
});

ipcMain.handle('scan-network', async (event) => {
    return scanner.scan({
        port: PJLINK_PORT,
        // Reports progress to the window so the wizard can show a bar.
        report: (progress) => {
            if (!event.sender.isDestroyed()) {
                event.sender.send('scan-progress', progress);
            }
        }
    });
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

// The translations, shaped the way i18next takes them on init:
// { en: { translation: {…} }, de: { translation: {…} } }.
//
// The renderer cannot read them itself — no fs there, and fetch() cannot reach
// a file:// path — and neither can the preload script, which runs sandboxed.
// So they are handed out from here.
//
// Synchronous by design: the preload script asks before the first paint, so
// that no screen can render before i18next has its resources. One object, once.
ipcMain.on('get-translations', (event) => {
    event.returnValue = translationResources;
});

// ============ LANGUAGE OF THE OPERATING SYSTEM ============

// Same route as the colour scheme: the operating system is asked, the renderer
// gets the answer. Only a language the app actually speaks is handed out — a
// French Windows gets English, not a half-translated screen.
ipcMain.handle('get-os-locale', async () => {
    return normalizeLanguage(app.getLocale(), translationResources);
});
