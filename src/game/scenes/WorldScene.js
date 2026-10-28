// The main game scene: the map, the player and the camera.
// For now the map is a simple placeholder grid. Real Tiled maps come later.

import Phaser from 'phaser';
import { Player } from '../Player.js';
import { Controls } from '../input/Controls.js';

// World size in game pixels.
const WORLD_WIDTH = 2048;
const WORLD_HEIGHT = 2048;

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

    // TODO: when we save positions, start at user.lastPosition instead.
    this.player = new Player(this, WORLD_WIDTH / 2, WORLD_HEIGHT / 2, user.username);
    this.player.sprite.setCollideWorldBounds(true);

    this.controls = new Controls(this);

    // The camera follows the player but never shows outside the world.
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    camera.startFollow(this.player.sprite, true);

    // Set the zoom now, and again every time the window size changes
    // (resizing a browser window or rotating a phone).
    this.updateZoom(this.scale.gameSize);
    this.scale.on('resize', this.updateZoom, this);
    // The scale manager lives longer than this scene, so remove our listener
    // when the scene stops. Otherwise it would call a dead scene.
    this.events.once('shutdown', () => this.scale.off('resize', this.updateZoom, this));
    this.events.once('destroy', () => this.scale.off('resize', this.updateZoom, this));
  }

  // Phaser calls update() every frame.
  update() {
    this.player.move(this.controls.getDirection());
  }

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
  }
}
