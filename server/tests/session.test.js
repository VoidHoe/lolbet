const { sign, read } = require('../session');

test('sign then read round-trips the username', () => {
  const v = sign('GraveDigger');
  expect(read(v)).toBe('GraveDigger');
});

test('read rejects a tampered signature', () => {
  const v = sign('alice');
  const tampered = v.slice(0, -1) + (v.endsWith('a') ? 'b' : 'a');
  expect(read(tampered)).toBe(null);
});

test('read returns null on malformed input', () => {
  expect(read('garbage')).toBe(null);
  expect(read('')).toBe(null);
  expect(read(undefined)).toBe(null);
});
