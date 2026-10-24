const test = require('node:test');
const assert = require('node:assert');
const { parseLine, toLine, describe, describeLine, TEMPLATES } = require('../lib/pjlink-reference.js');
const de = require('../locales/de.json');
const en = require('../locales/en.json');

// ---------------------------------------------------------------------------
// What counts as a line (spec 2.1)
// ---------------------------------------------------------------------------

test('a Class 1 query is taken apart', () => {
    assert.deepStrictEqual(parseLine('%1AVMT ?'), { cls: 1, cmd: 'AVMT', param: '?' });
});

test('a Class 2 line with a longer parameter is taken apart', () => {
    assert.deepStrictEqual(parseLine('%2INNM ?31'), { cls: 2, cmd: 'INNM', param: '?31' });
});

test('the command may be typed in lower case', () => {
    assert.deepStrictEqual(parseLine('%1avmt 21'), { cls: 1, cmd: 'AVMT', param: '21' });
});

test('surrounding spaces and a typed CR do not count', () => {
    assert.deepStrictEqual(parseLine('  %1POWR ?\r '), { cls: 1, cmd: 'POWR', param: '?' });
});

test('each way of getting a line wrong has its own reason', () => {
    assert.deepStrictEqual(parseLine('1AVMT ?'), { error: 'prefix' });
    assert.deepStrictEqual(parseLine(''), { error: 'prefix' });
    assert.deepStrictEqual(parseLine(null), { error: 'prefix' });
    assert.deepStrictEqual(parseLine('%3AVMT ?'), { error: 'class' });
    assert.deepStrictEqual(parseLine('%1AVM ?'), { error: 'command' });
    assert.deepStrictEqual(parseLine('%1AVMT?'), { error: 'separator' });
    assert.deepStrictEqual(parseLine('%1AVMT  ?'), { error: 'separator' });
    assert.deepStrictEqual(parseLine('%1AVMT'), { error: 'separator' });
    assert.deepStrictEqual(parseLine('%1NAME ' + 'x'.repeat(129)), { error: 'parameter' });
});

test('128 characters of parameter are still allowed', () => {
    assert.strictEqual(parseLine('%1NAME ' + 'x'.repeat(128)).param.length, 128);
});

test('the parts go back together into the wire line', () => {
    assert.strictEqual(toLine(parseLine('%1avmt 21')), '%1AVMT 21');
});

// ---------------------------------------------------------------------------
// What answers mean
// ---------------------------------------------------------------------------

test('the mute states are named', () => {
    assert.deepStrictEqual(describeLine('%1AVMT=31'), { key: 'avmt31' });
    assert.deepStrictEqual(describeLine('%1AVMT=21'), { key: 'avmt21' });
    assert.deepStrictEqual(describeLine('%1AVMT=11'), { key: 'avmt11' });
    assert.deepStrictEqual(describeLine('%1AVMT=30'), { key: 'avmt30' });
});

test('error answers are named for any command', () => {
    assert.deepStrictEqual(describeLine('%1AVMT=ERR2'), { key: 'err2' });
    assert.deepStrictEqual(describeLine('%2FREZ=ERR1'), { key: 'err1' });
    assert.deepStrictEqual(describeLine('%1POWR=OK'), { key: 'ok' });
});

test('power, class, freeze and input are named', () => {
    assert.deepStrictEqual(describe('POWR', '3'), { key: 'powr3' });
    assert.deepStrictEqual(describe('CLSS', '2'), { key: 'clss', values: { cls: '2' } });
    assert.deepStrictEqual(describe('FREZ', '1'), { key: 'frez1' });
    assert.deepStrictEqual(describe('INPT', '31'), { key: 'inpt3', values: { number: '1' } });
    assert.deepStrictEqual(describe('INPT', '6Z'), { key: 'inpt6', values: { number: 'Z' } });
});

test('a class answered as "Class 1" is named too', () => {
    assert.deepStrictEqual(describe('CLSS', 'Class 1'), { key: 'clss', values: { cls: '1' } });
    assert.deepStrictEqual(describe('CLSS', 'class2'), { key: 'clss', values: { cls: '2' } });
    assert.strictEqual(describe('CLSS', 'Class 3'), null);
});

