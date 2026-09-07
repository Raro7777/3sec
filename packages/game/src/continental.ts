/**
 * 동아시아 챔피언스리그: the stage above the league for the top flight's best three.
 *
 * Sixteen clubs: three Korean qualifiers (last season's first-division top three; season 1 the three
 * best by reputation) and thirteen fictional clubs from Japan, China, Australia and South-East Asia that
 * live in `s.foreign` (ids from FOREIGN_ID_BASE, never in `s.clubs`, so nothing league-side sees them).
 * Four groups of four play a single round-robin over three midweeks, the top two go to a single-leg
 * quarter-final, semi-final and final. The ties reuse `CupTie` and the cup's engine glue.
 */
import { Rng, type Match, type FormationName } from "@3sec/engine";
import type { Club, Continental, CupTie, Fixture, GameState } from "./types";
import { buildSquad } from "./world";
import { autoSelect } from "./selection";
import { seasonBudget } from "./transfers";
import { wageFor } from "./contracts";
import { generateManager, managerTraining } from "./managers";
import { newFans, fansCupResult } from "./fans";
import { ensureCaptain, lockerRoom } from "./morale";
import { defaultTactics } from "@3sec/engine";
import { clubOf, createMatch, fixtureSeed, prepareRound, recordResult, seasonOver, type GameMatchOptions } from "./season";
import { clubsIn, divisionTable } from "./divisions";
import { penaltyShootout, tieWinner } from "./cup";
import { boardCupWin } from "./board";
import { applyStaffRecovery } from "./staff";
import type { Nationality } from "./names";
import { FOREIGN_ID_BASE } from "./foreign";

export const CL_NAME = "동아시아 챔피언스리그";
export const CL_SHORT = "동아시아 CL";
/** Matchdays: before league round index r when the season reaches it → stage. Never on a cup day (6/11/16/21). */
export const CL_ROUNDS = [3, 8, 13, 17, 19, 20] as const;
export const CL_STAGES = 6;
export const CL_STAGE_LABEL = ["조별리그 1차전", "조별리그 2차전", "조별리그 3차전", "8강", "4강", "결승"] as const;
export const CL_GROUP_STAGES = 3;
export const CL_KR_SLOTS = 3;
export { FOREIGN_ID_BASE };
/** Prize money (억원): per group win / draw, then by how far a club went. Bigger than the league title, which is the point. */
export const CL_PRIZE = { groupWin: 5, groupDraw: 2, qfLoser: 15, sfLoser: 25, runnerUp: 40, winner: 80 } as const;
/** Reputation the winner and the runner-up carry home. */
export const CL_REP = { winner: 0.3, runnerUp: 0.15 } as const;

export interface ForeignDef { name: string; shortName: string; color: string; country: Nationality; reputation: number; formation: FormationName; capacity: number }
/** Thirteen fictional clubs. Reputation runs 12.4-15.6 against the top flight's 10.5-14: the best of them are better than anything at home. */
export const FOREIGN_DEFS: ForeignDef[] = [
  { name: "도쿄 이글스", shortName: "도쿄", color: "#d62828", country: "일본", reputation: 15.6, formation: "4-2-3-1", capacity: 62000 },
  { name: "오사카 스톰", shortName: "오사카", color: "#1d4ed8", country: "일본", reputation: 14.9, formation: "4-3-3", capacity: 48000 },
  { name: "요코하마 하버", shortName: "요코하마", color: "#0ea5e9", country: "일본", reputation: 14.4, formation: "4-4-2", capacity: 70000 },
  { name: "삿포로 스노우", shortName: "삿포로", color: "#e5e7eb", country: "일본", reputation: 13.1, formation: "3-5-2", capacity: 38000 },
  { name: "후쿠오카 웨이브", shortName: "후쿠오카", color: "#0f766e", country: "일본", reputation: 12.6, formation: "4-4-2", capacity: 21000 },
  { name: "상하이 드래곤", shortName: "상하이", color: "#b91c1c", country: "중국", reputation: 15.0, formation: "4-3-3", capacity: 56000 },
  { name: "베이징 그레이트월", shortName: "베이징", color: "#16a34a", country: "중국", reputation: 14.2, formation: "4-2-3-1", capacity: 66000 },
  { name: "광저우 타이거", shortName: "광저우", color: "#f59e0b", country: "중국", reputation: 13.6, formation: "4-4-2", capacity: 58000 },
  { name: "청두 판다", shortName: "청두", color: "#7c3aed", country: "중국", reputation: 12.4, formation: "3-5-2", capacity: 40000 },
  { name: "시드니 서퍼스", shortName: "시드니", color: "#38bdf8", country: "호주", reputation: 13.8, formation: "4-3-3", capacity: 42000 },
  { name: "멜버른 킹스", shortName: "멜버른", color: "#1e3a8a", country: "호주", reputation: 13.3, formation: "4-2-3-1", capacity: 30000 },
  { name: "방콕 엘리펀츠", shortName: "방콕", color: "#eab308", country: "태국", reputation: 12.8, formation: "4-4-2", capacity: 25000 },
  { name: "호치민 로터스", shortName: "호치민", color: "#dc2626", country: "베트남", reputation: 12.5, formation: "4-3-3", capacity: 25000 },
];

