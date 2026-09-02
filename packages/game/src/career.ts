import { Rng } from "@3sec/engine";
import type { Club, ContractTalk, GameState, JobOffer } from "./types";
import { clubOf, seasonOver, table } from "./season";
import { roundsPerSeason } from "./fixtures";
import { expectedPositions } from "./managers";
import { ROLLOVER_SACK_BELOW, TRUST_AT, acceptJob, userExpectation, userPosition } from "./board";

/** Reputation floor a new manager starts on. */
export const REP_MIN_START = 5;
export const REP_MIN = 1;
export const REP_MAX = 20;
/** Reputation lost when the board pulls the trigger. */
export const REP_SACKED = -2;
/** Unsolicited approaches can arrive between these rounds. */
export const OFFER_FROM_ROUND = 5;
export const OFFER_UNTIL_ROUNDS_LEFT = 3;
/** Rounds an unsolicited offer stays on the table. */
export const OFFER_TTL = 2;
/** Weekly chance of an approach once a club qualifies. */
export const OFFER_CHANCE = 0.35;
/** A bigger club's manager needs this much board pressure before it looks elsewhere. */
export const OFFER_PRESSURE = 2;
/** Counter-offers above this multiple of the board's figure are refused outright. */
export const COUNTER_CAP = 1.5;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Reputation a fresh manager brings to a club: the club's minus two, at least REP_MIN_START. */
export const startingRep = (clubRep: number): number => round1(Math.max(REP_MIN_START, clubRep - 2));

/** Wage (억/season) a club offers a manager: 1 + 0.4 per point of club reputation above 8 + 0.3 per point of manager reputation above 8, ×1.15 after beating the expectation. */
export function offerWage(clubRep: number, managerRep: number, beatExpectation = false): number {
  const base = 1 + Math.max(0, clubRep - 8) * 0.4 + Math.max(0, managerRep - 8) * 0.3;
  return round1(Math.max(1, base * (beatExpectation ? 1.15 : 1)));
}

/** Contract length a board offers: three seasons for a big name, two as a rule, one for a struggling man. */
export function offerYears(managerRep: number, clubRep: number, beatExpectation: boolean): number {
  if (managerRep >= clubRep + 2 || (managerRep >= 14 && beatExpectation)) return 3;
  if (beatExpectation || managerRep >= clubRep) return 2;
  return 1;
}

/** 1..5 stars for the home card (rep 5 → 1, 17+ → 5). */
export const repStars = (rep: number): number => clamp(Math.round(1 + ((rep - 5) / 12) * 4), 1, 5);

export const repLabel = (rep: number): string => (rep >= 17 ? "명장" : rep >= 14 ? "검증된 감독" : rep >= 11 ? "유망한 감독" : rep >= 8 ? "무명 감독" : "초보 감독");

export const managerRep = (s: GameState): number => { if (typeof s.managerRep !== "number") migrateCareer(s); return s.managerRep!; };

/** Sign the user to a club: rep set only when missing, contract from the club's reputation. */
export function careerInit(s: GameState): void {
  const me = clubOf(s, s.userClub);
  if (typeof s.managerRep !== "number") s.managerRep = startingRep(me.reputation);
  s.managerContract = { until: s.season + 1, wage: offerWage(me.reputation, s.managerRep) };
  s.contractTalk = undefined;
  s.jobOffersPending = [];
}

/** Saves from before the career mode: reputation from the current club, a contract to the end of next season. */
export function migrateCareer(s: GameState): void {
  const me = s.clubs[s.userClub];
  if (!me) return;
  if (typeof s.managerRep !== "number") s.managerRep = startingRep(me.reputation);
  s.managerRep = clamp(round1(s.managerRep), REP_MIN, REP_MAX);
  if (!s.managerContract || typeof s.managerContract.until !== "number") s.managerContract = { until: s.season + 1, wage: offerWage(me.reputation, s.managerRep) };
  if (s.contractTalk && typeof s.contractTalk.wage !== "number") s.contractTalk = undefined;
  if (!Array.isArray(s.jobOffersPending)) s.jobOffersPending = [];
}

