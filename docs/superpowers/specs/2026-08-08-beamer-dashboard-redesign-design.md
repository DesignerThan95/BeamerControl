# Beamer-Steuerung: Neugestaltung der Oberfläche

Datum: 2026-08-08

## Ziel

Die Anwendung soll von ungeschulten Personen bedient werden können — Leute, die
sie ein paar Mal im Jahr anfassen und sich nicht für Netzwerktechnik
interessieren. Die heutige Oberfläche (`dashboard.html`) zeigt IP-Adresse, Port,
Passwort, Netzwerksuche, vier Statuskarten, zehn Knöpfe und ein Protokoll auf
einem Bildschirm. Das eigentliche Bedienen verschwindet zwischen der Einrichtung.

Nach dem Umbau gilt: Wer den Beamer bedient, sieht ausschließlich Bedienelemente
für den Beamer. Alles Technische liegt hinter einem Zahnrad.

## Grundentscheidungen

| Entscheidung | Gewählt |
|---|---|
| Trennung Bedienung / Technik | Technik komplett hinter dem Zahnrad, plus Assistent beim ersten Start |
| Funktionen für den Nutzer | Ein/Aus, Bildquelle wählen, Bild ausblenden, Ton stumm |
| Zielgerät | Fester PC mit Maus, Fenster ~1200×800 |
| Aufbau Bedien-Bildschirm | Der Bildschirm folgt dem Beamerzustand (nur Sinnvolles ist da) |
| Sekundäraktionen | Als Chips oben in der Statuszeile, getrennt von den Bildquellen-Kacheln |
| Ausschalten | Roter Balken unten, mit Rückfrage |
| Technik-Seite | Eine durchgehende Seite: Verbindung, Bildquellen, Protokoll |
| Zugangsschutz Technik | Keiner — nur das unauffällige Zahnrad |
| Erscheinungsbild | Hell/Dunkel umschaltbar, Voreinstellung folgt dem Betriebssystem |
| Hoher Kontrast | Zusätzlicher Schalter auf der Technik-Seite, wirkt in beiden Modi |
| Alte Einstellungsdateien | Werden nicht übernommen — sauberer Neustart |

## Die drei Bildschirme

### Bedienung

Der Normalzustand. Kopfzeile mit Titel, Hell/Dunkel-Symbol und Zahnrad. Darunter
ein Bereich, dessen Inhalt sich nach dem Beamerzustand richtet:

| Zustand (PJLink) | Was zu sehen ist |
|---|---|
| Verbindung wird aufgebaut | Ruhiger Hinweis, keine Bedienelemente |
| Aus (0) | Ein einziger großer Knopf: „Beamer einschalten“ |
| Wärmt auf (3) | „Der Beamer wärmt sich auf …“ mit laufender Animation und verstrichener Zeit — PJLink meldet keinen Fortschritt in Prozent; keine Bedienelemente |
| Ein (1) | Statuszeile mit den zwei Chips, Bildquellen-Kacheln, roter Ausschalten-Balken |
| Ein + Video stumm | Auffälliger Streifen „Die Leinwand ist gerade schwarz“ mit „Bild wieder zeigen“; Kacheln abgeblendet, aber bedienbar |
| Kühlt ab (2) | „Der Beamer kühlt ab, bitte warten“; Einschalten gesperrt, bis der Beamer „Aus“ meldet |
| Kein Kontakt | „Kein Kontakt zum Beamer.“ Die App versucht es im Hintergrund weiter; Hinweis auf das Zahnrad |

Bildquellen erscheinen als Kacheln mit dem selbst vergebenen Namen und dem
Anschluss als kleiner Unterzeile („Laptop / HDMI 1“). Die gerade aktive Kachel ist
hervorgehoben. Es werden nur Quellen gezeigt, die auf der Technik-Seite als
sichtbar markiert sind.

Der Ausschalten-Balken fragt vor dem Ausführen nach — als Dialog innerhalb der
Anwendung, nicht über das `confirm()` des Browsers.

### Technik

Erreichbar über das Zahnrad, ohne Passwort oder PIN. Eine durchgehende, gescrollte
Seite mit „Zurück zur Bedienung“ oben links und vier Blöcken:

1. **Verbindung** — IP-Adresse, Port, Passwort; „Verbindung testen“; „Beamer im
   Netzwerk suchen“ mit Trefferliste zum Übernehmen; aktueller Verbindungsstatus
   mit Gerätename.
