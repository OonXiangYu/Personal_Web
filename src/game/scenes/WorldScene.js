// The main game scene: the map, the players and the camera.
// For now the map is a simple placeholder grid. Real Tiled maps come later.
// It also connects to the real-time server, sends our position, shows
// the other players, and connects the chat (input, log, bubbles).

import Phaser from 'phaser';
import { Player } from '../Player.js';
import { RemotePlayers } from '../RemotePlayers.js';
import { Controls } from '../input/Controls.js';
import { WorldConnection, STATUS } from '../../net/WorldConnection.js';
import { showNetStatus, hideNetStatus } from '../../ui/netStatus.js';
import { PlayerOverlay } from '../../ui/PlayerOverlay.js';
import { ChatInput } from '../../ui/ChatInput.js';
import { ChatLog } from '../../ui/ChatLog.js';
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
    this.player = new Player(this, SPAWN_POINT.x, SPAWN_POINT.y);
    this.player.sprite.setCollideWorldBounds(true);

    // Our player id. It is the user id, the same id the server uses for us.
    this.myId = user.id;

    // Names and chat bubbles, drawn as HTML on top of the game (see PlayerOverlay.js).
    this.overlay = new PlayerOverlay(document.getElementById('player-overlay'));
    this.overlay.addPlayer(this.myId, user.username, { isLocal: true });

    this.controls = new Controls(this);
    this.remotePlayers = new RemotePlayers(this, this.overlay);

    this.chatLog = new ChatLog();
    this.chatInput = new ChatInput({
      onSend: (text) => this.sendChat(text),
      // While the chat box is open, the movement keys type letters instead.
      onOpenChange: (open) => this.controls.setEnabled(!open),
    });

    // The camera follows the player but never shows outside the world.
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    camera.startFollow(this.player.sprite, true);

    // Set the zoom now, and again every time the window size changes
    // (resizing a browser window or rotating a phone).
    this.updateZoom(this.scale.gameSize);
    this.scale.on('resize', this.updateZoom, this);

    // Move the names and bubbles after every drawn frame. "postrender" runs
    // after Phaser has drawn, when the camera position for this frame is
    // final, so the HTML lines up exactly with the sprites.
    this.game.events.on('postrender', this.updateOverlay, this);

    this.startNetwork();

    // When the scene stops or the game is destroyed (logout), clean up.
    // The scale manager and the game live longer than this scene, so remove
    // our listeners, or they would call a dead scene. Close the connection,
    // or we would stay "online" after logging out. And remove the HTML we
    // added (names, bubbles, chat), or it would stay on top of the login form.
    let cleanedUp = false;
    const cleanUp = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.scale.off('resize', this.updateZoom, this);
      this.game.events.off('postrender', this.updateOverlay, this);
      this.connection.close();
      hideNetStatus();
      this.chatInput.destroy();
      this.chatLog.destroy();
      this.overlay.clear();
    };
    this.events.once('shutdown', cleanUp);
    this.events.once('destroy', cleanUp);
  }

  // Moves the HTML names and bubbles to the players' current positions.
  updateOverlay() {
    this.overlay.update(this.cameras.main, (id) =>
      id === this.myId ? this.player.sprite : this.remotePlayers.getSprite(id),
    );
  }

  // Phaser calls update() every frame. `time` is in milliseconds.
  update(time) {
    this.player.move(this.controls.getDirection());
    this.sendMoveIfNeeded(time);
    this.remotePlayers.update();
  }

  // ---------- Network ----------

  startNetwork() {
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

  // Sends a chat message typed by the player.
  // We do not show our own bubble yet: the server sends the message back to
  // everyone, including us. That way we see exactly what others see (later,
  // moderation may mask or block a message).
  sendChat(text) {
    if (!this.connection.sendChat(text)) {
      this.chatInput.showNotice('Not connected');
    }
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
        // data.you is our user id, the same as this.myId.
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
          this.chatLog.addSystem(`${data.player.name} joined`);
        }
        break;
      case MSG.LEAVE: {
        // Read the name before removing the player: `leave` only has the id.
        const name = this.remotePlayers.getName(data.id);
        this.remotePlayers.remove(data.id);
        if (name) {
          this.chatLog.addSystem(`${name} left`);
        }
        break;
      }
      case MSG.CHAT:
        if (typeof data.text !== 'string' || typeof data.name !== 'string') return;
        // Works for our own messages too (our id is in the overlay as well).
        this.overlay.showBubble(data.id, data.text);
        this.chatLog.addChat(data.name, data.text);
        return;
      case MSG.NOTICE:
        if (typeof data.text === 'string') {
          this.chatInput.showNotice(data.text);
        }
        return;
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
    // The HTML names and bubbles do not need anything here: PlayerOverlay
    // reads the zoom every frame.
  }
}

// Positions are sent with one decimal place, to keep messages short.
function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}
