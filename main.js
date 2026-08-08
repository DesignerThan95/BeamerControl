// main.js für Electron Desktop App
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const PJLink = require('./index'); // PJLink Library

let mainWindow;
let beamer = null;

// Speicherort für die letzten Einstellungen (im Benutzerprofil, nicht im App-Ordner,
// damit es auch nach einem App-Update erhalten bleibt)
const settingsPath = path.join(app.getPath('userData'), 'beamer-settings.json');

function loadSettingsFromDisk() {
    try {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        return null; // Noch keine gespeicherten Einstellungen vorhanden
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

    // Optional: Entwicklertools ausblenden für Produktionsumgebung
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (beamer) {
        beamer.disconnect();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Helper function für Promise-basierte PJLink Calls
function promisifyPJLinkCall(method, ...args) {
    return new Promise((resolve, reject) => {
        const callback = (err, ...results) => {
            if (err) {
                reject(err);
            } else {
                resolve(results.length <= 1 ? results[0] : results);
            }
        };

        method.call(beamer, ...args, callback);
    });
}

// IPC Handlers für PJLink Funktionen
ipcMain.handle('connect', async (event, { host, port, password }) => {
    try {
        // Ohne Zeitablauf hängt ein nicht erreichbarer Host bis zum
        // Betriebssystem-Timeout (über eine Minute) und die Oberfläche steht still.
        beamer = new PJLink({ host, port, password: password || null, timeout: 6000 });

        // Test connection
        await promisifyPJLinkCall(beamer.getPowerState.bind(beamer));

        return { success: true, message: 'Verbunden' };
    } catch (error) {
        beamer = null;
        throw new Error(error.message || 'Verbindung fehlgeschlagen');
    }
});

ipcMain.handle('disconnect', async () => {
    try {
        if (beamer) {
            beamer.disconnect();
            beamer = null;
        }
        return { success: true, message: 'Getrennt' };
    } catch (error) {
        throw new Error(error.message || 'Trennung fehlgeschlagen');
    }
});

ipcMain.handle('power-on', async () => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.powerOn.bind(beamer));
    return { success: true };
});

ipcMain.handle('power-off', async () => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.powerOff.bind(beamer));
    return { success: true };
});

ipcMain.handle('get-power-state', async () => {
    if (!beamer) throw new Error('Nicht verbunden');
    const state = await promisifyPJLinkCall(beamer.getPowerState.bind(beamer));
    const states = { 0: 'Aus', 1: 'Ein', 2: 'Wird abgekühlt', 3: 'Wird aufgewärmt' };
    return { state, description: states[state] || `Unbekannt (${state})` };
});

ipcMain.handle('set-input', async (event, inputCode) => {
    if (!beamer) throw new Error('Nicht verbunden');
    const source = parseInt(inputCode.charAt(0));
    const channel = parseInt(inputCode.charAt(1));
    await promisifyPJLinkCall(beamer.setInput.bind(beamer), { source, channel });
    return { success: true };
});

ipcMain.handle('get-current-input', async () => {
    if (!beamer) throw new Error('Nicht verbunden');
    return await promisifyPJLinkCall(beamer.getInput.bind(beamer));
});

ipcMain.handle('get-available-inputs', async () => {
    if (!beamer) throw new Error('Nicht verbunden');
    const inputs = await promisifyPJLinkCall(beamer.getInputs.bind(beamer));
    return { inputs };
});

// Video und Ton werden einzeln geschaltet, damit sich beide unabhängig
// voneinander an- und abschalten lassen.
ipcMain.handle('set-mute', async (event, { video, audio }) => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), video ? '11' : '10');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), audio ? '21' : '20');
    return { success: true };
});

ipcMain.handle('set-mute-video', async (event, an) => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), an ? '11' : '10');
    return { success: true };
});

ipcMain.handle('set-mute-audio', async (event, an) => {
    if (!beamer) throw new Error('Nicht verbunden');
    await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), an ? '21' : '20');
    return { success: true };
});

ipcMain.handle('get-mute-state', async () => {
    if (!beamer) throw new Error('Nicht verbunden');
    return await promisifyPJLinkCall(beamer.getMute.bind(beamer));
});

ipcMain.handle('get-device-info', async () => {
    if (!beamer) throw new Error('Nicht verbunden');

    try {
        const [name, manufacturer, model] = await Promise.allSettled([
            promisifyPJLinkCall(beamer.getName.bind(beamer)),
            promisifyPJLinkCall(beamer.getManufacturer.bind(beamer)),
            promisifyPJLinkCall(beamer.getModel.bind(beamer))
        ]);

        return {
            name: name.status === 'fulfilled' ? name.value : 'Unbekannt',
            manufacturer: manufacturer.status === 'fulfilled' ? manufacturer.value : 'Unbekannt',
            model: model.status === 'fulfilled' ? model.value : 'Unbekannt'
        };
    } catch (error) {
        return {
            name: 'Unbekannt',
            manufacturer: 'Unbekannt',
            model: 'Unbekannt'
        };
    }
});

// ============ EINSTELLUNGEN SPEICHERN/LADEN ============

ipcMain.handle('load-settings', async () => {
    return loadSettingsFromDisk();
});

ipcMain.handle('save-settings', async (event, settings) => {
    saveSettingsToDisk(settings);
    return { success: true };
});

// ============ NETZWERK SCANNER ============

// Ermittelt die lokalen Subnetze (z.B. "192.168.1") anhand der Netzwerk-Interfaces
function getLocalSubnets() {
    const interfaces = os.networkInterfaces();
    const subnets = [];
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const parts = iface.address.split('.');
                subnets.push(parts.slice(0, 3).join('.'));
            }
        }
    }
    return [...new Set(subnets)];
}

// Prüft schnell, ob ein Host auf einem Port lauscht (ohne PJLink-Protokoll zu sprechen)
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

// Versucht best-effort den Gerätenamen per PJLink zu holen (mit kurzem Timeout)
function getDeviceNameQuick(host, port) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        try {
            const testBeamer = new PJLink(host, port, null);
            testBeamer.getName((err, result) => {
                clearTimeout(timer);
                testBeamer.disconnect();
                resolve(err ? null : result);
            });
        } catch (error) {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

ipcMain.handle('scan-network', async (event) => {
    const PORT = 4352; // PJLink Standardport
    const TIMEOUT = 400; // ms pro Host
    const subnets = getLocalSubnets();

    if (subnets.length === 0) {
        throw new Error('Kein aktives Netzwerk gefunden');
    }

    const total = subnets.length * 254;
    let checked = 0;
    const openHosts = [];
    const devices = [];

    // Meldet den Fortschritt an das Fenster, damit der Assistent einen Balken zeigen kann.
    const melden = () => {
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
                    if (checked % 10 === 0) melden();
                })
            );
        }
        await Promise.all(checks);
    }
    melden();

    // Für jeden gefundenen Host best-effort den Gerätenamen holen
    for (const host of openHosts) {
        const name = await getDeviceNameQuick(host, PORT);
        devices.push({ host, port: PORT, name: name || null });
        melden();
    }

    return { devices };
});

// ============ FARBSCHEMA DES BETRIEBSSYSTEMS ============

ipcMain.handle('get-os-theme', async () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('os-theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
});
