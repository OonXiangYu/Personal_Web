// Schools of sardines in the sunlight layer (the bright water near the top).
// Decoration only, and only in this browser: the server knows nothing about
// them, so every player sees their own sardines.
//
// They move with "boids" (Craig Reynolds, 1986). Each sardine only looks at
// the sardines of its OWN school near it (within NEIGHBOUR_RADIUS) and
// follows three simple rules:
//   1. separation: do not bump into your neighbours
//   2. alignment:  swim the same way as your neighbours
//   3. cohesion:   stay close to your neighbours
// Together these make the whole school swim like one animal, although no
// sardine knows where the school is going. On top of that:
//   - each school slowly wanders toward a goal point that changes now and then
//   - soft forces keep them inside the sunlight layer and away from the
//     world's left and right edges
//   - every player fish scares them: they scatter (faster than usual), and
//     regroup when the fish is gone (lost sardines swim back to the middle
//     of their school). A fast fish scares them more.
//
// Cheap on phones:
//   - a "spatial grid": the world is cut into squares as big as the
//     neighbour radius, so each sardine only checks the sardines in its own
//     square and the 8 around it, not every sardine
//   - schools far outside the camera are hidden and only updated every few
//     frames
//   - fewer sardines on small screens
//
// Debug view (PC only): press B to show each sardine's neighbour radius and
// direction, and each player's scare radius.

import { depthFade, MIN_VISIBILITY_OTHER_FISH } from './depthFade.js';
import { LAYER_DEPTH } from './ParallaxOcean.js';
import { MOVE_SPEED } from '../../shared/world.js';
import { isTouchMode } from '../ui/touchMode.js';

// ---------- The sprite sheet (made by tools/make-sardine-animation.js) ----------
// 3 rows (fish 25, 28 and 31 px long), 9 frames each, facing LEFT.
const SHEET_KEY = 'fish-sardine-swim';
const SHEET_URL = 'assets/sprites/fish/sardine-swim.png';
const SARDINE_FRAME = { width: 31, height: 7 };
const FRAME_COUNT = 9;
const SIZE_ROWS = 3;
// The base speed of the swim cycle. Each sardine plays it a bit faster or
// slower (see ANIMATION_SPEED_RANGE), and faster when swimming fast.
const SWIM_FRAMES_PER_SECOND = 12;
const animationKey = (row) => `sardine-swim-${row}`;

// ---------- Schools ----------
const SCHOOL_COUNT = 3;
const SCHOOL_SIZE_MIN = 15;
const SCHOOL_SIZE_MAX = 20;
// Screens whose shorter side is smaller than this (phones) get fewer sardines.
const SMALL_SCREEN_MAX_SIDE = 500;
const SMALL_SCREEN_SCHOOL_SIZE = 10;
// New sardines start within this distance of their school's centre.
const START_SPREAD = 40;

// ---------- Boids ----------
// A sardine sees the sardines of its school within this distance (pixels).
// Also the size of the squares in the spatial grid.
const NEIGHBOUR_RADIUS = 40;
// Closer than this, a sardine moves away from a neighbour (separation).
const SEPARATION_RADIUS = 14;
// How strongly each rule steers (bigger = stronger).
const SEPARATION_WEIGHT = 1.8;
const ALIGNMENT_WEIGHT = 1.0;
const COHESION_WEIGHT = 0.9;
// The pull toward the school's wandering goal (weak, so the school drifts).
const WANDER_WEIGHT = 0.35;
// A sardine farther than this from the middle of its school (for example
// after being scattered) swims back toward it, with this weight. Without
// it, a lost sardine with no neighbours nearby would never find its school.
const REGROUP_DISTANCE = 30;
const REGROUP_WEIGHT = 1.2;
// Speeds in pixels per second. Each sardine gets its own top speed, up to
// SPEED_VARIATION more or less than MAX_SPEED.
const MAX_SPEED = 40;
const MIN_SPEED = 15;
const SPEED_VARIATION = 0.15;
// The strongest steering (pixels per second per second), so they curve
// instead of jerking around.
const MAX_FORCE = 80;
// How fast a sardine can turn (radians per second; 3.14 = half a turn).
const MAX_TURN_RATE = 2.5;
// A school picks a new goal when it gets this close, or after this long.
const WANDER_REACHED_DISTANCE = 60;
const WANDER_RETARGET_MS = [8000, 15000];

