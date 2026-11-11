import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../server/tools.mjs";
import { createDataAgent, planFirstHook } from "../server/agent.mjs";

const PLAN = {
  requirement: { goal: "分析南京PM2.5变化", dataset: "air_quality", metric: "pm25", timeRange: "2015-2024", caveats: ["2016年在该表中没有公布"] },
  steps: [
    { id: 1, action: "检查数据结构", tool: "inspect_dataset" },
    { id: 2, action: "统计查询", tool: "analyze_data" }
  ]
};
function planTools() {
  const planning = { submitted: false, plan: null };
  const tools = createTools(planning);
  return { planning, submit: tools.find(t=>t.name==="submit_plan"), update: tools.find(t=>t.name==="update_plan") };
}
test("submit_plan 置位并返回 pending 计划", async () => {
  const { planning, submit } = planTools();
  const r = await submit.execute("t", PLAN);
  assert.equal(planning.submitted, true);
  assert.equal(r.details.plan.steps[0].status, "pending");
  assert.equal(planning.plan.steps.length, 2);
});
test("update_plan 更新状态且未知 id 被忽略", async () => {
  const { planning, submit, update } = planTools();
  await submit.execute("t", PLAN);
  await update.execute("t", { updates: [{ id: 1, status: "completed" }, { id: 9, status: "completed" }] });
  assert.equal(planning.plan.steps[0].status, "completed");
  assert.equal(planning.plan.steps[1].status, "pending");
});
test("update_plan 的 revisedSteps 整体替换并重置状态", async () => {
  const { planning, submit, update } = planTools();
  await submit.execute("t", PLAN);
  await update.execute("t", { updates: [{ id: 1, status: "completed" }] });
  await update.execute("t", { updates: [{ id: 1, status: "completed" }], revisedSteps: [{ id: 1, action: "改查天气数据" }] });
  assert.equal(planning.plan.steps.length, 1);
  assert.equal(planning.plan.steps[0].status, "pending");
});
test("update_plan 无计划时返回错误文本而不抛异常", async () => {
  const { update } = planTools();
  const r = await update.execute("t", { updates: [{ id: 1, status: "completed" }] });
  assert.match(r.content[0].text, /submit_plan/);
});
test("createTools 无参时规划工具不落状态", async () => {
  const tools = createTools();
  const submit = tools.find(t=>t.name==="submit_plan");
  const r = await submit.execute("t", PLAN);
  assert.ok(r.details.plan.steps.length === 2);
});
test("planFirstHook 拦截未提交时的数据工具", async () => {
  const planning = { submitted: false, plan: null };
  const hook = planFirstHook(planning);
  const blocked = await hook({ toolCall: { name: "analyze_data" } });
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /submit_plan/);
  assert.equal(await hook({ toolCall: { name: "submit_plan" } }), undefined);
  assert.equal(await hook({ toolCall: { name: "update_plan" } }), undefined);
});
test("planFirstHook 在提交后放行", async () => {
  const hook = planFirstHook({ submitted: true, plan: { steps: [] } });
  assert.equal(await hook({ toolCall: { name: "analyze_data" } }), undefined);
});
test("createDataAgent 返回 agent 与 planning", () => {
  const created = createDataAgent("test-session-0001");
  assert.equal(typeof created.agent.prompt, "function");
  assert.deepEqual(created.planning, { submitted: false, plan: null });
});
