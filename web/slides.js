(() => {
  // Copyable prompts are intentionally separate from terse on-screen slide text.
  const prompts = {
  "data": {
    "title": "步骤 01 · 验证南京 SQLite 数据",
    "content": "我们正在仓库 hythzx/pi-agent-demo 的根目录，现场构建一个独立的 Web Agent。\n\n只在新建的 workshop/ 目录里写代码；不要覆盖现有的 server/、web/、data/、/agent 和 /slides。\n\n第一步：创建 workshop/check-data.mjs。\n- 使用现有 ../server/db.mjs 导出的 listDatasets、describeDataset、series 读取 SQLite。\n- 列出可用数据集及记录数，查看 air_quality 的字段与年份范围。\n- 调用 series 查询 air_quality.pm25 在 2015—2024 年的数据，打印每年的数值、首尾变化、单位和数据来源。\n- 不要补造 2016 年的数据，不要生成随机数或写死分析结果。\n- 用 Node.js 24+，不创建新数据库，也不安装额外依赖。\n\n最后真正执行 node workshop/check-data.mjs，展示运行结果。确保 PM2.5 2015 年是 57、2024 年是 28（μg/m³）。只做这一步，完成后停止。"
  },
  "agent": {
    "title": "步骤 02 · 创建真实 Pi Agent 与工具",
    "content": "继续在当前仓库，仅修改 workshop/ 目录；请保留第一步已完成的文件。\n\n现在用 @earendil-works/pi-agent-core 和 @earendil-works/pi-ai 构建一个真正调用模型的 Agent，不要使用关键词分流、伪造 Tool Call 或将预设流程冒充 Agent。\n\n请完成：\n1. workshop/tools.mjs：亲手定义三个 Agent Tools：\n   - list_datasets：调用 ../server/db.mjs 的 listDatasets。\n   - analyze_data：接收 dataset、metric、startYear、endYear，调用 ../server/db.mjs 的 series 执行真实 SQLite 聚合。\n   - create_chart：同样调用 series，返回标准工具文本，同时在 result.details.chart 中附上图表数据（points、标题、单位、来源、统计口径）。\n   每个工具都要有 name、label、description、parameters（JSON Schema）、execute。参数必须受数据库模块已有的白名单验证；绝不能执行模型自造的 SQL。\n2. workshop/agent.mjs：使用 Agent、createModels 和对应的 provider 建立真实 Agent。读取根目录 .env 中的 PI_PROVIDER、PI_MODEL 和相应 API Key；模型不存在时给出明确错误。systemPrompt 要求先看数据、用工具计算、需要图表就调用 create_chart，引用数据来源，拒绝填补缺失年份。\n3. workshop/cli.mjs：接收命令行中的自然语言问题，通过 agent.prompt() 运行；订阅 message_update、tool_execution_start、tool_execution_end，分别输出实时文字和工具调用轨迹。\n\n先阅读仓库当前 server/agent.mjs、server/tools.mjs 和已安装的 Pi 包实际 API 作为参考，但不要直接导入现成的 createDataAgent 或 createTools，否则看不到核心实现。\n\n验证命令：\nnode workshop/cli.mjs \"南京2015—2024年的PM2.5变化了多少？请画图。\"\n\n必须确实看到模型主动调用工具；无 API Key 时明确报配置错误，不得悄悄回退到模拟数据。完成并运行后停止。"
  },
  "stream": {
    "title": "步骤 03 · 把 Pi Events 转为 SSE",
    "content": "继续刚才在 workshop/ 生成的真实 Pi Agent，新增 workshop/server.mjs。请不要修改根目录已有的服务端。\n\n目标：让浏览器能通过 HTTP 观察 Agent 的真实执行，而不是等所有结果完成后一次返回。\n\n接口：\n- GET /api/datasets：调用 ../server/db.mjs 的 listDatasets 并返回 JSON。\n- POST /api/chat：请求体 { message, sessionId? }；响应 text/event-stream。无模型配置时明确返回错误，不伪装真实 Agent。\n- 服务使用 Node.js 原生 node:http，端口 3001，与 PPT 的 3000 端口分开。\n- 用 Map 按 sessionId 隔离内存中的 Agent 实例，多轮追问复用同一实例；避免一个会话并发请求导致状态交叉。\n- 将 Pi Agent 事件转换为稳定的 SSE JSON：\n  {type:\"text_delta\", text:\"...\"}\n  {type:\"tool_start\", id, name, args}\n  {type:\"tool_end\", id, name, result, isError}\n  {type:\"chart\", chart}   // 来自 create_chart 的 result.details.chart\n  {type:\"done\", sessionId}\n  {type:\"error\", message}\n- 用 res.write(\"data: \"+JSON.stringify(payload)+\"\\n\\n\") 逐条推送。\n- 从工具真实执行结果里提取 chart；不要用假数组画图。\n- 处理异常、客户端断开、重复提交；限制消息长度；密钥绝不返回给前端。\n\n先创建一个能响应 GET /api/datasets 的服务器，再完成 POST /api/chat。实际启动 node workshop/server.mjs，使用 curl -N 验证流式事件格式。不要开始做 UI，完成后停止。"
  },
  "ui": {
    "title": "步骤 04 · 构建交互式 Web UI",
    "content": "在现有 workshop/server.mjs 上增加静态文件服务，并实现真正可交互的 Web Agent。\n\n只在 workshop/public/ 创建 index.html、style.css、app.js；不必安装前端框架，不引入外部 CDN。页面访问 http://localhost:3001 。\n\n界面采用三栏布局，手机上自动纵向排列：\n左栏：聊天记录、输入框、发送按钮和常用问题。\n中栏：统计分析产物；收到 chart 事件后用原生 SVG 绘制折线图或柱状图，标清指标名称、单位、时间范围；展示最大/最小值、数据来源链接、统计口径说明。\n右栏：数据集列表和工具执行时间线，实时显示工具名、参数、是否完成，以及摘要信息。\n\n前端通过 fetch POST /api/chat 并读取 ReadableStream，以 SSE 帧边界解析实时消息；不要直接使用 EventSource（它不支持本次 POST 方式）。\n收到 text_delta：增量更新回答；\n收到 tool_start/tool_end：更新对应任务状态；\n收到 chart：根据服务器实际返回的数据绘图；\n收到 done/error：结束加载并恢复输入；\n支持多轮对话，sessionId 保存于 sessionStorage。\n\n不能伪造工具日志、图表或成功提示；错误要对用户可见。\n页面风格参考当前仓库 /agent 的深色简洁配色，但请自己实现这一套 workshop UI，不直接复制已完成的 app.js。\n\n完成后启动服务器并演示三个问题：空气质量趋势、换一个指标、询问缺失的2016年数据。确认用户可以自然语言交互，工具调用与图表确实来自 SQLite 和 Pi。"
  },
  "verify": {
    "title": "步骤 05 · 运行验收与最小修复",
    "content": "请只检查和修复 workshop/，不要改动仓库已有的 /slides、/agent 成品。\n\n对刚才生成的 Node.js + Pi Agent Core + SQLite + Web UI 做一次最小验收：\n1. 检查 workshop/ 下 JavaScript 语法与模块导入，修复真实的运行错误。\n2. 验证 GET /api/datasets 至少有 air_quality、transit、education。\n3. 验证 POST /api/chat 是真正的 SSE：文字增量、工具开始/结束、图表事件、done/error 格式正确。\n4. 使用有 Key 的实际模型，输入“南京2015—2024年PM2.5变化了多少？画图”，核对 2015=57、2024=28、2016 缺失。\n5. 再输入“那优良天数比例呢？”验证多轮对话与切换指标。\n6. 在浏览器检查聊天、工具时间线和图表是否匹配真实事件。若当前环境无法启动浏览器或无法访问模型，请明确写出未验证项，不要假装测试通过。\n7. 输出简短验收结果：已通过、未通过、需要现场手动检查，和启动命令。\n\n不要为了验收引入随机/模拟结果，也不要扩大需求。"
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
