import { difficultyOf } from "./difficulty";
import { FOREIGN_PREMIUM, FOREIGN_QUOTA, foreignCount, isForeignPlayer } from "./foreign";
import { scenarioBlock } from "./scenario";
import { isForeignId } from "./continental";
import { divisionOf } from "./divisions";
import type { Club, GameState, ManagerTraits, MarketEntry, MarketKind, SquadPlayer, TransferOffer } from "./types";
import { scoutReport, staffWeek, type ScoutReport } from "./staff";
import { overall } from "./rating";
import { autoSelect, repairSelection } from "./selection";
import { clubOf, playerOf, seasonOver, table } from "./season";
import { wageFor } from "./contracts";
import { spendGrowth, weeklyRate } from "./training";
import { fansTransfer } from "./fans";
import { moraleOfferRefused } from "./morale";
import { divisionPosition, pyramidByReputation, pyramidPosition } from "./divisions";

/** Currency unit: 억원 (100 million KRW). */
export const MIN_SQUAD = 16;
export const MAX_SQUAD = 25;
/** An AI club with more players than this lists its lowest-value men at plain value. */
export const SURPLUS_ABOVE = 23;
/** An AI club with fewer players than this signs free agents. */
export const THIN_SQUAD = 20;
/** Open offers lapse after this many rounds. */
export const OFFER_TTL = 2;
export const MAX_FREE_AGENTS = 20;
/** Weekly development bonus for a youngster out on loan (growth points). */
export const LOAN_GROWTH = 0.02;
/** Free agent terms: signing fee share of value, wage premium over the going rate. */
export const FREE_AGENT_FEE = 0.3;
export const FREE_AGENT_WAGE = 1.2;
/** Purchases an AI club may make in one window. */
export const AI_DEALS_PER_WINDOW = 2;
/** How much better than the starter he replaces a foreign signing must be for an AI club to bother. */
export const AI_FOREIGN_MARGIN = 2;
/** An AI club with more than this in the bank (억원) gets an extra deal per window and shops for any weak starter. */
export const RICH_BUDGET = 60;
/** Lines kept in the league-wide market log. */
export const MARKET_LOG_MAX = 80;
/** An AI club with more players than this may loan a surplus youngster out (one per season). */
const AI_LOAN_ABOVE = 21;
const AI_LOAN_MAX_AGE = 22;

type Rand = { next(): number };
/** A club without an AI manager (the user's) trades by the book. */
const NEUTRAL: ManagerTraits = { attack: 0.5, possession: 0.5, pressing: 0.5, pragmatism: 0.5, youth: 0.5, spending: 0.5, stubborn: 0.5, temper: 0.5 };
const traitsOf = (c: Club): ManagerTraits => c.manager?.traits ?? NEUTRAL;
/** Market policy flags read off the manager's traits. */
const policy = (c: Club) => { const t = traitsOf(c); return { youth: t.youth > 0.6, spender: t.spending > 0.6, frugal: t.spending < 0.35, stubborn: t.stubborn > 0.6 }; };
const round1 = (x: number): number => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const ovr = (p: SquadPlayer): number => overall(p.attrs, p.role);

/** Market value from role rating and age: 10 → 5억, 12 → 12억, 14 → 29억, 16 → 70억. */
export function playerValue(p: SquadPlayer): number {
  const o = ovr(p);
  const ageFactor = p.age <= 23 ? 1.25 : p.age <= 28 ? 1 : p.age <= 31 ? 0.7 : 0.4;
  return Math.max(1, Math.round(5 * Math.pow(1.55, o - 10) * ageFactor));
}

/** Starting budget by reputation; refilled each season with prize money. */
export function seasonBudget(reputation: number, position: number | null): number {
  const base = Math.round(20 + (reputation - 10) * 12);
  const prize = position === null ? 0 : Math.max(0, 60 - (position - 1) * 5);
  return base + prize;
}

/** Pre-season, the winter window (before rounds 11-12) and the off-season are open. */
export function windowOpen(s: GameState): boolean {
  return s.round === 0 || s.round === 10 || s.round === 11 || seasonOver(s);
}

/** Last week of a window: before R1 and before R12. AI clubs deal more freely. */
export function deadlineDay(s: GameState): boolean {
  return s.round === 0 || s.round === 11;
}

/** Key of the window currently open (AI_DEALS_PER_WINDOW purchases per club per window). */
function windowKey(s: GameState): string {
  return `${s.season}:${s.round === 0 ? "pre" : seasonOver(s) ? "post" : "winter"}`;
}

/** Players of a club that can actually be traded (not borrowed, not away on loan). */
const tradeable = (p: SquadPlayer): boolean => !p.onLoan && p.loanFrom === undefined;

/** What a relegated club's players go for: a third off, which is what gets a squad broken up. */
export const RELEGATION_DISCOUNT = 0.68;
const playing = (c: Club): SquadPlayer[] => c.squad.filter((p) => !p.onLoan);
const isStarter = (c: Club, p: SquadPlayer): boolean => c.selection.starters.includes(p.id);

/** Lowest-value players an over-full AI club wants rid of (squad − SURPLUS_ABOVE of them). */
export function surplusPlayers(club: Club): SquadPlayer[] {
  const extra = club.squad.length - SURPLUS_ABOVE;
  if (extra <= 0) return [];
  return [...club.squad].filter(tradeable).sort((a, b) => playerValue(a) - playerValue(b)).slice(0, extra);
}

/**
 * What a club wants for one of its players, or null if it will not sell. The manager's policy colours the
 * price: a youth man wants 1.6× for a prospect (≤ 21), a hard negotiator adds 10%, a frugal one lets
 * surplus go at 90%.
 */
