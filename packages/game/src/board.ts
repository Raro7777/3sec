import { Rng } from "@3sec/engine";
import type { Board, Club, GameState, SackRecord } from "./types";
import { clubOf, seasonOver, table } from "./season";
import { roundsPerSeason } from "./fixtures";
import { MAX_FREE_MANAGERS, applyManagerPolicy, clearUserManager, expectedPositions, generateManager } from "./managers";

/** Weekly reviews start once this many rounds are played. */
export const BOARD_FROM_ROUND = 5;
export const START_CONFIDENCE = 60;
/** Share of the gap to the target closed each week. */
export const CONFIDENCE_STEP = 0.25;
/** Below this the board counts a bad week. */
export const WARN_BELOW = 25;
/** Bad weeks in a row before a warning (or, after one, the sack). */
export const WARN_WEEKS = 3;
/** After a warning, a further bad streak ending below this is the end. */
export const SACK_BELOW = 15;
/** Season-end verdicts. */
export const TRUST_AT = 70;
export const ROLLOVER_SACK_BELOW = 35;
/** A cup win (in 90 minutes) on a cup day. */
export const CUP_WIN_BONUS = 5;
/** Confidence a new employer starts the user on. */
export const NEW_JOB_CONFIDENCE = 55;
/** Clubs that come calling after a sacking. */
export const JOB_OFFERS = 2;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;

export const newBoard = (confidence = START_CONFIDENCE): Board => ({ confidence, warnings: 0, lastReview: -1, lowWeeks: 0 });

/** Where the user's board expects the club to finish (rank by reputation, the same yardstick AI boards use). */
export const userExpectation = (s: GameState): number => expectedPositions(s).get(s.userClub) ?? s.clubs.length;

export const userPosition = (s: GameState): number => table(s).findIndex((r) => r.club === s.userClub) + 1;

/** League points from the club's last `n` played fixtures (0..3n). */
export function formPoints(s: GameState, club: number, n = 5): number {
  const played = s.fixtures.filter((f) => f.score && (f.home === club || f.away === club)).slice(-n);
  let pts = 0;
  for (const f of played) {
    const [hg, ag] = f.score!;
    const gf = f.home === club ? hg : ag, ga = f.home === club ? ag : hg;
    pts += gf > ga ? 3 : gf === ga ? 1 : 0;
  }
  return pts;
}

/** The confidence the current situation would settle at: 50 + (expectation − position) × 5 + (form − 7) × 1.5, clamped 0..100. */
export const confidenceTarget = (expectation: number, position: number, form: number): number =>
  clamp(50 + (expectation - position) * 5 + (form - 7) * 1.5, 0, 100);

/** One step of the weekly drift: a quarter of the way to the target. */
export const stepConfidence = (confidence: number, target: number): number => round1(clamp(confidence + (target - confidence) * CONFIDENCE_STEP, 0, 100));

export type BoardEvent = "warning" | "sacked" | null;

/** The colour band of a confidence value for the UI. */
export const confidenceBand = (c: number): "good" | "ok" | "warn" | "bad" => (c >= TRUST_AT ? "good" : c >= 45 ? "ok" : c >= WARN_BELOW ? "warn" : "bad");

function sack(s: GameState, reason: SackRecord["reason"]): void {
  const rows = table(s);
  const idx = rows.findIndex((r) => r.club === s.userClub);
  s.board.sacked = { season: s.season, round: s.round, position: idx + 1, expected: userExpectation(s), pts: rows[idx]?.pts ?? 0, reason };
  s.board.lowWeeks = 0;
  s.news.unshift(`${clubOf(s, s.userClub).shortName}: 이사회가 ${s.managerName} 감독을 경질했습니다 (${idx + 1}위, 기대 ${userExpectation(s)}위).`);
}

/**
 * The weekly board review for the user's club (from BOARD_FROM_ROUND rounds played, not once the season is
 * over). Confidence drifts toward the target; three straight weeks under WARN_BELOW bring a warning, and after
 * a warning a further such streak that ends under SACK_BELOW brings the sack. Returns what happened.
 */
