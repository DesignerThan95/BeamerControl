# Ein eigenes App-Icon

**Stand:** 2026-08-29

## Das Problem

Im Build-Protokoll steht bei jedem Lauf `default Electron icon is used —
reason: application icon is not set`. Die App trägt also Electrons Standard-Icon.
Im Dock und im Programme-Ordner ist sie damit nicht von jedem anderen
Electron-Programm zu unterscheiden, und auf dem Rechner in der Kirche soll
jemand sie unter Druck wiederfinden.

## Das Motiv

Ein Beamer, kein Text. Text im Icon scheidet aus, weil er bei 16 Pixeln
ohnehin nur noch ein Fleck wäre.

Vier Motive standen zur Wahl: Beamer mit Lichtkegel von der Seite, Objektiv von
vorn, Licht das auf eine Leinwand trifft, und eine Linse mit Lichtbögen.
Entschieden wurde das **Objektiv von vorn**, ausgearbeitet als erkennbares
Gerät: ein Gehäuse in Beamer-Proportion — breiter als hoch —, die Linse
außermittig links, zwei Lüftungsschlitze rechts.

Die Gefahr bei einer reinen Linse ist, dass sie als Fotoapparat gelesen wird.
Das Gehäuse mit seinen Proportionen und den Schlitzen nimmt diese Lesart weg.

## Verworfen: eine Zeichnung für alle Größen

Der Einwand gegen das gewählte Motiv war die Kleindarstellung: Lüftungsschlitze
bei 16 Pixeln sind Grau-Rauschen, und die Linse wird zu klein, um noch blau zu
wirken.

Der Ausweg ist nicht, die Zeichnung zu verwässern. Eine `.icns` ist keine Datei
mit einem Bild, sondern eine **Sammlung von Bildern**, je eines pro Größe — bei
Windows `.ico` genauso. Für die kleinen Größen darf also eine eigene,
vereinfachte Zeichnung hinterlegt werden. Die Schlitze müssen bei 16 Pixeln
nicht überleben; sie sind dort schlicht nicht dabei.

Deshalb zwei Zeichnungen:

Die Regel lautet: **bis 64 Pixel vereinfacht, ab 128 voll.**

| Gerenderte Größe | Zeichnung | gebraucht für |
|---|---|---|
| 16, 32, 48, 64 | vereinfacht: Gehäuse und Linse, größer, ohne Schlitze | `.icns` (16, 32, 64), `.ico` (16, 32, 48, 64) |
| 128, 256, 512, 1024 | voll: mit Schlitzen und Glanzlicht auf der Linse | `.icns` (alle), `.ico` (256) |

48 Pixel kommt nur unter Windows vor (Ansicht „große Symbole") und fällt damit
noch unter die vereinfachte Zeichnung.

## Die Farben

Aus `renderer/css/tokens.css`, damit das Icon zur App gehört:

| Rolle | Wert |
|---|---|
| Gehäuse | `#2b2926` (`--text`) |
| Linse | `#2f6fb5` (`--accent`) |
| Linsenkern | `#1c4f86` (`--accent-text`) |
| Kachel | `#efe7da` |

Die Kachel ist bewusst **nicht** `#faf8f5`, der Hintergrund der App. Eine fast
weiße Kachel verliert im hellen Dock ihre Kontur und das Icon franst aus.
`#efe7da` ist derselbe warme Ton, ein paar Prozent tiefer: hält die Kante auf
hellem Grund, bleibt auf dunklem freundlich.

## Die Teile

### `build/icon.svg` und `build/icon-klein.svg`

Die beiden Zeichnungen als Vektor, in einem `viewBox="0 0 100 100"`. Quelltext
statt Binärblob: diff-bar, änderbar, und niemand braucht ein Grafikprogramm.

### `tools/icon-bauen.js`

Rendert die SVGs zu PNGs und packt sie in `.icns` und `.ico`.

Gerendert wird mit **Electron**. Das ist keine Kür, sondern die Lage auf der
Maschine: `rsvg-convert`, ImageMagick, Inkscape und Pillow fehlen alle. Electron
ist als devDependency ohnehin da und ist Chromium — es öffnet ein transparentes
Fenster in der Zielgröße, lädt das SVG und schreibt das Bild heraus. Kein neues
Werkzeug, keine Homebrew-Installation, und es rendert mit derselben Engine, die
auch die App zeichnet.

Aus den PNGs wird:

- **`.icns`** über einen `.iconset`-Ordner mit Apples Namensschema
  (`icon_16x16.png`, `icon_16x16@2x.png`, …) und `iconutil -c icns`. Bordmittel.
- **`.ico`** von Hand. Dafür gibt es kein Bordmittel, aber das Format ist
  schlicht: ein 6-Byte-Kopf, 16 Byte pro Größe, dann die PNGs am Stück.
  Rund 40 Zeilen. Das Paket `png-to-ico` wurde verworfen — eine Abhängigkeit
  für 40 Zeilen Build-Code lohnt in dieser App nicht.

Der ICO-Schreiber ist der einzige Teil mit echter Logik und bekommt einen Test,
der die erzeugte Datei wieder aufmacht und Kopf und Einträge prüft.

### Einbinden

electron-builder holt `build/icon.icns` und `build/icon.ico` von allein aus dem
`buildResources`-Verzeichnis, das in `package.json` schon auf `build` steht.
Vermutlich ist damit **keine** Änderung an der Konfiguration nötig. Das wird
beim Bauen geprüft, nicht angenommen.

`npm run icon` erzeugt die Dateien neu.

## Was eingecheckt wird

Die beiden SVGs, das Skript, der Test — und die erzeugten `.icns` und `.ico`.
Letztere gehören dazu, weil sonst niemand ohne Mac ein Windows-Paket bauen
kann: `iconutil` gibt es nur auf macOS.

## Bewusst nicht dabei

- **Apples Icon Composer und geschichtete Tahoe-Icons.** Das braucht ein
  eigenes Werkzeug und Apple-Formate, die electron-builder 24 nicht verarbeitet.
  Die klassische `.icns` funktioniert weiterhin.
- **Ein eigenes Fenster-Icon zur Laufzeit.** Unter Windows reicht das `.ico` am
  Programm; unter macOS zeichnet das System das Dock-Icon aus dem Bundle.
- **Ein Linux-Icon.** Es wird kein Linux-Paket gebaut.
