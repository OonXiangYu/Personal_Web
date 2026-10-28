// The first scene. It loads the images and makes the animations,
// then starts the world scene.

import Phaser from 'phaser';
import { Player } from '../Player.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  // Phaser calls preload() first and waits until all files are loaded.
  preload() {
    Player.preload(this);
  }

  // Phaser calls create() when loading is done.
  create() {
    Player.createAnimations(this);
    this.scene.start('WorldScene');
  }
}
