import type { Attributes, PlayerState } from "../types";
import { angleOf, dist, len, norm, scale, sub, type Vec2 } from "../math/vec";

/**
 * Map a 1..20 attribute to [0,1], compressed around the midpoint. Attribute differences
 * compound across dozens of duels per match; without compression a 5-point quality gap
 * produced 48 shots to 2. With it, strong vs weak looks like ~25 to 6, as in real football.
 */
export const ATTR_COMPRESSION = 0.7;
export const a01 = (x: number): number => 0.5 + (Math.min(20, Math.max(1, x)) / 20 - 0.5) * ATTR_COMPRESSION;

/**
 * Top speed in m/s: 1 => 7.0, 20 => 9.6 (elite sprinter ~ 9.5–10 m/s).
 * The range is deliberately compressed: professional players differ by ~10-15% in top speed,
 * and a wider spread makes every loose-ball race a foregone conclusion.
 */
export function maxSpeed(attrs: Attributes, fatigue: number): number {
  const base = 7.0 + 2.6 * a01(attrs.pace);
  return base * (1 - 0.22 * fatigue);
}

/** Max acceleration in m/s^2: 1 => 4.0, 20 => 7.0. */
export function maxAccel(attrs: Attributes, fatigue: number): number {
  const base = 4.0 + 3.0 * a01(attrs.acceleration);
  return base * (1 - 0.18 * fatigue);
}

/** Max turn rate in rad/s: agile players turn faster; turning is harder at high speed. */
export function maxTurnRate(attrs: Attributes, speed: number): number {
  const base = 4 + 8 * a01(attrs.agility);
  return base / (1 + speed * 0.25);
}

/**
 * Steer a player toward their target at the desired speed, respecting
 * acceleration, top speed and turning limits.
 */
export function stepPlayer(p: PlayerState, attrs: Attributes, dt: number): void {
  const toTarget = sub(p.target, p.pos);
  const d = len(toTarget);
  const vMax = maxSpeed(attrs, p.fatigue);
  const aMax = maxAccel(attrs, p.fatigue);

  // Arrive behaviour: slow down within braking distance.
  let wantSpeed = Math.min(p.desiredSpeed, vMax);
  const brakingDist = (wantSpeed * wantSpeed) / (2 * aMax);
  if (d < brakingDist) wantSpeed = Math.max(0, Math.sqrt(2 * aMax * d) * 0.9);
  if (d < 0.05) wantSpeed = 0;

  const desiredVel = d > 1e-6 ? scale(norm(toTarget), wantSpeed) : { x: 0, y: 0 };
  const dv = sub(desiredVel, p.vel);
  const dvLen = len(dv);
  const maxDv = aMax * dt;
  if (dvLen > maxDv) {
    p.vel.x += (dv.x / dvLen) * maxDv;
    p.vel.y += (dv.y / dvLen) * maxDv;
  } else {
    p.vel.x = desiredVel.x;
    p.vel.y = desiredVel.y;
  }

  const speed = len(p.vel);
  if (speed > vMax) {
    p.vel.x *= vMax / speed;
    p.vel.y *= vMax / speed;
  }

  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  p.distance += speed * dt;

  // Facing follows velocity (or target when standing still), limited by turn rate.
  const faceTarget = speed > 0.3 ? angleOf(p.vel) : d > 0.3 ? angleOf(toTarget) : p.facing;
  let diff = faceTarget - p.facing;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const maxTurn = maxTurnRate(attrs, speed) * dt;
  p.facing += Math.max(-maxTurn, Math.min(maxTurn, diff));

  // Fatigue: a baseline cost of being on the pitch plus an effort cost that grows steeply with
  // sprinting. After 90 minutes an average outfielder sits around 0.6-0.7, a stamina-18 player
  // around 0.45 and a stamina-7 player near 0.85 (before half-time recovery).
  const effort = speed / vMax;
  const staminaFactor = 1.7 - a01(attrs.stamina);
  p.fatigue += (0.00005 + 0.00033 * Math.pow(effort, 1.5)) * staminaFactor * dt;
  if (p.fatigue < 0) p.fatigue = 0;
  if (p.fatigue > 1) p.fatigue = 1;
}

/** Estimated time for a player to reach a point (accel-aware, approximate). */
export function timeToReach(p: PlayerState, attrs: Attributes, target: Vec2): number {
  const d = dist(p.pos, target);
  const vMax = maxSpeed(attrs, p.fatigue);
  const aMax = maxAccel(attrs, p.fatigue);
  const v0 = Math.max(0, len(p.vel) * 0.7); // partial credit for current motion
  const tAcc = (vMax - v0) / aMax;
  const dAcc = v0 * tAcc + 0.5 * aMax * tAcc * tAcc;
  if (d <= dAcc) {
    // solve 0.5 a t^2 + v0 t - d = 0
    return (-v0 + Math.sqrt(v0 * v0 + 2 * aMax * d)) / aMax;
  }
  return tAcc + (d - dAcc) / vMax;
}
