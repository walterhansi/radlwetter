'use strict';
const assert = require('node:assert/strict');
const L = require('../logik.js');
const { erzeuge, idxStunde, vergleich, H } = require('./simdaten.js');

// config.js ist ein Browser-Skript mit globaler Konstante; hier per Auswertung laden.
const fs = require('node:fs');
const CFG = new Function(fs.readFileSync(__dirname + '/../config.js', 'utf8') + '; return RADL_CONFIG;')();

// „Jetzt“: Sa 17.10.2026 14:51 Ortszeit (MESZ, +2h) = 12:51 UTC
const JETZT = Date.UTC(2026, 9, 17, 12, 51) / 1000;
const HEUTE = L.lokalerTag(JETZT, 7200);
let nTests = 0;
const test = (name, fn) => { fn(); nTests++; console.log('  ok  ' + name); };
const kopie = (o) => JSON.parse(JSON.stringify(o));
const spalte = (daten, stunde, tag = HEUTE) => L.baueSpalten(daten, JETZT, CFG).find((s) => s.stunde === stunde && s.tag === tag);

test('Konfiguration: 48 Stunden, Nacht ausblenden, Fenster ab 2 Std., Regen ab 0,1 mm gelb', () => {
  assert.equal(CFG.stunden, 48);
  assert.equal(CFG.nachtAusblenden, true);
  assert.equal(CFG.fenster.mindestStunden, 2);
  assert.equal(CFG.grenzen.gelb.regenMm, 0.1);
  assert.deepEqual(CFG.grenzen.rot, { regenMm: 1, regenProzent: 60, windKmh: 35, boeenKmh: 50, tempUnter: 5 });
});

test('Start bei der aktuellen Stunde (14 Uhr), nicht bei der nächsten', () => {
  const { daten } = erzeuge(JETZT);
  const sp = L.baueSpalten(daten, JETZT, CFG);
  assert.equal(sp[0].stunde, 14);
  assert.equal(sp[0].jetzt, true);
  assert.equal(sp.filter((s) => s.jetzt).length, 1);
});

