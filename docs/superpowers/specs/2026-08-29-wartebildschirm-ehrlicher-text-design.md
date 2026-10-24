# Wartebildschirm: ehrlicher Text nach dem ersten Fehlversuch

**Stand:** 2026-08-29

## Das Problem

Bis die App aufgibt und „Kein Kontakt zum Beamer" zeigt, vergehen rund
28 Sekunden: drei Versuche mit je 6 s Timeout und 5 s Pause dazwischen. In
dieser ganzen Zeit steht unverändert „Einen Moment … Die App nimmt Kontakt zum
Beamer auf." auf dem Schirm. Wer davorsteht, weiß nicht, ob noch etwas passiert.

## Verworfen: ein Ladebalken

Naheliegend, aber er würde lügen. Ein Balken, der sich füllt, verspricht: wenn
er voll ist, bist du da. Hier ist er voll, wenn die App **aufgibt**. Die App
kennt zwar ihren Fortschritt genau — Versuch 2 von 3 —, aber „Fortschritt"
zeigt hier in die falsche Richtung.

## Die Entscheidung

Kein neues Bauteil. Der Text wird nach dem ersten tatsächlich gescheiterten
Versuch ehrlicher.

Der Auslöser ist der Zähler, nicht die Uhr: die Zustandsmaschine zählt
gescheiterte Runden ohnehin mit (`consecutiveFailures`), sie veröffentlicht die
Zahl nur nicht. Damit wechselt der Text genau dann, wenn wirklich ein Versuch
danebenging — und nicht nach einer geratenen Sekundenzahl, die bei einem
langsamen Netz zu früh und bei einem schnellen zu spät käme.

## Die Teile

**`renderer/js/projector.js`** — nimmt `failedAttempts` in den veröffentlichten
Zustand auf. Der Zähler existiert bereits; er wird bei Erfolg auf 0 gesetzt und
im Fehlerfall erhöht. Neu ist nur, dass er nach außen sichtbar wird.

**`renderer/js/view-operate.js`** — im Zweig `link === 'connecting'`:

| `failedAttempts` | Text |
|---|---|
| 0 | wie bisher: „Die App nimmt Kontakt zum Beamer auf." |
| ≥ 1 | „Der Beamer antwortet nicht sofort. Die App versucht es noch zweimal." (bzw. „noch einmal") |

Der drehende Kreis (`.pulsen`) bleibt unverändert.

**`locales/de.json`, `locales/en.json`** — ein Schlüssel mit i18next-Plural
(`_one` / `_other`), wie `setup.found` es schon macht. So stimmt die Zahl von
selbst, statt bei Versuch 3 noch „zweimal" zu behaupten. Die verbleibenden
Versuche sind `MAX_FAILURES - failedAttempts`.

## Zeitlicher Ablauf

| Zeit | Bildschirm |
|---|---|
| 0–6 s | „Einen Moment … Die App nimmt Kontakt zum Beamer auf." |
| 6–17 s | „… Die App versucht es noch zweimal." |
| 17–28 s | „… Die App versucht es noch einmal." |
| ab 28 s | „Kein Kontakt zum Beamer" mit Knopf |

## Test

In `test/projector.test.js`: nach einer gescheiterten Runde meldet der Zustand
`failedAttempts: 1`, nach einer erfolgreichen wieder `0`. Die Textauswahl im
View ist eine Verzweigung über diese Zahl und braucht keinen eigenen Test.

## Was ausdrücklich nicht dazugehört

Die 28 Sekunden bleiben, wie sie sind — sie wurden geprüft und für in Ordnung
befunden. Hier geht es allein darum, was in dieser Zeit auf dem Schirm steht.
