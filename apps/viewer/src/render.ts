import { PITCH } from "@3sec/engine";
import { DEFAULT_STADIUM, stadiumKey, type Stadium } from "./stadiums";

export interface View {
  w: number;
  h: number;
  scale: number; // px per meter
  ox: number; // px of x=0
  oy: number; // px of y=0
}

/** grass apron beyond the touch/goal lines (m) */
const APRON = 1.6;
/** ad-board band: distance from the touchline and its height (m) */
const BOARD_GAP = 1.9;
const BOARD_H = 0.85;

/**
 * Static stadium painting (surround, grass, boards, lines, vignette) is rendered once per
 * (stadium, canvas size, dpr) into an offscreen canvas and blitted every frame.
 */
interface CacheEntry {
  key: string;
  canvas: HTMLCanvasElement;
}
const cache: CacheEntry[] = [];
const CACHE_MAX = 4;

export function drawPitch(ctx: CanvasRenderingContext2D, v: View, stadium: Stadium = DEFAULT_STADIUM): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const key = stadiumKey(stadium, v.w, v.h, dpr);
  let hit = cache.find((c) => c.key === key);
  if (!hit) {
    const off = makeCanvas(Math.max(1, Math.round(v.w * dpr)), Math.max(1, Math.round(v.h * dpr)));
    const octx = off?.getContext("2d");
    if (!off || !octx) {
      paintStadium(ctx, v, stadium);
      return;
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintStadium(octx, v, stadium);
    hit = { key, canvas: off };
    cache.push(hit);
    if (cache.length > CACHE_MAX) cache.shift();
  }
  ctx.drawImage(hit.canvas, 0, 0, v.w, v.h);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Full static painting; draws directly on `ctx` (used for the cache and as a fallback). */
export function paintStadium(ctx: CanvasRenderingContext2D, v: View, stadium: Stadium): void {
  const { scale, ox, oy } = v;
  const hl = PITCH.halfLength;
  const hw = PITCH.halfWidth;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;

  // --- Surround: stands (club tone) or an athletics track ---------------------------------
  ctx.fillStyle = stadium.surround.color;
  ctx.fillRect(0, 0, v.w, v.h);
  if (stadium.surround.track) {
    // lane lines around the apron
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(1, 0.08 * scale);
    for (let i = 0; i < 3; i++) {
      const m = APRON + 0.9 + i * 1.1;
      roundedRect(ctx, X(-hl - m), Y(-hw - m), (PITCH.length + 2 * m) * scale, (PITCH.width + 2 * m) * scale, 2.2 * scale);
      ctx.stroke();
    }
  } else {
    // faint stand rows: a few lighter bands toward the edge give the surround some depth
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 3; i++) {
      const m = APRON + 1.2 + i * 0.9;
      ctx.fillRect(X(-hl - m), Y(-hw - m), (PITCH.length + 2 * m) * scale, Math.max(1, 0.35 * scale));
      ctx.fillRect(X(-hl - m), Y(hw + m), (PITCH.length + 2 * m) * scale, Math.max(1, 0.35 * scale));
    }
  }

  // --- Grass apron + mow pattern ------------------------------------------------------------
  const gx0 = X(-hl - APRON);
  const gy0 = Y(-hw - APRON);
  const gw = (PITCH.length + 2 * APRON) * scale;
  const gh = (PITCH.width + 2 * APRON) * scale;
  ctx.fillStyle = stadium.grass.a;
  ctx.fillRect(gx0, gy0, gw, gh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx0, gy0, gw, gh);
  ctx.clip();
  ctx.fillStyle = stadium.grass.b;
  paintMow(ctx, v, stadium);
  ctx.restore();

  // --- Ad boards at both touchlines ---------------------------------------------------------
  paintBoards(ctx, v, stadium);

  // --- Lines (geometry unchanged) -------------------------------------------------------------
  const line = stadium.grass.line;
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = Math.max(1, 0.12 * scale);
  ctx.lineJoin = "round";

  // Outline & halfway line
  ctx.strokeRect(X(-hl), Y(-hw), PITCH.length * scale, PITCH.width * scale);
  ctx.beginPath();
  ctx.moveTo(X(0), Y(-hw));
  ctx.lineTo(X(0), Y(hw));
  ctx.stroke();

  // Centre circle & spot
  ctx.beginPath();
  ctx.arc(X(0), Y(0), PITCH.centerCircleRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Y(0), 0.2 * scale, 0, Math.PI * 2);
  ctx.fill();

  for (const side of [-1, 1] as const) {
    const gx = hl * side;
    // Penalty area
    const pa = PITCH.penaltyAreaDepth * side;
    ctx.strokeRect(
      Math.min(X(gx), X(gx - pa)),
      Y(-PITCH.penaltyAreaHalfWidth),
      PITCH.penaltyAreaDepth * scale,
      PITCH.penaltyAreaHalfWidth * 2 * scale,
    );
    // Goal area
    const ga = PITCH.goalAreaDepth * side;
    ctx.strokeRect(
      Math.min(X(gx), X(gx - ga)),
      Y(-PITCH.goalAreaHalfWidth),
      PITCH.goalAreaDepth * scale,
      PITCH.goalAreaHalfWidth * 2 * scale,
    );
    // Penalty spot
    const ps = (hl - PITCH.penaltySpotDist) * side;
    ctx.beginPath();
    ctx.arc(X(ps), Y(0), 0.2 * scale, 0, Math.PI * 2);
    ctx.fill();
    // Penalty arc (outside the box only)
    ctx.beginPath();
    const r = PITCH.centerCircleRadius * scale;
    const dx = (PITCH.penaltyAreaDepth - PITCH.penaltySpotDist) * scale;
    const ang = Math.acos(dx / r);
    if (side === 1) ctx.arc(X(ps), Y(0), r, Math.PI - ang, Math.PI + ang);
    else ctx.arc(X(ps), Y(0), r, -ang, ang);
    ctx.stroke();
    // Goal
    const gd = PITCH.goalDepth * side;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(Math.min(X(gx), X(gx + gd)), Y(-PITCH.goalHalfWidth), PITCH.goalDepth * scale, PITCH.goalWidth * scale);
    ctx.strokeRect(Math.min(X(gx), X(gx + gd)), Y(-PITCH.goalHalfWidth), PITCH.goalDepth * scale, PITCH.goalWidth * scale);
    ctx.fillStyle = line;
    // Corner arcs
    for (const sy of [-1, 1] as const) {
      ctx.beginPath();
      const cx = X(gx);
      const cy = Y(hw * sy);
      const start = side === 1 ? (sy === 1 ? Math.PI : Math.PI / 2) : sy === 1 ? -Math.PI / 2 : 0;
      ctx.arc(cx, cy, PITCH.cornerArcRadius * scale, start, start + Math.PI / 2);
      ctx.stroke();
    }
  }

  // --- Atmosphere vignette: darker edges for louder grounds -----------------------------------
  const a = 0.12 + 0.3 * stadium.atmosphere;
  const rMax = Math.hypot(v.w, v.h) / 2;
  const grad = ctx.createRadialGradient(ox, oy, rMax * 0.55, ox, oy, rMax);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, `rgba(0,0,0,${a.toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, v.w, v.h);
}

/** Second-tone mow pattern; caller has set fillStyle to grass.b and clipped to the grass rect. */
function paintMow(ctx: CanvasRenderingContext2D, v: View, stadium: Stadium): void {
  const { scale, ox, oy } = v;
  const hl = PITCH.halfLength + APRON;
  const hw = PITCH.halfWidth + APRON;
  const L = 2 * hl;
  const W = 2 * hw;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;
  switch (stadium.pattern) {
    case "lengthwise": {
      const n = 12;
      const sw = L / n;
      for (let i = 0; i < n; i += 2) ctx.fillRect(X(-hl + i * sw), Y(-hw), sw * scale + 0.5, W * scale);
      break;
    }
    case "crosswise": {
      const n = 8;
      const sh = W / n;
      for (let j = 0; j < n; j += 2) ctx.fillRect(X(-hl), Y(-hw + j * sh), L * scale, sh * scale + 0.5);
      break;
    }
    case "checker": {
      const nx = 12;
      const ny = 8;
      const sw = L / nx;
      const sh = W / ny;
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++)
          if ((i + j) % 2 === 0) ctx.fillRect(X(-hl + i * sw), Y(-hw + j * sh), sw * scale + 0.5, sh * scale + 0.5);
      break;
    }
    case "diagonal": {
      const sw = 6; // m, measured perpendicular to the stripe
      const diag = Math.hypot(L, W);
      ctx.save();
      ctx.translate(X(0), Y(0));
      ctx.rotate(-Math.PI / 4);
      const n = Math.ceil(diag / sw) + 2;
      for (let i = -n; i <= n; i += 2) ctx.fillRect(i * sw * scale, (-diag / 2) * scale, sw * scale + 0.5, diag * scale);
      ctx.restore();
      break;
    }
    case "circles": {
      const step = 5.5; // m per ring
      const rMax = Math.hypot(hl, hw);
      for (let r = rMax + step; r > 0; r -= step) {
        ctx.fillStyle = Math.round(r / step) % 2 === 0 ? stadium.grass.b : stadium.grass.a;
        ctx.beginPath();
        ctx.arc(X(0), Y(0), r * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

function paintBoards(ctx: CanvasRenderingContext2D, v: View, stadium: Stadium): void {
  const { scale, ox, oy } = v;
  const hl = PITCH.halfLength;
  const hw = PITCH.halfWidth;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;
  // Boards keep a legible minimum height in px; on small canvases the gap to the touchline
  // shrinks so the band still fits inside the 4 m margin the view reserves.
  const bh = Math.max(9, BOARD_H * scale);
  const gap = Math.min(BOARD_GAP * scale, Math.max(1, 4 * scale - bh - 1.5));
  const bw = (PITCH.length + 2 * APRON) * scale;
  const bx = X(-hl - APRON);
  const label = ` ${stadium.shortName} `;
  const fontPx = bh * 0.78;
  ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const unit = Math.max(1, ctx.measureText(label).width) + fontPx * 1.6;
  for (const sy of [-1, 1] as const) {
    const by = sy < 0 ? Y(-hw) - gap - bh : Y(hw) + gap;
    ctx.fillStyle = stadium.accent;
    ctx.fillRect(bx, by, bw, bh);
    // subtle top/bottom rim so the band reads as a board, not a line
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(bx, by + bh - Math.max(1, bh * 0.12), bw, Math.max(1, bh * 0.12));
    if (fontPx < 6.5) continue; // too small to read; keep the band only
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();
    ctx.fillStyle = textOn(stadium.accent);
    const cy = by + bh / 2;
    for (let x = bx + fontPx * 0.5; x < bx + bw; x += unit) ctx.fillText(label, x, cy);
    ctx.restore();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Dark or light text depending on the band's luminance. */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return "rgba(255,255,255,0.9)";
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.92)";
}
