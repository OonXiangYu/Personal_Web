// Reads the facts the GAME RULES need from a Tiled map (world.tmj):
// the map size, which tiles are walls, and where players start.
// The browser and the real-time server both use this file with the SAME map
// file, so they always agree on walls and edges. (Drawing the map is done
// by Phaser in src/game/WorldMap.js. This file does not draw anything.)
// Plain JavaScript only: it runs in the browser and in a Cloudflare Worker.

import { PLAYER_FEET, PLAYER_VISIBLE } from './world.js';

// A tile layer with this name marks walls. Any non-empty tile in it is blocked.
export const COLLISION_LAYER_NAME = 'collision';

// A point object with this name (in any object layer) is where players start.
export const SPAWN_OBJECT_NAME = 'spawn';

// Tiled stores "flipped" and "rotated" as the top 3 bits of a tile number.
// We only care whether a tile is there, but we remove those bits to be safe.
const TILE_ID_MASK = 0x1fffffff;

// Reads a parsed world.tmj. Returns:
//   width, height        map size in game pixels
//   tileWidth, tileHeight
//   columns, rows        map size in tiles
//   blocked              one number per tile (row by row): 1 = wall, 0 = free
//   spawn                { x, y } where players start (never inside a wall)
//   fingerprint          a short text that changes when the size, walls or
//                        spawn change. Client and server compare it to notice
//                        when one of them has an older map.
// Throws an Error with a clear message if the map cannot be used.
export function readMapInfo(map) {
  if (map.orientation !== 'orthogonal') throw new Error('The map must be orthogonal.');
  if (map.infinite) throw new Error('The map must not be infinite (Map > Map Properties).');

  const info = {
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    columns: map.width,
    rows: map.height,
    width: map.width * map.tilewidth,
    height: map.height * map.tileheight,
    blocked: new Uint8Array(map.width * map.height),
  };

  const collision = findLayers(map.layers || []).find(
    (layer) => layer.type === 'tilelayer' && layer.name === COLLISION_LAYER_NAME,
  );
  if (collision) {
    if (!Array.isArray(collision.data)) {
      // Tiled can save tiles as base64 or compressed text. We read plain lists.
      throw new Error(
        'The collision layer must be saved as CSV. In Tiled: Map > Map Properties > Tile Layer Format: CSV.',
      );
    }
    collision.data.forEach((tile, index) => {
      if ((tile & TILE_ID_MASK) !== 0) info.blocked[index] = 1;
    });
  }

  info.spawn = findSpawn(map, info);
  info.fingerprint = makeFingerprint(info);
  return info;
}

// The allowed range for a player's sprite CENTER, so the whole visible body
// stays inside the map: { minX, maxX, minY, maxY }.
export function centerLimits(info) {
  return {
    minX: PLAYER_VISIBLE.halfWidth,
    maxX: info.width - PLAYER_VISIBLE.halfWidth,
    minY: PLAYER_VISIBLE.top,
    maxY: info.height - PLAYER_VISIBLE.bottom,
  };
}

// Moves a point into the allowed center range.
export function clampToMap(info, x, y) {
  const limits = centerLimits(info);
  return {
    x: Math.min(limits.maxX, Math.max(limits.minX, x)),
    y: Math.min(limits.maxY, Math.max(limits.minY, y)),
  };
}

// True if a player standing at (x, y) would have their feet on a wall tile.
// `shrink` makes the feet a bit smaller (in pixels). The server uses 1 px,
// so tiny rounding differences never block an honest player at a wall's edge.
export function isFeetBlocked(info, x, y, shrink = 0) {
  const left = x - PLAYER_FEET.halfWidth + shrink;
  const right = x + PLAYER_FEET.halfWidth - shrink;
  const top = y + PLAYER_FEET.top + shrink;
  const bottom = y + PLAYER_FEET.bottom - shrink;

  // Which tiles does the feet box touch? Usually 1, at most 4.
  // (The tiny 0.001 stops a box that ends exactly on a tile edge from
  // counting the next tile.)
  const firstColumn = Math.floor(left / info.tileWidth);
  const lastColumn = Math.floor((right - 0.001) / info.tileWidth);
  const firstRow = Math.floor(top / info.tileHeight);
  const lastRow = Math.floor((bottom - 0.001) / info.tileHeight);

  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      // Outside the map counts as a wall.
      if (column < 0 || row < 0 || column >= info.columns || row >= info.rows) return true;
      if (info.blocked[row * info.columns + column]) return true;
    }
  }
  return false;
}

