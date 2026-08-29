const test = require('node:test');
const assert = require('node:assert');
const { scanLogLine, failureSummary } = require('../renderer/js/scan-report.js');

test('a search that found nothing says why the addresses stayed silent', () => {
    const line = scanLogLine({
        problem: null,
        devices: [],
        checked: 254,
        total: 254,
        failures: { EHOSTUNREACH: 254 }
    });

    // This is the line that would have settled the whole question: 254 times
    // "no route to host" is a network or a permission, not an absent projector.
    assert.match(line.text, /EHOSTUNREACH 254/);
    assert.match(line.text, /254 addresses checked/);
});

test('the reasons are ordered by how often they came up', () => {
    assert.strictEqual(
        failureSummary({ ECONNREFUSED: 1, EHOSTUNREACH: 252, TIMEOUT: 3 }),
        'EHOSTUNREACH 252, TIMEOUT 3, ECONNREFUSED 1'
    );
});

test('no failures at all leave the summary empty', () => {
    assert.strictEqual(failureSummary({}), '');
});

test('a computer on no network is told apart from a fruitless search', () => {
    const line = scanLogLine({ problem: 'no-network', devices: [], checked: 0, total: 0, failures: {} });

    assert.match(line.text, /no network/i);
    assert.strictEqual(line.level, 'error');
});

test('a search that found something reports it as a success', () => {
    const line = scanLogLine({
        problem: null,
        devices: [{ host: '10.150.10.7', port: 4352, name: 'Beamer' }],
        checked: 254,
        total: 254,
        failures: { EHOSTUNREACH: 253 }
    });

    assert.strictEqual(line.level, 'ok');
    assert.match(line.text, /1 device/);
    // The 253 addresses without a projector behind them are the normal case
    // here and would only bury the one line that matters.
    assert.doesNotMatch(line.text, /EHOSTUNREACH/);
});

test('an empty search is not an error — the projector may simply be off', () => {
    const line = scanLogLine({ problem: null, devices: [], checked: 254, total: 254, failures: {} });
    assert.strictEqual(line.level, 'info');
});

test('a result from an older shape does not break the line', () => {
    const line = scanLogLine({ devices: [] });
    assert.strictEqual(typeof line.text, 'string');
    assert.strictEqual(line.level, 'info');
});
