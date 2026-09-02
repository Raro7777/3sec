/**
 * Tiny dependency-free GIF89a encoder for replay clips: a global 256-colour palette built from
 * the frames (popularity of 15-bit colour bins, nearest-colour lookup with a cache) and standard
 * LZW image data. Good enough for a few dozen 320-px frames; not a general-purpose encoder.
 */

export interface GifFrame { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** Encode RGBA frames (all the same size) into a looping GIF; `delayCs` is the frame delay in 1/100 s. */
export function encodeGif(frames: GifFrame[], delayCs = 50): Uint8Array {
  if (frames.length === 0) throw new Error("no frames");
  const { width: w, height: h } = frames[0]!;
  const palette = buildPalette(frames);
  const out = new ByteWriter();
  out.str("GIF89a");
  out.u16(w); out.u16(h);
  out.u8(0xf7); // global colour table, 8 bits/pixel, 256 entries
  out.u8(0); out.u8(0);
  for (let i = 0; i < 256; i++) { const c = palette[i] ?? 0; out.u8((c >> 16) & 255); out.u8((c >> 8) & 255); out.u8(c & 255); }
  // Netscape looping extension
  out.bytes([0x21, 0xff, 0x0b]); out.str("NETSCAPE2.0"); out.bytes([3, 1, 0, 0, 0]);
  const lookup = new Map<number, number>();
  const indices = new Uint8Array(w * h);
  for (const f of frames) {
    const d = f.data;
    for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
      const key = ((d[p]! >> 3) << 10) | ((d[p + 1]! >> 3) << 5) | (d[p + 2]! >> 3);
      let idx = lookup.get(key);
      if (idx === undefined) { idx = nearest(palette, d[p]!, d[p + 1]!, d[p + 2]!); lookup.set(key, idx); }
      indices[i] = idx;
    }
    // graphic control extension: delay, no transparency
    out.bytes([0x21, 0xf9, 4, 0]); out.u16(delayCs); out.u8(0); out.u8(0);
    // image descriptor
    out.u8(0x2c); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.u8(0);
    out.u8(8); // LZW minimum code size
    lzw(indices, 8, out);
  }
  out.u8(0x3b);
  return out.result();
}

/** The 256 most common 15-bit colour bins over the frames (sampled), as 0xRRGGBB. */
function buildPalette(frames: GifFrame[]): number[] {
  const counts = new Map<number, number>();
  const step = Math.max(1, Math.floor((frames.length * frames[0]!.width * frames[0]!.height) / 60000));
  let n = 0;
  for (const f of frames) {
    const d = f.data;
    for (let p = 0; p < d.length; p += 4, n++) {
      if (n % step) continue;
      const key = ((d[p]! >> 3) << 10) | ((d[p + 1]! >> 3) << 5) | (d[p + 2]! >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256);
  const pal = top.map(([k]) => {
    const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
    return (r << 16) | (g << 8) | b;
  });
  // always have pure white and black available for lines and text
  if (!pal.includes(0xffffff)) pal[pal.length < 256 ? pal.length : 255] = 0xffffff;
  if (!pal.includes(0)) pal[pal.length < 256 ? pal.length : 254] = 0;
  while (pal.length < 256) pal.push(0);
  return pal;
}

function nearest(pal: number[], r: number, g: number, b: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const c = pal[i]!;
    const dr = ((c >> 16) & 255) - r, dg = ((c >> 8) & 255) - g, db = (c & 255) - b;
    const d = dr * dr * 2 + dg * dg * 3 + db * db;
    if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
  }
  return best;
}

/** Variable-length LZW as used by GIF, written in 255-byte sub-blocks. */
function lzw(px: Uint8Array, minCode: number, out: ByteWriter): void {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  const block = new Uint8Array(255);
  let blockLen = 0;
  let cur = 0, curBits = 0;
  const emit = (code: number) => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) {
      block[blockLen++] = cur & 255; cur >>>= 8; curBits -= 8;
      if (blockLen === 255) { out.u8(255); out.bytes(block); blockLen = 0; }
    }
  };
  emit(clear);
  let prefix = px[0]!;
  for (let i = 1; i < px.length; i++) {
    const k = px[i]!;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map(); next = eoi + 1; codeSize = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) { block[blockLen++] = cur & 255; if (blockLen === 255) { out.u8(255); out.bytes(block); blockLen = 0; } }
  if (blockLen > 0) { out.u8(blockLen); out.bytes(block.subarray(0, blockLen)); }
  out.u8(0);
}

class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  private len = 0;
  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    nb.set(this.buf); this.buf = nb;
  }
  u8(v: number): void { this.grow(1); this.buf[this.len++] = v & 255; }
  u16(v: number): void { this.u8(v & 255); this.u8((v >> 8) & 255); }
  str(s: string): void { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  bytes(b: ArrayLike<number>): void { this.grow(b.length); this.buf.set(b, this.len); this.len += b.length; }
  result(): Uint8Array { return this.buf.slice(0, this.len); }
}
