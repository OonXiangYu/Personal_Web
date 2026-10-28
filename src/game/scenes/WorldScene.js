// The main game scene: the map, the players and the camera.
// The map comes from Tiled (public/assets/maps/world.tmj, see WorldMap.js).
//
// It runs in one of two modes, chosen by the "user" in the registry:
//   - spectator (no user): behind the login form. The map, other players
//     walking (read-only connection), and a slowly drifting camera.
//     No own player, no controls, no chat, no status box.
//   - player (logged in): your own player, controls, the real-time
//     connection, chat (input, log, bubbles) and the status box.
// Logging in or out restarts this scene in the other mode (see createGame.js).

import Phaser from 'phaser';
import { Player } from '../Player.js';
import { RemotePlayers } from '../RemotePlayers.js';
import { Controls } from '../input/Controls.js';
import { WorldConnection, STATUS } from '../../net/WorldConnection.js';
import { showNetStatus, hideNetStatus } from '../../ui/netStatus.js';
import { PlayerOverlay } from '../../ui/PlayerOverlay.js';
import { ChatInput } from '../../ui/ChatInput.js';
import { ChatLog } from '../../ui/ChatLog.js';
import { createWorldMap } from '../WorldMap.js';
import { SpectatorCamera } from '../SpectatorCamera.js';
import { centerLimits } from '../../../shared/mapInfo.js';
import { PLAYER_HITBOX } from '../../../shared/world.js';
import { createOcean, SKY_VIEW_HEIGHT } from '../Ocean.js';
import { DeepLight } from '../DeepLight.js';
import { MSG, CLIENT_SEND_INTERVAL_MS } from '../../../shared/protocol.js';

// The message shown when the server has a different map than this page.
const MAP_OUTDATED_MESSAGE = 'The game was updated. Please refresh the page.';

// We want the shorter side of the screen to show about this many game pixels
// (so phones and PCs see about the same amount of the world).
const TARGET_VIEW_SIZE = 340;

