# Pi Agent Demo · Nanjing Data Lab

一套可运行的 Pi Agent 实战项目：**11页 Web PPT（内置逐步可复制的开发提示词）+ 南京 SQLite 数据 + Pi Agent Core + 实时工具追踪 + Web 图表**。

## 快速开始

要求 Node.js **24+**（内置 node:sqlite）。

    git clone https://github.com/hythzx/pi-agent-demo.git
    cd pi-agent-demo
    npm install
    cp .env.example .env
    npm start

打开：
- http://localhost:3000/slides — Web PPT：10页构建路线与5组现场开发提示词，支持复制、左右键、全屏与讲者备注（N）
- http://localhost:3000/agent — 对话、工具时间线、数据表和趋势图
- http://localhost:3000/api/status — 运行模式

### 真实 Pi Agent 与离线兜底

编辑 .env，使用 OpenAI（默认模型仅为示例，可按 pi-ai 模型目录修改）：

    PI_PROVIDER=openai
    PI_MODEL=gpt-4.1-mini
    OPENAI_API_KEY=your-api-key

也支持 Anthropic：

    PI_PROVIDER=anthropic
    PI_MODEL=claude-sonnet-4-6
    ANTHROPIC_API_KEY=your-api-key

重启服务器即可。**真实模式**使用 @earendil-works/pi-agent-core 的 Agent Loop 和 Tool Calling。

未配置 Key 时界面标记 **离线脚本演示（非 LLM）**。这时按照固定规则运行 SQLite 工具，能演示 UI 和计算，**不能证明模型的自主决策**。建议讲课前预先在有网环境测试模型可用性。

### 课堂演示问题

1. 南京2015年至2024年的 PM2.5 改善了多少？请画趋势图。
2. 优良天数比例是否也改善？换个指标再画一张图。
3. 2016年的 PM2.5 数据在哪里？能否判断改善原因？
4. 南京2022至2024年轨道交通客运量有什么变化？
5. 南京普通高校在校学生人数从2000年到2024年有什么变化？

## 数据与来源

第一次启动时自动初始化 SQLite 数据库到 data/nanjing.db，内置 **46行真实统计数据**：

| 数据表 | 行数 | 年份 | 官方来源 |
| --- | ---: | --- | --- |
| air_quality | 9 | 2015、2017—2024 | [南京统计年鉴2025 表16-6](https://tjj.nanjing.gov.cn/material/njnj_2025/chengxiangjianshe/16-6.html) |
| transit | 3 | 2022—2024 | [南京统计年鉴2025 表8-8](https://tjj.nanjing.gov.cn/material/njnj_2025/jiaotongyunshu/8-8.html) |
| education | 34 | 1949—2024主要年份 | [南京统计年鉴2025 表13-9](https://tjj.nanjing.gov.cn/material/njnj_2025/keji/13-9.html) |

**注意**：空气质量指标2015年前后统计标准变化，不能跨口径比较；2016年在选用表格中没有PM2.5记录，不推测缺失值。交通只有3年，不宜外推长期变化；教育仅部分年份。

### 南京逐日天气：可选导入

    npm run import:weather

联网请求 Open-Meteo Historical Weather API，以南京 **32.0603°N,118.7969°E** 为查询坐标，使用**ERA5** 再分析网格历史数据，默认2015-01-01至当天（ERA5 有数天发布延迟，脚本会自动剪掉末尾尚未发布的空占位行）；将日平均/最高/最低温度及降水量导入 SQLite 的 weather_daily 表。没有实际导入就不会声称天气数据存在。

这是**网格气象再分析估计，不是南京单一气象站实测**。数据署名：[Weather data by Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0，注明再分析模型/修改方式）。公共 API 免费访问条件适用于非商业场景。导入可以用 WEATHER_START、WEATHER_END 改日期。

第一版工具支持天气按年/月聚合；如果要研究“夏天是否越来越热”，应进一步增加6—8月季节过滤，不能用全年均值冒充夏季趋势。

## 现场通过提示词构建自己的 Agent

先启动 PPT，再在仓库根目录运行 Pi Coding Agent（未安装时可使用 `npm install -g @earendil-works/pi-coding-agent` 安装）。

PPT 第6—10页提供5组可展开、可复制的完整开发提示词，依次完成：SQLite 数据验证 → 自定义 Tools 与真实 Agent → SSE 服务 → Web UI → 验收。

现场生成代码放在独立的 `workshop/`，服务端口 `3001`，不会覆盖已有的 `/agent` 成品。操作细节见 [docs/teaching-guide.md](docs/teaching-guide.md)。

## 架构

    Browser /slides → Web PPT
    Browser /agent  → Chat + chart + trace
              │ HTTP / SSE
              ▼
        Node.js Server
              │
      Pi Agent Core + pi-ai
              │
      Tool Call（白名单）
              ▼
      SQLite (node:sqlite)

工具：list_datasets / inspect_dataset / analyze_data / create_chart。服务端严格限定数据集与字段名，不接受任意SQL、Shell或Python；计算由SQLite完成，图表由Web SVG绘制。

主要文件：

- server/agent.mjs — Pi Agent 配置、提示词及模型选择
- server/tools.mjs — AgentTool 定义
- server/db.mjs — SQLite、数据来源和查询白名单
- server/main.mjs — HTTP / SSE / 会话（进程内）
- web/slides.html、slides.js — PPT
- web/agent.html、agent.js — 可交互 UI
- scripts/import-weather.mjs — 南京 ERA5 导入器
- docs/teaching-guide.md — 课堂流程
- tests/ — 基础测试

## 验证与部署

    npm test
    npm start
    curl -fsS http://localhost:3000/api/datasets
    curl -N -H 'Content-Type: application/json' -d '{"message":"南京PM2.5有什么变化？"}' http://localhost:3000/api/chat

Docker：

    cp .env.example .env
    docker compose up --build -d

SQLite 挂载在宿主机 ./data。注意**不要把有密钥的 .env 推送到仓库**。

## 工程边界

本项目面向教学演示，不适合直接暴露在互联网：没有账号认证、请求限流、租户隔离、权限控制、预算或长任务恢复。Agent 当前会话上下文保存在进程内存；SQLite 会保存用户/助手的对话记录用于查询，但**重启后没有自动把完整工具上下文重建到 Agent**。Web UI 没有提供上传任意用户数据的接口。

代码 MIT，第三方统计数据和 Open-Meteo 数据保留独立署名与使用条件。见 LICENSE。
