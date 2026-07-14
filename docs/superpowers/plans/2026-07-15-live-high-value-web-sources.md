# 编报过程高价值联网信源展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有编报信源面板中，运行时同时展示数据库召回与高价值联网搜索信源，并明确标注来源分类。

**Architecture:** 后端信源聚合同时读取 API artifact 与 `HERMES_SHARED_REPORT_ROOT/<jobId>/research`，筛选 evidence card、可信度不低于 0.8 或已由 Web Supplement 接受的来源，再按规范化 URL 去重。前端复用现有信源页签和表格，在任务运行且信源页签可见时每 5 秒刷新当前分类，并显示“数据库召回”或“联网搜索采集”。

**Tech Stack:** NestJS 11、TypeScript strict、Vue 3、Vite、Node `assert` 脚本测试。

## Global Constraints

- 不修改深度编报任务执行顺序、调研子任务、Tavily 搜索、数据库混合检索、报告生成和质量检查逻辑。
- 不修改现有 API 路由或响应的分页结构。
- 不改变现有页面布局和主题。
- 不操作、重启、替换或修改云节点上的 `gaogao-api` 容器。
- 目录或单个 JSON 文件读取失败不得阻断数据库信源展示或编报主流程。
- 先写失败测试并观察 RED，再写最小实现得到 GREEN。

---

### Task 1: 后端双目录高价值联网信源聚合

**Files:**
- Create: `tests/report-live-tool-search-sources.test.ts`
- Modify: `server/reports.service.ts:5253-5382`
- Test: `tests/report-source-artifact-persistence.test.ts`
- Test: `tests/source-channel-report-ref-filter.test.ts`

**Interfaces:**
- Consumes: `HERMES_SHARED_REPORT_ROOT` 环境变量、`RemoteFileService`、现有 `normalizeToolSearchSourceItem()`。
- Produces: `toolSearchSources(job): Promise<ReportSourceListItem[]>`，最多返回 50 条 `sourceGroup='tool_search'` 的高价值来源。
- Produces: `toolSearchResearchDirs(job): Promise<string[]>`，返回 artifact 与共享 Hermes research 目录并去重。
- Produces: `isHighValueToolSearchItem(item, evidenceKind): boolean`，实现统一高价值判定。
- Produces: `canonicalToolSearchUrl(url): string`，用于联网渠道内 URL 去重。

- [ ] **Step 1: 写双目录、高价值筛选和 URL 去重失败测试**

测试进程在动态导入 `ReportsService` 前设置共享目录：

```ts
process.env.HERMES_SHARED_REPORT_ROOT = '/app/hermes-inbox';
const { ReportsService } = await import('../server/reports.service.js');
```

构造：

```ts
const files = {
  '/app/storage/artifacts/job-1/research/consolidated.json': JSON.stringify({
    sources: [{
      title: 'Accepted supplement',
      url: 'https://example.com/accepted?utm_source=artifact',
      engine: 'tavily',
      sourceQuality: { status: 'accepted', score: 0.9 },
    }],
  }),
  '/app/hermes-inbox/job-1/research/research_A.json': JSON.stringify({
    sources: [
      { title: 'High source', url: 'https://example.com/high?utm_source=one', engine: 'tavily', credibility_score: 0.95, credibility_tier: 'high' },
      { title: 'Duplicate high source', url: 'https://example.com/high?utm_medium=two', engine: 'tavily', credibility_score: 0.8, credibility_tier: 'medium-high' },
      { title: 'Low source', url: 'https://example.com/low', engine: 'tavily', credibility_score: 0.5 },
    ],
    evidence_cards: [
      { title: 'Evidence source', url: 'https://example.com/evidence', engine: 'web_fetch' },
    ],
  }),
};
```

断言：

```ts
assert.deepEqual(sources.map((item) => item.url).sort(), [
  'https://example.com/accepted?utm_source=artifact',
  'https://example.com/evidence',
  'https://example.com/high?utm_source=one',
].sort());
assert.ok(sources.every((item) => item.sourceGroup === 'tool_search'));
assert.ok(!sources.some((item) => item.url.includes('/low')));
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx tests/report-live-tool-search-sources.test.ts`

Expected: FAIL，因为当前实现只读取 artifact 目录，并且未进行高价值筛选或规范化 URL 去重。

- [ ] **Step 3: 实现双目录发现和容错读取**

在 `server/reports.service.ts` 中从配置读取共享根目录，并构造目录集合：

```ts
private async toolSearchResearchDirs(job: JobRecord): Promise<string[]> {
  const dirs = new Set<string>();
  dirs.add(this.remoteFs.joinPath(this.remoteFs.remoteDir, job.jobId, 'research'));
  const sharedRoot = String(process.env.HERMES_SHARED_REPORT_ROOT || '').trim();
  if (sharedRoot) dirs.add(this.remoteFs.joinPath(sharedRoot, job.jobId, 'research'));
  const resolved = await this.resolveHermesJobDir(job);
  if (resolved) dirs.add(this.remoteFs.joinPath(resolved, 'research'));
  return [...dirs];
}
```

