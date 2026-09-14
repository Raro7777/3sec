import type { Match } from "@3sec/engine";
import type { Club, EarnedAchievement, Fixture, GameState, Records, SeasonRecord, SquadPlayer } from "./types";
import { clubOf, seasonRounds, table, topScorers } from "./season";
import { roundsPerSeason } from "./fixtures";
import { expectedPositions } from "./managers";
import { tieWinner, CUP_NAME } from "./cup";
import { MAX_STAFF } from "./staff";

export type AchievementTier = "bronze" | "silver" | "gold";

export const TIER_LABEL: Record<AchievementTier, string> = { bronze: "동", silver: "은", gold: "금" };

/** What a check may look at: the state, the user's club, the league table and whether the season has just closed. */
export interface AchievementContext {
  s: GameState;
  me: Club;
  records: Records;
  /** the user's league row */
  row: { played: number; won: number; drawn: number; lost: number; gf: number; ga: number; pts: number };
  position: number;
  expected: number;
  rounds: number;
  /** true only at the rollover (season-long achievements are judged there) */
  seasonEnd: boolean;
}

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  tier: AchievementTier;
  check: (c: AchievementContext) => boolean;
}

/** Transfer fees the user's club banked this season (억원). */
export function seasonTransferIncome(s: GameState, season = s.season): number {
  return Math.round((s.marketLog ?? []).filter((e) => e.season === season && e.kind === "transfer" && e.from === s.userClub).reduce((a, e) => a + e.fee, 0) * 10) / 10;
}

/** League matches this season the user's side kept a clean sheet in. */
export function seasonCleanSheets(s: GameState, club = s.userClub): number {
  let n = 0;
  for (const f of s.fixtures) {
    if (!f.score || (f.home !== club && f.away !== club)) continue;
    if ((f.home === club ? f.score[1] : f.score[0]) === 0) n++;
  }
  return n;
}

/** Cup ties the user won on penalties this season. */
export const seasonShootoutWins = (s: GameState): number => (s.cup?.ties ?? []).filter((t) => t.penalties && tieWinner(t) === s.userClub).length;

