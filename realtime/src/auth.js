// Checks login tokens (JWT) and allowed websites for the real-time server.
// The token is made by our Vercel API (api/_lib/auth.js) with the same JWT_SECRET.
// We use `jose` here because `jsonwebtoken` needs Node and does not run in Workers.

import { jwtVerify } from 'jose';

// So we only print the "secret is missing" warning once, not on every connection.
let warnedAboutMissingSecret = false;

// Checks a token. Returns { id, name } of the user if it is valid, or null.
// "Valid" means: signed with our secret, using HS256, and not expired.
export async function verifyToken(token, secret) {
  if (!secret) {
    if (!warnedAboutMissingSecret) {
      console.error('JWT_SECRET is not set for the Worker. Every connection will be refused.');
      warnedAboutMissingSecret = true;
    }
    return null;
  }
  if (!token) return null;

  try {
    // jsonwebtoken (on Vercel) uses the secret's UTF-8 bytes, so we do the same.
    const key = new TextEncoder().encode(secret);
    // Only allow HS256. This blocks tricks like a token that says "alg: none".
    // jwtVerify also checks the "exp" (expiry) time for us.
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });

    if (typeof payload.sub !== 'string' || typeof payload.name !== 'string') return null;
    return { id: payload.sub, name: payload.name };
  } catch {
    // Bad signature, expired, or not a JWT at all. We do not log the token.
    return null;
  }
}

// Reads the token from an "Authorization: Bearer <token>" header, or returns null.
export function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const [type, token] = header.split(' ');
  return type === 'Bearer' && token ? token : null;
}

// True if `origin` (for example "http://localhost:3000") is in ALLOWED_ORIGINS.
// Browsers always send the Origin header with WebSockets and cross-site
// requests, and a web page cannot fake it. This stops other websites from
// connecting to our server with a visitor's token.
export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    // Forgive small typing mistakes in the config: spaces around an entry,
    // or a "/" at the end. Browsers never send a "/" at the end of Origin.
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return allowed.includes(origin);
}
