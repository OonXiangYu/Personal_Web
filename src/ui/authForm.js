// The HTML login / register popup that sits on top of the game.
// It checks the input, calls the API, and shows friendly error messages.
// When login works, it calls onLoggedIn({ token, user }).
// The player can close it (X button, Esc, or a click outside the card) to
// go on playing as a guest; then it calls onClose().

import { login, register } from './api.js';
import { checkNewUsername, checkPassword } from '../../shared/validate.js';

// Sets up the form and returns functions to show or hide it.
export function createAuthForm({ onLoggedIn, onClose }) {
  const screen = document.getElementById('auth-screen');
  const closeButton = document.getElementById('auth-close');
  const form = document.getElementById('auth-form');
  const loading = document.getElementById('auth-loading');
  const fields = document.getElementById('auth-fields');
  const usernameInput = document.getElementById('auth-username');
  const passwordInput = document.getElementById('auth-password');
  const confirmRow = document.getElementById('auth-confirm-row');
  const confirmInput = document.getElementById('auth-confirm');
  const errorText = document.getElementById('auth-error');
  const submitButton = document.getElementById('auth-submit');
  const switchButton = document.getElementById('auth-switch');

  // 'login' or 'register'. The same form is used for both.
  let mode = 'login';

  // Updates the texts and fields to match the current mode.
  function applyMode() {
    const isRegister = mode === 'register';
    confirmRow.hidden = !isRegister;
    submitButton.textContent = isRegister ? 'Create account' : 'Log in';
    switchButton.textContent = isRegister
      ? 'Already have an account? Log in'
      : 'No account? Create one';
    // Tells password managers whether to fill a saved password or make a new one.
    passwordInput.autocomplete = isRegister ? 'new-password' : 'current-password';
    showError('');
  }

  function showError(message) {
    errorText.textContent = message;
  }

  // Disables the buttons while we wait, so the player cannot send twice.
  function setBusy(busy) {
    submitButton.disabled = busy;
    switchButton.disabled = busy;
  }

  // Quick checks in the browser, so the player sees mistakes at once.
  // The API checks everything again; this is only for speed.
  // Returns an error message, or null if everything looks OK.
  function checkInput(username, password) {
    if (mode === 'login') {
      // When logging in, only check that both boxes are filled.
      // The full rules would give hints like "too short" for a wrong password.
      if (!username || !password) return 'Please enter your username and password';
      return null;
    }
    return (
      checkNewUsername(username) ||
      checkPassword(password) ||
      (password !== confirmInput.value ? 'The two passwords do not match' : null)
    );
  }

  switchButton.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
  });

  form.addEventListener('submit', async (event) => {
    // Stop the browser from reloading the page (the normal form behavior).
    event.preventDefault();

    // Remove spaces at the ends. Phone keyboards often add one after a word.
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    const inputError = checkInput(username, password);
    if (inputError) {
      showError(inputError);
      return;
    }

    showError('');
    setBusy(true);
    try {
      const result =
        mode === 'login' ? await login(username, password) : await register(username, password);
      // Clear the password boxes so the password does not stay in the page.
      passwordInput.value = '';
      confirmInput.value = '';
      onLoggedIn(result);
    } catch (err) {
      // ApiError messages are already written for the player.
      showError(err.message);
    } finally {
      setBusy(false);
    }
  });

  applyMode();

  // ---------- Closing the popup ----------
  // True while the popup is shown (or fading in).
  let isOpen = false;

  // The player closed the popup without logging in.
  function close() {
    if (!isOpen) return;
    fadeOut();
    onClose();
  }

  closeButton.addEventListener('click', close);

  // A click on the dark area around the card (not on the card itself).
  screen.addEventListener('click', (event) => {
    if (event.target === screen) close();
  });

  // Esc, wherever the focus is.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close();
    }
  });

  // ---------- Fading the popup in and out ----------
  // The popup sits on top of the running world. It fades instead of
  // popping, so going in and out of the game feels smooth.
  // The time must match the CSS transition on .overlay (style.css).
  const FADE_MS = 400;
  let fadeTimer = null;

  function fadeIn() {
    isOpen = true;
    clearTimeout(fadeTimer);
    if (!screen.hidden && !screen.classList.contains('is-fading')) return;
    screen.classList.add('is-fading');
    screen.hidden = false;
    // Make the browser draw it once at opacity 0, so the change to
    // opacity 1 below is animated (instead of happening at once).
    void screen.offsetWidth;
    screen.classList.remove('is-fading');
  }

  function fadeOut() {
    isOpen = false;
    // Take the focus out of the popup, so Enter opens the chat again
    // instead of pressing a popup button.
    if (screen.contains(document.activeElement)) document.activeElement.blur();
    clearTimeout(fadeTimer);
    screen.classList.add('is-fading');
    // After the fade, really hide it, so it cannot catch taps or clicks.
    fadeTimer = setTimeout(() => {
      screen.hidden = true;
    }, FADE_MS);
  }

  return {
    // Shows "Loading…" while we check a saved login.
    showLoading() {
      fadeIn();
      loading.hidden = false;
      fields.hidden = true;
    },

    // Shows the form, with an optional message (for example after an error).
    showForm(message = '') {
      fadeIn();
      loading.hidden = true;
      fields.hidden = false;
      // Always start on "Log in" (the player may have left it on "Create").
      mode = 'login';
      applyMode();
      showError(message);
    },

    // Hides it after a login (does not call onClose).
    hide() {
      fadeOut();
    },

    isOpen() {
      return isOpen;
    },
  };
}
