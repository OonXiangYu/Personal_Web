// Creates the Phaser game with our settings.
// main.js calls this once, when the page loads. Visitors play straight away
// as a guest fish; logging in (or out) switches the same game to another
// mode, without reloading the page. See MODE in mode.js.

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { WorldScene } from './scenes/WorldScene.js';
import { watchScreenSize } from './watchScreenSize.js';
import { MODE } from './mode.js';

// Starts the game inside the element with id `parentId`.
// `onLoginRejected` is called when the login is no longer valid
// (for example it expired). main.js then shows the login form.
// Returns { game, playAsGuest, playAsUser, setPaused }.
export function createGame(parentId, { onLoginRejected }) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    // Plain black. Normally never seen: the camera stays inside the world
    // and the strip of sky above it (see WorldScene). Shown only while loading.
    backgroundColor: '#000000',

    // Keep pixel art sharp: no smoothing when scaling, and draw at whole pixels.
    pixelArt: true,
    roundPixels: true,

    scale: {
      // RESIZE makes the canvas always fill the whole window (no empty bars),
      // on PC and on phones in both portrait and landscape.
      // The camera zoom (see WorldScene) decides how much of the world we see.
      // watchScreenSize.js makes sure it notices every size change.
      mode: Phaser.Scale.RESIZE,
    },

    physics: {
      default: 'arcade',
      arcade: {
        // Top-down game, so nothing falls down.
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },

    scene: [BootScene, WorldScene],

    callbacks: {
      // Runs before any scene starts.
      preBoot(phaserGame) {
        // "loading": main.js is still checking a saved login. The world shows
        // (map, drifting camera) but does not connect yet, so a returning
        // player never appears as a guest for a moment first.
        phaserGame.registry.set('mode', MODE.LOADING);
        phaserGame.registry.set('user', null);
        phaserGame.registry.set('paused', false);
        // The handoff token from the last `welcome` (see shared/protocol.js).
        phaserGame.registry.set('handoff', null);
        // Why we are a spectator: 'full' when the tank was full.
        phaserGame.registry.set('spectatorReason', null);
        phaserGame.registry.set('onLoginRejected', onLoginRejected);
        // WorldScene calls these when the tank is full / for "Try again".
        phaserGame.registry.set('worldControl', { tankFull, tryAgain });
      },

      // Runs after the canvas exists. We can only resize it after this point.
      postBoot(phaserGame) {
        const container = document.getElementById(parentId);
        const stopWatching = watchScreenSize(phaserGame, container);
        game.events.once(Phaser.Core.Events.DESTROY, stopWatching);
      },
    },
  });

  // The mode we WANT to play in (guest, or user + the user), so that after
  // "the tank is full" the "Try again" button knows what to try.
  let wanted = { mode: MODE.LOADING, user: null };

  // Switches the world to another mode.
  // WorldScene reads the mode when it starts, so we restart it. The map and
  // images are already loaded, so this is quick, and its clean-up code closes
  // the old connection and removes the old HTML (chat, names...). The next
  // connection sends the handoff token, so the fish keeps its place.
  function setMode(mode, user = null) {
    game.registry.set('mode', mode);
    game.registry.set('user', user);
    if (mode !== MODE.SPECTATOR) game.registry.set('spectatorReason', null);
    if (game.scene.isActive('WorldScene')) {
      const world = game.scene.getScene('WorldScene');
      // Remember where the camera is, so the next mode can glide from there
      // instead of jumping (see WorldScene).
      const camera = world.cameras.main;
      game.registry.set('cameraFrom', { x: camera.midPoint.x, y: camera.midPoint.y });
      // And where our fish is, so the new fish appears right there (the
      // server puts it there too, thanks to the handoff token) instead of
      // jumping from the spawn area.
      const fish = world.player?.sprite;
      game.registry.set('fishFrom', fish ? { x: fish.x, y: fish.y } : null);
      world.scene.restart();
    }
    // If the game is still loading, WorldScene simply starts in the right
    // mode when loading is done (BootScene starts it).
  }

  // Play without logging in.
  function playAsGuest() {
    wanted = { mode: MODE.GUEST, user: null };
    setMode(MODE.GUEST);
  }

  // Play as a logged-in player. `user` is { id, username } from the API.
  function playAsUser(user) {
    wanted = { mode: MODE.USER, user };
    setMode(MODE.USER, user);
  }

  // Called by WorldScene when the server said "the tank is full":
  // watch as a spectator instead, with a message and "Try again".
  function tankFull() {
    game.registry.set('spectatorReason', 'full');
    setMode(MODE.SPECTATOR);
  }

  // "Try again" after a full tank: back to the mode we wanted.
  function tryAgain() {
    setMode(wanted.mode, wanted.user);
  }

  // Stops (true) or allows (false) the own fish from moving, for example
  // while the login popup is open.
  function setPaused(paused) {
    game.registry.set('paused', paused);
  }

  return { game, playAsGuest, playAsUser, setPaused };
}
