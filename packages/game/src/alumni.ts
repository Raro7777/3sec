/**
 * 떠난 선수들: the user's players sold abroad (story.ts overseasBid) are remembered here, since the foreign
 * squads are rebuilt each season and would forget them. Two seasons on, a former youth product or club star
 * may ask to come home (story.ts prodigalReturn) — older, cheaper, and loved by the crowd.
 */
import type { GameState, SquadPlayer } from "./types";
import { overall } from "./rating";
import { playerValue } from "./transfers";

/** Seasons abroad before the man thinks of home. */
export const RETURN_AFTER = 2;
/** The homecoming fee as a share of value; a returning son does not haggle. */
export const RETURN_FEE_SHARE = 0.6;
export const ALUMNI_MAX = 12;

export interface Alumnus { player: SquadPlayer; season: number; toClub: number; toName: string; /** apps for the user's club before leaving */ apps: number }

/** Remember a departure worth a story: a youth product, or a man with a real history at the club. */
export function noteDeparture(s: GameState, p: SquadPlayer, toClub: number, toName: string, myClub: number): void {
  const apps = p.stats.apps + (p.career ?? []).filter((e) => e.club === myClub).reduce((n, e) => n + e.apps, 0);
  if (!p.youthProduct && apps < 40) return;
  const snapshot = JSON.parse(JSON.stringify(p)) as SquadPlayer;
  (s.alumni ??= []).unshift({ player: snapshot, season: s.season, toClub, toName, apps });
  if (s.alumni.length > ALUMNI_MAX) s.alumni.length = ALUMNI_MAX;
}

/** The alumni who have been away long enough to come home this window. */
export const returnable = (s: GameState): Alumnus[] => (s.alumni ?? []).filter((a) => s.season - a.season >= RETURN_AFTER);

/** The player as he would arrive now: older, and past thirty a little slower. */
export function returningPlayer(s: GameState, a: Alumnus): SquadPlayer {
  const p = JSON.parse(JSON.stringify(a.player)) as SquadPlayer;
  const years = s.season - a.season;
  p.age += years;
  const step = p.age >= 33 ? -0.5 : p.age >= 30 ? -0.25 : overall(p.attrs, p.role) < p.potential ? 0.25 : 0;
  if (step) for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = Math.max(1, Math.min(20, Math.round((p.attrs[k] + step * years) * 10) / 10));
  p.stats = { ...p.stats, apps: 0, goals: 0, assists: 0 };
  p.form = [];
  p.condition = 1; p.injuryDays = 0; p.ban = 0; p.onLoan = undefined; p.loanFrom = undefined; p.transferRequest = undefined; p.refusedSeason = undefined;
  p.morale = 70;
  p.contractUntil = s.season + (p.age >= 32 ? 1 : 2);
  p.wage = Math.max(0.3, Math.round(p.wage * 0.8 * 10) / 10);
  return p;
}

export const returnFee = (p: SquadPlayer): number => Math.max(1, Math.round(playerValue(p) * RETURN_FEE_SHARE));

export function forgetAlumnus(s: GameState, playerId: string): void {
  if (s.alumni) s.alumni = s.alumni.filter((a) => a.player.id !== playerId);
}

/** Nobody waits forever: an alumnus not brought home within three seasons of eligibility is forgotten. */
export function alumniRollover(s: GameState): void {
  if (s.alumni) s.alumni = s.alumni.filter((a) => s.season - a.season <= RETURN_AFTER + 3);
}
