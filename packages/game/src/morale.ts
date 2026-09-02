/**
 * 선수 개성·사기·주장·라커룸: every player has a personality (ambition, loyalty, temperament, professionalism — 0..1,
 * derived from the id so it never disturbs the world's dice and old saves migrate for free) and a morale (0..100,
 * start MORALE_START). Morale moves weekly with playing time against ambition, results, an expiring contract, a
 * refused offer, the locker-room pull and a drift toward the start value; professionalism dampens the swings.
 *
 * Effects: training growth ×0.85..1.15 (training.ts trainWeek), match attributes ±MATCH_ATTR_SWING (season.ts strip),
 * temperament costs composure/decisions on the pitch, and two weeks under MORALE_COMPLAINT_BELOW bring a complaint:
 * a transfer request (AI clubs bid more readily) or a week's training refusal.
 *
 * Hooks: `moraleWeek` from advanceRound (before training, so the week's minutes are still known), `moraleTrainingFactor`
 * from trainWeek, `matchAttrs` from teamDef's strip, `moraleOfferRefused` from transfers.rejectOffer,
 * `moraleRollover` from startNextSeason, `migrateMorale` from save.deserialize.
 */
import type { Attributes } from "@3sec/engine";
import type { Club, GameState, Personality, SquadPlayer } from "./types";
import { overall } from "./rating";

// ------------------------------------------------------------------ tuning

export const MORALE_START = 60;
/** Under this for MORALE_COMPLAINT_WEEKS straight weeks a player complains. */
export const MORALE_COMPLAINT_BELOW = 35;
export const MORALE_COMPLAINT_WEEKS = 2;
/** A transfer request is withdrawn once morale climbs back above this. */
export const MORALE_CONTENT_AT = 55;
/** Weekly swings (before the professionalism damping). */
export const MORALE = { win: 4, draw: 1, loss: 4, started: 2, subbed: 0.5, unused: 1, unusedAmbition: 3, expiring: 1.5, offerRefused: 3, offerRefusedAmbition: 4, lockerPull: 0.1, drift: 0.05, captainLift: 5 } as const;
/** Match attributes move by up to this many points with morale (±). */
export const MATCH_ATTR_SWING = 0.4;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ personality

/** FNV-1a over the id: four bytes → four traits in 0..1. Deterministic, no dice consumed. */
export function personalityFromId(id: string): Personality {
  let h = 2166136261;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  // a second round decorrelates the bytes for short ids
  let g = h ^ 0x9e3779b9;
  g = Math.imul(g ^ (g >>> 15), 0x2c1b3c6d) >>> 0;
  g = Math.imul(g ^ (g >>> 12), 0x297a2d39) >>> 0;
  const u = (k: number): number => Math.round((((g >>> (k * 8)) & 255) / 255) * 100) / 100;
  return { ambition: u(0), loyalty: u(1), temperament: u(2), professionalism: u(3) };
}

/** Gives a player his personality and starting morale when missing; returns the personality. */
export function ensurePersonality(p: SquadPlayer): Personality {
  if (!p.personality || typeof p.personality.ambition !== "number") p.personality = personalityFromId(p.id);
  if (typeof p.morale !== "number" || Number.isNaN(p.morale)) p.morale = MORALE_START;
  return p.personality;
}

export const personalityOf = (p: SquadPlayer): Personality => p.personality ?? personalityFromId(p.id);
export const moraleOf = (p: SquadPlayer): number => (typeof p.morale === "number" ? p.morale : MORALE_START);

/** Short Korean tags: 야심가 / 충성파 / 다혈질 / 프로페셔널 (and their opposites when extreme). */
export function personalityTags(p: SquadPlayer): string[] {
  const t = personalityOf(p);
  const tags: string[] = [];
  if (t.ambition > 0.7) tags.push("야심가"); else if (t.ambition < 0.25) tags.push("느긋함");
  if (t.loyalty > 0.7) tags.push("충성파"); else if (t.loyalty < 0.25) tags.push("철새");
  if (t.temperament > 0.7) tags.push("다혈질"); else if (t.temperament < 0.25) tags.push("냉정함");
  if (t.professionalism > 0.7) tags.push("프로페셔널"); else if (t.professionalism < 0.25) tags.push("게으름");
  return tags;
}

/** 최고 / 좋음 / 보통 / 불만 / 최악 */
export const moraleLabel = (m: number): string => (m >= 80 ? "최고" : m >= 60 ? "좋음" : m >= 45 ? "보통" : m >= MORALE_COMPLAINT_BELOW ? "불만" : "최악");
export const moraleBand = (m: number): "good" | "ok" | "warn" | "bad" => (m >= 60 ? "good" : m >= 45 ? "ok" : m >= MORALE_COMPLAINT_BELOW ? "warn" : "bad");

