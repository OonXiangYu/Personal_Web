// Facts about the game world that the browser AND the real-time server must agree on.
// If the server used a different speed or map size than the browser,
// honest players would look like cheaters. So both import these numbers from here.
// Plain JavaScript only: this file runs in the browser and in a Cloudflare Worker.

// Map size in game pixels.
export const WORLD_WIDTH = 2048;
export const WORLD_HEIGHT = 2048;

// How fast a player walks, in game pixels per second.
// The server uses this to reject moves that are too fast.
export const MOVE_SPEED = 80;

// Where everyone appears when they join.
// TODO: load each user's `lastPosition` from MongoDB instead, and save it when they leave.
export const SPAWN_POINT = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };

// The 4 directions a character can face. Matches the sprite file names.
export const FACINGS = ['down', 'left', 'right', 'up'];
