// Packt fertige PNGs in eine Windows-ICO-Datei.
//
// macOS bringt für .icns das Werkzeug `iconutil` mit, für .ico gibt es kein
// Gegenstück. Das Format ist aber schlicht genug, um es hier zu schreiben,
// statt dafür eine Abhängigkeit aufzunehmen:
//
//   6 Byte Kopf, dann 16 Byte pro Bild, dann die Bilder am Stück.
//
// Seit Windows Vista dürfen die Bilder PNGs sein und müssen keine BMPs mehr
// sein — genau das nutzen wir hier, sonst müsste noch ein BMP-Kodierer dazu.
//
// Die Größe wird aus dem PNG selbst gelesen und nicht vom Aufrufer
// entgegengenommen. Eine Datei, in der die angegebene Größe nicht zum Bild
// passt, sieht heil aus und zeigt das falsche Symbol — dieser Fehler soll hier
// gar nicht erst möglich sein.

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

// Im PNG stehen Breite und Höhe im IHDR-Block, direkt hinter Signatur,
// Blocklänge und Blockname.
function readPngSize(png) {
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_MAGIC)) {
        throw new Error('Not a PNG');
    }
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// 256 passt nicht in ein Byte. Die Antwort des Formats darauf ist die 0.
function sizeByte(value) {
    if (value > 256) {
        throw new Error(`An icon may be at most 256 pixels, this one is ${value}`);
    }
    return value === 256 ? 0 : value;
}

function buildIco(pngs) {
    if (!pngs || pngs.length === 0) {
        throw new Error('An icon file with no images is not a file');
    }

    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt16LE(0, 0); // reserviert
    header.writeUInt16LE(1, 2); // 1 = Symbol (2 wäre ein Mauszeiger)
    header.writeUInt16LE(pngs.length, 4);

    // Die Bilder folgen hinter Kopf und allen Einträgen.
    let offset = HEADER_BYTES + pngs.length * ENTRY_BYTES;

    const entries = pngs.map((png) => {
        const { width, height } = readPngSize(png);
        const entry = Buffer.alloc(ENTRY_BYTES);

        entry.writeUInt8(sizeByte(width), 0);
        entry.writeUInt8(sizeByte(height), 1);
        entry.writeUInt8(0, 2);  // Farbanzahl der Palette — bei Echtfarbe 0
        entry.writeUInt8(0, 3);  // reserviert
        entry.writeUInt16LE(1, 4);  // Ebenen
        entry.writeUInt16LE(32, 6); // Bit pro Bildpunkt, mit Alpha
        entry.writeUInt32LE(png.length, 8);
        entry.writeUInt32LE(offset, 12);

        offset += png.length;
        return entry;
    });

    return Buffer.concat([header, ...entries, ...pngs]);
}

module.exports = { buildIco };
