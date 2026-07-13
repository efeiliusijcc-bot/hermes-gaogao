import fs from 'node:fs/promises';
import path from 'node:path';
import { assessSourceQuality, buildSupplementQueries, decideWebSupplementTrigger, dedupeSupplementSources, sourcePriority, WebSupplementService } from '../server/web-supplement.service.js';
import type { EntityPolicy } from '../server/entity-policy.js';
import { filterSourcesByEntityPolicy } from '../server/source-entity-guard.js';
import { ResearchKeysService } from '../server/research-keys.service.js';

if (process.env.RUN_LIVE_RETRIEVAL_TESTS !== 'true') {
  throw new Error('Set RUN_LIVE_RETRIEVAL_TESTS=true to run billable live retrieval validation.');
}

type Scenario = { id: string; topic: string; policy: EntityPolicy; databaseAccepted: number };

function policy(entity: string, aliases: string[], topicTerms: string[], actionTerms: string[], queries: string[], confusions: string[] = []): EntityPolicy {
  return {
    coreEntities: [{ canonical: entity, type: 'company', aliases: [entity, ...aliases], importance: 'primary' }],
    entityRelations: [], topicTerms, actionTerms, timeConstraints: [], locationConstraints: [],
    ambiguousTerms: [],
    possibleConfusions: confusions.map((item) => ({ entity: item, aliases: [item], reason: 'live validation negative control' })),
    requiredEntityMatch: true, searchQueries: queries, confidence: 0.9, generatedBy: 'existing',
  };
}

const scenarios: Scenario[] = [
  { id: 'magnequench-neo', topic: 'Magnequench / NEO production progress', databaseAccepted: 0, policy: policy('Magnequench', ['麦格昆磁', 'Neo Performance Materials'], ['production', 'manufacturing', '生产', '量产'], ['expansion', 'progress', '扩产'], ['Magnequench Neo Performance Materials production expansion', '麦格昆磁 NEO 生产 量产 进展'], ['Micron']) },
  { id: 'catl-europe', topic: 'CATL European plant development', databaseAccepted: 0, policy: policy('CATL', ['宁德时代', 'Contemporary Amperex Technology'], ['Europe', 'European', '欧洲', 'plant', '工厂'], ['construction', 'production', '建设', '投产'], ['CATL European plant construction progress', '宁德时代 欧洲 工厂 建设 进展']) },
  { id: 'li-qiang-state-council', topic: 'Li Qiang State Council policy', databaseAccepted: 0, policy: policy('李强', ['Li Qiang', 'State Council'], ['国务院', 'policy', '政策'], ['发布', '会议', 'announced'], ['李强 国务院 政策 发布', 'Li Qiang State Council policy announcement']) },
  { id: 'poland-border', topic: 'Poland border incident', databaseAccepted: 0, policy: policy('Poland', ['波兰', 'Polish border'], ['border', '边境', 'incident', '事件'], ['security', 'crossing', '安全'], ['Poland border incident security', '波兰 边境 事件'], ['US Mexico border']) },
  { id: 'arm-holdings', topic: 'Arm Holdings semiconductor business', databaseAccepted: 0, policy: policy('Arm Holdings', ['Arm Ltd', 'ARM Holdings'], ['semiconductor', 'chip', '芯片'], ['earnings', 'licensing', '财报'], ['Arm Holdings semiconductor licensing earnings', 'Arm Holdings 芯片 授权 财报'], ['army', 'military']) },
  { id: 'eu-crma', topic: 'EU Critical Raw Materials Act policy', databaseAccepted: 0, policy: policy('Critical Raw Materials Act', ['CRMA', 'European Commission'], ['European Union', '欧盟', 'critical raw materials'], ['implementation', 'policy', '实施'], ['European Commission Critical Raw Materials Act implementation 2025', '欧盟 关键原材料法案 实施 2025']) },
  { id: 'europe-magnets', topic: 'European rare-earth permanent-magnet expansion risk', databaseAccepted: 0, policy: policy('European rare-earth permanent-magnet expansion', ['European permanent magnets', '欧洲 稀土 永磁'], ['rare earth', 'permanent magnet', '稀土', '永磁'], ['expansion', 'risk', '扩张', '风险'], ['European rare earth permanent magnet expansion risk', '欧洲 稀土 永磁 扩产 风险']) },
  { id: 'database-sufficient', topic: 'database sufficient negative trigger', databaseAccepted: 3, policy: policy('CATL', ['宁德时代'], ['Europe'], ['plant'], ['CATL Europe plant']) },
];

async function runScenario(service: WebSupplementService, scenario: Scenario) {
  const decision = decideWebSupplementTrigger({ acceptedDatabaseCount: scenario.databaseAccepted, context: { databaseSourceOptions: { enabled: true }, webSearchOptions: { enabled: true } } });
  const queries = buildSupplementQueries(scenario.policy);
  if (!decision.triggered) return { id: scenario.id, topic: scenario.topic, triggered: false, queries: 0, searchResults: 0, searchAccepted: 0, contentAccepted: 0, uncertain: 0, rejected: 0, deduplicated: 0, durationMs: 0, queryDiagnostics: [] };
  const result = await service.searchWithDiagnostics(queries);
  const summaryFiltered = filterSourcesByEntityPolicy(result.sources.map((source) => ({ ...source, content: '' })), scenario.policy);
  const acceptedKeys = new Set(summaryFiltered.acceptedSources.map((source) => String(source.url)));
  const candidates = result.sources.filter((source) => acceptedKeys.has(String(source.url)));
  const bodyFiltered = filterSourcesByEntityPolicy(candidates, scenario.policy);
  const qualityAccepted = bodyFiltered.acceptedSources.filter((source) => assessSourceQuality(source).status === 'accepted').map((source) => ({ ...source, sourceQuality: assessSourceQuality(source), sourcePriority: sourcePriority(source) }));
  const deduped = dedupeSupplementSources(qualityAccepted);
  return {
    id: scenario.id, topic: scenario.topic, triggered: true, queries: queries.length,
    searchResults: result.sources.length, searchAccepted: summaryFiltered.acceptedSources.length,
    contentAccepted: deduped.length, uncertain: summaryFiltered.uncertainSources.length + bodyFiltered.uncertainSources.length,
    rejected: summaryFiltered.rejectedSources.length + bodyFiltered.rejectedSources.length,
    deduplicated: Math.max(0, qualityAccepted.length - deduped.length), durationMs: result.durationMs,
    queryDiagnostics: result.queryDiagnostics.map((item) => ({ query: item.query, resultCount: item.resultCount, durationMs: item.durationMs, error: item.error || '' })),
    acceptedDomains: Array.from(new Set(deduped.map((source) => { try { return new URL(String(source.url)).hostname; } catch { return ''; } }).filter(Boolean))),
  };
}

const keys = new ResearchKeysService();
const status = await keys.getStatus();
if (!status.tavilyApiKey.configured) throw new Error('Tavily is not configured.');
const service = new WebSupplementService(keys);
const selectedIds = new Set(String(process.env.LIVE_RETRIEVAL_SCENARIOS || '').split(',').map((item) => item.trim()).filter(Boolean));
const selectedScenarios = selectedIds.size ? scenarios.filter((scenario) => selectedIds.has(scenario.id)) : scenarios;
const results = [];
for (const scenario of selectedScenarios) results.push(await runScenario(service, scenario));
const output = { generatedAt: new Date().toISOString(), tavilyConfigured: true, results };
const outputPath = path.join('/tmp', `hermes-live-retrieval-${Date.now()}.json`);
await fs.writeFile(outputPath, JSON.stringify(output, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ outputPath, results }, null, 2));