/** Full Club objects for the foreign field, ids from FOREIGN_ID_BASE, `division` 0 so no division code claims them. */
export function buildForeignClubs(seed: number): Club[] {
  return FOREIGN_DEFS.map((d, i) => {
    const id = FOREIGN_ID_BASE + i;
    const rng = new Rng((seed * 53 + id * 2003 + 29) >>> 0);
    const club: Club = {
      id, name: d.name, shortName: d.shortName, color: d.color, reputation: d.reputation, division: 0,
      budget: seasonBudget(d.reputation, null), seasonStartBudget: seasonBudget(d.reputation, null),
      squad: buildSquad(rng, `F${id}`, d.reputation, d.country),
      tactics: { ...defaultTactics(d.formation), mentality: 0.5, pressing: 0.5, directness: 0.5 },
      selection: { formation: d.formation, starters: [], bench: [] },
      training: { focus: "balanced", intensity: "normal" },
      youth: { prospects: [], scouting: "local", coaching: 1, nextId: 1 },
      staff: [], manager: null, pressure: 0, capacity: d.capacity, fans: newFans(d.reputation, d.capacity),
      stadiumName: `${d.shortName} 스타디움`,
    };
    for (const p of club.squad) p.wage = wageFor(p);
    club.manager = generateManager(rng, 1, `MF${id}`, d.country);
    club.training = managerTraining(club.manager);
    club.selection = autoSelect(club, d.formation);
    ensureCaptain(club);
    lockerRoom(club);
    return club;
  });
}

export const isForeignId = (id: number): boolean => id >= FOREIGN_ID_BASE;
export const foreignCountry = (id: number): string => FOREIGN_DEFS[id - FOREIGN_ID_BASE]?.country ?? "";

/** The foreign field, created on first use (older saves). */
export function ensureForeign(s: GameState): Club[] {
  if (!Array.isArray(s.foreign) || s.foreign.length !== FOREIGN_DEFS.length) s.foreign = buildForeignClubs(s.seed);
  return s.foreign;
}

/** Foreign clubs are NPCs with no weekly life: before their matches they are simply fit and picked. */
export function refreshForeign(s: GameState): void {
  for (const c of ensureForeign(s)) {
    for (const p of c.squad) { p.injuryDays = 0; p.ban = 0; p.condition = 1; }
    c.selection = autoSelect(c, c.selection.formation);
  }
}

/** New squads for the foreign clubs each season: they neither age nor trade, they are just there. */
export function foreignRollover(s: GameState): void {
  for (const c of ensureForeign(s)) {
    const rng = new Rng((s.seed * 53 + c.id * 2003 + s.season * 331 + 29) >>> 0);
    c.squad = buildSquad(rng, `F${c.id}S${s.season}`, c.reputation, FOREIGN_DEFS[c.id - FOREIGN_ID_BASE]?.country ?? "한국");
    for (const p of c.squad) p.wage = wageFor(p);
    c.selection = autoSelect(c, c.selection.formation);
    ensureCaptain(c);
    lockerRoom(c);
  }
}

/** Korean entrants for the coming season: last season's top three, or the three best by reputation in season 1. */
export function continentalQualifiers(s: GameState): number[] {
  if (Array.isArray(s.clQualifiers) && s.clQualifiers.length === CL_KR_SLOTS) return s.clQualifiers;
  return clubsIn(s, 1).sort((a, b) => b.reputation - a.reputation || a.id - b.id).slice(0, CL_KR_SLOTS).map((c) => c.id);
}

