import { Rng, type Match, type MatchOptions, type TeamId } from "@3sec/engine";
import type { Cup, CupTie, Fixture, GameState } from "./types";
import { clubOf, createMatch, fixtureSeed, prepareRound, recordResult, seasonOver } from "./season";

export const CUP_NAME = "3sec 컵";
/** Cup matchdays: before league round index r (0-based) when the season reaches it → stage index. */
export const CUP_ROUNDS = [6, 11, 16, 21] as const;
export const CUP_STAGES = 4;
export const CUP_STAGE_LABEL = ["1라운드", "8강", "4강", "결승"] as const;
/** Byes in round 1: the 12-club field is cut to 8 by resting the four best-reputation clubs. */
export const CUP_BYES = 4;
/** Prize money (억원): loser of QF / SF, then runner-up and winner of the final. */
export const CUP_PRIZE = { qfLoser: 4, sfLoser: 8, runnerUp: 15, winner: 30 } as const;

const drawRng = (s: GameState, stage: number): Rng => new Rng((s.seed * 6151 + s.season * 7877 + stage * 911 + 5) >>> 0);

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The four clubs that skip round 1 (highest reputation, ties broken by id). */
export function cupByes(s: GameState): number[] {
  return [...s.clubs].sort((a, b) => b.reputation - a.reputation || a.id - b.id).slice(0, CUP_BYES).map((c) => c.id);
}

/** Clubs still in the cup entering `stage`: R1 = everyone but the byes, later = byes + previous winners. */
export function cupEntrants(s: GameState, stage: number): number[] {
  const byes = cupByes(s);
  if (stage === 0) return s.clubs.map((c) => c.id).filter((id) => !byes.includes(id));
  const prev = s.cup.ties.filter((t) => t.stage === stage - 1).map((t) => tieWinner(t)!).filter((w) => w !== null);
  return stage === 1 ? [...byes, ...prev] : prev;
}

/** Pair the entrants of a stage at random (seeded by save, season and stage) and append the ties. */
export function drawCupRound(s: GameState, stage: number, rng: Rng = drawRng(s, stage)): CupTie[] {
  const entrants = shuffle(cupEntrants(s, stage), rng);
  if (entrants.length % 2 !== 0) throw new Error("odd number of cup entrants");
  const ties: CupTie[] = [];
  let id = s.cup.ties.length;
  for (let i = 0; i < entrants.length; i += 2) ties.push({ id: id++, stage, home: entrants[i]!, away: entrants[i + 1]!, score: null, scorers: [] });
  s.cup.ties.push(...ties);
  return ties;
}

/** A fresh cup for the current season with the round-1 draw made. */
export function newCup(s: GameState): Cup {
  s.cup = { ties: [], stage: 0 };
  drawCupRound(s, 0);
  return s.cup;
}

export const tieWinner = (t: CupTie): number | null => {
  if (!t.score) return null;
  const [h, a] = t.score;
  if (h !== a) return h > a ? t.home : t.away;
  if (!t.penalties) return null;
  return t.penalties[0] > t.penalties[1] ? t.home : t.away;
};

export const cupDone = (s: GameState): boolean => s.cup.stage >= CUP_STAGES;
/** Ties of the stage currently being played (empty once the cup is over). */
export const currentCupTies = (s: GameState): CupTie[] => s.cup.ties.filter((t) => t.stage === s.cup.stage);
export const pendingCupTies = (s: GameState): CupTie[] => currentCupTies(s).filter((t) => !t.score);
/** The user's tie in the current stage, if the club is still in and not resting. */
export const userCupTie = (s: GameState): CupTie | null => currentCupTies(s).find((t) => t.home === s.userClub || t.away === s.userClub) ?? null;

export type CupStatus = "playing" | "bye" | "out" | "holder" | "done";
/** Where the user's club stands in this season's cup. */
export function userCupStatus(s: GameState): CupStatus {
  if (cupDone(s)) return s.cup.holder === s.userClub ? "holder" : "done";
  if (userCupTie(s)) return "playing";
  if (s.cup.stage === 0 && cupByes(s).includes(s.userClub)) return "bye";
  return cupEntrants(s, s.cup.stage).includes(s.userClub) ? "playing" : "out";
}

/** A cup day is due when the season has reached the stage's matchday and the stage is still open. */
export const cupDayDue = (s: GameState): boolean => !cupDone(s) && !seasonOver(s) && s.round >= CUP_ROUNDS[s.cup.stage]!;

/** Fixture-shaped view of a tie so the engine glue (createMatch/recordResult) can be reused. Negative ids never clash with the league. */
export const cupFixture = (t: CupTie): Fixture => ({ id: -(1000 * (t.stage + 1) + t.id), round: -1 - t.stage, home: t.home, away: t.away, score: null, scorers: [] });

export function createCupMatch(s: GameState, t: CupTie, opts: MatchOptions = {}): Match {
  return createMatch(s, cupFixture(t), opts);
}

/**
 * Penalty shoot-out after a drawn tie: five kicks each, then sudden death. Success ≈ 0.76, shifted up to
 * ±0.08 by the taker's finishing/composure against the keeper's reflexes. Takers are the players on the
 * pitch at full time, best first; the keeper is the goalkeeper still on the pitch.
 */
