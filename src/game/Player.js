// One fish in the ocean. Used for BOTH kinds of players:
//   - the local player: has physics, moved with move()
//   - remote players (from the network): no physics, moved with
//     setPosition() and showState() using the data the server sends
// The name label and chat bubble are HTML, drawn by src/ui/PlayerOverlay.js.
//
// Each fish is made of TWO objects:
//   - `sprite`: an invisible box at the fish's real position. It moves,
//     bumps into walls, and is what the camera and the name label follow.
//     (Named "sprite" because the rest of the game uses that name for
//     "the thing with the player's position".)
//   - `image`: the fish picture drawn on top. It bobs, wiggles its tail and
//     tilts. These are only for looks, so they never push the hit box into
//     a wall, shake the camera, or make the name label wobble.

import Phaser from 'phaser';
import { MOVE_SPEED, PLAYER_HITBOX, PLAYER_VISIBLE } from '../../shared/world.js';
import { depthFade, MIN_VISIBILITY_OWN_FISH, MIN_VISIBILITY_OTHER_FISH } from './depthFade.js';

// ---------- The picture ----------
// One frame, 44 x 26 px, facing LEFT (made by tools/make-fish-sprite.js).
const FISH_IMAGE_KEY = 'fish-clownfish';
const FISH_IMAGE_URL = 'assets/sprites/fish/clownfish.png';

// ---------- Name label position ----------
// Distance (in game pixels) from the fish's center up to the bottom of the
// name label: the top of the fish (13 px) plus a small gap.
// PlayerOverlay.js uses it to place the name and chat bubble.
export const LABEL_OFFSET_Y = PLAYER_VISIBLE.top + 3;

// ---------- Swimming (inertia) ----------
// The fish does not reach full speed at once, and glides when you let go,
// like in water. These are "about how many seconds" to get most of the way.
// The speed never goes above MOVE_SPEED, so the server's speed check still works.
const SPEED_UP_SECONDS = 0.3;
const SLOW_DOWN_SECONDS = 0.6;
// Below this speed (pixels per second), the fish counts as "not moving".
const STILL_SPEED = 6;

// ---------- Fake animation (one picture, moved in code) ----------
// Idle bob: a gentle up and down while floating.
const BOB_PIXELS = 1.5;
const BOB_SECONDS = 2.5; // one full up-and-down
// Tail kick: the fish gets a little longer and thinner, then shorter and
// fatter, a few times per second while swimming. Stronger when faster.
const KICK_AMOUNT = 0.07; // 7% squash/stretch at full speed
const KICKS_PER_SECOND = 4;
// Tilt: nose up when swimming up, nose down when swimming down.
const TILT_MAX_DEGREES = 15;
// How softly the tilt follows the movement (seconds), so it never snaps.
const TILT_SOFTNESS_SECONDS = 0.25;
// How softly a REMOTE fish's speed is worked out from its positions (seconds).
const REMOTE_SPEED_SOFTNESS_SECONDS = 0.15;

export class Player {
  // Queues the fish picture for loading. Call this in a scene's preload().
  static preload(scene) {
    scene.load.image(FISH_IMAGE_KEY, FISH_IMAGE_URL);
  }

  // options.physics: true for the local player. Remote fish do not need
  // physics, because the server tells us exactly where they are.
  // Only our OWN fish has physics, so that also decides how visible it stays
  // at the bottom (see depthFade.js).
  constructor(scene, x, y, { physics = true } = {}) {
    this.scene = scene;
    this.hasPhysics = physics;
    this.minVisibility = physics ? MIN_VISIBILITY_OWN_FISH : MIN_VISIBILITY_OTHER_FISH;

    // Which way the fish looks: 'left' or 'right'. Kept when it stops.
    this.facing = 'left';
    // True while swimming (sent to the server, used by remote fish).
    this.moving = false;

    // The invisible box at the real position. A "zone" is an invisible
    // game object; its size is the hit box (centered on x, y).
    const hitWidth = PLAYER_HITBOX.halfWidth * 2;
    const hitHeight = PLAYER_HITBOX.bottom - PLAYER_HITBOX.top;
    this.sprite = scene.add.zone(x, y, hitWidth, hitHeight);
    if (physics) {
      scene.physics.add.existing(this.sprite);
      // Stop at the physics world edges (set to the map, see WorldScene).
      this.sprite.body.setCollideWorldBounds(true);
    }

    // The fish picture.
    this.image = scene.add.image(x, y, FISH_IMAGE_KEY);

    // The movement the picture is animated from (pixels per second).
    this.velocity = { x: 0, y: 0 };
    // For remote fish: the last position, to work out their speed.
    this.lastX = x;
    this.lastY = y;
    // The current tilt, eased toward the target tilt.
    this.tilt = 0;
    // Start each fish's bob at a different moment, so a group of fish
    // does not bob in perfect step.
    this.bobOffset = Math.random() * BOB_SECONDS * 1000;

    // Draw the picture in "postupdate", which runs after physics has moved
    // the box, so the picture uses this frame's position.
    scene.events.on('postupdate', this.draw, this);

    // When the scene stops (on login/logout it restarts), clean up by itself.
    // Phaser destroys the box and the picture then, but it KEEPS the scene's
    // event listeners. Without this, draw() would keep running with a
    // destroyed box, throw an error, and stop the whole game loop.
    scene.events.once('shutdown', this.destroy, this);
    this.destroyed = false;
  }

