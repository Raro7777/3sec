import { Rng } from "./rng";
import { TUNING } from "./tuning";
import { normalizeTactics } from "./teams";
import { ROLES, type RoleDef } from "./ai/roles";

const TACTIC_LABEL: Partial<Record<keyof Tactics, string>> = { mentality: "멘탈리티", defensiveLine: "수비라인", pressing: "프레싱", directness: "직접성", width: "폭", tempo: "템포", counter: "역습", engageLine: "압박선", offsideTrap: "오프사이드 트랩", formation: "포메이션" };
import { PITCH, goalCenter, inPenaltyArea, penaltySpot } from "./pitch";
import { FORMATIONS, roleDistance, slotToPitch } from "./formation";
import { BALL, kickBall, stepBall } from "./physics/ball";
import { a01, stepPlayer } from "./physics/player";
import { add, dist, fromAngle, len, norm, pointSegment, scale, sub, type Vec2 } from "./math/vec";
import { computePositioning } from "./ai/positioning";
import { decideOnBall, executeRestart } from "./ai/decision";
import type {
  AttackDir,
  BallState,
  MatchEvent,
  MatchEventType,
  MatchState,
  PlayerDef,
  PlayerState,
  Restart,
  RestartKind,
  Tactics,
  TeamDef,
  TeamId,
  TeamStats,
} from "./types";

export const TICK_HZ = 20;
export const DT = 1 / TICK_HZ;

export interface MatchOptions {
  seed?: number;
  /** seconds per half (default 45 * 60) */
  halfLength?: number;
  /** teams whose substitutions/tactics are handled by the built-in AI manager (default: [1]) */
  aiManaged?: TeamId[];
  /** starting fatigue (0..1) per player id, e.g. tired legs carried over from a congested schedule */
  initialFatigue?: Record<string, number>;
}

export const MAX_SUBS = 5;

const emptyStats = (): TeamStats => ({
  possessionTicks: 0,
  shots: 0,
  shotsOnTarget: 0,
  goals: 0,
  corners: 0,
  fouls: 0,
  offsides: 0,
  passes: 0,
  passesCompleted: 0,
  crosses: 0,
  tackles: 0,
  saves: 0,
  xg: 0,
  yellows: 0,
  reds: 0,
});

/** Per-shot bookkeeping while the ball is in flight toward a goal. */
interface ShotInFlight {
  shooterId: string;
  team: TeamId;
  xg: number;
  saveAttempted: boolean;
  onTargetCounted: boolean;
}

export class Match {
  readonly teams: [TeamDef, TeamDef];
  readonly state: MatchState;
  readonly rng: Rng;
  readonly halfLength: number;
  readonly defs = new Map<string, PlayerDef>();
  readonly teamOf = new Map<string, TeamId>();
  readonly byId = new Map<string, PlayerState>();

  /** who a pass was aimed at (for chasing / completion stats) */
  intendedReceiver: string | null = null;
  /** players making a timed off-ball run (give-and-go / overlap): id -> tick it ends */
  readonly runUntil = new Map<string, number>();
  /** AI-managed teams' base tactics; score management is applied on top */
  private aiBase: Partial<Record<TeamId, Tactics>> = {};
  private aiBucket: Partial<Record<TeamId, string>> = {};
  /** tick of the last pass/clearance kick (defenders react with a delay) */
  lastKickTick = -1000;
  /** tick at which possession last changed hands (transition / counter-attack window) */
  lastTurnoverTick = -1000;
  private lastPossTeam: TeamId | null = null;
  /** true for a few seconds after winning the ball: the moment to break quickly */
  inTransition(team: TeamId): boolean {
    return this.lastPossTeam === team && this.state.tick - this.lastTurnoverTick < 20 * 4;
  }

  /** a pass whose outcome is not yet settled (completed when a team-mate gains possession, failed on opponent touch/dead ball) */
  passInFlight: { team: TeamId; fromId: string } | null = null;

  /** Called by the decision layer when a genuine pass (not a clearance) is played. */
  notePass(from: PlayerState): void {
    this.passInFlight = { team: from.team, fromId: from.id };
  }
  /** players currently assigned to chase/press the ball (recomputed periodically by the AI) */
  chasers = new Set<string>();
  /** man-marking assignments: defender id -> opponent id (recomputed periodically by the AI) */
  marks = new Map<string, string>();
  /** predicted ball positions at 0.25 s intervals (index 0 = now), refreshed each tick when loose */
  readonly ballTrack: Float64Array = new Float64Array(2 * 17);
  private ballTrackTick = -1;

  /** Predict the loose ball's path (flight with drag + bounces, then rolling). */
  updateBallTrack(): void {
    const s = this.state;
    if (this.ballTrackTick === s.tick) return;
    this.ballTrackTick = s.tick;
    const b = s.ball;
    let x = b.pos.x, y = b.pos.y, z = b.z, vx = b.vel.x, vy = b.vel.y, vz = b.vz;
    const h = 0.05;
    let idx = 0;
    this.ballTrack[0] = x;
    this.ballTrack[1] = y;
    for (let i = 1; i <= 16; i++) {
      for (let k = 0; k < 5; k++) {
        if (z > 0.001 || vz > 0) {
          const sp = Math.hypot(vx, vy, vz);
          const drag = BALL.dragK * sp;
          vx -= vx * drag * h;
          vy -= vy * drag * h;
          vz -= (BALL.gravity + vz * drag) * h;
          x += vx * h;
          y += vy * h;
          z += vz * h;
          if (z <= 0) {
            z = 0;
            if (Math.abs(vz) > BALL.settleVz) {
              vz = -vz * BALL.restitution;
              vx *= BALL.bounceFriction;
              vy *= BALL.bounceFriction;
            } else vz = 0;
          }
        } else {
          const sp = Math.hypot(vx, vy);
          if (sp > 1e-6) {
            const ns = Math.max(0, sp - (BALL.rollingDecel + BALL.dragK * sp * sp) * h);
            vx *= ns / sp;
            vy *= ns / sp;
          }
          x += vx * h;
          y += vy * h;
        }
      }
      idx += 2;
      this.ballTrack[idx] = x;
      this.ballTrack[idx + 1] = y;
    }
  }
  shot: ShotInFlight | null = null;
  /** simple per-player decision throttle */
  private nextDecision = new Map<string, number>();
  /** optional debug hooks (used by tuning scripts) */
  debug: {
    onSave?: (info: { lateral: number; reach: number; pSave: number; speed: number; saved: boolean; distToBall: number }) => void;
    onPass?: (info: { from: string; to: string; d: number; margin: number; lane: number; lofted: boolean; score: number; pressure: number }) => void;
  } = {};

  private readonly initialFatigue: Record<string, number>;

