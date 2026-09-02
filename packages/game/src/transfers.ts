import type { Club, GameState, SquadPlayer, TransferOffer } from "./types";
import { overall } from "./rating";
import { autoSelect, repairSelection } from "./selection";
import { clubOf, playerOf, seasonOver, table } from "./season";
import { wageFor } from "./contracts";
import { spendGrowth, weeklyRate } from "./training";

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

type Rand = { next(): number };
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

/** Key of the window currently open (one AI purchase per club per window). */
function windowKey(s: GameState): string {
  return `${s.season}:${s.round === 0 ? "pre" : seasonOver(s) ? "post" : "winter"}`;
}

/** Players of a club that can actually be traded (not borrowed, not away on loan). */
const tradeable = (p: SquadPlayer): boolean => !p.onLoan && p.loanFrom === undefined;
const playing = (c: Club): SquadPlayer[] => c.squad.filter((p) => !p.onLoan);
const isStarter = (c: Club, p: SquadPlayer): boolean => c.selection.starters.includes(p.id);

/** Lowest-value players an over-full AI club wants rid of (squad − SURPLUS_ABOVE of them). */
export function surplusPlayers(club: Club): SquadPlayer[] {
  const extra = club.squad.length - SURPLUS_ABOVE;
  if (extra <= 0) return [];
  return [...club.squad].filter(tradeable).sort((a, b) => playerValue(a) - playerValue(b)).slice(0, extra);
}

/** What a club wants for one of its players, or null if it will not sell. */
export function askingPrice(club: Club, p: SquadPlayer): number | null {
  if (club.squad.length <= MIN_SQUAD || !tradeable(p)) return null;
  if (surplusPlayers(club).includes(p)) return playerValue(p);
  const ranked = [...club.squad].sort((a, b) => ovr(b) - ovr(a));
  const rank = ranked.indexOf(p);
  const premium = rank < 3 ? 1.5 : rank < 8 ? 1.25 : 1.1;
  return Math.round(playerValue(p) * premium);
}

export interface TransferTarget {
  club: Club;
  player: SquadPlayer;
  price: number | null;
  value: number;
}

