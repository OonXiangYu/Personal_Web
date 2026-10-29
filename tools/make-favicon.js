// Makes the favicon (the small icon in the browser tab) from the first
// frame of the clownfish swim sheet.
//
// It writes, in public/:
//   favicon.ico           16x16, 32x32 and 48x48 inside one file
//   favicon-32.png        32x32
//   apple-touch-icon.png  180x180, on a water-blue background (iPhones show
//                         this icon on a solid background, with rounded corners)
//
// Pixel art must stay sharp, so the fish is never stretched or smoothed:
//   - it is cut to its own size first (44 x 24, without the empty border)
//   - it is scaled by a WHOLE number only, nearest-neighbour (each fish
//     pixel becomes a square block of pixels)
//   - for the 16 and 32 icons the fish (44 px wide) is too big even at 1x,
//     so it is shrunk by a whole number instead (1/3 and 1/2), keeping one
//     pixel out of each 3x3 or 2x2 block (no blending)
//   - it is centred on a square canvas (transparent, except the apple icon)
//
// Run it from the project folder:
//   node tools/make-favicon.js

import fs from 'node:fs';
import { readPng, writePng, encodePng } from './png.js';

const SHEET = 'public/assets/sprites/fish/clownfish-swim.png';
// The size of one frame in the sheet (see FRAME_WIDTH/HEIGHT in src/game/Player.js).
const FRAME_WIDTH = 45;
const FRAME_HEIGHT = 27;

// The water colour behind the apple icon (a light blue from the water
// near the surface, see public/assets/backgrounds/ocean/water.png).
const APPLE_BACKGROUND = [0x17, 0xaf, 0xf0];

// Each icon: its square size, and the whole-number scale for the fish.
// A scale like "1/2" means "shrink to half" (keep 1 pixel of each 2x2).
const ICONS = {
  ico16: { size: 16, scale: { up: 1, down: 3 } }, // fish 15 x 8
  ico32: { size: 32, scale: { up: 1, down: 2 } }, // fish 22 x 12
  ico48: { size: 48, scale: { up: 1, down: 1 } }, // fish 44 x 24
  // 3x (132 x 72), not 4x (176 x 96): 4x would reach the edges, and iPhones
  // cut off the corners of this icon.
  apple: { size: 180, scale: { up: 3, down: 1 }, background: APPLE_BACKGROUND },
};

// ---------- 1. The first frame, cut to the fish ----------
const sheet = readPng(SHEET);
const isSolid = (x, y) => sheet.pixels[(y * sheet.width + x) * 4 + 3] > 0;
let left = FRAME_WIDTH;
let top = FRAME_HEIGHT;
let right = -1;
let bottom = -1;
for (let y = 0; y < FRAME_HEIGHT; y++) {
  for (let x = 0; x < FRAME_WIDTH; x++) {
    if (!isSolid(x, y)) continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
}
const fishWidth = right - left + 1;
const fishHeight = bottom - top + 1;

// ---------- 2. One square icon ----------
// Returns RGBA pixels of a size x size icon.
function makeIcon({ size, scale, background }) {
  const pixels = Buffer.alloc(size * size * 4); // all (0,0,0,0) = transparent
  if (background) {
    for (let i = 0; i < size * size; i++) pixels.set([...background, 255], i * 4);
  }

  // The fish size after scaling (whole pixels only).
  const width = Math.floor(fishWidth / scale.down) * scale.up;
  const height = Math.floor(fishHeight / scale.down) * scale.up;
  if (width > size || height > size) {
    throw new Error(`The fish (${width} x ${height}) does not fit in ${size} x ${size}.`);
  }
  // Centred, on whole pixels.
  const offsetX = Math.floor((size - width) / 2);
  const offsetY = Math.floor((size - height) / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Nearest-neighbour: which fish pixel lands here. When shrinking, the
      // middle pixel of each block (so a 1-pixel outline is not always lost).
      const blockMiddle = Math.floor(scale.down / 2);
      const fishX = Math.floor(x / scale.up) * scale.down + blockMiddle;
      const fishY = Math.floor(y / scale.up) * scale.down + blockMiddle;
      const from = ((top + fishY) * sheet.width + (left + fishX)) * 4;
      if (sheet.pixels[from + 3] === 0) continue; // keep the background
      sheet.pixels.copy(pixels, ((offsetY + y) * size + (offsetX + x)) * 4, from, from + 3);
      pixels[((offsetY + y) * size + (offsetX + x)) * 4 + 3] = 255;
    }
  }
  return { size, pixels, fish: `${width} x ${height}` };
}

// ---------- 3. The .ico file ----------
// A .ico is a small header, one 16-byte entry per image, then the images.
// Modern browsers and Windows accept PNG images inside a .ico.
function makeIco(icons) {
  const images = icons.map((icon) => encodePng(icon.size, icon.size, icon.pixels));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(icons.length, 4);

  const entries = [];
  let offset = 6 + 16 * icons.length;
  icons.forEach((icon, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = icon.size; // width (0 would mean 256)
    entry[1] = icon.size; // height
    entry[2] = 0; // no colour palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(images[i].length, 8); // size of the image data
    entry.writeUInt32LE(offset, 12); // where the image data starts
    offset += images[i].length;
    entries.push(entry);
  });
  return Buffer.concat([header, ...entries, ...images]);
}

// ---------- 4. Write the files ----------
const ico = [makeIcon(ICONS.ico16), makeIcon(ICONS.ico32), makeIcon(ICONS.ico48)];
fs.writeFileSync('public/favicon.ico', makeIco(ico));
writePng('public/favicon-32.png', 32, 32, ico[1].pixels);
const apple = makeIcon(ICONS.apple);
writePng('public/apple-touch-icon.png', 180, 180, apple.pixels);

console.log(`Fish (first frame, cut to size): ${fishWidth} x ${fishHeight}`);
for (const icon of [...ico, apple]) console.log(`  ${icon.size} x ${icon.size}: fish ${icon.fish}`);
console.log('Wrote public/favicon.ico (16, 32, 48), public/favicon-32.png, public/apple-touch-icon.png');