export function adjustMorale(p: SquadPlayer, delta: number): void {
  ensurePersonality(p);
  p.morale = round1(clamp(moraleOf(p) + delta, 0, 100));
  if (p.transferRequest && p.morale > MORALE_CONTENT_AT) p.transferRequest = undefined;
}

/** Every player of a club moves by `delta` (the captain's professionalism does not shield anyone; this is a team event). */
export function adjustSquadMorale(c: Club, delta: number): void {
  for (const p of c.squad) if (!p.onLoan) adjustMorale(p, delta);
}

// ------------------------------------------------------------------ captain and locker room

/** Leadership 0..1: loyalty and professionalism, plus experience (age 28+ counts extra). */
export function leadership(p: SquadPlayer): number {
  const t = personalityOf(p);
  return clamp((t.loyalty + t.professionalism) / 2 + (p.age >= 28 ? 0.1 : p.age <= 22 ? -0.1 : 0), 0, 1);
}

/** AI choice: the most experienced player available (oldest, then the best); null for an empty squad. */
export function pickCaptain(c: Club): SquadPlayer | null {
  const pool = c.squad.filter((p) => !p.onLoan && p.loanFrom === undefined);
  if (!pool.length) return null;
  return [...pool].sort((a, b) => b.age - a.age || overall(b.attrs, b.role) - overall(a.attrs, a.role) || a.id.localeCompare(b.id))[0]!;
}

export const captainOf = (c: Club): SquadPlayer | null => (c.captain ? c.squad.find((p) => p.id === c.captain && !p.onLoan) ?? null : null);

/** Keeps the armband on someone who is in the squad (the AI picks; the user's pick stands while he is around). */
export function ensureCaptain(c: Club): SquadPlayer | null {
  const cur = captainOf(c);
  if (cur) return cur;
  const pick = pickCaptain(c);
  c.captain = pick?.id;
  return pick;
}

/** The user hands the armband to one of his players. Returns an error or null. */
export function setCaptain(s: GameState, playerId: string): string | null {
  const me = s.clubs[s.userClub]!;
  const p = me.squad.find((q) => q.id === playerId);
  if (!p) return "선수를 찾을 수 없습니다";
  if (p.onLoan) return "임대 중인 선수는 주장이 될 수 없습니다";
  if (p.loanFrom !== undefined) return "임대 온 선수는 주장이 될 수 없습니다";
  if (me.captain === p.id) return "이미 주장입니다";
  me.captain = p.id;
  adjustMorale(p, 5);
  lockerRoom(me);
  s.news.unshift(`${me.shortName}: ${p.name}이(가) 새 주장으로 임명됐습니다.`);
  return null;
}

/**
 * The dressing-room mood 0..100: the squad's average morale, pulled toward the captain's by his leadership, plus
 * MORALE.captainLift for a captain of high loyalty/professionalism. Stored on the club and returned.
 */
export function lockerRoom(c: Club): number {
  const pool = c.squad.filter((p) => !p.onLoan);
  if (!pool.length) { c.lockerRoom = MORALE_START; return c.lockerRoom; }
  const avg = pool.reduce((a, p) => a + moraleOf(p), 0) / pool.length;
  const cap = ensureCaptain(c);
  let room = avg;
  if (cap) {
    const lead = leadership(cap);
    room += (moraleOf(cap) - avg) * 0.3 * lead;
    const t = personalityOf(cap);
    if ((t.loyalty + t.professionalism) / 2 >= 0.6) room += MORALE.captainLift;
  }
  c.lockerRoom = round1(clamp(room, 0, 100));
  return c.lockerRoom;
}

// ------------------------------------------------------------------ effects

/** Training multiplier 0.85..1.15: neutral at the start morale; a professional's development swings less with his mood. */
export function moraleTrainingFactor(p: SquadPlayer): number {
  const m = clamp((moraleOf(p) - MORALE_START) / 40, -1, 1);
  const prof = personalityOf(p).professionalism;
  return Math.round(clamp(1 + m * (0.15 - 0.1 * prof), 0.85, 1.15) * 100) / 100;
}

/**
 * The attributes a player takes onto the pitch: every attribute ±MATCH_ATTR_SWING with morale (0 at the start value),
 * and a hot temperament costs up to 1 composure and 0.5 decisions (the engine's card and foul proneness live there).
 */
export function matchAttrs(p: SquadPlayer): Attributes {
  const d = round1(clamp((moraleOf(p) - MORALE_START) / 40, -1, 1) * MATCH_ATTR_SWING * 10) / 10;
  const temper = Math.max(0, personalityOf(p).temperament - 0.5) * 2;
  const out = { ...p.attrs };
  if (d !== 0) for (const k of Object.keys(out) as (keyof Attributes)[]) out[k] = round1(clamp(out[k] + d, 1, 20));
  if (temper > 0) {
    out.composure = round1(clamp(out.composure - temper, 1, 20));
    out.decisions = round1(clamp(out.decisions - temper * 0.5, 1, 20));
  }
  return out;
}

