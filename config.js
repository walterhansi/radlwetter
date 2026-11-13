/* Radlwetter – Einstellungen. Hier stehen alle Grenzwerte und Vorgaben. */
const RADL_CONFIG = {
  // Wird bei jeder Änderung hochgezählt; der Service Worker nutzt sie als Cache-Name.
  version: '1.2.1',

  // Standard-Ort (im Programm per Ortswahl änderbar)
  ort: { name: 'Moosburg', lat: 48.47, lon: 11.94 },

  // Zeitfenster ab jetzt in Stunden; Nachtstunden werden daraus entfernt
  stunden: 48,
  nachtAusblenden: true,

  // Hauptmodell (Open-Meteo, ICON). Die Kennungen werden der Reihe nach probiert;
  // schlägt alles fehl, folgt ein Abruf ohne Modellwahl.
  modell: ['icon_seamless', 'dwd_icon_seamless'],

  // Vergleichsmodelle nur für die Einigkeit beim Regen. Auch hier werden die Kennungen
  // der Reihe nach probiert (die Doku und ältere Fassungen nennen unterschiedliche Namen).
  vergleichsmodelle: [
    { name: 'ECMWF', ids: ['ecmwf_ifs', 'ecmwf_ifs025'] },
    { name: 'GFS', ids: ['ncep_gfs_seamless', 'gfs_seamless'] },
  ],

  // DWD-Stationsvorhersage (MOSMIX über Bright Sky) als weiteres Vergleichsmodell beim Regen.
  // Bright Sky wählt die nächste Vorhersagestation (für Moosburg: Nandlstadt, ca. 10 km).
  dwdVergleich: true,

  // Regenwahrscheinlichkeit aus dem DWD-Ensemble ICON-D2-EPS (20 Läufe, 2 km, 48 Std.).
  // Anteil der Läufe mit mindestens regenSchwelle mm in der Stunde. Danach: ICON-EPS von Open-Meteo.
  ensemble: ['icon_d2', 'icon_d2_eps'],

  // DWD-Regenradar (Bright Sky, 1 km, 5 Minuten, gemessen + 2 Stunden Vorschau).
  // umkreisKm: höchster Wert im Umkreis zählt; nassMm5: ab so viel mm je 5 Minuten gilt „Regen“.
  radar: { aktiv: true, umkreisKm: 1, nassMm5: 0.02, intervallMinuten: 5 },

  // Amtliche DWD-Warnungen für den Ort (Bright Sky). Gewitter, Glätte, Sturm, Starkregen -> rot.
  warnungen: true,

  // Nasse Straße: mindestens so viel Regen (mm) in den 2 Stunden davor -> gelb
  nasseStrasse: { mm: 0.3 },

  // Glätte: Lufttemperatur höchstens tempMax °C und Straße nass, Regen oder Schnee -> rot
  glaette: { tempMax: 2 },

  // Treffsicherheit: Vorhersage vom Vortag gegen DWD-Messwerte der letzten Tage
  treffsicherheit: { tage: 7, alleStunden: 6 },

  // Regendauer: Viertelstunden mit mindestens so viel Regen (mm) zählen als nass
  regenSchwelle: 0.1,

  // Aktualisierung
  intervallMinuten: 15,
  maxAlterOfflineStunden: 6,

  // Ampel: rot, wenn EINE Bedingung zutrifft; sonst gelb, wenn EINE zutrifft; sonst grün.
  // Reihenfolge deiner Wichtigkeit: 1 Regen, 2 Wind, 3 Sonne (nur „besonders gut“), 4 Temperatur.
  // Temperatur zählt als GEFÜHLTE Temperatur (Wind, Feuchte, Strahlung); fehlt sie, die Lufttemperatur.
  grenzen: {
    rot:  { regenMm: 1,   regenProzent: 60, windKmh: 35, boeenKmh: 50, tempUnter: 5 },
    gelb: { regenMm: 0.1, regenDauerMin: 15, regenProzent: 30, windKmh: 25, boeenKmh: 40, tempUnter: 10, blitzJkg: 1 },
  },
  // Gewitter: Wettercode 95/96/99 -> immer rot. Blitzpotenzial (ICON-D2, J/kg) ab blitzJkg -> gelb
  // (der Wert 1 ist ein Vorschlag, kein belegter Grenzwert).

  // „Besonders gut“: grüne Stunde UND Sonne, trocken, keine Regendauer – und Modelle einig beim Regen
  ampelTop: { sonneMin: 60, regenMm: 0, regenDauerMin: 0 },

  // Einigkeit der Modelle beim Regen (mm je Stunde):
  // uneinig = mindestens ein Modell ab nassMm UND mindestens eines unter trockenMm
  unsicherheit: { nassMm: 0.2, trockenMm: 0.1 },

  // Bestes Radlfenster je Tag: mindestens so viele zusammenhängende grüne Stunden
  fenster: { mindestStunden: 2 },
};
