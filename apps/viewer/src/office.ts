/**
 * 감독실: the home screen as a place instead of a page. A canvas paints the room and the window onto our
 * ground (time of day, weather, floodlights, the crowd), and DOM hotspots sit on the objects a manager
 * would actually touch: the board, the folder, the paper, the phone, the cabinet, the youth photo.
 *
 * Everything is drawn from the game state, so the room reports the season back: the walls and the desk
 * improve with the manager's reputation, the trophies on the shelf are the ones we won, the window shows
 * the ground as it stands now (an expansion makes the stands deeper), and the weather is the fixture's.
 *
 * The scene is deliberately cheap: gradients, silhouettes and a few hundred particles at 30 fps, paused
 * whenever the room is off screen. No new art files.
 */
import type { GameState } from "@3sec/game";

export type OfficeAct = "match" | "squad" | "table" | "transfers" | "youth" | "records";

export interface OfficeSpot {
  act: OfficeAct;
  label: string;
  sub: string;
  /** hit box in canvas-normalised coordinates (0..1) */
  x: number; y: number; w: number; h: number;
  hot?: boolean;
}

export interface OfficeLook {
  /** 0 the concrete room, 1 the painted one, 2 the panelled one */
  tier: 0 | 1 | 2;
  club: string;
  grass: string;
  /** 0..1, how full the ground is */
  crowd: number;
  capacity: number;
  night: boolean;
  weather: "clear" | "cloud" | "rain" | "snow";
  trophies: number;
  /** the ground's name, printed on the window sill */
  ground: string;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Where everything sits, in 0..1 of the canvas. The painter and the hit boxes both read this. */
export const L = {
  window: { x: 0.30, y: 0.045, w: 0.66, h: 0.40 },
  board: { x: 0.035, y: 0.055, w: 0.245, h: 0.215 },
  photo: { x: 0.035, y: 0.30, w: 0.245, h: 0.145 },
  cabinet: { x: 0.035, y: 0.475, w: 0.145, h: 0.135 },
  shelf: { x: 0.33, y: 0.525, w: 0.34 },
  deskTop: 0.615,
  folder: { x: 0.055, y: 0.655, w: 0.255, h: 0.20 },
  paper: { x: 0.345, y: 0.685, w: 0.29, h: 0.185 },
  phone: { x: 0.675, y: 0.655, w: 0.215, h: 0.185 },
  mug: { x: 0.915, y: 0.700, w: 0.05, h: 0.075 },
} as const;

/** A deterministic 0..1 from a few integers: the same round always has the same sky. */
function hash01(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) { h ^= Math.imul(x | 0, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; }
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
}

/** Hex to rgb, tolerant of #abc and #aabbcc. */
function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}
const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = rgb(a), [br, bg, bb] = rgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * clamp(t, 0, 1));
  return `rgb(${f(ar, br)},${f(ag, bg)},${f(ab, bb)})`;
};
const shade = (hex: string, t: number): string => (t < 0 ? mix(hex, "#000000", -t) : mix(hex, "#ffffff", t));

/** The room, read off the state. */
export function officeLook(s: GameState, rep: number, trophies: number): OfficeLook {
  const me = s.clubs[s.userClub]!;
  const round = s.round;
  const w = hash01(s.seed, s.season, round, 7);
  const winter = round >= 10 && round <= 15;
  const weather: OfficeLook["weather"] = w > 0.86 ? (winter ? "snow" : "rain") : w > 0.55 ? "cloud" : "clear";
  return {
    tier: rep >= 13 ? 2 : rep >= 9 ? 1 : 0,
    club: me.color,
    grass: "#2f7d3a",
    crowd: clamp((me.fans?.mood ?? 55) / 100 + 0.25, 0.2, 1),
    capacity: me.capacity ?? 20000,
    night: hash01(s.seed, s.season, round, 11) > 0.45,
    weather,
    trophies: Math.min(6, trophies),
    ground: me.stadiumName || "홈 구장",
  };
}

