// Start-up code for the page.
// 1. If there is a saved token, ask the API who it belongs to (auto login).
// 2. Otherwise show the login form.
// 3. When the player is logged in, start the game. On logout, stop it.

import './ui/style.css';
import { createAuthForm } from './ui/authForm.js';
import { loadToken, saveToken, clearToken } from './ui/storage.js';
import { getMe } from './ui/api.js';
import { createGame } from './game/createGame.js';

const logoutButton = document.getElementById('logout-button');

// The running Phaser game, or null when nobody is logged in.
let game = null;

const authForm = createAuthForm({
  onLoggedIn({ token, user }) {
    saveToken(token);
    startGame(user);
  },
});

// Hides the form and starts the game for this user.
function startGame(user) {
  authForm.hide();
  logoutButton.hidden = false;
  game = createGame('game', user);
}

// Stops the game and goes back to the login form.
function logout() {
  clearToken();
  if (game) {
    // true = also remove the canvas from the page.
    game.destroy(true);
    game = null;
  }
  logoutButton.hidden = true;
  authForm.showForm();
}

logoutButton.addEventListener('click', logout);

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
    startGame(user);
  } catch (err) {
    // 401 means the token is expired or invalid, so throw it away.
    // For other errors (no internet, server down) keep it: it may still be good.
    if (err.status === 401) {
      clearToken();
      authForm.showForm();
    } else {
      authForm.showForm(err.message);
    }
  }
}

start();