`toolSearchSources()` 遍历每个目录的 `consolidated.json` 和 `research_*.json`；任一读取或 `readdir` 失败只跳过该目录。

- [ ] **Step 4: 实现高价值判定**

```ts
private isHighValueToolSearchItem(item: unknown, evidenceKind: ReportEvidenceKind): boolean {
  if (!item || typeof item !== 'object') return false;
  if (evidenceKind === 'evidence_card') return true;
  const source = item as Record<string, unknown>;
  const credibility = this.firstNumber(source, ['credibility_score', 'credibilityScore']) || 0;
  const tier = this.firstString(source, ['credibility_tier', 'credibilityTier']).toLowerCase();
  const quality = source.sourceQuality;
  const qualityObject = quality && typeof quality === 'object' ? quality as Record<string, unknown> : {};
  const qualityScore = typeof quality === 'number'
    ? quality
    : this.firstNumber(qualityObject, ['score']) || 0;
  const accepted = this.firstString(qualityObject, ['status']).toLowerCase() === 'accepted';
  const normalizedQualityScore = qualityScore > 1 ? qualityScore / 100 : qualityScore;
  return credibility >= 0.8 || ['high', 'medium-high'].includes(tier) || accepted || normalizedQualityScore >= 0.8;
}
```

`sourceQuality` 的数值按量纲归一化：`0-1` 直接使用，`1-100` 除以 100；不得把 `2-79` 误判为高价值。

要求 URL 非空；evidence card 的 `web_fetch` 允许映射为 `tavily_extract` 或由同 URL 的 Tavily source 补齐引擎。

- [ ] **Step 5: 实现联网渠道规范化 URL 去重与优先保留**

规范化时移除 fragment 和 `utm_*`、`iref`、`ref`、`source` 等跟踪参数。按规范化 URL 合并时比较 evidence card、可信度、摘要/正文完整度，保留更高价值记录；输出仍保留原始可访问 URL。

```ts
private canonicalToolSearchUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|iref|ref|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}
```

- [ ] **Step 6: 运行后端测试确认 GREEN**

Run:

```bash
npx tsx tests/report-live-tool-search-sources.test.ts
npx tsx tests/report-source-artifact-persistence.test.ts
npx tsx tests/source-channel-report-ref-filter.test.ts
npx tsx tests/source-cross-channel-dedup.test.ts
```

Expected: 全部 PASS；现有 Web Supplement accepted 来源保持可见。

- [ ] **Step 7: 提交后端聚合改动**

```bash
git add server/reports.service.ts tests/report-live-tool-search-sources.test.ts
git commit -m "feat: expose high-value live web sources"
```

---

### Task 2: 前端来源分类和运行中自动刷新

