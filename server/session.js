// server/session.js
// Stateless session: an HMAC-signed cookie value "b64url(username).hexsig".
const { createHmac, timingSafeEqual } = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'lolbet-dev-secret-change-me';

function hmac(username) {
  return createHmac('sha256', SECRET).update(username).digest('hex');
}

function sign(username) {
  return `${Buffer.from(String(username)).toString('base64url')}.${hmac(String(username))}`;
}

function read(value) {
  try {
    const [b64, sig] = String(value).split('.');
    if (!b64 || !sig) return null;
    const username = Buffer.from(b64, 'base64url').toString('utf8');
    const expected = hmac(username);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return username;
  } catch {
    return null;
  }
}

module.exports = { sign, read };
