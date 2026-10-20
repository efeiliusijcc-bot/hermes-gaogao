import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DraftAssistantService } from '../server/draft-assistant.service.js';
import { DraftAnalysisJobsService } from '../server/draft-analysis-jobs.service.js';
import { DraftAnalysisWorkerService } from '../server/draft-analysis-worker.service.js';
import { budgetedPool, checkOperationBudget, operationRequestOptions, withOperationBudget } from '../server/operation-budget.js';
import type { AuthUser } from '../server/auth-user.interface.js';

test('request budgets stay scoped and timeout cannot become a successful fallback', async () => {
  assert.equal(operationRequestOptions(), undefined);
  const controller = new AbortController();
  await withOperationBudget({ signal: controller.signal, deadlineAt: Date.now() + 1000 }, async () => {
    assert.equal(operationRequestOptions()?.signal, controller.signal);
    controller.abort(new Error('DRAFT_ANALYSIS_TIMEOUT'));
    assert.throws(checkOperationBudget, /DRAFT_ANALYSIS_TIMEOUT/);
  });
  assert.equal(operationRequestOptions(), undefined);
  const modelController = new AbortController();
  const drafts = new DraftAssistantService({ search: async () => ({ sources: [] }) } as any);
  (drafts as any).generateAnalysis = async () => { modelController.abort(new Error('DRAFT_ANALYSIS_TIMEOUT')); throw new Error('model timed out'); };
  await assert.rejects(withOperationBudget({ signal: modelController.signal, deadlineAt: Date.now() + 1000 },
    () => drafts.prepareAnalysis({ title: 'test' }, async () => {})), /DRAFT_ANALYSIS_TIMEOUT/);
});

test('budget cancellation destroys only its own query connection, not the shared pool', async () => {
  const controller = new AbortController();
  const releases: boolean[] = [];
  const pool = {
    connect: async () => ({
      query: async (sql: string) => {
        if (sql === 'long query') {
          controller.abort(new Error('DRAFT_ANALYSIS_TIMEOUT'));
          throw new Error('connection terminated');
        }
        return { rows: [] };
      },
      release: (destroy = false) => releases.push(destroy),
    }),
    query: async () => ({ rows: [{ unaffected: true }] }),
    end: async () => { assert.fail('shared pool must remain open'); },
  };
  assert.equal(budgetedPool(pool), pool);
  await assert.rejects(withOperationBudget({ signal: controller.signal, deadlineAt: Date.now() + 1000 },
    () => budgetedPool(pool).query('long query')), /terminated/);
  assert.deepEqual(releases, [true]);
  assert.deepEqual((await pool.query()).rows, [{ unaffected: true }]);
});

