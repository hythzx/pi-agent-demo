# 规划优先的南京数据调查智能体 · 设计文档

日期：2026-11-11
状态：已与用户确认的最终设计

## 背景与目标

本项目（pi-agent-demo）已有一个基于 `@earendil-works/pi-agent-core` 1.5.2 的真实
LLM 智能体：4 个工具（list_datasets / inspect_dataset / analyze_data / create_chart）、
SSE 事件流、Web 图表。当前智能体是"反应式"的——收到问题后直接挑选工具执行。

本次改造目标：

1. **先规划再执行**：智能体接到每个新问题必须先做需求分析并提交结构化调查计划，
   然后按计划逐步执行并实时更新步骤状态。规划由模型自主完成（不是脚本），
   并用 pi-agent-core 的 `beforeToolCall` 钩子做硬约束兜底。
2. **接入 MiniMax LLM**：新增 `minimax-cn` provider（Anthropic 兼容协议），
   让界面从"离线脚本演示"切换到真实 LLM 模式。
3. **补齐天气查询缺口**：新增专用 `query_weather` 工具，支持逐日原始记录与
   季节过滤，解决现有工具"最细只到月聚合、无法查夏季趋势"的已记录缺口。

### 非目标（有意不做）

- 多指标同图（模型可对 `query_weather` 分多次调用，每次单指标）；
- 高温天数、降雨天数等阈值统计；
- 双 Agent（Planner + Executor）编排层；
- 认证、限流、租户隔离（维持 README 声明的教学边界）。

## 总体架构

单 Agent 架构不变，扩展后共 7 个工具：

```
Browser /agent ── SSE ── Node Server ── Pi Agent Core (minimax-cn / openai / anthropic)
                              │
        submit_plan / update_plan / query_weather / list_datasets
        / inspect_dataset / analyze_data / create_chart
                              │
        beforeToolCall 钩子：计划未提交 → 拦截其余数据工具
                              │
                      SQLite (node:sqlite)
```

## 一、规划工具与硬约束

### 规划状态

`createTools(planning)` 接收共享状态对象 `planning = { submitted: false, plan: null }`，
由 `createDataAgent` 创建并随返回值暴露；`main.mjs` 在每次 `agent.prompt()` 前
将 `planning.submitted` 复位为 `false`、`planning.plan` 复位为 `null`，
保证多轮会话中每个新问题都要重新规划。

`createTools()` 不带参数时（离线路径 `toolByName` 使用）行为向后兼容，
规划工具不会被离线脚本调用。

### submit_plan

用途：提交需求分析 + 步骤清单。执行后置 `planning.submitted = true`。

参数 schema：

```json
{
  "type": "object",
  "properties": {
    "requirement": {
      "type": "object",
      "properties": {
        "goal": { "type": "string", "description": "一句话调查目标" },
        "dataset": { "type": "string", "description": "数据集 ID，未确定填 unknown" },
        "metric": { "type": "string", "description": "指标，未确定填 unknown" },
        "timeRange": { "type": "string", "description": "时间范围及口径说明" },
        "caveats": { "type": "array", "items": { "type": "string" }, "description": "口径注意事项" }
      },
      "required": ["goal"],
      "additionalProperties": false
    },
    "steps": {
      "type": "array",
      "minItems": 1,
      "maxItems": 8,
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer", "minimum": 1, "maximum": 8 },
          "action": { "type": "string" },
          "tool": { "type": "string", "description": "预计使用的工具名" }
        },
        "required": ["id", "action"],
        "additionalProperties": false
      }
    }
  },
  "required": ["requirement", "steps"],
  "additionalProperties": false
}
```

返回：`content` 为合并后完整计划的 JSON；`details.plan` 携带同一计划对象
（供 SSE 转发）。步骤初始状态 `pending`。

### update_plan

用途：更新步骤状态，必要时整体修订。

参数 schema：

```json
{
  "type": "object",
  "properties": {
    "updates": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer", "minimum": 1, "maximum": 8 },
          "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
        },
        "required": ["id", "status"],
        "additionalProperties": false
      }
    },
    "revisedSteps": {
      "type": "array",
      "minItems": 1,
      "maxItems": 8,
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "integer", "minimum": 1, "maximum": 8 },
          "action": { "type": "string" },
          "tool": { "type": "string" }
        },
        "required": ["id", "action"],
        "additionalProperties": false
      },
      "description": "整体修订时提供，替换现有步骤"
    }
  },
  "required": ["updates"],
  "additionalProperties": false
}
```

行为：`planning.plan` 为空时返回错误文本（提示先 submit_plan，不抛异常）；
否则合并 updates（未知 id 忽略），有 revisedSteps 则整体替换步骤（状态重置 pending），
返回 `details.plan`。

