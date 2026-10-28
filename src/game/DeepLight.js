// Darkness and light in the deep.
// Deep water gets dark. Every fish carries its own light:
//   - your own fish: a big soft light around you, so you can see the water,
//     bubbles and other fish near you
//   - other fish: a small soft glow, visible from far away in the dark, so
//     they look like little points of light you want to swim toward
//   - logged out (spectator): no own fish, so a wide gentle light around the
//     middle of the screen
//
// HOW IT IS DRAWN (cheap, phone friendly):
//   1. ONE darkness layer: a "render texture" (a picture we draw into each
//      frame) the size of the view, in game pixels. Each frame we:
//        - fill it with a pre-made vertical darkness gradient, stretched over
//          the world's height, so each part of the screen is as dark as its
//          REAL depth (darker toward the bottom of the screen)
//        - cut a soft round hole into it where your light is ("erase")
//   2. ONE small glow picture per OTHER fish, drawn ABOVE the darkness with
//      "additive" blending (it adds light), so it shines in the dark.
//   3. ONE soft "light pool" in your light, drawn UNDER the fish, that
//      brightens the water around you (deep water itself is nearly black,
//      so just cutting a hole in the darkness would only show black water).
//   All use soft-circle pictures made once at start. No blur, no shaders,
//   no effect per fish: 1 fill + 1 erase + 1 pool + 1 small picture per fish.
//   Without WebGL (very old devices) all of this is skipped.
//
// HOW IT WORKS WITH depthFade.js:
//   depthFade makes deep fish dark and see-through. Here, fish INSIDE your
//   light are brought back toward their normal look ("lit"), so a fish you
//   swim up to becomes clearly visible. Your own fish is always lit.
//   Fish outside your light keep the full depth fade and sit under the
//   darkness: you only see their glow point.
//
// NAMES: in the deep, names of fish outside your light fade out (only the
// glow stays) and come back when the fish gets near. Your own name and all
// chat bubbles always stay visible.

import Phaser from 'phaser';
import { mixColors } from './Ocean.js';

// ======================= Tweak these =======================

// Darkness. Depth is a share of the world height (0 = surface, 1 = bottom).
export const DARKNESS_START_DEPTH = 0.25; // no darkness above this depth
export const MAX_DARKNESS = 0.92; // how dark it gets at the bottom (0 = none, 1 = black)
const DARKNESS_COLOR = 0x01040a; // the colour of the darkness (almost black, a little blue)

// Lights (radius in game pixels).
export const OWN_LIGHT_RADIUS = 110; // the light around your own fish
export const SPECTATOR_LIGHT_RADIUS = 170; // the light around the screen middle when logged out
export const SPECTATOR_LIGHT_STRENGTH = 0.6; // 1 = clears the darkness fully in the middle

// Glows (the light points). They start at GLOW_START_DEPTH and are at full
// strength from GLOW_FULL_DEPTH down.
export const GLOW_START_DEPTH = 0.3;
export const GLOW_FULL_DEPTH = 0.7;
export const OTHER_GLOW_RADIUS = 18; // other fish: a small point of light
export const OTHER_GLOW_COLOR = 0x8fe6ff; // soft cyan
export const OTHER_GLOW_ALPHA = 0.9; // brightness at full strength
// A fish inside your light is lit, so you see the fish itself. Its glow is
// turned down by up to this much there, so it does not wash the fish out.
export const GLOW_DIM_INSIDE_LIGHT = 0.8;

// The "light pool": the water inside your light (or the spectator light)
// gets brighter, so you can really see around you in the dark. It is drawn
// under the fish and bubbles, and only as strong as the darkness around it
// (so it does nothing in the bright shallow water).
export const LIGHT_POOL_COLOR = 0x9fd8ff; // soft blue-white
export const LIGHT_POOL_ALPHA = 0.35;

// Gentle pulse on the glows, so they feel alive.
export const PULSE_SECONDS = 3; // one full pulse
export const PULSE_AMOUNT = 0.08; // ±8% size and brightness

// Names of other fish fade out beyond this distance from your light's centre
// (game pixels), but only in the deep (where the glows are).
export const NAME_FADE_DISTANCE = OWN_LIGHT_RADIUS;

// ===========================================================

// Drawing order: the darkness covers everything in the world (fish use their
// y as depth, map layers are at -1,000,000 or +1,000,000), and the glows
// shine on top of the darkness. The light pool is under the bubbles (-1)
// and the fish (0 and up), but over the water and the lower map layers.
const DARKNESS_LAYER_DEPTH = 2_000_000;
const GLOW_DEPTH = DARKNESS_LAYER_DEPTH + 1;
const LIGHT_POOL_DEPTH = -2;

// The darkness layer is a bit bigger than the view, so it still covers the
// edges when the camera has moved a little since we last placed it.
const LAYER_MARGIN = 16;

