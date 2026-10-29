// Makes the sardine sprite sheet from separate animation frames.
//
// The frames (old-assets/sprites/sardine-frames/) were split from a GIF and
// each one was trimmed to its own fish, like the clownfish frames (see
// make-fish-animation.js). This script:
//   1. lines the frames up by the HEAD (it hardly moves while swimming)
//   2. puts them all on ONE shared canvas, so the fish does not jump around
//   3. shrinks them to 3 sizes (SIZES, the fish's length in pixels). Each
//      sardine in the game uses one size, so they are not all the same.
//      (Scaling in the game by odd amounts like x0.93 would make the pixels
//      uneven, so the sizes are made here instead.)
//   4. packs them into one sprite sheet:
//      public/assets/sprites/fish/sardine-swim.png
//      One row per size (smallest first), one column per frame. Every cell
//      has the size of the biggest fish; smaller fish sit in the middle of
//      their cell, so the game can use one plain sprite sheet.
//
// Shrinking uses the AVERAGE colour of the pixels that become one pixel
// (better than skipping pixels for these detailed frames). A new pixel is
// solid if at least half of its area was solid, otherwise fully empty, so
// edges stay sharp (no half see-through pixels).
//
// Run it from the project folder:
//   node tools/make-sardine-animation.js
// Then check the printed cell size against SARDINE_FRAME in src/game/Sardines.js.

import fs from 'node:fs';
import path from 'node:path';
import { readPng, writePng } from './png.js';

const SOURCE_FOLDER = 'old-assets/sprites/sardine-frames';
const OUTPUT = 'public/assets/sprites/fish/sardine-swim.png';

// The swim cycle in order (it loops from the last back to the first).
// All 9 are kept: the cycle is 3 quick tail beats of "straight, straight,
// bent", and leaving one out would break that steady rhythm.
const FRAME_FILES = [
  'ezgif-frame-001.png',
  'ezgif-frame-005.png',
  'ezgif-frame-010.png',
  'ezgif-frame-015.png',
  'ezgif-frame-020.png',
  'ezgif-frame-025.png',
  'ezgif-frame-030.png',
  'ezgif-frame-035.png',
  'ezgif-frame-040.png',
];

// The fish lengths to make (pixels): 28 is normal, about ±10% around it.
const SIZES = [25, 28, 31];

// The sardine faces LEFT: match this many columns from the left edge (the head).
const HEAD_COLUMNS = 12;
// How far (in pixels) a frame may be moved to find the best head match.
const MAX_SHIFT_X = 2;
const MAX_SHIFT_Y = 3;

// ---------- 1. Read the frames ----------
const frames = FRAME_FILES.map((file) => {
  const image = readPng(path.join(SOURCE_FOLDER, file));
  return { file, width: image.width, height: image.height, pixels: image.pixels };
});

// The colour at (x, y), or null outside the frame or on a transparent pixel.
function solidPixel(frame, x, y) {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
  const at = (y * frame.width + x) * 4;
  return frame.pixels[at + 3] > 0 ? frame.pixels.subarray(at, at + 3) : null;
}

// How different the head of `frame`, moved by (dx, dy), is from the head of
// `reference`. Lower = more alike.
function headDifference(reference, frame, dx, dy) {
  let total = 0;
  let count = 0;
  for (let y = 0; y < reference.height; y++) {
    for (let x = 0; x < HEAD_COLUMNS; x++) {
      const a = solidPixel(reference, x, y);
      const b = solidPixel(frame, x - dx, y - dy);
      if (!a && !b) continue;
      count++;
      if (!a || !b) total += 255 * 3;
      else total += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    }
  }
  return count ? total / count : Infinity;
}

// ---------- 2. Line them up by the head ----------
const reference = frames[0];
for (const frame of frames) {
  let best = { dx: 0, dy: 0, score: Infinity };
  for (let dy = -MAX_SHIFT_Y; dy <= MAX_SHIFT_Y; dy++) {
    for (let dx = -MAX_SHIFT_X; dx <= MAX_SHIFT_X; dx++) {
      const score = headDifference(reference, frame, dx, dy);
      if (score < best.score) best = { dx, dy, score };
    }
  }
  frame.dx = best.dx;
  frame.dy = best.dy;
}