### beforeToolCall 硬约束

`agent.mjs` 导出纯函数工厂 `planFirstHook(planning)`，返回 beforeToolCall 处理器：

- 计划未提交（`!planning.submitted`）且调用的不是 `submit_plan`：
  返回 `{ block: true, reason: "尚未提交调查计划。请先调用 submit_plan 提交需求分析与步骤清单，再使用数据工具。" }`
  ——拦截原因作为工具结果回给模型，模型据此先规划；
- 其余情况放行。

### 系统提示词

改写 `SYSTEM_PROMPT` 为规划优先工作流，保留现有数据纪律条款
（不插值、口径、单位、来源链接、禁止任意 SQL 等），新增：

- 每个新问题先完成需求分析（识别指标、时间范围、口径风险），再调用 submit_plan；
- 按计划逐步执行，每完成一步调用 update_plan 更新状态；情况变化时可整体修订；
- 天气类问题（逐日、季节、月度）优先使用 query_weather；
- 全部步骤完成后给出带数字依据的中文结论。

## 二、query_weather 工具

参数 schema：

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["daily", "monthly", "yearly"] },
    "metric": { "type": "string", "enum": ["temp_mean_c", "temp_max_c", "temp_min_c", "precipitation_mm"] },
    "startDate": { "type": "string", "description": "daily 必填，YYYY-MM-DD" },
    "endDate": { "type": "string", "description": "daily 必填，YYYY-MM-DD" },
    "startYear": { "type": "integer", "minimum": 1900, "maximum": 2100 },
    "endYear": { "type": "integer", "minimum": 1900, "maximum": 2100 },
    "months": {
      "type": "array", "items": { "type": "integer", "minimum": 1, "maximum": 12 },
      "maxItems": 12, "uniqueItems": true,
      "description": "季节过滤；yearly 为聚合窗口，monthly 为月份筛选"
    },
    "aggregation": { "type": "string", "enum": ["avg", "sum", "max", "min"], "description": "默认气温 avg、降水 sum" },
    "chartType": { "type": "string", "enum": ["line", "bar"], "description": "提供时随结果返回图表数据" }
  },
  "required": ["mode", "metric"],
  "additionalProperties": false
}
```

行为：

- **daily**：`startDate`/`endDate` 必填，格式校验 `YYYY-MM-DD`，区间上限 400 行
  （超出抛错并提示改用 monthly/yearly）；返回逐日 `{ period, value }`；
  `months` 在 daily 模式下非法（抛参数错误）；
- **yearly**：按年聚合，`months` 限定聚合窗口（如 `[6,7,8]` 查夏季趋势）；
- **monthly**：按月聚合，`months` 筛选保留的月份；yearly/monthly 用 `startYear`/`endYear`
  （默认 1949—当前年）；
- 聚合默认值：降水 `sum`，其余 `avg`；
- `weather_daily` 表为空（未运行 `npm run import:weather`）时抛错，
  错误信息提示先导入，与 `series()` 行为一致；
- 返回结构与 `series()` 风格一致：`points`（`{period, value, samples}`）、`summary`
  （count/lowest/highest/first/last/change/changePct）、`metricTitle`、`unit`、
  `source`、`caveat`（ERA5 网格再分析署名 + "2026 为不完整年度（截至 11-05）"提示）；
- `chartType` 提供时构造 `details.chart`（与 create_chart 相同形状：
  points/summary/unit/source/caveat + chartType），走现有 SSE chart 通道。

实现：`db.mjs` 新增 `weatherQuery(params)`，沿用现有白名单风格——指标键、
月份、模式全部校验，SQL 只拼白名单片段，值走参数绑定。

## 三、MiniMax 接入

- `config.mjs`：`PI_PROVIDER` 支持 `minimax-cn`；live 检测：
  `minimax-cn → Boolean(process.env.MINIMAX_CN_API_KEY)`（保留 openai/anthropic 分支）；
  provider 为 minimax-cn 时默认模型 `MiniMax-M2.7`，`PI_MODEL` 可覆盖
  （可选 `MiniMax-M2.7-highspeed`、`MiniMax-M3`、`MiniMax-M3.1-Flash`）；
- `agent.mjs`：新增分支 `setProvider(minimaxCnProvider())`
  （pi-ai 原生支持，Anthropic 兼容协议，baseUrl `https://api.minimaxi.com/anthropic`）；
- `.env.example` 增加 `MINIMAX_CN_API_KEY` 条目与说明；真实 Key 由用户自行填入 `.env`；
- 已知风险：M2.7 为推理模型，`thinkingLevel: "off"` 在 Anthropic 兼容协议下的行为
  需运行验证；如有问题，minimax 分支单独调整 thinkingLevel。