test('Nachtstunden fehlen, Stunden mit Sonnenauf-/untergang bleiben', () => {
  const { daten } = erzeuge(JETZT);
  const sp = L.baueSpalten(daten, JETZT, CFG);
  const heute = sp.filter((s) => s.tag === sp[0].tag).map((s) => s.stunde);
  assert.deepEqual(heute, [14, 15, 16, 17, 18]);
  const morgen = sp.filter((s) => s.tag === sp[0].tag + 1).map((s) => s.stunde);
  assert.deepEqual(morgen, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  for (const s of sp) assert.ok(s.stunde >= 7 && s.stunde <= 18, 'Nachtstunde ' + s.stunde);
});

test('48-Stunden-Fenster: Übermorgen nur bis 13 Uhr', () => {
  const { daten } = erzeuge(JETZT);
  const sp = L.baueSpalten(daten, JETZT, CFG);
  const uebermorgen = sp.filter((s) => s.tag === sp[0].tag + 2).map((s) => s.stunde);
  assert.deepEqual(uebermorgen, [7, 8, 9, 10, 11, 12, 13]);
  assert.equal(sp[sp.length - 1].ts, sp[0].ts + 47 * H);
});

test('Ohne Nachtfilter bleiben alle 48 Stunden; fehlen Sonnenzeiten, werden alle gezeigt', () => {
  const { daten } = erzeuge(JETZT);
  assert.equal(L.baueSpalten(daten, JETZT, { ...CFG, nachtAusblenden: false }).length, 48);
  delete daten.daily;
  assert.equal(L.baueSpalten(daten, JETZT, CFG).length, 48);
});

test('Stundenzuordnung: Spalte 16 nutzt Regen, Sonne und Böen mit Zeitstempel 17:00, Temperaturen 16:00', () => {
  const { daten, tag0 } = erzeuge(JETZT);
  const h = daten.hourly;
  const i16 = idxStunde(null, 0, 16);
  const i17 = idxStunde(null, 0, 17);
  h.precipitation[i17] = 1.2; h.precipitation_probability[i17] = 80; h.sunshine_duration[i17] = 600;
  h.wind_gusts_10m[i17] = 45; h.wind_gusts_10m[i16] = 99; // 99 darf in Spalte 16 NICHT auftauchen
  h.temperature_2m[i16] = 11.4; h.temperature_2m[i17] = 99;
  h.apparent_temperature[i16] = 8.7; h.apparent_temperature[i17] = 99;
  h.wind_speed_10m[i16] = 21; h.wind_speed_10m[i17] = 77;
  const sp = spalte(daten, 16);
  assert.equal(sp.regenMm, 1.2);
  assert.equal(sp.regenProzent, 80);
  assert.equal(sp.sonneMin, 10);
  assert.equal(sp.boeenKmh, 45);
  assert.equal(sp.temp, 11); // Lufttemperatur ganzzahlig
  assert.equal(sp.gefuehltC, 8.7); // gefühlte Temperatur mit einer Nachkommastelle
  assert.equal(sp.windKmh, 21);
  assert.equal(tag0 + 16 * H, sp.ts);
});

test('Rundung wie angezeigt: Farbe und Zahl passen immer zusammen', () => {
  const { daten } = erzeuge(JETZT);
  const h = daten.hourly;
  const i15 = idxStunde(null, 0, 15);
  const i16 = idxStunde(null, 0, 16);
  // 9,96 °C gefühlt wird als 10,0 angezeigt -> nicht gelb; 9,94 wird als 9,9 angezeigt -> gelb
  h.apparent_temperature[i15] = 9.96; h.apparent_temperature[i16] = 9.94;
  // 24,6 km/h wird als 25 angezeigt -> gelb; 24,4 als 24 -> nicht gelb
  h.wind_speed_10m[i15] = 24.6; h.wind_speed_10m[i16] = 24.4;
  const a = spalte(daten, 15);
  const b = spalte(daten, 16);
  assert.equal(a.gefuehltC, 10);
  assert.equal(a.zellen.gefuehlt, null);
  assert.equal(b.gefuehltC, 9.9);
  assert.equal(b.zellen.gefuehlt, 'gelb');
  assert.equal(a.windKmh, 25);
  assert.equal(a.zellen.wind, 'gelb');
  assert.equal(b.windKmh, 24);
  assert.equal(b.zellen.wind, null);
});

test('Regendauer: Viertelstunden 16:15 bis 17:00 mit >= 0,1 mm, mal 15; Viertelwerte werden mitgegeben', () => {
  const { daten, tag0 } = erzeuge(JETZT);
  const m = daten.minutely_15;
  const setze = (hh, mm, v) => { m.precipitation[m.time.indexOf(tag0 + hh * H + mm * 60)] = v; };
  setze(16, 15, 0.2); setze(16, 30, 0.5); setze(16, 45, 0.09); setze(17, 0, 0.1);
  setze(16, 0, 5); // gehört zu Spalte 15 (Viertelstunde 15:45–16:00)
  const sp = spalte(daten, 16);
  assert.equal(sp.regenDauerMin, 45);
  assert.deepEqual(sp.viertel, [0.2, 0.5, 0.09, 0.1]);
  assert.equal(spalte(daten, 15).regenDauerMin, 15);
});

test('Regendauer und Viertelwerte fehlen (null), wenn Viertelstundenwerte fehlen', () => {
  const { daten } = erzeuge(JETZT);
  delete daten.minutely_15;
  const sp = L.baueSpalten(daten, JETZT, CFG);
  assert.ok(sp.every((s) => s.regenDauerMin === null && s.viertel === null));
});

test('Sonne wird auf 0–60 Minuten begrenzt, fehlendes Feld ergibt null', () => {
  const { daten } = erzeuge(JETZT);
  daten.hourly.sunshine_duration[idxStunde(null, 0, 15)] = 4000;
  daten.hourly.sunshine_duration[idxStunde(null, 0, 16)] = 1799;
  let sp = L.baueSpalten(daten, JETZT, CFG);
  assert.equal(sp[0].sonneMin, 60);
  assert.equal(sp[1].sonneMin, 30);
  delete daten.hourly.sunshine_duration;
  sp = L.baueSpalten(daten, JETZT, CFG);
  assert.ok(sp.every((s) => s.sonneMin === null));
});

const basis = { sonneMin: 60, wolken: 20, temp: 15, gefuehltC: 14, regenProzent: 0, regenMm: 0, regenDauerMin: 0, windKmh: 10, boeenKmh: 20 };
const stufe = (aenderung) => L.bewerte({ ...basis, ...aenderung }, CFG);

test('Ampel: grün, besonders gut', () => {
  assert.equal(stufe({}), 'top');
  assert.equal(stufe({ sonneMin: 59 }), 'gruen');
  assert.equal(stufe({ regenDauerMin: 15, regenMm: 0 }), 'gelb'); // nasse Viertelstunde = gelb
  assert.equal(stufe({ sonneMin: null }), 'gruen'); // fehlt einer der drei Werte
  assert.equal(stufe({ regenDauerMin: null }), 'gruen');
  assert.equal(stufe({ regenMm: null }), 'gruen');
});

test('Ampel: gelb ab 0,1 mm, 30 %, 25 km/h, Böen 40, gefühlt unter 10 °C', () => {
  assert.equal(stufe({ regenMm: 0.09 }), 'gruen'); // Spur: nicht gelb, aber auch nicht „besonders gut“
  assert.equal(stufe({ regenMm: 0.1 }), 'gelb');
  assert.equal(stufe({ regenProzent: 29 }), 'top');
  assert.equal(stufe({ regenProzent: 30 }), 'gelb');
  assert.equal(stufe({ windKmh: 24.9 }), 'top');
  assert.equal(stufe({ windKmh: 25 }), 'gelb');
  assert.equal(stufe({ boeenKmh: 39.9 }), 'top');
  assert.equal(stufe({ boeenKmh: 40 }), 'gelb');
  assert.equal(stufe({ gefuehltC: 10 }), 'top');
  assert.equal(stufe({ gefuehltC: 9.9 }), 'gelb');
});

test('Ampel: rot ab 1 mm, 60 %, 35 km/h, Böen 50, gefühlt unter 5 °C', () => {
  assert.equal(stufe({ regenMm: 0.99 }), 'gelb');
  assert.equal(stufe({ regenMm: 1 }), 'rot');
  assert.equal(stufe({ regenProzent: 59 }), 'gelb');
  assert.equal(stufe({ regenProzent: 60 }), 'rot');
  assert.equal(stufe({ windKmh: 34.9 }), 'gelb');
  assert.equal(stufe({ windKmh: 35 }), 'rot');
  assert.equal(stufe({ boeenKmh: 49.9 }), 'gelb');
  assert.equal(stufe({ boeenKmh: 50 }), 'rot');
  assert.equal(stufe({ gefuehltC: 5 }), 'gelb');
  assert.equal(stufe({ gefuehltC: 4.9 }), 'rot');
});

test('Temperatur: gefühlte Temperatur ist die Grundlage, sonst die Lufttemperatur', () => {
  assert.equal(stufe({ temp: 15, gefuehltC: 4 }), 'rot'); // Wind drückt die gefühlte Temperatur
  assert.equal(stufe({ temp: 4, gefuehltC: 12 }), 'top'); // Sonne hebt sie an
  assert.equal(stufe({ temp: 4, gefuehltC: null }), 'rot'); // ohne gefühlte Temperatur: Luft
  const b1 = L.bewertung({ ...basis, temp: 15, gefuehltC: 8 }, CFG);
  assert.equal(b1.zellen.gefuehlt, 'gelb');
  assert.equal(b1.zellen.temp, null);
  const b2 = L.bewertung({ ...basis, temp: 8, gefuehltC: null }, CFG);
  assert.equal(b2.zellen.temp, 'gelb');
  assert.equal(b2.zellen.gefuehlt, null);
});

test('Ursachen: Reihenfolge Regen, Wind, Temperatur; nur die der höchsten Stufe', () => {
  assert.deepEqual(L.bewertung({ ...basis, windKmh: 36, regenMm: 1.2 }, CFG).ursachen, ['regen', 'wind']);
  assert.deepEqual(L.bewertung({ ...basis, gefuehltC: 8 }, CFG).ursachen, ['temp']);
  assert.deepEqual(L.bewertung({ ...basis, boeenKmh: 45 }, CFG).ursachen, ['wind']);
  // rot durch Wind, gelb durch Temperatur: nur Wind
  assert.deepEqual(L.bewertung({ ...basis, windKmh: 40, gefuehltC: 8 }, CFG).ursachen, ['wind']);
  assert.deepEqual(L.bewertung({ ...basis, regenDauerMin: 30, gefuehltC: 8, windKmh: 26 }, CFG).ursachen, ['regen', 'wind', 'temp']);
  assert.deepEqual(L.bewertung({ ...basis }, CFG).ursachen, []);
});

test('Ampel: Wolken und Tageszeit zählen für rot/gelb nicht; fehlende Werte lösen nichts aus', () => {
  assert.equal(stufe({ sonneMin: 0, wolken: 100 }), 'gruen');
  const leer = { sonneMin: null, wolken: null, temp: null, gefuehltC: null, regenProzent: null, regenMm: null, regenDauerMin: null, windKmh: null, boeenKmh: null };
  assert.equal(L.bewerte(leer, CFG), 'gruen');
});

test('Modell-Einigkeit beim Regen', () => {
  assert.equal(L.modellStatus([0, 0, 0], CFG), 'einig-trocken');
  assert.equal(L.modellStatus([0.5, 0.4], CFG), 'einig-nass');
  assert.equal(L.modellStatus([0, 0.5], CFG), 'uneinig');
  assert.equal(L.modellStatus([0.2, 0.05], CFG), 'uneinig'); // genau nassMm gegen trocken
  assert.equal(L.modellStatus([0.19, 0], CFG), 'schwach'); // nur Spuren, kein Widerspruch
  assert.equal(L.modellStatus([0.15, 0.15], CFG), 'schwach');
  assert.equal(L.modellStatus([0.5], CFG), 'unbekannt');
  assert.equal(L.modellStatus([], CFG), 'unbekannt');
});

test('Uneinigkeit: Spalte wird markiert und „besonders gut“ fällt auf grün zurück', () => {
  const { daten } = erzeuge(JETZT);
  const ecmwf = vergleich(daten, 'ECMWF', 0);
  const gfs = vergleich(daten, 'GFS', 0);
  ecmwf.hourly.precipitation[idxStunde(null, 0, 17)] = 0.5; // betrifft Spalte 16 (Zeitstempel 17:00)
  daten.vergleich = [ecmwf, gfs];
  const unsicher = spalte(daten, 16);
  assert.equal(unsicher.modellStatus, 'uneinig');
  assert.equal(unsicher.stufe, 'gruen');
  assert.equal(unsicher.topAbgewertet, true);
  assert.deepEqual(unsicher.modelle.map((x) => x.name), ['ICON', 'ECMWF', 'GFS']);
  const sicher = spalte(daten, 15);
  assert.equal(sicher.modellStatus, 'einig-trocken');
  assert.equal(sicher.stufe, 'top');
});

test('Ohne Vergleichsmodelle: Status „unbekannt“, „besonders gut“ bleibt erhalten', () => {
  const { daten } = erzeuge(JETZT);
  const sp = spalte(daten, 15);
  assert.equal(sp.modellStatus, 'unbekannt');
  assert.equal(sp.stufe, 'top');
});

test('Vergleichsmodell mit anderen Zeitstempeln: nach Zeit zugeordnet, fehlende Werte ignoriert', () => {
  const { daten } = erzeuge(JETZT);
  const v = vergleich(daten, 'ECMWF', 0);
  v.hourly.time = v.hourly.time.slice(0, 20); // endet früh -> für spätere Spalten kein Wert
  v.hourly.precipitation = v.hourly.precipitation.slice(0, 20);
  daten.vergleich = [v];
  assert.equal(spalte(daten, 15).modelle.length, 2);
  assert.equal(spalte(daten, 15, HEUTE + 1).modelle.length, 1);
  assert.equal(spalte(daten, 15, HEUTE + 1).modellStatus, 'unbekannt');
});

const mk = (i, st, tag = 1, status = 'einig-trocken', basisTs = 1000 * H) => ({ ts: basisTs + i * H, stufe: st, tag, modellStatus: status });

test('Fenster je Tag: mindestens 2 Stunden, längster Block, bei Gleichstand weniger unsichere', () => {
  const sp = [
    // Tag 1: einzelne Stunde zählt nicht, danach 3 Stunden (mit 1x „besonders gut“)
    mk(0, 'gruen'), mk(1, 'rot'), mk(2, 'gruen'), mk(3, 'gruen'), mk(4, 'top'), mk(5, 'gelb'),
    // Tag 2 (14 Stunden später): zwei Blöcke à 2 Stunden, der erste unsicher
    mk(14, 'gruen', 2, 'uneinig'), mk(15, 'gruen', 2), mk(16, 'rot', 2), mk(17, 'gruen', 2), mk(18, 'gruen', 2),
    // Tag 3: nur Einzelstunden
    mk(38, 'gruen', 3), mk(39, 'gelb', 3), mk(40, 'gruen', 3),
  ];
  const f = L.fensterProTag(sp, CFG);
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].von, f[0].bis, f[0].stunden, f[0].top], [2, 4, 3, 1]);
  // Positionen: Tag 2 beginnt bei Index 6; der erste Block (6–7) ist unsicher, der zweite (9–10) sicher
  assert.deepEqual([f[1].von, f[1].bis, f[1].unsicher], [9, 10, 0]);
  assert.equal(L.fensterProTag([mk(0, 'gruen'), mk(1, 'rot'), mk(2, 'gruen')], CFG).length, 0);
});