**Files:**
- Create: `tests/frontend-live-source-refresh.test.ts`
- Modify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue:228-280,3320-3362,3594-3669,3845-3945,5890-5923`

**Interfaces:**
- Consumes: `/api/report-jobs/:jobId/sources` 现有分页响应及 `sourceGroup`。
- Produces: `sourceChannelLabel(source): string`，返回“数据库召回”“联网搜索采集”或现有来源类型。
- Produces: `startSourceAutoRefresh()` / `stopSourceAutoRefresh()`，仅在运行任务的信源页签中维持 5 秒刷新。
- Produces: `loadSourceListPage(page, { preserveOnError })`，自动刷新失败时保留现有列表。

- [ ] **Step 1: 写分类标签和自动刷新失败测试**

新增静态契约测试读取 `DataCanvas.vue`：

```ts
const component = fs.readFileSync(
  new URL('../b_k3ewYvsOEc1/src/components/DataCanvas.vue', import.meta.url),
  'utf8',
);
assert.match(component, /const SOURCE_AUTO_REFRESH_MS = 5000/);
assert.match(component, /function startSourceAutoRefresh\(/);
assert.match(component, /function stopSourceAutoRefresh\(/);
assert.match(component, /function sourceChannelLabel\(/);
assert.match(component, /数据库召回/);
assert.match(component, /联网搜索采集/);
assert.match(component, /preserveOnError/);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx tsx tests/frontend-live-source-refresh.test.ts`

Expected: FAIL，缺少定时刷新和渠道标签函数。

- [ ] **Step 3: 实现来源分类标签**

```js
function sourceChannelLabel(source) {
  if (source?.sourceGroup === 'database_recall') return '数据库召回'
  if (source?.sourceGroup === 'tool_search') return '联网搜索采集'
  if (source?.sourceGroup === 'crawler') return '资料采集'
  return source?.sourceType || '--'
}
```

表格“来源类型”列改为：

```vue
<span class="source-type-pill">{{ sourceChannelLabel(source) }}</span>
```

- [ ] **Step 4: 实现 5 秒自动刷新生命周期**

```js
const SOURCE_AUTO_REFRESH_MS = 5000
let sourceAutoRefreshTimer = null

function shouldAutoRefreshSources() {
  return activeResultTab.value === 'sources' &&
    Boolean(props.job?.jobId) &&
    ['queued', 'running'].includes(String(props.job?.status || '').toLowerCase())
}

function stopSourceAutoRefresh() {
  if (sourceAutoRefreshTimer) window.clearInterval(sourceAutoRefreshTimer)
  sourceAutoRefreshTimer = null
}

function startSourceAutoRefresh() {
  stopSourceAutoRefresh()
  if (!shouldAutoRefreshSources()) return
  sourceAutoRefreshTimer = window.setInterval(() => {
    if (!sourceListLoading.value) void loadSourceListPage(1, { preserveOnError: true })
  }, SOURCE_AUTO_REFRESH_MS)
}
```

监听 `activeResultTab`、`jobId`、`job.status`，并在 `onBeforeUnmount` 调用 `stopSourceAutoRefresh()`。

- [ ] **Step 5: 保留自动刷新失败前的数据**

将签名调整为：

```js
async function loadSourceListPage(page = 1, { preserveOnError = false } = {})
```

catch 分支最前面增加：

```js
if (preserveOnError && sourceListItems.value.length) {
  sourceListError.value = ''
  return
}
```

- [ ] **Step 6: 运行前端契约和构建确认 GREEN**

Run:

```bash
npx tsx tests/frontend-live-source-refresh.test.ts
npx tsx tests/source-display.test.ts
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
```

Expected: 测试 PASS，Vite build exit 0。

- [ ] **Step 7: 提交前端改动**

```bash
git add b_k3ewYvsOEc1/src/components/DataCanvas.vue tests/frontend-live-source-refresh.test.ts
git commit -m "feat: refresh categorized report sources live"
```

---

### Task 3: 集成验证、部署和线上验收

**Files:**
- Verify: `server/reports.service.ts`
- Verify: `b_k3ewYvsOEc1/src/components/DataCanvas.vue`
- Verify: `deploy.sh`

**Interfaces:**
- Consumes: Task 1 的高价值 `tool_search` 响应与 Task 2 的自动刷新。
- Produces: 生产环境中可观察的数据库召回与联网搜索采集分类列表。

- [ ] **Step 1: 运行完整相关回归**

```bash
npx tsx tests/report-live-tool-search-sources.test.ts
npx tsx tests/report-source-artifact-persistence.test.ts
npx tsx tests/source-channel-report-ref-filter.test.ts
npx tsx tests/source-cross-channel-dedup.test.ts
npx tsx tests/source-display.test.ts
npx tsx tests/frontend-live-source-refresh.test.ts
npx tsx tests/hermes-report-artifact-sync.test.ts
npx tsx tests/reports-context-source-filter.test.ts
npx pnpm@9.15.9 build
npx pnpm@9.15.9 --dir b_k3ewYvsOEc1 build
bash -n deploy.sh
git diff --check
```

Expected: 所有测试和构建 exit 0。

- [ ] **Step 2: 部署后端，明确保护 `gaogao-api`**

Run: `bash deploy.sh`

Expected: 只替换 `hermes-api`；部署前后记录 `gaogao-api` 容器 ID、启动时间和镜像 ID并确认完全一致。

- [ ] **Step 3: 验证生产 API 分类与高价值过滤**

对运行中或最近任务调用：

```text
GET /api/report-jobs/:jobId/sources?type=all&page=1&pageSize=100
GET /api/report-jobs/:jobId/sources?type=tool_search&page=1&pageSize=100
```

验收：

- `type=all` 同时包含 `database_recall` 和 `tool_search`；
- `tool_search` 只包含 evidence card、`credibility_score >= 0.8`、`high/medium-high` 或 accepted Web Supplement；
- 规范化 URL 无重复；
- 当前美伊任务应展示约 8 条高价值联网信源，而不是全部 57 条；
- 数据库信源数量和编报状态不被改写。

- [ ] **Step 4: 浏览器验证运行中刷新**

打开编报任务的信源页签，确认：

- “全部”同时展示两类来源；
- 每条显示“数据库召回”或“联网搜索采集”；
- 任务运行时网络面板约每 5 秒请求 sources API；
- 切换离开信源页签或任务完成后停止请求；
- 没有布局跳动、文本重叠或列表被错误清空。

- [ ] **Step 5: 最终提交并推送当前独立分支**

```bash
git status --short --branch
git push origin codex/hybrid-retrieval-b
```

Expected: 工作区干净，远端分支指向最新提交；不直接修改 `main`。
