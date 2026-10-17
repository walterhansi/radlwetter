/* Radlwetter – Einstellungen. Hier stehen alle Grenzwerte und Vorgaben. */
const RADL_CONFIG = {
  // Wird bei jeder Änderung hochgezählt; der Service Worker nutzt sie als Cache-Name.
  version: '1.0.0',

  // Standard-Ort (im Programm per Ortswahl änderbar)
  ort: { name: 'Moosburg', lat: 48.47, lon: 11.94 },

  // Zeitfenster ab jetzt in Stunden; Nachtstunden werden daraus entfernt
  stunden: 48,
  nachtAusblenden: true,

  // Wettermodell (Open-Meteo); fehlen Werte, folgt ein Abruf ohne Modellwahl
  modell: 'icon_seamless',

  // Regendauer: Viertelstunden mit mindestens so viel Regen (mm) zählen als nass
  regenSchwelle: 0.1,

  // Aktualisierung
  intervallMinuten: 15,
  maxAlterOfflineStunden: 6,

  // Ampel: rot, wenn EINE Bedingung zutrifft; sonst gelb, wenn EINE zutrifft; sonst grün
  grenzen: {
    rot:  { regenMm: 1,   regenProzent: 60, windKmh: 35, tempUnter: 5 },
    gelb: { regenMm: 0.3, regenProzent: 30, windKmh: 25, tempUnter: 10 },
  },

  // „Besonders gut“: grüne Stunde UND Sonne, trocken und kein Regen in der Stunde
  ampelTop: { sonneMin: 60, regenMm: 0, regenDauerMin: 0 },
};