/** The objects on the desk and the walls, in canvas-normalised coordinates. */
export function officeSpots(hasMatch: boolean): OfficeSpot[] {
  return [
    { act: "match", label: hasMatch ? "다음 경기" : "일정", sub: "", ...L.board, hot: hasMatch },
    { act: "youth", label: "유스", sub: "", ...L.photo },
    { act: "records", label: "기록실", sub: "", ...L.cabinet },
    { act: "squad", label: "스쿼드", sub: "", ...L.folder },
    { act: "table", label: "순위", sub: "", ...L.paper },
    { act: "transfers", label: "이적", sub: "", ...L.phone },
  ];
}

interface Drop { x: number; y: number; v: number; len: number }

/** Paints the room. One instance per canvas; `set` swaps the look, `start`/`stop` own the frame loop. */
export class OfficeScene {
  private ctx: CanvasRenderingContext2D | null;
  private look: OfficeLook | null = null;
  private raf = 0;
  private last = 0;
  private t = 0;
  private drops: Drop[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  set(look: OfficeLook): void {
    this.look = look;
    this.drops = [];
    const n = look.weather === "rain" ? 150 : look.weather === "snow" ? 90 : 0;
    for (let i = 0; i < n; i++) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.35 + Math.random() * 0.5, len: 0.02 + Math.random() * 0.03 });
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.paint();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts;
      this.t += dt;
      this.step(dt);
      this.paint();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private step(dt: number): void {
    const fall = this.look?.weather === "snow" ? 0.12 : 0.9;
    for (const d of this.drops) {
      d.y += d.v * fall * dt;
      if (this.look?.weather === "snow") d.x += Math.sin((this.t + d.y * 6) * 1.2) * 0.02 * dt;
      if (d.y > 1) { d.y = -0.05; d.x = Math.random(); }
    }
  }

  // ---------------------------------------------------------------- painting

  private paint(): void {
    const ctx = this.ctx, look = this.look;
    if (!ctx || !look || !this.w) return;
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.paintWall(ctx, look, w, h);
    this.paintWindow(ctx, look, w, h);
    this.paintWallThings(ctx, look, w, h);
    this.paintDesk(ctx, look, w, h);
    this.paintLamp(ctx, look, w, h);
    this.paintVignette(ctx, w, h);
  }

