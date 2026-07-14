import assert from 'node:assert/strict';
import { buildCleanRetrievalInput } from '../server/reports/retrieval/query/clean-query-input.js';
import { EntityAliasService } from '../server/reports/retrieval/query/entity-alias.service.js';
import { QueryParserService } from '../server/reports/retrieval/query/query-parser.service.js';
import { QueryPolicyValidatorService } from '../server/reports/retrieval/query/query-policy-validator.service.js';
import { RuleQueryAnalysisService } from '../server/reports/retrieval/query/rule-query-analysis.service.js';

const INCIDENT_JOB_ID = 'f323bc84-a139-4877-a74a-7dde42e0ed60';
const INCIDENT_TOPIC = '美伊技术层级会谈启动，聚焦核问题与黎巴嫩停火';

function createParser() {
  const aliases = new EntityAliasService();
  return new QueryParserService(
    aliases,
    new QueryPolicyValidatorService(aliases),
    new RuleQueryAnalysisService(),
  );
}

function testCleanInputIgnoresKnownContext() {
  const result = buildCleanRetrievalInput({
    reportJobId: INCIDENT_JOB_ID,
    topic: `  ${INCIDENT_TOPIC}  `,
    supplement: '',
    explicitEntities: [
      { name: '美国', canonicalId: 'country:us', type: 'country', required: true, ignored: 'PG' },
      '伊朗',
    ],
    explicitTimeRange: { start: '2026-01-01', end: '2026-12-31', workflow: 'ignore' },
    knownContext: {
      sourceScope: '政府与机构',
      sourceTypes: ['监管机构', '智库研判', '专业机构'],
      database: 'PG数据库信源',
      workflow: 'write-hb',
      stage: 'database',
    },
  });

  assert.deepEqual(result, {
    reportJobId: INCIDENT_JOB_ID,
    topic: INCIDENT_TOPIC,
    supplement: '',
    explicitEntities: [
      { name: '美国', canonicalId: 'country:us', type: 'country', required: true },
      { name: '伊朗', required: false },
    ],
    explicitTimeRange: { start: '2026-01-01', end: '2026-12-31' },
  });
  assert.doesNotMatch(JSON.stringify(result), /政府与机构|监管机构|智库研判|专业机构|PG数据库信源|workflow|stage/);
}

function testIncidentEntitiesAreCanonicalAndSoft() {
  const clean = buildCleanRetrievalInput({
    reportJobId: INCIDENT_JOB_ID,
    topic: INCIDENT_TOPIC,
    supplement: '',
    knownContext: {
      sourceScope: '政府与机构',
      sourceTypes: ['监管机构', '智库研判', '专业机构'],
      database: 'PG数据库信源',
    },
  });
  const profile = createParser().parse(clean);
  const byId = new Map(profile.coreEntities.map((entity) => [entity.canonicalId, entity]));

  assert.equal(byId.get('country:us')?.canonicalName, '美国');
  assert.equal(byId.get('country:iran')?.canonicalName, '伊朗');
  assert.equal(byId.get('country:us')?.enforcement, 'soft');
  assert.equal(byId.get('country:iran')?.enforcement, 'soft');
  assert.ok(byId.get('country:us')?.aliases.includes('美伊'));
  assert.ok(byId.get('country:iran')?.aliases.includes('美伊'));
  assert.ok(profile.coreTopics.includes('核问题'));
  assert.ok(profile.coreTopics.includes('黎巴嫩停火'));
  assert.doesNotMatch(JSON.stringify(profile), /政府与机构|监管机构|智库研判|专业机构|PG数据库信源/);
}

function testRequiredExplicitEntityStaysHard() {
  const profile = createParser().parse(buildCleanRetrievalInput({
    reportJobId: 'explicit-required',
    topic: '地区安全形势',
    explicitEntities: [
      { name: '法国', canonicalId: 'country:france', type: 'country', required: true },
      { name: '北约', canonicalId: 'organization:nato', type: 'organization', required: false },
    ],
  }));
  const france = profile.coreEntities.find((entity) => entity.canonicalId === 'country:france');
  const nato = profile.coreEntities.find((entity) => entity.canonicalId === 'organization:nato');

  assert.equal(france?.source, 'explicit');
  assert.equal(france?.enforcement, 'hard');
  assert.equal(nato?.enforcement, 'soft');
}

function testRequiredExplicitCompoundEntityExpandsToCanonicalCountries() {
  const profile = createParser().parse(buildCleanRetrievalInput({
    reportJobId: 'explicit-bilateral',
    topic: '技术层级会谈',
    explicitEntities: [{ name: '美伊', required: true }],
  }));
  const byId = new Map(profile.coreEntities.map((entity) => [entity.canonicalId, entity]));

  assert.deepEqual([...byId.keys()].sort(), ['country:iran', 'country:us']);
  assert.equal(byId.get('country:us')?.enforcement, 'hard');
  assert.equal(byId.get('country:iran')?.enforcement, 'hard');
  assert.ok(profile.coreEntities.every((entity) => entity.source === 'explicit'));
}

function testEuropeanAndCommonAliases() {
  const aliases = new EntityAliasService();
  const cases: Array<[string, string]> = [
    ['欧方在布鲁塞尔举行会议', 'organization:eu'],
    ['欧洲和欧陆安全形势', 'region:europe'],
    ['英方在伦敦表态', 'country:uk'],
    ['法方在巴黎表态', 'country:france'],
    ['德方在柏林表态', 'country:germany'],
    ['意方在罗马表态', 'country:italy'],
    ['西班牙和马德里', 'country:spain'],
    ['荷兰和阿姆斯特丹', 'country:netherlands'],
    ['比利时与波兰', 'country:belgium'],
    ['比利时与波兰', 'country:poland'],
    ['乌克兰与基辅', 'country:ukraine'],
    ['俄罗斯与莫斯科', 'country:russia'],
    ['北约峰会', 'organization:nato'],
  ];

  for (const [text, expectedId] of cases) {
    const ids = aliases.extractFromText(text, 'topic', 0.9).map((entity) => entity.canonicalId);
    assert.ok(ids.includes(expectedId), `${text} should resolve ${expectedId}`);
  }
}

function testForbiddenMetadataNeverBecomesEntity() {
  const profile = createParser().parse(buildCleanRetrievalInput({
    reportJobId: 'forbidden-metadata',
    topic: '地区形势更新',
    supplement: '政府与机构 覆盖政府 监管机构 智库研判 专业机构 PG 数据库信源 信源类型 检索方向 采集方向 联网信源 补充信源 workflow stage sourceScope sourceTypes',
  }));

  assert.deepEqual(profile.coreEntities, []);
}

testCleanInputIgnoresKnownContext();
testIncidentEntitiesAreCanonicalAndSoft();
testRequiredExplicitEntityStaysHard();
testRequiredExplicitCompoundEntityExpandsToCanonicalCountries();
testEuropeanAndCommonAliases();
testForbiddenMetadataNeverBecomesEntity();
console.log('hybrid retrieval query parser tests passed');
