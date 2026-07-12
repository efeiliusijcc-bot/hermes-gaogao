import assert from 'node:assert/strict';
import type { EntityPolicy } from '../server/entity-policy.js';
import { validateSourceEntityMatch, filterSourcesByEntityPolicy } from '../server/source-entity-guard.js';

const magnequenchPolicy: EntityPolicy = {
  coreEntities: [
    { canonical: '麦格昆磁', type: 'company', aliases: ['麦格昆磁', 'Magnequench'], importance: 'subsidiary' },
    { canonical: 'Neo Performance Materials', type: 'company', aliases: ['NEO', 'Neo Performance Materials'], importance: 'parent' },
  ],
  entityRelations: [{ subject: '麦格昆磁', relation: 'subsidiary_of', object: 'Neo Performance Materials' }],
  topicTerms: ['生产工艺', '中试', '量产'],
  actionTerms: ['生产工艺', '中试', '量产'],
  timeConstraints: [],
  locationConstraints: [],
  ambiguousTerms: [{ term: 'NEO', reason: '短缩写需要结合公司全称消歧', requiresContext: ['Neo Performance Materials', 'Magnequench'] }],
  possibleConfusions: [{ entity: '美光科技', aliases: ['美光', 'Micron', 'Micron Technology', 'DRAM', 'NAND'], reason: '半导体语义相近但非主题实体' }],
  requiredEntityMatch: true,
  searchQueries: ['麦格昆磁 Magnequench 生产工艺 中试 量产'],
  confidence: 0.9,
};

function testCoreEntityAndTopicAccepted() {
  const result = validateSourceEntityMatch({
    title: 'Magnequench updates pilot production and mass production process',
    summary: '麦格昆磁披露生产工艺、中试和量产相关进展。',
    websiteName: 'NEO',
    similarity: 0.82,
  }, magnequenchPolicy);
  assert.equal(result.status, 'accepted');
  assert.ok(result.matchedCoreEntities.includes('麦格昆磁'));
}

function testCoreEntityButWeakTopicUncertain() {
  const result = validateSourceEntityMatch({
    title: 'Neo Performance Materials announces quarterly update',
    summary: 'NEO mentions Magnequench in a broad corporate update.',
    similarity: 0.62,
  }, magnequenchPolicy);
  assert.equal(result.status, 'uncertain');
}

function testTopicOnlyRejected() {
  const result = validateSourceEntityMatch({
    title: '稀土磁材生产工艺和量产趋势',
    summary: '文章讨论中试、生产工艺和量产，但只涉及行业共性趋势。',
    similarity: 0.95,
  }, magnequenchPolicy);
  assert.equal(result.status, 'rejected');
}

function testConfusionRejected() {
  const result = validateSourceEntityMatch({
    title: 'Micron Technology reaches truth moment',
    summary: '美光 DRAM 和 NAND 业务进入财报关键期。',
    similarity: 0.99,
  }, magnequenchPolicy);
  assert.equal(result.status, 'rejected');
  assert.ok(result.matchedConfusions.includes('美光科技'));
}

function testAmbiguousOnlyRejected() {
  const result = validateSourceEntityMatch({
    title: 'NEO trading volume rises',
    summary: 'NEO token market update.',
    similarity: 0.9,
  }, magnequenchPolicy);
  assert.equal(result.status, 'rejected');
}

function testHighVectorMismatchRejected() {
  const result = validateSourceEntityMatch({
    title: '美光股价可能再次在财报公布后暴跌',
    summary: 'Micron Technology stock analysis with semiconductor references.',
    similarity: 1,
  }, magnequenchPolicy);
  assert.equal(result.status, 'rejected');
  assert.ok(result.finalScore < 0.4);
}

function testWeakPolicyRuns() {
  const weakPolicy: EntityPolicy = {
    ...magnequenchPolicy,
    coreEntities: [],
    possibleConfusions: [],
    requiredEntityMatch: false,
    confidence: 0.2,
  };
  const filtered = filterSourcesByEntityPolicy([
    { title: '生产工艺和量产趋势', summary: '中试和量产节奏变化。', similarity: 0.6 },
  ], weakPolicy);
  assert.equal(filtered.diagnostics.entityPolicyEnabled, true);
  assert.equal(filtered.acceptedSources.length + filtered.uncertainSources.length + filtered.rejectedSources.length, 1);
}

function testLocationMismatchRejected() {
  const policy: EntityPolicy = {
    coreEntities: [{ canonical: '波兰边境', type: 'location', aliases: ['波兰边境', 'Poland border', 'Polish border'], importance: 'primary' }],
    entityRelations: [],
    topicTerms: ['安全局势', '边境'],
    actionTerms: ['安全'],
    timeConstraints: [],
    locationConstraints: ['波兰'],
    ambiguousTerms: [],
    possibleConfusions: [{ entity: '非波兰边境', aliases: ['美国南部边境', '墨西哥边境', 'US southern border', 'Mexico border'], reason: '边境议题相似但地点不同' }],
    requiredEntityMatch: true,
    searchQueries: ['波兰边境 安全局势'],
    confidence: 0.8,
  };
  const accepted = validateSourceEntityMatch({ title: '波兰边境安全局势近期变化', summary: 'Polish border security update.', similarity: 0.7 }, policy);
  const rejected = validateSourceEntityMatch({ title: '美国南部边境安全局势', summary: 'Mexico border enforcement update.', similarity: 0.99 }, policy);
  assert.equal(accepted.status, 'accepted');
  assert.equal(rejected.status, 'rejected');
}

function testSameNamePersonMismatchRejected() {
  const policy: EntityPolicy = {
    coreEntities: [
      { canonical: '张伟（某研究院）', type: 'person', aliases: ['张伟', '某研究院 张伟'], importance: 'primary' },
      { canonical: '某研究院', type: 'organization', aliases: ['某研究院'], importance: 'context' },
    ],
    entityRelations: [{ subject: '张伟（某研究院）', relation: 'related_to', object: '某研究院' }],
    topicTerms: ['会晤', '表态'],
    actionTerms: ['会晤', '表态'],
    timeConstraints: [],
    locationConstraints: [],
    ambiguousTerms: [{ term: '张伟', reason: '常见同名人物，需要机构上下文', requiresContext: ['某研究院'] }],
    possibleConfusions: [{ entity: '张伟（体育界）', aliases: ['张伟 足球', '张伟 教练', '体育 张伟'], reason: '同名不同机构' }],
    requiredEntityMatch: true,
    searchQueries: ['某研究院 张伟 会晤 表态'],
    confidence: 0.75,
  };
  const accepted = validateSourceEntityMatch({ title: '某研究院张伟就会晤公开表态', summary: '机构专家张伟回应。', similarity: 0.8 }, policy);
  const rejected = validateSourceEntityMatch({ title: '张伟教练点评足球比赛', summary: '体育 张伟 表态。', similarity: 0.95 }, policy);
  assert.equal(accepted.status, 'accepted');
  assert.equal(rejected.status, 'rejected');
}

testCoreEntityAndTopicAccepted();
testCoreEntityButWeakTopicUncertain();
testTopicOnlyRejected();
testConfusionRejected();
testAmbiguousOnlyRejected();
testHighVectorMismatchRejected();
testWeakPolicyRuns();
testLocationMismatchRejected();
testSameNamePersonMismatchRejected();
console.log('source entity guard tests passed');
