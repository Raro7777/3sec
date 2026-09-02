import { DT, PITCH, type Match, type MatchEvent, type PlayerState, type TeamId } from "@3sec/engine";
import { drawPitch, type View } from "./render";
import { ManagerPanel } from "./panel";

export interface SideMatch {
  label: string;
  match: Match;
}

/**
 * The live match: canvas, clock, stats, event log, manager panel. The other fixtures of the round
 * are stepped in lockstep so the whole matchday happens at once, with a live-scores strip.
 */
export class MatchScreen {
  private match!: Match;
  private others: SideMatch[] = [];
  private userTeam: TeamId = 0;
  private playing = false;
  private speed = 1;
  private acc = 0;
  private lastTs = 0;
  private loggedEvents = 0;
  private selected: string | null = null;
  private onFinish: (() => void) | null = null;
  private finished = false;
  private rafStarted = false;

  private readonly canvas = document.getElementById("pitch") as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext("2d")!;
  private readonly scoreEl = document.getElementById("score")!;
  private readonly clockEl = document.getElementById("clock")!;
  private readonly phaseEl = document.getElementById("phase")!;
  private readonly logEl = document.getElementById("log")!;
  private readonly statsEl = document.getElementById("stats")!;
  private readonly othersEl = document.getElementById("others")!;
  private readonly btnPlay = document.getElementById("btnPlay") as HTMLButtonElement;
  private readonly btnSkip = document.getElementById("btnSkip") as HTMLButtonElement;
  private readonly btnContinue = document.getElementById("btnContinue") as HTMLButtonElement;
  private readonly speedSel = document.getElementById("speed") as HTMLSelectElement;
  private readonly debugChk = document.getElementById("debug") as HTMLInputElement;
  private readonly panel: ManagerPanel;

