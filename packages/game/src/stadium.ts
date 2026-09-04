/**
 * 홈구장 확장: the user's club can buy seats. A ground grows in EXPANSION_STEP blocks, at most one purchase per
 * season, up to EXPANSION_MAX_SHARE more than the seats it started with; the builders finish over the summer, so
 * the seats open at the next season rollover (`applyExpansion` from startNextSeason). Attendance is capped by
 * capacity (fans.ts), so seats only pay when the ground sells out — `expansionAdvice` puts that in numbers.
 */
import type { Club, GameState } from "./types";
import { clubOf } from "./season";
import { avgHomeAttendance, clubCapacity, ticketPrice } from "./fans";
import { CLUBS_PER_DIVISION } from "./divisions";

/** Seats per block. */
export const EXPANSION_STEP = 1000;
/** Cost of one block in 억원: EXPANSION_COST_BASE + EXPANSION_COST_PER_REP × (reputation − 10). */
export const EXPANSION_COST_BASE = 3;
export const EXPANSION_COST_PER_REP = 0.5;
/** A ground can grow to this share above its original seats. */
export const EXPANSION_MAX_SHARE = 0.5;
/** Share of the new seats that fill on a matchday that would have sold out (demand beyond the roof is unseen). */
export const EXPANSION_FILL = 0.8;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;
const fmt = (n: number): string => n.toLocaleString("ko-KR");

/** Seats the ground had before any expansion. */
export const baseCapacity = (c: Club): number => c.baseCapacity ?? clubCapacity(c);

/** Price of one EXPANSION_STEP block for a club of this reputation (억원). */
export const expansionCostPer1000 = (reputation: number): number => round1(EXPANSION_COST_BASE + EXPANSION_COST_PER_REP * clamp(reputation - 10, 0, 10));

/** Price of `seats` seats (억원). */
export const expansionCost = (c: Club, seats: number): number => round1((seats / EXPANSION_STEP) * expansionCostPer1000(c.reputation));

/** Seats still allowed: the ceiling minus what the club has and has already ordered, in whole blocks. */
export function maxExpansion(c: Club): number {
  const ceiling = Math.floor((baseCapacity(c) * (1 + EXPANSION_MAX_SHARE)) / EXPANSION_STEP) * EXPANSION_STEP;
  return Math.max(0, ceiling - clubCapacity(c) - (c.pendingSeats ?? 0));
}

/** Why the user cannot buy `seats` now (null when the purchase is fine). */
export function expansionProblem(s: GameState, seats: number): string | null {
  const c = clubOf(s, s.userClub);
  if (!Number.isInteger(seats) || seats <= 0 || seats % EXPANSION_STEP !== 0) return `${fmt(EXPANSION_STEP)}석 단위로만 확장할 수 있습니다.`;
  if (c.expansionSeason === s.season) return "이번 시즌에는 이미 확장 공사를 계약했습니다. 시즌마다 한 번만 가능합니다.";
  const max = maxExpansion(c);
  if (max <= 0) return `더 이상 확장할 수 없습니다 (원래 좌석의 ${Math.round(EXPANSION_MAX_SHARE * 100)}%까지).`;
  if (seats > max) return `이번에는 최대 ${fmt(max)}석까지만 늘릴 수 있습니다.`;
  const cost = expansionCost(c, seats);
  if (c.budget < cost) return `예산이 부족합니다 (필요 ${cost}억, 보유 ${c.budget}억).`;
  return null;
}

/** Buy `seats` seats for the user's club: the budget pays now, the seats open at the next season rollover. */
export function expandStadium(s: GameState, seats: number): string | null {
  const err = expansionProblem(s, seats);
  if (err) return err;
  const c = clubOf(s, s.userClub);
  const cost = expansionCost(c, seats);
  if (c.baseCapacity === undefined) c.baseCapacity = clubCapacity(c);
  c.budget = round1(c.budget - cost);
  c.pendingSeats = (c.pendingSeats ?? 0) + seats;
  c.expansionSeason = s.season;
  s.news.unshift(`🏗 ${c.shortName}: 홈구장 확장 공사 착공 (+${fmt(seats)}석, ${cost}억). 다음 시즌부터 ${fmt(clubCapacity(c) + c.pendingSeats)}석이 됩니다.`);
  return null;
}

