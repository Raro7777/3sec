import { Match, Rng, autoRoles, normalizeTactics, type MatchOptions, type PlayerDef, type TeamDef, type TeamId } from "@3sec/engine";
import type { Club, Fixture, GameState, SeasonRecord, SquadPlayer, TableRow } from "./types";
import { buildClubs } from "./world";
import { injuryFactor, injuryDaysFactor, recoveryBonus, staffWageBill } from "./staff";
import { buildFixtures, roundsPerSeason } from "./fixtures";
import { repairSelection, autoSelect } from "./selection";
import { expireOffers, freeAgentRollover, incomingOffers, returnLoans, seasonBudget, transferWeek } from "./transfers";
import { trainWeek, ATTR_LABEL, playingTimeBonus } from "./training";
import { payWages, settleContracts, wageBill, weeklyRevenue } from "./contracts";
import { youthIntake, youthRollover, youthWeek } from "./youth";
import { cupDayDue, cupPrize, newCup } from "./cup";
import { overall } from "./rating";
import { REVIEW_FROM_ROUND, applyManagerMatchday, applyManagerPolicy, boardReview, clearUserManager, managerRollover } from "./managers";
import { pendingCupTies } from "./cup";
import { appendCareer, applyRatings, emptyStats } from "./ratings";
import { BOARD_FROM_ROUND, boardCupWin, boardRollover, boardWeek, newBoard } from "./board";

export interface RecordOptions {
  /** cup matches count for player stats and injuries only: no league bans, no yellow-card accumulation */
  competition?: "league" | "cup";
}

export const DEFAULT_MANAGER_NAME = "감독";

export function newGame(seed: number, userClub = 0, managerName: string = DEFAULT_MANAGER_NAME): GameState {
  const clubs = buildClubs(seed);
  const name = managerName.trim() || DEFAULT_MANAGER_NAME;
  const s: GameState = { version: 1, seed, season: 1, round: 0, userClub, managerName: name, clubs, fixtures: buildFixtures(clubs.length), news: [`시즌 1 시작. ${name} 감독님, ${clubs[userClub]!.name}에 오신 것을 환영합니다.`], cup: { ties: [], stage: 0 }, pendingCupDay: false, offers: [], freeAgents: [], loans: [], aiDeals: [], marketLog: [], seasonHistory: [], freeManagers: [], board: newBoard() };
  clearUserManager(s);
  newCup(s);
  for (const c of clubs) resetSeasonCounters(c);
  youthIntake(s, new Rng(seed * 29 + 3));
  incomingOffers(s, new Rng(seed * 37 + 5));
  return s;
}

/** A fresh season's books for a club: start budget, injury / wage / revenue counters. */
function resetSeasonCounters(c: Club): void {
  c.seasonStartBudget = c.budget;
  c.seasonInjuries = 0;
  c.seasonWages = 0;
  c.seasonStaffWages = 0;
  c.seasonRevenue = 0;
}

/**
 * League ban for reaching a yellow-card total: every fifth card sits the player out — one match at 5 and 10,
 * two from 15 on. 0 when the total is not a threshold.
 */
export function yellowBan(seasonYellows: number): number {
  if (seasonYellows <= 0 || seasonYellows % 5 !== 0) return 0;
  return seasonYellows >= 15 ? 2 : 1;
}

export const clubOf = (s: GameState, id: number): Club => s.clubs[id]!;
export const playerOf = (c: Club, id: string): SquadPlayer => c.squad.find((p) => p.id === id)!;
export const seasonOver = (s: GameState): boolean => s.round >= roundsPerSeason(s.clubs.length);
export const currentFixtures = (s: GameState): Fixture[] => s.fixtures.filter((f) => f.round === s.round);
export const nextUserFixture = (s: GameState): Fixture | null => currentFixtures(s).find((f) => f.home === s.userClub || f.away === s.userClub) ?? null;

/** Deterministic per-match seed so a saved game replays identically. */
export function fixtureSeed(s: GameState, f: Fixture): number {
  return (s.seed * 7919 + s.season * 104729 + f.id * 131 + 17) >>> 0;
}

