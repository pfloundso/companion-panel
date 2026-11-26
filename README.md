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

Am Encoder-Button in Companion die Rotary-Aktionen aktivieren und Rotate-left / Rotate-right belegen.
Namen unter dem Fader antippen = Encoder drücken.
