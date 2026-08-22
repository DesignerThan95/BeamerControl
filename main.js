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

// Auch auf macOS vollständig beenden: Das hier ist ein Bediengerät für einen
// Beamer, kein Dokumentenprogramm — ein unsichtbar weiterlaufendes Programm im
// Dock verwirrt mehr, als es nützt.
app.on('window-all-closed', () => {
    if (beamer) {
        beamer.disconnect();
    }
    app.quit();
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

        return { success: true, message: 'Verbunden', pjlinkClass: await ermittleKlasse() };
    } catch (error) {
        beamer = null;
        throw new Error(error.message || 'Verbindung fehlgeschlagen');
    }
});

// Welchen PJLink-Stand meldet der Beamer? Class 2 kennt die Zusatzbefehle
// (Lautstärke, Standbild, Wartungswerte), Class 1 nicht. Die Abfrage selbst
// ist ein Class-1-Befehl und funktioniert deshalb überall.
// Sie darf die Verbindung nicht scheitern lassen: antwortet ein älteres Gerät
// darauf gar nicht, gilt Class 1 — dann bleiben die Zusatzfunktionen einfach aus.
async function ermittleKlasse() {
    try {
        const roh = await promisifyPJLinkCall(beamer.getClass.bind(beamer));
        const klasse = parseInt(roh, 10);
        return klasse === 2 ? 2 : 1;
    } catch (error) {
        return 1;
    }
}

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

// Bild und Ton werden zuerst einzeln geschaltet (AVMT 11/10 und 21/20).
// Viele Beamer — darunter etliche Optoma — kennen nur das gemeinsame
// Schalten (AVMT 31/30) und antworten auf die Einzelwerte mit ERR1
// "Undefined command". Dann wird auf den gemeinsamen Wert zurückgefallen,
// wobei das Bild den Ausschlag gibt: es ist das, was im Raum auffällt.
ipcMain.handle('set-mute', async (event, { video, audio }) => {
    if (!beamer) throw new Error('Nicht verbunden');

    try {
        await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), video ? '11' : '10');
        await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), audio ? '21' : '20');
        return { success: true, mode: 'separat' };
    } catch (error) {
        await promisifyPJLinkCall(beamer.setMuteRaw.bind(beamer), video ? '31' : '30');
        return { success: true, mode: 'gemeinsam', hinweis: error.message };
    }
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

// ============ PJLINK CLASS 2 ============

// Ein Beamer, der einen Class-2-Befehl nicht kennt, antwortet mit ERR1.
// Das ist kein Fehler der App und keiner der Verbindung — es heißt nur:
// diese Funktion gibt es an diesem Gerät nicht. Sie wird dann in der
// Oberfläche ausgegraut, statt eine Fehlermeldung auszulösen.
// Alles andere (Zeitablauf, Passwort, Gerätestörung) bleibt ein echter Fehler
// und geht unverändert an den Aufrufer.
const KENNT_BEAMER_NICHT = 'Undefined command';

async function class2(fn) {
    if (!beamer) throw new Error('Nicht verbunden');

    try {
        return { supported: true, value: await fn() };
    } catch (error) {
        if (error.message === KENNT_BEAMER_NICHT) {
            return { supported: false, reason: error.message };
        }
        throw error;
    }
}

// ---- Lautstärke (SVOL / MVOL) ----
// Rein relativ: eine Stufe hoch oder runter. Einen Ist-Wert gibt PJLink nicht
// her und es gibt auch keine Abfrage dafür — so steht es in der Spezifikation.

ipcMain.handle('speaker-volume', async (event, richtung) => {
    return class2(() => promisifyPJLinkCall(beamer.setSpeakerVolume.bind(beamer), richtung));
});

ipcMain.handle('microphone-volume', async (event, richtung) => {
    return class2(() => promisifyPJLinkCall(beamer.setMicrophoneVolume.bind(beamer), richtung));
});