export function askingPrice(club: Club, p: SquadPlayer): number | null {
  if (club.squad.length <= MIN_SQUAD || !tradeable(p)) return null;
  const pol = policy(club);
  const surplus = surplusPlayers(club).includes(p);
  let price: number;
  if (surplus) price = playerValue(p) * (pol.frugal ? 0.9 : 1);
  else {
    const ranked = [...club.squad].sort((a, b) => ovr(b) - ovr(a));
    const rank = ranked.indexOf(p);
    price = playerValue(p) * (rank < 3 ? 1.5 : rank < 8 ? 1.25 : 1.1);
  }
  if (pol.youth && p.age <= 21) price *= 1.6;
  if (pol.stubborn) price *= 1.1;
  // Relegation is a fire sale: the wages no longer fit the income, the best players want top-flight
  // football, and everyone in the market knows it. Without this a relegated side keeps its whole
  // squad and simply walks back up, which is the opposite of what relegation should cost.
  if (club.firesale) price *= RELEGATION_DISCOUNT;
  return Math.round(price);
}

export interface TransferTarget {
  club: Club;
  player: SquadPlayer;
  price: number | null;
  value: number;
  /** the selling club plays abroad (continental.ts): the price carries FOREIGN_PREMIUM */
  abroad?: boolean;
  /** the user's scout's 관찰 보고 (potential estimate); absent without a scout */
  report?: ScoutReport;
}

/** The asking price as the buyer sees it: a club abroad adds FOREIGN_PREMIUM. */
export function askingPriceFor(s: GameState, from: Club, p: SquadPlayer): number | null {
  const base = askingPrice(from, p);
  return base === null ? null : isForeignId(from.id) ? Math.round(base * FOREIGN_PREMIUM) : base;
}

export function transferTargets(s: GameState): TransferTarget[] {
  const out: TransferTarget[] = [];
  const me = s.clubs[s.userClub]!;
  for (const club of [...s.clubs, ...(s.foreign ?? [])]) {
    if (club.id === s.userClub) continue;
    const abroad = isForeignId(club.id);
    for (const player of club.squad) {
      const t: TransferTarget = { club, player, price: askingPriceFor(s, club, player), value: playerValue(player), ...(abroad ? { abroad } : {}) };
      const report = scoutReport(me, player, s.season);
      if (report) t.report = report;
      out.push(t);
    }
  }
  return out.sort((a, b) => ovr(b.player) - ovr(a.player));
}

function moveNumber(to: Club, p: SquadPlayer): void {
  const used = new Set(to.squad.map((q) => q.number));
  if (!used.has(p.number)) return;
  for (let n = 2; n < 100; n++) if (!used.has(n)) { p.number = n; return; }
}

function reselect(s: GameState, c: Club): void {
  c.selection = c.id === s.userClub ? repairSelection(c) : autoSelect(c, c.selection.formation);
}

/** Append a completed deal to the league-wide market log (newest first, capped). */
function logMarket(s: GameState, kind: MarketKind, p: SquadPlayer, to: Club, fee: number, from?: Club): void {
  if (!Array.isArray(s.marketLog)) s.marketLog = [];
  const text = kind === "free" ? `${to.shortName}: ${p.name} 자유계약 영입 (계약금 ${fee}억)`
    : kind === "loan" ? `${from!.shortName} → ${to.shortName}: ${p.name} 시즌 임대`
    : `${from!.shortName} → ${to.shortName}: ${p.name} 이적 (${fee}억)`;
  const entry: MarketEntry = { season: s.season, text, kind, fee, to: to.id, playerId: p.id, playerName: p.name };
  if (from) entry.from = from.id;
  s.marketLog.unshift(entry);
  if (s.marketLog.length > MARKET_LOG_MAX) s.marketLog.length = MARKET_LOG_MAX;
}

export interface MarketSummary {
  transfers: number;
  loans: number;
  frees: number;
  /** the season's biggest fee, if anyone paid one */
  biggest: MarketEntry | null;
  /** the user's arrivals (transfers, loans in, free agents) and departures (sales, loans out) */
  userIn: MarketEntry[];
  userOut: MarketEntry[];
}

/** Counts and highlights of one season's market activity from the log. */
export function marketSummary(s: GameState, season: number = s.season): MarketSummary {
  const rows = (s.marketLog ?? []).filter((e) => e.season === season);
  const out: MarketSummary = { transfers: 0, loans: 0, frees: 0, biggest: null, userIn: [], userOut: [] };
  for (const e of rows) {
    if (e.kind === "transfer") out.transfers++; else if (e.kind === "loan") out.loans++; else out.frees++;
    if (e.fee > 0 && (!out.biggest || e.fee > out.biggest.fee)) out.biggest = e;
    if (e.to === s.userClub) out.userIn.push(e);
    if (e.from === s.userClub) out.userOut.push(e);
  }
  return out;
}

/** Move a player between clubs for a fee: squads, budgets, shirt number, both selections. */
function movePlayer(s: GameState, from: Club, to: Club, p: SquadPlayer, fee: number): void {
  fansTransfer(s, from, to, p);
  from.squad = from.squad.filter((q) => q !== p);
  from.budget = round1(from.budget + fee);
  reselect(s, from);
  moveNumber(to, p);
  p.condition = 1;
  to.squad.push(p);
  to.budget = round1(to.budget - fee);
  reselect(s, to);
  logMarket(s, "transfer", p, to, fee, from);
  // Any open offers for a player who has left are void.
  for (const o of s.offers) if (o.playerId === p.id && (o.status === "open" || o.status === "countered")) o.status = "expired";
}

