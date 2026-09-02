import type { Match } from "../match";
import { TUNING } from "../tuning";
import type { PlayerState, Restart } from "../types";
import { PITCH, clampToPitch, inPenaltyArea } from "../pitch";
import { kickBall, loftedSpeedFor, passSpeedFor, rollTimeFor } from "../physics/ball";
import { a01, maxSpeed, timeToReach } from "../physics/player";

/** Time for a ball kicked at `v0` along the ground to cover `dist`; a ball that stops short counts as late. */
function ballTimeToDistance(v0: number, dist: number): number {
  const t = rollTimeFor(v0, dist);
  return Number.isFinite(t) ? t : 10;
}
import { add, angleOf, dist, fromAngle, len, norm, pointSegment, scale, sub, type Vec2 } from "../math/vec";

/**
 * On-ball decision making (utility AI). Returns the number of seconds before
 * the next decision is due.
 */
export function decideOnBall(m: Match, p: PlayerState): number {
  const attrs = m.def(p.id).attrs;
  const team = p.team;
  const dir = m.dirOf(team);
  const goal = m.goalFor(team);
  const pressure = m.pressureAt(p.pos, team);
  const isGk = m.isKeeper(p.id);
  const tactics = m.teams[team].tactics;
  const dGoal = dist(p.pos, goal);
  const noise = 0.18 * (1.2 - a01(attrs.decisions));

  interface Option {
    kind: "shoot" | "pass" | "cross" | "dribble" | "clear" | "hold";
    score: number;
    target?: PlayerState;
    point?: Vec2;
  }
  const options: Option[] = [];

  // Keeper holding the ball: distribute within a few seconds (6-second rule).
  if (isGk) {
    const best = bestPass(m, p, { longAllowed: true, minScore: -Infinity });
    if (best && (pressure > 3 || p.possessionTime > 1.5)) {
      executePass(m, p, best.target, best.lofted, false);
      return 0.5;
    }
    if (p.possessionTime > 4.5) {
      executeClear(m, p);
      return 0.5;
    }
    // Move up to the edge of the box with the ball.
    setDribble(m, p, { x: -PITCH.halfLength * dir + dir * 10, y: p.pos.y * 0.5 }, 3);
    return 0.3;
  }

  // Settle the ball first: a player needs a moment after receiving – a touch and a look up
  // (~1 s with time and space; hurried when pressed).
  const settle = (0.35 + 0.6 * (1 - a01(attrs.firstTouch))) * (pressure < 2.5 ? 0.4 : pressure < 5 ? 1.3 : 2.2);
  if (p.possessionTime < settle) {
    const point = dribbleTarget(m, p);
    setDribble(m, p, point, 4);
    p.intent = "settle";
    return settle - p.possessionTime;
  }

  // Scores live on a common scale (~0..2.5). Noise models decision quality.
  // ---- Shoot
  const xg = m.xgAt(p.pos, team);
  const shotAngleOk = Math.abs(p.pos.y) < 25 && dGoal < 32;
  if (shotAngleOk) {
    const inBox = inPenaltyArea(p.pos, dir);
    // Blocked lane in front of the shooter makes a shot unattractive.
    const blockers = countBlockers(m, p, goal);
    // Long-range appetite: space on the edge of the box tempts a strike from distance.
    const longRange = !inBox && dGoal < 28 && pressure > 2.5 && blockers === 0
      ? TUNING.longRangeBase + 0.4 * a01(attrs.technique) + 0.2 * a01(attrs.finishing) - (dGoal - 16) * 0.02
      : 0;
    // A first-time finish under pressure is the hardest skill in the game: most players take a
    // touch first (during which the defender arrives), only the composed strike immediately.
    const firstTime = p.possessionTime < 0.5 && pressure < 2.5 ? -0.9 * (1.1 - a01(attrs.composure)) : 0;
    const shotScore =
      TUNING.shotBase +
      (tactics.mentality - 0.5) * 0.4 +
      xg * (TUNING.shotXgMult + 1.5 * a01(attrs.finishing) + 0.5 * a01(attrs.composure)) +
      (inBox ? 0.15 : 0) +
      (pressure < 1.5 ? -0.3 : 0) -
      blockers * 0.6 +
      firstTime +
      longRange;
    options.push({ kind: "shoot", score: shotScore + m.rng.gauss(0, noise) });
  }

  // ---- Pass
  const pass = bestPass(m, p, { longAllowed: true, minScore: -Infinity });
  if (pass) options.push({ kind: "pass", score: pass.score + m.rng.gauss(0, noise), target: pass.target });

  // ---- Cross: wide in the final third, team-mates in the box
  const inWideFinalThird = p.pos.x * dir > 22 && Math.abs(p.pos.y) > 13;
  let cross: PlayerState | null = null;
  if (inWideFinalThird) {
    const spot = { x: (PITCH.halfLength - 10) * dir, y: 0 };
    let best = -Infinity;
    for (const q of m.activePlayers(team)) {
      if (q.id === p.id || m.isKeeper(q.id)) continue;
      const dq = dist(q.pos, spot);
      if (dq > 13) continue;
      const sc = m.pressureAt(q.pos, team) * 0.3 - dq * 0.05 - (m.inOffsidePosition(q) ? 5 : 0);
      if (sc > best) {
        best = sc;
        cross = q;
      }
    }
    if (cross) {
      const crossScore = TUNING.crossBase + 0.4 * a01(attrs.technique) + Math.min(best, 0.8) + (pressure < 2 ? 0.3 : 0);
      options.push({ kind: "cross", score: crossScore + m.rng.gauss(0, noise), target: cross });
    }
  }

  // ---- Dribble
  const fwd = m.forward(team);
  const space = spaceAhead(m, p, fwd);
  // Carry: with time and space a player brings the ball forward for a moment before releasing it
  // (keeps the pass rate realistic: ~1 pass every 5-6 s of possession).
  const carry = pressure > 4 && p.possessionTime < 1.6 ? TUNING.carryBonus : pressure > 2.5 && p.possessionTime < 0.9 ? TUNING.carryBonus * 0.55 : 0;
  const dribbleScore =
    0.35 +
    carry +
    Math.min(space, 12) * 0.04 +
    0.3 * a01(attrs.dribbling) +
    (pressure < 1.8 ? -0.4 : pressure < 3 ? -0.15 : 0) +
    (p.pos.x * dir < -20 ? -0.25 : 0) + // don't dribble out of defence
    (dGoal < 25 ? 0.1 : 0) -
    Math.min(0.5, Math.max(0, p.possessionTime - 1.6) * 0.15); // don't dribble forever
  options.push({ kind: "dribble", score: dribbleScore + m.rng.gauss(0, noise) });

  // ---- Clear (own third, under pressure, no good pass)
  // Weaker passers under pressure play safe and clear; better ones trust their feet.
  if (p.pos.x * dir < -25 && pressure < 4) {
    const safety = 0.2 * (1 - a01(attrs.passing)) + 0.1 * (1 - a01(attrs.composure));
    options.push({ kind: "clear", score: 0.5 + (pressure < 2 ? 0.5 : 0) + safety + m.rng.gauss(0, noise) });
  }

  // ---- Hold (only when nothing else appeals and not under pressure)
  options.push({ kind: "hold", score: pressure > 6 ? 0.45 : -0.5 });

  options.sort((a, b) => b.score - a.score);
  const choice = options[0]!;

  switch (choice.kind) {
    case "shoot":
      executeShot(m, p, xg);
      return 0.6;
    case "pass":
      m.debug.onPass?.({ from: p.id, to: pass!.target.id, d: pass!.d, margin: pass!.margin, lane: pass!.lane, lofted: pass!.lofted, score: pass!.score, pressure });
      executePass(m, p, choice.target!, pass!.lofted, false);
      return 0.6;
    case "cross":
      executePass(m, p, choice.target!, true, false, true);
      p.intent = "cross";
      m.state.stats[team].crosses++;
      return 0.6;
    case "clear":
      executeClear(m, p);
      return 0.6;
    case "dribble": {
      const point = dribbleTarget(m, p);
      // Running with the ball is slower than sprinting: 60-90% of top speed depending on dribbling.
      setDribble(m, p, point, maxSpeed(attrs, p.fatigue) * (0.6 + 0.3 * a01(attrs.dribbling)));
      return 0.35 + 0.3 * (1 - tactics.directness);
    }
    case "hold":
    default:
      setDribble(m, p, p.pos, 0.5);
      p.intent = "hold";
      return 0.3;
  }
}

