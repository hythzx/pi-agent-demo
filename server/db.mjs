import "./config.mjs";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";

mkdirSync(resolve(config.dataDir), { recursive: true });
export const db = new DatabaseSync(join(resolve(config.dataDir), "nanjing.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE IF NOT EXISTS air_quality (year INTEGER PRIMARY KEY, pm25 REAL, good_days_pct REAL)");
db.exec("CREATE TABLE IF NOT EXISTS transit (year INTEGER PRIMARY KEY, bus_riders_10k REAL, rail_riders_10k REAL, bus_route_km REAL, rail_route_km REAL)");
db.exec("CREATE TABLE IF NOT EXISTS education (year INTEGER PRIMARY KEY, university_10k REAL, middle_10k REAL, primary_10k REAL)");
db.exec("CREATE TABLE IF NOT EXISTS weather_daily (day TEXT PRIMARY KEY, year INTEGER, month INTEGER, temp_mean_c REAL, temp_max_c REAL, temp_min_c REAL, precipitation_mm REAL)");
db.exec("CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
db.exec("CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id, id)");

const air = [
  [2015,57,64.4],[2017,40,72.3],[2018,43,68.8],[2019,40,70.1],
  [2020,31,83.1],[2021,29,82.2],[2022,28,79.7],[2023,29,81.9],[2024,28,85.8]
];
const transit = [
  [2022,47853,76909,13010,466],
  [2023,50798,101238,13250,476],
  [2024,51474,109985,13320,500]
];
const education = [
  [1949,.35,1.82,12.06],[1952,.84,3.68,23.34],[1957,2.35,6.98,31.46],
  [1962,3.52,8.92,35.63],[1965,2.98,11.29,48],[1970,2.43,18.26,54.10],
  [1975,1.87,25.23,60.19],[1978,2.72,23.14,39.17],[1979,3.51,21.80,39.84],
  [1980,4.02,27.41,50.50],[1985,6.04,23.86,41.85],[1990,7.51,23.01,42.08],
  [1995,10.37,23.57,41.72],[1997,12.05,22.04,46.75],[1998,13.24,21.80,48.11],
  [1999,16.28,22.29,47.88],[2000,21.69,25.38,45.41],[2005,56.11,32.26,30.51],
  [2008,72.50,27.27,28.56],[2009,77.34,26.11,28.32],[2010,79.34,24.86,28.83],
  [2012,81.53,23.07,30.71],[2013,80.74,22.43,32.14],[2014,80.53,22.28,33.93],
  [2015,81.26,21.99,35.80],[2016,82.78,22.45,37.54],[2017,84.08,23.42,39.31],
  [2018,85.17,24.52,42.21],[2019,87.78,26.06,44.66],[2020,91.81,27.55,47.10],
  [2021,93.53,28.85,50.01],[2022,97.27,30.25,52.93],[2023,100.76,31.69,56.57],
  [2024,105.43,34.39,57.59]
];
const insertAir = db.prepare("INSERT OR IGNORE INTO air_quality VALUES (?, ?, ?)");
const insertTransit = db.prepare("INSERT OR IGNORE INTO transit VALUES (?, ?, ?, ?, ?)");
const insertEducation = db.prepare("INSERT OR IGNORE INTO education VALUES (?, ?, ?, ?)");
db.exec("BEGIN");
try {
  for (const row of air) insertAir.run(...row);
  for (const row of transit) insertTransit.run(...row);
  for (const row of education) insertEducation.run(...row);
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); throw error; }

export const CATALOG = Object.freeze({
  air_quality: {
    title: "南京 · 城市空气质量", description: "南京统计年鉴 2025 · 表16-6，2015年起部分年份",
    table: "air_quality", dateColumn: "year",
    source: "https://tjj.nanjing.gov.cn/material/njnj_2025/chengxiangjianshe/16-6.html",
    caveat: "2015年前后统计标准变化，不宜跨口径比较。2016年在该表中没有公布。",
    metrics: {
      pm25: { label: "PM2.5 年均浓度", unit: "μg/m³" },
      good_days_pct: { label: "优良天数比例", unit: "%" }
    }
  },
  transit: {
    title: "南京 · 城市公共交通", description: "南京统计年鉴 2025 · 表8-8",
    table: "transit", dateColumn: "year",
    source: "https://tjj.nanjing.gov.cn/material/njnj_2025/jiaotongyunshu/8-8.html",
    caveat: "仅2022—2024三年，不支持长期趋势推断；标准运营车数2024年有口径变化，此处未使用该指标。",
    metrics: {
      bus_riders_10k: { label: "公交客运量", unit: "万人次" },
      rail_riders_10k: { label: "轨道交通客运量", unit: "万人次" },
      bus_route_km: { label: "公交运营线路长度", unit: "公里" },
      rail_route_km: { label: "轨道交通线路长度", unit: "公里" }
    }
  },
  education: {
    title: "南京 · 在校学生人数", description: "南京统计年鉴 2025 · 表13-9，部分年份",
    table: "education", dateColumn: "year",
    source: "https://tjj.nanjing.gov.cn/material/njnj_2025/keji/13-9.html",
    caveat: "仅主要年份，不能当作完整逐年序列；高校人数含普通高校、科研院所所有在学研究生。",
    metrics: {
      university_10k: { label: "普通高等学校在校学生数", unit: "万人" },
      middle_10k: { label: "普通中学在校学生数", unit: "万人" },
      primary_10k: { label: "小学在校学生数", unit: "万人" }
    }
  },
  weather_daily: {
    title: "南京 · 历史天气（可选导入）", description: "Open-Meteo ERA5 再分析网格数据，默认2015—2024",
    table: "weather_daily", dateColumn: "day",
    source: "https://open-meteo.com/en/docs/historical-weather-api",
    caveat: "非南京气象站实测记录，是附近网格的气象再分析估计。运行 npm run import:weather 后可用，需注明 Open-Meteo CC BY 4.0 署名。",
    metrics: {
      temp_mean_c: { label: "日平均气温", unit: "°C" },
      temp_max_c: { label: "日最高气温", unit: "°C" },
      temp_min_c: { label: "日最低气温", unit: "°C" },
      precipitation_mm: { label: "日降水量", unit: "mm" }
    }
  }
});

export function getDataset(id) {
  const item = CATALOG[id];
  if (!item) throw new Error("未知数据集：" + String(id));
  return item;
}
export function listDatasets() {
  return Object.entries(CATALOG).map(([id, item]) => ({
    id, title: item.title, description: item.description, source: item.source, caveat: item.caveat,
    metrics: item.metrics, count: db.prepare("SELECT COUNT(*) AS n FROM " + item.table).get().n
  }));
}
export function describeDataset(id) {
  const item = getDataset(id);
  const count = db.prepare("SELECT COUNT(*) AS n FROM " + item.table).get().n;
  const range = db.prepare("SELECT MIN(" + item.dateColumn + ") AS first, MAX(" + item.dateColumn + ") AS last FROM " + item.table).get();
  const preview = db.prepare("SELECT * FROM " + item.table + " ORDER BY " + item.dateColumn + " DESC LIMIT 5").all();
  return { id, ...item, count, range, preview };
}
export function series({ dataset, metric, startYear = 1949, endYear = 2025, groupBy = "year", aggregation = "avg" }) {
  const meta = getDataset(dataset);
  if (!Object.hasOwn(meta.metrics, metric)) throw new Error("指标不在白名单内：" + String(metric));
  if (!["avg", "sum", "max", "min"].includes(aggregation)) throw new Error("不支持的聚合方式");
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear || startYear < 1900 || endYear > 2100) {
    throw new Error("年份范围无效");
  }
  if (!["year", "month"].includes(groupBy)) throw new Error("分组粒度无效");
  if (groupBy === "month" && dataset !== "weather_daily") throw new Error("只有日度天气支持按月分析");
  const expr = dataset === "weather_daily" && groupBy === "month" ? "substr(day, 1, 7)" : "year";
  const agg = aggregation.toUpperCase();
  const sql = "SELECT " + expr + " AS period, ROUND(" + agg + "(" + metric + "), 2) AS value, COUNT(" + metric + ") AS samples FROM " + meta.table +
    " WHERE year BETWEEN ? AND ? AND " + metric + " IS NOT NULL GROUP BY " + expr + " ORDER BY " + expr + " LIMIT 2000";
  const points = db.prepare(sql).all(startYear, endYear);
  if (points.length === 0) throw new Error("该数据集在选定时间范围内没有记录；可能尚未导入天气数据");
  const values = points.map(p => p.value).filter(Number.isFinite);
  const total = values.reduce((sum, v) => sum + v, 0);
  const lowest = points.reduce((a, b) => a.value <= b.value ? a : b);
  const highest = points.reduce((a, b) => a.value >= b.value ? a : b);
  const first = points[0], last = points[points.length - 1];
  return {
    dataset, datasetTitle: meta.title, metric, metricTitle: meta.metrics[metric].label,
    unit: meta.metrics[metric].unit, groupBy, aggregation,
    source: meta.source, caveat: meta.caveat,
    points, summary: { count: points.length, meanOfGroups: +(total / values.length).toFixed(2),
      lowest, highest, first, last, change: +(last.value - first.value).toFixed(2),
      changePct: first.value === 0 ? null : +((last.value - first.value) / Math.abs(first.value) * 100).toFixed(2) }
  };
}
export function saveMessage(sessionId, role, content) {
  db.prepare("INSERT INTO conversations(session_id, role, content) VALUES(?,?,?)").run(sessionId, role, content.slice(0,20000));
}
export function getHistory(sessionId) {
  return db.prepare("SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT 30")
    .all(sessionId).reverse();
}
