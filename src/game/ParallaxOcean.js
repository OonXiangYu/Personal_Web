// The painted ocean background (side view), in layers that move at
// different speeds when the camera moves left or right ("parallax"):
// far layers slowly, near layers faster. That makes the ocean look deep.
//
// Back to front:
//   sky, water, depth shade, far reef, mid reef, (bubbles, see Ocean.js),
//   near reef, (sardines, see Sardines.js), close reef, ... fish ...,
//   foreground reef
//
// The depth shade darkens only the WATER. The reef is in front of it, with
// its own milder darkening (REEF_SHADE_AT_BOTTOM). Otherwise the reef would
// be darkened twice (by the shade AND by the deep-water darkness in
// DeepLight.js) and could not be seen even inside your light. Outside your
// light the deep-water darkness still makes it dim.
//
// Decoration only: nothing here blocks the fish.
//
// How the parallax works:
// Each layer is ONE Phaser TileSprite: a rectangle that repeats its image
// over and over, so there is never a gap, even at the world edges.
// Its "scroll factor" tells Phaser how much it moves with the camera:
//   0   = stays on screen like a sticker (infinitely far away)
//   1   = moves exactly with the world (like the fish)
//   1.2 = moves FASTER than the world (closer to you than the fish)
// Phaser works this out while drawing, with the camera position of that
// exact frame, so the layers never lag behind.
//
// Up and down:
//   - The sky and the water image (with the surface waves) stay fixed at
//     the water surface.
//   - The reef layers sit at the BOTTOM OF THE SCREEN, so you see reef at
//     every depth. Each frame, just before drawing, placeReef() moves them:
//     a small vertical parallax (VERTICAL_PARALLAX) lets them sink a little
//     below the screen bottom while you swim up, so up/down feels deep too.
//     At the bottom of the world they rest on the seabed.
//
// Sharp pixels: every layer uses the same whole-number scale (LAYER_SCALE),
// and the game has `roundPixels` on (see createGame.js), so Phaser puts
// every layer on whole screen pixels. Nothing shimmers while moving.
//
// Cheap on phones: 7 TileSprites, 1 plain rectangle and 1 stretched
// picture. A TileSprite is drawn as a single rectangle however wide it is.

// ---------- Images (in public/assets/backgrounds/ocean/) ----------
const IMAGE_FOLDER = 'assets/backgrounds/ocean/';

// ---------- Parallax speeds (horizontal scroll factor of each layer) ----------
export const SKY_PARALLAX = 0.05;
export const WATER_PARALLAX = 0.1;
export const FAR_PARALLAX = 0.2;
export const MID_PARALLAX = 0.4;
export const NEAR_PARALLAX = 0.6;
export const CLOSE_PARALLAX = 0.8;
export const FOREGROUND_PARALLAX = 1.2;

// ---------- Vertical parallax of the reef layers ----------
// 0 = pinned to the bottom of the screen, 1 = fixed to the world (stays on
// the seabed). In between: the layer sinks below the screen bottom by this
// share of your height above the seabed. Example: 300 px above the seabed,
// the near reef (0.15) sinks 45 px.
export const FAR_VERTICAL_PARALLAX = 0.05;
export const MID_VERTICAL_PARALLAX = 0.1;
export const NEAR_VERTICAL_PARALLAX = 0.15;
export const CLOSE_VERTICAL_PARALLAX = 0.2;
export const FOREGROUND_VERTICAL_PARALLAX = 0.3;

// A reef layer never sinks more than this share of its own height, so it
// stays visible at every depth (high up, it stops sinking and just rides
// along at the screen bottom).
const REEF_MAX_SINK = 0.5;

// The same whole-number scale for all layers. 1 = one image pixel is one
// game pixel, the same pixel size as the fish. (The camera zoom then makes
// everything bigger together.)
const LAYER_SCALE = 1;

// The foreground reef is in front of the fish, so it is see-through,
// to never hide a fish too much. (Names and chat bubbles are HTML above the
// whole game, so the foreground never covers them.)
const FOREGROUND_ALPHA = 0.7;

// ---------- Water colour and depth shade ----------
// The water image fades from light waves at the top to this blue (its last
// rows). Below the image, the rest of the water is filled with it.
export const WATER_FILL_COLOR = 0x007ae1;

// The depth shade: a black layer over the water and the reef, see-through
// at the surface and darker with depth, so the water still gets darker the
// deeper you go. Values are how dark (0 = no shade, 1 = black):
const SHADE_AT_SURFACE = 0;
const SHADE_AT_MIDDLE = 0.5; // halfway down: WATER_FILL_COLOR becomes #003d70
const SHADE_AT_BOTTOM = 0.94; // at the seabed: almost black, #00070d
// The shade picture is 1 pixel wide and this tall, stretched over the world.
const SHADE_STEPS = 480;

// The reef's own darkening by depth: the same curve as the depth shade, but
// only this dark at the bottom (0 = not darkened, 1 = black). Mild, so the
// reef is clearly visible inside your light, but not so bright that it
// glows next to the dark water.
const REEF_SHADE_AT_BOTTOM = 0.4;

