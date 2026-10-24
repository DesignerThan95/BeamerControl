# PJLink-Konsole: Befehle direkt an den Beamer schicken

**Stand:** 2026-10-24

## Das Problem

Wer wissen will, was der Beamer auf einen bestimmten Befehl wirklich antwortet —
etwa ob der Optoma `%1AVMT ?` mit `21` oder `31` beantwortet, nachdem nur der
Ton stumm geschaltet wurde —, kann das heute nur über `PJLINK_TRACE=1` im
Terminal und einen Knopf der Oberfläche, der den gewünschten Befehl zufällig
auslöst. Einen beliebigen Befehl zu schicken, geht gar nicht.

## Die Entscheidung

Ein Werkzeug auf der Technik-Seite, das eine PJLink-Zeile über die bestehende
Verbindung der App schickt und die Antwort zeigt — roh und mit ihrer Bedeutung.

### Verworfen: ein eigener roher Socket

Er würde auch Begrüßung und Passwort-Austausch zeigen. Aber der Beamer hat nur
einen PJLink-Platz, und um den kämpft die Abfrage-Schleife alle fünf Sekunden.
Der Socket müsste sie anhalten und wieder anwerfen. Über die Warteschlange der
Bibliothek reiht sich der Befehl einfach ein; Begrüßung, Passwort (MD5 wie
SHA256) und das Schließen nach dem Austausch (Spec 5.4) laufen wie bei jedem
anderen Befehl. Wer den Draht sehen will, hat weiterhin `PJLINK_TRACE=1`.

## Wo es sitzt

Ganz unten auf der Technik-Seite ein Schalter **„Experten-Werkzeuge anzeigen“**.
Erst er blendet den Block **„PJLink-Befehle“** ein. Der Schalter wird nicht
gespeichert: nach jedem Start ist das Werkzeug wieder verborgen. Es ist in jedem
Build enthalten, auch im ausgelieferten — gerade am echten Beamer in der Kirche
wird es gebraucht.

## Wie es aussieht

- Eine **Eingabezeile** für die ganze Zeile, z. B. `%1AVMT ?`, und ein Knopf
  **„Senden“**; Enter sendet ebenfalls.
- Eine **Vorlagen-Auswahl** mit den gängigen Befehlen. Eine Vorlage füllt die
  Eingabezeile nur vor, sie sendet nicht. Enthalten:
  - Class 1: `POWR ?`, `POWR 1`, `POWR 0`, `INPT ?`, `INPT 31`, `AVMT ?`,
    `AVMT 10`, `AVMT 11`, `AVMT 20`, `AVMT 21`, `AVMT 30`, `AVMT 31`, `ERST ?`,
    `LAMP ?`, `INST ?`, `NAME ?`, `INF1 ?`, `INF2 ?`, `INFO ?`, `CLSS ?`
  - Class 2: `SNUM ?`, `SVER ?`, `INNM ?31`, `IRES ?`, `RRES ?`, `FILT ?`,
    `RLMP ?`, `RFIL ?`, `FREZ ?`, `FREZ 1`, `FREZ 0`, `SVOL 1`, `SVOL 0`,
    `MVOL 1`, `MVOL 0`
- Eine **Ergebnisliste**, neuester Eintrag oben. Jeder Eintrag zeigt die
  gesendete Zeile, die empfangene Zeile, die Dauer in Millisekunden und — wo
  bekannt — die Bedeutung. Die Liste lebt nur, solange die Technik-Seite offen
  ist.
- Jeder gesendete Befehl und seine Antwort gehen zusätzlich ins Protokoll.

## Die Teile

**`lib/pjlink-reference.js`** (neu) — reines Wissen, kein Netz:

- `parseLine(text)` prüft eine Eingabe nach Spec 2.1: `%`, Klasse `1` oder
  `2`, vier Zeichen Befehl (Buchstaben/Ziffern, wird großgeschrieben), ein
  Leerzeichen, ein Parameter von 1 bis 128 Zeichen. Führende und abschließende
  Leerzeichen werden entfernt, ein mitgetipptes `\r` ebenfalls. Ergebnis:
  `{ cls, cmd, param }` oder `{ error }` mit einem Grund aus einer festen Liste
  (`prefix`, `class`, `command`, `separator`, `parameter`).
- `TEMPLATES` — die Vorlagen oben, mit Klasse und einer kurzen
  Beschreibung als Übersetzungsschlüssel.
- `describe(cmd, answer)` liefert für bekannte Antworten einen
  Übersetzungsschlüssel samt Werten, sonst `null`. Abgedeckt:
  - `ERR1`–`ERR4`, `ERRA` und `OK` für jeden Befehl
  - `POWR` 0–3
  - `AVMT` 10/11/20/21/30/31
  - `ERST` (sechs Stellen: Lüfter, Lampe, Temperatur, Abdeckung, Filter,
    Sonstiges; je 0/1/2)
  - `INPT` (Eingangsart nach erster Ziffer: RGB, Video, Digital, Speicher,
    Netzwerk, intern)
  - `CLSS` 1/2
  - `FREZ` 0/1
  - `LAMP` (Betriebsstunden und an/aus je Lampe)

