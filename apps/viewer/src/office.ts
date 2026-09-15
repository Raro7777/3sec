/**
 * 감독실: the home screen as a place. The room itself is a painting (public/art/office-N.webp, one per
 * reputation tier); everything that has to be alive is drawn on top of it in canvas.
 *
 * The window in each painting is deliberately blown out to white, so at load time we read a mask out of it
 * (the bright pixels inside the glass) and paint our own ground through that mask. The frame, the mullions
 * and the mesh stay exactly as painted, while the view beyond them is the club's own stadium: sky by the
 * hour, floodlights at night, the stands filled to the fans' mood, rain or snow on the glass.
 *
 * On top of that the props carry the state: the board takes the next fixture, the newspaper the league
 * leader and our last result, the phone lights up while transfer offers wait, the photo counts the academy,
 * the cabinet counts the seasons on record.
 */
import type { GameState } from "@3sec/game";

export type OfficeAct = "match" | "squad" | "table" | "transfers" | "youth" | "records";
export type Tier = 0 | 1 | 2;

export interface Rect { x: number; y: number; w: number; h: number }
export interface OfficeSpot extends Rect { act: OfficeAct; label: string; hot?: boolean }

export interface OfficeLook {
  tier: Tier;
  club: string;
  grass: string;
  crowd: number;
  capacity: number;
  night: boolean;
  weather: "clear" | "cloud" | "rain" | "snow";
  ground: string;
  opponent: { short: string; color: string; home: boolean } | null;
  round: number;
  rounds: number;
  offers: number;
  prospects: number;
  seasons: number;
  trophies: number;
  leader: string | null;
  lastResult: string | null;
}

/** Where each painting put its things, measured off the art. */
interface Layout { glass: Rect; board: Rect; photo: Rect; cabinet: Rect; folder: Rect; paper: Rect; phone: Rect }
export const LAYOUTS: Record<Tier, Layout> = {
  0: {
    glass: { x: 0.540, y: 0.112, w: 0.460, h: 0.458 },
    board: { x: 0.100, y: 0.185, w: 0.285, h: 0.320 },
    photo: { x: 0.262, y: 0.528, w: 0.100, h: 0.125 },
    cabinet: { x: 0.005, y: 0.600, w: 0.132, h: 0.300 },
    folder: { x: 0.262, y: 0.765, w: 0.275, h: 0.205 },
    paper: { x: 0.505, y: 0.752, w: 0.292, h: 0.158 },
    phone: { x: 0.866, y: 0.658, w: 0.130, h: 0.135 },
  },
  1: {
    glass: { x: 0.537, y: 0.128, w: 0.310, h: 0.402 },
    board: { x: 0.042, y: 0.062, w: 0.238, h: 0.382 },
    photo: { x: 0.144, y: 0.468, w: 0.130, h: 0.210 },
    cabinet: { x: 0.002, y: 0.382, w: 0.126, h: 0.560 },
    folder: { x: 0.338, y: 0.738, w: 0.208, h: 0.128 },
    paper: { x: 0.572, y: 0.728, w: 0.194, h: 0.138 },
    phone: { x: 0.788, y: 0.672, w: 0.144, h: 0.128 },
  },
  2: {
    glass: { x: 0.590, y: 0.128, w: 0.392, h: 0.437 },
    board: { x: 0.131, y: 0.216, w: 0.186, h: 0.292 },
    photo: { x: 0.358, y: 0.296, w: 0.124, h: 0.160 },
    cabinet: { x: 0.002, y: 0.220, w: 0.126, h: 0.650 },
    folder: { x: 0.308, y: 0.772, w: 0.208, h: 0.096 },
    paper: { x: 0.468, y: 0.732, w: 0.168, h: 0.096 },
    phone: { x: 0.506, y: 0.655, w: 0.100, h: 0.090 },
  },
};

export const officeArt = (tier: Tier): string => `./art/office-${tier}.webp`;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

function hash01(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) { h ^= Math.imul(x | 0, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; }
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
}
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}
const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * clamp(t, 0, 1));
  return `rgb(${f(ar, br)},${f(ag, bg)},${f(ab, bb)})`;
};
const shade = (hex: string, t: number): string => (t < 0 ? mix(hex, "#0b0f13", -t) : mix(hex, "#fff6e2", t));