/** Season rollover: ordered seats open (called by startNextSeason once `s.season` has moved on). */
export function applyExpansion(s: GameState, c: Club): void {
  const seats = c.pendingSeats ?? 0;
  if (seats <= 0) { c.pendingSeats = undefined; return; }
  if (c.baseCapacity === undefined) c.baseCapacity = clubCapacity(c);
  c.capacity = clubCapacity(c) + seats;
  c.pendingSeats = undefined;
  s.news.unshift(`🏟 ${c.shortName} 구장 확장 완료: +${fmt(seats)}석, 이제 ${fmt(c.capacity)}석입니다.`);
}

/** Home matches this season whose crowd reached the roof (league and cup). */
export function seasonSellouts(s: GameState, clubId: number): number {
  const c = clubOf(s, clubId);
  const cap = clubCapacity(c);
  let n = 0;
  for (const f of s.fixtures) if (f.home === clubId && f.attendance !== undefined && f.attendance >= cap) n++;
  for (const t of s.cup?.ties ?? []) if (t.home === clubId && t.attendance !== undefined && t.attendance >= cap) n++;
  return n;
}

export interface ExpansionAdvice {
  capacity: number;
  baseCapacity: number;
  /** seats already ordered for next season */
  pendingSeats: number;
  /** seats still allowed */
  maxSeats: number;
  costPer1000: number;
  /** the purchase the advice is for */
  seats: number;
  cost: number;
  /** average home crowd this season as a share of the seats (0 before the first home match) */
  occupancy: number;
  avgAttendance: number;
  homeMatches: number;
  sellouts: number;
  /** home matches a season the projection assumes (league + a cup tie) */
  seasonHomeMatches: number;
  /** extra gate a season the new seats should bring, at this season's sellout rate (억원) */
  extraGate: number;
  /** seasons until the seats have paid for themselves (Infinity when they never fill) */
  paybackSeasons: number;
  /** the club already expanded this season */
  expandedThisSeason: boolean;
  /** why the purchase is impossible right now (null = allowed) */
  problem: string | null;
}

/**
 * Numbers for the expansion screen: this season's occupancy and sellouts, and what `seats` more would cost and
 * earn. New seats sell only on days the ground would have sold out, and EXPANSION_FILL of them at that; the
 * projection scales this season's sellout rate to a full season.
 */
export function expansionAdvice(s: GameState, seats = EXPANSION_STEP): ExpansionAdvice {
  const c = clubOf(s, s.userClub);
  const capacity = clubCapacity(c);
  const homeMatches = c.fans?.seasonHome ?? 0;
  const avgAttendance = c.fans ? avgHomeAttendance(c) : 0;
  const sellouts = seasonSellouts(s, c.id);
  // one home game against each of the division's other clubs, plus a cup tie
  const seasonHomeMatches = CLUBS_PER_DIVISION - 1 + 1;
  const selloutRate = homeMatches ? sellouts / homeMatches : 0;
  const cost = expansionCost(c, seats);
  const extraGate = round1((seats * EXPANSION_FILL * selloutRate * seasonHomeMatches * ticketPrice(c.reputation)) / 1e8);
  return {
    capacity,
    baseCapacity: baseCapacity(c),
    pendingSeats: c.pendingSeats ?? 0,
    maxSeats: maxExpansion(c),
    costPer1000: expansionCostPer1000(c.reputation),
    seats,
    cost,
    occupancy: capacity ? avgAttendance / capacity : 0,
    avgAttendance,
    homeMatches,
    sellouts,
    seasonHomeMatches,
    extraGate,
    paybackSeasons: extraGate > 0 ? round1(cost / extraGate) : Infinity,
    expandedThisSeason: c.expansionSeason === s.season,
    problem: expansionProblem(s, seats),
  };
}