const drawRng = (s: GameState, stage: number): Rng => new Rng((s.seed * 4099 + s.season * 9973 + stage * 577 + 13) >>> 0);
function shuffle<T>(arr: T[], rng: Rng): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; }

/** Round-robin of four in three matchdays; the home side alternates so nobody plays three at home. */
const GROUP_PAIRS: [number, number][][] = [[[0, 1], [2, 3]], [[2, 0], [1, 3]], [[0, 3], [3, 1].map((x) => x) as [number, number]]];

/** A fresh competition for the season: groups drawn (the Korean clubs kept apart), the three group matchdays laid out. */
export function newContinental(s: GameState): Continental {
  ensureForeign(s);
  const rng = drawRng(s, 0);
  const kr = continentalQualifiers(s);
  const foreign = shuffle(s.foreign!.map((c) => c.id), rng);
  // pots: the Korean three go one per group into groups A-C, the strongest foreign side heads group D
  const groups: number[][] = [[], [], [], []];
  kr.forEach((id, i) => groups[i]!.push(id));
  const strongest = [...s.foreign!].sort((a, b) => b.reputation - a.reputation)[0]!.id;
  groups[3]!.push(strongest);
  for (const id of foreign) { if (id === strongest) continue; const g = groups.reduce((best, grp, i) => (grp.length < groups[best]!.length ? i : best), 0); groups[g]!.push(id); }
  const entrants = groups.flat();
  const c: Continental = { season: s.season, entrants, ties: [], stage: 0 };
  let id = 0;
  for (let stage = 0; stage < CL_GROUP_STAGES; stage++) {
    for (let g = 0; g < 4; g++) {
      for (const [h, a] of GROUP_PAIRS[stage]!) {
        const pair = stage === 2 && h === 3 && a === 1 ? [1, 2] : [h, a];
        c.ties.push({ id: id++, stage, home: groups[g]![pair[0]!]!, away: groups[g]![pair[1]!]!, score: null, scorers: [] });
      }
    }
  }
  s.continental = c;
  s.pendingClDay = false;
  return c;
}

export const groupOf = (c: Continental, club: number): number => Math.floor(c.entrants.indexOf(club) / 4);
export const groupMembers = (c: Continental, g: number): number[] => c.entrants.slice(g * 4, g * 4 + 4);
export const GROUP_NAMES = ["A", "B", "C", "D"] as const;

