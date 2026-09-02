import { DT, PITCH, type Match, type MatchEvent, type PlayerState, type TeamId } from "@3sec/engine";
import { drawPitch, type View } from "./render";
import { DEFAULT_STADIUM, stadiumFor, type Stadium } from "./stadiums";
import { ManagerPanel } from "./panel";
import { Sfx } from "./sfx";
import { CLIP_SECONDS, Recorder, type Clip, type Frame } from "./replay";

/** On-canvas text burst (골!, 오프사이드!, 퇴장!) */
interface Fx { text: string; sub: string; color: string; t0: number; dur: number; big: boolean }
/** Slow-motion playback of a clip; `intro` is the freeze before the first frame. */
interface Replay { clip: Clip; pos: number; started: number; auto: boolean }

const REPLAY_RATE = 0.5;
const REPLAY_INTRO_MS = 900;
const REPLAY_ZOOM = 1.55;

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
  /** fixed multiplier, or 'auto' = highlight pacing (slow near goal, fast elsewhere) */
  private speed: number | "auto" = "auto";
  private effSpeed = 1;
  private acc = 0;
  private lastTs = 0;
  private loggedEvents = 0;
  private selected: string | null = null;
  private onFinish: (() => void) | null = null;
  private finished = false;
  private rafStarted = false;
  /** home club's ground; decides the pitch look and the kick-off banner */
  private stadium: Stadium = DEFAULT_STADIUM;
  /** wall-clock time of the first play press this match (banner countdown starts then) */
  private bannerT0: number | null = null;
  private readonly sfx = new Sfx();
  private readonly recorder = new Recorder();
  private clips: Clip[] = [];
  /** event index → clip, for the ▶ buttons in the log */
  private clipByEvent = new Map<number, Clip>();
  private replay: Replay | null = null;
  private fx: Fx[] = [];
  private shakeT0 = -1e9;
  private shakeAmp = 0;
  private flashT0 = -1e9;
  private fxEvents = 0;
  private readonly btnSound = document.getElementById("btnSound") as HTMLButtonElement | null;
  private readonly btnReplay = document.getElementById("btnReplay") as HTMLButtonElement | null;
  /** automatic slow-motion replay after a goal (clips are still recorded for the ▶ buttons when off) */
  private autoReplay = (() => { try { return localStorage.getItem("3sec.replay") !== "0"; } catch { return true; } })();

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
  private readonly ftOverlay = document.getElementById("ftOverlay") as HTMLDivElement;
  private readonly btnFull = document.getElementById("btnFull") as HTMLButtonElement;
  private readonly btnPanel = document.getElementById("btnPanel") as HTMLButtonElement;
  /** user explicitly toggled immersive mode (otherwise it follows phone orientation) */
  private immersiveByUser: boolean | null = null;
  private readonly speedSel = document.getElementById("speed") as HTMLSelectElement;
  private readonly debugChk = document.getElementById("debug") as HTMLInputElement;
  private readonly panel: ManagerPanel;

  constructor(private readonly runChunked: (work: () => boolean, label: string) => Promise<void>) {
    this.panel = new ManagerPanel(0, (id) => {
      this.selected = id;
      this.render();
    });
    this.btnPlay.addEventListener("click", () => { this.sfx.unlock(); if (this.replay) this.endReplay(); else this.setPlaying(!this.playing); });
    if (this.btnSound) {
      const paint = () => { this.btnSound!.textContent = this.sfx.enabled ? "🔊" : "🔇"; this.btnSound!.title = this.sfx.enabled ? "효과음 끄기" : "효과음 켜기"; };
      paint();
      this.btnSound.addEventListener("click", () => { this.sfx.setEnabled(!this.sfx.enabled); paint(); if (this.sfx.enabled) this.sfx.whistle(1, 0.2); });
    }
    if (this.btnReplay) {
      const paint = () => { this.btnReplay!.textContent = this.autoReplay ? "🔁" : "⏹"; this.btnReplay!.title = this.autoReplay ? "골 자동 리플레이 켜짐 (누르면 끔)" : "골 자동 리플레이 꺼짐 (누르면 켬)"; this.btnReplay!.style.opacity = this.autoReplay ? "1" : ".55"; };
      paint();
      this.btnReplay.addEventListener("click", () => { this.autoReplay = !this.autoReplay; try { localStorage.setItem("3sec.replay", this.autoReplay ? "1" : "0"); } catch { /* ignore */ } paint(); });
    }
    this.logEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-clip]");
      if (!b) return;
      const clip = this.clips.find((c) => c.id === Number(b.dataset.clip));
      if (clip) this.startReplay(clip, false);
    });
    this.btnSkip.addEventListener("click", () => void this.skipToEnd());
    this.btnContinue.addEventListener("click", () => this.onFinish?.());
    document.getElementById("btnContinue2")!.addEventListener("click", () => this.onFinish?.());
    this.speedSel.addEventListener("change", () => (this.speed = this.speedSel.value === "auto" ? "auto" : Number(this.speedSel.value)));
    this.debugChk.addEventListener("change", () => this.render());
    this.btnFull.addEventListener("click", () => this.setImmersive(!document.body.classList.contains("immersive"), true));
    this.btnPanel.addEventListener("click", () => document.body.classList.toggle("panel-open"));
    this.canvas.addEventListener("pointerdown", () => { document.body.classList.remove("panel-open"); if (this.replay) this.endReplay(); });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && this.immersiveByUser) this.setImmersive(false, true);
    });
    window.addEventListener("resize", () => {
      this.autoImmersive();
      this.resize();
    });
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
    this.stadium = stadiumFor(match.teams[0].name);
    this.bannerT0 = null;
    this.userTeam = userTeam;
    this.others = others;
    this.onFinish = onFinish;
    this.finished = false;
    this.playing = false;
    this.acc = 0;
    this.loggedEvents = 0;
    this.fxEvents = 0;
    this.selected = null;
    this.recorder.reset();
    this.clips = [];
    this.clipByEvent.clear();
    this.replay = null;
    this.fx = [];
    this.shakeT0 = -1e9;
    this.flashT0 = -1e9;
    this.logEl.innerHTML = "";
    this.btnContinue.style.display = "none";
    this.ftOverlay.hidden = true;
    document.body.classList.remove("finished");
    this.btnSkip.disabled = false;
    this.btnPlay.disabled = false;
    this.setPlaying(false);
    this.panel.attach(match, userTeam);
    this.immersiveByUser = null;
    requestAnimationFrame(() => { this.autoImmersive(); this.resize(); });
    if (!this.rafStarted) {
      this.rafStarted = true;
      requestAnimationFrame((ts) => this.frame(ts));
    }
  }

  /** Phones in landscape get the big pitch automatically; portrait goes back, unless the user chose. */
  private autoImmersive(): void {
    if (this.immersiveByUser !== null) return;
    const active = document.getElementById("screen-match")!.classList.contains("active");
    const landscapePhone = window.innerWidth > window.innerHeight && window.innerHeight < 560;
    const want = active && landscapePhone && !this.finished;
    if (want !== document.body.classList.contains("immersive")) this.setImmersive(want, false);
  }

  private setImmersive(on: boolean, byUser: boolean): void {
    document.body.classList.toggle("immersive", on);
    if (!on) document.body.classList.remove("panel-open");
    if (byUser) this.immersiveByUser = on ? true : null;
    this.btnFull.textContent = on ? "⛶ 닫기" : "⛶ 크게";
    if (byUser && on) {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
      (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => undefined);
    } else if (byUser && !on && document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
    requestAnimationFrame(() => this.resize());
  }

  /** Called by the controller when leaving the match screen. */
  leave(): void {
    this.replay = null;
    this.fx = [];
    this.ftOverlay.hidden = true;
    document.body.classList.remove("finished");
    this.immersiveByUser = null;
    this.setImmersive(false, false);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private setPlaying(v: boolean): void {
    if (this.finished) v = false;
    this.playing = v;
    if (v && this.bannerT0 === null) this.bannerT0 = performance.now();
    this.btnPlay.textContent = v ? "❚❚ 일시정지" : "▶ 재생";
  }

  private stepAll(n: number, record = false): void {
    for (let i = 0; i < n; i++) {
      if (this.match.state.phase !== "FULL_TIME") { this.match.step(); if (record) this.recorder.push(this.match.state); }
      for (const o of this.others) if (o.match.state.phase !== "FULL_TIME") o.match.step();
    }
  }

  private allDone(): boolean {
    return this.match.state.phase === "FULL_TIME" && this.others.every((o) => o.match.state.phase === "FULL_TIME");
  }

  private async skipToEnd(): Promise<void> {
    this.setPlaying(false);
    this.btnSkip.disabled = true;
    // from here the assistant runs my bench and tactics, as in an auto round
    this.match.enableAi(this.userTeam);
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
    if (this.replay) {
      const r = this.replay;
      const age = ts - r.started;
      if (age > REPLAY_INTRO_MS) {
        r.pos += elapsed * 1000 / (1000 / 20) * REPLAY_RATE;
        if (r.pos >= r.clip.frames.length + 8) this.endReplay();
      }
    } else if (this.playing) {
      // Dead-ball waits (free kicks, corners, celebrations, half time) are real-length in the
      // engine; at any fixed speed they run at least 4x faster so the game never drags.
      const dead = this.match.state.phase !== "PLAY";
      this.effSpeed = this.speed === "auto" ? this.autoSpeed() : dead ? Math.max(8, this.speed * 4) : this.speed;
      this.acc += elapsed * this.effSpeed;
      let steps = 0;
      while (this.acc >= DT && steps < 400) {
        this.stepAll(1, true);
        this.acc -= DT;
        steps++;
        if (this.replay) break; // a goal froze the action for its replay
      }
      if (this.match.state.phase === "FULL_TIME") this.setPlaying(false);
    }
    this.processEvents();
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** React to new events of the user's match: text bursts, shake, sounds and highlight clips. */
  private processEvents(): void {
    const s = this.match.state;
    const fast = this.playing && this.effSpeed > 12;
    while (this.fxEvents < s.events.length) {
      const idx = this.fxEvents++;
      const e = s.events[idx]!;
      const secs = CLIP_SECONDS[e.type];
      if (secs && !this.finished) {
        const frames = this.recorder.cut(secs);
        if (frames.length > 20) {
          const clip: Clip = { id: this.clips.length + 1, type: e.type, minute: e.minute, team: e.team, text: e.text, frames };
          this.clips.push(clip);
          this.clipByEvent.set(idx, clip);
          if ((e.type === "GOAL" || e.type === "OWN_GOAL") && this.playing && !this.replay && this.autoReplay) this.startReplay(clip, true);
        }
      }
      const team = e.team === null ? null : this.match.teams[e.team];
      const color = team?.color ?? "#ffd166";
      const now = performance.now();
      switch (e.type) {
        case "GOAL":
          this.burst("골!!!", `${team?.shortName ?? ""} ${e.text.replace(/^골[:!]?\s*/, "")}`, color, 2200, true);
          this.shake(now, 14); this.flashT0 = now; this.sfx.roar();
          break;
        case "OWN_GOAL":
          this.burst("자책골…", e.text, "#ff6b6b", 2000, true);
          this.shake(now, 8); this.sfx.boo();
          break;
        case "OFFSIDE":
          this.burst("🚩 오프사이드!", team ? `${team.shortName} 공격 무산` : "", "#ff9f43", 1500, false);
          this.sfx.whistle(2, 0.16, 0.08);
          break;
        case "RED_CARD":
          this.burst("🟥 퇴장!", e.text, "#ff4d4f", 2000, true);
          this.shake(now, 6); this.sfx.whistle(1, 0.7); this.sfx.boo();
          break;
        case "YELLOW_CARD":
          this.burst("🟨 경고", e.text, "#ffd166", 1200, false);
          if (!fast) this.sfx.whistle(1, 0.25);
          break;
        case "PENALTY":
          this.burst("페널티킥!", e.text, "#ffd166", 1800, true);
          this.shake(now, 5); this.sfx.whistle(1, 0.6);
          break;
        case "INJURY":
          this.burst("🩹 부상", e.text, "#8ecae6", 1400, false);
          break;
        case "SAVE": if (!fast) this.sfx.ooh(); break;
        case "SHOT": if (!fast && Math.random() < 0.5) this.sfx.ooh(); break;
        case "KICK_OFF": if (!fast || s.clock < 1) this.sfx.whistle(1, 0.5); break;
        case "HALF_TIME": this.sfx.whistle(2, 0.45); break;
        case "FULL_TIME": this.sfx.whistle(3, 0.4); this.sfx.clap(); break;
        case "SUBSTITUTION": if (!fast) this.sfx.clap(); break;
        default: break;
      }
    }
  }

  private burst(text: string, sub: string, color: string, dur: number, big: boolean): void {
    this.fx = this.fx.filter((f) => performance.now() - f.t0 < f.dur);
    this.fx.push({ text, sub, color, t0: performance.now(), dur, big });
  }

  private shake(now: number, amp: number): void { this.shakeT0 = now; this.shakeAmp = amp; }

  private startReplay(clip: Clip, auto: boolean): void {
    this.replay = { clip, pos: 0, started: performance.now(), auto };
    this.btnPlay.textContent = "⏭ 리플레이 건너뛰기";
  }

  private endReplay(): void {
    this.replay = null;
    this.acc = 0;
    this.btnPlay.textContent = this.playing ? "❚❚ 일시정지" : "▶ 재생";
  }

  /**
   * Highlight pacing: the ball near either goal in open play runs at 3x so chances can be
   * followed; midfield play at 20x; restarts, celebrations and half time at 40x.
   * A 90-minute match takes roughly 8-10 real minutes this way.
   */
  private autoSpeed(): number {
    const s = this.match.state;
    if (s.phase !== "PLAY") return 40;
    const nearGoal = Math.abs(s.ball.pos.x) > PITCH.halfLength - 32;
    return nearGoal ? 3 : 20;
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
    const clip = this.clipByEvent.get(this.loggedEvents - 1);
    if (clip) div.innerHTML += ` <button data-clip="${clip.id}" style="padding:0 6px;font-size:11px;border-radius:10px;margin-left:4px" title="주요 장면 다시 보기">▶ 리플레이</button>`;
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
    const ratio0 = (PITCH.length + 8) / (PITCH.width + 8);
    // Immersive landscape: when the pitch at full height leaves room on the right, dock the manager panel there.
    const body = document.body;
    if (body.classList.contains("immersive")) {
      const main = document.getElementById("main")!;
      const pitchW = (main.clientHeight - 16) * ratio0;
      const leftover = main.clientWidth - pitchW - 16;
      const dock = leftover >= 230;
      body.classList.toggle("dock", dock);
      if (dock) body.style.setProperty("--dockw", `${Math.round(Math.min(460, leftover))}px`);
      if (dock) body.classList.remove("panel-open");
    } else body.classList.remove("dock");
    const maxW = Math.max(200, stage.clientWidth - 16);
    const maxH = Math.max(140, stage.clientHeight - 16);
    const ratio = (PITCH.length + 8) / (PITCH.width + 8);
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.syncBitmap(true);
    if (this.match) this.render();
  }

  /**
   * Keep the bitmap equal to the laid-out box x dpr. CSS (max-height:100%) can clamp the canvas
   * after the stage settles without any resize event; a stale, larger bitmap would then leave
   * rows below the pitch that never get repainted.
   */
  private syncBitmap(force = false): void {
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.floor((this.canvas.clientWidth || 1) * dpr);
    const bh = Math.floor((this.canvas.clientHeight || 1) * dpr);
    if (!force && this.canvas.width === bw && this.canvas.height === bh) return;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    this.syncBitmap();
    const v = this.view();
    const now = performance.now();
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.save();
    // the stadium shakes after a goal (decaying random offset)
    const shakeAge = now - this.shakeT0;
    if (shakeAge < 700) {
      const k = this.shakeAmp * (1 - shakeAge / 700) ** 2;
      ctx.translate((Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k);
    }
    const rp = this.replay;
    const frame: Frame | null = rp ? rp.clip.frames[Math.min(rp.clip.frames.length - 1, Math.floor(rp.pos))] ?? null : null;
    if (rp && frame) {
      // slow-motion zoom on the action: the camera eases toward the ball of the clip's last frame
      const last = rp.clip.frames[rp.clip.frames.length - 1]!;
      const age = now - rp.started;
      const z = 1 + (REPLAY_ZOOM - 1) * Math.min(1, age / 1400);
      const fx = Math.max(-PITCH.halfLength + 20, Math.min(PITCH.halfLength - 20, (frame.bx + last.bx) / 2));
      const fy = Math.max(-PITCH.halfWidth + 14, Math.min(PITCH.halfWidth - 14, (frame.by + last.by) / 2));
      ctx.translate(v.w / 2, v.h / 2);
      ctx.scale(z, z);
      ctx.translate(-(v.ox + fx * v.scale), -(v.oy + fy * v.scale));
    }
    drawPitch(ctx, v, this.stadium);
    const toPx = (x: number, y: number): [number, number] => [v.ox + x * v.scale, v.oy + y * v.scale];
    const debug = this.debugChk.checked && !rp;
    if (rp && frame) {
      this.drawFrame(frame, v);
      ctx.restore();
      this.drawReplayHud(rp, v, now);
      this.drawFx(v, now);
      this.updateHud();
      return;
    }

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
      const r = Math.max(5, 1.45 * v.scale);
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
      this.drawNumber(px, py, r, def.number, team.color, this.selected === p.id);
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
    ctx.restore();
    // goal flash
    const flashAge = now - this.flashT0;
    if (flashAge < 260) {
      ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - flashAge / 260)})`;
      ctx.fillRect(0, 0, v.w, v.h);
    }
    this.drawFx(v, now);
    const bannerAge = this.bannerT0 === null ? 0 : performance.now() - this.bannerT0;
    if (!this.finished && bannerAge < BANNER_MS) this.drawStadiumBanner(v, bannerAge);
    if (this.selected) this.drawPlayerCard(match.player(this.selected), v);
    this.updateHud();
  }

  /** Scoreboard, clock, phase label, event log, stats and the manager panel. */
  private updateHud(): void {
    const match = this.match;
    const s = match.state;
    const [home, away] = match.teams;
    this.scoreEl.innerHTML = `<span style="color:${home.color}">${home.shortName}</span> ${s.score[0]} - ${s.score[1]} <span style="color:${away.color}">${away.shortName}</span>`;
    this.clockEl.textContent = this.fmtClock() + (this.playing && this.effSpeed !== this.speed ? `  ${this.effSpeed}x` : "");
    const phaseText: Record<string, string> = {
      PRE_KICKOFF: "킥오프 대기",
      PLAY: "",
      GOAL_CELEBRATION: "골!",
      RESTART_SETUP: s.restart ? restartLabel(s.restart.kind) : "",
      HALF_TIME: "하프타임",
      FULL_TIME: "경기 종료",
    };
    this.phaseEl.textContent = this.replay ? "리플레이" : phaseText[s.phase] ?? s.phase;
    while (this.loggedEvents < s.events.length) this.appendLog(s.events[this.loggedEvents++]!);
    this.renderStats();
    this.panel.update();

    if (!this.finished && this.allDone()) {
      this.finished = true;
      this.setPlaying(false);
      this.btnPlay.disabled = true;
      this.btnSkip.disabled = true;
      this.btnContinue.style.display = "";
      document.body.classList.remove("panel-open");
      document.body.classList.add("finished");
      const [hc, ac] = match.teams;
      const mine = this.userTeam === 0 ? s.score[0] - s.score[1] : s.score[1] - s.score[0];
      document.getElementById("ftScore")!.innerHTML = `<span style="color:${hc.color}">${hc.shortName}</span> ${s.score[0]} - ${s.score[1]} <span style="color:${ac.color}">${ac.shortName}</span>`;
      document.getElementById("ftNote")!.textContent = mine > 0 ? "승리! 라운드 결과와 순위를 확인하세요." : mine < 0 ? "패배… 결과 화면에서 다른 경기장 결과도 확인하세요." : "무승부. 결과 화면으로 이동합니다.";
      this.ftOverlay.hidden = false;
    } else if (!this.finished && s.phase === "FULL_TIME") {
      // The user's match is over but another ground is still playing: finish them quietly.
      this.btnSkip.textContent = "⏩ 다른 구장 종료";
    }
  }

  /** Shirt number: inside the disc when there is room (contrast picked from the kit colour), else just below it. */
  private drawNumber(px: number, py: number, r: number, num: number, kit: string, selected: boolean): void {
    const ctx = this.ctx;
    const text = String(num);
    if (r >= 5.5) {
      const size = Math.max(7, r * (text.length > 1 ? 1.05 : 1.3));
      ctx.font = `700 ${size}px 'IBM Plex Mono', ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = luminance(kit) > 0.5 ? "#101418" : "#ffffff";
      ctx.fillText(text, px, py + 0.5);
    } else {
      ctx.font = `700 ${Math.max(8, r * 1.6)}px 'IBM Plex Mono', ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(text, px, py + r + 1);
      ctx.fillStyle = selected ? "#ffd166" : "#ffffff";
      ctx.fillText(text, px, py + r + 1);
    }
  }

  /** Replay scene: players and ball from a recorded frame. */
  private drawFrame(f: Frame, v: View): void {
    const ctx = this.ctx;
    const match = this.match;
    const r = Math.max(5, 1.45 * v.scale);
    for (const p of f.players) {
      const team = match.teams[p.team];
      const def = match.def(p.id);
      const px = v.ox + p.x * v.scale, py = v.oy + p.y * v.scale;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(px + 1, py + 2, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = def.role === "GK" ? shade(team.color, -0.35) : team.color;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = f.owner === p.id ? "#fff" : "rgba(0,0,0,0.5)"; ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(p.f) * r * 1.3, py + Math.sin(p.f) * r * 1.3); ctx.stroke();
      this.drawNumber(px, py, r, def.number, team.color, false);
    }
    const bx = v.ox + f.bx * v.scale, by = v.oy + f.by * v.scale;
    const br = Math.max(2.5, 0.45 * v.scale) * (1 + f.bz * 0.12);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath(); ctx.ellipse(bx + 1, by + 1.5, br * 0.9, br * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(bx, by - f.bz * v.scale * 0.5, br, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1; ctx.stroke();
  }

  /** REPLAY badge, slow-motion note and the event caption. */
  private drawReplayHud(rp: Replay, v: View, now: number): void {
    const ctx = this.ctx;
    const blink = Math.floor(now / 500) % 2 === 0;
    ctx.save();
    ctx.font = `700 ${Math.max(13, v.scale * 1.6)}px 'Barlow Condensed','IBM Plex Sans KR',sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    const pad = 10;
    const label = "● REPLAY";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(pad, pad, ctx.measureText(label).width + 16, Math.max(13, v.scale * 1.6) + 10);
    ctx.fillStyle = blink ? "#ff4d4f" : "#ffffff";
    ctx.fillText(label, pad + 8, pad + 5);
    ctx.font = `${Math.max(11, v.scale * 1.1)}px 'IBM Plex Sans KR',sans-serif`;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(`슬로 모션 ${REPLAY_RATE}x · 탭하여 건너뛰기`, v.w - pad, pad + 6);
    // caption
    const team = rp.clip.team === null ? "" : this.match.teams[rp.clip.team].shortName;
    const cap = `${rp.clip.minute}' ${team} ${rp.clip.text}`;
    ctx.font = `600 ${Math.max(12, v.scale * 1.3)}px 'IBM Plex Sans KR',sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const w = ctx.measureText(cap).width + 24;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(v.w / 2 - w / 2, v.h - pad - Math.max(12, v.scale * 1.3) - 12, w, Math.max(12, v.scale * 1.3) + 12);
    ctx.fillStyle = "#fff";
    ctx.fillText(cap, v.w / 2, v.h - pad - 6);
    // letterbox bars for the broadcast feel
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    const bar = Math.min(28, v.h * 0.06);
    ctx.fillRect(0, 0, v.w, bar); ctx.fillRect(0, v.h - bar, v.w, bar);
    ctx.restore();
  }

  /** Text bursts: punch in, hold, fade. */
  private drawFx(v: View, now: number): void {
    const ctx = this.ctx;
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    let row = 0;
    for (const f of this.fx) {
      const age = now - f.t0;
      const inK = Math.min(1, age / 260);
      const scale = f.big ? 1 + (1 - inK) * (1 - inK) * 1.6 : 1 + (1 - inK) * 0.4;
      const fade = age > f.dur - 320 ? (f.dur - age) / 320 : 1;
      const size = f.big ? Math.max(30, v.scale * 6.5) : Math.max(16, v.scale * 2.4);
      const cx = v.w / 2, cy = f.big ? v.h * 0.42 : v.h * 0.2 + row * (size * 1.8);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      if (f.big) {
        // subtle wobble while the burst lands
        ctx.rotate(Math.sin(age / 90) * (1 - inK) * 0.08);
      }
      ctx.font = `900 ${size}px 'Barlow Condensed','IBM Plex Sans KR',sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size * 0.12);
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color; ctx.shadowBlur = f.big ? 24 : 8;
      ctx.fillText(f.text, 0, 0);
      ctx.shadowBlur = 0;
      if (f.sub) {
        const ss = Math.max(11, size * 0.32);
        ctx.font = `600 ${ss}px 'IBM Plex Sans KR',sans-serif`;
        ctx.lineWidth = Math.max(2, ss * 0.18);
        ctx.strokeText(f.sub, 0, size * 0.72);
        ctx.fillStyle = "#fff";
        ctx.fillText(f.sub, 0, size * 0.72);
      }
      ctx.restore();
      if (!f.big) row++;
    }
  }

  /** Ground name, capacity and the home side, top-left, until ~5 s after the first play press. */
  private drawStadiumBanner(v: View, age: number): void {
    const ctx = this.ctx;
    const st = this.stadium;
    const home = this.match.teams[0];
    const immersive = document.body.classList.contains("immersive");
    const fade = Math.min(1, (BANNER_MS - age) / 700); // eases out over the last 0.7 s
    const alpha = fade * (immersive ? 0.6 : 0.9);
    if (alpha <= 0) return;
    const fs = immersive ? 11 : 13;
    const l1 = `${st.name} · ${st.capacity.toLocaleString("ko-KR")}석`;
    const l2 = `홈: ${home.name}`;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${fs}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    const w1 = ctx.measureText(l1).width;
    ctx.font = `${fs - 1}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    const w2 = ctx.measureText(l2).width;
    const pad = 8;
    const w = Math.max(w1, w2) + pad * 2 + 6;
    const h = fs * 2 + pad * 2 + 4;
    // in immersive mode the translucent top bar overlays the canvas top; sit below it
    const x0 = 8;
    const y0 = immersive ? 48 : 8;
    ctx.fillStyle = "rgba(10,14,20,0.72)";
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = home.color;
    ctx.fillRect(x0, y0, 3, h);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#e6edf3";
    ctx.font = `600 ${fs}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    ctx.fillText(l1, x0 + pad + 6, y0 + pad);
    ctx.fillStyle = "rgba(230,237,243,0.75)";
    ctx.font = `${fs - 1}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    ctx.fillText(l2, x0 + pad + 6, y0 + pad + fs + 4);
    ctx.restore();
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

/** kick-off banner lifetime in real ms after the first play press */
const BANNER_MS = 5000;

const HIDDEN_EVENTS = new Set(["SHOT_ON_TARGET", "INTERCEPTION", "TACKLE", "BLOCK"]);

function restartLabel(kind: string): string {
  return ({ KICK_OFF: "킥오프", THROW_IN: "스로인", GOAL_KICK: "골킥", CORNER: "코너킥", FREE_KICK: "프리킥", PENALTY: "페널티킥" } as Record<string, string>)[kind] ?? kind;
}

/** Relative luminance (0..1) of a #rrggbb colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