export function officeLook(s: GameState, rep: number, trophies: number, extra: Partial<OfficeLook> = {}): OfficeLook {
  const me = s.clubs[s.userClub]!;
  const w = hash01(s.seed, s.season, s.round, 7);
  const winter = s.round >= 10 && s.round <= 15;
  const weather: OfficeLook["weather"] = w > 0.86 ? (winter ? "snow" : "rain") : w > 0.55 ? "cloud" : "clear";
  return {
    tier: rep >= 13 ? 2 : rep >= 9 ? 1 : 0,
    club: me.color,
    grass: "#2f7d3a",
    crowd: clamp((me.fans?.mood ?? 55) / 100 + 0.25, 0.2, 1),
    capacity: me.capacity ?? 20000,
    night: hash01(s.seed, s.season, s.round, 11) > 0.45,
    weather,
    ground: me.stadiumName || "홈 구장",
    opponent: null,
    round: s.round + 1,
    rounds: 22,
    offers: 0,
    prospects: me.youth?.prospects.length ?? 0,
    seasons: s.seasonHistory.length,
    trophies,
    leader: null,
    lastResult: null,
    ...extra,
  };
}

export function officeSpots(tier: Tier, hasMatch: boolean): OfficeSpot[] {
  const l = LAYOUTS[tier];
  return [
    { act: "match", label: hasMatch ? "다음 경기" : "일정", ...l.board, hot: hasMatch },
    { act: "youth", label: "유스", ...l.photo },
    { act: "records", label: "기록실", ...l.cabinet },
    { act: "squad", label: "스쿼드", ...l.folder },
    { act: "table", label: "순위", ...l.paper },
    { act: "transfers", label: "이적", ...l.phone },
  ];
}

interface Drop { x: number; y: number; v: number; len: number }