  // Swims the local fish. `direction` is { x, y } with a length of 0 or 1
  // (Controls makes sure diagonal is not faster). `deltaMs` = frame time.
  move(direction, deltaMs) {
    const body = this.sprite.body;
    const seconds = Math.min(deltaMs, 100) / 1000; // ignore long pauses (hidden tab)
    const wantsToMove = direction.x !== 0 || direction.y !== 0;

    // Ease the speed toward the target speed. The formula keeps the feel
    // the same at any frame rate.
    const softness = wantsToMove ? SPEED_UP_SECONDS : SLOW_DOWN_SECONDS;
    const share = 1 - Math.exp(-seconds / softness);
    let vx = body.velocity.x + (direction.x * MOVE_SPEED - body.velocity.x) * share;
    let vy = body.velocity.y + (direction.y * MOVE_SPEED - body.velocity.y) * share;

    // Never faster than MOVE_SPEED (the server checks this).
    const speed = Math.hypot(vx, vy);
    if (speed > MOVE_SPEED) {
      vx = (vx / speed) * MOVE_SPEED;
      vy = (vy / speed) * MOVE_SPEED;
    }
    // Stop fully when very slow, so it does not creep forever.
    if (!wantsToMove && speed < STILL_SPEED) {
      vx = 0;
      vy = 0;
    }
    body.setVelocity(vx, vy);

    // Only change facing when there is left/right input. Swimming straight
    // up or down keeps the way the fish was looking.
    if (direction.x !== 0) {
      this.facing = direction.x > 0 ? 'right' : 'left';
    }
    this.moving = Math.hypot(vx, vy) >= STILL_SPEED;
  }

  // Sets facing and moving from the server (remote fish).
  showState(facing, moving) {
    if (facing === 'left' || facing === 'right') this.facing = facing;
    this.moving = moving;
  }

  // Puts the fish at a position (remote fish, and the welcome message).
  setPosition(x, y) {
    if (this.hasPhysics) {
      // For a physics object, reset() moves the body too and clears its
      // speed. Moving only the box would confuse the physics engine.
      this.sprite.body.reset(x, y);
    } else {
      this.sprite.setPosition(x, y);
    }
  }

  // Draws the picture at the box's position, with the fake animation.
  draw() {
    const seconds = Math.min(this.scene.game.loop.delta, 100) / 1000;
    const x = this.sprite.x;
    const y = this.sprite.y;

    // How fast is the fish going? The local fish knows its physics speed.
    // A remote fish only has positions, so we work it out from how far it
    // moved since the last frame (softened, so it does not flicker).
    if (this.hasPhysics) {
      this.velocity.x = this.sprite.body.velocity.x;
      this.velocity.y = this.sprite.body.velocity.y;
    } else if (seconds > 0) {
      const share = 1 - Math.exp(-seconds / REMOTE_SPEED_SOFTNESS_SECONDS);
      this.velocity.x += ((x - this.lastX) / seconds - this.velocity.x) * share;
      this.velocity.y += ((y - this.lastY) / seconds - this.velocity.y) * share;
    }
    this.lastX = x;
    this.lastY = y;

    // 0 = still, 1 = full speed.
    const speedShare = Math.min(1, Math.hypot(this.velocity.x, this.velocity.y) / MOVE_SPEED);
    const time = this.scene.time.now;

    // Idle bob: fades out while swimming.
    const bobPhase = ((time + this.bobOffset) / (BOB_SECONDS * 1000)) * Math.PI * 2;
    const bob = Math.sin(bobPhase) * BOB_PIXELS * (1 - speedShare);

    // Tail kick: stretch longer/thinner, then shorter/fatter.
    const kick = Math.sin((time / 1000) * KICKS_PER_SECOND * Math.PI * 2) * KICK_AMOUNT * speedShare;

    // Tilt. The picture faces left. In Phaser, a positive angle turns
    // clockwise, which lifts the LEFT end. So:
    //   facing left, swimming up (y speed < 0)   -> positive angle (nose up)
    //   facing right (picture flipped), swimming up -> negative angle (nose up)
    const upDown = Math.max(-1, Math.min(1, this.velocity.y / MOVE_SPEED));
    const targetTilt = (this.facing === 'left' ? -upDown : upDown) * TILT_MAX_DEGREES;
    this.tilt += (targetTilt - this.tilt) * (1 - Math.exp(-seconds / TILT_SOFTNESS_SECONDS));

    this.image.setPosition(x, y + bob);
    this.image.setFlipX(this.facing === 'right');
    this.image.setScale(1 + kick, 1 - kick);
    this.image.setAngle(this.tilt);
    // Fish lower on the screen are drawn in front of ones higher up.
    this.image.setDepth(y);

    // Deeper = darker and more see-through, blending into the water.
    // Uses the map height, so it still works after resizing the map in Tiled.
    let look = depthFade(y, this.scene.mapInfo.height, this.minVisibility);
    // Then the deep light: fish inside your light look normal again, and
    // every fish gets its glow (see DeepLight.js).
    if (this.scene.deepLight) {
      look = this.scene.deepLight.adjustFish(this, x, y, look);
    }
    this.image.setTint(look.tint);
    this.image.setAlpha(look.alpha);
  }

  // Removes the fish (for example when a remote player leaves).
  // Safe to call more than once (for example "leave", then the scene stopping).
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('postupdate', this.draw, this);
    this.scene.events.off('shutdown', this.destroy, this);
    this.scene.deepLight?.forget(this);
    this.sprite.destroy();
    this.image.destroy();
  }
}
