import type { BallState } from "../types";
import type { Vec2 } from "../math/vec";
import { len } from "../math/vec";

/**
 * Ball physics constants (SI units).
 *
 * Quadratic air drag: a = -k * |v| * v with k = 0.5 * rho * Cd * A / m
 *   rho = 1.2 kg/m^3, Cd ≈ 0.25 (size-5 ball in turbulent regime),
 *   A = pi * 0.11^2 ≈ 0.038 m^2, m = 0.43 kg  => k ≈ 0.013
 */
export const BALL = {
  gravity: 9.81,
  dragK: 0.013,
  /** coefficient of restitution on grass */
  restitution: 0.55,
  /** horizontal velocity retained on bounce (grass friction at impact) */
  bounceFriction: 0.8,
  /** rolling deceleration on grass (m/s^2). 12 m/s kick rolls ~36 m on a typical pitch. */
  rollingDecel: 2.0,
  /** below this vertical speed the ball stops bouncing */
  settleVz: 0.6,
  radius: 0.11,
} as const;

export function stepBall(ball: BallState, dt: number): void {
  const speed2d = len(ball.vel);

  if (ball.z > 0.001 || ball.vz > 0) {
    // In the air: gravity + quadratic drag on the full 3D velocity.
    const speed3 = Math.hypot(ball.vel.x, ball.vel.y, ball.vz);
    const drag = BALL.dragK * speed3;
    ball.vel.x -= ball.vel.x * drag * dt;
    ball.vel.y -= ball.vel.y * drag * dt;
    ball.vz -= (BALL.gravity + ball.vz * drag) * dt;
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;
    ball.z += ball.vz * dt;

    if (ball.z <= 0) {
      ball.z = 0;
      if (Math.abs(ball.vz) > BALL.settleVz) {
        ball.vz = -ball.vz * BALL.restitution;
        ball.vel.x *= BALL.bounceFriction;
        ball.vel.y *= BALL.bounceFriction;
      } else {
        ball.vz = 0;
      }
    }
  } else {
    // Rolling on the ground: constant deceleration + small quadratic drag.
    if (speed2d > 1e-6) {
      const decel = BALL.rollingDecel + BALL.dragK * speed2d * speed2d;
      const newSpeed = Math.max(0, speed2d - decel * dt);
      const f = newSpeed / speed2d;
      ball.vel.x *= f;
      ball.vel.y *= f;
    }
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;
    ball.z = 0;
    ball.vz = 0;
  }
}

/** Apply an impulse: set the velocity directly (players kick, we don't model foot mass). */
export function kickBall(ball: BallState, vel: Vec2, vz: number): void {
  ball.vel.x = vel.x;
  ball.vel.y = vel.y;
  ball.vz = vz;
  if (vz > 0 && ball.z <= 0) ball.z = 0.01;
  ball.owner = null;
}

/*
 * Rolling model: dv/dt = -(a + k v^2) with a = rollingDecel, k = dragK.
 * Closed forms (exact for this model):
 *   distance from v0 down to v1:  D = ln((a + k v0^2) / (a + k v1^2)) / (2k)
 *   time     from v0 down to v1:  T = (atan(v0 sqrt(k/a)) - atan(v1 sqrt(k/a))) / sqrt(ak)
 */

/** Speed after rolling `distance` meters from `v0`, or 0 if it stops first. */
export function rollSpeedAfter(v0: number, distance: number): number {
  const a = BALL.rollingDecel;
  const k = BALL.dragK;
  const kv1sq = (a + k * v0 * v0) * Math.exp(-2 * k * distance) - a;
  return kv1sq > 0 ? Math.sqrt(kv1sq / k) : 0;
}

/** Time for a ball kicked at `v0` along the ground to cover `distance`; Infinity if it stops first. */
export function rollTimeFor(v0: number, distance: number): number {
  const v1 = rollSpeedAfter(v0, distance);
  if (v1 <= 0) return Infinity;
  const a = BALL.rollingDecel;
  const k = BALL.dragK;
  const s = Math.sqrt(k / a);
  return (Math.atan(v0 * s) - Math.atan(v1 * s)) / Math.sqrt(a * k);
}

/** Total distance a ball kicked at `v0` rolls before stopping. */
export function rollDistance(v0: number): number {
  const a = BALL.rollingDecel;
  const k = BALL.dragK;
  return Math.log((a + k * v0 * v0) / a) / (2 * k);
}

/**
 * Horizontal range of a lofted kick with launch speed `v` at elevation `theta`,
 * integrated with air drag until the first bounce.
 */
export function loftedRange(v: number, theta: number): number {
  let x = 0;
  let z = 0.01;
  let vx = v * Math.cos(theta);
  let vz = v * Math.sin(theta);
  const h = 0.02;
  for (let i = 0; i < 500 && z > 0; i++) {
    const sp = Math.hypot(vx, vz);
    const drag = BALL.dragK * sp;
    vx -= vx * drag * h;
    vz -= (BALL.gravity + vz * drag) * h;
    x += vx * h;
    z += vz * h;
  }
  return x;
}

/** Launch speed so that a lofted kick at `theta` first lands `distance` meters away (drag-aware). */
export function loftedSpeedFor(distance: number, theta: number): number {
  let lo = 5;
  let hi = 40;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (loftedRange(mid, theta) < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Ground speed required so that a rolling ball travels `distance` meters
 * and arrives with `arrivalSpeed` (exact inverse of the rolling model).
 */
export function passSpeedFor(distance: number, arrivalSpeed = 6): number {
  const a = BALL.rollingDecel;
  const k = BALL.dragK;
  return Math.sqrt(((a + k * arrivalSpeed * arrivalSpeed) * Math.exp(2 * k * distance) - a) / k);
}