// ---------------------------------------------------------------- passing

interface PassEval {
  target: PlayerState;
  score: number;
  lofted: boolean;
  margin: number;
  lane: number;
  d: number;
}

function bestPass(m: Match, p: PlayerState, opts: { longAllowed: boolean; minScore: number }): PassEval | null {
  const attrs = m.def(p.id).attrs;
  const team = p.team;
  const dir = m.dirOf(team);
  const tactics = m.teams[team].tactics;
  const pressure = m.pressureAt(p.pos, team);
  const vision = a01(attrs.vision);
  const opponents = m.activePlayers(m.opp(team));

  let best: PassEval | null = null;
  for (const q of m.activePlayers(team)) {
    if (q.id === p.id) continue;
    const isGkTarget = m.isKeeper(q.id);
    // Lead the receiver slightly
    const lead = add(q.pos, scale(q.vel, 0.6));
    const d = dist(p.pos, lead);
    if (d < 2.5) continue;
    if (!opts.longAllowed && d > 30) continue;
    const maxRange = 25 + 30 * vision;
    if (d > maxRange) continue;

    // Lane safety: for every opponent, can they reach the pass line before the ball does?
    // margin (s) = opponent arrival time − ball arrival time at the closest point of the lane.
    const passSpeed = passSpeedFor(d, 6);
    let lane = Infinity; // nearest opponent to the line (m)
    let margin = Infinity; // worst-case time margin (s)
    // The whole lane counts, including the reception point: a defender who reaches the receiver
    // before the ball is the most common way a pass dies. Defenders start after a reaction delay.
    let blockedAtFeet = false;
    for (const o of opponents) {
      const { d: od, t } = pointSegment(o.pos, p.pos, lead);
      if (t <= 0.02) continue;
      if (od < lane) lane = od;
      const along = t * d;
      // A body within a metre of the line in the first few metres simply blocks the pass –
      // no reaction time needed. Players pass around a presser, not through them.
      if (along < 3.5 && od < 1.0) {
        blockedAtFeet = true;
        margin = Math.min(margin, -1);
        continue;
      }
      const ballT = ballTimeToDistance(passSpeed, along);
      const oppT = timeToReach(o, m.def(o.id).attrs, add(p.pos, scale(sub(lead, p.pos), t))) + TUNING.reactionDelay;
      const mg = oppT - ballT;
      if (mg < margin) margin = mg;
    }
    const receiverSpace = m.pressureAt(lead, team);
    const progress = (lead.x - p.pos.x) * dir;
    // Offside awareness with perception latency: the passer judges the runner's position a
    // fraction of a second late, so a well-timed run can look onside. Clearly offside
    // team-mates are ignored; marginal cases are misjudged by players with weak decisions.
    // Real offsides are timing errors of a metre or two: the passer sees the runner ~0.4-0.6 s late
    // and gambles on marginal cases; only a clearly offside runner is ruled out.
    const latency = 0.55 * (1.4 - a01(attrs.vision));
    const perceivedX = (q.pos.x - q.vel.x * latency) * dir;
    const offMargin = perceivedX - m.offsideLine(team);
    const offside = perceivedX > 0 && offMargin > 0;
    const offsidePenalty = !offside ? 0 : offMargin > 2 ? 2 : offMargin > 0.8 ? 1.0 * (0.3 + 0.7 * a01(attrs.decisions)) : 0.25;
    // Lofted only when the ground lane is shut or the distance demands it (real football is ~15-20% aerial).
    const lofted = d > 40 || (!blockedAtFeet && margin < 0.15 && d > 20 && lane < 1.5);

    let score = 0.3;
    // Safe lanes are worth a lot; a lane a defender reaches first is nearly worthless (unless lofted over).
    if (blockedAtFeet && !lofted) score -= 1.5;
    else if (lofted) score += Math.min(lane, 4) * 0.05;
    else if (margin < 0) score -= 1.0;
    else score += (Math.min(margin, 1.5) - 0.6) * (TUNING.passMarginWeight - 0.6 * tactics.mentality); // tight lanes are a gamble; cautious teams shun them
    score += Math.min(receiverSpace, 6) * 0.05; // ≤ 0.3
    // Directness and mentality both reward vertical passes; a defensive mentality prefers safety.
    score += progress * (0.008 + 0.014 * tactics.directness) * (0.6 + 0.8 * tactics.mentality); // 20 m ≈ 0.3
    score -= d > 22 ? (d - 22) * (0.035 - 0.015 * tactics.directness) : 0; // long balls are risky
    score -= lofted ? 0.3 * (1 - a01(attrs.technique)) + 0.25 : 0;
    score -= offsidePenalty;
    if (isGkTarget) score -= pressure < 3 ? 0.1 : 0.9;
    // Passing back under no pressure is dull
    if (progress < -10 && pressure > 4) score -= 0.3;
    // Passer skill scales confidence in tight passes
    if (lane < 1.2) score -= 0.6 * (1 - a01(attrs.passing));
    // Pressure makes releasing the ball attractive
    if (pressure < 2.5) score += 0.25;
    // Receiver in a scoring position is attractive; a team-mate already sprinting in behind doubly so
    const rxg = m.xgAt(lead, team);
    score += rxg * 2.5;
    if (q.intent === "run" && progress > 5) score += 0.35;

    if (score > opts.minScore && (!best || score > best.score)) best = { target: q, score, lofted, margin, lane, d };
  }
  return best;
}

