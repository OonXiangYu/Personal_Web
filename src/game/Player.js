// One character in the world: the sprite and its animations.
// The name label and chat bubble are HTML, drawn by src/ui/PlayerOverlay.js.
// Used for BOTH kinds of players:
//   - the local player: has physics, moved with move()
//   - remote players (from the network): no physics, moved with
//     setPosition() and showState() using the data the server sends

import Phaser from 'phaser';
import { MOVE_SPEED, PLAYER_FEET } from '../../shared/world.js';

// ---------- Sprite sheet layout ----------
// Measured from the PNG files: each file is 768 x 80 pixels,
// a horizontal strip of 8 frames, each 96 x 80.
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 80;
const FRAME_COUNT = 8;

// ---------- Animation speed (frames per second) ----------
const IDLE_FRAME_RATE = 8;
const RUN_FRAME_RATE = 12;

// ---------- Hit box ----------
// The character only fills a small part of the 96 x 80 frame.
// The physics body is a small box around the feet, so the player can walk
// "behind" things, as in most top-down games. Its size comes from
// shared/world.js, so the server checks walls with exactly the same box.
// (Offsets are measured from the frame's top-left; the sprite's center is
// the middle of the frame.)
const BODY_WIDTH = PLAYER_FEET.halfWidth * 2;
const BODY_HEIGHT = PLAYER_FEET.bottom - PLAYER_FEET.top;
const BODY_OFFSET_X = FRAME_WIDTH / 2 - PLAYER_FEET.halfWidth;
const BODY_OFFSET_Y = FRAME_HEIGHT / 2 + PLAYER_FEET.top;

// ---------- Name label position ----------
// Distance (in game pixels) from the sprite center up to the bottom of the
// name label. The head top is about 16 pixels above the center, so 18 leaves
// a small gap. PlayerOverlay.js uses it to place the name and chat bubble.
export const LABEL_OFFSET_Y = 18;

const SPRITE_FOLDER = 'assets/sprites/player';
const DIRECTIONS = ['down', 'left', 'right', 'up'];
const STATES = ['idle', 'run'];

export class Player {
  // Queues the sprite sheets for loading. Call this in a scene's preload().
  static preload(scene) {
    for (const state of STATES) {
      for (const direction of DIRECTIONS) {
        scene.load.spritesheet(
          `player-${state}-${direction}`,
          `${SPRITE_FOLDER}/${state}/${state}_${direction}.png`,
          { frameWidth: FRAME_WIDTH, frameHeight: FRAME_HEIGHT },
        );
      }
    }
  }

  // Makes the 8 animations: idle-down, idle-left, ..., run-up.
  // Animations belong to the whole game, so this only needs to run once.
  static createAnimations(scene) {
    for (const state of STATES) {
      for (const direction of DIRECTIONS) {
        const key = `${state}-${direction}`;
        if (scene.anims.exists(key)) continue;

        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers(`player-${state}-${direction}`, {
            start: 0,
            end: FRAME_COUNT - 1,
          }),
          frameRate: state === 'idle' ? IDLE_FRAME_RATE : RUN_FRAME_RATE,
          repeat: -1, // loop forever
        });
      }
    }
  }

  // options.physics: true for the local player. Remote players do not need
  // physics, because the server tells us exactly where they are.
  constructor(scene, x, y, { physics = true } = {}) {
    this.scene = scene;

    // The direction the player last moved in. Used to pick the idle animation.
    this.facing = 'down';
    // True while the run animation is playing.
    this.moving = false;

    if (physics) {
      this.sprite = scene.physics.add.sprite(x, y, 'player-idle-down');
      this.sprite.body.setSize(BODY_WIDTH, BODY_HEIGHT, false);
      this.sprite.body.setOffset(BODY_OFFSET_X, BODY_OFFSET_Y);
    } else {
      this.sprite = scene.add.sprite(x, y, 'player-idle-down');
    }
    this.sprite.play('idle-down');

    // Update the drawing order in "postupdate", which runs after physics
    // has moved the sprite, so it uses this frame's position.
    scene.events.on('postupdate', this.syncDepth, this);
  }

  // Moves the player. `direction` is { x, y } with a length of 0 or 1
  // (Controls already makes sure diagonal is not faster).
  move(direction) {
    this.sprite.setVelocity(direction.x * MOVE_SPEED, direction.y * MOVE_SPEED);
    this.playAnimationFor(direction);
  }

  // Picks the right animation for a movement direction.
  // Moving: run in that direction. Stopped: idle, facing the last direction.
  playAnimationFor(direction) {
    const isMoving = direction.x !== 0 || direction.y !== 0;
    const facing = isMoving ? pickFacing(direction) : this.facing;
    this.showState(facing, isMoving);
  }

  // Shows the run or idle animation for a facing direction.
  // Remote players call this directly with the values from the server.
  showState(facing, moving) {
    this.facing = facing;
    this.moving = moving;
    const key = `${moving ? 'run' : 'idle'}-${facing}`;
    // true = do nothing if this animation is already playing.
    // Without it, the animation would restart from frame 0 every frame.
    this.sprite.play(key, true);
  }

  // Puts the player at a position (used for remote players and the welcome message).
  setPosition(x, y) {
    if (this.sprite.body) {
      // For a physics sprite, reset() moves the body too and clears its
      // speed. Moving only the sprite would confuse the physics engine.
      this.sprite.body.reset(x, y);
    } else {
      this.sprite.setPosition(x, y);
    }
  }

  // Characters lower on the screen are drawn in front of ones higher up.
  syncDepth() {
    this.sprite.setDepth(this.sprite.y);
  }

  // Removes the player from the scene (for example when a network player leaves).
  destroy() {
    this.scene.events.off('postupdate', this.syncDepth, this);
    this.sprite.destroy();
  }
}

// Chooses one of the 4 directions from a movement vector.
// For diagonal movement, the bigger axis wins.
// If both are equal (exact diagonal), up/down wins.
function pickFacing(direction) {
  if (Math.abs(direction.x) > Math.abs(direction.y)) {
    return direction.x > 0 ? 'right' : 'left';
  }
  return direction.y > 0 ? 'down' : 'up';
}
