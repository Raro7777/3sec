/**
 * Sharing helpers: hand a generated file to the OS share sheet (Android Chrome / WebView) or fall
 * back to a download; plus the 1080×1350 season summary card painter.
 */

type ShareNav = Navigator & { share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>; canShare?: (d: { files?: File[] }) => boolean };

/** The claude.ai artifact viewer blocks page-initiated downloads; only the share sheet works there. */
export const downloadsBlocked = (): boolean => { try { return location.hostname.endsWith("claude.ai"); } catch { return false; } };

/**
 * Share a blob as a file; returns "shared", "downloaded" or "blocked" (no share support and downloads
 * blocked — show a hint). A cancelled share sheet counts as "shared".
 */
export async function shareFile(blob: Blob, name: string, title: string): Promise<"shared" | "downloaded" | "blocked"> {
  const nav = navigator as ShareNav;
  const file = new File([blob], name, { type: blob.type });
  if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try { await nav.share({ files: [file], title }); } catch { /* cancelled */ }
    return "shared";
  }
  if (downloadsBlocked()) return "blocked";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

export const canvasBlob = (c: HTMLCanvasElement, type = "image/png"): Promise<Blob> =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type));

export interface SeasonCard {
  clubName: string; clubColor: string; managerName: string; season: number;
  position: number; teams: number; pts: number; won: number; drawn: number; lost: number; gf: number; ga: number;
  topScorer: string; cupResult: string; verdict: string; champion: string;
}

/** Paint the season summary card (1080×1350, portrait, club colours) and return the canvas. */
export function drawSeasonCard(d: SeasonCard): HTMLCanvasElement {
  const W = 1080, H = 1350;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const F = "'IBM Plex Sans KR', system-ui, sans-serif";
  const FC = "'Barlow Condensed', 'IBM Plex Sans KR', sans-serif";
  // background: dark ground with a club-colour glow from the top
  ctx.fillStyle = "#0b1014"; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.6);
  g.addColorStop(0, d.clubColor); g.addColorStop(1, "rgba(11,16,20,0)");
  ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.6); ctx.globalAlpha = 1;
  ctx.fillStyle = d.clubColor; ctx.fillRect(0, 0, W, 18);
  // header
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = `600 34px ${F}`;
  ctx.fillText(`가난한자의 FM · 시즌 ${d.season} 결산`, 64, 70);
  ctx.fillStyle = "#fff"; ctx.font = `700 78px ${FC}`;
  ctx.fillText(fit(ctx, d.clubName, W - 128), 64, 120);
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = `600 38px ${F}`;
  ctx.fillText(`감독 ${d.managerName}`, 64, 218);
  // the big number
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd166"; ctx.font = `700 300px ${FC}`;
  ctx.fillText(`${d.position}위`, W / 2, 300);
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = `600 44px ${F}`;
  ctx.fillText(`${d.teams}팀 중 · 승점 ${d.pts}`, W / 2, 620);
  // W-D-L tiles
  const tiles: [string, string][] = [["승", String(d.won)], ["무", String(d.drawn)], ["패", String(d.lost)], ["득실", `${d.gf - d.ga > 0 ? "+" : ""}${d.gf - d.ga}`]];
  const tw = 220, gap = 24, x0 = (W - (tw * 4 + gap * 3)) / 2, ty = 710;
  tiles.forEach(([l, v], i) => {
    const x = x0 + i * (tw + gap);
    roundRect(ctx, x, ty, tw, 150, 18); ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = `600 30px ${F}`; ctx.fillText(l, x + tw / 2, ty + 20);
    ctx.fillStyle = "#fff"; ctx.font = `700 72px ${FC}`; ctx.fillText(v, x + tw / 2, ty + 58);
  });
  // detail rows
  ctx.textAlign = "left";
  const rows: [string, string][] = [["리그 우승", d.champion], ["팀 내 최다 득점", d.topScorer], ["3sec 컵", d.cupResult]];
  let y = 910;
  for (const [l, v] of rows) {
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `600 32px ${F}`; ctx.fillText(l, 64, y);
    ctx.fillStyle = "#fff"; ctx.font = `600 40px ${F}`; ctx.fillText(fit(ctx, v, W - 128), 64, y + 40);
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(64, y + 100, W - 128, 2);
    y += 118;
  }
  // verdict ribbon
  roundRect(ctx, 64, 1256 - 6, W - 128, 60, 14); ctx.fillStyle = d.clubColor; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = textOn(d.clubColor); ctx.font = `600 30px ${F}`;
  ctx.fillText(fit(ctx, `이사회: ${d.verdict}`, W - 180), W / 2, 1256 + 24);
  return c;
}

function fit(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return "#fff";
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? "#111" : "#fff";
}
