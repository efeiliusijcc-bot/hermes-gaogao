import assert from 'node:assert/strict';
import { resolveApiErrorMessage } from '../b_k3ewYvsOEc1/src/lib/apiError.js';
import { userPasswordValidationMessage, userPasswordValidationState } from '../b_k3ewYvsOEc1/src/lib/userValidation.js';

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

assert.deepEqual(userPasswordValidationState(''), {
  valid: false,
  touched: false,
  message: '密码至少 8 位，并同时包含字母和数字',
});
assert.deepEqual(userPasswordValidationState('abc123'), {
  valid: false,
  touched: true,
  message: '密码还需至少 8 位',
});
assert.deepEqual(userPasswordValidationState(' user12 '), {
  valid: false,
  touched: true,
  message: '密码还需至少 8 位',
});
assert.deepEqual(userPasswordValidationState('12345678'), {
  valid: false,
  touched: true,
  message: '密码还需包含字母',
});
assert.deepEqual(userPasswordValidationState('abcdefgh'), {
  valid: false,
  touched: true,
  message: '密码还需包含数字',
});
assert.deepEqual(userPasswordValidationState('user1234'), {
  valid: true,
  touched: true,
  message: '密码要求已满足',
});

console.log('user create validation tests passed');
