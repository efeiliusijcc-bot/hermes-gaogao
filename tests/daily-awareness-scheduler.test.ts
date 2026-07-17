import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyAwarenessSourceContext,
  previousBusinessDate,
} from '../server/daily-awareness-date.js';

test('maps a brief business date to the previous MySQL business date', () => {
  assert.equal(previousBusinessDate('2026-07-18'), '2026-07-17');
  assert.equal(previousBusinessDate('2026-03-01'), '2026-02-28');
  assert.equal(previousBusinessDate('2024-03-01'), '2024-02-29');
  assert.equal(previousBusinessDate('2026-01-01'), '2025-12-31');
  assert.throws(() => previousBusinessDate('2026-02-30'), /businessDate/);
});

test('builds the server-owned source context and Shanghai wait deadline', () => {
  assert.deepEqual(dailyAwarenessSourceContext('2026-07-18'), {
    sourceBusinessDate: '2026-07-17',
    sourceTable: 'data_20260717',
    dataWaitDeadline: '2026-07-18T08:00:00+08:00',
  });
});