  /** The room behind everything: concrete, painted or panelled, tinted towards the club's colour. */
  private paintWall(ctx: CanvasRenderingContext2D, look: OfficeLook, w: number, h: number): void {
    const base = look.tier === 2 ? "#2a1c12" : look.tier === 1 ? "#1a222a" : "#171b1f";
    const top = mix(base, look.club, look.tier === 2 ? 0.06 : 0.12);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, shade(top, -0.15));
    g.addColorStop(1, shade(base, -0.45));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (look.tier === 2) {
      // wood panelling: vertical seams with a warm highlight
      ctx.save();
      ctx.globalAlpha = 0.25;
      for (let x = 0; x < w; x += Math.max(26, w / 14)) {
        ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(x, 0, 1.5, h * 0.62);
        ctx.fillStyle = "rgba(255,220,170,.10)"; ctx.fillRect(x + 1.5, 0, 1, h * 0.62);
      }
      ctx.restore();
    }
  }

  /** The window: sky, floodlights, stands seen from above, the pitch in perspective, weather on the glass. */
  private paintWindow(ctx: CanvasRenderingContext2D, look: OfficeLook, w: number, h: number): void {
    const x = w * L.window.x, y = h * L.window.y, ww = w * L.window.w, wh = h * L.window.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, ww, wh);
    ctx.clip();

    // sky
    const sky = ctx.createLinearGradient(0, y, 0, y + wh);
    if (look.night) { sky.addColorStop(0, "#070f1c"); sky.addColorStop(0.7, "#12233a"); sky.addColorStop(1, "#1b3350"); }
    else if (look.weather === "rain") { sky.addColorStop(0, "#2c3945"); sky.addColorStop(1, "#5d6d79"); }
    else if (look.weather === "snow") { sky.addColorStop(0, "#3b4a58"); sky.addColorStop(1, "#8b96a1"); }
    else if (look.weather === "cloud") { sky.addColorStop(0, "#425a70"); sky.addColorStop(1, "#8ba0b0"); }
    else { sky.addColorStop(0, "#1f4e7d"); sky.addColorStop(0.6, "#6f9bbd"); sky.addColorStop(1, "#c6d6e0"); }
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, ww, wh);

    if (look.night) {
      // a few stars, thinned by cloud
      ctx.fillStyle = "rgba(255,255,255,.5)";
      for (let i = 0; i < 40; i++) {
        const sxp = hash01(i, 3), syp = hash01(i, 9);
        if (hash01(i, 17) > 0.6) continue;
        ctx.globalAlpha = 0.15 + hash01(i, 23) * 0.4;
        ctx.fillRect(x + sxp * ww, y + syp * wh * 0.45, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    } else if (look.weather === "clear") {
      const cx = x + ww * 0.78, cy = y + wh * 0.24, r = Math.min(ww, wh) * 0.28;
      const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gl.addColorStop(0, "rgba(255,232,180,.55)");
      gl.addColorStop(1, "rgba(255,232,180,0)");
      ctx.fillStyle = gl; ctx.fillRect(x, y, ww, wh);
    }

    // ---- the ground, seen from the office: a bowl in perspective
    const horizon = y + wh * 0.42;
    const deep = clamp(look.capacity / 45000, 0.4, 1);
    const roofH = wh * 0.10 * deep;
    // far stand: roof, then seats in club colour with a crowd of speckles
    ctx.fillStyle = shade(look.club, -0.78);
    ctx.fillRect(x, horizon - roofH, ww, roofH);
    ctx.fillStyle = "rgba(255,255,255,.05)";
    ctx.fillRect(x, horizon - roofH, ww, 2);
    const seatsH = wh * 0.16;
    const sg = ctx.createLinearGradient(0, horizon, 0, horizon + seatsH);
    // by day the seats catch the light, at night they fall away and only the crowd shows
    const seat = mix(look.club, "#3d4750", 0.5);
    sg.addColorStop(0, shade(seat, look.night ? -0.45 : -0.10));
    sg.addColorStop(1, shade(seat, look.night ? -0.25 : 0.14));
    ctx.fillStyle = sg;
    ctx.fillRect(x, horizon, ww, seatsH);
    for (let i = 0; i < 9; i++) {
      const ry = horizon + (i / 9) * seatsH;
      for (let j = 0; j < 70; j++) {
        const seed = hash01(i * 71 + j, i + 3);
        if (seed > look.crowd) continue;
        ctx.fillStyle = look.night
          ? (seed > 0.82 ? "rgba(255,255,255,.32)" : `rgba(235,244,250,${0.07 + seed * 0.14})`)
          : (seed > 0.82 ? "rgba(20,26,32,.55)" : `rgba(24,30,38,${0.18 + seed * 0.22})`);
        ctx.fillRect(x + (j / 70) * ww + (i % 2) * 1.5, ry, 2, 1.8);
      }
    }
    // floodlights stand behind the far roof
    for (const px of [0.14, 0.86]) {
      const fx = x + ww * px, fy = horizon - roofH - wh * 0.26;
      ctx.strokeStyle = "rgba(8,12,16,.9)"; ctx.lineWidth = Math.max(1.5, ww * 0.007);
      ctx.beginPath(); ctx.moveTo(fx, horizon - roofH); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = look.night ? "#fff6da" : "rgba(214,226,236,.75)";
      ctx.fillRect(fx - ww * 0.032, fy - wh * 0.035, ww * 0.064, wh * 0.035);
      if (look.night) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const cone = ctx.createLinearGradient(fx, fy, fx, y + wh);
        cone.addColorStop(0, "rgba(255,240,205,.16)");
        cone.addColorStop(0.5, "rgba(255,240,205,.06)");
        cone.addColorStop(1, "rgba(255,240,205,0)");
        ctx.fillStyle = cone;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - ww * 0.55, y + wh); ctx.lineTo(fx + ww * 0.55, y + wh); ctx.closePath(); ctx.fill();
        const bulb = ctx.createRadialGradient(fx, fy - wh * 0.02, 0, fx, fy - wh * 0.02, wh * 0.13);
        bulb.addColorStop(0, "rgba(255,247,220,.55)"); bulb.addColorStop(1, "rgba(255,247,220,0)");
        ctx.fillStyle = bulb; ctx.beginPath(); ctx.arc(fx, fy - wh * 0.02, wh * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // near stands: darker wedges at both edges, which gives the bowl its depth
    const pitchTop = horizon + seatsH;
    ctx.fillStyle = shade(look.club, -0.68);
    ctx.beginPath(); ctx.moveTo(x, pitchTop); ctx.lineTo(x + ww * 0.10, pitchTop); ctx.lineTo(x, y + wh); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + ww, pitchTop); ctx.lineTo(x + ww * 0.90, pitchTop); ctx.lineTo(x + ww, y + wh); ctx.closePath(); ctx.fill();

    // the pitch: a trapezoid, mown in bands that widen towards us
    const pg = ctx.createLinearGradient(0, pitchTop, 0, y + wh);
    pg.addColorStop(0, shade(look.grass, look.night ? -0.42 : -0.12));
    pg.addColorStop(1, shade(look.grass, look.night ? -0.18 : 0.10));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + ww * 0.10, pitchTop);
    ctx.lineTo(x + ww * 0.90, pitchTop);
    ctx.lineTo(x + ww, y + wh);
    ctx.lineTo(x, y + wh);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = pg;
    ctx.fillRect(x, pitchTop, ww, y + wh - pitchTop);
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 7; i++) {
      if (i % 2) continue;
      ctx.fillStyle = "#ffffff";
      const t0 = i / 7, t1 = (i + 1) / 7;
      ctx.beginPath();
      ctx.moveTo(x + ww * (0.10 + t0 * 0.80), pitchTop);
      ctx.lineTo(x + ww * (0.10 + t1 * 0.80), pitchTop);
      ctx.lineTo(x + ww * t1, y + wh);
      ctx.lineTo(x + ww * t0, y + wh);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // far touchline and the top of the box
    ctx.strokeStyle = "rgba(255,255,255,.34)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x + ww * 0.105, pitchTop + 2); ctx.lineTo(x + ww * 0.895, pitchTop + 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + ww * 0.32, pitchTop + 2); ctx.lineTo(x + ww * 0.30, pitchTop + wh * 0.085);
    ctx.lineTo(x + ww * 0.70, pitchTop + wh * 0.085); ctx.lineTo(x + ww * 0.68, pitchTop + 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(x + ww * 0.5, y + wh * 0.95);
    ctx.scale(1, 0.28);
    ctx.beginPath(); ctx.arc(0, 0, ww * 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.restore();

    // weather on the glass
    if (this.drops.length) {
      ctx.save();
      if (look.weather === "rain") {
        ctx.strokeStyle = "rgba(205,224,238,.4)"; ctx.lineWidth = 1;
        for (const d of this.drops) {
          const dx = x + d.x * ww, dy = y + d.y * wh;
          ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - ww * 0.012, dy + wh * d.len); ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(255,255,255,.7)";
        for (const d of this.drops) ctx.fillRect(x + d.x * ww, y + d.y * wh, 2.2, 2.2);
      }
      ctx.restore();
    }

    // the glass itself: a diagonal sheen and the room's reflection
    ctx.save();
    ctx.globalAlpha = 0.09;
    const refl = ctx.createLinearGradient(x, y, x + ww * 0.7, y + wh);
    refl.addColorStop(0, "#ffffff"); refl.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = refl; ctx.fillRect(x, y, ww, wh);
    ctx.restore();
    ctx.restore();

    // ---- frame: outer, transom and mullion, then the sill
    const frameC = look.tier === 2 ? "#3f2a19" : "#10161c";
    ctx.strokeStyle = frameC;
    ctx.lineWidth = Math.max(5, w * 0.014);
    ctx.strokeRect(x, y, ww, wh);
    ctx.fillStyle = frameC;
    ctx.fillRect(x, y + wh * 0.34, ww, Math.max(2.5, w * 0.005));
    ctx.fillRect(x + ww * 0.5 - Math.max(1.5, w * 0.0025), y, Math.max(3, w * 0.005), wh);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y + 2, ww - 4, wh - 4);
    ctx.restore();
    const sillH = h * 0.036;
    const sillG = ctx.createLinearGradient(0, y + wh, 0, y + wh + sillH);
    sillG.addColorStop(0, look.tier === 2 ? "#6a4728" : "#1d262e");
    sillG.addColorStop(1, look.tier === 2 ? "#3a2716" : "#0f151b");
    ctx.fillStyle = sillG;
    ctx.fillRect(x - w * 0.014, y + wh, ww + w * 0.028, sillH);
    ctx.save();
    ctx.fillStyle = "rgba(215,228,238,.65)";
    ctx.font = `600 ${Math.max(9, Math.round(h * 0.026))}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(`${look.ground} · ${look.capacity.toLocaleString("ko-KR")}석`, x + ww - 8, y + wh + sillH / 2 + 1);
    ctx.restore();
  }

  /** What hangs on the walls: the tactics board, the youth photo, the cabinet, the trophy shelf. */
  private paintWallThings(ctx: CanvasRenderingContext2D, look: OfficeLook, w: number, h: number): void {
    // tactics board (left)
    const bx = w * L.board.x, by = h * L.board.y, bw = w * L.board.w, bh = h * L.board.h;
    ctx.fillStyle = "#0f1a14"; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = look.tier === 2 ? "#5a4227" : "#2a3640"; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
    ctx.save();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = "#cfe6d6"; ctx.lineWidth = 1;
    ctx.strokeRect(bx + bw * 0.10, by + bh * 0.14, bw * 0.80, bh * 0.72);
    ctx.beginPath(); ctx.moveTo(bx + bw * 0.5, by + bh * 0.14); ctx.lineTo(bx + bw * 0.5, by + bh * 0.86); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + bw * 0.5, by + bh * 0.5, bh * 0.12, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = look.club;
    for (const [mx, my] of [[0.26, 0.32], [0.26, 0.66], [0.40, 0.5], [0.62, 0.35], [0.62, 0.65], [0.74, 0.5]] as [number, number][]) {
      ctx.beginPath(); ctx.arc(bx + bw * mx, by + bh * my, Math.max(2.5, bh * 0.05), 0, Math.PI * 2); ctx.fill();
    }

    // youth photo (right, top)
    const px = w * L.photo.x, py = h * L.photo.y, pw = w * L.photo.w, ph = h * L.photo.h;
    ctx.fillStyle = look.tier === 2 ? "#6b4c2a" : "#26313b"; ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
    const pg = ctx.createLinearGradient(0, py, 0, py + ph);
    pg.addColorStop(0, shade(look.grass, 0.1)); pg.addColorStop(1, shade(look.grass, -0.4));
    ctx.fillStyle = pg; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = "rgba(10,14,18,.75)";
    for (let i = 0; i < 7; i++) ctx.fillRect(px + pw * (0.10 + i * 0.115), py + ph * 0.45, pw * 0.055, ph * 0.35);

    // filing cabinet (right, below the photo)
    const cx = w * L.cabinet.x, cy = h * L.cabinet.y, cw = w * L.cabinet.w, ch = h * L.cabinet.h;
    const cg = ctx.createLinearGradient(cx, 0, cx + cw, 0);
    cg.addColorStop(0, "#242c34"); cg.addColorStop(0.55, "#333e48"); cg.addColorStop(1, "#1c232a");
    ctx.fillStyle = cg; ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    for (let i = 0; i < 3; i++) ctx.fillRect(cx + cw * 0.12, cy + ch * (0.16 + i * 0.28), cw * 0.76, 2);
    ctx.fillStyle = "#8c98a3";
    for (let i = 0; i < 3; i++) ctx.fillRect(cx + cw * 0.40, cy + ch * (0.22 + i * 0.28), cw * 0.20, 3);

    // trophy shelf, once the room has earned one
    if (look.tier >= 1) {
      const sx = w * L.shelf.x, sy = h * L.shelf.y, sw = w * L.shelf.w;
      ctx.fillStyle = look.tier === 2 ? "#5a4227" : "#28323b";
      ctx.fillRect(sx, sy, sw, Math.max(4, h * 0.012));
      for (let i = 0; i < look.trophies; i++) {
        const tx = sx + sw * (0.10 + i * 0.14), ty = sy;
        ctx.fillStyle = "#e8c66a";
        ctx.beginPath(); ctx.moveTo(tx - 5, ty - 14); ctx.lineTo(tx + 5, ty - 14); ctx.lineTo(tx + 2, ty - 3); ctx.lineTo(tx - 2, ty - 3); ctx.closePath(); ctx.fill();
        ctx.fillRect(tx - 4, ty - 3, 8, 3);
      }
    }
  }

  /** The desk itself and what lies on it: blotter, folder, paper, phone, pen, mug. */
  private paintDesk(ctx: CanvasRenderingContext2D, look: OfficeLook, w: number, h: number): void {
    const dy = h * L.deskTop;
    const top = look.tier === 2 ? "#6d4a24" : look.tier === 1 ? "#3d322a" : "#31353b";
    // the desk edge catches the lamp; the surface falls away into the dark
    const g = ctx.createLinearGradient(0, dy, 0, h);
    g.addColorStop(0, shade(top, 0.18));
    g.addColorStop(0.06, top);
    g.addColorStop(1, shade(top, -0.55));
    ctx.fillStyle = g;
    ctx.fillRect(0, dy, w, h - dy);
    ctx.fillStyle = "rgba(255,236,200,.20)";
    ctx.fillRect(0, dy, w, 2);
    if (look.tier === 2) {
      ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = "#2a1a0c"; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const yy = dy + (h - dy) * (0.15 + i * 0.12);
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.bezierCurveTo(w * 0.3, yy - 3, w * 0.7, yy + 3, w, yy); ctx.stroke();
      }
      ctx.restore();
    }
    // blotter
    ctx.save();
    const bl = ctx.createLinearGradient(0, dy + h * 0.03, 0, dy + h * 0.33);
    bl.addColorStop(0, "rgba(24,18,14,.55)"); bl.addColorStop(1, "rgba(10,8,6,.35)");
    ctx.fillStyle = bl;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(w * 0.03, dy + h * 0.03, w * 0.62, h * 0.30, 6); else ctx.rect(w * 0.03, dy + h * 0.03, w * 0.62, h * 0.30);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,225,180,.10)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();

    const shadow = (x: number, y: number, ww: number, hh: number) => {
      ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = "#000";
      ctx.filter = "blur(4px)";
      ctx.fillRect(x + 3, y + 5, ww, hh);
      ctx.filter = "none"; ctx.restore();
    };

    // squad folder
    const fx = w * L.folder.x, fy = h * L.folder.y, fw = w * L.folder.w, fh = h * L.folder.h;
    ctx.save();
    ctx.translate(fx + fw / 2, fy + fh / 2); ctx.rotate(-0.05); ctx.translate(-fw / 2, -fh / 2);
    shadow(0, 0, fw, fh);
    const fg = ctx.createLinearGradient(0, 0, fw, fh);
    fg.addColorStop(0, shade(look.club, -0.10)); fg.addColorStop(1, shade(look.club, -0.38));
    ctx.fillStyle = fg; ctx.fillRect(0, 0, fw, fh);
    ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(0, 0, fw, fh * 0.06);
    // a label and a couple of sheets poking out
    ctx.fillStyle = "#f2f5f7"; ctx.fillRect(fw * 0.08, fh * 0.14, fw * 0.5, fh * 0.16);
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(fw * 0.62, -fh * 0.05, fw * 0.3, fh * 0.09);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    for (let i = 0; i < 3; i++) ctx.fillRect(fw * 0.08, fh * (0.48 + i * 0.15), fw * (0.66 - i * 0.14), fh * 0.05);
    ctx.restore();

    // newspaper
    const nx = w * L.paper.x, ny = h * L.paper.y, nw = w * L.paper.w, nh = h * L.paper.h;
    ctx.save();
    ctx.translate(nx + nw / 2, ny + nh / 2); ctx.rotate(0.045); ctx.translate(-nw / 2, -nh / 2);
    shadow(0, 0, nw, nh);
    ctx.fillStyle = "#ded8ca"; ctx.fillRect(0, 0, nw, nh);
    ctx.fillStyle = "#c9c2b2"; ctx.fillRect(nw * 0.5, 0, 1.5, nh);
    ctx.fillStyle = "#23231f"; ctx.fillRect(nw * 0.06, nh * 0.10, nw * 0.42, nh * 0.16);
    ctx.fillStyle = "rgba(35,35,31,.45)";
    for (let i = 0; i < 6; i++) ctx.fillRect(nw * 0.06, nh * (0.36 + i * 0.10), nw * (0.40 - (i % 2) * 0.08), nh * 0.045);
    for (let i = 0; i < 6; i++) ctx.fillRect(nw * 0.54, nh * (0.20 + i * 0.10), nw * (0.40 - ((i + 1) % 2) * 0.08), nh * 0.045);
    ctx.restore();

    // telephone: base, handset and a coiled cord
    const tx = w * L.phone.x, ty = h * L.phone.y, tw = w * L.phone.w, th = h * L.phone.h;
    shadow(tx + tw * 0.06, ty + th * 0.40, tw * 0.88, th * 0.5);
    ctx.fillStyle = "#1b2129"; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx + tw * 0.06, ty + th * 0.42, tw * 0.88, th * 0.48, 5); else ctx.rect(tx + tw * 0.06, ty + th * 0.42, tw * 0.88, th * 0.48);
    ctx.fill();
    ctx.fillStyle = shade(look.club, -0.1);
    ctx.fillRect(tx + tw * 0.20, ty + th * 0.62, tw * 0.60, th * 0.10);
    ctx.fillStyle = "#0f141a"; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx, ty + th * 0.12, tw, th * 0.30, 7); else ctx.rect(tx, ty + th * 0.12, tw, th * 0.30);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.10)"; ctx.fillRect(tx + tw * 0.08, ty + th * 0.15, tw * 0.84, 2);
    ctx.strokeStyle = "rgba(15,20,26,.9)"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const cxp = tx + tw * (0.95 + Math.sin(i * 1.1) * 0.05), cyp = ty + th * (0.55 + i * 0.03);
      if (i === 0) ctx.moveTo(cxp, cyp); else ctx.lineTo(cxp, cyp);
    }
    ctx.stroke();

    // a pen resting on the blotter
    ctx.save();
    ctx.translate(w * 0.335, h * (L.deskTop + 0.045)); ctx.rotate(-0.5);
    ctx.fillStyle = "#1b222a"; ctx.fillRect(0, 0, w * 0.075, 4);
    ctx.fillStyle = "#c9a24a"; ctx.fillRect(w * 0.075, 0, w * 0.014, 4);
    ctx.restore();

    // mug with steam
    const mx = w * L.mug.x, my = h * L.mug.y;
    shadow(mx, my + h * L.mug.h * 0.7, w * L.mug.w, h * 0.02);
    ctx.fillStyle = "#dce4ea"; ctx.fillRect(mx, my, w * L.mug.w, h * L.mug.h);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(mx + w * L.mug.w * 0.62, my, w * L.mug.w * 0.38, h * L.mug.h);
    ctx.strokeStyle = "#dce4ea"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(mx + w * L.mug.w, my + h * L.mug.h * 0.4, h * 0.016, -1.2, 1.2); ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const ph = ((this.t * 0.35 + i / 3) % 1);
      const sy = my - h * 0.006 - ph * h * 0.06;
      const sx = mx + w * L.mug.w * 0.5 + Math.sin(this.t * 0.9 + i * 2.1) * w * 0.008;
      const r = w * (0.012 + ph * 0.014);
      const gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      gg.addColorStop(0, `rgba(255,255,255,${0.10 * (1 - ph)})`);
      gg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** The desk lamp: the warm pool of light that makes the room a room. */
  private paintLamp(ctx: CanvasRenderingContext2D, look: OfficeLook, w: number, h: number): void {
    const lx = w * 0.055, ly = h * (L.deskTop - 0.02);
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, w * 0.55);
    g.addColorStop(0, "rgba(255,214,140,.30)");
    g.addColorStop(0.45, "rgba(255,196,110,.10)");
    g.addColorStop(1, "rgba(255,196,110,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (look.tier >= 1) {
      ctx.fillStyle = "#2a3037";
      const ly0 = h * (L.deskTop - 0.02);
      ctx.fillRect(lx - w * 0.012, ly0, w * 0.024, h * 0.02);
      ctx.beginPath(); ctx.moveTo(lx - w * 0.05, ly0 - h * 0.055); ctx.lineTo(lx + w * 0.05, ly0 - h * 0.055); ctx.lineTo(lx + w * 0.028, ly0); ctx.lineTo(lx - w * 0.028, ly0); ctx.closePath(); ctx.fill();
    }
  }

  private paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.25, w / 2, h * 0.55, Math.max(w, h) * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
