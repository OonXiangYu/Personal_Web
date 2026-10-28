// Generates the base floor of the Tiled map: the "ground" layer, filled with grass.
// About 90% is one plain grass tile, and about 10% is small grass spots,
// placed randomly so the map does not look like a grid.
//
// It ONLY replaces the tiles of the "ground" layer. Every other layer
// (paths, trees, objects...), every other tileset, and the map settings in
// world.tmj are kept as they are. So you can paint other layers in Tiled and
// still run this script again later.
// If world.tmj does not exist yet, it creates a new map.
//
// Run it from the project folder:
//   node tools/generate-floor.js
// Options (all optional):
//   --seed 2026     random seed. The same seed always gives the same ground.
//   --spots 0.10    share of the ground covered by spot tiles (0.10 = 10%)
//   --width 60      map width in tiles  (only for a NEW map, or a map with no other layers)
//   --height 60     map height in tiles (same)

import fs from 'node:fs';
import path from 'node:path';

// ---------- Files ----------
const MAP_FILE = 'public/assets/maps/world.tmj';
// Asset file names are always lowercase. Our live server (Vercel, Linux)
// treats "Grass.png" and "grass.png" as different files.
const TILESET_FILE = 'public/assets/tilesets/grass.png';

// ---------- Names in the map ----------
const GROUND_LAYER_NAME = 'ground';
const TILESET_NAME = 'grass';

// ---------- Tileset facts (measured from grass.png) ----------
const TILE_SIZE = 32;
const TILESET_COLUMNS = 32; // 1024 px / 32
const TILESET_ROWS = 16; // 512 px / 32
const TILESET_TILE_COUNT = TILESET_COLUMNS * TILESET_ROWS;

// ---------- Size of a NEW map ----------
const DEFAULT_WIDTH = 60;
const DEFAULT_HEIGHT = 60;

// ---------- Which tiles to use ----------
// Tile ids count from 0 at the top-left of grass.png, left to right.
//
// The plain tile: one even color (#768f5d, mid green) with no spots or edges.
// grass.png has only 3 plain tiles, one per grass color: 0 (mid green),
// 32 (yellow-green) and 64 (dark green). We use mid green, the middle shade.
const PLAIN_TILE = 0;

// Spot "stamps": each spot in this tileset is drawn across 2 x 2 tiles.
// One tile alone would show half a spot with a straight cut at its edge,
// which makes stripes. So we always place all 4 tiles together.
// The outer edge of each stamp is exactly the plain mid green, so it fits
// on the plain tile with no visible seam.
// Each stamp is [top-left, top-right, bottom-left, bottom-right].
const SPOT_STAMPS = [
  [1, 2, 33, 34], // small yellow-green spot
  [104, 105, 136, 137], // small yellow-green diamond
  [193, 194, 225, 226], // small dark green spot
  [216, 217, 248, 249], // small dark green diamond
];
const STAMP_SIZE = 2; // tiles

// =====================================================================

const options = readOptions(process.argv.slice(2), { seed: 2026, spots: 0.1, width: null, height: null });

// Start from the existing map, or from a new empty one.
const existingMap = fs.existsSync(MAP_FILE) ? readMap(MAP_FILE) : null;
const { width, height } = chooseSize(existingMap, options);
const map = existingMap || makeEmptyMap(width, height);

// Make sure the grass tileset is in the map, and find its first tile number.
const firstGid = ensureGrassTileset(map);

// Build the new ground tiles.
const random = makeRandom(options.seed);
const { tiles, stampCount } = buildGround(width, height, options.spots, random);

// Put them into the "ground" layer (made if missing). Nothing else changes.
setGroundLayer(map, tiles.map((id) => firstGid + id), width, height);

fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true });
fs.writeFileSync(MAP_FILE, formatMap(map));

const spotTiles = stampCount * STAMP_SIZE * STAMP_SIZE;
const total = width * height;
console.log(`${existingMap ? 'Updated' : 'Created'} ${MAP_FILE}: ${width} x ${height} tiles, seed ${options.seed}`);
console.log(`Plain tiles: ${total - spotTiles} (${percent(total - spotTiles, total)})`);
console.log(`Spot tiles:  ${spotTiles} (${percent(spotTiles, total)}) in ${stampCount} spots`);
const otherLayers = allLayers(map.layers).filter((layer) => layer.name !== GROUND_LAYER_NAME);
if (otherLayers.length > 0) {
  console.log(`Kept other layers: ${otherLayers.map((layer) => layer.name).join(', ')}`);
}

// =====================================================================
// Reading and updating the map

// Reads and checks world.tmj. Stops with a clear message if it cannot be used.
function readMap(file) {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    stop(`${file} is not valid JSON (${err.message}). Fix or delete it, then run again.`);
  }
  if (map.infinite) {
    // Infinite maps store tiles in "chunks", which this script does not handle.
    stop(`${file} is an infinite map. In Tiled, turn off Map > Map Properties > Infinite first.`);
  }
  if (map.tilewidth !== TILE_SIZE || map.tileheight !== TILE_SIZE) {
    stop(`${file} uses ${map.tilewidth} x ${map.tileheight} tiles, but grass.png has ${TILE_SIZE} x ${TILE_SIZE}.`);
  }
  map.layers = map.layers || [];
  map.tilesets = map.tilesets || [];
  return map;
}

