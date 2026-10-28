// Sets up the base of the Tiled map (public/assets/maps/world.tmj) for the
// side-view ocean:
//   - the map size (60 x 120 tiles of 32 px = 1920 x 3840 px by default)
//   - an EMPTY "ground" layer (the water itself is drawn by the game, not by tiles)
//   - the "collision" tileset (one red tile), so you can paint walls in Tiled
//   - a "spawn" rectangle near the top (the sunlit water), if the map has none yet:
//     players start at a random spot inside it
//
// It keeps every other layer, tileset and setting in world.tmj, so you can
// paint in Tiled and still run this script again later.
// If world.tmj does not exist yet, it creates a new map.
//
// Run it from the project folder:
//   node tools/generate-map.js
// Options (optional):
//   --width 60      map width in tiles
//   --height 120    map height in tiles
// The size can only change while the map has no other TILE layers
// (resize it in Tiled instead: Map > Resize Map).

import fs from 'node:fs';
import path from 'node:path';
import { writePng } from './png.js';

// ---------- Files ----------
const MAP_FILE = 'public/assets/maps/world.tmj';
// Asset file names are always lowercase (the live server is case-sensitive).
const COLLISION_TILESET_FILE = 'public/assets/tilesets/collision.png';

// ---------- Names in the map ----------
const GROUND_LAYER_NAME = 'ground';
const COLLISION_TILESET_NAME = 'collision';
const SPAWN_LAYER_NAME = 'points';
const SPAWN_OBJECT_NAME = 'spawn';
// The old grass tileset. It is removed from the map if no layer uses it.
const OLD_GRASS_TILESET_NAME = 'grass';

// ---------- Sizes ----------
const TILE_SIZE = 32;
const DEFAULT_WIDTH = 60; // tiles
const DEFAULT_HEIGHT = 120; // tiles

// The spawn area (the sunlit water near the surface), the same as the game's
// default in shared/mapInfo.js: x from 25% to 75% of the map width,
// y from 64 to 192 px below the surface.
const SPAWN_LEFT_SHARE = 0.25;
const SPAWN_RIGHT_SHARE = 0.75;
const SPAWN_TOP = 64;
const SPAWN_BOTTOM = 192;

// The collision tile: see-through red with a darker border, so painted walls
// are easy to see in Tiled. (The game never draws the collision layer.)
const COLLISION_FILL = [220, 40, 40, 140]; // red, about half see-through
const COLLISION_BORDER = [140, 0, 0, 220];

// =====================================================================

const options = readOptions(process.argv.slice(2), { width: null, height: null });

const existingMap = fs.existsSync(MAP_FILE) ? readMap(MAP_FILE) : null;
const map = existingMap || makeEmptyMap(options.width ?? DEFAULT_WIDTH, options.height ?? DEFAULT_HEIGHT);
const { width, height } = chooseSize(map, existingMap, options);

setEmptyGroundLayer(map, width, height);
const removedGrass = removeUnusedTileset(map, OLD_GRASS_TILESET_NAME);
makeCollisionTileImage();
ensureCollisionTileset(map);
const addedSpawn = ensureSpawnPoint(map);

fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true });
fs.writeFileSync(MAP_FILE, formatMap(map));

console.log(`${existingMap ? 'Updated' : 'Created'} ${MAP_FILE}: ${width} x ${height} tiles (${width * TILE_SIZE} x ${height * TILE_SIZE} px)`);
console.log(`"${GROUND_LAYER_NAME}" layer: empty. Tilesets: ${map.tilesets.map((t) => t.name).join(', ')}`);
if (removedGrass) console.log(`Removed the unused "${OLD_GRASS_TILESET_NAME}" tileset.`);
if (addedSpawn) {
  console.log(
    `Added a "${SPAWN_OBJECT_NAME}" rectangle: x ${addedSpawn.x}, y ${addedSpawn.y}, ` +
      `${addedSpawn.width} x ${addedSpawn.height} px.`,
  );
}

// =====================================================================

