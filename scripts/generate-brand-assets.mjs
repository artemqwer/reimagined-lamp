// Renders the MetricForge logo into the raster icon files Next.js serves from
// `src/app/` — `favicon.ico` (16/32/48), `icon.png` (256) and `apple-icon.png`
// (180).
//
// Run with `node scripts/generate-brand-assets.mjs` after changing the logo.
//
// The source of truth is `public/metricforge-logo.png` — the SAME asset the
// sidebar and the auth screens render, so the tab icon can never drift from the
// logo in the app. An earlier version of this script drew its own four-bar mark
// instead; that mark is gone, along with the `src/app/icon.svg` twin it kept in
// sync, because two definitions of the logo is one too many.
//
// Written against Node's stdlib only (zlib for PNG inflate/deflate). The repo
// has no sharp and the box does not have ImageMagick, so the PNG decoder and
// the resampler below are the price of not adding a dependency for four files.

import { deflateSync, inflateSync } from "node:zlib";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "src", "app");
const SOURCE = join(ROOT, "public", "metricforge-logo.png");

// ─── PNG decoder ────────────────────────────────────────────────────────────
// Enough of the spec for the one file we read: 8-bit, non-interlaced, colour
// type 6 (RGBA) or 2 (RGB). Anything else throws rather than emitting a subtly
// wrong icon.

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const colour = data[9];
      const interlace = data[12];
      if (depth !== 8) throw new Error(`bit depth ${depth} unsupported (need 8)`);
      if (interlace !== 0) throw new Error("interlaced PNG unsupported");
      if (colour === 6) channels = 4;
      else if (colour === 2) channels = 3;
      else throw new Error(`colour type ${colour} unsupported (need 2 or 6)`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len; // length + type + data + crc
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);

    // Undo the per-scanline filter (PNG spec §9.2). `a` is the pixel to the
    // left, `b` the one above, `c` above-left.
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    line.copy(prev);

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }

  return { width, height, rgba: out };
}

// ─── Resampler ──────────────────────────────────────────────────────────────
// Box filter over the source rectangle each destination pixel covers. Averaging
// happens in PREMULTIPLIED space and is un-premultiplied at the end: averaging
// straight RGBA would pull the logo's edge pixels toward whatever colour sits
// under full transparency (black), ringing the mark with a dark fringe at 16px.

function resize(src, sw, sh, size) {
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    const y0 = (y * sh) / size;
    const y1 = ((y + 1) * sh) / size;
    for (let x = 0; x < size; x++) {
      const x0 = (x * sw) / size;
      const x1 = ((x + 1) * sw) / size;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;

      for (let sy = Math.floor(y0); sy < Math.min(Math.ceil(y1), sh); sy++) {
        for (let sx = Math.floor(x0); sx < Math.min(Math.ceil(x1), sw); sx++) {
          const i = (sy * sw + sx) * 4;
          const alpha = src[i + 3] / 255;
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }

      const d = (y * size + x) * 4;
      if (n === 0 || a === 0) {
        out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0;
        continue;
      }
      out[d] = Math.round(r / a);
      out[d + 1] = Math.round(g / a);
      out[d + 2] = Math.round(b / a);
      out[d + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

// iOS ignores the alpha channel on an apple-touch-icon and composites whatever
// it finds onto black, so a blue-on-transparent logo would arrive as blue on
// black. Flatten onto white ourselves instead of letting it guess.
function flatten(rgba, [br, bg, bb]) {
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    out[i] = Math.round(out[i] * a + br * (1 - a));
    out[i + 1] = Math.round(out[i + 1] * a + bg * (1 - a));
    out[i + 2] = Math.round(out[i + 2] * a + bb * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

// ─── PNG encoder ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay 0: deflate, adaptive filtering, no interlace.

  // One filter byte (0 = None) per scanline; the image is tiny and gradients
  // deflate well enough that per-line filter search isn't worth it.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── ICO container ──────────────────────────────────────────────────────────
// PNG-compressed entries (the Vista+ form). Every browser in support reads it,
// and it keeps the file a fraction of the BMP-encoded equivalent.

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;

  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    dir[at] = size >= 256 ? 0 : size; // 0 means 256
    dir[at + 1] = size >= 256 ? 0 : size;
    dir[at + 2] = 0; // palette size (0 = truecolour)
    dir[at + 3] = 0; // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// ─── Emit ───────────────────────────────────────────────────────────────────

const src = decodePng(readFileSync(SOURCE));
if (src.width !== src.height) {
  console.warn(
    `warning: ${src.width}×${src.height} source is not square — it will be squashed, not cropped`,
  );
}

const at = (size) => resize(src.rgba, src.width, src.height, size);

// favicon.ico carries the logo on transparency: a tab strip supplies its own
// background and the browser composites onto it, light or dark.
const ico = encodeIco([16, 32, 48].map((size) => ({ size, png: encodePng(size, at(size)) })));
writeFileSync(join(APP_DIR, "favicon.ico"), ico);

// icon.png is what Next serves to anything that prefers a modern PNG icon.
const icon = encodePng(256, at(256));
writeFileSync(join(APP_DIR, "icon.png"), icon);

// apple-icon is flattened onto white — see flatten() for why.
const apple = encodePng(180, flatten(at(180), [255, 255, 255]));
writeFileSync(join(APP_DIR, "apple-icon.png"), apple);

console.log(`source         ${src.width}×${src.height} from public/metricforge-logo.png`);
console.log(`favicon.ico    ${ico.length} bytes (16, 32, 48)`);
console.log(`icon.png       ${icon.length} bytes (256×256)`);
console.log(`apple-icon.png ${apple.length} bytes (180×180, flattened onto white)`);