/** How much better the player is than the club's best in his role (positive = he would start). */
function roleGap(club: Club, p: SquadPlayer): number {
  const theirBest = playing(club).filter((q) => q.role === p.role).map(ovr).sort((a, b) => b - a)[0] ?? 0;
  return ovr(p) - theirBest;
}

// ------------------------------------------------------------------ buying (bids)

export interface BidResult {
  status: "accepted" | "countered" | "rejected" | "refused" | "error";
  text: string;
  /** the selling club's counter-price when countered */
  counter?: number;
}

/** The fraction of the asking price an AI club settles for: thin squads hold out, bloated or broke clubs sell cheap. */
export function acceptFactor(s: GameState, club: Club): number {
  let f = club.squad.length > 22 || club.budget < 0 ? 0.85 : 1 - 0.08 * clamp((club.squad.length - 19) / 3, 0, 1);
  if (deadlineDay(s)) f -= 0.04;
  return f;
}

/** League position of a club after round 5 (1-based), else null. */
function positionOf(s: GameState, clubId: number): number | null {
  if (s.round <= 5) return null;
  // a club's standing in its own division, so a second-division leader reads as a leader
  return divisionPosition(s, clubId);
}

/**
 * Would the player rather stay? A starter at a clearly bigger club (reputation, or league position
 * once the table means something) turns the user down with some probability; the answer holds for the season.
 */
/**
 * How reluctant a player is to move from `from` to `to`, 0..1.
 *
 * A player weighs the two clubs by where they stand in the pyramid, not by league position alone:
 * the top flight is where the football, the money and the attention are, so leading the second
 * division is a step down from surviving in the first. Comparing bare positions across divisions
 * made a second-tier leader look identical to a title-chasing top-flight club.
 *
 * Only a player who is a starter where he is has anything to lose. And a club just relegated is the
 * exception that makes the market move: its good players want out, so they barely refuse anyone.
 */
export function refusalChanceBetween(s: GameState, from: Club, to: Club, p: SquadPlayer): number {
  // From abroad the whole league is a step sideways at best: a starter over there rarely comes, and never
  // for the second division; a reserve is persuadable by a top-flight club.
  if (isForeignId(from.id)) {
    const top = divisionOf(to) === 1;
    return isStarter(from, p) ? (top ? 0.45 : 0.85) : top ? 0.15 : 0.55;
  }
  if (!isStarter(from, p)) return 0;
  // Before a table exists the standing comes from reputation instead of points.
  const settled = s.round > 5;
  const stand = (id: number) => (settled ? pyramidPosition(s, id) : pyramidByReputation(s, id));
  const gap = (stand(to.id) - stand(from.id)) / 2.5;
  if (gap < 1.5) return 0;
  const base = gap >= 2.5 ? 0.8 : 0.55;
  // A relegated club's dressing room is already halfway out of the door.
  return from.firesale ? base * 0.25 : base;
}

/** Reluctance to join the user's club, for the transfer screen. */
export function refusalChance(s: GameState, from: Club, p: SquadPlayer): number {
  return Math.min(0.95, refusalChanceBetween(s, from, clubOf(s, s.userClub), p) * difficultyOf(s).refusal);
}

/** Is this club playing the season that follows its relegation? (divisions.ts sets the flag.) */
export const justRelegated = (_s: GameState, c: Club): boolean => !!c.firesale;

/**
 * The user bids for a player. Fee ≥ asking × acceptFactor is taken; a bid within 80% of that may still be
 * accepted (chance rises with the bid, +20% on deadline day), otherwise the club counters once — at its asking
 * price, or 5% under it after a reasonable bid. Pass the counter back as `prior` for the one follow-up bid:
 * anything below it ends the talks. A wanted starter at a bigger club may simply refuse to come.
 */
export function makeBid(s: GameState, fromClubId: number, playerId: string, fee: number, rng: Rand, prior?: { counter: number }): BidResult {
  const me = clubOf(s, s.userClub);
  const from = clubOf(s, fromClubId);
  const p = from.squad.find((q) => q.id === playerId);
  const err = (text: string): BidResult => ({ status: "error", text });
  if (!p) return err("선수를 찾을 수 없습니다");
  if (!windowOpen(s)) return err("이적 시장이 닫혀 있습니다");
  const asking = askingPriceFor(s, from, p);
  if (asking === null) return err(`${from.name}은(는) 스쿼드가 얇아 팔지 않습니다`);
  if (isForeignPlayer(p) && foreignCount(me) >= FOREIGN_QUOTA) return err(`외국인 보유 한도 ${FOREIGN_QUOTA}명 (현재 ${foreignCount(me)}명)`);
  const blocked = scenarioBlock(s, "transfer", p);
  if (blocked) return err(blocked);
  fee = Math.round(fee);
  if (!(fee > 0)) return err("제시액이 올바르지 않습니다");
  if (me.budget < fee) return err(`예산 부족 (필요 ${fee}억, 보유 ${me.budget}억)`);
  if (me.squad.length >= MAX_SQUAD) return err(`스쿼드 상한 ${MAX_SQUAD}명`);
  if (p.refusedSeason === s.season) return { status: "refused", text: `${p.name}은(는) 이번 시즌 ${me.shortName} 이적을 거부했습니다.` };

  const threshold = Math.round(asking * acceptFactor(s, from) * difficultyOf(s).askMarkup);
  let accepted = fee >= threshold || (prior !== undefined && fee >= prior.counter);
  if (!accepted && fee >= threshold * 0.8) {
    const p1 = (0.5 * (fee - threshold * 0.8)) / (threshold * 0.2) + (deadlineDay(s) ? 0.2 : 0);
    accepted = rng.next() < p1;
  }
  if (!accepted) {
    if (prior) return { status: "rejected", text: `${from.shortName}: "${prior.counter}억 아래로는 없습니다." 협상 결렬.` };
    const counter = fee >= threshold * 0.7 ? Math.round(asking * 0.95) : asking;
    return { status: "countered", counter, text: `${from.shortName}: "${fee}억은 부족합니다. ${counter}억이면 보내겠습니다." (한 번 더 제시할 수 있습니다)`, };
  }
  // The clubs agree; now the player decides.
  if (rng.next() < refusalChance(s, from, p)) {
    p.refusedSeason = s.season;
    s.news.unshift(`${p.name} 이적 거부: ${me.shortName}행을 거절하고 ${from.shortName}에 남기로 했습니다.`);
    return { status: "refused", text: `${p.name}: "지금은 ${from.shortName}에서 주전으로 뛰고 싶습니다." 이적 거부.` };
  }
  movePlayer(s, from, me, p, fee);
  s.news.unshift(`${me.shortName}: ${p.name} 영입 (${from.shortName}, ${fee}억).`);
  return { status: "accepted", text: `${p.name} 영입 완료 (${fee}억).` };
}