// ---------- Where they may swim ----------
// The sunlight layer, as a share of the world height (0 = surface, 1 = bottom).
// (The deep-water darkness starts at 0.25, see DeepLight.js.)
const SUNLIGHT_TOP = 0.03;
const SUNLIGHT_BOTTOM = 0.25;
// Within this many pixels of a limit, a soft force pushes them back.
// It grows the closer they get (LIMIT_FORCE at the limit itself).
const LIMIT_MARGIN = 40;
const LIMIT_FORCE = 150;
// Never closer to the water surface than this (pixels): never out of the water.
const SURFACE_GAP = 6;
// The same for the world's left and right edges.
const EDGE_MARGIN = 80;
const EDGE_FORCE = 150;

// ---------- Being scared by player fish ----------
// The scare radius grows from SCARE_RADIUS (a still fish) to
// SCARE_RADIUS_FAST (a fish at full speed). The same for the strength.
const SCARE_RADIUS = 60;
const SCARE_RADIUS_FAST = 110;
const SCARE_WEIGHT = 3;
const SCARE_WEIGHT_FAST = 6;
// A scared sardine panics for this long: faster, turning faster, and hardly
// sticking to its school (so the school scatters). Then it regroups.
const PANIC_MS = 1200;
const PANIC_SPEED_BOOST = 2.2;
const PANIC_COHESION_SHARE = 0.2;
// How softly a player's speed is measured (seconds).
const PLAYER_SPEED_SOFTNESS_SECONDS = 0.2;

// ---------- Looks ----------
// The swim cycle plays at its base speed times a random number in this range.
const ANIMATION_SPEED_RANGE = [0.8, 1.2];
// Tilt: nose up when swimming up, like the clownfish (see Player.js).
const TILT_MAX_DEGREES = 20;
const TILT_SOFTNESS_SECONDS = 0.15;

// ---------- Far away schools ----------
// A school whose centre is more than this far outside the camera view is
// "far": hidden, and only updated every FAR_UPDATE_EVERY frames (with a
// bigger time step, so it still moves at the right speed).
const FAR_MARGIN = 300;
const FAR_UPDATE_EVERY = 4;
// Never simulate more than this much time in one step (seconds), so a
// slow frame (or a far school's big step) cannot make sardines jump far.
const MAX_STEP_SECONDS = 0.2;

// ---------- Debug view ----------
// Drawn above everything, including the deep-water darkness (2,000,000).
const DEBUG_DEPTH = 2_100_000;
const DEBUG_SARDINE_COLOR = 0x66ffcc;
const DEBUG_SCARE_COLOR = 0xff6666;
// Shown or not. Kept outside the class, so it stays on after login/logout.
let debugVisible = false;

export class Sardines {
  // Queues the sprite sheet for loading. Call this in a scene's preload().
  static preload(scene) {
    scene.load.spritesheet(SHEET_KEY, SHEET_URL, {
      frameWidth: SARDINE_FRAME.width,
      frameHeight: SARDINE_FRAME.height,
    });
  }

  // Makes one swim animation per size row (once for the whole game).
  static createAnimations(scene) {
    for (let row = 0; row < SIZE_ROWS; row++) {
      if (scene.anims.exists(animationKey(row))) continue;
      scene.anims.create({
        key: animationKey(row),
        frames: scene.anims.generateFrameNumbers(SHEET_KEY, {
          start: row * FRAME_COUNT,
          end: row * FRAME_COUNT + FRAME_COUNT - 1,
        }),
        frameRate: SWIM_FRAMES_PER_SECOND,
        repeat: -1,
      });
    }
  }