/** The club each side meets on the coming matchday (league round, or the pending cup day). */
function opponents(s: GameState): Map<number, number> {
  const out = new Map<number, number>();
  const pairs: { home: number; away: number }[] = s.pendingCupDay && !seasonOver(s) ? pendingCupTies(s) : currentFixtures(s);
  for (const f of pairs) { out.set(f.home, f.away); out.set(f.away, f.home); }
  return out;
}

/**
 * Before a round: AI managers pick their formation, best XI and tactics for the opponent (a pragmatist
 * sits deeper against a bigger side); the user's selection is repaired if it became illegal.
 */
export function prepareRound(s: GameState): void {
  const opp = opponents(s);
  for (const c of s.clubs) {
    if (c.id === s.userClub) { c.selection = repairSelection(c); continue; }
    if (c.manager) { applyManagerMatchday(c, opp.has(c.id) ? clubOf(s, opp.get(c.id)!) : null); continue; }
    c.selection = autoSelect(c, c.selection.formation);
    c.tactics = { ...c.tactics, formation: c.selection.formation, roles: autoRoles(c.selection.formation, c.selection.starters.map((id) => playerOf(c, id).attrs)) };
  }
}

const strip = (p: SquadPlayer): PlayerDef => ({ id: p.id, name: p.name, number: p.number, role: p.role, attrs: p.attrs });

export function teamDef(c: Club, side: TeamId): TeamDef {
  return {
    id: side,
    name: c.name,
    shortName: c.shortName,
    color: c.color,
    players: c.selection.starters.map((id) => strip(playerOf(c, id))),
    bench: c.selection.bench.map((id) => strip(playerOf(c, id))),
    tactics: normalizeTactics({ ...c.tactics, formation: c.selection.formation, roles: c.tactics.roles ?? autoRoles(c.selection.formation, c.selection.starters.map((id) => playerOf(c, id).attrs)) }),
  };
}

/** Build the engine match for a fixture. The user's side is human-managed, all others AI. */
export function createMatch(s: GameState, f: Fixture, opts: MatchOptions = {}): Match {
  const home = clubOf(s, f.home);
  const away = clubOf(s, f.away);
  const initialFatigue: Record<string, number> = {};
  for (const c of [home, away]) for (const p of c.squad) initialFatigue[p.id] = Math.max(0, Math.min(0.6, (1 - p.condition) * 0.8));
  const aiManaged: TeamId[] = [];
  if (f.home !== s.userClub) aiManaged.push(0);
  if (f.away !== s.userClub) aiManaged.push(1);
  return new Match(teamDef(home, 0), teamDef(away, 1), { seed: fixtureSeed(s, f), aiManaged, initialFatigue, ...opts });
}

