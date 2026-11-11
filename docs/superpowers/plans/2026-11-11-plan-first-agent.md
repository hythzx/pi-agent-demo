# 规划优先的南京数据调查智能体 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有 Pi Agent 增加"先规划再执行"能力（submit_plan/update_plan 工具 + beforeToolCall 硬约束 + Web 计划卡片）、新增 query_weather 天气工具（逐日/季节/月聚合）、接入 MiniMax（minimax-cn provider）切换真实 LLM 模式。

**Architecture:** 单 Pi Agent 不变，扩展 7 个工具；规划状态 `planning = { submitted, plan }` 由 `createTools(planning)` 闭包持有、`createDataAgent` 返回、`main.mjs` 每问重置；SSE 新增 `plan` 事件（完整计划）；离线脚本同步输出计划卡。设计文档：`docs/superpowers/specs/2026-11-11-plan-first-agent-design.md`。

**Tech Stack:** Node.js ≥24（node:sqlite、node:test）、@earendil-works/pi-agent-core 1.5.2、@earendil-works/pi-ai 1.5.2（providers/minimax-cn）、原生 ESM。

## Global Constraints

- Node ≥24，禁止新增 npm 依赖（package.json dependencies 不变）。
- SQL 只拼白名单片段（表名/列名来自代码内常量），所有值走参数绑定。
- 所有用户可见文案为简体中文；代码注释用书面中文，不复述代码。
- 遵循现有代码风格：server/*.mjs 双引号常规排版；web/*.js 紧凑单行风格；测试文件 `test(...) => { ... }` 双空格缩进紧凑风格。
- 数据纪律（进入提示词/答案文案）：缺年份不插值不当 0；交通仅 2022—2024；2016 无 PM2.5；2026 年不完整（ERA5 发布延迟）；weather_daily 是 ERA5 网格再分析非站点实测。
- 提交信息用 conventional commits（feat/test/docs/chore），只提交本任务文件（用户工作区有无关未提交改动，严禁 `git add -A`）。

---

### Task 1: db.mjs 新增 weatherQuery()

**Files:**
- Modify: `server/db.mjs`（`series()` 之后追加）
- Test: `tests/weather.test.mjs`（新建）

**Interfaces:**
- Consumes: `CATALOG.weather_daily`（现有）、`db`（现有）
- Produces: `weatherQuery({ mode, metric, startDate?, endDate?, startYear? = 1949, endYear? = 当前年, months?, aggregation? })` → `{ dataset, datasetTitle, mode, metric, metricTitle, unit, aggregation, source, caveat, points: [{period, value, samples}], summary: { count, meanOfGroups, lowest, highest, first, last, change, changePct } }`；非法参数 throw Error（中文消息）。Task 2 依赖此签名。

- [ ] **Step 1: 写失败测试**

创建 `tests/weather.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/weather.test.mjs`
Expected: 全部 FAIL，报 `weatherQuery` 未导出（SyntaxError: The requested module does not provide an export named 'weatherQuery'）。

- [ ] **Step 3: 实现 weatherQuery**

在 `server/db.mjs` 的 `series()` 函数之后追加（`saveMessage` 之前）：

```js
// 天气专用查询：daily 逐日原始记录（≤400 天）、monthly 按月聚合、yearly 按年聚合。
// months 仅用于 monthly/yearly：yearly 限定聚合窗口（季节过滤），monthly 筛选保留的月份。
export function weatherQuery({ mode, metric, startDate, endDate, startYear = 1949, endYear = new Date().getFullYear(), months, aggregation }) {
  if (!Object.hasOwn(CATALOG.weather_daily.metrics, metric)) throw new Error("指标不在白名单内：" + String(metric));
  if (!["daily", "monthly", "yearly"].includes(mode)) throw new Error("模式无效：" + String(mode));
  if (months !== undefined && mode === "daily") throw new Error("daily 模式不支持 months 过滤");
  const agg = (aggregation ?? (metric === "precipitation_mm" ? "sum" : "avg")).toUpperCase();
  if (!["AVG", "SUM", "MAX", "MIN"].includes(agg)) throw new Error("不支持的聚合方式");
  let where = "WHERE " + metric + " IS NOT NULL";
  const params = [];
  if (mode === "daily") {
    const dateRe = /^(\d{4})-(\d{2})-(\d{2})$/;
    const start = dateRe.exec(String(startDate || "")), end = dateRe.exec(String(endDate || ""));
    if (!start || !end) throw new Error("daily 模式需要 YYYY-MM-DD 格式的 startDate/endDate");
    const span = (Date.UTC(+end[1], +end[2] - 1, +end[3]) - Date.UTC(+start[1], +start[2] - 1, +start[3])) / 86400000;
    if (span < 0) throw new Error("日期范围无效：startDate 晚于 endDate");
    if (span > 400) throw new Error("日期区间超过 400 天；请改用 monthly 或 yearly 聚合");
    where += " AND day BETWEEN ? AND ?";
    params.push(startDate, endDate);
  } else {
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear || startYear < 1900 || endYear > 2100) throw new Error("年份范围无效");
    where += " AND year BETWEEN ? AND ?";
    params.push(startYear, endYear);
    if (months !== undefined) {
      if (!Array.isArray(months) || months.length === 0 || months.some(m => !Number.isInteger(m) || m < 1 || m > 12)) throw new Error("months 必须为 1—12 的整数数组");
      where += " AND month IN (" + months.map(() => "?").join(",") + ")";
      params.push(...months);
    }
  }
  const expr = mode === "daily" ? "day" : mode === "monthly" ? "substr(day, 1, 7)" : "year";
  const points = db.prepare("SELECT " + expr + " AS period, ROUND(" + agg + "(" + metric + "), 2) AS value, COUNT(" + metric + ") AS samples FROM weather_daily " + where + " GROUP BY " + expr + " ORDER BY " + expr).all(...params);
  if (points.length === 0) throw new Error("该时间范围内没有天气记录；可能尚未运行 npm run import:weather");
  const values = points.map(p => p.value).filter(Number.isFinite);
  const total = values.reduce((sum, v) => sum + v, 0);
  const lowest = points.reduce((a, b) => a.value <= b.value ? a : b);
  const highest = points.reduce((a, b) => a.value >= b.value ? a : b);
  const first = points[0], last = points[points.length - 1];
  return {
    dataset: "weather_daily", datasetTitle: CATALOG.weather_daily.title, mode, metric,
    metricTitle: CATALOG.weather_daily.metrics[metric].label,
    unit: CATALOG.weather_daily.metrics[metric].unit,
    aggregation: agg.toLowerCase(),
    source: CATALOG.weather_daily.source,
    caveat: CATALOG.weather_daily.caveat + " 涉及 2026 年时注意：该年度数据不完整（ERA5 有发布延迟），不能与完整年度直接比较。",
    points, summary: { count: points.length, meanOfGroups: +(total / values.length).toFixed(2),
      lowest, highest, first, last, change: +(last.value - first.value).toFixed(2),
      changePct: first.value === 0 ? null : +((last.value - first.value) / Math.abs(first.value) * 100).toFixed(2) }
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/weather.test.mjs`
Expected: 8 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/db.mjs tests/weather.test.mjs
git commit -m "feat(db): add weatherQuery with daily/monthly/yearly modes and season filter"
```

---

### Task 2: tools.mjs 新增 query_weather 工具

**Files:**
- Modify: `server/tools.mjs`
- Test: `tests/tools.test.mjs`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `weatherQuery`
- Produces: 工具 `query_weather`（parameters：mode/metric/startDate/endDate/startYear/endYear/months/aggregation/chartType）；`chartType` 提供时 `result.details.chart` 形状为 `{ ...weatherQuery结果, chartType }`（含 datasetTitle/metricTitle/points/summary/unit/source/caveat，供现有 chartNode 渲染）。Task 3 的工具名清单断言依赖顺序：query_weather 在 create_chart 之后。

- [ ] **Step 1: 写失败测试**

在 `tests/tools.test.mjs` 追加：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/tools.test.mjs`
Expected: 新用例 FAIL（`t.name==="query_weather"` 为 undefined，`Cannot read properties of undefined`）。

- [ ] **Step 3: 实现**

`server/tools.mjs` 修改三处：

① 顶部 import 增加 `weatherQuery`：

```js
import { CATALOG, listDatasets, describeDataset, series, weatherQuery } from "./db.mjs";
```

② `create_chart` 工具对象之后、`createTools` 数组结束前，插入 `query_weather`（保持数组内顺序：list_datasets → inspect_dataset → analyze_data → create_chart → query_weather）：

```js
    {
      name: "query_weather", label: "查询历史天气",
      description: "查询本地 SQLite 的南京 ERA5 历史天气：daily 逐日原始记录（单次不超过400天）、monthly 按月聚合、yearly 按年聚合；monthly/yearly 可用 months 做季节过滤（如[6,7,8]查夏季）。需要让用户看到天气图表时提供 chartType。",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["daily", "monthly", "yearly"], description: "daily逐日记录/monthly按月聚合/yearly按年聚合" },
          metric: { type: "string", enum: Object.keys(CATALOG.weather_daily.metrics), description: "天气指标键" },
          startDate: { type: "string", description: "daily 必填，YYYY-MM-DD" },
          endDate: { type: "string", description: "daily 必填，YYYY-MM-DD" },
          startYear: years.startYear,
          endYear: years.endYear,
          months: { type: "array", items: { type: "integer", minimum: 1, maximum: 12 }, maxItems: 12, uniqueItems: true, description: "季节过滤月份，仅 monthly/yearly 有效" },
          aggregation: years.aggregation,
          chartType: { type: "string", enum: ["line", "bar"], description: "提供时随结果返回可渲染图表" }
        },
        required: ["mode", "metric"], additionalProperties: false
      },
      execute: async (_id, params) => {
        const data = weatherQuery(params);
        const text = { mode: data.mode, metric: data.metricTitle, count: data.summary.count,
          first: data.summary.first, last: data.summary.last, change: data.summary.change,
          unit: data.unit, source: data.source, caveat: data.caveat };
        if (params.chartType) return textResult(text, { chart: { ...data, chartType: params.chartType } });
        return textResult(text);
      }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/tools.test.mjs tests/weather.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/tools.mjs tests/tools.test.mjs
git commit -m "feat(tools): add query_weather tool with daily/monthly/yearly modes"
```

---

### Task 3: tools.mjs 新增 submit_plan / update_plan 与 createTools(planning)

**Files:**
- Modify: `server/tools.mjs`
- Modify: `tests/tools.test.mjs:5-9`（工具名清单断言）
- Test: `tests/planning.test.mjs`（新建）

**Interfaces:**
- Consumes: 无新依赖
- Produces: ① `createTools(planning)` 可选参数 `planning = { submitted: boolean, plan: object|null }`（缺省 null 时规划工具不落状态，离线路径兼容）；② 工具 `submit_plan`：执行后 `planning.submitted=true`、`planning.plan={requirement, steps}`（步骤 status 全部 "pending"），返回 `details.plan`；③ 工具 `update_plan`：无计划返回错误文本（不抛异常），有计划合并 updates（未知 id 忽略）、revisedSteps 整体替换（状态重置 pending），返回 `details.plan`。Task 4/6 依赖 `{ submitted, plan }` 字段名与 `details.plan`。

- [ ] **Step 1: 更新工具清单断言并写失败测试**

`tests/tools.test.mjs` 第一个测试改为：

```js
test("all seven tools have proper names and schema", () => {
  const tools=createTools();
  assert.deepEqual(tools.map(t=>t.name),["list_datasets","inspect_dataset","analyze_data","create_chart","query_weather","submit_plan","update_plan"]);
  assert.ok(tools.every(t=>t.parameters && typeof t.execute==="function"));
});
```

新建 `tests/planning.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createTools } from "../server/tools.mjs";

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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/tools.test.mjs tests/planning.test.mjs`
Expected: FAIL（工具清单不含 query_weather/submit_plan/update_plan；planning.test 报 `t.name==="submit_plan"` 为 undefined）。

- [ ] **Step 3: 实现**

`server/tools.mjs`：`createTools()` 改为 `createTools(planning = null)`；在 `query_weather` 之后追加两个工具；数组顺序变为：list_datasets → inspect_dataset → analyze_data → create_chart → query_weather → submit_plan → update_plan。

在 `createTools` 函数体之前（模块顶层、`compute` 之后）加入：

```js
const stepSchema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 1, maximum: 8 },
    action: { type: "string" },
    tool: { type: "string", description: "预计使用的工具名" }
  },
  required: ["id", "action"],
  additionalProperties: false
};
// 计划步骤统一以 pending 初始化；提交与修订共用同一形状。
function planWithStatuses(steps) {
  return steps.map(s => ({ id: s.id, action: s.action, tool: s.tool, status: "pending" }));
}
```

函数签名改为 `export function createTools(planning = null) {`，数组追加：

```js
    {
      name: "submit_plan", label: "提交调查计划",
      description: "提交本次调查的需求分析与步骤清单；提交后才能使用数据工具。每个新问题都必须先提交计划。",
      parameters: {
        type: "object",
        properties: {
          requirement: {
            type: "object",
            properties: {
              goal: { type: "string", description: "一句话调查目标" },
              dataset: { type: "string", description: "数据集 ID，未确定填 unknown" },
              metric: { type: "string", description: "指标键，未确定填 unknown" },
              timeRange: { type: "string", description: "时间范围及口径说明" },
              caveats: { type: "array", items: { type: "string" }, description: "口径注意事项，如缺失年份、统计口径变化" }
            },
            required: ["goal"], additionalProperties: false
          },
          steps: { type: "array", minItems: 1, maxItems: 8, items: stepSchema }
        },
        required: ["requirement", "steps"], additionalProperties: false
      },
      execute: async (_id, params) => {
        const plan = { requirement: params.requirement, steps: planWithStatuses(params.steps) };
        if (planning) { planning.submitted = true; planning.plan = plan; }
        return textResult(plan, { plan });
      }
    },
    {
      name: "update_plan", label: "更新调查计划",
      description: "更新计划步骤状态（pending/in_progress/completed）；情况变化时提供 revisedSteps 整体修订计划。",
      parameters: {
        type: "object",
        properties: {
          updates: {
            type: "array", minItems: 1,
            items: {
              type: "object",
              properties: {
                id: { type: "integer", minimum: 1, maximum: 8 },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] }
              },
              required: ["id", "status"], additionalProperties: false
            }
          },
          revisedSteps: { type: "array", minItems: 1, maxItems: 8, items: stepSchema, description: "整体修订时提供，替换现有步骤" }
        },
        required: ["updates"], additionalProperties: false
      },
      execute: async (_id, params) => {
        if (!planning?.plan) return textResult({ error: "尚未提交计划；请先调用 submit_plan。" });
        if (params.revisedSteps) planning.plan = { ...planning.plan, steps: planWithStatuses(params.revisedSteps) };
        const known = new Set(planning.plan.steps.map(s => s.id));
        for (const u of params.updates) {
          if (!known.has(u.id)) continue;
          const step = planning.plan.steps.find(s => s.id === u.id);
          step.status = u.status;
        }
        return textResult(planning.plan, { plan: planning.plan });
      }
    }
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/tools.test.mjs tests/planning.test.mjs tests/weather.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/tools.mjs tests/tools.test.mjs tests/planning.test.mjs
git commit -m "feat(tools): add submit_plan/update_plan with shared planning state"
```

---

### Task 4: agent.mjs — planFirstHook、MiniMax provider、规划优先提示词

**Files:**
- Modify: `server/agent.mjs`（全文重写，文件仅 35 行）
- Test: `tests/planning.test.mjs`（追加钩子用例）

**Interfaces:**
- Consumes: Task 3 的 `createTools(planning)`、`planning = { submitted, plan }` 字段约定
- Produces: ① 导出 `planFirstHook(planning)` → 返回 async (context) => 未提交且 `context.toolCall.name !== "submit_plan"` 时 `{ block: true, reason: "尚未提交调查计划。请先调用 submit_plan 提交需求分析与步骤清单，再使用数据工具。" }`，否则 undefined；② `createDataAgent(sessionId)` 返回值由 `Agent` 实例改为 `{ agent, planning }`（**main.mjs 调用方在 Task 6 同步修改**，本任务完成后 main.mjs 处于短暂不兼容状态，两个任务连续执行）；③ provider 分支支持 `minimax-cn`。

- [ ] **Step 1: 写失败测试**

`tests/planning.test.mjs` 顶部 import 增加 `planFirstHook`，文件末尾追加：

```js
import { planFirstHook } from "../server/agent.mjs";
```

（放在文件顶部既有 import 之后；以下用例追加到文件末尾）

```js
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
```

同时把顶部 import 行改为（一行同时导入两个名字）：

```js
import { createDataAgent, planFirstHook } from "../server/agent.mjs";
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/planning.test.mjs`
Expected: 新用例 FAIL（`planFirstHook` 未导出；`createDataAgent` 返回的 Agent 实例无 `.planning`）。

- [ ] **Step 3: 重写 server/agent.mjs**

```js
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { config } from "./config.mjs";
import { createTools } from "./tools.mjs";

const SYSTEM_PROMPT = [
  "你是 Nanjing Data Lab 的南京城市数据调查智能体，不是通用闲聊助手。",
  "工作流程（每个新问题都要完整走一遍）：",
  "1. 需求分析：从问题中识别指标、时间范围与数据口径风险；不确定时先用 list_datasets、inspect_dataset 查证。",
  "2. 调用 submit_plan 提交调查计划（需求分析 + 步骤清单），提交前不得使用任何数据工具。",
  "3. 按计划逐步执行：开始某步骤前用 update_plan 把它标记为 in_progress，完成后标记为 completed。",
  "4. 情况变化时可调用 update_plan 并提供 revisedSteps 整体修订计划，并说明修订原因。",
  "5. 全部步骤完成后给出带数字依据、简洁自然的中文结论，涉及数据时附官方来源链接。",
  "天气类问题（逐日记录、季节对比、月度变化）优先使用 query_weather；逐日查询单次不超过 400 天。",
  "所有涉及南京统计数字的事实必须来自工具的 SQLite 查询结果。需要图表就调用 create_chart 或为 query_weather 提供 chartType；你不能声称已生成图表而不调用工具。",
  "严格尊重数据单位、时间范围、样本量和统计口径。缺年份不插值、不当成0；交通数据只有2022—2024三年；2026年为不完整年度，不能与完整年度直接比较。",
  "不要把空气污染趋势当作天气气温趋势；weather_daily 是 ERA5 网格再分析估计，非气象站实测。",
  "比较首尾变化时说明数据覆盖范围，相关性不等于因果关系；数据不足则明确说不能下结论。",
  "不要执行任意SQL、Shell、Python，也不能声称访问了互联网以外的新数据。"
].join("\n");

// 规划硬约束：计划未提交前拦截除 submit_plan 外的所有工具调用。
// 拦截原因会作为错误工具结果回给模型，模型据此先提交计划。
export function planFirstHook(planning) {
  return async (context) => {
    if (!planning.submitted && context.toolCall.name !== "submit_plan") {
      return { block: true, reason: "尚未提交调查计划。请先调用 submit_plan 提交需求分析与步骤清单，再使用数据工具。" };
    }
  };
}

export function createDataAgent(sessionId) {
  const models = createModels();
  if (config.provider === "anthropic") models.setProvider(anthropicProvider());
  else if (config.provider === "minimax-cn") models.setProvider(minimaxCnProvider());
  else models.setProvider(openaiProvider());
  const model = models.getModel(config.provider, config.model);
  if (!model) {
    throw new Error("模型不在当前 Pi 模型目录中：" + config.provider + "/" + config.model + "；请检查 PI_MODEL。");
  }
  const planning = { submitted: false, plan: null };
  const agent = new Agent({
    sessionId,
    initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: createTools(planning), thinkingLevel: "off" },
    streamFn: models.streamSimple.bind(models),
    toolExecution: "sequential",
    beforeToolCall: planFirstHook(planning),
    identity: { attribution: { name: "Nanjing Data Lab", url: "https://github.com/hythzx/pi-agent-demo" } }
  });
  return { agent, planning };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/planning.test.mjs`
Expected: 全部 PASS（含既有 planning 用例）。

注意：此时 `server/main.mjs` 尚按旧返回值使用 `createDataAgent`（`state.agent=createDataAgent(sessionId)` 会把 `{agent, planning}` 对象当 Agent 存），这是 Task 4→6 之间的已知中间态，live 模式暂不可用；Task 6 修复。离线模式不受影响（不经过 createDataAgent），`npm test` 全绿即可提交。

- [ ] **Step 5: 全量回归并提交**

Run: `npm test`
Expected: 全部 PASS。

```bash
git add server/agent.mjs tests/planning.test.mjs
git commit -m "feat(agent): plan-first hook, MiniMax provider branch, planning workflow prompt"
```

---

### Task 5: config.mjs 支持 minimax-cn + .env.example

**Files:**
- Modify: `server/config.mjs`
- Modify: `.env.example`

**Interfaces:**
- Consumes: 环境变量 `PI_PROVIDER`、`PI_MODEL`、`MINIMAX_CN_API_KEY`
- Produces: `config.provider` 支持 `"minimax-cn"`；provider 为 minimax-cn 时 `config.model` 默认 `"MiniMax-M2.7"`；`config.live` 在 minimax-cn 下由 `MINIMAX_CN_API_KEY` 决定。Task 8 的 `/api/status` 验证依赖此行为。配置与 env 强耦合，不做单元测试，由 Task 8 手工验证。

- [ ] **Step 1: 修改 server/config.mjs**

```js
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (existsSync(".env")) loadEnvFile(".env");
const provider = process.env.PI_PROVIDER || "openai";
const defaultModels = { "minimax-cn": "MiniMax-M2.7" };
export const config = {
  port: Number(process.env.PORT || 3000),
  provider,
  model: process.env.PI_MODEL || defaultModels[provider] || "gpt-4.1-mini",
  dataDir: process.env.DATA_DIR || "./data",
  live: provider === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : provider === "minimax-cn"
      ? Boolean(process.env.MINIMAX_CN_API_KEY)
      : Boolean(process.env.OPENAI_API_KEY),
};
```

- [ ] **Step 2: 更新 .env.example**

```
PORT=3000
PI_PROVIDER=minimax-cn
PI_MODEL=MiniMax-M2.7
# Set ONE credential for the live Pi Agent. Without it the site runs in clearly labeled offline demo mode.
# MINIMAX_CN_API_KEY=...        # for PI_PROVIDER=minimax-cn (api.minimaxi.com, Anthropic-compatible)
# OPENAI_API_KEY=sk-...         # for PI_PROVIDER=openai
# ANTHROPIC_API_KEY=sk-ant-...  # for PI_PROVIDER=anthropic
DATA_DIR=./data
```

- [ ] **Step 3: 回归并提交**

Run: `npm test`
Expected: 全部 PASS（config 无单测，此步确认无语法/导入破坏）。

```bash
git add server/config.mjs .env.example
git commit -m "feat(config): support minimax-cn provider with MiniMax-M2.7 default"
```

---

### Task 6: 离线模块抽取 + main.mjs 接线（plan 事件、planning 重置）

**Files:**
- Create: `server/offline.mjs`
- Modify: `server/main.mjs`
- Test: `tests/offline.test.mjs`（新建）

**Interfaces:**
- Consumes: `createTools()`（无参）、`listDatasets`、`series`（现有）；Task 4 的 `{ agent, planning }`
- Produces: ① `server/offline.mjs` 导出 `buildOfflinePlan(question, datasets?)` → `{ selected: {dataset, metric, aggregation, groupBy}, plan: {requirement, steps(4条, status) } }` 与 `runOffline(question, emit)`（行为同现 main.mjs 版本，额外在开始时与每个工具完成后 emit `{type:"plan", plan}`，plan 为含最新步骤状态的对象）；② `main.mjs` live 路径：`state.planning` 每次 prompt 前重置 `{submitted:false, plan:null}`；`tool_execution_end` 中 `event.result?.details?.plan` 转发为 `{type:"plan", plan}` SSE 事件。

- [ ] **Step 1: 写失败测试**

新建 `tests/offline.test.mjs`：

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/offline.test.mjs`
Expected: FAIL（`../server/offline.mjs` 不存在）。

- [ ] **Step 3: 创建 server/offline.mjs**

把 main.mjs 中的 `chooseOffline`、`runOffline` 原样迁移，新增 `buildOfflinePlan`；逻辑保持不变，仅按下列结构组织：

```js
import { listDatasets, series } from "./db.mjs";
import { createTools } from "./tools.mjs";

function chooseOffline(question, datasets) {
  let dataset="air_quality", metric="pm25";
  if (/地铁|公交|交通|轨道|客运/.test(question)) {
    dataset="transit"; metric=/公交/.test(question) && !/地铁|轨道/.test(question) ? "bus_riders_10k" : "rail_riders_10k";
  } else if (/大学|高校|学校|学生|教育|研究生/.test(question)) {
    dataset="education"; metric=/小学/.test(question) ? "primary_10k" : /中学/.test(question) ? "middle_10k" : "university_10k";
  } else if (/温度|气温|降水|天气|高温|炎热/.test(question)) {
    const weather = datasets.find(item => item.id === "weather_daily");
    if (weather.count > 0) {
      dataset="weather_daily";
      metric=/降水|雨/.test(question) ? "precipitation_mm" : /最高|高温/.test(question) ? "temp_max_c" : "temp_mean_c";
    }
  } else if (/优良|好天气|优质/.test(question)) {
    metric="good_days_pct";
  }
  return { dataset, metric, aggregation: metric === "precipitation_mm" ? "sum" : "avg", groupBy:"year" };
}
// 离线兜底的脚本化计划：复用问题路由结果，生成需求分析与固定四步。
export function buildOfflinePlan(question, datasets = listDatasets()) {
  const selected = chooseOffline(question, datasets);
  const plan = {
    requirement: {
      goal: question, dataset: selected.dataset, metric: selected.metric,
      timeRange: "自动选择全部可用年份",
      caveats: ["离线脚本按固定规则选择，并非模型自主规划"]
    },
    steps: [
      { id: 1, action: "发现可用数据集", tool: "list_datasets", status: "pending" },
      { id: 2, action: "检查数据结构与口径", tool: "inspect_dataset", status: "pending" },
      { id: 3, action: "统计查询 " + selected.dataset + "." + selected.metric, tool: "analyze_data", status: "pending" },
      { id: 4, action: "生成趋势图表", tool: "create_chart", status: "pending" }
    ]
  };
  return { selected, plan };
}
export async function runOffline(question, emit) {
  const { selected, plan } = buildOfflinePlan(question);
  emit({ type: "plan", plan });
  const tools = createTools();
  const byName = name => tools.find(t => t.name === name);
  const calls = [
    ["list_datasets", {}],
    ["inspect_dataset", { dataset: selected.dataset }],
    ["analyze_data", selected],
    ["create_chart", { ...selected, chartType: "line" }]
  ];
  for (const [name, args] of calls) {
    emit({ type: "tool_start", id: name, name, args });
    const result = await byName(name).execute(name, args);
    emit({ type: "tool_end", id: name, name, result: result.content[0].text.slice(0, 900) });
    if (result.details.chart) emit({ type: "chart", chart: result.details.chart });
    const step = plan.steps.find(s => s.tool === name);
    if (step) { step.status = "completed"; emit({ type: "plan", plan }); }
  }
  const report = series(selected);
  const s = report.summary;
  const caution = selected.dataset === "air_quality" && /天气|高温|气温/.test(question)
    ? "提醒：当前没有导入南京日度天气，以下展示的是空气质量示例，不能用 PM2.5 解释气温。运行 npm run import:weather 后再分析温度。\n\n" : "";
  const weatherNote = selected.dataset === "weather_daily"
    ? "\n提示：真实模式下 query_weather 工具还支持逐日记录与季节过滤（如夏季对比），离线演示仅做年聚合。\n" : "";
  const answer = caution + "离线演示结果（由确定性程序依次调用工具，并非模型自主规划）\n\n" +
    report.datasetTitle + " · " + report.metricTitle + "\n" +
    "覆盖 " + s.first.period + "—" + s.last.period + " 的 " + s.count + " 个时间点；起点 " +
    s.first.value + "，终点 " + s.last.value + " " + report.unit + "，变化 " + s.change + " " + report.unit + "。\n" +
    "最高值 " + s.highest.value + "（" + s.highest.period + "），最低值 " + s.lowest.value + "（" + s.lowest.period + "）。\n\n" +
    "统计注意：" + report.caveat + "\n数据来源：" + report.source + weatherNote +
    "\n配置 MINIMAX_CN_API_KEY 等密钥后，Agent 将由 Pi Agent Core 先规划再逐步执行。" ;
  for (let i = 0; i < answer.length; i += 42) emit({ type: "delta", text: answer.slice(i, i + 42) });
  return answer;
}
```

注意：`chooseOffline` 函数体必须从 `server/main.mjs:37-53` **逐字复制**（含正则与三元表达式），不要改写逻辑。

- [ ] **Step 4: 修改 server/main.mjs**

① 顶部 import 区：删除 `import { createTools } from "./tools.mjs";`（删函数后不再使用），并新增：

```js
import { runOffline } from "./offline.mjs";
```

（删除 `main.mjs:36-81` 的 `toolByName`、`chooseOffline`、`runOffline` 三个函数——`toolByName` 仅被旧 runOffline 使用，一并移除。）

② `handleChat` 中会话状态初始化（`const state=previous || { agent:null,busy:false };`）改为：

```js
  const state=previous || { agent:null, planning:null, busy:false };
```

③ live 分支的 agent 创建与 prompt 调用（原 `if (!state.agent) state.agent=createDataAgent(sessionId);` 与 `await state.agent.prompt(question);`）改为：

```js
      if (!state.agent) {
        const created=createDataAgent(sessionId);
        state.agent=created.agent; state.planning=created.planning;
      }
      // 每个新问题重新规划：复位后钩子会再次强制 submit_plan。
      state.planning.submitted=false; state.planning.plan=null;
```

（`await state.agent.prompt(question);` 保持在其后不动。）

④ live 分支的 `tool_execution_end` 处理中，在 chart 转发行 `if (event.result?.details?.chart) emit(...)` 之后追加：

```js
          if (event.result?.details?.plan) emit({type:"plan",plan:event.result.details.plan});
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test`
Expected: 全部 PASS（含 offline 新用例）。

- [ ] **Step 6: 冒烟验证离线模式**

Run: `npm start &` 后执行：

```bash
curl -N -H 'Content-Type: application/json' -d '{"message":"南京PM2.5有什么变化？"}' http://localhost:3000/api/chat
```

Expected: SSE 流中首先出现 `{"type":"plan","plan":{...}}`，随后 tool_start/tool_end/chart/delta/done；完成后 `kill %1` 停掉服务。

- [ ] **Step 7: 提交**

```bash
git add server/offline.mjs server/main.mjs tests/offline.test.mjs
git commit -m "feat(server): offline plan script and plan SSE relay with per-question planning reset"
```

---

### Task 7: Web 计划卡片

**Files:**
- Modify: `web/agent.html`（02 / 分析产物 pane）
- Modify: `web/agent.js`
- Modify: `web/shared.css`

**Interfaces:**
- Consumes: Task 6 的 SSE 事件 `{type:"plan", plan:{requirement:{goal,dataset,metric,timeRange,caveats}, steps:[{id,action,tool,status}]}}`
- Produces: 页面行为（无导出）。plan 事件 → `#planHost` 内重渲染单张计划卡片；重置按钮清空为占位文案。

- [ ] **Step 1: agent.html 加容器**

在 `<section class="panel window">`（02 / 分析产物）的 `<header class="pane-head">…</header>` 与 `<div id="artifacts" …>` 之间插入：

```html
<div id="planHost" class="plan-host"><p class="small muted">尚无调查计划；提问后 Agent 会先提交计划。</p></div>
```

- [ ] **Step 2: agent.js 处理 plan 事件**

① 在 `const currentSteps=new Map();` 之前加入渲染函数：

```js
  const statusIcon={pending:"○",in_progress:"●",completed:"✓"};
  function renderPlan(plan) {
    const host=el("planHost");host.replaceChildren();
    const card=document.createElement("article");card.className="plan-card";
    const title=document.createElement("h3");title.textContent="调查计划";
    const goal=document.createElement("p");goal.className="plan-goal";goal.textContent=plan.requirement?.goal||"";
    card.append(title,goal);
    const req=plan.requirement||{};
    const meta=document.createElement("div");meta.className="plan-meta";
    [["数据集",req.dataset],["指标",req.metric],["范围",req.timeRange]].forEach(([k,v])=>{if(!v)return;const s=document.createElement("span");s.textContent=k+"："+v;meta.append(s);});
    if(meta.childNodes.length)card.append(meta);
    const caveats=req.caveats||[];
    if(caveats.length){const ul=document.createElement("ul");ul.className="plan-caveats";caveats.forEach(c=>{const li=document.createElement("li");li.textContent=c;ul.append(li);});card.append(ul);}
    const list=document.createElement("ol");list.className="plan-steps";
    (plan.steps||[]).forEach(step=>{const li=document.createElement("li");li.className="plan-step "+(step.status||"pending");
      const icon=document.createElement("span");icon.className="plan-status";icon.textContent=statusIcon[step.status]||"○";
      li.append(icon,document.createTextNode(" "+step.action));list.append(li);});
    card.append(list);host.append(card);
  }
```

② SSE 分发处（`if(event.type==="chart")addChart(event.chart);` 之后）加入：

```js
          if(event.type==="plan")renderPlan(event.plan);
```

③ 重置按钮 handler 中（`el("artifacts").replaceChildren();` 附近）加入：

```js
    el("planHost").replaceChildren();
    const empty=document.createElement("p");empty.className="small muted";empty.textContent="尚无调查计划；提问后 Agent 会先提交计划。";el("planHost").append(empty);
```

- [ ] **Step 3: shared.css 追加样式**

文件末尾追加：

```css
/* 调查计划卡片 */
.plan-host{padding:14px 17px 0}
.plan-card{border:1px solid #2a3951;border-radius:14px;padding:14px;background:#101c30}
.plan-card h3{font-size:13px;margin:0;color:#79cfbd;letter-spacing:.04em}
.plan-goal{font-size:13px;margin:8px 0 0;line-height:1.6;color:#e3ecf8}
.plan-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.plan-meta span{font-size:11px;color:#afbed0;background:#18263e;border-radius:6px;padding:4px 7px}
.plan-caveats{margin:9px 0 0;padding-left:16px;font-size:11px;color:#e8aeae;line-height:1.6}
.plan-steps{margin:11px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.plan-step{font-size:12px;color:#d0def0}
.plan-step.pending .plan-status{color:#71839b}
.plan-step.in_progress .plan-status{color:#f4b477}
.plan-step.completed{color:#9fd8c6}
.plan-step.completed .plan-status{color:#67c9ae}
.plan-status{display:inline-block;width:16px}
```

- [ ] **Step 4: 手工验证**

Run: `npm start`，浏览器打开 http://localhost:3000/agent，无 Key 离线模式提问"南京PM2.5有什么变化？"。

Expected: 右侧面板顶部出现计划卡片，步骤随工具完成逐个变为 ✓；点"新会话"后卡片清空。验证后停掉服务。

- [ ] **Step 5: 提交**

```bash
git add web/agent.html web/agent.js web/shared.css
git commit -m "feat(web): investigation plan card with live step statuses"
```

---

### Task 8: 文档更新 + 全量回归 + 真实模式冒烟

**Files:**
- Modify: `README.md`
- Modify: `docs/teaching-guide.md`

**Interfaces:** 无代码接口；纯文档与端到端验证。

- [ ] **Step 1: 更新 README.md**

① "真实 Pi Agent 与离线兜底"一节的开头改为 MiniMax 优先（保留 OpenAI/Anthropic 小节）：

```markdown
编辑 .env，使用 MiniMax（国内直连，Anthropic 兼容协议）：

    PI_PROVIDER=minimax-cn
    PI_MODEL=MiniMax-M2.7
    MINIMAX_CN_API_KEY=your-api-key

也支持 OpenAI / Anthropic（见 .env.example 注释）。重启服务器即可。**真实模式**使用 @earendil-works/pi-agent-core 的 Agent Loop 和 Tool Calling。
```

② "架构"一节的工具清单行改为：

```markdown
工具：list_datasets / inspect_dataset / analyze_data / create_chart / query_weather / submit_plan / update_plan。服务端严格限定数据集与字段名，不接受任意SQL、Shell或Python；计算由SQLite完成，图表由Web SVG绘制。**先规划再执行**：每个新问题必须先调用 submit_plan 提交需求分析与步骤清单（beforeToolCall 钩子硬约束），执行中用 update_plan 更新步骤状态，右侧面板实时显示计划卡片。
```

③ "课堂演示问题"列表追加两条：

```markdown
6. 南京哪年夏天最热？请做夏季（6—8月）对比。
7. 2026年10月南京逐日降水如何？画一张图。
```

- [ ] **Step 2: 更新 docs/teaching-guide.md**

在合适章节追加小节（保持现有文风）：

```markdown
### 规划优先的教学点

真实模式下每个问题都会先出现"调查计划"卡片（需求分析 + 步骤清单），学生可以对照右侧工具时间线观察"计划 → 执行 → 打勾"的对应关系。可现场演示两个教学点：一是追问第二个问题时计划会重新生成（每问重置）；二是天气问题用 query_weather 的 months 参数做季节过滤，说明"全年均值冒充夏季趋势"是常见统计错误。
```

- [ ] **Step 3: 全量回归**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 4: 真实模式冒烟（需要用户提供 MiniMax Key）**

请用户把 Key 写入 `.env`（`MINIMAX_CN_API_KEY=...`，用户自行编辑，Key 不进对话记录），然后：

```bash
npm start
curl -fsS http://localhost:3000/api/status
```

Expected: `{"mode":"live","provider":"minimax-cn","model":"MiniMax-M2.7",...}`。

浏览器提问"南京2015至2024年PM2.5改善了多少？请画趋势图。"、"南京哪年夏天最热？"与"2026年10月南京逐日降水如何？画一张图。"：

Expected: ① 每个问题先出现计划卡片再执行工具；② 季节问题观察到 query_weather(yearly, months=[6,7,8]) 调用；③ 逐日降水问题观察到 query_weather(daily, 2026-10-01~10-31) 与折线图；④ 输出带数字与来源的结论。

已知风险处理：M2.7 为推理模型，若 `thinkingLevel:"off"` 在 Anthropic 兼容协议下报错（如要求必须开启 thinking），将 `server/agent.mjs` 中 `thinkingLevel` 改为 `"medium"` 并重测（仅 minimax 分支受影响时，可按 provider 条件设置）。

- [ ] **Step 5: 提交**

```bash
git add README.md docs/teaching-guide.md
git commit -m "docs: document plan-first workflow, query_weather and MiniMax setup"
```

---

## 任务依赖与顺序

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 严格顺序执行。Task 4 完成后 live 模式短暂不可用（main.mjs 未接线），Task 6 修复；其余每步独立可验证。