  // getPlayerFish(): returns the player fish right now, as [{ id, sprite }]
  // (our own and everybody else's). The sardines run away from them.
  constructor(scene, mapInfo, getPlayerFish) {
    this.scene = scene;
    this.worldWidth = mapInfo.width;
    this.worldHeight = mapInfo.height;
    this.getPlayerFish = getPlayerFish;
    this.top = SUNLIGHT_TOP * mapInfo.height;
    this.bottom = SUNLIGHT_BOTTOM * mapInfo.height;
    this.frame = 0;
    // Player id -> { x, y, speed }, to know how fast each player swims.
    this.players = new Map();

    const { width, height } = scene.scale.gameSize;
    const smallScreen = Math.min(width, height) < SMALL_SCREEN_MAX_SIDE;

    this.schools = [];
    for (let index = 0; index < SCHOOL_COUNT; index++) {
      // Spread the schools across the world: one in each third.
      const centerX = ((index + 0.5) / SCHOOL_COUNT) * this.worldWidth;
      const centerY = randomBetween(this.top + LIMIT_MARGIN, this.bottom - LIMIT_MARGIN);
      const size = smallScreen
        ? SMALL_SCREEN_SCHOOL_SIZE
        : Math.round(randomBetween(SCHOOL_SIZE_MIN, SCHOOL_SIZE_MAX));
      const heading = Math.random() * Math.PI * 2;
      const school = { index, fish: [], far: false, goal: null, newGoalAt: 0 };
      for (let i = 0; i < size; i++) {
        school.fish.push(this.makeSardine(school, centerX, centerY, heading));
      }
      this.schools.push(school);
    }

    this.debug = scene.add.graphics().setDepth(DEBUG_DEPTH);
    this.onKeyDown = (event) => this.toggleDebug(event);
    window.addEventListener('keydown', this.onKeyDown);
    // The scene destroys the sprites itself when it stops. We only need to
    // remove our window listener (the scene is reused on login/logout).
    const stop = () => {
      window.removeEventListener('keydown', this.onKeyDown);
      scene.events.off('shutdown', stop);
      scene.events.off('destroy', stop);
    };
    scene.events.once('shutdown', stop);
    scene.events.once('destroy', stop);

    // Only on the development server (npm run dev), never in the real
    // build: lets automatic checks read where the sardines are.
    if (import.meta.env.DEV) window.__sardines = this;
  }

  // True while the debug view is on (for the automatic checks).
  get debugVisible() {
    return debugVisible;
  }

  // One sardine near (centerX, centerY), swimming roughly along `heading`.
  makeSardine(school, centerX, centerY, heading) {
    const maxSpeed = MAX_SPEED * randomBetween(1 - SPEED_VARIATION, 1 + SPEED_VARIATION);
    const angle = heading + randomBetween(-0.3, 0.3);
    const row = Math.floor(Math.random() * SIZE_ROWS); // its size
    const sprite = this.scene.add.sprite(0, 0, SHEET_KEY).setDepth(LAYER_DEPTH.sardines);
    // Start on a random frame, so they never flap in sync.
    sprite.anims.play({ key: animationKey(row), startFrame: Math.floor(Math.random() * FRAME_COUNT) });
    return {
      school,
      x: centerX + randomBetween(-START_SPREAD, START_SPREAD),
      y: Math.min(this.bottom, Math.max(this.top, centerY + randomBetween(-START_SPREAD, START_SPREAD) / 2)),
      vx: Math.cos(angle) * maxSpeed * 0.7,
      vy: Math.sin(angle) * maxSpeed * 0.7,
      maxSpeed,
      animationSpeed: randomBetween(ANIMATION_SPEED_RANGE[0], ANIMATION_SPEED_RANGE[1]),
      panicUntil: 0,
      facingLeft: Math.cos(angle) < 0,
      tilt: 0,
      sprite,
    };
  }

  // Phaser calls this every frame (from WorldScene.update).
  update(time, delta) {
    this.frame++;
    const seconds = Math.min(delta / 1000, MAX_STEP_SECONDS);
    const view = this.scene.cameras.main.worldView;
    const players = this.measurePlayers(seconds);
    const grid = this.buildGrid();

    for (const school of this.schools) {
      const center = schoolCenter(school);
      const far =
        center.x < view.x - FAR_MARGIN ||
        center.x > view.right + FAR_MARGIN ||
        center.y < view.y - FAR_MARGIN ||
        center.y > view.bottom + FAR_MARGIN;
      if (far !== school.far) {
        school.far = far;
        for (const fish of school.fish) {
          fish.sprite.setVisible(!far);
          // A hidden sardine does not need its swim cycle.
          if (far) fish.sprite.anims.pause();
          else fish.sprite.anims.resume();
        }
      }
      // Far schools: only every few frames (each school on a different
      // frame, so the work is spread out), with a bigger time step.
      if (far && (this.frame + school.index) % FAR_UPDATE_EVERY !== 0) continue;
      const step = far ? Math.min(seconds * FAR_UPDATE_EVERY, MAX_STEP_SECONDS) : seconds;

      this.updateGoal(school, center, time);
      for (const fish of school.fish) {
        this.steer(fish, center, grid, players, time, step);
        if (!far) this.draw(fish, step);
      }
    }

    this.drawDebug(players);
  }

