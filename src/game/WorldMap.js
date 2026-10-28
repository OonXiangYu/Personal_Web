// Draws the Tiled map (public/assets/maps/world.tmj) in the game.
//
// - Every tile layer is drawn, in the same order as in Tiled, so new layers
//   you paint (paths, flowers...) just show up.
// - A layer with the custom property "above" = true is drawn ABOVE the
//   players (for treetops, roofs...). All other layers are drawn below them.
// - The layer named "collision" is never drawn. Its tiles are walls.
//
// The game rules (map size, walls, spawn point) come from shared/mapInfo.js,
// which reads the same map file. The real-time server uses that too.

import { readMapInfo, COLLISION_LAYER_NAME } from '../../shared/mapInfo.js';

// The map file, relative to the website root (files in public/ are served as they are).
export const MAP_URL = 'assets/maps/world.tmj';
export const MAP_KEY = 'world';

// Players use their y position as depth (0 up to the map height), so lower
// players are drawn in front. Map layers go far below or far above that range.
const BELOW_PLAYERS_DEPTH = -1_000_000;
const ABOVE_PLAYERS_DEPTH = 1_000_000;

// The name we load a tileset image under (see BootScene).
export function tilesetImageKey(tilesetName) {
  return `tileset:${tilesetName}`;
}

// Builds the map in a scene. Returns:
//   info            the game-rule facts (size, walls, spawn), see shared/mapInfo.js
//   collisionLayer  the invisible wall layer for physics, or null if there is none
export function createWorldMap(scene) {
  // The raw map JSON that Phaser loaded. We read the game rules from it
  // with the shared code, so the browser and the server agree exactly.
  const info = readMapInfo(scene.cache.tilemap.get(MAP_KEY).data);

  const map = scene.make.tilemap({ key: MAP_KEY });

  // Connect each tileset in the map to its loaded image.
  // Tiled tileset names must match (they do, because BootScene used them).
  const tilesets = map.tilesets
    .map((tileset) => map.addTilesetImage(tileset.name, tilesetImageKey(tileset.name)))
    .filter(Boolean); // a tileset whose image failed to load is skipped

  let collisionLayer = null;

  // map.layers lists the tile layers in Tiled order (bottom first). Layers
  // inside a group folder are included, named like "folder/layer".
  map.layers.forEach((layerData, index) => {
    const name = layerData.name.split('/').pop();
    const layer = map.createLayer(layerData.name, tilesets);

    if (name === COLLISION_LAYER_NAME) {
      // Walls: invisible, but solid for the player's physics body.
      // -1 means "empty"; every other tile collides.
      layer.setVisible(false);
      layer.setCollisionByExclusion([-1]);
      collisionLayer = layer;
      return;
    }

    // "+ index" keeps the Tiled order inside each group (below / above).
    const base = hasAboveProperty(layerData) ? ABOVE_PLAYERS_DEPTH : BELOW_PLAYERS_DEPTH;
    layer.setDepth(base + index);
  });

  return { info, collisionLayer };
}

// True if the layer has the custom property "above" set to true in Tiled
// (Layer Properties > Custom Properties > add a "bool" property named "above").
function hasAboveProperty(layerData) {
  const properties = layerData.properties || [];
  return properties.some((property) => property.name === 'above' && property.value === true);
}