// The shared canvas: big enough for every moved frame.
const left = Math.min(...frames.map((f) => f.dx));
const top = Math.min(...frames.map((f) => f.dy));
const canvasWidth = Math.max(...frames.map((f) => f.dx + f.width)) - left;
const canvasHeight = Math.max(...frames.map((f) => f.dy + f.height)) - top;

// The colour at (x, y) of the shared canvas for one frame (or null).
function canvasPixel(frame, x, y) {
  return solidPixel(frame, x + left - frame.dx, y + top - frame.dy);
}

// ---------- 3. Shrink ----------
// Shrinks one frame to `width` pixels long. Returns { width, height, pixels }.
function shrink(frame, width) {
  const scale = width / canvasWidth;
  const height = Math.round(canvasHeight * scale);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The area of the canvas that becomes this one pixel.
      const x0 = x / scale;
      const x1 = (x + 1) / scale;
      const y0 = y / scale;
      const y1 = (y + 1) / scale;
      let area = 0;
      let solidArea = 0;
      const sum = [0, 0, 0];
      for (let cy = Math.floor(y0); cy < Math.ceil(y1); cy++) {
        for (let cx = Math.floor(x0); cx < Math.ceil(x1); cx++) {
          // How much of canvas pixel (cx, cy) lies inside the area.
          const share = (Math.min(cx + 1, x1) - Math.max(cx, x0)) * (Math.min(cy + 1, y1) - Math.max(cy, y0));
          area += share;
          const colour = canvasPixel(frame, cx, cy);
          if (!colour) continue;
          solidArea += share;
          for (let k = 0; k < 3; k++) sum[k] += colour[k] * share;
        }
      }
      if (solidArea < area / 2) continue; // stays fully transparent
      const at = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) pixels[at + k] = Math.round(sum[k] / solidArea);
      pixels[at + 3] = 255;
    }
  }
  return { width, height, pixels };
}

// ---------- 4. Pack into one sheet ----------
const shrunk = SIZES.map((size) => frames.map((frame) => shrink(frame, size)));
const cellWidth = Math.max(...SIZES);
const cellHeight = Math.max(...shrunk.flat().map((f) => f.height));
const sheetWidth = cellWidth * frames.length;
const sheetHeight = cellHeight * SIZES.length;
const sheet = Buffer.alloc(sheetWidth * sheetHeight * 4); // all (0,0,0,0) = empty

shrunk.forEach((row, rowIndex) => {
  row.forEach((image, column) => {
    // Centre the fish in its cell (whole pixels, so it stays sharp).
    const offsetX = column * cellWidth + Math.floor((cellWidth - image.width) / 2);
    const offsetY = rowIndex * cellHeight + Math.floor((cellHeight - image.height) / 2);
    for (let y = 0; y < image.height; y++) {
      image.pixels.copy(sheet, ((offsetY + y) * sheetWidth + offsetX) * 4, y * image.width * 4, (y + 1) * image.width * 4);
    }
  });
});

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
writePng(OUTPUT, sheetWidth, sheetHeight, sheet);

for (const frame of frames) {
  console.log(`${frame.file}: ${frame.width} x ${frame.height}, moved by (${frame.dx}, ${frame.dy})`);
}
console.log(`Shared canvas: ${canvasWidth} x ${canvasHeight}`);
SIZES.forEach((size, i) => console.log(`Row ${i}: fish ${size} x ${shrunk[i][0].height} px`));
console.log(`\nWrote ${OUTPUT}: ${SIZES.length} rows x ${frames.length} frames, cells of ${cellWidth} x ${cellHeight} px (sheet ${sheetWidth} x ${sheetHeight}).`);
console.log('Make sure SARDINE_FRAME in src/game/Sardines.js matches the cell size.');
