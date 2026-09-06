import type { Club, GameState, SquadPlayer } from "./types";
import { playerValue, MIN_SQUAD, releaseToMarket } from "./transfers";
import { clubOf } from "./season";
import { autoSelect, repairSelection } from "./selection";
import { staffWageBill } from "./staff";
import { revenueFactor } from "./divisions";

/** Salary per season (억원) a player of this value expects. */
export function wageFor(p: SquadPlayer): number {
  return Math.max(0.3, Math.round(playerValue(p) * 0.05 * 10) / 10);
}

/** Season wage bill; a player away on loan costs his club only half (the borrowing club pays the rest). */
export const wageBill = (club: Club): number => Math.round(club.squad.reduce((s, p) => s + p.wage * (p.onLoan ? 0.5 : 1), 0) * 10) / 10;

/** The half-wages a club owes for players it has borrowed on loan-out deals (the player stays in the lender's squad). */
export function loanWageBill(s: GameState, club: Club): number {
  let sum = 0;
  for (const l of s.loans) {
    if (l.to !== club.id) continue;
    const p = clubOf(s, l.from).squad.find((q) => q.id === l.playerId);
    if (p?.onLoan) sum += p.wage * 0.5;
  }
  return Math.round(sum * 10) / 10;
}

/** The user's players whose contracts end with the current season. */
export function expiringContracts(s: GameState): SquadPlayer[] {
  const me = clubOf(s, s.userClub);
  return me.squad.filter((p) => p.contractUntil <= s.season).sort((a, b) => b.wage - a.wage);
}

/** Signing-on fee for a renewal; the new wage follows the player's current value. */
export function renewalTerms(p: SquadPlayer, years: number): { fee: number; wage: number; until: (season: number) => number } {
  const wage = Math.round(wageFor(p) * (1.05 + 0.05 * years) * 10) / 10;
  const fee = Math.max(1, Math.round(playerValue(p) * 0.05 * years));
  return { fee, wage, until: (season) => season + years };
}

export function renewContract(s: GameState, playerId: string, years: 1 | 2 | 3): string | null {
  const me = clubOf(s, s.userClub);
  const p = me.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  const terms = renewalTerms(p, years);
  if (me.budget < terms.fee) return `계약금 부족 (필요 ${terms.fee}억, 보유 ${me.budget}억)`;
  me.budget = Math.round((me.budget - terms.fee) * 10) / 10;
  p.wage = terms.wage;
  p.contractUntil = Math.max(p.contractUntil, s.season) + years;
  s.news.unshift(`${me.shortName}: ${p.name} ${years}년 재계약 (연봉 ${terms.wage}억, 계약금 ${terms.fee}억).`);
  return null;
}

/**
 * Weekly fixed income (broadcasting, sponsors, merchandise) in 억원: reputation-driven, with a small league-position
 * bonus. Gate receipts come on top, per home match, from fans.ts (recordAttendance) — together they land where the
 * old flat figure was (≈2.0–2.3억/week for a top club, ≈1.5억 for a mid club).
 */
export function weeklyRevenue(club: Club, position: number | null): number {
  const base = 0.5 + Math.max(0, club.reputation - 10) * 0.25;
  const pos = position === null ? 0 : Math.max(0, 12 - position) * 0.03;
  // the league's money follows the division (divisions.ts); the gate follows the crowd and is booked apart
  return Math.round((base + pos) * revenueFactor(club) * 100) / 100;
}

/** Every club banks its weekly fixed income and pays a week of wages (players, loanees and coaching staff); a poor club can slide into the red, which blocks buying. */
export function payWages(s: GameState, weeksPerSeason: number, positions?: Map<number, number>): void {
  for (const c of s.clubs) {
    const income = weeklyRevenue(c, positions?.get(c.id) ?? null);
    const wages = (wageBill(c) + loanWageBill(s, c)) / weeksPerSeason;
    const staff = staffWageBill(c) / weeksPerSeason;
    c.budget = Math.round((c.budget + income - wages - staff) * 10) / 10;
    c.seasonWages = Math.round(((c.seasonWages ?? 0) + wages) * 100) / 100;
    // booked apart so the player wage counter keeps its meaning; financeSummary should add the two (see staff.ts TODO)
    c.seasonStaffWages = Math.round(((c.seasonStaffWages ?? 0) + staff) * 100) / 100;
    c.seasonRevenue = Math.round(((c.seasonRevenue ?? 0) + income) * 100) / 100;
  }
}

/**
 * Season rollover: AI clubs renew anyone still useful and release veterans to the free-agent pool; the
 * user's expired players become free agents too unless they were renewed — the squad never drops
 * below the minimum, though: the last few are renewed automatically at full price.
 */
/** A club must keep at least this many goalkeepers under contract, or the season cannot be selected. */
export const MIN_GK = 2;
const staying = (c: Club, newSeason: number, leaving: (p: SquadPlayer) => boolean, role: string): number => c.squad.filter((p) => p.role === role && !leaving(p)).length;

export function settleContracts(s: GameState, newSeason: number, rng: { next(): number }): void {
  for (const c of s.clubs) {
    if (c.id === s.userClub) continue;
    // a youth-minded manager keeps his youngsters on long deals and lets veterans go unless they start
    const youthMgr = (c.manager?.traits.youth ?? 0.5) > 0.6;
    for (const p of c.squad) {
      if (p.contractUntil >= newSeason) continue;
      const keep = p.age <= 31 || (youthMgr ? c.selection.starters.includes(p.id) : rng.next() < 0.4)
        || (p.role === "GK" && staying(c, newSeason, (q) => q.contractUntil < newSeason || q.contractUntil === -1, "GK") < MIN_GK);
      if (keep) {
        const years = p.age <= 24 ? 3 : p.age <= 29 ? 2 : 1;
        p.contractUntil = newSeason - 1 + years;
        p.wage = renewalTerms(p, years).wage;
      } else {
        p.contractUntil = -1; // released below
      }
    }
    for (const p of [...c.squad]) {
      if (p.contractUntil !== -1) continue;
      if (c.squad.length <= MIN_SQUAD) { p.contractUntil = newSeason; p.wage = wageFor(p); continue; }
      c.squad = c.squad.filter((q) => q !== p);
      releaseToMarket(s, p, newSeason);
    }
    c.selection = autoSelect(c, c.selection.formation);
  }
  const me = clubOf(s, s.userClub);
  const leaving = me.squad.filter((p) => p.contractUntil < newSeason);
  for (const p of leaving) {
    // never let the last goalkeepers walk: the board renews one for a year
    const gkShort = p.role === "GK" && staying(me, newSeason, (q) => q.contractUntil < newSeason, "GK") < MIN_GK;
    if (me.squad.length <= MIN_SQUAD || gkShort) {
      const t = renewalTerms(p, 1);
      me.budget = Math.round((me.budget - t.fee) * 10) / 10;
      p.wage = t.wage;
      p.contractUntil = newSeason;
      s.news.unshift(`${me.shortName}: ${gkShort ? "골키퍼 부족으로" : "최소 인원 유지를 위해"} ${p.name} 1년 자동 재계약 (계약금 ${t.fee}억).`);
      continue;
    }
    me.squad = me.squad.filter((q) => q !== p);
    releaseToMarket(s, p, newSeason);
    s.news.unshift(`${me.shortName}: ${p.name} 계약 만료로 팀을 떠남 (자유계약 시장).`);
  }
  me.selection = repairSelection(me);
}