export function transferTargets(s: GameState): TransferTarget[] {
  const out: TransferTarget[] = [];
  for (const club of s.clubs) {
    if (club.id === s.userClub) continue;
    for (const player of club.squad) out.push({ club, player, price: askingPrice(club, player), value: playerValue(player) });
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

/** Move a player between clubs for a fee: squads, budgets, shirt number, both selections. */
function movePlayer(s: GameState, from: Club, to: Club, p: SquadPlayer, fee: number): void {
  from.squad = from.squad.filter((q) => q !== p);
  from.budget = round1(from.budget + fee);
  reselect(s, from);
  moveNumber(to, p);
  p.condition = 1;
  to.squad.push(p);
  to.budget = round1(to.budget - fee);
  reselect(s, to);
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
  return table(s).findIndex((r) => r.club === clubId) + 1;
}

/**
 * Would the player rather stay? A starter at a clearly bigger club (reputation, or league position
 * once the table means something) turns the user down with some probability; the answer holds for the season.
 */
export function refusalChance(s: GameState, from: Club, p: SquadPlayer): number {
  const me = clubOf(s, s.userClub);
  if (!isStarter(from, p)) return 0;
  const myPos = positionOf(s, me.id), theirPos = positionOf(s, from.id);
  const gap = myPos !== null && theirPos !== null ? (myPos - theirPos) / 2.5 : from.reputation - me.reputation;
  if (gap < 1.5) return 0;
  return gap >= 2.5 ? 0.8 : 0.55;
}

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
  const asking = askingPrice(from, p);
  if (asking === null) return err(`${from.name}은(는) 스쿼드가 얇아 팔지 않습니다`);
  fee = Math.round(fee);
  if (!(fee > 0)) return err("제시액이 올바르지 않습니다");
  if (me.budget < fee) return err(`예산 부족 (필요 ${fee}억, 보유 ${me.budget}억)`);
  if (me.squad.length >= MAX_SQUAD) return err(`스쿼드 상한 ${MAX_SQUAD}명`);
  if (p.refusedSeason === s.season) return { status: "refused", text: `${p.name}은(는) 이번 시즌 ${me.shortName} 이적을 거부했습니다.` };

  const threshold = Math.round(asking * acceptFactor(s, from));
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
  const price = askingPrice(from, p);
  if (price === null) return `${from.name}은(는) 스쿼드가 얇아 팔지 않습니다`;
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
    // Better players are wanted by everyone; a club pays more when the player would start for them.
    const need = roleGap(club, p) > 0 ? 1.1 : 0.85;
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

/**
 * AI clubs bid for the user's players who would start for them: 0–2 offers a week (one more on deadline
 * day), fee 0.8–1.1 × value — richer and needier clubs bid higher. Offers lapse after OFFER_TTL rounds.
 */
export function incomingOffers(s: GameState, rng: Rand): TransferOffer[] {
  const me = clubOf(s, s.userClub);
  const made: TransferOffer[] = [];
  if (!windowOpen(s) || me.squad.filter(tradeable).length <= MIN_SQUAD) return made;
  const deadline = deadlineDay(s);
  const cap = deadline ? 3 : 2;
  const clubs = [...s.clubs].filter((c) => c.id !== s.userClub).sort(() => 0.5 - rng.next());
  for (const club of clubs) {
    if (made.length >= cap) break;
    if (club.squad.length >= MAX_SQUAD - 1 || club.budget <= 0) continue;
    if (rng.next() > (deadline ? 0.45 : 0.25)) continue;
    const wants = me.squad
      .filter((p) => tradeable(p) && !s.offers.some((o) => o.from === club.id && o.playerId === p.id && (o.status === "open" || o.status === "countered")))
      .map((p) => ({ p, gap: roleGap(club, p), value: playerValue(p) }))
      .filter((x) => x.gap > 0.5 && x.value * 0.8 <= club.budget)
      .sort((a, b) => ovr(b.p) - ovr(a.p));
    const pick = wants[Math.floor(rng.next() * Math.min(3, wants.length))];
    if (!pick) continue;
    const rich = clamp(club.budget / (3 * pick.value), 0, 1);
    const need = clamp(pick.gap / 3, 0, 1);
    const fee = Math.max(1, Math.round(pick.value * (0.8 + 0.15 * rich + 0.15 * need)));
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
  const prob = clamp(1 - (fee - value * 1.15) / (value * 0.6), 0.05, 0.95) + (deadlineDay(s) ? 0.2 : 0);
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
  p.stats = { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 };
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
  const t = freeAgentTerms(p);
  if (me.budget < t.fee) return `계약금 부족 (필요 ${t.fee}억, 보유 ${me.budget}억)`;
  signFree(s, me, p);
  s.news.unshift(`${me.shortName}: 자유계약 ${p.name} 영입 (계약금 ${t.fee}억, 연봉 ${t.wage}억, ${t.years}년).`);
  return null;
}

/** Rollover for the unsigned: a year older, veterans lose a step, two seasons idle → gone. */
export function freeAgentRollover(s: GameState, newSeason: number, rng: Rand): void {
  s.freeAgents = s.freeAgents.filter((p) => (p.freeSince ?? newSeason) > newSeason - 2);
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
  s.news.unshift(`${me.shortName}: ${p.name} 임대 영입 (${from.shortName}, 시즌 종료까지, 연봉 ${p.wage}억 부담).`);
  return null;
}

/** Season rollover: every loan ends, borrowed players go home. */
export function returnLoans(s: GameState): void {
  for (const l of s.loans) {
    const from = clubOf(s, l.from), to = clubOf(s, l.to);
    const stayed = from.squad.find((q) => q.id === l.playerId);
    if (stayed) { stayed.onLoan = undefined; if (from.id === s.userClub) s.news.unshift(`${from.shortName}: ${stayed.name} 임대 복귀 (${to.shortName}).`); continue; }
    const borrowed = to.squad.find((q) => q.id === l.playerId);
    if (!borrowed) continue;
    to.squad = to.squad.filter((q) => q !== borrowed);
    borrowed.loanFrom = undefined;
    moveNumber(from, borrowed);
    from.squad.push(borrowed);
    if (to.id === s.userClub) s.news.unshift(`${to.shortName}: 임대 선수 ${borrowed.name} ${from.shortName}(으)로 복귀.`);
  }
  s.loans = [];
  for (const c of s.clubs) reselect(s, c);
}

// ------------------------------------------------------------------ AI market

/**
 * AI clubs strengthen their weakest line during a window: one purchase per club per window, from another
 * AI club's sellable players — over-full clubs' surplus men go at plain value and need less of an upgrade.
 */
export function aiTransfers(s: GameState, rng: Rand): void {
  if (!windowOpen(s)) return;
  const key = windowKey(s);
  s.aiDeals = s.aiDeals.filter((k) => k.startsWith(key + ":"));
  for (const club of s.clubs) {
    if (club.id === s.userClub || club.squad.length >= MAX_SQUAD - 1 || s.aiDeals.includes(`${key}:${club.id}`)) continue;
    const xi = club.selection.starters.map((id) => playerOf(club, id)).filter(Boolean);
    const weakest = xi.slice(1).sort((a, b) => ovr(a) - ovr(b))[0];
    if (!weakest) continue;
    const need = ovr(weakest);
    const candidates = transferTargets(s)
      .filter((t) => t.club.id !== club.id && t.player.role === weakest.role && t.price !== null && t.price <= club.budget)
      .filter((t) => ovr(t.player) >= need + (surplusPlayers(t.club).includes(t.player) ? 0.5 : 1.5))
      .sort((a, b) => ovr(b.player) / b.price! - ovr(a.player) / a.price!);
    const pick = candidates[0];
    if (!pick || rng.next() > (deadlineDay(s) ? 0.8 : 0.6)) continue;
    const from = pick.club;
    movePlayer(s, from, club, pick.player, pick.price!);
    s.aiDeals.push(`${key}:${club.id}`);
    s.news.unshift(`${club.shortName}: ${pick.player.name} 영입 (${from.shortName}, ${pick.price}억${surplusPlayers(from).length ? ", 잉여 자원 정리" : ""}).`);
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
    s.news.unshift(`${club.shortName}: 자유계약 ${pick.name} 영입 (계약금 ${t.fee}억).`);
  }
}

/** Loaned-out youngsters develop a little faster every week. */
export function loanWeek(s: GameState): void {
  for (const l of s.loans) {
    const p = clubOf(s, l.from).squad.find((q) => q.id === l.playerId);
    if (p?.onLoan && weeklyRate(p.age) > 0 && ovr(p) < p.potential) p.growth += LOAN_GROWTH;
  }
}

/** One market week (called after wages): offers lapse, new ones arrive, AI clubs trade and sign free agents. */
export function transferWeek(s: GameState, rng: Rand): void {
  loanWeek(s);
  expireOffers(s);
  if (!windowOpen(s)) return;
  incomingOffers(s, rng);
  aiSignFreeAgents(s);
  aiTransfers(s, rng);
}
