import assert from 'node:assert/strict';
import { buildRuleBasedEntityPolicy, extractEntityPolicy, parseEntityPolicy } from '../server/entity-policy.js';

async function testModelOutputParses() {
  const policy = await extractEntityPolicy(
    { topic: 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向' },
    async () => ({
      coreEntities: [
        { canonical: '麦格昆磁', type: 'company', aliases: ['麦格昆磁', 'Magnequench'], importance: 'primary' },
      ],
      entityRelations: [],
      topicTerms: ['生产工艺', '中试', '量产'],
      actionTerms: ['中试', '量产'],
      timeConstraints: [],
      locationConstraints: [],
      ambiguousTerms: [],
      possibleConfusions: [{ entity: '美光科技', aliases: ['美光', 'Micron'], reason: '名称近似但对象不同' }],
      requiredEntityMatch: true,
      searchQueries: ['Magnequench 生产工艺 中试 量产'],
      confidence: 0.91,
    }),
  );
  assert.equal(policy.generatedBy, 'llm');
  assert.equal(policy.requiredEntityMatch, true);
  assert.equal(policy.coreEntities[0]?.canonical, '麦格昆磁');
}

async function testModelFailureFallsBack() {
  const policy = await extractEntityPolicy(
    { topic: 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向' },
    async () => {
      throw new Error('model unavailable');
    },
  );
  assert.equal(policy.generatedBy, 'rules');
  assert.equal(policy.requiredEntityMatch, true);
  assert.ok(policy.coreEntities.some((entity) => entity.aliases.includes('Magnequench')));
  assert.ok(policy.possibleConfusions.some((item) => item.aliases.includes('Micron')));
}

async function testEntityEmptyModelFallsBack() {
  const policy = await extractEntityPolicy(
    { topic: 'NEO下属子公司麦格昆磁近期在生产工艺、中试、量产的主要动向' },
    async () => ({ coreEntities: [], requiredEntityMatch: false, confidence: 0.9 }),
  );
  assert.equal(policy.generatedBy, 'rules');
  assert.ok(policy.coreEntities.some((entity) => entity.aliases.includes('Magnequench')));
}

function testRuleFallbackDoesNotOpenGateWhenNoEntity() {
  const policy = buildRuleBasedEntityPolicy({ topic: '近期产业链动态和风险变化' });
  assert.equal(policy.requiredEntityMatch, false);
  assert.ok(policy.confidence < 0.4);
  assert.match(policy.fallbackReason || '', /弱主题校验|未识别明确核心实体/);
}

function testGenericScenariosExtractConfusions() {
  const catl = buildRuleBasedEntityPolicy({ topic: '宁德时代欧洲电池工厂建设进展' });
  assert.ok(catl.coreEntities.some((entity) => entity.aliases.includes('CATL')));
  assert.ok(catl.possibleConfusions.some((item) => item.aliases.includes('BYD')));

  const arm = buildRuleBasedEntityPolicy({ topic: 'ARM公司在AI芯片授权模式上的变化' });
  assert.ok(arm.coreEntities.some((entity) => entity.aliases.includes('ARM')));
  assert.ok(arm.possibleConfusions.some((item) => item.aliases.includes('army')));
}

function testJsonFenceParses() {
  const parsed = parseEntityPolicy(`\`\`\`json
  {"coreEntities":[{"canonical":"Arm Holdings","type":"company","aliases":["ARM"],"importance":"primary"}],"requiredEntityMatch":true,"confidence":0.8}
  \`\`\``);
  assert.equal(parsed?.coreEntities[0]?.canonical, 'Arm Holdings');
}

await testModelOutputParses();
await testModelFailureFallsBack();
await testEntityEmptyModelFallsBack();
testRuleFallbackDoesNotOpenGateWhenNoEntity();
testGenericScenariosExtractConfusions();
testJsonFenceParses();
console.log('entity policy extraction tests passed');