/** Write a finished match back into the season: score, scorers, player stats, cards, fatigue, injuries, bans. */
export function recordResult(s: GameState, f: Fixture, m: Match, opts: RecordOptions = {}): void {
  if (m.state.phase !== "FULL_TIME") throw new Error("match not finished");
  const cup = opts.competition === "cup";
  f.score = [m.state.score[0], m.state.score[1]];
  f.scorers = m.state.events
    .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL")
    .map((e) => `${e.minute}' ${e.playerId ? m.def(e.playerId).name : "?"}${e.type === "OWN_GOAL" ? " (OG)" : ""} (${m.teams[e.team!]!.shortName})`);
  const rng = new Rng(fixtureSeed(s, f) ^ 0x5bd1e995);
  const clubs: [Club, Club] = [clubOf(s, f.home), clubOf(s, f.away)];
  for (const side of [0, 1] as TeamId[]) {
    const c = clubs[side];
    const played = m.state.players.filter((p) => p.team === side && p.distance > 0);
    for (const ps of played) {
      const p = playerOf(c, ps.id);
      p.stats.apps++;
      const minutes = Math.round(90 * Math.min(1, ps.distance / 9000));
      p.stats.minutes += minutes;
      p.lastMinutes = (p.lastMinutes ?? 0) + minutes;
      // Match minutes are the best teacher: a youngster who played most of the game banks growth.
      if (overall(p.attrs, p.role) < p.potential) p.growth += playingTimeBonus(p.age, minutes);
      p.condition = Math.max(0.2, 1 - ps.fatigue * 0.9);
      // Injuries: roughly one per club every 2-3 matches, more likely on tired legs. Mostly short.
      const intensity = c.training.intensity === "high" ? 1.3 : c.training.intensity === "low" ? 0.85 : 1;
      if (rng.chance(0.022 * (0.6 + ps.fatigue) * intensity * injuryFactor(c))) {
        const days = Math.min(90, Math.round((3 + Math.pow(rng.next(), 2.2) * 60) * injuryDaysFactor(c)));
        p.injuryDays = days;
        c.seasonInjuries = (c.seasonInjuries ?? 0) + 1;
        s.news.unshift(`${c.shortName}: ${p.name} 부상, 약 ${days}일 결장.`);
      }
    }
    for (const e of m.state.events) {
      if (e.team !== side || !e.playerId) continue;
      const p = playerOf(c, e.playerId);
      if (e.type === "GOAL") p.stats.goals++;
      if (e.type === "INJURY" && p.injuryDays === 0) {
        const days = Math.min(90, Math.round((5 + Math.pow(rng.next(), 1.8) * 50) * injuryDaysFactor(c)));
        p.injuryDays = days;
        c.seasonInjuries = (c.seasonInjuries ?? 0) + 1;
        s.news.unshift(`${c.shortName}: ${p.name} 경기 중 부상, 약 ${days}일 결장.`);
      }
      if (e.type === "YELLOW_CARD") {
        p.stats.yellows++;
        if (cup) continue;
        p.seasonYellows++;
        const ban = yellowBan(p.seasonYellows);
        if (ban > 0) {
          p.ban = Math.max(p.ban, ban);
          s.news.unshift(`${c.shortName}: ${p.name} 경고 누적 ${p.seasonYellows}장으로 ${ban}경기 출장 정지.`);
        }
      }
      if (e.type === "RED_CARD") {
        p.stats.reds++;
        if (cup) { s.news.unshift(`${c.shortName}: ${p.name} 컵 경기 퇴장.`); continue; }
        const secondYellow = m.state.events.some((x) => x.type === "YELLOW_CARD" && x.playerId === p.id && x.t < e.t);
        p.ban = Math.max(p.ban, secondYellow ? 1 : 2);
        s.news.unshift(`${c.shortName}: ${p.name} 퇴장, ${p.ban}경기 출장 정지.`);
      }
    }
    // Suspended players who sat out this match have served one game.
    const playedIds = new Set(played.map((p) => p.id));
    if (!cup) for (const p of c.squad) if (p.ban > 0 && !playedIds.has(p.id)) p.ban--;
  }
  // Assists, match ratings, form and the man of the match.
  applyRatings(f, m, clubs);
  const [h, a] = clubs;
  // A cup win inside 90 minutes pleases the user's board (shoot-outs are settled later, in cup.ts).
  if (cup && s.board) {
    const [hg, ag] = f.score;
    if ((f.home === s.userClub && hg > ag) || (f.away === s.userClub && ag > hg)) boardCupWin(s);
  }
  s.news.unshift(`${cup ? "3sec 컵: " : ""}${h.shortName} ${f.score[0]} - ${f.score[1]} ${a.shortName}`);
  if (s.news.length > 60) s.news.length = 60;
}

/** Simulate every unplayed fixture of the current round headlessly (the user's too, if asked). */
export function simulateRound(s: GameState, opts: MatchOptions = {}, includeUser = true): void {
  prepareRound(s);
  for (const f of currentFixtures(s)) {
    if (f.score) continue;
    if (!includeUser && (f.home === s.userClub || f.away === s.userClub)) continue;
    const m = createMatch(s, f, opts);
    m.runToEnd();
    recordResult(s, f, m);
  }
}

