// One game room: a Durable Object that holds everyone in one map.
// All fish in the room connect to the SAME object, so it can see everyone
// and send them each other's positions.
//
// It does these jobs:
//   1. Keep a list of fish: logged-in players and guests (who is here, where).
//   2. Create guests: the room gives each guest an id and a name. The
//      browser cannot choose them.
//   3. Check every `move` message (not too fast, not off the map).
//   4. Send everyone one `state` message 10 times per second (the "tick").
//   5. Allow only one connection per account.
//   6. Check chat messages and send them to the fish (stricter for guests).
//   7. "Handoff": keep a fish's place when the page reconnects (login,
//      logout, dropped connection, "Rejoin").
//   8. Protect the free plan: at most MAX_FISH_PER_ROOM fish, close idle
//      fish, and let extra visitors watch as limited "spectators".

import { Server } from 'partyserver';
import {
  MSG,
  SERVER_TICK_MS,
  MAX_MESSAGE_BYTES,
  MAX_CHAT_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  CHAT_MAX_CHARS,
  GUEST_CHAT_MAX_CHARS,
  CLOSE_REPLACED,
  CLOSE_SPECTATORS_FULL,
  CLOSE_SPECTATOR_TIME_UP,
  CLOSE_TANK_FULL,
  CLOSE_IDLE,
  MAX_SPECTATORS,
  SPECTATOR_MAX_MS,
  MAX_FISH_PER_ROOM,
  GUEST_IDLE_MS,
  PLAYER_IDLE_MS,
  HANDOFF_QUERY_NAME,
  HANDOFF_MS,
} from '../../shared/protocol.js';
import { MOVE_SPEED, FACINGS } from '../../shared/world.js';
import { clampToMap, slideMove, findFreeSpot, pickSpawnPoint } from '../../shared/mapInfo.js';
import { worldMap } from './worldMap.js';
import { cleanChatText, countCharacters, ChatLimiter, PLAYER_CHAT_LIMITS, GUEST_CHAT_LIMITS } from './chat.js';
import { moderateMessage } from './moderation.js';

// When checking walls, the server makes the fish's hit box 1 px smaller than
// the browser does. Tiny rounding differences then never block an honest
// player who is standing right against a wall.
const WALL_CHECK_SHRINK = 1;

// Texts of the notices we send to a player.
const NOTICE_TOO_FAST = 'You are sending messages too fast';
const NOTICE_TOO_LONG = 'Message too long';
const NOTICE_BLOCKED = 'Your message was not sent';

// Headers set by index.js after checking the connection. Only index.js sets
// them (it removes any that a client sent).
export const PLAYER_ID_HEADER = 'X-Player-Id';
export const PLAYER_NAME_HEADER = 'X-Player-Name';
// What kind of connection this is: one of the KIND_ values below.
export const CONNECTION_KIND_HEADER = 'X-Connection-Kind';
export const KIND_USER = 'user'; // logged in (id and name from the verified token)
export const KIND_GUEST = 'guest'; // no login (the room makes the id and name)
export const KIND_SPECTATOR = 'spectator'; // watches only (the tank was full)

// Guest names: "Guest_" + 4 random digits, never the same as another fish's.
const GUEST_NAME_START = 'Guest_';

// How often to look for idle fish (it does not need to be exact).
const IDLE_CHECK_EVERY_MS = 5000;

// ---------- Movement check ----------
// Each player has a "movement allowance" in pixels, like a bucket of water.
// Moving uses some of it. Time fills it up again at MOVE_SPEED × SPEED_TOLERANCE.
// The bucket has a maximum size, so a player cannot save up allowance by
// standing still and then jump far away.
// Why a bucket and not "distance per message"? Messages arrive unevenly over
// the internet (sometimes two at once). The bucket keeps a little spare
// allowance for that, but on average a player can never go faster than allowed.

// Allow 20% more than the real speed, for timing differences between devices.
const SPEED_TOLERANCE = 1.2;
// The bucket holds at most this much (half a second of walking).
const MAX_ALLOWANCE = MOVE_SPEED * 0.5;

