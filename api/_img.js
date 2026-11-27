// Image helpers for the photo functions (no npm): sniff + size of JPEG/PNG/WebP, PNG decode, baseline JPEG
// encode (4:2:0), area downscale. Owner: photo.
//
// Why: Gemini image models return PNG (a 2K PNG is 4–6 MB, a 4K plate 20–30 MB). Phones should download a
// ~0.3–0.6 MB JPEG instead, so the functions transcode before writing to Storage. Files starting with "_" are
// not routed by Vercel.
import { inflateSync, deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------------------------- sniff + size
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** { width, height, progressive } of a JPEG from its SOF marker, or null. */
export function jpegSize(buf) {
  if (sniff(buf) !== 'image/jpeg') return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), progressive: m === 0xc2 };
    }
    if (m === 0xda) return null; // start of scan before any SOF: broken
    i += 2 + len;
  }
  return null;
}

export function pngSize(buf) {
  if (sniff(buf) !== 'image/png' || buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function imageSize(buf) {
  const t = sniff(buf);
  if (t === 'image/jpeg') return jpegSize(buf);
  if (t === 'image/png') return pngSize(buf);
  if (t === 'image/webp') {
    const c = buf.toString('ascii', 12, 16);
    if (c === 'VP8 ' && buf.length >= 30) return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (c === 'VP8L' && buf.length >= 25) { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (c === 'VP8X' && buf.length >= 30) return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

/** Bytes of a `data:image/...;base64,` URL (or plain base64), or null. */
export function fromDataUrl(s, maxBytes = Infinity) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
  const b64 = m ? s.slice(m[0].length) : s;
  if (b64.length > Math.ceil(maxBytes / 3) * 4 + 4) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 4096))) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length && buf.length <= maxBytes ? buf : null;
}

// ---------------------------------------------------------------------------------------------- PNG decode
/** Decode an 8/16-bit, non-interlaced PNG into { width, height, data: RGBA Uint8Array }. */
export function decodePNG(buf) {
  if (sniff(buf) !== 'image/png') throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 8, ct = 6, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; ct = body[9]; interlace = body[12]; }
    else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h || w * h > 60e6) throw new Error('bad PNG size');
  if (interlace) throw new Error('interlaced PNG not supported');
  if (depth !== 8 && depth !== 16 && !(ct === 3 && depth <= 8)) throw new Error(`PNG depth ${depth} not supported`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error(`PNG colour type ${ct} not supported`);
  const bitsPP = ch * depth;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = Math.ceil((w * bitsPP) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * h) throw new Error('truncated PNG');
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    const o = y * w * 4;
    if (ct === 3) {
      for (let x = 0; x < w; x++) {
        const bit = x * depth; const byte = cur[bit >> 3];
        const idx = depth === 8 ? byte : (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        out[o + x * 4] = plte[idx * 3]; out[o + x * 4 + 1] = plte[idx * 3 + 1]; out[o + x * 4 + 2] = plte[idx * 3 + 2];
        out[o + x * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    } else {
      const step = depth === 16 ? 2 : 1; // 16-bit: keep the high byte
      for (let x = 0; x < w; x++) {
        const s = x * ch * step;
        const g = (k) => cur[s + k * step];
        if (ch === 1) { const v = g(0); out[o + x * 4] = out[o + x * 4 + 1] = out[o + x * 4 + 2] = v; out[o + x * 4 + 3] = 255; }
        else if (ch === 2) { const v = g(0); out[o + x * 4] = out[o + x * 4 + 1] = out[o + x * 4 + 2] = v; out[o + x * 4 + 3] = g(1); }
        else { out[o + x * 4] = g(0); out[o + x * 4 + 1] = g(1); out[o + x * 4 + 2] = g(2); out[o + x * 4 + 3] = ch === 4 ? g(3) : 255; }
      }
    }
    [prev, cur] = [cur, prev];
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------------------------- PNG encode (masks)
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
/** 8-bit grayscale PNG from a Uint8Array of w×h values (sky masks for the window plate). */
export function encodeGrayPNG(w, h, gray) {
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------- resize
/** Area-average downscale of RGBA to fit `maxW × maxH` (never upscales). */
export function downscale(img, maxW, maxH = Infinity) {
  const { width: W, height: H, data } = img;
  const k = Math.min(1, maxW / W, maxH / H);
  if (k >= 1) return img;
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const out = new Uint8Array(w * h * 4);
  const sx = W / w, sy = H / h;
  const acc = new Float64Array(w * 4), wsum = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    acc.fill(0); wsum.fill(0);
    const y0 = y * sy, y1 = y0 + sy;
    for (let yy = Math.floor(y0); yy < Math.min(H, Math.ceil(y1)); yy++) {
      const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
      const row = yy * W * 4;
      for (let x = 0; x < w; x++) {
        const x0 = x * sx, x1 = x0 + sx;
        for (let xx = Math.floor(x0); xx < Math.min(W, Math.ceil(x1)); xx++) {
          const wt = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          const p = row + xx * 4;
          acc[x * 4] += data[p] * wt; acc[x * 4 + 1] += data[p + 1] * wt; acc[x * 4 + 2] += data[p + 2] * wt; acc[x * 4 + 3] += data[p + 3] * wt;
          wsum[x] += wt;
        }
      }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = Math.round(acc[x * 4 + c] / wsum[x]);
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------------------------- JPEG encode
const ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];
const DC_L = { bits: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_C = { bits: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], vals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_L = { bits: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], vals: [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };
const AC_C = { bits: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], vals: [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };

function huffCodes({ bits, vals }) {
  const codes = new Map(); let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) { for (let i = 0; i < bits[len - 1]; i++) codes.set(vals[k++], [code++, len]); code <<= 1; }
  return codes;
}
const H = { dcL: huffCodes(DC_L), dcC: huffCodes(DC_C), acL: huffCodes(AC_L), acC: huffCodes(AC_C) };
// DCT basis: c[u*8+x] = C(u)/2 · cos((2x+1)uπ/16)
const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) / 2 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

function scaleQ(base, quality) {
  const q = Math.min(100, Math.max(1, quality | 0));
  const s = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * s + 50) / 100))));
}

