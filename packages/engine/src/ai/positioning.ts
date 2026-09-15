import type { Match } from "../match";
import { TUNING } from "../tuning";
import type { PlayerState, TeamId } from "../types";
import { PITCH, clampToPitch, inPenaltyArea } from "../pitch";
import { isDefender, isForward, isMidfielder } from "../formation";
import { a01, maxAccel, maxSpeed } from "../physics/player";
import { add, dist, lerp, norm, pointSegment, scale, sub, type Vec2 } from "../math/vec";

/**
 * Sets `target` and `desiredSpeed` for every player each tick.
 * Off-ball behaviour: team shape, ball chasing, marking, keeper positioning,
 * and restart formalities (exclusion zones, own-half at kick-off).
 */
export function computePositioning(m: Match, _dt: number): void {
  const s = m.state;
  const ball = s.ball;
  const restart = s.restart;
  const possession = m.possessionTeam();

  // Off-ball shape is recomputed at 20/3 Hz; chasers and the keeper every tick.
  const heavy = s.tick % 3 === 0;
  // The carrier's two nearest outfield team-mates (6-28 m away) are this tick's supporters.
  const supporters = new Set<string>();
  if (ball.owner && possession !== null) {
    const carrier = m.player(ball.owner);
    m.activePlayers(possession)
      .filter((q) => q.id !== carrier.id && !m.isKeeper(q.id))
      .map((q) => ({ q, d: dist(q.pos, carrier.pos) }))
      .filter((x) => x.d > 6 && x.d < 28)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach((x) => supporters.add(x.q.id));
  }

  // ------------------------------------------------------------ chasers
  // For each team pick who should go to the ball (only in open play).
  const chasers = m.chasers;
  if (!heavy) {
    // keep previous assignment
  } else if (restart) {
    chasers.clear();
  } else if (!ball.owner) {
    chasers.clear();
    for (const team of [0, 1] as TeamId[]) {
      const tactics = m.teams[team].tactics;
      const candidates = m.activePlayers(team).filter((p) => !m.isKeeper(p.id));
      const ranked = candidates
        .map((p) => ({ p, t: interceptTime(m, p) }))
        .sort((a, b) => a.t - b.t);
      // Team in possession: intended receiver first, otherwise the quickest.
      if (m.intendedReceiver && m.teamOf.get(m.intendedReceiver) === team) {
        chasers.add(m.intendedReceiver);
      }
      // Defenders need a moment to read a pass; the passing team's receiver reacts at once.
      // Each defender reads the pass at their own speed: anticipation 1 => ~1.6x the base delay, 20 => ~0.6x.
      const sinceKick = s.tick - m.lastKickTick;
      const ready = team === ball.lastTouchTeam
        ? ranked
        : ranked.filter(({ p }) => sinceKick >= TUNING.reactionDelay * 20 * (1.6 - 1.2 * a01(m.def(p.id).attrs.anticipation)));
      const n = possession === team ? 1 : tactics.pressing > 0.65 ? 2 : 1;
      for (let i = 0; i < Math.min(n, ready.length); i++) chasers.add(ready[i]!.p.id);
    }
  } else {
    chasers.clear();
    // Press the ball carrier with the nearest defender(s).
    const ownerTeam = m.teamOf.get(ball.owner)!;
    const defTeam = m.opp(ownerTeam);
    const tactics = m.teams[defTeam].tactics;
    const ranked = m
      .activePlayers(defTeam)
      .filter((p) => !m.isKeeper(p.id))
      .map((p) => ({ p, d: dist(p.pos, ball.pos) / m.roleOf(p.id).press }))
      .sort((a, b) => a.d - b.d);
    // Engage line: where the press starts. 1 = hunt everywhere, 0 = only in front of our own box;
    // beyond it the team contains (holds shape) instead of chasing.
    const ballXDef = ball.pos.x * m.dirOf(defTeam);
    const pressLimit = -25 + 75 * tactics.engageLine;
    const n = ballXDef > pressLimit ? 0 : Math.round(TUNING.pressers) + (tactics.pressing > 0.65 ? 1 : 0);
    for (let i = 0; i < Math.min(n, ranked.length); i++) chasers.add(ranked[i]!.p.id);
  }

  // Ball carrier info for "engage" behaviour (defenders challenge a dribbler who comes close).
  const carrier = ball.owner ? m.player(ball.owner) : null;
  const carrierTeam = carrier ? carrier.team : null;

  // Man-marking assignments for the team out of possession.
  if (heavy && !restart) assignMarkers(m, possession, chasers);

  for (const p of m.activePlayers()) {
    const isGk = m.isKeeper(p.id);
    if (ball.owner === p.id) continue; // decided by decision module (dribble target)

    if (restart) {
      if (heavy || p.id === restart.takerId) restartPositioning(m, p);
      continue;
    }

    if (isGk) {
      keeperPositioning(m, p);
      continue;
    }

    if (chasers.has(p.id)) {
      if (carrier && carrierTeam !== p.team) {
        // Pressing a carrier: close down goal-side (between ball and own goal) so the shooting
        // and passing lanes are shut – this is where blocks and tackles happen.
        const dir = m.dirOf(p.team);
        const ownGoal = { x: -PITCH.halfLength * dir, y: 0 };
        const toGoal = norm(sub(ownGoal, ball.pos));
        const dGoal = dist(ball.pos, ownGoal);
        const jockey = add(add(ball.pos, scale(toGoal, dGoal < 25 ? 1.0 : 1.4)), scale(carrier.vel, 0.6));
        setTarget(p, jockey, 99, "press");
        continue;
      }
      const target = interceptPoint(m, p);
      setTarget(p, target, 99, "chase");
      continue;
    }

    // Engage: an opponent dribbling within reach gets challenged even if we are not the designated presser.
    if (carrier && carrierTeam !== p.team) {
      const d = dist(carrier.pos, p.pos);
      if (d < TUNING.engageRadius * m.roleOf(p.id).press + 3 * m.teams[p.team].tactics.pressing) {
        // Step out goal-side of the carrier, not at the ball: stay between them and the goal.
        const dir = m.dirOf(p.team);
        const ownGoal = { x: -PITCH.halfLength * dir, y: 0 };
        const toGoal = norm(sub(ownGoal, ball.pos));
        const ahead = add(add(ball.pos, scale(toGoal, 0.9)), scale(carrier.vel, 0.6));
        setTarget(p, ahead, 99, "engage");
        continue;
      }
    }

    if (!heavy) continue;

    // Marking: sit goal-side of the assigned opponent, tighter the closer to our goal.
    const markId = m.marks.get(p.id);
    if (markId && possession !== p.team) {
      const opp = m.player(markId);
      const dir = m.dirOf(p.team);
      const ownGoal = { x: -PITCH.halfLength * dir, y: 0 };
      const dGoal = dist(opp.pos, ownGoal);
      // Tight near goal, looser upfield (a marker 3-4 m off still shadows the lane but leaves time on the ball).
      const baseGap = dGoal < 20 ? TUNING.markGapNear : dGoal < 35 ? TUNING.markGapMid : TUNING.markGapFar;
      // Good markers/positioners hold the right distance; poor ones drift off their man.
      const gap = baseGap * (1.3 - 0.6 * (a01(m.def(p.id).attrs.marking) * 0.5 + a01(m.def(p.id).attrs.positioning) * 0.5));
      const toGoal = norm(sub(ownGoal, opp.pos));
      // Also lean toward the ball so the pass lane is shadowed.
      const toBall = norm(sub(ball.pos, opp.pos));
      if (opp.id === ball.owner) {
        // Jockeying the carrier: hold the line between ball and goal a metre off, retreating with them.
        const jockey = add(add(ball.pos, scale(toGoal, dGoal < 25 ? 1.0 : 1.4)), scale(opp.vel, 0.6));
        setTarget(p, jockey, 99, "jockey");
        continue;
      }
      // A poor marker keeps losing their man by a couple of metres (ball-watching, late reactions).
      const mk = a01(m.def(p.id).attrs.marking);
      const mph = s.tick * 0.006 + m.def(p.id).number * 1.7;
      const slack = (1 - mk) * 4.5;
      let markPos = add(add(opp.pos, add(scale(toGoal, gap), scale(toBall, 0.4))), { x: Math.sin(mph) * slack, y: Math.cos(mph * 0.8) * slack });
      // Offside trap: defenders never drop deeper than a flat line just behind the ball, so a
      // runner who goes early is caught rather than followed.
      if (m.teams[p.team].tactics.offsideTrap && isDefender(m.def(p.id).role)) {
        const holdX = ball.pos.x * dir - 6;
        if (markPos.x * dir < holdX) markPos = { x: holdX * dir, y: markPos.y };
      }
      const d = dist(p.pos, markPos);
      // Track the runner: never slower than the marked player.
      const oppSpeed = Math.hypot(opp.vel.x, opp.vel.y);
      const speed = d > 6 ? 99 : Math.max(oppSpeed + 1, d > 2 ? 5 : 2.5);
      setTarget(p, markPos, speed, "mark");
      continue;
    }

    // Timed off-ball run (give-and-go / overlap): sprint into the space ahead, then rejoin the shape.
    const runEnd = m.runUntil.get(p.id);
    if (runEnd !== undefined) {
      if (runEnd > s.tick && possession === p.team && ball.owner !== p.id) {
        const dir = m.dirOf(p.team);
        setTarget(p, runTarget(m, p, dir), 99, "run");
        continue;
      }
      m.runUntil.delete(p.id);
    }

    let target = shapePosition(m, p, possession);
    // Off-ball support: the two nearest team-mates of the carrier come to an open angle 10-12 m
    // away where the pass lane is clear; the same-side full-back overlaps a winger on the ball.
    if (possession === p.team && ball.owner && ball.owner !== p.id && supporters.has(p.id)) {
      const sp = supportTarget(m, p, m.player(ball.owner));
      if (sp) target = { x: target.x * 0.3 + sp.x * 0.7, y: target.y * 0.3 + sp.y * 0.7 };
    }
    if (possession === p.team && ball.owner && overlapFor(m, p, m.player(ball.owner))) {
      const carrier = m.player(ball.owner);
      const dir = m.dirOf(p.team);
      const side = Math.sign(carrier.pos.y) || 1;
      target = { x: carrier.pos.x + dir * 14, y: Math.max(-PITCH.halfWidth + 3, Math.min(PITCH.halfWidth - 3, carrier.pos.y + side * 5)) };
      m.runUntil.set(p.id, s.tick + 40);
      setTarget(p, target, 99, "run");
      continue;
    }
    // Hysteresis: a spot that moved less than 2 m is not worth moving for – players stand,
    // scan and adjust in steps, they do not drift continuously.
    if (!runFlag && (p.intent === "shape" || p.intent === "support") && dist(target, p.target) < 3) target = p.target;
    const d = dist(p.pos, target);
    // Shape adjustments are jogs and walks, not sprints (players cover ~10-11 km, not 15);
    // a run in behind is the exception.
    // Dead zone: within a metre of the spot players stand and scan instead of shuffling.
    const speed = runFlag ? 99 : d > 14 ? 7 : d > 6 ? 4.5 : d > 2.5 ? 2.5 : d > 1.5 ? 1.2 : 0;
    setTarget(p, target, speed, runFlag ? "run" : possession === p.team ? "support" : "shape");
  }
}

