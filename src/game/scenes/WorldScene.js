// The main game scene: the map, the players and the camera.
// For now the map is a simple placeholder grid. Real Tiled maps come later.
// It also connects to the real-time server, sends our position, and shows
// the other players.

import Phaser from 'phaser';
import { Player } from '../Player.js';
import { RemotePlayers } from '../RemotePlayers.js';
import { Controls } from '../input/Controls.js';
import { WorldConnection, STATUS } from '../../net/WorldConnection.js';
import { showNetStatus, hideNetStatus } from '../../ui/netStatus.js';
import { WORLD_WIDTH, WORLD_HEIGHT, SPAWN_POINT } from '../../../shared/world.js';
import { MSG, CLIENT_SEND_INTERVAL_MS } from '../../../shared/protocol.js';

// Size of one placeholder ground tile.
const TILE_SIZE = 32;

// We want the shorter side of the screen to show about this many game pixels
// (so phones and PCs see about the same amount of the world).
const TARGET_VIEW_SIZE = 340;

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  create() {
    this.createGround();

    // The world edges stop the player from walking off the map.
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // The user was saved in the registry when the game was created.
    const user = this.registry.get('user');

    // Everyone starts at the same spot. The server's `welcome` message may
    // move us (for example back to where we were before a reconnect).
    // TODO: start at the user's `lastPosition` from MongoDB instead.
    this.player = new Player(this, SPAWN_POINT.x, SPAWN_POINT.y, user.username);
    this.player.sprite.setCollideWorldBounds(true);

    this.controls = new Controls(this);
    this.remotePlayers = new RemotePlayers(this);

    // The camera follows the player but never shows outside the world.
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    camera.startFollow(this.player.sprite, true);

    // Set the zoom now, and again every time the window size changes
    // (resizing a browser window or rotating a phone).
    this.updateZoom(this.scale.gameSize);
    this.scale.on('resize', this.updateZoom, this);

    this.startNetwork();

    // When the scene stops or the game is destroyed (logout), clean up.
    // The scale manager lives longer than this scene, so remove our listener,
    // or it would call a dead scene. And close the connection, or we would
    // stay "online" after logging out.
    const cleanUp = () => {
      this.scale.off('resize', this.updateZoom, this);
      this.connection.close();
      hideNetStatus();
    };
    this.events.once('shutdown', cleanUp);
    this.events.once('destroy', cleanUp);
  }

  // Phaser calls update() every frame. `time` is in milliseconds.
  update(time) {
    this.player.move(this.controls.getDirection());
    this.sendMoveIfNeeded(time);
    this.remotePlayers.update();
  }

  // ---------- Network ----------

  startNetwork() {
    // Our player id from the server (the user id). Set by `welcome`.
    this.myId = null;
    this.netStatus = null;
    // The last `move` we sent, and when, so we only send changes.
    this.lastSentMove = null;
    this.lastSentAt = 0;

    this.connection = new WorldConnection({
      onMessage: (data) => this.handleServerMessage(data),
      onStatus: (status) => this.handleNetStatus(status),
      // main.js gave us this function. It shows the login form again.
      onLoginRejected: () => this.registry.get('onLoginRejected')(),
    });
    this.connection.connect();
  }

  // Sends our position at most every CLIENT_SEND_INTERVAL_MS,
  // and only if something changed. Standing still sends nothing.
  sendMoveIfNeeded(time) {
    if (time - this.lastSentAt < CLIENT_SEND_INTERVAL_MS) return;

    const move = {
      x: roundToTenth(this.player.sprite.x),
      y: roundToTenth(this.player.sprite.y),
      facing: this.player.facing,
      moving: this.player.moving,
    };
    const last = this.lastSentMove;
    if (
      last &&
      last.x === move.x &&
      last.y === move.y &&
      last.facing === move.facing &&
      last.moving === move.moving
    ) {
      return;
    }

    this.connection.sendMove(move);
    this.lastSentMove = move;
    this.lastSentAt = time;
  }

  // Handles one message from the server.
  // Data from the network can be broken, so check the shape before using it.
  handleServerMessage(data) {
    switch (data.type) {
      case MSG.WELCOME: {
        if (!Array.isArray(data.players)) return;
        this.myId = data.you;
        // Start fresh: the list in `welcome` is complete.
        this.remotePlayers.clear();
        for (const player of data.players) {
          if (player.id === this.myId) {
            // The server decides where we are (for example after a reconnect).
            this.player.setPosition(player.x, player.y);
          } else {
            this.remotePlayers.add(player);
          }
        }
        break;
      }
      case MSG.JOIN:
        if (data.player && data.player.id !== this.myId) {
          this.remotePlayers.add(data.player);
        }
        break;
      case MSG.LEAVE:
        this.remotePlayers.remove(data.id);
        break;
      case MSG.STATE:
        if (Array.isArray(data.players)) {
          // Our own position is in there too. We already know it, so skip it.
          this.remotePlayers.applyState(data.players.filter((p) => p.id !== this.myId));
        }
        break;
      default:
        // Unknown type, maybe from a newer server. Ignore it.
        return;
    }
    // The number of players may have changed.
    this.showStatus();
  }

  handleNetStatus(status) {
    this.netStatus = status;
    // When we are not online, the other players' positions are old and
    // would just stand frozen. Remove them. `welcome` adds them back.
    if (status !== STATUS.ONLINE) {
      this.remotePlayers.clear();
    }
    this.showStatus();
  }

  // Updates the status box in the top-left corner.
  showStatus() {
    const retry = () => this.connection.retry();
    switch (this.netStatus) {
      case STATUS.CONNECTING:
        showNetStatus('Connecting…');
        break;
      case STATUS.ONLINE: {
        const count = this.remotePlayers.count + 1; // + 1 for us
        showNetStatus(`Online (${count} ${count === 1 ? 'player' : 'players'})`);
        break;
      }
      case STATUS.RECONNECTING:
        showNetStatus('Reconnecting…');
        break;
      case STATUS.OFFLINE:
        showNetStatus('Cannot reach the game server.', 'Retry', retry);
        break;
      case STATUS.REPLACED:
        // Reconnecting here closes the game in the other tab or device.
        showNetStatus('You are playing in another tab or device.', 'Play here', retry);
        break;
      case STATUS.GAME_REJECTED:
        showNetStatus('Game server rejected your login. Please log out and log in again.');
        break;
      case STATUS.NOT_CONFIGURED:
        showNetStatus('Offline mode (no game server set).');
        break;
      default:
        hideNetStatus();
    }
  }

  // ---------- Map and camera ----------

  // Draws the placeholder ground: one grass tile with a darker edge,
  // repeated over the whole world, so it looks like a grid.
  createGround() {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x4a7c3a);
    graphics.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    graphics.fillStyle(0x427035);
    graphics.fillRect(0, 0, TILE_SIZE, 1);
    graphics.fillRect(0, 0, 1, TILE_SIZE);
    graphics.generateTexture('ground-tile', TILE_SIZE, TILE_SIZE);
    graphics.destroy();

    // A TileSprite repeats one texture over a big area. It is cheap to draw.
    this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'ground-tile').setOrigin(0, 0);
  }

  // Picks a whole-number zoom (1, 2, 3...) so the shorter side of the screen
  // shows about TARGET_VIEW_SIZE game pixels.
  // A whole number keeps every game pixel the same size, so pixel art stays sharp.
  // Example: a 1080 px tall PC screen gets zoom 3 (shows 360 px).
  // A phone 390 px wide gets zoom 1 (shows 390 px).
  updateZoom(gameSize) {
    const { width, height } = gameSize;
    const shorterSide = Math.min(width, height);
    const zoom = Math.max(1, Math.round(shorterSide / TARGET_VIEW_SIZE));

    // In RESIZE mode the canvas size changes, so the camera must match it.
    this.cameras.main.setSize(width, height);
    this.cameras.main.setZoom(zoom);
    this.player.setLabelResolution(zoom);
    this.remotePlayers.setLabelResolution(zoom);
  }
}

// Positions are sent with one decimal place, to keep messages short.
function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}
