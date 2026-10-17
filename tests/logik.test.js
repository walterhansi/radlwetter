'use strict';
const assert = require('node:assert/strict');
const L = require('../logik.js');
const { erzeuge, idxStunde, H } = require('./simdaten.js');

// config.js ist ein Browser-Skript mit globaler Konstante; hier per Auswertung laden.
const fs = require('node:fs');
const CFG = new Function(fs.readFileSync(__dirname + '/../config.js', 'utf8') + '; return RADL_CONFIG;')();

// „Jetzt“: Sa 17.10.2026 14:51 Ortszeit (MESZ, +2h) = 12:51 UTC
const JETZT = Date.UTC(2026, 9, 17, 12, 51) / 1000;
let nTests = 0;
const test = (name, fn) => { fn(); nTests++; console.log('  ok  ' + name); };
const kopie = (o) => JSON.parse(JSON.stringify(o));

test('Konfiguration: 48 Stunden, Nacht ausblenden', () => {
  assert.equal(CFG.stunden, 48);
  assert.equal(CFG.nachtAusblenden, true);
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
  // Heute: Untergang 18:19 -> Stunde 18 bleibt, 19 fällt weg. Morgen: Aufgang 7:40 -> Stunde 7 bleibt, 6 fällt weg.
  const heute = sp.filter((s) => s.tag === sp[0].tag).map((s) => s.stunde);
  assert.deepEqual(heute, [14, 15, 16, 17, 18]);
  const morgen = sp.filter((s) => s.tag === sp[0].tag + 1).map((s) => s.stunde);
  assert.deepEqual(morgen, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  for (const s of sp) assert.ok(s.stunde >= 7 && s.stunde <= 18, 'Nachtstunde ' + s.stunde);
});

test('48-Stunden-Fenster: Übermorgen nur bis 13 Uhr (14 Uhr wäre Stunde 49)', () => {
  const { daten } = erzeuge(JETZT);
  const sp = L.baueSpalten(daten, JETZT, CFG);
  const uebermorgen = sp.filter((s) => s.tag === sp[0].tag + 2).map((s) => s.stunde);
  assert.deepEqual(uebermorgen, [7, 8, 9, 10, 11, 12, 13]);
  // letzte Spalte = Stunde 47 nach dem Start (übermorgen 13 Uhr)
  assert.equal(sp[sp.length - 1].ts, sp[0].ts + 47 * H);
});

test('Ohne Nachtfilter bleiben alle 48 Stunden', () => {
  const { daten } = erzeuge(JETZT);
  const sp = L.baueSpalten(daten, JETZT, { ...CFG, nachtAusblenden: false });
  assert.equal(sp.length, 48);
});

test('Fehlen Sonnenzeiten, werden alle Stunden angezeigt (kein Raten)', () => {
  const { daten } = erzeuge(JETZT);
  delete daten.daily;
  const sp = L.baueSpalten(daten, JETZT, CFG);
  assert.equal(sp.length, 48);
});

test('Stundenzuordnung: Spalte 16 nutzt Regen/Sonne mit Zeitstempel 17:00, Temperatur 16:00', () => {
  const { daten, tag0 } = erzeuge(JETZT);
  const h = daten.hourly;
  const i17 = idxStunde(null, 0, 17);
  const i16 = idxStunde(null, 0, 16);
  h.precipitation[i17] = 1.2;
  h.precipitation_probability[i17] = 80;
  h.sunshine_duration[i17] = 600;
  h.temperature_2m[i16] = 11.4;
  h.temperature_2m[i17] = 99; // darf in Spalte 16 NICHT auftauchen
  const sp = L.baueSpalten(daten, JETZT, CFG).find((s) => s.stunde === 16 && s.tag === L.lokalerTag(JETZT, 7200));
  assert.equal(sp.regenMm, 1.2);
  assert.equal(sp.regenProzent, 80);
  assert.equal(sp.sonneMin, 10);
  assert.equal(sp.temp, 11.4);
  assert.equal(tag0 + 16 * H, sp.ts);
});

test('Regendauer: Viertelstunden 16:15 bis 17:00 mit >= 0,1 mm, mal 15', () => {
  const { daten, tag0 } = erzeuge(JETZT);
  const m = daten.minutely_15;
  const setze = (hh, mm, v) => { m.precipitation[m.time.indexOf(tag0 + hh * H + mm * 60)] = v; };
  setze(16, 15, 0.2); setze(16, 30, 0.5); setze(16, 45, 0.09); setze(17, 0, 0.1); // 0,09 zählt nicht, 0,1 zählt
  setze(16, 0, 5); // gehört zur Stunde 15–16 (vorangegangene Viertelstunde von 16:00), nicht zu Spalte 16
  const sp = L.baueSpalten(daten, JETZT, CFG).find((s) => s.stunde === 16 && s.tag === L.lokalerTag(JETZT, 7200));
  assert.equal(sp.regenDauerMin, 45);
  const sp15 = L.baueSpalten(daten, JETZT, CFG).find((s) => s.stunde === 15 && s.tag === L.lokalerTag(JETZT, 7200));
  assert.equal(sp15.regenDauerMin, 15);
});

test('Regendauer fehlt (null), wenn Viertelstundenwerte fehlen', () => {
  const { daten } = erzeuge(JETZT);
  delete daten.minutely_15;
  const sp = L.baueSpalten(daten, JETZT, CFG);
  assert.ok(sp.every((s) => s.regenDauerMin === null));
});

test('Sonne wird auf 0–60 Minuten begrenzt, fehlendes Feld ergibt null', () => {
  const { daten } = erzeuge(JETZT);
  // Spalte 14 liest den Eintrag 15:00, Spalte 15 den Eintrag 16:00
  daten.hourly.sunshine_duration[idxStunde(null, 0, 15)] = 4000; // > 3600 s -> 60
  daten.hourly.sunshine_duration[idxStunde(null, 0, 16)] = 1799; // 29,98 min -> 30
  let sp = L.baueSpalten(daten, JETZT, CFG);
  assert.equal(sp[0].stunde, 14);
  assert.equal(sp[0].sonneMin, 60);
  assert.equal(sp[1].stunde, 15);
  assert.equal(sp[1].sonneMin, 30);
  delete daten.hourly.sunshine_duration;
  sp = L.baueSpalten(daten, JETZT, CFG);
  assert.ok(sp.every((s) => s.sonneMin === null));
});

const basis = { sonneMin: 60, wolken: 20, temp: 15, regenProzent: 0, regenMm: 0, regenDauerMin: 0, windKmh: 10 };

test('Ampel: grün, besonders gut', () => {
  assert.equal(L.bewerte({ ...basis }, CFG), 'top');
  assert.equal(L.bewerte({ ...basis, sonneMin: 59 }, CFG), 'gruen');
  assert.equal(L.bewerte({ ...basis, regenDauerMin: 15 }, CFG), 'gruen');
  assert.equal(L.bewerte({ ...basis, sonneMin: null }, CFG), 'gruen'); // fehlt einer der drei Werte
  assert.equal(L.bewerte({ ...basis, regenDauerMin: null }, CFG), 'gruen');
  assert.equal(L.bewerte({ ...basis, regenMm: null }, CFG), 'gruen');
});

test('Ampel: Grenzen gelb (0,3 mm, 30 %, 25 km/h, unter 10 °C)', () => {
  assert.equal(L.bewerte({ ...basis, regenMm: 0.29 }, CFG), 'gruen');
  assert.equal(L.bewerte({ ...basis, regenMm: 0.3 }, CFG), 'gelb');
  // knapp unter der gelben Grenze bleibt die Stunde grün – und mit Sonne/0 mm/0 min „besonders gut“
  assert.equal(L.bewerte({ ...basis, regenProzent: 29 }, CFG), 'top');
  assert.equal(L.bewerte({ ...basis, regenProzent: 29, sonneMin: 30 }, CFG), 'gruen');
  assert.equal(L.bewerte({ ...basis, regenProzent: 30 }, CFG), 'gelb');
  assert.equal(L.bewerte({ ...basis, windKmh: 24.9 }, CFG), 'top');
  assert.equal(L.bewerte({ ...basis, windKmh: 24.9, sonneMin: 30 }, CFG), 'gruen');
  assert.equal(L.bewerte({ ...basis, windKmh: 25 }, CFG), 'gelb');
  assert.equal(L.bewerte({ ...basis, temp: 10 }, CFG), 'top');
  assert.equal(L.bewerte({ ...basis, temp: 9.9 }, CFG), 'gelb');
});

test('Ampel: Grenzen rot (1 mm, 60 %, 35 km/h, unter 5 °C)', () => {
  assert.equal(L.bewerte({ ...basis, regenMm: 0.99 }, CFG), 'gelb');
  assert.equal(L.bewerte({ ...basis, regenMm: 1 }, CFG), 'rot');
  assert.equal(L.bewerte({ ...basis, regenProzent: 59 }, CFG), 'gelb');
  assert.equal(L.bewerte({ ...basis, regenProzent: 60 }, CFG), 'rot');
  assert.equal(L.bewerte({ ...basis, windKmh: 34.9 }, CFG), 'gelb');
  assert.equal(L.bewerte({ ...basis, windKmh: 35 }, CFG), 'rot');
  assert.equal(L.bewerte({ ...basis, temp: 5 }, CFG), 'gelb');
  assert.equal(L.bewerte({ ...basis, temp: 4.9 }, CFG), 'rot');
});

test('Ampel: Regendauer, Wolken und Tageszeit zählen für rot/gelb nicht', () => {
  assert.equal(L.bewerte({ ...basis, regenDauerMin: 60, regenMm: 0, sonneMin: 0, wolken: 100 }, CFG), 'gruen');
});

test('Ampel: fehlende Werte lösen weder rot noch gelb aus', () => {
  const leer = { sonneMin: null, wolken: null, temp: null, regenProzent: null, regenMm: null, regenDauerMin: null, windKmh: null };
  assert.equal(L.bewerte(leer, CFG), 'gruen');
});

test('Bestes Fenster: längster zusammenhängender Block, Nacht unterbricht', () => {
  const mk = (ts, stufe) => ({ ts, stufe });
  const t0 = 1000 * H;
  const sp = [
    mk(t0, 'gruen'), mk(t0 + H, 'gruen'),                    // 2 h
    mk(t0 + 2 * H, 'rot'),
    mk(t0 + 3 * H, 'gruen'), mk(t0 + 4 * H, 'top'), mk(t0 + 5 * H, 'gruen'), // 3 h
    mk(t0 + 14 * H, 'gruen'), mk(t0 + 15 * H, 'gruen'), mk(t0 + 16 * H, 'gruen'), // 3 h, nach Nacht
  ];
  const b = L.besteZeit(sp);
  assert.deepEqual([b.von, b.bis], [3, 5]); // Gleichstand 3:3 -> mehr „top“ gewinnt
  assert.equal(L.besteZeit([mk(t0, 'rot'), mk(t0 + H, 'gelb')]), null);
  // Zwei Blöcke, die nur wegen entfernter Nachtstunden nebeneinander stehen, sind KEIN gemeinsamer Block
  const b2 = L.besteZeit([mk(t0, 'gruen'), mk(t0 + 13 * H, 'gruen')]);
  assert.equal(b2.bis - b2.von, 0);
});

test('Ergänzung: Regenwahrscheinlichkeit/Viertelstunden aus zweitem Abruf, nach Zeitstempel', () => {
  const { daten: a } = erzeuge(JETZT);
  const b = kopie(a);
  a.hourly.precipitation_probability = a.hourly.time.map(() => null);
  delete a.minutely_15;
  b.hourly.precipitation_probability[20] = 55;
  b.minutely_15.precipitation[3] = 0.4;
  assert.equal(L.brauchtErgaenzung(a), true);
  L.ergaenze(a, b);
  assert.equal(a.hourly.precipitation_probability[20], 55);
  assert.equal(a.minutely_15.precipitation[3], 0.4);
  assert.equal(L.brauchtErgaenzung(a), false);
});

test('Ergänzung: vollständige Antwort braucht keinen Zweitabruf', () => {
  const { daten } = erzeuge(JETZT);
  daten.hourly.precipitation_probability[10] = 5; // mindestens ein Wert
  assert.equal(L.brauchtErgaenzung(daten), false);
});

test('Lokale Zeit aus Unixzeit mit Offset', () => {
  assert.equal(L.lokaleStunde(JETZT, 7200), 14);
  assert.equal(L.lokaleStunde(JETZT, 0), 12);
  assert.equal(L.lokaleStunde(JETZT, -3600 * 5), 7);
});

console.log('\n' + nTests + ' Tests bestanden');
