import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../server/tools.mjs";

test("all five tools have proper names and schema", () => {
  const tools=createTools();
  assert.deepEqual(tools.map(t=>t.name),["list_datasets","inspect_dataset","analyze_data","create_chart","query_weather"]);
  assert.ok(tools.every(t=>t.parameters && typeof t.execute==="function"));
});
test("chart tool yields a chart artifact and provenance", async () => {
  const tools=createTools();
  const tool=tools.find(t=>t.name==="create_chart");
  const result=await tool.execute("test",{dataset:"education",metric:"university_10k",startYear:2019,endYear:2024});
  assert.equal(result.details.chart.points.length,6);
  assert.match(result.details.chart.source,/tjj\.nanjing\.gov\.cn/);
});
test("reject out-of-range and unsupported metrics", async () => {
  const tools=createTools();
  const tool=tools.find(t=>t.name==="analyze_data");
  await assert.rejects(()=>tool.execute("test",{dataset:"education",metric:"unsafe"}), /白名单/);
  await assert.rejects(()=>tool.execute("test",{dataset:"transit",metric:"rail_riders_10k",startYear:2025,endYear:2024}),/年份范围/);
});
test("query_weather 三种模式可用并产出图表", async () => {
  const tools=createTools();
  const tool=tools.find(t=>t.name==="query_weather");
  const daily=await tool.execute("t",{mode:"daily",metric:"temp_max_c",startDate:"2026-10-01",endDate:"2026-10-07"});
  assert.equal(JSON.parse(daily.content[0].text).count,7);
  const season=await tool.execute("t",{mode:"yearly",metric:"temp_max_c",startYear:2023,endYear:2024,months:[6,7,8],aggregation:"max",chartType:"line"});
  assert.equal(season.details.chart.chartType,"line");
  assert.equal(season.details.chart.points.length,2);
  assert.match(season.details.chart.source,/open-meteo/);
});
test("query_weather 透传校验错误", async () => {
  const tools=createTools();
  const tool=tools.find(t=>t.name==="query_weather");
  await assert.rejects(()=>tool.execute("t",{mode:"daily",metric:"temp_mean_c",startDate:"2015-01-01",endDate:"2026-11-05"}),/400/);
});
