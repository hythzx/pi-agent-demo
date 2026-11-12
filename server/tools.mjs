import { CATALOG, listDatasets, describeDataset, series, weatherQuery } from "./db.mjs";

const textResult = (data, extra = {}) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  details: { ...extra }
});
const datasetParam = { type: "string", enum: Object.keys(CATALOG), description: "数据集 ID" };
const metricParam = { type: "string", description: "仅可使用 inspect_dataset 返回的 metrics 中列出的指标键" };
const years = {
  startYear: { type: "integer", minimum: 1900, maximum: 2100, description: "起始年份，默认1949" },
  endYear: { type: "integer", minimum: 1900, maximum: 2100, description: "结束年份，默认当前年份" },
  groupBy: { type: "string", enum: ["year", "month"], description: "默认year；仅天气日度数据支持month" },
  aggregation: { type: "string", enum: ["avg", "sum", "max", "min"], description: "默认avg；降水量按年或月累计时用sum" }
};
const analyzeProperties = { dataset: datasetParam, metric: metricParam, ...years };
function compute(params) {
  return series({
    dataset: params.dataset, metric: params.metric,
    startYear: params.startYear ?? 1949, endYear: params.endYear ?? new Date().getFullYear(),
    groupBy: params.groupBy ?? "year", aggregation: params.aggregation ?? "avg"
  });
}
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
export function createTools(planning = null) {
  return [
    {
      name: "list_datasets", label: "发现数据集",
      description: "列出本地 SQLite 中可用的南京数据集、记录数、来源和指标列表。分析之前优先调用。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => textResult(listDatasets())
    },
    {
      name: "inspect_dataset", label: "检查数据结构",
      description: "检查某个数据集的指标键、单位、时间范围、样本行和数据来源，避免臆造列名。",
      parameters: { type: "object", properties: { dataset: datasetParam }, required: ["dataset"], additionalProperties: false },
      execute: async (_id, params) => textResult(describeDataset(params.dataset))
    },
    {
      name: "analyze_data", label: "执行统计分析",
      description: "由 SQLite 进行真实、确定性聚合；返回时间序列、最大/最小值、首尾变化、样本数与来源。不得推断不存在的年份。",
      parameters: { type: "object", properties: analyzeProperties, required: ["dataset", "metric"], additionalProperties: false },
      execute: async (_id, params) => textResult(compute(params))
    },
    {
      name: "create_chart", label: "生成交互图表",
      description: "将 SQLite 查询结果转换为 UI 可渲染的可视化数据。需要让用户看到图表时调用。",
      parameters: {
        type: "object",
        properties: { ...analyzeProperties, chartType: { type: "string", enum: ["line", "bar"] } },
        required: ["dataset", "metric"], additionalProperties: false
      },
      execute: async (_id, params) => {
        const data = compute(params);
        const chart = { ...data, chartType: params.chartType || "line" };
        return textResult({ chartCreated: true, metric: data.metricTitle, count: data.points.length, source: data.source, caveat: data.caveat }, { chart });
      }
    },
    {
      name: "query_weather", label: "查询历史天气",
      description: "查询本地 SQLite 的南京 ERA5 历史天气：daily 逐日原始记录（单次不超过400天）、monthly 按月聚合、yearly 按年聚合；monthly/yearly 可用 months 做季节过滤（如[6,7,8]查夏季）。需要让用户看到天气图表时提供 chartType。daily 必须同时提供 startDate 与 endDate（YYYY-MM-DD）；用户未给具体日期时改用 yearly 或 monthly。",
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
    },
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
        // 整体修订时替换全部步骤并重置为 pending，本次 updates 不再应用。
        if (params.revisedSteps) {
          planning.plan = { ...planning.plan, steps: planWithStatuses(params.revisedSteps) };
          return textResult(planning.plan, { plan: planning.plan });
        }
        const known = new Set(planning.plan.steps.map(s => s.id));
        for (const u of params.updates) {
          if (!known.has(u.id)) continue;
          const step = planning.plan.steps.find(s => s.id === u.id);
          step.status = u.status;
        }
        return textResult(planning.plan, { plan: planning.plan });
      }
    }
  ];
}
