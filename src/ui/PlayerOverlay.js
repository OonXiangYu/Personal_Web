// Name labels and chat bubbles above players, drawn as HTML on top of the game.
//
// Why HTML and not Phaser text?
// Phaser draws the game canvas at "CSS pixel" size. On a phone with a 3x
// screen, the browser stretches every canvas pixel 3 times, so text drawn
// inside the canvas looks blurry or blocky, and a higher Phaser text
// resolution cannot fix it. HTML text is drawn by the browser at the screen's
// full sharpness, at every camera zoom, for every language. CSS also gives us
// line wrapping, "…" after 3 lines, the bubble tail and the fade for free.
//
// How it follows the players:
// After Phaser draws each frame, WorldScene calls update(). We read the same
// sprite position and camera view that Phaser just used, turn them into
// screen pixels, and move each label there. Because this happens in the same
// frame, the labels never lag behind the players.
//
// The layer has `pointer-events: none` (see style.css), so taps and clicks go
// straight through to the game and the joystick.

import { LABEL_OFFSET_Y } from '../game/Player.js';

// Hide labels whose anchor point is this far (in screen pixels) outside the
// screen. A small margin keeps a label visible while its player is still
// partly on screen.
const OFFSCREEN_MARGIN = 40;

// How long a bubble stays: about 3 s for short messages, up to 7 s for long ones.
const BUBBLE_BASE_MS = 2500;
const BUBBLE_MS_PER_CHARACTER = 60;
const BUBBLE_MIN_MS = 3000;
const BUBBLE_MAX_MS = 7000;
// The fade at the end. Must match the CSS transition on .chat-bubble.
const BUBBLE_FADE_MS = 400;

export class PlayerOverlay {
  constructor(container) {
    this.container = container;
    // Player id → { root, bubble, bubbleText, name, x, y, visible, timers }
    this.tags = new Map();
  }

  // Adds a name label for a player.
  // isLocal: true for our own player (its name gets a different color).
  addPlayer(id, name, { isLocal = false } = {}) {
    this.removePlayer(id);

    const root = document.createElement('div');
    root.className = isLocal ? 'player-tag is-local' : 'player-tag';
    // Start hidden. update() shows it once it knows where to put it.
    root.hidden = true;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.hidden = true;
    const bubbleText = document.createElement('div');
    bubbleText.className = 'chat-bubble-text';
    bubble.appendChild(bubbleText);

    const nameLabel = document.createElement('div');
    nameLabel.className = 'player-name';
    // textContent, never innerHTML: a name can never become HTML or a script.
    nameLabel.textContent = name;

    // The bubble comes first, so it sits ABOVE the name.
    root.append(bubble, nameLabel);
    this.container.appendChild(root);

    this.tags.set(id, {
      root,
      bubble,
      bubbleText,
      // The last position and visibility we wrote, so we only touch the
      // page when something changed (changing styles has a cost).
      x: null,
      y: null,
      visible: false,
      fadeTimer: null,
      hideTimer: null,
    });
  }

  // Removes a player's label and bubble.
  removePlayer(id) {
    const tag = this.tags.get(id);
    if (!tag) return;
    clearTimeout(tag.fadeTimer);
    clearTimeout(tag.hideTimer);
    tag.root.remove();
    this.tags.delete(id);
  }

  // Removes everyone (for example on logout).
  clear() {
    for (const id of [...this.tags.keys()]) {
      this.removePlayer(id);
    }
  }

  // Shows a chat bubble above a player. Replaces their old bubble, if any.
  showBubble(id, text) {
    const tag = this.tags.get(id);
    if (!tag) return;

    // Stop the old bubble's timers, so they do not hide the new one.
    clearTimeout(tag.fadeTimer);
    clearTimeout(tag.hideTimer);

    // textContent, never innerHTML: chat can never become HTML or a script.
    tag.bubbleText.textContent = text;
    tag.bubble.hidden = false;
    tag.bubble.classList.remove('is-fading');

    const duration = bubbleDuration(text);
    // Start fading a little before the end, then hide.
    tag.fadeTimer = setTimeout(() => tag.bubble.classList.add('is-fading'), duration - BUBBLE_FADE_MS);
    tag.hideTimer = setTimeout(() => {
      tag.bubble.hidden = true;
      tag.bubble.classList.remove('is-fading');
    }, duration);
  }

  // Moves every label to its player. Call once per frame, after Phaser has drawn.
  //   camera:    the Phaser camera that drew the world
  //   getSprite: function (id) → the player's sprite, or null
  update(camera, getSprite) {
    const view = camera.worldView;
    const zoom = camera.zoom;

    for (const [id, tag] of this.tags) {
      const sprite = getSprite(id);
      if (!sprite) {
        this.setVisible(tag, false);
        continue;
      }

      // World position of the label anchor (just above the head),
      // turned into screen pixels. Rounded, like Phaser rounds the sprite
      // (roundPixels), so label and sprite stay exactly in line.
      const x = Math.round((sprite.x - view.x) * zoom);
      const y = Math.round((sprite.y - LABEL_OFFSET_Y - view.y) * zoom);

      // Off screen? Hide it, so it is not drawn (or clickable, or scrollable)
      // outside the view.
      const onScreen =
        x > -OFFSCREEN_MARGIN &&
        x < camera.width + OFFSCREEN_MARGIN &&
        y > -OFFSCREEN_MARGIN &&
        y < camera.height + OFFSCREEN_MARGIN;
      this.setVisible(tag, onScreen);
      if (!onScreen) continue;

      if (x !== tag.x || y !== tag.y) {
        tag.x = x;
        tag.y = y;
        // The first translate moves the anchor to (x, y). The second one
        // centers the label horizontally and puts its bottom on that point.
        tag.root.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    }
  }

  setVisible(tag, visible) {
    if (tag.visible === visible) return;
    tag.visible = visible;
    tag.root.hidden = !visible;
  }
}

// How long to show a bubble for this text, in milliseconds.
function bubbleDuration(text) {
  const characters = Array.from(text).length;
  const ms = BUBBLE_BASE_MS + characters * BUBBLE_MS_PER_CHARACTER;
  return Math.min(BUBBLE_MAX_MS, Math.max(BUBBLE_MIN_MS, ms));
}
