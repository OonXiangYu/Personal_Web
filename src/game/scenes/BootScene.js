// The first scene. It loads the images and the map, then starts the world scene.

import Phaser from 'phaser';
import { Player } from '../Player.js';
import { MAP_KEY, MAP_URL, tilesetImageKey } from '../WorldMap.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  // Phaser calls preload() first and waits until all files are loaded.
  preload() {
    Player.preload(this);

    // When the map file has loaded, look at the tilesets it lists and load
    // each tileset image too. So a tileset you add in Tiled loads by itself,
    // with no code change. (Adding files while loading is allowed in Phaser.)
    this.load.once(`filecomplete-tilemapJSON-${MAP_KEY}`, (key, type, mapData) => {
      // The image paths in the map are relative to the map file.
      const mapUrl = new URL(MAP_URL, document.baseURI);
      for (const tileset of mapData.tilesets) {
        if (tileset.source) {
          // A tileset saved in its own file (.tsj). We only support tilesets
          // embedded in the map. In Tiled: select the tileset, "Embed Tileset".
          console.error(`Tileset "${tileset.source}" is not embedded in the map, so it cannot be drawn.`);
          continue;
        }
        this.load.image(tilesetImageKey(tileset.name), new URL(tileset.image, mapUrl).href);
      }
    });
    this.load.tilemapTiledJSON(MAP_KEY, MAP_URL);
  }

  // Phaser calls create() when loading is done.
  create() {
    this.scene.start('WorldScene');
  }
}
