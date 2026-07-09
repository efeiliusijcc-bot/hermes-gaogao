# 开发记录：mixed-recall-source-garbled-label

## 完成内容

本次修复了编报结果页“混合召回”信源中出现 `?????(?)` 的显示问题。原因是前端展示来源媒体名时直接使用后端返回的 `publisher`、`websiteName` 等字段，没有过滤“全是问号、括号、空白”的乱码占位值。

修复后，前端会先清洗每个候选来源字段；如果某个字段是 `?????(?)` 这类无效值，会跳过它继续尝试后面的字段。如果所有来源名称字段都不可用，则从 URL 中提取域名作为兜底，再不行才显示“来源未知”。

## 实际改动文件

* `b_k3ewYvsOEc1/src/lib/sourceDisplay.js`：新增信源展示清洗工具，统一处理问号乱码、技术词替换、URL 域名兜底。
* `b_k3ewYvsOEc1/src/components/DataCanvas.vue`：报告信源卡片和信源概览列表统一使用清洗工具，避免 `?????(?)` 直接显示。
* `tests/source-display.test.ts`：新增测试，覆盖纯问号占位符、问号前缀、问号后缀、正常括号来源名、域名兜底等场景。

## 关键行为决策

* 本次只在前端展示层修复，不改后端召回、报告生成、数据库或资料采集逻辑，避免影响正在运行的编报任务。
* 保留正常来源名里的括号，例如 `阿尔法投资(英)`，只清理明显的乱码问号占位符。
* 字段选择改为“逐个清洗、逐个尝试”，避免第一个坏字段挡住后面可用的 `websiteName` 或域名。

## 验证结果

* `npx tsx tests/source-display.test.ts`：通过。
* `npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build`：通过。
* `git push origin main`：已执行，用于触发 Vercel 前端部署。

## 额外操作

* 本次未涉及数据库迁移。
* 本次未修改环境变量。
* 本次未新增依赖。
* 本次已提交并推送到 GitHub；前端线上部署由 Vercel 根据 `main` 分支更新自动触发。

## 已知风险

* 如果后端原始数据中的标题本身就是乱码，前端只能做展示兜底，无法恢复真实媒体名。
* 当前修复覆盖报告详情页的信源展示，不改变已经生成的报告正文内容。
* 工作区中已有 DailyAwareness 相关未提交改动，本次没有触碰这些文件。

## 后续排查入口

如果后续仍看到乱码来源，优先检查：

1. `b_k3ewYvsOEc1/src/lib/sourceDisplay.js` 的 `sanitizeSourceDisplayText` 是否覆盖该乱码模式。
2. `b_k3ewYvsOEc1/src/components/DataCanvas.vue` 中是否还有未接入清洗工具的来源展示位置。
3. `/api/report-jobs/:jobId/database-sources` 或 `/api/report-jobs/:jobId/sources` 返回的字段是否包含可用的 `publisher`、`websiteName`、`url`。
4. 如果接口返回没有任何可读来源字段，需要回到后端信源清洗或原始数据库采集链路排查。
