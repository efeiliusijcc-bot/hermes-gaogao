import assert from 'node:assert/strict';
import {
  firstSourceDisplayText,
  sanitizeSourceDisplayText,
  sourceHostname,
} from '../b_k3ewYvsOEc1/src/lib/sourceDisplay.js';

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

console.log('source display tests passed');
