/**
 * 팬 시스템: every club has supporters with a mood (0..100) that reacts to results, goals, the table, cup runs and
 * the transfer market. The mood, the opponent, the table and the occasion set the crowd at each home match, the
 * crowd pays the gate, and a happy crowd lifts the home advantage. Everything is seeded so a save replays alike.
 *
 * Hooks (kept short in their host files): `recordAttendance` from recordResult, `fansWeek` from advanceRound,
 * `fansCupResult` from recordCupResult, `fansTransfer` from transfers.movePlayer, `fansRollover` from the season
 * counters reset, `fanHomeEdge` from createMatch, `migrateFans` from save.deserialize.
 */
import { Rng, TUNING } from "@3sec/engine";
import type { Club, Fans, Fixture, GameState, SquadPlayer } from "./types";
import { CLUBS } from "./world";
import { clubOf, fixtureSeed, playerOf, table } from "./season";
import { expectedPositions } from "./managers";
import { overall } from "./rating";

// ------------------------------------------------------------------ tuning

/** Mood a fresh club's supporters start on. */
export const FAN_START_MOOD = 55;
/** The mood drifts toward this every week (share FAN_DRIFT of the gap). */
export const FAN_NEUTRAL_MOOD = 50;
export const FAN_DRIFT = 0.1;
/** Weekly mood swings. */
export const FAN_MOOD = { win: 3.5, upset: 3, draw: 2, loss: 3, collapse: 2, goalsFor3: 2, blank: 1, goalsAgainst3: 1, positionPerPlace: 0.3, positionCap: 2, unbeaten5: 1, winless5: 2, cupWin: 3, cupOut: 2, cupOutLate: 3, starSold: 8, starterSold: 3, starSigned: 6, signed: 2 } as const;
/** Under this mood for FAN_PROTEST_WEEKS straight weeks the fans protest (the user's board loses FAN_PROTEST_CONFIDENCE). */
export const FAN_PROTEST_BELOW = 25;
export const FAN_PROTEST_WEEKS = 3;
export const FAN_PROTEST_CONFIDENCE = 3;
/** From this mood the fans queue for tickets: news and FAN_FRENZY_GATE more at the gate. */
export const FAN_FRENZY_AT = 80;
export const FAN_FRENZY_GATE = 0.05;
/** Core supporters as a share of capacity: FAN_BASE_SHARE + FAN_BASE_PER_REP × (reputation − 10). */
export const FAN_BASE_SHARE = 0.25;
export const FAN_BASE_PER_REP = 0.07;
/** Ticket price in 원: TICKET_BASE + TICKET_PER_REP × (reputation − 10). Gate = attendance × price / 1e8 억원. */
export const TICKET_BASE = 2800;
export const TICKET_PER_REP = 150;
/** Crowds under this share of capacity make the "썰렁한 관중석" news. */
export const POOR_CROWD_SHARE = 0.45;
export const DEFAULT_CAPACITY = 30000;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;
const round2 = (x: number): number => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ model

/** Stadium seats of a club (old saves and test clubs fall back to the world definition, then the default). */
export const clubCapacity = (club: Pick<Club, "id" | "capacity">): number =>
  typeof club.capacity === "number" && club.capacity > 0 ? club.capacity : CLUBS[club.id]?.capacity ?? DEFAULT_CAPACITY;

/** Core supporters who turn up whatever happens. */
export const fanBase = (reputation: number, capacity: number): number => Math.round(capacity * (FAN_BASE_SHARE + FAN_BASE_PER_REP * clamp(reputation - 10, 0, 6)));

export const newFans = (reputation: number, capacity: number, mood = FAN_START_MOOD): Fans =>
  ({ base: fanBase(reputation, capacity), mood, lowWeeks: 0, lastAttendance: 0, seasonAttendance: 0, seasonHome: 0, bestAttendance: 0 });

export type MoodBand = "good" | "ok" | "warn" | "bad";
export const moodBand = (mood: number): MoodBand => (mood >= 60 ? "good" : mood >= 40 ? "ok" : mood >= FAN_PROTEST_BELOW ? "warn" : "bad");
/** 열광 / 만족 / 보통 / 불만 / 분노 */
export const moodLabel = (mood: number): string => (mood >= FAN_FRENZY_AT ? "열광" : mood >= 60 ? "만족" : mood >= 40 ? "보통" : mood >= FAN_PROTEST_BELOW ? "불만" : "분노");

