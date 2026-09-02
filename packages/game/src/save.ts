import type { GameState } from "./types";
import { CLUBS } from "./world";
import { overall } from "./rating";
import { wageFor } from "./contracts";

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
      if (!c.training) c.training = { focus: "balanced", intensity: "normal" };
      // Saves from before the academy: an empty one that fills at the next intake (season start / round 11).
      if (!c.youth || !Array.isArray(c.youth.prospects)) c.youth = { prospects: [], scouting: "local", coaching: 1, nextId: 1 };
      if (typeof c.youth.nextId !== "number") c.youth.nextId = c.youth.prospects.length + 1;
      for (const y of c.youth.prospects) if (typeof y.growth !== "number") y.growth = 0;
      for (const p of c.squad) {
        if (typeof p.potential !== "number") { const o = overall(p.attrs, p.role); p.potential = Math.max(o, Math.min(20, Math.round((o + Math.max(0, 27 - p.age) * 0.55 + 0.5) * 10) / 10)); }
        if (typeof p.growth !== "number") p.growth = 0;
        if (typeof p.contractUntil !== "number") p.contractUntil = s.season + 1;
        if (typeof p.wage !== "number") p.wage = wageFor(p);
      }
    }
    return s;
  } catch {
    return null;
  }
}
