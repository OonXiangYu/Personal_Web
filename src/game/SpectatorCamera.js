// The camera for logged-out visitors (behind the login form).
// It slowly drifts around the map. When other players are online, it
// sometimes follows one of them for a while, then switches.
// It is meant to be calm: slow speed, soft starts and stops, and it never
// shows anything outside the camera area (the world plus the strip of sky).

// Drifting speed, in game pixels per second.
const DRIFT_SPEED = 25;
// Near the target the camera slows down, so it does not stop with a jerk.
// Within this distance (game pixels) it starts slowing.
const SLOW_DOWN_DISTANCE = 80;
// But never slower than this part of the full speed, so it always arrives.
const MIN_SPEED_SHARE = 0.2;

// How softly the camera follows a player: about how many seconds it takes
// to catch up most of the way. Bigger = softer.
const FOLLOW_SOFTNESS_SECONDS = 1.2;

// How long to keep one plan (drift or follow), in milliseconds.
const PLAN_MIN_MS = 15_000;
const PLAN_MAX_MS = 25_000;
// When players are online, how often to follow one (0.7 = 7 times in 10).
const FOLLOW_CHANCE = 0.7;

export class SpectatorCamera {
  // scene:         the WorldScene
  // area:          { x, y, width, height } the camera may show: the same
  //                camera area as the player camera (the world plus the
  //                strip of sky above it, see WorldScene)
  // remotePlayers: the RemotePlayers list (to find someone to follow)
  // start:         { x, y } to start from (for example where the player
  //                camera was before logout), or null for the middle
  constructor(scene, area, remotePlayers, start) {
    this.scene = scene;
    this.camera = scene.cameras.main;
    this.area = area;
    this.remotePlayers = remotePlayers;

    this.center = start ? { ...start } : { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    this.followId = null; // the player we follow, or null while drifting
    this.target = this.randomPoint();
    this.nextPlanAt = 0; // pick a plan on the first update
  }

  // Call every frame. `deltaMs` = time since the last frame.
  update(time, deltaMs) {
    const seconds = Math.min(deltaMs, 100) / 1000; // ignore long pauses (hidden tab)

    if (time >= this.nextPlanAt) {
      this.choosePlan(time);
    }

    const followed = this.followId ? this.remotePlayers.getSprite(this.followId) : null;
    if (this.followId && !followed) {
      // The player we followed left. Drift instead.
      this.followId = null;
      this.target = this.randomPoint();
    }

    if (followed) {
      // Soft follow: each frame, close part of the gap. The formula keeps the
      // softness the same at any frame rate.
      const share = 1 - Math.exp(-seconds / FOLLOW_SOFTNESS_SECONDS);
      this.center.x += (followed.x - this.center.x) * share;
      this.center.y += (followed.y - this.center.y) * share;
    } else {
      this.driftTowardTarget(seconds);
    }

    // Never show outside the camera area.
    this.center = this.keepViewInsideArea(this.center);
    this.camera.centerOn(this.center.x, this.center.y);
  }

  // Moves slowly toward the drift target; picks a new one on arrival.
  driftTowardTarget(seconds) {
    const dx = this.target.x - this.center.x;
    const dy = this.target.y - this.center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) {
      this.target = this.randomPoint();
      return;
    }
    // Full speed far away, slower near the target (but never stopping).
    const share = Math.max(MIN_SPEED_SHARE, Math.min(1, distance / SLOW_DOWN_DISTANCE));
    const step = Math.min(distance, DRIFT_SPEED * share * seconds);
    this.center.x += (dx / distance) * step;
    this.center.y += (dy / distance) * step;
  }

  // Decides what to do for the next 15–25 seconds: follow a random online
  // player, or drift to a random spot.
  choosePlan(time) {
    const ids = this.remotePlayers.ids();
    if (ids.length > 0 && Math.random() < FOLLOW_CHANCE) {
      this.followId = ids[Math.floor(Math.random() * ids.length)];
    } else {
      this.followId = null;
      this.target = this.randomPoint();
    }
    this.nextPlanAt = time + PLAN_MIN_MS + Math.random() * (PLAN_MAX_MS - PLAN_MIN_MS);
  }

  // A random point where the camera can be centred without showing outside its area.
  randomPoint() {
    const range = this.safeRange();
    return {
      x: range.minX + Math.random() * (range.maxX - range.minX),
      y: range.minY + Math.random() * (range.maxY - range.minY),
    };
  }

  // Moves a camera centre so the whole view stays inside the camera area.
  // (The camera's own bounds would stop it too, but then our `center` would
  // drift away from where the camera really is, and following would lag.)
  keepViewInsideArea(point) {
    const range = this.safeRange();
    return {
      x: Math.min(range.maxX, Math.max(range.minX, point.x)),
      y: Math.min(range.maxY, Math.max(range.minY, point.y)),
    };
  }

  // Where the camera centre may be: half a view away from every edge of the
  // area. (WorldScene picks a zoom at which the view always fits inside the
  // area, so this range is never empty.)
  // Worked out every time, because the zoom and screen size can change.
  safeRange() {
    const halfWidth = Math.min(this.camera.width / this.camera.zoom / 2, this.area.width / 2);
    const halfHeight = Math.min(this.camera.height / this.camera.zoom / 2, this.area.height / 2);
    const { x, y, width, height } = this.area;
    return {
      minX: x + halfWidth,
      maxX: x + width - halfWidth,
      minY: y + halfHeight,
      maxY: y + height - halfHeight,
    };
  }
}