// Decides the map size.
// For an existing map we keep its size. Changing it is only allowed when
// "ground" is the only layer, because Tiled stores every tile layer at the
// map's size, and the other layers would no longer fit.
function chooseSize(existing, opts) {
  if (!existing) {
    return { width: opts.width ?? DEFAULT_WIDTH, height: opts.height ?? DEFAULT_HEIGHT };
  }
  const width = opts.width ?? existing.width;
  const height = opts.height ?? existing.height;
  const sizeChanges = width !== existing.width || height !== existing.height;
  const hasOtherLayers = allLayers(existing.layers).some((layer) => layer.name !== GROUND_LAYER_NAME);
  if (sizeChanges && hasOtherLayers) {
    stop(
      `The map is ${existing.width} x ${existing.height} and has other layers, so this script will not ` +
        `change its size to ${width} x ${height}. Resize the map in Tiled instead ` +
        '(Map > Resize Map), then run this script again without --width/--height.',
    );
  }
  if (sizeChanges) {
    existing.width = width;
    existing.height = height;
  }
  return { width, height };
}

// Makes sure the "grass" tileset is in the map. Returns its "firstgid":
// the number Tiled uses for tile 0 of this tileset in the layer data.
// (Each tileset gets its own range of numbers, and 0 means "empty".)
function ensureGrassTileset(map) {
  const imagePath = relativeToMap(TILESET_FILE);
  const existing = map.tilesets.find((tileset) => tileset.name === TILESET_NAME);

  if (existing) {
    if (existing.tilecount !== TILESET_TILE_COUNT || existing.columns !== TILESET_COLUMNS) {
      stop(`The "${TILESET_NAME}" tileset in the map has a different layout than grass.png. Check it in Tiled.`);
    }
    // Keep everything the person set in Tiled; only fix the image path
    // (for example after a file was renamed to lowercase).
    existing.image = imagePath;
    return existing.firstgid;
  }

  // Not there yet: add it after all other tilesets, using the next free numbers.
  const firstgid = nextFreeGid(map.tilesets);
  map.tilesets.push({
    columns: TILESET_COLUMNS,
    firstgid,
    image: imagePath,
    imageheight: TILE_SIZE * TILESET_ROWS,
    imagewidth: TILE_SIZE * TILESET_COLUMNS,
    margin: 0,
    name: TILESET_NAME,
    spacing: 0,
    tilecount: TILESET_TILE_COUNT,
    tileheight: TILE_SIZE,
    tilewidth: TILE_SIZE,
  });
  return firstgid;
}

// The first tile number not used by any existing tileset.
function nextFreeGid(tilesets) {
  let next = 1;
  for (const tileset of tilesets) {
    if (tileset.source) {
      // An external tileset file (.tsj). We cannot see its tile count here.
      stop(
        `The map uses an external tileset (${tileset.source}). This script only supports ` +
          'tilesets embedded in the map. In Tiled, use "Embed Tileset" on it, or add the grass tileset by hand.',
      );
    }
    next = Math.max(next, tileset.firstgid + tileset.tilecount);
  }
  return next;
}

// Puts the tiles into the "ground" layer. If there is no such layer, adds one
// at the very bottom (so it is drawn under everything else).
function setGroundLayer(map, data, width, height) {
  const ground = allLayers(map.layers).find((layer) => layer.name === GROUND_LAYER_NAME);

  if (ground) {
    if (ground.type !== 'tilelayer') {
      stop(`The layer "${GROUND_LAYER_NAME}" is a ${ground.type}, not a tile layer. Rename it in Tiled.`);
    }
    // Write plain numbers. Remove settings for other formats (Tiled can also
    // save data as base64 or compressed), because our data is a plain list.
    delete ground.encoding;
    delete ground.compression;
    ground.data = data;
    ground.width = width;
    ground.height = height;
    return;
  }

  map.nextlayerid = map.nextlayerid || 1;
  map.layers.unshift({
    data,
    height,
    id: map.nextlayerid,
    name: GROUND_LAYER_NAME,
    opacity: 1,
    type: 'tilelayer',
    visible: true,
    width,
    x: 0,
    y: 0,
  });
  map.nextlayerid += 1;
}

// A new, empty map with no layers and no tilesets.
function makeEmptyMap(width, height) {
  return {
    compressionlevel: -1,
    height,
    infinite: false,
    layers: [],
    nextlayerid: 1,
    nextobjectid: 1,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.12.2',
    tileheight: TILE_SIZE,
    tilesets: [],
    tilewidth: TILE_SIZE,
    type: 'map',
    version: '1.10',
    width,
  };
}

