/* Simulierte Open-Meteo-Antwort (Format wie die echte API mit timeformat=unixtime).
 * Nur für Tests – im Betrieb kommen die Daten live von Open-Meteo. */
'use strict';

const H = 3600;

/** Lokale Mitternacht (Europe/Berlin, Sommerzeit +2h) des Tages von `jetztSek`, in Unixsekunden. */
function mitternacht(jetztSek, offset) {
  return Math.floor((jetztSek + offset) / 86400) * 86400 - offset;
}

function erzeuge(jetztSek, opt = {}) {
  const offset = opt.offset ?? 7200;
  const tag0 = mitternacht(jetztSek, offset);
  const n = 72;
  const time = Array.from({ length: n }, (_, i) => tag0 + i * H);
  const m15 = Array.from({ length: n * 4 }, (_, i) => tag0 + i * 900);

  const hourly = {
    time,
    temperature_2m: [], cloud_cover: [], precipitation_probability: [], precipitation: [],
    wind_speed_10m: [], wind_direction_10m: [], sunshine_duration: [],
  };
  for (let i = 0; i < n; i++) {
    const h = i % 24;
    const tageszeit = Math.sin(((h - 9) / 24) * 2 * Math.PI);
    hourly.temperature_2m.push(+(9 + 6 * tageszeit).toFixed(1));
    hourly.cloud_cover.push(Math.round(40 + 30 * Math.sin(i / 5)));
    hourly.precipitation_probability.push(0);
    hourly.precipitation.push(0);
    hourly.wind_speed_10m.push(+(12 + 6 * Math.sin(i / 7)).toFixed(1));
    hourly.wind_direction_10m.push((200 + i * 9) % 360);
    // Sonne der vorangegangenen Stunde: tagsüber viel, nachts 0
    hourly.sunshine_duration.push(h >= 8 && h <= 18 ? 3600 : 0);
  }
  const minutely_15 = { time: m15, precipitation: m15.map(() => 0) };

  const sunrise = [];
  const sunset = [];
  for (let d = 0; d < 3; d++) {
    sunrise.push(tag0 + d * 86400 + 7 * H + 38 * 60 + d * 120);
    sunset.push(tag0 + d * 86400 + 18 * H + 19 * 60 - d * 120);
  }

  const daten = {
    latitude: 48.47, longitude: 11.94, utc_offset_seconds: offset, timezone: 'Europe/Berlin',
    hourly, minutely_15, daily: { time: [tag0, tag0 + 86400, tag0 + 2 * 86400], sunrise, sunset },
  };
  return { daten, tag0, offset };
}

/** Setzt einen Wert über die lokale Stunde des Tages `tag` (0 = heute) – Zeitstempel selbst. */
function idxStunde(sim, tag, stunde) { return tag * 24 + stunde; }

module.exports = { erzeuge, idxStunde, H };
