import type { Club, GameState, SquadPlayer } from "./types";
import { playerValue, MIN_SQUAD } from "./transfers";
import { clubOf, playerOf } from "./season";
import { autoSelect, repairSelection } from "./selection";

/** Salary per season (억원) a player of this value expects. */
export function wageFor(p: SquadPlayer): number {
  return Math.max(0.3, Math.round(playerValue(p) * 0.08 * 10) / 10);
}

export const wageBill = (club: Club): number => Math.round(club.squad.reduce((s, p) => s + p.wage, 0) * 10) / 10;

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

/** Every club pays a week of wages; a poor club can slide into the red, which blocks buying. */
export function payWages(s: GameState, weeksPerSeason: number): void {
  for (const c of s.clubs) c.budget = Math.round((c.budget - wageBill(c) / weeksPerSeason) * 10) / 10;
}

/**
 * Season rollover: AI clubs renew anyone still useful and let veterans go; the user's expired
 * players leave (to the richest AI club) unless they were renewed — the squad never drops
 * below the minimum, though: the last few are renewed automatically at full price.
 */
export function settleContracts(s: GameState, newSeason: number, rng: { next(): number }): void {
  for (const c of s.clubs) {
    if (c.id === s.userClub) continue;
    for (const p of c.squad) {
      if (p.contractUntil >= newSeason) continue;
      if (p.age <= 31 || rng.next() < 0.4) {
        const years = p.age <= 24 ? 3 : p.age <= 29 ? 2 : 1;
        p.contractUntil = newSeason - 1 + years;
        p.wage = renewalTerms(p, years).wage;
      } else {
        p.contractUntil = -1; // released below
      }
    }
    c.squad = c.squad.filter((p) => p.contractUntil !== -1 || c.squad.length <= MIN_SQUAD);
    for (const p of c.squad) if (p.contractUntil === -1) { p.contractUntil = newSeason; p.wage = wageFor(p); }
    c.selection = autoSelect(c, c.selection.formation);
  }
  const me = clubOf(s, s.userClub);
  const leaving = me.squad.filter((p) => p.contractUntil < newSeason);
  for (const p of leaving) {
    if (me.squad.length <= MIN_SQUAD) {
      const t = renewalTerms(p, 1);
      me.budget = Math.round((me.budget - t.fee) * 10) / 10;
      p.wage = t.wage;
      p.contractUntil = newSeason;
      s.news.unshift(`${me.shortName}: 최소 인원 유지를 위해 ${p.name} 1년 자동 재계약 (계약금 ${t.fee}억).`);
      continue;
    }
    me.squad = me.squad.filter((q) => q !== p);
    const dest = [...s.clubs].filter((c) => c.id !== s.userClub).sort((a, b) => b.budget - a.budget)[0]!;
    p.contractUntil = newSeason + 1;
    p.wage = wageFor(p);
    dest.squad.push(p);
    dest.selection = autoSelect(dest, dest.selection.formation);
    s.news.unshift(`${me.shortName}: ${p.name} 계약 만료로 ${dest.shortName}(으)로 이적.`);
  }
  me.selection = repairSelection(me);
  void playerOf;
}