export function executePass(m: Match, p: PlayerState, target: PlayerState, lofted: boolean, exemptOffside: boolean, isCross = false): void {
  const attrs = m.def(p.id).attrs;
  const ball = m.state.ball;
  const pressure = m.pressureAt(p.pos, p.team);
  const aim = add(target.pos, scale(target.vel, 0.6));
  const d = dist(p.pos, aim);

  // Execution error: angle & speed, worse under pressure and for weak passers.
  // Crosses into a crowded box are the least precise delivery in the game (~20-25% find a team-mate).
  const skill = a01(attrs.passing) * 0.7 + a01(attrs.technique) * 0.3;
  const pressureFactor = 1 + Math.max(0, 3 - pressure) * 0.35;
  const angSd = (0.14 - 0.11 * skill) * pressureFactor * (isCross ? 2.2 : lofted ? 1.4 : 1);
  const spdSd = (0.16 - 0.1 * skill) * pressureFactor * (isCross ? 1.8 : 1);

  const baseAng = angleOf(sub(aim, p.pos));
  const ang = baseAng + m.rng.gauss(0, angSd);

  let speed: number;
  let vz = 0;
  if (lofted) {
    // Launch angle ~ 22-34 degrees; solve the drag-aware range for the launch speed.
    const theta = (22 + 12 * m.rng.next()) * (Math.PI / 180);
    const v = loftedSpeedFor(d, theta) * (1 + m.rng.gauss(0, spdSd));
    speed = v * Math.cos(theta);
    vz = v * Math.sin(theta);
  } else {
    speed = passSpeedFor(d, 4.5) * (1 + m.rng.gauss(0, spdSd));
    speed = Math.min(speed, 24);
  }

  m.touch(p);
  m.recordPass(p, exemptOffside);
  kickBall(ball, fromAngle(ang, speed), vz);
  ball.pos = add(p.pos, fromAngle(ang, 0.4));
  p.kickCooldown = 0.5;
  p.intent = lofted ? "long pass" : "pass";
  m.intendedReceiver = target.id;
  m.state.stats[p.team].passes++;
  m.notePass(p);
  // Receiver runs to meet the ball
  target.target = aim;
  target.desiredSpeed = 99;
}