export class OfficeScene {
  private ctx: CanvasRenderingContext2D | null;
  private look: OfficeLook | null = null;
  private art: HTMLImageElement | null = null;
  private artTier: Tier | null = null;
  /** the glass, cut out of the painting so our ground shows through it */
  private mask: HTMLCanvasElement | null = null;
  private maskKey = "";
  private view: HTMLCanvasElement | null = null;
  private raf = 0;
  private last = 0;
  private t = 0;
  private drops: Drop[] = [];
  private w = 0; private h = 0; private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  set(look: OfficeLook): void {
    const tierChanged = this.artTier !== look.tier;
    this.look = look;
    this.drops = [];
    const n = look.weather === "rain" ? 120 : look.weather === "snow" ? 70 : 0;
    for (let i = 0; i < n; i++) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.35 + Math.random() * 0.5, len: 0.03 + Math.random() * 0.04 });
    if (tierChanged) {
      this.artTier = look.tier;
      this.mask = null; this.maskKey = "";
      const img = new Image();
      img.decoding = "async";
      img.onload = () => { this.art = img; this.paint(); };
      img.src = officeArt(look.tier);
    }
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.maskKey = "";
    this.paint();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts; this.t += dt;
      this.step(dt); this.paint();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  private step(dt: number): void {
    const fall = this.look?.weather === "snow" ? 0.12 : 0.9;
    for (const d of this.drops) {
      d.y += d.v * fall * dt;
      if (this.look?.weather === "snow") d.x += Math.sin((this.t + d.y * 6) * 1.2) * 0.02 * dt;
      if (d.y > 1) { d.y = -0.05; d.x = Math.random(); }
    }
  }

  // ---------------------------------------------------------------- paint

  private paint(): void {
    const ctx = this.ctx, look = this.look;
    if (!ctx || !look || !this.w) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.art) {
      ctx.fillStyle = "#0d1116";
      ctx.fillRect(0, 0, this.w, this.h);
      return;
    }
    // the painted room, covering the canvas
    const iw = this.art.naturalWidth, ih = this.art.naturalHeight;
    const r = Math.max(this.w / iw, this.h / ih);
    const dw = iw * r, dh = ih * r, dx = (this.w - dw) / 2, dy = (this.h - dh) / 2;
    ctx.drawImage(this.art, dx, dy, dw, dh);
    // our ground, through the glass
    this.paintView(ctx, look, { dx, dy, dw, dh });
    // what the props say
    this.paintProps(ctx, look, { dx, dy, dw, dh });
  }

  /** Map a rect given in art coordinates to the canvas. */
  private at(r: Rect, f: { dx: number; dy: number; dw: number; dh: number }): Rect {
    return { x: f.dx + r.x * f.dw, y: f.dy + r.y * f.dh, w: r.w * f.dw, h: r.h * f.dh };
  }

  /**
   * The stadium, drawn into an offscreen buffer and then cut to the shape of the painting's bright glass,
   * so the frame, the mullions and the wire mesh in the art stay in front of it.
   */
  private paintView(ctx: CanvasRenderingContext2D, look: OfficeLook, f: { dx: number; dy: number; dw: number; dh: number }): void {
    const g = this.at(LAYOUTS[look.tier].glass, f);
    const W = Math.max(8, Math.round(g.w)), H = Math.max(8, Math.round(g.h));
    const key = `${look.tier}|${W}x${H}`;
    if (!this.mask || this.maskKey !== key) this.mask = this.buildMask(look.tier, W, H, f, g);
    this.maskKey = key;
    if (!this.mask) return;
    if (!this.view || this.view.width !== W || this.view.height !== H) {
      const c = document.createElement("canvas"); c.width = W; c.height = H; this.view = c;
    }
    const vc = this.view.getContext("2d");
    if (!vc) return;
    vc.setTransform(1, 0, 0, 1, 0, 0);
    vc.clearRect(0, 0, W, H);
    this.paintStadium(vc, look, W, H);
    vc.globalCompositeOperation = "destination-in";
    vc.drawImage(this.mask, 0, 0);
    vc.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = 0.97;
    ctx.drawImage(this.view, g.x, g.y, g.w, g.h);
    ctx.restore();
  }

  /** Read the bright glass out of the painting: white pixels become opaque, everything else transparent. */
  private buildMask(tier: Tier, W: number, H: number, f: { dx: number; dy: number; dw: number; dh: number }, g: Rect): HTMLCanvasElement | null {
    if (!this.art) return null;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const cc = c.getContext("2d", { willReadFrequently: true });
    if (!cc) return null;
    const l = LAYOUTS[tier].glass;
    cc.drawImage(this.art, l.x * this.art.naturalWidth, l.y * this.art.naturalHeight, l.w * this.art.naturalWidth, l.h * this.art.naturalHeight, 0, 0, W, H);
    const img = cc.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255;
      // a soft edge between 0.72 and 0.90 keeps the mesh and the mullions from aliasing
      const a = clamp((lum - 0.72) / 0.18, 0, 1);
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
    cc.putImageData(img, 0, 0);
    void g;
    return c;
  }

  /** The club's ground, painted to fill the glass. */
  private paintStadium(ctx: CanvasRenderingContext2D, look: OfficeLook, w: number, h: number): void {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (look.night) { sky.addColorStop(0, "#060d19"); sky.addColorStop(0.6, "#102138"); sky.addColorStop(1, "#20395a"); }
    else if (look.weather === "rain") { sky.addColorStop(0, "#37454f"); sky.addColorStop(1, "#6d7a84"); }
    else if (look.weather === "snow") { sky.addColorStop(0, "#48565f"); sky.addColorStop(1, "#9aa4ac"); }
    else if (look.weather === "cloud") { sky.addColorStop(0, "#4a6070"); sky.addColorStop(1, "#93a6b3"); }
    else { sky.addColorStop(0, "#2a5c8c"); sky.addColorStop(0.55, "#7ba3c4"); sky.addColorStop(1, "#d3dfe6"); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    if (look.night) {
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 40; i++) {
        if (hash01(i, 17) > 0.55) continue;
        ctx.globalAlpha = 0.1 + hash01(i, 23) * 0.35;
        ctx.fillRect(hash01(i, 3) * w, hash01(i, 9) * h * 0.4, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    } else if (look.weather !== "clear") {
      ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(hash01(i, 41) * w, h * (0.06 + hash01(i, 43) * 0.18), w * (0.12 + hash01(i, 47) * 0.14), h * 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // a tall window shows more of the bowl, a letterbox one mostly sky and stand
    const horizon = h * clamp(0.40 + (h / Math.max(1, w)) * 0.34, 0.44, 0.60);
    const deep = clamp(look.capacity / 45000, 0.4, 1);
    const roofH = h * 0.055 * deep;
    // floodlights first, so the stands cover their feet
    for (const px of [0.16, 0.84]) {
      const fx = w * px, fy = horizon - roofH - h * 0.30;
      ctx.strokeStyle = "rgba(8,12,16,.85)"; ctx.lineWidth = Math.max(1.5, w * 0.008);
      ctx.beginPath(); ctx.moveTo(fx, horizon); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = look.night ? "#fff6da" : "rgba(214,226,236,.8)";
      ctx.fillRect(fx - w * 0.035, fy - h * 0.04, w * 0.07, h * 0.04);
      if (look.night) {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const cone = ctx.createLinearGradient(fx, fy, fx, h);
        cone.addColorStop(0, "rgba(255,240,205,.20)"); cone.addColorStop(0.55, "rgba(255,240,205,.07)"); cone.addColorStop(1, "rgba(255,240,205,0)");
        ctx.fillStyle = cone;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - w * 0.55, h); ctx.lineTo(fx + w * 0.55, h); ctx.closePath(); ctx.fill();
        const bulb = ctx.createRadialGradient(fx, fy - h * 0.02, 0, fx, fy - h * 0.02, h * 0.14);
        bulb.addColorStop(0, "rgba(255,247,220,.6)"); bulb.addColorStop(1, "rgba(255,247,220,0)");
        ctx.fillStyle = bulb; ctx.beginPath(); ctx.arc(fx, fy - h * 0.02, h * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
    // far stand
    ctx.fillStyle = shade(look.club, -0.80); ctx.fillRect(0, horizon - roofH, w, roofH);
    ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(0, horizon - roofH, w, 2);
    const seatsH = h * 0.115;
    const seat = mix(look.club, "#4a545e", 0.62);
    const sg = ctx.createLinearGradient(0, horizon, 0, horizon + seatsH);
    sg.addColorStop(0, shade(seat, look.night ? -0.35 : 0.02));
    sg.addColorStop(1, shade(seat, look.night ? -0.12 : 0.24));
    ctx.fillStyle = sg; ctx.fillRect(0, horizon, w, seatsH);
    for (let i = 0; i < 7; i++) {
      const ry = horizon + (i / 7) * seatsH;
      for (let j = 0; j < 74; j++) {
        const seed = hash01(i * 71 + j, i + 3);
        if (seed > look.crowd) continue;
        ctx.fillStyle = look.night
          ? (seed > 0.82 ? "rgba(255,255,255,.34)" : `rgba(235,244,250,${0.07 + seed * 0.15})`)
          : (seed > 0.82 ? "rgba(18,24,30,.5)" : `rgba(22,28,36,${0.16 + seed * 0.22})`);
        ctx.fillRect((j / 74) * w + (i % 2) * 1.5, ry, 2, 1.8);
      }
    }
    const pitchTop = horizon + seatsH;
    // ad boards
    ctx.fillStyle = shade(look.club, -0.30);
    ctx.fillRect(w * 0.08, pitchTop - h * 0.016, w * 0.84, h * 0.016);
    ctx.fillStyle = "rgba(255,255,255,.10)";
    for (let i = 0; i < 9; i++) ctx.fillRect(w * (0.09 + i * 0.093), pitchTop - h * 0.013, w * 0.05, h * 0.006);
    // near stands as wedges
    ctx.fillStyle = shade(look.club, -0.72);
    ctx.beginPath(); ctx.moveTo(0, pitchTop); ctx.lineTo(w * 0.08, pitchTop); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w, pitchTop); ctx.lineTo(w * 0.92, pitchTop); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    // the pitch
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.08, pitchTop); ctx.lineTo(w * 0.92, pitchTop); ctx.lineTo(w, h); ctx.lineTo(0, h);
    ctx.closePath(); ctx.clip();
    const grass = mix(look.grass, "#4a5a52", 0.28);
    const pg = ctx.createLinearGradient(0, pitchTop, 0, h);
    pg.addColorStop(0, shade(grass, look.night ? -0.45 : -0.18));
    pg.addColorStop(1, shade(grass, look.night ? -0.20 : 0.06));
    ctx.fillStyle = pg; ctx.fillRect(0, pitchTop, w, h - pitchTop);
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 7; i += 2) {
      const t0 = i / 7, t1 = (i + 1) / 7;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(w * (0.08 + t0 * 0.84), pitchTop); ctx.lineTo(w * (0.08 + t1 * 0.84), pitchTop);
      ctx.lineTo(w * t1, h); ctx.lineTo(w * t0, h); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,.34)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(w * 0.085, pitchTop + 2); ctx.lineTo(w * 0.915, pitchTop + 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w * 0.32, pitchTop + 2); ctx.lineTo(w * 0.30, pitchTop + h * 0.10);
    ctx.lineTo(w * 0.70, pitchTop + h * 0.10); ctx.lineTo(w * 0.68, pitchTop + 2);
    ctx.stroke();
    ctx.save(); ctx.translate(w * 0.5, h * 0.97); ctx.scale(1, 0.3);
    ctx.beginPath(); ctx.arc(0, 0, w * 0.15, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    ctx.restore();

    // the air between here and the far side: everything recedes a little
    const haze = ctx.createLinearGradient(0, horizon - h * 0.14, 0, horizon + h * 0.10);
    haze.addColorStop(0, look.night ? "rgba(20,34,54,.55)" : "rgba(190,206,218,.42)");
    haze.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - h * 0.14, w, h * 0.24);

    // weather on the glass
    if (this.drops.length) {
      if (look.weather === "rain") {
        ctx.strokeStyle = "rgba(210,228,240,.45)"; ctx.lineWidth = 1.1;
        for (const d of this.drops) {
          ctx.beginPath(); ctx.moveTo(d.x * w, d.y * h); ctx.lineTo(d.x * w - w * 0.02, d.y * h + h * d.len); ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(255,255,255,.8)";
        for (const d of this.drops) ctx.fillRect(d.x * w, d.y * h, 2.4, 2.4);
      }
    }
    // the glass itself
    ctx.save();
    ctx.globalAlpha = 0.10;
    const refl = ctx.createLinearGradient(0, 0, w * 0.7, h);
    refl.addColorStop(0, "#ffffff"); refl.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = refl; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /** What the objects say, written on them. */
  private paintProps(ctx: CanvasRenderingContext2D, look: OfficeLook, f: { dx: number; dy: number; dw: number; dh: number }): void {
    const l = LAYOUTS[look.tier];
    // the board: the next fixture, chalked on
    const b = this.at(l.board, f);
    if (look.opponent) {
      const size = Math.max(11, b.h * 0.115);
      ctx.save();
      ctx.translate(b.x + b.w * 0.5, b.y + b.h * 0.34);
      ctx.rotate(-0.012);
      this.chalk(ctx, `R${look.round}  ${look.opponent.home ? "HOME" : "AWAY"}`, 0, 0, size * 0.72, "rgba(236,246,240,.62)");
      this.chalk(ctx, `vs ${look.opponent.short}`, 0, size * 1.15, size, "rgba(246,252,248,.9)");
      ctx.restore();
    }
    // the photo: how many are in the academy
    const p = this.at(l.photo, f);
    if (look.prospects > 0) this.plate(ctx, `유스 ${look.prospects}`, p.x + p.w * 0.5, p.y + p.h * 1.06, Math.max(9, p.h * 0.16));
    // the cabinet: seasons on record
    const c = this.at(l.cabinet, f);
    if (look.seasons > 0) this.plate(ctx, `${look.seasons}시즌 기록`, c.x + c.w * 0.5, c.y + c.h * 0.16, Math.max(9, c.w * 0.16));
    // the newspaper: the headline
    const n = this.at(l.paper, f);
    ctx.save();
    ctx.translate(n.x + n.w * 0.5, n.y + n.h * 0.30);
    ctx.rotate(0.03);
    const hs = Math.max(9, n.h * 0.20);
    this.text(ctx, look.leader ? `${look.leader} 선두` : "리그 개막", 0, 0, hs, "rgba(28,28,26,.88)", "center");
    if (look.lastResult) this.text(ctx, look.lastResult, 0, hs * 1.25, hs * 0.72, "rgba(40,40,36,.7)", "center");
    ctx.restore();
    // the phone: offers waiting, with a light that will not be ignored
    const t = this.at(l.phone, f);
    if (look.offers > 0) {
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(this.t * 2.4));
      const cx = t.x + t.w * 0.5, cy = t.y - t.h * 0.12;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, t.w * 0.5);
      g.addColorStop(0, `rgba(255,90,80,${0.45 * pulse})`); g.addColorStop(1, "rgba(255,90,80,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, t.w * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      this.plate(ctx, `제안 ${look.offers}`, cx, cy, Math.max(9, t.w * 0.16), `rgba(255,${120 + 70 * pulse},110,.95)`);
    }
  }

  private text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign): void {
    ctx.save();
    ctx.font = `700 ${Math.round(size)}px "Barlow Condensed", "IBM Plex Sans KR", sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  /** Chalk on the board: a soft double pass, so it sits in the surface rather than on it. */
  private chalk(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string): void {
    ctx.save();
    ctx.font = `700 ${Math.round(size)}px "Barlow Condensed", "IBM Plex Sans KR", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.35; ctx.fillStyle = color; ctx.fillText(s, x + 0.8, y + 0.8);
    ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillText(s, x, y);
    ctx.restore();
  }

  /** A small dark plate with a label, for numbers that have to be read against a painting. */
  private plate(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, size: number, color = "rgba(226,236,242,.92)"): void {
    ctx.save();
    ctx.font = `700 ${Math.round(size)}px "Barlow Condensed", "IBM Plex Sans KR", sans-serif`;
    const w = ctx.measureText(s).width + size * 0.9, h = size * 1.5;
    ctx.fillStyle = "rgba(8,12,16,.62)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2); else ctx.rect(cx - w / 2, cy - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(s, cx, cy + 0.5);
    ctx.restore();
  }
}
