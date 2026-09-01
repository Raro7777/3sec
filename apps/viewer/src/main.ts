import {
  DT,
  FORMATIONS,
  Match,
  PITCH,
  generateTeam,
  type MatchEvent,
  type PlayerState,
  type TeamId,
} from "@3sec/engine";
import { drawPitch, type View } from "./render";
import { ManagerPanel } from "./panel";

const canvas = document.getElementById("pitch") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const scoreEl = document.getElementById("score")!;
const clockEl = document.getElementById("clock")!;
const phaseEl = document.getElementById("phase")!;
const logEl = document.getElementById("log")!;
const statsEl = document.getElementById("stats")!;
const btnPlay = document.getElementById("btnPlay") as HTMLButtonElement;
const btnRestart = document.getElementById("btnRestart") as HTMLButtonElement;
const speedSel = document.getElementById("speed") as HTMLSelectElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const debugChk = document.getElementById("debug") as HTMLInputElement;

let match: Match;
let playing = false;
let speed = 1;
let acc = 0;
let lastTs = 0;
let loggedEvents = 0;
let selected: string | null = null;
const USER_TEAM: TeamId = 0;
const panel = new ManagerPanel(USER_TEAM, (id) => {
  selected = id;
  render();
});

function newMatch(): void {
  const seed = Number(seedInput.value) || 1;
  const home = generateTeam({ id: 0, name: "Seoul FC", shortName: "SEO", color: "#e63946", formation: "4-3-3", quality: 13, seed: seed + 100 });
  const away = generateTeam({ id: 1, name: "Busan United", shortName: "BUS", color: "#4cc9f0", formation: "4-4-2", quality: 12, seed: seed + 200 });
  match = new Match(home, away, { seed, aiManaged: [1] });
  loggedEvents = 0;
  logEl.innerHTML = "";
  selected = null;
  panel.attach(match);
  render();
}

