// Keeps the Phaser canvas the same size as its container (the whole screen).
// Phaser checks the size by itself, but on phones it often misses the change
// after a rotation, and the canvas keeps its old size. So we listen to several
// events and tell Phaser to re-measure whenever any of them fires.

// Phones report the new size a little after the rotate event fires,
// so we check once more after this delay (in milliseconds).
const LATE_CHECK_DELAY_MS = 200;

// Starts watching. Returns a function that stops watching.
export function watchScreenSize(game, container) {
  let lateCheckTimer = null;

  // Makes Phaser re-measure the container, if its size really changed.
  function checkSize() {
    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    // Size 0 happens while the page is hidden. Resizing to 0 would break the camera.
    if (width === 0 || height === 0) return;

    const scale = game.scale;
    if (width === scale.gameSize.width && height === scale.gameSize.height) return;

    // In RESIZE mode, Phaser takes the canvas size from the parent size.
    // getParentBounds() reads the new parent size, and refresh() applies it.
    // refresh() also fires the 'resize' event, which makes WorldScene
    // recalculate the camera zoom.
    scale.getParentBounds();
    scale.refresh();
  }

  // Checks now, and once more a bit later (see LATE_CHECK_DELAY_MS).
  function onSizeMaybeChanged() {
    checkSize();
    clearTimeout(lateCheckTimer);
    lateCheckTimer = setTimeout(checkSize, LATE_CHECK_DELAY_MS);
  }

  // ResizeObserver: fires when the container itself changes size, for any
  // reason (window resize, rotation, the phone's address bar hiding or showing).
  // It is the most reliable of these.
  const observer = new ResizeObserver(onSizeMaybeChanged);
  observer.observe(container);

  // window "resize": the classic event. Some older browsers have no ResizeObserver.
  window.addEventListener('resize', onSizeMaybeChanged);

  // "orientationchange": fires when a phone rotates. Some phones fire it
  // before the size is updated, which is why we also do the late check.
  window.addEventListener('orientationchange', onSizeMaybeChanged);

  // visualViewport "resize": fires when the VISIBLE area changes, for example
  // when the address bar or the on-screen keyboard opens or closes on a phone.
  // window "resize" does not always fire for these.
  window.visualViewport?.addEventListener('resize', onSizeMaybeChanged);

  // Run once at the start, in case the size changed before we began watching.
  onSizeMaybeChanged();

  return function stopWatching() {
    clearTimeout(lateCheckTimer);
    observer.disconnect();
    window.removeEventListener('resize', onSizeMaybeChanged);
    window.removeEventListener('orientationchange', onSizeMaybeChanged);
    window.visualViewport?.removeEventListener('resize', onSizeMaybeChanged);
  };
}
