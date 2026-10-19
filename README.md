# Radlwetter

Eigenständige PWA: Wettervorschau fürs Rennrad. Nächste 48 Stunden, nur Tageslicht (Stunden vor Sonnenaufgang und nach Sonnenuntergang fehlen), mit Ampel.

Live: https://walterhansi.github.io/radlwetter/

## Prioritäten

Die Bewertung folgt dieser Reihenfolge: 1. möglichst kein Niederschlag, 2. nicht zu windig, 3. Sonnenschein, 4. Temperatur ab 10 °C. Die Windrichtung wird **nicht** bewertet (der Pfeil dient nur der Anzeige).

## Oberfläche

Oben: „Trocken bis …“ bzw. „Regnet bis …“ (aus den Viertelstundenwerten), darunter das **beste Radlfenster je Tag** (mindestens 2 zusammenhängende Stunden, grün oder besonders gut) und ein Hinweis, wenn die Wettermodelle beim Regen uneinig sind.

Tabelle (von oben nach unten):

1. **Rennrad** – Ampel; darunter kleine Symbole, **warum** gelb oder rot (Regen, Wind, Temperatur); „?“ = Modelle uneinig
2. Regen mm
3. Regendauer – Viertelstunden-Balken plus Minuten
4. Regen %
5. Modelle (Regen) – Vergleich ICON / ECMWF / GFS
6. Wind km/h mit Richtungspfeil
7. Böen km/h
8. Sonne (Minuten)
9. Temperatur °C
10. Gefühlte Temperatur °C (zählt für die 10-°C-Grenze)
11. Wolken % (zählt nicht für die Ampel)

Zellen, die gelb oder rot wirken, sind selbst gelb/rot markiert.

## Ampel (Grenzen in `config.js`, `grenzen`)

| Stufe | Bedingung (eine genügt) |
|---|---|
| rot | Regen ab 1 mm/h, ab 60 %, Wind ab 35 km/h, Böen ab 50 km/h oder gefühlt unter 5 °C |
| gelb | messbarer Regen (ab 0,1 mm/h oder eine nasse Viertelstunde), Regen ab 30 %, Wind ab 25 km/h, Böen ab 40 km/h oder gefühlt unter 10 °C |
| grün | sonst |
| besonders gut | grün **und** Sonne 60 min, 0 mm, Regendauer 0 (fehlt einer der Werte, bleibt es normal grün); bei Modell-Uneinigkeit nur grün |

Die Böen-Grenzen (40/50) sind ein Vorschlag, keine belegten Werte. Angezeigte Werte sind gerundet, die Farbe richtet sich nach dem angezeigten Wert. Fehlende Werte lösen nichts aus.

## Unsicherheit

Zusätzlich zu ICON werden ECMWF und GFS nur für den Niederschlag abgefragt. „Uneinig“ heißt: ein Modell ≥ 0,2 mm/h, ein anderes < 0,1 mm/h (`unsicherheit` in `config.js`). Solche Stunden tragen ein „?“, und das beste Fenster nennt die unsicheren Stunden. Ist der Vergleich nicht verfügbar, steht das sichtbar da.

## Daten

Open-Meteo, ICON (`icon_seamless`), Vergleich ECMWF und GFS. Die Modell-Kennungen werden der Reihe nach probiert (nur bei HTTP 400); die funktionierende merkt sich das Gerät. Fehlt beim Hauptmodell etwas (Regenwahrscheinlichkeit, Böen, gefühlte Temperatur, Viertelstundenwerte), folgt ein zweiter Abruf ohne Modellwahl.

- Regen mm, Regen %, Sonne und Böen sind bei Open-Meteo Werte der **vorangegangenen** Stunde. Die Spalte „19“ (19–20 Uhr) zeigt deshalb den Eintrag mit Zeitstempel 20:00. Temperatur, Wolken und Wind gelten für den Zeitstempel selbst.
- Regendauer = Viertelstunden mit mindestens 0,1 mm (`regenSchwelle`) mal 15.
- Nacht: Eine Stunde bleibt, wenn sie sich mit der Zeit zwischen Sonnenauf- und -untergang überschneidet.
- Abruf beim Laden, alle 15 Minuten, bei Stundenwechsel und bei Rückkehr zum Tab. Ohne Verbindung zeigt die App gespeicherte Daten (bis 6 Stunden alt).
- Ort: Standard Moosburg (48,47 / 11,94); über das Orts-Symbol änderbar (Suche), wird im Gerät gespeichert.

## Dateien

`index.html`, `style.css`, `config.js` (Grenzwerte, Version), `logik.js` (Auswertung), `app.js` (Oberfläche, Abruf), `sw.js` (Offline, Selbst-Update), `manifest.webmanifest`, `icons/`.

## Änderungen veröffentlichen

Nach dem Push auf `main` ist die Seite per GitHub Pages in ca. 1 Minute online (einmalig: Settings → Pages → Deploy from branch `main`, `/ (root)`). Die Version in `config.js` wird bei jeder Änderung hochgezählt; installierte Apps holen sich die neue Fassung beim nächsten Öffnen selbst und laden einmal neu.

## Tests

`node tests/logik.test.js` prüft Stundenzuordnung, Regendauer, Nachtfilter, Ampelgrenzen, Rundung, Modellvergleich und Fenster mit simulierten Daten (`tests/simdaten.js`, `tests/szenario.js`).
