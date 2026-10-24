// Device profiles: what a particular projector model really does, where that
// differs from what PJLink promises. One JSON file per model in devices/ —
// see devices/README.md for the format.
//
// A profile is matched on the answers to INF1 (manufacturer) and INF2
// (model). Without one, the standard applies.
const fs = require('fs');
const path = require('path');

const DEVICES_DIR = path.join(__dirname, '..', 'devices');

// What PJLink promises: picture and sound separately, every command answered.
const STANDARD_MUTE = Object.freeze({
    picture: 'separate',
    combinedAcknowledged: true,
    audioWhileCombined: true,
    toggles: false
});

function normalizeMute(raw) {
    const mute = Object.assign({}, STANDARD_MUTE);
    if (!raw) return mute;
    if (typeof raw !== 'object') return null;

    if (raw.picture !== undefined) {
        if (raw.picture !== 'separate' && raw.picture !== 'combined') return null;
        mute.picture = raw.picture;
    }
    for (const key of ['combinedAcknowledged', 'audioWhileCombined', 'toggles']) {
        if (raw[key] !== undefined) {
            if (typeof raw[key] !== 'boolean') return null;
            mute[key] = raw[key];
        }
    }
    return mute;
}

// A profile as the app uses it, or a reason why the file is not one.
function normalizeProfile(raw) {
    if (!raw || typeof raw !== 'object') return { problem: 'not an object' };
    if (typeof raw.name !== 'string' || !raw.name.trim()) return { problem: '"name" is missing' };

    const match = raw.match || {};
    if (typeof match.manufacturer !== 'string' || typeof match.model !== 'string') {
        return { problem: '"match" needs "manufacturer" and "model"' };
    }

    const mute = normalizeMute(raw.mute);
    if (!mute) return { problem: '"mute" has a value the app does not know' };

    return {
        profile: {
            name: raw.name.trim(),
            match: { manufacturer: match.manufacturer, model: match.model },
            mute: mute
        }
    };
}

// Reads every profile in the directory. A broken file is reported and
// skipped — one bad profile must not cost the others.
function loadProfiles(directory) {
    const dir = directory || DEVICES_DIR;
    const profiles = [];
    const problems = [];

    let files;
    try {
        files = fs.readdirSync(dir).filter(function (name) { return name.endsWith('.json'); }).sort();
    } catch (error) {
        problems.push({ file: dir, reason: error.message });
        return { profiles, problems };
    }

    for (const name of files) {
        try {
            const result = normalizeProfile(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')));
            if (result.profile) profiles.push(result.profile);
            else problems.push({ file: name, reason: result.problem });
        } catch (error) {
            problems.push({ file: name, reason: error.message });
        }
    }

    return { profiles, problems };
}

function same(a, b) {
    return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function matchProfile(profiles, identity) {
    if (!identity) return null;
    return profiles.find(function (p) {
        return same(p.match.manufacturer, identity.manufacturer) && same(p.match.model, identity.model);
    }) || null;
}

module.exports = { loadProfiles, matchProfile, normalizeProfile, STANDARD_MUTE, DEVICES_DIR };
