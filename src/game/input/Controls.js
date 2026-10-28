// Reads the player's input and turns it into one movement direction { x, y }.
// Keyboard (WASD + arrow keys) and the touch joystick both end up here,
// so the rest of the game only has one kind of input to handle.

import Phaser from 'phaser';
import { VirtualJoystick } from './VirtualJoystick.js';

const KeyCodes = Phaser.Input.Keyboard.KeyCodes;

export class Controls {
  constructor(scene) {
    // The second argument (false) means "do not capture these keys".
    // Captured keys cannot be typed into HTML text boxes, and we will need
    // W, A, S, D in the chat box later.
    this.keys = scene.input.keyboard.addKeys(
      {
        up: KeyCodes.UP,
        down: KeyCodes.DOWN,
        left: KeyCodes.LEFT,
        right: KeyCodes.RIGHT,
        w: KeyCodes.W,
        a: KeyCodes.A,
        s: KeyCodes.S,
        d: KeyCodes.D,
      },
      false,
    );

    // Always create the joystick. It shows or hides itself depending on
    // whether this is a touch device (see VirtualJoystick.js).
    this.joystick = new VirtualJoystick();

    // The joystick is HTML outside of Phaser, so we must remove it ourselves
    // when the scene stops or the game is destroyed (for example on logout).
    scene.events.once('shutdown', this.destroy, this);
    scene.events.once('destroy', this.destroy, this);
  }

  // Returns the direction to move in: { x, y } with a length of 0 or 1.
  // x: -1 = left, 1 = right. y: -1 = up, 1 = down (screen coordinates).
  getDirection() {
    const keys = this.keys;
    let x = 0;
    let y = 0;

    if (keys.left.isDown || keys.a.isDown) x -= 1;
    if (keys.right.isDown || keys.d.isDown) x += 1;
    if (keys.up.isDown || keys.w.isDown) y -= 1;
    if (keys.down.isDown || keys.s.isDown) y += 1;

    // If no key is pressed, use the joystick.
    if (x === 0 && y === 0 && this.joystick) {
      ({ x, y } = this.joystick.getVector());
    }

    // Normalize: make the length exactly 1.
    // Without this, pressing right + down gives length 1.41,
    // so walking diagonally would be 41% faster.
    const length = Math.hypot(x, y);
    if (length === 0) {
      return { x: 0, y: 0 };
    }
    return { x: x / length, y: y / length };
  }

  destroy() {
    if (this.joystick) {
      this.joystick.destroy();
      this.joystick = null;
    }
  }
}