/** The user turned down a bid for the player: an ambitious one takes it badly (transfers.rejectOffer). */
export function moraleOfferRefused(p: SquadPlayer): void {
  adjustMorale(p, -(MORALE.offerRefused + MORALE.offerRefusedAmbition * personalityOf(p).ambition));
}

// ------------------------------------------------------------------ the week

function resultOf(s: GameState, c: Club, round: number): -1 | 0 | 1 | null {
  const f = s.fixtures.find((x) => x.round === round && x.score && (x.home === c.id || x.away === c.id));
  if (!f || !f.score) return null;
  const gf = f.home === c.id ? f.score[0] : f.score[1], ga = f.home === c.id ? f.score[1] : f.score[0];
  return gf > ga ? 1 : gf < ga ? -1 : 0;
}

/**
 * The weekly morale update, called by advanceRound right after the round counter moved (the round just played is
 * `s.round − 1`) and before training consumes `lastMinutes`. Returns the players who complained this week.
 */
export function moraleWeek(s: GameState): SquadPlayer[] {
  const round = s.round - 1;
  const complained: SquadPlayer[] = [];
  for (const c of s.clubs) {
    for (const p of c.squad) ensurePersonality(p);
    const room = lockerRoom(c);
    const res = resultOf(s, c, round);
    const lateSeason = s.round >= 12;
    for (const p of c.squad) {
      if (p.onLoan) continue;
      const t = personalityOf(p);
      let delta = 0;
      if (res === 1) delta += MORALE.win; else if (res === -1) delta -= MORALE.loss; else if (res === 0) delta += MORALE.draw;
      const mins = p.lastMinutes ?? 0;
      if (mins >= 60) delta += MORALE.started;
      else if (mins > 0) delta += MORALE.subbed;
      else if (res !== null && p.injuryDays === 0 && p.ban === 0) delta -= MORALE.unused + MORALE.unusedAmbition * t.ambition;
      if (lateSeason && p.contractUntil <= s.season) delta -= MORALE.expiring * (1.5 - t.loyalty);
      delta += (room - moraleOf(p)) * MORALE.lockerPull;
      delta *= 1.2 - 0.4 * t.professionalism;
      delta += (MORALE_START - moraleOf(p)) * MORALE.drift;
      adjustMorale(p, delta);
      // complaints: two weeks in the dumps and the player speaks up (once; the flag or the week counter resets it)
      if (moraleOf(p) < MORALE_COMPLAINT_BELOW) {
        p.lowMoraleWeeks = (p.lowMoraleWeeks ?? 0) + 1;
        if (p.lowMoraleWeeks >= MORALE_COMPLAINT_WEEKS && !p.transferRequest) {
          p.lowMoraleWeeks = 0;
          complained.push(p);
          if (t.ambition >= 0.5) {
            p.transferRequest = true;
            if (c.id === s.userClub) s.news.unshift(`불만: ${p.name}이(가) 출전 시간에 불만을 표합니다 — 이적을 요청했습니다 (사기 ${moraleOf(p)}).`);
          } else {
            p.trainingRefused = true;
            if (c.id === s.userClub) s.news.unshift(`불만: ${p.name}이(가) 출전 시간에 불만을 표합니다 — 이번 주 훈련을 거부했습니다 (사기 ${moraleOf(p)}).`);
          }
        }
      } else p.lowMoraleWeeks = 0;
    }
    lockerRoom(c);
  }
  return complained;
}

/** Season rollover: requests are withdrawn, morale softens halfway toward the start value, counters reset. */
export function moraleRollover(s: GameState): void {
  for (const c of s.clubs) {
    for (const p of c.squad) {
      ensurePersonality(p);
      p.morale = round1(moraleOf(p) + (MORALE_START - moraleOf(p)) * 0.5);
      p.transferRequest = undefined;
      p.trainingRefused = undefined;
      p.lowMoraleWeeks = 0;
    }
    ensureCaptain(c);
    lockerRoom(c);
  }
}

/** Saves from before personalities: traits from the id hash, morale at the start value, a captain and a locker-room figure per club. */
export function migrateMorale(s: GameState): void {
  for (const c of s.clubs) {
    for (const p of c.squad) ensurePersonality(p);
    ensureCaptain(c);
    if (typeof c.lockerRoom !== "number") lockerRoom(c);
  }
  for (const p of s.freeAgents ?? []) ensurePersonality(p);
}
