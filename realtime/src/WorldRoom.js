// One game room: a Durable Object that holds everyone in one map.
// All players in the room connect to the SAME object, so it can see everyone
// and send them each other's positions.
//
// It does six jobs:
//   1. Keep a list of players (who is here and where they are).
//   2. Check every `move` message (not too fast, not off the map).
//   3. Send everyone one `state` message 10 times per second (the "tick").
//   4. Allow only one connection per account.
//   5. Check chat messages and send them to the players.
//   6. Let logged-out visitors watch ("spectators"), read-only and limited.

import { Server } from 'partyserver';
import {
  MSG,
  SERVER_TICK_MS,
  MAX_MESSAGE_BYTES,
  MAX_CHAT_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  CHAT_MAX_CHARS,
  CLOSE_REPLACED,
  CLOSE_SPECTATORS_FULL,
  CLOSE_SPECTATOR_TIME_UP,
  MAX_SPECTATORS,
  SPECTATOR_MAX_MS,
} from '../../shared/protocol.js';
import { MOVE_SPEED, FACINGS } from '../../shared/world.js';
import { clampToMap, slideMove, findFreeSpot } from '../../shared/mapInfo.js';
import { worldMap } from './worldMap.js';
import { cleanChatText, countCharacters, ChatLimiter } from './chat.js';
import { moderateMessage } from './moderation.js';

// When checking walls, the server makes the player's feet 1 px smaller than
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
// "1" for a spectator (a logged-out visitor watching, no token).
export const SPECTATOR_HEADER = 'X-Spectator';

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

// We remember where players were when they left, so a quick reconnect puts
// them back in the same spot. This is only in memory: it is lost when the
// room shuts down. Keep at most this many, so memory cannot grow forever.
// TODO: save positions to MongoDB (`lastPosition`) instead.
const MAX_REMEMBERED_POSITIONS = 1000;

export class WorldRoom extends Server {
  // No hibernation. While anyone is online, our 10-per-second tick keeps the
  // object awake anyway, so hibernation would not save anything. When no
  // PLAYERS are left we stop the tick, and when nobody at all is connected,
  // Cloudflare can shut the object down.
  // Note: an open spectator connection also keeps the object running (and
  // counting free-plan run time), even with the tick stopped. That is why
  // spectators are capped (MAX_SPECTATORS) and closed after SPECTATOR_MAX_MS.
  // Run time is counted per object, not per connection, so one room can use
  // at most 24 h × 128 MB = 10,800 GB-s a day, under the free 13,000.
  static options = { hibernate: false };

  // Player id → player object (see onConnect for the fields).
  players = new Map();

  // Connection id → player id. Lets us find the player for a message.
  playerIdByConnection = new Map();

  // Player id → { x, y }, where they were when they left.
  lastPositions = new Map();

  // Ids of players that moved since the last tick.
  changedIds = new Set();

  // The setInterval handle of the tick, or null when the tick is stopped.
  tickTimer = null;

  // Spectators: connection id → the timer that closes them after SPECTATOR_MAX_MS.
  // Spectators are NOT in `players`: they are not counted, not shown, and
  // they never start the tick.
  spectators = new Map();

  // Called when a WebSocket connection is open.
  // index.js has already checked the origin and the room name, and either
  // the token (players) or the spectator flag (spectators).
  onConnect(connection, ctx) {
    if (ctx.request.headers.get(SPECTATOR_HEADER) === '1') {
      this.addSpectator(connection);
      return;
    }

    const id = ctx.request.headers.get(PLAYER_ID_HEADER);
    const name = decodeName(ctx.request.headers.get(PLAYER_NAME_HEADER));
    if (!id || !name) {
      // Should never happen, because index.js always sets these headers.
      connection.close(1008, 'Not logged in');
      return;
    }

    // One character per account. If this user is already connected
    // (another tab or device), close the OLD connection.
    const oldPlayer = this.players.get(id);
    if (oldPlayer) {
      const oldConnection = this.getConnection(oldPlayer.connectionId);
      oldConnection?.close(CLOSE_REPLACED, 'Logged in somewhere else');
    }

    // Start where they were: in this room right now, or when they last left.
    // Otherwise at the map's spawn point.
    const remembered = oldPlayer || this.lastPositions.get(id);
    // A remembered spot may now be inside a wall (if the map changed), so
    // move it to the nearest free spot. The spawn point is always free already.
    const start = remembered ? findFreeSpot(worldMap, remembered.x, remembered.y) : worldMap.spawn;

    const player = {
      id,
      name,
      connectionId: connection.id,
      x: start.x,
      y: start.y,
      facing: oldPlayer?.facing || 'down',
      moving: false,
      // For the movement check.
      allowance: MAX_ALLOWANCE,
      lastMoveAt: Date.now(),
      // For the message rate limit.
      messageWindowStart: 0,
      messageCount: 0,
      // For the chat limits (speed, duplicates).
      chat: new ChatLimiter(),
    };
    this.players.set(id, player);
    this.playerIdByConnection.set(connection.id, id);

    // Tell the new player who they are and who is already here.
    this.sendTo(connection, {
      type: MSG.WELCOME,
      you: id,
      players: [...this.players.values()].map(toPublicPlayer),
      // Lets the browser check that it has the same map as the server.
      map: worldMap.fingerprint,
    });

    if (oldPlayer) {
      // Others already know this player. Just send the (maybe new) position.
      this.changedIds.add(id);
    } else {
      this.broadcastJson({ type: MSG.JOIN, player: toPublicPlayer(player) }, [connection.id]);
    }

    this.startTick();
  }

