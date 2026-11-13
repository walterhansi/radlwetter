# Radlwetter

Eigenständige PWA: Wettervorschau fürs Rennrad. Nächste 48 Stunden, nur Tageslicht (Stunden vor Sonnenaufgang und nach Sonnenuntergang fehlen), mit Ampel, DWD-Regenradar, amtlichen Warnungen und automatischer Trefferquote.

Live: https://walterhansi.github.io/radlwetter/

## Prioritäten

Die Bewertung folgt dieser Reihenfolge: 1. möglichst kein Niederschlag, 2. nicht zu windig, 3. Sonnenschein, 4. Temperatur ab 10 °C. Die Windrichtung wird **nicht** bewertet (der Pfeil dient nur der Anzeige).

## Oberfläche

Oben: amtliche DWD-Warnungen für den Ort (falls vorhanden), „Trocken bis …“ bzw. „Regnet bis …“ (zuerst DWD-Radar, danach ICON-Viertelstunden; die Quelle steht dahinter), darunter das **beste Radlfenster je Tag** (mindestens 2 zusammenhängende Stunden, grün oder besonders gut) und ein Hinweis, wenn die Wettermodelle beim Regen uneinig sind.

Tabelle (von oben nach unten):

1. **Rennrad** – Ampel; darunter kleine Symbole, **warum** gelb oder rot (Gewitter, Warnung, Regen, Schauer in der Nähe, Glätte, nasse Straße, Wind, Temperatur); Uneinigkeit der Modelle zeigt die Zeile „Modelle“ mit „?“
2. Regen mm – kleines „R“ = Wert vom DWD-Radar (gemessen oder 2-Std.-Vorschau); die Farbe der Zahl (gelb/rot) zeigt wie immer die Menge
3. Regendauer – Viertelstunden-Balken plus Minuten
4. Regen % – Anteil der 20 Läufe des D2-Ensembles mit Regen (danach ICON-EPS)
5. Modelle (Regen) – Vergleich ICON / ECMWF / GFS / DWD-Stationsvorhersage
6. Gefahr – Gewitter, Schauer in der Nähe (5 km), Glätte, nasse Straße, DWD-Warnung (Umriss-Dreieck = Hinweis ohne Ampelwirkung, z. B. Frost)
7. Wind km/h mit Richtungspfeil
8. Böen km/h
9. Sonne (Minuten)
10. Temperatur °C
11. Gefühlte Temperatur °C (zählt für die 10-°C-Grenze)
12. Wolken % (zählt nicht für die Ampel)

Neben dem Rennrad in der Tabelle eine kleine Ampel als Zeichen für die Ampelzeile. Unten: **Treffsicherheit** der letzten 3 Tage als eine Zeile (Einzelheiten beim Darüberfahren) und die Schaltfläche **„So schaltet die Ampel“** mit einer Erklärung (die Grenzwerte darin kommen direkt aus `config.js`).

Zellen, die gelb oder rot wirken, sind selbst gelb/rot markiert.

## Ampel (Grenzen in `config.js`, `grenzen`)

| Stufe | Bedingung (eine genügt) |
|---|---|
| rot | Regen ab 1 mm/h, ab 60 %, Wind ab 35 km/h, Böen ab 50 km/h, gefühlt unter 5 °C, **Gewitter** (Wettercode 95/96/99), **Glätte** (Luft ≤ 2 °C und nass/Regen/Schnee) oder **amtliche DWD-Warnung** vor Gewitter, Glätte, Sturm/Orkan, Stark-/Dauerregen, Unwetter |
| gelb | messbarer Regen (ab 0,1 mm/h oder eine nasse Viertelstunde), Regen ab 30 %, Wind ab 25 km/h, Böen ab 40 km/h, gefühlt unter 10 °C, **nasse Straße** (ab 0,3 mm in den 2 Stunden davor) **Blitzpotenzial** ab 1 J/kg (ICON-D2) oder **Schauer in der Nähe** (Radar: mindestens 10 % der Fläche im Umkreis von 5 km mit Regen, am Ort selbst trocken) |
| grün | sonst |
| besonders gut | grün **und** Sonne 60 min, 0 mm, Regendauer 0 (fehlt einer der Werte, bleibt es normal grün); bei Modell-Uneinigkeit nur grün |

Die Böen-Grenzen (40/50), die Blitzpotenzial-Grenze (1 J/kg), die Nässe-Grenze (0,3 mm) und die Glätte-Grenze (2 °C) sind Vorschläge, keine belegten Werte. In Radar-Stunden zählt die Regenwahrscheinlichkeit nicht (das Radar ist dort genauer). Angezeigte Werte sind gerundet, die Farbe richtet sich nach dem angezeigten Wert. Fehlende Werte lösen nichts aus.

## Unsicherheit

Zusätzlich zu ICON werden ECMWF, GFS und die DWD-Stationsvorhersage MOSMIX (nächste Station, für Moosburg Nandlstadt) nur für den Niederschlag abgefragt. „Uneinig“ heißt: ein Modell ≥ 0,2 mm/h, ein anderes < 0,1 mm/h (`unsicherheit` in `config.js`). Solche Stunden zeigen in der Zeile „Modelle“ ein „?“, der Hinweis oben nennt sie, und das beste Fenster nennt die unsicheren Stunden. Ist der Vergleich nicht verfügbar, steht das sichtbar da.