// Reads and checks world.tmj. Stops with a clear message if it cannot be used.
function readMap(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    stop(`${file} is not valid JSON (${err.message}). Fix or delete it, then run again.`);
  }
  if (parsed.infinite) stop(`${file} is an infinite map. In Tiled, turn off Map > Map Properties > Infinite.`);
  if (parsed.tilewidth !== TILE_SIZE || parsed.tileheight !== TILE_SIZE) {
    stop(`${file} uses ${parsed.tilewidth} x ${parsed.tileheight} tiles; this script expects ${TILE_SIZE} x ${TILE_SIZE}.`);
  }
  parsed.layers = parsed.layers || [];
  parsed.tilesets = parsed.tilesets || [];
  return parsed;
}

// Decides the map size. Changing the size of an existing map is only allowed
// while it has no other TILE layers, because Tiled stores every tile layer at
// the map's size (object layers do not care).
function chooseSize(map, existing, opts) {
  const width = opts.width ?? map.width;
  const height = opts.height ?? map.height;
  if (existing && (width !== map.width || height !== map.height)) {
    const otherTileLayers = allLayers(map.layers).filter(
      (layer) => layer.type === 'tilelayer' && layer.name !== GROUND_LAYER_NAME,
    );
    if (otherTileLayers.length > 0) {
      stop(
        `The map has other tile layers (${otherTileLayers.map((l) => l.name).join(', ')}), so this script will not ` +
          `resize it from ${map.width} x ${map.height} to ${width} x ${height}. Use Map > Resize Map in Tiled.`,
      );
    }
  }
  map.width = width;
  map.height = height;
  return { width, height };
}

// Makes the "ground" layer empty (all 0 = no tile), at the map size.
// The layer stays, so the map keeps the same structure as before.
function setEmptyGroundLayer(map, width, height) {
  const data = new Array(width * height).fill(0);
  const ground = allLayers(map.layers).find((layer) => layer.name === GROUND_LAYER_NAME);
  if (ground) {
    if (ground.type !== 'tilelayer') stop(`The layer "${GROUND_LAYER_NAME}" is not a tile layer. Rename it in Tiled.`);
    delete ground.encoding;
    delete ground.compression;
    ground.data = data;
    ground.width = width;
    ground.height = height;
    return;
  }
  map.nextlayerid = map.nextlayerid || 1;
  map.layers.unshift({
    data, height, id: map.nextlayerid, name: GROUND_LAYER_NAME, opacity: 1,
    type: 'tilelayer', visible: true, width, x: 0, y: 0,
  });
  map.nextlayerid += 1;
}

// Removes a tileset from the map, but only if no tile layer uses any of its
// tiles. Returns true if it was removed.
function removeUnusedTileset(map, name) {
  const index = map.tilesets.findIndex((tileset) => tileset.name === name);
  if (index === -1) return false;
  const { firstgid, tilecount } = map.tilesets[index];
  const used = allLayers(map.layers).some(
    (layer) =>
      layer.type === 'tilelayer' &&
      Array.isArray(layer.data) &&
      layer.data.some((gid) => (gid & 0x1fffffff) >= firstgid && (gid & 0x1fffffff) < firstgid + tilecount),
  );
  if (used) {
    console.warn(`The "${name}" tileset is still used by a layer, so it is kept.`);
    return false;
  }
  map.tilesets.splice(index, 1);
  return true;
}

// Writes collision.png (one 32 x 32 tile) if it does not exist yet.
function makeCollisionTileImage() {
  if (fs.existsSync(COLLISION_TILESET_FILE)) return;
  const pixels = Buffer.alloc(TILE_SIZE * TILE_SIZE * 4);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const onBorder = x === 0 || y === 0 || x === TILE_SIZE - 1 || y === TILE_SIZE - 1;
      Buffer.from(onBorder ? COLLISION_BORDER : COLLISION_FILL).copy(pixels, (y * TILE_SIZE + x) * 4);
    }
  }
  fs.mkdirSync(path.dirname(COLLISION_TILESET_FILE), { recursive: true });
  writePng(COLLISION_TILESET_FILE, TILE_SIZE, TILE_SIZE, pixels);
  console.log(`Wrote ${COLLISION_TILESET_FILE}`);
}

