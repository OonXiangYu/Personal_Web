// Makes the in-game fish sprite from the big original drawing.
//
// The original (old-assets/sprites/clownfish-original.png, 809 x 480) is a
// painted picture in pixel-art STYLE, not real pixel art on a grid, so it
// cannot be "un-scaled" exactly. We shrink it to the size the fish has in
// the game world (44 px wide), one source pixel per game pixel, using
// nearest-neighbour: each game pixel takes the colour from the middle of
// its area in the original. This keeps the outlines crisp.
//
// Run it from the project folder:
//   node tools/make-fish-sprite.js
// Options (optional):
//   --width 44    fish width in game pixels (height follows the picture's shape)

import { readPng, writePng } from './png.js';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'old-assets/sprites/clownfish-original.png';
const OUTPUT = 'public/assets/sprites/fish/clownfish.png';

const widthArgument = process.argv.indexOf('--width');
const TARGET_WIDTH = widthArgument > 0 ? Number(process.argv[widthArgument + 1]) : 44;
if (!Number.isInteger(TARGET_WIDTH) || TARGET_WIDTH < 4) {
  console.error('--width must be a whole number of at least 4');
  process.exit(1);
}

const image = readPng(SOURCE);
const isSolid = (x, y) => image.pixels[(y * image.width + x) * 4 + 3] > 0;

// 1. Find the box around the solid (not transparent) pixels, so the empty
//    margin around the fish does not waste space in the small sprite.
let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
for (let y = 0; y < image.height; y++) {
  for (let x = 0; x < image.width; x++) {
    if (!isSolid(x, y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
}
const sourceWidth = maxX - minX + 1;
const sourceHeight = maxY - minY + 1;
const targetHeight = Math.round((TARGET_WIDTH * sourceHeight) / sourceWidth);

// 2. Nearest-neighbour: for each game pixel, copy the source pixel in the
//    middle of the area it covers. Every pixel is fully solid or fully
//    transparent (the original has no half-transparent pixels), so the
//    edge stays sharp. We never mix colours, so the near-white colour hidden
//    under the original's transparent pixels cannot leak in as a white halo.
const output = Buffer.alloc(TARGET_WIDTH * targetHeight * 4);
for (let y = 0; y < targetHeight; y++) {
  for (let x = 0; x < TARGET_WIDTH; x++) {
    const sourceX = minX + Math.floor(((x + 0.5) * sourceWidth) / TARGET_WIDTH);
    const sourceY = minY + Math.floor(((y + 0.5) * sourceHeight) / targetHeight);
    const from = (sourceY * image.width + sourceX) * 4;
    const to = (y * TARGET_WIDTH + x) * 4;
    if (image.pixels[from + 3] === 0) continue; // stays fully transparent (0,0,0,0)
    image.pixels.copy(output, to, from, from + 3);
    output[to + 3] = 255;
  }
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
writePng(OUTPUT, TARGET_WIDTH, targetHeight, output);
console.log(`Wrote ${OUTPUT}: ${TARGET_WIDTH} x ${targetHeight} px (from ${sourceWidth} x ${sourceHeight}, scale 1/${(sourceWidth / TARGET_WIDTH).toFixed(1)})`);
