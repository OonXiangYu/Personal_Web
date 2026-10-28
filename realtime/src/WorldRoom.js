// One game room: a Durable Object that holds everyone in one map.
// All players in the room connect to the SAME object, so it can see everyone
// and send them each other's positions.
//
// It does four jobs:
//   1. Keep a list of players (who is here and where they are).
//   2. Check every `move` message (not too fast, not off the map).
//   3. Send everyone one `state` message 10 times per second (the "tick").
//   4. Allow only one connection per account.

import { Server } from 'partyserver';
import {
  MSG,
  SERVER_TICK_MS,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  CLOSE_REPLACED,
} from '../../shared/protocol.js';
import { WORLD_WIDTH, WORLD_HEIGHT, MOVE_SPEED, SPAWN_POINT, FACINGS } from '../../shared/world.js';

// Headers set by index.js after checking the token. Only index.js sets them.
export const PLAYER_ID_HEADER = 'X-Player-Id';
export const PLAYER_NAME_HEADER = 'X-Player-Name';

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
  // object awake anyway, so hibernation would not save anything. When the
  // room is empty we stop the tick, and Cloudflare can shut the object down.
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

  // Called when a WebSocket connection is open.
  // index.js has already checked the token, the origin and the room name.
  onConnect(connection, ctx) {
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
    const start = oldPlayer || this.lastPositions.get(id) || SPAWN_POINT;

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
    };
    this.players.set(id, player);
    this.playerIdByConnection.set(connection.id, id);

    // Tell the new player who they are and who is already here.
    this.sendTo(connection, {
      type: MSG.WELCOME,
      you: id,
      players: [...this.players.values()].map(toPublicPlayer),
    });

    if (oldPlayer) {
      // Others already know this player. Just send the (maybe new) position.
      this.changedIds.add(id);
    } else {
      this.broadcastJson({ type: MSG.JOIN, player: toPublicPlayer(player) }, [connection.id]);
    }

    this.startTick();
  }

  // Called for every message from a connection.
  // Anything strange is ignored, never allowed to crash the room.
  onMessage(connection, message) {
    const player = this.getPlayerFor(connection);
    if (!player) return;

    // We only use text messages. For plain-English JSON, 1 character is 1 byte.
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return;

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

    if (data?.type === MSG.MOVE) {
      this.handleMove(player, data, now);
    }
    // Unknown types are ignored. (Chat comes in Step 3.)
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

    // Keep them inside the map.
    newX = clamp(newX, 0, WORLD_WIDTH);
    newY = clamp(newY, 0, WORLD_HEIGHT);

    player.allowance -= Math.hypot(newX - player.x, newY - player.y);
    player.x = roundToTenth(newX);
    player.y = roundToTenth(newY);
    player.facing = facing;
    player.moving = moving;

    // Do not send it now. The next tick sends all changes in one message.
    this.changedIds.add(player.id);
  }

  // Called when a connection closes (tab closed, network lost, or replaced).
  onClose(connection) {
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Positions are sent as numbers with one decimal place, to keep messages short.
function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}
