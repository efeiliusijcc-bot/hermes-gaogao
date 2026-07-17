import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyReportJson,
  buildDailyReportMarkdown,
  buildDailyMaterialWindow,
  buildEventCandidates,
  categoryStats,
  dailyReportTitle,
  dedupeMaterials,
  extractJsonObject,
  formatPublishedDate,
  normalizeEventTitle,
  rankDailyEvents,
  selectClassificationCandidates,
  sanitizeSourceText,
} from './daily-awareness.utils.js';
import type { DailyAwarenessMaterial, DailyAwarenessScoredEvent } from './daily-awareness.types.js';

test('builds exact and seven-day fallback material windows from target date', () => {
  const window = buildDailyMaterialWindow('2026-07-05', 24);

  assert.equal(window.exactStart, '2026-07-04T00:00:00.000Z');
  assert.equal(window.exactEnd, '2026-07-06T00:00:00.000Z');
  assert.equal(window.fallbackStart, '2026-06-28T00:00:00.000Z');
  assert.equal(window.fallbackEnd, '2026-07-06T00:00:00.000Z');
});

test('normalizes event titles for duplicate comparison', () => {
  assert.equal(normalizeEventTitle('【快讯】英国拟禁止 16 岁以下使用高风险社交媒体 - BBC'), '英国拟禁止16岁以下使用高风险社交媒体');
  assert.equal(normalizeEventTitle('英国拟禁止16岁以下使用高风险社交媒体'), '英国拟禁止16岁以下使用高风险社交媒体');
});

test('dedupes materials by url while preserving same-title sources for event aggregation', () => {
  const materials: DailyAwarenessMaterial[] = [
    { id: '1', title: '英国拟禁止16岁以下使用高风险社交媒体', content: '短内容', url: 'https://a.example/news', publisher: 'A', publishedAt: '2026-07-04T01:00:00Z', metadata: {} },
    { id: '2', title: '英国拟禁止16岁以下使用高风险社交媒体', content: '更长的内容用于保留', url: 'https://b.example/news', publisher: 'B', publishedAt: '2026-07-04T02:00:00Z', metadata: {} },
    { id: '3', title: '另一个事件', content: '正文', url: 'https://b.example/news', publisher: 'B', publishedAt: '2026-07-04T03:00:00Z', metadata: {} },
  ];

  const deduped = dedupeMaterials(materials);

  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((item) => item.id).sort(), ['1', '2']);
});

test('builds candidates with merged sources and related material ids', () => {
  const materials: DailyAwarenessMaterial[] = [
    { id: '1', title: '事件A', content: '第一条正文', url: 'https://a.example/1', publisher: 'A', publishedAt: '2026-07-04T01:00:00Z', metadata: {} },
    { id: '2', title: '事件A', content: '第二条正文', url: 'https://b.example/2', publisher: 'B', publishedAt: '2026-07-04T02:00:00Z', metadata: {} },
    { id: '3', title: '事件B', content: '第三条正文', url: 'https://c.example/3', publisher: 'C', publishedAt: '2026-07-04T03:00:00Z', metadata: {} },
  ];

  const candidates = buildEventCandidates(materials);

  assert.equal(candidates.length, 2);
  assert.deepEqual([...candidates[0].relatedMaterialIds].sort(), ['1', '2']);
  assert.equal(candidates[0].sources.length, 2);
  assert.equal(candidates[0].sourceCount, 2);
});

test('sanitizes mojibake question mark prefixes from source labels', () => {
  assert.equal(sanitizeSourceText('??????Fox News'), 'Fox News');
  assert.equal(sanitizeSourceText('Fox News?'), 'Fox News');
  assert.equal(sanitizeSourceText('CBS?'), 'CBS');
  assert.equal(sanitizeSourceText('?????(?)'), '');
  assert.equal(sanitizeSourceText('���Reuters'), 'Reuters');
  assert.equal(sanitizeSourceText('新华社'), '新华社');
});

