import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyAwarenessMysqlQuery,
  deriveDailyMysqlTableName,
  normalizeDailyAwarenessMysqlRow,
} from '../server/daily-awareness-mysql.service.js';

test('derives a safe daily MySQL table name from businessDate', () => {
  assert.equal(deriveDailyMysqlTableName('2026-07-16'), 'data_20260716');
  assert.throws(() => deriveDailyMysqlTableName('2026-7-16'), /businessDate/);
  assert.throws(() => deriveDailyMysqlTableName('2026-02-30'), /businessDate/);
  assert.throws(() => deriveDailyMysqlTableName('2026-07-16;DROP TABLE news'), /businessDate/);
});

test('normalizes MySQL daily rows without rewriting source summary', () => {
  assert.deepEqual(normalizeDailyAwarenessMysqlRow({
    id: 7,
    ch_title: '',
    entitle: 'Fallback title',
    summary: 'Source summary',
    designated_tag: null,
    tag: 'topic',
    publish_time: '2026-07-16 10:00:00',
    website_name: 'Publisher',
    data_source_url: 'https://example.com/7',
    data_type: 'news',
  }), {
    id: '7',
    title: 'Fallback title',
    summary: 'Source summary',
    designatedTag: '其他',
    tag: 'topic',
    publishedAt: '2026-07-16 10:00:00',
    publisher: 'Publisher',
    url: 'https://example.com/7',
    dataType: 'news',
  });
});

test('ignores an invalid MySQL Date without failing the entire daily batch', () => {
  const invalidDate = new Date(Number.NaN);

  assert.equal(normalizeDailyAwarenessMysqlRow({
    id: 8,
    ch_title: 'News with an invalid source timestamp',
    publish_time: invalidDate,
  }).publishedAt, '');
});

test('builds a parameterized category query for a validated table', () => {
  const query = buildDailyAwarenessMysqlQuery('data_20260716', ['涉政', '危安']);
  assert.match(query.text, /FROM `data_20260716`/);
  assert.match(query.text, /designated_tag\).*IN \(\?,\?\)/s);
  assert.deepEqual(query.values, ['涉政', '危安']);
  assert.doesNotMatch(query.text, /summary\s+FROM|content\s+FROM/);
});
