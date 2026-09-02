import { DT, PITCH, type Match, type MatchEvent, type PlayerState, type TeamId } from "@3sec/engine";
import { applyCamera, drawPitch, type Camera, type View } from "./render";
import { DEFAULT_STADIUM, stadiumFor, type Stadium } from "./stadiums";
import { ManagerPanel } from "./panel";
import { Sfx } from "./sfx";
import { CLIP_SECONDS, Recorder, cameraTarget, type Clip, type Frame } from "./replay";
import { drawKitDisc, kitTextColor, resolveKits, type Kit, type MatchKits } from "./kits";
import { roundsPerSeason, table, type Fixture, type GameState } from "@3sec/game";
import { encodeGif, type GifFrame } from "./gif";
import { downloadsBlocked, shareFile } from "./share";

/** On-canvas text burst (골!, 오프사이드!, 퇴장!) */
interface Fx { text: string; sub: string; color: string; t0: number; dur: number; big: boolean }
/** Slow-motion playback of a clip; `intro` is the freeze before the first frame. */
interface Replay { clip: Clip; pos: number; started: number; auto: boolean }
/** Live goal cam: a short push-in on the scorer right after the goal, before any replay. */
interface GoalCam { t0: number; x: number; y: number; caption: string; color: string }

const REPLAY_RATE = 0.5;
const REPLAY_INTRO_MS = 900;
/** replay zoom ramps from the first to the second value over the clip */
const REPLAY_ZOOM_FROM = 1.15;
const REPLAY_ZOOM_TO = 1.6;
const GOAL_CAM_MS = 1200;
const GOAL_CAM_ZOOM = 1.5;
/** camera easing time constants (ms): position and zoom */
const CAM_TAU_POS = 170;
const CAM_TAU_ZOOM = 260;

const reducedMotion = (): boolean => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; } };

export interface SideMatch {
  label: string;
  match: Match;
  /** the league fixture behind this match (lets the live table count its score) */
  fixture?: Fixture;
}

/** Optional atmosphere / context for start(): absent fields keep the old behaviour. */
export interface MatchExtra {
  /** home crowd of the day; drives the crowd volume and the banner line */
  crowd?: { attendance: number; capacity: number; derby?: boolean };
  /** derby day: ribbon in the banner, louder crowd */
  derby?: boolean;
  /** season context for the live "가상 순위" line (league matchdays only) */
  live?: { state: GameState; fixture: Fixture };
}

