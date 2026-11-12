import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { minimaxCnProvider } from "@earendil-works/pi-ai/providers/minimax-cn";
import { config } from "./config.mjs";
import { createTools } from "./tools.mjs";

const SYSTEM_PROMPT = [
  "你是 Nanjing Data Lab 的南京城市数据调查智能体，不是通用闲聊助手。",
  "工作流程（每个新问题都要完整走一遍）：",
  "1. 需求分析：从问题中识别指标、时间范围与数据口径风险；不确定项写入计划的 caveats，把 list_datasets、inspect_dataset 查证列为计划的第一步。",
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

// 规划硬约束：计划未提交前拦截数据工具；submit_plan/update_plan 两个规划工具放行，
// 无计划时的 update_plan 由工具自身返回"请先 submit_plan"引导文本。
// 拦截原因会作为错误工具结果回给模型，模型据此先提交计划。
export function planFirstHook(planning) {
  return async (context) => {
    const name = context.toolCall.name;
    if (!planning.submitted && name !== "submit_plan" && name !== "update_plan") {
      return { block: true, reason: "尚未提交调查计划。请先调用 submit_plan 提交需求分析与步骤清单，再使用数据工具。" };
    }
  };
}

function createCustomModelProvider() {
  let endpoint;
  try {
    endpoint = new URL(config.baseUrl);
  } catch {
    throw new Error("PI_BASE_URL 必须是完整的 HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash) {
    throw new Error("PI_BASE_URL 只能使用 http(s) 地址，不允许 URL 内嵌密钥、查询或片段");
  }
  if (!config.model.trim()) throw new Error("请设置 PI_MODEL 为服务商实际支持的模型 ID");
  if (!Number.isFinite(config.contextWindow) || !Number.isFinite(config.maxTokens) ||
      config.maxTokens < 1 || config.contextWindow <= config.maxTokens) {
    throw new Error("PI_CONTEXT_WINDOW 必须大于 PI_MAX_TOKENS 且均为正数");
  }

  // Pi model descriptors carry the actual API protocol and endpoint. An
  // arbitrary third-party model is not necessarily in Pi's built-in catalog.
  const model = {
    id: config.model,
    name: config.model,
    provider: "custom",
    api: "openai-completions",
    baseUrl: endpoint.toString().replace(/\/$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens
  };
  return createProvider({
    id: "custom",
    name: "Custom OpenAI-compatible API",
    baseUrl: model.baseUrl,
    auth: { apiKey: envApiKeyAuth("Custom model API key", ["PI_API_KEY"]) },
    models: [model],
    api: openAICompletionsApi()
  });
}

export function createDataAgent(sessionId) {
  const models = createModels();
  if (config.provider === "custom") {
    models.setProvider(createCustomModelProvider());
  } else if (config.provider === "anthropic") {
    models.setProvider(anthropicProvider());
  } else if (config.provider === "minimax-cn") {
    models.setProvider(minimaxCnProvider());
  } else if (config.provider === "openai") {
    models.setProvider(openaiProvider());
  } else {
    throw new Error("不支持的 PI_PROVIDER：" + config.provider + "（可用：openai、anthropic、minimax-cn、custom）");
  }
  const model = models.getModel(config.provider, config.model);
  if (!model) {
    throw new Error("模型不可用：" + config.provider + "/" + config.model + "；请检查 PI_MODEL。");
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