// ---------------------------------------------------------------- shooting

export function executeShot(m: Match, p: PlayerState, xg: number, isPenalty = false): void {
  const attrs = m.def(p.id).attrs;
  const ball = m.state.ball;
  const dir = m.dirOf(p.team);
  const goal = m.goalFor(p.team);
  const d = dist(p.pos, goal);
  const pressure = isPenalty ? 99 : m.pressureAt(p.pos, p.team);

  // Aim inside a post, error grows with distance, pressure and low finishing.
  const skill = a01(attrs.finishing) * 0.6 + a01(attrs.composure) * 0.25 + a01(attrs.technique) * 0.15;
  const side = m.rng.chance(0.5) ? 1 : -1;
  const aimY = side * (PITCH.goalHalfWidth - 0.6 - m.rng.range(0, 1.6));
  const pressureFactor = 1 + Math.max(0, 2.5 - pressure) * 0.4;
  // ~0.16 rad for a poor finisher, ~0.07 for an elite one (before pressure): at 15 m that is
  // a lateral sd of 2.4 m vs 1.0 m, which yields roughly the real-world ~35-45% on-target rate.
  // Long-range strikes are markedly less precise (body shape, ball movement, power over placement).
  const rangeFactor = 1 + Math.max(0, d - 16) * 0.03;
  const angSd = (TUNING.shotAngSd - 0.16 * skill) * pressureFactor * rangeFactor * (isPenalty ? 0.22 : 1);
  const baseAng = angleOf(sub({ x: goal.x, y: aimY }, p.pos));
  const ang = baseAng + m.rng.gauss(0, angSd);

  // Shot speed: 20–31 m/s. Elevation: mostly low, sometimes lifted; long shots rise more.
  const speed = 20 + 11 * (0.4 * a01(attrs.finishing) + 0.6 * m.rng.next()) * (isPenalty ? 0.9 : 1);
  const elevDeg = Math.max(0, m.rng.gauss(5 + Math.min(d, 30) * 0.22, 5.5 * (1.4 - skill) * (isPenalty ? 0.4 : 1)));
  const elev = Math.min(elevDeg, 40) * (Math.PI / 180);

  m.touch(p);
  kickBall(ball, fromAngle(ang, speed * Math.cos(elev)), speed * Math.sin(elev));
  ball.pos = add(p.pos, fromAngle(ang, 0.4));
  p.kickCooldown = 0.6;
  p.intent = "shoot";
  m.intendedReceiver = null;
  m.registerShot(p, isPenalty ? 0.76 : xg);

  // Blocks: a defender standing in the first metres of the shot line gets in the way.
  if (!isPenalty) {
    const end = add(p.pos, fromAngle(ang, 10));
    for (const o of m.activePlayers(m.opp(p.team))) {
      if (m.isKeeper(o.id)) continue;
      const { d: od, t } = pointSegment(o.pos, p.pos, end);
      if (t <= 0 || od > 2.0) continue;
      // closer bodies and lower shots get blocked more; a lunge covers ~2 m
      const pBlock = (0.9 - od * 0.35) * (1 - t * 0.4) * (elev > 0.3 ? 0.4 : 1);
      if (m.rng.chance(pBlock)) {
        // which side of the shot line the blocker stands on decides the deflection side
        const rel = sub(o.pos, p.pos);
        const side = rel.x * Math.sin(ang) - rel.y * Math.cos(ang) > 0 ? -1 : 1;
        m.blockShot(o, od, side);
        break;
      }
    }
  }
  void dir;
}

