// Start-up code for the page.
// 1. Start the game right away (in "loading" mode: the map, no fish yet).
// 2. If there is a saved token, ask the API who it belongs to (auto login)
//    and play as that player. Otherwise play as a guest at once: no popup.
// 3. The "Log in" button (top-right) opens the login popup. While it is
//    open, our fish stops. After login, the same fish (same place) gets the
//    player's real name. After logout, it becomes a new guest, same place.
//    The page never reloads.

import './ui/style.css';
import { createAuthForm } from './ui/authForm.js';
import { loadToken, saveToken, clearToken } from './ui/storage.js';
import { getMe } from './ui/api.js';
import { createGame } from './game/createGame.js';

const loginButton = document.getElementById('login-button');
const logoutButton = document.getElementById('logout-button');

const LOGIN_EXPIRED_MESSAGE = 'Your login has expired. Please log in again.';

// The game starts now, before we know who this visitor is.
const world = createGame('game', {
  // The game server says our login is no longer valid: go on as a guest,
  // and offer to log in again.
  onLoginRejected: () => {
    clearToken();
    playAsGuest();
    openLoginPopup(LOGIN_EXPIRED_MESSAGE);
  },
});

const authForm = createAuthForm({
  onLoggedIn({ token, user }) {
    saveToken(token);
    authForm.hide();
    world.setPaused(false);
    playAsUser(user);
  },
  // Closed without logging in: go on swimming as a guest.
  onClose() {
    world.setPaused(false);
  },
});

// Opens the login popup. Our fish stops while it is open, so it does not
// swim away while the player types (see WorldScene).
function openLoginPopup(message = '') {
  authForm.showForm(message);
  world.setPaused(true);
}

function playAsGuest() {
  world.playAsGuest();
  showButtons({ loggedIn: false });
}

function playAsUser(user) {
  world.playAsUser(user);
  showButtons({ loggedIn: true });
}

// Shows "Log in" for guests and "Log out" for logged-in players (never both).
function showButtons({ loggedIn }) {
  loginButton.hidden = loggedIn;
  logoutButton.hidden = !loggedIn;
}

// Not `addEventListener('click', openLoginPopup)`: that would pass the
// click event as `message`.
loginButton.addEventListener('click', () => openLoginPopup());

logoutButton.addEventListener('click', () => {
  clearToken();
  // The same fish, in the same place, becomes a new guest
  // (the handoff token takes care of the place, see WorldScene).
  playAsGuest();
});

// Runs once when the page loads.
async function start() {
  const token = loadToken();
  if (!token) {
    playAsGuest();
    return;
  }

  try {
    const { user } = await getMe(token);
    playAsUser(user);
  } catch (err) {
    // Play as a guest for now, and explain in the popup.
    playAsGuest();
    // 401 means the token is expired or invalid, so throw it away.
    // For other errors (no internet, server down) keep it: it may still be
    // good, and the next page load tries again.
    if (err.status === 401) {
      clearToken();
      openLoginPopup(LOGIN_EXPIRED_MESSAGE);
    } else {
      openLoginPopup(err.message);
    }
  }
}

start();