test('Fenster: Nachtlücke und Tageswechsel trennen Blöcke; Mindestlänge ist einstellbar', () => {
  const sp = [mk(0, 'gruen'), mk(13, 'gruen')]; // Lücke (Nacht)
  assert.equal(L.fensterProTag(sp, { fenster: { mindestStunden: 2 } }).length, 0);
  assert.equal(L.fensterProTag(sp, { fenster: { mindestStunden: 1 } }).length, 1); // einer je Tag? gleicher Tag -> bester
  const zweiTage = [mk(0, 'gruen', 1), mk(1, 'gruen', 2)]; // lückenlos, aber anderer Tag
  assert.equal(L.fensterProTag(zweiTage, { fenster: { mindestStunden: 2 } }).length, 0);
  assert.equal(L.fensterProTag([mk(0, 'gruen'), mk(1, 'gruen'), mk(2, 'gruen')], { fenster: { mindestStunden: 3 } })[0].stunden, 3);
});

test('Bestes Fenster insgesamt: längster Block, Nacht unterbricht', () => {
  const t0 = 1000 * H;
  const m = (ts, s) => ({ ts, stufe: s });
  const sp = [m(t0, 'gruen'), m(t0 + H, 'gruen'), m(t0 + 2 * H, 'rot'),
    m(t0 + 3 * H, 'gruen'), m(t0 + 4 * H, 'top'), m(t0 + 5 * H, 'gruen'),
    m(t0 + 14 * H, 'gruen'), m(t0 + 15 * H, 'gruen'), m(t0 + 16 * H, 'gruen')];
  const b = L.besteZeit(sp);
  assert.deepEqual([b.von, b.bis], [3, 5]);
  assert.equal(L.besteZeit([m(t0, 'rot'), m(t0 + H, 'gelb')]), null);
  const b2 = L.besteZeit([m(t0, 'gruen'), m(t0 + 13 * H, 'gruen')]);
  assert.equal(b2.bis - b2.von, 0);
  assert.equal(L.besteZeit([m(t0, 'gruen'), m(t0 + 13 * H, 'gruen')], 2), null);
});

