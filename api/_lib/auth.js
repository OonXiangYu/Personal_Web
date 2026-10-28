// Login tokens (JWT) and password hashing.
// A token proves "this browser logged in as this user" without asking for the
// password again. It is signed with JWT_SECRET, so nobody can fake one.

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// How long a login lasts before the player must log in again.
const TOKEN_LIFETIME = '7d';

// bcrypt cost. Higher is slower to crack but also slower for our server.
// 10 is a common, safe choice for a small game.
const BCRYPT_COST = 10;

// A real bcrypt hash (cost 10) of a random password nobody knows.
// When a username does not exist, we still compare against this hash,
// so the response takes the same time as for a real user.
// Otherwise an attacker could time the response to find valid usernames.
const FAKE_PASSWORD_HASH = '$2b$10$skUOHW5cMyE00yw2ME.eh.ndG8sOABb1oNHXxPWIbuKyZK0B1c21a';

// Thrown when the server is set up wrong (for example a missing env variable).
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Reads JWT_SECRET, or throws a clear error if it is missing.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new ConfigError('JWT_SECRET is not set. Add it to your environment variables.');
  }
  return secret;
}

// Makes a token for a user.
// The payload only has the user id (sub) and the name. Nothing secret goes in,
// because anyone can read a JWT payload. The signature only stops changes.
export function createToken(user) {
  const payload = { sub: String(user._id), name: user.username };
  return jwt.sign(payload, getSecret(), {
    expiresIn: TOKEN_LIFETIME,
    algorithm: 'HS256',
  });
}

// Checks a token. Returns the payload if it is valid, or null if it is not
// (bad signature, expired, or garbage).
export function verifyToken(token) {
  // Read the secret outside the try block, so a missing secret is reported
  // as a setup error and not as "your token is bad".
  const secret = getSecret();
  try {
    // Only allow HS256. This blocks tricks like a token that says "alg: none".
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// Gets the token from the "Authorization: Bearer <token>" header.
// Returns null if the header is missing or in the wrong format.
export function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) {
    return null;
  }
  return token;
}

// Turns a password into a bcrypt hash for storing in the database.
export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

// Checks a password against a stored hash.
// If there is no stored hash (user not found), it checks against the fake
// hash instead. This always returns false, but takes the normal amount of time.
export async function passwordMatches(password, storedHash) {
  const hashToCheck = storedHash || FAKE_PASSWORD_HASH;
  const matches = await bcrypt.compare(password, hashToCheck);
  return Boolean(storedHash) && matches;
}
