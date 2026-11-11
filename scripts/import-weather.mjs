import "../server/config.mjs";
import { db } from "../server/db.mjs";

const start = process.env.WEATHER_START || "2015-01-01";
const end = process.env.WEATHER_END || "2024-12-31";
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
  throw new Error("WEATHER_START / WEATHER_END 日期无效");
}
const url = new URL("https://archive-api.open-meteo.com/v1/archive");
const options = {
  latitude: "32.0603", longitude: "118.7969", start_date: start, end_date: end,
  daily: "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum",
  timezone: "Asia/Shanghai", models: "era5"
};
for (const [k,v] of Object.entries(options)) url.searchParams.set(k,v);
console.log("Requesting verified Nanjing coordinates; ERA5 reanalysis (not station observations)");
console.log(url.toString());
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 90000);
let payload;
try {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
  payload = await response.json();
} finally { clearTimeout(timer); }
if (payload.error || !payload.daily?.time?.length) throw new Error("Historical API returned no daily rows: " + JSON.stringify(payload.reason || payload));
const daily = payload.daily;
const fields = ["time","temperature_2m_mean","temperature_2m_max","temperature_2m_min","precipitation_sum"];
if (!fields.every(f => Array.isArray(daily[f]) && daily[f].length === daily.time.length)) throw new Error("Unexpected Open-Meteo response schema");
const stmt = db.prepare("INSERT INTO weather_daily(day,year,month,temp_mean_c,temp_max_c,temp_min_c,precipitation_mm) VALUES(?,?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET year=excluded.year,month=excluded.month,temp_mean_c=excluded.temp_mean_c,temp_max_c=excluded.temp_max_c,temp_min_c=excluded.temp_min_c,precipitation_mm=excluded.precipitation_mm");
db.exec("BEGIN");
try {
  for (let i=0;i<daily.time.length;i++) {
    const day = daily.time[i];
    stmt.run(day, Number(day.slice(0,4)), Number(day.slice(5,7)), daily.temperature_2m_mean[i], daily.temperature_2m_max[i], daily.temperature_2m_min[i], daily.precipitation_sum[i]);
  }
  db.exec("COMMIT");
} catch (e) { db.exec("ROLLBACK"); throw e; }
console.log("Imported " + daily.time.length + " Nanjing ERA5 daily weather records to SQLite.");
console.log("Attribution: Weather data by Open-Meteo.com (CC BY 4.0); model: ERA5; https://open-meteo.com/");
