// The box where the player types a chat message.
// It is a normal HTML <input>, because only real inputs open the phone
// keyboard and the Chinese input method properly.
//
//   PC:    Enter opens it, Enter sends, Esc closes.
//   Phone: the chat button (bottom-right) opens it, the keyboard's send key sends.
//   Both:  it closes after each send, and when the player taps or clicks the game.
//
// It also shows short notices from the server ("You are sending messages too fast").

import { CHAT_MAX_CHARS } from '../../shared/protocol.js';
import { onTouchModeChange } from './touchMode.js';

// Show the "72/80" counter from this many characters on.
const COUNTER_FROM = 60;

// How long a notice stays on screen.
const NOTICE_MS = 3000;

export class ChatInput {
  // onSend(text):        the player sent a message (already trimmed, never empty)
  // onOpenChange(open):  the box opened or closed (used to stop movement)
  constructor({ onSend, onOpenChange }) {
    this.onSend = onSend;
    this.onOpenChange = onOpenChange;

    this.bar = document.getElementById('chat-bar');
    this.input = document.getElementById('chat-input');
    this.counter = document.getElementById('chat-counter');
    this.chatButton = document.getElementById('chat-button');
    this.notice = document.getElementById('chat-notice');
    this.game = document.getElementById('game');

    this.isOpen = false;
    this.noticeTimer = null;
    // The browser's own limit. It counts UTF-16 units, so an emoji counts as 2.
    // The server counts real characters, so this is never more than the server allows.
    this.input.maxLength = CHAT_MAX_CHARS;

    // We keep every listener in a list, so destroy() can remove them all.
    this.listeners = [];
    this.listen(window, 'keydown', (event) => this.onWindowKeyDown(event));
    this.listen(this.input, 'keydown', (event) => this.onInputKeyDown(event));
    this.listen(this.input, 'input', () => this.updateCounter());
    this.listen(this.bar, 'submit', (event) => this.onSubmit(event));
    this.listen(this.chatButton, 'click', () => this.open());
    // Tapping or clicking the game closes the box.
    this.listen(this.game, 'pointerdown', () => this.close());

    // When the phone keyboard opens, the "visual viewport" (the part of the
    // page you can see) gets smaller. We move the box up so it stays visible.
    if (window.visualViewport) {
      this.listen(window.visualViewport, 'resize', () => this.positionAboveKeyboard());
      this.listen(window.visualViewport, 'scroll', () => this.positionAboveKeyboard());
    }

    // The chat button only appears on touch devices.
    this.stopWatchingTouchMode = onTouchModeChange((isTouch) => {
      this.chatButton.hidden = !isTouch;
    });
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.listeners.push([target, type, handler]);
  }

  // Opens the box and puts the cursor in it.
  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.bar.hidden = false;
    this.updateCounter();
    this.positionAboveKeyboard();
    // On phones, focus() must happen right inside the tap, or the keyboard
    // will not open. open() is called directly from the click, so this works.
    this.input.focus();
    this.onOpenChange(true);
  }

  // Closes the box and hides the phone keyboard.
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.value = '';
    this.input.blur();
    this.bar.hidden = true;
    this.onOpenChange(false);
  }

  // Shows a short message above the chat box for a few seconds.
  showNotice(text) {
    this.notice.textContent = text;
    this.notice.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice.hidden = true;
    }, NOTICE_MS);
  }

  // Enter anywhere in the game opens the box.
  onWindowKeyDown(event) {
    if (this.isOpen || event.key !== 'Enter') return;
    // Ignore Enter while typing in any other text box.
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // preventDefault also matters when a button has focus (for example after
    // clicking "Log out" or "Chat ▾"): without it, Enter would press that
    // button again instead of opening the chat.
    event.preventDefault();
    this.open();
  }

  onInputKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    // When typing Chinese, Enter often CONFIRMS the chosen characters.
    // That Enter must not send the message. While the input method is still
    // working, isComposing is true (Safari uses key code 229 instead).
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) {
      event.preventDefault();
    }
  }

  // The form was sent (Enter on PC, or the send key on a phone keyboard).
  onSubmit(event) {
    // Stop the browser from reloading the page (the normal form behavior).
    event.preventDefault();
    const text = this.input.value.trim();
    // Never send empty messages. Enter on an empty box just closes it.
    if (text) {
      this.onSend(text);
    }
    this.close();
  }

  // Shows "72/80" when the text is close to the limit.
  updateCounter() {
    const count = Array.from(this.input.value).length;
    this.counter.hidden = count < COUNTER_FROM;
    this.counter.textContent = `${count}/${CHAT_MAX_CHARS}`;
  }

  // Keeps the chat box just above the phone keyboard.
  // On iPhone the keyboard covers the page instead of shrinking it, so a box
  // fixed to the bottom would be hidden behind the keyboard. The visual
  // viewport tells us how much of the page is really visible.
  positionAboveKeyboard() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    // How much of the page bottom is covered (by the keyboard, usually).
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    this.bar.style.setProperty('--keyboard-height', `${covered}px`);
    this.notice.style.setProperty('--keyboard-height', `${covered}px`);
  }

  // Removes all listeners and hides everything (on logout).
  destroy() {
    this.close();
    for (const [target, type, handler] of this.listeners) {
      target.removeEventListener(type, handler);
    }
    this.listeners = [];
    this.stopWatchingTouchMode();
    clearTimeout(this.noticeTimer);
    this.notice.hidden = true;
    this.chatButton.hidden = true;
  }
}