  constructor(home: TeamDef, away: TeamDef, opts: MatchOptions = {}) {
    this.initialFatigue = opts.initialFatigue ?? {};
    home = { ...home, tactics: normalizeTactics(home.tactics) };
    away = { ...away, tactics: normalizeTactics(away.tactics) };
    this.teams = [home, away];
    this.rng = new Rng(opts.seed ?? 1);
    this.halfLength = opts.halfLength ?? 45 * 60;

    const players: PlayerState[] = [];
    for (const team of this.teams) {
      for (const [i, def] of [...team.players, ...team.bench].entries()) {
        this.defs.set(def.id, def);
        this.teamOf.set(def.id, team.id);
        const onPitch = i < team.players.length;
        const ps: PlayerState = {
          id: def.id,
          team: team.id,
          pos: { x: 0, y: (PITCH.halfWidth + 3) * (team.id === 0 ? -1 : 1) },
          vel: { x: 0, y: 0 },
          facing: 0,
          target: { x: 0, y: 0 },
          desiredSpeed: 0,
          fatigue: Math.max(0, Math.min(0.6, this.initialFatigue[def.id] ?? 0)),
          onPitch,
          distance: 0,
          yellow: 0,
          sentOff: false,
          injured: false,
          kickCooldown: 0,
          possessionTime: 0,
          intent: "",
        };
        players.push(ps);
        this.byId.set(def.id, ps);
      }
    }
    this.aiManaged = new Set(opts.aiManaged ?? [1]);
    // An AI manager who knows the squad is outclassed sets up to sit deep and go direct.
    for (const team of this.aiManaged) {
      const q = (t: TeamDef) => t.players.reduce((acc, p) => acc + Object.values(p.attrs).reduce((x, y) => x + y, 0) / 20, 0) / t.players.length;
      const gap = q(this.teams[team]) - q(this.teams[team === 0 ? 1 : 0]);
      if (gap < -1.5) {
        // The bigger the gap, the deeper and more direct: a low block, narrow, and long balls to the outlet.
        const k = Math.min(1, (-gap - 1.5) / 2.5); // 0 at gap -1.5 .. 1 at gap -4
        const t = this.teams[team].tactics;
        this.teams[team].tactics = {
          ...t,
          directness: Math.min(1, t.directness + 0.3 + 0.15 * k),
          defensiveLine: Math.max(0, t.defensiveLine - 0.25 - 0.15 * k),
          mentality: Math.max(0, t.mentality - 0.2 - 0.15 * k),
          pressing: Math.max(0, t.pressing - 0.2 - 0.1 * k),
          width: Math.max(0, t.width - 0.15),
        };
      } else if (gap > 1.5) {
        const t = this.teams[team].tactics;
        this.teams[team].tactics = { ...t, mentality: Math.min(1, t.mentality + 0.1), pressing: Math.min(1, t.pressing + 0.15), defensiveLine: Math.min(1, t.defensiveLine + 0.15) };
      }
    }

    // Home advantage: the crowd lifts the home side a touch (worth ~+0.15 goals per match).
    if (TUNING.homeBoost > 0) {
      const t = this.teams[0].tactics;
      this.teams[0].tactics = { ...t, mentality: Math.min(1, t.mentality + TUNING.homeBoost), pressing: Math.min(1, t.pressing + TUNING.homeBoost) };
    }
    for (const team of this.aiManaged) this.aiBase[team] = { ...this.teams[team].tactics };

    const ball: BallState = {
      pos: { x: 0, y: 0 },
      z: 0,
      vel: { x: 0, y: 0 },
      vz: 0,
      owner: null,
      lastTouch: null,
      lastTouchTeam: null,
      prevTouch: null,
    };

    const kickoffTeam: TeamId = this.rng.chance(0.5) ? 0 : 1;
    this.state = {
      tick: 0,
      clock: 0,
      half: 1,
      addedTime: 0,
      phase: "PRE_KICKOFF",
      phaseTimer: 0,
      score: [0, 0],
      attackDir: [1, -1],
      ball,
      players,
      lineups: [home.players.map((p) => p.id), away.players.map((p) => p.id)],
      subsUsed: [0, 0],
      pendingSubs: [],
      restart: null,
      secondHalfKickoff: kickoffTeam === 0 ? 1 : 0,
      events: [],
      stats: [emptyStats(), emptyStats()],
      lastPass: null,
      stoppages: 0,
    };

    this.refreshActive();
    this.placeFormation(0);
    this.placeFormation(1);
    this.setupRestart("KICK_OFF", kickoffTeam, { x: 0, y: 0 });
  }

  // ---------------------------------------------------------------- helpers

  def(id: string): PlayerDef {
    return this.defs.get(id)!;
  }

  player(id: string): PlayerState {
    return this.byId.get(id)!;
  }

  dirOf(team: TeamId): AttackDir {
    return this.state.attackDir[team];
  }

  opp(team: TeamId): TeamId {
    return team === 0 ? 1 : 0;
  }

  private activeAll: PlayerState[] = [];
  private activeTeam: [PlayerState[], PlayerState[]] = [[], []];

  /** Refresh cached lists (once per tick and after a sending-off / substitution). */
  refreshActive(): void {
    this.activeAll = this.state.players.filter((p) => p.onPitch && !p.sentOff);
    this.activeTeam = [this.activeAll.filter((p) => p.team === 0), this.activeAll.filter((p) => p.team === 1)];
  }

  /** Teams managed by the built-in AI manager. */
  aiManaged: Set<TeamId>;
  private lastAiCheck = -1;
  private aiShifted: [boolean, boolean] = [false, false];

  activePlayers(team?: TeamId): PlayerState[] {
    return team === undefined ? this.activeAll : this.activeTeam[team];
  }

  minute(): number {
    const base = this.state.half === 1 ? 0 : 45;
    return base + Math.floor(this.state.clock / 60) + 1;
  }

  matchSeconds(): number {
    return (this.state.half === 1 ? 0 : this.halfLength) + this.state.clock;
  }

  emit(type: MatchEventType, team: TeamId | null, playerId: string | null, text: string, pos?: Vec2): void {
    const ev: MatchEvent = {
      t: this.matchSeconds(),
      minute: this.minute(),
      type,
      team,
      playerId,
      text,
    };
    if (pos) ev.pos = { x: pos.x, y: pos.y };
    this.state.events.push(ev);
  }

  /** The goalkeeper of a team: whoever occupies formation slot 0. */
  keeper(team: TeamId): PlayerState {
    return this.player(this.state.lineups[team][0]!);
  }

  /** Is this player currently playing in goal? */
  isKeeper(id: string): boolean {
    const team = this.teamOf.get(id)!;
    return this.state.lineups[team][0] === id;
  }

  /** Formation slot index of an on-pitch player, or -1. */
  slotIndex(id: string): number {
    return this.state.lineups[this.teamOf.get(id)!].indexOf(id);
  }

  homeSlot(id: string): Vec2 {
    const team = this.teamOf.get(id)!;
    const t = this.teams[team];
    const idx = Math.max(0, this.slotIndex(id));
    const slot = FORMATIONS[t.tactics.formation][idx]!;
    return slotToPitch(slot, this.dirOf(team), 0.7 + 0.5 * t.tactics.width);
  }

  /** Bench players still available to come on. */
  benchAvailable(team: TeamId): PlayerState[] {
    return this.teams[team].bench.map((d) => this.player(d.id)).filter((p) => !p.onPitch && !p.sentOff && !this.usedSubs.has(p.id));
  }
  private usedSubs = new Set<string>();

  /** Place a team in formation inside its own half (kick-off shape, Law 8). */
  private placeFormation(team: TeamId): void {
    const dir = this.dirOf(team);
    for (const id of this.state.lineups[team]) {
      const p = this.player(id);
      const home = this.homeSlot(id);
      // Compress the formation into the own half: x in forward coords maps [-52.5, +52.5] -> [-50, -2]
      const fx = home.x * dir; // forward coords
      const ownHalfX = -2 - (52.5 - fx) * 0.5 * 0.92;
      let pos = { x: ownHalfX * dir, y: home.y };
      if (dist(pos, { x: 0, y: 0 }) < PITCH.centerCircleRadius + 0.5) {
        pos = { x: -(PITCH.centerCircleRadius + 1) * dir, y: home.y };
      }
      p.pos = pos;
      p.target = { ...pos };
      p.vel = { x: 0, y: 0 };
      p.facing = dir === 1 ? 0 : Math.PI;
    }
  }

  /** Whose possession is it, for positioning purposes. */
  possessionTeam(): TeamId | null {
    const b = this.state.ball;
    if (b.owner) return this.teamOf.get(b.owner)!;
    return b.lastTouchTeam;
  }

  // ---------------------------------------------------------------- substitutions & tactics

  /**
   * Request a substitution. Applied immediately if the ball is dead, otherwise queued for the
   * next stoppage (Law 3). Returns an error string, or null when accepted.
   */
  requestSubstitution(team: TeamId, outId: string, inId: string): string | null {
    const s = this.state;
    const out = this.byId.get(outId);
    const inn = this.byId.get(inId);
    if (!out || !inn || out.team !== team || inn.team !== team) return "unknown player";
    if (!out.onPitch || out.sentOff) return "player is not on the pitch";
    if (inn.onPitch || inn.sentOff || this.usedSubs.has(inn.id)) return "substitute not available";
    if (!this.teams[team].bench.some((d) => d.id === inId)) return "not a bench player";
    const queued = s.pendingSubs.filter((q) => q.team === team).length;
    if (s.subsUsed[team] + queued >= MAX_SUBS) return `substitution limit (${MAX_SUBS}) reached`;
    if (s.pendingSubs.some((q) => q.outId === outId || q.inId === inId)) return "already queued";
    if (s.phase === "FULL_TIME") return "match is over";
    s.pendingSubs.push({ team, outId, inId });
    if (s.phase !== "PLAY") this.applyPendingSubs();
    return null;
  }

