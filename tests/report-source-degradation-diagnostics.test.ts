import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

const databaseSource = {
  id: 'database-1',
  sourceGroup: 'structured_sources',
  sourceOrigin: 'database_recall',
  evidenceKind: 'structured_source',
  engine: 'database',
  title: 'Available database source',
  url: 'https://example.com/database',
  sourceName: 'Database',
  publishTime: '',
  summary: '',
  excerpt: '',
  sourceType: '数据库记录',
  relevanceScore: 0.9,
  status: 'accepted',
  method: 'database',
};

const service = Object.create(ReportsService.prototype) as ReportsService & Record<string, unknown>;
service.assertCanAccessJob = () => ({ jobId: 'job-degraded', payload: {} });
service.normalizeReportSourceType = () => 'all';
service.parsePositiveInt = (value: unknown, fallback: number) => Number(value) || fallback;
service.structuredReportSources = async () => [databaseSource];
service.reportReferenceSources = async () => {
  throw new Error('token=super-secret reference storage unavailable');
};
service.toolSearchSources = async () => {
  throw new Error('https://user:password@example.com/private failed');
};
service.reportSourceDiagnostics = async () => {
  throw new Error('diagnostic file unavailable');
};

const warnings: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => warnings.push(args);

try {
  const response = await service.getSources('job-degraded', {}, {} as never);

  assert.deepEqual(response?.items.map((item) => item.url), ['https://example.com/database']);
  const diagnostics = response?.meta?.sourceDiagnostics as {
    degradedSources?: Array<{ sourceGroup: string; reason: string }>;
  };
  assert.deepEqual(
    diagnostics.degradedSources?.map((item) => item.sourceGroup).sort(),
    ['report_refs', 'source_diagnostics', 'tool_search'],
  );
  assert.ok(diagnostics.degradedSources?.every((item) => item.reason === 'load_failed'));
  assert.ok(warnings.length >= 3, 'each degraded source group should be logged');
  assert.doesNotMatch(JSON.stringify(response), /super-secret|user:password/);
  assert.doesNotMatch(JSON.stringify(warnings), /super-secret|user:password/);
} finally {
  console.warn = originalWarn;
}

console.log('report source degradation diagnostics tests passed');