/** Close the round once every fixture has a result: a week passes (recovery, injuries heal). */
export function advanceRound(s: GameState): boolean {
  if (currentFixtures(s).some((f) => !f.score)) return false;
  s.round++;
  const rng = new Rng(s.seed * 19 + s.season * 503 + s.round * 7);
  for (const c of s.clubs) {
    const recover = c.training.intensity === "high" ? 0.5 : c.training.intensity === "low" ? 0.7 : 0.6;
    for (const p of c.squad) {
      p.condition = Math.min(1, p.condition + recover + recoveryBonus(c));
      p.injuryDays = Math.max(0, p.injuryDays - 7);
    }
    const dev = trainWeek(c, rng);
    if (c.id === s.userClub) for (const d of dev.slice(0, 3)) s.news.unshift(`훈련: ${d.player.name} ${ATTR_LABEL[d.attr]} ${d.delta > 0 ? "+1" : "-1"}`);
  }
  payWages(s, roundsPerSeason(s.clubs.length), new Map(table(s).map((r, i) => [r.club, i + 1])));
  transferWeek(s, new Rng(s.seed * 17 + s.season * 331 + s.round * 41));
  youthWeek(s);
  if (s.round === 10) youthIntake(s, new Rng(s.seed * 29 + s.season * 449 + 11));
  // The boards judge their managers once the table has settled (the final table is judged at the rollover).
  if (s.round >= REVIEW_FROM_ROUND && !seasonOver(s)) boardReview(s, new Rng(s.seed * 43 + s.season * 719 + s.round * 53));
  // The user's own board: confidence drifts weekly, warnings and the sack follow.
  if (s.round >= BOARD_FROM_ROUND) boardWeek(s);
  if (seasonOver(s)) s.news.unshift(`시즌 ${s.season} 종료. 우승: ${clubOf(s, table(s)[0]!.club).name}.`);
  // Cup matchdays sit between league rounds 6/7, 11/12, 16/17 and 21/22.
  if (cupDayDue(s)) s.pendingCupDay = true;
  return true;
}

/** Start the next season: ages, development, fresh fixtures and stats. */
/** Budget (억원) above which the board reinvests 60% of the surplus at the rollover. */
export const BUDGET_CAP = 120;

export function startNextSeason(s: GameState): void {
  if (!seasonOver(s)) throw new Error("season still running");
  const rng = new Rng(s.seed * 13 + s.season * 977);
  const finalTable = table(s);
  const userRow = finalTable.findIndex((r) => r.club === s.userClub);
  const record: SeasonRecord = { season: s.season, champion: finalTable[0]!.club, cupWinner: s.cup.holder ?? null, userPosition: userRow + 1, userPts: finalTable[userRow]!.pts };
  const award = managerRollover(s, new Rng(s.seed * 43 + s.season * 719 + 999));
  if (award) record.managerOfYear = award;
  s.seasonHistory.push(record);
  // The user's board judges the season; every player's season goes on the CV before the counters reset.
  boardRollover(s);
  appendCareer(s);
  // Weekly income already covers running costs, so the rollover only pays out prize money.
  for (const c of s.clubs) c.budget += seasonBudget(c.reputation, finalTable.findIndex((r) => r.club === c.id) + 1) - seasonBudget(c.reputation, null);
  // Money that just sits in the bank goes into the club instead: the board reinvests most of any surplus above
  // BUDGET_CAP in infrastructure, which nudges reputation (and with it income and expectations) upward.
  for (const c of s.clubs) {
    if (c.budget <= BUDGET_CAP) continue;
    const invest = Math.round((c.budget - BUDGET_CAP) * 0.6 * 10) / 10;
    c.budget = Math.round((c.budget - invest) * 10) / 10;
    const rep = Math.min(0.2, invest / 150);
    c.reputation = Math.round(Math.min(15, c.reputation + rep) * 10) / 10;
    if (c.id === s.userClub) s.news.unshift(`${c.shortName}: 이사회가 잉여 예산 ${invest}억을 구단 인프라에 투자했습니다 (평판 +${rep.toFixed(1)}). 남는 돈은 선수단에 쓰길 기대합니다.`);
  }
  // With the new budgets known, every AI manager sets his training and academy for the coming season.
  for (const c of s.clubs) if (c.id !== s.userClub) applyManagerPolicy(c);
  expireOffers(s, true);
  returnLoans(s);
  settleContracts(s, s.season + 1, rng);
  freeAgentRollover(s, s.season + 1, rng);
  for (const c of s.clubs) for (const p of c.squad) {
    p.age++;
    if (p.age >= 28) p.potential = Math.min(p.potential, Math.max(1, Math.round(p.potential * 10) / 10));
    p.refusedSeason = undefined;
    p.seasonYellows = 0;
    p.ban = 0;
    p.injuryDays = 0;
    p.condition = 1;
    p.lastMinutes = 0;
    p.stats = emptyStats();
    p.form = [];
  }
  s.season++;
  s.round = 0;
  s.fixtures = buildFixtures(s.clubs.length);
  s.news.unshift(`시즌 ${s.season} 시작.`);
  newCup(s);
  s.pendingCupDay = false;
  youthRollover(s, rng);
  youthIntake(s, new Rng(s.seed * 29 + s.season * 449 + 3));
  transferWeek(s, rng);
  for (const c of s.clubs) resetSeasonCounters(c);
  prepareRound(s);
}