/** Instant purchase at the asking price (kept for scripts/tests; the UI bids via makeBid). */
export function buyPlayer(s: GameState, fromClubId: number, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const from = clubOf(s, fromClubId);
  const p = from.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  const price = askingPriceFor(s, from, p);
  if (price === null) return `${from.name}은(는) 스쿼드가 얇아 팔지 않습니다`;
  { const blocked = scenarioBlock(s, "transfer", p); if (blocked) return blocked; }
  if (isForeignPlayer(p) && foreignCount(me) >= FOREIGN_QUOTA) return `외국인 보유 한도 ${FOREIGN_QUOTA}명 (현재 ${foreignCount(me)}명)`;
  if (me.budget < price) return `예산 부족 (필요 ${price}억, 보유 ${me.budget}억)`;
  if (me.squad.length >= MAX_SQUAD) return `스쿼드 상한 ${MAX_SQUAD}명`;
  movePlayer(s, from, me, p, price);
  s.news.unshift(`${me.shortName}: ${p.name} 영입 (${from.shortName}, ${price}억).`);
  return null;
}

// ------------------------------------------------------------------ selling (instant)

/** Best bid an AI club would make right now for one of the user's players. */
export function bestOffer(s: GameState, playerId: string): { club: Club; fee: number } | null {
  const me = clubOf(s, s.userClub);
  const p = playerOf(me, playerId);
  if (!p || !tradeable(p)) return null;
  const value = playerValue(p);
  let best: { club: Club; fee: number } | null = null;
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length >= MAX_SQUAD - 1) continue;
    // Better players are wanted by everyone; a club pays more when the player would start for them, a big spender more still.
    const pol = policy(club);
    if (pol.youth && p.age > 24 && roleGap(club, p) < STRONG_GAP) continue;
    const need = (roleGap(club, p) > 0 ? (pol.spender ? 1.2 : 1.1) : 0.85) * (pol.frugal ? 0.9 : 1);
    const fee = Math.round(value * need);
    if (fee <= club.budget && (!best || fee > best.fee)) best = { club, fee };
  }
  return best;
}

/** The user sells a player to the best bidder. Returns an error string or null. */
export function sellPlayer(s: GameState, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const p = me.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  if (p.loanFrom !== undefined) return "임대 선수는 팔 수 없습니다";
  if (p.onLoan) return "임대 중인 선수는 팔 수 없습니다";
  if (me.squad.length <= MIN_SQUAD) return `스쿼드는 최소 ${MIN_SQUAD}명이어야 합니다`;
  const offer = bestOffer(s, playerId);
  if (!offer) return "지금은 제안하는 구단이 없습니다";
  movePlayer(s, me, offer.club, p, offer.fee);
  s.news.unshift(`${me.shortName}: ${p.name} → ${offer.club.shortName} 이적 (${offer.fee}억).`);
  return null;
}

// ------------------------------------------------------------------ incoming offers

export const openOffers = (s: GameState): TransferOffer[] => s.offers.filter((o) => o.status === "open" || o.status === "countered");

/** Mark lapsed offers and drop everything that is no longer live. */
export function expireOffers(s: GameState, all = false): void {
  for (const o of s.offers) {
    if (o.status !== "open" && o.status !== "countered") continue;
    if (all || !windowOpen(s) || s.round >= o.expiresRound) o.status = "expired";
  }
  s.offers = openOffers(s);
}

/** A user player who would be a clear starter for an AI club (role gap ≥ this) draws a bid half the weeks. */
const STRONG_GAP = 2;
const STRONG_BID_CHANCE = 0.5;

/**
 * AI clubs bid for the user's players who would start for them: 0–2 offers a week (one more on deadline
 * day), fee 0.8–1.1 × value — richer and needier clubs bid higher. A club that sees a clear starter
 * (gap ≥ 2) in the user's squad bids for him with probability 0.5 regardless of its top need (at most two
 * such extra bids a week). Offers lapse after OFFER_TTL rounds.
 */