const url = process.env.DRAFT_ANALYSIS_TEST_PG_URL;
test('persistent analysis queue integration (isolated PostgreSQL only)', { skip: !url }, async t => {
  // Only an explicitly supplied test database is used; no application environment URL is consulted.
  const { Pool } = createRequire(import.meta.url)('pg');
  const schema = `draft_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 10 });
  const drafts = new DraftAssistantService({ search: async () => ({ sources: [] }) } as any);
  (drafts as any).pool = pool;
  (drafts as any).generateAnalysis = async () => ({ oneSentenceSummary: '受控分析结果', mainFacts: ['受控事实'] });
  const jobs = new DraftAnalysisJobsService(drafts);
  (jobs as any).pool = pool;
  const worker = new DraftAnalysisWorkerService(jobs);
  t.after(async () => {
    await worker.onModuleDestroy();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await pool.query('CREATE TABLE users(id uuid PRIMARY KEY, username text)');
  await pool.query(await readFile(new URL('../scripts/init-draft-assistant.sql', import.meta.url), 'utf8'));
  await jobs.initialize();
  const users = [1, 2, 3].map(i => ({ id: randomUUID(), username: `test-${i}`, roles: [], permissions: [] }) as unknown as AuthUser);
  for (const user of users) await pool.query('INSERT INTO users VALUES($1,$2)', [user.id, user.username]);
  const input = () => ({ title: '受控事件测试', materials: '受控测试材料，不调用真实模型', links: ['https://example.test/source'], clientRequestId: randomUUID() });
  const finish = async (id: string, status = 'succeeded') => {
    for (let count = 0; count < 100; count++) {
      const row = (await pool.query('SELECT status FROM draft_analysis_jobs WHERE job_id=$1', [id])).rows[0];
      if (row.status === status) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(`job did not become ${status}`);
  };

  await t.test('idempotency, changed payload rejection, one owner slot and owner isolation', async () => {
    const request = input();
    const [a, b] = await Promise.all([jobs.submit(request, users[0]), jobs.submit(request, users[0])]);
    assert.equal(a.jobId, b.jobId);
    await assert.rejects(jobs.submit({ ...request, title: 'changed' }, users[0]), (e: any) => e.getStatus() === 409);
    await assert.rejects(jobs.submit(input(), users[0]), (e: any) => e.getResponse().job.jobId === a.jobId);
    await assert.rejects(jobs.get(a.jobId, users[1]), (e: any) => e.getStatus() === 404);
    assert.equal((await jobs.list(users[1])).items.length, 0);
    assert.equal((await jobs.list(users[0], request.clientRequestId)).items[0]?.jobId, a.jobId);
    await assert.rejects(drafts.generateOutline({ eventId: a.eventId }, users[0]),
      (error: any) => /尚未成功/.test(error.getResponse().error));
    assert.equal(Number((await pool.query('SELECT count(*) FROM events')).rows[0].count), 1);
  });
  await t.test('two global slots, real steps, transactional results and waiting slot recovery', async () => {
    await jobs.submit(input(), users[1]);
    await jobs.submit(input(), users[2]);
    const [a, b, c] = await Promise.all([jobs.claim(), jobs.claim(), jobs.claim()]);
    assert.equal([a, b, c].filter(Boolean).length, 2);
    const claimed = [a, b, c].filter(Boolean) as Record<string, unknown>[];
    assert.equal(new Set(claimed.map(row => row.slot)).size, 2);
    for (const row of claimed) await jobs.execute(row, new AbortController().signal);
    const third = await jobs.claim();
    assert.ok(third);
    await jobs.execute(third, new AbortController().signal);
    for (const row of [...claimed, third]) {
      const event = await drafts.getEvent(String(row.event_id), users.find(u => u.id === row.owner_id)!);
      assert.equal(event.analysisJob?.status, 'succeeded');
      assert.equal(event.event.analysis.oneSentenceSummary, '受控分析结果');
      assert.equal(event.sources.length, 1);
    }
  });
  await t.test('saving after its deadline rolls back sources and analysis together', async () => {
    const a = await jobs.submit(input(), users[0]);
    const row = await jobs.claim();
    const save = drafts.savePreparedAnalysis.bind(drafts);
    drafts.savePreparedAnalysis = async (eventId, owner, prepared, db) => {
      await save(eventId, owner, prepared, db);
      const inserted = await db.query('SELECT source_id FROM event_sources WHERE event_id=$1', [eventId]);
      assert.equal(inserted.rows[0].source_id, prepared.sources[0].sourceId);
      await db.query("UPDATE draft_analysis_jobs SET deadline_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [a.jobId]);
    };
    await assert.rejects(jobs.execute(row!, new AbortController().signal), /INTERRUPTED|TIMEOUT/);
    drafts.savePreparedAnalysis = save;
    await jobs.fail(row!, 'DRAFT_ANALYSIS_TIMEOUT');
    const event = await drafts.getEvent(a.eventId, users[0]);
    assert.equal(event.sources.length, 0);
    assert.equal(event.event.summary, '');
  });
  await t.test('queue deadline includes waiting and does not run expired work', async () => {
    const a = await jobs.submit(input(), users[0]);
    const row = (await pool.query('SELECT extract(epoch from(deadline_at-created_at)) AS seconds FROM draft_analysis_jobs WHERE job_id=$1', [a.jobId])).rows[0];
    assert.ok(Math.abs(Number(row.seconds) - 120) < 0.01);
    await pool.query("UPDATE draft_analysis_jobs SET deadline_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [a.jobId]);
    await jobs.expire();
    assert.equal((await jobs.get(a.jobId, users[0])).errorCode, 'DRAFT_ANALYSIS_TIMEOUT');
    assert.equal(await jobs.claim(), null);
  });
  await t.test('lease interruption, retry without another event, stale result cannot overwrite retry', async () => {
    const a = await jobs.submit(input(), users[1]);
    const stale = await jobs.claim();
    assert.ok(stale);
    await pool.query("UPDATE draft_analysis_jobs SET heartbeat_at=clock_timestamp()-interval '46 seconds' WHERE job_id=$1", [a.jobId]);
    await jobs.expire();
    assert.equal((await jobs.get(a.jobId, users[1])).errorCode, 'DRAFT_ANALYSIS_INTERRUPTED');
    const count = Number((await pool.query('SELECT count(*) FROM events')).rows[0].count);
    const retried = await jobs.submit({ clientRequestId: randomUUID() } as any, users[1], a.jobId);
    assert.equal(retried.eventId, a.eventId);
    assert.equal(Number((await pool.query('SELECT count(*) FROM events')).rows[0].count), count);
    await assert.rejects(jobs.execute(stale, new AbortController().signal), /INTERRUPTED/);
    const current = await jobs.claim();
    assert.ok(current);
    await jobs.execute(current, new AbortController().signal);
    assert.equal((await jobs.get(a.jobId, users[1])).status, 'failed');
    assert.equal((await jobs.get(retried.jobId, users[1])).status, 'succeeded');
  });
  await t.test('worker marks real errors and aborted late work cannot persist partial results', async () => {
    const original = drafts.prepareAnalysis.bind(drafts);
    drafts.prepareAnalysis = async () => { throw new Error('controlled execution failure'); };
    const failed = await jobs.submit(input(), users[2]);
    await worker.tick();
    await finish(failed.jobId, 'failed');
    assert.equal((await jobs.get(failed.jobId, users[2])).errorCode, 'DRAFT_ANALYSIS_FAILED');
    drafts.prepareAnalysis = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return original(...args);
    };
    const timeout = await jobs.submit(input(), users[2]);
    await pool.query("UPDATE draft_analysis_jobs SET deadline_at=clock_timestamp()+interval '70 milliseconds' WHERE job_id=$1", [timeout.jobId]);
    await worker.tick();
    await finish(timeout.jobId, 'failed');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal((await jobs.get(timeout.jobId, users[2])).errorCode, 'DRAFT_ANALYSIS_TIMEOUT');
    const event = await drafts.getEvent(timeout.eventId, users[2]);
    assert.equal(event.event.summary, '');
    assert.equal(event.sources.length, 0);
    drafts.prepareAnalysis = original;
  });
  await t.test('legacy synchronous success shape uses the same persisted job', async () => {
    await worker.onModuleInit();
    const response = jobs.analyzeSync(input(), users[0]);
    const result = await response;
    assert.deepEqual(Object.keys(result).sort(), ['analysis', 'eventId', 'sources']);
    assert.equal(result.analysis.oneSentenceSummary, '受控分析结果');
  });
});
