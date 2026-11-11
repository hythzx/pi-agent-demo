# 60分钟技术分享讲解手册

对象：计算机相关专业大学生。目标：掌握 Agent Loop、Tool Calling、Context、Event，并理解 SQLite 工具如何形成独立 Web Agent。

| 时间 | 内容 | 幻灯片 |
|---|---|---|
| 0—5min | 从 LLM 到 Agent，南京数据问题 | 1—2 |
| 5—15min | Pi AI / Agent Core / Coding Agent 的边界 | 3—4 |
| 15—24min | Agent Loop，Tool Schema，白名单执行 | 5—6 |
| 24—31min | Event → SSE，真实数据的口径 | 7—8 |
| 31—37min | 讲解完整 Web 系统结构 | 9 |
| 37—50min | 现场读代码：agent.mjs → tools.mjs → main.mjs | 10 |
| 50—56min | /agent 三轮提问，观察图表及工具调用 | 11 |
| 56—60min | 生产环境边界、提问 | 12 |

## 课前检查

- npm install && npm test；Node.js 24+
- 准备 .env，接通模型，确认 /api/status 返回 live
- 用三个问题实际跑通 inspect_dataset、analyze_data、create_chart
- PPT 左右键翻页、F 全屏、N 讲者备注
- 如需展示真实天气，提前跑 npm run import:weather；不要依赖现场下载
- 备用方案：删除 .env 中的 API Key 并重启，会显示“离线脚本演示（非 LLM）”，**不要把离线脚本说成真实 Agent**

## 三轮示例

第一轮：“南京2015—2024年 PM2.5 改善了多少？请用数据分析并画图。”
第二轮：“同一段时间的优良天数比例怎样？再生成一个图。”
第三轮：“2016年的数据呢？可以得出空气质量改善的直接原因吗？”

学生应观察：2015年57、2024年28 μg/m³；2016年缺失；模型不能随意编造原因。

## 看哪些关键代码

1. server/agent.mjs：Agent、模型、工具数组、streamFn
2. server/tools.mjs：Tool 定义四要素（name / description / parameters / execute）
3. server/db.mjs：真实数据、来源与 SQL 白名单
4. server/main.mjs：订阅 message_update、tool_execution_start/end，并转 SSE
5. web/agent.js：根据事件绘图与记录工具时间线

可让学生设计第五个工具：对两项指标计算相关系数，并讨论为什么相关不能推出因果。此功能留作课后扩展，不要临时在课堂上写复杂分析。