  // Each player's position and speed (smoothed), for the scare radius.
  measurePlayers(seconds) {
    const seen = new Set();
    for (const { id, sprite } of this.getPlayerFish()) {
      seen.add(id);
      const last = this.players.get(id);
      if (!last) {
        this.players.set(id, { x: sprite.x, y: sprite.y, speed: 0 });
        continue;
      }
      if (seconds > 0) {
        const speed = Math.hypot(sprite.x - last.x, sprite.y - last.y) / seconds;
        last.speed += (speed - last.speed) * (1 - Math.exp(-seconds / PLAYER_SPEED_SOFTNESS_SECONDS));
      }
      last.x = sprite.x;
      last.y = sprite.y;
    }
    // Forget players who left.
    for (const id of this.players.keys()) {
      if (!seen.has(id)) this.players.delete(id);
    }
    // Add the scare radius and strength for this frame.
    const result = [];
    for (const player of this.players.values()) {
      const fast = Math.min(1, player.speed / MOVE_SPEED); // 0 = still, 1 = full speed
      result.push({
        x: player.x,
        y: player.y,
        radius: SCARE_RADIUS + (SCARE_RADIUS_FAST - SCARE_RADIUS) * fast,
        weight: SCARE_WEIGHT + (SCARE_WEIGHT_FAST - SCARE_WEIGHT) * fast,
      });
    }
    return result;
  }

  // The spatial grid: square (cx, cy) -> the sardines in it.
  buildGrid() {
    const grid = new Map();
    for (const school of this.schools) {
      for (const fish of school.fish) {
        const key = gridKey(Math.floor(fish.x / NEIGHBOUR_RADIUS), Math.floor(fish.y / NEIGHBOUR_RADIUS));
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(fish);
      }
    }
    return grid;
  }

  // Gives the school a new wandering goal when it reached the old one, or
  // after a while: a random spot inside the sunlight layer.
  updateGoal(school, center, time) {
    const reached = school.goal && Math.hypot(school.goal.x - center.x, school.goal.y - center.y) < WANDER_REACHED_DISTANCE;
    if (school.goal && !reached && time < school.newGoalAt) return;
    school.goal = {
      x: randomBetween(EDGE_MARGIN * 2, this.worldWidth - EDGE_MARGIN * 2),
      y: randomBetween(this.top + LIMIT_MARGIN, this.bottom - LIMIT_MARGIN),
    };
    school.newGoalAt = time + randomBetween(WANDER_RETARGET_MS[0], WANDER_RETARGET_MS[1]);
  }

  // Works out one sardine's new speed and position (the boids rules).
  // `center` is the middle of its school.
  steer(fish, center, grid, players, time, seconds) {
    let ax = 0;
    let ay = 0;

    // --- Look at the neighbours (same school only) ---
    let count = 0;
    let sumVx = 0;
    let sumVy = 0;
    let sumX = 0;
    let sumY = 0;
    let awayX = 0;
    let awayY = 0;
    const cellX = Math.floor(fish.x / NEIGHBOUR_RADIUS);
    const cellY = Math.floor(fish.y / NEIGHBOUR_RADIUS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = grid.get(gridKey(cellX + dx, cellY + dy));
        if (!list) continue;
        for (const other of list) {
          if (other === fish || other.school !== fish.school) continue;
          const offX = fish.x - other.x;
          const offY = fish.y - other.y;
          const distanceSquared = offX * offX + offY * offY;
          if (distanceSquared > NEIGHBOUR_RADIUS * NEIGHBOUR_RADIUS || distanceSquared === 0) continue;
          count++;
          sumVx += other.vx;
          sumVy += other.vy;
          sumX += other.x;
          sumY += other.y;
          if (distanceSquared < SEPARATION_RADIUS * SEPARATION_RADIUS) {
            // Push away, harder the closer they are (1 / distance).
            awayX += offX / distanceSquared;
            awayY += offY / distanceSquared;
          }
        }
      }
    }