export function incomingOffers(s: GameState, rng: Rand): TransferOffer[] {
  const me = clubOf(s, s.userClub);
  const made: TransferOffer[] = [];
  if (!windowOpen(s) || me.squad.filter(tradeable).length <= MIN_SQUAD) return made;
  const deadline = deadlineDay(s);
  const cap = deadline ? 3 : 2;
  let strongBids = 0;
  const clubs = [...s.clubs].filter((c) => c.id !== s.userClub).sort(() => 0.5 - rng.next());
  for (const club of clubs) {
    if (made.length >= cap + 2) break;
    if (club.squad.length >= MAX_SQUAD - 1 || club.budget <= 0) continue;
    const pol = policy(club);
    // a frugal manager sits most windows out; a youth man only chases the young (or an outright star)
    if (pol.frugal && rng.next() < 0.5) continue;
    const wants = me.squad
      .filter((p) => tradeable(p) && !s.offers.some((o) => o.from === club.id && o.playerId === p.id && (o.status === "open" || o.status === "countered")))
      .map((p) => ({ p, gap: roleGap(club, p), value: playerValue(p) }))
      // a player who asked away (morale.ts transferRequest) draws bids even where he would not start
      .filter((x) => (x.gap > 0.5 || (x.p.transferRequest && x.gap > -1)) && x.value * 0.8 <= club.budget)
      .filter((x) => !pol.youth || x.p.age <= 24 || x.gap >= STRONG_GAP)
      .sort((a, b) => ovr(b.p) - ovr(a.p));
    const strong = wants.filter((x) => x.gap >= STRONG_GAP);
    let pick: (typeof wants)[number] | undefined;
    if (strong.length && strongBids < 2 && rng.next() < STRONG_BID_CHANCE) {
      pick = strong[Math.floor(rng.next() * strong.length)];
      strongBids++;
    } else {
      if (made.length - strongBids >= cap) continue;
      if (rng.next() > (deadline ? 0.45 : 0.25) + (pol.spender && deadline ? 0.15 : 0)) continue;
      pick = wants[Math.floor(rng.next() * Math.min(3, wants.length))];
    }
    if (!pick) continue;
    const rich = clamp(club.budget / (3 * pick.value), 0, 1);
    const need = clamp(pick.gap / 3, 0, 1);
    const fee = Math.max(1, Math.round(pick.value * (0.8 + 0.15 * rich + 0.15 * need) * (pol.spender ? 1.15 : 1)));
    if (fee > club.budget) continue;
    const offer: TransferOffer = { id: `o${s.season}-${s.round}-${club.id}-${pick.p.id}`, from: club.id, playerId: pick.p.id, fee, wageOffer: round1(wageFor(pick.p) * 1.1), expiresRound: s.round + OFFER_TTL, status: "open" };
    s.offers.push(offer);
    made.push(offer);
    s.news.unshift(`${club.shortName}이(가) ${pick.p.name}에게 ${fee}억 이적 제안 (가치 ${pick.value}억). 이적 탭에서 응답하세요.`);
  }
  return made;
}

function liveOffer(s: GameState, offerId: string): TransferOffer | null {
  const o = s.offers.find((x) => x.id === offerId);
  return o && (o.status === "open" || o.status === "countered") ? o : null;
}

