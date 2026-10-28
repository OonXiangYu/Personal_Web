// Saves the login token in localStorage.
// localStorage can throw an error (for example in some private browsing modes,
// or when storage is full or blocked). So every call is wrapped in try/catch.
// We also keep a copy in memory. If saving fails, the game still works for
// this page (the real-time connection needs the token on every reconnect);
// the player just has to log in again after a refresh.

const TOKEN_KEY = 'pixelworld.token';

// The token for this page, even if localStorage does not work.
let memoryToken = null;

// Returns the saved token, or null if there is none.
export function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}

// Saves the token.
export function saveToken(token) {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore. The memory copy still works. See the note at the top of the file.
  }
}

// Removes the token (used on logout or when the token is no longer valid).
export function clearToken() {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore. See the note at the top of the file.
  }
}