    const panicking = time < fish.panicUntil;
    if (count > 0) {
      // Alignment: swim like the neighbours.
      [ax, ay] = addSteer(ax, ay, fish, sumVx, sumVy, ALIGNMENT_WEIGHT);
      // Cohesion: toward the neighbours' middle (weak while panicking).
      const cohesion = COHESION_WEIGHT * (panicking ? PANIC_COHESION_SHARE : 1);
      [ax, ay] = addSteer(ax, ay, fish, sumX / count - fish.x, sumY / count - fish.y, cohesion);
    }
    if (awayX !== 0 || awayY !== 0) {
      // Separation: do not bump into anyone.
      [ax, ay] = addSteer(ax, ay, fish, awayX, awayY, SEPARATION_WEIGHT);
    }

    // --- Lost? Swim back to the school (not while still panicking) ---
    const toCenterX = center.x - fish.x;
    const toCenterY = center.y - fish.y;
    if (!panicking && toCenterX * toCenterX + toCenterY * toCenterY > REGROUP_DISTANCE * REGROUP_DISTANCE) {
      [ax, ay] = addSteer(ax, ay, fish, toCenterX, toCenterY, REGROUP_WEIGHT);
    }

    // --- Drift toward the school's goal ---
    const goal = fish.school.goal;
    if (goal) {
      [ax, ay] = addSteer(ax, ay, fish, goal.x - fish.x, goal.y - fish.y, WANDER_WEIGHT);
    }

    // --- Stay in the sunlight layer (soft, stronger near the limit) ---
    if (fish.y < this.top + LIMIT_MARGIN) {
      ay += LIMIT_FORCE * Math.min(1, (this.top + LIMIT_MARGIN - fish.y) / LIMIT_MARGIN);
    } else if (fish.y > this.bottom - LIMIT_MARGIN) {
      ay -= LIMIT_FORCE * Math.min(1, (fish.y - (this.bottom - LIMIT_MARGIN)) / LIMIT_MARGIN);
    }
    // --- Turn away from the left and right edges of the world ---
    if (fish.x < EDGE_MARGIN) {
      ax += EDGE_FORCE * (EDGE_MARGIN - fish.x) / EDGE_MARGIN;
    } else if (fish.x > this.worldWidth - EDGE_MARGIN) {
      ax -= EDGE_FORCE * (fish.x - (this.worldWidth - EDGE_MARGIN)) / EDGE_MARGIN;
    }

    // --- Run away from player fish ---
    for (const player of players) {
      const offX = fish.x - player.x;
      const offY = fish.y - player.y;
      const distance = Math.hypot(offX, offY);
      if (distance >= player.radius) continue;
      // 1 right next to the player, 0 at the edge of the scare radius.
      const closeness = 1 - distance / player.radius;
      const awayLength = distance || 1;
      ax += (offX / awayLength) * MAX_FORCE * player.weight * closeness;
      ay += (offY / awayLength) * MAX_FORCE * player.weight * closeness;
      fish.panicUntil = time + PANIC_MS;
    }

    // --- Move ---
    const boost = time < fish.panicUntil ? PANIC_SPEED_BOOST : 1;
    let vx = fish.vx + ax * seconds;
    let vy = fish.vy + ay * seconds;
    let speed = Math.hypot(vx, vy);
    speed = Math.min(fish.maxSpeed * boost, Math.max(MIN_SPEED, speed));

    // Limit how fast it can turn, so it swims in curves.
    const oldAngle = Math.atan2(fish.vy, fish.vx);
    let turn = Math.atan2(vy, vx) - oldAngle;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    const maxTurn = MAX_TURN_RATE * boost * seconds;
    const angle = oldAngle + Math.max(-maxTurn, Math.min(maxTurn, turn));
    vx = Math.cos(angle) * speed;
    vy = Math.sin(angle) * speed;

