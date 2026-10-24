// What the PJLink console on the technical page knows about the protocol: how
// a line has to look, which commands it offers as templates, and what the
// common answers mean. No network in here — lib/raw-console.js does the
// talking.
//
// Meanings come back as translation keys under tech.console.meaning, never as
// text: the main process does not speak the user's language, the window does.

// Spec 2.1: header, class, four characters of command body, a space, and a
// parameter of at most 128 bytes.
const MAX_PARAMETER = 128;

function parseLine(text) {
    const line = String(text == null ? '' : text).replace(/\r/g, '').trim();

    if (line.charAt(0) !== '%') return { error: 'prefix' };
    if (line.charAt(1) !== '1' && line.charAt(1) !== '2') return { error: 'class' };

    const cmd = line.slice(2, 6).toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(cmd)) return { error: 'command' };

    const param = line.slice(7);
    if (line.charAt(6) !== ' ' || param.charAt(0) === ' ') return { error: 'separator' };
    if (param.length < 1 || param.length > MAX_PARAMETER) return { error: 'parameter' };

    return { cls: Number(line.charAt(1)), cmd: cmd, param: param };
}

function toLine(parts) {
    return '%' + parts.cls + parts.cmd + ' ' + parts.param;
}

// The description of each template lives in the language files under
// tech.console.templates.<id>.
const TEMPLATES = [
    { id: 'powrQuery', cls: 1, cmd: 'POWR', param: '?' },
    { id: 'powrOn', cls: 1, cmd: 'POWR', param: '1' },
    { id: 'powrOff', cls: 1, cmd: 'POWR', param: '0' },
    { id: 'inptQuery', cls: 1, cmd: 'INPT', param: '?' },
    { id: 'inptSet', cls: 1, cmd: 'INPT', param: '31' },
    { id: 'avmtQuery', cls: 1, cmd: 'AVMT', param: '?' },
    { id: 'avmt10', cls: 1, cmd: 'AVMT', param: '10' },
    { id: 'avmt11', cls: 1, cmd: 'AVMT', param: '11' },
    { id: 'avmt20', cls: 1, cmd: 'AVMT', param: '20' },
    { id: 'avmt21', cls: 1, cmd: 'AVMT', param: '21' },
    { id: 'avmt30', cls: 1, cmd: 'AVMT', param: '30' },
    { id: 'avmt31', cls: 1, cmd: 'AVMT', param: '31' },
    { id: 'erstQuery', cls: 1, cmd: 'ERST', param: '?' },
    { id: 'lampQuery', cls: 1, cmd: 'LAMP', param: '?' },
    { id: 'instQuery', cls: 1, cmd: 'INST', param: '?' },
    { id: 'nameQuery', cls: 1, cmd: 'NAME', param: '?' },
    { id: 'inf1Query', cls: 1, cmd: 'INF1', param: '?' },
    { id: 'inf2Query', cls: 1, cmd: 'INF2', param: '?' },
    { id: 'infoQuery', cls: 1, cmd: 'INFO', param: '?' },
    { id: 'clssQuery', cls: 1, cmd: 'CLSS', param: '?' },
    { id: 'snumQuery', cls: 2, cmd: 'SNUM', param: '?' },
    { id: 'sverQuery', cls: 2, cmd: 'SVER', param: '?' },
    { id: 'innmQuery', cls: 2, cmd: 'INNM', param: '?31' },
    { id: 'iresQuery', cls: 2, cmd: 'IRES', param: '?' },
    { id: 'rresQuery', cls: 2, cmd: 'RRES', param: '?' },
    { id: 'filtQuery', cls: 2, cmd: 'FILT', param: '?' },
    { id: 'rlmpQuery', cls: 2, cmd: 'RLMP', param: '?' },
    { id: 'rfilQuery', cls: 2, cmd: 'RFIL', param: '?' },
    { id: 'frezQuery', cls: 2, cmd: 'FREZ', param: '?' },
    { id: 'frezOn', cls: 2, cmd: 'FREZ', param: '1' },
    { id: 'frezOff', cls: 2, cmd: 'FREZ', param: '0' },
    { id: 'svolUp', cls: 2, cmd: 'SVOL', param: '1' },
    { id: 'svolDown', cls: 2, cmd: 'SVOL', param: '0' },
    { id: 'mvolUp', cls: 2, cmd: 'MVOL', param: '1' },
    { id: 'mvolDown', cls: 2, cmd: 'MVOL', param: '0' }
];

