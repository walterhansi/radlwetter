/* Radlwetter – reine Logik (ohne Oberfläche), im Browser und in Node nutzbar.
 *
 * Zeitzuordnung bei Open-Meteo (Zeitstempel = Unixsekunden):
 *  - Temperatur, Wolken, Wind gelten für den Zeitstempel selbst.
 *  - Regen mm, Regen %, Sonnenscheindauer sind Werte der VORANGEGANGENEN Stunde.
 *    Die Spalte „19“ (19–20 Uhr) nutzt dafür also den Eintrag mit Zeitstempel 20:00.
 *  - minutely_15 Regen: Summe der vorangegangenen 15 Minuten.
 */
(function (root) {
  'use strict';

  const zahl = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const hatWerte = (arr) => Array.isArray(arr) && arr.some((v) => zahl(v) !== null);

  function indexVon(zeiten) {
    const m = new Map();
    (zeiten || []).forEach((t, i) => m.set(t, i));
    return m;
  }

  /** Liegt die Stunde [ts, ts+3600) ganz oder teilweise zwischen Sonnenaufgang und -untergang? */
  function istTag(ts, daten) {
    const d = daten.daily;
    if (!d || !Array.isArray(d.sunrise) || !Array.isArray(d.sunset) || !d.sunrise.length) return true;
    let unbekannt = false;
    for (let i = 0; i < d.sunrise.length; i++) {
      const auf = zahl(d.sunrise[i]);
      const unter = zahl(d.sunset[i]);
      if (auf === null || unter === null) { unbekannt = true; continue; }
      if (ts < unter && ts + 3600 > auf) return true;
    }
    return unbekannt; // Polartag/-nacht o. ä.: im Zweifel anzeigen
  }

  function lokaleStunde(ts, offset) {
    return Math.floor((((ts + offset) % 86400) + 86400) % 86400 / 3600);
  }
  function lokalerTag(ts, offset) {
    return Math.floor((ts + offset) / 86400);
  }

  /** Baut die Tabellenspalten ab der aktuellen Stunde. */
  function baueSpalten(daten, jetztSek, cfg) {
    const h = daten.hourly || {};
    const m = daten.minutely_15 || {};
    const offset = zahl(daten.utc_offset_seconds) || 0;
    const zeiten = h.time || [];
    const hIdx = indexVon(zeiten);
    const mIdx = indexVon(m.time);

    let start = null;
    for (const t of zeiten) if (t <= jetztSek) start = t;
    if (start === null) return [];

    const hole = (arr, t) => {
      const i = hIdx.get(t);
      return arr && i !== undefined ? zahl(arr[i]) : null;
    };

    const spalten = [];
    for (let i = 0; i < cfg.stunden; i++) {
      const ts = start + i * 3600;
      if (!hIdx.has(ts)) break;
      if (cfg.nachtAusblenden && !istTag(ts, daten)) continue;

      const vor = ts + 3600; // Zeitstempel der Werte „der vorangegangenen Stunde“
      const sonneSek = hole(h.sunshine_duration, vor);

      let regenDauerMin = null;
      if (m.precipitation) {
        let nass = 0;
        let vollstaendig = true;
        for (let k = 1; k <= 4; k++) {
          const j = mIdx.get(ts + k * 900);
          const v = j === undefined ? null : zahl(m.precipitation[j]);
          if (v === null) { vollstaendig = false; break; }
          if (v >= cfg.regenSchwelle - 1e-9) nass++;
        }
        regenDauerMin = vollstaendig ? nass * 15 : null;
      }

      const sp = {
        ts,
        stunde: lokaleStunde(ts, offset),
        tag: lokalerTag(ts, offset),
        wochentag: new Date((ts + offset) * 1000).getUTCDay(),
        datum: new Date((ts + offset) * 1000),
        jetzt: ts === start,
        sonneMin: sonneSek === null ? null : Math.max(0, Math.min(60, Math.round(sonneSek / 60))),
        wolken: hole(h.cloud_cover, ts),
        temp: hole(h.temperature_2m, ts),
        regenProzent: hole(h.precipitation_probability, vor),
        regenMm: hole(h.precipitation, vor),
        regenDauerMin,
        windKmh: hole(h.wind_speed_10m, ts),
        windRichtung: hole(h.wind_direction_10m, ts),
      };
      sp.stufe = bewerte(sp, cfg);
      spalten.push(sp);
    }
    return spalten;
  }

  /** Ampel: 'rot' | 'gelb' | 'gruen' | 'top' (besonders gut). Fehlende Werte zählen nicht. */
  function bewerte(sp, cfg) {
    const ab = (v, grenze) => v !== null && v >= grenze;
    const unter = (v, grenze) => v !== null && v < grenze;
    const r = cfg.grenzen.rot;
    const g = cfg.grenzen.gelb;
    if (ab(sp.regenMm, r.regenMm) || ab(sp.regenProzent, r.regenProzent) ||
        ab(sp.windKmh, r.windKmh) || unter(sp.temp, r.tempUnter)) return 'rot';
    if (ab(sp.regenMm, g.regenMm) || ab(sp.regenProzent, g.regenProzent) ||
        ab(sp.windKmh, g.windKmh) || unter(sp.temp, g.tempUnter)) return 'gelb';
    const t = cfg.ampelTop;
    if (sp.sonneMin !== null && sp.regenMm !== null && sp.regenDauerMin !== null &&
        sp.sonneMin >= t.sonneMin && sp.regenMm <= t.regenMm && sp.regenDauerMin <= t.regenDauerMin) {
      return 'top';
    }
    return 'gruen';
  }

  /** Längster zusammenhängender Block grüner Stunden (bei Gleichstand: mehr „besonders gut“, dann früher). */
  function besteZeit(spalten) {
    let best = null;
    let cur = null;
    spalten.forEach((s, i) => {
      const gut = s.stufe === 'gruen' || s.stufe === 'top';
      const anschluss = i > 0 && s.ts === spalten[i - 1].ts + 3600;
      if (!gut) { cur = null; return; }
      if (cur && anschluss) { cur.bis = i; } else { cur = { von: i, bis: i, top: 0 }; }
      if (s.stufe === 'top') cur.top++;
      const len = (b) => b.bis - b.von + 1;
      if (!best || len(cur) > len(best) || (len(cur) === len(best) && cur.top > best.top)) best = { ...cur };
    });
    return best;
  }

  /** Ergänzt fehlende Teile der Hauptantwort a aus der Antwort b (ohne Modellwahl). */
  function ergaenze(a, b) {
    if (!a || !b) return a;
    a.hourly = a.hourly || {};
    if (!hatWerte(a.hourly.precipitation_probability) && b.hourly && hatWerte(b.hourly.precipitation_probability)) {
      const map = indexVon(b.hourly.time);
      a.hourly.precipitation_probability = (a.hourly.time || []).map((t) => {
        const i = map.get(t);
        return i === undefined ? null : zahl(b.hourly.precipitation_probability[i]);
      });
    }
    if (!(a.minutely_15 && hatWerte(a.minutely_15.precipitation)) && b.minutely_15 && hatWerte(b.minutely_15.precipitation)) {
      a.minutely_15 = b.minutely_15;
    }
    if (!(a.daily && hatWerte(a.daily.sunrise)) && b.daily) a.daily = b.daily;
    return a;
  }

  /** Braucht die Antwort eine Ergänzung (ohne Modellwahl)? */
  function brauchtErgaenzung(a) {
    return !a || !a.hourly || !hatWerte(a.hourly.precipitation_probability) ||
      !(a.minutely_15 && hatWerte(a.minutely_15.precipitation)) ||
      !(a.daily && hatWerte(a.daily.sunrise));
  }

  const api = { baueSpalten, bewerte, besteZeit, ergaenze, brauchtErgaenzung, istTag, hatWerte, lokaleStunde, lokalerTag };
  root.RadlLogik = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
