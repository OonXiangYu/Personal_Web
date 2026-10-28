// All the OTHER players in the room, moved only by data from the server.
//
// Smooth movement (interpolation):
// The server sends positions about 10 times per second. If we put a player
// right at each new position, they would jump every 100 ms. Instead, we keep
// a short list of recent positions ("snapshots") with the time we got them,
// and draw each player a little in the past (INTERPOLATION_DELAY_MS), sliding
// smoothly between the two snapshots around that moment.
// The delay is a bit longer than one server tick, so there is usually a newer
// snapshot to slide toward, even when the network is a bit uneven.

import { Player } from './Player.js';
import { SERVER_TICK_MS } from '../../shared/protocol.js';

// How far in the past we draw remote players.
const INTERPOLATION_DELAY_MS = 150;

// Keep at most this many snapshots per player (about 2 seconds).
const MAX_SNAPSHOTS = 20;

export class RemotePlayers {
  // overlay: the PlayerOverlay that draws names and chat bubbles.
  constructor(scene, overlay) {
    this.scene = scene;
    this.overlay = overlay;
    // Player id → { player: Player, name, snapshots: [{ time, x, y, facing, moving }] }
    this.entries = new Map();
  }

  // How many remote players there are.
  get count() {
    return this.entries.size;
  }

  // The sprite of a remote player (for the name label position), or null.
  getSprite(id) {
    return this.entries.get(id)?.player.sprite || null;
  }

  // The username of a remote player, or null.
  // Used for "Oscar left": the `leave` message only has the id.
  getName(id) {
    return this.entries.get(id)?.name || null;
  }

  // Adds a player from a `welcome` or `join` message.
  add(data) {
    if (this.entries.has(data.id)) {
      this.remove(data.id);
    }
    const player = new Player(this.scene, data.x, data.y, { physics: false });
    player.showState(data.facing, data.moving);
    this.overlay.addPlayer(data.id, data.name);

    this.entries.set(data.id, {
      player,
      name: data.name,
      snapshots: [{ time: performance.now(), x: data.x, y: data.y, facing: data.facing, moving: data.moving }],
    });
  }

  // Removes a player (from a `leave` message).
  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.player.destroy();
    this.overlay.removePlayer(id);
    this.entries.delete(id);
  }

  // Removes everyone (for example when we lose the connection).
  clear() {
    for (const id of [...this.entries.keys()]) {
      this.remove(id);
    }
  }

  // Stores the new positions from a `state` message.
  applyState(players) {
    const now = performance.now();
    for (const data of players) {
      const entry = this.entries.get(data.id);
      if (!entry) continue; // our own player, or someone we do not know yet

      const snapshots = entry.snapshots;
      const last = snapshots[snapshots.length - 1];

      // If this player stood still for a while, their last snapshot is old.
      // Sliding from that old time to now would make them jump almost all
      // the way at once. So we copy the old position to "one tick ago",
      // and they slide over one normal tick instead.
      if (now - last.time > SERVER_TICK_MS * 2) {
        snapshots.push({ ...last, time: now - SERVER_TICK_MS });
      }

      snapshots.push({ time: now, x: data.x, y: data.y, facing: data.facing, moving: data.moving });
      if (snapshots.length > MAX_SNAPSHOTS) {
        snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
      }
    }
  }

  // Moves every remote player to where they were INTERPOLATION_DELAY_MS ago.
  // Call this every frame.
  update() {
    const renderTime = performance.now() - INTERPOLATION_DELAY_MS;
    for (const entry of this.entries.values()) {
      this.updateOne(entry, renderTime);
    }
  }

  updateOne(entry, renderTime) {
    const snapshots = entry.snapshots;

    // Throw away snapshots we no longer need: keep the last one
    // that is older than renderTime, as the "from" point.
    while (snapshots.length >= 2 && snapshots[1].time <= renderTime) {
      snapshots.shift();
    }

    const from = snapshots[0];
    const to = snapshots[1];

    if (!to || renderTime <= from.time) {
      // Nothing newer to slide toward: stand at the latest known spot.
      entry.player.setPosition(from.x, from.y);
      entry.player.showState(from.facing, from.moving);
      return;
    }

    // How far between `from` and `to` we are, from 0 to 1.
    const t = (renderTime - from.time) / (to.time - from.time);
    entry.player.setPosition(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    // Use the animation of the moving part: while sliding toward `to`, the
    // player is moving in `to`'s direction. When they stop, `to` says
    // "not moving", but they should still run until they arrive. So we
    // show running if either snapshot is moving.
    entry.player.showState(to.facing, from.moving || to.moving);
  }
}
