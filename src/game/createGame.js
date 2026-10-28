// Creates the Phaser game with our settings.
// main.js calls this once, when the page loads, BEFORE anyone logs in:
// the world runs behind the login form (as a spectator), and after login
// the same game switches to player mode, without reloading the page.

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { WorldScene } from './scenes/WorldScene.js';
import { watchScreenSize } from './watchScreenSize.js';

// Starts the game inside the element with id `parentId`.
// `onLoginRejected` is called when the login is no longer valid
// (for example it expired). main.js then shows the login form.
// Returns { game, setUser }. Call setUser(user) after login and
// setUser(null) after logout.
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
        // null = nobody logged in yet, so WorldScene starts as a spectator.
        phaserGame.registry.set('user', null);
        phaserGame.registry.set('onLoginRejected', onLoginRejected);
      },

      // Runs after the canvas exists. We can only resize it after this point.
      postBoot(phaserGame) {
        const container = document.getElementById(parentId);
        const stopWatching = watchScreenSize(phaserGame, container);
        game.events.once(Phaser.Core.Events.DESTROY, stopWatching);
      },
    },
  });

  // Switches between spectator mode (user = null) and player mode (user = { id, username }).
  // WorldScene reads the user when it starts, so we restart it. The map and
  // images are already loaded, so this is quick, and its clean-up code closes
  // the old connection and removes the old HTML (chat, names...).
  function setUser(user) {
    game.registry.set('user', user);
    if (game.scene.isActive('WorldScene')) {
      const world = game.scene.getScene('WorldScene');
      // Remember where the camera is, so the next mode can glide from there
      // instead of jumping (see WorldScene).
      const camera = world.cameras.main;
      game.registry.set('cameraFrom', { x: camera.midPoint.x, y: camera.midPoint.y });
      world.scene.restart();
    }
    // If the game is still loading, WorldScene simply starts in the right
    // mode when loading is done (BootScene starts it).
  }

  return { game, setUser };
}