    fish.vx = vx;
    fish.vy = vy;
    fish.x = Math.min(this.worldWidth, Math.max(0, fish.x + vx * seconds));
    // Never above the water (the soft force keeps them lower anyway).
    fish.y = Math.min(this.worldHeight, Math.max(SURFACE_GAP, fish.y + vy * seconds));
  }

  // Puts the sprite where the sardine is, facing and tilted the right way.
  draw(fish, seconds) {
    const speed = Math.hypot(fish.vx, fish.vy);
    // Only change the facing when clearly swimming sideways, so a sardine
    // swimming straight up does not flip back and forth.
    if (Math.abs(fish.vx) > 2) fish.facingLeft = fish.vx < 0;

    // Tilt, like the clownfish (see Player.js): nose up when swimming up.
    const upDown = speed > 0 ? fish.vy / speed : 0;
    const targetTilt = (fish.facingLeft ? -upDown : upDown) * TILT_MAX_DEGREES;
    fish.tilt += (targetTilt - fish.tilt) * (1 - Math.exp(-seconds / TILT_SOFTNESS_SECONDS));

    // Faster swimming = faster tail beat.
    fish.sprite.anims.timeScale = fish.animationSpeed * (0.6 + 0.6 * Math.min(1.5, speed / MAX_SPEED));

    // Same depth fade as the other fish in the water (see depthFade.js).
    // In the sunlight layer this is barely visible.
    const look = depthFade(fish.y, this.worldHeight, MIN_VISIBILITY_OTHER_FISH);
    fish.sprite
      .setPosition(fish.x, fish.y)
      .setFlipX(!fish.facingLeft) // the picture faces left
      .setAngle(fish.tilt)
      .setTint(look.tint)
      .setAlpha(look.alpha);
  }

  // ---------- Debug view ----------

  // B toggles the debug view. Not on touch screens, and not while typing
  // (in the chat box or the login popup).
  toggleDebug(event) {
    if (event.key !== 'b' && event.key !== 'B') return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (isTouchMode()) return;
    debugVisible = !debugVisible;
  }

  drawDebug(players) {
    const graphics = this.debug;
    graphics.clear();
    if (!debugVisible || isTouchMode()) return;

    // Each sardine: its neighbour radius (faint) and a direction arrow.
    for (const school of this.schools) {
      if (school.far) continue;
      for (const fish of school.fish) {
        graphics.lineStyle(1, DEBUG_SARDINE_COLOR, 0.15);
        graphics.strokeCircle(fish.x, fish.y, NEIGHBOUR_RADIUS);
        // The arrow: half a second of movement long.
        const endX = fish.x + fish.vx * 0.5;
        const endY = fish.y + fish.vy * 0.5;
        const angle = Math.atan2(fish.vy, fish.vx);
        graphics.lineStyle(1, DEBUG_SARDINE_COLOR, 0.9);
        graphics.lineBetween(fish.x, fish.y, endX, endY);
        graphics.lineBetween(endX, endY, endX - Math.cos(angle - 0.5) * 4, endY - Math.sin(angle - 0.5) * 4);
        graphics.lineBetween(endX, endY, endX - Math.cos(angle + 0.5) * 4, endY - Math.sin(angle + 0.5) * 4);
      }
    }
    // Each player fish: its scare radius right now (bigger when fast).
    for (const player of players) {
      graphics.lineStyle(1, DEBUG_SCARE_COLOR, 0.8);
      graphics.strokeCircle(player.x, player.y, player.radius);
    }
  }
}

// ---------- Small helpers ----------

// Adds one boids rule to the steering (ax, ay). The rule says which way the
// sardine WANTS to swim (wantX, wantY): it then wants to swim that way at
// full speed, and steers from its current speed toward that, at most
// MAX_FORCE, times `weight`. Returns the new [ax, ay].
function addSteer(ax, ay, fish, wantX, wantY, weight) {
  const length = Math.hypot(wantX, wantY);
  if (length === 0) return [ax, ay];
  let steerX = (wantX / length) * fish.maxSpeed - fish.vx;
  let steerY = (wantY / length) * fish.maxSpeed - fish.vy;
  const steerLength = Math.hypot(steerX, steerY);
  if (steerLength > MAX_FORCE) {
    steerX = (steerX / steerLength) * MAX_FORCE;
    steerY = (steerY / steerLength) * MAX_FORCE;
  }
  return [ax + steerX * weight, ay + steerY * weight];
}

// The middle of a school.
function schoolCenter(school) {
  let x = 0;
  let y = 0;
  for (const fish of school.fish) {
    x += fish.x;
    y += fish.y;
  }
  return { x: x / school.fish.length, y: y / school.fish.length };
}

// One number for a grid square (the world is far smaller than 100,000 squares wide).
function gridKey(cellX, cellY) {
  return cellX * 100_000 + cellY;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
