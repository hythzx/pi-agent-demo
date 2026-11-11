import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../server/tools.mjs";

test("all four tools have proper names and schema", () => {
  const tools=createTools();
  assert.deepEqual(tools.map(t=>t.name),["list_datasets","inspect_dataset","analyze_data","create_chart"]);
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