  constructor(private readonly runChunked: (work: () => boolean, label: string) => Promise<void>) {
    this.panel = new ManagerPanel(0, (id) => {
      this.selected = id;
      this.render();
    });
    this.btnPlay.addEventListener("click", () => this.setPlaying(!this.playing));
    this.btnSkip.addEventListener("click", () => void this.skipToEnd());
    this.btnContinue.addEventListener("click", () => this.onFinish?.());
    this.speedSel.addEventListener("change", () => (this.speed = Number(this.speedSel.value)));
    this.debugChk.addEventListener("change", () => this.render());
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && document.getElementById("screen-match")!.classList.contains("active") && !this.finished) {
        e.preventDefault();
        this.setPlaying(!this.playing);
      }
    });
    this.canvas.addEventListener("pointerdown", (e) => this.pick(e));
  }

  start(match: Match, userTeam: TeamId, others: SideMatch[], onFinish: () => void): void {
    this.match = match;
    this.userTeam = userTeam;
    this.others = others;
    this.onFinish = onFinish;
    this.finished = false;
    this.playing = false;
    this.acc = 0;
    this.loggedEvents = 0;
    this.selected = null;
    this.logEl.innerHTML = "";
    this.btnContinue.style.display = "none";
    this.btnSkip.disabled = false;
    this.btnPlay.disabled = false;
    this.setPlaying(false);
    this.panel.attach(match, userTeam);
    this.resize();
    if (!this.rafStarted) {
      this.rafStarted = true;
      requestAnimationFrame((ts) => this.frame(ts));
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private setPlaying(v: boolean): void {
    if (this.finished) v = false;
    this.playing = v;
    this.btnPlay.textContent = v ? "❚❚ 일시정지" : "▶ 재생";
  }

  private stepAll(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.match.state.phase !== "FULL_TIME") this.match.step();
      for (const o of this.others) if (o.match.state.phase !== "FULL_TIME") o.match.step();
    }
  }

  private allDone(): boolean {
    return this.match.state.phase === "FULL_TIME" && this.others.every((o) => o.match.state.phase === "FULL_TIME");
  }

  private async skipToEnd(): Promise<void> {
    this.setPlaying(false);
    this.btnSkip.disabled = true;
    await this.runChunked(() => {
      this.stepAll(20 * 30); // 30 match seconds per slice
      return this.allDone();
    }, "라운드 시뮬레이션 중…");
    this.render();
  }

  private frame(ts: number): void {
    if (!this.lastTs) this.lastTs = ts;
    const elapsed = Math.min(0.25, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    if (this.playing) {
      this.acc += elapsed * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 400) {
        this.stepAll(1);
        this.acc -= DT;
        steps++;
      }
      if (this.match.state.phase === "FULL_TIME") this.setPlaying(false);
    }
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  private fmtClock(): string {
    const m = this.match;
    const s = m.state;
    const base = s.half === 1 ? 0 : 45 * 60;
    const t = Math.floor(base + Math.min(s.clock, m.halfLength));
    const extra = Math.max(0, Math.floor(s.clock - m.halfLength));
    const mm = String(Math.floor(t / 60)).padStart(2, "0");
    const ss = String(t % 60).padStart(2, "0");
    return extra > 0 ? `${mm}:${ss} +${Math.floor(extra / 60)}:${String(extra % 60).padStart(2, "0")}` : `${mm}:${ss}`;
  }

  private appendLog(e: MatchEvent): void {
    if (HIDDEN_EVENTS.has(e.type) && !this.debugChk.checked) return;
    const div = document.createElement("div");
    const team = e.team === null ? "" : this.match.teams[e.team].shortName;
    const color = e.team === null ? "#e6edf3" : this.match.teams[e.team].color;
    div.innerHTML = `<span style="opacity:.6">${String(e.minute).padStart(2, "0")}'</span> <span style="color:${color};font-weight:600">${team}</span> ${e.text}`;
    if (e.type === "GOAL" || e.type === "OWN_GOAL") div.style.color = "#ffd166";
    if (e.type === "SUBSTITUTION" || e.type === "TACTICS") div.style.color = "#8ecae6";
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private renderStats(): void {
    const [a, b] = this.match.state.stats;
    const tot = Math.max(1, a.possessionTicks + b.possessionTicks);
    const row = (label: string, x: string | number, y: string | number) => `<span><b>${label}</b> ${x} : ${y}</span>`;
    this.statsEl.innerHTML = [
      row("점유율", `${Math.round((100 * a.possessionTicks) / tot)}%`, `${Math.round((100 * b.possessionTicks) / tot)}%`),
      row("슈팅(유효)", `${a.shots}(${a.shotsOnTarget})`, `${b.shots}(${b.shotsOnTarget})`),
      row("xG", a.xg.toFixed(2), b.xg.toFixed(2)),
      row("패스", `${a.passesCompleted}/${a.passes}`, `${b.passesCompleted}/${b.passes}`),
      row("코너", a.corners, b.corners),
      row("파울", a.fouls, b.fouls),
      row("오프사이드", a.offsides, b.offsides),
      row("경고/퇴장", `${a.yellows}/${a.reds}`, `${b.yellows}/${b.reds}`),
    ].join("");
    this.othersEl.innerHTML = this.others
      .map((o) => {
        const s = o.match.state;
        const done = s.phase === "FULL_TIME" ? " ✓" : "";
        return `<span>${o.match.teams[0].shortName} <b style="color:var(--text)">${s.score[0]}-${s.score[1]}</b> ${o.match.teams[1].shortName}${done}</span>`;
      })
      .join("");
  }

  private resize(): void {
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
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.match) this.render();
  }

  private view(): View {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const scale = Math.min(w / (PITCH.length + 8), h / (PITCH.width + 8));
    return { w, h, scale, ox: w / 2, oy: h / 2 };
  }

  private pick(e: PointerEvent): void {
    if (!this.match) return;
    const v = this.view();
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - v.ox) / v.scale;
    const y = (e.clientY - rect.top - v.oy) / v.scale;
    let best: string | null = null;
    let bestD = 2.5;
    for (const p of this.match.state.players) {
      if (!p.onPitch || p.sentOff) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.y - y);
      if (d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    this.selected = best;
    this.panel.selectFromPitch(best);
    this.render();
  }

  private render(): void {
    const match = this.match;
    if (!match) return;
    const ctx = this.ctx;
    const s = match.state;
    const v = this.view();
    ctx.clearRect(0, 0, v.w, v.h);
    drawPitch(ctx, v);
    const toPx = (x: number, y: number): [number, number] => [v.ox + x * v.scale, v.oy + y * v.scale];
    const debug = this.debugChk.checked;

    if (debug) {
      for (const team of [0, 1] as TeamId[]) {
        const line = match.offsideLine(team) * match.dirOf(team);
        const [lx] = toPx(line, 0);
        ctx.strokeStyle = match.teams[team].color;
        ctx.setLineDash([4, 6]);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(lx, v.oy - PITCH.halfWidth * v.scale);
        ctx.lineTo(lx, v.oy + PITCH.halfWidth * v.scale);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

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
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(px + 1, py + 2, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = def.role === "GK" ? shade(team.color, -0.35) : team.color;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = this.selected === p.id ? 3 : 1.2;
      ctx.strokeStyle = this.selected === p.id ? "#ffd166" : s.ball.owner === p.id ? "#fff" : "rgba(0,0,0,0.5)";
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(p.facing) * r * 1.3, py + Math.sin(p.facing) * r * 1.3);
      ctx.stroke();
      if (debug || this.selected === p.id) {
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(9, v.scale * 1.1)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(String(def.number), px, py + r + 1);
      }
    }

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

    if (s.restart) {
      const [rx, ry] = toPx(s.restart.pos.x, s.restart.pos.y);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(rx, ry, PITCH.restartExclusion * v.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const [home, away] = match.teams;
    this.scoreEl.innerHTML = `<span style="color:${home.color}">${home.shortName}</span> ${s.score[0]} - ${s.score[1]} <span style="color:${away.color}">${away.shortName}</span>`;
    this.clockEl.textContent = this.fmtClock();
    const phaseText: Record<string, string> = {
      PRE_KICKOFF: "킥오프 대기",
      PLAY: "",
      GOAL_CELEBRATION: "골!",
      RESTART_SETUP: s.restart ? restartLabel(s.restart.kind) : "",
      HALF_TIME: "하프타임",
      FULL_TIME: "경기 종료",
    };
    this.phaseEl.textContent = phaseText[s.phase] ?? s.phase;
    if (this.selected) this.drawPlayerCard(match.player(this.selected), v);
    while (this.loggedEvents < s.events.length) this.appendLog(s.events[this.loggedEvents++]!);
    this.renderStats();
    this.panel.update();

    if (!this.finished && this.allDone()) {
      this.finished = true;
      this.setPlaying(false);
      this.btnPlay.disabled = true;
      this.btnSkip.disabled = true;
      this.btnContinue.style.display = "";
    } else if (!this.finished && s.phase === "FULL_TIME") {
      // The user's match is over but another ground is still playing: finish them quietly.
      this.btnSkip.textContent = "⏩ 다른 구장 종료";
    }
  }

  private drawPlayerCard(p: PlayerState, v: View): void {
    const ctx = this.ctx;
    const def = this.match.def(p.id);
    const a = def.attrs;
    const lines = [
      `#${def.number} ${def.name} (${def.role})`,
      `속도 ${a.pace} 가속 ${a.acceleration} 체력 ${a.stamina} 힘 ${a.strength}`,
      `패스 ${a.passing} 시야 ${a.vision} 기술 ${a.technique} 터치 ${a.firstTouch}`,
      `드리블 ${a.dribbling} 마무리 ${a.finishing} 침착 ${a.composure} 판단 ${a.decisions}`,
      `태클 ${a.tackling} 마킹 ${a.marking} 위치 ${a.positioning}`,
      `피로 ${(p.fatigue * 100).toFixed(0)}%  속도 ${Math.hypot(p.vel.x, p.vel.y).toFixed(1)} m/s  의도 ${p.intent}`,
    ];
    ctx.font = "12px 'IBM Plex Sans KR', system-ui, sans-serif";
    const w = 340;
    const h = 16 * lines.length + 12;
    ctx.fillStyle = "rgba(10,14,20,0.85)";
    ctx.fillRect(8, v.h - h - 8, w, h);
    ctx.fillStyle = "#e6edf3";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, 16, v.h - h - 2 + i * 16));
  }
}

const HIDDEN_EVENTS = new Set(["SHOT_ON_TARGET", "INTERCEPTION", "TACKLE", "BLOCK"]);

function restartLabel(kind: string): string {
  return ({ KICK_OFF: "킥오프", THROW_IN: "스로인", GOAL_KICK: "골킥", CORNER: "코너킥", FREE_KICK: "프리킥", PENALTY: "페널티킥" } as Record<string, string>)[kind] ?? kind;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
