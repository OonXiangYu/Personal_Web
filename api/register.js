// POST /api/register
// Creates a new account and logs the player in at once.
// Body: { username, password }
// Reply: { token, user: { id, username } }

import { ObjectId } from 'mongodb';
import { getUsersCollection, toPublicUser } from './_lib/db.js';
import { createToken, hashPassword } from './_lib/auth.js';
import { checkUsername, checkPassword, toUsernameLower } from '../shared/validate.js';
import { allowMethod, readBody, sendJson, sendError, handleServerError } from './_lib/http.js';

// MongoDB error code for "this value breaks a unique index".
const DUPLICATE_KEY_ERROR = 11000;

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;

  // TODO: add rate limiting here (for example, max N sign-ups per IP per hour)
  // so one person cannot create thousands of accounts.

  const { username, password } = readBody(req);

  // Check the input first. This is the real check: the browser check
  // can be skipped by anyone calling the API directly.
  const usernameError = checkUsername(username);
  if (usernameError) return sendError(res, 400, usernameError);

  const passwordError = checkPassword(password);
  if (passwordError) return sendError(res, 400, passwordError);

  try {
    const now = new Date();

    // We make the id ourselves, so we can create the token BEFORE saving.
    // If JWT_SECRET is missing, we fail here and no half-made account is saved.
    const userDoc = {
      _id: new ObjectId(),
      username,
      usernameLower: toUsernameLower(username),
      passwordHash: await hashPassword(password),
      createdAt: now,
      lastLoginAt: now,
      lastPosition: null, // filled in later, when we save where the player stood
      appearance: 0, // which character look the player uses (only one for now)
    };
    const token = createToken(userDoc);

    const users = await getUsersCollection();
    // The unique index on usernameLower stops duplicates, even if two
    // people register the same name at the exact same moment.
    await users.insertOne(userDoc);

    sendJson(res, 201, { token, user: toPublicUser(userDoc) });
  } catch (err) {
    if (err?.code === DUPLICATE_KEY_ERROR) {
      return sendError(res, 409, 'Username is already taken');
    }
    handleServerError(res, err, 'register');
  }
}
