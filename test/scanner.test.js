const test = require('node:test');
const assert = require('node:assert');
const { createScanner } = require('../lib/scanner.js');

// Stand-ins for the three things the scanner needs from the outside world: the
// local subnets, a port check, and a device name. None of them touch a network
// here, so the whole scan runs in a few milliseconds.

// Records every progress report so a test can look at the first one.
function recorder() {
    const reports = [];
    return { reports, report: (p) => reports.push(p) };
}

// A port check that answers from a table: host -> true (open) or an error code.
function portsFrom(table) {
    return async function (host) {
        const answer = table[host];
        if (answer === true) return { open: true };
        return { open: false, code: answer || 'EHOSTUNREACH' };
    };
}

test('the number of addresses is reported before the first one is checked', async () => {
    const seen = recorder();
    let checksStarted = 0;
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: async () => { checksStarted++; return { open: false, code: 'EHOSTUNREACH' }; },
        getName: async () => null
    });

    await scanner.scan({ port: 4352, report: seen.report });

    // This is the "0 von 0" bug: the window learned the total only once ten
    // addresses had been checked, so a scan that stalled early showed nothing
    // to go by.
    assert.ok(seen.reports.length > 0, 'a scan has to report before it starts working');
    assert.deepStrictEqual(
        { checked: seen.reports[0].checked, total: seen.reports[0].total },
        { checked: 0, total: 254 }
    );
    assert.strictEqual(checksStarted, 254, 'every address in the subnet gets checked');
});

test('two subnets are counted together in the total', async () => {
    const seen = recorder();
    const scanner = createScanner({
        subnets: () => ['10.150.10', '192.168.1'],
        checkPort: portsFrom({}),
        getName: async () => null
    });

    const result = await scanner.scan({ port: 4352, report: seen.report });

    assert.strictEqual(seen.reports[0].total, 508);
    assert.strictEqual(result.total, 508);
    assert.strictEqual(result.checked, 508, 'the last report has to reach the total');
});

test('a computer that is on no network says so instead of finding nothing', async () => {
    const scanner = createScanner({
        subnets: () => [],
        checkPort: portsFrom({}),
        getName: async () => null
    });

    const result = await scanner.scan({ port: 4352, report: () => {} });

    // Used to throw. The window caught that and showed the same "no projector
    // found" screen as a scan that had searched the whole subnet in vain —
    // two very different situations, one answer.
    assert.strictEqual(result.problem, 'no-network');
    assert.deepStrictEqual(result.devices, []);
});

test('without a network not a single address is checked', async () => {
    let checks = 0;
    const scanner = createScanner({
        subnets: () => [],
        checkPort: async () => { checks++; return { open: false, code: 'EHOSTUNREACH' }; },
        getName: async () => null
    });

    await scanner.scan({ port: 4352, report: () => {} });

    assert.strictEqual(checks, 0);
});

test('a scan that found something reports no problem', async () => {
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: portsFrom({ '10.150.10.7': true }),
        getName: async () => 'Beamer Kirchsaal'
    });

    const result = await scanner.scan({ port: 4352, report: () => {} });

    assert.strictEqual(result.problem, null);
    assert.deepStrictEqual(result.devices, [
        { host: '10.150.10.7', port: 4352, name: 'Beamer Kirchsaal' }
    ]);
});

test('a device that will not give its name is still on the list', async () => {
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: portsFrom({ '10.150.10.7': true }),
        getName: async () => null
    });

    const result = await scanner.scan({ port: 4352, report: () => {} });

    assert.deepStrictEqual(result.devices, [{ host: '10.150.10.7', port: 4352, name: null }]);
});

test('why the addresses did not answer is counted, not swallowed', async () => {
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: async (host) => {
            if (host === '10.150.10.7') return { open: true };
            if (host === '10.150.10.8') return { open: false, code: 'ECONNREFUSED' };
            return { open: false, code: 'EHOSTUNREACH' };
        },
        getName: async () => null
    });

    const result = await scanner.scan({ port: 4352, report: () => {} });

    // 254 addresses: one open, one refused, the rest unreachable. Without these
    // counts a whole subnet blocked by the operating system looks exactly like
    // a subnet with no projector in it.
    assert.deepStrictEqual(result.failures, { ECONNREFUSED: 1, EHOSTUNREACH: 252 });
});

test('a check that answers without a code is counted under a name, not undefined', async () => {
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: async () => ({ open: false }),
        getName: async () => null
    });

    const result = await scanner.scan({ port: 4352, report: () => {} });

    assert.deepStrictEqual(result.failures, { UNKNOWN: 254 });
});

test('the found devices travel along with the progress', async () => {
    const seen = recorder();
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: portsFrom({ '10.150.10.7': true }),
        getName: async () => 'Beamer'
    });

    await scanner.scan({ port: 4352, report: seen.report });

    const last = seen.reports[seen.reports.length - 1];
    assert.deepStrictEqual(last.devices, [{ host: '10.150.10.7', port: 4352, name: 'Beamer' }]);
});

test('a report that throws does not bring the scan down', async () => {
    const scanner = createScanner({
        subnets: () => ['10.150.10'],
        checkPort: portsFrom({ '10.150.10.7': true }),
        getName: async () => null
    });

    // In the app the report goes to a window that may have been closed in the
    // meantime. The scan is not the place where that ends up as a mishap.
    const result = await scanner.scan({
        port: 4352,
        report: () => { throw new Error('window is gone'); }
    });

    assert.strictEqual(result.devices.length, 1);
});
