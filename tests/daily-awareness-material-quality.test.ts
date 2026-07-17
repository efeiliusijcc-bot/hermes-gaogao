import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDailyAwarenessMaterials } from '../server/daily-awareness-material.service.js';
import type { DailyAwarenessMaterial } from '../server/daily-awareness.types.js';

function material(overrides: Partial<DailyAwarenessMaterial>): DailyAwarenessMaterial {
  return {
    id: overrides.id || 'material-1',
    title: overrides.title ?? '标题',
    summary: overrides.summary ?? '摘要',
    content: overrides.content ?? '',
    url: overrides.url ?? 'https://example.com/1',
    publisher: overrides.publisher ?? '来源',
    publishedAt: overrides.publishedAt ?? '2026-07-16T08:00:00.000Z',
    metadata: overrides.metadata ?? {},
  };
}

test('keeps titled materials when summary is empty and calculates partial quality', () => {
  const prepared = prepareDailyAwarenessMaterials([
    material({ id: 'with-summary', title: '有摘要', summary: '摘要内容', url: 'https://example.com/a' }),
    material({ id: 'title-only', title: '只有标题', summary: '', content: '', url: 'https://example.com/b' }),
    material({ id: 'no-title', title: '', summary: '无标题摘要', url: 'https://example.com/c' }),
  ], 1200);

  assert.equal(prepared.sourceCount, 2);
  assert.equal(prepared.summaryCount, 1);
  assert.equal(prepared.titleOnlyCount, 1);
  assert.equal(prepared.skippedCount, 1);
  assert.equal(prepared.qualityStatus, 'PARTIAL_SUMMARY');
  assert.equal(prepared.candidates.find((item) => item.title === '只有标题')?.summaryText, '只有标题');
});

test('marks all title-only materials as TITLE_ONLY and preserves source summaries', () => {
  const titleOnly = prepareDailyAwarenessMaterials([
    material({ id: 'a', title: '事件A', summary: '', url: 'https://example.com/a' }),
    material({ id: 'b', title: '事件B', summary: '', url: 'https://example.com/b' }),
  ], 100);
  assert.equal(titleOnly.qualityStatus, 'TITLE_ONLY');

  const normal = prepareDailyAwarenessMaterials([
    material({ id: 'long', title: '长摘要', summary: '甲'.repeat(180), url: 'https://example.com/long' }),
  ], 100);
  assert.equal(normal.qualityStatus, 'NORMAL');
  assert.equal(normal.materials[0].summary?.length, 180);
});

test('preserves multiple sources for the same normalized title after URL dedupe', () => {
  const prepared = prepareDailyAwarenessMaterials([
    material({ id: 'a', title: '【快讯】事件A - BBC', summary: '来源一', url: 'https://example.com/a', publisher: 'BBC' }),
    material({ id: 'b', title: '事件A', summary: '来源二', url: 'https://example.com/b', publisher: 'Reuters' }),
    material({ id: 'duplicate-url', title: '事件A', summary: '短', url: 'https://example.com/b', publisher: 'Duplicate' }),
  ], 1200);

  assert.equal(prepared.materials.length, 2);
  assert.equal(prepared.candidates.length, 1);
  assert.equal(prepared.candidates[0].sourceCount, 2);
  assert.equal(prepared.candidates[0].sources.length, 2);
  assert.deepEqual([...prepared.candidates[0].relatedMaterialIds].sort(), ['a', 'b']);
});

test('keeps source category, tag, and summary while building scoring input', async () => {
  const { buildDailyAwarenessScoringPayload } = await import('../server/daily-awareness.utils.js');
  const candidates = [{
    candidateId: 'candidate-1',
    title: '标题',
    summaryText: 'MySQL 原始摘要，不应发送给评分模型',
    category: '涉政',
    tag: '选举',
    sources: [],
    relatedMaterialIds: ['row-1'],
    sourceCount: 1,
  }];

  assert.deepEqual(buildDailyAwarenessScoringPayload(candidates), [{
    candidateId: 'candidate-1',
    title: '标题',
    category: '涉政',
    tag: '选举',
  }]);
  assert.equal(JSON.stringify(buildDailyAwarenessScoringPayload(candidates)).includes('原始摘要'), false);
});

test('uses the candidate summary and category instead of model-written brief fields', async () => {
  const { applyDailyAwarenessScores } = await import('../server/daily-awareness.utils.js');
  const candidates = [{
    candidateId: 'candidate-1',
    title: '标题',
    summaryText: 'MySQL 原始摘要',
    category: '危安',
    tag: '冲突',
    sources: [],
    relatedMaterialIds: ['row-1'],
    sourceCount: 1,
  }];

  assert.deepEqual(applyDailyAwarenessScores(candidates, [{
    candidateId: 'candidate-1',
    importanceScore: 88,
    riskScore: 42,
    briefContent: '模型重写内容',
    category: '模型分类',
  }]), [{
    candidateId: 'candidate-1',
    eventTitle: '标题',
    category: '危安',
    region: '',
    basicSituation: 'MySQL 原始摘要',
    backgroundContext: '',
    importanceJudgement: '',
    riskToUs: '',
    importanceScore: 88,
    riskScore: 42,
    sourceInfo: [],
    relatedMaterialIds: ['row-1'],
  }]);
});
