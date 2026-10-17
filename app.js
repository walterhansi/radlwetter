/* Radlwetter – Oberfläche, Abruf, Aktualisierung */
(() => {
  'use strict';
  const CFG = RADL_CONFIG;
  const L = RadlLogik;
  const KEY_CACHE = 'radlwetter.cache';
  const KEY_ORT = 'radlwetter.ort';
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
  const HOURLY = 'temperature_2m,cloud_cover,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,sunshine_duration';

  function apiUrl(ort, modell) {
    const p = new URLSearchParams({
      latitude: ort.lat,
      longitude: ort.lon,
      hourly: HOURLY,
      minutely_15: 'precipitation',
      daily: 'sunrise,sunset',
      wind_speed_unit: 'kmh',
      timeformat: 'unixtime',
      timezone: 'auto',
      forecast_days: '3',
    });
    if (modell) p.set('models', modell);
    return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
  }

  async function hole(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.reason || 'API-Fehler');
      if (!j.hourly || !Array.isArray(j.hourly.time) || !j.hourly.time.length) throw new Error('Antwort ohne Stundenwerte');
      return j;
    } finally {
      clearTimeout(timer);
    }
  }

  async function holeDaten(ort) {
    let a = null;
    let fehler = null;
    try { a = await hole(apiUrl(ort, CFG.modell)); } catch (e) { fehler = e; }
    let b = null;
    if (L.brauchtErgaenzung(a)) {
      try { b = await hole(apiUrl(ort, null)); } catch (e) { fehler = fehler || e; }
    }
    if (!a && !b) throw fehler || new Error('keine Daten');
    if (!a) return b;
    return b ? L.ergaenze(a, b) : a;
  }

  async function aktualisieren(grund) {
    if (st.laedt) return;
    st.laedt = true;
    st.letzterVersuch = Date.now();
    $('neuBtn').classList.add('dreht');
    try {
      st.daten = await holeDaten(st.ort);
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

  /* ---------- Darstellung ---------- */
  const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const NS = 'http://www.w3.org/2000/svg';

  const GLYPHEN = {
    gruen: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    top: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    gelb: '<path d="M12 6v7"/><path d="M12 17.5v.01"/>',
    rot: '<path d="M7 7l10 10M17 7L7 17"/>',
  };
  const NAMEN = { top: 'besonders gut', gruen: 'gut', gelb: 'mäßig', rot: 'schlecht' };

  function ampel(stufe) {
    const s = document.createElement('span');
    s.className = 'amp ' + stufe;
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', NAMEN[stufe]);
    s.title = NAMEN[stufe];
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHEN[stufe] + '</svg>';
    return s;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const ganz = (v) => (v === null ? null : String(Math.round(v)).replace('-', '−'));
  function mm(v) {
    if (v === null) return null;
    if (v === 0) return '0';
    if (v < 0.1) return '<0,1';
    return v.toFixed(1).replace('.', ',');
  }

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

  function beschriftung(text, einheit, icon) {
    const th = el('th');
    th.scope = 'row';
    const w = el('span', 'lbl');
    if (icon) w.appendChild(icon);
    if (text) w.appendChild(el('span', null, text));
    if (einheit) w.appendChild(el('span', 'u', einheit));
    th.appendChild(w);
    return th;
  }

  function tagText(sp, heute) {
    const diff = sp.tag - heute;
    const d = sp.datum;
    const kurz = TAGE[sp.wochentag] + ' ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.';
    if (diff === 0) return 'Heute · ' + kurz;
    if (diff === 1) return 'Morgen · ' + kurz;
    return kurz;
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
      const th = el('th', i > 0 ? 'neuer-tag' : '', tagText(spalten[i], heute));
      th.colSpan = j - i + 1;
      th.scope = 'colgroup';
      r1.appendChild(th);
      i = j + 1;
    }
    thead.appendChild(r1);

    const r2 = el('tr', 'stunden');
    const eck = el('th');
    eck.appendChild(el('span', 'u', 'Uhr'));
    eck.firstChild.style.cssText = 'color:var(--text-leise);font-weight:500;font-size:.85rem';
    r2.appendChild(eck);
    spalten.forEach((sp, k) => {
      const th = el('th', (sp.jetzt ? 'jetzt ' : '') + (wechsel(k) ? 'neuer-tag' : ''), String(sp.stunde));
      th.scope = 'col';
      th.title = sp.stunde + '–' + ((sp.stunde + 1) % 24) + ' Uhr';
      r2.appendChild(th);
    });
    thead.appendChild(r2);
    t.appendChild(thead);

    // Zeilen; Reihenfolge: Eignung (Rennrad) zuerst, dann Sonne bis Wind
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
    const zahlZelle = (feld, fmt) => (td, sp) => {
      const s = fmt(sp[feld]);
      if (s === null) { td.textContent = '–'; td.classList.add('leer'); } else { td.textContent = s; }
    };

    const radKopf = beschriftung('', '', radSymbol());
    radKopf.title = 'Eignung fürs Rennrad';
    radKopf.firstChild.setAttribute('aria-label', 'Eignung fürs Rennrad');
    zeile(radKopf, 'eignung', (td, sp) => td.appendChild(ampel(sp.stufe)));

    zeile(beschriftung('', 'min', sonnenSymbol()), 'sonne', zahlZelle('sonneMin', ganz));
    zeile(beschriftung('Wolken', '%'), 'wolken', zahlZelle('wolken', ganz));
    zeile(beschriftung('Temp.', '°C'), 'temp', zahlZelle('temp', ganz));
    zeile(beschriftung('Regen', '%'), 'regenp', zahlZelle('regenProzent', ganz));
    zeile(beschriftung('Regen', 'mm'), 'regenmm', (td, sp) => {
      zahlZelle('regenMm', mm)(td, sp);
      if (sp.regenMm !== null && sp.regenMm > 0) td.classList.add('nass');
    });
    zeile(beschriftung('Regendauer', 'min'), 'regendauer', zahlZelle('regenDauerMin', ganz));
    zeile(beschriftung('Wind', 'km/h'), 'wind', (td, sp) => {
      const s = ganz(sp.windKmh);
      if (s === null) { td.textContent = '–'; td.classList.add('leer'); return; }
      td.textContent = s;
      if (sp.windRichtung !== null) td.appendChild(pfeil(sp.windRichtung));
    });
    t.appendChild(tb);
  }

  function fensterText(spalten) {
    const b = L.besteZeit(spalten);
    const p = $('fenster');
    if (!spalten.length) { p.hidden = true; return; }
    p.hidden = false;
    if (!b) { p.textContent = 'Kein gutes Radlfenster in den nächsten 48 Stunden.'; return; }
    const offset = (st.daten && st.daten.utc_offset_seconds) || 0;
    const heute = L.lokalerTag(Date.now() / 1000, offset);
    const von = spalten[b.von];
    const bis = spalten[b.bis];
    const diff = von.tag - heute;
    const tag = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : TAGE[von.wochentag];
    const ende = (bis.stunde + 1) % 24;
    const n = b.bis - b.von + 1;
    p.innerHTML = '';
    p.append('Bestes Radlfenster: ');
    const bold = el('b', null, tag + ' ' + von.stunde + '–' + ende + ' Uhr');
    p.appendChild(bold);
    p.append(' (' + n + (n === 1 ? ' Stunde' : ' Stunden') + ')');
  }

  const uhrzeit = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function statusText(spalten) {
    const s = $('status');
    s.classList.remove('fehler');
    if (!st.daten) {
      s.classList.add('fehler');
      s.textContent = st.laedt ? 'Lade Wetter …' : 'Keine Wetterdaten – Verbindung prüfen. Neuer Versuch läuft automatisch.';
      return;
    }
    if (st.offline) {
      s.textContent = 'Offline – gespeicherte Daten von ' + uhrzeit(st.abgerufen) + ' Uhr. Neuer Versuch läuft automatisch.';
      return;
    }
    s.textContent = 'Stand ' + uhrzeit(st.abgerufen) + ' Uhr · ' + st.ort.name +
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
      $('rahmen').hidden = !!st.daten ? false : true;
    }
    fensterText(spalten);
    statusText(spalten);
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
    aktualisieren('ort');
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
  $('neuBtn').addEventListener('click', () => aktualisieren('hand'));

  function takt() {
    const jetzt = Date.now();
    const stunde = Math.floor(jetzt / 3600000);
    if (stunde !== st.stunde) {
      st.stunde = stunde;
      zeichne();
      aktualisieren('stunde');
      return;
    }
    const wartezeit = st.fehler || st.offline || !st.daten ? 60000 : CFG.intervallMinuten * 60000;
    if (jetzt - st.letzterVersuch >= wartezeit) aktualisieren('takt');
  }
  setInterval(takt, 30000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    st.stunde = Math.floor(Date.now() / 3600000);
    zeichne();
    if (Date.now() - st.letzterVersuch > 60000) aktualisieren('tab');
    if (st.reg) sicher(() => st.reg.update());
  });
  window.addEventListener('online', () => aktualisieren('online'));

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
    aktualisieren('update');
    setTimeout(() => { b.textContent = 'Aktuell – v' + CFG.version; setTimeout(() => { b.textContent = 'Nach Update suchen'; }, 2500); }, 1200);
  });

  /* ---------- Start ---------- */
  const c0 = cacheLesen();
  if (c0 && Date.now() - c0.abgerufen <= CFG.maxAlterOfflineStunden * 3600000) {
    st.daten = c0.daten; st.abgerufen = c0.abgerufen; // sofort etwas zeigen, Abruf folgt
  }
  zeichne();
  aktualisieren('start');
})();
