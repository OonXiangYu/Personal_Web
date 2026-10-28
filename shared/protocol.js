// The messages the browser and the real-time server send to each other.
// Every message is a small JSON object with a `type` field.
// Both sides import this file, so a type name can never be spelled two ways.
// Plain JavaScript only: this file runs in the browser and in a Cloudflare Worker.

// ---------- Where to connect ----------

// The party (server type) name. It comes from the Durable Object binding name
// "World" in realtime/wrangler.jsonc (PartyServer turns it into kebab-case).
export const PARTY_NAME = 'world';

// The room everyone joins for now: the whole world.
export const DEFAULT_ROOM = 'main';

// Rooms the server accepts. Any other name is refused, so nobody can make
// the server create thousands of rooms. To add a map later, add its name here.
export const ALLOWED_ROOMS = ['main'];

// ---------- Message types ----------

export const MSG = {
  // client → server. "This is where I am now."
  //   { type: 'move', x, y, facing, moving }
  //   x, y:    position in game pixels (numbers)
  //   facing:  'left' | 'right'  (side view: the fish faces left or right)
  //   moving:  true while running, false when standing still
  // NOTE: we plan to use this movement data later to train an ML model that
  // spots cheaters. So keep this format simple and do not change it lightly.
  MOVE: 'move',

  // server → client. Sent once, right after connecting.
  //   { type: 'welcome', you: '<your player id>', players: [Player, ...], map }
  //   `players` includes you, with the position the server has for you.
  //   For a spectator (see below), `you` is null.
  //   `map` is the server's map fingerprint (see shared/mapInfo.js). If it is
  //   different from the browser's, one of them has an older map.
  WELCOME: 'welcome',

  // server → client. Someone else entered the room.
  //   { type: 'join', player: Player }
  JOIN: 'join',

  // server → client. Someone left the room.
  //   { type: 'leave', id }
  LEAVE: 'leave',

  // server → client. Sent on every server tick, only if someone moved.
  //   { type: 'state', players: [{ id, x, y, facing, moving }, ...] }
  //   Only players that changed since the last tick are listed.
  STATE: 'state',

  // client → server. "I said this."
  //   { type: 'chat', text }
  // server → client. Someone said something (sent right away, not on the tick).
  //   { type: 'chat', id, name, text, ts }
  //   id:   the speaker's player id
  //   name: the speaker's username, taken from their login token by the server
  //   text: the cleaned (and later, moderated) text
  //   ts:   server time in milliseconds, when the server accepted the message
  // Both directions use the same type name, like a normal chat.
  CHAT: 'chat',

  // server → client. A short message for this player only, shown briefly.
  //   { type: 'notice', text }
  //   For example "You are sending messages too fast".
  NOTICE: 'notice',
};

// A "Player" in the messages above looks like this:
//   { id, name, x, y, facing, moving }
// `id` is the user id from the login token. `name` is the username.

// ---------- Timing ----------

// How often the browser may send a `move` message (only if something changed).
// 100 ms = 10 times per second.
export const CLIENT_SEND_INTERVAL_MS = 100;

// How often the server sends one `state` message to everyone.
// 100 ms = 10 times per second.
export const SERVER_TICK_MS = 100;

// ---------- Limits (protect the server) ----------

// A `move` message is about 60 bytes. Anything much bigger is not ours.
// This limit is for every message type EXCEPT chat.
export const MAX_MESSAGE_BYTES = 200;

// The longest chat text, counted in characters (not bytes).
// "你好" is 2 characters, even though it uses 6 bytes.
export const CHAT_MAX_CHARS = 80;

// The size limit for a whole chat message, in bytes.
// 80 characters can need up to 4 bytes each in UTF-8 (320 bytes), and JSON
// can make some characters longer (for example a quote becomes \"),
// so we allow a lot more than 200.
export const MAX_CHAT_MESSAGE_BYTES = 1024;

// More messages than this per second from one connection are ignored.
// A normal client sends at most 10.
export const MAX_MESSAGES_PER_SECOND = 30;

// ---------- Close codes ----------
// WebSocket close codes 4000–4999 are free for apps to use.

// "You logged in from another tab or device, so this connection was closed."
// The browser must NOT reconnect automatically after this one, or the two
// tabs would keep kicking each other out forever.
export const CLOSE_REPLACED = 4001;

// "There are already MAX_SPECTATORS spectators in this room."
// Sent right after a spectator connects, instead of refusing the connection
// with an HTTP error: the browser cannot read why an HTTP refusal happened
// and would keep retrying, but it can read this code. The page must NOT
// reconnect; it just shows the map without players.
export const CLOSE_SPECTATORS_FULL = 4003;

// "You have watched for SPECTATOR_MAX_MS, so this connection was closed."
// Protects the free plan from login pages left open for hours.
// The page must NOT reconnect; the map keeps drifting without players.
export const CLOSE_SPECTATOR_TIME_UP = 4004;

// ---------- Spectators ----------
// A spectator is a logged-out visitor watching the world behind the login
// form. They connect with no token and this query flag: ?spectator=1
// They receive positions (welcome, join, leave, state), but never chat.
// They cannot send anything, and they are not counted as players.
export const SPECTATOR_QUERY_FLAG = 'spectator';

// At most this many spectators per room. Extra ones get CLOSE_SPECTATORS_FULL.
export const MAX_SPECTATORS = 50;

// A spectator connection is closed after this long (10 minutes).
export const SPECTATOR_MAX_MS = 10 * 60 * 1000;