export interface GroupRow { club: number; played: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number }
/** Standing of one group from the played group ties; ties broken by points, goal difference, goals, then draw order. */
export function groupTable(s: GameState, g: number): GroupRow[] {
  const c = s.continental!;
  const rows = new Map<number, GroupRow>(groupMembers(c, g).map((id) => [id, { club: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const t of c.ties) {
    if (t.stage >= CL_GROUP_STAGES || !t.score || !rows.has(t.home)) continue;
    const [hg, ag] = t.score; const h = rows.get(t.home)!, a = rows.get(t.away)!;
    h.played++; a.played++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    if (hg > ag) { h.won++; a.lost++; h.pts += 3; } else if (hg < ag) { a.won++; h.lost++; a.pts += 3; } else { h.drawn++; a.drawn++; h.pts++; a.pts++; }
  }
  const order = groupMembers(c, g);
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || order.indexOf(x.club) - order.indexOf(y.club));
}

export const clDone = (s: GameState): boolean => !s.continental || s.continental.stage >= CL_STAGES;
export const currentClTies = (s: GameState): CupTie[] => (s.continental ? s.continental.ties.filter((t) => t.stage === s.continental!.stage) : []);
export const pendingClTies = (s: GameState): CupTie[] => currentClTies(s).filter((t) => !t.score);
export const userClTie = (s: GameState): CupTie | null => currentClTies(s).find((t) => t.home === s.userClub || t.away === s.userClub) ?? null;
export const userEnteredCl = (s: GameState): boolean => !!s.continental && s.continental.entrants.includes(s.userClub);
/** Is the user still in it (entered, and not knocked out)? */
export function userStillInCl(s: GameState): boolean {
  const c = s.continental;
  if (!c || !c.entrants.includes(s.userClub)) return false;
  if (c.stage < CL_GROUP_STAGES) return true;
  if (c.stage >= CL_STAGES) return c.holder === s.userClub;
  return currentClTies(s).some((t) => t.home === s.userClub || t.away === s.userClub);
}
export const clDayDue = (s: GameState): boolean => !!s.continental && !clDone(s) && !seasonOver(s) && s.round >= CL_ROUNDS[s.continental.stage]!;

/** Fixture-shaped view of a tie; its own negative band so it never meets a league or cup id. */
export const clFixture = (t: CupTie): Fixture => ({ id: -(100000 + t.stage * 1000 + t.id), round: -100 - t.stage, home: t.home, away: t.away, score: null, scorers: [] });
export function createClMatch(s: GameState, t: CupTie, opts: GameMatchOptions = {}): Match {
  refreshForeign(s);
  return createMatch(s, clFixture(t), opts);
}

/** Write a finished tie back: stats via recordResult, the score, a shoot-out in the knock-outs, prize money, the next stage when the day is complete. */
export function recordClResult(s: GameState, t: CupTie, m: Match): void {
  const c = s.continental!;
  const f = clFixture(t);
  recordResult(s, f, m, { competition: "cl" });
  t.score = f.score; t.scorers = f.scorers; t.motm = f.motm; t.attendance = f.attendance;
  const home = clubOf(s, t.home), away = clubOf(s, t.away);
  const [hg, ag] = t.score!;
  if (t.stage < CL_GROUP_STAGES) {
    if (hg !== ag) (hg > ag ? home : away).budget += CL_PRIZE.groupWin;
    else { home.budget += CL_PRIZE.groupDraw; away.budget += CL_PRIZE.groupDraw; }
  } else {
    if (hg === ag) {
      t.penalties = penaltyShootout(s, t, m);
      const w = clubOf(s, tieWinner(t)!);
      if (w.id === s.userClub && s.board) boardCupWin(s);
      s.news.unshift(`${CL_SHORT} ${CL_STAGE_LABEL[t.stage]}: ${home.shortName} ${hg} - ${ag} ${away.shortName}, 승부차기 ${t.penalties[0]}-${t.penalties[1]}로 ${w.shortName} 진출.`);
    }
    const winner = clubOf(s, tieWinner(t)!);
    const loser = winner === home ? away : home;
    fansCupResult(s, winner, loser, t.stage - 2);
    if (t.stage === 3) loser.budget += CL_PRIZE.qfLoser;
    if (t.stage === 4) loser.budget += CL_PRIZE.sfLoser;
    if (t.stage === 5) {
      winner.budget += CL_PRIZE.winner; loser.budget += CL_PRIZE.runnerUp;
      winner.reputation = Math.round(Math.min(15, winner.reputation + CL_REP.winner) * 10) / 10;
      loser.reputation = Math.round(Math.min(15, loser.reputation + CL_REP.runnerUp) * 10) / 10;
      c.holder = winner.id;
      s.news.unshift(`🏆 ${CL_NAME} 우승: ${winner.name}! 상금 ${CL_PRIZE.winner}억 (준우승 ${loser.name} ${CL_PRIZE.runnerUp}억).`);
    }
  }
  for (const x of [home, away]) x.budget = Math.round(x.budget * 10) / 10;
  if (pendingClTies(s).length === 0) closeClStage(s);
}

/** Every tie of the stage is in: move on; after the groups, draw the quarter-finals (winner vs another group's runner-up). */
function closeClStage(s: GameState): void {
  const c = s.continental!;
  c.stage++;
  s.pendingClDay = false;
  if (c.stage === CL_GROUP_STAGES) {
    const tables = [0, 1, 2, 3].map((g) => groupTable(s, g));
    // A1-B2, C1-D2, B1-A2, D1-C2: the classic cross
    const pairs: [number, number][] = [[tables[0]![0]!.club, tables[1]![1]!.club], [tables[2]![0]!.club, tables[3]![1]!.club], [tables[1]![0]!.club, tables[0]![1]!.club], [tables[3]![0]!.club, tables[2]![1]!.club]];
    let id = c.ties.length;
    for (const [h, a] of pairs) c.ties.push({ id: id++, stage: 3, home: h, away: a, score: null, scorers: [] });
    if (userEnteredCl(s)) {
      const g = groupOf(c, s.userClub); const row = tables[g]!.findIndex((r) => r.club === s.userClub) + 1;
      s.news.unshift(row <= 2 ? `${CL_SHORT} 조별리그 ${GROUP_NAMES[g]}조 ${row}위로 8강 진출!` : `${CL_SHORT} 조별리그 ${GROUP_NAMES[g]}조 ${row}위, 탈락.`);
    }
  } else if (c.stage === 4 || c.stage === 5) {
    const prev = c.ties.filter((t) => t.stage === c.stage - 1);
    let id = c.ties.length;
    for (let i = 0; i + 1 < prev.length; i += 2) c.ties.push({ id: id++, stage: c.stage, home: tieWinner(prev[i]!)!, away: tieWinner(prev[i + 1]!)!, score: null, scorers: [] });
  }
  const mine = userClTie(s);
  if (mine && c.stage >= CL_GROUP_STAGES && c.stage < CL_STAGES) {
    const opp = clubOf(s, mine.home === s.userClub ? mine.away : mine.home);
    s.news.unshift(`${CL_SHORT} ${CL_STAGE_LABEL[c.stage]} 대진: ${opp.name}(${foreignCountry(opp.id) || "한국"})과(와) ${mine.home === s.userClub ? "홈" : "원정"} 경기.`);
  }
}

/** Simulate the open ties of the current stage headlessly (the user's too, if asked). */
export function simulateClDay(s: GameState, opts: GameMatchOptions = { autoUser: true }, includeUser = true): void {
  prepareRound(s);
  for (const t of pendingClTies(s)) {
    if (!includeUser && (t.home === s.userClub || t.away === s.userClub)) continue;
    const m = createClMatch(s, t, opts);
    m.runToEnd();
    recordClResult(s, t, m);
  }
}

/** Close the matchday once every tie is in: a midweek passes for everyone at home. */
export function advanceClDay(s: GameState): boolean {
  if (s.pendingClDay && pendingClTies(s).length) return false;
  for (const c of s.clubs) {
    for (const p of c.squad) { p.condition = Math.min(1, p.condition + 0.4); p.injuryDays = Math.max(0, p.injuryDays - 3); }
    applyStaffRecovery(c, 0.5);
  }
  s.pendingClDay = clDayDue(s);
  return true;
}

/** Prize money a club collected in this season's competition (for the review). */
export function clPrize(s: GameState, club: number): number {
  const c = s.continental; if (!c) return 0;
  let sum = 0;
  for (const t of c.ties) {
    if (!t.score || (t.home !== club && t.away !== club)) continue;
    const [hg, ag] = t.score; const mine = t.home === club ? hg : ag, theirs = t.home === club ? ag : hg;
    if (t.stage < CL_GROUP_STAGES) { sum += mine > theirs ? CL_PRIZE.groupWin : mine === theirs ? CL_PRIZE.groupDraw : 0; continue; }
    const won = tieWinner(t) === club;
    if (t.stage === 3 && !won) sum += CL_PRIZE.qfLoser;
    if (t.stage === 4 && !won) sum += CL_PRIZE.sfLoser;
    if (t.stage === 5) sum += won ? CL_PRIZE.winner : CL_PRIZE.runnerUp;
  }
  return sum;
}

/** A one-line summary of the user's run: "조별리그 탈락", "8강", "우승" and so on (null when not entered). */
export function userClSummary(s: GameState): string | null {
  const c = s.continental;
  if (!c || !c.entrants.includes(s.userClub)) return null;
  if (c.holder === s.userClub) return "우승";
  const last = [...c.ties].reverse().find((t) => t.score && (t.home === s.userClub || t.away === s.userClub));
  if (!last) return "조별리그";
  if (last.stage < CL_GROUP_STAGES) { if (c.stage < CL_GROUP_STAGES) return "조별리그"; const g = groupOf(c, s.userClub); const row = groupTable(s, g).findIndex((r) => r.club === s.userClub) + 1; return row <= 2 ? "8강 진출" : `조별리그 탈락 (${GROUP_NAMES[g]}조 ${row}위)`; }
  const won = tieWinner(last) === s.userClub;
  if (last.stage === 5) return won ? "우승" : "준우승";
  return won ? `${CL_STAGE_LABEL[last.stage + 1]} 진출` : `${CL_STAGE_LABEL[last.stage]} 탈락`;
}

/** The tables that decide the Korean qualifiers for next season, taken before the divisions swap. */
export function noteQualifiers(s: GameState): void {
  s.clQualifiers = divisionTable(s, 1).slice(0, CL_KR_SLOTS).map((r) => r.club);
}