export interface HomeAwayRecord { home: { won: number; drawn: number; lost: number }; away: { won: number; drawn: number; lost: number } }

/** A club's league record split by venue. */
export function homeAwayRecord(s: GameState, clubId: number): HomeAwayRecord {
  const out: HomeAwayRecord = { home: { won: 0, drawn: 0, lost: 0 }, away: { won: 0, drawn: 0, lost: 0 } };
  for (const f of s.fixtures) {
    if (!f.score || (f.home !== clubId && f.away !== clubId)) continue;
    const atHome = f.home === clubId;
    const [gf, ga] = atHome ? f.score : [f.score[1], f.score[0]];
    const rec = atHome ? out.home : out.away;
    if (gf > ga) rec.won++; else if (gf < ga) rec.lost++; else rec.drawn++;
  }
  return out;
}

export interface FinanceSummary {
  start: number;
  end: number;
  /** wages paid this season (the running counter, or the season bill for saves without one) */
  wages: number;
  /** income banked this season (the running counter, or weekly revenue × rounds for saves without one) */
  revenue: number;
  cupPrize: number;
  /** league prize money due at the rollover for the current position */
  leaguePrize: number;
}

/** The season's money story for the review screen. */
export function financeSummary(s: GameState, clubId: number): FinanceSummary {
  const c = clubOf(s, clubId);
  const rows = table(s);
  const pos = rows.findIndex((r) => r.club === clubId) + 1;
  const rounds = roundsPerSeason(s.clubs.length);
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return {
    start: c.seasonStartBudget,
    end: c.budget,
    wages: c.seasonWages ? r1(c.seasonWages + (c.seasonStaffWages ?? 0)) : wageBill(c) + staffWageBill(c),
    revenue: c.seasonRevenue ? r1(c.seasonRevenue) : r1(weeklyRevenue(c, pos) * rounds),
    cupPrize: cupPrize(s, clubId),
    leaguePrize: seasonBudget(c.reputation, pos) - seasonBudget(c.reputation, null),
  };
}

export function table(s: GameState): TableRow[] {
  const rows: TableRow[] = s.clubs.map((c) => ({ club: c.id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }));
  for (const f of s.fixtures) {
    if (!f.score) continue;
    const h = rows[f.home]!, a = rows[f.away]!;
    const [hg, ag] = f.score;
    h.played++; a.played++;
    h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.won++; a.lost++; h.pts += 3; }
    else if (hg < ag) { a.won++; h.lost++; a.pts += 3; }
    else { h.drawn++; a.drawn++; h.pts++; a.pts++; }
  }
  return rows.sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || s.clubs[x.club]!.name.localeCompare(s.clubs[y.club]!.name));
}

export function topScorers(s: GameState, n = 10): { player: SquadPlayer; club: Club }[] {
  const all: { player: SquadPlayer; club: Club }[] = [];
  for (const club of s.clubs) for (const player of club.squad) if (player.stats.goals > 0) all.push({ player, club });
  return all.sort((a, b) => b.player.stats.goals - a.player.stats.goals || b.player.stats.apps - a.player.stats.apps).slice(0, n);
}

/**
 * Has the league title been decided already? Returns the champion's club id when no other club
 * can still catch the leader, or null.
 */
export function titleClinched(s: GameState): number | null {
  const rows = table(s);
  const lead = rows[0]!, second = rows[1]!;
  const remaining = roundsPerSeason(s.clubs.length) - Math.min(lead.played, roundsPerSeason(s.clubs.length));
  if (lead.played === 0) return null;
  return lead.pts - second.pts > remaining * 3 ? lead.club : null;
}
