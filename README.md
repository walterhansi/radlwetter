# Radlwetter

Eigenständige PWA: Wettervorschau fürs Rennrad. Nächste 48 Stunden, nur Tageslicht (Stunden vor Sonnenaufgang und nach Sonnenuntergang fehlen), mit Ampel.

Live: https://walterhansi.github.io/radlwetter/

## Tabelle (von oben nach unten)

1. **Rennrad** – Eignung als Ampel (die wichtigste Zeile)
2. Sonne (Minuten, gelbes Sonnen-Symbol)
3. Wolken %
4. Temperatur °C
5. Regen %
6. Regen mm
7. Regendauer (Minuten)
8. Wind km/h mit Richtungspfeil (zeigt, wohin der Wind weht)

Darüber steht das beste Radlfenster (längster Block grüner Stunden).

## Ampel (Grenzen in `config.js`)

| Stufe | Bedingung (eine genügt) |
|---|---|
| rot | Regen ab 1 mm/h, ab 60 %, Wind ab 35 km/h oder unter 5 °C |
| gelb | Regen ab 0,3 mm/h, ab 30 %, Wind ab 25 km/h oder unter 10 °C |
| grün | sonst |
| besonders gut | grün **und** Sonne 60 min, 0 mm, Regendauer 0 (fehlt einer der drei Werte, bleibt es normal grün) |

Regendauer, Wolken und Tageszeit zählen für rot/gelb nicht. Fehlende Werte lösen nichts aus.

## Daten

Open-Meteo, ICON-Modelle (`icon_seamless`). Fehlt dabei etwas (Regenwahrscheinlichkeit, Viertelstundenwerte), folgt ein zweiter Abruf ohne Modellwahl.

- Regen mm, Regen % und Sonne sind bei Open-Meteo Werte der **vorangegangenen** Stunde. Die Spalte „19“ (19–20 Uhr) zeigt deshalb den Eintrag mit Zeitstempel 20:00. Temperatur, Wolken und Wind gelten für den Zeitstempel selbst.
- Regendauer = Viertelstunden mit mindestens 0,1 mm (`regenSchwelle`) mal 15.
- Nacht: Eine Stunde bleibt, wenn sie sich mit der Zeit zwischen Sonnenauf- und -untergang überschneidet (Daten: `daily=sunrise,sunset`).
- Abruf beim Laden, alle 15 Minuten, bei Stundenwechsel und bei Rückkehr zum Tab. Ohne Verbindung zeigt die App gespeicherte Daten (bis 6 Stunden alt).
- Ort: Standard Moosburg (48,47 / 11,94); über das Orts-Symbol oben rechts änderbar (Suche oder Standort), wird im Gerät gespeichert.

## Dateien

`index.html`, `style.css`, `config.js` (Grenzwerte, Version), `logik.js` (Auswertung), `app.js` (Oberfläche, Abruf), `sw.js` (Offline, Selbst-Update), `manifest.webmanifest`, `icons/`.

## Änderungen veröffentlichen

Nach dem Push auf `main` ist die Seite per GitHub Pages in ca. 1 Minute online. Die Version in `config.js` wird bei jeder Änderung hochgezählt; installierte Apps holen sich die neue Fassung beim nächsten Öffnen selbst und laden einmal neu.

## Tests

`node tests/logik.test.js` prüft Stundenzuordnung, Regendauer, Nachtfilter, Ampelgrenzen und Fenster mit simulierten Daten (`tests/simdaten.js`).
