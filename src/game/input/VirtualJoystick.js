// A simple on-screen joystick for touch devices.
// It is made of HTML elements (not Phaser objects), so:
//   - CSS keeps it in the bottom-left corner after a resize or rotation
//   - the camera zoom does not change its size
// It only reports a direction. Controls.js decides what to do with it.

// Small pushes near the center are ignored, so a resting thumb does not
// make the player slowly drift.
const DEAD_ZONE = 0.2;

export class VirtualJoystick {
  constructor() {
    this.base = document.createElement('div');
    this.base.className = 'joystick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    // Current direction. x and y go from -1 to 1.
    this.vector = { x: 0, y: 0 };

    // The id of the finger using the joystick, so other fingers
    // (for example a second thumb) do not move it.
    this.pointerId = null;

    // Bind once, so we can remove the same functions later.
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    // Pointer events work for touch, pen and mouse.
    this.base.addEventListener('pointerdown', this.onPointerDown);
    this.base.addEventListener('pointermove', this.onPointerMove);
    this.base.addEventListener('pointerup', this.onPointerUp);
    this.base.addEventListener('pointercancel', this.onPointerUp);
  }

  onPointerDown(event) {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    // Keep getting move events for this finger even if it slides
    // outside the joystick circle.
    this.base.setPointerCapture(event.pointerId);
    this.updateFromPointer(event);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (event.pointerId !== this.pointerId) return;
    this.updateFromPointer(event);
  }

  onPointerUp(event) {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = '';
  }

  // Works out the direction from where the finger is.
  updateFromPointer(event) {
    // Read the position every time, so it is still right after a resize.
    const rect = this.base.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = event.clientX - (rect.left + radius);
    let dy = event.clientY - (rect.top + radius);

    // Keep the knob inside the circle.
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

    const strength = Math.min(distance, radius) / radius;
    if (strength < DEAD_ZONE) {
      this.vector = { x: 0, y: 0 };
    } else {
      this.vector = { x: dx / radius, y: dy / radius };
    }
  }

  // Returns the current direction { x, y }.
  getVector() {
    return this.vector;
  }

  // Removes the joystick from the page.
  destroy() {
    this.base.remove();
  }
}
