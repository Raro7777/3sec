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
  // The wide pair are wing-backs, not wide midfielders: they carry the width on their own (there is
  // no winger outside them) and drop in to make a back five when the ball is lost. Giving them the
  // LB/RB slot role is what makes both halves of that work — see `isWingBackSlot`.
  "3-5-2": [
    { role: "GK", x: -0.94, y: 0 },
    { role: "CB", x: -0.6, y: -0.4 },
    { role: "CB", x: -0.65, y: 0 },
    { role: "CB", x: -0.6, y: 0.4 },
    { role: "LB", x: -0.2, y: -0.85 },
    { role: "DM", x: -0.3, y: 0 },
    { role: "CM", x: -0.1, y: -0.3 },
    { role: "CM", x: -0.1, y: 0.3 },
    { role: "RB", x: -0.2, y: 0.85 },
    { role: "ST", x: 0.32, y: -0.2 },
    { role: "ST", x: 0.32, y: 0.2 },
  ],
};

/**
 * A wing-back slot: a full-back who starts level with the midfield rather than in the back line.
 *
 * The slot role decides how the player defends (LB/RB drops into the defensive line, so a back three
 * becomes a back five out of possession) and which player roles the manager can pick; the starting
 * x decides how they attack. A full-back in a back four sits at x ≈ −0.55, a wing-back at −0.2, so
 * the threshold below separates them with room to spare either side.
 */
export function isWingBackSlot(slot: Slot): boolean {
  return (slot.role === "LB" || slot.role === "RB") && slot.x > -0.4;
}

/** Convert a normalized slot to pitch meters for a team attacking in `dir`. */
export function slotToPitch(slot: { x: number; y: number }, dir: 1 | -1, width = 1): Vec2 {
  return { x: slot.x * 52.5 * dir, y: slot.y * 34 * width * 0.92 };
}

/** How well a player of role `have` fits a slot of role `want` (0 = perfect, larger = worse). */
export function roleDistance(have: Role, want: Role): number {
  if (have === want) return 0;
  const group = (r: Role): number => (r === "GK" ? 0 : isDefender(r) ? 1 : isMidfielder(r) ? 2 : 3);
  const side = (r: Role): "L" | "R" | "C" => (r[0] === "L" ? "L" : r[0] === "R" ? "R" : "C");
  const gh = group(have);
  const gw = group(want);
  if (gh === 0 || gw === 0) return 10; // keepers only in goal
  let d = Math.abs(gh - gw) * 2 + 1;
  if (side(have) !== side(want)) d += side(have) === "C" || side(want) === "C" ? 0.5 : 1.5;
  return d;
}

export const isDefender = (r: Role): boolean => r === "CB" || r === "LB" || r === "RB";
export const isMidfielder = (r: Role): boolean =>
  r === "DM" || r === "CM" || r === "LM" || r === "RM" || r === "AM";
export const isForward = (r: Role): boolean => r === "LW" || r === "RW" || r === "ST";
