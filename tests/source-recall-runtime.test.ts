import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createSourceRecallApp } from '../dist-server/server/source-recall-app.js';
import { SOURCE_RECALL_POOL_OPTIONS } from '../dist-server/server/source-recall-runtime.service.js';
import { VectorSourceService } from '../dist-server/server/vector-source.service.js';
import { ReportsService } from '../dist-server/server/reports.service.js';

// Import compiled code so Nest constructor metadata matches production.
process.env.SOURCE_RECALL_API_ENABLED = 'true';
process.env.SOURCE_RECALL_API_KEY = 'isolated-runtime-test';
delete process.env.SOURCE_RECALL_DATABASE_URL;
const app = await createSourceRecallApp();
app.useLogger(false);
await app.listen(0, '127.0.0.1');
try {
  assert.throws(() => app.get(VectorSourceService));
  assert.throws(() => app.get(ReportsService));
  const address = await app.getUrl();
  const health = await fetch(`${address}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'hermes-source-recall');
  assert.equal((await fetch(`${address}/api/report-jobs`)).status, 404);
  const post = (key?: string, body = '{}') => fetch(`${address}/api/external/source-recall`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-hermes-recall-key': key } : {}) }, body,
  });
  assert.equal((await post()).status, 401);
  assert.equal((await post('wrong')).status, 401);
  assert.equal((await post('isolated-runtime-test')).status, 400);
  assert.equal((await post('isolated-runtime-test', JSON.stringify({ topic: 'a'.repeat(70000) }))).status, 413);
  const unavailable = await post('isolated-runtime-test', JSON.stringify({ topic: '欧盟贸易调查', limit: 1 }));
  assert.equal(unavailable.status, 200);
  assert.equal((await unavailable.json()).status, 'unavailable');
  assert.equal(SOURCE_RECALL_POOL_OPTIONS.max, 2);
  assert.match(SOURCE_RECALL_POOL_OPTIONS.options, /default_transaction_read_only=on/);
  assert.equal(SOURCE_RECALL_POOL_OPTIONS.statement_timeout, 5000);
  console.log('isolated source recall runtime tests passed');
} finally {
  await app.close();
}
