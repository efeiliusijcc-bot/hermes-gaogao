import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:1555';
const key = process.env.HERMES_RECALL_KEY || process.env.SOURCE_RECALL_API_KEY;
if (!key) throw new Error('Configure HERMES_RECALL_KEY without printing it');
const call = (body, credential) => fetch(`${base}/api/external/source-recall`, {
  method: 'POST', signal: AbortSignal.timeout(60000),
  headers: { 'content-type': 'application/json', ...(credential ? { 'x-hermes-recall-key': credential } : {}) },
  body: JSON.stringify(body),
});
assert.equal((await call({ topic: 'test' })).status, 401);
assert.equal((await call({ topic: 'test' }, 'invalid')).status, 401);
assert.equal((await call({}, key)).status, 400);
const started = Date.now();
const response = await call({ topic: '欧盟贸易政策', lookbackDays: 365, limit: 5 }, key);
const data = await response.json();
assert.equal(response.status, 200);
console.log(JSON.stringify({
  httpStatus: response.status, elapsedMs: Date.now() - started, status: data.status,
  requestId: data.requestId, returned: data.sources?.length, totalHits: data.totalHits,
  diagnostics: data.diagnostics, titles: data.sources?.slice(0, 2).map((source) => source.title),
  rateLimit: response.headers.get('ratelimit-limit'),
}, null, 2));
assert.ok(data.sources?.length > 0, 'Expected real source hits');
assert.ok(data.diagnostics?.vectorCandidateCount > 0, 'Expected actual vector retrieval');
assert.equal(data.status, 'hit', 'Partial/unavailable retrieval requires investigation');
