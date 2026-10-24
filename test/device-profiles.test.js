const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadProfiles, matchProfile, normalizeProfile, STANDARD_MUTE } = require('../lib/device-profiles.js');

function directoryWith(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devices-'));
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
    }
    return dir;
}

test('the shipped profiles all load', () => {
    const { profiles, problems } = loadProfiles();
    assert.deepStrictEqual(problems, []);
    assert.ok(profiles.length >= 1);
});

test('the Optoma 1080p is found by what it answers to INF1 and INF2', () => {
    const { profiles } = loadProfiles();
    const optoma = matchProfile(profiles, { manufacturer: 'Optoma', model: 'Optoma 1080p' });
    assert.strictEqual(optoma.name, 'Optoma 1080p');
    assert.deepStrictEqual(optoma.mute, { picture: 'combined', combinedAcknowledged: false, audioWhileCombined: false, toggles: true });
});

test('matching ignores case and surrounding spaces, nothing else', () => {
    const profiles = [{ name: 'X', match: { manufacturer: 'Optoma', model: 'Optoma 1080p' }, mute: STANDARD_MUTE }];
    assert.ok(matchProfile(profiles, { manufacturer: ' OPTOMA ', model: 'optoma 1080P' }));
    assert.strictEqual(matchProfile(profiles, { manufacturer: 'Optoma', model: 'Optoma 1080' }), null);
    assert.strictEqual(matchProfile(profiles, { manufacturer: null, model: 'Optoma 1080p' }), null);
    assert.strictEqual(matchProfile(profiles, null), null);
});

test('what a profile leaves out keeps the standard', () => {
    const { profile } = normalizeProfile({ name: 'Y', match: { manufacturer: 'A', model: 'B' }, mute: { picture: 'combined' } });
    assert.deepStrictEqual(profile.mute, { picture: 'combined', combinedAcknowledged: true, audioWhileCombined: true, toggles: false });

    const bare = normalizeProfile({ name: 'Z', match: { manufacturer: 'A', model: 'B' } });
    assert.deepStrictEqual(bare.profile.mute, STANDARD_MUTE);
});

test('a broken profile is reported and skipped, the others load', () => {
    const dir = directoryWith({
        'good.json': { name: 'Good', match: { manufacturer: 'A', model: 'B' } },
        'no-json.json': '{ this is not json',
        'no-match.json': { name: 'No match' },
        'bad-value.json': { name: 'Bad', match: { manufacturer: 'A', model: 'C' }, mute: { picture: 'sometimes' } },
        'README.md': '# not a profile'
    });
    const { profiles, problems } = loadProfiles(dir);
    assert.deepStrictEqual(profiles.map(function (p) { return p.name; }), ['Good']);
    assert.deepStrictEqual(problems.map(function (p) { return p.file; }).sort(), ['bad-value.json', 'no-json.json', 'no-match.json']);
});

test('a missing directory is reported, not thrown', () => {
    const { profiles, problems } = loadProfiles(path.join(os.tmpdir(), 'no-such-devices-dir-' + process.pid));
    assert.deepStrictEqual(profiles, []);
    assert.strictEqual(problems.length, 1);
});
