// Start-up code for the page.
// 1. Start the game right away. Behind the login form, the world runs as a
//    "spectator": the map and other players walking, but you cannot play.
// 2. If there is a saved token, ask the API who it belongs to (auto login).
//    Otherwise show the login form (a popup on top of the world).
// 3. After login, the popup fades out and the same game switches to player
//    mode. After logout, it switches back. The page never reloads.

import './ui/style.css';
import { createAuthForm } from './ui/authForm.js';
import { loadToken, saveToken, clearToken } from './ui/storage.js';
import { getMe } from './ui/api.js';
import { createGame } from './game/createGame.js';

const logoutButton = document.getElementById('logout-button');

const LOGIN_EXPIRED_MESSAGE = 'Your login has expired. Please log in again.';

// The game starts now, before login, so the world shows behind the form.
const world = createGame('game', {
  onLoginRejected: () => logout(LOGIN_EXPIRED_MESSAGE),
});

const authForm = createAuthForm({
  onLoggedIn({ token, user }) {
    saveToken(token);
    enterGame(user);
  },
});

// Hides the popup and makes the visitor a player in the running world.
function enterGame(user) {
  authForm.hide();
  logoutButton.hidden = false;
  world.setUser(user);
}

// Goes back to the login popup. The world keeps running behind it
// (switching back to spectator mode).
// `message` is shown in the form (for example why the player was logged out).
function logout(message = '') {
  clearToken();
  logoutButton.hidden = true;
  // This also closes the player connection (see WorldScene's clean-up).
  world.setUser(null);
  authForm.showForm(message);
}

// Not `addEventListener('click', logout)`: that would pass the click event as `message`.
logoutButton.addEventListener('click', () => logout());

// Runs once when the page loads.
async function start() {
  const token = loadToken();
  if (!token) {
    authForm.showForm();
    return;
  }

  authForm.showLoading();
  try {
    const { user } = await getMe(token);
    enterGame(user);
  } catch (err) {
    // 401 means the token is expired or invalid, so throw it away.
    // For other errors (no internet, server down) keep it: it may still be good.
    if (err.status === 401) {
      clearToken();
      authForm.showForm(LOGIN_EXPIRED_MESSAGE);
    } else {
      authForm.showForm(err.message);
    }
  }
}

start();
