# Device profiles

PJLink is a standard, but projectors read it in their own ways. A profile
tells the app what one particular model really does, so the operating screen
can offer the controls that work on it — instead of finding out the hard way,
in the middle of a service.

Without a profile the app follows the PJLink standard and learns what it can
along the way (a projector that refuses to hide the picture on its own, for
example).

## Adding a device

1. Connect to the projector, open the technical page, tick **Show expert
   tools** and try the commands in question with the PJLink console.
2. Copy `optoma-1080p.json` to a new file named after the model, and fill in
   what you measured.
3. Open a pull request. No code changes are needed.

The app matches a profile against what the projector answers to `%1INF1 ?`
(manufacturer) and `%1INF2 ?` (model). The comparison ignores upper and lower
case and surrounding spaces, nothing else — copy the answers exactly.

## Fields

```json
{
  "name": "Optoma 1080p",
  "match": { "manufacturer": "Optoma", "model": "Optoma 1080p" },
  "mute": {
    "picture": "combined",
    "combinedAcknowledged": false,
    "audioWhileCombined": false,
    "toggles": true
  },
  "notes": "What was measured, and when."
}
```

| Field | Values | Default | Meaning |
|---|---|---|---|
| `mute.picture` | `"separate"`, `"combined"` | `"separate"` | Can the picture be hidden on its own (`AVMT 11/10`), or only together with the sound (`AVMT 31/30`)? With `"combined"` the operating screen offers *Picture & sound off* instead of *Hide picture*. |
| `mute.combinedAcknowledged` | `true`, `false` | `true` | Does the projector answer `AVMT 31/30`? With `false` the app does not wait for the answer and asks for the state right away. |
| `mute.audioWhileCombined` | `true`, `false` | `true` | Can the sound be switched on its own while picture and sound are both off? With `false` the sound switch is greyed out in that state. |
| `mute.toggles` | `true`, `false` | `false` | Does the projector ignore the value and simply toggle? Some devices only read the first digit of `AVMT` and switch over on every command — `AVMT 31` on a hidden picture brings it back. With `true` the app asks for the current state right before each command and only sends one when the device is really in the other state. |
| `notes` | text | – | Free text for people; the app ignores it. |

Every field under `mute` is optional; what is left out keeps its default.
