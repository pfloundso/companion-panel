# Companion Panel (Satellite)

1. `npm install`
2. `config.json` anpassen (Adresse der Companion-Satellite-API, Port 16622)
3. `npm start`, dann http://<rechner-ip>:3000 öffnen

Ablage: `server.js` und `config.json` im Projektordner, `index.html` in `public/`.

Das Panel meldet sich bei Companion als eigenes Surface an (16 Tasten, 4 pro Zeile).
Es erscheint im Tab "Surfaces". Die aktuelle Seitennummer steht unten zwischen den Pfeiltasten.

## Kiosk und Webapp
- `http://<rechner-ip>:3000/?kiosk=1` blendet Cursor und Vollbild-Knopf aus, sperrt das Kontextmenü, hält den Bildschirm an und schaltet beim ersten Tippen auf Vollbild.
- Als Webapp installieren: iPhone/iPad Safari "Teilen > Zum Home-Bildschirm", Android Chrome "Zum Startbildschirm hinzufügen". Die installierte App startet immer im Kiosk-Modus (Vollbild ohne Browserleiste).
- Installieren mit Offline-Shell (Service Worker) und Bildschirm-Wachhalten gehen nur über HTTPS oder `localhost`. Über `http://<ip>` funktionieren Vollbild und "Zum Home-Bildschirm" trotzdem, der Bildschirm kann aber ausgehen.
- Reiner Kiosk-Rechner: `chromium --kiosk http://localhost:3000/?kiosk=1`.

## Overlay-Builder
Oben links auf ✎ tippen (nicht im Kiosk-Modus, also in einem normalen Browser ohne `?kiosk=1`). Dann:
- "+ Button" / "+ Fader" fügt ein Widget an der ersten freien Stelle hinzu.
- Widget antippen = auswählen, ziehen = verschieben (rastet am Raster ein, keine Überlappung).
- Unten stellst du Typ, Companion-Taste (Nummer und Zeile/Spalte auf der Seite) und Größe (B x H) ein.
- Spalten und Zeilen ändern die Rastergröße.
- "Speichern" schreibt `layout.json` neben `server.js`. Alle verbundenen Browser, auch ein Kiosk-Panel, übernehmen das Layout sofort.
  Ohne `layout.json` gilt das Standardlayout aus `config.json` (12 Buttons, 4 Fader). Datei löschen = zurücksetzen.

Jedes Widget ist an eine der 16 Satellite-Tasten gebunden. Ein Button zeigt Bild, Text und Farbe dieser Taste,
ein Fader liest ihren Text im Format `Label|min|max|step|wert` (siehe unten).
Bitmaps schickt der Server nur für Tasten, die als Button angezeigt werden.

## Popups statt Seitenwechsel

Ein Popup ist ein kleines eigenes Raster, das über dem Panel aufgeht. Es wird nur im Browser geöffnet, Companion bekommt davon nichts, und alle Tasten und Fader darin laufen live weiter.

- Im Builder legt "+ Popup-Button" einen Button und ein neues Popup an. Oben bei "Bearbeiten" wechselst du zwischen Hauptlayout und Popups. Ein Popup baust du wie das Hauptlayout (Buttons, Fader, weitere Popup-Buttons, Spalten und Zeilen), dazu Titel und "nach Tastendruck schließen".
- Ein Popup-Button zeigt seinen Namen (mit Farbe) oder, wenn du eine Taste auswählst, deren Bild und Text aus Companion. Diese Taste wird nicht gedrückt, der Button öffnet nur das Popup.
- Schließen mit ✕, Tipp neben das Popup oder Esc. Mit "nach Tastendruck schließen" geht es nach jedem Tastendruck von selbst zu (Fader schließen nicht). Popups lassen sich bis zu 4 Ebenen tief stapeln.
- Löschst du ein Popup, verschwinden auch die Popup-Buttons, die darauf zeigen.

### Mehr Tasten für die Popups

Alle Popup-Tasten kommen vom selben Companion-Surface und liegen auf derselben Seite. Dafür brauchst du mehr als 16 Tasten: Gesamtzahl = `buttons` + `faders` in config.json. `columns` bei 4 lassen, dann bleiben die bisherigen 16 Tasten an ihrer Position in Companion (Zeile 0 bis 3), neue Tasten liegen darunter. Beispiel für 32 Tasten: `"buttons": 28, "faders": 4`. Prüf, ob das Seitenraster der Companion-Seite groß genug ist. Bei vielen Tasten mit `bitmapSize` 256 wird viel übertragen, 128 oder 72 sind leichter.

## Tasten
Tasten 0 bis 11: Bild, Beschriftung und Farbe kommen aus Companion
(`bitmapSize` in config.json, Standard 72).

## Seitenwechsel
Die Pfeiltasten unten senden `SURFACE <id> PAGE-UP/PAGE-DOWN` an die Companion-TCP-API
(Port 16759, in Companion unter Settings > Protocols aktivieren).
`api.surfaceId` in config.json muss der Surface-ID aus dem Tab "Surfaces" entsprechen.

## Fader = Zeile 3 (Tasten 12 bis 15)
Jeder Encoder-Button beschreibt seinen Fader über den Button-Text:

    Label|min|max|step|wert

Beispiele:

    Vox|-90|10|0.5|$(x32:ch01_level)     (Audio)
    Dimmer|0|100|1|$(custom:dimmer)      (Licht)

- Ändert sich die Variable, ändert sich der Text und damit die Fader-Position.
- Seitenwechsel tauscht Belegung und Bereich.
- `-oo` / `-∞` wird als Minimum dargestellt.
- Button-Text nicht passend oder leer: Fader ist ausgegraut.
- `step` muss zur Rotate-Aktion passen (Wertänderung pro Rast).
- Ab Companion 5.1 werden mehrere Rasten in einer Nachricht gesendet, bei älteren Versionen einzeln.
- Über jedem Fader erscheint klein (36 px, `--ico` in `index.html`) das Bild der Companion-Taste. Es kommt so, wie
  Companion die Taste rendert, also inklusive Text. Soll das Icon sauber aussehen, den Button-Text unsichtbar machen
  (Textfarbe = Hintergrundfarbe, bei Schwarz wird er durch die Transparenz-Funktion ganz ausgeblendet). Der Server
  verkleinert das Bild für Fader auf 64 px, damit beim Fahren nicht ständig große Bitmaps fließen.

Am Encoder-Button in Companion die Rotary-Aktionen aktivieren und Rotate-left / Rotate-right belegen.
Namen unter dem Fader antippen = Encoder drücken.
