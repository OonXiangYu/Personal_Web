// Facts about the game world that the browser AND the real-time server must agree on.
// If the server used a different speed or fish size than the browser,
// honest players would look like cheaters. So both import these numbers from here.
// Plain JavaScript only: this file runs in the browser and in a Cloudflare Worker.
//
// The map size, walls and spawn point are NOT here. They come from the map
// file itself (public/assets/maps/world.tmj), read by shared/mapInfo.js.

// The fastest a fish can swim, in game pixels per second.
// The browser speeds up and slows down smoothly (like in water), but never
// goes faster than this. The server uses it to reject moves that are too fast.
export const MOVE_SPEED = 80;

// The directions a fish can face. It is a side view, so only left or right.
export const FACINGS = ['left', 'right'];

// The fish's HIT BOX, measured from the fish's center, in game pixels.
// This is what bumps into walls and the map edges. It covers the body,
// not the thin fins and tail tips, so the fish can get close to things.
// (The fish picture is 44 x 26 px; the body is about 34 x 16.)
// "top" and "bottom" are offsets from the center: negative = above.
export const PLAYER_HITBOX = { halfWidth: 17, top: -8, bottom: 8 };

// The WHOLE visible fish, measured from its center (the 44 x 26 picture).
// Used to keep the whole fish inside the map at the edges.
// "top" and "bottom" are distances above and below the center.
export const PLAYER_VISIBLE = { halfWidth: 22, top: 13, bottom: 13 };
