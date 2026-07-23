import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { requestStructureGuard } from '../server/index.js';

function runGuard(body: unknown) {
  let nextCalled = false;
  let status = 200;
  let payload: unknown;
  const response = {
    status(value: number) {
      status = value;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
  } as unknown as Response;
  requestStructureGuard({ body } as Request, response, (() => { nextCalled = true; }) as NextFunction);
  return { nextCalled, status, payload };
}

assert.equal(runGuard({ topic: 'safe', options: { limit: 10 } }).nextCalled, true);
assert.equal(runGuard(JSON.parse('{"__proto__":{"polluted":true}}')).status, 400);

let nested: Record<string, unknown> = {};
let cursor = nested;
for (let index = 0; index < 14; index += 1) {
  cursor.next = {};
  cursor = cursor.next as Record<string, unknown>;
}
assert.equal(runGuard(nested).status, 400);

const indexSource = fs.readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
const authControllerSource = fs.readFileSync(new URL('../server/auth.controller.ts', import.meta.url), 'utf8');
assert.match(indexSource, /app\.use\(helmet\(/);
assert.match(indexSource, /app\.use\(rateLimit\(/);
assert.match(indexSource, /bodyParser: false/);
assert.match(indexSource, /app\.use\(json\(\{ limit: '1mb' \}\)\)/);
assert.match(indexSource, /app\.use\(requestStructureGuard\)/);
assert.match(indexSource, /TRUST_PROXY_HOPS/);
assert.doesNotMatch(authControllerSource, /x-forwarded-for/i);

console.log('HTTP hardening tests passed');
