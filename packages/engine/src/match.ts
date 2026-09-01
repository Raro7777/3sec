import { Rng } from "./rng";
import { PITCH, goalCenter, inPenaltyArea, penaltySpot } from "./pitch";
import { FORMATIONS, slotToPitch } from "./formation";
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
}

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

  constructor(home: TeamDef, away: TeamDef, opts: MatchOptions = {}) {
    this.teams = [home, away];
    this.rng = new Rng(opts.seed ?? 1);
    this.halfLength = opts.halfLength ?? 45 * 60;

    const players: PlayerState[] = [];
    for (const team of this.teams) {
      for (const def of team.players) {
        this.defs.set(def.id, def);
        this.teamOf.set(def.id, team.id);
        const ps: PlayerState = {
          id: def.id,
          team: team.id,
          pos: { x: 0, y: 0 },
          vel: { x: 0, y: 0 },
          facing: 0,
          target: { x: 0, y: 0 },
          desiredSpeed: 0,
          fatigue: 0,
          yellow: 0,
          sentOff: false,
          kickCooldown: 0,
          possessionTime: 0,
          intent: "",
        };
        players.push(ps);
        this.byId.set(def.id, ps);
      }
    }

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

  /** Refresh cached lists (once per tick and after a sending-off). */
  refreshActive(): void {
    this.activeAll = this.state.players.filter((p) => !p.sentOff);
    this.activeTeam = [this.activeAll.filter((p) => p.team === 0), this.activeAll.filter((p) => p.team === 1)];
  }

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

  /** The goalkeeper of a team (index 0 by convention). */
  keeper(team: TeamId): PlayerState {
    return this.player(this.teams[team].players[0]!.id);
  }

  isKeeper(id: string): boolean {
    return this.def(id).role === "GK";
  }

  homeSlot(id: string): Vec2 {
    const team = this.teamOf.get(id)!;
    const t = this.teams[team];
    const idx = t.players.findIndex((p) => p.id === id);
    const slot = FORMATIONS[t.tactics.formation][idx]!;
    return slotToPitch(slot, this.dirOf(team), 0.7 + 0.5 * t.tactics.width);
  }

  /** Place a team in formation inside its own half (kick-off shape, Law 8). */
  private placeFormation(team: TeamId): void {
    const dir = this.dirOf(team);
    for (const def of this.teams[team].players) {
      const p = this.player(def.id);
      const home = this.homeSlot(def.id);
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

  // ---------------------------------------------------------------- main loop

  step(): void {
    const s = this.state;
    if (s.phase === "FULL_TIME") return;
    s.tick++;
    this.refreshActive();

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
      this.emit("HALF_TIME", null, null, `Half time: ${this.scoreline()}`);
      s.phase = "HALF_TIME";
      s.phaseTimer = 3;
    } else {
      this.emit("FULL_TIME", null, null, `Full time: ${this.scoreline()}`);
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

    const timers: Record<RestartKind, number> = {
      KICK_OFF: 3,
      THROW_IN: 2.5,
      GOAL_KICK: 4,
      CORNER: 5,
      FREE_KICK: 4,
      PENALTY: 6,
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

    const restart: Restart = { kind, team, pos: { ...pos }, takerId: taker.id, timer: timers[kind] };
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

    const taker = this.player(r.takerId!);
    if (r.timer <= 0 && dist(taker.pos, r.pos) < 1.2) {
      if (r.kind === "KICK_OFF") this.emit("KICK_OFF", r.team, taker.id, `Kick-off: ${this.teams[r.team].shortName}`);
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

    // Possession stats
    const pt = this.possessionTeam();
    if (pt !== null) s.stats[pt].possessionTicks++;

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
    for (const p of this.activePlayers()) {
      if (p.kickCooldown > 0) continue;
      const isGk = this.isKeeper(p.id);
      const maxZ = isGk ? 2.4 : 1.3;
      if (b.z > maxZ) continue;
      const d = ballSpeed > 6 ? pointSegment(p.pos, prevPos, b.pos).d : dist(p.pos, b.pos);
      if (d >= this.controlRadius(p, ballSpeed)) continue;
      // Contested receptions: the intended receiver (who shields and reads the pass) has priority
      // over a marker unless the marker is clearly closer.
      const bias = p.id === this.intendedReceiver ? 0.5 : p.team === b.lastTouchTeam ? 0.15 : 0;
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

    const attrs = this.def(best.id).attrs;
    const isGk = this.isKeeper(best.id);

    // Fast ball: chance to control depends on first touch; failing = deflection.
    const control = isGk
      ? 0.6 + 0.4 * a01(attrs.handling) - Math.max(0, ballSpeed - 15) * 0.02
      : 0.55 + 0.45 * a01(attrs.firstTouch) - Math.max(0, ballSpeed - 8) * 0.035;

    const prevTeam = b.lastTouchTeam;
    const prevToucher = b.lastTouch;

    if (this.rng.chance(Math.max(0.1, control))) {
      this.gainPossession(best);
      // Pass completion / interception bookkeeping
      if (prevTeam !== null && prevToucher && prevToucher !== best.id) {
        if (prevTeam === best.team) {
          if (this.intendedReceiver) s.stats[best.team].passesCompleted++;
        } else if (this.intendedReceiver) {
          this.emit("INTERCEPTION", best.team, best.id, `${this.name(best.id)} intercepts`);
        }
      }
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

  /** Register a touch for attribution (throw-ins, own goals, offside reset). */
  touch(p: PlayerState): void {
    const b = this.state.ball;
    if (b.lastTouch !== p.id) b.prevTouch = b.lastTouch;
    b.lastTouch = p.id;
    b.lastTouchTeam = p.team;
    // An opponent touching the ball resets the offside snapshot (deliberate play simplification).
    if (this.state.lastPass && this.state.lastPass.team !== p.team) this.state.lastPass = null;
  }

  gainPossession(p: PlayerState): void {
    const s = this.state;
    const b = s.ball;
    // Offside: the first teammate to touch after a pass is judged on their position at pass time.
    const lp = s.lastPass;
    if (lp && lp.team === p.team && lp.fromId !== p.id && lp.offsidePositions[p.id]) {
      s.lastPass = null;
      s.stats[p.team].offsides++;
      this.emit("OFFSIDE", p.team, p.id, `Offside: ${this.name(p.id)}`, p.pos);
      const spot = { x: p.pos.x, y: p.pos.y };
      this.setupRestart("FREE_KICK", this.opp(p.team), spot);
      return;
    }
    s.lastPass = null;
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
      // Attempt rate ~1.8/s when in range.
      if (!this.rng.chance(1.8 * DT)) continue;

      const isGk = this.isKeeper(p.id);
      const tackleSkill = isGk ? a01(attrs.handling) * 0.8 : a01(attrs.tackling);
      const keepSkill = a01(oAttrs.dribbling) * 0.7 + a01(oAttrs.strength) * 0.3 + a01(oAttrs.composure) * 0.15;
      const pWin = tackleSkill / (tackleSkill + keepSkill * 1.05);

      // Foul probability: clumsy tacklers (low tackling) foul more; tackles from behind more.
      const facingDot = Math.cos(owner.facing - Math.atan2(p.pos.y - owner.pos.y, p.pos.x - owner.pos.x));
      const fromBehind = facingDot < -0.3;
      const pFoul = (0.06 + 0.1 * (1 - a01(attrs.tackling))) * (fromBehind ? 1.8 : 1) * (isGk ? 0.4 : 1);

      if (this.rng.chance(pFoul)) {
        this.foul(p, owner);
        return;
      }
      if (this.rng.chance(pWin)) {
        s.stats[p.team].tackles++;
        this.emit("TACKLE", p.team, p.id, `${this.name(p.id)} wins the ball from ${this.name(owner.id)}`);
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
    const pYellow = 0.12 + (distToGoal < 30 ? 0.12 : 0) + (inBox ? 0.1 : 0);
    let text = `Foul by ${this.name(offender.id)} on ${this.name(victim.id)}`;
    this.emit("FOUL", offender.team, offender.id, text, spot);
    if (this.rng.chance(pYellow)) {
      offender.yellow++;
      if (offender.yellow >= 2) {
        offender.sentOff = true;
        s.stats[offender.team].reds++;
        this.emit("RED_CARD", offender.team, offender.id, `Second yellow – ${this.name(offender.id)} is sent off`);
      } else {
        s.stats[offender.team].yellows++;
        this.emit("YELLOW_CARD", offender.team, offender.id, `Yellow card: ${this.name(offender.id)}`);
      }
    } else if (this.rng.chance(0.01)) {
      offender.sentOff = true;
      s.stats[offender.team].reds++;
      this.emit("RED_CARD", offender.team, offender.id, `Straight red – ${this.name(offender.id)} is sent off`);
    }

    if (inBox) {
      s.stats[victimTeam].xg += 0.76;
      this.emit("PENALTY", victimTeam, null, `Penalty to ${this.teams[victimTeam].shortName}!`, spot);
      this.setupRestart("PENALTY", victimTeam, penaltySpot(attackDir));
    } else {
      this.emit("FREE_KICK", victimTeam, null, `Free kick to ${this.teams[victimTeam].shortName}`, spot);
      this.setupRestart("FREE_KICK", victimTeam, spot);
    }
  }

  // ---------------------------------------------------------------- shots & saves

  registerShot(shooter: PlayerState, xg: number): void {
    const s = this.state;
    s.stats[shooter.team].shots++;
    s.stats[shooter.team].xg += xg;
    this.shot = { shooterId: shooter.id, team: shooter.team, xg, saveAttempted: false, onTargetCounted: false };
    this.emit("SHOT", shooter.team, shooter.id, `${this.name(shooter.id)} shoots (xG ${xg.toFixed(2)})`, shooter.pos);
  }

  /** A defender blocks the shot: the ball ricochets off them. */
  blockShot(blocker: PlayerState): void {
    const b = this.state.ball;
    const speed = Math.hypot(b.vel.x, b.vel.y);
    const ang = Math.atan2(b.vel.y, b.vel.x) + this.rng.range(-1.6, 1.6) + Math.PI * (this.rng.chance(0.6) ? 1 : 0);
    kickBall(b, fromAngle(ang, speed * this.rng.range(0.15, 0.45)), this.rng.range(0, 3));
    b.pos = { x: blocker.pos.x, y: blocker.pos.y };
    blocker.kickCooldown = 0.4;
    this.touch(blocker);
    this.emit("BLOCK", blocker.team, blocker.id, `Blocked by ${this.name(blocker.id)}`);
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
      this.emit("SHOT_ON_TARGET", shot.team, shot.shooterId, `On target`);
    }

    const attrs = this.def(gk.id).attrs;
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vz);
    // Diving reach (m) grows with reflexes; positioning lets the keeper be closer to the line of the shot.
    const reach = 1.6 + 1.0 * a01(attrs.reflexes) + 0.5 * a01(attrs.gkPositioning);
    const lateral = Math.abs(gk.pos.y - yCross);
    const distToBall = dist(gk.pos, b.pos);
    if (lateral > reach + 0.5 || distToBall > reach + 4) return; // nowhere near: goal

    // Save probability: quadratic fall-off with distance from the keeper's body, penalised by
    // shot speed and high corners. Calibrated for ~65-70% of on-target shots being saved.
    const rel = Math.min(1.2, lateral / reach);
    const base = 0.92 - 0.55 * rel * rel - Math.max(0, speed - 22) * 0.015;
    const cornerHigh = zCross > 1.7 ? -0.1 : 0;
    const closeRange = distToBall < 6 ? -0.12 : 0; // less reaction time
    const pSave = Math.max(0.03, Math.min(0.97, base + 0.25 * (a01(attrs.reflexes) - 0.5) + cornerHigh + closeRange));
    if (!this.rng.chance(pSave)) return;

    // Saved!
    s.stats[defTeam].saves++;
    this.emit("SAVE", defTeam, gk.id, `Save by ${this.name(gk.id)}`);
    gk.kickCooldown = 0;
    const holdChance = 0.35 + 0.5 * a01(attrs.handling) - Math.max(0, speed - 20) * 0.03;
    if (this.rng.chance(holdChance)) {
      this.shot = null;
      b.pos = { ...gk.pos };
      this.gainPossession(gk);
      gk.possessionTime = 0;
    } else {
      // Parry: ball deflected back into play, away from the goal.
      const outDir = -this.dirOf(shot.team);
      const ang = Math.atan2(this.rng.range(-1, 1), outDir) ;
      kickBall(b, fromAngle(ang, this.rng.range(4, 9)), this.rng.range(0.5, 2.5));
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
      this.emit("THROW_IN", to, null, `Throw-in: ${this.teams[to].shortName}`, spot);
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
        this.emit("SHOT", scoringTeam, b.lastTouch, `Off the woodwork!`);
        this.shot = null;
        return;
      }

      const lastTeam = b.lastTouchTeam ?? defendingTeam;
      this.shot = null;
      if (lastTeam === scoringTeam) {
        // Attacker put it out: goal kick
        const spot = { x: (hl - PITCH.goalAreaDepth) * side, y: Math.sign(b.pos.y || 1) * 5 };
        this.emit("GOAL_KICK", defendingTeam, null, `Goal kick: ${this.teams[defendingTeam].shortName}`, spot);
        this.setupRestart("GOAL_KICK", defendingTeam, spot);
      } else {
        // Defender put it out: corner
        s.stats[scoringTeam].corners++;
        const spot = { x: (hl - 0.3) * side, y: Math.sign(b.pos.y || 1) * (hw - 0.3) };
        this.emit("CORNER", scoringTeam, null, `Corner: ${this.teams[scoringTeam].shortName}`, spot);
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
      this.emit("OWN_GOAL", scoringTeam, scorer, `OWN GOAL by ${this.name(scorer!)} – ${this.scoreline()}`, b.pos);
    } else {
      this.emit("GOAL", scoringTeam, scorer, `GOAL! ${scorer ? this.name(scorer) : ""} – ${this.scoreline()}`, b.pos);
    }
    this.lastGoalTeam = scoringTeam;
    this.shot = null;
    this.intendedReceiver = null;
    b.owner = null;
    b.vel = { x: 0, y: 0 };
    b.vz = 0;
    s.phase = "GOAL_CELEBRATION";
    s.phaseTimer = 4;
    s.stoppages++;
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
