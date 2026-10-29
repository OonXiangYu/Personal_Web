// Rules for usernames and passwords.
// This file is used in TWO places:
//   - the API (the real check, because anyone can call the API directly)
//   - the browser form (a quick check, so the player sees mistakes at once)
// The browser loads this file too, so it must NOT import any Node-only
// modules (like mongodb or bcryptjs). Plain JavaScript only.
// It lives in /shared, not /api, because under `vercel dev` every URL that
// starts with /api goes to Vercel Functions, so the browser cannot load it from there.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 16;

// bcrypt only looks at the first 72 BYTES of a password.
// Anything after that is ignored, so we do not allow longer passwords.
export const PASSWORD_MIN_BYTES = 8;
export const PASSWORD_MAX_BYTES = 72;

// Allowed characters: English letters, numbers, underscore,
// and common Chinese characters (Unicode range 4E00 to 9FFF).
// Spaces and all other symbols are not allowed.
const USERNAME_PATTERN = /^[A-Za-z0-9_一-鿿]+$/;

// Checks a username.
// Returns an error message, or null if the username is OK.
export function checkUsername(username) {
  if (typeof username !== 'string' || username.length === 0) {
    return 'Please enter a username';
  }

  // Count real characters, not UTF-16 code units.
  // (All allowed characters are one unit each, but this is the safe way.)
  const length = Array.from(username).length;
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    return `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters`;
  }

  if (!USERNAME_PATTERN.test(username)) {
    return 'Username can only use letters, numbers, _ and Chinese characters';
  }

  return null;
}

// Usernames that start with this (in any letter case) cannot be registered,
// because guests are named "Guest_1234". Otherwise someone could register
// "Guest_1234" and look like a guest.
const RESERVED_USERNAME_START = 'guest';

// Checks a username for a NEW account (registration): the normal rules,
// plus no reserved names. Login uses checkUsername only, so an account made
// before this rule can still log in.
export function checkNewUsername(username) {
  const error = checkUsername(username);
  if (error) return error;
  if (username.toLowerCase().startsWith(RESERVED_USERNAME_START)) {
    return "Usernames starting with 'guest' are reserved.";
  }
  return null;
}

// Checks a password.
// Returns an error message, or null if the password is OK.
export function checkPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Please enter a password';
  }

  const bytes = getByteLength(password);
  if (bytes < PASSWORD_MIN_BYTES) {
    return `Password must be at least ${PASSWORD_MIN_BYTES} characters`;
  }
  if (bytes > PASSWORD_MAX_BYTES) {
    // One Chinese character is 3 bytes, so a Chinese password hits this sooner.
    return 'Password is too long (max 72 English letters, or about 24 Chinese characters)';
  }

  return null;
}

// The lowercase version of a username.
// We use it to find users and to stop "Tom" and "tom" both being registered.
export function toUsernameLower(username) {
  return username.toLowerCase();
}

// Counts how many bytes a string uses in UTF-8.
// TextEncoder works in both the browser and Node.
function getByteLength(text) {
  return new TextEncoder().encode(text).length;
}
