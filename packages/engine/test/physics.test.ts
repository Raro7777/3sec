import { describe, expect, it } from "vitest";
import { kickBall, passSpeedFor, rollDistance, rollTimeFor, stepBall } from "../src/physics/ball";
import { maxSpeed, stepPlayer } from "../src/physics/player";
import { generateAttributes } from "../src/teams";
import { Rng } from "../src/rng";
import type { BallState, PlayerState } from "../src/types";

const DT = 1 / 20;

const freshBall = (): BallState => ({
  pos: { x: 0, y: 0 },
  z: 0,
  vel: { x: 0, y: 0 },
  vz: 0,
  owner: null,
  lastTouch: null,
  lastTouchTeam: null,
  prevTouch: null,
});

describe("ball physics", () => {
  it("a rolling ball decelerates to rest and travels the analytic distance", () => {
    const b = freshBall();
    kickBall(b, { x: 10, y: 0 }, 0);
    let t = 0;
    while (Math.hypot(b.vel.x, b.vel.y) > 0 && t < 30) {
      stepBall(b, DT);
      t += DT;
    }
    const expected = rollDistance(10);
    expect(b.pos.x).toBeGreaterThan(expected * 0.97);
    expect(b.pos.x).toBeLessThan(expected * 1.03);
    expect(b.pos.y).toBe(0);
  });

  it("passSpeedFor delivers the ball close to the target distance", () => {
    const b = freshBall();
    const d = 20;
    kickBall(b, { x: passSpeedFor(d, 6), y: 0 }, 0);
    let t = 0;
    // stop once the ball has crossed the target distance and check arrival speed
    while (b.pos.x < d && t < 10) {
      stepBall(b, DT);
      t += DT;
    }
    expect(b.pos.x).toBeGreaterThanOrEqual(d);
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeGreaterThan(5.5);
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeLessThan(6.5);
    expect(t).toBeGreaterThan(rollTimeFor(passSpeedFor(d, 6), d) - 0.1);
    expect(t).toBeLessThan(rollTimeFor(passSpeedFor(d, 6), d) + 0.1);
  });

  it("a lofted ball follows a parabola, bounces and settles", () => {
    const b = freshBall();
    kickBall(b, { x: 15, y: 0 }, 10);
    let maxZ = 0;
    let bounces = 0;
    let prevVz = b.vz;
    for (let i = 0; i < 20 * 12; i++) {
      stepBall(b, DT);
      maxZ = Math.max(maxZ, b.z);
      if (prevVz < 0 && b.vz > 0) bounces++;
      prevVz = b.vz;
    }
    // apex of a 10 m/s vertical launch without drag: 5.1 m
    expect(maxZ).toBeGreaterThan(4);
    expect(maxZ).toBeLessThan(5.2);
    expect(bounces).toBeGreaterThanOrEqual(2);
    expect(b.z).toBe(0);
    expect(b.vz).toBe(0);
  });
});

describe("player kinematics", () => {
  it("accelerates toward the target and caps at top speed", () => {
    const attrs = generateAttributes(new Rng(3), "ST", 15);
    const p: PlayerState = {
      id: "p",
      team: 0,
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      facing: 0,
      target: { x: 100, y: 0 },
      desiredSpeed: 99,
      fatigue: 0,
      onPitch: true,
      distance: 0,
      yellow: 0,
      sentOff: false,
      kickCooldown: 0,
      possessionTime: 0,
      intent: "",
    };
    const speeds: number[] = [];
    for (let i = 0; i < 20 * 4; i++) {
      stepPlayer(p, attrs, DT);
      speeds.push(Math.hypot(p.vel.x, p.vel.y));
    }
    expect(speeds[5]!).toBeLessThan(speeds[40]!);
    const top = maxSpeed(attrs, 0);
    expect(speeds[79]!).toBeLessThanOrEqual(top + 1e-9);
    expect(speeds[79]!).toBeGreaterThan(top * 0.95);
    expect(p.pos.x).toBeGreaterThan(20);
  });
});
