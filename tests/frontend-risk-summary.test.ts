import assert from 'node:assert/strict';
import {
  mapRiskLevel,
  normalizeRiskSummary,
  riskSummaryTitle,
} from '../b_k3ewYvsOEc1/src/lib/riskSummary.js';

const rawItems = [
  {
    riskType: '技术竞争',
    riskLevel: '中',
    description: '可能提升竞争优势。',
    basis: '涉及生产工艺和中试。',
    uncertainty: '具体工艺内容待核实；技术成熟度待核实',
  },
  {
    riskType: '供应链竞争',
    riskLevel: '低',
    description: '可能增加相关材料供应。',
    basis: '产能提升通常会影响供应结构。',
    uncertainty: '新增产能规模待确认',
  },
];

const arraySummary = normalizeRiskSummary(rawItems);
assert.equal(arraySummary.items.length, 2);
assert.equal(arraySummary.overallLevel, 'medium');
assert.equal(arraySummary.items[0].riskLevelLabel, '中等风险');

const jsonSummary = normalizeRiskSummary(JSON.stringify({ risks: rawItems, pendingVerifications: ['官方公告待核实'] }));
assert.equal(jsonSummary.items.length, 2);
assert.deepEqual(jsonSummary.pendingVerifications, ['官方公告待核实']);

const doubleJsonSummary = normalizeRiskSummary(JSON.stringify(JSON.stringify({ risks: rawItems })));
assert.equal(doubleJsonSummary.items.length, 2);

const fencedSummary = normalizeRiskSummary(`\`\`\`json\n${JSON.stringify({ risks: rawItems })}\n\`\`\``);
assert.equal(fencedSummary.items.length, 2);

const invalidSummary = normalizeRiskSummary('[{"riskType": "技术竞争",]');
assert.equal(invalidSummary.note, 'parse_failed');
assert.equal(invalidSummary.items.length, 0);
assert.equal(JSON.stringify(invalidSummary).includes('{"riskType"'), false);

assert.deepEqual(mapRiskLevel('高风险'), { value: 'high', label: '高风险' });
assert.deepEqual(mapRiskLevel('moderate'), { value: 'medium', label: '中等风险' });
assert.deepEqual(mapRiskLevel('低'), { value: 'low', label: '较低风险' });
assert.deepEqual(mapRiskLevel('暂不确定'), { value: 'unknown', label: '待评估' });

const displayText = [
  arraySummary.overallLevelLabel,
  ...arraySummary.items.flatMap((item) => [
    item.riskType,
    item.riskLevelLabel,
    item.title,
    item.description,
    item.basis,
    item.uncertainty,
  ]),
].join('\n');
for (const token of ['riskType', 'riskLevel', 'description', 'basis', 'uncertainty', '{"riskType"']) {
  assert.equal(displayText.includes(token), false);
}

assert.equal(riskSummaryTitle({}), '风险研判');
assert.equal(riskSummaryTitle({ viewpointSubject: 'Magnequench' }), '对「Magnequench」的潜在影响');

assert.deepEqual(arraySummary.pendingVerifications, [
  '具体工艺内容待核实',
  '技术成熟度待核实',
  '新增产能规模待确认',
]);

const textSummary = normalizeRiskSummary('当前资料不足，需继续核验。');
assert.equal(textSummary.items.length, 1);
assert.equal(textSummary.items[0].riskLevel, 'unknown');
assert.equal(textSummary.items[0].description, '当前资料不足，需继续核验。');

console.log('frontend risk summary tests passed');