const wonTitle = (r: SeasonRecord, s: GameState): boolean => r.champion === (r.userClub ?? s.userClub);
const wonCup = (r: SeasonRecord, s: GameState): boolean => r.cupWinner !== null && r.cupWinner === (r.userClub ?? s.userClub);

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_win", title: "첫 승", desc: "감독으로서 첫 승리를 거둔다.", tier: "bronze", check: (c) => c.records.wins >= 1 },
  { id: "wins_100", title: "100승", desc: "통산 100승을 달성한다 (리그 + 컵).", tier: "gold", check: (c) => c.records.wins >= 100 },
  { id: "unbeaten_5", title: "무패 5경기", desc: "5경기 연속 패하지 않는다.", tier: "bronze", check: (c) => c.records.bestUnbeaten >= 5 },
  { id: "unbeaten_10", title: "무패 10경기", desc: "10경기 연속 패하지 않는다.", tier: "silver", check: (c) => c.records.bestUnbeaten >= 10 },
  { id: "season_unbeaten", title: "시즌 무패", desc: "리그 한 시즌을 한 번도 지지 않고 마친다.", tier: "gold", check: (c) => c.seasonEnd && c.row.played >= c.rounds && c.row.lost === 0 },
  { id: "league_title", title: "리그 우승", desc: "리그 1위로 시즌을 마친다.", tier: "gold", check: (c) => c.seasonEnd && c.position === 1 },
  { id: "back_to_back", title: "2연패", desc: "리그를 두 시즌 연속 제패한다.", tier: "gold", check: (c) => c.seasonEnd && c.position === 1 && c.s.seasonHistory.some((r) => r.season === c.s.season - 1 && wonTitle(r, c.s)) },
  { id: "cup_win", title: "컵 우승", desc: `${CUP_NAME}을 들어올린다.`, tier: "silver", check: (c) => c.s.cup?.holder === c.s.userClub || c.s.seasonHistory.some((r) => wonCup(r, c.s)) },
  { id: "double", title: "더블", desc: "같은 시즌에 리그와 컵을 모두 우승한다.", tier: "gold", check: (c) => c.seasonEnd && c.position === 1 && c.s.cup?.holder === c.s.userClub },
  { id: "underdog_title", title: "언더독의 반란", desc: "이사회 기대 6위 이하인 팀으로 리그 우승을 차지한다.", tier: "gold", check: (c) => c.seasonEnd && c.position === 1 && c.expected >= 6 },
  { id: "title_no_debt", title: "적자 없는 우승", desc: "시즌 내내 예산이 한 번도 마이너스가 되지 않고 우승한다.", tier: "gold", check: (c) => c.seasonEnd && c.position === 1 && (c.s.seasonMinBudget ?? c.me.budget) >= 0 && c.me.budget >= 0 },
  { id: "youth_top_scorer", title: "유스 출신 득점왕", desc: "우리 아카데미 출신 선수가 리그 득점왕에 오른다.", tier: "gold", check: (c) => { if (!c.seasonEnd) return false; const t = topScorers(c.s, 1)[0]; return !!t && t.club.id === c.s.userClub && !!t.player.youthProduct; } },
  { id: "top_scorer", title: "득점왕 배출", desc: "우리 선수가 리그 득점왕에 오른다.", tier: "silver", check: (c) => { if (!c.seasonEnd) return false; const t = topScorers(c.s, 1)[0]; return !!t && t.club.id === c.s.userClub; } },
  { id: "goals_60", title: "시즌 60골", desc: "리그 한 시즌에 60골을 넣는다.", tier: "silver", check: (c) => c.row.gf >= 60 },
  { id: "home_perfect", title: "홈 전승", desc: "리그 홈 경기를 전부 이기고 시즌을 마친다.", tier: "gold", check: (c) => { if (!c.seasonEnd) return false; let w = 0, n = 0; for (const f of c.s.fixtures) { if (!f.score || f.home !== c.s.userClub) continue; n++; if (f.score[0] > f.score[1]) w++; } return n >= c.rounds / 2 && w === n; } },
  { id: "clean_sheets_8", title: "철벽 수비", desc: "리그 한 시즌에 무실점 경기 8회를 기록한다.", tier: "silver", check: (c) => seasonCleanSheets(c.s) >= 8 },
  { id: "transfer_income_50", title: "장사의 신", desc: "한 시즌 이적 수익 50억을 올린다.", tier: "silver", check: (c) => seasonTransferIncome(c.s) >= 50 },
  { id: "fans_80", title: "팬들의 사랑", desc: "팬 분위기 80 이상으로 시즌을 마친다.", tier: "silver", check: (c) => c.seasonEnd && (c.me.fans?.mood ?? 0) >= 80 },
  { id: "board_90", title: "이사회의 전폭 신뢰", desc: "이사회 신뢰도 90에 도달한다.", tier: "silver", check: (c) => (c.s.board?.confidence ?? 0) >= 90 },
  { id: "five_seasons", title: "장기 집권", desc: "5시즌을 감독으로 완주한다.", tier: "silver", check: (c) => c.records.seasonsInCharge >= 5 },
  { id: "comebacks_5", title: "역전의 명수", desc: "끌려가다 뒤집은 역전승 5회.", tier: "silver", check: (c) => c.records.comebacks >= 5 },
  { id: "big_win", title: "대승", desc: "3골 차 이상으로 승리한다.", tier: "bronze", check: (c) => c.records.bigWins >= 1 },
  { id: "shootout_win", title: "승부차기의 신", desc: "컵 승부차기에서 승리한다.", tier: "bronze", check: (c) => c.records.shootoutWins + seasonShootoutWins(c.s) >= 1 },
  { id: "youth_5", title: "유스 사관학교", desc: "유망주 5명을 1군으로 승격시킨다.", tier: "silver", check: (c) => c.records.promotedYouth >= 5 },
  { id: "full_staff", title: "코칭스태프 완편", desc: `코칭스태프 ${MAX_STAFF}명을 모두 채운다.`, tier: "bronze", check: (c) => (c.me.staff?.length ?? 0) >= MAX_STAFF },
  { id: "manager_of_year", title: "올해의 감독", desc: "시즌 올해의 감독상을 받는다.", tier: "gold", check: (c) => c.s.seasonHistory.some((r) => r.managerOfYear?.club === (r.userClub ?? c.s.userClub) && r.managerOfYear.name === c.s.managerName) },
];