// ---------- Drawing order ----------
// All of these are far below the map layers (which start at -1,000,000,
// see WorldMap.js) and the fish (their depth is their y position).
const BACKGROUND_DEPTH = -3_000_000;
export const LAYER_DEPTH = {
  sky: BACKGROUND_DEPTH,
  water: BACKGROUND_DEPTH + 1,
  shade: BACKGROUND_DEPTH + 2, // over the water only, behind the reef
  far: BACKGROUND_DEPTH + 3,
  mid: BACKGROUND_DEPTH + 4,
  bubbles: BACKGROUND_DEPTH + 5, // used by Ocean.js
  near: BACKGROUND_DEPTH + 6,
  sardines: BACKGROUND_DEPTH + 7, // used by Sardines.js: between the near and close reef
  close: BACKGROUND_DEPTH + 8,
  // In front of the fish and the map's "above" layers (1,000,000), but
  // behind the deep-water darkness (2,000,000, see DeepLight.js), so the
  // foreground gets dark in the deep like everything else.
  foreground: 1_500_000,
};

// The layers. `place` says where the image sits:
//   'sky'     its bottom edge on the water surface (y = 0)
//   'surface' its top edge on the water surface
//   'reef'    at the bottom of the screen (see placeReef), with its own
//             vertical parallax and depth darkening
const LAYERS = [
  { key: 'ocean-sky', file: 'sky.png', parallax: SKY_PARALLAX, depth: LAYER_DEPTH.sky, place: 'sky' },
  { key: 'ocean-water', file: 'water.png', parallax: WATER_PARALLAX, depth: LAYER_DEPTH.water, place: 'surface' },
  {
    key: 'ocean-coral-far',
    file: 'coral-far.png',
    parallax: FAR_PARALLAX,
    vertical: FAR_VERTICAL_PARALLAX,
    depth: LAYER_DEPTH.far,
    place: 'reef',
  },
  {
    key: 'ocean-coral-mid',
    file: 'coral-mid.png',
    parallax: MID_PARALLAX,
    vertical: MID_VERTICAL_PARALLAX,
    depth: LAYER_DEPTH.mid,
    place: 'reef',
  },
  {
    key: 'ocean-coral-near',
    file: 'coral-near.png',
    parallax: NEAR_PARALLAX,
    vertical: NEAR_VERTICAL_PARALLAX,
    depth: LAYER_DEPTH.near,
    place: 'reef',
  },
  {
    key: 'ocean-coral-close',
    file: 'coral-close.png',
    parallax: CLOSE_PARALLAX,
    vertical: CLOSE_VERTICAL_PARALLAX,
    depth: LAYER_DEPTH.close,
    place: 'reef',
  },
  {
    key: 'ocean-coral-foreground',
    file: 'coral-foreground.png',
    parallax: FOREGROUND_PARALLAX,
    vertical: FOREGROUND_VERTICAL_PARALLAX,
    depth: LAYER_DEPTH.foreground,
    place: 'reef',
    foreground: true,
  },
];

const SHADE_TEXTURE = 'ocean-depth-shade';

// The height of the sky image, so the camera can show all of it
// (see SKY_VIEW_HEIGHT in Ocean.js).
export const SKY_IMAGE_HEIGHT = 128;

// Loads the layer images. Called from BootScene's preload().
export function preloadParallaxOcean(scene) {
  for (const layer of LAYERS) {
    scene.load.image(layer.key, IMAGE_FOLDER + layer.file);
  }
}

// How dark the depth shade is at a depth (0 = surface, 1 = bottom).
// Also used for the water colour behind a fish (see Ocean.js waterColorAt).
export function shadeAt(depth) {
  const d = Math.min(1, Math.max(0, depth));
  return d < 0.5
    ? SHADE_AT_SURFACE + (SHADE_AT_MIDDLE - SHADE_AT_SURFACE) * (d / 0.5)
    : SHADE_AT_MIDDLE + (SHADE_AT_BOTTOM - SHADE_AT_MIDDLE) * ((d - 0.5) / 0.5);
}

// Builds all the layers in a scene. `mapInfo` gives the world size.
export function createParallaxOcean(scene, mapInfo) {
  const { width, height } = mapInfo;

  // The reef layers, to move every frame: { sprite, height, vertical }.
  const reef = [];
  for (const layer of LAYERS) {
    const sprite = addLayer(scene, layer, width);
    if (layer.place === 'reef') {
      reef.push({ sprite, height: sprite.displayHeight, vertical: layer.vertical });
    }
  }

  // Place the reef just before each frame is drawn. The camera fires
  // "prerender" after it has worked out its final position for this frame
  // (following the fish), so the reef never lags one frame behind.
  const camera = scene.cameras.main;
  const onPreRender = () => placeReef(reef, camera, height);
  camera.on('prerender', onPreRender);
  // The scene is reused on login/logout: remove the listener when it stops.
  scene.events.once('shutdown', () => camera.off('prerender', onPreRender));

  // Below the water image: plain water colour down to the seabed.
  // (A flat colour looks the same at any speed, so it needs no parallax.)
  const waterImageHeight = scene.textures.get('ocean-water').getSourceImage().height * LAYER_SCALE;
  scene.add
    .rectangle(0, waterImageHeight, width, height - waterImageHeight, WATER_FILL_COLOR)
    .setOrigin(0, 0)
    .setDepth(LAYER_DEPTH.water);

  // The depth shade, over the water (but behind the reef and the fish).
  makeShadeTexture(scene);
  scene.add.image(0, 0, SHADE_TEXTURE).setOrigin(0, 0).setDisplaySize(width, height).setDepth(LAYER_DEPTH.shade);
}