/** Opponents standing in the shooting lane close to the shooter. */
function countBlockers(m: Match, p: PlayerState, goal: Vec2): number {
  const end = add(p.pos, scale(norm(sub(goal, p.pos)), 6));
  let n = 0;
  for (const o of m.activePlayers(m.opp(p.team))) {
    if (m.isKeeper(o.id)) continue;
    const { d: od, t } = pointSegment(o.pos, p.pos, end);
    if (t > 0 && od < 1.2) n++;
  }
  return n;
}

// ---------------------------------------------------------------- clearing / dribbling

function executeClear(m: Match, p: PlayerState): void {
  const ball = m.state.ball;
  const dir = m.dirOf(p.team);
  const sideY = p.pos.y >= 0 ? 1 : -1;
  const pressure = m.pressureAt(p.pos, p.team);
  const inOwnBox = inPenaltyArea(p.pos, (-dir) as 1 | -1);
  let ang: number;
  let theta: number;
  let v: number;
  if (inOwnBox && pressure < 2.5 && m.rng.chance(TUNING.panicClear)) {
    // Hurried clearance facing own goal: sideways or behind – corners and throw-ins come from here.
    ang = angleOf({ x: dir * m.rng.range(-0.8, 0.2), y: sideY }) + m.rng.gauss(0, 0.2);
    theta = (10 + 25 * m.rng.next()) * (Math.PI / 180);
    v = 10 + 8 * m.rng.next();
  } else {
    // Hoof it upfield toward the nearer touchline side, high and long.
    ang = angleOf({ x: dir, y: sideY * 0.5 }) + m.rng.gauss(0, 0.15);
    theta = (30 + 10 * m.rng.next()) * (Math.PI / 180);
    v = 22 + 6 * m.rng.next();
  }
  m.touch(p);
  m.recordPass(p, false);
  kickBall(ball, fromAngle(ang, v * Math.cos(theta)), v * Math.sin(theta));
  ball.pos = add(p.pos, fromAngle(ang, 0.4));
  p.kickCooldown = 0.5;
  p.intent = "clear";
  m.intendedReceiver = null;
}

function setDribble(m: Match, p: PlayerState, point: Vec2, speed: number): void {
  p.target = clampToPitch(point, 0.5);
  p.desiredSpeed = speed;
  p.intent = "dribble";
}