test('Regenausblick: trocken bis (Beginn der nassen Viertelstunde), regnet jetzt, kein Regen', () => {
  const { daten, tag0 } = erzeuge(JETZT);
  const m = daten.minutely_15;
  const setze = (hh, mi, v) => { m.precipitation[m.time.indexOf(tag0 + hh * H + mi * 60)] = v; };
  // alles trocken
  let a = L.regenAusblick(daten, JETZT, CFG);
  assert.equal(a.status, 'kein-regen');
  assert.equal(a.bis, JETZT + 48 * H);
  // Regen in der Viertelstunde mit Zeitstempel 16:30 (= 16:15 bis 16:30) -> trocken bis 16:15
  setze(16, 30, 0.3);
  a = L.regenAusblick(daten, JETZT, CFG);
  assert.equal(a.status, 'trocken');
  assert.equal(a.bis, tag0 + 16 * H + 15 * 60);
  // laufende Viertelstunde (Zeitstempel 15:00) und die nächste nass -> regnet bis 15:15
  setze(15, 0, 0.2); setze(15, 15, 0.1);
  a = L.regenAusblick(daten, JETZT, CFG);
  assert.equal(a.status, 'regnet');
  assert.equal(a.bis, tag0 + 15 * H + 15 * 60);
  // ohne Viertelstundenwerte: keine Aussage
  delete daten.minutely_15;
  assert.equal(L.regenAusblick(daten, JETZT, CFG), null);
});

