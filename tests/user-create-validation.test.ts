import assert from 'node:assert/strict';
import { resolveApiErrorMessage } from '../b_k3ewYvsOEc1/src/lib/apiError.js';
import { userPasswordValidationMessage } from '../b_k3ewYvsOEc1/src/lib/userValidation.js';

assert.equal(
  resolveApiErrorMessage(
    { message: 'Password must be at least 8 characters', error: 'Bad Request', statusCode: 400 },
    'HTTP 400',
  ),
  'Password must be at least 8 characters',
);

assert.equal(
  resolveApiErrorMessage({ error: 'username already exists', statusCode: 409 }, 'HTTP 409'),
  'username already exists',
);

assert.equal(
  resolveApiErrorMessage({ message: ['username is required'], error: 'Bad Request' }, 'HTTP 400'),
  'username is required',
);

assert.equal(userPasswordValidationMessage('123456'), '密码至少需要 8 位，并同时包含字母和数字');
assert.equal(userPasswordValidationMessage('abcdefgh'), '密码至少需要 8 位，并同时包含字母和数字');
assert.equal(userPasswordValidationMessage('12345678'), '密码至少需要 8 位，并同时包含字母和数字');
assert.equal(userPasswordValidationMessage('user1234'), '');

console.log('user create validation tests passed');
