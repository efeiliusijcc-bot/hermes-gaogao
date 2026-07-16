import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DailyAwarenessInternalController } from '../server/daily-awareness.internal.controller.js';
import { DailyAwarenessInboxService } from '../server/daily-awareness-inbox.service.js';
import { InternalEventKeyGuard } from '../server/internal-event-key.guard.js';
import type { DailyDataFinishedEvent } from '../server/daily-awareness.contracts.js';

const validEvent: DailyDataFinishedEvent = {
  eventId: '01JDAILY20260716001',
  eventType: 'DAILY_DATA_FINISHED',
  businessDate: '2026-07-16',
  batchId: '20260716-001',
  completedAt: '2026-07-17T06:10:00+08:00',
  totalCount: 2864,
};

test('internal event endpoint authenticates, validates, and accepts idempotently without generating', async () => {
  process.env.DAILY_AWARENESS_INTERNAL_EVENT_KEY = 'test-secret';
  const acceptedIds = new Set<string>();
  let wakeCalls = 0;
  let generationCalls = 0;

  @Module({
    controllers: [DailyAwarenessInternalController],
    providers: [
      InternalEventKeyGuard,
      {
        provide: DailyAwarenessInboxService,
        useValue: {
          accept: async (event: DailyDataFinishedEvent) => {
            const duplicate = acceptedIds.has(event.eventId);
            acceptedIds.add(event.eventId);
            wakeCalls += 1;
            return { accepted: true as const, duplicate, eventId: event.eventId };
          },
          generate: async () => {
            generationCalls += 1;
          },
        },
      },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const endpoint = `http://127.0.0.1:${port}/internal/events/daily-data-finished`;

  try {
    const missing = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validEvent),
    });
    assert.equal(missing.status, 401);

    const invalidKey = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'wrong-secret' },
      body: JSON.stringify(validEvent),
    });
    assert.equal(invalidKey.status, 401);

    const invalidEvent = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'test-secret' },
      body: JSON.stringify({ ...validEvent, businessDate: '2026-02-30' }),
    });
    assert.equal(invalidEvent.status, 400);

    const accepted = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'test-secret' },
      body: JSON.stringify(validEvent),
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false, eventId: validEvent.eventId });

    const duplicate = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'test-secret' },
      body: JSON.stringify(validEvent),
    });
    assert.equal(duplicate.status, 202);
    assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true, eventId: validEvent.eventId });
    assert.equal(wakeCalls, 2);
    assert.equal(generationCalls, 0);
  } finally {
    await app.close();
    delete process.env.DAILY_AWARENESS_INTERNAL_EVENT_KEY;
  }
});

test('internal event endpoint refuses service when the internal key is not configured', async () => {
  delete process.env.DAILY_AWARENESS_INTERNAL_EVENT_KEY;

  @Module({
    controllers: [DailyAwarenessInternalController],
    providers: [
      InternalEventKeyGuard,
      { provide: DailyAwarenessInboxService, useValue: { accept: async () => assert.fail('must not accept') } },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/events/daily-data-finished`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hermes-internal-key': 'anything' },
      body: JSON.stringify(validEvent),
    });
    assert.equal(response.status, 503);
  } finally {
    await app.close();
  }
});
