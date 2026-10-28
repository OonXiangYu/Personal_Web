// The placeholder ocean behind everything (side view):
//   - a strip of light sky above the water surface (the camera can show
//     SKY_VIEW_HEIGHT pixels above the water; fish cannot go there)
//   - a thin light line at the surface, so the water edge is clear
//   - the water: a vertical gradient, bright blue at the top, darker blue in
//     the middle, almost black at the bottom
//   - a few slow bubbles and tiny drifting specks, so the water feels alive
// Cheap on phones: one stretched picture for the water, and only a few dozen
// particles, created only near the camera.

// ---------- Colours (change these to change the look) ----------
const SKY_COLOR = 0xcde8f5; // light sky, above the water surface
const SURFACE_LINE_COLOR = 0xeaf8ff; // the thin line at the water surface
const WATER_TOP_COLOR = 0x3a9ad9; // bright blue, just under the surface
const WATER_MIDDLE_COLOR = 0x0f3d73; // darker blue, halfway down
const WATER_BOTTOM_COLOR = 0x03070f; // almost black, at the bottom
const BUBBLE_COLOR = 0xd8f2ff;
const SPECK_COLOR = 0xbfe4ff;

// ---------- Sizes ----------
// How much sky the camera may show above the water surface (game pixels).
// The camera's bounds go this far above the world (see WorldScene), so when
// a fish is at the surface, the player sees this strip of sky above it.
// Fish themselves can never leave the water.
export const SKY_VIEW_HEIGHT = 96;
const SURFACE_LINE_HEIGHT = 2;
// The gradient picture is 1 pixel wide and this many pixels tall; the game
// stretches it over the whole world. Taller = smoother colour steps.
const GRADIENT_STEPS = 480;

// ---------- Drawing order ----------
// Far below the map layers (which start at -1,000,000, see WorldMap.js).
const OCEAN_DEPTH = -3_000_000;
// Particles: behind the fish (fish use their y position, 0 and up),
// in front of the water and the map's lower layers.
const PARTICLE_DEPTH = -1;

// ---------- Particles ----------
const BUBBLE_EVERY_MS = 350; // one new bubble this often
const BUBBLE_LIFE_MS = [5000, 9000]; // each bubble lives this long (random in range)
const BUBBLE_RISE_SPEED = [8, 18]; // game pixels per second, upward
const SPECK_EVERY_MS = 250;
const SPECK_LIFE_MS = [6000, 10000];
const SPECK_DRIFT_SPEED = [2, 6]; // very slow sideways drift

// Texture names (made once, then reused when the scene restarts).
const GRADIENT_TEXTURE = 'ocean-gradient';
const BUBBLE_TEXTURE = 'ocean-bubble';
const SPECK_TEXTURE = 'ocean-speck';

// Builds the ocean in a scene. `mapInfo` gives the world size.
export function createOcean(scene, mapInfo) {
  const { width, height } = mapInfo;

  // Sky: the strip above the water that the camera may show.
  scene.add
    .rectangle(0, -SKY_VIEW_HEIGHT, width, SKY_VIEW_HEIGHT, SKY_COLOR)
    .setOrigin(0, 0)
    .setDepth(OCEAN_DEPTH);

  // Water: the gradient picture stretched over the whole world.
  makeGradientTexture(scene);
  scene.add.image(0, 0, GRADIENT_TEXTURE).setOrigin(0, 0).setDisplaySize(width, height).setDepth(OCEAN_DEPTH);

  // A thin light line at the surface (just under it, inside the water).
  scene.add
    .rectangle(0, 0, width, SURFACE_LINE_HEIGHT, SURFACE_LINE_COLOR)
    .setOrigin(0, 0)
    .setDepth(OCEAN_DEPTH + 1);

  makeDotTextures(scene);
  addParticles(scene, mapInfo);
}

// A 1 x GRADIENT_STEPS picture with the three water colours, made with a
// normal browser canvas. Works with every Phaser renderer.
// The water colour at a depth, as a number like 0x3a9ad9.
// `depth` is 0 at the surface and 1 at the bottom. It uses the same three
// colours as the gradient picture, so a fish tinted with this colour matches
// the water behind it (see depthFade.js).
export function waterColorAt(depth) {
  const d = Math.min(1, Math.max(0, depth));
  // Top half: top colour -> middle colour. Bottom half: middle -> bottom.
  return d < 0.5
    ? mixColors(WATER_TOP_COLOR, WATER_MIDDLE_COLOR, d / 0.5)
    : mixColors(WATER_MIDDLE_COLOR, WATER_BOTTOM_COLOR, (d - 0.5) / 0.5);
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

// 0x3a9ad9 -> "#3a9ad9" (the browser canvas wants text colours).
function toCssColor(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function makeGradientTexture(scene) {
  if (scene.textures.exists(GRADIENT_TEXTURE)) return;
  const texture = scene.textures.createCanvas(GRADIENT_TEXTURE, 1, GRADIENT_STEPS);
  const context = texture.getContext();
  const gradient = context.createLinearGradient(0, 0, 0, GRADIENT_STEPS);
  gradient.addColorStop(0, toCssColor(WATER_TOP_COLOR));
  gradient.addColorStop(0.5, toCssColor(WATER_MIDDLE_COLOR));
  gradient.addColorStop(1, toCssColor(WATER_BOTTOM_COLOR));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, GRADIENT_STEPS);
  texture.refresh();
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
