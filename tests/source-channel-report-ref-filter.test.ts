import assert from 'node:assert/strict';
import { ReportsService } from '../server/reports.service.js';

const service = Object.create(ReportsService.prototype) as ReportsService & {
  toolSearchChannelSources: Function;
};

const rawOnlyRef = {
  id: 'report-ref-raw',
  sourceGroup: 'report_refs',
  evidenceKind: 'report_reference',
  title: 'Raw report reference without URL',
  url: '',
  sourceName: '',
  publishTime: '',
  summary: 'Raw only citation text',
  excerpt: '正文引用编号 [1]',
  sourceType: '报告引用',
  relevanceScore: 100,
  status: 'referenced',
  method: '报告参考资料索引',
  citationNo: 1,
  rawReferenceText: 'Raw only citation text',
  matchStatus: 'raw_only',
};

const matchedRef = {
  id: 'report-ref-matched',
  sourceGroup: 'report_refs',
  evidenceKind: 'report_reference',
  title: 'Matched web source',
  url: 'https://example.com/source',
  sourceName: 'Example',
  publishTime: '2026-07-11',
  summary: 'Matched citation text',
  excerpt: '正文引用编号 [2]',
  sourceType: '报告引用',
  relevanceScore: 90,
  status: 'referenced',
  method: '报告参考资料索引',
  citationNo: 2,
  rawReferenceText: 'Matched citation text',
  matchStatus: 'matched',
};

const eligibleResearchSource = {
  ...matchedRef,
  id: 'research-source',
  sourceGroup: 'tool_search',
  sourceOrigin: 'tool_search',
  evidenceKind: 'evidence_card',
  citationNo: undefined,
  matchStatus: undefined,
};

const result = service.toolSearchChannelSources([eligibleResearchSource], [rawOnlyRef, matchedRef], []);

assert.equal(result.length, 1);
assert.equal(result[0].url, 'https://example.com/source');
assert.equal(result[0].matchStatus, 'matched');
assert.equal(result.some((item: { matchStatus?: string }) => item.matchStatus === 'raw_only'), false);

console.log('source channel report reference filter tests passed');