// We remember where logged-in players were when they left, so a QUICK
// reconnect (for example a dropped phone connection, without a handoff)
// puts them back in the same spot. After this long, a returning player
// starts in the shallow spawn area again, like a new visit.
const QUICK_RECONNECT_MS = 60_000;
// Also never keep more than this many saved spots (extra safety for memory).
// This is only in memory: it is lost when the room shuts down.
// TODO: save positions to MongoDB (`lastPosition`) instead.
const MAX_REMEMBERED_POSITIONS = 1000;

export class WorldRoom extends Server {
  // No hibernation. While anyone is online, our 10-per-second tick keeps the
  // object awake anyway, so hibernation would not save anything. When no
  // fish are left we stop the tick, and when nobody at all is connected,
  // Cloudflare can shut the object down.
  // Note: an open spectator connection also keeps the object running (and
  // counting free-plan run time), even with the tick stopped. That is why
  // spectators are capped (MAX_SPECTATORS) and closed after SPECTATOR_MAX_MS,
  // fish are capped (MAX_FISH_PER_ROOM) and idle fish are closed.
  // Run time is counted per object, not per connection, so one room can use
  // at most 24 h × 128 MB = 10,800 GB-s a day, under the free 13,000.
  static options = { hibernate: false };

  // Fish id → fish object (see onConnect for the fields). Players AND guests.
  players = new Map();

  // Connection id → fish id. Lets us find the fish for a message.
  playerIdByConnection = new Map();

  // User id → { x, y, leftAt }, where a logged-in player was when they left.
  // Oldest first (see rememberPosition), so old ones are easy to remove.
  lastPositions = new Map();

  // Handoff token → either
  //   { playerId }                            the fish is still connected
  //   { saved: { x, y, facing, guest }, expiresAt }   the fish has left
  // (`guest` is { id, name } if it was a guest, so a guest gets them back.)
  handoffs = new Map();

  // Ids of fish that moved since the last tick.
  changedIds = new Set();

  // The setInterval handle of the tick, or null when the tick is stopped.
  tickTimer = null;

  // When we last looked for idle fish.
  lastIdleCheckAt = 0;

  // Spectators: connection id → the timer that closes them after SPECTATOR_MAX_MS.
  // Spectators are NOT in `players`: they are not counted, not shown, and
  // they never start the tick.
  spectators = new Map();

