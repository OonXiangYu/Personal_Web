// Tiny helpers to read and write PNG images, for the scripts in tools/.
// Only what we need: 8-bit RGB or RGBA, no interlacing. Uses only Node's
// built-in zlib, so no extra packages are needed.

import fs from 'node:fs';
import zlib from 'node:zlib';

// Reads a PNG file. Returns { width, height, pixels }, where pixels is
// RGBA (4 bytes per pixel, row by row), even if the file has no alpha.
export function readPng(file) {
  const data = fs.readFileSync(file);
  let offset = 8; // skip the 8-byte PNG signature
  let width, height, colorType;
  const compressed = [];

  // A PNG is a list of "chunks": IHDR (size), IDAT (pixels), IEND (end)...
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`${file}: only 8-bit, non-interlaced PNGs are supported`);
      colorType = body[9];
    }
    if (type === 'IDAT') compressed.push(body);
    offset += 12 + length;
  }
  if (colorType !== 6 && colorType !== 2) throw new Error(`${file}: only RGB or RGBA PNGs are supported`);

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(compressed));
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(width * height * 4, 255);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    // Each row starts with a "filter" byte that says how it was packed.
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < bytesPerPixel; c++) {
        pixels[(y * width + x) * 4 + c] = row[x * bytesPerPixel + c];
      }
    }
    previous = row;
  }
  return { width, height, pixels };
}

// Writes RGBA pixels as a PNG file.
export function writePng(file, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // RGBA

  // Each row: a filter byte (0 = none), then the row's pixels.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// The "Paeth" guess used by PNG filter 4.
function paeth(left, up, upLeft) {
  const guess = left + up - upLeft;
  const toLeft = Math.abs(guess - left);
  const toUp = Math.abs(guess - up);
  const toUpLeft = Math.abs(guess - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

// One PNG chunk: length, type, body, and a CRC checksum.
function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typeAndBody = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody));
  return Buffer.concat([length, typeAndBody, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
