// The search for projectors on the network.
//
// This used to sit in main.js, and a search that found nothing was the only
// answer it could give. Three different situations came out looking the same:
//
//   * the search ran through the whole subnet and no projector answered,
//   * this computer was not on a network at all, so there was nothing to
//     search — that threw, and the window turned the exception into the very
//     same "no projector found" screen,
//   * every single address was blocked or unreachable, which is what a macOS
//     that has not been given permission for the local network looks like.
//
// The third one was invisible because the port check threw its error code
// away. So the scan says now how far it got, what it found, and why the
// addresses that did not answer did not answer.
//
// Everything it needs from the outside world is handed in: the local subnets,
// a port check, and a way to ask a device for its name. That keeps the tests
// off the network entirely.
//
// `checkPort(host, port)` answers `{ open: true }` or `{ open: false, code }`,
// where code is the operating system's ("ECONNREFUSED", "EHOSTUNREACH") or
// "TIMEOUT" when nothing came back at all.

const ADDRESSES_PER_SUBNET = 254; // .1 to .254 — .0 and .255 are not hosts

// How often the progress travels to the window. Every single address would be
// 254 messages per subnet for a bar that only has so many pixels.
const REPORT_EVERY = 10;

function createScanner({ subnets, checkPort, getName }) {
    async function scan({ port, report }) {
        const nets = subnets();

        const total = nets.length * ADDRESSES_PER_SUBNET;
        let checked = 0;
        const openHosts = [];
        const devices = [];
        // Error code -> how many addresses answered with it.
        const failures = {};

        // The window may have been closed while the scan was still running.
        // That is not a fault of the search, and it must not end it.
        const send = () => {
            try {
                report({ checked, total, devices: [...devices], failures: { ...failures } });
            } catch (error) {
                // Nobody is listening any more. Carry on.
            }
        };

        // Before the first address, not after the tenth. Until this was here
        // the window had no total to show and stood at "0 of 0 addresses
        // checked" for the whole first second — and for ever if the checks
        // hung, which is exactly the case where somebody needs to see what is
        // going on.
        send();

        // No network, nothing to search. Not an exception: a laptop whose
        // Wi-Fi is off is an ordinary situation with its own answer, and it
        // deserves a different screen than a fruitless search.
        if (nets.length === 0) {
            return { problem: 'no-network', devices: [], checked: 0, total: 0, failures };
        }

        for (const subnet of nets) {
            const checks = [];
            for (let i = 1; i <= ADDRESSES_PER_SUBNET; i++) {
                const host = `${subnet}.${i}`;
                checks.push(
                    checkPort(host, port).then((answer) => {
                        checked++;
                        if (answer.open) {
                            openHosts.push(host);
                        } else {
                            const code = answer.code || 'UNKNOWN';
                            failures[code] = (failures[code] || 0) + 1;
                        }
                        if (checked % REPORT_EVERY === 0) send();
                    })
                );
            }
            await Promise.all(checks);
        }
        send();

        // For every host that answered, ask for its name — best effort. A
        // device that will not say is still a device.
        for (const host of openHosts) {
            const name = await getName(host, port);
            devices.push({ host, port, name: name || null });
            send();
        }

        return { problem: null, devices, checked, total, failures };
    }

    return { scan };
}

module.exports = { createScanner, ADDRESSES_PER_SUBNET };
