/* Schreibt eine simulierte Open-Meteo-Antwort mit abwechslungsreichem Wetter für JETZT (Testhilfe).
 * Aufruf: node tests/szenario.js <ausgabedatei.json> */
'use strict';
const fs = require('node:fs');
const { erzeuge, H } = require('./simdaten.js');

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
// Heute spät: leichter Wind-Anstieg und etwas Wolken
h.wind_speed_10m[idx(0, 17)] = 27; h.wind_speed_10m[idx(0, 18)] = 31;
// Übermorgen: trüb, wenig Sonne
for (let s = 8; s <= 19; s++) h.sunshine_duration[idx(2, s)] = 900;
// Morgen früh sehr kalt
h.temperature_2m[idx(1, 7)] = 3.2; h.temperature_2m[idx(1, 8)] = 4.6;

fs.writeFileSync(process.argv[2], JSON.stringify(daten));
console.log('geschrieben:', process.argv[2]);