2. **Bildquellen** — Tabelle aus Anschluss (vom Beamer gemeldet), frei
   editierbarem Namen und Sichtbarkeitshaken. Reihenfolge per Ziehen änderbar.
   Knopf „Eingänge neu vom Beamer einlesen“.
3. **Darstellung** — Hell / Dunkel / Systemeinstellung, sowie Schalter für hohen
   Kontrast.
4. **Protokoll** — die bisherigen Log-Meldungen, mit „Protokoll kopieren“.
   Zusätzlich „Einrichtung neu starten“.

### Einrichtung

Läuft einmal, wenn keine gültige Einstellungsdatei existiert. Vier Schritte:

1. **Beamer finden** — „Beamer suchen“ startet den Netzwerk-Suchlauf mit
   Fortschrittsbalken und laufend wachsender Trefferliste. Alternativ „IP-Adresse
   selbst eingeben“.
2. **Verbindung prüfen** — zeigt den gefundenen Gerätenamen, bietet das optionale
   PJLink-Passwort an, prüft die Verbindung.
3. **Bildquellen benennen** — listet die vom Beamer gemeldeten Eingänge mit
   Namensfeld und Sichtbarkeitshaken. „Später erledigen“ ist erlaubt.
4. **Fertig** — Bestätigung und Knopf in die Bedienung.

Bricht jemand mittendrin ab, wird der erreichte Stand gespeichert und beim
nächsten Start an dieser Stelle fortgesetzt. Findet der Suchlauf nichts, erscheint
statt einer Fehlermeldung eine Prüfliste im Klartext (Beamer eingeschaltet oder im
Netzwerk-Standby? PJLink im Beamermenü aktiviert? gleiches Netzwerk?).

## Aufbau

`dashboard.html` wird durch einen `renderer/`-Ordner ersetzt:

```
renderer/
  index.html          Grundgerüst, die drei Bereiche
  css/tokens.css      Farb- und Größenvariablen: hell, dunkel, hoher Kontrast
  css/app.css         Bausteine: Kopfzeile, Kacheln, Chips, Schalter, Dialog
  js/api.js           dünne Hülle um window.pjlinkAPI
  js/store.js         Einstellungen laden, prüfen, speichern
  js/theme.js         hell/dunkel/System + hoher Kontrast
  js/beamer.js        Zustandsmaschine und Abfrage-Schleife, ohne DOM
  js/view-operate.js  Bedien-Bildschirm
  js/view-tech.js     Technik-Seite
  js/view-setup.js    Einrichtungsassistent
  js/app.js           verdrahtet Views und Zustand
```

Kein Bundler und keine neuen Abhängigkeiten. Die Dateien werden als gewöhnliche
`<script>`-Tags eingebunden, weil ES-Module unter `file://` in Electron nicht
geladen werden; jede Datei kapselt sich selbst und hängt ihre öffentliche
Schnittstelle an einen gemeinsamen Namensraum.

### Verantwortlichkeiten

- **`beamer.js`** kennt Zustände und Befehle, aber kein HTML. Es hält den zuletzt
  bekannten Zustand (Power, aktive Quelle, Stummschaltung, Verbindung), fragt den
  Beamer regelmäßig ab und meldet Änderungen über Rückrufe. Alle knifflige Logik
  — Aufwärmen, Abkühlen, Verbindungsverlust, Befehlsbestätigung — sitzt hier und
  ist ohne Fenster testbar.
- **`store.js`** lädt und speichert die Einstellungen und entscheidet, ob eine
  Einrichtung nötig ist. Es kennt weder Beamer noch DOM.
- **`theme.js`** setzt `data-theme` und `data-contrast` am Wurzelelement, hört auf
  die Betriebssystem-Einstellung, solange der Modus `system` ist, und schreibt
  Änderungen über `store.js` fort.
- Die **Views** lesen Zustand und schreiben DOM. Sie enthalten keine
  Netzwerklogik und keine Persistenz.

### Erscheinungsbild

Die Farben liegen als CSS-Variablen auf `:root` (hell). `[data-theme="dark"]`
überschreibt sie, `[data-contrast="high"]` überschreibt beide. Der Modus `system`
setzt kein Attribut und wertet `prefers-color-scheme` aus — wechselt das
Betriebssystem abends auf Dunkel, zieht die Anwendung mit, bis jemand selbst
umschaltet. Der Hell/Dunkel-Schalter erscheint sowohl als Symbol in der Kopfzeile
als auch als Einstellung auf der Technik-Seite.