export const ticketPrice = (reputation: number): number => Math.round(TICKET_BASE + TICKET_PER_REP * clamp(reputation - 10, 0, 6));

/** Gate receipts (억원) for a crowd; a frenzied support pays FAN_FRENZY_GATE more (merchandise, hospitality). */
export function gateReceipts(club: Club, attendance: number): number {
  const bonus = club.fans.mood >= FAN_FRENZY_AT ? 1 + FAN_FRENZY_GATE : 1;
  return round2((attendance * ticketPrice(club.reputation) * bonus) / 1e8);
}

/** Home advantage for the engine: the default edge scaled by the mood (0.5× at 0, 1× at 50, 1.5× at 100). */
export const fanHomeEdge = (home: Club): number => round2(TUNING.homeEdge * (0.5 + (home.fans?.mood ?? FAN_START_MOOD) / 100));

export const avgHomeAttendance = (club: Club): number => (club.fans.seasonHome ? Math.round(club.fans.seasonAttendance / club.fans.seasonHome) : 0);

export const adjustMood = (club: Club, delta: number): void => { club.fans.mood = round1(clamp(club.fans.mood + delta, 0, 100)); };

/**
 * Share of the floating support (capacity − base) that turns up: the mood first, then the opponent's pull, the
 * home side's league position, the occasion (early cup rounds draw less, the semi/final more) and the season's
 * run-in. The result is 0..1; noise of ±0.08 (1σ) comes from `rng`.
 */
export function crowdInterest(s: GameState, home: Club, away: Club, cup: boolean, rng: Rng): number {
  const mood = home.fans?.mood ?? FAN_START_MOOD;
  let x = 0.35 + ((mood - 50) / 100) * 0.6;
  x += (away.reputation - 12) * 0.06;
  const rows = table(s);
  const pos = rows.findIndex((r) => r.club === home.id) + 1;
  const played = rows.find((r) => r.club === home.id)?.played ?? 0;
  if (pos > 0 && played > 0) x += ((rows.length / 2 + 0.5 - pos) / rows.length) * 0.15;
  if (cup) x += s.cup.stage >= 2 ? 0.1 : -0.12;
  else if (played >= 18) x += 0.04;
  x += rng.gauss(0, 0.08);
  return clamp(x, 0, 1);
}

/** Crowd at a home match: the core support plus the interested share of the rest, capped by the seats. */
export function expectedAttendance(s: GameState, home: Club, away: Club, cup: boolean, rng: Rng): number {
  const cap = clubCapacity(home);
  const base = Math.min(cap, home.fans?.base ?? fanBase(home.reputation, cap));
  return Math.min(cap, Math.round(base + (cap - base) * crowdInterest(s, home, away, cup, rng)));
}

// ------------------------------------------------------------------ hooks

const fmt = (n: number): string => n.toLocaleString("ko-KR");

/**
 * Called by recordResult once the score is in: the crowd for the fixture (seeded), the gate for the home club,
 * the season counters, and news for sellouts, a new season best and a poor house.
 */
export function recordAttendance(s: GameState, f: Fixture, cup: boolean): number {
  const home = clubOf(s, f.home), away = clubOf(s, f.away);
  if (!home.fans) home.fans = newFans(home.reputation, clubCapacity(home));
  const rng = new Rng((fixtureSeed(s, f) ^ 0x2545f491) >>> 0);
  const att = expectedAttendance(s, home, away, cup, rng);
  f.attendance = att;
  const gate = gateReceipts(home, att);
  home.budget = round1(home.budget + gate);
  home.seasonRevenue = round2((home.seasonRevenue ?? 0) + gate);
  home.seasonGate = round2((home.seasonGate ?? 0) + gate);
  const fans = home.fans;
  const cap = clubCapacity(home);
  const prevBest = fans.bestAttendance;
  fans.lastAttendance = att;
  fans.seasonAttendance += att;
  fans.seasonHome++;
  fans.bestAttendance = Math.max(fans.bestAttendance, att);
  const mine = home.id === s.userClub;
  if (att >= cap) s.news.unshift(`🎟 ${home.shortName} 홈구장 매진! ${fmt(att)}명이 ${away.shortName}전을 찾았습니다 (입장 수입 ${gate.toFixed(1)}억).`);
  else if (mine && fans.seasonHome > 1 && att > prevBest) s.news.unshift(`${home.shortName}: 시즌 최다 관중 ${fmt(att)}명 (${away.shortName}전, 입장 수입 ${gate.toFixed(1)}억).`);
  else if (mine && att < cap * POOR_CROWD_SHARE) s.news.unshift(`${home.shortName}: 썰렁한 관중석. ${fmt(cap)}석 중 ${fmt(att)}명만 찾아왔습니다 (팬 분위기 ${moodLabel(fans.mood)}).`);
  return att;
}

