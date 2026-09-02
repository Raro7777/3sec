/**
 * Per-club kits. A kit is a primary colour (the club colour used everywhere else in the UI),
 * a secondary colour and a pattern; the keeper wears a plain colour that clashes with nobody.
 * Player discs are painted from a cached offscreen sprite per (kit, radius, dpr) so the match
 * render only blits one image per player.
 */

export type KitPattern = "solid" | "stripes" | "hoops" | "sash" | "halves";

export interface Kit {
  /** dominant colour: base of the shirt and the reference for number contrast */
  primary: string;
  /** colour of the stripes/hoops/sash/second half (trim only for "solid") */
  secondary: string;
  pattern: KitPattern;
}

/** Both outfield kits of a match plus the two keeper colours, after clash resolution. */
export interface MatchKits {
  outfield: [Kit, Kit];
  gk: [string, string];
  /** true when the away side had to switch to its alternate kit */
  awayAlternate: boolean;
}

const K = (club: string, primary: string, secondary: string, pattern: KitPattern): [string, Kit] => [club, { primary, secondary, pattern }];

/** Home kits, by club name (packages/game/src/world.ts CLUBS). Primary = club.color. */
const KITS = new Map<string, Kit>([
  K("서울 FC", "#e63946", "#1a1a1a", "stripes"),
  K("부산 유나이티드", "#4cc9f0", "#ffffff", "hoops"),
  K("인천 블루", "#3a86ff", "#0b1f4d", "halves"),
  K("대구 울브스", "#8ecae6", "#1f2937", "sash"),
  K("광주 레이즈", "#ffd166", "#d62828", "stripes"),
  K("대전 코메츠", "#c77dff", "#2b1b4a", "sash"),
  K("수원 윙스", "#06d6a0", "#ffffff", "halves"),
  K("울산 앵커스", "#f4a261", "#2f3e46", "hoops"),
  K("전주 그린", "#2a9d8f", "#ffffff", "stripes"),
  K("포항 아이언", "#adb5bd", "#111111", "hoops"),
  K("제주 아일랜더스", "#ff8fab", "#ffffff", "sash"),
  K("창원 세일즈", "#a7c957", "#1b4332", "solid"),
]);

/** Home kit of a club; unknown clubs (engine test teams) get a plain kit in their colour. */
export function kitFor(clubName: string, color: string): Kit {
  const k = KITS.get(clubName);
  if (k && k.primary.toLowerCase() === color.toLowerCase()) return k;
  if (k) return { ...k, primary: color }; // club colour changed elsewhere: keep the pattern
  return { primary: color, secondary: shade(color, -0.35), pattern: "solid" };
}

/** Alternate (away) kit: white or dark with the club colour as a sash, whichever reads against the home kit. */
export function alternateKit(color: string, homeKit: Kit): Kit {
  const dark = luminance(homeKit.primary) > 0.45 || (homeKit.pattern !== "solid" && luminance(homeKit.secondary) > 0.7 && luminance(homeKit.primary) > 0.3);
  return dark ? { primary: "#1d2230", secondary: color, pattern: "sash" } : { primary: "#f3f4f6", secondary: color, pattern: "sash" };
}

/** Do two kits look alike on the pitch? (close hue and similar brightness of the dominant colours) */
export function kitsClash(a: Kit, b: Kit): boolean {
  const la = luminance(a.primary), lb = luminance(b.primary);
  const dl = Math.abs(la - lb);
  const sa = saturation(a.primary), sb = saturation(b.primary);
  // two near-greys / near-whites / near-blacks clash on brightness alone
  if (sa < 0.2 && sb < 0.2) return dl < 0.25;
  if (sa < 0.2 || sb < 0.2) return dl < 0.12;
  return hueDistance(a.primary, b.primary) < 38 && dl < 0.3;
}

const GK_COLORS = ["#ffe74c", "#ff7f11", "#7bf1a8", "#9b5de5", "#38bdf8", "#f72585", "#d9d9d9"];