const ANSWER_KEYS = { OK: 'ok', ERR1: 'err1', ERR2: 'err2', ERR3: 'err3', ERR4: 'err4', ERRA: 'erra' };

// Spec 4.8: six digits, in this order, each 0 (fine), 1 (warning) or 2 (error).
const ERST_PARTS = ['fan', 'lamp', 'temperature', 'cover', 'filter', 'other'];
const ERST_LEVELS = { '1': 'warning', '2': 'error' };

function describeErrors(answer) {
    if (!/^[012]{6}$/.test(answer)) return null;

    const items = [];
    for (let i = 0; i < ERST_PARTS.length; i++) {
        const level = ERST_LEVELS[answer.charAt(i)];
        if (level) items.push({ key: 'erstItems.' + ERST_PARTS[i] + '.' + level });
    }
    return items.length ? { key: 'erstHead', items: items } : { key: 'erstNone' };
}

// Spec 4.9: pairs of operating hours and 1/0 for on/off, one pair per lamp.
function describeLamps(answer) {
    const parts = answer.split(' ');
    if (parts.length % 2 !== 0) return null;

    const items = [];
    for (let i = 0; i < parts.length; i += 2) {
        const hours = parts[i];
        const on = parts[i + 1];
        if (!/^\d{1,5}$/.test(hours) || !/^[01]$/.test(on)) return null;
        items.push({
            key: on === '1' ? 'lampOn' : 'lampOff',
            values: { number: String(i / 2 + 1), hours: String(Number(hours)) }
        });
    }
    return { key: 'lampHead', items: items };
}

// Spec 4.10: the available inputs, separated by spaces — each one read the way
// INPT is.
function describeInputs(answer) {
    const codes = answer.split(' ');
    if (!codes.every(function (c) { return /^[1-6][1-9A-Z]$/.test(c); })) return null;

    return {
        key: 'instHead',
        items: codes.map(function (c) { return { key: 'inpt' + c.charAt(0), values: { number: c.charAt(1) } }; })
    };
}

// What an answer means, as { key, values?, items? } — or null when there is
// nothing to say beyond the answer itself.
function describe(cmd, answer) {
    if (typeof answer !== 'string') return null;
    if (ANSWER_KEYS[answer]) return { key: ANSWER_KEYS[answer] };

    switch (cmd) {
        case 'POWR': return /^[0-3]$/.test(answer) ? { key: 'powr' + answer } : null;
        case 'AVMT': return /^(10|11|20|21|30|31)$/.test(answer) ? { key: 'avmt' + answer } : null;
        // Some devices answer "Class 1" instead of the bare digit (the Optoma
        // 1080p does) — it means the same.
        case 'CLSS': {
            const m = /^(?:class\s*)?([12])$/i.exec(answer);
            return m ? { key: 'clss', values: { cls: m[1] } } : null;
        }
        case 'FREZ': return /^[01]$/.test(answer) ? { key: 'frez' + answer } : null;
        // Spec 4.3: the first digit is the kind of connector, the second which
        // one — 1-9 in Class 1, 1-9 and A-Z in Class 2.
        case 'INPT': return /^[1-6][1-9A-Z]$/.test(answer)
            ? { key: 'inpt' + answer.charAt(0), values: { number: answer.charAt(1) } }
            : null;
        case 'INST': return describeInputs(answer);
        case 'ERST': return describeErrors(answer);
        case 'LAMP': return describeLamps(answer);
        default: return null;
    }
}

// The same for a whole line as the projector sent it, e.g. "%1AVMT=31".
function describeLine(raw) {
    if (typeof raw !== 'string' || raw.charAt(0) !== '%' || raw.charAt(6) !== '=') return null;
    return describe(raw.slice(2, 6).toUpperCase(), raw.slice(7));
}

module.exports = { parseLine, toLine, describe, describeLine, TEMPLATES, MAX_PARAMETER };