export function penaltyShootout(s: GameState, t: CupTie, m: Match): [number, number] {
  const rng = new Rng(fixtureSeed(s, cupFixture(t)) ^ 0x9e3779b9);
  const side = (team: TeamId) => {
    const onPitch = m.state.players.filter((p) => p.team === team && p.onPitch && !p.sentOff).map((p) => m.def(p.id));
    const keeper = onPitch.find((p) => p.role === "GK") ?? onPitch[0]!;
    const takers = onPitch.filter((p) => p !== keeper).sort((a, b) => (b.attrs.finishing + b.attrs.composure) - (a.attrs.finishing + a.attrs.composure));
    return { keeper, takers: takers.length ? takers : [keeper] };
  };
  const teams = [side(0), side(1)];
  const kick = (team: 0 | 1, i: number): boolean => {
    const me = teams[team]!, them = teams[1 - team]!;
    const taker = me.takers[i % me.takers.length]!;
    const edge = ((taker.attrs.finishing + taker.attrs.composure) / 2 - them.keeper.attrs.reflexes) * 0.016;
    return rng.chance(0.76 + Math.max(-0.08, Math.min(0.08, edge)));
  };
  const score: [number, number] = [0, 0];
  for (let i = 0; i < 5; i++) {
    if (kick(0, i)) score[0]++;
    if (score[0] > score[1] + (5 - i) || score[1] > score[0] + (4 - i)) break;
    if (kick(1, i)) score[1]++;
    if (score[0] > score[1] + (4 - i) || score[1] > score[0] + (4 - i)) break;
  }
  for (let i = 5; score[0] === score[1] && i < 40; i++) {
    if (kick(0, i)) score[0]++;
    if (kick(1, i)) score[1]++;
  }
  if (score[0] === score[1]) score[0]++;
  return score;
}

/** Write a finished cup match back: player stats and injuries via recordResult (no league bookkeeping), the tie's score, a shoot-out if drawn, prize money. */
export function recordCupResult(s: GameState, t: CupTie, m: Match): void {
  const f = cupFixture(t);
  recordResult(s, f, m, { competition: "cup" });
  t.score = f.score;
  t.scorers = f.scorers;
  const home = clubOf(s, t.home), away = clubOf(s, t.away);
  if (t.score![0] === t.score![1]) {
    t.penalties = penaltyShootout(s, t, m);
    const w = clubOf(s, tieWinner(t)!);
    s.news.unshift(`${CUP_NAME} ${CUP_STAGE_LABEL[t.stage]}: ${home.shortName} ${t.score![0]} - ${t.score![1]} ${away.shortName}, 승부차기 ${t.penalties[0]}-${t.penalties[1]}로 ${w.shortName} 진출.`);
  }
  const winner = clubOf(s, tieWinner(t)!);
  const loser = winner === home ? away : home;
  if (t.stage === 1) loser.budget += CUP_PRIZE.qfLoser;
  if (t.stage === 2) loser.budget += CUP_PRIZE.sfLoser;
  if (t.stage === 3) {
    winner.budget += CUP_PRIZE.winner;
    loser.budget += CUP_PRIZE.runnerUp;
    s.cup.holder = winner.id;
    s.news.unshift(`${CUP_NAME} 우승: ${winner.name}! 상금 ${CUP_PRIZE.winner}억 (준우승 ${loser.name} ${CUP_PRIZE.runnerUp}억).`);
  }
  if (pendingCupTies(s).length === 0) closeCupStage(s);
}

/** Every tie of the stage has a result: move on and make the next draw. */
function closeCupStage(s: GameState): void {
  s.cup.stage++;
  s.pendingCupDay = false;
  if (!cupDone(s)) {
    const ties = drawCupRound(s, s.cup.stage);
    if (ties.some((t) => t.home === s.userClub || t.away === s.userClub)) {
      const t = ties.find((x) => x.home === s.userClub || x.away === s.userClub)!;
      const opp = clubOf(s, t.home === s.userClub ? t.away : t.home);
      s.news.unshift(`${CUP_NAME} ${CUP_STAGE_LABEL[s.cup.stage]} 대진: ${opp.name}과(와) ${t.home === s.userClub ? "홈" : "원정"} 경기.`);
    }
  }
}

/** Simulate the open ties of the current cup stage headlessly (the user's too, if asked). */
export function simulateCupDay(s: GameState, opts: MatchOptions = {}, includeUser = true): void {
  prepareRound(s);
  for (const t of pendingCupTies(s)) {
    if (!includeUser && (t.home === s.userClub || t.away === s.userClub)) continue;
    const m = createCupMatch(s, t, opts);
    m.runToEnd();
    recordCupResult(s, t, m);
  }
}

/** Close the cup matchday once every tie is decided: a midweek passes (light recovery, no wages/training). */
export function advanceCupDay(s: GameState): boolean {
  if (s.pendingCupDay && pendingCupTies(s).length) return false;
  for (const c of s.clubs) for (const p of c.squad) {
    p.condition = Math.min(1, p.condition + 0.4);
    p.injuryDays = Math.max(0, p.injuryDays - 3);
  }
  // Normally the next stage waits for its own league round; a save that fell behind catches up at once.
  s.pendingCupDay = cupDayDue(s);
  return true;
}

/** Cup prize money collected by a club this season (for the review screen). */
export function cupPrize(s: GameState, club: number): number {
  let sum = 0;
  for (const t of s.cup.ties) {
    const w = tieWinner(t);
    if (w === null || (t.home !== club && t.away !== club)) continue;
    const won = w === club;
    if (t.stage === 1 && !won) sum += CUP_PRIZE.qfLoser;
    if (t.stage === 2 && !won) sum += CUP_PRIZE.sfLoser;
    if (t.stage === 3) sum += won ? CUP_PRIZE.winner : CUP_PRIZE.runnerUp;
  }
  return sum;
}