/** A plain keeper colour that stays apart from every outfield colour handed in and from `avoid`. */
export function keeperColor(kits: Kit[], avoid: string[] = []): string {
  const others = [...kits.flatMap((k) => (k.pattern === "solid" ? [k.primary] : [k.primary, k.secondary])), ...avoid];
  let best = GK_COLORS[0]!;
  let bestScore = -1;
  for (const c of GK_COLORS) {
    let score = Infinity;
    for (const o of others) {
      const d = saturation(o) < 0.2 || saturation(c) < 0.2 ? Math.abs(luminance(o) - luminance(c)) * 300 : hueDistance(o, c) + Math.abs(luminance(o) - luminance(c)) * 120;
      score = Math.min(score, d);
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** Kits for a fixture: home kit, away kit (alternate when clashing) and two keeper colours. */
export function resolveKits(home: { name: string; color: string }, away: { name: string; color: string }): MatchKits {
  const h = kitFor(home.name, home.color);
  let a = kitFor(away.name, away.color);
  let awayAlternate = false;
  if (kitsClash(h, a)) { a = alternateKit(away.color, h); awayAlternate = true; }
  const gkH = keeperColor([h, a]);
  const gkA = keeperColor([h, a], [gkH]);
  return { outfield: [h, a], gk: [gkH, gkA], awayAlternate };
}

/** Text colour that reads on the kit's dominant colour. */
export function kitTextColor(kit: Kit | string): string {
  const c = typeof kit === "string" ? kit : kit.primary;
  return luminance(c) > 0.42 ? "#101418" : "#ffffff";
}

// ---------------------------------------------------------------- sprites

interface Sprite { key: string; canvas: HTMLCanvasElement; pad: number; dpr: number }
const sprites: Sprite[] = [];
const SPRITE_MAX = 24;

/** Offscreen disc for a kit at radius `r` css px; `pad` extra px around it for the rim/highlight. */
export function kitSprite(kit: Kit, r: number, dpr: number): Sprite | null {
  const rr = Math.round(r * 4) / 4;
  const key = `${kit.primary}|${kit.secondary}|${kit.pattern}|${rr}|${dpr}`;
  let hit = sprites.find((s) => s.key === key);
  if (hit) return hit;
  const pad = 2;
  const size = Math.ceil((rr + pad) * 2 * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintKit(ctx, kit, rr + pad, rr + pad, rr);
  hit = { key, canvas, pad, dpr };
  sprites.push(hit);
  if (sprites.length > SPRITE_MAX) sprites.shift();
  return hit;
}

/** Paint a patterned disc directly (used for the sprite; also usable for previews). */
export function paintKit(ctx: CanvasRenderingContext2D, kit: Kit, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = kit.primary;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = kit.secondary;
  switch (kit.pattern) {
    case "stripes": {
      const w = Math.max(1.5, r * 0.42);
      for (let x = cx - r + w * 0.75; x < cx + r; x += w * 2) ctx.fillRect(x, cy - r, w, r * 2);
      break;
    }
    case "hoops": {
      const h = Math.max(1.5, r * 0.42);
      for (let y = cy - r + h * 0.75; y < cy + r; y += h * 2) ctx.fillRect(cx - r, y, r * 2, h);
      break;
    }
    case "sash": {
      ctx.beginPath();
      const w = r * 0.75;
      ctx.moveTo(cx - r + w * 0.2, cy - r); ctx.lineTo(cx - r + w * 0.2 + w, cy - r);
      ctx.lineTo(cx + r - w * 0.2, cy + r); ctx.lineTo(cx + r - w * 0.2 - w, cy + r);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "halves":
      ctx.fillRect(cx, cy - r, r, r * 2);
      break;
    case "solid":
      // collar/trim: a thin ring in the secondary colour
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.strokeStyle = kit.secondary;
      ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
      break;
  }
  // a little volume: light top-left, shade bottom-right
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
  g.addColorStop(0, "rgba(255,255,255,0.28)");
  g.addColorStop(0.55, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

/** Blit a kit disc centred at (x, y) with radius r (css px). Falls back to a plain fill without a DOM. */
export function drawKitDisc(ctx: CanvasRenderingContext2D, kit: Kit, x: number, y: number, r: number): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const sp = typeof document !== "undefined" ? kitSprite(kit, r, dpr) : null;
  if (!sp) {
    ctx.fillStyle = kit.primary;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const s = sp.canvas.width / sp.dpr;
  ctx.drawImage(sp.canvas, x - s / 2, y - s / 2, s, s);
}

// ---------------------------------------------------------------- colour maths

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (0..1) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const c = rgb(hex).map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => x / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  const h = (c: number) => f(c).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