/** The user took a job (board.ts acceptJob): a two-season contract at the new club's rate. Called by acceptJob. */
export function careerOnNewJob(s: GameState, target: Club, offer?: JobOffer): void {
  migrateCareer(s);
  s.managerContract = offer ? { until: s.season + offer.years - (seasonOver(s) ? 0 : 1), wage: offer.wage } : { until: s.season + 1, wage: offerWage(target.reputation, s.managerRep!) };
  s.contractTalk = undefined;
  s.jobOffersPending = [];
}

const bump = (s: GameState, delta: number): number => { s.managerRep = clamp(round1(managerRep(s) + delta), REP_MIN, REP_MAX); return s.managerRep; };

export interface RepChange { before: number; after: number; reasons: string[] }

/**
 * Season verdict on the manager's standing, at the rollover after the user's board has spoken: ±0.3 per place
 * against the expectation (capped ±1.5), +1.5 for the title, +1 for the cup, +0.5 for a vote of confidence,
 * −0.5 for a rollover on thin ice, −2 for the sack. Returns the change for the review.
 */
export function careerRollover(s: GameState): RepChange {
  migrateCareer(s);
  const before = s.managerRep!;
  const reasons: string[] = [];
  const rows = table(s);
  const pos = rows.findIndex((r) => r.club === s.userClub) + 1;
  const exp = expectedPositions(s).get(s.userClub) ?? s.clubs.length;
  const sacked = !!s.board?.sacked;
  const byPlaces = clamp((exp - pos) * 0.3, -1.5, 1.5);
  if (byPlaces) { bump(s, byPlaces); reasons.push(`기대 ${exp}위 → ${pos}위 (${byPlaces > 0 ? "+" : ""}${round1(byPlaces)})`); }
  if (pos === 1) { bump(s, 1.5); reasons.push("리그 우승 (+1.5)"); }
  if (s.cup?.holder === s.userClub) { bump(s, 1); reasons.push("컵 우승 (+1)"); }
  if (!sacked && s.board.confidence >= TRUST_AT) { bump(s, 0.5); reasons.push("이사회 신임 (+0.5)"); }
  else if (!sacked && s.board.confidence < ROLLOVER_SACK_BELOW + 10) { bump(s, -0.5); reasons.push("이사회 불신 (−0.5)"); }
  if (sacked) { bump(s, REP_SACKED); reasons.push("경질 (−2)"); }
  if (sacked) { s.managerContract = undefined; s.contractTalk = undefined; s.jobOffersPending = []; }
  else if (s.contractTalk) {
    // an unanswered offer at the rollover is taken as signed
    acceptContract(s);
    s.news.unshift(`${clubOf(s, s.userClub).shortName}: 답이 없어 이사회 제시안대로 계약이 연장된 것으로 처리됐습니다.`);
  } else if (!s.managerContract || s.managerContract.until <= s.season) {
    // a lapsed contract without a talk (older saves): the board rolls it on a season at the going rate
    s.managerContract = { until: s.season + 1, wage: offerWage(clubOf(s, s.userClub).reputation, s.managerRep!) };
  }
  const after = s.managerRep!;
  if (after !== before) s.news.unshift(`감독 평판 ${before} → ${after} (${reasons.join(", ")}).`);
  return { before, after, reasons };
}

/** Is the manager's contract up at the end of this season? */
export const contractExpiring = (s: GameState): boolean => !!s.managerContract && s.managerContract.until <= s.season;

/**
 * Open the season-end negotiation when the contract runs out this season and the board is not about to sack
 * the manager: years and wage from reputation and the finish. Called by careerWeek once the season is over.
 */
export function openContractTalk(s: GameState): ContractTalk | null {
  migrateCareer(s);
  if (s.contractTalk || s.board?.sacked || !contractExpiring(s)) return s.contractTalk ?? null;
  if (s.board.confidence < ROLLOVER_SACK_BELOW) return null;
  const me = clubOf(s, s.userClub);
  const pos = userPosition(s), exp = userExpectation(s);
  const beat = pos <= exp;
  const rep = s.managerRep!;
  s.contractTalk = { season: s.season, years: offerYears(rep, me.reputation, beat), wage: offerWage(me.reputation, rep, beat), countered: false };
  s.news.unshift(`${me.shortName} 이사회가 재계약을 제안했습니다: ${s.contractTalk.years}년, 연봉 ${s.contractTalk.wage}억.`);
  return s.contractTalk;
}