export function boardWeek(s: GameState): BoardEvent {
  const b = s.board;
  if (b.sacked || s.round < BOARD_FROM_ROUND || seasonOver(s)) return null;
  const exp = userExpectation(s), pos = userPosition(s);
  b.confidence = stepConfidence(b.confidence, confidenceTarget(exp, pos, formPoints(s, s.userClub)));
  b.lastReview = s.round;
  if (b.confidence >= WARN_BELOW) { b.lowWeeks = 0; return null; }
  b.lowWeeks++;
  if (b.lowWeeks < WARN_WEEKS) return null;
  b.lowWeeks = 0;
  if (b.warnings >= 1 && b.confidence < SACK_BELOW) {
    sack(s, "warnings");
    return "sacked";
  }
  b.warnings++;
  s.news.unshift(`이사회 경고: ${clubOf(s, s.userClub).shortName} 이사회가 성적 부진(${pos}위, 기대 ${exp}위)에 공식 경고를 보냈습니다. 신뢰도 ${b.confidence}.`);
  return "warning";
}

/** A cup win on a cup day pleases the board a little. */
export function boardCupWin(s: GameState): void {
  if (s.board.sacked) return;
  s.board.confidence = round1(clamp(s.board.confidence + CUP_WIN_BONUS, 0, 100));
}

/**
 * The season-end verdict, taken at the rollover before the counters reset: TRUST_AT and above earns a vote of
 * confidence, under ROLLOVER_SACK_BELOW the sack. A new season starts with the warnings wiped either way.
 */
export function boardRollover(s: GameState): BoardEvent {
  const b = s.board;
  if (b.sacked) return null;
  let ev: BoardEvent = null;
  if (b.confidence >= TRUST_AT) s.news.unshift(`이사회 신임: ${clubOf(s, s.userClub).shortName} 이사회가 ${s.managerName} 감독에게 전폭적인 신뢰를 보냈습니다 (신뢰도 ${b.confidence}).`);
  else if (b.confidence < ROLLOVER_SACK_BELOW) { sack(s, "rollover"); ev = "sacked"; }
  b.warnings = 0;
  b.lowWeeks = 0;
  b.lastReview = -1;
  return ev;
}

/**
 * Clubs willing to hire a sacked manager: vacancies first, then the AI dugouts under the most pressure
 * (lowest reputation breaking ties), at most JOB_OFFERS of them.
 */
export function jobOffers(s: GameState, n = JOB_OFFERS): Club[] {
  return s.clubs
    .filter((c) => c.id !== s.userClub)
    .sort((a, b) => Number(!!a.manager) - Number(!!b.manager) || (b.pressure ?? 0) - (a.pressure ?? 0) || a.reputation - b.reputation || a.id - b.id)
    .slice(0, n);
}

/**
 * Take a job at another club after the sack: the old club gets an AI manager (the pool first), the new club's
 * manager joins the pool, the user moves over with a fresh board. Bids for the old club's players lapse.
 */
export function acceptJob(s: GameState, clubId: number): string | null {
  if (!s.board.sacked) return "경질 상태가 아닙니다.";
  if (clubId === s.userClub) return "지금 구단입니다.";
  const target = s.clubs[clubId];
  if (!target) return "없는 구단입니다.";
  if (!Array.isArray(s.freeManagers)) s.freeManagers = [];
  const old = clubOf(s, s.userClub);
  const oldManager = s.freeManagers.shift() ?? generateManager(new Rng((s.seed * 59 + s.season * 811 + s.round * 17 + old.id) >>> 0), s.season, `M${old.id}-S${s.season}R${s.round}U`);
  oldManager.since = s.season;
  old.manager = oldManager;
  old.pressure = 0;
  applyManagerPolicy(old);
  if (target.manager) {
    target.manager.since = s.season;
    s.freeManagers.unshift(target.manager);
    if (s.freeManagers.length > MAX_FREE_MANAGERS) s.freeManagers.length = MAX_FREE_MANAGERS;
  }
  const oldName = target.manager?.name;
  s.userClub = clubId;
  clearUserManager(s);
  s.offers = [];
  s.board = newBoard(NEW_JOB_CONFIDENCE);
  s.news.unshift(`${target.shortName}: ${s.managerName} 감독 부임${oldName ? ` (${oldName} 감독 퇴진)` : ""}. ${old.shortName}은(는) ${oldManager.name} 감독을 선임했습니다.`);
  return null;
}

/** Rounds the season has (for the sacked-screen summary). */
export const boardSeasonRounds = (s: GameState): number => roundsPerSeason(s.clubs.length);
