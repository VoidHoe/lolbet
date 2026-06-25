// server/tests/auth.test.js
const { hashPassword, verifyPassword } = require('../auth');

test('hashPassword returns salt:hash and is salted (differs each call)', () => {
  const a = hashPassword('hunter2');
  const b = hashPassword('hunter2');
  expect(a).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  expect(a).not.toBe(b); // random salt
});

test('verifyPassword accepts the correct password', () => {
  const stored = hashPassword('hunter2');
  expect(verifyPassword('hunter2', stored)).toBe(true);
});

test('verifyPassword rejects a wrong password', () => {
  const stored = hashPassword('hunter2');
  expect(verifyPassword('wrong', stored)).toBe(false);
});

test('verifyPassword returns false (no throw) on malformed stored value', () => {
  expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  expect(verifyPassword('x', '')).toBe(false);
  expect(verifyPassword('x', undefined)).toBe(false);
});

test('hashPassword throws on empty input', () => {
  expect(() => hashPassword('')).toThrow();
});