  // A logged-out visitor wants to watch. They get the same position updates
  // as players (welcome, join, leave, state), but never chat, and they
  // cannot send anything (see onMessage).
  addSpectator(connection) {
    if (this.spectators.size >= MAX_SPECTATORS) {
      // Room full of watchers. The close code tells the page not to retry.
      connection.close(CLOSE_SPECTATORS_FULL, 'Too many spectators');
      return;
    }

    // Close it after SPECTATOR_MAX_MS, so a login page left open for hours
    // does not keep the room running. (onClose removes it from the map.)
    const timer = setTimeout(() => {
      connection.close(CLOSE_SPECTATOR_TIME_UP, 'Spectator time is up');
    }, SPECTATOR_MAX_MS);
    this.spectators.set(connection.id, timer);

    this.sendTo(connection, {
      type: MSG.WELCOME,
      you: null, // not a player
      players: [...this.players.values()].map(toPublicPlayer),
      map: worldMap.fingerprint,
    });
    // No startTick() here: only players start it. With no players there is
    // nothing to send anyway (nobody moves).
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

  // Checks a `chat` message and sends it to everyone.
  // The order of the checks matters:
  //   clean → empty? → too long? → duplicate? → too fast? → moderation → send
  // Cheap checks come first. Moderation (later an ML model) comes last,
  // so spam never reaches it.
  // Never log the text: chat is private to the players in the room.
  async handleChat(connection, player, data, now) {
    const text = cleanChatText(data.text);
    if (!text) return;

    // Reject, do not cut. Cutting could change the meaning of a message.
    // The browser stops at CHAT_MAX_CHARS, so only a modified client gets here.
    if (countCharacters(text) > CHAT_MAX_CHARS) {
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

    // ALL chat goes through moderateMessage(). See moderation.js for the plan.
    const result = await moderateMessage(text, { id: player.id, name: player.name });

    // Moderation may take time. If the player left or was replaced by another
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
    // The name comes from the login token (set in onConnect), never from the client.
    // Spectators (logged-out visitors) are left out: chat is for players only.
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

  // Checks a `move` message and updates the player's position.
  // NOTE: this movement data will later be used to train an ML model that
  // spots cheaters. Keep the `move` format simple and consistent.
  handleMove(player, data, now) {
    const { x, y, facing, moving } = data;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!FACINGS.includes(facing) || typeof moving !== 'boolean') return;

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

  // Called when a connection closes (tab closed, network lost, or replaced).
  onClose(connection) {
    // A spectator left (or was closed): just forget them. They never
    // touched the player list or the tick.
    if (this.spectators.has(connection.id)) {
      clearTimeout(this.spectators.get(connection.id));
      this.spectators.delete(connection.id);
      return;
    }

    const id = this.playerIdByConnection.get(connection.id);
    this.playerIdByConnection.delete(connection.id);
    const player = this.players.get(id);

    // Only remove the player if THIS connection still owns them.
    // When a user was replaced by a new tab, the old connection closes
    // later, and must not remove the player that the new tab now controls.
    if (player && player.connectionId === connection.id) {
      this.rememberPosition(player);
      this.players.delete(id);
      this.changedIds.delete(id);
      this.broadcastJson({ type: MSG.LEAVE, id });
    }

    if (this.players.size === 0) {
      this.stopTick();
    }
  }

  onError(connection, error) {
    // Only the message. Never the URL (it could hold a token in other setups).
    console.error(`[room ${this.name}] connection error: ${error?.message}`);
  }

  // ---------- Tick ----------

  // Starts the tick if it is not running yet.
  startTick() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), SERVER_TICK_MS);
  }

  // Stops the tick. A running timer keeps the Durable Object awake and costs
  // free-plan time, so we stop it as soon as the room is empty.
  stopTick() {
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  // Sends one `state` message with every player that changed.
  // One message per tick (not one per `move`) keeps traffic low and steady.
  tick() {
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
    // Delete first, so the newest entry moves to the end of the Map.
    this.lastPositions.delete(player.id);
    this.lastPositions.set(player.id, { x: player.x, y: player.y });
    if (this.lastPositions.size > MAX_REMEMBERED_POSITIONS) {
      // A Map keeps insertion order, so the first key is the oldest.
      const oldestId = this.lastPositions.keys().next().value;
      this.lastPositions.delete(oldestId);
    }
  }
}

// The fields other players are allowed to see. No connection ids, no limits.
function toPublicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    facing: player.facing,
    moving: player.moving,
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