/** Sell to the bidding club at the fee on the table. Returns an error string or null. */
export function acceptOffer(s: GameState, offerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const o = liveOffer(s, offerId);
  if (!o) return "유효한 제안이 아닙니다";
  const p = me.squad.find((q) => q.id === o.playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  if (me.squad.filter(tradeable).length <= MIN_SQUAD) return `스쿼드는 최소 ${MIN_SQUAD}명이어야 합니다`;
  const buyer = clubOf(s, o.from);
  if (buyer.budget < o.fee || buyer.squad.length >= MAX_SQUAD) { o.status = "expired"; return `${buyer.name}이(가) 제안을 철회했습니다 (예산/스쿼드 사정)`; }
  o.status = "accepted";
  movePlayer(s, me, buyer, p, o.fee);
  s.offers = openOffers(s);
  s.news.unshift(`${me.shortName}: ${p.name} → ${buyer.shortName} 이적 (${o.fee}억, 제안 수락).`);
  return null;
}

export function rejectOffer(s: GameState, offerId: string): string | null {
  const o = liveOffer(s, offerId);
  if (!o) return "유효한 제안이 아닙니다";
  o.status = "rejected";
  s.offers = openOffers(s);
  // the player hears of it: an ambitious one sulks (morale.ts)
  const p = clubOf(s, s.userClub).squad.find((q) => q.id === o.playerId);
  if (p) moraleOfferRefused(p);
  return null;
}

export interface NegotiationResult { accepted: boolean; text: string }

/**
 * The user asks for more. The club accepts with probability 1 − (counter − 1.15·value) / (0.6·value)
 * (clamped 5–95%, +20% on deadline day) if it can afford it; a refused counter leaves the original fee on the
 * table, and a second counter makes them walk away.
 */
export function respondToCounter(s: GameState, offerId: string, fee: number, rng: Rand): NegotiationResult {
  const me = clubOf(s, s.userClub);
  const o = liveOffer(s, offerId);
  if (!o) return { accepted: false, text: "유효한 제안이 아닙니다" };
  const p = me.squad.find((q) => q.id === o.playerId);
  if (!p) return { accepted: false, text: "선수를 찾을 수 없습니다" };
  const buyer = clubOf(s, o.from);
  fee = Math.round(fee);
  if (!(fee > 0)) return { accepted: false, text: "금액이 올바르지 않습니다" };
  if (o.status === "countered") {
    o.status = "rejected";
    s.offers = openOffers(s);
    s.news.unshift(`${buyer.shortName}: ${p.name} 영입 협상 결렬.`);
    return { accepted: false, text: `${buyer.shortName}: "더는 협상하지 않겠습니다." 제안 철회.` };
  }
  if (fee <= o.fee) return acceptOffer(s, offerId) ? { accepted: false, text: "수락 처리에 실패했습니다" } : { accepted: true, text: `${buyer.shortName}이(가) ${fee}억에 동의했습니다.` };
  o.counterFee = fee;
  const value = playerValue(p);
  // a hard-nosed buyer is 20 points less likely to meet the user's counter
  const prob = clamp(1 - (fee - value * 1.15) / (value * 0.6), 0.05, 0.95) + (deadlineDay(s) ? 0.2 : 0) - (policy(buyer).stubborn ? 0.2 : 0);
  if (fee <= buyer.budget && buyer.squad.length < MAX_SQUAD && rng.next() < Math.min(0.95, prob)) {
    o.fee = fee;
    const err = acceptOffer(s, offerId);
    return err ? { accepted: false, text: err } : { accepted: true, text: `${buyer.shortName}이(가) ${fee}억 역제안을 받아들였습니다. 이적 완료.` };
  }
  o.status = "countered";
  return { accepted: false, text: `${buyer.shortName}: "${fee}억은 무리입니다. ${o.fee}억 제안은 유효합니다." (재역제안 시 철회)` };
}

// ------------------------------------------------------------------ free agents

/** Put a released player on the market (best MAX_FREE_AGENTS kept). */
export function releaseToMarket(s: GameState, p: SquadPlayer, season: number): void {
  p.freeSince = season;
  p.onLoan = undefined;
  p.loanFrom = undefined;
  p.contractUntil = season;
  p.wage = wageFor(p);
  p.condition = 1;
  p.injuryDays = 0;
  p.ban = 0;
  s.freeAgents.push(p);
  s.freeAgents.sort((a, b) => playerValue(b) - playerValue(a));
  if (s.freeAgents.length > MAX_FREE_AGENTS) s.freeAgents.length = MAX_FREE_AGENTS;
}

export function freeAgentTerms(p: SquadPlayer): { fee: number; wage: number; years: number } {
  return { fee: Math.max(1, Math.round(playerValue(p) * FREE_AGENT_FEE)), wage: round1(wageFor(p) * FREE_AGENT_WAGE), years: p.age <= 29 ? 2 : 1 };
}

function signFree(s: GameState, club: Club, p: SquadPlayer): { fee: number; wage: number } {
  const t = freeAgentTerms(p);
  s.freeAgents = s.freeAgents.filter((q) => q !== p);
  p.freeSince = undefined;
  p.wage = t.wage;
  // a contract signed mid-season covers this season; one signed after the final round starts next season
  p.contractUntil = s.season + t.years - (seasonOver(s) ? 0 : 1);
  p.stats = { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0, assists: 0, ratingSum: 0, ratedApps: 0, motm: 0 };
  p.form = [];
  moveNumber(club, p);
  club.squad.push(p);
  club.budget = round1(club.budget - t.fee);
  reselect(s, club);
  return t;
}

/** The user signs a free agent: fee 30% of value, wage 120% of the going rate. */
export function signFreeAgent(s: GameState, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const p = s.freeAgents.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  if (me.squad.length >= MAX_SQUAD) return `스쿼드 상한 ${MAX_SQUAD}명`;
  { const blocked = scenarioBlock(s, "free", p); if (blocked) return blocked; }
  if (isForeignPlayer(p) && foreignCount(me) >= FOREIGN_QUOTA) return `외국인 보유 한도 ${FOREIGN_QUOTA}명 (현재 ${foreignCount(me)}명)`;
  const t = freeAgentTerms(p);
  if (me.budget < t.fee) return `계약금 부족 (필요 ${t.fee}억, 보유 ${me.budget}억)`;
  signFree(s, me, p);
  logMarket(s, "free", p, me, t.fee);
  s.news.unshift(`${me.shortName}: 자유계약 ${p.name} 영입 (계약금 ${t.fee}억, 연봉 ${t.wage}억, ${t.years}년).`);
  return null;
}

/** Rollover for the unsigned: a year older, veterans lose a step, two seasons idle → gone. */
export function freeAgentRollover(s: GameState, newSeason: number, rng: Rand): void {
  // veterans nobody signed hang up their boots; everyone else gets at most two seasons on the market
  const retiring = s.freeAgents.filter((p) => p.age >= 33 || (p.age >= 31 && (p.freeSince ?? newSeason) < newSeason));
  for (const p of retiring) s.news.unshift(`${p.name}(${p.age}세) 은퇴 – 자유계약 시장에서 새 팀을 찾지 못했습니다.`);
  s.freeAgents = s.freeAgents.filter((p) => !retiring.includes(p) && (p.freeSince ?? newSeason) > newSeason - 2);
  for (const p of s.freeAgents) {
    p.age++;
    const rate = weeklyRate(p.age);
    if (rate < 0) { p.growth += rate * 22; spendGrowth(p, [], rng); }
    p.wage = wageFor(p);
  }
}

// ------------------------------------------------------------------ loans

/** The user's players who may go out on loan: youngsters or non-starters, not already involved in a loan. */
export function loanableOut(s: GameState): SquadPlayer[] {
  const me = clubOf(s, s.userClub);
  return me.squad.filter((p) => tradeable(p) && (p.age <= 23 || !isStarter(me, p)) && p.injuryDays === 0);
}

/** Best AI destination: the club (not over-full) where the player would be closest to the first team. */
export function loanDestination(s: GameState, p: SquadPlayer): Club | null {
  let best: { club: Club; score: number } | null = null;
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length >= MAX_SQUAD - 1) continue;
    const gap = roleGap(club, p);
    if (gap < -2) continue; // he would not play there either
    const score = gap + club.budget / 200;
    if (!best || score > best.score) best = { club, score };
  }
  return best?.club ?? null;
}

