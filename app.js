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
      p.set('hourly', HOURLY);
      p.set('minutely_15', 'precipitation');
      p.set('daily', 'sunrise,sunset');
    }
    if (modell) p.set('models', modell);
    return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
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

  async function aktualisieren() {
    if (st.laedt) return;
    st.laedt = true;
    st.letzterVersuch = Date.now();
    $('neuBtn').classList.add('dreht');
    try {
      const [haupt, vgl] = await Promise.all([holeHaupt(st.ort), holeVergleich(st.ort)]);
      haupt.vergleich = vgl.ok;
      haupt.vergleichFehlt = vgl.fehlt;
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
  const GRUND = { regen: 'Regen', wind: 'Wind', temp: 'Temperatur' };

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
    if (sp.modellStatus === 'uneinig') wrap.appendChild(el('span', 'badge', '?'));
    box.appendChild(wrap);
    const g = el('div', 'gruende');
    sp.ursachen.forEach((u) => g.appendChild(symbol('i-' + u)));
    box.appendChild(g);
    td.appendChild(box);

    const teile = [NAMEN[sp.stufe]];
    if (sp.ursachen.length) teile.push('Grund: ' + sp.ursachen.map((u) => GRUND[u]).join(', '));
    if (sp.modellStatus === 'uneinig') teile.push('Wettermodelle beim Regen uneinig');
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

    const radKopf = beschriftung('', '', radSymbol(), 'Eignung fürs Rennrad');
    radKopf.firstChild.setAttribute('aria-label', 'Eignung fürs Rennrad');
    zeile(radKopf, 'eignung', eignungZelle);

    zeile(beschriftung('Regen', 'mm'), 'regenmm', (td, sp) => {
      zahlZelle('regenMm', mm, 'regenMm')(td, sp);
      if (sp.regenMm !== null && sp.regenMm > 0) td.classList.add('nass');
    });
    zeile(beschriftung('Regendauer', 'min', null, 'Regen je Viertelstunde der Stunde, darunter Minuten mit Regen'), 'regendauer', viertelZelle);
    zeile(beschriftung('Regen', '%'), 'regenp', zahlZelle('regenProzent', ganz, 'regenProzent'));
    zeile(beschriftung('Modelle', 'Regen', null, 'Einigkeit der Wettermodelle beim Regen'), 'modelle', modellZelle);
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
      if (a.status === 'trocken') text = 'Trocken bis ' + wannText(a.bis, offset, heute);
      else if (a.status === 'regnet') text = a.offen ? 'Es regnet – Ende nicht absehbar' : 'Es regnet – trocken ab ' + wannText(a.bis, offset, heute);
      else text = a.bis >= jetzt + CFG.stunden * 3600 - 60 ? 'Kein Regen in den nächsten ' + CFG.stunden + ' Stunden' : 'Kein Regen bis ' + wannText(a.bis, offset, heute);
      ra.classList.add(a.status === 'regnet' ? 'nass' : 'trocken');
      ra.appendChild(symbol('i-regen', 'ra-sym'));
      const rt = el('span', 'ra-text');
      rt.appendChild(el('b', null, text));
      rt.appendChild(el('span', 'quelle', ' (ICON)'));
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

    // 3) Einigkeit der Wettermodelle beim Regen – deutlich sichtbar
    const mh = $('modellhinweis');
    const namen = ['ICON'].concat((st.daten.vergleich || []).map((v) => v.name));
    const fehlt = st.daten.vergleichFehlt || [];
    const uneinig = spalten.filter((s) => s.modellStatus === 'uneinig').length;
    mh.className = 'modellhinweis';
    mh.textContent = '';
    if (namen.length < 2) {
      mh.classList.add('warn');
      mh.textContent = 'Modellvergleich nicht verfügbar (' + (fehlt.join(', ') || 'keine Vergleichsmodelle') + ' nicht abrufbar) – Sicherheit beim Regen unbekannt.';
    } else if (uneinig > 0) {
      mh.classList.add('warn');
      mh.appendChild(el('span', 'badge inline', '?'));
      mh.appendChild(el('b', null, 'Regen unsicher: '));
      mh.append('Die Wettermodelle (' + namen.join(', ') + ') sind sich in ' + uneinig + (uneinig === 1 ? ' Stunde' : ' Stunden') + ' uneinig (mit ? markiert).' +
        (fehlt.length ? ' Ohne ' + fehlt.join(', ') + ' (nicht abrufbar).' : ''));
    } else {
      mh.textContent = 'Die Wettermodelle (' + namen.join(', ') + ') sind sich beim Regen einig.' +
        (fehlt.length ? ' Ohne ' + fehlt.join(', ') + ' (nicht abrufbar).' : '');
    }
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
    statusText();
  }

  // Legende mit Symbolen füllen
  document.querySelectorAll('.legende .amp').forEach((e) => {
    const s = e.dataset.s;
    e.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHEN[s] + '</svg>';
  });

  /* ---------- Ortswahl ---------- */
  const dlg = $('ortDlg');
  const hinweis = (t) => { $('ortHinweis').textContent = t || ''; };

  function ortSetzen(ort) {
    st.ort = ort;
    sicher(() => localStorage.setItem(KEY_ORT, JSON.stringify(ort)));
    st.daten = null;
    st.offline = false;
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
    if (jetzt - st.letzterVersuch >= wartezeit) aktualisieren();
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
