// Single-owner auth: a password you set in ADMIN_PASSWORD, and an HMAC-signed cookie.
// Also used to sign OAuth `state` values (stateless, so it works on serverless).
import crypto from 'node:crypto';

export const COOKIE = 'pp_session';
const DAY = 86_400_000;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.STORE === 'file') return 'dev-only-secret'; // local dev convenience
  throw new Error('AUTH_SECRET is not set');
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function sign(payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${mac(body)}`;
}

export function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!same(sig, mac(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export const newSession = () => sign({ exp: Date.now() + 30 * DAY });
export const validSession = (token) => !!verify(token);

export function checkPassword(given) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real || !given) return false;
  // hash both so lengths match for the constant-time compare
  const h = (s) => crypto.createHash('sha256').update(s).digest('base64url');
  return same(h(given), h(real));
}