/** Loan a player out for the rest of the season: half his wage is covered, he grows a little faster. */
export function loanOut(s: GameState, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const p = me.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  if (!loanableOut(s).includes(p)) return "임대 보낼 수 없는 선수입니다 (주전이거나 이미 임대 관련)";
  if (playing(me).filter(tradeable).length - 1 < MIN_SQUAD) return `임대 후에도 ${MIN_SQUAD}명은 남아야 합니다`;
  const to = loanDestination(s, p);
  if (!to) return "임대를 원하는 구단이 없습니다";
  p.onLoan = true;
  s.loans.push({ playerId: p.id, from: me.id, to: to.id, until: s.season });
  me.selection = repairSelection(me);
  logMarket(s, "loan", p, to, 0, me);
  s.news.unshift(`${me.shortName}: ${p.name} → ${to.shortName} 시즌 임대 (연봉 50% 부담).`);
  return null;
}

export interface LoanTarget { club: Club; player: SquadPlayer }

/** AI non-starters (age ≤ 30, clubs with depth) available on a season loan for no fee. */
export function loanTargets(s: GameState): LoanTarget[] {
  const out: LoanTarget[] = [];
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length <= 18) continue;
    for (const player of club.squad) if (tradeable(player) && !isStarter(club, player) && player.age <= 30 && player.injuryDays === 0) out.push({ club, player });
  }
  return out.sort((a, b) => ovr(b.player) - ovr(a.player));
}

/** Borrow a player for the season: no fee, the user pays his full wage; he goes back at the rollover. */
export function loanIn(s: GameState, clubId: number, playerId: string): string | null {
  const me = clubOf(s, s.userClub);
  const from = clubOf(s, clubId);
  const p = from.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  { const blocked = scenarioBlock(s, "loan", p); if (blocked) return blocked; }
  if (!windowOpen(s)) return "이적 시장이 닫혀 있습니다";
  if (!loanTargets(s).some((t) => t.player === p)) return `${from.name}은(는) ${p.name}을(를) 임대하지 않습니다`;
  if (me.squad.length >= MAX_SQUAD) return `스쿼드 상한 ${MAX_SQUAD}명`;
  if (s.loans.filter((l) => l.to === me.id).length >= 2) return "임대 영입은 시즌당 2명까지입니다";
  from.squad = from.squad.filter((q) => q !== p);
  reselect(s, from);
  p.loanFrom = from.id;
  p.condition = 1;
  moveNumber(me, p);
  me.squad.push(p);
  reselect(s, me);
  s.loans.push({ playerId: p.id, from: from.id, to: me.id, until: s.season });
  logMarket(s, "loan", p, me, 0, from);
  s.news.unshift(`${me.shortName}: ${p.name} 임대 영입 (${from.shortName}, 시즌 종료까지, 연봉 ${p.wage}억 부담).`);
  return null;
}

/** Season rollover: every loan ends, borrowed players go home. */
export function returnLoans(s: GameState): void {
  for (const l of s.loans) {
    const from = clubOf(s, l.from), to = clubOf(s, l.to);
    const stayed = from.squad.find((q) => q.id === l.playerId);
    if (stayed) { stayed.onLoan = undefined; stayed.lastLoanClub = to.id; if (from.id === s.userClub) s.news.unshift(`${from.shortName}: ${stayed.name} 임대 복귀 (${to.shortName}).`); continue; }
    const borrowed = to.squad.find((q) => q.id === l.playerId);
    if (!borrowed) continue;
    to.squad = to.squad.filter((q) => q !== borrowed);
    borrowed.loanFrom = undefined;
    borrowed.lastLoanClub = to.id;
    moveNumber(from, borrowed);
    from.squad.push(borrowed);
    if (to.id === s.userClub) s.news.unshift(`${to.shortName}: 임대 선수 ${borrowed.name} ${from.shortName}(으)로 복귀.`);
  }
  s.loans = [];
  for (const c of s.clubs) reselect(s, c);
}

// ------------------------------------------------------------------ AI market

/**
 * AI clubs strengthen their weakest line during a window: up to AI_DEALS_PER_WINDOW purchases per club per
 * window (the second one less eagerly), from another AI club's sellable players — over-full clubs' surplus
 * men go at plain value and need less of an upgrade.
 */