/** Sign the offer on the table. */
export function acceptContract(s: GameState): string | null {
  const t = s.contractTalk;
  if (!t) return "진행 중인 협상이 없습니다.";
  s.managerContract = { until: t.season + t.years, wage: t.wage };
  s.contractTalk = undefined;
  s.news.unshift(`${clubOf(s, s.userClub).shortName}: ${s.managerName} 감독 재계약 (~S${s.managerContract.until}, 연봉 ${t.wage}억).`);
  return null;
}

export interface CounterResult { ok: boolean; wage: number; chance: number; error?: string }

/** Odds the board meets an ask: 0.35 + 0.08 per point of rep over the club's + 0.05 per place above the expectation − 1.2 × the mark-up, clamped 0.05..0.9. */
export function counterChance(s: GameState, askWage: number): number {
  const t = s.contractTalk;
  if (!t) return 0;
  const me = clubOf(s, s.userClub);
  const markup = askWage / t.wage - 1;
  return clamp(0.35 + (managerRep(s) - me.reputation) * 0.08 + (userExpectation(s) - userPosition(s)) * 0.05 - markup * 1.2, 0.05, 0.9);
}

/** One counter: ask for more. Success signs at the asked wage; refusal keeps the board's figure (no second try). */
export function counterContract(s: GameState, askWage: number): CounterResult {
  const t = s.contractTalk;
  if (!t) return { ok: false, wage: 0, chance: 0, error: "진행 중인 협상이 없습니다." };
  if (t.countered) return { ok: false, wage: t.wage, chance: 0, error: "역제안은 한 번만 할 수 있습니다." };
  const ask = round1(askWage);
  if (!(ask > t.wage)) return { ok: false, wage: t.wage, chance: 0, error: "제시액보다 높은 금액을 부르세요." };
  t.countered = true;
  const me = clubOf(s, s.userClub);
  if (ask > t.wage * COUNTER_CAP) { s.news.unshift(`${me.shortName} 이사회가 연봉 ${ask}억 요구를 일축했습니다. 원안(${t.wage}억)은 유효합니다.`); return { ok: false, wage: t.wage, chance: 0 }; }
  const chance = counterChance(s, ask);
  const rng = new Rng((s.seed * 61 + s.season * 733 + Math.round(ask * 10) * 13 + 5) >>> 0);
  if (rng.next() < chance) {
    t.wage = ask;
    acceptContract(s);
    return { ok: true, wage: ask, chance };
  }
  s.news.unshift(`${me.shortName} 이사회가 연봉 ${ask}억 요구를 거절했습니다. 원안(${t.wage}억)은 유효합니다.`);
  return { ok: false, wage: t.wage, chance };
}

/** Walk away: the manager becomes a free agent (the sacked flow with reason "declined"); job offers follow. */
export function declineContract(s: GameState): string | null {
  if (!s.contractTalk) return "진행 중인 협상이 없습니다.";
  const rows = table(s);
  const idx = rows.findIndex((r) => r.club === s.userClub);
  s.contractTalk = undefined;
  s.managerContract = undefined;
  s.jobOffersPending = [];
  s.board.sacked = { season: s.season, round: s.round, position: idx + 1, expected: userExpectation(s), pts: rows[idx]?.pts ?? 0, reason: "declined" };
  s.board.lowWeeks = 0;
  s.news.unshift(`${clubOf(s, s.userClub).shortName}: ${s.managerName} 감독이 재계약을 거절하고 구단을 떠납니다.`);
  return null;
}

/**
 * Clubs open to a free-agent manager of this reputation: vacancies and dugouts under pressure first, then the
 * biggest club that would have him (reputation up to rep + 3), at most `n`. A name can pick a bigger club than
 * a sacked one (board.ts jobOffers ignores reputation).
 */
