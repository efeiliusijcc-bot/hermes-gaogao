import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import { AuthController } from '../server/auth.controller.js';
import { AuthGuard } from '../server/auth.guard.js';
import { AuthService } from '../server/auth.service.js';
import type { AuthUser } from '../server/auth-user.interface.js';
import { AuditLogService } from '../server/audit-log.service.js';
import { UsersService } from '../server/users.service.js';

type Query = { text: string; params?: unknown[] };

function authUser(): AuthUser {
  return {
    id: 'admin-1',
    username: 'admin',
    displayName: 'Admin',
    email: null,
    role: 'admin',
    roles: ['admin'],
    permissions: ['user:manage'],
  };
}

async function assertStatus(response: Response, expected: number) {
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return text ? JSON.parse(text) : null;
}

function decode(token: string) {
  return jwt.decode(token) as { exp?: number; iat?: number; roles?: string[]; permissions?: string[]; typ?: string; ver?: number };
}

function createAuthPoolStub(passwordHash: string, queries: Query[] = [], active = true) {
  let tokenVersion = 0;
  return {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.includes('FROM users') && (params?.[0] === 'admin' || params?.[0] === 'admin-1')) {
        return { rows: [{
          id: 'admin-1',
          username: 'admin',
          password_hash: passwordHash,
          display_name: 'Admin',
          email: null,
          role: 'admin',
          is_active: active,
          token_version: tokenVersion,
        }] };
      }
      if (text.includes('FROM user_roles')) {
        return { rows: [{ role_name: 'admin', resource: 'user', action: 'manage' }] };
      }
      if (text.includes('UPDATE users') && text.includes('password_hash')) {
        tokenVersion += 1;
        return { rows: [{
          id: 'admin-1',
          username: 'admin',
          password_hash: String(params?.[0] || ''),
          display_name: 'Admin',
          email: null,
          role: 'admin',
          is_active: true,
          token_version: tokenVersion,
        }] };
      }
      if (text.includes('UPDATE users') && text.includes('token_version')) {
        if (params?.[1] === tokenVersion) tokenVersion += 1;
        return { rows: [] };
      }
      return { rows: [] };
    },
    end: async () => undefined,
  };
}

async function testAuthTokenAndRefreshCookie() {
  process.env.JWT_SECRET = 'test-secret-for-auth-security';
  const passwordHash = await bcrypt.hash('password123', 4);
  const service = new AuthService({ log: async () => undefined } as never) as AuthService & { getPool: () => Promise<ReturnType<typeof createAuthPoolStub>> };
  service.getPool = async () => createAuthPoolStub(passwordHash);

  @Module({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: service },
      { provide: AuthGuard, useFactory: (auth: AuthService) => new AuthGuard(auth), inject: [AuthService] },
    ],
  })
  class TestModule {}

  const app = await NestFactory.create(TestModule, { logger: ['error'] });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    const loginBody = await assertStatus(loginResponse, 201);
    assert.ok(loginBody.access_token);
    assert.ok(loginBody.user.roles.includes('admin'));
    assert.ok(loginBody.user.permissions.includes('user:manage'));
    const accessPayload = decode(loginBody.access_token);
    assert.ok(accessPayload.exp && accessPayload.iat);
    assert.ok(accessPayload.exp - accessPayload.iat <= 15 * 60 + 2);
    assert.ok(accessPayload.exp - accessPayload.iat >= 15 * 60 - 2);
    assert.equal(accessPayload.ver, 0);
    const cookie = loginResponse.headers.get('set-cookie') || '';
    assert.match(cookie, /refresh_token=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Max-Age=604800/i);

    const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie.split(';')[0] },
    });
    const refreshBody = await assertStatus(refreshResponse, 201);
    assert.ok(refreshBody.access_token);
    assert.ok(refreshBody.user.permissions.includes('user:manage'));
  } finally {
    await app.close();
  }
}

async function testPasswordChangeAndLogoutRevokeIssuedTokens() {
  process.env.JWT_SECRET = 'test-secret-for-auth-security';
  const passwordHash = await bcrypt.hash('password123', 4);

  const passwordPool = createAuthPoolStub(passwordHash);
  const passwordService = new AuthService() as AuthService & { getPool: () => Promise<typeof passwordPool> };
  passwordService.getPool = async () => passwordPool;
  const beforePasswordChange = await passwordService.login('admin', 'password123');
  await passwordService.changePassword(authUser(), 'password123', 'newpass123');
  await assert.rejects(() => passwordService.verifyAccessToken(beforePasswordChange.access_token), (error: unknown) => (
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401)
  ));
  await assert.rejects(() => passwordService.refreshAccessToken(beforePasswordChange.refresh_token), /Invalid or expired refresh token/);

  const logoutPool = createAuthPoolStub(passwordHash);
  const logoutService = new AuthService() as AuthService & { getPool: () => Promise<typeof logoutPool> };
  logoutService.getPool = async () => logoutPool;
  const beforeLogout = await logoutService.login('admin', 'password123');
  await logoutService.revokeRefreshToken(beforeLogout.refresh_token);
  await assert.rejects(() => logoutService.verifyAccessToken(beforeLogout.access_token), (error: unknown) => (
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401)
  ));
  await assert.rejects(() => logoutService.refreshAccessToken(beforeLogout.refresh_token), /Invalid or expired refresh token/);
}

