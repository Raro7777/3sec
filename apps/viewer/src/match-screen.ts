import { keepAwake } from "./platform";
import { DT, PITCH, type Attributes, type Match, type MatchEvent, type MatchState, type PlayerState, type TeamId } from "@3sec/engine";
import { applyCamera, drawPitch, type Camera, type View, project, unproject, screenAngle } from "./render";
import { DEFAULT_STADIUM, stadiumFor, type Stadium } from "./stadiums";
import { ManagerPanel } from "./panel";
import { Sfx } from "./sfx";
import { Haptics } from "./haptics";
import { CLIP_SECONDS, Recorder, cameraTarget, type Clip, type Frame } from "./replay";
import { drawKitDisc, kitTextColor, resolveKits, type Kit, type KitSource, type MatchKits } from "./kits";
import { LAST_CALLS, lastCallDue, TacticsRecorder, seasonRounds, table, type Fixture, type GameState, type TacticsReport } from "@3sec/game";
import { encodeGif, type GifFrame } from "./gif";
import { downloadsBlocked, isNativeApp, shareFile } from "./share";
import { Broadcast, type IntervalStat } from "./broadcast";
import { emblemSvg } from "./emblem";
import { Commentator, josa } from "./commentary";

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
/** A drawn box the name-tag layout has to keep clear of. */
interface Rect { x0: number; x1: number; y0: number; y1: number }
/** One name waiting to be placed under its player. */
interface TagRequest { px: number; y: number; r: number; name: string; selected: boolean; priority: boolean; own: Rect }

/** Legs only start showing on the pitch past this; below it the ring would be permanent clutter. */
const FATIGUE_SHOW_AT = 0.45;

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
  /** the two clubs as the game knows them (custom kits, renamed clubs/grounds, expanded seats); teams[] otherwise */
  clubs?: [ClubLook, ClubLook];
  /** player id → age, for the substitution picker */
  ages?: Record<string, number>;
  /** what this match is: the league round, the cup tie, the continental tie (broadcast.ts) */
  competition?: string;
  /**
   * Finish the other grounds off the main thread (the worker pool replays them from kick-off; the engine is
   * deterministic, so the scores the ticker showed so far still hold). Swaps each `others[].match` for the
   * finished result. Without it "결과로" steps every match in-thread, which is six matches' worth of engine work.
   */
  finishOthers?: () => Promise<void>;
  /**
   * 하프타임 토크: open the dressing room from the half-time card. The callback returns the eleven's
   * attribute moves (the game layer runs the talk and knows the morale), which are pushed into the running
   * match — the second half is played with them.
   */
  halfTimeTalk?: () => Promise<Record<string, Partial<Attributes>> | null>;
}