// All layers, including layers inside groups (Tiled lets you put layers in folders).
function allLayers(layers) {
  return layers.flatMap((layer) => (layer.type === 'group' ? [layer, ...allLayers(layer.layers || [])] : [layer]));
}

// Tiled wants file paths relative to the map file, with "/" slashes.
function relativeToMap(file) {
  return path.relative(path.dirname(MAP_FILE), file).split(path.sep).join('/');
}

// Turns the map into text. Tile data is written one map row per line
// (like Tiled does), so the file is easy to read and to compare in git.
function formatMap(map) {
  const rowsByMarker = new Map();
  const text = JSON.stringify(
    map,
    function (key, value) {
      // Swap each tile layer's data list for a marker, and remember its rows.
      if (key === 'data' && Array.isArray(value) && this.type === 'tilelayer') {
        const marker = `__TILE_DATA_${rowsByMarker.size}__`;
        const rows = [];
        for (let y = 0; y < this.height; y++) {
          rows.push(value.slice(y * this.width, (y + 1) * this.width).join(', '));
        }
        rowsByMarker.set(marker, `[${rows.join(',\n  ')}]`);
        return marker;
      }
      return value;
    },
    1,
  );
  let result = text;
  for (const [marker, rows] of rowsByMarker) {
    result = result.replace(`"${marker}"`, rows);
  }
  return result + '\n';
}

// =====================================================================
// Building the ground

// Fills the ground with the plain tile, then places spot stamps at random free places.
// Returns the tile ids (0-based, row by row) and how many stamps were placed.
function buildGround(width, height, spotShare, random) {
  const tiles = new Array(width * height).fill(PLAIN_TILE);

  // Marks tiles that are part of a stamp OR right next to one.
  // Keeping a one-tile gap stops spots from touching and forming big clumps.
  const blocked = new Array(width * height).fill(false);

  const wantedStamps = Math.round((width * height * spotShare) / (STAMP_SIZE * STAMP_SIZE));
  let stampCount = 0;

  // Try random places. Some tries fail (the place is blocked), so we allow
  // many tries, but stop at some point so the script can never loop forever.
  const maxTries = wantedStamps * 100;
  for (let tries = 0; tries < maxTries && stampCount < wantedStamps; tries++) {
    const x = Math.floor(random() * (width - STAMP_SIZE + 1));
    const y = Math.floor(random() * (height - STAMP_SIZE + 1));
    if (isAreaBlocked(blocked, width, x, y)) continue;

    const stamp = SPOT_STAMPS[Math.floor(random() * SPOT_STAMPS.length)];
    tiles[y * width + x] = stamp[0];
    tiles[y * width + x + 1] = stamp[1];
    tiles[(y + 1) * width + x] = stamp[2];
    tiles[(y + 1) * width + x + 1] = stamp[3];
    blockAround(blocked, width, height, x, y);
    stampCount++;
  }

  if (stampCount < wantedStamps) {
    console.warn(`Only room for ${stampCount} of ${wantedStamps} spots. Try a smaller --spots value.`);
  }
  return { tiles, stampCount };
}

// True if any tile of the 2 x 2 area at (x, y) is already blocked.
function isAreaBlocked(blocked, width, x, y) {
  for (let dy = 0; dy < STAMP_SIZE; dy++) {
    for (let dx = 0; dx < STAMP_SIZE; dx++) {
      if (blocked[(y + dy) * width + x + dx]) return true;
    }
  }
  return false;
}

// Blocks the stamp at (x, y) and a one-tile ring around it.
function blockAround(blocked, width, height, x, y) {
  for (let by = y - 1; by <= y + STAMP_SIZE; by++) {
    for (let bx = x - 1; bx <= x + STAMP_SIZE; bx++) {
      if (bx >= 0 && by >= 0 && bx < width && by < height) {
        blocked[by * width + bx] = true;
      }
    }
  }
}

// =====================================================================
// Small helpers

// A small random number generator with a seed (mulberry32).
// Math.random() cannot take a seed, and we want the same ground for the same seed.
// Returns a function that gives a number from 0 (included) to 1 (not included).
function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reads "--name value" options, with defaults. Stops with a clear message on mistakes.
function readOptions(args, defaults) {
  const result = { ...defaults };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '');
    const value = Number(args[i + 1]);
    if (!(name in defaults) || !Number.isFinite(value)) {
      stop(`Unknown option or bad value: ${args[i]} ${args[i + 1] ?? ''}\n` +
        'Options: --seed 2026 --spots 0.1 --width 60 --height 60');
    }
    result[name] = value;
  }
  for (const name of ['width', 'height']) {
    if (result[name] !== null && result[name] < STAMP_SIZE) {
      stop(`--${name} must be at least ${STAMP_SIZE}.`);
    }
  }
  return result;
}

// Prints an error and stops, without touching the map file.
function stop(message) {
  console.error(message);
  process.exit(1);
}

function percent(part, total) {
  return `${((part / total) * 100).toFixed(1)}%`;
}
