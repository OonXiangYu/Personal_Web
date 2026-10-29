// Makes the swimming fish sprite sheet from separate animation frames.
//
// The frames (old-assets/sprites/clownfish-frames/) were split from a GIF.
// Each frame was trimmed to its own fish, so they are not the same size and
// their original positions are lost. This script:
//   1. lines the frames up by the HEAD (the part of a swimming fish that
//      hardly moves): each frame is moved to where its head best matches the
//      first frame's head
//   2. puts them all on ONE shared canvas (the union of all frames), so the
//      fish does not jump around between frames
//   3. optionally shrinks them (--width), with nearest-neighbour
//   4. packs them side by side into one sprite sheet:
//      public/assets/sprites/fish/clownfish-swim.png
// Transparent pixels are written as fully empty (0,0,0,0). The original
// frames hide a near-white colour under their transparent pixels, which
// could otherwise bleed in as a white edge.
//
// Run it from the project folder:
//   node tools/make-fish-animation.js
// Options (optional):
//   --width 44   shrink each frame to this width (default: keep 1:1, no shrinking)
// After running, check the printed frame size against FRAME_WIDTH and
// FRAME_HEIGHT in src/game/Player.js.

import fs from 'node:fs';
import path from 'node:path';
import { readPng, writePng } from './png.js';

const SOURCE_FOLDER = 'old-assets/sprites/clownfish-frames';
const OUTPUT = 'public/assets/sprites/fish/clownfish-swim.png';

// The frames of one swim cycle, in order. The animation loops from the last
// back to the first. Add, remove or reorder names here to change the cycle.
// (ezgif-frame-005.png is left out: it is almost the same as 001, which made
// the motion pause. Without it, the jump 001 -> 010 is smaller than the
// biggest normal step, so the cycle stays smooth.)
const FRAME_FILES = [
  'ezgif-frame-001.png',
  'ezgif-frame-010.png',
  'ezgif-frame-015.png',
  'ezgif-frame-020.png',
  'ezgif-frame-025.png',
  'ezgif-frame-030.png',
  'ezgif-frame-035.png',
  'ezgif-frame-040.png',
];

// The fish faces LEFT, so its head is in the left part of each frame.
// We match this many columns from the left edge.
const HEAD_COLUMNS = 14;
// How far (in pixels) a frame may be moved to find the best head match.
const MAX_SHIFT_X = 3;
const MAX_SHIFT_Y = 4;

// ---------- Read the options ----------
const widthArgument = process.argv.indexOf('--width');
const targetWidth = widthArgument > 0 ? Number(process.argv[widthArgument + 1]) : null;
if (targetWidth !== null && (!Number.isInteger(targetWidth) || targetWidth < 4)) {
  console.error('--width must be a whole number of at least 4');
  process.exit(1);
}

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
// `reference`. Lower = more alike. A pixel that is solid in one and empty in
// the other counts as the biggest possible difference.
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
const right = Math.max(...frames.map((f) => f.dx + f.width));
const bottom = Math.max(...frames.map((f) => f.dy + f.height));
const canvasWidth = right - left;
const canvasHeight = bottom - top;

// ---------- 3. Optional shrink, and 4. pack into one sheet ----------
const scale = targetWidth ? targetWidth / canvasWidth : 1;
const frameWidth = Math.round(canvasWidth * scale);
const frameHeight = Math.round(canvasHeight * scale);
const sheetWidth = frameWidth * frames.length;
const sheet = Buffer.alloc(sheetWidth * frameHeight * 4); // all (0,0,0,0) = empty

frames.forEach((frame, index) => {
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      // Nearest-neighbour: the canvas pixel in the middle of this output
      // pixel's area (at scale 1 this is simply the same pixel).
      const canvasX = Math.floor((x + 0.5) / scale);
      const canvasY = Math.floor((y + 0.5) / scale);
      const colour = solidPixel(frame, canvasX + left - frame.dx, canvasY + top - frame.dy);
      if (!colour) continue; // stays fully transparent
      const at = (y * sheetWidth + index * frameWidth + x) * 4;
      sheet[at] = colour[0];
      sheet[at + 1] = colour[1];
      sheet[at + 2] = colour[2];
      sheet[at + 3] = 255;
    }
  }
});

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
writePng(OUTPUT, sheetWidth, frameHeight, sheet);

for (const frame of frames) {
  console.log(`${frame.file}: ${frame.width} x ${frame.height}, moved by (${frame.dx}, ${frame.dy})`);
}
console.log(`\nWrote ${OUTPUT}: ${frames.length} frames of ${frameWidth} x ${frameHeight} px (sheet ${sheetWidth} x ${frameHeight}).`);
console.log('Make sure FRAME_WIDTH, FRAME_HEIGHT and FRAME_COUNT in src/game/Player.js match.');
