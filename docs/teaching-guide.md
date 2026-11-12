# 现场构建路线

## 目标

从现成的南京 SQLite 数据出发，现场用 Pi Coding Agent 生成一个**独立运行**的 Web Agent：

- 自然语言提问；
- Pi Agent Core 自主选择工具；
- SQLite 完成可信计算；
- 浏览器实时显示回答、工具调用、图表。

**操作路径：**运行 `npm start`，打开 `http://localhost:3000/slides`。第 6—10 页均有 **“查看／复制提示词”** 按钮，复制到 Pi Coding Agent 逐步执行。

## 60 分钟节奏

| 时间 | 页面 | 操作 |
| --- | --- | --- |
| 0—2 分钟 | 1 | 展示目标 |
| 2—5 分钟 | 2 | 看最终成品 |
| 5—9 分钟 | 3 | 对照经典 ReAct 与 Pi Agent Loop |
| 9—13 分钟 | 4 | 理清 Web、Runtime、Tools、SQLite 执行链 |
| 13—16 分钟 | 5 | 准备终端和模型密钥 |
| 16—24 分钟 | 6 | 提示词 01：读取 SQLite |
| 24—36 分钟 | 7 | 提示词 02：实现 Tools 与 Pi Agent |
| 36—44 分钟 | 8 | 提示词 03：SSE 事件流 |
| 44—54 分钟 | 9 | 提示词 04：Web UI |
| 54—58 分钟 | 10 | 提示词 05：验证与修复 |
| 58—60 分钟 | 11 | 展示现场生成的 Web Agent |

### ReAct 与 Pi：讲解时只说两句话

- **ReAct 是范式：**模型交替生成推理与行动，并利用环境观察继续完成任务。经典写法是 Thought → Action → Observation。
- **Pi Agent Loop 是实现：**模型以文本和结构化 Tool Calls 返回，运行时执行工具、记录结果，再决定是否进入下一 Turn，并持续发出事件供 UI 订阅。

**不要误导：**不是所有传统 Agent 都是 ReAct，也不是 Pi 取代 ReAct；ReAct 并不必然只能靠解析文本实现，Pi 也不要求向用户展示模型隐藏的推理过程。对比的重点是**抽象的行为范式**与**具体可集成的运行时机制**。

参考：[ReAct 论文](https://arxiv.org/abs/2210.03629) · [Pi 官方 How Pi Works](https://pi.dev/docs/latest/how-pi-works)。

## 课前准备

运行环境：Node.js 24+、可调用的模型 API Key、Pi Coding Agent。国内模型和自建兼容端点可以配置根目录 .env 的 PI_PROVIDER=custom、PI_BASE_URL、PI_API_KEY、PI_MODEL。注意这里是 Web Agent 服务端配置；Pi Coding Agent 自身的自定义模型另行配置 ~/.pi/agent/models.json。安装 Pi Coding Agent（如果尚未安装）：

    npm install -g @earendil-works/pi-coding-agent

在仓库根目录：

    npm install
    cp .env.example .env
    # 在 .env 中写入所选模型和 API Key
    npm start

打开 PPT：`http://localhost:3000/slides`。
打开已经完成、可用于兜底的版本：`http://localhost:3000/agent`。

另开一个终端在**仓库根目录**运行 `pi`。第 6 页开始，按顺序点击“查看／复制提示词”，交给 Pi Coding Agent 逐步实现。

本次现场生成的代码只落在 `workshop/`。在第 7 步开启的演示服务使用**3001端口**，不与 PPT 和已有成品的**3000端口**冲突。第 10 页可以打开 `http://localhost:3001`。

## 演示时只强调四件事

1. **真正的 Agent Loop**：模型选择工具，Runtime 执行，而不是字符串匹配决定动作。
2. **工具是边界**：SQL 查询由受限 API 构造，模型不能直接执行任意 SQL。
3. **事件可观察**：工具调用及结果和模型文字通过 SSE 推给浏览器。
4. **数据可信**：南京统计年鉴中缺失的2016年 PM2.5 不能让模型补造。

### 规划优先的教学点

真实模式下每个问题都会先出现“调查计划”卡片（需求分析 + 步骤清单），学生可以对照右侧工具时间线观察“计划 → 执行 → 打勾”的对应关系。可现场演示两个教学点：一是追问第二个问题时计划会重新生成（每问重置）；二是天气问题用 query_weather 的 months 参数做季节过滤，说明“全年均值冒充夏季趋势”是常见统计错误。

## 现场风险预案

- **模型不可用：**切回 `/agent` 演示已经跑通的功能；如果没有 Key，备用 UI 会明确显示“离线脚本演示（非 LLM）”，不能称其为真实 Agent Loop。
- **时间不够：**停在已完成的步骤，演示备用版本。不要临时改演示数据或伪造工具事件。
- **网络问题：**SQLite 内置南京数据可离线读取，能继续讲解数据库、工具白名单与 UI；真正的模型决策需要可访问模型服务。

## 三个验收问题

- “南京2015—2024年 PM2.5 变化了多少？请画图。”
- “那空气质量优良天数比例呢？”
- “2016年呢？可以解释改善的原因吗？”

验收时核对：2015年 PM2.5 为57 μg/m³，2024年为28 μg/m³；**2016年没有对应记录**。数据来源链接应保留，不能用相关性推断因果原因。

提示词全文以 `web/slides.js` 中的 `prompts` 为准，避免多处复制后发生版本偏差。
