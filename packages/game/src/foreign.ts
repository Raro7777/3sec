/**
 * 외국인 선수 규정: a club may hold FOREIGN_QUOTA foreign players and field FOREIGN_ON_PITCH at once,
 * as the K League does. Foreign players come from the continental field (continental.ts) at a premium,
 * and its clubs come shopping for Korean stars in return (story.ts, overseasBid).
 */
import type { Club, SquadPlayer } from "./types";

/** Ids from here up belong to clubs abroad (continental.ts); the K League quota below does not bind them. */
export const FOREIGN_ID_BASE = 100;
export const quotaBound = (club: Pick<Club, "id">): boolean => club.id < FOREIGN_ID_BASE;

export const FOREIGN_QUOTA = 4;
export const FOREIGN_ON_PITCH = 3;
/** A club abroad wants more than the domestic price: agents, flights, the risk of a flop. */
export const FOREIGN_PREMIUM = 1.3;

export const isForeignPlayer = (p: Pick<SquadPlayer, "nat">): boolean => !!p.nat && p.nat !== "한국";
export const foreignCount = (club: Pick<Club, "squad">): number => club.squad.filter(isForeignPlayer).length;
export const foreignStarters = (club: Pick<Club, "squad" | "selection">): number =>
  club.selection.starters.filter((id) => { const p = club.squad.find((q) => q.id === id); return !!p && isForeignPlayer(p); }).length;
