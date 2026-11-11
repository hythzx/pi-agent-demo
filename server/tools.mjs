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
export function createTools() {
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
  ];
}
