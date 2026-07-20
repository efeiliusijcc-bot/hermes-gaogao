import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyAwarenessQueryService } from '../server/daily-awareness-query.service.js';

type Row = Record<string, unknown>;

function brief(id: string, date: string): Row {
  return {
    brief_id: id,
    brief_date: date,
    title: `${date} 每日动态简报`,
    summary: '概览',
    status: 'completed',
    categories: [{ category: '国际安全', count: 1 }],
    content_json: { categoryDistribution: { 国际安全: 1 } },
    content_markdown: '# 每日动态简报',
    publication_scope: 'GLOBAL',
    quality_status: 'NORMAL',
    selected_count: 50,
    generated_at: `${date}T08:00:00.000Z`,
    generated_by_type: 'SYSTEM',
  };
}

function serviceFor(status: Row | null, briefs: Row[]) {
  const service = new DailyAwarenessQueryService() as DailyAwarenessQueryService & {
    getPool: () => Promise<{ query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }> }>;
  };
  service.getPool = async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM daily_awareness_day_status')) return { rows: status ? [status] : [] };
      if (sql.includes('FROM daily_briefs') && sql.includes('brief_id = $1')) {
        return { rows: briefs.filter((item) => item.brief_id === params[0]) };
      }
      if (sql.includes('FROM daily_briefs') && sql.includes('brief_date = $1::date')) {
        return { rows: briefs.filter((item) => item.brief_date === params[0]) };
      }
      if (sql.includes('FROM daily_briefs') && sql.includes('ORDER BY brief_date DESC')) {
        return { rows: briefs.slice().sort((a, b) => String(b.brief_date).localeCompare(String(a.brief_date))).slice(0, 1) };
      }
      if (sql.includes('FROM daily_brief_events')) return { rows: [] };
      return { rows: [] };
    },
  });
  return service;
}

test('current returns today global brief when generation succeeded', async () => {
  const today = brief('brief-today', '2026-07-16');
  const service = serviceFor({
    business_date: '2026-07-16',
    data_status: 'READY',
    generation_status: 'SUCCESS',
    quality_status: 'NORMAL',
    current_brief_id: 'brief-today',
  }, [today]);

  const result = await service.current('2026-07-16');

  assert.equal(result.messageCode, 'TODAY_READY');
  assert.equal(result.businessDate, '2026-07-16');
  assert.equal(result.displayedBrief?.businessDate, '2026-07-16');
});

test('history exposes the actual selected item count', async () => {
  const item = brief('brief-today', '2026-07-20');
  const service = serviceFor(null, [item]);

  const result = await service.history({ page: 1, pageSize: 20 });

  assert.equal(result.items[0]?.selectedCount, 50);
});

for (const scenario of [
  { dataStatus: 'NO_DATA', generationStatus: 'NOT_REQUIRED', messageCode: 'TODAY_NO_DATA' },
  { dataStatus: 'READY', generationStatus: 'GENERATING', messageCode: 'TODAY_GENERATING' },
  { dataStatus: 'READY', generationStatus: 'GENERATION_FAILED', messageCode: 'TODAY_GENERATION_FAILED' },
] as const) {
  test(`current falls back to latest successful brief for ${scenario.generationStatus}`, async () => {
    const previous = brief('brief-previous', '2026-07-15');
    const service = serviceFor({
      business_date: '2026-07-16',
      data_status: scenario.dataStatus,
      generation_status: scenario.generationStatus,
      quality_status: null,
      current_brief_id: null,
    }, [previous]);

    const result = await service.current('2026-07-16');

    assert.equal(result.messageCode, scenario.messageCode);
    assert.equal(result.businessDate, '2026-07-16');
    assert.equal(result.displayedBrief?.businessDate, '2026-07-15');
  });
}

test('current returns waiting state and null brief when no status or history exists', async () => {
  const result = await serviceFor(null, []).current('2026-07-16');

  assert.equal(result.dataStatus, 'WAITING');
  assert.equal(result.generationStatus, 'WAITING');
  assert.equal(result.messageCode, 'NO_SUCCESSFUL_BRIEF');
  assert.equal(result.displayedBrief, null);
});

test('exact date lookup never falls back to another date', async () => {
  const service = serviceFor(null, [brief('brief-previous', '2026-07-15')]);

  await assert.rejects(
    () => service.byDate('2026-07-16'),
    (error) => {
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as { error?: string } | undefined;
      return response?.error === 'Daily brief not found';
    },
  );
});
