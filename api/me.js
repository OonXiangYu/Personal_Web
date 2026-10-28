// GET /api/me
// Returns the logged-in user, based on the token in the header.
// Header: Authorization: Bearer <token>
// Reply: { user: { id, username } }
// The game calls this on page load, so a player who refreshes stays logged in.

import { ObjectId } from 'mongodb';
import { getUsersCollection, toPublicUser } from './_lib/db.js';
import { getBearerToken, verifyToken } from './_lib/auth.js';
import { allowMethod, sendJson, sendError, handleServerError } from './_lib/http.js';

const LOGIN_AGAIN_MESSAGE = 'Please log in again';

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'GET')) return;

  try {
    const token = getBearerToken(req);
    const payload = token ? verifyToken(token) : null;

    // The token is missing, fake, or expired. The id inside a good token
    // is always a valid ObjectId, but we check in case something is odd.
    if (!payload || !ObjectId.isValid(payload.sub)) {
      return sendError(res, 401, LOGIN_AGAIN_MESSAGE);
    }

    // Look the user up again, instead of trusting the name in the token.
    // This way a deleted account cannot keep playing with an old token.
    const users = await getUsersCollection();
    const user = await users.findOne(
      { _id: new ObjectId(payload.sub) },
      // Do not even load passwordHash. We do not need it here.
      { projection: { passwordHash: 0 } },
    );
    if (!user) {
      return sendError(res, 401, LOGIN_AGAIN_MESSAGE);
    }

    sendJson(res, 200, { user: toPublicUser(user) });
  } catch (err) {
    handleServerError(res, err, 'me');
  }
}
