/* Schreibt simulierte Open-Meteo-Antworten mit abwechslungsreichem Wetter für JETZT (Testhilfe):
 *   primary.json  Hauptmodell (ICON), ecmwf.json und gfs.json Vergleichsmodelle (nur Niederschlag)
 * Aufruf: node tests/szenario.js <ausgabeordner> */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { erzeuge, vergleich, H } = require('./simdaten.js');

const jetzt = Math.floor(Date.now() / 1000);
const { daten, tag0 } = erzeuge(jetzt);
const h = daten.hourly;
const m = daten.minutely_15;
const idx = (tag, std) => tag * 24 + std;

for (let i = 0; i < h.time.length; i++) h.precipitation_probability[i] = 5 + ((i * 7) % 20);

// Morgen 10–12 Uhr: Regenschauer (Werte der vorangegangenen Stunde, Zeitstempel 11:00 und 12:00)
h.precipitation[idx(1, 11)] = 1.4; h.precipitation_probability[idx(1, 11)] = 90; h.sunshine_duration[idx(1, 11)] = 0;
h.precipitation[idx(1, 12)] = 0.4; h.precipitation_probability[idx(1, 12)] = 45; h.sunshine_duration[idx(1, 12)] = 600;
const quart = (tag, std, minute, v) => { m.precipitation[m.time.indexOf(tag0 + tag * 86400 + std * H + minute * 60)] = v; };
quart(1, 10, 30, 0.4); quart(1, 10, 45, 0.5); quart(1, 11, 0, 0.5);
quart(1, 11, 15, 0.2); quart(1, 11, 30, 0.2);
// Morgen 16 Uhr: leichter Nieselregen (0,1 mm in einer Viertelstunde) -> gelb ab 0,1 mm
h.precipitation[idx(1, 17)] = 0.1; quart(1, 16, 30, 0.1);
// Heute später und morgen früh: Wind und Böen
h.wind_speed_10m[idx(0, 17)] = 27; h.wind_speed_10m[idx(0, 18)] = 31;
h.wind_gusts_10m[idx(0, 18)] = 52; h.wind_gusts_10m[idx(0, 19)] = 44;
// Übermorgen: trüb, wenig Sonne
for (let s = 8; s <= 19; s++) h.sunshine_duration[idx(2, s)] = 900;
// Morgen früh sehr kalt (gefühlt noch kälter), danach zunächst kühl
h.temperature_2m[idx(1, 7)] = 3.2; h.temperature_2m[idx(1, 8)] = 4.6;
h.apparent_temperature[idx(1, 7)] = 0.9; h.apparent_temperature[idx(1, 8)] = 2.7; h.apparent_temperature[idx(1, 9)] = 7.5;

// Vergleichsmodelle: ECMWF meldet morgen 14–16 Uhr Regen, wo ICON trocken ist (Zeitstempel 15:00 und 16:00)
const ecmwf = vergleich(daten, 'ECMWF', 0);
ecmwf.hourly.precipitation[idx(1, 15)] = 0.6; ecmwf.hourly.precipitation[idx(1, 16)] = 0.3;
// … und ist beim Schauer am Vormittag einig mit ICON
ecmwf.hourly.precipitation[idx(1, 11)] = 1.1; ecmwf.hourly.precipitation[idx(1, 12)] = 0.5;
const gfs = vergleich(daten, 'GFS', 0);
gfs.hourly.precipitation[idx(1, 11)] = 0.9; gfs.hourly.precipitation[idx(1, 12)] = 0.4;

const ordner = process.argv[2];
const schreibe = (name, obj) => fs.writeFileSync(path.join(ordner, name), JSON.stringify(obj));
schreibe('primary.json', daten);
// Antwortformat der Vergleichsmodelle wie bei Open-Meteo (nur Stundenwerte des Niederschlags)
const antwort = (v) => ({ latitude: 48.47, longitude: 11.94, utc_offset_seconds: daten.utc_offset_seconds, hourly: v.hourly });
schreibe('ecmwf.json', antwort(ecmwf));
schreibe('gfs.json', antwort(gfs));
console.log('geschrieben in', ordner);