## 四、SSE 事件与离线兜底

- 新增事件 `{ type: "plan", plan }`：`main.mjs` 在 `tool_execution_end` 中检测
  `event.result?.details?.plan` 统一转发（submit_plan 与 update_plan 共用同一事件类型，
  plan 始终是合并后的完整计划，UI 原位重渲染）；
- 离线模式：`chooseOffline` 重构为 `buildOfflinePlan(question, datasets)` 纯函数，
  返回选定的数据集/指标参数与脚本化计划（requirement + steps）；
  `runOffline` 先发 `{type:"plan"}`，每完成一个工具调用发一次带最新步骤状态的 plan 事件；
  文案仍明确标注"离线脚本演示（非 LLM）"；离线不调用 query_weather
  （天气问题离线仍走年聚合序列，并在结论中提示联网模式支持逐日/季节查询）。

## 五、Web UI 计划卡片

- 右侧 artifacts 面板顶部新增计划卡片容器，与图表卡同样式（深色卡片语言）；
- 内容：需求分析区（目标 / 数据集·指标 / 时间范围 / 口径注意事项列表）
  + 步骤清单（状态徽标 `○ pending / ● in_progress / ✓ completed`）；
- 收到 plan 事件即重渲染当前卡片（新问题替换旧卡片，不堆叠）；
- 会话重置按钮同步清空计划卡片；
- 涉及文件：`web/agent.html`（容器）、`web/agent.js`（plan 事件处理与渲染）、
  `web/shared.css`（样式）。

## 六、错误处理

- 钩子拦截：block 原因作为工具结果返回，模型可自行恢复（先规划）；
- 工具参数校验：由 pi-agent-core 的 schema 校验 + 工具内校验双层保证，
  校验失败以工具错误结果呈现，模型可修正参数重试（现有模式）；
- `update_plan` 在无计划时返回错误文本而非抛异常；
- MiniMax 网络错误沿用现有 `agent.state.errorMessage` → SSE error 事件路径。

## 七、测试与文档

测试（`node --test`，沿用现有 tests/ 结构）：

- `tests/weather.test.mjs`（新增）：daily 日期过滤与 400 行上限、monthly/yearly 聚合、
  months 季节过滤、非法日期/超范围年份/未知指标拒绝、chartType 产出 details.chart；
- `tests/planning.test.mjs`（新增）：submit_plan 置位与计划合并、update_plan
  状态更新与 revisedSteps 整体替换、无计划时错误文本、`planFirstHook` 拦截与放行；
- `tests/tools.test.mjs` 扩展：createTools(planning) 注入路径；
- `tests/main` 相关：`buildOfflinePlan` 纯函数输出（问题 → 数据集/指标/计划）。

文档：README（工具清单、计划卡说明、MiniMax 配置小节）、
docs/teaching-guide.md（演示话术：规划→执行→修订的教学点）。

## 改动文件清单

| 文件 | 改动 |
| --- | --- |
| server/config.mjs | minimax-cn provider、live 检测、默认模型 |
| server/agent.mjs | provider 分支、planFirstHook、SYSTEM_PROMPT、createDataAgent 返回 planning |
| server/tools.mjs | submit_plan、update_plan、query_weather、createTools(planning) |
| server/db.mjs | weatherQuery() |
| server/main.mjs | plan SSE 转发、prompt 前重置 planning、buildOfflinePlan/runOffline |
| web/agent.html | 计划卡片容器 |
| web/agent.js | plan 事件处理、计划卡片渲染、重置清理 |
| web/shared.css | 计划卡片样式 |
| .env.example | MINIMAX_CN_API_KEY 条目 |
| tests/weather.test.mjs、tests/planning.test.mjs | 新增 |
| tests/tools.test.mjs | 扩展 |
| README.md、docs/teaching-guide.md | 文档更新 |

## 验收标准

1. 配置 `MINIMAX_CN_API_KEY` 后 `/api/status` 显示 live 模式；
2. 提问"南京2015至2024年PM2.5改善了多少"：界面先出现计划卡片（需求分析+步骤），
   工具时间线按计划推进，步骤徽标逐个变为 ✓，最后输出带数字与来源的结论；
3. 提问"南京哪年夏天最热"：模型调用 query_weather（yearly + months=[6,7,8]），
   返回各年夏季聚合值与图表；
4. 提问"2026年10月南京逐日降水"：daily 模式返回逐日数据并可渲染折线图；
5. 未配置 Key 时离线模式同样展示脚本化计划卡，并明确标注非 LLM；
6. `npm test` 全部通过。