function fmtClock(): string {
  const s = match.state;
  const base = s.half === 1 ? 0 : 45 * 60;
  const t = Math.floor(base + Math.min(s.clock, match.halfLength));
  const extra = Math.max(0, Math.floor(s.clock - match.halfLength));
  const mm = String(Math.floor(t / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return extra > 0 ? `${mm}:${ss} +${Math.floor(extra / 60)}:${String(extra % 60).padStart(2, "0")}` : `${mm}:${ss}`;
}

const HIDDEN_EVENTS = new Set(["SHOT_ON_TARGET", "INTERCEPTION", "TACKLE", "BLOCK"]);

function appendLog(e: MatchEvent): void {
  if (HIDDEN_EVENTS.has(e.type) && !debugChk.checked) return;
  const div = document.createElement("div");
  const team = e.team === null ? "" : match.teams[e.team].shortName;
  const color = e.team === null ? "#e6edf3" : match.teams[e.team].color;
  div.innerHTML = `<span style="opacity:.6">${String(e.minute).padStart(2, "0")}'</span> <span style="color:${color};font-weight:600">${team}</span> ${e.text}`;
  if (e.type === "GOAL" || e.type === "OWN_GOAL") div.style.color = "#ffd166";
  if (e.type === "SUBSTITUTION" || e.type === "TACTICS") div.style.color = "#8ecae6";
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderStats(): void {
  const [a, b] = match.state.stats;
  const tot = Math.max(1, a.possessionTicks + b.possessionTicks);
  const row = (label: string, x: string | number, y: string | number) => `<span><b>${label}</b> ${x} : ${y}</span>`;
  statsEl.innerHTML = [
    row("점유율", `${Math.round((100 * a.possessionTicks) / tot)}%`, `${Math.round((100 * b.possessionTicks) / tot)}%`),
    row("슈팅(유효)", `${a.shots}(${a.shotsOnTarget})`, `${b.shots}(${b.shotsOnTarget})`),
    row("xG", a.xg.toFixed(2), b.xg.toFixed(2)),
    row("패스", `${a.passesCompleted}/${a.passes}`, `${b.passesCompleted}/${b.passes}`),
    row("코너", a.corners, b.corners),
    row("파울", a.fouls, b.fouls),
    row("오프사이드", a.offsides, b.offsides),
    row("경고/퇴장", `${a.yellows}/${a.reds}`, `${b.yellows}/${b.reds}`),
  ].join("");
}

function resize(): void {
  const stage = document.getElementById("stage")!;
  const maxW = Math.max(200, stage.clientWidth - 16);
  const maxH = Math.max(140, stage.clientHeight - 16);
  const ratio = (PITCH.length + 8) / (PITCH.width + 8);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function view(): View {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const scale = Math.min(w / (PITCH.length + 8), h / (PITCH.width + 8));
  return { w, h, scale, ox: w / 2, oy: h / 2 };
}

function render(): void {
  const s = match.state;
  const v = view();
  ctx.clearRect(0, 0, v.w, v.h);
  drawPitch(ctx, v);

  const toPx = (x: number, y: number): [number, number] => [v.ox + x * v.scale, v.oy + y * v.scale];
  const debug = debugChk.checked;

  // Offside lines (debug)
  if (debug) {
    for (const team of [0, 1] as TeamId[]) {
      const line = match.offsideLine(team) * match.dirOf(team);
      const [lx] = toPx(line, 0);
      ctx.strokeStyle = match.teams[team].color;
      ctx.setLineDash([4, 6]);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(lx, v.oy - (PITCH.halfWidth * v.scale));
      ctx.lineTo(lx, v.oy + (PITCH.halfWidth * v.scale));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // Players
  for (const p of s.players) {
    if (p.sentOff || !p.onPitch) continue;
    const team = match.teams[p.team];
    const def = match.def(p.id);
    const [px, py] = toPx(p.pos.x, p.pos.y);
    const r = Math.max(4, 1.1 * v.scale);

    if (debug) {
      const [tx, ty] = toPx(p.target.x, p.target.y);
      ctx.strokeStyle = team.color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Shadow + body
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(px + 1, py + 2, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.role === "GK" ? shade(team.color, -0.35) : team.color;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = selected === p.id ? 3 : 1.2;
    ctx.strokeStyle = selected === p.id ? "#ffd166" : s.ball.owner === p.id ? "#fff" : "rgba(0,0,0,0.5)";
    ctx.stroke();

    // Facing tick
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(p.facing) * r * 1.3, py + Math.sin(p.facing) * r * 1.3);
    ctx.stroke();

    // Number
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(8, r * 1.1)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(def.number), px, py + 0.5);

    if (debug) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `${Math.max(8, r * 0.9)}px ui-monospace, monospace`;
      ctx.fillText(`${def.role} ${p.intent}`, px, py - r - 6);
    }
    if (p.yellow > 0) {
      ctx.fillStyle = "#ffd60a";
      ctx.fillRect(px + r * 0.6, py - r * 1.4, r * 0.5, r * 0.7);
    }
  }

  // Ball (with height: bigger + shadow offset as it rises)
  const b = s.ball;
  const [bx, by] = toPx(b.pos.x, b.pos.y);
  const br = Math.max(2.5, 0.45 * v.scale) * (1 + b.z * 0.12);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(bx + 1, by + 1.5, br * 0.9, br * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(bx, by - b.z * v.scale * 0.5, br, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Restart marker
  if (s.restart) {
    const [rx, ry] = toPx(s.restart.pos.x, s.restart.pos.y);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(rx, ry, PITCH.restartExclusion * v.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Top bar
  const [home, away] = match.teams;
  scoreEl.innerHTML = `<span style="color:${home.color}">${home.shortName}</span> ${s.score[0]} - ${s.score[1]} <span style="color:${away.color}">${away.shortName}</span>`;
  clockEl.textContent = fmtClock();
  const phaseText: Record<string, string> = {
    PRE_KICKOFF: "킥오프 대기",
    PLAY: "",
    GOAL_CELEBRATION: "골!",
    RESTART_SETUP: s.restart ? restartLabel(s.restart.kind) : "",
    HALF_TIME: "하프타임",
    FULL_TIME: "경기 종료",
  };
  phaseEl.textContent = phaseText[s.phase] ?? s.phase;

  // Selected player card
  if (selected) drawPlayerCard(match.player(selected), v);

  // Log
  while (loggedEvents < s.events.length) appendLog(s.events[loggedEvents++]!);
  renderStats();
  panel.update();
}

function restartLabel(kind: string): string {
  return (
    {
      KICK_OFF: "킥오프",
      THROW_IN: "스로인",
      GOAL_KICK: "골킥",
      CORNER: "코너킥",
      FREE_KICK: "프리킥",
      PENALTY: "페널티킥",
    } as Record<string, string>
  )[kind] ?? kind;
}

function drawPlayerCard(p: PlayerState, v: View): void {
  const def = match.def(p.id);
  const a = def.attrs;
  const lines = [
    `#${def.number} ${def.name} (${def.role})`,
    `PAC ${a.pace} ACC ${a.acceleration} STA ${a.stamina} STR ${a.strength}`,
    `PAS ${a.passing} VIS ${a.vision} TEC ${a.technique} FT ${a.firstTouch}`,
    `DRI ${a.dribbling} FIN ${a.finishing} CMP ${a.composure} DEC ${a.decisions}`,
    `TCK ${a.tackling} MRK ${a.marking} POS ${a.positioning}`,
    `피로 ${(p.fatigue * 100).toFixed(0)}%  속도 ${Math.hypot(p.vel.x, p.vel.y).toFixed(1)} m/s  의도 ${p.intent}`,
  ];
  ctx.font = "12px ui-monospace, monospace";
  const w = 330;
  const h = 16 * lines.length + 12;
  ctx.fillStyle = "rgba(10,14,20,0.85)";
  ctx.fillRect(8, v.h - h - 8, w, h);
  ctx.fillStyle = "#e6edf3";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, 16, v.h - h - 2 + i * 16));
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function frame(ts: number): void {
  if (!lastTs) lastTs = ts;
  const elapsed = Math.min(0.25, (ts - lastTs) / 1000);
  lastTs = ts;
  if (playing) {
    acc += elapsed * speed;
    let steps = 0;
    while (acc >= DT && steps < 400) {
      match.step();
      acc -= DT;
      steps++;
    }
    if (match.state.phase === "FULL_TIME") setPlaying(false);
  }
  render();
  requestAnimationFrame(frame);
}

function setPlaying(v: boolean): void {
  playing = v;
  btnPlay.textContent = v ? "❚❚ Pause" : "▶ Play";
}

btnPlay.addEventListener("click", () => setPlaying(!playing));
btnRestart.addEventListener("click", () => {
  setPlaying(false);
  newMatch();
});
speedSel.addEventListener("change", () => (speed = Number(speedSel.value)));
debugChk.addEventListener("change", render);
window.addEventListener("resize", resize);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    setPlaying(!playing);
  }
});
canvas.addEventListener("pointerdown", (e) => {
  const v = view();
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left - v.ox) / v.scale;
  const y = (e.clientY - rect.top - v.oy) / v.scale;
  let best: string | null = null;
  let bestD = 2.5;
  for (const p of match.state.players) {
    if (!p.onPitch || p.sentOff) continue;
    const d = Math.hypot(p.pos.x - x, p.pos.y - y);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  selected = best;
  panel.selectFromPitch(best);
  render();
});

void FORMATIONS;
newMatch();
resize();
requestAnimationFrame(frame);
