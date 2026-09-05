---
name: write-hb
description: 生成 K 报或 HB 报。消费后端已准备的任务上下文和数据库信源，通过统一 Research Harness 完成公开资料采集、整合、撰写和校验。
---

# Write HB 生产编报流程

本 Skill 适用于正式 K 报和 HB 报。质量优先，但不得重复执行已经由后端或 Research Harness 完成的工作。

## 路径

- 报告根目录：`/opt/data/workspace/report-agent/reports`
- Research Harness：`/opt/data/workspace/report-agent/skills/web-research-firecrawl/scripts/harness_cli.py`
- 研究密钥文件：`/opt/data/workspace/report-agent/config/research-keys.env`
- 当前任务目录：`/opt/data/workspace/report-agent/reports/{jobId}`
- 最终报告：`/opt/data/workspace/report-agent/reports/{jobId}/final/report.md`

`jobId` 必须使用请求中给定的完整值，不得缩写、替换或创建第二个任务目录。

## 唯一执行流程

1. 读取后端已经准备好的 `{jobId}/context.json`。不得在对话中重建、复制或改写完整上下文。
2. 读取 `{jobId}/database/database_query_plan.json`、`database_sources.json` 和 `vector_sources.json`（存在时）。这些文件已经完成数据库召回、实体校验、去重和字段裁剪。
3. 不得再次调用 `pg-sources__query`、`mysql-test__mysql_query` 或其他数据库工具。数据库空结果不是任务失败，继续公开资料采集。
4. 加载研究密钥后，只执行一次：

   ```bash
   set -a; [ -f /opt/data/workspace/report-agent/config/research-keys.env ] && . /opt/data/workspace/report-agent/config/research-keys.env; set +a; python /opt/data/workspace/report-agent/skills/web-research-firecrawl/scripts/harness_cli.py orchestrate --job-id {jobId}
   ```

5. `orchestrate` 负责规划、最多三组并行研究、去重整合和最多一次缺口补充。成功后必须存在：
   - `plan.json`
   - 至少一个 `groups/group_*.json`
   - 至少一个 `research/research_*.json`
   - `research/consolidated.json`
   - `research/synthesis_packet.json`
6. 不得再运行 `harness_cli.py plan`、`harness_cli.py run`、`research_cli.py brief`，不得启动独立研究 Agent、独立资料采集 Agent或独立撰稿 Agent。
7. 优先读取 `research/synthesis_packet.json` 撰写。仅当某个必写章节缺少证据细节时，按需读取 `research/consolidated.json` 或对应 `research_*.json`，不得把全部长制品重复塞入上下文。
8. 由当前主 Agent 直接把完整 Markdown 成稿写入 `{jobId}/final/report.md`。
9. 运行现有 `scripts/validate_report.py` 校验最终文件。若失败，只修复成稿中对应问题并复验，不得重跑完整研究流程。
10. 校验通过并生成 `references/report_references.json` 后，将这三个交付文件及引用目录交给后端运行账户：先执行 `chown 1000:1000 /opt/data/workspace/report-agent/reports/{jobId}/final/report.md /opt/data/workspace/report-agent/reports/{jobId}/final/summary.json /opt/data/workspace/report-agent/reports/{jobId}/references /opt/data/workspace/report-agent/reports/{jobId}/references/report_references.json`，再执行 `chmod 0755 /opt/data/workspace/report-agent/reports/{jobId}/references` 和 `chmod 0644 /opt/data/workspace/report-agent/reports/{jobId}/final/report.md /opt/data/workspace/report-agent/reports/{jobId}/final/summary.json /opt/data/workspace/report-agent/reports/{jobId}/references/report_references.json`。最后用 `test -r /opt/data/workspace/report-agent/reports/{jobId}/final/report.md && test -w /opt/data/workspace/report-agent/reports/{jobId}/references/report_references.json` 确认后端可读取成稿并更新引用清单。不得跳过此步骤，也不得把任务目录或配置文件改成宽松权限。
11. 最终响应只能是一行：`REPORT_FILE: /opt/data/workspace/report-agent/reports/{jobId}/final/report.md`

## 研究与信源约束

- 公开研究必须经过 Research Harness。不得以 Hermes 原生 `web_search`、`web_extract` 或浏览器工具替代正常 Harness 流程。
- Tavily、Exa、Firecrawl 可独立降级；至少一个渠道形成有效来源时可以继续，但必须保留真实错误和信息缺口。
- 仅使用通过实体和主题校验的数据库信源、Harness 证据、用户指定信源和用户材料。
- `uncertain`、`rejected`、实体错配、只有向量相似或无法回指来源的内容不得写成已确认事实。
- 同一事实尽量使用两个相互独立来源交叉核验；冲突信息标记“待核实”。
- 不得编造来源、URL、发布时间、机构表态、数字或引语。
- `synthesis_packet.json` 中的 `gaps` 和 `verification_needed` 必须在相关章节或文末信息缺口中体现。

## 成稿质量

- 严格按照请求中的 `report_type`、`selectedModules`、`selectedDirections` 和参数撰写。
- 每个用户选定方向都必须有实质内容；证据不足时写为信息缺口或监测点，不能静默省略。
- K 报最终正文目标约 9000 至 11000 个中文字符，最低 8000 个中文字符。只能增加事实密度、分析层次、风险链条和可执行建议，不得堆砌空话或重复内容凑篇幅。
- 定向扩写使用锚点替换时，写入前必须确认锚点在目标文件中只出现一次；若重复，立即改用更长且唯一的上下文锚点，不得执行会触发断言失败的替换，也不得重跑完整研究流程。
- K 报固定结构：标题、编号、签发日期、无标题开场自然段、`一、基本情况`、`二、涉我风险`、`三、对策建议`、`四、参考资料`。
- K 报不得出现独立的“导语”“摘要”“导语/摘要”小标题。
- 涉我风险使用“一是、二是、三是、四是”加粗段首；对策建议使用“一是、二是、三是”加粗段首，不增加额外一级章节。
- HB 报按请求和既有模板组织，保持事实、研判、风险、建议和信息缺口层级清晰。
- 正文关键事实必须能回指文末参考资料；正文不直接展示 URL，完整 URL 只放在参考资料。
- 文末每条参考资料必须独立成段，相邻编号资料之间保留一个空行，不得仅用单换行连续书写。
- 来源标题、机构、发布时间和 URL 能保留的必须保留；发布时间未知统一如实留空或标记待核实。
- 正文、标题、来源和文件名不得含 Unicode 替换字符或明显乱码。

## 技术与安全边界

- 不输出或记录密钥、令牌、数据库连接信息、SQL、表名、内部绝对路径、原始长文本、模型推理或隐藏提示词。
- 用户可见日志只描述真实已发生的工具和阶段事件；没有事件时可以由系统显示明确标记的心跳，不得伪造 Agent 动作。
- 不执行写数据库、删除信源、修改系统配置或任务目录外的文件操作。
- Harness 失败或必需制品缺失时明确失败，不自动重复完整流水线，不用空报告伪装成功。
