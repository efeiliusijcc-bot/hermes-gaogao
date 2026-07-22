import assert from 'node:assert/strict';
import { DraftAssistantService } from '../server/draft-assistant.service.js';
import type { DraftAnalysisJson, DraftSourceResponse } from '../server/draft-assistant.types.js';
import { buildDraftAnalysisSections } from '../b_k3ewYvsOEc1/src/lib/draftAssistantFlow.js';

type AnalysisServiceAccess = {
  normalizeAnalysis(value: unknown): DraftAnalysisJson;
  ensureMinimumAnalysis(
    analysis: DraftAnalysisJson,
    input: {
      title: string;
      materials: string;
      category: string;
      region: string;
      sources: DraftSourceResponse[];
    },
  ): DraftAnalysisJson;
};

const service = new DraftAssistantService({} as never) as unknown as AnalysisServiceAccess;

const summaryOnly = service.ensureMinimumAnalysis(
  service.normalizeAnalysis({
    oneSentenceSummary: '俄乌冲突持续升级，乌克兰加速加入欧盟进程。',
    keyActors: [],
    timeline: [],
    mainFacts: [],
    riskSummary: { overallLevel: 'unknown', risks: [], pendingVerifications: [], sourceStatus: 'unverified' },
  }),
  {
    title: '俄乌冲突持续升级与乌克兰入欧进程',
    materials: '俄乌冲突持续升级与乌克兰入欧进程',
    category: '',
    region: '',
    sources: [],
  },
);

assert.ok(summaryOnly.keyActors.length, 'summary-only analysis should receive an actor verification placeholder');
assert.ok(summaryOnly.timeline.length, 'summary-only analysis should receive a time/place verification placeholder');
assert.ok(summaryOnly.mainFacts.length, 'summary-only analysis should receive a facts verification placeholder');
assert.match(JSON.stringify(summaryOnly.riskSummary), /待核实|待研判/);

const aliases = service.normalizeAnalysis({
  summary: '事件概括',
  coreActors: ['俄罗斯', '乌克兰', '欧盟'],
  timeAndPlace: ['2026年，欧洲'],
  keyFacts: ['乌克兰继续推进加入欧盟进程'],
  risksToChina: ['地缘政治与经贸外溢风险待研判'],
});

assert.deepEqual(aliases.keyActors, ['俄罗斯', '乌克兰', '欧盟']);
assert.deepEqual(aliases.timeline, ['2026年，欧洲']);
assert.deepEqual(aliases.mainFacts, ['乌克兰继续推进加入欧盟进程']);
assert.deepEqual(aliases.riskToUs, ['地缘政治与经贸外溢风险待研判']);

const sections = buildDraftAnalysisSections({
  analysis: {
    oneSentenceSummary: '事件概括',
    keyActors: ['俄罗斯', '乌克兰'],
    timeline: ['2026年，欧洲'],
    mainFacts: ['关键事实'],
    riskSummary: {
      overallLevel: 'medium',
      risks: [{
        riskType: '地缘政治',
        title: '外溢风险',
        description: '需关注能源、贸易及地区安全形势变化。',
        basis: '基于当前材料研判',
      }],
      pendingVerifications: ['欧盟后续政策安排待核实'],
      sourceStatus: 'partial',
    },
  },
});

const riskContent = sections.find((item) => item.key === 'risk')?.content || '';
assert.match(riskContent, /外溢风险/);
assert.match(riskContent, /能源、贸易/);
assert.match(riskContent, /欧盟后续政策安排待核实/);

console.log('draft assistant analysis normalization tests passed');
