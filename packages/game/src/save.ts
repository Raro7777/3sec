import type { GameState } from "./types";
import { CLUBS } from "./world";

export const SAVE_KEY = "3sec.save.v1";

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string | null | undefined): GameState | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as GameState;
    if (s.version !== 1 || !Array.isArray(s.clubs) || !Array.isArray(s.fixtures)) return null;
    for (const c of s.clubs) {
      if (typeof c.budget !== "number") c.budget = Math.round(20 + (c.reputation - 10) * 12);
      // Older saves carry English club names; the roster of clubs is fixed by id, so refresh the labels.
      const def = CLUBS[c.id];
      if (def) { c.name = def.name; c.shortName = def.shortName; }
    }
    return s;
  } catch {
    return null;
  }
}