  cancelSubstitution(team: TeamId, outId: string): void {
    const s = this.state;
    s.pendingSubs = s.pendingSubs.filter((q) => !(q.team === team && q.outId === outId));
  }

  private applyPendingSubs(): void {
    const s = this.state;
    if (s.pendingSubs.length === 0) return;
    const subs = s.pendingSubs;
    s.pendingSubs = [];
    for (const sub of subs) {
      const out = this.player(sub.outId);
      const inn = this.player(sub.inId);
      if (!out.onPitch || out.sentOff || inn.onPitch) continue;
      const slot = this.slotIndex(out.id);
      if (slot < 0) continue;
      s.lineups[sub.team][slot] = inn.id;
      out.onPitch = false;
      out.intent = "off";
      inn.onPitch = true;
      this.usedSubs.add(inn.id);
      s.subsUsed[sub.team]++;
      // Enter from the touchline at the halfway line; walk off to the same side.
      const side = sub.team === 0 ? -1 : 1;
      inn.pos = { x: 0, y: (PITCH.halfWidth - 0.5) * side };
      inn.vel = { x: 0, y: 0 };
      inn.fatigue = Math.max(0, Math.min(0.6, this.initialFatigue[inn.id] ?? 0));
      out.pos = { x: 0, y: (PITCH.halfWidth + 3) * side };
      out.vel = { x: 0, y: 0 };
      if (s.ball.owner === out.id) s.ball.owner = null;
      this.chasers.delete(out.id);
      this.marks.delete(out.id);
      if (s.restart?.takerId === out.id) s.restart.takerId = inn.id;
      this.emit(
        "SUBSTITUTION",
        sub.team,
        inn.id,
        `교체 (${this.teams[sub.team].shortName}): ${this.name(out.id)} OUT → ${this.name(inn.id)} IN`,
      );
    }
    this.refreshActive();
  }

  /** Change tactics live. A formation change re-assigns the eleven to the new slots by role fit. */
  setTactics(team: TeamId, patch: Partial<Tactics>): void {
    const t = this.teams[team];
    const prev = t.tactics;
    const merged = { ...prev, ...patch };
    // A formation change resets the roles unless the caller supplied a matching set.
    if (merged.formation !== prev.formation && !patch.roles) merged.roles = undefined;
    const next: Tactics = normalizeTactics(merged);
    t.tactics = next;
    if (next.formation !== prev.formation) {
      this.reassignLineup(team);
      this.emit("TACTICS", team, null, `${t.shortName} 포메이션 변경 → ${next.formation}`);
    } else {
      const changed = (Object.keys(patch) as (keyof Tactics)[]).filter((k) => k !== "roles" && prev[k] !== next[k]);
      const rolesChanged = !!patch.roles && JSON.stringify(prev.roles) !== JSON.stringify(next.roles);
      if (changed.length || rolesChanged) this.emit("TACTICS", team, null, `${t.shortName} 전술 조정: ${[...changed.map((k) => TACTIC_LABEL[k] ?? k), ...(rolesChanged ? ["역할"] : [])].join(", ")}`);
    }
  }

