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
// 每个 plan 事件须反映发出时刻的步骤状态，发送深一层拷贝，避免后续打勾改写历史事件。
const planSnapshot = plan => ({ ...plan, steps: plan.steps.map(s => ({ ...s })) });
export async function runOffline(question, emit) {
  const { selected, plan } = buildOfflinePlan(question);
  emit({ type: "plan", plan: planSnapshot(plan) });
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
    if (step) { step.status = "completed"; emit({ type: "plan", plan: planSnapshot(plan) }); }
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