  // Called when a WebSocket connection is open.
  // index.js has already checked the origin and the room name, set the
  // connection kind, and (for logged-in players) checked the token.
  onConnect(connection, ctx) {
    const kind = ctx.request.headers.get(CONNECTION_KIND_HEADER);
    if (kind === KIND_SPECTATOR) {
      this.addSpectator(connection);
      return;
    }
    if (kind !== KIND_USER && kind !== KIND_GUEST) {
      // Should never happen, because index.js always sets the kind.
      connection.close(1008, 'Unknown connection');
      return;
    }

    // A handoff token from the page's previous connection (if any, and valid).
    const token = new URL(ctx.request.url).searchParams.get(HANDOFF_QUERY_NAME);
    const handoff = this.takeHandoff(token);

    // Who is this?
    //   Logged-in player: id and name from the verified token (via index.js).
    //   Guest with a handoff from a guest: the SAME guest again (reconnect).
    //   Other guests: a new guest, made here. The browser cannot choose it.
    let id;
    let name;
    if (kind === KIND_USER) {
      id = ctx.request.headers.get(PLAYER_ID_HEADER);
      name = decodeName(ctx.request.headers.get(PLAYER_NAME_HEADER));
      if (!id || !name) {
        connection.close(1008, 'Not logged in');
        return;
      }
    } else if (handoff?.guest) {
      ({ id, name } = handoff.guest);
    } else {
      ({ id, name } = this.newGuestIdentity());
    }

    // If the handoff's fish is still connected (the new connection came in
    // before the old one closed), it is replaced now: removed (or, if it is
    // the same fish, simply taken over below).
    if (handoff?.livePlayer && handoff.livePlayer.id !== id) {
      this.removeFish(handoff.livePlayer, { closeCode: CLOSE_REPLACED, keepHandoff: false });
    }

    // The same fish already here: another tab of the same account ("Play
    // here"), or a guest reconnecting before its old connection closed.
    const oldPlayer = this.players.get(id);

    // Is there room? A handoff or a takeover never adds a fish, so it is
    // never refused. (A guest who logs in keeps their place.)
    if (!handoff && !oldPlayer && this.players.size >= MAX_FISH_PER_ROOM) {
      connection.close(CLOSE_TANK_FULL, 'The tank is full');
      return;
    }

    if (oldPlayer) {
      // Close the OLD connection. One fish per account.
      this.playerIdByConnection.delete(oldPlayer.connectionId);
      this.handoffs.delete(oldPlayer.handoff);
      this.getConnection(oldPlayer.connectionId)?.close(CLOSE_REPLACED, 'Logged in somewhere else');
    }

    // Where does this fish start?
    //   1. A handoff: where the page's previous fish was.
    //   2. Taking over the same fish: where it is now.
    //   3. A logged-in player back within QUICK_RECONNECT_MS: where they left.
    //   4. Otherwise: a random spot in the shallow spawn area.
    // A remembered spot may now be inside a wall (if the map changed), so it
    // goes to the nearest free spot. pickSpawnPoint is always free already.
    this.forgetOldPositions();
    const remembered = handoff || oldPlayer || (kind === KIND_USER ? this.lastPositions.get(id) : null);
    const start = remembered ? findFreeSpot(worldMap, remembered.x, remembered.y) : pickSpawnPoint(worldMap);

    const isGuest = kind === KIND_GUEST;
    const now = Date.now();
    const player = {
      id,
      name,
      kind,
      connectionId: connection.id,
      x: start.x,
      y: start.y,
      facing: remembered?.facing || 'left',
      moving: false,
      // For the movement check.
      allowance: MAX_ALLOWANCE,
      lastMoveAt: now,
      // For closing idle fish: the last time they moved or chatted.
      lastActiveAt: now,
      // For the message rate limit.
      messageWindowStart: 0,
      messageCount: 0,
      // For the chat limits (speed, duplicates). Stricter for guests.
      chat: new ChatLimiter(isGuest ? GUEST_CHAT_LIMITS : PLAYER_CHAT_LIMITS),
      // This connection's handoff token (sent in `welcome`).
      handoff: crypto.randomUUID(),
    };
    this.players.set(id, player);
    this.playerIdByConnection.set(connection.id, id);
    this.handoffs.set(player.handoff, { playerId: id });

    // Tell the new fish who they are and who is already here.
    this.sendTo(connection, {
      type: MSG.WELCOME,
      you: id,
      players: [...this.players.values()].map(toPublicPlayer),
      // Lets the browser check that it has the same map as the server.
      map: worldMap.fingerprint,
      // The secret to send with the page's next connection (see shared/protocol.js).
      handoff: player.handoff,
    });

    if (oldPlayer) {
      // Others already know this fish. Just send the (maybe new) position.
      this.changedIds.add(id);
    } else {
      this.broadcastJson({ type: MSG.JOIN, player: toPublicPlayer(player) }, [connection.id]);
    }

    this.startTick();
  }

  // A visitor who could not get into a full tank watches instead. They get
  // the same position updates as fish (welcome, join, leave, state), but
  // never chat, and they cannot send anything (see onMessage).
  addSpectator(connection) {
    if (this.spectators.size >= MAX_SPECTATORS) {
      // Room full of watchers. The close code tells the page not to retry.
      connection.close(CLOSE_SPECTATORS_FULL, 'Too many spectators');
      return;
    }

    // Close it after SPECTATOR_MAX_MS, so a page left open for hours does
    // not keep the room running. (onClose removes it from the map.)
    const timer = setTimeout(() => {
      connection.close(CLOSE_SPECTATOR_TIME_UP, 'Spectator time is up');
    }, SPECTATOR_MAX_MS);
    this.spectators.set(connection.id, timer);

    this.sendTo(connection, {
      type: MSG.WELCOME,
      you: null, // not a fish
      players: [...this.players.values()].map(toPublicPlayer),
      map: worldMap.fingerprint,
    });
    // No startTick() here: only fish start it.
  }

