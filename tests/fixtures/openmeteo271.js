'use strict';
// v2.7.1 tests: an Open-Meteo-shaped answer (same fields as the fixed URL asks for), 24 hours from the hour of `now`.
// Pattern like the approved mockup: some cloud, rain + a storm in the evening, fog at night, sun in the morning.
const pad = (n) => String(n).padStart(2, '0');
// Europe/Athens wall clock, like the real answer (timezone=Europe/Athens), whatever the test machine's zone
const F = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const ath = (d) => { const o = {}; for (const p of F.formatToParts(d)) o[p.type] = p.value; return o; };
const key = (d) => { const o = ath(d); return `${o.year}-${o.month}-${o.day}T${o.hour}:00`; };
function build(now, o = {}) {
  const base = new Date(Math.floor(+new Date(now) / 3600000) * 3600000); // Athens is a whole-hour offset
  const CODES = [2, 2, 3, 3, 61, 63, 95, 63, 61, 3, 2, 0, 0, 45, 45, 45, 3, 2, 1, 0, 0, 1, 2, 3];
  const TEMPS = [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 7, 7, 8, 9, 11, 13, 14, 15, 15];
  const POPS = [0, 5, 10, 20, 45, 70, 80, 65, 40, 20, 10, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 5, 10];
  const h = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], is_day: [] };
  for (let i = 0; i < 24; i++) { const d = new Date(+base + i * 3600000); const hr = +ath(d).hour; h.time.push(key(d)); h.temperature_2m.push(TEMPS[i] + 0.2); h.weather_code.push(CODES[i]); h.precipitation_probability.push(POPS[i]); h.is_day.push(hr >= 7 && hr < 17 ? 1 : 0); }
  const cd = new Date(Math.floor(+new Date(now) / 900000) * 900000); const ca = ath(cd);
  return { latitude: 40.62, longitude: 22.44, timezone: 'Europe/Athens', current: { time: `${ca.year}-${ca.month}-${ca.day}T${ca.hour}:${ca.minute}`, interval: 900, temperature_2m: o.t ?? 15.2, weather_code: o.code ?? 2, is_day: o.day ?? (+ca.hour >= 7 && +ca.hour < 17 ? 1 : 0), wind_speed_10m: 12.1, wind_direction_10m: 315 }, hourly: h };
}
module.exports = { build };
