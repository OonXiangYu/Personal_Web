// Creates the Phaser game with our settings.
// main.js calls this after the player logs in.

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { WorldScene } from './scenes/WorldScene.js';

// Starts a new game inside the element with id `parentId`.
// `user` is { id, username } from the API. Scenes read it from the registry.
export function createGame(parentId, user) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: parentId,
    backgroundColor: '#1b1b24',

    // Keep pixel art sharp: no smoothing when scaling, and draw at whole pixels.
    pixelArt: true,
    roundPixels: true,

    scale: {
      // RESIZE makes the canvas always fill the whole window (no empty bars),
      // on PC and on phones in both portrait and landscape.
      // The camera zoom (see WorldScene) decides how much of the world we see.
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
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
      // Runs before any scene starts, so the user is ready when scenes need it.
      preBoot(game) {
        game.registry.set('user', user);
      },
    },
  });
}