/** League points and goals of a club in one fixture (null when it did not play). */
function outcome(f: Fixture, club: number): { gf: number; ga: number; home: boolean } | null {
  if (!f.score || (f.home !== club && f.away !== club)) return null;
  const home = f.home === club;
  return { gf: home ? f.score[0] : f.score[1], ga: home ? f.score[1] : f.score[0], home };
}

/**
 * The weekly mood update, called by advanceRound after the round counter moved on (so the round just played is
 * `s.round − 1`): the result against expectation, goals, the table against the board's expectation, runs, the
 * drift toward neutral, then the protest check. Returns the clubs whose fans protested.
 */
export function fansWeek(s: GameState): Club[] {
  const round = s.round - 1;
  const expected = expectedPositions(s);
  const rows = table(s);
  const protested: Club[] = [];
  for (const c of s.clubs) {
    if (!c.fans) c.fans = newFans(c.reputation, clubCapacity(c));
    let delta = 0;
    const f = s.fixtures.find((x) => x.round === round && (x.home === c.id || x.away === c.id));
    const o = f ? outcome(f, c.id) : null;
    if (f && o) {
      const opp = clubOf(s, f.home === c.id ? f.away : f.home);
      const edge = c.reputation - opp.reputation + (o.home ? 0.6 : -0.6);
      if (o.gf > o.ga) delta += FAN_MOOD.win + (edge < -1 ? FAN_MOOD.upset : 0);
      else if (o.gf === o.ga) delta += edge > 1 ? -FAN_MOOD.draw : edge < -1 ? FAN_MOOD.draw : 0;
      else delta -= FAN_MOOD.loss + (edge > 1 ? FAN_MOOD.collapse : 0);
      if (o.gf >= 3) delta += FAN_MOOD.goalsFor3;
      if (o.gf === 0) delta -= FAN_MOOD.blank;
      if (o.ga >= 3) delta -= FAN_MOOD.goalsAgainst3;
    }
    const idx = rows.findIndex((r) => r.club === c.id);
    if (idx >= 0 && (rows[idx]?.played ?? 0) >= 3) delta += clamp(((expected.get(c.id) ?? idx + 1) - (idx + 1)) * FAN_MOOD.positionPerPlace, -FAN_MOOD.positionCap, FAN_MOOD.positionCap);
    const last5 = s.fixtures.filter((x) => x.score && x.round <= round && (x.home === c.id || x.away === c.id)).slice(-5).map((x) => outcome(x, c.id)!);
    if (last5.length === 5 && last5.every((r) => r.gf >= r.ga)) delta += FAN_MOOD.unbeaten5;
    if (last5.length === 5 && last5.every((r) => r.gf <= r.ga)) delta -= FAN_MOOD.winless5;
    const before = c.fans.mood;
    c.fans.mood = round1(clamp(c.fans.mood + delta + (FAN_NEUTRAL_MOOD - c.fans.mood) * FAN_DRIFT, 0, 100));
    if (c.fans.mood >= FAN_FRENZY_AT && before < FAN_FRENZY_AT) s.news.unshift(`${c.shortName}: 매진 행렬! 팬들이 열광하며 홈구장 티켓이 동나고 있습니다 (팬 분위기 ${c.fans.mood}).`);
    if (c.fans.mood < FAN_PROTEST_BELOW) {
      c.fans.lowWeeks++;
      if (c.fans.lowWeeks >= FAN_PROTEST_WEEKS) {
        c.fans.lowWeeks = 0;
        protested.push(c);
        const mine = c.id === s.userClub;
        s.news.unshift(`${c.shortName}: 팬 시위! 서포터들이 홈구장 앞에서 ${mine ? `${s.managerName} 감독과 ` : ""}구단 운영에 항의했습니다 (팬 분위기 ${c.fans.mood}).${mine ? " 이사회 신뢰도 −3." : ""}`);
        if (mine && s.board && !s.board.sacked) s.board.confidence = round1(clamp(s.board.confidence - FAN_PROTEST_CONFIDENCE, 0, 100));
      }
    } else c.fans.lowWeeks = 0;
  }
  return protested;
}

