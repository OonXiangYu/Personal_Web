// Saves the login token in localStorage.
// localStorage can throw an error (for example in some private browsing modes,
// or when storage is full or blocked). So every call is wrapped in try/catch.
// If saving fails, the game still works; the player just has to log in again
// after a refresh.

const TOKEN_KEY = 'pixelworld.token';

// Returns the saved token, or null if there is none or storage fails.
export function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// Saves the token. Does nothing if storage fails.
export function saveToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore. See the note at the top of the file.
  }
}

// Removes the token (used on logout or when the token is no longer valid).
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore. See the note at the top of the file.
  }
}