export const achievementById = (id: string): AchievementDef | undefined => ACHIEVEMENTS.find((a) => a.id === id);

export const newRecords = (): Records => ({ wins: 0, unbeaten: 0, bestUnbeaten: 0, cleanSheets: 0, bestCleanSheets: 0, comebacks: 0, bigWins: 0, shootoutWins: 0, promotedYouth: 0, seasonsInCharge: 0, recordAttendance: 0 });

/** Saves from before the achievements: empty counters and no unlocks (also what newGame starts with). */
export function migrateAchievements(s: GameState): void {
  if (!s.records || typeof s.records !== "object") s.records = newRecords();
  const fresh = newRecords();
  for (const k of Object.keys(fresh) as (keyof Records)[]) if (k !== "biggestWin" && typeof s.records[k] !== "number") (s.records as unknown as Record<string, number>)[k] = 0;
  if (!Array.isArray(s.achievements)) s.achievements = [];
  if (!Array.isArray(s.freshAchievements)) s.freshAchievements = [];
  if (typeof s.seasonMinBudget !== "number") s.seasonMinBudget = s.clubs[s.userClub]?.budget ?? 0;
}

export const records = (s: GameState): Records => { if (!s.records) migrateAchievements(s); return s.records!; };

export const hasAchievement = (s: GameState, id: string): boolean => (s.achievements ?? []).some((a) => a.id === id);

function context(s: GameState, seasonEnd: boolean): AchievementContext {
  const rows = table(s);
  const idx = rows.findIndex((r) => r.club === s.userClub);
  return { s, me: clubOf(s, s.userClub), records: records(s), row: rows[idx]!, position: idx + 1, expected: expectedPositions(s).get(s.userClub) ?? rows.length, rounds: seasonRounds(s), seasonEnd };
}

/** Run every locked achievement's check; unlocks go on the list, into the news and onto `freshAchievements`. Returns the new ids. */
export function evaluateAchievements(s: GameState, seasonEnd = false): string[] {
  migrateAchievements(s);
  const c = context(s, seasonEnd);
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (hasAchievement(s, a.id)) continue;
    let ok = false;
    try { ok = a.check(c); } catch { ok = false; }
    if (!ok) continue;
    const e: EarnedAchievement = { id: a.id, season: s.season, round: s.round };
    s.achievements!.push(e);
    s.freshAchievements!.push(a.id);
    s.news.unshift(`🏅 업적 달성: ${a.title} — ${a.desc}`);
    out.push(a.id);
  }
  return out;
}

/** Did the user's side trail at any point of the match? (running score from the goal events) */
function trailed(m: Match, side: 0 | 1): boolean {
  const score: [number, number] = [0, 0];
  for (const e of m.state.events) {
    if (e.team === undefined || e.team === null) continue;
    const t = e.team as 0 | 1;
    if (e.type === "GOAL") score[t]++;
    else if (e.type === "OWN_GOAL") score[t === 0 ? 1 : 0]++;
    else continue;
    if (score[side] < score[side === 0 ? 1 : 0]) return true;
  }
  return false;
}