**`lib/pjlink.js` → `sendRaw({ cls, cmd, param }, cb)`** — nimmt die von
`parseLine` geprüften Teile entgegen und reiht einen Befehl ein, dessen Klasse fest
vorgegeben ist (`cls` überschreibt die Klasse der Verbindung, wie bei den
Class-2-Befehlen). Die Antwort kommt als unveränderte Zeile ohne `\r` zurück,
z. B. `%1AVMT=31`. Eine Antwort `ERR1`–`ERR4` ist hier eine **Antwort**, kein
Fehler — sie ist ja gerade, was man sehen will. Ein Fehler (`cb(err)`) ist nur,
was keine Antwort ist: Zeitüberschreitung, Verbindungsabbruch, falsches
Passwort. Eine Antwort, deren Befehl nicht zum gesendeten passt, wird
ebenfalls als Zeile zurückgegeben, denn auch das will man sehen.

**`main.js`** — Kanal `send-raw`: Eingabe mit `parseLine` prüfen, über
`connection.require()` senden, Dauer messen. Rückgabe
`{ ok: true, sent, received, ms }` oder `{ ok: false, sent, reason, ms }` mit
`reason` aus `invalid` (samt Grund), `not-connected`, `timeout`, `auth`,
`connection`. Kein `throw` über die IPC-Grenze — das landete sonst als
„Error occurred in handler“ im Log.

**`preload.js`** — `pjlinkAPI.sendRaw(line)`.

**`renderer/js/view-tech.js`** — Schalter und Block. Der Renderer lädt keine
Datei aus `lib/` (das Preload läuft sandboxed): `send-raw` liefert das Ergebnis
von `describe` gleich mit (`meaning: { key, values }` oder `null`), und der
Renderer übersetzt nur noch den Schlüssel. Die Vorlagen holt er einmal über
einen zweiten Kanal `get-raw-templates`.

**`locales/de.json`, `locales/en.json`** — alle Texte: Schalter, Block,
Vorlagenbeschreibungen, Bedeutungen, Gründe für ungültige Eingaben.

## Fehlerverhalten

| Fall | Anzeige im Eintrag |
|---|---|
| Ungültige Eingabe | Kein Senden. Hinweis unter der Eingabezeile, was nicht stimmt („Die Zeile muss mit % beginnen“ …) |
| Nicht verbunden | „Keine Verbindung zum Beamer — oben unter „Verbindung“ verbinden.“ |
| Keine Antwort binnen 6 s | „Keine Antwort.“ Neutral gefärbt, nicht als Fehler: manche Beamer führen Befehle aus, ohne sie zu quittieren (der Optoma bei AVMT). |
| `ERR1`–`ERR4` | Die Zeile wie empfangen, dazu die Bedeutung („Parameter außerhalb des Bereichs“ …) |
| Falsches Passwort | „Der Beamer hat das Passwort abgelehnt.“ |
| Verbindung abgebrochen | „Die Verbindung ist abgebrochen.“ |

Während ein Befehl läuft, ist „Senden“ gesperrt; eine zweite Zeile wartet nicht
in einer eigenen Schlange.

**Zustand der Bedienung.** Nach einem Befehl, der etwas setzt (Parameter nicht
`?`), stößt der Renderer die Abfrage der Zustandsmaschine sofort an
(`refreshNow`), damit die Bedienseite nachzieht. Eine Bestätigungslogik wie bei
den Knöpfen gibt es hier nicht: das Werkzeug zeigt, was der Beamer sagt, und
bewertet es nicht.

## Tests

- `test/pjlink-reference.test.js`: `parseLine` mit gültigen Zeilen beider
  Klassen, Kleinschreibung, fehlendem `%`, Klasse 3, zu kurzem Befehl, fehlendem
  Leerzeichen, leerem und zu langem Parameter; `describe` für jede Zeile der
  Tabelle und für Unbekanntes.
- `test/pjlink.test.js`: `sendRaw` gegen den nachgebauten Socket — Antwort
  kommt roh zurück, `ERR2` kommt als Antwort statt als Fehler, Class-2-Befehl
  auf einer Class-1-Verbindung trägt `%2`, Zeitüberschreitung kommt als Fehler.
- Durchlauf in der App gegen den Test-Beamer (`run-app`): Schalter, Vorlage
  wählen, senden, Eintrag mit Bedeutung; Verhalten `swallows` zeigt „Keine
  Antwort.“

## Bewusst nicht enthalten

- Speichern der Ergebnisliste oder des Schalters.
- Mehrere Zeilen auf einmal oder Skripte.
- Anzeige von Begrüßung und Passwort-Austausch (dafür bleibt `PJLINK_TRACE=1`).
- Eine Bewertung, ob ein Befehl „gewirkt“ hat.
