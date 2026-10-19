/* Radlwetter – Einstellungen. Hier stehen alle Grenzwerte und Vorgaben. */
const RADL_CONFIG = {
  // Wird bei jeder Änderung hochgezählt; der Service Worker nutzt sie als Cache-Name.
  version: '1.1.0',

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
    gelb: { regenMm: 0.1, regenDauerMin: 15, regenProzent: 30, windKmh: 25, boeenKmh: 40, tempUnter: 10 },
  },

  // „Besonders gut“: grüne Stunde UND Sonne, trocken, keine Regendauer – und Modelle einig beim Regen
  ampelTop: { sonneMin: 60, regenMm: 0, regenDauerMin: 0 },

  // Einigkeit der Modelle beim Regen (mm je Stunde):
  // uneinig = mindestens ein Modell ab nassMm UND mindestens eines unter trockenMm
  unsicherheit: { nassMm: 0.2, trockenMm: 0.1 },

  // Bestes Radlfenster je Tag: mindestens so viele zusammenhängende grüne Stunden
  fenster: { mindestStunden: 2 },
};