/** A cup tie is decided: the winner's fans cheer, the loser's sulk (more so from the semi-final on). */
export function fansCupResult(s: GameState, winner: Club, loser: Club, stage: number): void {
  if (winner.fans) adjustMood(winner, FAN_MOOD.cupWin);
  if (loser.fans) adjustMood(loser, -(stage >= 2 ? FAN_MOOD.cupOutLate : FAN_MOOD.cupOut));
}

/** Is the player one of the club's stars (top two overall, or clearly above the starting XI's average)? */
export function isStar(club: Club, p: SquadPlayer): boolean {
  const ovr = overall(p.attrs, p.role);
  const ranked = club.squad.map((q) => overall(q.attrs, q.role)).sort((a, b) => b - a);
  const xi = club.selection.starters.map((id) => club.squad.find((q) => q.id === id)).filter((q): q is SquadPlayer => !!q);
  const xiAvg = xi.length ? xi.reduce((a, q) => a + overall(q.attrs, q.role), 0) / xi.length : ovr;
  return ovr >= (ranked[1] ?? ovr) || ovr >= xiAvg + 1.5;
}

/**
 * A transfer went through (called by movePlayer while the player is still in `from`'s squad): selling a star
 * angers the fans, selling a starter irks them; signing a star (one who would lift the buyer's XI) delights the
 * buyer's fans, any signing pleases them a little.
 */
export function fansTransfer(s: GameState, from: Club, to: Club, p: SquadPlayer): void {
  if (from.fans) {
    const star = isStar(from, p);
    const starter = from.selection.starters.includes(p.id);
    if (star) adjustMood(from, -FAN_MOOD.starSold);
    else if (starter) adjustMood(from, -FAN_MOOD.starterSold);
    if (star && from.id === s.userClub) s.news.unshift(`${from.shortName}: ${p.name} 매각에 팬들이 실망했습니다 (팬 분위기 ${from.fans.mood}).`);
  }
  if (to.fans) {
    const xi = to.selection.starters.map((id) => playerOf(to, id)).filter(Boolean);
    const xiAvg = xi.length ? xi.reduce((a, q) => a + overall(q.attrs, q.role), 0) / xi.length : 0;
    const star = overall(p.attrs, p.role) >= xiAvg + 1;
    adjustMood(to, star ? FAN_MOOD.starSigned : FAN_MOOD.signed);
    if (star && to.id === s.userClub) s.news.unshift(`${to.shortName}: ${p.name} 영입에 팬들이 들떴습니다 (팬 분위기 ${to.fans.mood}).`);
  }
}

/** Season rollover: counters reset, the mood softens halfway toward the start value. */
export function fansRollover(c: Club): void {
  if (!c.fans) c.fans = newFans(c.reputation, clubCapacity(c));
  const f = c.fans;
  f.base = fanBase(c.reputation, clubCapacity(c));
  f.mood = round1(f.mood + (FAN_START_MOOD - f.mood) * 0.5);
  f.lowWeeks = 0;
  f.lastAttendance = 0;
  f.seasonAttendance = 0;
  f.seasonHome = 0;
  f.bestAttendance = 0;
  c.seasonGate = 0;
}

/** Saves from before the fans: capacity from the world definition, content supporters, empty counters. */
export function migrateFans(s: GameState): void {
  for (const c of s.clubs) {
    if (typeof c.capacity !== "number" || c.capacity <= 0) c.capacity = clubCapacity(c);
    if (!c.fans || typeof c.fans.mood !== "number") c.fans = newFans(c.reputation, c.capacity);
    const f = c.fans;
    if (typeof f.base !== "number") f.base = fanBase(c.reputation, c.capacity);
    for (const k of ["lowWeeks", "lastAttendance", "seasonAttendance", "seasonHome", "bestAttendance"] as const) if (typeof f[k] !== "number") f[k] = 0;
    f.mood = clamp(f.mood, 0, 100);
    if (typeof c.seasonGate !== "number") c.seasonGate = 0;
  }
}