test('the list of inputs is named input by input', () => {
    assert.deepStrictEqual(describe('INST', '11 21 31 32'), {
        key: 'instHead',
        items: [
            { key: 'inpt1', values: { number: '1' } },
            { key: 'inpt2', values: { number: '1' } },
            { key: 'inpt3', values: { number: '1' } },
            { key: 'inpt3', values: { number: '2' } }
        ]
    });
    assert.strictEqual(describe('INST', '11 x'), null);
});

test('the error status names only what is wrong', () => {
    assert.deepStrictEqual(describe('ERST', '000000'), { key: 'erstNone' });
    assert.deepStrictEqual(describe('ERST', '010020'), {
        key: 'erstHead',
        items: [{ key: 'erstItems.lamp.warning' }, { key: 'erstItems.filter.error' }]
    });
});

test('every lamp gets its hours and its state', () => {
    assert.deepStrictEqual(describe('LAMP', '01234 1 99 0'), {
        key: 'lampHead',
        items: [
            { key: 'lampOn', values: { number: '1', hours: '1234' } },
            { key: 'lampOff', values: { number: '2', hours: '99' } }
        ]
    });
});

test('what is not understood gets no meaning rather than a wrong one', () => {
    assert.strictEqual(describe('AVMT', '41'), null);
    assert.strictEqual(describe('POWR', '7'), null);
    assert.strictEqual(describe('ERST', '0000'), null);
    assert.strictEqual(describe('LAMP', '12 1 5'), null);
    assert.strictEqual(describe('NAME', 'Beamer Kirche'), null);
    assert.strictEqual(describeLine('%1AVMT 31'), null);
    assert.strictEqual(describeLine('PJLINK ERRA'), null);
    assert.strictEqual(describeLine(undefined), null);
});

// ---------------------------------------------------------------------------
// Every key the console uses has a text
// ---------------------------------------------------------------------------

function lookup(tree, path) {
    return path.split('.').reduce(function (node, part) { return node && node[part]; }, tree);
}

const MEANING_SAMPLES = [
    ['AVMT', '10'], ['AVMT', '11'], ['AVMT', '20'], ['AVMT', '21'], ['AVMT', '30'], ['AVMT', '31'],
    ['POWR', '0'], ['POWR', '1'], ['POWR', '2'], ['POWR', '3'],
    ['CLSS', '1'], ['FREZ', '0'], ['FREZ', '1'],
    ['INPT', '11'], ['INPT', '21'], ['INPT', '31'], ['INPT', '41'], ['INPT', '51'], ['INPT', '61'],
    ['ERST', '000000'], ['ERST', '111111'], ['ERST', '222222'], ['LAMP', '1 1 2 0'], ['INST', '11 31'],
    ['X', 'OK'], ['X', 'ERR1'], ['X', 'ERR2'], ['X', 'ERR3'], ['X', 'ERR4'], ['X', 'ERRA']
];

for (const [name, locale] of [['German', de], ['English', en]]) {
    test('every template and every meaning has a ' + name + ' text', () => {
        const c = locale.tech.console;
        for (const t of TEMPLATES) {
            assert.strictEqual(typeof c.templates[t.id], 'string', 'template ' + t.id);
        }
        for (const [cmd, answer] of MEANING_SAMPLES) {
            const m = describe(cmd, answer);
            assert.strictEqual(typeof lookup(c.meaning, m.key), 'string', cmd + ' ' + answer + ' -> ' + m.key);
            for (const item of m.items || []) {
                assert.strictEqual(typeof lookup(c.meaning, item.key), 'string', item.key);
            }
        }
        for (const reason of ['prefix', 'class', 'command', 'separator', 'parameter']) {
            assert.strictEqual(typeof c.invalid[reason], 'string', 'invalid.' + reason);
        }
        for (const reason of ['not-connected', 'timeout', 'auth', 'connection']) {
            assert.strictEqual(typeof c.reason[reason], 'string', 'reason.' + reason);
        }
    });
}

test('template ids are unique and every template is a valid line', () => {
    const ids = TEMPLATES.map(function (t) { return t.id; });
    assert.strictEqual(new Set(ids).size, ids.length);
    for (const t of TEMPLATES) {
        assert.deepStrictEqual(parseLine(toLine(t)), { cls: t.cls, cmd: t.cmd, param: t.param });
    }
});
