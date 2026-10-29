// Entry point of the real-time server (a Cloudflare Worker).
// Every request comes here first. We check it, then pass WebSocket connections
// to the right game room (a Durable Object, see WorldRoom.js).
//
// URLs:
//   GET  /auth-check                     → 200 if the token is OK, 401 if not (used by the browser to explain errors)
//   WS   /parties/world/<room>?token=...     → join a game room as a logged-in player
//   WS   /parties/world/<room>?guest=1       → join as a guest (no login; the room picks the id and name)
//   WS   /parties/world/<room>?spectator=1   → watch without a fish (read-only; used when the tank is full)
//   (guests and players may also send &handoff=... to keep their place, see shared/protocol.js)

import { routePartykitRequest } from 'partyserver';
import { verifyToken, getBearerToken, isAllowedOrigin } from './auth.js';
import { ALLOWED_ROOMS, SPECTATOR_QUERY_FLAG, GUEST_QUERY_FLAG } from '../../shared/protocol.js';
import {
  PLAYER_ID_HEADER,
  PLAYER_NAME_HEADER,
  CONNECTION_KIND_HEADER,
  KIND_USER,
  KIND_GUEST,
  KIND_SPECTATOR,
} from './WorldRoom.js';

// Wrangler needs the Durable Object class exported from the main file.
export { WorldRoom } from './WorldRoom.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/auth-check') {
      return handleAuthCheck(request, env);
    }

    const response = await routePartykitRequest(request, env, {
      // Runs in the Worker BEFORE the room sees the connection.
      // Bad connections are refused here and never reach the room.
      onBeforeConnect: (req, lobby) => checkConnection(req, lobby, env),
      // We only use WebSockets. Refuse plain HTTP requests to rooms,
      // so they do not wake up a Durable Object for nothing.
      onBeforeRequest: () => textResponse(404, 'Not found'),
    });
    return response || textResponse(404, 'Not found');
  },
};

// Checks a new WebSocket connection.
// Returns a Response to refuse it, or a new Request to let it through.
async function checkConnection(request, lobby, env) {
  if (!isAllowedOrigin(request.headers.get('Origin'), env)) {
    return textResponse(403, 'Origin not allowed');
  }

  // lobby.name is the room name from the URL.
  if (!ALLOWED_ROOMS.includes(lobby.name)) {
    return textResponse(404, 'Unknown room');
  }

  const url = new URL(request.url);

  // A spectator (someone who could not get into a full tank) or a guest
  // (plays without logging in). No token needed. The room decides if there
  // is space, and creates a guest's id and name itself (see WorldRoom.js).
  const kind =
    url.searchParams.get(SPECTATOR_QUERY_FLAG) === '1' ? KIND_SPECTATOR
    : url.searchParams.get(GUEST_QUERY_FLAG) === '1' ? KIND_GUEST
    : null;
  if (kind) {
    // Drop a token if one was sent anyway: they are never a logged-in player.
    url.searchParams.delete('token');
    return withRoleHeaders(new Request(url.toString(), request), kind, null);
  }

  // Browsers cannot set headers on a WebSocket, so the token comes in the URL.
  const player = await verifyToken(url.searchParams.get('token'), env.JWT_SECRET);
  if (!player) {
    return textResponse(401, 'Invalid or expired login');
  }
  // TODO: the token is only checked here, when connecting. A connection that
  // stays open longer than the token lifetime (7 days) keeps working until it
  // reconnects. Later we could close connections when their token expires.

  // Remove the token from the URL before passing it on. PartyServer saves the
  // URL on the connection, and we do not want the token stored anywhere.
  url.searchParams.delete('token');
  return withRoleHeaders(new Request(url.toString(), request), KIND_USER, player);
}

// Sets the headers that tell the room WHO this connection is.
// Only this Worker sets them: we first REMOVE every role header a client may
// have sent, then set the right ones. So nobody can pretend to be a
// registered user (or choose a guest's id or name). The room trusts only
// these values, never a name sent inside a message.
//   kind:   KIND_USER, KIND_GUEST or KIND_SPECTATOR
//   player: { id, name } from the verified token (users only), else null
function withRoleHeaders(request, kind, player) {
  request.headers.delete(PLAYER_ID_HEADER);
  request.headers.delete(PLAYER_NAME_HEADER);
  request.headers.delete(CONNECTION_KIND_HEADER);

  request.headers.set(CONNECTION_KIND_HEADER, kind);
  if (player) {
    request.headers.set(PLAYER_ID_HEADER, player.id);
    // Usernames can be Chinese, but HTTP headers only allow plain ASCII text.
    // encodeURIComponent turns the name into safe ASCII (the room decodes it).
    request.headers.set(PLAYER_NAME_HEADER, encodeURIComponent(player.name));
  }
  return request;
}

// GET /auth-check with "Authorization: Bearer <token>".
// Answers 200 if this server accepts the token, 401 if not.
// The browser calls it when it cannot connect, to find out WHY
// (for example when JWT_SECRET is different on Vercel and here).
async function handleAuthCheck(request, env) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, env)) {
    return textResponse(403, 'Origin not allowed');
  }

  // CORS headers: they let the browser page (on another domain) read our answer.
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Authorization',
    // The answer depends on the Origin, so caches must keep them apart.
    Vary: 'Origin',
  };

  // Because we send an Authorization header, the browser first asks
  // "may I?" with an OPTIONS request (a CORS preflight).
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return textResponse(405, 'Method not allowed', corsHeaders);
  }

  const player = await verifyToken(getBearerToken(request), env.JWT_SECRET);
  // Only say yes or no. Never send the token or the user back.
  return Response.json(
    { ok: Boolean(player) },
    {
      status: player ? 200 : 401,
      headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
    },
  );
}

// Makes a simple plain-text response.
function textResponse(status, text, headers = {}) {
  return new Response(text, { status, headers });
}
