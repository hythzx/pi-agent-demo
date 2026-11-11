import test from "node:test";
import assert from "node:assert/strict";
import { listDatasets, describeDataset, series, db } from "../server/db.mjs";

test("official Nanjing datasets are seeded and keep source metadata", () => {
  const rows = listDatasets();
  assert.equal(rows.find(x => x.id === "air_quality").count, 9);
  assert.equal(rows.find(x => x.id === "transit").count, 3);
  assert.equal(rows.find(x => x.id === "education").count, 34);
  assert.match(describeDataset("air_quality").source, /tjj\.nanjing\.gov\.cn/);
});
test("real PM2.5 records are correct and not interpolated", () => {
  const result = series({ dataset: "air_quality", metric: "pm25", startYear: 2015, endYear: 2024 });
  assert.deepEqual(result.points.map(p => Number(p.period)), [2015,2017,2018,2019,2020,2021,2022,2023,2024]);
  assert.equal(result.summary.first.value, 57);
  assert.equal(result.summary.last.value, 28);
  assert.equal(result.summary.change, -29);
});
test("public transit tracks separate bus and rail ridership", () => {
  const result = series({ dataset: "transit", metric: "rail_riders_10k", startYear: 2022, endYear: 2024 });
  assert.deepEqual(result.points.map(p => p.value), [76909,101238,109985]);
});
test("metrics and dataset are allowlisted: never arbitrary SQL", () => {
  assert.throws(() => series({ dataset: "air_quality", metric: "pm25; DROP TABLE air_quality;" }), /白名单/);
  assert.throws(() => series({ dataset: "unknown", metric: "pm25" }), /未知/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM air_quality").get().n, 9);
});
test("weather rows remain optional, rather than invented", () => {
  const weather = listDatasets().find(x => x.id === "weather_daily");
  assert.ok(weather.count >= 0);
  if (weather.count === 0) {
    assert.throws(() => series({ dataset: "weather_daily", metric: "temp_mean_c", startYear: 2015, endYear: 2024 }), /没有记录/);
  }
});