// After login, the camera glides from where the spectator camera was to the
// player. A small "lerp" (0..1) = a soft, slow catch-up; 1 = locked on.
const LOGIN_GLIDE_LERP = 0.08;
const LOGIN_GLIDE_MS = 1200;

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  create() {
    // Phaser REUSES this scene object when it restarts the scene (on login
    // and logout). Forget the things from the last run, so spectator mode
    // never sees the old player (for example DeepLight puts the light on
    // `this.player` when there is one).
    this.player = null;
    this.controls = null;
    this.chatLog = null;
    this.chatInput = null;
    this.spectatorCamera = null;

    // Draw the Tiled map. `mapInfo` has the size, walls and spawn point.
    const { info, collisionLayer } = createWorldMap(this);
    this.mapInfo = info;

    // The ocean behind everything: sky, water gradient, bubbles (see Ocean.js).
    createOcean(this, info);

    // Darkness in the deep, your light, and the glows of other fish.
    // Made before any fish, because each fish uses it while drawing.
    this.deepLight = new DeepLight(this, info);

    // The area the camera may show: the whole world, plus a strip of sky
    // above the water surface. The camera stops at these edges, so no black
    // is ever shown. (Fish are blocked at the world edges, so near an edge
    // the camera stops and the fish keeps swimming toward the screen edge.)
    this.cameraArea = {
      x: 0,
      y: -SKY_VIEW_HEIGHT,
      width: info.width,
      height: info.height + SKY_VIEW_HEIGHT,
    };
    this.cameras.main.setBounds(
      this.cameraArea.x,
      this.cameraArea.y,
      this.cameraArea.width,
      this.cameraArea.height,
    );

    // Logged in? (null = a logged-out visitor behind the login form.)
    const user = this.registry.get('user');
    this.isSpectator = !user;

    // Where the camera was before this mode started (set by createGame.js
    // when switching modes), so we can glide instead of jumping.
    const cameraFrom = this.registry.get('cameraFrom');
    this.registry.set('cameraFrom', null);

    // True when the server has a different map than this page (see `welcome`).
    this.mapOutdated = false;

    // Names and chat bubbles, drawn as HTML on top of the game (see PlayerOverlay.js).
    this.overlay = new PlayerOverlay(document.getElementById('player-overlay'));
    this.remotePlayers = new RemotePlayers(this, this.overlay);

    // Set the zoom now, and again every time the window size changes
    // (resizing a browser window or rotating a phone).
    // (Done before the camera code below, which needs the zoom.)
    this.updateZoom(this.scale.gameSize);
    this.scale.on('resize', this.updateZoom, this);

    if (this.isSpectator) {
      this.myId = null;
      // The spectator camera drifts inside the same area as the player camera.
      this.spectatorCamera = new SpectatorCamera(this, this.cameraArea, this.remotePlayers, cameraFrom);
    } else {
      this.createPlayer(user, collisionLayer, cameraFrom);
    }

    // Move the names and bubbles after every drawn frame. "postrender" runs
    // after Phaser has drawn, when the camera position for this frame is
    // final, so the HTML lines up exactly with the sprites.
    this.game.events.on('postrender', this.updateOverlay, this);

    this.startNetwork();

    // When the scene stops (switching mode on login/logout) or the game is
    // destroyed, clean up. The scale manager and the game live longer than
    // this scene, so remove our listeners, or they would call a dead scene.
    // Close the connection, or we would stay connected in the old mode.
    // And remove the HTML we added (names, bubbles, chat), or it would stay
    // on top of the login form.
    let cleanedUp = false;
    const cleanUp = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      // Only one of the two events fires. Remove the other listener too, or
      // a new one would pile up on every login/logout (the scene is reused).
      this.events.off('shutdown', cleanUp);
      this.events.off('destroy', cleanUp);
      this.scale.off('resize', this.updateZoom, this);
      this.game.events.off('postrender', this.updateOverlay, this);
      this.connection.close();
      hideNetStatus();
      this.chatInput?.destroy();
      this.chatLog?.destroy();
      // Remove every fish (our own and the others), so none of them keeps
      // drawing after the scene has stopped.
      this.player?.destroy();
      this.remotePlayers.clear();
      this.overlay.clear();
    };
    this.events.once('shutdown', cleanUp);
    this.events.once('destroy', cleanUp);
  }

  // Player mode only: our own player, walls, controls, chat, camera.
  createPlayer(user, collisionLayer, cameraFrom) {
    const info = this.mapInfo;

    // Keep the WHOLE fish inside the map.
    this.setPhysicsBounds();

    // The SERVER decides where we start (a random spot in the spawn area, or
    // our last spot after a quick reconnect) and tells us in `welcome`,
    // a moment after connecting. Until then, show the fish in the middle of
    // the spawn area.
    // TODO: start at the user's `lastPosition` from MongoDB instead.
    // (The fish stops at the physics world edges by itself, see Player.js.)
    this.player = new Player(this, info.spawnCenter.x, info.spawnCenter.y);

    // Walls: the fish's hit box cannot enter tiles of the "collision" layer.
    // Arcade physics makes the fish slide along a wall instead of sticking.
    if (collisionLayer) {
      this.physics.add.collider(this.player.sprite, collisionLayer);
    }

    // Our player id. It is the user id, the same id the server uses for us.
    this.myId = user.id;
    this.overlay.addPlayer(this.myId, user.username, { isLocal: true });

    this.controls = new Controls(this);

    this.chatLog = new ChatLog();
    this.chatInput = new ChatInput({
      onSend: (text) => this.sendChat(text),
      // While the chat box is open, the movement keys type letters instead.
      onOpenChange: (open) => this.controls.setEnabled(!open),
    });

    // The camera follows the player, but stops at the edges of the camera
    // area (set in create). Near a world edge the camera stays still and
    // the fish swims on toward the edge of the screen.
    const camera = this.cameras.main;
    if (cameraFrom) {
      // Just logged in: start where the spectator camera was and glide
      // softly to the player, then lock on.
      camera.centerOn(cameraFrom.x, cameraFrom.y);
      camera.startFollow(this.player.sprite, true, LOGIN_GLIDE_LERP, LOGIN_GLIDE_LERP);
      this.time.delayedCall(LOGIN_GLIDE_MS, () => camera.setLerp(1, 1));
    } else {
      camera.startFollow(this.player.sprite, true);
    }
  }

  // Moves the HTML names and bubbles to the players' current positions.
  updateOverlay() {
    this.overlay.update(
      this.cameras.main,
      (id) => (id === this.myId && this.player ? this.player.sprite : this.remotePlayers.getSprite(id)),
      // Our own name always stays visible; other names fade in the deep
      // when they are far from our light (see DeepLight.js).
      (id, sprite) => (id === this.myId ? 1 : this.deepLight.nameOpacityAt(sprite.x, sprite.y)),
    );
  }

  // Phaser calls update() every frame. `time` and `delta` are in milliseconds.
  update(time, delta) {
    if (this.isSpectator) {
      this.remotePlayers.update();
      this.spectatorCamera.update(time, delta);
      return;
    }
    this.player.move(this.controls.getDirection(), delta);
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
      // Spectators connect read-only, with no token (see WorldConnection.js).
      spectator: this.isSpectator,
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
        // Does the server have the same map as this page? If not, one of
        // them is older (for example this tab was open during a deploy).
        // Walls would not match, so ask the player to refresh.
        if (data.map !== this.mapInfo.fingerprint) {
          console.warn(
            `Map mismatch: the server has map ${data.map}, this page has ${this.mapInfo.fingerprint}. ` +
              'Refresh the page. If it still happens, deploy BOTH the website and the realtime Worker.',
          );
          this.mapOutdated = true;
        }
        // data.you is our user id, the same as this.myId
        // (both are null for a spectator, who has no player of their own).
        // Start fresh: the list in `welcome` is complete.
        this.remotePlayers.clear();
        for (const player of data.players) {
          if (this.myId && player.id === this.myId) {
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
          // (Spectators have no chat log, hence the "?.".)
          this.chatLog?.addSystem(`${data.player.name} joined`);
        }
        break;
      case MSG.LEAVE: {
        // Read the name before removing the player: `leave` only has the id.
        const name = this.remotePlayers.getName(data.id);
        this.remotePlayers.remove(data.id);
        if (name) {
          this.chatLog?.addSystem(`${name} left`);
        }
        break;
      }
      case MSG.CHAT:
        // The server never sends chat to spectators. Ignore it just in case.
        if (this.isSpectator) return;
        if (typeof data.text !== 'string' || typeof data.name !== 'string') return;
        // Works for our own messages too (our id is in the overlay as well).
        this.overlay.showBubble(data.id, data.text);
        this.chatLog.addChat(data.name, data.text);
        return;
      case MSG.NOTICE:
        if (!this.isSpectator && typeof data.text === 'string') {
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
    // Logged-out visitors see no status box: the login popup is enough.
    if (this.isSpectator) {
      hideNetStatus();
      return;
    }

    const retry = () => this.connection.retry();

    // An old map is more important than the player count: walls may not
    // match the server's, so tell the player to refresh. They can still play.
    if (this.mapOutdated && this.netStatus === STATUS.ONLINE) {
      showNetStatus(MAP_OUTDATED_MESSAGE, 'Refresh', () => window.location.reload());
      return;
    }

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

  // Sets the physics world bounds so the WHOLE visible fish stays inside
  // the world. This also means a fish can never leave the water: the top of
  // the world (y = 0) is the water surface. The server uses the same limits
  // (shared/mapInfo.js), so a cheater cannot swim into the sky either.
  // The physics body is only the hit box (smaller than the picture), so the
  // bounds are the allowed range for the hit box, worked out from the
  // allowed range for the fish's center.
  // Example: the picture reaches 13 px above the center, so the center can
  // never be closer than 13 px to the surface; the hit box (8 px above the
  // center) then starts 5 px down.
  setPhysicsBounds() {
    const limits = centerLimits(this.mapInfo);
    const left = limits.minX - PLAYER_HITBOX.halfWidth;
    const top = limits.minY + PLAYER_HITBOX.top;
    const right = limits.maxX + PLAYER_HITBOX.halfWidth;
    const bottom = limits.maxY + PLAYER_HITBOX.bottom;
    this.physics.world.setBounds(left, top, right - left, bottom - top);
  }

  // Picks a whole-number zoom (1, 2, 3...) so the shorter side of the screen
  // shows about TARGET_VIEW_SIZE game pixels.
  // A whole number keeps every game pixel the same size, so pixel art stays sharp.
  // Example: a 1080 px tall PC screen gets zoom 3 (shows 360 px).
  // A phone 390 px wide gets zoom 1 (shows 390 px).
  // But the view must never be bigger than the camera area, or black bands
  // would show at the sides. So on a very wide screen we zoom in more.
  // Example: a 4000 px wide screen at zoom 2 would show 2000 px, more than
  // the 1920 px world, so it gets zoom 3 instead (shows 1333 px).
  updateZoom(gameSize) {
    const { width, height } = gameSize;
    const shorterSide = Math.min(width, height);
    const comfortableZoom = Math.max(1, Math.round(shorterSide / TARGET_VIEW_SIZE));
    // The smallest whole zoom at which the camera area fills the screen.
    const fillWidthZoom = Math.ceil(width / this.cameraArea.width);
    const fillHeightZoom = Math.ceil(height / this.cameraArea.height);
    const zoom = Math.max(comfortableZoom, fillWidthZoom, fillHeightZoom);

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
