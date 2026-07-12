import assert from 'node:assert/strict';
import { buildRuleBasedEntityPolicy } from '../server/entity-policy.js';
import { buildSupplementQueries, decideWebSupplementTrigger } from '../server/web-supplement.service.js';

const baseContext = {
  databaseSourceOptions: { enabled: true },
  crawlerPlan: { enabled: false, executePhase: 'research' },
};

function testEnoughDatabaseSourcesDoesNotTrigger() {
  const result = decideWebSupplementTrigger({ acceptedDatabaseCount: 3, context: baseContext });
  assert.equal(result.triggered, false);
}

function testInsufficientDatabaseSourcesTriggers() {
  const result = decideWebSupplementTrigger({ acceptedDatabaseCount: 2, context: baseContext });
  assert.equal(result.triggered, true);
  assert.match(result.reason, /低于最低阈值/);
}

function testUserDisablesInternetAndCrawler() {
  const result = decideWebSupplementTrigger({
    acceptedDatabaseCount: 0,
    context: {
      ...baseContext,
      webSearchOptions: { enabled: false },
      crawlerPlan: { enabled: false, executePhase: 'research' },
    },
  });
  assert.equal(result.triggered, false);
  assert.match(result.reason, /关闭互联网搜索和资料采集/);
}

function testPlanningCollectionLockDoesNotTrigger() {
  const result = decideWebSupplementTrigger({
    acceptedDatabaseCount: 0,
    context: {
      ...baseContext,
      crawlerPlan: { enabled: true, executePhase: 'planning', alreadyExecuted: true, allowFurtherCollectionInResearch: false },
    },
  });
  assert.equal(result.triggered, false);
}

function testQueriesRequireSpecificEntity() {
  const policy = buildRuleBasedEntityPolicy({ topic: 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向' });
  const queries = buildSupplementQueries(policy);
  assert.ok(queries.length >= 4 && queries.length <= 10);
  assert.ok(queries.every((query) => /麦格昆磁|Magnequench|Neo Performance Materials|Neo Materials/.test(query)));
  assert.ok(queries.every((query) => !/^NEO\s/.test(query)));
  assert.ok(!queries.includes('稀土产业'));
}

testEnoughDatabaseSourcesDoesNotTrigger();
testInsufficientDatabaseSourcesTriggers();
testUserDisablesInternetAndCrawler();
testPlanningCollectionLockDoesNotTrigger();
testQueriesRequireSpecificEntity();
console.log('web supplement trigger tests passed');
