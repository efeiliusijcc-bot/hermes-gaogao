import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyMaterialWindow,
  buildEventCandidates,
  dedupeMaterials,
  extractJsonObject,
  normalizeEventTitle,
  rankDailyEvents,
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

test('dedupes materials by url and normalized title while preserving richer content', () => {
  const materials: DailyAwarenessMaterial[] = [
    { id: '1', title: '英国拟禁止16岁以下使用高风险社交媒体', content: '短内容', url: 'https://a.example/news', publisher: 'A', publishedAt: '2026-07-04T01:00:00Z', metadata: {} },
    { id: '2', title: '英国拟禁止16岁以下使用高风险社交媒体', content: '更长的内容用于保留', url: 'https://b.example/news', publisher: 'B', publishedAt: '2026-07-04T02:00:00Z', metadata: {} },
    { id: '3', title: '另一个事件', content: '正文', url: 'https://b.example/news', publisher: 'B', publishedAt: '2026-07-04T03:00:00Z', metadata: {} },
  ];

  const deduped = dedupeMaterials(materials);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, '2');
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

test('ranks daily events by weighted importance and risk scores', () => {
  const events: DailyAwarenessScoredEvent[] = [
    { candidateId: 'a', eventTitle: 'A', category: '其他', region: '', basicSituation: '', backgroundContext: '', importanceJudgement: '', riskToUs: '', importanceScore: 50, riskScore: 100, sourceInfo: [], relatedMaterialIds: [] },
    { candidateId: 'b', eventTitle: 'B', category: '其他', region: '', basicSituation: '', backgroundContext: '', importanceJudgement: '', riskToUs: '', importanceScore: 100, riskScore: 50, sourceInfo: [], relatedMaterialIds: [] },
  ];

  const ranked = rankDailyEvents(events, 1);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].eventTitle, 'B');
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