  /** Greedy assignment of the current eleven to the formation's slots by role distance. */
  private reassignLineup(team: TeamId): void {
    const s = this.state;
    const slots = FORMATIONS[this.teams[team].tactics.formation];
    const current = [...s.lineups[team]];
    const gk = current[0]!;
    const outfield = current.slice(1);
    const assigned: string[] = [gk];
    // Fill slots in order of "hardest to fill" (wide/specialist roles first) to avoid poor leftovers.
    const order = slots.map((slot, i) => ({ slot, i })).slice(1);
    order.sort((a, b) => (a.slot.role.startsWith("L") || a.slot.role.startsWith("R") ? -1 : 0) - (b.slot.role.startsWith("L") || b.slot.role.startsWith("R") ? -1 : 0));
    const picks = new Map<number, string>();
    const pool = new Set(outfield);
    for (const { slot, i } of order) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const id of pool) {
        const d = roleDistance(this.def(id).role, slot.role) + (1 - a01(this.def(id).attrs.positioning)) * 0.2;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      picks.set(i, best!);
      pool.delete(best!);
    }
    for (let i = 1; i < slots.length; i++) assigned[i] = picks.get(i)!;
    s.lineups[team] = assigned;
  }

  /** Built-in manager for AI teams: tired legs off after the hour, tactical shift when chasing/protecting. */
  private aiManage(): void {
    const s = this.state;
    const minute = this.minute();
    if (minute === this.lastAiCheck) return;
    this.lastAiCheck = minute;
    for (const team of this.aiManaged) {
      const opp = this.opp(team);
      const diff = s.score[team] - s.score[opp];
      // Game management: a side two goals up sits in and protects the lead; a side behind pushes
      // harder the later it gets. Applied on top of the base tactics whenever the situation changes.
      const base = this.aiBase[team];
      if (base) {
        let dm = 0, dl = 0, dp = 0, dd = 0;
        if (diff >= 3) { dm = -0.4; dl = -0.25; dp = -0.35; }
        else if (diff >= 2) { dm = -0.3; dl = -0.2; dp = -0.25; }
        else if (diff === 1 && minute >= 70) { dm = -0.12; dl = -0.1; dp = -0.05; }
        else if (diff === -1 && minute >= 60) { dm = 0.15; dl = 0.1; dp = 0.1; dd = 0.1; }
        else if (diff <= -2 && minute >= 45) { dm = 0.3; dl = 0.2; dp = 0.2; dd = 0.15; }
        else if (diff < 0 && minute >= 80) { dm = 0.3; dl = 0.2; dp = 0.2; dd = 0.15; }
        const bucket = `${dm}|${dl}|${dp}|${dd}`;
        if (bucket !== this.aiBucket[team]) {
          this.aiBucket[team] = bucket;
          const c = (v: number) => Math.max(0, Math.min(1, v));
          this.setTactics(team, { mentality: c(base.mentality + dm), defensiveLine: c(base.defensiveLine + dl), pressing: c(base.pressing + dp), directness: c(base.directness + dd) });
          this.aiShifted[team] = dm !== 0;
        }
      }
      // Substitutions: an injured player comes off at once; from the hour, the most fatigued
      // outfielder is replaced by the best-fitting sub.
      const eleven = s.lineups[team].slice(1).map((id) => this.player(id)).filter((p) => !p.sentOff);
      const hurt = eleven.find((p) => p.injured && !s.pendingSubs.some((q) => q.outId === p.id));
      if ((hurt && s.subsUsed[team] < MAX_SUBS) || (minute >= 60 && minute % 5 === 0 && s.subsUsed[team] < 3)) {
        const threshold = minute >= 75 ? 0.4 : 0.5;
        const tired = hurt ?? eleven.filter((p) => p.fatigue > threshold).sort((a, b) => b.fatigue - a.fatigue)[0];
        if (!tired) continue;
        const bench = this.benchAvailable(team).filter((p) => this.def(p.id).role !== "GK");
        let best: PlayerState | null = null;
        let bestD = 4;
        for (const b of bench) {
          const d = roleDistance(this.def(b.id).role, this.def(tired.id).role);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        if (best) this.requestSubstitution(team, tired.id, best.id);
      }
    }
  }

  // ---------------------------------------------------------------- main loop

  step(): void {
    const s = this.state;
    if (s.phase === "FULL_TIME") return;
    s.tick++;
    this.refreshActive();
    if (this.aiManaged.size) this.aiManage();
    if (s.phase === "PLAY") this.checkInjuries();

    for (const p of s.players) {
      if (p.kickCooldown > 0) p.kickCooldown -= DT;
    }

    switch (s.phase) {
      case "PRE_KICKOFF":
      case "RESTART_SETUP":
        this.stepRestartSetup();
        break;
      case "GOAL_CELEBRATION":
        s.phaseTimer -= DT;
        this.advanceClock();
        if (s.phaseTimer <= 0) {
          const conceding = this.opp(this.lastGoalTeam!);
          this.placeFormation(0);
          this.placeFormation(1);
          this.setupRestart("KICK_OFF", conceding, { x: 0, y: 0 });
        }
        break;
      case "HALF_TIME":
        s.phaseTimer -= DT;
        this.applyPendingSubs();
        if (s.phaseTimer <= 0) this.startSecondHalf();
        break;
      case "PLAY":
        this.stepPlay();
        break;
    }
  }

  private lastGoalTeam: TeamId | null = null;

  private advanceClock(): void {
    const s = this.state;
    s.clock += DT;
  }

  private checkHalfEnd(): boolean {
    const s = this.state;
    const limit = this.halfLength + s.addedTime;
    if (s.clock < limit) return false;
    // Do not blow the whistle in the middle of a promising attack: wait until the
    // ball is in the middle third or loose (simplified referee discretion).
    const b = s.ball;
    const attackTeam = this.possessionTeam();
    if (attackTeam !== null && Math.abs(b.pos.x) > 30 && b.pos.x * this.dirOf(attackTeam) > 0 && s.clock < limit + 30) {
      return false;
    }
    if (s.half === 1) {
      this.emit("HALF_TIME", null, null, `전반 종료: ${this.scoreline()}`);
      s.phase = "HALF_TIME";
      s.phaseTimer = 3;
    } else {
      this.emit("FULL_TIME", null, null, `경기 종료: ${this.scoreline()}`);
      s.phase = "FULL_TIME";
    }
    b.owner = null;
    b.vel = { x: 0, y: 0 };
    b.vz = 0;
    return true;
  }

  private startSecondHalf(): void {
    const s = this.state;
    s.half = 2;
    s.clock = 0;
    s.stoppages = 0;
    s.addedTime = 0;
    s.attackDir = [s.attackDir[1], s.attackDir[0]];
    for (const p of s.players) p.fatigue = Math.max(0, p.fatigue - 0.15);
    this.placeFormation(0);
    this.placeFormation(1);
    this.setupRestart("KICK_OFF", s.secondHalfKickoff, { x: 0, y: 0 });
  }

  scoreline(): string {
    return `${this.teams[0].shortName} ${this.state.score[0]} - ${this.state.score[1]} ${this.teams[1].shortName}`;
  }

  // ---------------------------------------------------------------- restarts

  setupRestart(kind: RestartKind, team: TeamId, pos: Vec2): void {
    const s = this.state;
    const b = s.ball;
    b.pos = { x: pos.x, y: pos.y };
    b.z = 0;
    b.vel = { x: 0, y: 0 };
    b.vz = 0;
    b.owner = null;
    b.lastTouch = null;
    b.prevTouch = null;
    b.lastTouchTeam = team;
    this.intendedReceiver = null;
    this.shot = null;
    s.lastPass = null;
    this.passInFlight = null; // ball went dead: the pass did not find a team-mate

    // Law 3: substitutions happen while the ball is dead.
    this.applyPendingSubs();

    // Realistic dead-ball durations: the ball is in play for roughly 55-60 of the 90 minutes.
    const timers: Record<RestartKind, number> = {
      KICK_OFF: 10,
      THROW_IN: 10,
      GOAL_KICK: 22,
      CORNER: 30,
      FREE_KICK: 25,
      PENALTY: 40,
    };

    let taker: PlayerState;
    const candidates = this.activePlayers(team).filter((p) => !this.isKeeper(p.id));
    if (kind === "GOAL_KICK") {
      taker = this.keeper(team);
    } else if (kind === "PENALTY") {
      taker = candidates.reduce((best, p) =>
        this.def(p.id).attrs.finishing > this.def(best.id).attrs.finishing ? p : best,
      );
    } else if (kind === "KICK_OFF") {
      taker = candidates.reduce((best, p) => (dist(p.pos, pos) < dist(best.pos, pos) ? p : best));
    } else {
      taker = candidates.reduce((best, p) => (dist(p.pos, pos) < dist(best.pos, pos) ? p : best));
    }

    // A substitution during the stoppage adds a little time.
    const restart: Restart = { kind, team, pos: { ...pos }, takerId: taker.id, timer: timers[kind] + (s.pendingSubs.length ? 0 : 0) };
    s.restart = restart;
    s.phase = kind === "KICK_OFF" && s.tick === 0 ? "PRE_KICKOFF" : "RESTART_SETUP";
    if (kind !== "KICK_OFF") s.stoppages++;
  }

  private stepRestartSetup(): void {
    const s = this.state;
    const r = s.restart!;
    r.timer -= DT;
    if (s.phase !== "PRE_KICKOFF") this.advanceClock();

    computePositioning(this, DT);

    for (const p of this.activePlayers()) {
      stepPlayer(p, this.def(p.id).attrs, DT);
    }
    this.resolveBodyContact();

    const taker = this.player(r.takerId!);
    if (r.timer <= 0 && dist(taker.pos, r.pos) < 1.2) {
      if (r.kind === "KICK_OFF") this.emit("KICK_OFF", r.team, taker.id, `킥오프: ${this.teams[r.team].shortName}`);
      executeRestart(this, r, taker);
      s.restart = null;
      s.phase = "PLAY";
    } else if (r.timer < -8) {
      // Safety: taker could not reach the ball (should not happen). Teleport.
      taker.pos = { x: r.pos.x - 0.5 * this.dirOf(r.team), y: r.pos.y };
    }
  }

  // ---------------------------------------------------------------- open play

  private stepPlay(): void {
    const s = this.state;
    const b = s.ball;

    this.advanceClock();

    // Possession stats + turnover bookkeeping
    const pt = this.possessionTeam();
    if (pt !== null) {
      s.stats[pt].possessionTicks++;
      if (pt !== this.lastPossTeam) {
        this.lastPossTeam = pt;
        this.lastTurnoverTick = s.tick;
      }
    }

    computePositioning(this, DT);

    // On-ball decisions
    if (b.owner) {
      const owner = this.player(b.owner);
      owner.possessionTime += DT;
      const due = this.nextDecision.get(owner.id) ?? 0;
      if (s.tick >= due) {
        const interval = decideOnBall(this, owner);
        this.nextDecision.set(owner.id, s.tick + Math.max(1, Math.round(interval * TICK_HZ)));
      }
    }

    // Move players
    for (const p of this.activePlayers()) {
      stepPlayer(p, this.def(p.id).attrs, DT);
    }
    this.resolveBodyContact();

    // Ball: dribble-follow or free physics
    if (b.owner) {
      const owner = this.player(b.owner);
      const ahead = fromAngle(owner.facing, 0.35);
      b.pos = add(owner.pos, ahead);
      b.vel = { ...owner.vel };
      b.z = 0;
      b.vz = 0;
      this.resolveTackles(owner);
    } else {
      stepBall(b, DT);
      this.resolveLooseBall();
    }

    if (this.state.phase !== "PLAY") return;
    this.refereeBallOut();
    if (this.state.phase !== "PLAY") return;
    this.checkHalfEnd();
  }

  /**
   * Soft body contact: players cannot run through each other. Overlapping pairs are pushed
   * apart (the stronger player yields less) and lose the velocity component driving them
   * together. This is what lets a goal-side defender actually bar the way to goal.
   */
  private resolveBodyContact(): void {
    const ps = this.activePlayers();
    const minD = 0.75;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      for (let j = i + 1; j < ps.length; j++) {
        const c = ps[j]!;
        const dx = c.pos.x - a.pos.x;
        const dy = c.pos.y - a.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const overlap = minD - d;
        const sa = a01(this.def(a.id).attrs.strength);
        const sc = a01(this.def(c.id).attrs.strength);
        const wa = sc / (sa + sc); // a moves proportionally to c's strength
        a.pos.x -= nx * overlap * wa;
        a.pos.y -= ny * overlap * wa;
        c.pos.x += nx * overlap * (1 - wa);
        c.pos.y += ny * overlap * (1 - wa);
        // Kill approach velocity (inelastic contact)
        const va = a.vel.x * nx + a.vel.y * ny;
        const vc = c.vel.x * nx + c.vel.y * ny;
        if (va > 0) {
          a.vel.x -= nx * va * 0.9;
          a.vel.y -= ny * va * 0.9;
        }
        if (vc < 0) {
          c.vel.x -= nx * vc * 0.9;
          c.vel.y -= ny * vc * 0.9;
        }
      }
    }
  }

  /** Control radius for gaining a loose ball. */
  private controlRadius(p: PlayerState, ballSpeed: number): number {
    const attrs = this.def(p.id).attrs;
    const base = this.isKeeper(p.id) ? 1.6 : 0.9;
    return base + 0.35 * a01(attrs.firstTouch) - Math.min(0.4, ballSpeed * 0.012);
  }

  private resolveLooseBall(): void {
    const s = this.state;
    const b = s.ball;
    const ballSpeed = len(b.vel);

    // Goalkeeper save check for shots
    if (this.shot) this.checkSave();
    if (s.phase !== "PLAY") return;

    // Which players can reach the ball right now?
    // Use the closest approach over this tick's travel segment (avoids tunnelling at high speed),
    // and disallow "controlling" a ball that is moving away from the player.
    const prevPos = { x: b.pos.x - b.vel.x * DT, y: b.pos.y - b.vel.y * DT };
    let best: PlayerState | null = null;
    let bestD = Infinity;
    // High balls: an outfield player can head a descending ball between 1.3 m and 2.4 m.
    if (b.z > 1.3 && b.z < 2.4 && b.vz < 0) {
      this.resolveHeader();
      return;
    }

    for (const p of this.activePlayers()) {
      if (p.kickCooldown > 0) continue;
      const isGk = this.isKeeper(p.id);
      const maxZ = isGk ? 2.4 : 1.3;
      if (b.z > maxZ) continue;
      const d = ballSpeed > 6 ? pointSegment(p.pos, prevPos, b.pos).d : dist(p.pos, b.pos);
      if (d >= this.controlRadius(p, ballSpeed)) continue;
      // Contested receptions: the intended receiver (who shields and reads the pass) has priority
      // over a marker unless the marker is clearly closer.
      // Inside the defending team's penalty area defenders win contested balls (no attacker priority).
      const inOppBox = inPenaltyArea(b.pos, this.dirOf(p.team)) && p.team === b.lastTouchTeam;
      const bias = inOppBox ? 0 : p.id === this.intendedReceiver ? TUNING.receiverBias : p.team === b.lastTouchTeam ? 0.2 : 0;
      if (d - bias >= bestD) continue;
      if (ballSpeed > 4) {
        const toP = sub(p.pos, b.pos);
        const dp = len(toP) || 1;
        const approach = (b.vel.x * toP.x + b.vel.y * toP.y) / dp; // + = ball coming toward player
        if (approach < -1.5 && dp > 0.5) continue; // ball already past / going away
      }
      best = p;
      bestD = d - bias;
    }
    if (!best) return;

    // Shielding: when the intended receiver is right there, a defender who is merely a little
    // closer to the ball does not simply take it – the receiver uses their body. The receiver
    // wins most of these duels (first touch/strength vs anticipation/marking), except inside
    // the defending team's own penalty area where defenders attack the ball.
    if (this.intendedReceiver && best.id !== this.intendedReceiver && best.team !== b.lastTouchTeam) {
      const recv = this.byId.get(this.intendedReceiver);
      if (recv && recv.onPitch && !recv.sentOff && recv.kickCooldown <= 0 && dist(recv.pos, b.pos) < 1.6 && b.z < 1.3) {
        const ra = this.def(recv.id).attrs;
        const da = this.def(best.id).attrs;
        const inDefBox = inPenaltyArea(b.pos, this.dirOf(recv.team));
        const pReceiver =
          (inDefBox ? 0.45 : TUNING.shieldBase) +
          0.45 * (a01(ra.firstTouch) * 0.5 + a01(ra.strength) * 0.5 - a01(da.anticipation) * 0.5 - a01(da.marking) * 0.5);
        if (this.rng.chance(Math.max(0.15, Math.min(0.92, pReceiver)))) best = recv;
      }
    }

    const attrs = this.def(best.id).attrs;
    const isGk = this.isKeeper(best.id);

    // Fast ball: chance to control depends on first touch; failing = deflection.
    const control = isGk
      ? 0.6 + 0.4 * a01(attrs.handling) - Math.max(0, ballSpeed - 15) * 0.02
      : TUNING.controlBase + 0.45 * a01(attrs.firstTouch) - Math.max(0, ballSpeed - 8) * 0.035;

    const prevTeam = b.lastTouchTeam;
    const prevToucher = b.lastTouch;

    // A keeper off the line meeting a shot: it is a save attempt, not a free catch. Roll on the
    // ball's lateral offset from the keeper's body.
    if (isGk && this.shot && this.shot.team !== best.team && ballSpeed > 10 && !this.shot.saveAttempted) {
      this.shot.saveAttempted = true;
      const gAttrs = this.def(best.id).attrs;
      const reach = TUNING.gkReach + 1.0 * a01(gAttrs.reflexes);
      const rel = Math.min(1.2, bestD / reach);
      const pSave = Math.max(0.05, Math.min(0.95, 0.64 - 0.5 * rel * rel - Math.max(0, ballSpeed - 22) * 0.015 + 0.2 * (a01(gAttrs.reflexes) - 0.5)));
      if (!this.shot.onTargetCounted) {
        this.shot.onTargetCounted = true;
        s.stats[this.shot.team].shotsOnTarget++;
      }
      if (!this.rng.chance(pSave)) {
        best.kickCooldown = 0.3; // beaten: the ball goes past
        return;
      }
      s.stats[best.team].saves++;
      this.emit("SAVE", best.team, best.id, `${this.name(best.id)} 선방`);
      this.shot = null;
      b.pos = { ...best.pos };
      this.gainPossession(best);
      this.intendedReceiver = null;
      return;
    }

    if (this.rng.chance(Math.max(0.1, control))) {
      // Keeper gathering an on-target shot counts as a save.
      if (isGk && this.shot && this.shot.team !== best.team && this.shot.onTargetCounted) {
        s.stats[best.team].saves++;
        this.emit("SAVE", best.team, best.id, `${this.name(best.id)} 선방`);
      }
      // Interception bookkeeping (pass completion itself is settled in gainPossession/touch)
      if (prevTeam !== null && prevToucher && prevToucher !== best.id && prevTeam !== best.team && this.intendedReceiver) {
        this.emit("INTERCEPTION", best.team, best.id, `${this.name(best.id)} 가로채기`);
      }
      this.gainPossession(best);
      this.intendedReceiver = null;
      if (this.shot && this.shot.team !== best.team) this.shot = null;
    } else {
      // Deflection / poor touch: ball bounces off at reduced speed in a random direction.
      const ang = this.rng.range(-Math.PI, Math.PI);
      const sp = Math.max(2, ballSpeed * this.rng.range(0.25, 0.6));
      kickBall(b, fromAngle(ang, sp), this.rng.range(0, 2));
      best.kickCooldown = 0.4;
      this.touch(best);
      if (this.shot && this.shot.team !== best.team) this.shot = null;
    }
  }

  /**
   * Aerial duel / header. The keeper may catch; outfield players head the ball:
   * defenders clear away from goal, attackers head toward goal or a team-mate.
   */
  private resolveHeader(): void {
    const s = this.state;
    const b = s.ball;
    let best: PlayerState | null = null;
    let bestScore = -Infinity;
    for (const p of this.activePlayers()) {
      if (p.kickCooldown > 0) continue;
      const d = dist(p.pos, b.pos);
      const reach = this.isKeeper(p.id) ? 1.8 : 0.8;
      if (d > reach) continue;
      const attrs = this.def(p.id).attrs;
      // Defenders facing the ball near their own goal hold the aerial advantage.
      const defDir = this.dirOf(p.team);
      const defending = dist(p.pos, { x: -PITCH.halfLength * defDir, y: 0 }) < 25;
      const score =
        (this.isKeeper(p.id) ? 1.5 : 0) +
        (defending ? 0.35 : 0) +
        0.9 * a01(attrs.strength) +
        this.roleOf(p.id).aerial +
        0.5 * a01(attrs.anticipation) -
        d +
        this.rng.range(0, 0.4);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return;

    if (this.isKeeper(best.id)) {
      const attrs = this.def(best.id).attrs;
      if (this.rng.chance(0.5 + 0.45 * a01(attrs.handling))) {
        b.pos = { ...best.pos };
        this.gainPossession(best);
        if (this.shot && this.shot.team !== best.team) this.shot = null;
        return;
      }
      // Punch clear
      const dir = this.dirOf(best.team);
      kickBall(b, fromAngle(Math.atan2(this.rng.range(-1, 1), dir), this.rng.range(8, 14)), this.rng.range(3, 6));
      best.kickCooldown = 0.5;
      this.touch(best);
      this.shot = null;
      return;
    }

    const dir = this.dirOf(best.team);
    const attrs = this.def(best.id).attrs;
    const ownGoal = { x: -PITCH.halfLength * dir, y: 0 };
    const nearOwnGoal = dist(best.pos, ownGoal) < 30;
    const oppGoal = goalCenter(dir);
    const nearOppGoal = dist(best.pos, oppGoal) < 14;
    const acc = 0.5 * (1 - a01(attrs.technique)) + 0.25;
    let ang: number;
    let speed: number;
    let vz: number;
    if (nearOppGoal && Math.abs(best.pos.y) < 20) {
      // Header at goal
      const aimY = this.rng.range(-PITCH.goalHalfWidth + 0.5, PITCH.goalHalfWidth - 0.5);
      ang = Math.atan2(aimY - best.pos.y, oppGoal.x - best.pos.x) + this.rng.gauss(0, acc * 0.5);
      speed = this.rng.range(10, 17);
      vz = this.rng.range(-1, 2.5);
      this.touch(best);
      kickBall(b, fromAngle(ang, speed), vz);
      b.z = 1.6;
      best.kickCooldown = 0.5;
      this.registerShot(best, this.xgAt(best.pos, best.team) * 0.5, true);
      return;
    }
    if (nearOwnGoal) {
      // Defensive clearance: away from goal, high and wide. Under pressure (or facing own goal)
      // a fair share is only headed sideways/behind – the classic source of corners.
      const pressed = this.pressureAt(best.pos, best.team) < 2;
      const side = best.pos.y >= 0 ? 1 : -1;
      if (pressed && this.rng.chance(0.45)) {
        ang = Math.atan2(side * this.rng.range(0.7, 1.2), dir * this.rng.range(-0.7, 0.3)) + this.rng.gauss(0, acc);
        speed = this.rng.range(6, 12);
        vz = this.rng.range(1, 4);
      } else {
        ang = Math.atan2(side * this.rng.range(0.2, 1), dir) + this.rng.gauss(0, acc);
        speed = this.rng.range(10, 16);
        vz = this.rng.range(3, 6);
      }
    } else {
      // Flick toward the opponent's half
      ang = Math.atan2(this.rng.range(-0.8, 0.8), dir) + this.rng.gauss(0, acc);
      speed = this.rng.range(6, 11);
      vz = this.rng.range(0, 3);
    }
    this.touch(best);
    kickBall(b, fromAngle(ang, speed), vz);
    b.z = 1.6;
    best.kickCooldown = 0.5;
    this.intendedReceiver = null;
    if (this.shot && this.shot.team !== best.team) this.shot = null;
  }

  /** The role assigned to this player's current slot (or their default). */
  roleOf(id: string): RoleDef {
    const team = this.teamOf.get(id)!;
    const slot = this.slotIndex(id);
    const roles = this.teams[team].tactics.roles;
    const rid = slot >= 0 ? roles?.[slot] : undefined;
    return ROLES[rid ?? (this.isKeeper(id) ? "GK" : "CB")] ?? ROLES.CB;
  }

  /**
   * Injuries: a small hazard every second on the pitch (higher on tired legs) plus a bump on
   * every tackle received. An injured player limps until substituted; the AI manager reacts at
   * the next stoppage, a human manager sees the flag in the panel.
   */
  private checkInjuries(): void {
    const s = this.state;
    if (s.tick % 20 !== 0) return; // once a second
    for (const p of this.activePlayers()) {
      if (p.injured || this.isKeeper(p.id)) continue;
      const hazard = 0.0000012 * (1 + 4 * p.fatigue);
      if (this.rng.chance(hazard)) this.injure(p, "근육");
    }
  }

  injure(p: PlayerState, kind: string): void {
    if (p.injured) return;
    p.injured = true;
    this.emit("INJURY", p.team, p.id, `부상: ${this.name(p.id)} (${kind}) – 교체가 필요합니다`, p.pos);
  }

  /** Register a touch for attribution (throw-ins, own goals, offside reset). */
  touch(p: PlayerState): void {
    const b = this.state.ball;
    if (b.lastTouch !== p.id) b.prevTouch = b.lastTouch;
    b.lastTouch = p.id;
    b.lastTouchTeam = p.team;
    // An opponent touching the ball resets the offside snapshot (deliberate play simplification).
    if (this.state.lastPass && this.state.lastPass.team !== p.team) this.state.lastPass = null;
    // An opponent touch means the pass failed.
    if (this.passInFlight && this.passInFlight.team !== p.team) this.passInFlight = null;
  }

  gainPossession(p: PlayerState): void {
    const s = this.state;
    const b = s.ball;
    // Offside: the first teammate to touch after a pass is judged on their position at pass time.
    const lp = s.lastPass;
    if (lp && lp.team === p.team && lp.fromId !== p.id && lp.offsidePositions[p.id]) {
      s.lastPass = null;
      s.stats[p.team].offsides++;
      this.emit("OFFSIDE", p.team, p.id, `오프사이드: ${this.name(p.id)}`, p.pos);
      const spot = { x: p.pos.x, y: p.pos.y };
      this.setupRestart("FREE_KICK", this.opp(p.team), spot);
      return;
    }
    s.lastPass = null;
    // Pass completed: a team-mate (anyone but the passer) has the ball under control.
    if (this.passInFlight && this.passInFlight.team === p.team && this.passInFlight.fromId !== p.id) {
      s.stats[p.team].passesCompleted++;
    }
    this.passInFlight = null;
    b.owner = p.id;
    b.vel = { ...p.vel };
    b.z = 0;
    b.vz = 0;
    p.possessionTime = 0;
    this.touch(p);
    this.nextDecision.set(p.id, s.tick + 2);
  }

  private resolveTackles(owner: PlayerState): void {
    const s = this.state;
    const b = s.ball;
    const oAttrs = this.def(owner.id).attrs;
    for (const p of this.activePlayers(this.opp(owner.team))) {
      if (p.kickCooldown > 0) continue;
      const d = dist(p.pos, b.pos);
      if (d > 1.2) continue;
      const attrs = this.def(p.id).attrs;
      // Numbers beat skill in a crowd: with team-mates within 3 m of the ball (a packed box),
      // challenges come faster and the dribbler has nowhere to turn. This is what lets a low
      // block frustrate a far better side.
      let crowd = 0;
      for (const q of this.activePlayers(p.team)) if (q.id !== p.id && !this.isKeeper(q.id) && dist(q.pos, b.pos) < 3) crowd++;
      crowd = Math.min(2, crowd);
      // Attempt rate ~1.5/s when in range.
      // Aggressive pressing means more (and rasher) challenges.
      if (!this.rng.chance(TUNING.tackleRate * (0.75 + 0.5 * this.teams[p.team].tactics.pressing) * (1 + 0.3 * crowd) * DT)) continue;

      const isGk = this.isKeeper(p.id);
      const tackleSkill = isGk ? a01(attrs.handling) * 0.8 : a01(attrs.tackling);
      const keepSkill = a01(oAttrs.dribbling) * 0.7 + a01(oAttrs.strength) * 0.3 + a01(oAttrs.composure) * 0.15;
      const pWin = Math.min(0.85, tackleSkill / (tackleSkill + keepSkill * 1.05) + 0.08 * crowd);

      // Foul probability: clumsy tacklers (low tackling) foul more; tackles from behind more.
      const facingDot = Math.cos(owner.facing - Math.atan2(p.pos.y - owner.pos.y, p.pos.x - owner.pos.x));
      const fromBehind = facingDot < -0.3;
      const pFoul = (TUNING.foulBase + 0.1 * (1 - a01(attrs.tackling))) * (fromBehind ? 1.8 : 1) * (isGk ? 0.4 : 1);

      if (this.rng.chance(pFoul)) {
        this.foul(p, owner);
        if (this.rng.chance(0.012)) this.injure(owner, "태클 충격");
        return;
      }
      if (this.rng.chance(pWin)) {
        s.stats[p.team].tackles++;
        this.emit("TACKLE", p.team, p.id, `${this.name(p.id)} 태클 성공 (${this.name(owner.id)})`);
        // Ball squirts loose toward the tackler's side.
        const away = norm(sub(p.pos, owner.pos));
        const ang = Math.atan2(away.y, away.x) + this.rng.range(-0.8, 0.8);
        kickBall(b, fromAngle(ang, this.rng.range(2.5, 6)), 0);
        owner.kickCooldown = 0.5;
        p.kickCooldown = 0.1;
        this.touch(p);
        this.intendedReceiver = null;
        return;
      }
      p.kickCooldown = 0.7; // missed tackle: brief recovery
    }
  }

  private foul(offender: PlayerState, victim: PlayerState): void {
    const s = this.state;
    s.stats[offender.team].fouls++;
    const spot = { ...victim.pos };
    const victimTeam = victim.team;
    const attackDir = this.dirOf(victimTeam);
    const inBox = inPenaltyArea(spot, attackDir);

    // Cards: promising attack / from behind increases card chance (simplified).
    const distToGoal = dist(spot, goalCenter(attackDir));
    // Referees are noticeably more lenient with a player already booked (second yellow ≈ rare).
    const pYellow = (TUNING.yellowBase + (distToGoal < 30 ? 0.12 : 0) + (inBox ? 0.1 : 0)) * (offender.yellow > 0 ? 0.25 : 1);
    const text = `파울: ${this.name(offender.id)} → ${this.name(victim.id)}`;
    this.emit("FOUL", offender.team, offender.id, text, spot);
    if (this.rng.chance(pYellow)) {
      offender.yellow++;
      if (offender.yellow >= 2) {
        offender.sentOff = true;
        s.stats[offender.team].reds++;
        this.emit("RED_CARD", offender.team, offender.id, `경고 누적 퇴장 – ${this.name(offender.id)}`);
      } else {
        s.stats[offender.team].yellows++;
        this.emit("YELLOW_CARD", offender.team, offender.id, `경고: ${this.name(offender.id)}`);
      }
    } else if (this.rng.chance(0.002)) {
      offender.sentOff = true;
      s.stats[offender.team].reds++;
      this.emit("RED_CARD", offender.team, offender.id, `다이렉트 퇴장 – ${this.name(offender.id)}`);
    }

    if (inBox) {
      s.stats[victimTeam].xg += 0.76;
      this.emit("PENALTY", victimTeam, null, `페널티킥: ${this.teams[victimTeam].shortName}!`, spot);
      this.setupRestart("PENALTY", victimTeam, penaltySpot(attackDir));
    } else {
      this.emit("FREE_KICK", victimTeam, null, `프리킥: ${this.teams[victimTeam].shortName}`, spot);
      this.setupRestart("FREE_KICK", victimTeam, spot);
    }
  }

  // ---------------------------------------------------------------- shots & saves

  registerShot(shooter: PlayerState, xg: number, header = false): void {
    const s = this.state;
    s.stats[shooter.team].shots++;
    s.stats[shooter.team].xg += xg;
    this.shot = { shooterId: shooter.id, team: shooter.team, xg, saveAttempted: false, onTargetCounted: false };
    this.emit("SHOT", shooter.team, shooter.id, `${this.name(shooter.id)} ${header ? "헤딩 슛" : "슛"} (xG ${xg.toFixed(2)})`, shooter.pos);
  }

  /** A defender blocks the shot: the ball ricochets off them. */
  /**
   * A defender blocks the shot. Where the ball strikes the body decides the ricochet:
   * a central hit (offset < 0.4 m) comes straight back, a hit on the flank deflects onward to
   * that side, a glancing touch barely changes the ball's path – which is how most corners and
   * deflected goals happen.
   */
  blockShot(blocker: PlayerState, offset = 0.5, side = 1): void {
    const b = this.state.ball;
    const speed = Math.hypot(b.vel.x, b.vel.y);
    const shotAng = Math.atan2(b.vel.y, b.vel.x);
    let ang: number;
    let keep: number;
    if (offset < 0.4) {
      ang = shotAng + Math.PI + this.rng.range(-1.0, 1.0);
      keep = this.rng.range(0.15, 0.4);
    } else if (offset < 1.0) {
      ang = shotAng + side * this.rng.range(0.5, 1.4);
      keep = this.rng.range(0.35, 0.7);
    } else {
      ang = shotAng + side * this.rng.range(0.1, 0.5);
      keep = this.rng.range(0.6, 0.9);
    }
    kickBall(b, fromAngle(ang, speed * keep), this.rng.range(0, 3));
    b.pos = { x: blocker.pos.x, y: blocker.pos.y };
    blocker.kickCooldown = 0.4;
    this.touch(blocker);
    this.emit("BLOCK", blocker.team, blocker.id, `${this.name(blocker.id)} 블록`);
    this.shot = null;
  }


  private checkSave(): void {
    const s = this.state;
    const b = s.ball;
    const shot = this.shot!;
    if (shot.saveAttempted) return;
    const defTeam = this.opp(shot.team);
    const gk = this.keeper(defTeam);
    if (gk.sentOff) return;
    const goalX = PITCH.halfLength * this.dirOf(shot.team);
    // Is the ball heading toward the goal?
    if (b.vel.x * this.dirOf(shot.team) <= 0) return;
    const dxToLine = (goalX - b.pos.x) * this.dirOf(shot.team);
    if (dxToLine > 4 || dxToLine < -0.3) return;

    // Predict crossing point at the goal line
    const tCross = dxToLine / Math.abs(b.vel.x);
    const yCross = b.pos.y + b.vel.y * tCross;
    const zCross = b.z + b.vz * tCross - 0.5 * 9.81 * tCross * tCross;
    const onTarget = Math.abs(yCross) < PITCH.goalHalfWidth + 0.1 && zCross < PITCH.goalHeight + 0.1 && zCross > -0.5;
    if (!onTarget) return;

    shot.saveAttempted = true;
    if (!shot.onTargetCounted) {
      shot.onTargetCounted = true;
      s.stats[shot.team].shotsOnTarget++;
      this.emit("SHOT_ON_TARGET", shot.team, shot.shooterId, `유효 슈팅`);
    }

    const attrs = this.def(gk.id).attrs;
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vz);
    // Diving reach (m) grows with reflexes; positioning lets the keeper be closer to the line of the shot.
    // Full diving reach (m): ~2.6 for an average keeper, ~3.3 for an elite one.
    const reach = TUNING.gkReach + 1.0 * a01(attrs.reflexes) + 0.6 * a01(attrs.gkPositioning);
    const lateral = Math.abs(gk.pos.y - yCross);
    const distToBall = dist(gk.pos, b.pos);
    if (lateral > reach + 0.4 || distToBall > reach + 4) {
      this.debug.onSave?.({ lateral, reach, pSave: 0, speed, saved: false, distToBall });
      return; // nowhere near: goal
    }

    // Save probability: quadratic fall-off with distance from the keeper's body, penalised by
    // shot speed and high corners. Calibrated for ~70% of on-target shots being saved.
    const rel = Math.min(1.15, lateral / reach);
    const base = 0.95 - 0.5 * rel * rel - Math.max(0, speed - 24) * 0.015;
    const cornerHigh = zCross > 1.7 ? -0.1 : 0;
    const closeRange = distToBall < 6 ? -0.12 : 0; // less reaction time
    // A keeper who has come off the line leaves more goal to aim at either side.
    const gkOff = Math.abs(Math.abs(gk.pos.x) - PITCH.halfLength);
    const offLine = -Math.min(0.3, Math.max(0, gkOff - 2) * 0.05);
    const pSave = Math.max(0.03, Math.min(0.97, base + 0.25 * (a01(attrs.reflexes) - 0.5) + cornerHigh + closeRange + offLine));
    const saved = this.rng.chance(pSave);
    this.debug.onSave?.({ lateral, reach, pSave, speed, saved, distToBall });
    if (!saved) return;

    // Saved!
    s.stats[defTeam].saves++;
    this.emit("SAVE", defTeam, gk.id, `${this.name(gk.id)} 선방`);
    gk.kickCooldown = 0;
    const holdChance = 0.35 + 0.5 * a01(attrs.handling) - Math.max(0, speed - 20) * 0.03;
    if (this.rng.chance(holdChance)) {
      this.shot = null;
      b.pos = { ...gk.pos };
      this.gainPossession(gk);
      gk.possessionTime = 0;
    } else {
      // Parry: mostly pushed wide/behind (corner) or back into play, away from the goal.
      const outDir = -this.dirOf(shot.team);
      const wide = this.rng.chance(0.7);
      const ang = wide
        ? Math.atan2((yCross >= 0 ? 1 : -1) * this.rng.range(0.8, 1.5), outDir * this.rng.range(-0.7, 0.3))
        : Math.atan2(this.rng.range(-1, 1), outDir);
      kickBall(b, fromAngle(ang, this.rng.range(6, 12)), this.rng.range(0.5, 2.5));
      b.pos = { x: gk.pos.x, y: gk.pos.y };
      gk.kickCooldown = 0.5;
      this.touch(gk);
      this.shot = null;
    }
  }

  // ---------------------------------------------------------------- ball out / goals

  private refereeBallOut(): void {
    const s = this.state;
    const b = s.ball;
    const hl = PITCH.halfLength;
    const hw = PITCH.halfWidth;
    const r = 0.11; // whole of the ball must cross the line

    // Touchline
    if (Math.abs(b.pos.y) > hw + r) {
      const lastTeam = b.lastTouchTeam ?? 0;
      const to = this.opp(lastTeam);
      const spot = { x: Math.max(-hl + 1, Math.min(hl - 1, b.pos.x)), y: Math.sign(b.pos.y) * (hw - 0.3) };
      this.emit("THROW_IN", to, null, `스로인: ${this.teams[to].shortName}`, spot);
      this.shot = null;
      this.setupRestart("THROW_IN", to, spot);
      return;
    }

    // Goal lines
    if (Math.abs(b.pos.x) > hl + r) {
      const side: AttackDir = b.pos.x > 0 ? 1 : -1;
      const scoringTeam: TeamId = this.dirOf(0) === side ? 0 : 1; // team attacking this goal
      const defendingTeam = this.opp(scoringTeam);

      const inGoalMouth = Math.abs(b.pos.y) < PITCH.goalHalfWidth && b.z < PITCH.goalHeight;
      if (inGoalMouth) {
        this.goal(scoringTeam, defendingTeam);
        return;
      }
      // Hit the frame? (approx: ball at post/bar height inside width => bounce back)
      if (Math.abs(b.pos.y) < PITCH.goalHalfWidth + 0.15 && b.z < PITCH.goalHeight + 0.15 && Math.abs(b.pos.x) < hl + 0.3) {
        b.vel.x *= -0.6;
        b.pos.x = Math.sign(b.pos.x) * (hl - 0.1);
        this.emit("SHOT", scoringTeam, b.lastTouch, `골대 강타!`);
        this.shot = null;
        return;
      }

      const lastTeam = b.lastTouchTeam ?? defendingTeam;
      this.shot = null;
      if (lastTeam === scoringTeam) {
        // Attacker put it out: goal kick
        const spot = { x: (hl - PITCH.goalAreaDepth) * side, y: Math.sign(b.pos.y || 1) * 5 };
        this.emit("GOAL_KICK", defendingTeam, null, `골킥: ${this.teams[defendingTeam].shortName}`, spot);
        this.setupRestart("GOAL_KICK", defendingTeam, spot);
      } else {
        // Defender put it out: corner
        s.stats[scoringTeam].corners++;
        const spot = { x: (hl - 0.3) * side, y: Math.sign(b.pos.y || 1) * (hw - 0.3) };
        this.emit("CORNER", scoringTeam, null, `코너킥: ${this.teams[scoringTeam].shortName}`, spot);
        this.setupRestart("CORNER", scoringTeam, spot);
      }
    }
  }

  private goal(scoringTeam: TeamId, defendingTeam: TeamId): void {
    const s = this.state;
    const b = s.ball;
    s.score[scoringTeam]++;
    s.stats[scoringTeam].goals++;
    const scorer = b.lastTouch;
    const ownGoal = scorer !== null && this.teamOf.get(scorer) === defendingTeam;
    if (ownGoal) {
      this.emit("OWN_GOAL", scoringTeam, scorer, `자책골! ${this.name(scorer!)} – ${this.scoreline()}`, b.pos);
    } else {
      this.emit("GOAL", scoringTeam, scorer, `골! ${scorer ? this.name(scorer) : ""} – ${this.scoreline()}`, b.pos);
    }
    this.lastGoalTeam = scoringTeam;
    this.shot = null;
    this.intendedReceiver = null;
    b.owner = null;
    b.vel = { x: 0, y: 0 };
    b.vz = 0;
    s.phase = "GOAL_CELEBRATION";
    s.phaseTimer = 55;
    s.stoppages++;
    // The ball is dead: queued substitutions come on now.
    this.applyPendingSubs();
  }

  name(id: string): string {
    return this.def(id).name;
  }

  // ---------------------------------------------------------------- utilities for AI

  /** x-coordinate (in the attacking team's direction) of the offside line for `team` attacking. */
  offsideLine(team: TeamId): number {
    const dir = this.dirOf(team);
    const xs = this.activePlayers(this.opp(team))
      .map((p) => p.pos.x * dir)
      .sort((a, b) => b - a); // descending: deepest defender first
    const secondLast = xs[1] ?? xs[0] ?? PITCH.halfLength;
    const ballX = this.state.ball.pos.x * dir;
    return Math.max(secondLast, ballX, 0);
  }

  /** Is this player currently in an offside position (Law 11)? */
  inOffsidePosition(p: PlayerState): boolean {
    const dir = this.dirOf(p.team);
    const px = p.pos.x * dir;
    if (px <= 0) return false; // own half
    const line = this.offsideLine(p.team);
    return px > line + 0.05;
  }

  /** Snapshot offside positions of the passer's teammates (called at the moment of a pass). */
  recordPass(from: PlayerState, exemptOffside: boolean): void {
    const positions: Record<string, boolean> = {};
    if (!exemptOffside) {
      for (const p of this.activePlayers(from.team)) {
        if (p.id === from.id) continue;
        positions[p.id] = this.inOffsidePosition(p);
      }
    }
    this.state.lastPass = { fromId: from.id, team: from.team, t: this.matchSeconds(), offsidePositions: positions };
    this.lastKickTick = this.state.tick;
  }

  /** Nearest opponent distance to a point. */
  pressureAt(pos: Vec2, team: TeamId): number {
    let best = Infinity;
    for (const p of this.activePlayers(this.opp(team))) {
      const d = dist(p.pos, pos);
      if (d < best) best = d;
    }
    return best;
  }

  goalFor(team: TeamId): Vec2 {
    return goalCenter(this.dirOf(team));
  }

  /** Expected-goal estimate from shot location (simple distance/angle model). */
  xgAt(pos: Vec2, team: TeamId): number {
    const dir = this.dirOf(team);
    const goal = goalCenter(dir);
    const d = dist(pos, goal);
    // Visible angle of the goal mouth
    const a1 = Math.atan2(goal.y + PITCH.goalHalfWidth - pos.y, (goal.x - pos.x) * dir);
    const a2 = Math.atan2(goal.y - PITCH.goalHalfWidth - pos.y, (goal.x - pos.x) * dir);
    const angle = Math.abs(a1 - a2);
    const xg = 1 / (1 + Math.exp(-(-1.1 - 0.13 * d + 2.6 * angle)));
    return Math.max(0.01, Math.min(0.85, xg));
  }

  /** Utility: direction vector toward the opponent goal. */
  forward(team: TeamId): Vec2 {
    return { x: this.dirOf(team), y: 0 };
  }

  /** Simulate to full time (headless). */
  runToEnd(maxTicks = 200_000): void {
    let n = 0;
    while (this.state.phase !== "FULL_TIME" && n++ < maxTicks) this.step();
  }
}