/** What the viewer needs of a club beyond the engine's team def. */
export interface ClubLook extends KitSource {
  stadiumName?: string;
  capacity?: number;
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
const AUTO_TAU_UP = 0.8;
/** "just happened" hold after a shot / save / block / corner / penalty / red card (ms) */
const DANGER_HOLD_MS = 1100;
/**
 * 자동 pacing tiers (sim seconds per real second). Tuned so a full match lands at ~7 real minutes:
 * open play runs from PLAY_FAST (nothing on) down to PLAY_SLOW (box entries, shots, penalties);
 * dead balls far from goal fly at DEAD_FAST, a corner / penalty / close free kick is set up at
 * SETPIECE; a goal celebration holds CELEB_SLOW for CELEB_MS and then DEAD_FAST.
 */
const PLAY_FAST = 14;
const PLAY_MID = 6;
const PLAY_SLOW = 2.2;
const PLAY_SLOW_TIGHT = 1.8;
const DEAD_FAST = 36;
const SETPIECE = 4;
const CELEB_SLOW = 2.5;
const CELEB_MS = 1500;
/** ceilings late in a tight game, and in stoppage time with the user level or behind */
const CAP_LATE_TIGHT = 9;
const CAP_STOPPAGE = 6;
/** the bottom ticker rotates the other grounds' scores this often (ms) */
const TICKER_MS = 3500;
const TICKER_PER = 2;

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
  private readonly haptics = new Haptics();
  private readonly recorder = new Recorder();
  /** Samples the user's tactics and both sides' stats so the result screen can show what a change did. */
  private tactics: TacticsRecorder | null = null;
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
  private readonly btnHaptics = document.getElementById("btnHaptics") as HTMLButtonElement | null;
  /** the live 0..1 danger score of the current frame, shared by the auto pacing and the crowd bed */
  private dangerNow = 0;
  /** Unit direction the ball is travelling, kept between frames so the trail points the right way. */
  private ballDir: { x: number; y: number } | null = null;
  /** wall-clock time of the last ambient update, so the bed is nudged ~8x a second, not 60x */
  private ambAt = 0;
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
  /** 중계 그래픽 (broadcast.ts): the bug, the line-ups, the lower thirds, the interval cards */
  private bc: Broadcast | null = null;
  /** half-time has already been shown for this half */
  private htShown = false;
  /** the dressing room has been used this match (one talk at the interval, like the one before kick-off) */
  private htTalked = false;
  /** the numbers panel in the terrace band under an upright pitch (renderBand) */
  private bandEl: HTMLDivElement | null = null;
  /** the goal a replay is about, so the scorer stays named while it runs */
  private replayStrap: import("./broadcast").StrapSpec | null = null;
  /** 결정적 순간: the penalty-taker pick and the once-a-match last call share this overlay */
  private readonly callOverlay = document.getElementById("callOverlay") as HTMLDivElement;
  private readonly btnLastCall = document.getElementById("btnLastCall") as HTMLButtonElement;
  private lastCallUsed = false;
  /** the match was running when the overlay opened; resume on close */
  private resumeAfterCall = false;
  private readonly btnFull = document.getElementById("btnFull") as HTMLButtonElement;
  private readonly btnPanel = document.getElementById("btnPanel") as HTMLButtonElement;
  /** user explicitly toggled immersive mode (otherwise it follows phone orientation) */
  private immersiveByUser: boolean | null = null;
  private readonly btnLog = document.getElementById("btnLog") as HTMLButtonElement | null;
  private readonly btnPanelClose = document.getElementById("btnPanelClose") as HTMLButtonElement | null;
  private readonly panelBack = document.getElementById("panelBack");
  /** immersive: show the running commentary strip over the pitch */
  private showLog = (() => { try { return localStorage.getItem("3sec.log") === "1"; } catch { return false; } })();
  /** the drawer paused the match; resume when it closes */
  private resumeOnClose = false;
  /** last visible event of the user's match, for the bottom ticker */
  private lastEventHtml = "";
  /** 중계 자막: turns the engine's event log into a commentator's lines */
  private commentator: Commentator | null = null;
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
      this.btnSound.addEventListener("click", () => {
        this.sfx.setEnabled(!this.sfx.enabled);
        paint();
        if (this.sfx.enabled) { this.sfx.whistle(1, 0.2); if (this.playing) this.sfx.startAmbient(); }
      });
    }
    if (this.btnHaptics) {
      const paint = () => {
        this.btnHaptics!.title = this.haptics.enabled ? "진동 켜짐 (누르면 끔)" : "진동 꺼짐 (누르면 켬)";
        this.btnHaptics!.style.opacity = this.haptics.enabled ? "1" : ".55";
      };
      paint();
      this.btnHaptics.addEventListener("click", () => { this.haptics.setEnabled(!this.haptics.enabled); paint(); if (this.haptics.enabled) this.haptics.yellowCard(); });
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
    this.btnSkip.addEventListener("click", () => this.confirmSkip());
    this.btnContinue.addEventListener("click", () => this.onFinish?.());
    document.getElementById("btnContinue2")!.addEventListener("click", () => this.onFinish?.());
    this.btnLastCall.addEventListener("click", () => this.openLastCall());
    this.speedSel.addEventListener("change", () => (this.speed = this.speedSel.value === "auto" ? "auto" : Number(this.speedSel.value)));
    this.debugChk.addEventListener("change", () => this.render());
    this.btnFull.addEventListener("click", () => this.setImmersive(!document.body.classList.contains("immersive"), true));
    this.btnPanel.addEventListener("click", () => this.togglePanel());
    this.btnPanelClose?.addEventListener("click", () => this.closePanel());
    this.panelBack?.addEventListener("click", () => this.closePanel());
    if (this.btnLog) {
      const paint = () => { document.body.classList.toggle("log-open", this.showLog); this.btnLog!.title = this.showLog ? "중계 자막 숨기기" : "중계 자막 보기"; this.btnLog!.style.opacity = this.showLog ? "1" : ".7"; };
      paint();
      this.btnLog.addEventListener("click", () => { this.showLog = !this.showLog; try { localStorage.setItem("3sec.log", this.showLog ? "1" : "0"); } catch { /* ignore */ } paint(); if (this.showLog) this.logEl.scrollTop = this.logEl.scrollHeight; });
    }
    // immersive: a swipe in from the right edge opens the drawer
    document.getElementById("main")!.addEventListener("pointerdown", (e) => {
      if (!document.body.classList.contains("immersive") || document.body.classList.contains("panel-open")) return;
      if (e.clientX < window.innerWidth - 28) return;
      const x0 = e.clientX;
      const onMove = (ev: PointerEvent) => { if (x0 - ev.clientX > 24) { cleanup(); this.openPanel(); } };
      const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", cleanup); window.removeEventListener("pointercancel", cleanup); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (document.body.classList.contains("panel-open")) { this.closePanel(); return; }
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
    const [home, away]: [ClubLook, ClubLook] = extra.clubs ?? [match.teams[0], match.teams[1]];
    const ground = stadiumFor(home.baseName ?? home.name);
    // a renamed club, a renamed ground or expanded seats: the boards, banner and stands follow the game state
    this.stadium = extra.clubs
      ? { ...ground, shortName: match.teams[0].shortName || ground.shortName, name: home.stadiumName || ground.name, capacity: home.capacity || ground.capacity, grown: home.capacity ? home.capacity / ground.capacity : 1 }
      : ground;
    this.kits = resolveKits(home, away);
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.goalCam = null;
    this.pendingReplay = null;
    this.bannerT0 = null;
    this.userTeam = userTeam;
    this.commentator = new Commentator(match);
    this.tactics = new TacticsRecorder(match, userTeam);
    this.others = others;
    this.onFinish = onFinish;
    this.finished = false;
    this.playing = false;
    this.acc = 0;
    this.effSpeed = 1;
    this.loggedEvents = 0;
    this.fxEvents = 0;
    this.htShown = false;
    this.htTalked = false;
    // nine minutes of watching with no touches is exactly how long Android waits before dimming
    void keepAwake(true);
    this.startBroadcast(extra);
    this.lastCallUsed = false;
    this.closeCall(false);
    this.btnLastCall.hidden = true;
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
    this.lastEventHtml = "";
    this.resumeOnClose = false;
    document.body.classList.remove("panel-open");
    const myKit = this.kits.outfield[userTeam];
    this.panel.attach(match, userTeam, extra.ages ?? {}, { color: myKit.primary, text: kitTextColor(myKit) });
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
    // a phone in either orientation: landscape gets the wide pitch, portrait the pitch standing on end,
    // both filling the screen with the controls in a side column and the manager panel as a drawer
    const phone = Math.min(window.innerWidth, window.innerHeight) < 560;
    const want = active && phone && !this.finished;
    if (want !== document.body.classList.contains("immersive")) this.setImmersive(want, false);
  }

  /** Immersive drawer: opening pauses the match, closing resumes it if it was playing. */
  private openPanel(): void {
    if (!document.body.classList.contains("immersive")) return;
    if (document.body.classList.contains("panel-open")) return;
    document.body.classList.add("panel-open");
    this.resumeOnClose = this.playing && !this.finished;
    if (this.playing) this.setPlaying(false);
    this.panel.update(true);
  }

  private closePanel(resume = true): void {
    if (!document.body.classList.contains("panel-open")) return;
    document.body.classList.remove("panel-open");
    this.panel.clearSelection();
    this.selected = null;
    if (resume && this.resumeOnClose && !this.finished) this.setPlaying(true);
    this.resumeOnClose = false;
  }

  private togglePanel(): void {
    if (document.body.classList.contains("panel-open")) this.closePanel(); else this.openPanel();
  }

  /** Icon-only control labels in the immersive column; full labels otherwise. */
  private syncLabels(): void {
    const imm = document.body.classList.contains("immersive");
    this.btnFull.textContent = imm ? "⛶" : "⛶ 크게";
    this.btnFull.title = imm ? "전체 화면 닫기" : "경기장을 화면에 꽉 채웁니다 (가로 모드 권장)";
    this.btnSkip.textContent = imm ? "⏩" : this.btnSkip.textContent?.startsWith("⏩ 다른") ? "⏩ 다른 구장 종료" : "⏩ 결과로";
    this.btnPanel.textContent = imm ? "☰" : "☰ 전술·교체";
    this.btnPanel.title = "전술·교체 (오른쪽 가장자리에서 밀어도 열립니다)";
    this.btnContinue.textContent = imm ? "→" : "계속 →";
    this.paintPlay();
  }

  private paintPlay(): void {
    const imm = document.body.classList.contains("immersive");
    if (this.replay) this.btnPlay.textContent = imm ? "⏭" : "⏭ 리플레이 건너뛰기";
    else this.btnPlay.textContent = this.playing ? (imm ? "❚❚" : "❚❚ 일시정지") : (imm ? "▶" : "▶ 재생");
    this.btnPlay.title = this.replay ? "리플레이 건너뛰기" : this.playing ? "일시정지" : "재생";
  }

  private setImmersive(on: boolean, byUser: boolean): void {
    if (!on) this.closePanel(false);
    document.body.classList.toggle("immersive", on);
    if (byUser) this.immersiveByUser = on ? true : null;
    this.panel.orient = on ? "right" : "up";
    this.syncLabels();
    this.panel.update(true);
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
    void keepAwake(false); // the match is over; the screen may sleep again
    this.bc?.dispose();
    this.bc = null;
    document.body.classList.remove("bcOn");
    this.closeCall(false);
    this.btnLastCall.hidden = true;
    this.sfx.stopAmbient();
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
    // the crowd bed only runs while the match does (it needs a user gesture to have unlocked audio)
    if (v) this.sfx.startAmbient(); else this.sfx.stopAmbient();
    this.paintPlay();
  }

  private stepAll(n: number, record = false): void {
    for (let i = 0; i < n; i++) {
      if (this.match.state.phase !== "FULL_TIME") { this.match.step(); this.tactics?.sample(); if (record) this.recorder.push(this.match.state); }
      for (const o of this.others) if (o.match.state.phase !== "FULL_TIME") o.match.step();
    }
  }

  /** The manager's own before/after readout for this match, once it has been played (tactics-report.ts). */
  // ------------------------------------------------------------------ 결정적 순간 (penalty taker, last call)

  private openCall(html: string): void {
    this.resumeAfterCall = this.playing && !this.finished;
    if (this.playing) this.setPlaying(false);
    this.callOverlay.innerHTML = html;
    this.callOverlay.hidden = false;
  }

  private closeCall(resume = true): void {
    if (this.callOverlay.hidden) return;
    this.callOverlay.hidden = true;
    this.callOverlay.innerHTML = "";
    if (resume && this.resumeAfterCall && !this.finished) this.setPlaying(true);
    this.resumeAfterCall = false;
  }

  /** Who steps up: the outfielders still on the pitch, best penalty men first, the engine's choice marked. */
  private offerPenaltyTaker(): void {
    const s = this.match.state;
    const cur = s.restart?.takerId ?? null;
    const cands = s.players.filter((p) => p.team === this.userTeam && p.onPitch && !p.sentOff)
      .map((p) => ({ p, d: this.match.def(p.id) }))
      .filter((x) => x.d.role !== "GK" || x.p.id === cur)
      .sort((a, b) => (b.d.attrs.finishing * 0.7 + b.d.attrs.composure * 0.3) - (a.d.attrs.finishing * 0.7 + a.d.attrs.composure * 0.3))
      .slice(0, 8);
    if (!cands.length) return;
    const rows = cands.map(({ p, d }) => `<button class="callOpt${p.id === cur ? " cur" : ""}" data-taker="${p.id}"><span class="ico">${p.id === cur ? "⚽" : ""}</span><span><b>${d.name}</b><small>${d.role}${p.id === cur ? " · 현재 키커" : ""}</small></span><span class="num">결정 ${d.attrs.finishing.toFixed(0)} · 침착 ${d.attrs.composure.toFixed(0)}<br>체력 ${Math.round((1 - p.fatigue) * 100)}%</span></button>`).join("");
    this.openCall(`<div class="callCard"><div class="callTitle">⚽ 페널티킥 — 누가 찹니까?</div><div class="callSub">결정력과 침착성이 성공률을 좌우합니다. 지친 선수는 흔들립니다.</div>${rows}<div class="callActs"><button data-call="keep">그대로 간다</button></div></div>`);
    this.callOverlay.querySelectorAll<HTMLButtonElement>("button[data-taker]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.taker!;
      if (id !== cur && this.match.setRestartTaker(this.userTeam, id)) this.burst("PK 키커", `${this.match.def(id).name}이(가) 공을 놓습니다`, "#ffd166", 1600, false);
      this.closeCall();
    }));
    this.callOverlay.querySelector<HTMLButtonElement>("button[data-call=keep]")?.addEventListener("click", () => this.closeCall());
  }

  private updateLastCallButton(): void {
    const s = this.match.state;
    const show = !this.finished && !this.lastCallUsed && s.phase !== "FULL_TIME" && this.callOverlay.hidden && lastCallDue(this.match.matchSeconds(), this.match.halfLength);
    if (this.btnLastCall.hidden === show) this.btnLastCall.hidden = !show;
  }

  /** The once-a-match shout from the touchline: three ready-made tactical swings. */
  private openLastCall(): void {
    if (this.lastCallUsed || this.finished) return;
    const s = this.match.state;
    const mine = s.score[this.userTeam], theirs = s.score[1 - this.userTeam]!;
    const state = mine > theirs ? "리드 중" : mine < theirs ? "뒤지는 중" : "동점";
    const rows = LAST_CALLS.map((c) => `<button class="callOpt" data-lc="${c.id}"><span class="ico">${c.icon}</span><span><b>${c.label}</b><small>${c.hint}</small></span></button>`).join("");
    this.openCall(`<div class="callCard"><div class="callTitle">📣 마지막 지시 <span style="color:var(--muted);font-weight:400;font-size:13px">${Math.floor(this.match.matchSeconds() / 60)}' · ${state}</span></div><div class="callSub">이번 경기에 한 번뿐입니다. 남은 시간 동안 전술이 통째로 바뀝니다.</div>${rows}<div class="callActs"><button data-call="keep">아직 아니다</button></div></div>`);
    this.callOverlay.querySelectorAll<HTMLButtonElement>("button[data-lc]").forEach((b) => b.addEventListener("click", () => {
      const call = LAST_CALLS.find((c) => c.id === b.dataset.lc);
      if (!call) return;
      this.match.setTactics(this.userTeam, call.patch);
      this.lastCallUsed = true;
      this.btnLastCall.hidden = true;
      this.burst(`${call.icon} ${call.label}!`, call.shout, "#ffd166", 2200, true);
      this.sfx.whistle(1, 0.3);
      this.closeCall();
    }));
    this.callOverlay.querySelector<HTMLButtonElement>("button[data-call=keep]")?.addEventListener("click", () => this.closeCall());
  }

  tacticsReport(): TacticsReport | null {
    return this.tactics?.report() ?? null;
  }

  private ownDone(): boolean {
    return this.match.state.phase === "FULL_TIME";
  }

  /** Step only my own match (the other grounds are being finished elsewhere). */
  private stepOwn(n: number): void {
    for (let i = 0; i < n && !this.ownDone(); i++) { this.match.step(); this.tactics?.sample(); }
  }

  private allDone(): boolean {
    return this.match.state.phase === "FULL_TIME" && this.others.every((o) => o.match.state.phase === "FULL_TIME");
  }

  /**
   * "결과로" hands the rest of the match to the assistant and jumps to the final score. New players read
   * it as "show me the score so far", so the tap opens the interval card first and says exactly what it
   * skips; the small button on the card is the one that skips, the primary one goes back to the game.
   */
  private confirmSkip(): void {
    if (this.finished || !this.bc || this.bc.hasCard()) { void this.skipToEnd(); return; }
    const s = this.match.state;
    const left = Math.max(0, Math.round((this.match.halfLength * 2 - (s.half === 2 ? this.match.halfLength + s.clock : s.clock)) / 60));
    const wasPlaying = this.playing;
    if (wasPlaying) this.setPlaying(false);
    this.bc.closeStrap();
    this.bc.interval(`결과로 건너뛰기 · 남은 시간 약 ${left}분`, `${s.score[0]} - ${s.score[1]}`, [], "계속 지휘한다 ▶", () => {
      if (wasPlaying && !this.finished) this.setPlaying(true);
    }, {
      label: "남은 경기를 수석코치에게 맡기고 결과만 본다 ⏩",
      onPick: () => { this.bc?.closeCard(); void this.skipToEnd(); },
    });
  }

  private async skipToEnd(): Promise<void> {
    this.setPlaying(false);
    this.btnSkip.disabled = true;
    // from here the assistant runs my bench and tactics, as in an auto round; its changes are not "내 지시"
    this.match.enableAi(this.userTeam);
    this.tactics?.handOver();
    // the other grounds go to the worker pool while this thread finishes my own match
    const others = this.extra.finishOthers?.();
    await this.runChunked(() => {
      if (others) this.stepOwn(20 * 30);
      else this.stepAll(20 * 30); // 30 match seconds per slice
      return others ? this.ownDone() : this.allDone();
    }, "경기 결과 계산 중…");
    if (others) {
      let ready = false;
      void others.then(() => { ready = true; }, () => { ready = true; });
      await this.runChunked(() => ready, "다른 구장 결과 기다리는 중…");
      await others;
    }
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
      // one danger reading per frame, shared by the auto pacing (below) and the crowd bed (further down)
      this.dangerNow = this.danger(ts);
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
      // crowd bed: follow the danger score, with a floor while the goal celebration is still going
      if (ts - this.ambAt > 120) {
        this.ambAt = ts;
        const celeb = this.match.state.phase === "GOAL_CELEBRATION" && ts - this.celebT0 < 5000 ? 0.8 : 0;
        this.sfx.ambient(Math.max(this.dangerNow, celeb));
      }
    }
    this.processEvents();
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** React to new events of the user's match: text bursts, shake, sounds and highlight clips. */
  private processEvents(): void {
    const s = this.match.state;
    this.updateLastCallButton();
    const fast = this.playing && this.effSpeed > 12;
    /** at 8x and above the ball ticks would machine-gun, so they stop there */
    const hurried = !this.playing || this.effSpeed >= 8;
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
      // ball ticks: a quiet transient on kicks and challenges, skipped once the sim outruns them
      if (!hurried && KICK_EVENTS.has(e.type)) this.sfx.kick(e.type === "SHOT" || e.type === "SHOT_ON_TARGET" ? 1 : 0.6);
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
      // haptics: celebrate my goals, one dull buzz for a conceded one (only the notable moments buzz)
      if (scoringSide !== null && !this.finished) { if (scoringSide === this.userTeam) this.haptics.goalFor(); else this.haptics.goalAgainst(); }
      switch (e.type) {
        case "GOAL":
          this.goalStrap(e, false);
          if (late) {
            this.burst("극장골!", this.bc ? "" : `${team?.shortName ?? ""} ${e.text.replace(/^골[:!]?\s*/, "")} · 추가시간 결승골`, "#ffd166", 3200, true);
            this.shake(now, 22, 1400); this.flashT0 = now; this.sfx.roar();
            setTimeout(() => this.sfx.roar(), 700);
          } else {
            this.burst("골!!!", this.bc ? "" : `${team?.shortName ?? ""} ${e.text.replace(/^골[:!]?\s*/, "")}`, color, 2200, true);
            this.shake(now, 14); this.flashT0 = now; this.sfx.roar();
          }
          this.sfx.chant(scoringSide === 0 ? 1 : 0.45);
          break;
        case "OWN_GOAL":
          this.goalStrap(e, true);
          if (late) {
            this.burst("극장골!", this.bc ? "" : `${e.text} · 추가시간 결승골`, "#ffd166", 3200, true);
            this.shake(now, 22, 1400); this.flashT0 = now; this.sfx.roar();
            setTimeout(() => this.sfx.roar(), 700);
          } else {
            this.burst("자책골…", this.bc ? "" : e.text, "#ff6b6b", 2000, true);
            this.shake(now, 8); this.sfx.boo();
          }
          this.sfx.chant(scoringSide === 0 ? 0.8 : 0.35);
          break;
        case "OFFSIDE":
          this.bc?.strap({ kind: "note", title: "오프사이드", who: team ? `${team.shortName} 공격 무산` : "오프사이드", minute: this.strapMinute(), color: "#ff9f43" });
          this.sfx.whistle(2, 0.16, 0.08);
          break;
        case "RED_CARD":
          this.bc?.strap({ kind: "card", title: "퇴장", who: this.strapName(e), minute: this.strapMinute(), color: "#ef4444", note: this.teamOf(e)?.name });

          this.shake(now, 6); this.sfx.whistle(1, 0.7); this.sfx.boo(); this.haptics.redCard();
          break;
        case "YELLOW_CARD":
          this.bc?.strap({ kind: "card", title: "경고", who: this.strapName(e), minute: this.strapMinute(), color: "#f2c14e", note: this.teamOf(e)?.name });
          if (!fast) this.sfx.whistle(1, 0.25);
          this.haptics.yellowCard();
          break;
        case "PENALTY":
          this.bc?.strap({ kind: "note", title: "페널티킥", who: team ? `${team.shortName}에게 페널티` : "페널티킥", minute: this.strapMinute(), color: "#f2c14e" });
          this.shake(now, 5); this.sfx.whistle(1, 0.6); this.haptics.penalty();
          // the manager names his kicker: only for a penalty of his own side, in a match he is watching
          if (e.team === this.userTeam && this.playing && !this.finished && !this.replay) this.offerPenaltyTaker();
          break;
        case "INJURY":
          this.bc?.strap({ kind: "note", title: "부상", who: this.strapName(e), minute: this.strapMinute(), color: "#8ecae6", note: "교체가 필요합니다" });
          break;
        case "SAVE": if (!fast) this.sfx.ooh(); break;
        case "SHOT": if (!fast && Math.random() < 0.5) this.sfx.ooh(); break;
        case "KICK_OFF": if (!fast || s.clock < 1) this.sfx.whistle(1, 0.5); break;
        case "HALF_TIME":
          this.sfx.whistle(2, 0.45);
          this.showInterval("하프타임", "후반 시작 ▶");
          break;
        case "FULL_TIME": this.sfx.whistle(3, 0.4); this.sfx.clap(); this.sfx.stopAmbient(); this.haptics.fullTime(); break;
        case "SUBSTITUTION":
          // the colour bar already says whose change it is, so the club prefix comes off
          this.bc?.strap({ kind: "sub", title: "교체", who: e.text.replace(/^교체[:：]?\s*/, "").replace(/^\([^)]*\)\s*:?\s*/, ""), minute: this.strapMinute(), color: this.teamOf(e)?.color ?? "#8ecae6", note: this.teamOf(e)?.name });
          if (!fast) this.sfx.clap();
          break;
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
    // a broadcast cuts to a replay behind a wipe, and names the scorer again while it runs
    void this.bc?.wipe(this.match.teams[this.userTeam].color);
    this.replay = { clip, pos: 0, started: performance.now(), auto };
    if (this.replayStrap) this.bc?.strap(this.replayStrap);
    this.paintPlay();
  }

  private endReplay(): void {
    void this.bc?.wipe(this.match.teams[this.userTeam].color);
    if (this.replayStrap) this.bc?.closeStrap();
    this.replayStrap = null;
    this.replay = null;
    this.acc = 0;
    this.paintPlay();
  }

  /**
   * Tension-aware pacing target for the 자동 mode (eased in frame()): a 0..1 "danger" score from
   * the live state picks a speed between PLAY_FAST (nothing on) and PLAY_SLOW (box entries, shots,
   * penalties); dead balls run at DEAD_FAST far from goal and SETPIECE when a corner / free kick /
   * penalty is being set up; a goal celebration holds CELEB_SLOW for CELEB_MS and then DEAD_FAST.
   * Late in a tight game the ceiling drops. A 90-minute match takes about 7 real minutes.
   */
  private autoSpeed(now: number): number {
    const m = this.match, s = m.state;
    const u = this.userTeam;
    const margin = Math.abs(s.score[0] - s.score[1]);
    const inStoppage = s.half === 2 && s.clock > m.halfLength;
    const lateTight = s.half === 2 && (s.clock > m.halfLength - 10 * 60) && margin <= 1;
    const userBehindOrLevel = s.score[u] - s.score[1 - u]! <= 0 && margin <= 1;
    let cap = DEAD_FAST;
    if (lateTight) cap = CAP_LATE_TIGHT;
    if (inStoppage && userBehindOrLevel) cap = CAP_STOPPAGE;
    if (s.phase === "GOAL_CELEBRATION") return Math.min(cap, now - this.celebT0 < CELEB_MS ? CELEB_SLOW : DEAD_FAST);
    if (s.phase !== "PLAY") {
      const r = s.restart;
      if (r && r.kind !== "KICK_OFF") {
        const dist = Math.hypot(PITCH.halfLength * m.dirOf(r.team) - r.pos.x, r.pos.y);
        const near = r.kind === "CORNER" || r.kind === "PENALTY" || (r.kind === "FREE_KICK" && dist < 30);
        if (near) return Math.min(cap, SETPIECE);
      }
      return Math.min(cap, DEAD_FAST);
    }
    const d = this.dangerNow; // read once per frame in frame(), also drives the ambient crowd bed
    // piecewise linear: 0 → PLAY_FAST, 0.5 → PLAY_MID, 1 → PLAY_SLOW (tighter at the top on a knife edge)
    const high = lateTight ? PLAY_SLOW_TIGHT : PLAY_SLOW;
    const v = d < 0.5 ? PLAY_FAST - (PLAY_FAST - PLAY_MID) * (d / 0.5) : PLAY_MID - (PLAY_MID - high) * ((d - 0.5) / 0.5);
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

  // ------------------------------------------------------------------ 중계 그래픽

  /** Build the graphics for this match and open with the line-ups. */
  private startBroadcast(extra: MatchExtra): void {
    const stage = document.getElementById("stage");
    if (!stage) return;
    this.bc?.dispose();
    this.bc = new Broadcast(stage);
    document.body.classList.add("bcOn");
    const looks = extra.clubs;
    const side = (i: 0 | 1) => {
      const t = this.match.teams[i];
      const look = looks?.[i];
      return { name: look?.name ?? t.name, shortName: t.shortName, color: t.color, crest: emblemSvg({ id: i, name: look?.name ?? t.name, shortName: t.shortName, color: t.color }, 17) };
    };
    const home = side(0), away = side(1);
    const comp = extra.competition ?? "리그";
    this.bc.reset(home, away, comp);
    const xi = (i: 0 | 1): string[] => this.match.state.players.filter((p) => p.team === i && p.onPitch).slice(0, 11).map((p) => this.match.def(p.id).name);
    const note = extra.crowd ? `${comp} · ${extra.crowd.attendance.toLocaleString("ko-KR")}명` : comp;
    void this.bc.lineups(xi(0), xi(1), this.match.teams[0].tactics.formation, this.match.teams[1].tactics.formation, note).then(() => {
      // the line-ups are gone and the pitch is still: say what starts it, once, and only if nothing has
      if (!this.playing && !this.finished && this.match.state.tick === 0) {
        this.bc?.strap({ kind: "note", title: "킥오프", who: "▶ 을 누르면 시작합니다", minute: "", color: "#ffd166", note: "☰ 에서 전술과 교체" });
      }
    });
  }

  private teamOf(e: MatchEvent): { name: string; shortName: string; color: string } | null {
    return e.team === null ? null : this.match.teams[e.team];
  }

  private strapMinute(): string {
    return `${Math.floor(this.match.matchSeconds() / 60) + 1}'`;
  }

  /** The player an event names, taken off the event's own text when it carries no id. */
  private strapName(e: MatchEvent): string {
    if (e.playerId) return this.match.def(e.playerId).name;
    return e.text.replace(/^[^:：]*[:：]\s*/, "");
  }

  /** A goal, announced the way a broadcast announces it. */
  private goalStrap(e: MatchEvent, own: boolean): void {
    const s = this.match.state;
    const scoring = own && e.team !== null ? ((1 - e.team) as TeamId) : e.team;
    const t = scoring === null ? null : this.match.teams[scoring];
    const spec = {
      kind: "goal" as const,
      title: own ? "자책골" : "골",
      who: this.strapName(e),
      minute: this.strapMinute(),
      color: t?.color ?? "#ffd166",
      score: `${s.score[0]} - ${s.score[1]}`,
      note: t?.name,
    };
    this.replayStrap = spec;
    this.bc?.strap(spec);
  }

  /** The half-time and full-time card, with the numbers that decided it. */
  private showInterval(title: string, button: string | null): void {
    if (!this.bc || this.htShown) return;
    this.htShown = true;
    const s = this.match.state;
    const [a, b] = s.stats;
    const tot = Math.max(1, a.possessionTicks + b.possessionTicks);
    const stats: IntervalStat[] = [
      { label: "점유율", home: `${Math.round((100 * a.possessionTicks) / tot)}%`, away: `${Math.round((100 * b.possessionTicks) / tot)}%`, share: a.possessionTicks / tot },
      { label: "슈팅 (유효)", home: `${a.shots} (${a.shotsOnTarget})`, away: `${b.shots} (${b.shotsOnTarget})`, share: a.shots / Math.max(1, a.shots + b.shots) },
      { label: "xG", home: a.xg.toFixed(2), away: b.xg.toFixed(2), share: a.xg / Math.max(0.01, a.xg + b.xg) },
      { label: "패스 성공", home: `${a.passesCompleted}/${a.passes}`, away: `${b.passesCompleted}/${b.passes}` },
      { label: "코너 · 파울", home: `${a.corners} · ${a.fouls}`, away: `${b.corners} · ${b.fouls}` },
    ];
    const wasPlaying = this.playing;
    if (wasPlaying) this.setPlaying(false);
    const done = this.finished;
    this.bc.closeStrap();
    const talk = !done && this.extra.halfTimeTalk && !this.htTalked
      ? {
          label: "라커룸 →",
          onPick: () => {
            void this.extra.halfTimeTalk!().then((moves) => {
              // said nothing: the card is still there, and so is the dressing room
              if (!moves) return;
              this.htTalked = true;
              for (const [id, deltas] of Object.entries(moves)) this.match.adjustAttrs(id, deltas);
              // the talk's own button walks the manager out, so the card behind it goes
              this.bc?.closeCard();
              if (!this.finished) this.setPlaying(true);
            });
          },
        }
      : undefined;
    this.bc.interval(title, `${s.score[0]} - ${s.score[1]}`, stats, button, () => {
      if (done) { this.onFinish?.(); return; }
      if (wasPlaying && !this.finished) this.setPlaying(true);
    }, talk);
  }

  /**
   * What the Android back button should do while a match is on screen: shut the drawer, then leave the
   * immersive view. A match itself is never abandoned by back — there is no way back to the week from a
   * game in progress, and a stray gesture would throw the result away.
   */
  backOut(): boolean {
    if (this.bc?.hasCard()) return false; // an interval card is a decision, not a thing to dismiss
    if (document.body.classList.contains("panel-open")) { this.closePanel(); return true; }
    if (document.body.classList.contains("immersive")) { this.setImmersive(false, true); return true; }
    return false;
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
    const raw = this.debugChk.checked;
    if (HIDDEN_EVENTS.has(e.type) && !raw) return;
    // the engine's own text with the overlay on; otherwise the commentator's line, or silence
    const said = raw ? e.text : this.commentator?.line(e) ?? null;
    if (said === null) return;
    const text = raw ? said : josa(said);
    const div = document.createElement("div");
    const team = e.team === null ? "" : this.match.teams[e.team].shortName;
    const color = e.team === null ? "#e6edf3" : this.match.teams[e.team].color;
    div.innerHTML = `<span style="opacity:.6">${String(e.minute).padStart(2, "0")}'</span> <span style="color:${color};font-weight:600">${team}</span> ${text}`;
    if (e.type === "GOAL" || e.type === "OWN_GOAL") div.style.color = "#ffd166";
    if (e.type === "SUBSTITUTION" || e.type === "TACTICS") div.style.color = "#8ecae6";
    this.lastEventHtml = `<i>${e.minute}'</i><span style="color:${color};font-weight:600">${team}</span> ${text}`;
    const clip = this.clipByEvent.get(this.loggedEvents - 1);
    if (clip) div.innerHTML += ` <button data-clip="${clip.id}" style="padding:0 6px;font-size:11px;border-radius:10px;margin-left:4px" title="주요 장면 다시 보기">▶ 리플레이</button> <button data-gif="${clip.id}" style="padding:0 6px;font-size:11px;border-radius:10px" title="이 장면을 GIF로 저장/공유">GIF 공유</button>`;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private renderStats(): void {
    const [a, b] = this.match.state.stats;
    const tot = Math.max(1, a.possessionTicks + b.possessionTicks);
    this.renderBand(a, b, tot);
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
    const line = (o: SideMatch) => {
      const s = o.match.state;
      const done = s.phase === "FULL_TIME" ? " ✓" : "";
      return `<span>${o.match.teams[0].shortName} <b style="color:var(--text)">${s.score[0]}-${s.score[1]}</b> ${o.match.teams[1].shortName}${done}</span>`;
    };
    const live = this.liveLine();
    if (!document.body.classList.contains("immersive")) {
      this.othersEl.innerHTML = live + this.others.map(line).join("");
      return;
    }
    // immersive ticker: last event on the left, the other grounds rotating in pairs on the right
    const n = this.others.length;
    let og = "";
    if (n > 0) {
      const pages = Math.ceil(n / TICKER_PER);
      const page = Math.floor(performance.now() / TICKER_MS) % pages;
      og = `<span class="og">${this.others.slice(page * TICKER_PER, page * TICKER_PER + TICKER_PER).map(line).join("")}${pages > 1 ? `<span style="opacity:.5">${page + 1}/${pages}</span>` : ""}</span>`;
    }
    this.othersEl.innerHTML = `<span class="tick">${this.lastEventHtml || `<i>${this.fmtClock().slice(0, 5)}</i>${this.match.teams[0].name} vs ${this.match.teams[1].name}`}</span>${live}${og}`;
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
      const lastRounds = live.fixture.round >= seasonRounds(st) - 3;
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
    // immersive: the pitch takes the whole stage (the manager panel is a drawer over it)
    const pad = document.body.classList.contains("immersive") ? 0 : 16;
    const maxW = Math.max(200, stage.clientWidth - pad);
    const maxH = Math.max(140, stage.clientHeight - pad);
    // a stage taller than it is wide (a phone held upright) gets the pitch standing on end
    const portrait = maxH > maxW;
    const ratio = portrait ? (PITCH.width + 8) / (PITCH.length + 8) : (PITCH.length + 8) / (PITCH.width + 8);
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    // immersive: the canvas takes the whole stage and the stadium painting (stands, surround) fills
    // what the pitch's aspect ratio leaves over, instead of black bands either side
    if (document.body.classList.contains("immersive")) { w = maxW; h = maxH; }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // On an upright phone the pitch is narrower than the stage is tall, and the stadium painting fills the
    // rest as terraces. The band under the pitch is dead space until it is big enough to carry the match's
    // numbers; then it does, and #stats (hidden in this layout) has somewhere to live.
    const scale = portrait ? Math.min(w / (PITCH.width + 8), h / (PITCH.length + 8)) : 0;
    const band = portrait ? (h - scale * (PITCH.length + 8)) / 2 : 0;
    const screen = document.getElementById("screen-match");
    screen?.classList.toggle("has-band", document.body.classList.contains("immersive") && band >= BAND_MIN);
    stage.style.setProperty("--band", `${Math.round(band)}px`);
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
    const rot = h > w;
    const scale = rot ? Math.min(w / (PITCH.width + 8), h / (PITCH.length + 8)) : Math.min(w / (PITCH.length + 8), h / (PITCH.width + 8));
    return { w, h, scale, ox: w / 2, oy: h / 2, rot };
  }

  private pick(e: PointerEvent): void {
    if (!this.match) return;
    const v = this.view();
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = unproject(v, e.clientX - rect.left, e.clientY - rect.top);
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
    const toPx = (x: number, y: number): [number, number] => project(v, x, y);
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
        const [ax, ay] = toPx(line, -PITCH.halfWidth), [bx2, by2] = toPx(line, PITCH.halfWidth);
        ctx.strokeStyle = match.teams[team].color;
        ctx.setLineDash([4, 6]);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx2, by2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    const tags: TagRequest[] = [];
    const numBoxes: Rect[] = [];
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
      ctx.lineTo(px + Math.cos(screenAngle(v, p.facing)) * r * 1.3, py + Math.sin(screenAngle(v, p.facing)) * r * 1.3);
      ctx.stroke();
      // Tiredness, on the player rather than only in the panel: the substitution decision is made
      // while watching, and having to open a screen to find out who is gone is the wrong moment.
      if (p.team === this.userTeam && p.fatigue > FATIGUE_SHOW_AT) this.drawFatigueArc(px, py, r, p.fatigue);
      const { tagY, box } = this.drawNumber(px, py, r, def.number, kit, this.selected === p.id);
      numBoxes.push(box);
      const named = tagsFor === "all" || (tagsFor === "user" && p.team === this.userTeam);
      if (named) tags.push({ px, y: tagY, r, name: def.name, selected: this.selected === p.id, priority: this.selected === p.id || s.ball.owner === p.id, own: box });
    }
    this.drawTags(tags, numBoxes);

    const b = s.ball;
    const [bx, by] = toPx(b.pos.x, b.pos.y);
    const bspeed = Math.hypot(b.vel.x, b.vel.y);
    // the trail direction is kept in screen space so it follows a rotated view
    this.ballDir = bspeed > 0.5 ? (v.rot ? { x: b.vel.y / bspeed, y: -b.vel.x / bspeed } : { x: b.vel.x / bspeed, y: b.vel.y / bspeed }) : this.ballDir;
    this.drawBall(bx, by, b.z, bspeed, v);

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
    this.bc?.update([s.score[0]!, s.score[1]!], this.fmtClock(), this.replay ? "리플레이" : phaseText[s.phase] ?? s.phase, this.clockEl.classList.contains("danger"));
    this.bc?.replay(!!this.replay);
    while (this.loggedEvents < s.events.length) this.appendLog(s.events[this.loggedEvents++]!);
    this.renderStats();
    this.panel.update();

    if (!this.finished && this.allDone()) {
      this.finished = true;
      this.setPlaying(false);
      this.btnPlay.disabled = true;
      this.btnSkip.disabled = true;
      this.btnContinue.style.display = "";
      this.closePanel(false);
      document.body.classList.add("finished");
      const [hc, ac] = match.teams;
      const mine = this.userTeam === 0 ? s.score[0] - s.score[1] : s.score[1] - s.score[0];
      document.getElementById("ftScore")!.innerHTML = `<span style="color:${hc.color}">${hc.shortName}</span> ${s.score[0]} - ${s.score[1]} <span style="color:${ac.color}">${ac.shortName}</span>`;
      const season = !!this.extra.live || this.others.length > 0;
      document.getElementById("ftNote")!.textContent = !season ? (mine > 0 ? "승리! 결과를 확인하세요." : mine < 0 ? "패배… 결과를 확인하세요." : "무승부. 결과를 확인하세요.") : mine > 0 ? "승리! 라운드 결과와 순위를 확인하세요." : mine < 0 ? "패배… 결과 화면에서 다른 경기장 결과도 확인하세요." : "무승부. 결과 화면으로 이동합니다.";
      // the broadcast card carries the result; the plain overlay is the fallback when it is not up
      if (this.bc) {
        this.htShown = false;
        const note = document.getElementById("ftNote")!.textContent ?? "";
        this.showInterval(mine > 0 ? "경기 종료 · 승리" : mine < 0 ? "경기 종료 · 패배" : "경기 종료 · 무승부", "결과로 →");
        void note;
      } else {
        this.ftOverlay.hidden = false;
      }
    } else if (!this.finished && s.phase === "FULL_TIME") {
      // The user's match is over but another ground is still playing: finish them quietly.
      this.btnSkip.textContent = document.body.classList.contains("immersive") ? "⏩" : "⏩ 다른 구장 종료";
      this.btnSkip.title = "다른 구장 종료";
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
  private drawNumber(px: number, py: number, r: number, num: number, kit: Kit, selected: boolean): { tagY: number; box: Rect } {
    const ctx = this.ctx;
    const text = String(num);
    let tagY: number;
    let numBox: Rect;
    if (r >= 5.5) {
      const size = Math.max(7, r * (text.length > 1 ? 1.05 : 1.3));
      ctx.font = `700 ${size}px 'IBM Plex Mono', ui-monospace, monospace`;
      const w = ctx.measureText(text).width;
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
      numBox = { x0: px - w / 2, x1: px + w / 2, y0: py - size / 2, y1: py + size / 2 };
    } else {
      const size = Math.max(8, r * 1.6);
      ctx.font = `700 ${size}px 'IBM Plex Mono', ui-monospace, monospace`;
      const w = ctx.measureText(text).width;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(text, px, py + r + 1);
      ctx.fillStyle = selected ? "#ffd166" : "#ffffff";
      ctx.fillText(text, px, py + r + 1);
      tagY = py + r + 1 + size + 1;
      numBox = { x0: px - w / 2, x1: px + w / 2, y0: py + r + 1, y1: tagY };
    }
    return { tagY, box: numBox };
  }

  /**
   * Place the name tags collected while drawing the players.
   *
   * Drawn as they came, tags of players standing close together printed on top of one another and
   * neither could be read — exactly in the goalmouth scrambles where you most want to know who is
   * who. Tags are laid out top-down instead: each is pushed below any tag already placed that it
   * would collide with, and one that cannot find room within two rows is dropped rather than
   * scribbled over its neighbour. The ball carrier and the selected player are placed first so they
   * always keep their name.
   */
  private drawTags(tags: TagRequest[], obstacles: Rect[] = []): void {
    const ctx = this.ctx;
    // shirt numbers are already on the pitch: a name printed across one is as unreadable as two names
    // printed across each other, so they are obstacles from the start
    const order = [...tags].sort((a, b) => Number(b.priority) - Number(a.priority) || a.y - b.y);
    const placed: Rect[] = [];
    for (const t of order) {
      // every number except this player's own: a name sits directly under its own shirt number by
      // construction, so treating that one as an obstacle would reject every tag on the pitch
      const blocked = [...placed, ...obstacles.filter((o) => o !== t.own)];
      const size = Math.max(8, Math.min(13, t.r * 1.15));
      ctx.font = `600 ${size}px 'IBM Plex Sans KR', system-ui, sans-serif`;
      const w = ctx.measureText(t.name).width;
      const step = size + 2;
      let y = t.y;
      let rows = 0;
      const hits = (yy: number) =>
        blocked.some((q) => t.px - w / 2 < q.x1 + 2 && t.px + w / 2 > q.x0 - 2 && yy < q.y1 + 1 && yy + size > q.y0 - 1);
      while (hits(y) && rows < 3) { y += step; rows++; }
      if (hits(y)) continue; // no room: better nothing than an unreadable pile
      placed.push({ x0: t.px - w / 2, x1: t.px + w / 2, y0: y, y1: y + size });
      this.drawTag(t.px, y, t.r, t.name, t.selected);
    }
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

  /**
   * The ball.
   *
   * A 3px white dot on a green pitch is the hardest thing on the screen to follow, and it is the one
   * thing you are always looking for. Three cues, none of them decoration: a tapered trail behind it
   * while it is travelling, so a driven pass reads as a line rather than a dot that teleports; a
   * shadow that stays on the ground and tightens as the ball climbs, which is what separates a cross
   * from a ground pass at a glance; and a dark rim that keeps it visible against a white kit.
   */
  private drawBall(bx: number, by: number, z: number, speed: number, v: View): void {
    const ctx = this.ctx;
    const br = Math.max(2.5, 0.45 * v.scale) * (1 + z * 0.12);
    const lift = z * v.scale * 0.5;

    // trail: only while it is genuinely moving, and only as long as the speed earns
    if (speed > 6) {
      const len = Math.min(28, (speed - 6) * 1.5) * (v.scale / 6);
      const dir = this.ballDir;
      if (dir) {
        const g = ctx.createLinearGradient(bx, by - lift, bx - dir.x * len, by - dir.y * len - lift);
        g.addColorStop(0, "rgba(255,255,255,0.5)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = br * 1.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(bx, by - lift);
        ctx.lineTo(bx - dir.x * len, by - dir.y * len - lift);
        ctx.stroke();
      }
    }

    // shadow stays on the ground and shrinks with height, so the two separate as the ball rises
    const shrink = 1 / (1 + z * 0.35);
    ctx.fillStyle = `rgba(0,0,0,${0.4 * shrink})`;
    ctx.beginPath();
    ctx.ellipse(bx + 1, by + 1.5, br * 0.9 * shrink, br * 0.55 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(bx, by - lift, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20,24,28,0.85)";
    ctx.lineWidth = Math.max(1, br * 0.32);
    ctx.stroke();
  }

  /**
   * A wearing-down ring around one of my players: an arc that shrinks as the legs go, amber at first
   * and red once they are spent. Drawn under the disc's own outline so it reads as a state of the
   * player rather than another object on the pitch.
   */
  private drawFatigueArc(px: number, py: number, r: number, fatigue: number): void {
    const ctx = this.ctx;
    // remap so the ring is full at the threshold and empty at exhaustion, not a stub that barely moves
    const spent = Math.min(1, (fatigue - FATIGUE_SHOW_AT) / (1 - FATIGUE_SHOW_AT));
    const sweep = Math.PI * 2 * spent;
    if (sweep < 0.05) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.6, r * 0.28);
    ctx.strokeStyle = spent > 0.66 ? "rgba(239,71,111,0.95)" : "rgba(255,209,102,0.9)";
    ctx.beginPath();
    // grows clockwise from the top, so a glance reads "how much of the ring is gone"
    ctx.arc(px, py, r + ctx.lineWidth * 0.75, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.stroke();
    ctx.restore();
  }

  /** Replay scene: players and ball from a recorded frame. Name tags are always on here. */
  private drawFrame(f: Frame, v: View): void {
    const ctx = this.ctx;
    const match = this.match;
    const r = Math.max(5, 1.45 * v.scale);
    const replayTags: TagRequest[] = [];
    const replayBoxes: Rect[] = [];
    for (const p of f.players) {
      const def = match.def(p.id);
      const kit = this.kitOf(p.team, def.role === "GK");
      const [px, py] = project(v, p.x, p.y);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(px + 1, py + 2, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      drawKitDisc(ctx, kit, px, py, r);
      ctx.lineWidth = 1.2; ctx.strokeStyle = f.owner === p.id ? "#fff" : "rgba(0,0,0,0.5)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(screenAngle(v, p.f)) * r * 1.3, py + Math.sin(screenAngle(v, p.f)) * r * 1.3); ctx.stroke();
      const { tagY, box } = this.drawNumber(px, py, r, def.number, kit, false);
      replayBoxes.push(box);
      if (this.showTags) replayTags.push({ px, y: tagY, r, name: def.name, selected: false, priority: f.owner === p.id, own: box });
    }
    this.drawTags(replayTags, replayBoxes);
    const [bx, by] = project(v, f.bx, f.by);
    this.drawBall(bx, by, f.bz, 0, v);
  }

  /** REPLAY badge, slow-motion note and the event caption. */
  private drawReplayHud(rp: Replay, v: View, now: number): void {
    const ctx = this.ctx;
    const blink = Math.floor(now / 500) % 2 === 0;
    // The broadcast layer already carries the REPLAY mark and the scorer's lower third, so with it on the
    // canvas draws neither: the same words in two places is the clutter the graphics were meant to remove.
    const bare = !!this.bc;
    ctx.save();
    const pad = 10;
    if (!bare) {
      ctx.font = `700 ${Math.max(13, v.scale * 1.6)}px 'Barlow Condensed','IBM Plex Sans KR',sans-serif`;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      const label = "● REPLAY";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(pad, pad, ctx.measureText(label).width + 16, Math.max(13, v.scale * 1.6) + 10);
      ctx.fillStyle = blink ? "#ff4d4f" : "#ffffff";
      ctx.fillText(label, pad + 8, pad + 5);
    }
    ctx.font = `${Math.max(11, v.scale * 1.1)}px 'IBM Plex Sans KR',sans-serif`;
    ctx.textAlign = bare ? "left" : "right";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const hint = bare ? "탭하여 건너뛰기" : `슬로 모션 ${REPLAY_RATE}x · 탭하여 건너뛰기`;
    ctx.fillText(hint, bare ? pad : v.w - pad, bare ? v.h * 0.5 : pad + 6);
    if (!bare) {
      const team = rp.clip.team === null ? "" : this.match.teams[rp.clip.team].shortName;
      const cap = `${rp.clip.minute}' ${team} ${rp.clip.text}`;
      ctx.font = `600 ${Math.max(12, v.scale * 1.3)}px 'IBM Plex Sans KR',sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      const w = ctx.measureText(cap).width + 24;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(v.w / 2 - w / 2, v.h - pad - Math.max(12, v.scale * 1.3) - 12, w, Math.max(12, v.scale * 1.3) + 12);
      ctx.fillStyle = "#fff";
      ctx.fillText(cap, v.w / 2, v.h - pad - 6);
    }
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
      // the lower third owns the bottom of the picture while the broadcast graphics are up
      const bx = v.w - pad - bw, by = v.h - pad - bh - (bare ? 74 : Math.max(12, v.scale * 1.3) + 16);
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
    if (!isNativeApp() && downloadsBlocked() && !("share" in navigator)) { alert("이 환경에서는 파일 저장이 막혀 있습니다. 앱이나 브라우저에서 열면 GIF를 공유할 수 있습니다."); return; }
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

  /** The match's numbers in the terrace band under an upright pitch: a broadcast panel, not a strip of text. */
  private renderBand(a: MatchState["stats"][0], b: MatchState["stats"][1], tot: number): void {
    let el = this.bandEl;
    if (!el) {
      el = document.createElement("div");
      el.id = "bandStats";
      document.getElementById("stage")?.appendChild(el);
      this.bandEl = el;
    }
    if (!document.getElementById("screen-match")?.classList.contains("has-band")) { el.hidden = true; return; }
    el.hidden = false;
    const h = this.match.teams[0], w = this.match.teams[1];
    const pos = Math.round((100 * a.possessionTicks) / tot);
    const cell = (label: string, x: string, y: string, share?: number) => `<div class="bcStat"><span class="l">${x}</span><span class="k">${label}</span><span class="r">${y}</span>${share === undefined ? "" : `<div class="bcBar"><i style="width:${Math.round(share * 100)}%;background:${h.color}"></i><u style="width:${Math.round((1 - share) * 100)}%;background:${w.color}"></u></div>`}</div>`;
    el.innerHTML = `<div class="bandHead"><b style="color:${h.color}">${h.shortName}</b><span>경기 기록</span><b style="color:${w.color}">${w.shortName}</b></div>` +
      cell("점유율", `${pos}%`, `${100 - pos}%`, a.possessionTicks / tot) +
      cell("슈팅 (유효)", `${a.shots} (${a.shotsOnTarget})`, `${b.shots} (${b.shotsOnTarget})`, a.shots / Math.max(1, a.shots + b.shots)) +
      cell("xG", a.xg.toFixed(2), b.xg.toFixed(2), a.xg / Math.max(0.01, a.xg + b.xg)) +
      cell("패스 성공", `${a.passesCompleted}/${a.passes}`, `${b.passesCompleted}/${b.passes}`);
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
    // the broadcast bug owns the top-left corner; the banner sits under it rather than behind it
    const y0 = this.bc ? (immersive ? 96 : 92) : immersive ? 48 : 8;
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

/** the terrace band under an upright pitch has to be this tall before the numbers move into it */
const BAND_MIN = 118;
/** kick-off banner lifetime in real ms after the first play press */
const BANNER_MS = 5000;

const HIDDEN_EVENTS = new Set(["SHOT_ON_TARGET", "INTERCEPTION", "TACKLE", "BLOCK"]);
/** events that hold the auto pacing slow for a moment afterwards */
const DANGER_EVENTS = new Set<string>(["SHOT", "SHOT_ON_TARGET", "SAVE", "BLOCK", "CORNER", "PENALTY", "RED_CARD"]);

/** events that make a "ball being kicked" noise: shots, clearances/challenges and restarts */
const KICK_EVENTS = new Set<string>(["SHOT", "SHOT_ON_TARGET", "BLOCK", "TACKLE", "INTERCEPTION", "GOAL_KICK", "THROW_IN", "FREE_KICK", "CORNER"]);

function restartLabel(kind: string): string {
  return ({ KICK_OFF: "킥오프", THROW_IN: "스로인", GOAL_KICK: "골킥", CORNER: "코너킥", FREE_KICK: "프리킥", PENALTY: "페널티킥" } as Record<string, string>)[kind] ?? kind;
}

