import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PNG } from "pngjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const outputDir = path.join(root, "assets", "electron");
const iconsetDir = path.join(outputDir, "icon.iconset");

const ICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const ICNS_FILES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function alphaBlendPixel(png, x, y, color, alpha) {
  if (alpha <= 0) return;
  if (alpha >= 1) {
    setPixel(png, x, y, color[0], color[1], color[2], color[3] ?? 255);
    return;
  }
  const idx = (png.width * y + x) << 2;
  const existingAlpha = png.data[idx + 3] / 255;
  const nextAlpha = alpha + existingAlpha * (1 - alpha);
  const blend = (src, dst) => Math.round((src * alpha + dst * existingAlpha * (1 - alpha)) / nextAlpha);
  png.data[idx] = blend(color[0], png.data[idx]);
  png.data[idx + 1] = blend(color[1], png.data[idx + 1]);
  png.data[idx + 2] = blend(color[2], png.data[idx + 2]);
  png.data[idx + 3] = Math.round(nextAlpha * 255);
}

function fillRoundedRect(png, x, y, width, height, radius, color) {
  const samples = 4;
  for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const cx = px + (sx + 0.5) / samples;
          const cy = py + (sy + 0.5) / samples;
          const nearestX = Math.max(x + radius, Math.min(cx, x + width - radius));
          const nearestY = Math.max(y + radius, Math.min(cy, y + height - radius));
          const dx = cx - nearestX;
          const dy = cy - nearestY;
          if (dx * dx + dy * dy <= radius * radius) covered += 1;
        }
      }
      alphaBlendPixel(png, px, py, color, covered / (samples * samples));
    }
  }
}

function fillRect(png, x, y, width, height, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + height); py += 1) {
    for (let px = Math.floor(x); px < Math.ceil(x + width); px += 1) {
      setPixel(png, px, py, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function renderIcon(size) {
  const png = new PNG({ width: size, height: size });
  const s = size / 32;
  const black = [26, 26, 26, 255];
  const white = [255, 255, 255, 255];

  fillRoundedRect(png, 0, 0, size, size, 8 * s, black);

  // Matches the favicon's bold Societyer "S" mark as a crisp block glyph.
  fillRect(png, 10 * s, 10 * s, 12 * s, 3 * s, white);
  fillRect(png, 10 * s, 10 * s, 4 * s, 8 * s, white);
  fillRect(png, 10 * s, 16 * s, 12 * s, 3 * s, white);
  fillRect(png, 18 * s, 16 * s, 4 * s, 8 * s, white);
  fillRect(png, 10 * s, 21 * s, 12 * s, 3 * s, white);

  // Small counter cuts keep the glyph close to the original favicon.
  fillRect(png, 14 * s, 13 * s, 4 * s, 3 * s, black);
  fillRect(png, 14 * s, 19 * s, 4 * s, 2 * s, black);

  return PNG.sync.write(png);
}

function makeIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + images.length * entrySize;
  const imageBytes = images.reduce((total, image) => total + image.data.length, 0);
  const output = Buffer.alloc(directorySize + imageBytes);
  let offset = 0;
  output.writeUInt16LE(0, offset);
  output.writeUInt16LE(1, offset + 2);
  output.writeUInt16LE(images.length, offset + 4);
  offset = headerSize;

  let imageOffset = directorySize;
  for (const image of images) {
    output.writeUInt8(image.size >= 256 ? 0 : image.size, offset);
    output.writeUInt8(image.size >= 256 ? 0 : image.size, offset + 1);
    output.writeUInt8(0, offset + 2);
    output.writeUInt8(0, offset + 3);
    output.writeUInt16LE(1, offset + 4);
    output.writeUInt16LE(32, offset + 6);
    output.writeUInt32LE(image.data.length, offset + 8);
    output.writeUInt32LE(imageOffset, offset + 12);
    image.data.copy(output, imageOffset);
    imageOffset += image.data.length;
    offset += entrySize;
  }

  return output;
}

await mkdir(outputDir, { recursive: true });
await rm(iconsetDir, { recursive: true, force: true });
await mkdir(iconsetDir, { recursive: true });

const rendered = new Map(ICON_SIZES.map((size) => [size, renderIcon(size)]));
await writeFile(path.join(outputDir, "icon.png"), rendered.get(1024));

for (const [fileName, size] of ICNS_FILES) {
  await writeFile(path.join(iconsetDir, fileName), rendered.get(size));
}

await execFileAsync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(outputDir, "icon.icns")]);
await rm(iconsetDir, { recursive: true, force: true });

await writeFile(
  path.join(outputDir, "icon.ico"),
  makeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: rendered.get(size) }))),
);

console.log("Generated Electron icons in assets/electron.");
