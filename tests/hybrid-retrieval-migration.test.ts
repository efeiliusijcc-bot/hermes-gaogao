import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractHybridEntityIds, tokenizeHybridSearchText } from '../server/reports/retrieval/indexing/hybrid-indexing.js';

async function testMigrationUsesActualSchemaAndRequiredIndexes() {
  const sql = await readFile(
    new URL('../server/migrations/20260714_hybrid_retrieval.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /ALTER TABLE vector_materials_text_embedding_v4/);
  assert.match(sql, /search_tokens\s+text/i);
  assert.match(sql, /search_vector\s+tsvector/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS hybrid_retrieval_search_documents/i);
  assert.match(sql, /USING gin \(search_vector\)/i);
  assert.match(sql, /gin_trgm_ops/i);
  assert.match(sql, /hybrid_retrieval_document_entities/i);
  assert.match(sql, /hybrid_retrieval_runs/i);
  assert.match(sql, /hybrid_retrieval_candidates/i);
  assert.match(sql, /embedding_vector\s+vector_cosine_ops/i);
  assert.match(sql, /NOT\s+i\.indisvalid/i);
  assert.match(sql, /DROP INDEX CONCURRENTLY IF EXISTS/i);
  assert.match(sql, /\\gexec/);
  assert.doesNotMatch(sql, /source_documents|DatabaseService|EmbeddingService/);
}

async function testDeployStopsOnMigrationErrorAndSupportsTimerRollback() {
  const deploy = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
  const uninstall = await readFile(
    new URL('../scripts/uninstall-hybrid-retrieval-timer.sh', import.meta.url),
    'utf8',
  ).catch(() => '');

  assert.match(deploy, /psql\s+-v\s+ON_ERROR_STOP=1\s+"\\\$PGVECTOR_DATABASE_URL"/);
  assert.match(deploy, /HYBRID_RETRIEVAL_ENABLED[\s\S]{0,240}uninstall-hybrid-retrieval-timer/);
  assert.match(deploy, /0\|false\|off/);
  assert.match(
    deploy,
    /HYBRID_FLAG[\s\S]{0,320}PGVECTOR_NEWS_TABLE[\s\S]{0,160}vector_materials_text_embedding_v4/,
  );
  assert.match(uninstall, /systemctl\s+disable\s+--now\s+hermes-hybrid-retrieval-sync\.timer/);
  assert.match(uninstall, /SERVICE_FILE=[^\n]+hermes-hybrid-retrieval-sync\.service/);
  assert.match(uninstall, /TIMER_FILE=[^\n]+hermes-hybrid-retrieval-sync\.timer/);
  assert.match(uninstall, /rm\s+-f\s+"\$SERVICE_FILE"\s+"\$TIMER_FILE"/);
}

function testChinesePretokenizationAndEntityExtraction() {
  const tokens = tokenizeHybridSearchText(
    '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火。美国与伊朗代表在技术层级继续磋商。',
  ).split(' ');

  for (const expected of ['美伊', '技术', '会谈', '核问题', '黎巴嫩', '停火', '美国', '伊朗']) {
    assert.ok(tokens.includes(expected), `missing token ${expected}`);
  }
  assert.deepEqual(
    extractHybridEntityIds('美伊会谈中，美方与德黑兰代表交换意见。'),
    ['country:us', 'country:iran'],
  );
  assert.deepEqual(
    extractHybridEntityIds('欧盟与北约在布鲁塞尔讨论乌克兰局势。'),
    ['organization:eu', 'country:ukraine', 'organization:nato'],
  );
}

await testMigrationUsesActualSchemaAndRequiredIndexes();
await testDeployStopsOnMigrationErrorAndSupportsTimerRollback();
testChinesePretokenizationAndEntityExtraction();
console.log('hybrid retrieval migration and indexing tests passed');