test('ranks daily events by weighted importance and risk scores', () => {
  const events: DailyAwarenessScoredEvent[] = [
    { candidateId: 'a', eventTitle: 'A', category: '其他', region: '', basicSituation: '', backgroundContext: '', importanceJudgement: '', riskToUs: '', importanceScore: 50, riskScore: 100, sourceInfo: [], relatedMaterialIds: [] },
    { candidateId: 'b', eventTitle: 'B', category: '其他', region: '', basicSituation: '', backgroundContext: '', importanceJudgement: '', riskToUs: '', importanceScore: 100, riskScore: 50, sourceInfo: [], relatedMaterialIds: [] },
  ];

  const ranked = rankDailyEvents(events, 1);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].eventTitle, 'B');
});

test('limits classification candidates dynamically from requested output size', () => {
  const candidates = Array.from({ length: 300 }, (_, index) => ({
    candidateId: `candidate_${index}`,
    title: `事件${index}`,
    summaryText: `正文${index}`,
    sources: [],
    relatedMaterialIds: [],
    sourceCount: 1,
  }));

  assert.equal(selectClassificationCandidates(candidates, 50).items.length, 120);
  assert.equal(selectClassificationCandidates(candidates, 5).items.length, 80);
  assert.equal(selectClassificationCandidates(candidates.slice(0, 42), 50).items.length, 42);
  assert.equal(selectClassificationCandidates(candidates, 50).limit, 120);
});

test('uses 70 percent importance and 30 percent risk for daily event ranking', () => {
  const events: DailyAwarenessScoredEvent[] = [
    { candidateId: 'importance', eventTitle: 'Importance', category: '其他', region: '', basicSituation: '', backgroundContext: '', importanceJudgement: '', riskToUs: '', importanceScore: 90, riskScore: 0, sourceInfo: [], relatedMaterialIds: [] },
    { candidateId: 'risk', eventTitle: 'Risk', category: '其他', region: '', basicSituation: '', backgroundContext: '', importanceJudgement: '', riskToUs: '', importanceScore: 59, riskScore: 70, sourceInfo: [], relatedMaterialIds: [] },
  ];

  const ranked = rankDailyEvents(events, 2);

  assert.equal(ranked[0].eventTitle, 'Importance');
});

test('extracts a JSON object from fenced model output', () => {
  const parsed = extractJsonObject('```json\n{"events":[{"eventTitle":"测试"}]}\n```');

  assert.deepEqual(parsed, { events: [{ eventTitle: '测试' }] });
});

test('builds daily report title with fallback marker', () => {
  assert.equal(dailyReportTitle('2026-07-05'), '2026-07-05 每日动态简报');
  assert.equal(dailyReportTitle('2026-07-05', true), '2026-07-05 每日动态简报（使用最近可用信源）');
});

test('builds report json grouped by news category', () => {
  const events: DailyAwarenessScoredEvent[] = [
    {
      candidateId: 'a',
      eventTitle: '国际安全新闻',
      category: '国际安全',
      region: '',
      basicSituation: '一百字以内的简要内容',
      backgroundContext: '',
      importanceJudgement: '',
      riskToUs: '',
      importanceScore: 92,
      riskScore: 0,
      sourceInfo: [{ title: '来源标题', publisher: '新华社', publishedAt: '2026-07-05T01:00:00Z', url: 'https://example.com/a' }],
      relatedMaterialIds: [],
    },
    {
      candidateId: 'b',
      eventTitle: '美国政治新闻',
      category: '美国政治',
      region: '',
      basicSituation: '另一条简要内容',
      backgroundContext: '',
      importanceJudgement: '',
      riskToUs: '',
      importanceScore: 88,
      riskScore: 0,
      sourceInfo: [],
      relatedMaterialIds: [],
    },
  ];

  const reportJson = buildDailyReportJson(events);

  assert.equal(reportJson.sections.length, 2);
  assert.equal(reportJson.sections[0].category, '国际安全');
  assert.equal(reportJson.sections[0].items[0].title, '国际安全新闻');
  assert.equal(reportJson.sections[0].items[0].publisher, '新华社');
});

