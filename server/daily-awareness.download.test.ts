import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { DailyAwarenessController } from './daily-awareness.controller.js';
import type { AuthUser } from './auth-user.interface.js';

const user: AuthUser = {
  id: 'user-1',
  username: 'operator',
  displayName: 'Operator',
  email: null,
  role: 'operator',
  roles: ['operator'],
  modules: ['daily'],
  permissions: ['daily_awareness:read'],
};

test('daily awareness download controller returns docx headers and buffer', async () => {
  const service = {
    async downloadBrief(briefId: string, authUser: AuthUser, format: string) {
      assert.equal(briefId, 'brief-1');
      assert.equal(authUser.id, 'user-1');
      assert.equal(format, 'docx');
      return {
        buffer: Buffer.from('docx-binary'),
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: '2026-07-06-每日动态简报.docx',
      };
    },
  };
  const controller = new DailyAwarenessController(service as never);
  const response = mockResponse();

  await controller.downloadBrief('brief-1', user, 'docx', response as never);

  assert.equal(response.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(response.headers['Content-Disposition'], /2026-07-06-/);
  assert.deepEqual(response.body, Buffer.from('docx-binary'));
});

test('daily awareness service download rejects pdf explicitly', async () => {
  const service = {
    async downloadBrief(_briefId: string, _authUser: AuthUser, format: string) {
      if (format === 'pdf') throw new BadRequestException({ error: 'PDF export is not supported yet. Please use format=docx.' });
      throw new Error('unexpected format');
    },
  };
  const controller = new DailyAwarenessController(service as never);

  await assert.rejects(
    () => controller.downloadBrief('brief-1', user, 'pdf', mockResponse() as never),
    BadRequestException,
  );
});

function mockResponse() {
  return {
    headers: {} as Record<string, string>,
    body: undefined as Buffer | undefined,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    send(body: Buffer) {
      this.body = body;
      return this;
    },
  };
}