// ---- Standbild (FREZ) ----

ipcMain.handle('set-freeze', async (event, an) => {
    return class2(() => promisifyPJLinkCall(beamer.setFreeze.bind(beamer), an === true));
});

ipcMain.handle('get-freeze', async () => {
    return class2(() => promisifyPJLinkCall(beamer.getFreeze.bind(beamer)));
});

// ---- Gerätedaten (SNUM / SVER) ----

ipcMain.handle('get-device-details', async () => {
    return class2(async () => {
        const [seriennummer, software] = await Promise.all([
            promisifyPJLinkCall(beamer.getSerialNumber.bind(beamer)),
            promisifyPJLinkCall(beamer.getSoftwareVersion.bind(beamer))
        ]);
        return { serialNumber: seriennummer, softwareVersion: software };
    });
});

// ---- Name eines Eingangs (INNM) ----
// Der einzige Class-2-Abfragebefehl mit Parameter: gefragt wird je Eingang.

ipcMain.handle('get-input-name', async (event, code) => {
    return class2(() => promisifyPJLinkCall(beamer.getInputName.bind(beamer), code));
});

// ---- Auflösung (IRES / RRES) ----

ipcMain.handle('get-resolutions', async () => {
    return class2(async () => {
        const [anliegend, empfohlen] = await Promise.all([
            promisifyPJLinkCall(beamer.getInputResolution.bind(beamer)),
            promisifyPJLinkCall(beamer.getRecommendedResolution.bind(beamer))
        ]);
        return { input: anliegend, recommended: empfohlen };
    });
});

// ---- Wartung (FILT / RLMP / RFIL) ----

ipcMain.handle('get-maintenance', async () => {
    if (!beamer) throw new Error('Nicht verbunden');

    // Einzeln abgesichert: ein Laserbeamer hat keine Wechsellampe und
    // antwortet auf RLMP mit ERR1, kennt aber sehr wohl die Filterstunden.
    const [filterStunden, lampen, filter] = await Promise.allSettled([
        promisifyPJLinkCall(beamer.getFilterUsage.bind(beamer)),
        promisifyPJLinkCall(beamer.getLampReplacements.bind(beamer)),
        promisifyPJLinkCall(beamer.getFilterReplacements.bind(beamer))
    ]);
    const alle = [filterStunden, lampen, filter];

    const unbekannt = (e) => e.status === 'rejected' && e.reason.message === KENNT_BEAMER_NICHT;

    // Kennt der Beamer keinen einzigen dieser Befehle, beherrscht er die
    // Funktion nicht — sie wird ausgegraut, statt drei leere Felder zu zeigen.
    if (alle.every(unbekannt)) {
        return { supported: false, reason: KENNT_BEAMER_NICHT };
    }

    // Ein echter Fehler (Zeitablauf, Passwort, Gerätestörung) darf nicht als
    // "dieser Wert fehlt eben" durchgehen.
    const echterFehler = alle.find((e) => e.status === 'rejected' && !unbekannt(e));
    if (echterFehler) throw new Error(echterFehler.reason.message);

    return {
        supported: true,
        value: {
            filterHours: filterStunden.status === 'fulfilled' ? filterStunden.value : null,
            lampModels: lampen.status === 'fulfilled' ? (lampen.value || []) : [],
            filterModels: filter.status === 'fulfilled' ? (filter.value || []) : []
        }
    };
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
            if (iface.family !== 'IPv4' || iface.internal) continue;
            // 169.254.x.x vergibt sich ein Gerät selbst, wenn es keine Adresse
            // bekommen hat. Dort steht garantiert kein Beamer — die 254 Adressen
            // zu prüfen kostet nur Zeit.
            if (iface.address.startsWith('169.254.')) continue;
            const parts = iface.address.split('.');
            subnets.push(parts.slice(0, 3).join('.'));
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
    const TIMEOUT = 900; // ms pro Host — Beamer im Standby antworten träge
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