Grundhaltung: ruhig, kräftige Schriftgrößen, Farbe nur dort, wo sie etwas
bedeutet — Grün für „läuft“, Gelb für „ausgeblendet“, Rot ausschließlich für
Ausschalten.

## Einstellungsdatei

Weiterhin `beamer-settings.json` im Benutzerprofil.

```json
{
  "version": 2,
  "connection": { "host": "192.168.1.100", "port": 4352, "password": null },
  "sources":    [ { "code": "31", "label": "Laptop", "visible": true } ],
  "appearance": { "theme": "system", "highContrast": false },
  "setupCompleted": true
}
```

Fehlt die Datei, ist sie unlesbar oder trägt sie nicht `version: 2`, wird sie
ignoriert und die Einrichtung gestartet. Eine Übernahme des alten Formats findet
bewusst nicht statt.

Das PJLink-Passwort liegt wie bisher im Klartext in dieser Datei. Für ein Gerät im
Gemeindenetz ist das vertretbar und entspricht dem heutigen Verhalten.

## Änderungen im Hauptprozess

`main.js` und `preload.js` bleiben in ihrer Struktur bestehen. Zwei Ergänzungen:

- **Fortschritt beim Netzwerk-Suchlauf**: `scan-network` meldet über
  `webContents.send` laufend geprüfte Adressen und neu gefundene Geräte, damit der
  Assistent einen Balken und eine wachsende Liste zeigen kann. `preload.js`
  bekommt dafür einen Empfänger.
- **Farbeinstellung des Betriebssystems**: `nativeTheme` wird an den Renderer
  weitergereicht, inklusive Änderungsmeldung.

`dashboard.html` entfällt; `main.js` lädt `renderer/index.html`. Die Dateiliste in
`package.json` (Abschnitt `build.files`) wird entsprechend angepasst.

## Fehlerverhalten

- Schlagen drei Abfragen hintereinander fehl, gilt die Verbindung als verloren.
  Der Bedien-Bildschirm wechselt auf „Kein Kontakt zum Beamer“, im Hintergrund
  wird mit wachsendem Abstand weiter versucht (5 s, 10 s, 20 s, dann alle 30 s).
- Ein Befehl gilt erst als erledigt, wenn der Beamer den Zustand bestätigt. Bis
  dahin steht „wird geschaltet …“ auf dem Bildschirm. Nach 30 Sekunden ohne den
  erwarteten Zustand erscheint eine Erklärung im Klartext statt einer technischen
  Fehlermeldung.
- Technische Fehlertexte erscheinen ausschließlich im Protokoll auf der
  Technik-Seite, nie auf dem Bedien-Bildschirm.
- Meldet der Beamer eine Quelle, die nicht in den Einstellungen steht, wird sie
  mit ihrem Rohnamen angezeigt, statt „Unbekannt“ zu schreiben.

## Tests

Das Projekt hat bisher keine Tests. Angelegt werden welche für die Teile, die sich
von Hand kaum durchspielen lassen — mit dem in Node eingebauten Test-Runner, ohne
neue Abhängigkeit:

- **`beamer.js`**: Aufwärmen führt zum Zustand „Ein“; Abkühlen sperrt das
  Einschalten bis „Aus“; drei fehlgeschlagene Abfragen lösen „kein Kontakt“ aus;
  eine erfolgreiche Abfrage danach stellt den Normalzustand wieder her; ein Befehl
  ohne Bestätigung läuft nach 30 Sekunden in die Klartext-Erklärung.
- **`store.js`**: fehlende, unlesbare und veraltete Dateien führen zur
  Einrichtung; gültige Dateien werden korrekt gelesen; Speichern und Lesen ergeben
  denselben Inhalt.

Die Views werden nicht automatisiert getestet, sondern beim Umbau von Hand am
echten Beamer geprüft.

## Bewusst nicht enthalten

- Mehrere Beamer gleichzeitig
- Zeitsteuerung oder Automatik
- Lampenstunden, Fehlercodes und weitere PJLink-Abfragen
- Passwortschutz für die Technik-Seite
- Touch-Bedienung als eigenes Layout
