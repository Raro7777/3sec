/**
 * 구단 생존: what being in the red does to the user's club, week by week. The budget can go negative
 * (payWages); from RED_ARREARS_WEEKS consecutive weeks in the red the wages are late and the squad's
 * morale bleeds ARREARS_MORALE a week; the story events wageArrears, boardSellDemand, fanFunding and
 * cityGrant (story.ts) grow out of that state. An emergency loan from the owner (takeEmergencyLoan) is
 * repaid weekly with interest over LOAN_WEEKS, which is its own trap.
 *
 * Hooks: `financeWeek` from advanceRound after payWages; `financeRollover` from startNextSeason.
 */
import type { Club, GameState } from "./types";
import { clubOf } from "./season";
import { adjustSquadMorale } from "./morale";

/** From this many consecutive weeks in the red the players' wages are late. */
export const RED_ARREARS_WEEKS = 3;
/** Squad morale lost every week the wages are late. */
export const ARREARS_MORALE = -2;
/** The owner's emergency loan: repaid over this many rounds, at this interest. */
export const LOAN_WEEKS = 20;
export const LOAN_INTEREST = 0.15;

const round1 = (x: number): number => Math.round(x * 10) / 10;

export const redWeeks = (c: Club): number => c.redWeeks ?? 0;
export const inArrears = (c: Club): boolean => redWeeks(c) >= RED_ARREARS_WEEKS;

export interface FinanceStatus { redWeeks: number; arrears: boolean; loan: { remaining: number; weekly: number } | null }

export function financeStatus(s: GameState): FinanceStatus {
  const me = clubOf(s, s.userClub);
  const loan = s.emergencyLoan && s.emergencyLoan.remaining > 0 ? { remaining: s.emergencyLoan.remaining, weekly: s.emergencyLoan.weekly } : null;
  return { redWeeks: redWeeks(me), arrears: inArrears(me), loan };
}

/** The owner lends `amount`; the club owes it back with interest, a slice every round. */
export function takeEmergencyLoan(s: GameState, amount: number): void {
  const me = clubOf(s, s.userClub);
  const owed = round1(amount * (1 + LOAN_INTEREST)) + (s.emergencyLoan?.remaining ?? 0);
  me.budget = round1(me.budget + amount);
  s.emergencyLoan = { remaining: round1(owed), weekly: round1(Math.max(0.1, owed / LOAN_WEEKS)), season: s.season };
}

/** A week of the user's finances: the red-weeks counter, late wages, the loan instalment. */
export function financeWeek(s: GameState): void {
  const me = clubOf(s, s.userClub);
  const loan = s.emergencyLoan;
  if (loan && loan.remaining > 0) {
    const pay = Math.min(loan.weekly, loan.remaining);
    me.budget = round1(me.budget - pay);
    loan.remaining = round1(loan.remaining - pay);
    if (loan.remaining <= 0) { loan.remaining = 0; s.news.unshift("구단주 긴급 대출을 모두 갚았습니다."); }
  }
  if (me.budget < 0) {
    me.redWeeks = redWeeks(me) + 1;
    if (me.redWeeks === RED_ARREARS_WEEKS) s.news.unshift(`재정: ${RED_ARREARS_WEEKS}주째 적자입니다. 이번 주 급여가 밀렸습니다 — 흑자로 돌아설 때까지 매주 선수단 사기가 떨어집니다.`);
    if (inArrears(me)) adjustSquadMorale(me, ARREARS_MORALE);
  } else if (redWeeks(me) > 0) {
    if (inArrears(me)) s.news.unshift("재정: 밀린 급여를 모두 지급했습니다. 라커룸이 한숨 돌립니다.");
    me.redWeeks = 0;
  }
}

/** The counter carries across the rollover only if the club is still in the red. */
export function financeRollover(s: GameState): void {
  const me = clubOf(s, s.userClub);
  if (me.budget >= 0) me.redWeeks = 0;
}
