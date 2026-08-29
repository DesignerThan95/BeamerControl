const test = require('node:test');
const assert = require('node:assert');
const { buildIco } = require('../tools/ico.js');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A PNG only as far as this matters here: signature, then an IHDR chunk whose
// width and height are where the writer looks for them. The bytes after that
// stand in for the image data.
function fakePng(width, height, filler = 40) {
    const head = Buffer.alloc(24);
    PNG_MAGIC.copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(width, 16);
    head.writeUInt32BE(height, 20);
    return Buffer.concat([head, Buffer.alloc(filler, 0x7f)]);
}

test('the header says how many images are in the file', () => {
    const ico = buildIco([fakePng(16, 16), fakePng(32, 32), fakePng(48, 48)]);

    assert.strictEqual(ico.readUInt16LE(0), 0, 'reserved');
    assert.strictEqual(ico.readUInt16LE(2), 1, 'type 1 = icon');
    assert.strictEqual(ico.readUInt16LE(4), 3, 'three images');
});

test('the size is read out of the image, not taken on trust', () => {
    const ico = buildIco([fakePng(48, 48)]);

    assert.strictEqual(ico.readUInt8(6), 48, 'width');
    assert.strictEqual(ico.readUInt8(7), 48, 'height');
});

test('256 pixels is written as zero, the way the format demands', () => {
    // A byte cannot hold 256. The format's answer is 0, and a reader that does
    // not know that sees a 0x0 icon.
    const ico = buildIco([fakePng(256, 256)]);

    assert.strictEqual(ico.readUInt8(6), 0);
    assert.strictEqual(ico.readUInt8(7), 0);
});

test('every entry points at its own image', () => {
    const images = [fakePng(16, 16), fakePng(32, 32)];
    const ico = buildIco(images);

    images.forEach((png, i) => {
        const entry = 6 + i * 16;
        const length = ico.readUInt32LE(entry + 8);
        const offset = ico.readUInt32LE(entry + 12);

        assert.strictEqual(length, png.length, 'declared length matches the image');
        assert.deepStrictEqual(
            ico.subarray(offset, offset + png.length), png,
            'the offset lands on the image itself'
        );
    });
});

test('the first image starts after the header and all entries', () => {
    const ico = buildIco([fakePng(16, 16), fakePng(32, 32)]);
    assert.strictEqual(ico.readUInt32LE(6 + 12), 6 + 2 * 16);
});

test('an image wider than 256 pixels is refused', () => {
    // Not a size the format can express. Silently writing a 0 here would
    // produce a file that looks fine and shows the wrong icon.
    assert.throws(() => buildIco([fakePng(512, 512)]), /256/);
});

test('something that is not a PNG is refused', () => {
    assert.throws(() => buildIco([Buffer.alloc(64, 1)]), /PNG/);
});

test('a file with no images at all is refused', () => {
    assert.throws(() => buildIco([]), /no images/i);
});
