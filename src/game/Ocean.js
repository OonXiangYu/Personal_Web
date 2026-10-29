// The ocean behind everything (side view):
//   - the painted, layered background: sky, water and coral reef, moving
//     at different speeds with the camera (see ParallaxOcean.js)
//   - the water gets darker with depth (the "depth shade"), and the reef
//     has its own milder darkening (see ParallaxOcean.js)
//   - a few slow bubbles and tiny drifting specks, so the water feels alive
// Cheap on phones: only a few dozen particles, created only near the camera.

import { createParallaxOcean, LAYER_DEPTH, SKY_IMAGE_HEIGHT, WATER_FILL_COLOR, shadeAt } from './ParallaxOcean.js';

// ---------- Colours ----------
const BUBBLE_COLOR = 0xd8f2ff;
const SPECK_COLOR = 0xbfe4ff;

// ---------- Sizes ----------
// How much sky the camera may show above the water surface (game pixels).
// The camera's bounds go this far above the world (see WorldScene), so when
// a fish is at the surface, the player sees this strip of sky above it.
// It is the full height of the sky image. Fish can never leave the water.
export const SKY_VIEW_HEIGHT = SKY_IMAGE_HEIGHT;

// ---------- Drawing order ----------
// Particles: between the mid and the near reef (see LAYER_DEPTH), so
// bubbles rise from inside the reef. Behind the fish.
const PARTICLE_DEPTH = LAYER_DEPTH.bubbles;

// ---------- Particles ----------
const BUBBLE_EVERY_MS = 350; // one new bubble this often
const BUBBLE_LIFE_MS = [5000, 9000]; // each bubble lives this long (random in range)
const BUBBLE_RISE_SPEED = [8, 18]; // game pixels per second, upward
const SPECK_EVERY_MS = 250;
const SPECK_LIFE_MS = [6000, 10000];
const SPECK_DRIFT_SPEED = [2, 6]; // very slow sideways drift

// Texture names (made once, then reused when the scene restarts).
const BUBBLE_TEXTURE = 'ocean-bubble';
const SPECK_TEXTURE = 'ocean-speck';

// Builds the ocean in a scene. `mapInfo` gives the world size.
export function createOcean(scene, mapInfo) {
  createParallaxOcean(scene, mapInfo);

  makeDotTextures(scene);
  addParticles(scene, mapInfo);
}

// The water colour at a depth, as a number like 0x007ae1.
// `depth` is 0 at the surface and 1 at the bottom. It is the water fill
// colour darkened by the depth shade, so a fish tinted with this colour
// matches the water behind it (see depthFade.js).
export function waterColorAt(depth) {
  return mixColors(WATER_FILL_COLOR, 0x000000, shadeAt(depth));
}

// Mixes two colours: share 0 = all `from`, share 1 = all `to`.
export function mixColors(from, to, share) {
  const channel = (shift) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

// Small pixel pictures for the particles: a 4 x 4 bubble ring and a 1 x 1 speck.
function makeDotTextures(scene) {
  if (!scene.textures.exists(BUBBLE_TEXTURE)) {
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(BUBBLE_COLOR, 1);
    // A tiny ring: the 4 edges of a 4 x 4 square, without the corners.
    graphics.fillRect(1, 0, 2, 1);
    graphics.fillRect(1, 3, 2, 1);
    graphics.fillRect(0, 1, 1, 2);
    graphics.fillRect(3, 1, 1, 2);
    graphics.generateTexture(BUBBLE_TEXTURE, 4, 4);
    graphics.destroy();
  }
  if (!scene.textures.exists(SPECK_TEXTURE)) {
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(SPECK_COLOR, 1);
    graphics.fillRect(0, 0, 1, 1);
    graphics.generateTexture(SPECK_TEXTURE, 1, 1);
    graphics.destroy();
  }
}

// Bubbles that rise and fade, and specks that drift. They are only created
// inside the area the camera shows, so there are never many of them.
function addParticles(scene, mapInfo) {
  const camera = scene.cameras.main;

  // Where new particles appear: a random spot in the camera's view, but
  // only in the water (not in the sky or outside the world).
  // Phaser calls getRandomPoint() on this object for each new particle.
  // (The name must be exactly this, or Phaser silently ignores the zone and
  // every particle appears at the world's top-left corner.)
  const inViewUnderwater = {
    getRandomPoint(point) {
      const view = camera.worldView;
      const left = Math.max(0, view.x);
      const right = Math.min(mapInfo.width, view.right);
      const top = Math.max(8, view.y);
      const bottom = Math.min(mapInfo.height, view.bottom);
      point.x = left + Math.random() * Math.max(0, right - left);
      point.y = top + Math.random() * Math.max(0, bottom - top);
      return point;
    },
  };

  // A bubble that rises into the sky disappears.
  const aboveSurface = new Phaser.Geom.Rectangle(-100_000, -100_000, 200_000, 100_000);

  scene.add
    .particles(0, 0, BUBBLE_TEXTURE, {
      emitZone: { type: 'random', source: inViewUnderwater },
      deathZone: { type: 'onEnter', source: aboveSurface },
      frequency: BUBBLE_EVERY_MS,
      lifespan: { min: BUBBLE_LIFE_MS[0], max: BUBBLE_LIFE_MS[1] },
      speedY: { min: -BUBBLE_RISE_SPEED[1], max: -BUBBLE_RISE_SPEED[0] },
      speedX: { min: -2, max: 2 },
      alpha: { start: 0.7, end: 0 },
      scale: { min: 0.5, max: 1 },
    })
    .setDepth(PARTICLE_DEPTH);

  scene.add
    .particles(0, 0, SPECK_TEXTURE, {
      emitZone: { type: 'random', source: inViewUnderwater },
      frequency: SPECK_EVERY_MS,
      lifespan: { min: SPECK_LIFE_MS[0], max: SPECK_LIFE_MS[1] },
      speedX: { min: -SPECK_DRIFT_SPEED[1], max: SPECK_DRIFT_SPEED[1] },
      speedY: { min: -SPECK_DRIFT_SPEED[0], max: SPECK_DRIFT_SPEED[0] },
      // Fade in and out softly (0 -> 0.5 -> 0).
      alpha: { values: [0, 0.5, 0] },
    })
    .setDepth(PARTICLE_DEPTH);
}
