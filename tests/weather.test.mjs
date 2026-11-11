import test from "node:test";
import assert from "node:assert/strict";
import { weatherQuery } from "../server/db.mjs";

test("daily 模式返回逐日原始记录", () => {
  const r = weatherQuery({ mode: "daily", metric: "temp_max_c", startDate: "2026-10-01", endDate: "2026-10-07" });
  assert.equal(r.points.length, 7);
  assert.equal(r.points[0].period, "2026-10-01");
  assert.equal(r.mode, "daily");
  assert.equal(r.unit, "°C");
});
test("daily 模式拒绝超过 400 天的区间", () => {
  assert.throws(() => weatherQuery({ mode: "daily", metric: "temp_mean_c", startDate: "2015-01-01", endDate: "2026-11-05" }), /400/);
});
test("daily 模式拒绝非法日期与 months", () => {
  assert.throws(() => weatherQuery({ mode: "daily", metric: "temp_mean_c", startDate: "2026/10/01", endDate: "2026-10-07" }), /YYYY-MM-DD/);
  assert.throws(() => weatherQuery({ mode: "daily", metric: "temp_mean_c", startDate: "2026-10-01", endDate: "2026-10-07", months: [6, 7, 8] }), /months/);
});
test("yearly 模式支持夏季月份过滤", () => {
  const summer = weatherQuery({ mode: "yearly", metric: "temp_max_c", startYear: 2023, endYear: 2024, months: [6, 7, 8], aggregation: "max" });
  assert.deepEqual(summer.points.map(p => p.period), [2023, 2024]);
  assert.ok(summer.points.every(p => p.samples > 80));
});
test("monthly 模式按月聚合并支持月份筛选", () => {
  const r = weatherQuery({ mode: "monthly", metric: "precipitation_mm", startYear: 2026, endYear: 2026, months: [10] });
  assert.equal(r.points.length, 1);
  assert.equal(r.points[0].period, "2026-10");
});
test("降水默认按 sum 聚合，气温默认按 avg", () => {
  const rain = weatherQuery({ mode: "yearly", metric: "precipitation_mm", startYear: 2024, endYear: 2024 });
  const temp = weatherQuery({ mode: "yearly", metric: "temp_mean_c", startYear: 2024, endYear: 2024 });
  assert.equal(rain.aggregation, "sum");
  assert.equal(temp.aggregation, "avg");
});
test("未知指标与坏年份被拒绝", () => {
  assert.throws(() => weatherQuery({ mode: "yearly", metric: "pm25" }), /白名单/);
  assert.throws(() => weatherQuery({ mode: "yearly", metric: "temp_mean_c", startYear: 2024, endYear: 2020 }), /年份范围/);
});
test("无记录范围抛出导入提示", () => {
  assert.throws(() => weatherQuery({ mode: "yearly", metric: "temp_mean_c", startYear: 1900, endYear: 1901 }), /import:weather/);
});
