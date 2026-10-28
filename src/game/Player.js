// One character in the world: the sprite, its animations and the name label.
// Right now only the local player uses it. Later, players that come from the
// network can use the same class: call playAnimationFor() with their movement
// instead of move().

import Phaser from 'phaser';

// ---------- Sprite sheet layout ----------
// Measured from the PNG files: each file is 768 x 80 pixels,
// a horizontal strip of 8 frames, each 96 x 80.
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 80;
const FRAME_COUNT = 8;

// ---------- Animation speed (frames per second) ----------
const IDLE_FRAME_RATE = 8;
const RUN_FRAME_RATE = 12;

// ---------- Movement ----------
// Speed in game pixels per second.
const MOVE_SPEED = 80;

// ---------- Hit box ----------
// The character only fills a small part of the 96 x 80 frame
// (about 18 x 34 pixels, with the feet near y = 58).
// We use a small box around the feet, so the player can walk "behind"
// things later, as in most top-down games.
const BODY_WIDTH = 14;
const BODY_HEIGHT = 8;
const BODY_OFFSET_X = (FRAME_WIDTH - BODY_WIDTH) / 2;
const BODY_OFFSET_Y = 51;

// ---------- Name label ----------
// Distance from the sprite center up to the bottom of the name label.
// The head top is about 16 pixels above the center, so 18 leaves a small gap.
// Later the chat bubble will go above this label.
const LABEL_GAP = 18;
// Labels are drawn above every character.
const LABEL_DEPTH = 1_000_000;
const LABEL_STYLE = {
  fontFamily: 'Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
  fontSize: '10px',
  color: '#ffffff',
  // A dark outline keeps the name readable on any ground color.
  stroke: '#000000',
  strokeThickness: 3,
};

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

  constructor(scene, x, y, name) {
    this.scene = scene;

    // The direction the player last moved in. Used to pick the idle animation.
    this.facing = 'down';

    this.sprite = scene.physics.add.sprite(x, y, 'player-idle-down');
    this.sprite.body.setSize(BODY_WIDTH, BODY_HEIGHT, false);
    this.sprite.body.setOffset(BODY_OFFSET_X, BODY_OFFSET_Y);
    this.sprite.play('idle-down');

    // Origin (0.5, 1) = the label's bottom center sits at its position.
    this.label = scene.add.text(x, y - LABEL_GAP, name, LABEL_STYLE).setOrigin(0.5, 1);
    this.label.setDepth(LABEL_DEPTH);

    // Move the label in "postupdate", which runs after physics has moved
    // the sprite. If we did it in update(), the label would lag one frame behind.
    scene.events.on('postupdate', this.syncLabel, this);
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
    if (isMoving) {
      this.facing = pickFacing(direction);
    }
    const key = `${isMoving ? 'run' : 'idle'}-${this.facing}`;
    // true = do nothing if this animation is already playing.
    // Without it, the animation would restart from frame 0 every frame.
    this.sprite.play(key, true);
  }

  // Keeps the label above the head and sorts the sprite by height on screen.
  syncLabel() {
    this.label.setPosition(this.sprite.x, this.sprite.y - LABEL_GAP);
    // Characters lower on the screen are drawn in front of ones higher up.
    this.sprite.setDepth(this.sprite.y);
  }

  // Sets how sharp the label text is drawn. Use the camera zoom,
  // so one text pixel matches one screen pixel and the text is not blurry.
  setLabelResolution(resolution) {
    this.label.setResolution(resolution);
  }

  // Removes the player from the scene (for example when a network player leaves).
  destroy() {
    this.scene.events.off('postupdate', this.syncLabel, this);
    this.sprite.destroy();
    this.label.destroy();
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
