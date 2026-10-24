# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] – Unreleased

A complete redesign. The single dashboard full of addresses, buttons and status
cards is gone; the person operating the projector now sees only what operates
the projector, and everything technical sits behind the gear icon.

### Added

- **Operating screen that follows the projector.** Off: one button. Warming up
  or cooling down: a waiting screen until the projector reports its new state.
  On: a tile per picture source, *Hide picture* and *Mute sound* as separate
  switches, and a red bar to switch off, with a confirmation.
- **Setup wizard** on first start: find the projector, check the connection,
  name the picture sources. An interrupted setup resumes where it stopped. If
  the search finds nothing, a plain checklist appears instead of an error.
- **Technical page** behind the gear icon: connection and connection test,
  network search, picture sources (rename, hide, reorder), appearance, and an
  activity log that can be copied.
- **Named picture sources** — "Laptop" instead of "HDMI 1".
- **Light and dark appearance**, following the operating system by default,
  plus a high-contrast mode for both.
- **English translation** and a language selector; the app follows the
  operating system's language. All texts live in `locales/` as JSON, so a new
  language needs no code.
- **PJLink Class 2**: input names, freeze, speaker and microphone volume,
  resolutions, filter usage and replacement parts, serial number and software
  version. The app asks the projector for its class and only offers what it
  supports.
- **SHA256 authentication** of PJLink 2.10, alongside the classic MD5
  procedure.
- **Class 2 broadcast search** (`%2SRCH`) in addition to the address sweep.
- **Device profiles** in `devices/`, matched on the manufacturer and model the
  projector reports. The first one describes the Optoma 1080p: its picture can
  only be hidden together with the sound, so the operating screen offers
  *Picture & sound off* next to a separate *Mute sound*, and does not wait for
  an acknowledgement the device never sends.
- **PJLink console** behind *Show expert tools* on the technical page: send a
  single PJLink line and see the raw answer and its meaning, with templates for
  the common Class 1 and Class 2 commands.
- The connecting screen says how many attempts are left. While the app is
  running, a quiet notice appears from the second unanswered poll in a row and
  goes away by itself when the projector answers again.
- The network search says what went wrong when it cannot run.
- An app icon of its own.
- macOS explains why the app asks for access to the local network.
- `PJLINK_TRACE=1` logs every line sent to and received from the projector.
- A unit test suite covering the PJLink wire format, the connection, the state
  machine, the settings, the network search and the translations.

### Changed

- **Updated to Electron 45** (from 27) and electron-builder 26.
- The app waits 3 s for an answer instead of 6, so a lost connection shows as
  "no contact" after about 20 s instead of 30.
- After every command the app checks back every second for 20 seconds instead
  of every five, so the screen catches up quickly.
- Error texts from the protocol appear on the operating screen only in
  translated form; the raw text stays in the activity log.
- The network search skips link-local (169.254.x.x) networks and waits longer
  for slow devices.
- On macOS, closing the window quits the app completely.
- Settings use a new file format; settings from 1.0 are not carried over, the
  setup wizard runs once instead.
- Licensed as GPL-3.0-or-later, in line with the PJLink library the app is
  built on.

### Fixed

- A rejected command no longer locks the controls; it shows a message that can
  be dismissed.
- Muting on projectors that only switch picture and sound together, and on
  projectors that carry out a mute without acknowledging it: the projector's
  reported state now decides whether a command worked.
- After a failed connection attempt, *Try again* works, and no system error
  dialog appears.
- Pressing *Try again* repeatedly no longer starts several polling loops.
- A stale, slow connection attempt can no longer tear down a working
  connection.
- The app holds at most one connection to the projector and closes it when an
  exchange is done — projectors only have one PJLink slot.
- Responses are read up to their terminator, so answers split across network
  packets are no longer misread.
- A line without the `=` separator is no longer taken for an answer.
- Class 2 input codes keep both characters.
- The PJLink class is read correctly from projectors that answer in unusual
  ways, and an unanswered class query is told apart from a reported one.

## [1.0.0] – 2026-08-08

First version: a single dashboard with IP address, port and password, a
network search, status cards for power, input and mute, buttons for the PJLink
Class 1 commands, and an activity log.

[2.0.0]: https://github.com/DesignerThan/BeamerControl/releases/tag/v2.0.0