/**
 * Assign man-markers for the defending team: most dangerous attacker first, nearest suitable
 * free defender/midfielder. Forwards are not used as markers (they keep the counter-attack outlet).
 */
function assignMarkers(m: Match, possession: TeamId | null, chasers: Set<string>): void {
  const prev = new Map(m.marks);
  m.marks.clear();
  if (possession === null) return;
  const defTeam = m.opp(possession);
  const dir = m.dirOf(defTeam);
  const ownGoal = { x: -PITCH.halfLength * dir, y: 0 };
  const ball = m.state.ball;

  // The carrier is the first threat; then the nearest attackers to our goal.
  const threats = m
    .activePlayers(possession)
    .filter((q) => !m.isKeeper(q.id))
    .map((q) => ({ q, d: q.id === ball.owner ? -1 : dist(q.pos, ownGoal) }))
    .filter((t) => t.d < 45)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);

  // Markers: outfield players who are not pressing. (Forwards only mark the carrier when they
  // happen to be goal-side of them.)
  const available = m.activePlayers(defTeam).filter((p) => !m.isKeeper(p.id) && !chasers.has(p.id));

  for (const { q } of threats) {
    const isCarrier = q.id === ball.owner;
    let best: PlayerState | null = null;
    let bestCost = isCarrier ? 14 : 18;
    for (const p of available) {
      const role = m.def(p.id).role;
      const fwd = isForward(role);
      if (fwd && !isCarrier) continue;
      // Goal-side of the threat? (between the threat and our goal along the length)
      const goalSide = (p.pos.x - q.pos.x) * dir < -0.3;
      let cost = dist(p.pos, q.pos) + (isMidfielder(role) ? 2 : fwd ? 6 : 0) + (1 - m.def(p.id).attrs.marking / 20) * 3;
      if (isCarrier) {
        // Whoever was already marking the carrier (and is goal-side) keeps the job: they are in the lane.
        if (!goalSide) cost += 8;
        if (prev.get(p.id) === q.id) cost -= 4;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    if (best) {
      m.marks.set(best.id, q.id);
      available.splice(available.indexOf(best), 1);
    }
  }
}

/** Where a timed run goes: straight ahead, bending away from the nearest opponent. */
function runTarget(m: Match, p: PlayerState, dir: 1 | -1): Vec2 {
  let nearest: PlayerState | null = null;
  let nd = Infinity;
  for (const o of m.activePlayers(m.opp(p.team))) {
    const d = dist(o.pos, p.pos);
    if (d < nd) { nd = d; nearest = o; }
  }
  const away = nearest && nd < 8 ? Math.sign(p.pos.y - nearest.pos.y) || 1 : 0;
  // Stay onside: the run bends along the line until the ball is played.
  const line = m.offsideLine(p.team) * dir; // pitch x of the line
  let x = p.pos.x + dir * 14;
  if ((x - line) * dir > -0.6 && m.state.ball.owner !== null) x = line - dir * 0.6;
  return { x, y: p.pos.y + away * 4 };
}

/** Support angle for a team-mate of the carrier: open, lane clear, a little ahead if possible. */
function supportTarget(m: Match, p: PlayerState, carrier: PlayerState): Vec2 | null {
  const dir = m.dirOf(p.team);
  const opponents = m.activePlayers(m.opp(p.team));
  const R = 11;
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (const deg of [-140, -95, -50, -15, 15, 50, 95, 140]) {
    const a = (deg * Math.PI) / 180;
    const pt = { x: carrier.pos.x + dir * Math.cos(a) * R, y: carrier.pos.y + Math.sin(a) * R };
    if (Math.abs(pt.x) > PITCH.halfLength - 2 || Math.abs(pt.y) > PITCH.halfWidth - 1) continue;
    let open = Infinity;
    let laneMin = Infinity;
    for (const o of opponents) {
      open = Math.min(open, dist(o.pos, pt));
      const { d } = pointSegment(o.pos, carrier.pos, pt);
      laneMin = Math.min(laneMin, d);
    }
    // Prefer staying on the player's own side of the carrier so the shape keeps its width.
    const sameSide = Math.sign(pt.y - carrier.pos.y) === Math.sign(p.pos.y - carrier.pos.y) ? 1.5 : 0;
    const score = Math.min(open, 9) + (laneMin > 1.5 ? 3 : 0) + Math.cos(a) * 2 + sameSide - dist(p.pos, pt) * 0.08;
    if (score > bestScore) { bestScore = score; best = pt; }
  }
  return best;
}

/** Full-back overlapping a winger who has the ball wide in the opposition half. */
function overlapFor(m: Match, p: PlayerState, carrier: PlayerState): boolean {
  const role = m.def(p.id).role;
  if (role !== "LB" && role !== "RB") return false;
  if (!m.roleOf(p.id).overlap) return false;
  const cRole = m.def(carrier.id).role;
  if (cRole !== "LW" && cRole !== "RW" && cRole !== "LM" && cRole !== "RM") return false;
  const dir = m.dirOf(p.team);
  if (carrier.pos.x * dir < 5 || carrier.pos.x * dir > 38 || Math.abs(carrier.pos.y) < 12) return false;
  if (Math.sign(m.homeSlot(p.id).y) !== Math.sign(m.homeSlot(carrier.id).y)) return false;
  return dist(p.pos, carrier.pos) < 25 && (carrier.pos.x - p.pos.x) * dir > -2;
}

function setTarget(p: PlayerState, target: Vec2, speed: number, intent: string): void {
  p.target = clampToPitch(target, 0.3);
  p.desiredSpeed = speed;
  p.intent = intent;
}

/**
 * Earliest time at which the player can meet the rolling ball, and where.
 * Allocation-free inner loop (this runs for every outfield player several times a second).
 */
const _icp: Vec2 = { x: 0, y: 0 };
function interceptSearch(m: Match, p: PlayerState): number {
  const attrs = m.def(p.id).attrs;
  m.updateBallTrack();
  const track = m.ballTrack;

  const vMax = maxSpeed(attrs, p.fatigue);
  const aMax = maxAccel(attrs, p.fatigue);
  const v0 = Math.max(0, Math.hypot(p.vel.x, p.vel.y) * 0.7);
  const tAcc = (vMax - v0) / aMax;
  const dAcc = v0 * tAcc + 0.5 * aMax * tAcc * tAcc;

  let px = track[0]!;
  let py = track[1]!;
  for (let i = 0; i <= 16; i++) {
    const t = i * 0.25;
    px = track[2 * i]!;
    py = track[2 * i + 1]!;
    const dd = Math.hypot(px - p.pos.x, py - p.pos.y);
    const reach = dd <= dAcc ? (-v0 + Math.sqrt(v0 * v0 + 2 * aMax * dd)) / aMax : tAcc + (dd - dAcc) / vMax;
    if (reach <= t + 0.05) {
      _icp.x = px;
      _icp.y = py;
      return t;
    }
  }
  _icp.x = px;
  _icp.y = py;
  return 4 + Math.hypot(px - p.pos.x, py - p.pos.y) / vMax;
}

function interceptTime(m: Match, p: PlayerState): number {
  return interceptSearch(m, p);
}

function interceptPoint(m: Match, p: PlayerState): Vec2 {
  interceptSearch(m, p);
  return { x: _icp.x, y: _icp.y };
}

/** Team shape: formation slot shifted toward the ball, adjusted for possession & tactics. */
/** Set by shapePosition when the player should sprint (a run in behind). */
let runFlag = false;

function shapePosition(m: Match, p: PlayerState, possession: TeamId | null): Vec2 {
  runFlag = false;
  const s = m.state;
  const ball = s.ball;
  const team = p.team;
  const dir = m.dirOf(team);
  const tactics = m.teams[team].tactics;
  const role = m.def(p.id).role;
  const home = m.homeSlot(p.id);
  const inPoss = possession === team;

  // Shift the whole block along the length toward the ball, and a little across.
  // Mentality pushes the whole block up (attacking) or drops it (defensive) in both phases.
  const ballX = ball.pos.x * dir; // in team-forward coordinates
  const ment = (tactics.mentality - 0.5) * 12; // -6 .. +6 m
  let shiftX = ballX * 0.4 + ment;
  shiftX += inPoss ? 4 + 6 * tactics.directness : -6 + 8 * tactics.defensiveLine;
  const shiftY = ball.pos.y * (inPoss ? 0.25 : 0.4);

  // Role-specific pull toward the ball (lengthwise and across).
  // In possession midfielders/forwards push up to support; defending, the block stays compact
  // but forwards hold a higher position to offer an outlet.
  // Out of possession the midfield screens just in front of the back line (compact block of
  // ~25-30 m between defence and forwards), instead of floating 15-20 m ahead of it.
  // An attacking mentality commits the full-backs/centre-backs further forward in possession
  // (and leaves the team open on the counter); a defensive one keeps them home.
  const mentPull = (tactics.mentality - 0.5) * 0.5; // -0.25 .. +0.25
  // A low block is also a compact one: the lower the line, the tighter the midfield screens the
  // back four (lengthwise and across), so the ball has to go around ten men, not through them.
  const compact = !inPoss ? Math.max(0, (0.4 - tactics.defensiveLine) / 0.4) : 0; // 0 .. 1
  // A wing-back is a full-back by slot but plays the midfield line going forward: in possession they
  // are the team's whole width, so they push on like a midfielder. Out of possession the defender
  // branch below still applies and they tuck into the back line — a back three becomes a back five.
  const wingBack = m.isWingBack(p.id);
  const asDefender = isDefender(role) && !(wingBack && inPoss);
  const asMidfielder = isMidfielder(role) || (wingBack && inPoss);
  const pullX = inPoss
    ? asDefender ? Math.max(0, 0.1 + mentPull) : asMidfielder ? 0.4 + mentPull * 0.6 : 0.55
    : asDefender ? 0 : asMidfielder ? 0.25 + 0.3 * compact : 0.15 + 0.15 * compact;
  const pullY = (asDefender ? 0.15 : asMidfielder ? 0.3 : 0.2) * (1 + 0.6 * compact);

  const rd = m.roleOf(p.id);
  // Defending, a wing-back drops out of the midfield line and into the back line — the slot's own
  // depth would leave them 12-15 m in front of the centre-backs, which is a back three with two
  // stragglers rather than the back five a 3-5-2 is supposed to defend with.
  // The role's forward shift is an attacking instruction, so a wing-back tucking in drops it (a
  // defensive-minded role's negative shift still counts — that one asks them to sit deeper still).
  // Both terms are substituted in place rather than regrouped: float addition is not associative, so
  // reordering this sum alone moves every player by an ulp and reshuffles the whole match.
  const tuckIn = wingBack && !inPoss;
  const homeX = tuckIn ? m.backLineX(team) : home.x * dir;
  const roleDx = tuckIn ? Math.min(0, rd.dx) : rd.dx;
  let x = homeX + shiftX + roleDx * 52.5;
  let y = home.y * (1 + rd.dy) + shiftY;
  // "hold": how far the role pushes up with the ball (0 = bombs on, 1 = stays home)
  if (ballX > x) x += (ballX - x) * pullX * (inPoss ? 1.4 - 0.8 * rd.hold : 1);

  // Pull toward the ball laterally (compactness when defending)
  y += (ball.pos.y - y) * pullY * (inPoss ? 0.5 : 1);

  // Defensive line: keep the back four roughly level, goal-side of the ball, and never deeper
  // than the edge of the box unless the ball is already there.
  if (isDefender(role) && !inPoss) {
    // Offside trap: hold a higher line and step up together the moment the opponent plays a pass.
    const trap = tactics.offsideTrap;
    const justPassed = trap && ball.lastTouchTeam !== team && s.tick - m.lastKickTick < 8;
    const lineX = Math.min(x, ballX - (trap ? 5 : 8)) + (justPassed ? 2.5 : 0);
    x = Math.max(lineX, Math.min(ballX - 3, -PITCH.halfLength + 12 + 8 * tactics.defensiveLine));
  }
  // Defending forwards stay on the shoulder of the opponent's back line (ready to break),
  // and never drop below the halfway line minus a bit.
  if (!inPoss && isForward(role)) x = Math.max(x, -12, Math.min(m.offsideLine(team) - 5, 30));

  // Attackers in possession: hold the line of the second-last defender. Timing is imperfect:
  // players with poor anticipation drift offside now and then.
  if (inPoss && (isForward(role) || rd.runs >= 1.3)) {
    const line = m.offsideLine(team);
    const ant = m.def(p.id).attrs.anticipation / 20;
    // Runs in behind: every few seconds, when a team-mate has the ball behind them with time to
    // pick a pass, the forward darts beyond the line for about a second. Players with poor
    // anticipation go early (offside), good ones time it on the whistle of the pass.
    const cycle = 5.5 + (m.def(p.id).number % 4) * 0.7; // desynchronise the forwards
    const phase = ((s.tick / 20 + m.def(p.id).number * 1.3) % cycle) / cycle;
    const carrierBehind = ball.owner !== null && ball.owner !== p.id && ballX < x - 3 && dist(ball.pos, p.pos) < 35;
    const carrierFree = ball.owner !== null && m.pressureAt(ball.pos, team) > 2.5;
    // On a transition (ball just won) forwards break immediately, whatever the cycle says.
    const transition = m.inTransition(team);
    if (carrierBehind && carrierFree && (transition || phase < Math.min(0.6, 0.4 * rd.runs))) {
      // burst: start level with the line; only poor anticipation strays beyond it early
      const early = (1 - ant) * TUNING.offsideWobble * 0.35; // 0 .. ~1.8 m
      x = line - 0.4 + early;
      runFlag = true;
    } else if (x > line - 0.8) {
      x = line - 0.8;
    }
  }

  // Never stand behind own goal line or in front of the opposite one.
  x = Math.max(-PITCH.halfLength + 2, Math.min(PITCH.halfLength - 1, x));

  // Positioning attribute: poor positional sense = the spot is a few metres off and drifts.
  const posSkill = a01(m.def(p.id).attrs.positioning);
  const drift = (1 - posSkill) * 5 * (tactics.offsideTrap && isDefender(role) && !inPoss ? 0.3 : 1); // 0 .. ~3.5 m for the weakest; a trap keeps the line flat
  const ph = s.tick * 0.004 + m.def(p.id).number;
  let target: Vec2 = { x: x * dir + Math.sin(ph) * drift, y: y + Math.cos(ph * 0.7) * drift };

  // Avoid bunching with teammates
  for (const q of m.activePlayers(team)) {
    if (q.id === p.id || m.isKeeper(q.id)) continue;
    const d = dist(q.target, target);
    if (d < 4 && d > 1e-6) {
      const push = scale(norm(sub(target, q.target)), (4 - d) * 0.5);
      target = add(target, push);
    }
  }
  return target;
}

/** Goalkeeper: stay on the ball-goal line, come for loose balls in the box, narrow angles. */
function keeperPositioning(m: Match, gk: PlayerState): void {
  const s = m.state;
  const ball = s.ball;
  const dir = m.dirOf(gk.team);
  const goal = { x: -PITCH.halfLength * dir, y: 0 };
  const ownerTeam = ball.owner ? m.teamOf.get(ball.owner)! : null;

  // Loose ball inside our box and we are the closest: go and claim it.
  const ownBox = inPenaltyArea(ball.pos, (-dir) as 1 | -1);
  if (!ball.owner && ownBox && !m.shot && ball.z < 2) {
    const oppNearest = m.pressureAt(ball.pos, gk.team);
    const myDist = dist(gk.pos, ball.pos);
    if (myDist < oppNearest + (m.roleOf(gk.id).sweeper ? 3 : 1.5) && myDist < (m.roleOf(gk.id).sweeper ? 22 : 14)) {
      setTarget(gk, interceptPoint(m, gk), 99, "claim");
      return;
    }
  }

  // A shot is in flight: move to the predicted crossing point.
  if (m.shot && m.shot.team !== gk.team && !ball.owner) {
    const vx = ball.vel.x * dir; // toward our goal means negative in team coords
    if (vx < -0.5) {
      const t = (ball.pos.x - goal.x) / Math.abs(ball.vel.x);
      const yCross = ball.pos.y + ball.vel.y * t;
      const y = Math.max(-PITCH.goalHalfWidth, Math.min(PITCH.goalHalfWidth, yCross));
      setTarget(gk, { x: goal.x + dir * 0.8, y }, 99, "save");
      return;
    }
  }

  // Default: on the bisector between ball and goal centre, a few metres off the line.
  const toBall = sub(ball.pos, goal);
  const d = Math.max(1, dist(ball.pos, goal));
  const sweep = m.roleOf(gk.id).sweeper ? 1.6 : 1;
  let off = (ownerTeam === m.opp(gk.team) ? Math.min(4.5, 1 + d * 0.06) : Math.min(8, 2 + d * 0.1)) * sweep;
  // One-on-one: no team-mate between the carrier and goal => come out to narrow the angle.
  if (ownerTeam === m.opp(gk.team) && d < 32) {
    const carrier = m.player(ball.owner!);
    const coverers = m.activePlayers(gk.team).filter((q) => q.id !== gk.id && (q.pos.x - carrier.pos.x) * dir < -0.5 && dist(q.pos, carrier.pos) < 8).length;
    if (coverers === 0) off = Math.max(off, Math.min(11, d * 0.45));
  }
  const base = add(goal, scale(norm(toBall), off));
  const y = Math.max(-PITCH.goalHalfWidth - 1, Math.min(PITCH.goalHalfWidth + 1, base.y));
  const x = goal.x + dir * Math.max(0.6, Math.abs(base.x - goal.x));
  setTarget(gk, { x, y }, 6, "gk");
}

/** Positioning during a dead ball: taker to the ball, others to shape respecting exclusion zones. */
function restartPositioning(m: Match, p: PlayerState): void {
  const s = m.state;
  const r = s.restart!;
  const dir = m.dirOf(p.team);
  const isGk = m.isKeeper(p.id);

  if (p.id === r.takerId) {
    // Stand just behind the ball relative to the direction of play.
    const behind = r.kind === "CORNER" || r.kind === "THROW_IN"
      ? { x: r.pos.x - Math.sign(r.pos.x || 1) * 0.6, y: r.pos.y - Math.sign(r.pos.y || 1) * 0.6 }
      : { x: r.pos.x - dir * 0.7, y: r.pos.y };
    setTarget(p, behind, 6, "taker");
    return;
  }

  if (isGk) {
    if (r.kind === "PENALTY" && r.team !== p.team) {
      setTarget(p, { x: -PITCH.halfLength * dir + dir * 0.3, y: 0 }, 6, "gk-pen");
      return;
    }
    keeperPositioning(m, p);
    return;
  }

  let target: Vec2;
  const attackers = r.team === p.team;
  const home = m.homeSlot(p.id);

  switch (r.kind) {
    case "KICK_OFF": {
      target = { ...home };
      // Everyone in own half, non-takers outside the centre circle.
      if (target.x * dir > -1) target.x = -1 * dir;
      if (dist(target, { x: 0, y: 0 }) < PITCH.centerCircleRadius + 0.5) {
        target = scale(norm(target), PITCH.centerCircleRadius + 0.5);
      }
      break;
    }
    case "CORNER": {
      const goalX = r.pos.x; // corner is at the goal line of the defending side
      const gs = Math.sign(goalX);
      const idx = Math.max(0, m.slotIndex(p.id));
      const role = m.def(p.id).role;
      if (attackers) {
        // Six attackers crowd the box (near post, penalty spot, far post, edge), full-backs hold.
        if (isForward(role) || isMidfielder(role)) {
          const k = idx % 6;
          const spots = [
            { x: 6, y: -6 }, { x: 10, y: -2 }, { x: 10, y: 4 }, { x: 7, y: 8 }, { x: 15, y: 0 }, { x: 19, y: -4 },
          ];
          const sp = spots[k]!;
          target = { x: goalX - gs * sp.x, y: sp.y * Math.sign(r.pos.y || 1) };
        } else {
          target = { x: goalX - gs * 32, y: home.y * 0.5 };
        }
      } else {
        // Eight defenders in and around the six-yard box (one on the near post), two forwards stay up.
        if (isDefender(role) || isMidfielder(role)) {
          const k = idx % 8;
          const spots = [
            { x: 1, y: -3.4 }, { x: 4, y: -5 }, { x: 5, y: -1.5 }, { x: 5, y: 2 }, { x: 6, y: 5 }, { x: 9, y: -3 }, { x: 9, y: 3 }, { x: 12, y: 0 },
          ];
          const sp = spots[k]!;
          target = { x: goalX - gs * sp.x, y: sp.y * Math.sign(r.pos.y || 1) };
        } else {
          target = { x: goalX - gs * 30, y: (idx % 2 ? 1 : -1) * 6 };
        }
      }
      break;
    }
    case "PENALTY": {
      // Outside the box, behind the ball, outside the arc.
      const goalDir = Math.sign(r.pos.x || 1);
      const x = r.pos.x - goalDir * (PITCH.penaltyAreaDepth - PITCH.penaltySpotDist + 2.5);
      const idx = Math.max(0, m.slotIndex(p.id));
      target = { x, y: (idx - 5) * 4 };
      break;
    }
    case "GOAL_KICK": {
      target = { ...home };
      const ballSide = Math.sign(r.pos.x);
      // Opponents must be outside the penalty area
      if (!attackers && inPenaltyArea(target, ballSide as 1 | -1)) {
        target.x = ballSide * (PITCH.halfLength - PITCH.penaltyAreaDepth - 2);
      }
      break;
    }
    case "FREE_KICK":
    case "THROW_IN":
    default: {
      // Shape around the ball, compact: most of both teams gather within ~30 m of a dead ball.
      const ballX = r.pos.x * dir;
      const shiftX = ballX * 0.6 + (attackers ? 6 : -5);
      target = { x: (home.x * dir + shiftX) * dir, y: home.y * 0.6 + r.pos.y * 0.5 };
      const role = m.def(p.id).role;
      const holdsBack = isDefender(role) && (m.slotIndex(p.id) === 2 || m.slotIndex(p.id) === 3);
      const dBall = dist(target, r.pos);
      if (!holdsBack && dBall > 30) target = add(r.pos, scale(norm(sub(target, r.pos)), 30));
      break;
    }
  }

  // Exclusion zone for opponents (Law: 9.15 m at free kicks/corners/kick-off, 2 m at throw-ins).
  if (!attackers) {
    const minD = r.kind === "THROW_IN" ? 2 : PITCH.restartExclusion;
    const d = dist(target, r.pos);
    if (d < minD) {
      const away = d > 1e-6 ? norm(sub(target, r.pos)) : { x: -dir, y: 0 };
      target = add(r.pos, scale(away, minD + 0.3));
    }
    // A wall for direct free kicks near goal (2-4 players on the ball-goal line).
    if (r.kind === "FREE_KICK") {
      const goal = { x: -PITCH.halfLength * dir, y: 0 };
      const dGoal = dist(r.pos, goal);
      if (dGoal < 30) {
        const idx = Math.max(0, m.slotIndex(p.id));
        const wallSize = dGoal < 22 ? 4 : 3;
        const wallSlot = idx - 1; // outfield index 0..9
        if (wallSlot >= 0 && wallSlot < wallSize) {
          const toGoal = norm(sub(goal, r.pos));
          const base = add(r.pos, scale(toGoal, PITCH.restartExclusion + 0.2));
          const perp = { x: -toGoal.y, y: toGoal.x };
          target = add(base, scale(perp, (wallSlot - (wallSize - 1) / 2) * 0.6));
        }
      }
    }
  }

  const d = dist(p.pos, target);
  setTarget(p, target, d > 10 ? 5 : 3, "restart");
}