/** Choose a dribbling waypoint: forward, steering away from the nearest opponents. */
function dribbleTarget(m: Match, p: PlayerState): Vec2 {
  const dir = m.dirOf(p.team);
  const goal = m.goalFor(p.team);
  let desired = norm(sub(goal, p.pos));
  if (dist(p.pos, goal) > 35) desired = norm(add(desired, { x: dir * 0.8, y: 0 }));

  // Repulsion from close opponents
  let steer = { ...desired };
  for (const o of m.activePlayers(m.opp(p.team))) {
    const d = dist(o.pos, p.pos);
    if (d < 7 && d > 1e-6) {
      const away = norm(sub(p.pos, o.pos));
      steer = add(steer, scale(away, (7 - d) / 7));
    }
  }
  // Attraction to open space in front (sample a few directions)
  let bestDir = norm(steer);
  let bestScore = -Infinity;
  for (let k = -3; k <= 3; k++) {
    const a = angleOf(steer) + k * 0.35;
    const cand = fromAngle(a);
    const point = add(p.pos, scale(cand, 6));
    if (Math.abs(point.y) > PITCH.halfWidth - 1 || Math.abs(point.x) > PITCH.halfLength - 1) continue;
    const space = m.pressureAt(point, p.team);
    const progress = cand.x * dir;
    const score = Math.min(space, 10) * 0.6 + progress * 3 - Math.abs(k) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestDir = cand;
    }
  }
  return add(p.pos, scale(bestDir, 6));
}

/** Free space along a direction: distance to the nearest opponent within a forward cone. */
function spaceAhead(m: Match, p: PlayerState, fwd: Vec2): number {
  let best = 20;
  for (const o of m.activePlayers(m.opp(p.team))) {
    const rel = sub(o.pos, p.pos);
    const d = len(rel);
    if (d < 1e-6 || d > 20) continue;
    const cos = (rel.x * fwd.x + rel.y * fwd.y) / d;
    if (cos > 0.5 && d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- restarts

export function executeRestart(m: Match, r: Restart, taker: PlayerState): void {
  const ball = m.state.ball;
  const dir = m.dirOf(taker.team);
  ball.pos = { ...r.pos };
  ball.z = 0;

  switch (r.kind) {
    case "PENALTY": {
      executeShot(m, taker, 0.76, true);
      return;
    }
    case "KICK_OFF": {
      // Short pass to the nearest teammate (ball must move forward or anywhere since 2016).
      const mate = nearestTeammate(m, taker);
      if (mate) executePass(m, taker, mate, false, false);
      return;
    }
    case "THROW_IN": {
      // Throw: lofted, limited range, no offside from a throw-in.
      const best = bestThrowTarget(m, taker, 22);
      if (best) executePass(m, taker, best, true, true);
      else executeClear(m, taker);
      return;
    }
    case "GOAL_KICK": {
      const best = bestPass(m, taker, { longAllowed: true, minScore: -Infinity });
      if (best) executePass(m, taker, best.target, best.lofted || m.rng.chance(0.5), true);
      else executeClear(m, taker);
      return;
    }
    case "CORNER": {
      // Cross toward the penalty spot area (no offside from a corner).
      const box = { x: (PITCH.halfLength - 9) * dir, y: m.rng.range(-5, 5) };
      const candidates = m.activePlayers(taker.team).filter((q) => q.id !== taker.id && dist(q.pos, box) < 12);
      const target = candidates.length
        ? candidates.reduce((b, q) => (dist(q.pos, box) < dist(b.pos, box) ? q : b))
        : nearestTeammate(m, taker);
      if (target) executePass(m, taker, target, true, true);
      return;
    }
    case "FREE_KICK":
    default: {
      const goal = m.goalFor(taker.team);
      const d = dist(r.pos, goal);
      if (d < 28 && Math.abs(r.pos.y) < 18 && m.rng.chance(0.6)) {
        executeShot(m, taker, m.xgAt(r.pos, taker.team) * 0.7);
        return;
      }
      const best = bestPass(m, taker, { longAllowed: true, minScore: -Infinity });
      if (best) executePass(m, taker, best.target, best.lofted, false);
      else executeClear(m, taker);
      return;
    }
  }
}

function nearestTeammate(m: Match, p: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const q of m.activePlayers(p.team)) {
    if (q.id === p.id || m.isKeeper(q.id)) continue;
    const d = dist(q.pos, p.pos);
    if (d < bestD) {
      best = q;
      bestD = d;
    }
  }
  return best;
}

function bestThrowTarget(m: Match, p: PlayerState, maxRange: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const q of m.activePlayers(p.team)) {
    if (q.id === p.id || m.isKeeper(q.id)) continue;
    const d = dist(q.pos, p.pos);
    if (d > maxRange || d < 2) continue;
    const space = m.pressureAt(q.pos, p.team);
    const score = Math.min(space, 6) - d * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

export { maxSpeed };
