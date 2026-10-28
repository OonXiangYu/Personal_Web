// Reads the facts the GAME RULES need from a Tiled map (world.tmj):
// the map size, which tiles are walls, and where players start.
// The browser and the real-time server both use this file with the SAME map
// file, so they always agree on walls and edges. (Drawing the map is done
// by Phaser in src/game/WorldMap.js. This file does not draw anything.)
// Plain JavaScript only: it runs in the browser and in a Cloudflare Worker.

import { PLAYER_HITBOX, PLAYER_VISIBLE } from './world.js';

// A tile layer with this name marks walls. Any non-empty tile in it is blocked.
export const COLLISION_LAYER_NAME = 'collision';

// An object with this name (in any object layer) is where players start:
//   - a RECTANGLE: players start at a random spot inside it
//   - a POINT: players always start at that exact spot
export const SPAWN_OBJECT_NAME = 'spawn';

// Without a "spawn" object, players start in this area: the shallow, sunlit
// water near the surface, across the middle part of the world.
// x: from 25% to 75% of the world width. y: 64 to 192 px below the surface.
const DEFAULT_SPAWN_LEFT_SHARE = 0.25;
const DEFAULT_SPAWN_RIGHT_SHARE = 0.75;
const DEFAULT_SPAWN_TOP = 64;
const DEFAULT_SPAWN_BOTTOM = 192;

// How many random spots in the spawn area to try before giving up and
// searching for the nearest free spot (when walls fill much of the area).
const SPAWN_TRIES = 10;

// Tiled stores "flipped" and "rotated" as the top 3 bits of a tile number.
// We only care whether a tile is there, but we remove those bits to be safe.
const TILE_ID_MASK = 0x1fffffff;

// Reads a parsed world.tmj. Returns:
//   width, height        map size in game pixels
//   tileWidth, tileHeight
//   columns, rows        map size in tiles
//   blocked              one number per tile (row by row): 1 = wall, 0 = free
//   spawnArea            { x, y, width, height } where players start
//                        (pick a spot in it with pickSpawnPoint)
//   spawnCenter          { x, y } a free spot near the middle of the area
//                        (the browser shows the fish there until the server
//                        sends the real start position)
//   fingerprint          a short text that changes when the size, walls or
//                        spawn area change. Client and server compare it to
//                        notice when one of them has an older map.
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

  info.spawnArea = findSpawnArea(map, info);
  info.spawnCenter = findFreeSpot(
    info,
    info.spawnArea.x + info.spawnArea.width / 2,
    info.spawnArea.y + info.spawnArea.height / 2,
  );
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

// True if a fish at (x, y) would have its hit box on a wall tile.
// `shrink` makes the hit box a bit smaller (in pixels). The server uses 1 px,
// so tiny rounding differences never block an honest player at a wall's edge.
export function isHitboxBlocked(info, x, y, shrink = 0) {
  const left = x - PLAYER_HITBOX.halfWidth + shrink;
  const right = x + PLAYER_HITBOX.halfWidth - shrink;
  const top = y + PLAYER_HITBOX.top + shrink;
  const bottom = y + PLAYER_HITBOX.bottom - shrink;

  // Which tiles does the hit box touch? Usually 1 to 4, at most 6.
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
// looked at the end. Steps of 4 px are smaller than the hit box (16 px tall),
// so no wall can be skipped.
// Why try X alone and Y alone? When walking diagonally into a wall, the
// player should slide along it (like on the client), not stop dead.
export function slideMove(info, fromX, fromY, toX, toY, shrink = 0) {
  // A player already standing in a wall (for example a wall was added to
  // the map) may move anywhere free, so they can get out.
  if (isHitboxBlocked(info, fromX, fromY, shrink)) {
    return isHitboxBlocked(info, toX, toY, shrink) ? { x: fromX, y: fromY } : { x: toX, y: toY };
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
    if (!isHitboxBlocked(info, x + stepX, y + stepY, shrink)) {
      x += stepX;
      y += stepY;
    } else if (stepX !== 0 && !isHitboxBlocked(info, x + stepX, y, shrink)) {
      x += stepX; // slide sideways along a wall above or below
      hitWall = true;
    } else if (stepY !== 0 && !isHitboxBlocked(info, x, y + stepY, shrink)) {
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
  if (!isHitboxBlocked(info, start.x, start.y)) return start;

  const startColumn = Math.floor(start.x / info.tileWidth);
  const startRow = Math.floor(start.y / info.tileHeight);
  const maxRing = Math.max(info.columns, info.rows);

  for (let ring = 1; ring <= maxRing; ring++) {
    for (let row = startRow - ring; row <= startRow + ring; row++) {
      for (let column = startColumn - ring; column <= startColumn + ring; column++) {
        // Only the outer edge of the ring (the inside was checked already).
        const onEdge = Math.abs(row - startRow) === ring || Math.abs(column - startColumn) === ring;
        if (!onEdge) continue;
        // Put the middle of the HIT BOX in the middle of this tile.
        const hitboxMiddle = (PLAYER_HITBOX.top + PLAYER_HITBOX.bottom) / 2;
        const candidate = clampToMap(
          info,
          (column + 0.5) * info.tileWidth,
          (row + 0.5) * info.tileHeight - hitboxMiddle,
        );
        if (!isHitboxBlocked(info, candidate.x, candidate.y)) return candidate;
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
// The area where players start: the "spawn" rectangle or point from the map,
// or the default shallow-water area. A point is an area of size 0.
function findSpawnArea(map, info) {
  for (const layer of findLayers(map.layers || [])) {
    if (layer.type !== 'objectgroup') continue;
    const object = (layer.objects || []).find((item) => item.name === SPAWN_OBJECT_NAME);
    if (object) {
      return { x: object.x, y: object.y, width: object.width || 0, height: object.height || 0 };
    }
  }
  const left = info.width * DEFAULT_SPAWN_LEFT_SHARE;
  const right = info.width * DEFAULT_SPAWN_RIGHT_SHARE;
  return {
    x: left,
    y: DEFAULT_SPAWN_TOP,
    width: right - left,
    height: DEFAULT_SPAWN_BOTTOM - DEFAULT_SPAWN_TOP,
  };
}

// Picks where a new player starts: a random spot in the spawn area, so fish
// do not all appear on top of each other. The spot is always inside the map
// and never in a wall. The SERVER calls this (the browser just shows the
// fish where the server says).
// `random` is a function giving 0..1; it is only a parameter so tests can
// use a fixed one.
export function pickSpawnPoint(info, random = Math.random) {
  const area = info.spawnArea;
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const spot = clampToMap(info, area.x + random() * area.width, area.y + random() * area.height);
    if (!isHitboxBlocked(info, spot.x, spot.y)) return spot;
  }
  // Walls fill much of the area: use the nearest free spot to its middle.
  return info.spawnCenter;
}

// A short text that changes whenever the size, the walls or the spawn area change.
// (FNV-1a hash: simple, fast, and the same in the browser and the Worker.)
function makeFingerprint(info) {
  let hash = 0x811c9dc5;
  const add = (value) => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  const area = info.spawnArea;
  for (const char of `${info.width}x${info.height}|${area.x},${area.y},${area.width},${area.height}|`) {
    add(char.charCodeAt(0));
  }
  for (const cell of info.blocked) add(cell);
  return hash.toString(16).padStart(8, '0');
}