// Moves a player from (fromX, fromY) toward (toX, toY), stopping at walls
// and sliding along them. Used by the server to check moves.
//
// Why walk the path in small steps, not just check the end point?
// The speed check allows up to about 40 px in one message. A wall can be
// only one tile (32 px) thick, so a cheater could "hop over" it if we only
// looked at the end. Steps of 4 px are smaller than the feet (8 px tall),
// so no wall can be skipped.
// Why try X alone and Y alone? When walking diagonally into a wall, the
// player should slide along it (like on the client), not stop dead.
export function slideMove(info, fromX, fromY, toX, toY, shrink = 0) {
  // A player already standing in a wall (for example a wall was added to
  // the map) may move anywhere free, so they can get out.
  if (isFeetBlocked(info, fromX, fromY, shrink)) {
    return isFeetBlocked(info, toX, toY, shrink) ? { x: fromX, y: fromY } : { x: toX, y: toY };
  }

  const STEP = 4;
  const distance = Math.hypot(toX - fromX, toY - fromY);
  const steps = Math.max(1, Math.ceil(distance / STEP));
  const stepX = (toX - fromX) / steps;
  const stepY = (toY - fromY) / steps;

  let x = fromX;
  let y = fromY;
  let hitWall = false;
  for (let i = 0; i < steps; i++) {
    if (!isFeetBlocked(info, x + stepX, y + stepY, shrink)) {
      x += stepX;
      y += stepY;
    } else if (stepX !== 0 && !isFeetBlocked(info, x + stepX, y, shrink)) {
      x += stepX; // slide sideways along a wall above or below
      hitWall = true;
    } else if (stepY !== 0 && !isFeetBlocked(info, x, y + stepY, shrink)) {
      y += stepY; // slide up or down along a wall to the left or right
      hitWall = true;
    } else {
      hitWall = true;
      break; // blocked in both directions: stop here
    }
  }
  // Nothing in the way: return the exact target. (Adding up many small
  // steps leaves tiny errors like 59.99999999 instead of 60.)
  return hitWall ? { x, y } : { x: toX, y: toY };
}

// Returns a free spot near (x, y): the spot itself if it is free, otherwise
// the center of the nearest free tile (searching in rings around it).
export function findFreeSpot(info, x, y) {
  const start = clampToMap(info, x, y);
  if (!isFeetBlocked(info, start.x, start.y)) return start;

  const startColumn = Math.floor(start.x / info.tileWidth);
  const startRow = Math.floor(start.y / info.tileHeight);
  const maxRing = Math.max(info.columns, info.rows);

  for (let ring = 1; ring <= maxRing; ring++) {
    for (let row = startRow - ring; row <= startRow + ring; row++) {
      for (let column = startColumn - ring; column <= startColumn + ring; column++) {
        // Only the outer edge of the ring (the inside was checked already).
        const onEdge = Math.abs(row - startRow) === ring || Math.abs(column - startColumn) === ring;
        if (!onEdge) continue;
        // Stand so the FEET are in the middle of this tile.
        const feetMiddle = (PLAYER_FEET.top + PLAYER_FEET.bottom) / 2;
        const candidate = clampToMap(
          info,
          (column + 0.5) * info.tileWidth,
          (row + 0.5) * info.tileHeight - feetMiddle,
        );
        if (!isFeetBlocked(info, candidate.x, candidate.y)) return candidate;
      }
    }
  }
  // The whole map is walls. Nothing better to do than the start.
  return start;
}

// ---------- Inside helpers ----------

// All layers, including layers inside group folders.
function findLayers(layers) {
  return layers.flatMap((layer) => (layer.type === 'group' ? findLayers(layer.layers || []) : [layer]));
}

// The "spawn" object, or the middle of the map. Always a free spot.
function findSpawn(map, info) {
  for (const layer of findLayers(map.layers || [])) {
    if (layer.type !== 'objectgroup') continue;
    const object = (layer.objects || []).find((item) => item.name === SPAWN_OBJECT_NAME);
    if (object) {
      // A point object's x/y is the point. For a rectangle, use its middle.
      const x = object.x + (object.width || 0) / 2;
      const y = object.y + (object.height || 0) / 2;
      return findFreeSpot(info, x, y);
    }
  }
  return findFreeSpot(info, info.width / 2, info.height / 2);
}

// A short text that changes whenever the size, the walls or the spawn change.
// (FNV-1a hash: simple, fast, and the same in the browser and the Worker.)
function makeFingerprint(info) {
  let hash = 0x811c9dc5;
  const add = (value) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const char of `${info.width}x${info.height}|${Math.round(info.spawn.x)},${Math.round(info.spawn.y)}|`) {
    add(char.charCodeAt(0));
  }
  for (const cell of info.blocked) add(cell);
  return hash.toString(16).padStart(8, '0');
}