/**
 * After a recorded match of the user's club (league or cup): update the career counters and run the checks.
 * Called by recordResult; a no-op for matches the user was not part of.
 */
export function achievementsAfterMatch(s: GameState, f: Fixture, m: Match, cup: boolean): string[] {
  if (f.home !== s.userClub && f.away !== s.userClub) return [];
  if (!f.score) return [];
  const r = records(s);
  const side: 0 | 1 = f.home === s.userClub ? 0 : 1;
  const gf: number = f.score[side], ga: number = f.score[side === 0 ? 1 : 0];
  if (gf > ga) {
    r.wins++;
    r.unbeaten++;
    if (trailed(m, side)) r.comebacks++;
    if (gf - ga >= 3) r.bigWins++;
    const b = r.biggestWin;
    if (!b || gf - ga > b.score[0] - b.score[1] || (gf - ga === b.score[0] - b.score[1] && gf > b.score[0])) r.biggestWin = { season: s.season, opponent: side === 0 ? f.away : f.home, score: [gf, ga], home: side === 0, cup };
  } else if (gf === ga) r.unbeaten++;
  else r.unbeaten = 0;
  r.bestUnbeaten = Math.max(r.bestUnbeaten, r.unbeaten);
  r.cleanSheets = ga === 0 ? r.cleanSheets + 1 : 0;
  r.bestCleanSheets = Math.max(r.bestCleanSheets, r.cleanSheets);
  if (side === 0 && f.attendance) r.recordAttendance = Math.max(r.recordAttendance, f.attendance);
  return evaluateAchievements(s, false);
}

/** Weekly (advanceRound): sample the lowest budget of the season and re-run the checks (cup shoot-outs, staff, board). */
export function achievementsWeek(s: GameState): string[] {
  migrateAchievements(s);
  const me = clubOf(s, s.userClub);
  s.seasonMinBudget = Math.min(s.seasonMinBudget ?? me.budget, me.budget);
  return evaluateAchievements(s, false);
}

/** The user promoted an academy prospect (youth.ts). */
export function recordPromotion(s: GameState): void {
  records(s).promotedYouth++;
}

/**
 * At the rollover, after the season record is on the history and before the counters reset: stamp the record
 * with the user's club and the top scorer, bank the season's shoot-out wins, count the season and judge the
 * season-long achievements. Returns the new ids.
 */
export function achievementsSeasonEnd(s: GameState): string[] {
  migrateAchievements(s);
  const rec = s.seasonHistory[s.seasonHistory.length - 1];
  if (rec && rec.season === s.season) {
    rec.userClub = s.userClub;
    const t = topScorers(s, 1)[0];
    if (t) rec.topScorer = { name: t.player.name, club: t.club.id, goals: t.player.stats.goals };
  }
  const r = records(s);
  r.shootoutWins += seasonShootoutWins(s);
  if (!s.board?.sacked) r.seasonsInCharge++;
  const out = evaluateAchievements(s, true);
  s.seasonMinBudget = clubOf(s, s.userClub).budget;
  return out;
}

/** Ids unlocked since the viewer last asked, then cleared. */
export function takeFreshAchievements(s: GameState): string[] {
  const out = s.freshAchievements ?? [];
  s.freshAchievements = [];
  return out;
}

// ------------------------------------------------------------------ hall of fame / trophy cabinet

export interface HallOfFame {
  /** seasons the user's club won the league */
  titles: number[];
  /** seasons the user's club won the cup */
  cups: number[];
  /** seasons with both */
  doubles: number[];
  /** the user's finishing positions, oldest first */
  positions: { season: number; position: number; pts: number; club: number }[];
  bestPosition: number | null;
  /** 올해의 감독 seasons won by the user */
  managerAwards: number[];
  /** the league's top scorer per season, oldest first */
  topScorers: { season: number; name: string; club: number; goals: number }[];
  /** career goals across the league (current squads and free agents) */
  careerGoals: { player: SquadPlayer; club: Club | null; goals: number }[];
  /** best career average rating (players with ≥ 20 rated appearances over their careers) */
  careerRatings: { player: SquadPlayer; club: Club | null; rating: number; apps: number }[];
  /** biggest home crowd of the user's career and of every club this season */
  recordAttendance: number;
  bestAttendances: { club: Club; attendance: number }[];
  biggestWin: Records["biggestWin"] | null;
  records: Records;
  /** unlocked achievements with their defs, newest first */
  earned: (EarnedAchievement & { def: AchievementDef })[];
  total: number;
}