/** how often the live table is recomputed (ms) */
const LIVE_TABLE_MS = 500;
/** stoppage-time danger window for the clock pulse (match seconds) */
const WHISTLE_PULSE_S = 60;
/** GIF export: frames per second of clip and output width */
const GIF_FPS = 2;
const GIF_W = 320;
const GIF_MAX_FRAMES = 40;
/** auto-speed easing time constants (s): slowing down is quick, speeding up gentle */
const AUTO_TAU_DOWN = 0.35;
const AUTO_TAU_UP = 1.2;
/** "just happened" hold after a shot / save / block / corner / penalty / red card (ms) */
const DANGER_HOLD_MS = 1500;

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
  /** an auto replay waiting for the live goal cam to finish */
  private pendingReplay: { clip: Clip; at: number } | null = null;
  private goalCam: GoalCam | null = null;
  /** eased camera; zoom 1 at the pitch centre is the ordinary full view */
  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private camTs = 0;
  private kits: MatchKits = resolveKits({ name: "", color: "#e63946" }, { name: "", color: "#4cc9f0" });
  private readonly btnTags = document.getElementById("btnTags") as HTMLButtonElement | null;
  /** name tags under the discs */
  private showTags = (() => { try { return localStorage.getItem("3sec.tags") !== "0"; } catch { return true; } })();
  private fx: Fx[] = [];
  private shakeT0 = -1e9;
  private shakeAmp = 0;
  private shakeDur = 700;
  private flashT0 = -1e9;
  private fxEvents = 0;
  private extra: MatchExtra = {};
  /** live table: position at kick-off, the latest live position, when it was last computed and when it last changed */
  private livePos0 = 0;
  private livePos = 0;
  private liveAt = 0;
  private liveChangedAt = -1e9;
  private liveHtml = "";
  /** wall-clock time of the last "danger" event (shot, save, block, corner, penalty, red card) for auto pacing */
  private dangerAt = -1e9;
  /** hit box of the "GIF 공유" pill drawn in the replay HUD (canvas CSS px) */
  private hudGifBtn: { x: number; y: number; w: number; h: number } | null = null;
  private gifBusy = false;
  /** wall-clock time of the goal celebration start (auto pacing: slow for the first seconds) */
  private celebT0 = -1e9;
  private readonly btnSound = document.getElementById("btnSound") as HTMLButtonElement | null;
  private readonly btnReplay = document.getElementById("btnReplay") as HTMLButtonElement | null;
  /** automatic slow-motion replay after a goal (clips are still recorded for the ▶ buttons when off) */
  private autoReplay = (() => { try { return localStorage.getItem("3sec.replay") !== "0"; } catch { return true; } })();

  private readonly canvas = document.getElementById("pitch") as HTMLCanvasElement;
  /** the on-screen context; swapped for an offscreen one while rendering GIF frames (see renderClipFrame) */
  private ctx = this.canvas.getContext("2d")!;
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
    if (this.btnTags) {
      const paint = () => { this.btnTags!.title = this.showTags ? "선수 이름표 켜짐 (누르면 끔)" : "선수 이름표 꺼짐 (누르면 켬)"; this.btnTags!.style.opacity = this.showTags ? "1" : ".55"; };
      paint();
      this.btnTags.addEventListener("click", () => { this.showTags = !this.showTags; try { localStorage.setItem("3sec.tags", this.showTags ? "1" : "0"); } catch { /* ignore */ } paint(); this.render(); });
    }
    this.logEl.addEventListener("click", (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>("[data-gif]");
      if (g) {
        const clip = this.clips.find((c) => c.id === Number(g.dataset.gif));
        if (clip) void this.shareClipGif(clip);
        return;
      }
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
    this.canvas.addEventListener("pointerdown", (e) => {
      document.body.classList.remove("panel-open");
      if (!this.replay) return;
      // the "GIF 공유" pill inside the replay HUD: share the clip instead of ending the replay
      const b = this.hudGifBtn;
      if (b) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { void this.shareClipGif(this.replay.clip); return; }
      }
      this.endReplay();
    });
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

  start(match: Match, userTeam: TeamId, others: SideMatch[], onFinish: () => void, extra: MatchExtra = {}): void {
    this.match = match;
    this.extra = extra;
    this.stadium = stadiumFor(match.teams[0].name);
    this.kits = resolveKits(match.teams[0], match.teams[1]);
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.goalCam = null;
    this.pendingReplay = null;
    this.bannerT0 = null;
    this.userTeam = userTeam;
    this.others = others;
    this.onFinish = onFinish;
    this.finished = false;
    this.playing = false;
    this.acc = 0;
    this.effSpeed = 1;
    this.loggedEvents = 0;
    this.fxEvents = 0;
    this.dangerAt = -1e9;
    this.celebT0 = -1e9;
    this.hudGifBtn = null;
    // crowd volume: how full the ground is, plus a derby bump
    const crowd = extra.crowd;
    const derby = !!(extra.derby || crowd?.derby);
    const fill = crowd && crowd.capacity > 0 ? crowd.attendance / crowd.capacity : 1;
    this.sfx.setCrowd(Math.min(1, fill + (derby ? 0.2 : 0)));
    // live table: the user's position before kick-off is the reference for the ▲▼ arrow
    this.liveAt = 0; this.liveChangedAt = -1e9; this.liveHtml = "";
    this.livePos0 = this.livePos = extra.live ? this.computeLivePos(false) : 0;
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
    this.pendingReplay = null;
    this.goalCam = null;
    this.hudGifBtn = null;
    this.clockEl.classList.remove("danger");
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.fx = [];
    this.ftOverlay.hidden = true;
    document.body.classList.remove("finished");
    this.immersiveByUser = null;
    this.setImmersive(false, false);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** The match sound synth (shared with the shoot-out sheet so its crowd level carries over). */
  get sounds(): Sfx {
    return this.sfx;
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
    if (this.pendingReplay && !this.replay && ts >= this.pendingReplay.at) {
      const { clip } = this.pendingReplay;
      this.pendingReplay = null;
      if (this.playing && this.autoReplay) this.startReplay(clip, true);
    }
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
      if (this.speed === "auto") {
        // tension-aware pacing: ease toward the target (quick when slowing down, gentle when speeding up)
        const target = this.autoSpeed(ts);
        const tau = target < this.effSpeed ? AUTO_TAU_DOWN : AUTO_TAU_UP;
        const k = 1 - Math.exp(-elapsed / tau);
        this.effSpeed += (target - this.effSpeed) * k;
        if (Math.abs(this.effSpeed - target) < 0.05) this.effSpeed = target;
      } else this.effSpeed = dead ? Math.max(8, this.speed * 4) : this.speed;
      // the goal cam is a real-time moment: hold the sim near 1x so the celebration is not skipped
      if (this.goalCam && ts - this.goalCam.t0 < GOAL_CAM_MS) this.effSpeed = Math.min(this.effSpeed, 2);
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
          // the replay waits for the live goal cam (below) to finish its push-in
          if ((e.type === "GOAL" || e.type === "OWN_GOAL") && this.playing && !this.replay && this.autoReplay) this.pendingReplay = { clip, at: performance.now() + GOAL_CAM_MS };
        }
      }
      const team = e.team === null ? null : this.match.teams[e.team];
      const color = team?.color ?? "#ffd166";
      const now = performance.now();
      if (DANGER_EVENTS.has(e.type)) this.dangerAt = now;
      if ((e.type === "GOAL" || e.type === "OWN_GOAL") && !this.finished) {
        const scorer = e.playerId ? this.match.def(e.playerId).name : team?.shortName ?? "";
        const at = e.pos ?? s.ball.pos;
        this.goalCam = { t0: now, x: at.x, y: at.y, caption: `⚽ ${scorer} · ${e.minute}'${e.type === "OWN_GOAL" ? " (자책골)" : ""}`, color };
        this.celebT0 = now;
      }
      // 추가시간 결승골: a stoppage-time goal that turns the user's result (draw→win or loss→draw)
      const late = (e.type === "GOAL" || e.type === "OWN_GOAL") && this.isLateGoalTwist(e);
      if (late) {
        const clip = this.clipByEvent.get(idx);
        if (clip) clip.text = `추가시간 결승골! ${clip.text}`;
      }
      // home end sings after a goal for either side; the travelling fans are fewer
      const scoringSide = e.type === "GOAL" ? e.team : e.type === "OWN_GOAL" && e.team !== null ? (1 - e.team) as TeamId : null;
      switch (e.type) {
        case "GOAL":
          if (late) {
            this.burst("극장골!", `${team?.shortName ?? ""} ${e.text.replace(/^골[:!]?\s*/, "")} · 추가시간 결승골`, "#ffd166", 3200, true);
            this.shake(now, 22, 1400); this.flashT0 = now; this.sfx.roar();
            setTimeout(() => this.sfx.roar(), 700);
          } else {
            this.burst("골!!!", `${team?.shortName ?? ""} ${e.text.replace(/^골[:!]?\s*/, "")}`, color, 2200, true);
            this.shake(now, 14); this.flashT0 = now; this.sfx.roar();
          }
          this.sfx.chant(scoringSide === 0 ? 1 : 0.45);
          break;
        case "OWN_GOAL":
          if (late) {
            this.burst("극장골!", `${e.text} · 추가시간 결승골`, "#ffd166", 3200, true);
            this.shake(now, 22, 1400); this.flashT0 = now; this.sfx.roar();
            setTimeout(() => this.sfx.roar(), 700);
          } else {
            this.burst("자책골…", e.text, "#ff6b6b", 2000, true);
            this.shake(now, 8); this.sfx.boo();
          }
          this.sfx.chant(scoringSide === 0 ? 0.8 : 0.35);
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

  private shake(now: number, amp: number, dur = 700): void { this.shakeT0 = now; this.shakeAmp = amp; this.shakeDur = dur; }

  /**
   * Does this goal, scored in second-half stoppage time, turn the user's result — a draw into a win
   * or a loss into a draw? (The score already includes the goal.)
   */
  private isLateGoalTwist(e: MatchEvent): boolean {
    const m = this.match, s = m.state;
    if (s.half !== 2 || s.clock <= m.halfLength || e.team === null) return false;
    const scoredFor: TeamId = e.type === "OWN_GOAL" ? (1 - e.team) as TeamId : e.team;
    const u = this.userTeam;
    const after = s.score[u] - s.score[1 - u]!;
    const before = after - (scoredFor === u ? 1 : -1);
    return (before === 0 && after > 0) || (before < 0 && after === 0);
  }

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
   * Tension-aware pacing target for the 자동 mode (eased in frame()): a 0..1 "danger" score from
   * the live state picks a speed between 20x (nothing on) and 2x (box entries, shots, penalties);
   * dead balls run at 40x far from goal and 4x when a corner / free kick / penalty is being set up;
   * a goal celebration holds 3x for its first two seconds and then 40x. Late in a tight game the
   * ceiling drops. A 90-minute match still takes roughly 8-11 real minutes.
   */
  private autoSpeed(now: number): number {
    const m = this.match, s = m.state;
    const u = this.userTeam;
    const margin = Math.abs(s.score[0] - s.score[1]);
    const inStoppage = s.half === 2 && s.clock > m.halfLength;
    const lateTight = s.half === 2 && (s.clock > m.halfLength - 10 * 60) && margin <= 1;
    const userBehindOrLevel = s.score[u] - s.score[1 - u]! <= 0 && margin <= 1;
    let cap = 40;
    if (lateTight) cap = 10;
    if (inStoppage && userBehindOrLevel) cap = 6;
    if (s.phase === "GOAL_CELEBRATION") return Math.min(cap, now - this.celebT0 < 2000 ? 3 : 40);
    if (s.phase !== "PLAY") {
      const r = s.restart;
      if (r && r.kind !== "KICK_OFF") {
        const dist = Math.hypot(PITCH.halfLength * m.dirOf(r.team) - r.pos.x, r.pos.y);
        const near = r.kind === "CORNER" || r.kind === "PENALTY" || (r.kind === "FREE_KICK" && dist < 30);
        if (near) return Math.min(cap, 4);
      }
      return Math.min(cap, 40);
    }
    const d = this.danger(now);
    // 0 → 18x, 0.5 → 7x, 1 → 2x (piecewise linear), and 1.5x at the top when the game is on a knife edge
    // (measured: a full match lands at roughly 8-9 real minutes with these tiers)
    const high = lateTight ? 1.5 : 2;
    const v = d < 0.5 ? 18 - (18 - 7) * (d / 0.5) : 7 - (7 - high) * ((d - 0.5) / 0.5);
    return Math.min(cap, v);
  }

  /**
   * How much is happening (0..1): ball in the attacking third and moving toward goal, an attacker
   * on the ball near the box, a quick counter across midfield, and a hold right after a shot,
   * save, block, corner, penalty or red card.
   */
  private danger(now: number): number {
    const m = this.match, s = m.state;
    const b = s.ball;
    const team = m.possessionTeam();
    let d = 0;
    if (team !== null) {
      const dir = m.dirOf(team);
      const goalX = PITCH.halfLength * dir;
      const toGoal = Math.hypot(goalX - b.pos.x, b.pos.y);
      // attacking third: 0 at 35 m from goal, 1 at the goal line
      const third = Math.max(0, Math.min(1, (35 - toGoal) / 30));
      d = Math.max(d, third * 0.7);
      // moving toward goal
      const speed = Math.hypot(b.vel.x, b.vel.y);
      const towards = speed > 1 ? (b.vel.x * dir) / speed : 0;
      if (towards > 0.3 && toGoal < 45) d = Math.max(d, 0.35 + 0.4 * third);
      // attacker on the ball inside / near the box
      if (b.owner && toGoal < 22) d = Math.max(d, 0.85);
      // fast counter crossing the middle
      if (speed > 9 && Math.abs(b.pos.x) < 25 && towards > 0.6) d = Math.max(d, 0.45);
    }
    const hold = now - this.dangerAt;
    if (hold < DANGER_HOLD_MS) d = Math.max(d, 1 - 0.3 * (hold / DANGER_HOLD_MS));
    return Math.max(0, Math.min(1, d));
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
    if (clip) div.innerHTML += ` <button data-clip="${clip.id}" style="padding:0 6px;font-size:11px;border-radius:10px;margin-left:4px" title="주요 장면 다시 보기">▶ 리플레이</button> <button data-gif="${clip.id}" style="padding:0 6px;font-size:11px;border-radius:10px" title="이 장면을 GIF로 저장/공유">GIF 공유</button>`;
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
    this.othersEl.innerHTML = this.liveLine() + this.others
      .map((o) => {
        const s = o.match.state;
        const done = s.phase === "FULL_TIME" ? " ✓" : "";
        return `<span>${o.match.teams[0].shortName} <b style="color:var(--text)">${s.score[0]}-${s.score[1]}</b> ${o.match.teams[1].shortName}${done}</span>`;
      })
      .join("");
  }

  /**
   * League table as it stands right now: recorded results plus the live scores of this matchday.
   * Returns the user's position (1-based), or 0 when no season context was given.
   */
  private computeLivePos(includeLive = true): number {
    const live = this.extra.live;
    if (!live) return 0;
    const st = live.state;
    const scores = new Map<number, [number, number]>();
    if (includeLive) {
      scores.set(live.fixture.id, [this.match.state.score[0], this.match.state.score[1]]);
      for (const o of this.others) if (o.fixture) scores.set(o.fixture.id, [o.match.state.score[0], o.match.state.score[1]]);
    }
    const fixtures = st.fixtures.map((f) => (f.score || !scores.has(f.id) ? f : { ...f, score: scores.get(f.id)! }));
    const rows = table({ ...st, fixtures });
    const me = live.fixture.home === st.userClub ? live.fixture.home : live.fixture.away;
    const pos = rows.findIndex((r) => r.club === me) + 1;
    this.liveRows = rows;
    return pos;
  }
  private liveRows: ReturnType<typeof table> = [];

  /**
   * "현재 2위 ▲ · 선두와 1점 차": shown in the last three rounds, or whenever the user's club is within
   * three points of the lead or of the positions either side of it. Recomputed at most twice a second;
   * the line flashes when the live position changes.
   */
  private liveLine(): string {
    const live = this.extra.live;
    if (!live || live.fixture.round < 0) return "";
    const now = performance.now();
    if (now - this.liveAt >= LIVE_TABLE_MS) {
      this.liveAt = now;
      const pos = this.computeLivePos(true);
      if (pos !== this.livePos) { this.livePos = pos; this.liveChangedAt = now; }
      const st = live.state;
      const rows = this.liveRows;
      const i = pos - 1;
      const mine = rows[i];
      if (!mine) { this.liveHtml = ""; return ""; }
      const near = (j: number) => rows[j] !== undefined && Math.abs(rows[j]!.pts - mine.pts) <= 3;
      const lastRounds = live.fixture.round >= roundsPerSeason(st.clubs.length) - 3;
      const matters = lastRounds || near(0) || near(i - 1) || near(i + 1);
      if (!matters) { this.liveHtml = ""; return ""; }
      const arrow = pos < this.livePos0 ? '<b style="color:var(--good)">▲</b>' : pos > this.livePos0 ? '<b style="color:var(--bad)">▼</b>' : "";
      let tail: string;
      if (i === 0) {
        const second = rows[1];
        tail = second ? `2위와 ${mine.pts - second.pts}점 차` : "";
      } else {
        const lead = rows[0]!;
        const above = rows[i - 1]!;
        const gap = (n: number) => (n === 0 ? "승점 동률" : `${n}점 차`);
        tail = `선두와 ${gap(lead.pts - mine.pts)}`;
        if (i > 1 && above.pts !== lead.pts) tail += ` · ${i}위와 ${gap(above.pts - mine.pts)}`;
      }
      this.liveHtml = `가상 순위: <b style="color:var(--text)">현재 ${pos}위</b> ${arrow}${tail ? ` · ${tail}` : ""}`;
    }
    if (!this.liveHtml) return "";
    const flash = now - this.liveChangedAt < 1600 ? " flash" : "";
    return `<span class="liveTable${flash}">${this.liveHtml}</span>`;
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
    if (shakeAge < this.shakeDur) {
      const k = this.shakeAmp * (1 - shakeAge / this.shakeDur) ** 2;
      ctx.translate((Math.random() * 2 - 1) * k, (Math.random() * 2 - 1) * k);
    }
    const rp = this.replay;
    const frame: Frame | null = rp ? rp.clip.frames[Math.min(rp.clip.frames.length - 1, Math.floor(rp.pos))] ?? null : null;
    this.updateCamera(now, rp);
    applyCamera(ctx, v, this.cam, this.cam.zoom);
    drawPitch(ctx, v, this.stadium, this.kits.outfield[1].primary);
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
    const r = Math.max(5, 1.45 * v.scale);
    const tagsFor = this.showTags ? (r >= 7 ? "all" : "user") : "none";

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
      const kit = this.kitOf(p.team, def.role === "GK");
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
      drawKitDisc(ctx, kit, px, py, r);
      ctx.lineWidth = this.selected === p.id ? 3 : 1.2;
      ctx.strokeStyle = this.selected === p.id ? "#ffd166" : s.ball.owner === p.id ? "#fff" : "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(p.facing) * r * 1.3, py + Math.sin(p.facing) * r * 1.3);
      ctx.stroke();
      const tag = tagsFor === "all" || (tagsFor === "user" && p.team === this.userTeam) ? def.name : null;
      this.drawNumber(px, py, r, def.number, kit, this.selected === p.id, tag);
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
    if (this.goalCam && now - this.goalCam.t0 < GOAL_CAM_MS + 600) this.drawGoalCaption(this.goalCam, v, now);
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
    const spd = this.effSpeed < 5 ? (Math.round(this.effSpeed * 10) / 10).toString() : String(Math.round(this.effSpeed));
    this.clockEl.textContent = this.fmtClock() + (this.playing && this.effSpeed !== this.speed ? `  ${spd}x` : "");
    // 휘슬 직전: the last minute of stoppage time with the user level or a goal down pulses the clock red
    const u = this.userTeam;
    const diff = s.score[u] - s.score[1 - u]!;
    const stoppageLeft = match.halfLength + s.addedTime - s.clock;
    const danger = s.half === 2 && s.phase !== "FULL_TIME" && s.clock > match.halfLength && stoppageLeft <= WHISTLE_PULSE_S && (diff === 0 || diff === -1);
    this.clockEl.classList.toggle("danger", danger);
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

  /** Outfield kit of a side, or the keeper's plain colour. */
  private kitOf(team: TeamId, gk: boolean): Kit {
    if (gk) { const c = this.kits.gk[team]; return { primary: c, secondary: c, pattern: "solid" }; }
    return this.kits.outfield[team];
  }

  /**
   * Camera target for this frame, eased into `this.cam`:
   * - replay: the ball of the current frame with a bit of lead, zoom ramping over the clip;
   * - live goal cam: the scorer/ball at GOAL_CAM_ZOOM for GOAL_CAM_MS, then back out;
   * - otherwise the full pitch. With prefers-reduced-motion the camera cuts instead of easing.
   */
  private updateCamera(now: number, rp: Replay | null): void {
    const dt = this.camTs ? Math.min(100, now - this.camTs) : 16;
    this.camTs = now;
    const reduce = reducedMotion();
    let tx = 0, ty = 0, tz = 1;
    let snap = false;
    if (rp) {
      const n = rp.clip.frames.length;
      if (reduce) {
        const last = rp.clip.frames[n - 1]!;
        tx = last.bx; ty = last.by; tz = 1.4; snap = true;
      } else {
        const t = cameraTarget(rp.clip.frames, rp.pos);
        tx = t.x; ty = t.y;
        const prog = Math.max(0, Math.min(1, rp.pos / Math.max(1, n)));
        tz = REPLAY_ZOOM_FROM + (REPLAY_ZOOM_TO - REPLAY_ZOOM_FROM) * prog;
        // the intro freeze starts already framed on the build-up
        if (now - rp.started < 32) snap = true;
      }
    } else if (this.goalCam) {
      const age = now - this.goalCam.t0;
      if (age < GOAL_CAM_MS) {
        tx = this.goalCam.x; ty = this.goalCam.y; tz = GOAL_CAM_ZOOM;
        snap = reduce;
      } else if (reduce) snap = true;
    }
    if (snap) { this.cam.x = tx; this.cam.y = ty; this.cam.zoom = tz; return; }
    const kp = 1 - Math.exp(-dt / CAM_TAU_POS);
    const kz = 1 - Math.exp(-dt / CAM_TAU_ZOOM);
    this.cam.x += (tx - this.cam.x) * kp;
    this.cam.y += (ty - this.cam.y) * kp;
    this.cam.zoom += (tz - this.cam.zoom) * kz;
    if (Math.abs(this.cam.zoom - 1) < 0.004 && tz === 1) { this.cam.zoom = 1; this.cam.x = tx; this.cam.y = ty; }
  }

  /** "⚽ 이름 · 분'" near the top while the goal cam runs (fades out after it). */
  private drawGoalCaption(g: GoalCam, v: View, now: number): void {
    const ctx = this.ctx;
    const age = now - g.t0;
    const alpha = age < 200 ? age / 200 : age > GOAL_CAM_MS ? Math.max(0, 1 - (age - GOAL_CAM_MS) / 600) : 1;
    if (alpha <= 0) return;
    const immersive = document.body.classList.contains("immersive");
    const fs = Math.max(13, Math.min(22, v.scale * 1.7));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 ${fs}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(g.caption).width + fs * 1.6;
    const h = fs + 14;
    const y0 = (immersive ? 46 : 10) + h / 2;
    ctx.fillStyle = "rgba(10,14,20,0.78)";
    ctx.fillRect(v.w / 2 - w / 2, y0 - h / 2, w, h);
    ctx.fillStyle = g.color;
    ctx.fillRect(v.w / 2 - w / 2, y0 - h / 2, 4, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(g.caption, v.w / 2 + 2, y0 + 1);
    ctx.restore();
  }

  /**
   * Shirt number: inside the disc when there is room (contrast from the kit's dominant colour,
   * with a thin counter-outline so it survives stripes), else just below it. The optional name
   * tag goes under the disc, or under the number when that sits below the disc.
   */
  private drawNumber(px: number, py: number, r: number, num: number, kit: Kit, selected: boolean, tag: string | null = null): void {
    const ctx = this.ctx;
    const text = String(num);
    let tagY: number;
    if (r >= 5.5) {
      const size = Math.max(7, r * (text.length > 1 ? 1.05 : 1.3));
      ctx.font = `700 ${size}px 'IBM Plex Mono', ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fill = kitTextColor(kit);
      if (kit.pattern !== "solid") {
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(1.5, size * 0.22);
        ctx.strokeStyle = fill === "#ffffff" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)";
        ctx.strokeText(text, px, py + 0.5);
      }
      ctx.fillStyle = fill;
      ctx.fillText(text, px, py + 0.5);
      tagY = py + r + 1.5;
    } else {
      const size = Math.max(8, r * 1.6);
      ctx.font = `700 ${size}px 'IBM Plex Mono', ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(text, px, py + r + 1);
      ctx.fillStyle = selected ? "#ffd166" : "#ffffff";
      ctx.fillText(text, px, py + r + 1);
      tagY = py + r + 1 + size + 1;
    }
    if (tag) this.drawTag(px, tagY, r, tag, selected);
  }

  /** Name tag: small white text with a dark outline, centred under (px, y). */
  private drawTag(px: number, y: number, r: number, name: string, selected: boolean): void {
    const ctx = this.ctx;
    const size = Math.max(8, Math.min(13, r * 1.15));
    ctx.font = `600 ${size}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, size * 0.28);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(name, px, y);
    ctx.fillStyle = selected ? "#ffd166" : "rgba(255,255,255,0.95)";
    ctx.fillText(name, px, y);
  }

  /** Replay scene: players and ball from a recorded frame. Name tags are always on here. */
  private drawFrame(f: Frame, v: View): void {
    const ctx = this.ctx;
    const match = this.match;
    const r = Math.max(5, 1.45 * v.scale);
    for (const p of f.players) {
      const def = match.def(p.id);
      const kit = this.kitOf(p.team, def.role === "GK");
      const px = v.ox + p.x * v.scale, py = v.oy + p.y * v.scale;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(px + 1, py + 2, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      drawKitDisc(ctx, kit, px, py, r);
      ctx.lineWidth = 1.2; ctx.strokeStyle = f.owner === p.id ? "#fff" : "rgba(0,0,0,0.5)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(p.f) * r * 1.3, py + Math.sin(p.f) * r * 1.3); ctx.stroke();
      this.drawNumber(px, py, r, def.number, kit, false, this.showTags ? def.name : null);
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
    // "GIF 공유" pill, bottom-right (tap target stored for the pointer handler)
    if (ctx === this.canvas.getContext("2d")) {
      const fs = Math.max(11, v.scale * 1.1);
      ctx.font = `600 ${fs}px 'IBM Plex Sans KR',sans-serif`;
      const label = this.gifBusy ? "GIF 만드는 중…" : "⬇ GIF 공유";
      const bw = ctx.measureText(label).width + 20, bh = fs + 12;
      const bx = v.w - pad - bw, by = v.h - pad - bh - Math.max(12, v.scale * 1.3) - 16;
      ctx.fillStyle = this.gifBusy ? "rgba(60,60,60,0.85)" : "rgba(242,193,78,0.92)";
      ctx.beginPath(); ctx.roundRect?.(bx, by, bw, bh, bh / 2); if (!ctx.roundRect) ctx.rect(bx, by, bw, bh); ctx.fill();
      ctx.fillStyle = this.gifBusy ? "#ddd" : "#1a1400";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
      this.hudGifBtn = { x: bx, y: by, w: bw, h: bh };
    }
    ctx.restore();
  }

  /**
   * Render the clip offscreen at GIF_FPS (≤ GIF_MAX_FRAMES, GIF_W px wide) with the same pitch and
   * frame painters, encode it, and hand it to the share sheet (or a download).
   */
  private async shareClipGif(clip: Clip): Promise<void> {
    if (this.gifBusy) return;
    if (downloadsBlocked() && !("share" in navigator)) { alert("이 환경에서는 파일 저장이 막혀 있습니다. 앱이나 브라우저에서 열면 GIF를 공유할 수 있습니다."); return; }
    this.gifBusy = true;
    this.render();
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the "만드는 중" pill paint
      const ratio = (PITCH.length + 8) / (PITCH.width + 8);
      const w = GIF_W, h = Math.round(GIF_W / ratio);
      const step = Math.max(1, Math.round(20 / GIF_FPS));
      const idx: number[] = [];
      for (let i = 0; i < clip.frames.length && idx.length < GIF_MAX_FRAMES; i += step) idx.push(i);
      if (idx[idx.length - 1] !== clip.frames.length - 1) idx.push(clip.frames.length - 1);
      const frames: GifFrame[] = [];
      const off = document.createElement("canvas");
      off.width = w; off.height = h;
      const octx = off.getContext("2d", { willReadFrequently: true })!;
      const v: View = { w, h, scale: Math.min(w / (PITCH.length + 8), h / (PITCH.width + 8)), ox: w / 2, oy: h / 2 };
      const team = clip.team === null ? "" : this.match.teams[clip.team].shortName;
      const cap = `${clip.minute}' ${team} ${clip.text}`;
      for (const i of idx) {
        this.renderClipFrame(octx, v, clip.frames[i]!, cap);
        frames.push({ data: octx.getImageData(0, 0, w, h).data, width: w, height: h });
        await new Promise((r) => setTimeout(r, 0));
      }
      // hold the last frame a little longer so the goal lands
      frames.push(frames[frames.length - 1]!);
      const bytes = encodeGif(frames, Math.round(100 / GIF_FPS));
      const blob = new Blob([bytes as BlobPart], { type: "image/gif" });
      const name = `3sec-${clip.minute}min-${clip.type.toLowerCase()}.gif`;
      const r = await shareFile(blob, name, `${cap} · 가난한자의 FM`);
      if (r === "blocked") alert("이 환경에서는 파일 저장이 막혀 있습니다. 앱이나 브라우저에서 열면 GIF를 공유할 수 있습니다.");
    } catch (err) {
      console.error(err);
      alert("GIF를 만들지 못했습니다.");
    } finally {
      this.gifBusy = false;
      this.render();
    }
  }

  /** One clip frame into an arbitrary context (same painters as the live view), with a caption. */
  private renderClipFrame(octx: CanvasRenderingContext2D, v: View, f: Frame, caption: string): void {
    const saved = this.ctx;
    this.ctx = octx;
    try {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, v.w, v.h);
      drawPitch(octx, v, this.stadium, this.kits.outfield[1].primary);
      this.drawFrame(f, v);
      const fs = Math.max(10, v.scale * 1.3);
      octx.font = `600 ${fs}px 'IBM Plex Sans KR',sans-serif`;
      octx.textAlign = "center"; octx.textBaseline = "bottom";
      const cw = Math.min(v.w - 8, octx.measureText(caption).width + 16);
      octx.fillStyle = "rgba(0,0,0,0.6)";
      octx.fillRect(v.w / 2 - cw / 2, v.h - fs - 12, cw, fs + 10);
      octx.fillStyle = "#fff";
      octx.fillText(caption, v.w / 2, v.h - 6);
    } finally {
      this.ctx = saved;
    }
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
    const crowd = this.extra.crowd;
    const derby = !!(this.extra.derby || crowd?.derby);
    const l1 = `${st.name} · ${st.capacity.toLocaleString("ko-KR")}석`;
    const l2 = `홈: ${home.name}`;
    const l3 = crowd ? (crowd.attendance >= crowd.capacity ? `관중 ${crowd.attendance.toLocaleString("ko-KR")}명 · 매진` : `관중 ${crowd.attendance.toLocaleString("ko-KR")}명`) : "";
    const ribbon = derby ? "더비 데이" : "";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${fs}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    const w1 = ctx.measureText(l1).width;
    const wr = ribbon ? ctx.measureText(ribbon).width + 14 : 0;
    ctx.font = `${fs - 1}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    const w2 = ctx.measureText(l2).width;
    const w3 = l3 ? ctx.measureText(l3).width : 0;
    const pad = 8;
    const lines = 2 + (l3 ? 1 : 0);
    const w = Math.max(w1 + (wr ? wr + 8 : 0), w2, w3) + pad * 2 + 6;
    const h = fs * lines + pad * 2 + 4 * (lines - 1);
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
    if (ribbon) {
      // derby ribbon: a small red tag after the ground name
      const rx = x0 + pad + 6 + w1 + 8, ry = y0 + pad - 2, rh = fs + 4;
      ctx.fillStyle = "#e63946";
      ctx.fillRect(rx, ry, wr, rh);
      ctx.fillStyle = "#fff";
      ctx.fillText(ribbon, rx + 7, ry + 2);
    }
    ctx.fillStyle = "rgba(230,237,243,0.75)";
    ctx.font = `${fs - 1}px 'IBM Plex Sans KR', system-ui, sans-serif`;
    ctx.fillText(l2, x0 + pad + 6, y0 + pad + fs + 4);
    if (l3) {
      ctx.fillStyle = crowd && crowd.attendance >= crowd.capacity ? "#ffd166" : "rgba(230,237,243,0.75)";
      ctx.fillText(l3, x0 + pad + 6, y0 + pad + (fs + 4) * 2);
    }
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
/** events that hold the auto pacing slow for a moment afterwards */
const DANGER_EVENTS = new Set<string>(["SHOT", "SHOT_ON_TARGET", "SAVE", "BLOCK", "CORNER", "PENALTY", "RED_CARD"]);

function restartLabel(kind: string): string {
  return ({ KICK_OFF: "킥오프", THROW_IN: "스로인", GOAL_KICK: "골킥", CORNER: "코너킥", FREE_KICK: "프리킥", PENALTY: "페널티킥" } as Record<string, string>)[kind] ?? kind;
}