  // Called for every message from a connection.
  // Anything strange is ignored, never allowed to crash the room.
  onMessage(connection, message) {
    // Spectators are read-only. Drop everything they send, before any other
    // work (no parsing, no rate limit counting).
    if (this.spectators.has(connection.id)) return;

    const player = this.getPlayerFor(connection);
    if (!player) return;

    // We only use text messages. A string's length (in UTF-16 units) is never
    // more than its size in bytes, so this cheap check already drops anything
    // bigger than the largest message we accept. The exact byte check per
    // message type comes after parsing, below.
    if (typeof message !== 'string' || message.length > MAX_CHAT_MESSAGE_BYTES) return;

    // Rate limit: count messages in 1-second windows.
    const now = Date.now();
    if (now - player.messageWindowStart >= 1000) {
      player.messageWindowStart = now;
      player.messageCount = 0;
    }
    player.messageCount += 1;
    if (player.messageCount > MAX_MESSAGES_PER_SECOND) return;

    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    // Each type has its own size limit. Chat needs more room, because
    // 80 Chinese characters use 240 bytes in UTF-8.
    const bytes = new TextEncoder().encode(message).length;

    if (data?.type === MSG.MOVE) {
      if (bytes > MAX_MESSAGE_BYTES) return;
      this.handleMove(player, data, now);
    } else if (data?.type === MSG.CHAT) {
      if (bytes > MAX_CHAT_MESSAGE_BYTES) return;
      // handleChat waits for moderation, so it is async. We do not wait for it
      // here, but we catch errors so a bad message can never crash the room.
      this.handleChat(connection, player, data, now).catch((err) => {
        // Only the error message. Never the chat text.
        console.error(`[room ${this.name}] chat error: ${err?.message}`);
      });
    }
    // Unknown types are ignored.
  }

  // Checks a `chat` message and sends it to every fish.
  // The order of the checks matters:
  //   clean → empty? → too long? → duplicate? → too fast? → moderation → send
  // Cheap checks come first. Moderation (later an ML model) comes last,
  // so spam never reaches it.
  // Never log the text: chat is private to the players in the room.
  async handleChat(connection, player, data, now) {
    const text = cleanChatText(data.text);
    if (!text) return;

    // Writing counts as being active (not idle).
    player.lastActiveAt = now;

    // Reject, do not cut. Cutting could change the meaning of a message.
    // The browser stops at the limit, so only a modified client gets here.
    // Guests have a shorter limit.
    const maxCharacters = player.kind === KIND_GUEST ? GUEST_CHAT_MAX_CHARS : CHAT_MAX_CHARS;
    if (countCharacters(text) > maxCharacters) {
      this.sendNotice(connection, player, NOTICE_TOO_LONG, now);
      return;
    }

    // The same text again within a few seconds: ignore it quietly.
    if (player.chat.isDuplicate(text, now)) return;

    if (!player.chat.tryUse(now)) {
      this.sendNotice(connection, player, NOTICE_TOO_FAST, now);
      return;
    }
    player.chat.remember(text, now);

    // ALL chat goes through moderateMessage(), guests too. See moderation.js.
    const result = await moderateMessage(text, {
      id: player.id,
      name: player.name,
      guest: player.kind === KIND_GUEST,
    });

    // Moderation may take time. If the fish left or was replaced by another
    // tab meanwhile, do not send anything.
    if (this.players.get(player.id) !== player) return;

    if (!result?.allowed) {
      this.sendNotice(connection, player, NOTICE_BLOCKED, now);
      return;
    }

    // Use the text moderation gave back (it may be a masked version).
    const finalText = typeof result.text === 'string' ? result.text : text;

    // Send right away, not on the tick: chat should feel instant.
    // The sender gets it too, so they see the same text everyone else sees.
    // The name comes from the token or the room, never from the client.
    // Spectators are left out: chat is for the fish only.
    this.broadcastJson(
      {
        type: MSG.CHAT,
        id: player.id,
        name: player.name,
        text: finalText,
        ts: Date.now(),
      },
      [...this.spectators.keys()],
    );
  }

  // Sends a short notice to one player, but not more often than every 2 seconds.
  sendNotice(connection, player, text, now) {
    if (!player.chat.canSendNotice(now)) return;
    this.sendTo(connection, { type: MSG.NOTICE, text });
  }

  // Checks a `move` message and updates the fish's position.
  // NOTE: this movement data will later be used to train an ML model that
  // spots cheaters. Keep the `move` format simple and consistent.
  handleMove(player, data, now) {
    const { x, y, facing, moving } = data;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!FACINGS.includes(facing) || typeof moving !== 'boolean') return;

    // Moving counts as being active (not idle).
    player.lastActiveAt = now;

    // Refill the movement allowance for the time that passed.
    const seconds = (now - player.lastMoveAt) / 1000;
    player.allowance = Math.min(
      MAX_ALLOWANCE,
      player.allowance + MOVE_SPEED * SPEED_TOLERANCE * seconds,
    );
    player.lastMoveAt = now;