/** Career goals of a player: finished seasons plus the running one. */
export function careerGoals(p: SquadPlayer): number {
  return (p.career ?? []).reduce((a, e) => a + e.goals, 0) + p.stats.goals;
}

/** Career average rating weighted by appearances (0 without any). */
export function careerRating(p: SquadPlayer): { rating: number; apps: number } {
  let sum = 0, apps = 0;
  for (const e of p.career ?? []) if (e.rating > 0 && e.apps > 0) { sum += e.rating * e.apps; apps += e.apps; }
  const n = p.stats.ratedApps ?? 0;
  if (n > 0) { sum += p.stats.ratingSum ?? 0; apps += n; }
  return { rating: apps ? Math.round((sum / apps) * 100) / 100 : 0, apps };
}

/** Everything the trophy cabinet shows, aggregated from the season history, the players' CVs and the records. */
export function hallOfFame(s: GameState, n = 5): HallOfFame {
  migrateAchievements(s);
  const hist = s.seasonHistory ?? [];
  const titles = hist.filter((r) => wonTitle(r, s)).map((r) => r.season);
  const cups = hist.filter((r) => wonCup(r, s)).map((r) => r.season);
  const doubles = titles.filter((x) => cups.includes(x));
  const positions = hist.map((r) => ({ season: r.season, position: r.userPosition, pts: r.userPts, club: r.userClub ?? s.userClub }));
  const bestPosition = positions.length ? Math.min(...positions.map((p) => p.position)) : null;
  const managerAwards = hist.filter((r) => r.managerOfYear && r.managerOfYear.name === s.managerName && r.managerOfYear.club === (r.userClub ?? s.userClub)).map((r) => r.season);
  const topScorersList = hist.filter((r) => r.topScorer).map((r) => ({ season: r.season, ...r.topScorer! }));
  const all: { player: SquadPlayer; club: Club | null }[] = [];
  for (const c of s.clubs) for (const player of c.squad) all.push({ player, club: c });
  for (const player of s.freeAgents ?? []) all.push({ player, club: null });
  const careerGoalsList = all.map((x) => ({ ...x, goals: careerGoals(x.player) })).filter((x) => x.goals > 0).sort((a, b) => b.goals - a.goals || a.player.name.localeCompare(b.player.name)).slice(0, n);
  const careerRatingsList = all.map((x) => ({ ...x, ...careerRating(x.player) })).filter((x) => x.apps >= 20).sort((a, b) => b.rating - a.rating || b.apps - a.apps).slice(0, n);
  const bestAttendances = s.clubs.filter((c) => c.fans?.bestAttendance).map((c) => ({ club: c, attendance: c.fans.bestAttendance })).sort((a, b) => b.attendance - a.attendance).slice(0, n);
  const r = records(s);
  const earned = [...(s.achievements ?? [])].reverse().map((e) => ({ ...e, def: achievementById(e.id)! })).filter((e) => e.def);
  return { titles, cups, doubles, positions, bestPosition, managerAwards, topScorers: topScorersList, careerGoals: careerGoalsList, careerRatings: careerRatingsList, recordAttendance: Math.max(r.recordAttendance, clubOf(s, s.userClub).fans?.bestAttendance ?? 0), bestAttendances, biggestWin: r.biggestWin ?? null, records: r, earned, total: ACHIEVEMENTS.length };
}
