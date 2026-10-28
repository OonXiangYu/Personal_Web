// Entry point of the real-time server (a Cloudflare Worker).
// Every request comes here first. We check it, then pass WebSocket connections
// to the right game room (a Durable Object, see WorldRoom.js).
//
// URLs:
//   GET  /auth-check                 → 200 if the token is OK, 401 if not (used by the browser to explain errors)
//   WS   /parties/world/<room>?token= → join a game room

import { routePartykitRequest } from 'partyserver';
import { verifyToken, getBearerToken, isAllowedOrigin } from './auth.js';
import { ALLOWED_ROOMS } from '../../shared/protocol.js';
import { PLAYER_ID_HEADER, PLAYER_NAME_HEADER } from './WorldRoom.js';

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

  // Browsers cannot set headers on a WebSocket, so the token comes in the URL.
  const url = new URL(request.url);
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
  const checkedRequest = new Request(url.toString(), request);

  // Tell the room who this is. We ALWAYS overwrite these headers, so a client
  // cannot send its own fake ones. The room trusts only these values, never
  // a name sent inside a message.
  checkedRequest.headers.set(PLAYER_ID_HEADER, player.id);
  // Usernames can be Chinese, but HTTP headers only allow plain ASCII text.
  // encodeURIComponent turns the name into safe ASCII (the room decodes it).
  checkedRequest.headers.set(PLAYER_NAME_HEADER, encodeURIComponent(player.name));
  return checkedRequest;
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