    // How far do they want to go?
    const dx = x - player.x;
    const dy = y - player.y;
    const distance = Math.hypot(dx, dy);

    let newX = x;
    let newY = y;
    if (distance > player.allowance) {
      // Too far. Move them only as far as allowed, in the same direction.
      // (We do not tell the client. Its next moves let the server catch up.)
      const ratio = player.allowance / distance;
      newX = player.x + dx * ratio;
      newY = player.y + dy * ratio;
    }

    // Keep the whole body inside the map.
    const inside = clampToMap(worldMap, newX, newY);

    // Walk there step by step, stopping at walls and sliding along them,
    // the same way the browser's physics does. A cheater cannot walk
    // through walls, or hop over a thin wall in one big move.
    const final = slideMove(worldMap, player.x, player.y, inside.x, inside.y, WALL_CHECK_SHRINK);

    player.allowance -= Math.hypot(final.x - player.x, final.y - player.y);
    player.x = roundToTenth(final.x);
    player.y = roundToTenth(final.y);
    player.facing = facing;
    player.moving = moving;

    // Do not send it now. The next tick sends all changes in one message.
    this.changedIds.add(player.id);
  }

  // Called when a connection closes (tab closed, network lost, replaced, idle...).
  onClose(connection) {
    // A spectator left (or was closed): just forget them. They never
    // touched the fish list or the tick.
    if (this.spectators.has(connection.id)) {
      clearTimeout(this.spectators.get(connection.id));
      this.spectators.delete(connection.id);
      return;
    }

    const player = this.getPlayerFor(connection);
    this.playerIdByConnection.delete(connection.id);

    // Only remove the fish if THIS connection still owns it. When a fish was
    // replaced (another tab, or a handoff), the old connection closes later
    // and must not remove the fish the new connection now controls.
    if (player && player.connectionId === connection.id) {
      this.removeFish(player, { closeCode: null, keepHandoff: true });
    }
  }

  onError(connection, error) {
    // Only the message. Never the URL (it could hold a token in other setups).
    console.error(`[room ${this.name}] connection error: ${error?.message}`);
  }

  // ---------- Fish coming and going ----------

  // Removes a fish from the room and tells everyone.
  //   closeCode:   close its connection with this code (or null if it is
  //                already closing)
  //   keepHandoff: save its place under its handoff token for HANDOFF_MS,
  //                so the page's next connection can continue from there
  removeFish(player, { closeCode, keepHandoff }) {
    this.players.delete(player.id);
    this.changedIds.delete(player.id);
    this.playerIdByConnection.delete(player.connectionId);

    if (keepHandoff) {
      this.handoffs.set(player.handoff, {
        saved: {
          x: player.x,
          y: player.y,
          facing: player.facing,
          guest: player.kind === KIND_GUEST ? { id: player.id, name: player.name } : null,
        },
        expiresAt: Date.now() + HANDOFF_MS,
      });
    } else {
      this.handoffs.delete(player.handoff);
    }
    if (player.kind === KIND_USER) {
      this.rememberPosition(player);
    }
    if (closeCode !== null) {
      this.getConnection(player.connectionId)?.close(closeCode, 'Replaced');
    }

    this.broadcastJson({ type: MSG.LEAVE, id: player.id });
    if (this.players.size === 0) {
      this.stopTick();
    }
  }

  // Uses up a handoff token. Returns null if it is missing, unknown or too
  // old. Otherwise returns { x, y, facing, guest, livePlayer }:
  //   livePlayer: the fish, if it is still connected (else null)
  //   guest:      { id, name } if the old fish was a guest (else null)
  // A token works only once: it is removed here.
  takeHandoff(token) {
    this.forgetOldHandoffs();
    if (!token) return null;
    const entry = this.handoffs.get(token);
    if (!entry) return null;
    this.handoffs.delete(token);

    if (entry.playerId) {
      const live = this.players.get(entry.playerId);
      if (!live) return null;
      return {
        x: live.x,
        y: live.y,
        facing: live.facing,
        guest: live.kind === KIND_GUEST ? { id: live.id, name: live.name } : null,
        livePlayer: live,
      };
    }
    return { ...entry.saved, livePlayer: null };
  }

  // Removes saved handoffs that are too old.
  forgetOldHandoffs() {
    const now = Date.now();
    for (const [token, entry] of this.handoffs) {
      if (entry.expiresAt && entry.expiresAt < now) this.handoffs.delete(token);
    }
  }

  // A new guest: a random id, and "Guest_" + 4 random digits that no other
  // fish (or recently left guest) is using.
  newGuestIdentity() {
    const usedNames = new Set([...this.players.values()].map((p) => p.name));
    for (const entry of this.handoffs.values()) {
      if (entry.saved?.guest) usedNames.add(entry.saved.guest.name);
    }
    let name;
    for (let tries = 0; tries < 50; tries++) {
      name = GUEST_NAME_START + String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
      if (!usedNames.has(name)) break;
    }
    return { id: `guest:${crypto.randomUUID()}`, name };
  }

  // ---------- Tick ----------

  // Starts the tick if it is not running yet.
  startTick() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), SERVER_TICK_MS);
  }

  // Stops the tick. A running timer keeps the Durable Object awake and costs
  // free-plan time, so we stop it as soon as the room has no fish.
  stopTick() {
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // Sends one `state` message with every fish that changed, and now and
  // then closes idle fish.
  // One message per tick (not one per `move`) keeps traffic low and steady.
  tick() {
    const now = Date.now();
    if (now - this.lastIdleCheckAt >= IDLE_CHECK_EVERY_MS) {
      this.lastIdleCheckAt = now;
      this.closeIdleFish(now);
    }

    if (this.changedIds.size === 0) return;

    const changed = [];
    for (const id of this.changedIds) {
      const player = this.players.get(id);
      if (player) {
        changed.push({
          id,
          x: player.x,
          y: player.y,
          facing: player.facing,
          moving: player.moving,
        });
      }
    }
    this.changedIds.clear();

    if (changed.length > 0) {
      this.broadcastJson({ type: MSG.STATE, players: changed });
    }
  }

  // Closes fish that did not move or chat for too long (guests sooner).
  // Their place is kept under their handoff token for HANDOFF_MS, so
  // "Rejoin" soon after brings them back to the same spot.
  closeIdleFish(now) {
    for (const player of [...this.players.values()]) {
      const limit = player.kind === KIND_GUEST ? GUEST_IDLE_MS : PLAYER_IDLE_MS;
      if (now - player.lastActiveAt > limit) {
        // onClose removes the fish (and keeps its handoff).
        this.getConnection(player.connectionId)?.close(CLOSE_IDLE, 'Away for a while');
      }
    }
  }

  // ---------- Helpers ----------

  getPlayerFor(connection) {
    return this.players.get(this.playerIdByConnection.get(connection.id));
  }

  sendTo(connection, data) {
    connection.send(JSON.stringify(data));
  }

  // Sends to everyone, except the connection ids in `exclude`.
  broadcastJson(data, exclude = []) {
    this.broadcast(JSON.stringify(data), exclude);
  }

  rememberPosition(player) {
    this.forgetOldPositions();
    // Delete first, so the newest entry moves to the end of the Map.
    this.lastPositions.delete(player.id);
    this.lastPositions.set(player.id, { x: player.x, y: player.y, facing: player.facing, leftAt: Date.now() });
    if (this.lastPositions.size > MAX_REMEMBERED_POSITIONS) {
      // A Map keeps insertion order, so the first key is the oldest.
      const oldestId = this.lastPositions.keys().next().value;
      this.lastPositions.delete(oldestId);
    }
  }

  // Throws away saved spots older than QUICK_RECONNECT_MS, so a late return
  // starts in the spawn area, and the list cannot grow forever.
  // The Map is oldest first, so we can stop at the first one that is new enough.
  forgetOldPositions() {
    const tooOld = Date.now() - QUICK_RECONNECT_MS;
    for (const [id, saved] of this.lastPositions) {
      if (saved.leftAt > tooOld) break;
      this.lastPositions.delete(id);
    }
  }
}

// The fields other players are allowed to see. No connection ids, no limits,
// no handoff tokens.
function toPublicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    facing: player.facing,
    moving: player.moving,
    guest: player.kind === KIND_GUEST,
  };
}

// Turns the encoded name from the header back into normal text.
function decodeName(encoded) {
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// Positions are sent as numbers with one decimal place, to keep messages short.
function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}
