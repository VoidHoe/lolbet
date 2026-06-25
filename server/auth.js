// server/auth.js
// Password hashing with Node's built-in scrypt. No external dependency.
// Stored format: "<saltHex>:<hashHex>".

const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const KEYLEN = 64;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 1) {
    throw new Error('mot de passe vide');
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