test('builds daily report markdown with overview, distribution, news and fallback notice', () => {
  const events: DailyAwarenessScoredEvent[] = [
    {
      candidateId: 'a',
      eventTitle: '法案正式文本发布',
      category: '国际安全',
      region: '',
      basicSituation: '简要内容：法案正式文本发布，监管重点进一步明确。',
      backgroundContext: '',
      importanceJudgement: '',
      riskToUs: '',
      importanceScore: 90,
      riskScore: 0,
      sourceInfo: [{ title: '来源标题', publisher: 'BBC', publishedAt: '2026-07-05T01:00:00Z', url: 'https://example.com/a' }],
      relatedMaterialIds: [],
    },
    {
      candidateId: 'b',
      eventTitle: '企业发布回应',
      category: '科技产业',
      region: '',
      basicSituation: '简要内容：相关企业发布最新回应。',
      backgroundContext: '',
      importanceJudgement: '',
      riskToUs: '',
      importanceScore: 80,
      riskScore: 0,
      sourceInfo: [{ title: '来源标题', publisher: 'Reuters', publishedAt: '2026-07-05T02:00:00Z', url: 'https://example.com/b' }],
      relatedMaterialIds: [],
    },
  ];

  const stats = categoryStats(events);
  const markdown = buildDailyReportMarkdown({
    date: '2026-07-05',
    title: dailyReportTitle('2026-07-05', true),
    summary: '',
    materialCount: 2186,
    selectedCount: 2,
    categoryStats: stats,
    events,
    usedFallback: true,
  });

  assert.match(markdown, /^# 2026-07-05 每日动态简报（使用最近可用信源）/);
  assert.match(markdown, /今日共从 2186 条候选新闻中筛选出 2 条重点新闻/);
  assert.match(markdown, /国际安全：1 条/);
  assert.match(markdown, /1\. 法案正式文本发布/);
  assert.match(markdown, /来源：BBC，发布时间：2026-07-05/);
  assert.doesNotMatch(markdown, /发布时间：2026-07-05T/);
  assert.match(markdown, /已使用最近 7 天可用信源生成简报/);
});

test('formats published times as calendar dates', () => {
  assert.equal(formatPublishedDate('2026-07-15T06:06:00.000Z'), '2026-07-15');
  assert.equal(formatPublishedDate('2026-07-15 06:06:00'), '2026-07-15');
  assert.equal(formatPublishedDate(''), '时间未知');
});

test('numbers grouped markdown items sequentially within each category', () => {
  const event = (candidateId: string, eventTitle: string, category: string): DailyAwarenessScoredEvent => ({
    candidateId,
    eventTitle,
    category,
    region: '',
    basicSituation: `${eventTitle}简要内容`,
    backgroundContext: '',
    importanceJudgement: '',
    riskToUs: '',
    importanceScore: 90,
    riskScore: 80,
    sourceInfo: [],
    relatedMaterialIds: [],
  });
  const events = [
    event('a-1', '涉华新闻一', '涉华'),
    event('b-1', '危安新闻一', '危安'),
    event('a-2', '涉华新闻二', '涉华'),
  ];
  const markdown = buildDailyReportMarkdown({
    date: '2026-07-17',
    title: dailyReportTitle('2026-07-17'),
    summary: '测试摘要',
    materialCount: 3,
    selectedCount: 3,
    categoryStats: categoryStats(events),
    events,
  });
  const involvedChinaSection = markdown.split('### （一）涉华')[1].split('### （二）危安')[0];
  const securitySection = markdown.split('### （二）危安')[1].split('## 四、可进一步研判方向')[0];

  assert.match(involvedChinaSection, /1\. 涉华新闻一/);
  assert.match(involvedChinaSection, /2\. 涉华新闻二/);
  assert.doesNotMatch(involvedChinaSection, /3\. 涉华新闻二/);
  assert.match(securitySection, /1\. 危安新闻一/);
});