export function aiTransfers(s: GameState, rng: Rand): void {
  if (!windowOpen(s)) return;
  const key = windowKey(s);
  s.aiDeals = s.aiDeals.filter((k) => k.startsWith(key + ":"));
  for (const club of s.clubs) {
    const done = s.aiDeals.filter((k) => k === `${key}:${club.id}`).length;
    const rich = club.budget >= RICH_BUDGET;
    if (club.id === s.userClub || club.squad.length >= MAX_SQUAD - 1 || done >= AI_DEALS_PER_WINDOW + (rich ? 1 : 0)) continue;
    const xi = club.selection.starters.map((id) => playerOf(club, id)).filter(Boolean);
    const weakOrder = xi.slice(1).sort((a, b) => ovr(a) - ovr(b));
    // A club sitting on money upgrades any of its three weakest starters, not only the single weakest.
    const weakSet = rich ? weakOrder.slice(0, 3) : weakOrder.slice(0, 1);
    if (!weakSet.length) continue;
    const needFor = new Map(weakSet.map((p) => [p.role, ovr(p)]));
    const pol = policy(club);
    // how far above value a manager will go: a big spender to 2×, a frugal one barely past the tag; money burns a hole in the pocket
    const maxRatio = (pol.spender ? 2 : pol.frugal ? 1.25 : 1.6) * (rich ? 1.25 : 1);
    // Abroad too, within the quota and one foreign signing per window: a flop from overseas is a bigger risk,
    // so the man has to be a clearer upgrade (AI_FOREIGN_MARGIN) than a domestic one.
    const canAbroad = foreignCount(club) < FOREIGN_QUOTA && !s.aiDeals.includes(`${key}:${club.id}:abroad`);
    const candidates = transferTargets(s)
      .filter((t) => !t.abroad || canAbroad)
      .filter((t) => t.club.id !== club.id && needFor.has(t.player.role) && t.price !== null && t.price <= club.budget && t.price <= t.value * maxRatio)
      .filter((t) => !pol.youth || t.player.age <= 24)
      .filter((t) => ovr(t.player) >= needFor.get(t.player.role)! + (surplusPlayers(t.club).includes(t.player) ? 0.5 : t.abroad ? AI_FOREIGN_MARGIN : 1.5))
      // A player has a say: a starter will not drop down the pyramid to sit in someone else's team
      // (transfers.ts refusalChanceBetween). Without this a moneyed second-division club simply buys
      // the top flight's best, which is not a transfer market so much as an auction.
      .filter((t) => refusalChanceBetween(s, t.club, club, t.player) < 0.5)
      .sort((a, b) => ovr(b.player) / b.price! - ovr(a.player) / a.price!);
    const pick = candidates[0];
    const eagerness = (pol.spender ? 1.2 : pol.frugal ? 0.5 : 1) * (rich ? 1.3 : 1);
    if (!pick || rng.next() > (deadlineDay(s) ? 0.8 : 0.6) * (done ? 0.6 : 1) * eagerness) continue;
    const from = pick.club;
    movePlayer(s, from, club, pick.player, pick.price!);
    s.aiDeals.push(`${key}:${club.id}`);
    if (pick.abroad) s.aiDeals.push(`${key}:${club.id}:abroad`);
    s.news.unshift(`${club.shortName}: ${pick.abroad ? "외국인 " : ""}${pick.player.name} 영입 (${from.shortName}, ${pick.price}억${!pick.abroad && surplusPlayers(from).length ? ", 잉여 자원 정리" : ""}).`);
  }
}

/** Thin AI squads pick the best free agent they can afford (one per club per week). */
export function aiSignFreeAgents(s: GameState): void {
  if (!windowOpen(s)) return;
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length >= THIN_SQUAD) continue;
    // veterans (the ones clubs just released) only interest a really short-handed club
    const pick = [...s.freeAgents]
      .sort((a, b) => ovr(b) + roleGap(club, b) * 0.5 - (ovr(a) + roleGap(club, a) * 0.5))
      .find((p) => freeAgentTerms(p).fee <= club.budget && (p.age <= 31 || club.squad.length < 18));
    if (!pick) continue;
    const t = signFree(s, club, pick);
    logMarket(s, "free", pick, club, t.fee);
    s.news.unshift(`${club.shortName}: 자유계약 ${pick.name} 영입 (계약금 ${t.fee}억).`);
  }
}

/**
 * AI clubs with depth (squad > 21) loan a surplus youngster (≤ 22, not a starter) to another AI club
 * that needs his role — at most one outgoing loan per club per season, roughly one in three weeks of a
 * window. The player moves for the season (loanFrom) and goes home at the rollover.
 */
export function aiLoans(s: GameState, rng: Rand): void {
  if (!windowOpen(s)) return;
  for (const from of s.clubs) {
    if (from.id === s.userClub || from.squad.length <= AI_LOAN_ABOVE) continue;
    if (s.loans.some((l) => l.from === from.id)) continue;
    // youth men loan youngsters out for minutes, frugal ones to save wages
    const pol = policy(from);
    if (rng.next() > (pol.youth || pol.frugal ? 0.5 : 0.35)) continue;
    const spare = from.squad
      .filter((p) => tradeable(p) && p.age <= AI_LOAN_MAX_AGE && !isStarter(from, p) && p.injuryDays === 0)
      .sort((a, b) => ovr(b) - ovr(a))[0];
    if (!spare) continue;
    let best: { club: Club; score: number } | null = null;
    for (const to of s.clubs) {
      if (to.id === s.userClub || to.id === from.id || to.squad.length >= MAX_SQUAD - 1) continue;
      const gap = roleGap(to, spare);
      const depth = playing(to).filter((q) => q.role === spare.role).length;
      if (gap < -1 && depth > 1) continue; // no need for him there
      const score = gap - depth * 0.5;
      if (!best || score > best.score) best = { club: to, score };
    }
    if (!best) continue;
    const to = best.club;
    from.squad = from.squad.filter((q) => q !== spare);
    reselect(s, from);
    spare.loanFrom = from.id;
    spare.condition = 1;
    moveNumber(to, spare);
    to.squad.push(spare);
    reselect(s, to);
    s.loans.push({ playerId: spare.id, from: from.id, to: to.id, until: s.season });
    logMarket(s, "loan", spare, to, 0, from);
    s.news.unshift(`${from.shortName}: ${spare.name}(${spare.age}세 ${spare.role}) → ${to.shortName} 시즌 임대.`);
  }
}

/** Loaned-out youngsters develop a little faster every week. */
export function loanWeek(s: GameState): void {
  for (const l of s.loans) {
    const p = clubOf(s, l.from).squad.find((q) => q.id === l.playerId);
    if (p?.onLoan && weeklyRate(p.age) > 0 && ovr(p) < p.potential) p.growth += LOAN_GROWTH;
  }
}

/** One market week (called after wages): the staff market ticks, offers lapse, new ones arrive, AI clubs trade and sign free agents. */
export function transferWeek(s: GameState, rng: Rand): void {
  staffWeek(s);
  loanWeek(s);
  expireOffers(s);
  if (!windowOpen(s)) return;
  incomingOffers(s, rng);
  aiSignFreeAgents(s);
  aiTransfers(s, rng);
  aiLoans(s, rng);
}