test('Ergänzung: Wahrscheinlichkeit, Böen, gefühlte Temperatur und Viertelstunden aus zweitem Abruf', () => {
  const { daten: a } = erzeuge(JETZT);
  const b = kopie(a);
  a.hourly.precipitation_probability = a.hourly.time.map(() => null);
  a.hourly.wind_gusts_10m = a.hourly.time.map(() => null);
  delete a.hourly.apparent_temperature;
  delete a.minutely_15;
  b.hourly.precipitation_probability[20] = 55;
  b.hourly.wind_gusts_10m[21] = 61;
  b.hourly.apparent_temperature[22] = 3.3;
  b.minutely_15.precipitation[3] = 0.4;
  assert.equal(L.brauchtErgaenzung(a), true);
  L.ergaenze(a, b);
  assert.equal(a.hourly.precipitation_probability[20], 55);
  assert.equal(a.hourly.wind_gusts_10m[21], 61);
  assert.equal(a.hourly.apparent_temperature[22], 3.3);
  assert.equal(a.minutely_15.precipitation[3], 0.4);
  assert.equal(L.brauchtErgaenzung(a), false);
});

test('Ergänzung: vollständige Antwort braucht keinen Zweitabruf', () => {
  const { daten } = erzeuge(JETZT);
  daten.hourly.precipitation_probability[10] = 5;
  assert.equal(L.brauchtErgaenzung(daten), false);
});

test('Lokale Zeit aus Unixzeit mit Offset', () => {
  assert.equal(L.lokaleStunde(JETZT, 7200), 14);
  assert.equal(L.lokaleStunde(JETZT, 0), 12);
  assert.equal(L.lokaleStunde(JETZT, -3600 * 5), 7);
});

console.log('\n' + nTests + ' Tests bestanden');
