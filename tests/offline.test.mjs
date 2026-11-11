import test from "node:test";
import assert from "node:assert/strict";
import { buildOfflinePlan, runOffline } from "../server/offline.mjs";

test("buildOfflinePlan 按问题路由数据集并产出计划", () => {
  const { selected, plan } = buildOfflinePlan("南京地铁客运量有什么变化？");
  assert.equal(selected.dataset, "transit");
  assert.equal(plan.steps.length, 4);
  assert.ok(plan.steps.every(s => s.status === "pending"));
  assert.equal(plan.requirement.goal, "南京地铁客运量有什么变化？");
});
test("runOffline 先发 plan 事件，工具完成时步骤打勾", async () => {
  const events = [];
  await runOffline("南京2015年至2024年PM2.5改善了多少？", e => events.push(e));
  assert.equal(events[0].type, "plan");
  assert.equal(events[0].plan.steps[0].status, "pending");
  const lastPlan = events.filter(e => e.type === "plan").at(-1).plan;
  assert.ok(lastPlan.steps.every(s => s.status === "completed"));
  assert.ok(events.some(e => e.type === "chart"));
  assert.ok(events.some(e => e.type === "delta"));
});
