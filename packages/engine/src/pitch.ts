import type { Vec2 } from "./math/vec";

/**
 * Pitch geometry (meters). Origin at center spot.
 * x runs along the length (-L/2 .. +L/2), y along the width (-W/2 .. +W/2).
 * Team with attackDir = +1 attacks the goal at x = +L/2.
 */
export const PITCH = {
  length: 105,
  width: 68,
  halfLength: 52.5,
  halfWidth: 34,
  goalWidth: 7.32,
  goalHalfWidth: 3.66,
  goalHeight: 2.44,
  goalDepth: 2.0,
  penaltyAreaDepth: 16.5,
  penaltyAreaHalfWidth: 20.16,
  goalAreaDepth: 5.5,
  goalAreaHalfWidth: 9.16,
  penaltySpotDist: 11,
  centerCircleRadius: 9.15,
  cornerArcRadius: 1,
  /** Minimum opponent distance at restarts (Law 13/16/17): 9.15m */
  restartExclusion: 9.15,
} as const;

export const goalCenter = (attackDir: 1 | -1): Vec2 => ({
  x: PITCH.halfLength * attackDir,
  y: 0,
});

export const penaltySpot = (attackDir: 1 | -1): Vec2 => ({
  x: (PITCH.halfLength - PITCH.penaltySpotDist) * attackDir,
  y: 0,
});

export function inPenaltyArea(p: Vec2, goalSide: 1 | -1): boolean {
  const x = p.x * goalSide;
  return x >= PITCH.halfLength - PITCH.penaltyAreaDepth && Math.abs(p.y) <= PITCH.penaltyAreaHalfWidth;
}

export function inGoalArea(p: Vec2, goalSide: 1 | -1): boolean {
  const x = p.x * goalSide;
  return x >= PITCH.halfLength - PITCH.goalAreaDepth && Math.abs(p.y) <= PITCH.goalAreaHalfWidth;
}

export function insidePitch(p: Vec2, margin = 0): boolean {
  return (
    Math.abs(p.x) <= PITCH.halfLength + margin && Math.abs(p.y) <= PITCH.halfWidth + margin
  );
}

export function clampToPitch(p: Vec2, margin = 0.5): Vec2 {
  const hl = PITCH.halfLength - margin;
  const hw = PITCH.halfWidth - margin;
  return {
    x: p.x < -hl ? -hl : p.x > hl ? hl : p.x,
    y: p.y < -hw ? -hw : p.y > hw ? hw : p.y,
  };
}