## Radar

DWD-Radarkomposit RV über Bright Sky (`/radar`, 1 km, alle 5 Minuten, gemessen + Vorschau bis 2 Stunden). Je 5-Minuten-Bild zählt der höchste Wert im Umkreis von 1 km. Eine Stunde nutzt das Radar nur, wenn alle 12 Bilder da sind (meist die laufende und die nächste Stunde). „Regen“ im Ausblick ab 0,02 mm je 5 Minuten (`radar` in `config.js`). Das Radar wird alle 5 Minuten neu geholt.

Umkreis: Zusätzlich wertet die App je Radarbild den Kreis von 5 km aus (rund 80 Felder à 1 km²): Anteil der Fläche mit Regen und Entfernung zum nächsten Regen. Ab 10 % (`nahAnteilProzent`, ein Vorschlag) wird die Stunde gelb mit dem Grund „Schauer in der Nähe“ – nicht rot, denn Regenmenge und Rot bleiben beim Ort selbst. Der Ausblick nennt es zusätzlich („Schauer im Umkreis von 5 km ab … (nächster ca. … km)“). So werden knapp vorbeiziehende Schauer und kleine Fehler der Radar-Vorschau bei der Zugbahn erfasst, ohne an Schauertagen ständig Rot zu zeigen.

## Treffsicherheit

Alle 6 Stunden vergleicht die App die ICON-Vorhersage von 24 Stunden vorher (Open-Meteo Previous Runs API) mit den DWD-Messwerten der letzten 3 Tage (Bright Sky: Regen meist Nandlstadt, Wind/Böen teils Nachbarstationen wie München-Flughafen). Bewertet werden Regenmenge, Wind, Böen und Lufttemperatur, nur Tageslicht-Stunden. Angezeigt: wie oft die Ampelfarbe übereinstimmt, wie oft sie zu optimistisch bzw. zu vorsichtig war, und wie oft „Regen ja/nein“ stimmte. Damit lassen sich die Grenzwerte begründet nachstellen.

## Daten

Open-Meteo: ICON (`icon_seamless`, dazu Wettercode, Blitzpotenzial, Schnee), D2-Ensemble (`ensemble-api`, `icon_d2`), Vergleich ECMWF und GFS, Vorhersage vom Vortag (`previous-runs-api`). Deutscher Wetterdienst über Bright Sky (kostenlos, ohne Schlüssel, nur Deutschland): Radar, Stationsvorhersage MOSMIX, Messwerte, Warnungen. Fällt eine Zusatzquelle aus, fehlt nur sie (Hinweis unter „Modelle“). Die Modell-Kennungen werden der Reihe nach probiert (nur bei HTTP 400); die funktionierende merkt sich das Gerät. Fehlt beim Hauptmodell etwas (Regenwahrscheinlichkeit, Böen, gefühlte Temperatur, Viertelstundenwerte), folgt ein zweiter Abruf ohne Modellwahl.

- Regen mm, Regen %, Sonne und Böen sind bei Open-Meteo Werte der **vorangegangenen** Stunde. Die Spalte „19“ (19–20 Uhr) zeigt deshalb den Eintrag mit Zeitstempel 20:00. Temperatur, Wolken und Wind gelten für den Zeitstempel selbst.
- Regendauer = Viertelstunden mit mindestens 0,1 mm (`regenSchwelle`) mal 15.
- Nacht: Eine Stunde bleibt, wenn sie sich mit der Zeit zwischen Sonnenauf- und -untergang überschneidet.
- Hinweis: Open-Meteo stellt ICON nach dem 30.11.2026 auf native Gitter um. `icon_seamless` sollte weiterlaufen; falls nicht, greift die Ausweichkette (andere Kennung, dann Abruf ohne Modellwahl).
- Abruf beim Laden, alle 15 Minuten (Radar alle 5 Minuten), bei Stundenwechsel und bei Rückkehr zum Tab. Ohne Verbindung zeigt die App gespeicherte Daten (bis 6 Stunden alt).
- Ort: Standard Moosburg (48,47 / 11,94); über das Orts-Symbol änderbar (Suche), wird im Gerät gespeichert.

## Dateien

`index.html`, `style.css`, `config.js` (Grenzwerte, Version), `logik.js` (Auswertung), `app.js` (Oberfläche, Abruf), `sw.js` (Offline, Selbst-Update), `manifest.webmanifest`, `icons/`.

## Änderungen veröffentlichen

Nach dem Push auf `main` ist die Seite per GitHub Pages in ca. 1 Minute online (einmalig: Settings → Pages → Deploy from branch `main`, `/ (root)`). Die Version in `config.js` wird bei jeder Änderung hochgezählt; installierte Apps holen sich die neue Fassung beim nächsten Öffnen selbst und laden einmal neu.

## Tests

`node tests/logik.test.js` prüft Stundenzuordnung, Regendauer, Nachtfilter, Ampelgrenzen, Rundung, Modellvergleich, Fenster, Radar, D2-Ensemble, DWD-Vergleich, Gewitter, Nässe, Glätte, Warnungen und Treffsicherheit mit simulierten Daten (`tests/simdaten.js`, `tests/szenario.js`).