// Texture names (made once, reused when the scene restarts).
const SOFT_CIRCLE_TEXTURE = 'light-soft-circle';
const SOFT_CIRCLE_SIZE = 64;
const DARKNESS_TEXTURE = 'light-darkness-gradient';
const DARKNESS_STEPS = 256; // rows in the darkness gradient

export class DeepLight {
  // scene: the WorldScene. mapInfo: the world size (shared/mapInfo.js).
  constructor(scene, mapInfo) {
    this.scene = scene;
    this.mapInfo = mapInfo;
    // Player -> its glow picture.
    this.glows = new Map();

    // The darkness layer needs WebGL (fast drawing into textures, additive
    // light). Without it, skip the whole effect: the game stays playable.
    this.enabled = scene.game.renderer.type === Phaser.WEBGL;
    if (!this.enabled) return;

    makeTextures(scene);

    this.layer = scene.add.renderTexture(0, 0, 4, 4).setOrigin(0, 0).setDepth(DARKNESS_LAYER_DEPTH);
    // Helper pictures we draw INTO the layer (not shown by themselves).
    this.gradient = scene.make.image({ key: DARKNESS_TEXTURE, add: false }).setOrigin(0, 0);
    this.lightStamp = scene.make.image({ key: SOFT_CIRCLE_TEXTURE, add: false });
    // The light pool (shown in the world, under the fish).
    this.pool = scene.add
      .image(0, 0, SOFT_CIRCLE_TEXTURE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(LIGHT_POOL_COLOR)
      .setDepth(LIGHT_POOL_DEPTH);

    // Redraw the darkness every frame, after everything has moved.
    scene.events.on('postupdate', this.update, this);
    scene.events.once('shutdown', () => scene.events.off('postupdate', this.update, this));
  }

  // Where the light is now: { x, y, radius, strength }.
  // Logged in: around our own fish. Logged out: the middle of the view.
  lightCircle() {
    const player = this.scene.player;
    if (player) {
      return { x: player.sprite.x, y: player.sprite.y, radius: OWN_LIGHT_RADIUS, strength: 1 };
    }
    const middle = this.scene.cameras.main.midPoint;
    return { x: middle.x, y: middle.y, radius: SPECTATOR_LIGHT_RADIUS, strength: SPECTATOR_LIGHT_STRENGTH };
  }

  // Redraws the darkness layer over the current view.
  update() {
    const view = this.scene.cameras.main.worldView;
    const width = Math.ceil(view.width) + LAYER_MARGIN * 2;
    const height = Math.ceil(view.height) + LAYER_MARGIN * 2;
    if (this.layer.width !== width || this.layer.height !== height) {
      this.layer.resize(width, height);
    }
    // Whole pixels, so the layer does not shimmer as the camera moves.
    const left = Math.floor(view.x) - LAYER_MARGIN;
    const top = Math.floor(view.y) - LAYER_MARGIN;
    this.layer.setPosition(left, top);

    this.layer.clear();
    // The darkness gradient covers the whole world height (y = 0 is the
    // surface), so each part of the view gets the darkness of its real depth.
    // Above the surface (the sky) nothing is drawn: no darkness there.
    this.gradient.setDisplaySize(width, this.mapInfo.height);
    this.layer.draw(this.gradient, 0, -top);

    // Cut the soft hole for the light. A see-through stamp erases only a
    // little, so the edge of the light is soft.
    const light = this.lightCircle();
    this.lightStamp.setDisplaySize(light.radius * 2, light.radius * 2);
    this.lightStamp.setAlpha(light.strength);
    this.layer.erase(this.lightStamp, light.x - left, light.y - top);

    // The light pool: brightens the water inside the light, as much as it
    // is dark there (0 in the shallow water, full near the bottom).
    const darkness = darknessAt(light.y / this.mapInfo.height) / MAX_DARKNESS;
    this.pool.setPosition(light.x, light.y);
    this.pool.setDisplaySize(light.radius * 2, light.radius * 2);
    this.pool.setAlpha(LIGHT_POOL_ALPHA * light.strength * darkness);
    this.pool.setVisible(darkness > 0);
  }

  // Called by each fish while drawing (see Player.js). Takes the depthFade
  // look and returns the final look, and places the fish's glow.
  adjustFish(player, x, y, look) {
    if (!this.enabled) return look;

    // How much this fish is inside the light: 1 = fully, 0 = outside.
    // Our own fish is always fully lit.
    const lit = player.hasPhysics ? 1 : this.litAt(x, y);
    // Inside the light, undo the depth fade (back toward the normal look).
    const finalLook = {
      tint: mixColors(look.tint, 0xffffff, lit),
      alpha: look.alpha + (1 - look.alpha) * lit,
    };

    // Our own fish has the light pool instead of a glow point.
    if (!player.hasPhysics) {
      this.placeGlow(player, x, y, lit);
    }
    return finalLook;
  }

  // Shows another fish's glow point, as strong as its depth allows.
  // `lit` (0..1): how much the fish is inside our light; there the glow is
  // turned down, so we see the fish itself instead of a bright blob.
  placeGlow(player, x, y, lit) {
    let glow = this.glows.get(player);
    if (!glow) {
      glow = this.scene.add
        .image(x, y, SOFT_CIRCLE_TEXTURE)
        .setBlendMode(Phaser.BlendModes.ADD) // adds light instead of covering
        .setTint(OTHER_GLOW_COLOR)
        .setDepth(GLOW_DEPTH);
      // Each glow pulses at its own moment, so they do not blink together.
      glow.pulseOffset = Math.random() * PULSE_SECONDS * 1000;
      this.glows.set(player, glow);
    }

    const strength = glowStrength(y / this.mapInfo.height) * (1 - lit * GLOW_DIM_INSIDE_LIGHT);
    const pulse =
      1 + Math.sin(((this.scene.time.now + glow.pulseOffset) / (PULSE_SECONDS * 1000)) * Math.PI * 2) * PULSE_AMOUNT;
    const size = OTHER_GLOW_RADIUS * 2 * pulse;

    glow.setPosition(x, y);
    glow.setDisplaySize(size, size);
    glow.setAlpha(strength * OTHER_GLOW_ALPHA * pulse);
    glow.setVisible(strength > 0);
  }

  // How visible another fish's NAME should be (0..1), from its position.
  // Shallow: always 1. Deep: 1 near your light, fading to 0 further away.
  nameOpacityAt(x, y) {
    if (!this.enabled) return 1;
    const light = this.lightCircle();
    const distance = Math.hypot(x - light.x, y - light.y);
    const near = 1 - smoothStep(NAME_FADE_DISTANCE * 0.75, NAME_FADE_DISTANCE, distance);
    const deep = glowStrength(y / this.mapInfo.height);
    return 1 - deep * (1 - near);
  }

  // How much a point is inside the light (1 = in the middle, 0 = outside).
  // The same soft edge as the hole cut into the darkness.
  litAt(x, y) {
    const light = this.lightCircle();
    const distance = Math.hypot(x - light.x, y - light.y);
    return light.strength * (1 - smoothStep(light.radius * 0.5, light.radius, distance));
  }

  // Removes a fish's glow (when the fish is removed).
  forget(player) {
    const glow = this.glows.get(player);
    if (glow) {
      glow.destroy();
      this.glows.delete(player);
    }
  }
}

// How strong the glows are at a depth (0..1): 0 above GLOW_START_DEPTH,
// 1 below GLOW_FULL_DEPTH, smooth in between.
function glowStrength(depth) {
  return smoothStep(GLOW_START_DEPTH, GLOW_FULL_DEPTH, depth);
}

// How dark the water is at a depth (0..MAX_DARKNESS).
// Uses a smooth S-curve from DARKNESS_START_DEPTH down to the bottom: it
// starts very gently (no hard line where the darkness begins) and gets dark
// steadily deeper down.
function darknessAt(depth) {
  return MAX_DARKNESS * smoothStep(DARKNESS_START_DEPTH, 1, depth);
}

// 0 below `edge0`, 1 above `edge1`, and a smooth S-curve in between.
function smoothStep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Makes the two pictures once:
//   - a soft white circle (solid in the middle, see-through at the edge),
//     used for the light hole and for the glows
//   - a 1 x DARKNESS_STEPS darkness gradient: each row is the darkness of
//     that depth (row 0 = surface, last row = bottom)
function makeTextures(scene) {
  if (!scene.textures.exists(SOFT_CIRCLE_TEXTURE)) {
    const texture = scene.textures.createCanvas(SOFT_CIRCLE_TEXTURE, SOFT_CIRCLE_SIZE, SOFT_CIRCLE_SIZE);
    const context = texture.getContext();
    const half = SOFT_CIRCLE_SIZE / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, SOFT_CIRCLE_SIZE, SOFT_CIRCLE_SIZE);
    texture.refresh();
  }
  if (!scene.textures.exists(DARKNESS_TEXTURE)) {
    const texture = scene.textures.createCanvas(DARKNESS_TEXTURE, 1, DARKNESS_STEPS);
    const context = texture.getContext();
    const r = (DARKNESS_COLOR >> 16) & 0xff;
    const g = (DARKNESS_COLOR >> 8) & 0xff;
    const b = DARKNESS_COLOR & 0xff;
    for (let row = 0; row < DARKNESS_STEPS; row++) {
      const depth = (row + 0.5) / DARKNESS_STEPS;
      context.fillStyle = `rgba(${r}, ${g}, ${b}, ${darknessAt(depth)})`;
      context.fillRect(0, row, 1, 1);
    }
    texture.refresh();
  }
}
