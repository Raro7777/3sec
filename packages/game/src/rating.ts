import { roleDistance, type Attributes, type Role } from "@3sec/engine";

type W = Partial<Record<keyof Attributes, number>>;
const GK: W = { reflexes: 3, handling: 3, gkPositioning: 2, positioning: 1, anticipation: 1, decisions: 1 };
const DEF: W = { tackling: 3, marking: 3, positioning: 2, strength: 1.5, anticipation: 1.5, pace: 1, passing: 0.5, decisions: 1 };
const WIDE_DEF: W = { tackling: 2, marking: 2, positioning: 1.5, pace: 2, acceleration: 1, stamina: 1.5, passing: 1, technique: 0.5 };
const DM: W = { tackling: 2, marking: 1.5, positioning: 2, passing: 2, decisions: 1.5, anticipation: 1, stamina: 1 };
const MID: W = { passing: 3, vision: 2, firstTouch: 1.5, technique: 1.5, decisions: 1.5, stamina: 1, tackling: 1 };
const AM: W = { passing: 2, vision: 3, technique: 2, firstTouch: 1.5, dribbling: 1.5, composure: 1, finishing: 1 };
const WING: W = { pace: 2, acceleration: 2, dribbling: 3, technique: 1.5, firstTouch: 1, finishing: 1, vision: 0.5 };
const ST: W = { finishing: 3.5, composure: 2, firstTouch: 1.5, acceleration: 1.5, pace: 1, strength: 1, anticipation: 1 };

function weights(role: Role): W {
  switch (role) {
    case "GK": return GK;
    case "CB": return DEF;
    case "LB": case "RB": return WIDE_DEF;
    case "DM": return DM;
    case "CM": case "LM": case "RM": return MID;
    case "AM": return AM;
    case "LW": case "RW": return WING;
    case "ST": return ST;
  }
}

/** Role-specific overall rating on the attribute scale (1..20). */
export function overall(attrs: Attributes, role: Role): number {
  const w = weights(role);
  let num = 0, den = 0;
  for (const [k, wt] of Object.entries(w) as [keyof Attributes, number][]) {
    num += attrs[k] * wt;
    den += wt;
  }
  return Math.round((num / den) * 10) / 10;
}

/** How well a player fits a slot: rating in that role minus a penalty for playing out of position. */
export function slotFit(attrs: Attributes, natural: Role, slot: Role): number {
  return overall(attrs, slot) - roleDistance(natural, slot) * 1.2;
}