// Makes sure the one-tile "collision" tileset is embedded in the map.
function ensureCollisionTileset(map) {
  const image = path.relative(path.dirname(MAP_FILE), COLLISION_TILESET_FILE).split(path.sep).join('/');
  const existing = map.tilesets.find((tileset) => tileset.name === COLLISION_TILESET_NAME);
  if (existing) {
    existing.image = image;
    return;
  }
  // Tiled numbers tiles across all tilesets; use the next free number.
  let firstgid = 1;
  for (const tileset of map.tilesets) {
    if (tileset.source) stop(`The map uses an external tileset (${tileset.source}). In Tiled, use "Embed Tileset" first.`);
    firstgid = Math.max(firstgid, tileset.firstgid + tileset.tilecount);
  }
  map.tilesets.push({
    columns: 1, firstgid, image, imageheight: TILE_SIZE, imagewidth: TILE_SIZE, margin: 0,
    name: COLLISION_TILESET_NAME, spacing: 0, tilecount: 1, tileheight: TILE_SIZE, tilewidth: TILE_SIZE,
  });
}

// Adds a "spawn" rectangle near the top, in a "points" object layer, unless
// the map already has a spawn object (then it is left as you made it).
// Returns the new rectangle, or null.
function ensureSpawnPoint(map) {
  const hasSpawn = allLayers(map.layers).some(
    (layer) => layer.type === 'objectgroup' && (layer.objects || []).some((o) => o.name === SPAWN_OBJECT_NAME),
  );
  if (hasSpawn) return null;

  map.nextobjectid = map.nextobjectid || 1;
  const mapWidth = map.width * TILE_SIZE;
  // A rectangle object: no "point: true", and a real width and height.
  const spawn = {
    height: SPAWN_BOTTOM - SPAWN_TOP, id: map.nextobjectid, name: SPAWN_OBJECT_NAME, rotation: 0, type: '',
    visible: true, width: mapWidth * (SPAWN_RIGHT_SHARE - SPAWN_LEFT_SHARE),
    x: mapWidth * SPAWN_LEFT_SHARE, y: SPAWN_TOP,
  };
  map.nextobjectid += 1;

  let layer = map.layers.find((l) => l.type === 'objectgroup' && l.name === SPAWN_LAYER_NAME);
  if (!layer) {
    map.nextlayerid = map.nextlayerid || 1;
    layer = {
      draworder: 'topdown', id: map.nextlayerid, name: SPAWN_LAYER_NAME, objects: [], opacity: 1,
      type: 'objectgroup', visible: true, x: 0, y: 0,
    };
    map.nextlayerid += 1;
    map.layers.push(layer);
  }
  layer.objects.push(spawn);
  return spawn;
}

// A new, empty map.
function makeEmptyMap(width, height) {
  return {
    compressionlevel: -1, height, infinite: false, layers: [], nextlayerid: 1, nextobjectid: 1,
    orientation: 'orthogonal', renderorder: 'right-down', tiledversion: '1.12.2', tileheight: TILE_SIZE,
    tilesets: [], tilewidth: TILE_SIZE, type: 'map', version: '1.10', width,
  };
}

// All layers, including layers inside group folders.
function allLayers(layers) {
  return layers.flatMap((layer) => (layer.type === 'group' ? [layer, ...allLayers(layer.layers || [])] : [layer]));
}

// Turns the map into text. Tile data is written one map row per line
// (like Tiled does), so the file is easy to read and to compare in git.
function formatMap(map) {
  const rowsByMarker = new Map();
  const text = JSON.stringify(
    map,
    function (key, value) {
      if (key === 'data' && Array.isArray(value) && this.type === 'tilelayer') {
        const marker = `__TILE_DATA_${rowsByMarker.size}__`;
        const rows = [];
        for (let y = 0; y < this.height; y++) rows.push(value.slice(y * this.width, (y + 1) * this.width).join(', '));
        rowsByMarker.set(marker, `[${rows.join(',\n  ')}]`);
        return marker;
      }
      return value;
    },
    1,
  );
  let result = text;
  for (const [marker, rows] of rowsByMarker) result = result.replace(`"${marker}"`, rows);
  return result + '\n';
}

// Reads "--name value" options. Stops with a clear message on mistakes.
function readOptions(args, defaults) {
  const result = { ...defaults };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '');
    const value = Number(args[i + 1]);
    if (!(name in defaults) || !Number.isInteger(value) || value < 1) {
      stop(`Unknown option or bad value: ${args[i]} ${args[i + 1] ?? ''}\nOptions: --width 60 --height 120`);
    }
    result[name] = value;
  }
  return result;
}

// Prints an error and stops, without touching the map file.
function stop(message) {
  console.error(message);
  process.exit(1);
}
