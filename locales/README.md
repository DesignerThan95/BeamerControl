# Translations

Every user-facing text in this app lives here, as plain JSON. Translating the
app never means editing JavaScript.

## Adding a language

Copy `en.json` to `<code>.json`, translate the values, open a pull request.
That is the whole job — no code changes anywhere. The file name is the
[ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) code
of the language (`de`, `fr`, `pl`, …), and it is what the app matches against
the operating system's locale.

The new language then appears in the language dropdown by itself, sorted
alphabetically by the name it calls itself.

## File structure

```json
{
  "languageName": "Deutsch",
  "common":  { … },
  "operate": { … },
  "tech":    { … },
  "setup":   { … }
}
```

- **`languageName`** — the name of the language *in that language*
  ("Deutsch", not "German"; "Français", not "French"). This one is never
  translated into anything else: it is always read out of its own file, so the
  language dropdown stays readable for someone who cannot read the language
  the app is currently set to.
- **`common`** — texts that appear in more than one screen.
- **`operate`** — the operating screen. This is the screen the congregation's
  volunteers use on a Sunday; keep the wording plain and free of jargon.
- **`tech`** — the technical page behind the gear icon.
- **`setup`** — the setup wizard that runs on first start.

## Rules that are easy to get wrong

**Placeholders in curly braces must survive the translation.**
`"{checked} of {total} addresses checked"` — the names inside the braces are
filled in by the app and must stay exactly as they are, though you may move
them around to suit your language's word order. A placeholder that is renamed
or dropped shows up literally on screen.

**Some values begin with a space.** `operate.switching` and
`tech.highContrast` are appended to something else, so their leading space is
deliberate. Keep it.

**`operate.connector.*`** turns PJLink's raw input names into words people
recognise. PJLink reports `RGB`, `DIGITAL` and so on, which tells nobody
anything — `hdmi`, `vga`, `network` are what actually gets shown next to a
picture source. Use whatever your language calls the socket on the wall.

**`operate.errors.*`** are the plain-language versions of the PJLink library's
own English error wording. None of that raw wording may ever reach the
operating screen — it stays in the activity log. If a projector answers with
something these keys do not cover, the raw text is shown as a last resort, so
covering them properly matters.

**`en.json` is the fallback.** Every key the app asks for must exist there. If
a key is missing from your language, the English text is used; if it is missing
from English too, the key itself appears on screen, which is how you spot it.

## What is *not* translated

**The activity log** at the bottom of the technical page is English in every
language, on purpose. It is a diagnostic record for whoever maintains the
installation — the person reading it is the person who would also read a stack
trace, and a log that changes language with the interface is harder to compare
against documentation or paste into a bug report.

**PJLink protocol strings** (`POWR`, `INF2`, `CLSS`, …) are defined by the
protocol and never appear in these files.

## If a file is broken

A locale file that is missing or contains invalid JSON is skipped, with the
reason printed to the console of the process that started the app. The app
starts anyway, and anyone whose chosen language was in that file gets English
until it is fixed. A malformed translation can therefore never take the app
down.

Do run `npm test` before opening a pull request, though: it parses every file
in this folder and checks that each one carries exactly the same set of keys
as `en.json`.