// One repeating layer. Returns its TileSprite.
function addLayer(scene, layer, worldWidth) {
  const image = scene.textures.get(layer.key).getSourceImage();
  const layerHeight = image.height * LAYER_SCALE;

  // (Reef layers are moved every frame by placeReef, so 0 is just a start.)
  const y = layer.place === 'sky' ? -layerHeight : 0;

  // How wide must the strip be, so it covers the screen wherever the camera
  // is? The camera's scroll goes from about -worldWidth to +worldWidth
  // (with zoom, Phaser's scroll can be a bit outside the world), and the
  // layer moves `parallax` times as far. So start well to the left and make
  // it wide enough for the far right, plus a full screen (the view is never
  // wider than the world, see WorldScene.updateZoom). Only the part on
  // screen is drawn, so the extra width costs nothing.
  const reach = worldWidth * (1 + layer.parallax);
  const left = -reach - worldWidth;
  const stripWidth = 2 * reach + 3 * worldWidth;

  const sprite = scene.add
    .tileSprite(left, y, stripWidth / LAYER_SCALE, image.height, layer.key)
    .setOrigin(0, 0)
    .setScale(LAYER_SCALE)
    .setScrollFactor(layer.parallax, 1)
    .setDepth(layer.depth);

  if (layer.foreground) {
    sprite.setAlpha(FOREGROUND_ALPHA);
  }
  return sprite;
}

// Moves each reef layer to the bottom of the screen, and darkens it for
// the depth where it is drawn this frame. Runs once per frame.
function placeReef(reef, camera, worldHeight) {
  // The world y of the bottom edge of the screen. (The camera never shows
  // anything below the world, so this is never more than worldHeight.)
  const screenBottom = camera.worldView.bottom;
  const aboveSeabed = worldHeight - screenBottom;

  for (const layer of reef) {
    // How far the layer sinks below the screen bottom: a share of our
    // height above the seabed (0 at the seabed, so it rests on it there),
    // but never more than REEF_MAX_SINK of the layer.
    const sink = Math.min(layer.vertical * aboveSeabed, layer.height * REEF_MAX_SINK);
    // Rounded UP to a whole pixel: a bottom edge that is a fraction of a
    // pixel too high would show a thin gap below the reef.
    const bottom = Math.ceil(screenBottom + sink);
    // Never above the water surface: on a short screen near the surface,
    // the reef would otherwise reach into the sky. (Its bottom edge is then
    // even lower, so there is still no gap below it.)
    const top = Math.max(0, bottom - layer.height);
    layer.sprite.y = top;

    // Darker at the bottom of the image than at its top, for the depth it
    // is really drawn at this frame. Phaser tints the 4 corners (top-left,
    // top-right, bottom-left, bottom-right) and blends smoothly between them.
    const topTint = reefTint(top / worldHeight);
    const bottomTint = reefTint((top + layer.height) / worldHeight);
    layer.sprite.setTint(topTint, topTint, bottomTint, bottomTint);
  }
}

// The grey tint for the reef at a depth (0 = surface, 1 = bottom):
// white (no change) at the surface, down to REEF_SHADE_AT_BOTTOM darker at
// the bottom, following the same curve as the water's depth shade.
function reefTint(depth) {
  const shade = shadeAt(depth) * (REEF_SHADE_AT_BOTTOM / SHADE_AT_BOTTOM);
  const grey = Math.round(255 * (1 - shade));
  return (grey << 16) | (grey << 8) | grey;
}

// A 1 x SHADE_STEPS picture: black, see-through at the top, darker below,
// following shadeAt(). Made with a normal browser canvas.
function makeShadeTexture(scene) {
  if (scene.textures.exists(SHADE_TEXTURE)) return;
  const texture = scene.textures.createCanvas(SHADE_TEXTURE, 1, SHADE_STEPS);
  const context = texture.getContext();
  const gradient = context.createLinearGradient(0, 0, 0, SHADE_STEPS);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${SHADE_AT_SURFACE})`);
  gradient.addColorStop(0.5, `rgba(0, 0, 0, ${SHADE_AT_MIDDLE})`);
  gradient.addColorStop(1, `rgba(0, 0, 0, ${SHADE_AT_BOTTOM})`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1, SHADE_STEPS);
  texture.refresh();
}
