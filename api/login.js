// POST /api/login
// Checks a username and password.
// Body: { username, password }
// Reply: { token, user: { id, username } }

import { getUsersCollection, toPublicUser } from './_lib/db.js';
import { createToken, passwordMatches } from './_lib/auth.js';
import { checkUsername, checkPassword, toUsernameLower } from '../shared/validate.js';
import { allowMethod, readBody, sendJson, sendError, handleServerError } from './_lib/http.js';

// Always the same message, so the reply never tells an attacker
// whether the username or the password was the wrong part.
const WRONG_LOGIN_MESSAGE = 'Wrong username or password';

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;

  // TODO: add login rate limiting (for example, max N tries per IP and per
  // username every 15 minutes) to slow down password guessing.

  const { username, password } = readBody(req);

  // Every saved account passed these rules when it was made.
  // So if the input breaks a rule, it cannot be a correct login.
  // This also stops huge passwords from reaching bcrypt.
  if (checkUsername(username) || checkPassword(password)) {
    return sendError(res, 401, WRONG_LOGIN_MESSAGE);
  }

  try {
    const users = await getUsersCollection();
    const user = await users.findOne({ usernameLower: toUsernameLower(username) });

    // Run bcrypt even if the user was not found (see passwordMatches),
    // so both cases take the same time.
    const ok = await passwordMatches(password, user?.passwordHash);
    if (!user || !ok) {
      return sendError(res, 401, WRONG_LOGIN_MESSAGE);
    }

    const token = createToken(user);
    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    sendJson(res, 200, { token, user: toPublicUser(user) });
  } catch (err) {
    handleServerError(res, err, 'login');
  }
}