class Bits {
  constructor(size) { this.buf = new Uint8Array(size); this.n = 0; this.acc = 0; this.cnt = 0; }
  grow(k) { if (this.n + k > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k + 1024)); b.set(this.buf); this.buf = b; } }
  byte(v) { this.grow(1); this.buf[this.n++] = v; }
  bytes(arr) { this.grow(arr.length); this.buf.set(arr, this.n); this.n += arr.length; }
  put(code, len) {
    this.acc = (this.acc << len) | code; this.cnt += len;
    while (this.cnt >= 8) {
      const b = (this.acc >>> (this.cnt - 8)) & 255;
      this.byte(b); if (b === 0xff) this.byte(0);
      this.cnt -= 8; this.acc &= (1 << this.cnt) - 1;
    }
  }
  flush() { if (this.cnt > 0) this.put((1 << (8 - this.cnt)) - 1, 8 - this.cnt); }
}

/** Baseline JPEG (JFIF, YCbCr 4:2:0) from RGBA. Returns a Buffer. */
export function encodeJPEG({ width: W, height: Hh, data }, quality = 86) {
  const ql = scaleQ(QL, quality), qc = scaleQ(QC, quality);
  const out = new Bits(Math.max(4096, (W * Hh) >> 2));
  const seg = (marker, body) => { out.byte(0xff); out.byte(marker); out.byte((body.length + 2) >> 8); out.byte((body.length + 2) & 255); out.bytes(body); };
  out.byte(0xff); out.byte(0xd8);
  seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  seg(0xdb, [0, ...ZZ.map((i) => ql[i]), 1, ...ZZ.map((i) => qc[i])]);
  seg(0xc0, [8, Hh >> 8, Hh & 255, W >> 8, W & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  seg(0xc4, [0x00, ...DC_L.bits, ...DC_L.vals, 0x10, ...AC_L.bits, ...AC_L.vals, 0x01, ...DC_C.bits, ...DC_C.vals, 0x11, ...AC_C.bits, ...AC_C.vals]);
  seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  // colour conversion into full-res Y and 2×2-averaged Cb/Cr planes (edge-replicated to the MCU grid)
  const MW = Math.ceil(W / 16) * 16, MH = Math.ceil(Hh / 16) * 16;
  const Y = new Float32Array(MW * MH), cw = MW >> 1, chh = MH >> 1;
  const Cb = new Float32Array(cw * chh), Cr = new Float32Array(cw * chh);
  for (let y = 0; y < MH; y++) {
    const sy = Math.min(y, Hh - 1);
    for (let x = 0; x < MW; x++) {
      const p = (sy * W + Math.min(x, W - 1)) * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      Y[y * MW + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      const ci = (y >> 1) * cw + (x >> 1);
      Cb[ci] += (-0.168736 * r - 0.331264 * g + 0.5 * b) * 0.25;
      Cr[ci] += (0.5 * r - 0.418688 * g - 0.081312 * b) * 0.25;
    }
  }
  const blk = new Float64Array(64), tmp = new Float64Array(64), q = new Int32Array(64);
  const pred = [0, 0, 0];
  const bitLen = (v) => { v = v < 0 ? -v : v; let n = 0; while (v) { n++; v >>= 1; } return n; };
  function block(plane, pw, bx, by, qt, ci, dc, ac) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = plane[(by + y) * pw + bx + x];
    // rows then columns: tmp[y][u] = Σx c[u][x] f[y][x];  F[v][u] = Σy c[v][y] tmp[y][u]
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * blk[y * 8 + x]; tmp[y * 8 + u] = s; }
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { let s = 0; for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u]; q[v * 8 + u] = Math.round(s / qt[v * 8 + u]); }
    const d = q[0] - pred[ci]; pred[ci] = q[0];
    const dl = bitLen(d); const [c0, l0] = dc.get(dl); out.put(c0, l0);
    if (dl) out.put(d < 0 ? d + (1 << dl) - 1 : d, dl);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = q[ZZ[k]];
      if (!v) { run++; continue; }
      while (run > 15) { const [cz, lz] = ac.get(0xf0); out.put(cz, lz); run -= 16; }
      const l = bitLen(v); const [c, len] = ac.get((run << 4) | l); out.put(c, len);
      out.put(v < 0 ? v + (1 << l) - 1 : v, l);
      run = 0;
    }
    if (run) { const [ce, le] = ac.get(0); out.put(ce, le); }
  }
  for (let my = 0; my < MH; my += 16) {
    for (let mx = 0; mx < MW; mx += 16) {
      block(Y, MW, mx, my, ql, 0, H.dcL, H.acL); block(Y, MW, mx + 8, my, ql, 0, H.dcL, H.acL);
      block(Y, MW, mx, my + 8, ql, 0, H.dcL, H.acL); block(Y, MW, mx + 8, my + 8, ql, 0, H.dcL, H.acL);
      block(Cb, cw, mx >> 1, my >> 1, qc, 1, H.dcC, H.acC);
      block(Cr, cw, mx >> 1, my >> 1, qc, 2, H.dcC, H.acC);
    }
  }
  out.flush();
  out.byte(0xff); out.byte(0xd9);
  return Buffer.from(out.buf.buffer, 0, out.n);
}

/**
 * Normalise a model output for Storage: JPEG stays as is (if within maxEdge); PNG is decoded, downscaled to
 * maxEdge and re-encoded as JPEG. WebP passes through. Returns { bytes, type, width, height, transcoded }.
 */
export function toStorableJpeg(buf, { maxEdge = 2048, quality = 86 } = {}) {
  const t = sniff(buf);
  if (t === 'image/jpeg' || t === 'image/webp') {
    const s = imageSize(buf) || {};
    // (no JPEG decoder here: an oversize JPEG is stored as it came, flagged)
    return { bytes: buf, type: t, width: s.width || 0, height: s.height || 0, transcoded: false, oversize: !!s.width && Math.max(s.width, s.height) > maxEdge * 1.02 };
  }
  if (t !== 'image/png') throw new Error('unknown image type');
  let img = decodePNG(buf);
  img = downscale(img, maxEdge, maxEdge);
  return { bytes: encodeJPEG(img, quality), type: 'image/jpeg', width: img.width, height: img.height, transcoded: true };
}
