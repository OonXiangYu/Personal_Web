// Facts about the game world that the browser AND the real-time server must agree on.
// If the server used a different speed or player size than the browser,
// honest players would look like cheaters. So both import these numbers from here.
// Plain JavaScript only: this file runs in the browser and in a Cloudflare Worker.
//
// The map size, walls and spawn point are NOT here. They come from the map
// file itself (public/assets/maps/world.tmj), read by shared/mapInfo.js.

// How fast a player walks, in game pixels per second.
// The server uses this to reject moves that are too fast.
export const MOVE_SPEED = 80;

// The 4 directions a character can face. Matches the sprite file names.
export const FACINGS = ['down', 'left', 'right', 'up'];

// The player's FEET, measured from the sprite's center, in game pixels.
// This small box is what bumps into walls (like in most top-down games,
// so the head can overlap a wall that is "behind" the player).
// Measured from the sprite frames: a 14 x 8 box just above the bottom of the feet.
export const PLAYER_FEET = { halfWidth: 7, top: 11, bottom: 19 };

// The WHOLE visible character, measured from the sprite's center.
// Used to keep the whole body inside the map at the edges.
// Measured from all idle and run frames: about 22 px wide, 16 px above the
// center (top of the head) and 20 px below it (bottom of the feet).
export const PLAYER_VISIBLE = { halfWidth: 11, top: 16, bottom: 20 };