export function careerJobOffers(s: GameState, n = 3): Club[] {
  const rep = managerRep(s);
  const expected = expectedPositions(s);
  const rows = table(s);
  const posOf = new Map(rows.map((r, i) => [r.club, i + 1]));
  const struggling = (c: Club): boolean => !c.manager || (c.pressure ?? 0) >= 1 || (posOf.get(c.id) ?? 0) - (expected.get(c.id) ?? 0) >= 3;
  const list = s.clubs
    .filter((c) => c.id !== s.userClub && c.reputation <= rep + 3)
    .sort((a, b) => Number(!!a.manager) - Number(!!b.manager) || Number(struggling(b)) - Number(struggling(a)) || b.reputation - a.reputation || a.id - b.id)
    .slice(0, n);
  if (list.length) return list;
  // nobody at that level: the smallest clubs will still talk
  return s.clubs.filter((c) => c.id !== s.userClub).sort((a, b) => a.reputation - b.reputation || a.id - b.id).slice(0, Math.min(2, n));
}

/** Take a job from the sacked / free-agent screen: acceptJob plus a contract at the new club's rate. */
export function acceptCareerJob(s: GameState, clubId: number): string | null {
  return acceptJob(s, clubId);
}

/** The offer on the table, if any. */
export const pendingJobOffer = (s: GameState): JobOffer | null => (s.jobOffersPending ?? [])[0] ?? null;

/** Clubs that might come calling this week: bigger than the user's, expecting someone of the manager's standing, dugout under pressure. */
export function approachCandidates(s: GameState): Club[] {
  const me = clubOf(s, s.userClub);
  const rep = managerRep(s);
  return s.clubs
    .filter((c) => c.id !== s.userClub && c.manager && c.reputation > me.reputation + 0.5 && rep >= c.reputation && (c.pressure ?? 0) >= OFFER_PRESSURE)
    .sort((a, b) => b.reputation - a.reputation || a.id - b.id);
}

/**
 * Weekly (advanceRound): expire a stale offer, maybe generate a new approach mid-season, and open the contract
 * talk once the season is over. Returns the new offer, if one arrived.
 */
export function careerWeek(s: GameState): JobOffer | null {
  migrateCareer(s);
  if (s.board?.sacked) { s.jobOffersPending = []; return null; }
  const offers = s.jobOffersPending!;
  for (const o of [...offers]) if (o.expires <= s.round) {
    offers.splice(offers.indexOf(o), 1);
    s.news.unshift(`${clubOf(s, o.club).shortName}의 감독직 제안이 만료됐습니다.`);
  }
  if (seasonOver(s)) { openContractTalk(s); return null; }
  const rounds = roundsPerSeason(s.clubs.length);
  if (offers.length || s.round < OFFER_FROM_ROUND || s.round > rounds - OFFER_UNTIL_ROUNDS_LEFT) return null;
  const cands = approachCandidates(s);
  if (!cands.length) return null;
  const rng = new Rng((s.seed * 67 + s.season * 887 + s.round * 29 + 9) >>> 0);
  if (rng.next() >= OFFER_CHANCE) return null;
  const club = cands[0]!;
  const offer: JobOffer = { club: club.id, wage: offerWage(club.reputation, s.managerRep!, true), years: 2, expires: s.round + OFFER_TTL };
  offers.push(offer);
  s.news.unshift(`${club.name} 구단이 감독직을 제안했습니다 (${offer.years}년, 연봉 ${offer.wage}억, ${OFFER_TTL}라운드 내 답변).`);
  return offer;
}

/** Take the mid-season approach: the switch itself is board.ts acceptJob (forced), the contract comes from the offer. */
export function acceptJobOffer(s: GameState): string | null {
  const o = pendingJobOffer(s);
  if (!o) return "진행 중인 제안이 없습니다.";
  const target = clubOf(s, o.club);
  const err = acceptJob(s, o.club, true);
  if (err) return err;
  careerOnNewJob(s, target, o);
  return null;
}

/** Turn the approach down. */
export function declineJobOffer(s: GameState): string | null {
  const o = pendingJobOffer(s);
  if (!o) return "진행 중인 제안이 없습니다.";
  s.jobOffersPending = [];
  s.news.unshift(`${s.managerName} 감독이 ${clubOf(s, o.club).shortName}의 제안을 거절했습니다.`);
  return null;
}
