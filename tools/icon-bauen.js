// Erzeugt build/icon.icns und build/icon.ico aus den beiden SVG-Zeichnungen.
//
//   npm run icon
//
// Gerendert wird mit Electron. Das ist keine Kür: rsvg-convert, ImageMagick,
// Inkscape und Pillow fehlen auf dieser Maschine, Electron ist als
// devDependency ohnehin da — und Electron ist Chromium. Damit rendert das Icon
// mit derselben Engine, die auch die App zeichnet, und niemand muss vorher
// etwas installieren.
//
// Gezeichnet wird über ein Canvas in fester Pixelgröße, nicht über einen
// Screenshot des Fensters. Ein Screenshot käme auf einem Retina-Bildschirm in
// doppelter Auflösung zurück und auf einem anderen Rechner in einfacher — das
// Ergebnis hinge dann am Monitor dessen, der es gebaut hat.

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { buildIco } = require('./ico.js');

const BUILD = path.join(__dirname, '..', 'build');

// Bis 64 Pixel die vereinfachte Zeichnung, ab 128 die volle. Warum, steht in
// docs/superpowers/specs/2026-08-29-app-icon-design.md.
const KLEIN_BIS = 64;

// Apples Namensschema für einen .iconset-Ordner. Links der Dateiname, rechts
// die Kantenlänge, die tatsächlich gerendert werden muss — bei @2x also das
// Doppelte des Namens.
const ICONSET = {
    'icon_16x16.png': 16,
    'icon_16x16@2x.png': 32,
    'icon_32x32.png': 32,
    'icon_32x32@2x.png': 64,
    'icon_128x128.png': 128,
    'icon_128x128@2x.png': 256,
    'icon_256x256.png': 256,
    'icon_256x256@2x.png': 512,
    'icon_512x512.png': 512,
    'icon_512x512@2x.png': 1024
};

// Windows. 48 kommt nur dort vor (Ansicht „große Symbole"), 256 ist die
// Größe, die electron-builder für den Installer verlangt.
const ICO_GROESSEN = [16, 32, 48, 64, 256];

function svgAlsBase64(datei) {
    return fs.readFileSync(path.join(BUILD, datei)).toString('base64');
}

async function rendern(fenster, base64, groesse) {
    const dataUrl = await fenster.webContents.executeJavaScript(`
        (async () => {
            const bild = new Image();
            bild.src = 'data:image/svg+xml;base64,${base64}';
            await bild.decode();
            const flaeche = document.createElement('canvas');
            flaeche.width = ${groesse};
            flaeche.height = ${groesse};
            // Ohne dst-Größe würde Chromium die Eigengröße des SVG nehmen.
            flaeche.getContext('2d').drawImage(bild, 0, 0, ${groesse}, ${groesse});
            return flaeche.toDataURL('image/png');
        })()
    `);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function main() {
    const voll = svgAlsBase64('icon.svg');
    const klein = svgAlsBase64('icon-klein.svg');

    const fenster = new BrowserWindow({ show: false, width: 200, height: 200 });
    await fenster.loadURL('about:blank');

    // Jede Kantenlänge nur einmal rendern, auch wenn sie mehrfach gebraucht
    // wird — 32 etwa steckt in icon_16x16@2x und in icon_32x32.
    const gebraucht = [...new Set([...Object.values(ICONSET), ...ICO_GROESSEN])].sort((a, b) => a - b);
    const bilder = new Map();
    for (const groesse of gebraucht) {
        bilder.set(groesse, await rendern(fenster, groesse <= KLEIN_BIS ? klein : voll, groesse));
        console.log(`  ${groesse}×${groesse}  ${groesse <= KLEIN_BIS ? 'vereinfacht' : 'voll'}`);
    }

    // ---- macOS ----
    const iconset = path.join(BUILD, 'icon.iconset');
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset);
    for (const [name, groesse] of Object.entries(ICONSET)) {
        fs.writeFileSync(path.join(iconset, name), bilder.get(groesse));
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')]);
    // Der Ordner war nur Zwischenlager für iconutil.
    fs.rmSync(iconset, { recursive: true, force: true });
    console.log('build/icon.icns');

    // ---- Windows ----
    fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(ICO_GROESSEN.map((g) => bilder.get(g))));
    console.log('build/icon.ico');
}

app.whenReady()
    .then(main)
    .then(() => app.exit(0))
    .catch((fehler) => {
        console.error(fehler);
        app.exit(1);
    });
