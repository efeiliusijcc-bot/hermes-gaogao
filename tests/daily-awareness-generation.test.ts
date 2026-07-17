import test from 'node:test';
import assert from 'node:assert/strict';
import { DailyAwarenessGenerationService } from '../server/daily-awareness-generation.service.js';
import { dailyAwarenessClassificationSystemPrompt } from '../server/daily-awareness-prompt.js';
import type { DailyAwarenessConfig, DailyAwarenessInboxRecord } from '../server/daily-awareness.contracts.js';

const config: DailyAwarenessConfig = {
  lookbackHours: 24,
  maxArticles: 50,
  categoryScope: ['国际安全'],
  maxRetryCount: 2,
  retryIntervalSeconds: 1,
  summaryMaxChars: 1200,
  version: 1,
};

function event(payload: Record<string, unknown> = {}): DailyAwarenessInboxRecord {
  return {
    eventId: 'event-1',
    eventType: 'DAILY_DATA_FINISHED',
    businessDate: '2026-07-16',
    batchId: 'batch-1',
    completedAt: '2026-07-17T06:10:00.000Z',
    totalCount: 1,
    payload,
    status: 'PROCESSING',
    attemptCount: 1,
  };
}

function harness(options: { noData?: boolean; successful?: boolean; failOnce?: boolean } = {}) {
  const calls: string[] = [];
  let composeAttempts = 0;
  let runSequence = 0;
  const store = {
    loadConfig: async () => config,
    hasSuccessfulGlobalBrief: async () => Boolean(options.successful),
    startRun: async (_item: unknown, triggerType: string, attemptNo: number) => {
      calls.push(`start:${triggerType}:${attemptNo}`);
      runSequence += 1;
      return `run-${runSequence}`;
    },
    recordIgnored: async () => calls.push('ignored'),
    completeNoData: async () => calls.push('no-data'),
    failRun: async (_runId: string, _error: unknown, terminal: boolean) => calls.push(`failed:${terminal}`),
    saveSuccess: async () => calls.push('save-success'),
  };
  const material = {
    prepareForBusinessDate: async () => {
      calls.push('materials');
      return options.noData
        ? { materials: [], candidates: [], sourceCount: 0, summaryCount: 0, titleOnlyCount: 0, skippedCount: 0, qualityStatus: null, diagnostics: {} }
        : {
            materials: [],
            candidates: [{ candidateId: 'c1', title: '事件', summaryText: '事件摘要', sources: [], relatedMaterialIds: [], sourceCount: 1 }],
            sourceCount: 1,
            summaryCount: 1,
            titleOnlyCount: 0,
            skippedCount: 0,
            qualityStatus: 'NORMAL' as const,
            diagnostics: {},
          };
    },
  };
  const composer = {
    composeGlobalBrief: async () => {
      calls.push('model-call');
      composeAttempts += 1;
      if (options.failOnce && composeAttempts === 1) throw Object.assign(new Error('rate limited'), { status: 429 });
      return {
        title: '2026-07-16 每日动态简报',
        summary: '今日概览',
        reportMarkdown: '# 每日动态简报\n\n这是经过校验的每日动态简报正文，包含足够长度的重点动态和分类信息。',
        contentJson: {},
        categoryStats: [],
        events: [],
      };
    },
  };
  const lock = {
    withBusinessDateLock: async (_date: string, _mode: string, work: () => Promise<unknown>) => ({ acquired: true, value: await work() }),
  };
  const inbox = { registerProcessor: () => () => undefined };
  const generation = new DailyAwarenessGenerationService(
    material as never,
    lock as never,
    composer as never,
    inbox as never,
    store as never,
  );
  return { generation, calls };
}

test('records NO_DATA without calling the model or saving a brief', async () => {
  const { generation, calls } = harness({ noData: true });

  const result = await generation.processEvent(event());

  assert.equal(result.generationStatus, 'NOT_REQUIRED');
  assert.deepEqual(calls, ['start:EVENT:1', 'materials', 'no-data']);
});

test('ignores Inbox replay when a successful global brief already exists', async () => {
  const { generation, calls } = harness({ successful: true });

  const result = await generation.processEvent(event({ reprocessRequested: true }));

  assert.equal(result.generationStatus, 'SUCCESS');
  assert.deepEqual(calls, ['ignored']);
});

test('retries a transient model failure in a separate run and saves after model execution', async () => {
  const { generation, calls } = harness({ failOnce: true });

  const result = await generation.processEvent(event());

  assert.equal(result.generationStatus, 'SUCCESS');
  assert.deepEqual(calls, [
    'start:EVENT:1',
    'materials',
    'model-call',
    'failed:false',
    'start:AUTO_RETRY:2',
    'model-call',
    'save-success',
  ]);
  assert.ok(calls.indexOf('model-call') > calls.indexOf('start:EVENT:1'));
  assert.ok(calls.lastIndexOf('model-call') < calls.indexOf('save-success'));
});

test('title-only prompt forbids facts not present in titles', () => {
  const prompt = dailyAwarenessClassificationSystemPrompt(true);
  assert.match(prompt, /只能依据输入标题/);
  assert.match(prompt, /不得补充标题中未明确体现的事实/);
  assert.match(prompt, /每个输入候选.*恰好.*一条评分/);
});
