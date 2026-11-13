/* Radlwetter – Oberfläche, Abruf, Aktualisierung */
(() => {
  'use strict';
  const CFG = RADL_CONFIG;
  const L = RadlLogik;
  const KEY_CACHE = 'radlwetter.cache';
  const KEY_ORT = 'radlwetter.ort';
  const KEY_ID = 'radlwetter.modellid.';
  const $ = (id) => document.getElementById(id);

  const sicher = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

  /* ---------- Zustand ---------- */
  const st = {
    ort: sicher(() => {
      const o = JSON.parse(localStorage.getItem(KEY_ORT));
      return o && o.name && isFinite(o.lat) && isFinite(o.lon) ? o : null;
    }, null) || CFG.ort,
    daten: null,
    abgerufen: 0,        // ms, Zeitpunkt des letzten erfolgreichen Abrufs
    letzterVersuch: 0,   // ms
    offline: false,
    fehler: null,
    laedt: false,
    stunde: Math.floor(Date.now() / 3600000),
  };

  const gleicherOrt = (a, b) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

  /* ---------- Zwischenspeicher (Offline-Notbehelf) ---------- */
  function cacheLesen() {
    return sicher(() => {
      const c = JSON.parse(localStorage.getItem(KEY_CACHE));
      if (!c || !c.daten || !c.ort || !gleicherOrt(c.ort, st.ort)) return null;
      return c;
    }, null);
  }
  function cacheSchreiben() {
    sicher(() => localStorage.setItem(KEY_CACHE, JSON.stringify({ ort: st.ort, abgerufen: st.abgerufen, daten: st.daten })));
  }

  /* ---------- Abruf Open-Meteo ---------- */
  const HOURLY = 'temperature_2m,apparent_temperature,cloud_cover,precipitation_probability,precipitation,' +
    'wind_speed_10m,wind_gusts_10m,wind_direction_10m,sunshine_duration';
  // Nur beim gewählten ICON-Modell: Gewitter (Wettercode, Blitzpotenzial nur ICON-D2) und Schnee
  const HOURLY_ICON = ',weather_code,lightning_potential,snowfall';

  function apiUrl(ort, modell, nurRegen) {
    const p = new URLSearchParams({
      latitude: ort.lat,
      longitude: ort.lon,
      wind_speed_unit: 'kmh',
      timeformat: 'unixtime',
      timezone: 'auto',
      forecast_days: '3',
    });
    if (nurRegen) {
      p.set('hourly', 'precipitation');
    } else {
      p.set('hourly', HOURLY + (modell ? HOURLY_ICON : ''));
      p.set('minutely_15', 'precipitation');
      p.set('daily', 'sunrise,sunset');
    }
    if (modell) p.set('models', modell);
    return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
  }

  function ensembleUrl(ort, modell) {
    const p = new URLSearchParams({
      latitude: ort.lat, longitude: ort.lon, hourly: 'precipitation', models: modell,
      forecast_days: '3', timeformat: 'unixtime', timezone: 'auto',
    });
    return 'https://ensemble-api.open-meteo.com/v1/ensemble?' + p.toString();
  }

  // Bright Sky: DWD-Daten (Radar, Stationsvorhersage, Messwerte, Warnungen), nur Deutschland
  const BS = 'https://api.brightsky.dev/';
  const isoZeit = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

  async function holeJson(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function hole(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      const j = await r.json();
      if (j.error) throw new Error(j.reason || 'API-Fehler');
      if (!j.hourly || !Array.isArray(j.hourly.time) || !j.hourly.time.length) throw new Error('Antwort ohne Stundenwerte');
      return j;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Probiert Modell-Kennungen der Reihe nach (zuletzt funktionierende zuerst).
   *  Nur bei „ungültiger Parameter“ (HTTP 400) wird die nächste Kennung versucht. */
  async function mitKennungen(ids, bauen, merkName) {
    const gemerkt = sicher(() => localStorage.getItem(KEY_ID + merkName), null);
    const reihe = gemerkt && ids.includes(gemerkt) ? [gemerkt, ...ids.filter((i) => i !== gemerkt)] : ids.slice();
    let letzter = null;
    for (const id of reihe) {
      try {
        const daten = await hole(bauen(id));
        sicher(() => localStorage.setItem(KEY_ID + merkName, id));
        return { daten, id };
      } catch (e) {
        letzter = e;
        if (e.status !== 400) throw e;
      }
    }
    throw letzter || new Error('keine Kennung');
  }

  async function holeHaupt(ort) {
    let a = null;
    let fehler = null;
    try { a = (await mitKennungen(CFG.modell, (id) => apiUrl(ort, id, false), 'haupt')).daten; } catch (e) { fehler = e; }
    let b = null;
    if (L.brauchtErgaenzung(a)) {
      try { b = await hole(apiUrl(ort, null, false)); } catch (e) { fehler = fehler || e; }
    }
    if (!a && !b) throw fehler || new Error('keine Daten');
    if (!a) return b;
    return b ? L.ergaenze(a, b) : a;
  }

  /** Vergleichsmodelle (nur Regen). Schlägt eines fehl, fehlt nur dieses; der Rest bleibt. */
  async function holeVergleich(ort) {
    const erg = await Promise.allSettled(CFG.vergleichsmodelle.map(async (vm) => {
      const r = await mitKennungen(vm.ids, (id) => apiUrl(ort, id, true), vm.name);
      const h = r.daten.hourly;
      if (!L.hatWerte(h.precipitation)) throw new Error('keine Niederschlagswerte');
      return { name: vm.name, id: r.id, hourly: { time: h.time, precipitation: h.precipitation } };
    }));
    const ok = [];
    const fehlt = [];
    erg.forEach((r, i) => { if (r.status === 'fulfilled') ok.push(r.value); else fehlt.push(CFG.vergleichsmodelle[i].name); });
    return { ok, fehlt };
  }

  /** D2-Ensemble: Regenwahrscheinlichkeit aus 20 Läufen. */
  async function holeEnsemble(ort) {
    const r = await mitKennungen(CFG.ensemble, (id) => ensembleUrl(ort, id), 'ensemble');
    const e = L.ensembleAuswerten(r.daten, CFG.regenSchwelle);
    if (!e) throw new Error('keine Ensemble-Werte');
    return e;
  }

  /** DWD-Radar: ab Beginn der laufenden Stunde bis 2 Std. 10 min voraus (gemessen + Vorschau). */
  async function holeRadar(ort) {
    const ab = Math.floor(Date.now() / 3600000) * 3600000;
    const km = CFG.radar.umkreisKm;
    const weit = Math.max(km, CFG.radar.nahKm || 0);
    const url = BS + 'radar?format=plain&lat=' + ort.lat + '&lon=' + ort.lon + '&distance=' + ((weit + 2) * 1000) +
      '&date=' + isoZeit(ab) + '&last_date=' + isoZeit(Date.now() + 130 * 60000);
    const r = L.radarAuswerten(await holeJson(url), km, CFG.radar.nahKm ? { km: CFG.radar.nahKm, nassMm5: CFG.radar.nassMm5 } : null);
    if (!r) throw new Error('keine Radarwerte');
    return r;
  }

  /** DWD-Stationsvorhersage MOSMIX der nächsten Station. */
  async function holeMosmix(ort) {
    const ab = Math.floor(Date.now() / 3600000) * 3600000 - 3600000;
    const url = BS + 'weather?lat=' + ort.lat + '&lon=' + ort.lon + '&date=' + isoZeit(ab) + '&last_date=' + isoZeit(ab + 3 * 86400000);
    const m = L.mosmixAuswerten(await holeJson(url), 'DWD');
    if (!m) throw new Error('keine Stationsvorhersage');
    return m;
  }

  async function holeWarnungen(ort) {
    const w = L.warnungenAuswerten(await holeJson(BS + 'alerts?lat=' + ort.lat + '&lon=' + ort.lon));
    if (!w) throw new Error('keine Warnungen');
    return w;
  }

  /** Zusatzquellen parallel; was fehlschlägt, fehlt nur selbst (Name landet in zusatzFehlt). */
  async function holeZusatz(ort) {
    const auftraege = [];
    if (CFG.ensemble && CFG.ensemble.length) auftraege.push(['ensemble', 'D2-Ensemble', holeEnsemble]);
    if (CFG.radar && CFG.radar.aktiv) auftraege.push(['radar', 'Radar', holeRadar]);
    if (CFG.dwdVergleich) auftraege.push(['mosmix', 'DWD-Stationsvorhersage', holeMosmix]);
    if (CFG.warnungen) auftraege.push(['warnungen', 'DWD-Warnungen', holeWarnungen]);
    const erg = await Promise.allSettled(auftraege.map((a) => a[2](ort)));
    const z = { zusatzFehlt: [] };
    erg.forEach((r, i) => {
      if (r.status === 'fulfilled') z[auftraege[i][0]] = r.value;
      else { z[auftraege[i][0]] = null; z.zusatzFehlt.push(auftraege[i][1]); }
    });
    return z;
  }

  async function aktualisieren() {
    if (st.laedt) return;
    st.laedt = true;
    st.letzterVersuch = Date.now();
    st.letzterRadar = Date.now();
    $('neuBtn').classList.add('dreht');
    try {
      const [haupt, vgl, zusatz] = await Promise.all([holeHaupt(st.ort), holeVergleich(st.ort), holeZusatz(st.ort)]);
      haupt.vergleich = vgl.ok;
      haupt.vergleichFehlt = vgl.fehlt;
      Object.assign(haupt, zusatz);
      st.daten = haupt;
      st.abgerufen = Date.now();
      st.offline = false;
      st.fehler = null;
      cacheSchreiben();
    } catch (e) {
      st.fehler = e;
      const c = cacheLesen();
      const maxAlter = CFG.maxAlterOfflineStunden * 3600000;
      if (c && Date.now() - c.abgerufen <= maxAlter) {
        st.daten = c.daten;
        st.abgerufen = c.abgerufen;
        st.offline = true;
      } else if (!st.daten || Date.now() - st.abgerufen > maxAlter) {
        st.daten = null;
        st.offline = false;
      } else {
        st.offline = true;
      }
    } finally {
      st.laedt = false;
      $('neuBtn').classList.remove('dreht');
      zeichne();
    }
    treffAktualisieren();
  }

  /** Nur das Radar neu holen (alle paar Minuten, das Radar wird alle 5 Minuten neu gerechnet). */
  async function radarAktualisieren() {
    if (st.laedt || !st.daten || st.offline || !(CFG.radar && CFG.radar.aktiv)) return;
    st.letzterRadar = Date.now();
    try {
      st.daten.radar = await holeRadar(st.ort);
      st.daten.zusatzFehlt = (st.daten.zusatzFehlt || []).filter((n) => n !== 'Radar');
      cacheSchreiben();
      zeichne();
    } catch (e) { /* alter Stand bleibt; zu alte Bilder werden ohnehin ignoriert */ }
  }

  /* ---------- Treffsicherheit (einmal je paar Stunden, eigener Speicher) ---------- */
  const KEY_TREFF = 'radlwetter.treff';
  st.treff = sicher(() => {
    const t = JSON.parse(localStorage.getItem(KEY_TREFF));
    return t && t.ort && gleicherOrt(t.ort, st.ort) && t.tage === (CFG.treffsicherheit && CFG.treffsicherheit.tage) ? t : null;
  }, null);

  async function treffAktualisieren(erzwingen) {
    const t = CFG.treffsicherheit;
    if (!t || st.treffLaedt) return;
    if (!erzwingen && st.treff && gleicherOrt(st.treff.ort, st.ort) && st.treff.tage === t.tage && Date.now() - st.treff.zeit < t.alleStunden * 3600000) return;
    st.treffLaedt = true;
    try {
      const vh = await mitKennungen(CFG.modell, (id) => 'https://previous-runs-api.open-meteo.com/v1/forecast?' + new URLSearchParams({
        latitude: st.ort.lat, longitude: st.ort.lon, models: id, past_days: String(t.tage), forecast_days: '1',
        hourly: 'precipitation_previous_day1,wind_speed_10m_previous_day1,wind_gusts_10m_previous_day1,temperature_2m_previous_day1',
        daily: 'sunrise,sunset', timeformat: 'unixtime', timezone: 'auto', wind_speed_unit: 'kmh',
      }).toString(), 'vortag');
      const ab = Math.floor(Date.now() / 3600000) * 3600000 - t.tage * 86400000;
      const mess = L.messungenAuswerten(await holeJson(BS + 'weather?lat=' + st.ort.lat + '&lon=' + st.ort.lon +
        '&date=' + isoZeit(ab) + '&last_date=' + isoZeit(Date.now())));
      const erg = L.treffsicherheit(vh.daten, mess, Date.now() / 1000, CFG);
      st.treff = { ort: st.ort, zeit: Date.now(), erg, tage: t.tage };
      sicher(() => localStorage.setItem(KEY_TREFF, JSON.stringify(st.treff)));
    } catch (e) {
      if (!st.treff || !gleicherOrt(st.treff.ort, st.ort)) st.treff = { ort: st.ort, zeit: 0, erg: null, fehler: true };
    } finally {
      st.treffLaedt = false;
      zeichneTreff();
    }
  }

  /* ---------- Darstellung: Hilfen ---------- */
  const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const NS = 'http://www.w3.org/2000/svg';

  const GLYPHEN = {
    gruen: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    top: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    gelb: '<path d="M12 6v7"/><path d="M12 17.5v.01"/>',
    rot: '<path d="M7 7l10 10M17 7L7 17"/>',
  };
  const NAMEN = { top: 'besonders gut', gruen: 'gut', gelb: 'mäßig', rot: 'schlecht' };
  const GRUND = { regen: 'Regen', wind: 'Wind', temp: 'Temperatur', gewitter: 'Gewitter', nass: 'nasse Straße', glaette: 'Glätte', warnung: 'DWD-Warnung', nah: 'Schauer in der Nähe' };

  function ampel(stufe) {
    const s = document.createElement('span');
    s.className = 'amp ' + stufe;
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', NAMEN[stufe]);
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHEN[stufe] + '</svg>';
    return s;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function symbol(id, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<use href="#' + id + '"/>';
    return svg;
  }

  const ganz = (v) => (v === null ? null : String(Math.round(v)).replace('-', '−'));
  const dez1 = (v) => (v === null ? null : v.toFixed(1).replace('.', ',').replace('-', '−'));
  function mm(v) {
    if (v === null) return null;
    if (v === 0) return '0';
    if (v < 0.1) return '<0,1';
    return v.toFixed(1).replace('.', ',');
  }
  const mmKomma = (v) => (v === 0 ? '0' : v < 0.1 ? '<0,1' : v.toFixed(1).replace('.', ','));

  function pfeil(richtungVon) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'pfeil');
    svg.setAttribute('aria-hidden', 'true');
    // Meteorologische Richtung = Herkunft des Windes; der Pfeil zeigt, wohin er weht.
    svg.style.transform = 'rotate(' + ((richtungVon + 180) % 360) + 'deg)';
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M12 2.5 L19 21 L12 16.5 L5 21 Z');
    svg.appendChild(p);
    return svg;
  }

  function sonnenSymbol() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'sonne');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle cx="12" cy="12" r="5" fill="currentColor"/>' +
      '<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
      '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></g>';
    return svg;
  }

  function radSymbol() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 40');
    svg.setAttribute('class', 'rad');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<use href="#rad"/>';
    return svg;
  }

  function beschriftung(text, einheit, icon, titel) {
    const th = el('th');
    th.scope = 'row';
    const w = el('span', 'lbl');
    if (icon) w.appendChild(icon);
    if (text) w.appendChild(el('span', null, text));
    if (einheit) w.appendChild(el('span', 'u', einheit));
    th.appendChild(w);
    if (titel) th.title = titel;
    return th;
  }

  /** Zahl, bei Überschreiten der Grenze als gelbe/rote Marke (wie die Ampel). */
  function wert(text, stufe) {
    if (text === null) { const s = el('span', 'leer', '–'); return s; }
    if (!stufe) return document.createTextNode(text);
    const s = el('span', 'flag ' + stufe, text);
    s.title = stufe === 'rot' ? 'schlecht (Grenze überschritten)' : 'mäßig (Grenze überschritten)';
    return s;
  }

  const zweistellig = (n) => String(n).padStart(2, '0');
  function uhrzeit(ts, offset) {
    const d = new Date((ts + offset) * 1000);
    return zweistellig(d.getUTCHours()) + ':' + zweistellig(d.getUTCMinutes());
  }
  function tagWort(tag, heute, wochentag, datum) {
    const diff = tag - heute;
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Morgen';
    return TAGE[wochentag] + ' ' + datum.getUTCDate() + '.' + (datum.getUTCMonth() + 1) + '.';
  }
  function wannText(ts, offset, heute) {
    const d = new Date((ts + offset) * 1000);
    const diff = L.lokalerTag(ts, offset) - heute;
    const prefix = diff === 0 ? '' : diff === 1 ? 'morgen ' : TAGE[d.getUTCDay()] + ' ';
    return prefix + uhrzeit(ts, offset) + ' Uhr';
  }

  /* ---------- Tabelle ---------- */
  function eignungZelle(td, sp) {
    const box = el('div', 'ampelbox');
    const wrap = el('div', 'ampelwrap');
    wrap.appendChild(ampel(sp.stufe));
    box.appendChild(wrap);
    const g = el('div', 'gruende');
    sp.ursachen.forEach((u) => g.appendChild(symbol('i-' + u)));
    box.appendChild(g);
    td.appendChild(box);

    const teile = [NAMEN[sp.stufe]];
    if (sp.ursachen.length) teile.push('Grund: ' + sp.ursachen.map((u) => GRUND[u]).join(', '));
    if (sp.unsicher) teile.push('Wettermodelle beim Regen uneinig');
    if (sp.radar) teile.push(sp.radarGemessen ? 'Regen laut Radar gemessen' : 'Regen laut Radar-Vorschau');
    (sp.warnungen || []).forEach((w) => teile.push('DWD: ' + w.ereignis));
    if (sp.topAbgewertet) teile.push('wegen Uneinigkeit nicht „besonders gut“');
    td.title = teile.join(' · ');
  }

  function viertelZelle(td, sp) {
    if (sp.viertel === null) { td.textContent = '–'; td.classList.add('leer'); return; }
    const balken = el('span', 'viertel');
    balken.setAttribute('role', 'img');
    const vtext = (v) => (v === null ? '–' : mmKomma(v) + ' mm');
    balken.setAttribute('aria-label', 'Regen je Viertelstunde: ' + sp.viertel.map(vtext).join(', '));
    sp.viertel.forEach((v, k) => {
      const i = el('i');
      const nass = v >= CFG.regenSchwelle - 1e-9;
      if (nass) {
        i.className = 'nass';
        i.style.height = Math.round(7 + 17 * Math.min(v / 0.8, 1)) + 'px';
      }
      i.title = (k * 15) + '–' + ((k + 1) * 15) + ' min: ' + vtext(v);
      balken.appendChild(i);
    });
    td.appendChild(balken);
    const min = el('span', 'dauer');
    min.appendChild(wert(sp.regenDauerMin === null ? null : String(sp.regenDauerMin), sp.zellen.regenDauer));
    td.appendChild(min);
  }

  function gefahrZelle(td, sp) {
    const z = sp.zellen;
    const liste = [];
    if (z.gewitter) liste.push(['gewitter', z.gewitter, sp.gewitterCode ? 'Gewitter vorhergesagt' : (z.gewitter === 'rot' ? 'DWD-Gewitterwarnung' : 'Gewitter möglich (Blitzpotenzial)')]);
    if (z.glaette) liste.push(['glaette', z.glaette, sp.glaette ? 'Glättegefahr (kalt und nass)' : 'DWD-Glättewarnung']);
    if (z.nah) liste.push(['nah', z.nah, 'Schauer in der Nähe: ' + sp.nahProzent + ' % der Fläche im Umkreis von ' + CFG.radar.nahKm + ' km mit Regen' + (sp.nahKmMin !== null && sp.nahKmMin !== undefined ? ', nächster ca. ' + sp.nahKmMin + ' km entfernt' : '') + ' (Radar)']);
    if (z.nass && !z.glaette) liste.push(['nass', z.nass, 'Straße noch nass (' + mmKomma(sp.regenVorher) + ' mm in den 2 Std. davor)']);
    if (z.warnung) liste.push(['warnung', z.warnung, 'DWD-Warnung']);
    const hinweise = (sp.warnungen || []).filter((w) => !w.art);
    if (!liste.length && !hinweise.length) { td.appendChild(el('span', 'leer', '–')); return; }
    const box = el('span', 'gefahren');
    liste.forEach(([id, stufe]) => { const i = el('span', 'gf ' + stufe); i.appendChild(symbol('i-' + id)); box.appendChild(i); });
    if (!liste.length) { const i = el('span', 'gf hinweis'); i.appendChild(symbol('i-warnung')); box.appendChild(i); }
    td.appendChild(box);
    td.title = liste.map((x) => x[2]).concat(hinweise.map((w) => 'DWD-Hinweis: ' + w.ereignis)).join(' · ');
  }

  function modellZelle(td, sp) {
    const tip = sp.modelle.map((x) => x.name + ' ' + mmKomma(x.mm) + ' mm').join(' · ');
    td.title = tip || 'keine Modelle verfügbar';
    switch (sp.modellStatus) {
      case 'uneinig': { const f = el('span', 'flag gelb mod', '?'); td.appendChild(f); break; }
      case 'einig-nass': { td.appendChild(symbol('i-regen', 'mod-nass')); break; }
      case 'einig-trocken': { const c = el('span', 'mod-ok'); c.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'; td.appendChild(c); break; }
      case 'schwach': { td.appendChild(el('span', 'leer', '~')); break; }
      default: { td.appendChild(el('span', 'leer', '–')); }
    }
  }

  function tabelle(spalten) {
    const t = $('tafel');
    t.textContent = '';
    const offset = (st.daten && st.daten.utc_offset_seconds) || 0;
    const heute = L.lokalerTag(Date.now() / 1000, offset);
    const wechsel = (i) => i > 0 && spalten[i].tag !== spalten[i - 1].tag;

    // Kopf: Tage (zusammengefasst) und Stunden
    const thead = el('thead');
    const r1 = el('tr', 'tage');
    r1.appendChild(el('th'));
    let i = 0;
    while (i < spalten.length) {
      let j = i;
      while (j + 1 < spalten.length && spalten[j + 1].tag === spalten[i].tag) j++;
      const s = spalten[i];
      const text = tagWort(s.tag, heute, s.wochentag, s.datum);
      const th = el('th', i > 0 ? 'neuer-tag' : '', text === 'Heute' || text === 'Morgen'
        ? text + ' · ' + TAGE[s.wochentag] + ' ' + s.datum.getUTCDate() + '.' + (s.datum.getUTCMonth() + 1) + '.'
        : text);
      th.colSpan = j - i + 1;
      th.scope = 'colgroup';
      r1.appendChild(th);
      i = j + 1;
    }
    thead.appendChild(r1);

    const r2 = el('tr', 'stunden');
    const eck = el('th');
    eck.appendChild(el('span', 'uhr', 'Uhr'));
    r2.appendChild(eck);
    spalten.forEach((sp, k) => {
      const th = el('th', (sp.jetzt ? 'jetzt ' : '') + (wechsel(k) ? 'neuer-tag' : ''), String(sp.stunde));
      th.scope = 'col';
      th.title = sp.stunde + '–' + ((sp.stunde + 1) % 24) + ' Uhr';
      r2.appendChild(th);
    });
    thead.appendChild(r2);
    t.appendChild(thead);

    // Zeilen in der Reihenfolge deiner Wichtigkeit:
    // Eignung (Rennrad) · Regen · Modelle · Wind/Böen · Sonne · Temperatur · Wolken
    const tb = el('tbody');
    const zeile = (kopf, cls, fuelle) => {
      const tr = el('tr', cls);
      tr.appendChild(kopf);
      spalten.forEach((sp, k) => {
        const td = el('td', (sp.jetzt ? 'jetzt ' : '') + (wechsel(k) ? 'neuer-tag' : ''));
        fuelle(td, sp);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    };
    const zahlZelle = (feld, fmt, zelle) => (td, sp) => {
      const s = fmt(sp[feld]);
      td.appendChild(wert(s, zelle ? sp.zellen[zelle] : null));
      if (s === null) td.classList.add('leer');
    };

    const radAmpel = el('span', 'radampel');
    radAmpel.appendChild(radSymbol());
    const mini = document.createElementNS(NS, 'svg');
    mini.setAttribute('viewBox', '0 0 12 39');
    mini.setAttribute('class', 'miniampel');
    mini.setAttribute('aria-hidden', 'true');
    // Rot, Gelb, Grün und ganz unten Dunkelgrün mit weißem Ring = „besonders gut“ (wie in der Tabelle)
    mini.innerHTML = '<rect x="0.5" y="0.5" width="11" height="38" rx="4" fill="#0d1424" stroke="rgba(255,255,255,.55)"/>' +
      '<circle cx="6" cy="6.3" r="3.6" fill="var(--rot)"/><circle cx="6" cy="15" r="3.6" fill="var(--gelb)"/>' +
      '<circle cx="6" cy="23.7" r="3.6" fill="var(--gruen)"/>' +
      '<circle cx="6" cy="32.4" r="3.2" fill="var(--gruen-dunkel)" stroke="#fff" stroke-width="1.2"/>';
    radAmpel.appendChild(mini);
    const radKopf = beschriftung('', '', radAmpel, 'Eignung fürs Rennrad');
    radKopf.firstChild.setAttribute('aria-label', 'Eignung fürs Rennrad');
    zeile(radKopf, 'eignung', eignungZelle);

    zeile(beschriftung('Regen', 'mm'), 'regenmm', (td, sp) => {
      zahlZelle('regenMm', mm, 'regenMm')(td, sp);
      if (sp.regenMm !== null && sp.regenMm > 0) td.classList.add('nass');
      if (sp.radar) {
        const r = el('span', 'rq', 'R');
        r.setAttribute('aria-label', 'Radar');
        td.appendChild(r);
        td.title = sp.radarGemessen ? 'DWD-Radar: gemessen' : 'DWD-Radar: Vorschau (bis 2 Stunden)';
      }
    });
    zeile(beschriftung('Regendauer', 'min', null, 'Regen je Viertelstunde der Stunde, darunter Minuten mit Regen'), 'regendauer', viertelZelle);
    zeile(beschriftung('Regen', '%', null, 'Regenwahrscheinlichkeit: Anteil der Rechenläufe mit Regen (D2-Ensemble, 20 Läufe; danach ICON-EPS)'), 'regenp', (td, sp) => {
      zahlZelle('regenProzent', ganz, 'regenProzent')(td, sp);
      td.title = sp.regenProzentQuelle + (sp.radar ? ' – zählt hier nicht, das Radar ist genauer' : '');
    });
    zeile(beschriftung('Modelle', 'Regen', null, 'Einigkeit der Wettermodelle beim Regen'), 'modelle', modellZelle);
    zeile(beschriftung('Gefahr', '', null, 'Gewitter, Glätte, nasse Straße, amtliche DWD-Warnung'), 'gefahr', gefahrZelle);
    zeile(beschriftung('Wind', 'km/h'), 'wind', (td, sp) => {
      const s = ganz(sp.windKmh);
      td.appendChild(wert(s, sp.zellen.wind));
      if (s === null) { td.classList.add('leer'); return; }
      if (sp.windRichtung !== null) td.appendChild(pfeil(sp.windRichtung));
    });
    zeile(beschriftung('Böen', 'km/h', null, 'Stärkste Böe der Stunde'), 'boeen', zahlZelle('boeenKmh', ganz, 'boeen'));
    zeile(beschriftung('', 'min', sonnenSymbol(), 'Sonnenschein in Minuten'), 'sonne', zahlZelle('sonneMin', ganz));
    zeile(beschriftung('Temp.', '°C', null, 'Lufttemperatur'), 'temp', zahlZelle('temp', ganz, 'temp'));
    zeile(beschriftung('Gefühlt', '°C', null, 'Gefühlte Temperatur (Wind, Feuchte, Sonne) – Grundlage der Ampel'), 'gefuehlt', zahlZelle('gefuehltC', dez1, 'gefuehlt'));
    zeile(beschriftung('Wolken', '%'), 'wolken', zahlZelle('wolken', ganz));
    t.appendChild(tb);
  }

  /* ---------- Kopfinfo: Regenausblick, Fenster, Modelle ---------- */
  function kopfinfo(spalten) {
    const box = $('kopfinfo');
    if (!spalten.length || !st.daten) { box.hidden = true; return; }
    box.hidden = false;
    const offset = st.daten.utc_offset_seconds || 0;
    const jetzt = Date.now() / 1000;
    const heute = L.lokalerTag(jetzt, offset);

    // 1) Regenausblick (Viertelstundenwerte des Hauptmodells)
    const ra = $('regenausblick');
    ra.textContent = '';
    ra.className = 'regenausblick';
    const a = L.regenAusblick(st.daten, jetzt, CFG);
    if (a) {
      let text;
      if (a.status === 'trocken') text = 'Trocken ' + (a.mindestens ? 'mindestens ' : '') + 'bis ' + wannText(a.bis, offset, heute);
      else if (a.status === 'regnet') text = a.offen ? 'Es regnet – Ende nicht absehbar' : a.mindestens ? 'Es regnet – mindestens bis ' + wannText(a.bis, offset, heute) : 'Es regnet – trocken ab ' + wannText(a.bis, offset, heute);
      else text = a.bis >= jetzt + CFG.stunden * 3600 - 60 ? 'Kein Regen in den nächsten ' + CFG.stunden + ' Stunden' : 'Kein Regen bis ' + wannText(a.bis, offset, heute);
      ra.classList.add(a.status === 'regnet' ? 'nass' : 'trocken');
      ra.appendChild(symbol('i-regen', 'ra-sym'));
      const rt = el('span', 'ra-text');
      rt.appendChild(el('b', null, text));
      rt.appendChild(el('span', 'quelle', ' (' + (a.quelle || 'ICON') + (a.quelle && a.quelle.startsWith('Radar') ? ', DWD' : '') + ')'));
      if (a.nahAb !== undefined) {
        const n = el('span', 'nahtext');
        n.appendChild(symbol('i-nah', 'nah-sym'));
        n.append((a.nahJetzt ? 'Schauer im Umkreis von ' + CFG.radar.nahKm + ' km' : 'Schauer im Umkreis von ' + CFG.radar.nahKm + ' km ab ' + wannText(a.nahAb, offset, heute)) +
          (a.nahKm !== null && a.nahKm !== undefined ? ' (nächster ca. ' + a.nahKm + ' km)' : ''));
        rt.appendChild(n);
      }
      ra.appendChild(rt);
    }
    ra.hidden = !a;

    // 2) Bestes Radlfenster je Tag (mindestens N Stunden)
    const ul = $('fenster');
    ul.textContent = '';
    const fenster = L.fensterProTag(spalten, CFG);
    const proTag = new Map(fenster.map((f) => [f.tag, f]));
    const tage = [];
    spalten.forEach((s) => { if (!tage.find((x) => x.tag === s.tag)) tage.push(s); });
    tage.forEach((s) => {
      const li = el('li');
      const f = proTag.get(s.tag);
      const name = tagWort(s.tag, heute, s.wochentag, s.datum);
      li.appendChild(el('span', 'tag', name));
      if (f) {
        const von = spalten[f.von];
        const bis = spalten[f.bis];
        li.appendChild(el('b', null, von.stunde + '–' + ((bis.stunde + 1) % 24) + ' Uhr'));
        li.appendChild(el('span', 'dauerf', f.stunden + ' Std.'));
        if (f.unsicher > 0) {
          const u = el('span', 'unsicherbox');
          u.title = f.unsicher + ' Std. mit uneinigen Wettermodellen beim Regen';
          u.appendChild(el('span', 'badge inline', '?'));
          u.appendChild(el('span', 'unsicher-text', f.unsicher + ' Std. unsicher'));
          li.appendChild(u);
        }
      } else {
        li.classList.add('keins');
        li.appendChild(el('span', 'keinfenster', 'kein Fenster ab ' + CFG.fenster.mindestStunden + ' Std.'));
      }
      ul.appendChild(li);
    });

    // 3) Amtliche DWD-Warnungen für den Ort
    const wb = $('warnbox');
    wb.textContent = '';
    const jetztW = (st.daten.warnungen && st.daten.warnungen.liste || []).filter((w) => w.bis === null || w.bis > jetzt);
    wb.hidden = !jetztW.length;
    jetztW.forEach((w) => {
      const li = el('li', w.art ? 'stark' : '');
      li.appendChild(symbol(w.art === 'gewitter' ? 'i-gewitter' : w.art === 'glaette' ? 'i-glaette' : 'i-warnung', 'wb-sym'));
      const t = el('span');
      t.appendChild(el('b', null, 'DWD-Warnung: ' + w.ereignis.charAt(0) + w.ereignis.slice(1).toLowerCase()));
      const von = w.von !== null && w.von > jetzt ? 'ab ' + wannText(w.von, offset, heute) : 'jetzt';
      t.append(' · ' + von + (w.bis !== null ? ' bis ' + wannText(w.bis, offset, heute) : ''));
      li.appendChild(t);
      li.title = w.titel;
      wb.appendChild(li);
    });

    // 4) Einigkeit der Wettermodelle beim Regen – deutlich sichtbar
    const mh = $('modellhinweis');
    const namen = ['ICON'].concat((st.daten.vergleich || []).map((v) => v.name));
    if (st.daten.mosmix) namen.push('DWD ' + (st.daten.mosmix.station ? stationName(st.daten.mosmix.station) : 'Station'));
    const fehlt = (st.daten.vergleichFehlt || []).concat(st.daten.zusatzFehlt || []);
    const uneinig = spalten.filter((s) => s.unsicher).length;
    mh.className = 'modellhinweis';
    mh.textContent = '';
    if (namen.length < 2) {
      mh.classList.add('warn');
      mh.textContent = 'Modellvergleich nicht verfügbar (' + (fehlt.join(', ') || 'keine Vergleichsmodelle') + ' nicht abrufbar) – Sicherheit beim Regen unbekannt.';
    } else if (uneinig > 0) {
      mh.classList.add('warn');
      mh.appendChild(el('span', 'badge inline', '?'));
      mh.appendChild(el('b', null, 'Regen unsicher: '));
      // betroffene Stunden direkt nennen, zusammengefasst zu Zeiträumen je Tag
      const bereiche = [];
      spalten.forEach((s, i) => {
        if (!s.unsicher) return;
        const letzter = bereiche[bereiche.length - 1];
        if (letzter && letzter.tag === s.tag && letzter.bisTs + 3600 === s.ts) { letzter.bis = s.stunde; letzter.bisTs = s.ts; }
        else bereiche.push({ tag: s.tag, von: s.stunde, bis: s.stunde, bisTs: s.ts, sp: s });
      });
      const wann = bereiche.map((b) => {
        const t = tagWort(b.tag, heute, b.sp.wochentag, b.sp.datum);
        return (t === 'Heute' ? 'heute' : t === 'Morgen' ? 'morgen' : t) + ' ' + b.von + '–' + ((b.bis + 1) % 24) + ' Uhr';
      }).join(', ');
      mh.append('Die Wettermodelle (' + namen.join(', ') + ') sind sich uneinig: ' + wann + '.' +
        (fehlt.length ? ' Ohne ' + fehlt.join(', ') + ' (nicht abrufbar).' : ''));
    } else {
      mh.textContent = 'Die Wettermodelle (' + namen.join(', ') + ') sind sich beim Regen einig.' +
        (fehlt.length ? ' Ohne ' + fehlt.join(', ') + ' (nicht abrufbar).' : '');
    }
  }

  /** „NANDLSTADT“ -> „Nandlstadt“ */
  const stationName = (n) => String(n).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  /* ---------- Treffsicherheit anzeigen ---------- */
  const prozent = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  function zeichneTreff() {
    const box = $('treff');
    if (!box) return;
    const t = st.treff && gleicherOrt(st.treff.ort, st.ort) ? st.treff : null;
    box.textContent = '';
    if (!t || (!t.erg && !t.fehler)) { box.hidden = true; return; }
    box.hidden = false;
    const tage = CFG.treffsicherheit.tage;
    if (!t.erg) { box.appendChild(el('span', 'leise', 'Treffsicherheit: noch keine Auswertung möglich (Messwerte nicht abrufbar).')); return; }
    const e = t.erg;
    box.appendChild(el('b', 'gross', prozent(e.gleich, e.stunden) + ' %'));
    box.append(' so oft stimmte die Ampel in den letzten ' + tage + ' Tagen');
    // Einzelheiten nur beim Darüberfahren bzw. langen Antippen
    box.title = 'Ampel vom Vortag gegen gemessenes Wetter, ' + e.stunden + ' Tageslicht-Stunden · zu optimistisch: ' + e.zuGut +
      ' Std. · zu vorsichtig: ' + e.zuSchlecht + ' Std. · Regen ja/nein richtig: ' + prozent(e.regenRichtig, e.regenStunden) +
      ' % (verpasst ' + e.regenVerpasst + ', Fehlalarm ' + e.regenFehlalarm + ') · Messung: ' + (e.stationen || []).map(stationName).join(', ') +
      ' · Stand ' + uhrText(t.zeit) + ' Uhr';
  }

  const uhrText = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function statusText() {
    const s = $('status');
    s.classList.remove('fehler');
    if (!st.daten) {
      s.classList.add('fehler');
      s.textContent = st.laedt ? 'Lade Wetter …' : 'Keine Wetterdaten – Verbindung prüfen. Neuer Versuch läuft automatisch.';
      return;
    }
    if (st.offline) {
      s.textContent = 'Offline – gespeicherte Daten von ' + uhrText(st.abgerufen) + ' Uhr. Neuer Versuch läuft automatisch.';
      return;
    }
    s.textContent = 'Stand ' + uhrText(st.abgerufen) + ' Uhr · ' + st.ort.name +
      ' · nur Tageslicht, nächste ' + CFG.stunden + ' Stunden';
  }

  function zeichne() {
    $('ortName').textContent = st.ort.name;
    $('ver').textContent = CFG.version;
    let spalten = [];
    if (st.daten) spalten = L.baueSpalten(st.daten, Date.now() / 1000, CFG);
    if (spalten.length) {
      tabelle(spalten);
      $('rahmen').hidden = false;
    } else {
      $('tafel').textContent = '';
      $('rahmen').hidden = !st.daten;
    }
    kopfinfo(spalten);
    zeichneTreff();
    statusText();
  }

  // Legende mit Symbolen füllen
  document.querySelectorAll('.legende .amp').forEach((e) => {
    const s = e.dataset.s;
    e.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHEN[s] + '</svg>';
  });

  /* ---------- Erklärung: So schaltet die Ampel (Werte direkt aus config.js) ---------- */
  function erklaerung() {
    const box = $('erklText');
    box.textContent = '';
    const r = CFG.grenzen.rot;
    const g = CFG.grenzen.gelb;
    const km = (CFG.radar && CFG.radar.nahKm) || 5;
    const z = (v) => String(v).replace('.', ',');
    const abschnitt = (titel, punkte, einleitung) => {
      box.appendChild(el('h3', null, titel));
      if (einleitung) box.appendChild(el('p', null, einleitung));
      if (punkte) { const ul = el('ul'); punkte.forEach((p) => ul.appendChild(el('li', null, p))); box.appendChild(ul); }
    };
    abschnitt('Grundidee', null, 'Jede Stunde wird für sich bewertet. Es gilt die Reihenfolge deiner Wichtigkeit: kein Regen, wenig Wind, Sonne, warm genug. Schon eine einzige Bedingung genügt für Rot bzw. Gelb.');
    abschnitt('Rot – schlecht, wenn eines davon zutrifft', [
      'Regen ab ' + z(r.regenMm) + ' mm in der Stunde oder Regenwahrscheinlichkeit ab ' + r.regenProzent + ' %',
      'Wind ab ' + r.windKmh + ' km/h oder Böen ab ' + r.boeenKmh + ' km/h',
      'gefühlte Temperatur unter ' + r.tempUnter + ' °C',
      'Gewitter vorhergesagt',
      'Glätte: Luft höchstens ' + z(CFG.glaette.tempMax) + ' °C und Straße nass, Regen oder Schnee',
      'amtliche DWD-Warnung vor Gewitter, Glätte, Sturm oder Starkregen',
    ]);
    abschnitt('Gelb – mäßig, wenn eines davon zutrifft', [
      'Regen ab ' + z(g.regenMm) + ' mm, mindestens ' + g.regenDauerMin + ' Minuten Regen oder Regenwahrscheinlichkeit ab ' + g.regenProzent + ' %',
      'Wind ab ' + g.windKmh + ' km/h oder Böen ab ' + g.boeenKmh + ' km/h',
      'gefühlte Temperatur unter ' + g.tempUnter + ' °C',
      'Straße noch nass: ab ' + z(CFG.nasseStrasse.mm) + ' mm Regen in den 2 Stunden davor',
      'Blitzgefahr (Gewitter möglich)',
      'Schauer in der Nähe: Radar zeigt Regen auf mindestens ' + CFG.radar.nahAnteilProzent + ' % der Fläche im Umkreis von ' + km + ' km',
    ]);
    abschnitt('Grün – gut', null, 'Keine der Bedingungen trifft zu. Dunkelgrün mit weißem Ring heißt „besonders gut“: zusätzlich die volle Stunde Sonne, kein Tropfen Regen und die Wettermodelle sind sich einig.');
    abschnitt('Woher die Werte kommen', [
      'Wettermodell ICON des Deutschen Wetterdienstes, in den ersten 2 Tagen mit 2 km feinem Raster.',
      'Regenwahrscheinlichkeit: Das feine Modell wird 20-mal mit leicht veränderten Startwerten gerechnet. Zeigen 5 der 20 Läufe Regen, steht dort 25 %.',
      'Nächste 2 Stunden: Statt des Modells zählt das DWD-Regenradar (gemessen und Vorschau, Kennzeichen „R“). Dort zählt die Regenwahrscheinlichkeit nicht.',
      'Gegenprobe: Die Modelle ECMWF (Europa), GFS (USA) und die DWD-Vorhersage für Nandlstadt werden beim Regen verglichen. Widersprechen sie sich, steht ein „?“ in der Zeile „Modelle“.',
    ]);
    abschnitt('Symbole unter der Ampel', null, 'Sie zeigen den Grund für Gelb oder Rot: Tropfen = Regen, Tropfen im Kreis = Schauer in der Nähe, Wind, Thermometer = Temperatur, Blitz = Gewitter, Schneeflocke = Glätte, Tropfen über Straße = nasse Straße, Dreieck = DWD-Warnung.');
    abschnitt('Treffsicherheit', null, 'Die App vergleicht laufend, was das Modell 24 Stunden vorher für die letzten ' + CFG.treffsicherheit.tage +
      ' Tage vorhergesagt hat, mit den Messwerten der DWD-Stationen. Die Prozentzahl sagt, wie oft die Ampelfarbe gestimmt hat (nur Tageslicht-Stunden).');
    abschnitt('Gut zu wissen', null, 'Einige Grenzen sind Vorschläge und keine wissenschaftlich belegten Werte: Böen 40/50 km/h, nasse Straße, Glätte, Blitzgefahr und Schauer in der Nähe. Mit der Treffsicherheit lassen sie sich mit der Zeit begründet anpassen.');
  }
  $('erklBtn').addEventListener('click', () => { erklaerung(); $('erklDlg').showModal(); });
  $('erklDlg').addEventListener('click', (e) => { if (e.target === $('erklDlg')) $('erklDlg').close(); });

  /* ---------- Ortswahl ---------- */
  const dlg = $('ortDlg');
  const hinweis = (t) => { $('ortHinweis').textContent = t || ''; };

  function ortSetzen(ort) {
    st.ort = ort;
    sicher(() => localStorage.setItem(KEY_ORT, JSON.stringify(ort)));
    st.daten = null;
    st.offline = false;
    st.treff = null;
    const c = cacheLesen();
    if (c) { st.daten = c.daten; st.abgerufen = c.abgerufen; }
    zeichne();
    aktualisieren();
    if (dlg.open) dlg.close();
  }

  async function ortSuchen() {
    const q = $('ortSuche').value.trim();
    const liste = $('ortListe');
    liste.textContent = '';
    if (q.length < 2) { hinweis('Bitte mindestens 2 Buchstaben eingeben.'); return; }
    hinweis('Suche …');
    try {
      const url = 'https://geocoding-api.open-meteo.com/v1/search?count=6&language=de&format=json&name=' + encodeURIComponent(q);
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const res = j.results || [];
      hinweis(res.length ? '' : 'Nichts gefunden.');
      res.forEach((o) => {
        const li = el('li');
        const b = el('button');
        b.type = 'button';
        b.append(o.name);
        const zusatz = [o.admin1, o.country].filter(Boolean).join(', ');
        if (zusatz) { b.append(' '); b.appendChild(el('small', null, '· ' + zusatz)); }
        b.addEventListener('click', () => ortSetzen({ name: o.name, lat: +o.latitude.toFixed(4), lon: +o.longitude.toFixed(4) }));
        li.appendChild(b);
        liste.appendChild(li);
      });
    } catch (e) {
      hinweis('Suche nicht möglich (keine Verbindung?).');
    }
  }

  $('ortBtn').addEventListener('click', () => { hinweis(''); $('ortListe').textContent = ''; dlg.showModal(); $('ortSuche').focus(); });
  $('ortSuchBtn').addEventListener('click', ortSuchen);
  $('ortSuche').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ortSuchen(); } });
  $('ortStandard').addEventListener('click', () => ortSetzen(CFG.ort));
  $('ortGps').addEventListener('click', () => {
    if (!navigator.geolocation) { hinweis('Standort wird von diesem Gerät nicht unterstützt.'); return; }
    hinweis('Standort wird ermittelt …');
    navigator.geolocation.getCurrentPosition(
      (p) => ortSetzen({ name: 'Mein Standort', lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      () => hinweis('Standort nicht verfügbar (Freigabe verweigert?).'),
      { timeout: 10000, maximumAge: 600000 }
    );
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------- Aktualisierungs-Takt ---------- */
  $('neuBtn').addEventListener('click', () => aktualisieren());

  function takt() {
    const jetzt = Date.now();
    const stunde = Math.floor(jetzt / 3600000);
    if (stunde !== st.stunde) {
      st.stunde = stunde;
      zeichne();
      aktualisieren();
      return;
    }
    const wartezeit = st.fehler || st.offline || !st.daten ? 60000 : CFG.intervallMinuten * 60000;
    if (jetzt - st.letzterVersuch >= wartezeit) { aktualisieren(); return; }
    if (CFG.radar && CFG.radar.aktiv && jetzt - (st.letzterRadar || 0) >= CFG.radar.intervallMinuten * 60000) radarAktualisieren();
  }
  setInterval(takt, 30000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    st.stunde = Math.floor(Date.now() / 3600000);
    zeichne();
    if (Date.now() - st.letzterVersuch > 60000) aktualisieren();
    if (st.reg) sicher(() => st.reg.update());
  });
  window.addEventListener('online', () => aktualisieren());

  /* ---------- Service Worker (Installierbarkeit, Offline, Selbst-Update) ---------- */
  if ('serviceWorker' in navigator) {
    const hatteSW = !!navigator.serviceWorker.controller;
    let neuGeladen = false;
    navigator.serviceWorker.register('./sw.js').then((reg) => { st.reg = reg; }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hatteSW || neuGeladen) return; // erste Installation braucht keinen Neustart
      neuGeladen = true;
      location.reload();
    });
  }
  $('updBtn').addEventListener('click', async () => {
    const b = $('updBtn');
    b.textContent = 'Prüfe …';
    try { if (st.reg) await st.reg.update(); } catch (e) { /* offline */ }
    aktualisieren();
    setTimeout(() => { b.textContent = 'Aktuell – v' + CFG.version; setTimeout(() => { b.textContent = 'Nach Update suchen'; }, 2500); }, 1200);
  });

  /* ---------- Start ---------- */
  const c0 = cacheLesen();
  if (c0 && Date.now() - c0.abgerufen <= CFG.maxAlterOfflineStunden * 3600000) {
    st.daten = c0.daten; st.abgerufen = c0.abgerufen; // sofort etwas zeigen, Abruf folgt
  }
  zeichne();
  aktualisieren();
})();
