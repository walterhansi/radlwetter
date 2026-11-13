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
  const GRUPPEN = {
    regenMm: 'regen', regenProzent: 'regen', regenDauer: 'regen', wind: 'wind', boeen: 'wind', temp: 'temp', gefuehlt: 'temp',
    gewitter: 'gewitter', nass: 'nass', glaette: 'glaette', warnung: 'warnung',
  };
  const GRUPPEN_REIHENFOLGE = ['gewitter', 'warnung', 'regen', 'glaette', 'nass', 'wind', 'temp'];
  const GEWITTER_CODES = [95, 96, 99];
  const isoSek = (s) => { const t = Date.parse(s); return isFinite(t) ? Math.round(t / 1000) : null; };

  /* ---------- Zusatzquellen aufbereiten (Ergebnis wird an die Hauptdaten gehängt) ---------- */

  /** D2-Ensemble: Anteil der Läufe mit mindestens `schwelle` mm je Stunde, in Prozent. */
  function ensembleAuswerten(antwort, schwelle) {
    const h = antwort && antwort.hourly;
    if (!h || !Array.isArray(h.time)) return null;
    const reihen = Object.keys(h).filter((k) => k === 'precipitation' || k.startsWith('precipitation_member')).map((k) => h[k]);
    if (!reihen.length) return null;
    const prob = h.time.map((_, i) => {
      const w = reihen.map((r) => zahl(r[i])).filter((v) => v !== null);
      if (w.length < Math.max(2, Math.ceil(reihen.length / 2))) return null;
      return Math.round((100 * w.filter((v) => v >= schwelle - 1e-9).length) / w.length);
    });
    if (!hatWerte(prob)) return null;
    return { time: h.time.slice(), prob, laeufe: reihen.length };
  }

  /** DWD-Radar (Bright Sky /radar, format=plain): mm je 5 Minuten am Ort.
   *  Je Bild zählt der höchste Wert im Umkreis von `umkreis` Pixeln (1 Pixel = 1 km). */
  function radarAuswerten(antwort, umkreis) {
    if (!antwort || !Array.isArray(antwort.radar) || !antwort.latlon_position) return null;
    const px = Math.round(antwort.latlon_position.x);
    const py = Math.round(antwort.latlon_position.y);
    const r = umkreis === undefined ? 1 : umkreis;
    let stand = null;
    const bilder = [];
    for (const b of antwort.radar) {
      const ts = isoSek(b.timestamp);
      const g = b.precipitation_5;
      if (ts === null || !Array.isArray(g)) continue;
      let max = null;
      for (let y = py - r; y <= py + r; y++) {
        for (let x = px - r; x <= px + r; x++) {
          const v = g[y] && zahl(g[y][x]);
          if (v !== null && v !== undefined && (max === null || v > max)) max = v;
        }
      }
      if (max === null) continue;
      bilder.push({ ts, mm: max / 100 });
      // Quelle „RADARCOMP::RV::<Zeit>“: Zeit der letzten Messung; spätere Bilder sind Vorhersage
      const q = String(b.source || '').split('::').pop();
      const qs = isoSek(q);
      if (qs !== null && (stand === null || qs > stand)) stand = qs;
    }
    if (!bilder.length) return null;
    bilder.sort((a, b) => a.ts - b.ts);
    return { stand, bilder };
  }

  /** DWD-Stationsvorhersage MOSMIX (Bright Sky /weather) als Vergleichsmodell (Regen der vorangegangenen Stunde). */
  function mosmixAuswerten(antwort, name) {
    if (!antwort || !Array.isArray(antwort.weather)) return null;
    const quellen = new Map((antwort.sources || []).map((s) => [s.id, s]));
    const time = [];
    const precipitation = [];
    let station = null;
    for (const w of antwort.weather) {
      const q = quellen.get(w.source_id);
      if (!q || q.observation_type !== 'forecast') continue;
      const ts = isoSek(w.timestamp);
      if (ts === null) continue;
      time.push(ts);
      precipitation.push(zahl(w.precipitation));
      station = station || q.station_name;
    }
    if (!hatWerte(precipitation)) return null;
    return { name, station, hourly: { time, precipitation } };
  }

  /** Amtliche DWD-Warnungen (Bright Sky /alerts) vereinfachen und einordnen. */
  function warnungenAuswerten(antwort) {
    if (!antwort || !Array.isArray(antwort.alerts)) return null;
    const art = (ev) => {
      const e = String(ev || '').toUpperCase();
      if (/GEWITTER|HAGEL/.test(e)) return 'gewitter';
      if (/GLÄTTE|GLATTEIS|GLATT/.test(e)) return 'glaette';
      if (/STURM|ORKAN/.test(e)) return 'wind';
      if (/STARKREGEN|DAUERREGEN|UNWETTER/.test(e)) return 'regen';
      return null; // z. B. Frost, Nebel, Hitze: nur Hinweis, keine eigene Ampelwirkung
    };
    return {
      ort: antwort.location ? antwort.location.name : null,
      liste: antwort.alerts.filter((a) => a.status !== 'test').map((a) => ({
        ereignis: a.event_de || a.event_en || 'Warnung',
        titel: a.headline_de || a.headline_en || '',
        stufe: a.severity || null,
        von: isoSek(a.onset),
        bis: isoSek(a.expires),
        art: art(a.event_de || a.event_en),
      })),
    };
  }

  /** Warnungen, die die Stunde [ts, ts+3600) berühren. */
  function warnungenFuer(ts, warnungen) {
    if (!warnungen || !warnungen.liste) return [];
    return warnungen.liste.filter((w) => (w.von === null || w.von < ts + 3600) && (w.bis === null || w.bis > ts));
  }

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

    // DWD-Stationsvorhersage (MOSMIX) zählt wie ein weiteres Vergleichsmodell
    if (daten.mosmix && daten.mosmix.hourly) {
      vergleich.push({ name: daten.mosmix.name || 'DWD', idx: indexVon(daten.mosmix.hourly.time), mm: daten.mosmix.hourly.precipitation });
    }
    const ens = daten.ensemble && Array.isArray(daten.ensemble.time) ? daten.ensemble : null;
    const ensIdx = ens ? indexVon(ens.time) : null;
    const radar = daten.radar && Array.isArray(daten.radar.bilder) ? daten.radar : null;
    const radarIdx = radar ? new Map(radar.bilder.map((b) => [b.ts, b.mm])) : null;
    const nassCfg = cfg.nasseStrasse || null;
    const glCfg = cfg.glaette || null;

    let start = null;
    for (const t of zeiten) if (t <= jetztSek) start = t;
    if (start === null) return [];

    const hole = (arr, t) => {
      const i = hIdx.get(t);
      return arr && i !== undefined ? zahl(arr[i]) : null;
    };
    const maxVon = (...w) => { const z = w.filter((v) => v !== null); return z.length ? Math.max(...z) : null; };
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
        regenProzentQuelle: 'ICON-EPS',
        radar: false,
      };

      // Einigkeit der Modelle beim Regen (Hauptmodell + Vergleichsmodelle) – Modellwerte, vor dem Radar
      const modelle = [];
      if (sp.regenMm !== null) modelle.push({ name: 'ICON', mm: sp.regenMm });
      for (const v of vergleich) {
        const j = v.idx.get(vor);
        const mm = j === undefined ? null : zahl(v.mm[j]);
        if (mm !== null) modelle.push({ name: v.name, mm });
      }
      sp.modelle = modelle;
      sp.modellStatus = modellStatus(modelle.map((x) => x.mm), cfg);

      // Regenwahrscheinlichkeit aus dem feinen D2-Ensemble (20 Läufe, 2 km), sonst ICON-EPS von Open-Meteo
      if (ensIdx && ensIdx.has(vor)) {
        const p = zahl(ens.prob[ensIdx.get(vor)]);
        if (p !== null) { sp.regenProzent = p; sp.regenProzentQuelle = 'D2-Ensemble'; }
      }

      // Radar (gemessen + 2-Stunden-Vorschau): ersetzt Regen der Stunde, wenn alle 12 Bilder da sind
      if (radarIdx) {
        const fuenf = [];
        for (let k = 1; k <= 12; k++) fuenf.push(radarIdx.has(ts + k * 300) ? radarIdx.get(ts + k * 300) : null);
        if (fuenf.every((v) => v !== null)) {
          const summe = (a) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;
          sp.radar = true;
          sp.radarGemessen = radar.stand !== null && ts + 3600 <= radar.stand;
          sp.regenMm = summe(fuenf);
          sp.viertel = [0, 1, 2, 3].map((q) => summe(fuenf.slice(q * 3, q * 3 + 3)));
          sp.regenDauerMin = sp.viertel.filter((v) => v >= cfg.regenSchwelle - 1e-9).length * 15;
        }
      }

      // Gewitter: Wettercode 95/96/99 (ICON) und Blitzpotenzial (nur ICON-D2), je Stunde das Stärkere
      const code = maxVon(hole(h.weather_code, ts), hole(h.weather_code, vor));
      sp.gewitterCode = code !== null && GEWITTER_CODES.includes(code);
      sp.blitz = maxVon(hole(h.lightning_potential, ts), hole(h.lightning_potential, vor));
      sp.schnee = hole(h.snowfall, vor);

      // Nasse Straße: Regen in den 2 Stunden vor dieser Stunde (Zeitstempel ts und ts−1h)
      const vorher = [hole(h.precipitation, ts), hole(h.precipitation, ts - 3600)];
      sp.regenVorher = vorher.some((v) => v !== null) ? Math.round(vorher.reduce((s, v) => s + (v || 0), 0) * 10) / 10 : null;
      sp.strasseNass = !!(nassCfg && sp.regenVorher !== null && sp.regenVorher >= nassCfg.mm - 1e-9);

      // Glätte: kalt (Lufttemperatur) und nass, oder Schneefall
      const tLuft = hole(h.temperature_2m, ts);
      sp.glaette = !!(glCfg && tLuft !== null && tLuft <= glCfg.tempMax &&
        (sp.strasseNass || (sp.regenMm !== null && sp.regenMm >= cfg.regenSchwelle - 1e-9) || (sp.schnee !== null && sp.schnee > 0)));

      // Amtliche Warnungen des DWD für den Ort
      sp.warnungen = warnungenFuer(ts, daten.warnungen);

      const b = bewertung(sp, cfg);
      sp.stufe = b.stufe;
      sp.ursachen = b.ursachen;
      sp.zellen = b.zellen;
      // „Besonders gut“ braucht sicheres Trockenwetter: bei Uneinigkeit nur normal grün (Radar sticht Modelle)
      sp.unsicher = sp.modellStatus === 'uneinig' && !sp.radar;
      if (sp.stufe === 'top' && sp.unsicher) { sp.stufe = 'gruen'; sp.topAbgewertet = true; }
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
      // In Radar-Stunden zählt die Messung bzw. Radar-Vorschau, nicht die Modell-Wahrscheinlichkeit
      regenProzent: sp.radar ? null : hoch(sp.regenProzent, r.regenProzent, y.regenProzent),
      regenDauer: sp.regenDauerMin !== null && sp.regenDauerMin !== undefined && y.regenDauerMin !== undefined && sp.regenDauerMin >= y.regenDauerMin ? 'gelb' : null,
      wind: hoch(sp.windKmh, r.windKmh, y.windKmh),
      boeen: hoch(sp.boeenKmh, r.boeenKmh, y.boeenKmh),
      temp: null,
      gefuehlt: null,
      gewitter: sp.gewitterCode ? 'rot'
        : (y.blitzJkg !== undefined && sp.blitz !== null && sp.blitz !== undefined && sp.blitz >= y.blitzJkg ? 'gelb' : null),
      nass: sp.strasseNass ? 'gelb' : null,
      glaette: sp.glaette ? 'rot' : null,
      warnung: null,
    };
    // Amtliche Warnungen: Gewitter, Glätte, Sturm, Starkregen machen die Stunde rot
    for (const w of sp.warnungen || []) {
      if (!w.art) continue;
      if (w.art === 'gewitter') z.gewitter = 'rot';
      else if (w.art === 'glaette') z.glaette = 'rot';
      else z.warnung = 'rot';
    }
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
          unsicher: teil.filter((s) => (s.unsicher !== undefined ? s.unsicher : s.modellStatus === 'uneinig')).length,
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
  function regenAusblickModell(daten, abSek, jetztSek, cfg) {
    const m = daten.minutely_15;
    if (!m || !Array.isArray(m.time) || !Array.isArray(m.precipitation)) return null;
    const schwelle = cfg.regenSchwelle - 1e-9;
    const nass = (i) => { const v = zahl(m.precipitation[i]); return v !== null && v >= schwelle; };
    const i0 = m.time.findIndex((t) => t > abSek); // laufende Viertelstunde
    if (i0 < 0) return null;
    const ende = jetztSek + cfg.stunden * 3600;
    if (nass(i0)) {
      let j = i0;
      while (j + 1 < m.time.length && nass(j + 1)) j++;
      return { status: 'regnet', bis: m.time[j], offen: j === m.time.length - 1, quelle: 'ICON' };
    }
    for (let j = i0; j < m.time.length; j++) {
      if (m.time[j] - 900 > ende) break;
      if (nass(j)) return { status: 'trocken', bis: Math.max(abSek, m.time[j] - 900), quelle: 'ICON' };
    }
    return { status: 'kein-regen', bis: Math.min(ende, m.time[m.time.length - 1]), quelle: 'ICON' };
  }

  /** Trocken bis wann / Regen bis wann: zuerst DWD-Radar (gemessen + 2 Std. Vorschau), danach ICON-Viertelstunden. */
  function regenAusblick(daten, jetztSek, cfg) {
    const radar = daten.radar && Array.isArray(daten.radar.bilder) ? daten.radar : null;
    const rcfg = cfg.radar || {};
    const bilder = radar ? radar.bilder.filter((b) => b.ts > jetztSek) : [];
    // Radar nur, wenn das laufende 5-Minuten-Bild dabei ist (sonst veraltet)
    if (!bilder.length || bilder[0].ts - jetztSek > 600) return regenAusblickModell(daten, jetztSek, jetztSek, cfg);
    const nass = (b) => b.mm >= (rcfg.nassMm5 || 0.02) - 1e-9;
    const radarEnde = bilder[bilder.length - 1].ts;
    if (nass(bilder[0])) {
      let j = 0;
      while (j + 1 < bilder.length && nass(bilder[j + 1])) j++;
      if (j < bilder.length - 1) return { status: 'regnet', bis: bilder[j].ts, offen: false, quelle: 'Radar' };
      // Regen bis zum Ende der Radar-Vorschau: das Modell entscheidet über das Ende
      const m = regenAusblickModell(daten, radarEnde, jetztSek, cfg);
      if (m && m.status === 'regnet') return { ...m, quelle: 'Radar + ICON' };
      return { status: 'regnet', bis: radarEnde, offen: false, mindestens: true, quelle: 'Radar' };
    }
    const erstesNass = bilder.find(nass);
    if (erstesNass) return { status: 'trocken', bis: erstesNass.ts - 300, quelle: 'Radar' };
    const m = regenAusblickModell(daten, radarEnde, jetztSek, cfg);
    if (!m) return { status: 'trocken', bis: radarEnde, mindestens: true, quelle: 'Radar' };
    if (m.status === 'regnet') return { status: 'trocken', bis: radarEnde, quelle: 'Radar + ICON' };
    return { ...m, quelle: 'Radar + ICON' };
  }

  /* ---------- Treffsicherheit: Vorhersage vom Vortag gegen DWD-Messung ---------- */

  /** Messwerte (Bright Sky /weather, nur gemessene Quellen) nach Zeitstempel. */
  function messungenAuswerten(antwort) {
    if (!antwort || !Array.isArray(antwort.weather)) return null;
    const quellen = new Map((antwort.sources || []).map((s) => [s.id, s]));
    const m = new Map();
    // Station der Regenmessung (Hauptquelle des Eintrags); gleiche DWD-Station nur einmal, Schreibweise „Nandlstadt“ bevorzugt
    const stationen = new Map();
    for (const w of antwort.weather) {
      const q = quellen.get(w.source_id);
      if (!q || q.observation_type === 'forecast') continue;
      const ts = isoSek(w.timestamp);
      if (ts === null) continue;
      m.set(ts, { regenMm: zahl(w.precipitation), windKmh: zahl(w.wind_speed), boeenKmh: zahl(w.wind_gust_speed), temp: zahl(w.temperature) });
      const key = q.dwd_station_id || q.station_name;
      const alt = stationen.get(key);
      if (!alt || (alt === alt.toUpperCase() && q.station_name !== q.station_name.toUpperCase())) stationen.set(key, q.station_name);
    }
    return { werte: m, stationen: [...stationen.values()] };
  }

  /** Vergleich je Tageslicht-Stunde: Ampel aus der Vorhersage vom Vortag gegen Ampel aus den Messwerten.
   *  Bewertet werden Regen-Menge, Wind, Böen und Lufttemperatur (Wahrscheinlichkeit und Regendauer gibt es gemessen nicht). */
  function treffsicherheit(vorhersage, messung, jetztSek, cfg) {
    const h = vorhersage && vorhersage.hourly;
    if (!h || !Array.isArray(h.time) || !messung || !messung.werte) return null;
    const idx = indexVon(h.time);
    const get = (feld, t) => { const i = idx.get(t); return h[feld] && i !== undefined ? zahl(h[feld][i]) : null; };
    const rund0 = (v) => (v === null ? null : Math.round(v));
    const klasse = (s) => (s === 'top' ? 'gruen' : s);
    const RANG = { gruen: 0, gelb: 1, rot: 2 };
    const erg = { stunden: 0, gleich: 0, zuGut: 0, zuSchlecht: 0, regenStunden: 0, regenRichtig: 0, regenVerpasst: 0, regenFehlalarm: 0, regenGemessen: 0, von: null, bis: null, stationen: messung.stationen };
    for (const ts of h.time) {
      const vor = ts + 3600;
      if (vor > jetztSek) break;
      if (!istTag(ts, vorhersage)) continue;
      const mT = messung.werte.get(ts);
      const mV = messung.werte.get(vor);
      if (!mV || mV.regenMm === null) continue;
      const f = {
        regenMm: get('precipitation_previous_day1', vor), regenProzent: null, regenDauerMin: null,
        windKmh: rund0(get('wind_speed_10m_previous_day1', ts)), boeenKmh: rund0(get('wind_gusts_10m_previous_day1', vor)),
        temp: rund0(get('temperature_2m_previous_day1', ts)), gefuehltC: null,
      };
      if (f.regenMm === null) continue;
      const o = {
        regenMm: mV.regenMm, regenProzent: null, regenDauerMin: null,
        windKmh: rund0(mV.windKmh), boeenKmh: rund0(mV.boeenKmh), temp: rund0(mT ? mT.temp : null), gefuehltC: null,
      };
      const sf = klasse(bewertung(f, cfg).stufe);
      const so = klasse(bewertung(o, cfg).stufe);
      erg.stunden++;
      if (sf === so) erg.gleich++;
      else if (RANG[sf] < RANG[so]) erg.zuGut++;
      else erg.zuSchlecht++;
      const fn = f.regenMm >= cfg.regenSchwelle - 1e-9;
      const on = o.regenMm >= cfg.regenSchwelle - 1e-9;
      erg.regenStunden++;
      if (fn === on) erg.regenRichtig++;
      else if (on) erg.regenVerpasst++;
      else erg.regenFehlalarm++;
      if (on) erg.regenGemessen++;
      if (erg.von === null) erg.von = ts;
      erg.bis = ts;
    }
    return erg.stunden ? erg : null;
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
    ensembleAuswerten, radarAuswerten, mosmixAuswerten, warnungenAuswerten, warnungenFuer,
    messungenAuswerten, treffsicherheit,
  };
  root.RadlLogik = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