async function testRefreshRejectsInactiveUser() {
  process.env.JWT_SECRET = 'test-secret-for-auth-security';
  const passwordHash = await bcrypt.hash('password123', 4);
  const activeService = new AuthService({ log: async () => undefined } as never) as AuthService & { getPool: () => Promise<ReturnType<typeof createAuthPoolStub>> };
  activeService.getPool = async () => createAuthPoolStub(passwordHash, [], true);
  const login = await activeService.login('admin', 'password123', { ip: '127.0.0.1' });

  const inactiveService = new AuthService({ log: async () => undefined } as never) as AuthService & { getPool: () => Promise<ReturnType<typeof createAuthPoolStub>> };
  inactiveService.getPool = async () => createAuthPoolStub(passwordHash, [], false);
  await assert.rejects(() => inactiveService.refreshAccessToken(login.refresh_token), /Invalid or expired refresh token/);
}

async function testPasswordStrengthAndChangePassword() {
  process.env.JWT_SECRET = 'test-secret-for-auth-security';
  const passwordHash = await bcrypt.hash('password123', 4);
  const service = new AuthService({ log: async () => undefined } as never) as AuthService & { getPool: () => Promise<ReturnType<typeof createAuthPoolStub>> };
  service.getPool = async () => createAuthPoolStub(passwordHash);

  await assert.rejects(() => service.changePassword(authUser(), 'password123', 'short'), /at least 8/);
  await assert.rejects(() => service.changePassword(authUser(), 'wrongpass', 'newpass123'), /old password/i);
  const result = await service.changePassword(authUser(), 'password123', 'newpass123');
  assert.deepEqual(result, { success: true });

  const users = new UsersService() as UsersService & { getPool: () => Promise<ReturnType<typeof createAuthPoolStub>> };
  users.getPool = async () => createAuthPoolStub(passwordHash);
  await assert.rejects(() => users.createUser({ username: 'new', password: 'short', role: 'viewer' }), /at least 8/);
  await assert.rejects(() => users.resetPassword('admin-1', 'short'), /at least 8/);
}

function testAuthMigrationRevokesTokensOnBootstrapRotation() {
  const migration = fs.readFileSync(new URL('../scripts/init-auth-users.sql', import.meta.url), 'utf8');
  assert.match(migration, /token_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /WHEN :'rotate_bootstrap_admin_password'::boolean THEN users\.token_version \+ 1/);
}

async function testLoginFailureLockoutAndAuditSanitization() {
  process.env.JWT_SECRET = 'test-secret-for-auth-security';
  const passwordHash = await bcrypt.hash('password123', 4);
  const auditDetails: unknown[] = [];
  const service = new AuthService({
    log: async (entry: { action: string; detail?: unknown }) => {
      auditDetails.push(entry);
    },
  } as never) as AuthService & { getPool: () => Promise<ReturnType<typeof createAuthPoolStub>> };
  service.getPool = async () => createAuthPoolStub(passwordHash);

  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(() => service.login('admin', 'wrongpass', { ip: '10.0.0.1' }), /Invalid username or password/);
  }
  await assert.rejects(() => service.login('admin', 'password123', { ip: '10.0.0.1' }), /登录失败次数过多/);
  service.clearLoginFailuresForTest('admin', '10.0.0.1');
  const login = await service.login('admin', 'password123', { ip: '10.0.0.1' });
  assert.ok(login.access_token);

  const serialized = JSON.stringify(auditDetails);
  assert.ok(serialized.includes('login_failure'));
  assert.ok(serialized.includes('login_success'));
  assert.ok(!serialized.includes('wrongpass'));
  assert.ok(!serialized.includes('password123'));
  assert.ok(!serialized.includes(login.access_token));
}

await testAuthTokenAndRefreshCookie();
await testRefreshRejectsInactiveUser();
await testPasswordStrengthAndChangePassword();
testAuthMigrationRevokesTokensOnBootstrapRotation();
await testPasswordChangeAndLogoutRevokeIssuedTokens();
await testLoginFailureLockoutAndAuditSanitization();
console.log('auth security tests passed');
