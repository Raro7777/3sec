import type { FormationName, Role } from "./types";
import type { Vec2 } from "./math/vec";

/**
 * Formation slots in normalized coordinates:
 *   x: -1 (own goal line) .. +1 (opponent goal line)
 *   y: -1 (left touchline, from the attacking team's view) .. +1 (right)
 * Index 0 is always the goalkeeper.
 */
export interface Slot {
  role: Role;
  x: number;
  y: number;
}

export const FORMATIONS: Record<FormationName, Slot[]> = {
  "4-3-3": [
    { role: "GK", x: -0.94, y: 0 },
    { role: "LB", x: -0.55, y: -0.7 },
    { role: "CB", x: -0.62, y: -0.25 },
    { role: "CB", x: -0.62, y: 0.25 },
    { role: "RB", x: -0.55, y: 0.7 },
    { role: "DM", x: -0.3, y: 0 },
    { role: "CM", x: -0.12, y: -0.35 },
    { role: "CM", x: -0.12, y: 0.35 },
    { role: "LW", x: 0.25, y: -0.7 },
    { role: "ST", x: 0.35, y: 0 },
    { role: "RW", x: 0.25, y: 0.7 },
  ],
  "4-4-2": [
    { role: "GK", x: -0.94, y: 0 },
    { role: "LB", x: -0.55, y: -0.7 },
    { role: "CB", x: -0.62, y: -0.25 },
    { role: "CB", x: -0.62, y: 0.25 },
    { role: "RB", x: -0.55, y: 0.7 },
    { role: "LM", x: -0.1, y: -0.75 },
    { role: "CM", x: -0.2, y: -0.25 },
    { role: "CM", x: -0.2, y: 0.25 },
    { role: "RM", x: -0.1, y: 0.75 },
    { role: "ST", x: 0.32, y: -0.2 },
    { role: "ST", x: 0.32, y: 0.2 },
  ],
  "4-2-3-1": [
    { role: "GK", x: -0.94, y: 0 },
    { role: "LB", x: -0.55, y: -0.7 },
    { role: "CB", x: -0.62, y: -0.25 },
    { role: "CB", x: -0.62, y: 0.25 },
    { role: "RB", x: -0.55, y: 0.7 },
    { role: "DM", x: -0.3, y: -0.2 },
    { role: "DM", x: -0.3, y: 0.2 },
    { role: "LW", x: 0.1, y: -0.7 },
    { role: "AM", x: 0.05, y: 0 },
    { role: "RW", x: 0.1, y: 0.7 },
    { role: "ST", x: 0.38, y: 0 },
  ],
  "3-5-2": [
    { role: "GK", x: -0.94, y: 0 },
    { role: "CB", x: -0.6, y: -0.4 },
    { role: "CB", x: -0.65, y: 0 },
    { role: "CB", x: -0.6, y: 0.4 },
    { role: "LM", x: -0.15, y: -0.85 },
    { role: "DM", x: -0.3, y: 0 },
    { role: "CM", x: -0.1, y: -0.3 },
    { role: "CM", x: -0.1, y: 0.3 },
    { role: "RM", x: -0.15, y: 0.85 },
    { role: "ST", x: 0.32, y: -0.2 },
    { role: "ST", x: 0.32, y: 0.2 },
  ],
};

/** Convert a normalized slot to pitch meters for a team attacking in `dir`. */
export function slotToPitch(slot: { x: number; y: number }, dir: 1 | -1, width = 1): Vec2 {
  return { x: slot.x * 52.5 * dir, y: slot.y * 34 * width * 0.92 };
}

export const isDefender = (r: Role): boolean => r === "CB" || r === "LB" || r === "RB";
export const isMidfielder = (r: Role): boolean =>
  r === "DM" || r === "CM" || r === "LM" || r === "RM" || r === "AM";
export const isForward = (r: Role): boolean => r === "LW" || r === "RW" || r === "ST";
