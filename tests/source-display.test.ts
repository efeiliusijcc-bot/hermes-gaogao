import assert from 'node:assert/strict';
import {
  firstSourceDisplayText,
  sanitizeSourceDisplayText,
  sourceHostname,
} from '../b_k3ewYvsOEc1/src/lib/sourceDisplay.js';

const sourceDisplayModule = await import('../b_k3ewYvsOEc1/src/lib/sourceDisplay.js');

assert.equal(sanitizeSourceDisplayText('?????(?)'), '');
assert.equal(sanitizeSourceDisplayText('??????Fox News'), 'Fox News');
assert.equal(sanitizeSourceDisplayText('Reuters????'), 'Reuters');
assert.equal(sanitizeSourceDisplayText('Hermes SQL Agent'), '自主智能体 查询信息 技术信息');

assert.equal(
  firstSourceDisplayText(
    { publisher: '?????(?)', websiteName: '阿尔法投资(英)' },
    ['publisher', 'websiteName'],
    '来源未知',
  ),
  '阿尔法投资(英)',
);

assert.equal(
  firstSourceDisplayText(
    { publisher: '?????(?)', url: 'https://www.example.com/news' },
    ['publisher', 'websiteName'],
    sourceHostname('https://www.example.com/news') || '来源未知',
  ),
  'example.com',
);

assert.equal(typeof sourceDisplayModule.filterAcceptedReportReferences, 'function');
const acceptedReportReferences = sourceDisplayModule.filterAcceptedReportReferences?.([
  { citationNo: 1, title: 'Accepted', url: 'https://example.com/accepted', matchStatus: 'matched' },
  { citationNo: 2, title: 'Information gap', url: '', matchStatus: 'raw_only' },
  { citationNo: 3, title: 'Rejected', url: 'https://example.com/rejected', matchStatus: 'failed' },
]);
assert.deepEqual(acceptedReportReferences?.map((item) => item.citationNo), [1]);

assert.equal(typeof sourceDisplayModule.resolveSourceGroup, 'function');
assert.equal(sourceDisplayModule.resolveSourceGroup?.({
  sourceGroup: 'candidate_hits',
  sourceOrigin: 'database_recall',
}), 'candidate_hits');
assert.equal(sourceDisplayModule.resolveSourceGroup?.({
  sourceGroup: 'report_refs',
  sourceOrigin: 'tool_search',
}), 'report_refs');

console.log('source display tests passed');
