import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DAILY_AWARENESS_DATA_STATUSES,
  DAILY_AWARENESS_GENERATION_STATUSES,
  DAILY_AWARENESS_INBOX_STATUSES,
  DAILY_AWARENESS_QUALITY_STATUSES,
} from '../server/daily-awareness.constants.js';

test('daily awareness v2 exposes fixed status enums', () => {
  assert.deepEqual(DAILY_AWARENESS_INBOX_STATUSES, [
    'RECEIVED',
    'PROCESSING',
    'RETRY_PENDING',
    'PROCESSED',
    'DEAD_LETTER',
  ]);
  assert.deepEqual(DAILY_AWARENESS_DATA_STATUSES, ['WAITING', 'READY', 'NO_DATA']);
  assert.ok(DAILY_AWARENESS_GENERATION_STATUSES.includes('NOT_REQUIRED'));
  assert.deepEqual(DAILY_AWARENESS_QUALITY_STATUSES, ['NORMAL', 'PARTIAL_SUMMARY', 'TITLE_ONLY']);
});

test('daily awareness migration is additive and idempotent', async () => {
  const sql = await readFile(new URL('../scripts/init-daily-awareness.sql', import.meta.url), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_event_inbox/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_day_status/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_runs/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS daily_awareness_config/i);
  assert.match(sql, /WHERE publication_scope = 'GLOBAL'/i);
  assert.match(sql, /row_number\(\).*PARTITION BY (?:\w+\.)?brief_date/is);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE\s+daily_briefs|DELETE\s+FROM\s+daily_briefs/i);
});
