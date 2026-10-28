// Decides if this looks like a touch device (phone or tablet).
// The joystick and the chat button use it to know when to show themselves.
//
// We do not decide only once at page load, because the answer can change:
// Chrome device mode can switch from desktop to phone, and a laptop can have
// both a mouse and a touch screen.

// "coarse" pointer = the main input is a finger, not a mouse.
const touchQuery = window.matchMedia('(pointer: coarse)');

// True after the first touch anywhere on the page. Some touch devices still
// report a "fine" pointer, so a real touch is the surest sign.
let touchSeen = false;

// Functions to call when the answer changes.
const listeners = new Set();

function notifyAll() {
  const isTouch = isTouchMode();
  for (const listener of listeners) listener(isTouch);
}

// The media query's "change" event fires when the main input switches
// between mouse and finger.
touchQuery.addEventListener('change', notifyAll);

// "capture" makes us hear the touch even if another element stops the event.
window.addEventListener(
  'touchstart',
  () => {
    if (touchSeen) return;
    touchSeen = true;
    notifyAll();
  },
  { capture: true, passive: true },
);

// True if we should show touch controls.
export function isTouchMode() {
  return touchQuery.matches || touchSeen;
}

// Calls `listener(isTouch)` now and every time the answer changes.
// Returns a function that stops listening.
export function onTouchModeChange(listener) {
  listeners.add(listener);
  listener(isTouchMode());
  return () => listeners.delete(listener);
}
