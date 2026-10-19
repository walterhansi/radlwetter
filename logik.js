/* Radlwetter – reine Logik (ohne Oberfläche), im Browser und in Node nutzbar.
 *
 * Zeitzuordnung bei Open-Meteo (Zeitstempel = Unixsekunden):
 *  - Temperatur, gefühlte Temperatur, Wolken, Wind (Mittel) gelten für den Zeitstempel selbst.
 *  - Regen mm, Regen %, Sonnenscheindauer und Böen sind Werte der VORANGEGANGENEN Stunde
 *    (Böen: Maximum der vorangegangenen Stunde). Die Spalte „19“ (19–20 Uhr) nutzt dafür
 *    also den Eintrag mit Zeitstempel 20:00.
 *  - minutely_15 Regen: Summe der vorangegangenen 15 Minuten.
 */
(function (root) {
  'use strict';

  const zahl = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const hatWerte = (arr) => Array.isArray(arr) && arr.some((v) => zahl(v) !== null);
  const GRUPPEN = { regenMm: 'regen', regenProzent: 'regen', regenDauer: 'regen', wind: 'wind', boeen: 'wind', temp: 'temp', gefuehlt: 'temp' };
  const GRUPPEN_REIHENFOLGE = ['regen', 'wind', 'temp'];

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

  /** Einigkeit der Modelle beim Regen. werte = mm je Stunde der Modelle (ohne fehlende). */
  function modellStatus(werte, cfg) {
    const u = (cfg && cfg.unsicherheit) || { nassMm: 0.2, trockenMm: 0.1 };
    if (!werte || werte.length < 2) return 'unbekannt';
    const nass = werte.some((v) => v >= u.nassMm);
    const trocken = werte.some((v) => v < u.trockenMm);
    if (nass && trocken) return 'uneinig';
    if (nass) return 'einig-nass';
    if (werte.every((v) => v < u.trockenMm)) return 'einig-trocken';
    return 'schwach'; // nur Spuren (zwischen trockenMm und nassMm), kein Widerspruch
  }

  /** Baut die Tabellenspalten ab der aktuellen Stunde. */
  function baueSpalten(daten, jetztSek, cfg) {
    const h = daten.hourly || {};
    const m = daten.minutely_15 || {};
    const offset = zahl(daten.utc_offset_seconds) || 0;
    const zeiten = h.time || [];
    const hIdx = indexVon(zeiten);
    const mIdx = indexVon(m.time);

    // Vergleichsmodelle: je Modell Zeitindex und Niederschlag
    const vergleich = (Array.isArray(daten.vergleich) ? daten.vergleich : [])
      .filter((v) => v && v.hourly && Array.isArray(v.hourly.time) && Array.isArray(v.hourly.precipitation))
      .map((v) => ({ name: v.name, idx: indexVon(v.hourly.time), mm: v.hourly.precipitation }));

    let start = null;
    for (const t of zeiten) if (t <= jetztSek) start = t;
    if (start === null) return [];

    const hole = (arr, t) => {
      const i = hIdx.get(t);
      return arr && i !== undefined ? zahl(arr[i]) : null;
    };
    // Werte so runden, wie sie angezeigt werden – damit Farbe und Zahl immer zusammenpassen
    const rund = (v, stellen) => (v === null ? null : Math.round(v * 10 ** stellen) / 10 ** stellen);

    const spalten = [];
    for (let i = 0; i < cfg.stunden; i++) {
      const ts = start + i * 3600;
      if (!hIdx.has(ts)) break;
      if (cfg.nachtAusblenden && !istTag(ts, daten)) continue;

      const vor = ts + 3600; // Zeitstempel der Werte „der vorangegangenen Stunde“
      const sonneSek = hole(h.sunshine_duration, vor);

      // Viertelstunden-Regen der Stunde (Zeitstempel ts+15, ts+30, ts+45, ts+60 min)
      let viertel = null;
      let regenDauerMin = null;
      if (m.precipitation) {
        viertel = [1, 2, 3, 4].map((k) => {
          const j = mIdx.get(ts + k * 900);
          return j === undefined ? null : zahl(m.precipitation[j]);
        });
        if (viertel.every((v) => v !== null)) {
          regenDauerMin = viertel.filter((v) => v >= cfg.regenSchwelle - 1e-9).length * 15;
        }
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
        temp: rund(hole(h.temperature_2m, ts), 0),
        gefuehltC: rund(hole(h.apparent_temperature, ts), 1),
        regenProzent: rund(hole(h.precipitation_probability, vor), 0),
        regenMm: hole(h.precipitation, vor),
        regenDauerMin,
        viertel,
        windKmh: rund(hole(h.wind_speed_10m, ts), 0),
        boeenKmh: rund(hole(h.wind_gusts_10m, vor), 0),
        windRichtung: hole(h.wind_direction_10m, ts),
      };

      // Einigkeit der Modelle beim Regen (Hauptmodell + Vergleichsmodelle)
      const modelle = [];
      if (sp.regenMm !== null) modelle.push({ name: 'ICON', mm: sp.regenMm });
      for (const v of vergleich) {
        const j = v.idx.get(vor);
        const mm = j === undefined ? null : zahl(v.mm[j]);
        if (mm !== null) modelle.push({ name: v.name, mm });
      }
      sp.modelle = modelle;
      sp.modellStatus = modellStatus(modelle.map((x) => x.mm), cfg);

      const b = bewertung(sp, cfg);
      sp.stufe = b.stufe;
      sp.ursachen = b.ursachen;
      sp.zellen = b.zellen;
      // „Besonders gut“ braucht sicheres Trockenwetter: bei Uneinigkeit nur normal grün
      if (sp.stufe === 'top' && sp.modellStatus === 'uneinig') { sp.stufe = 'gruen'; sp.topAbgewertet = true; }
      spalten.push(sp);
    }
    return spalten;
  }

  /** Bewertung je Wert: 'rot' | 'gelb' | null. Höhere Werte sind schlechter, bei Temperatur niedrigere. */
  function zellenBewerten(sp, cfg) {
    const r = cfg.grenzen.rot;
    const y = cfg.grenzen.gelb;
    const hoch = (v, rotG, gelbG) => {
      if (v === null || v === undefined) return null;
      if (rotG !== undefined && v >= rotG) return 'rot';
      if (gelbG !== undefined && v >= gelbG) return 'gelb';
      return null;
    };
    const tief = (v, rotG, gelbG) => {
      if (v === null || v === undefined) return null;
      if (rotG !== undefined && v < rotG) return 'rot';
      if (gelbG !== undefined && v < gelbG) return 'gelb';
      return null;
    };
    const z = {
      regenMm: hoch(sp.regenMm, r.regenMm, y.regenMm),
      regenProzent: hoch(sp.regenProzent, r.regenProzent, y.regenProzent),
      regenDauer: sp.regenDauerMin !== null && sp.regenDauerMin !== undefined && y.regenDauerMin !== undefined && sp.regenDauerMin >= y.regenDauerMin ? 'gelb' : null,
      wind: hoch(sp.windKmh, r.windKmh, y.windKmh),
      boeen: hoch(sp.boeenKmh, r.boeenKmh, y.boeenKmh),
      temp: null,
      gefuehlt: null,
    };
    // Temperatur: gefühlte Temperatur ist die Grundlage, sonst die Lufttemperatur
    const gef = sp.gefuehltC !== null && sp.gefuehltC !== undefined;
    const wert = gef ? sp.gefuehltC : sp.temp;
    z[gef ? 'gefuehlt' : 'temp'] = tief(wert === undefined ? null : wert, r.tempUnter, y.tempUnter);
    return z;
  }

  /** Gesamtbewertung: Stufe, auslösende Gruppen (Regen, Wind, Temperatur) und Bewertung je Zelle. */
  function bewertung(sp, cfg) {
    const z = zellenBewerten(sp, cfg);
    const werte = Object.values(z);
    let stufe = werte.includes('rot') ? 'rot' : werte.includes('gelb') ? 'gelb' : 'gruen';
    const ursachen = [];
    if (stufe !== 'gruen') {
      for (const [k, v] of Object.entries(z)) {
        if (v === stufe && !ursachen.includes(GRUPPEN[k])) ursachen.push(GRUPPEN[k]);
      }
      ursachen.sort((a, b) => GRUPPEN_REIHENFOLGE.indexOf(a) - GRUPPEN_REIHENFOLGE.indexOf(b));
    } else {
      const t = cfg.ampelTop;
      const ok = (v) => v !== null && v !== undefined;
      if (ok(sp.sonneMin) && ok(sp.regenMm) && ok(sp.regenDauerMin) &&
          sp.sonneMin >= t.sonneMin && sp.regenMm <= t.regenMm && sp.regenDauerMin <= t.regenDauerMin) {
        stufe = 'top';
      }
    }
    return { stufe, ursachen, zellen: z };
  }

  /** Ampel: 'rot' | 'gelb' | 'gruen' | 'top' (besonders gut). Fehlende Werte zählen nicht. */
  function bewerte(sp, cfg) {
    return bewertung(sp, cfg).stufe;
  }

  const gut = (s) => s.stufe === 'gruen' || s.stufe === 'top';

  function besser(a, b) {
    if (a.stunden !== b.stunden) return a.stunden > b.stunden;
    if (a.top !== b.top) return a.top > b.top;
    return a.unsicher < b.unsicher; // bei Gleichstand gewinnt das frühere (b war zuerst da)
  }

  /** Zusammenhängende grüne Läufe (Nachtlücken und Tageswechsel trennen) mit Kennzahlen. */
  function laeufe(spalten, mindest) {
    const liste = [];
    let cur = null;
    spalten.forEach((s, i) => {
      if (!gut(s)) { cur = null; return; }
      const anschluss = cur && s.ts === spalten[i - 1].ts + 3600 && s.tag === spalten[i - 1].tag;
      if (anschluss) { cur.bis = i; } else { cur = { von: i, bis: i }; liste.push(cur); }
    });
    return liste
      .map((l) => {
        const teil = spalten.slice(l.von, l.bis + 1);
        return {
          von: l.von, bis: l.bis, stunden: l.bis - l.von + 1, tag: spalten[l.von].tag,
          top: teil.filter((s) => s.stufe === 'top').length,
          unsicher: teil.filter((s) => s.modellStatus === 'uneinig').length,
        };
      })
      .filter((l) => l.stunden >= mindest);
  }

  /** Bestes Radlfenster je Tag (mindestens cfg.fenster.mindestStunden zusammenhängende grüne Stunden). */
  function fensterProTag(spalten, cfg) {
    const mindest = (cfg && cfg.fenster && cfg.fenster.mindestStunden) || 1;
    const proTag = new Map();
    for (const l of laeufe(spalten, mindest)) {
      const alt = proTag.get(l.tag);
      if (!alt || besser(l, alt)) proTag.set(l.tag, l);
    }
    return [...proTag.values()].sort((a, b) => a.von - b.von);
  }

  /** Bestes Fenster insgesamt (Gleichstand: mehr „besonders gut“, dann weniger unsichere, dann früher). */
  function besteZeit(spalten, mindest) {
    let best = null;
    for (const l of laeufe(spalten, mindest || 1)) if (!best || besser(l, best)) best = l;
    return best;
  }

  /** Trocken bis wann / Regen bis wann (aus den Viertelstundenwerten des Hauptmodells). */
  function regenAusblick(daten, jetztSek, cfg) {
    const m = daten.minutely_15;
    if (!m || !Array.isArray(m.time) || !Array.isArray(m.precipitation)) return null;
    const schwelle = cfg.regenSchwelle - 1e-9;
    const nass = (i) => { const v = zahl(m.precipitation[i]); return v !== null && v >= schwelle; };
    const i0 = m.time.findIndex((t) => t > jetztSek); // laufende Viertelstunde
    if (i0 < 0) return null;
    const ende = jetztSek + cfg.stunden * 3600;
    if (nass(i0)) {
      let j = i0;
      while (j + 1 < m.time.length && nass(j + 1)) j++;
      return { status: 'regnet', bis: m.time[j], offen: j === m.time.length - 1 };
    }
    for (let j = i0; j < m.time.length; j++) {
      if (m.time[j] - 900 > ende) break;
      if (nass(j)) return { status: 'trocken', bis: m.time[j] - 900 };
    }
    return { status: 'kein-regen', bis: Math.min(ende, m.time[m.time.length - 1]) };
  }

  /** Ergänzt fehlende Teile der Hauptantwort a aus der Antwort b (ohne Modellwahl). */
  function ergaenze(a, b) {
    if (!a || !b) return a;
    a.hourly = a.hourly || {};
    const bh = b.hourly || {};
    const mapB = indexVon(bh.time);
    // Felder, die dem Hauptmodell fehlen können, aus b übernehmen (nach Zeitstempel)
    for (const feld of ['precipitation_probability', 'wind_gusts_10m', 'apparent_temperature']) {
      if (!hatWerte(a.hourly[feld]) && hatWerte(bh[feld])) {
        a.hourly[feld] = (a.hourly.time || []).map((t) => {
          const i = mapB.get(t);
          return i === undefined ? null : zahl(bh[feld][i]);
        });
      }
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
      !hatWerte(a.hourly.wind_gusts_10m) || !hatWerte(a.hourly.apparent_temperature) ||
      !(a.minutely_15 && hatWerte(a.minutely_15.precipitation)) ||
      !(a.daily && hatWerte(a.daily.sunrise));
  }

  const api = {
    baueSpalten, bewerte, bewertung, zellenBewerten, modellStatus, besteZeit, fensterProTag,
    regenAusblick, ergaenze, brauchtErgaenzung, istTag, hatWerte, lokaleStunde, lokalerTag,
  };
  root.RadlLogik = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
