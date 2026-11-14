(() => {
  // Copyable prompts are intentionally separate from terse on-screen slide text.
  const prompts = {
  "data": {
    "title": "步骤 01 · 搭建数据库层",
    "content": "我们正在仓库 hythzx/pi-agent-demo 的根目录，现场构建一个独立的 Web Agent。\n\n只在新建的 workshop/ 目录里写代码；不要覆盖现有的 server/、web/、data/、/agent 和 /slides。\n\n第一步：搭建数据库层。先阅读根目录 server/db.mjs 作为参考（表结构、真实数据与查询函数都在里面），然后自己重建一个同构模块，不要 import 现成实现。\n\n请创建 workshop/db.mjs：\n- 打开仓库现有 data/nanjing.db 数据文件；若表为空，按 server/db.mjs 中的真实种子数据建表并初始化（46 行真实统计，所有数值必须与参考实现一致，不得编造）。\n- 导出数据目录 CATALOG：四个数据集（air_quality、transit、education、weather_daily）的标题、描述、指标键、单位、官方来源链接与口径说明。\n- 导出 listDatasets、describeDataset、series 三个查询函数；series 按 dataset、metric、startYear、endYear、groupBy、aggregation 做真实聚合，沿用白名单校验：指标必须在 CATALOG 内、聚合方式枚举、年份范围合法；缺失年份不插值、不当 0。\n- 不安装额外依赖，数据库访问方式与 server/db.mjs 保持一致。\n\n再创建 workshop/check-data.mjs 验证脚本：\n1. 列出全部数据集与记录数。\n2. 查询 air_quality 的 pm25（2015—2024）：2015 年必须是 57、2024 年必须是 28（μg/m³），2016 年无记录，不得虚构补齐。\n3. 查询 education 的 university_10k（2000—2024），打印首尾变化与单位。\n\n实际运行 node workshop/check-data.mjs，展示输出。只做这一步，完成后停止。"
  },
  "agent": {
    "title": "步骤 02 · 基础工具与真实 Agent",
    "content": "继续在当前仓库，仅修改 workshop/ 目录；保留第一步已完成的文件。\n\n现在用 @earendil-works/pi-agent-core 和 @earendil-works/pi-ai 构建真正调用模型的 Agent。不得以关键词分流、伪造 Tool Call 或预设流程冒充 Agent 行为。\n\n请完成：\n1. workshop/tools.mjs：定义四个 Agent Tools：\n   - list_datasets：调用 workshop/db.mjs 的 listDatasets。\n   - inspect_dataset：接收 dataset，返回指标键、单位、时间范围、样本行与口径说明，避免模型臆造列名。\n   - analyze_data：接收 dataset、metric、startYear、endYear、groupBy、aggregation，调用 series 执行真实聚合。\n   - create_chart：同样调用 series，返回标准工具文本，并在 result.details.chart 附上图表数据（points、标题、单位、来源、统计口径）。\n   每个工具都要有 name、label、description、parameters（JSON Schema）、execute；参数校验以数据库模块的白名单为准，绝不能执行模型自造的查询语句。\n2. workshop/agent.mjs：用 Agent、createModels 与对应 provider 建立真实 Agent。读取 .env 的 PI_PROVIDER 与 PI_MODEL；支持 openai、anthropic、minimax-cn（MINIMAX_CN_API_KEY）与 custom（PI_BASE_URL、PI_API_KEY 接入 OpenAI Chat Completions 兼容服务；自定义模型可参考根目录 server/agent.mjs 的 createProvider 实现）。systemPrompt 要求：先看数据；数字必须来自工具结果；需要图表就调用 create_chart；引用来源；缺失年份不插值。模型不可用时明确报错，不得静默回退到模拟数据。\n3. workshop/cli.mjs：接收命令行自然语言问题，通过 agent.prompt() 运行；订阅 message_update、tool_execution_start、tool_execution_end，实时输出文字与工具调用轨迹。\n\n先阅读仓库 server/tools.mjs、server/agent.mjs 与已安装 Pi 包的实际 API 作参考，但不要直接导入现成的 createDataAgent 或 createTools，需自行实现以掌握核心逻辑。\n\n验证命令：\nnode workshop/cli.mjs \"南京2015—2024年的PM2.5变化了多少？请画图。\"\n\n必须确实看到模型主动调用工具。完成并运行后停止。"
  },
  "evolve": {
    "title": "步骤 03 · 系统演进：先规划再执行 + 天气查询",
    "content": "继续在 workshop/ 目录演进这个系统；保留前两步的成果。本步演示如何给一个运行中的 Agent 系统添加新能力：先规划再执行的结构约束，以及天气查询。\n\n一、规划能力（先规划，再执行）：\n1. workshop/tools.mjs 新增两个规划工具：\n   - submit_plan：参数 requirement（goal 必填，dataset、metric、timeRange、caveats 可选）与 steps（1—8 条，每条含 id、action、预计使用的 tool）。执行后置 planning.submitted = true，返回完整计划。\n   - update_plan：参数 updates（按步骤 id 更新 pending / in_progress / completed）与可选 revisedSteps（整体修订并重置状态）。无计划时返回引导文本而不是抛错。\n2. workshop/agent.mjs：持有 planning = { submitted: false, plan: null }；构造 Agent 时加入 beforeToolCall 钩子——计划未提交时，除 submit_plan 与 update_plan 外的所有工具调用都被拦截，拦截原因（请先调用 submit_plan 提交调查计划）作为错误工具结果回给模型，模型据此先规划。\n3. workshop/cli.mjs：每个新问题运行前把 planning 重置为未提交（保证每问都重新规划），并输出计划事件。\n\n二、天气查询：\n1. workshop/db.mjs 新增 weatherQuery：三种模式——daily 逐日原始记录（startDate 与 endDate 必填，YYYY-MM-DD，区间不超过 400 天）、monthly 按月聚合、yearly 按年聚合；monthly/yearly 支持 months 季节过滤（如 [6,7,8] 查夏季，避免以全年均值代替夏季趋势）；降水默认 sum、气温默认 avg；无数据时明确报错并提示导入方式。\n2. workshop/tools.mjs 新增 query_weather：包装 weatherQuery，单指标返回时间序列与统计摘要；提供 chartType 时在 result.details.chart 附图表数据。\n\n验证：\nnode workshop/cli.mjs \"南京哪年夏天最热？请做夏季对比。\"\n\n必须观察到：模型先调用 submit_plan；未提交前其他工具被拦截；计划提交后按步骤执行；query_weather 使用 yearly + months=[6,7,8]。完成后停止。"
  },
  "stream": {
    "title": "步骤 04 · 把 Agent 事件转为 SSE",
    "content": "继续刚才在 workshop/ 生成的真实 Pi Agent，新增 workshop/server.mjs。请不要修改根目录已有的服务端。\n\n目标：让浏览器能通过 HTTP 观察 Agent 的真实执行过程，包括调查计划的提交与推进，而不是等所有结果完成后一次返回。\n\n接口：\n- GET /api/datasets：调用 workshop/db.mjs 的 listDatasets 并返回 JSON。\n- POST /api/chat：请求体 { message, sessionId? }；响应 text/event-stream。未配置模型时明确返回错误，不得伪装为真实 Agent。\n- 服务使用 Node.js 原生 node:http，端口 3001，与 PPT 的 3000 端口分开。\n- 用 Map 按 sessionId 隔离 Agent 实例与 planning 状态；每个新问题先重置 planning 再 agent.prompt()。\n- 将 Pi Agent 事件转换为稳定的 SSE JSON，逐条 res.write(\"data: \"+JSON.stringify(payload)+\"\\n\\\")：\n  {type:\"text_delta\", text:\"...\"}\n  {type:\"plan\", plan}        // 完整计划对象，来自规划工具结果的 details.plan\n  {type:\"tool_start\", id, name, args}\n  {type:\"tool_end\", id, name, result, isError}\n  {type:\"chart\", chart}      // 来自工具真实执行结果的 details.chart\n  {type:\"done\", sessionId}\n  {type:\"error\", message}\n- 不得使用伪造数组绘图；密钥绝不返回给前端；处理异常、客户端断开与重复提交。\n\n先完成 GET /api/datasets，再完成 POST /api/chat。实际启动 node workshop/server.mjs，用 curl -N 验证事件序列包含 plan、tool_start/tool_end、chart、done。不要开始做 UI，完成后停止。"
  },
  "ui": {
    "title": "步骤 05 · 构建交互式 Web UI",
    "content": "在现有 workshop/server.mjs 上增加静态文件服务，并实现真正可交互的 Web Agent。\n\n只在 workshop/public/ 创建 index.html、style.css、app.js；不引入前端框架与外部 CDN。页面访问 http://localhost:3001 。\n\n三栏布局，手机上自动纵向排列：\n左栏：聊天记录、输入框、发送按钮和常用问题。\n中栏：调查计划卡片 + 分析产物。计划卡片渲染 requirement（目标、数据集、指标、时间范围、口径注意）与步骤清单，状态徽标 ○ 待办 / ● 进行中 / ✓ 完成；每次收到 plan 事件整卡原位重渲染，新问题替换旧计划。图表用原生 SVG 绘制折线图或柱状图，标清指标名称、单位、时间范围、数据来源与口径说明。\n右栏：数据集列表和工具执行时间线，实时显示工具名、参数、是否完成。\n\nMarkdown 渲染：把仓库 web/vendor/ 下已有的 marked.umd.js 与 purify.min.js 复制到 workshop/public/vendor/ 并以 <script> 引入；助手回答用 marked.parse(text,{breaks:true}) 解析后经 DOMPurify.sanitize 再 innerHTML；vendor 加载失败时退回纯文本。\n\n前端通过 fetch POST /api/chat 并读取 ReadableStream，以帧边界解析 SSE 消息；不要直接使用 EventSource（其仅支持 GET 请求，不适用于本接口）。\n收到 text_delta：增量渲染回答；\n收到 plan：更新计划卡片；\n收到 tool_start/tool_end：更新对应任务状态；\n收到 chart：根据服务器实际返回的数据绘图；\n收到 done/error：结束加载并恢复输入；\n支持多轮对话，sessionId 保存于 sessionStorage。\n\n不能伪造工具日志、计划、图表或成功提示；错误必须对用户可见。页面风格参考当前仓库 /agent 的深色简洁配色，但请自己实现这一套 workshop UI，不直接复制已完成的 app.js。\n\n完成后启动服务器并在浏览器演示：先出现计划卡片且步骤状态依次更新为完成，回答按标题/表格/列表渲染，图表来自真实数据。完成后停止。"
  },
  "verify": {
    "title": "步骤 06 · 运行验收与最小修复",
    "content": "请只检查和修复 workshop/，不要改动仓库已有的 /slides、/agent 成品。\n\n对刚才生成的 Node.js + Pi Agent Core + 数据库 + Web UI 做一次最小验收：\n1. 检查 workshop/ 下全部 JavaScript 语法与模块导入，修复真实的运行错误。\n2. 验证 GET /api/datasets 返回四个数据集及记录数。\n3. 验证 POST /api/chat 的事件序列：text_delta、plan、tool_start/tool_end、chart、done/error 格式正确。\n4. 用有 Key 的真实模型提问\"南京2015—2024年PM2.5变化了多少？画图\"，核对 2015=57、2024=28、2016 缺失不得虚构补齐；浏览器中计划卡片先出现且步骤状态依次更新为完成。\n5. 提问\"南京哪年夏天最热？\"，确认 query_weather 使用 yearly + months=[6,7,8]，结果与图表一致。\n6. 提问\"2026年10月南京逐日降水如何？画一张图。\"，确认 query_weather 使用 daily 与日期区间，逐日折线图正常。\n7. 检查 Markdown 渲染：标题、表格、列表、来源链接正常，页面上不应出现 ** 或 ## 等 Markdown 原文。\n8. 临时移除 API Key 再提问：必须得到明确的配置错误提示，不得静默回退到模拟数据。\n9. 当前环境无法验证的项要明确写出，不得谎报测试通过。\n\n输出简短验收清单：已通过、未通过、需要现场人工复核的项，以及启动命令。不要为了验收引入随机或模拟结果，也不要扩大需求。"
  }
};

  const slides = [...document.querySelectorAll(".slide")];
  const el = id => document.getElementById(id);
  const dialog = el("promptDialog");
  const input = el("promptContent");
  let index = 0;
  el("total").textContent = String(slides.length).padStart(2, "0");

  function show(n) {
    index = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
    el("page").textContent = String(index + 1).padStart(2, "0");
    el("section").textContent = slides[index].dataset.title || "";
    el("progress").style.width = ((index + 1) / slides.length * 100) + "%";
    el("prev").disabled = index === 0;
    el("next").disabled = index === slides.length - 1;
    el("notes").textContent = slides[index].dataset.note || "";
    const hash = "#" + (index + 1);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }
  function toggleNotes() {
    el("notes").hidden = !el("notes").hidden;
    el("notesBtn").setAttribute("aria-pressed", String(!el("notes").hidden));
  }
  function openPrompt(id) {
    if (!Object.hasOwn(prompts, id)) return;
    const prompt = prompts[id];
    el("promptTitle").textContent = prompt.title;
    input.value = prompt.content;
    el("copyStatus").textContent = "可以直接选中文本复制";
    if (document.fullscreenElement) document.exitFullscreen?.();
    dialog.showModal();
    input.scrollTop = 0;
  }
  async function copyPrompt() {
    if (!input.value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("not-supported");
      await navigator.clipboard.writeText(input.value);
      el("copyStatus").textContent = "已复制。粘贴到 Pi Coding Agent 中即可。";
    } catch {
      input.focus();
      input.select();
      try {
        if (!document.execCommand("copy")) throw new Error("copy-failed");
        el("copyStatus").textContent = "已复制。";
      } catch {
        el("copyStatus").textContent = "已选中全部文本，请手动复制（Ctrl/Cmd+C）。";
      }
    }
  }
  document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => openPrompt(button.dataset.prompt));
  });
  el("copyPrompt").addEventListener("click", copyPrompt);
  el("closePrompt").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  el("prev").addEventListener("click", () => show(index - 1));
  el("next").addEventListener("click", () => show(index + 1));
  el("notesBtn").addEventListener("click", toggleNotes);
  el("fullBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el("stage").requestFullscreen?.();
  });
  document.addEventListener("keydown", event => {
    if (dialog.open) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault(); show(index + 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault(); show(index - 1);
    } else if (event.key === "Home") show(0);
    else if (event.key === "End") show(slides.length - 1);
    else if (event.key.toLowerCase() === "n") toggleNotes();
    else if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey) el("fullBtn").click();
  });
  window.addEventListener("hashchange", () => {
    const n = Number(location.hash.slice(1));
    if (Number.isInteger(n) && n >= 1 && n <= slides.length) show(n - 1);
  });
  const initial = Number(location.hash.slice(1));
  show(Number.isInteger(initial) && initial >= 1 && initial <= slides.length ? initial - 1 : 0);

})();
