import { Rng, type Tactics } from "@3sec/engine";
import type { Club, GameState, StaffMember, StaffRole } from "./types";
import { randomName } from "./world";

/*
 * Coaching staff: generation, effects, the hiring market, the weekly tick and the season rollover.
 *
 * TODO(season.ts maintainer) — three one-line calls this module cannot wire itself (season.ts is out of scope):
 *   1. advanceRound, inside `for (const c of s.clubs)` right after the recovery loop:   applyStaffRecovery(c);
 *      (the fitness coach's weekly condition bonus; cup midweeks already get half of it in advanceCupDay)
 *   2. recordResult, the injury roll:   if (rng.chance(0.022 * (0.6 + ps.fatigue) * intensity * injuryFactor(c)))
 *   3. recordResult, both `days` lines:   Math.round((3 + Math.pow(rng.next(), 2.2) * 60) * injuryDaysFactor(c))
 *      (and the INJURY-event line likewise: Math.round((5 + …) * injuryDaysFactor(c)))
 *   4. financeSummary, the wages line:   wages: c.seasonWages ? r1(c.seasonWages + (c.seasonStaffWages ?? 0)) : wageBill(c) + staffWageBill(c)
 *      and resetSeasonCounters:   c.seasonStaffWages = 0;   (payWages books staff wages in their own counter)
 *   Optional (already handled lazily): startNextSeason after `s.season++` may call staffRollover(s) explicitly;
 *   advanceRound may call staffWeek(s) — both run anyway from transferWeek, which season.ts already calls weekly.
 */

export const STAFF_ROLES: StaffRole[] = ["assistant", "fitness", "youth", "gk", "scout", "physio"];

/** A coach's footballing instincts (0..1 each), derived from the id so old saves need no migration. */
export interface StaffStyle { attack: number; pressing: number; possession: number }
export function staffStyle(m: Pick<StaffMember, "id">): StaffStyle {
  let h = 2166136261;
  for (const ch of m.id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const u = (k: number) => (((h >>> (k * 8)) & 255) / 255);
  return { attack: u(0), pressing: u(1), possession: u(2) };
}
/** Short Korean tags for a coach's style ("공격적 · 강한 압박"); empty for a balanced coach. */
export function staffStyleTags(m: Pick<StaffMember, "id">): string[] {
  const st = staffStyle(m);
  const tags: string[] = [];
  if (st.attack > 0.68) tags.push("공격적"); else if (st.attack < 0.32) tags.push("수비적");
  if (st.pressing > 0.68) tags.push("강한 압박"); else if (st.pressing < 0.32) tags.push("내려앉기");
  if (st.possession > 0.68) tags.push("점유"); else if (st.possession < 0.32) tags.push("다이렉트");
  return tags;
}

/**
 * How the user's side plays when a round is simulated automatically: the manager's own tactics (the
 * user's habits) nudged by the assistant coach's instincts, more so for a better-rated assistant.
 */
export function autoUserTactics(s: GameState): Tactics {
  const me = s.clubs[s.userClub]!;
  const t: Tactics = { ...me.tactics };
  const a = staffOf(me).filter((m) => m.role === "assistant").sort((x, y) => y.rating - x.rating)[0];
  if (!a) return t;
  const st = staffStyle(a);
  const k = 0.25 * (0.5 + a.rating / 20);
  const c = (x: number) => Math.max(0, Math.min(1, x));
  t.mentality = c(t.mentality + (st.attack - 0.5) * k);
  t.pressing = c(t.pressing + (st.pressing - 0.5) * k);
  t.directness = c(t.directness - (st.possession - 0.5) * k);
  t.defensiveLine = c(t.defensiveLine + (st.pressing - 0.5) * k * 0.5);
  return t;
}
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  assistant: "수석코치", fitness: "피지컬 코치", youth: "유스 코치", gk: "GK 코치", scout: "스카우트", physio: "의무 팀장",
};
/** A club employs at most this many staff. */
export const MAX_STAFF = 8;
/** One per role, except two assistants. */
export const MAX_PER_ROLE: Record<StaffRole, number> = { assistant: 2, fitness: 1, youth: 1, gk: 1, scout: 1, physio: 1 };
export const STAFF_MARKET_MIN = 8;
export const STAFF_MARKET_MAX = 12;
/** Seasons a new hire or renewal signs for. */
export const STAFF_CONTRACT_YEARS = 2;
/** An AI club renews an expiring coach rated at least this. */
export const AI_RENEW_RATING = 8;
/** Scouting tier "national" needs a scout at least this good; otherwise the intake runs one tier lower. */
export const NATIONAL_SCOUT_RATING = 12;
/** A coach retires at the rollover once this old. */
export const STAFF_RETIRE_AGE = 66;
/** Budget an AI club keeps back before paying a signing fee for staff. */
const AI_STAFF_RESERVE = 10;
/** The order an AI club fills its empty roles in. */
const AI_ROLE_PRIORITY: StaffRole[] = ["assistant", "fitness", "physio", "youth", "scout", "gk"];

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const round1 = (x: number): number => Math.round(x * 10) / 10;
const round2 = (x: number): number => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ generation

/** Season salary (억원) for a rating: 0.15 × rating^1.3 / 10, at least 0.3. */
export function staffWage(rating: number): number {
  return Math.max(0.3, round2(0.15 * Math.pow(rating, 1.3) / 10));
}

export function makeStaff(rng: Rng, id: string, role: StaffRole, rating: number, season: number): StaffMember {
  const r = clamp(Math.round(rating), 1, 20);
  return { id, name: randomName(rng), role, rating: r, age: rng.int(30, 62), wage: staffWage(r), contractUntil: season + rng.int(0, 2) };
}

/** Rating of a club's coach: reputation ± gauss(0, 2.5), clamped 4..19. */
const clubRating = (rng: Rng, reputation: number): number => clamp(Math.round(reputation + rng.gauss(0, 2.5)), 4, 19);

/**
 * 3..6 staff for an AI club, more (and better) for a bigger reputation. An assistant always comes first;
 * the remaining roles are drawn without repeats. Deterministic for the rng handed in.
 */
export function generateClubStaff(rng: Rng, club: Pick<Club, "id" | "reputation">, season: number): StaffMember[] {
  const count = clamp(Math.round(3 + ((club.reputation - 10.5) / 3.5) * 3 + rng.gauss(0, 0.6)), 3, 6);
  const rest = STAFF_ROLES.filter((r) => r !== "assistant");
  for (let i = rest.length - 1; i > 0; i--) { const j = rng.int(0, i); [rest[i], rest[j]] = [rest[j]!, rest[i]!]; }
  const roles: StaffRole[] = ["assistant", ...rest.slice(0, count - 1)];
  return roles.map((role, i) => makeStaff(rng, `C${club.id}-ST${season}-${i + 1}`, role, clubRating(rng, club.reputation), season));
}

/** Rating of the user's opening assistant: the neutral point of the training multiplier (×1.0), so the first team starts from plain rates. */
export const USER_ASSISTANT_RATING = 8;

/**
 * The user's opening staff on one-season deals: a neutral assistant (USER_ASSISTANT_RATING — the human is the
 * head coach), a fitness coach and a physio a notch below the club (≈ reputation − 1).
 */
export function userStartingStaff(rng: Rng, club: Pick<Club, "id" | "reputation">, season: number): StaffMember[] {
  const roles: StaffRole[] = ["assistant", "fitness", "physio"];
  return roles.map((role, i) => {
    const rating = role === "assistant" ? USER_ASSISTANT_RATING : clamp(Math.round(club.reputation - 1 + rng.gauss(0, 0.5)), 4, 19);
    const m = makeStaff(rng, `C${club.id}-ST${season}-U${i + 1}`, role, rating, season);
    m.contractUntil = season;
    return m;
  });
}

// ------------------------------------------------------------------ effects (pure helpers)

const staffOf = (club: Club): StaffMember[] => (Array.isArray(club.staff) ? club.staff : []);

/** Best rating a club has in a role; 0 when the role is vacant. */
export function staffRating(club: Club, role: StaffRole): number {
  return staffOf(club).reduce((best, m) => (m.role === role && m.rating > best ? m.rating : best), 0);
}

/**
 * Development multiplier a coach brings (1 when the role is vacant; rating 8 ≈ neutral for the assistant):
 * assistant ×(0.8 + 0.025·r) on first-team training, gk ×(0.8 + 0.03·r) for keepers, youth ×(0.85 + 0.02·r) in the academy.
 */
export function staffBonus(club: Club, role: StaffRole): number {
  const r = staffRating(club, role);
  if (!r) return 1;
  if (role === "assistant") return 0.8 + 0.025 * r;
  if (role === "gk") return 0.8 + 0.03 * r;
  if (role === "youth") return 0.85 + 0.02 * r;
  return 1;
}

/** Youth coach: how much faster the scouts' potential range narrows (×(0.8 + 0.03·r), 1 without one). */
export function youthNarrowFactor(club: Club): number {
  const r = staffRating(club, "youth");
  return r ? 0.8 + 0.03 * r : 1;
}

/** Fitness coach: extra weekly condition recovery, +0.01 per rating point above 8 (clamped −0.05..+0.12; 0 without one). */
export function recoveryBonus(club: Club): number {
  const r = staffRating(club, "fitness");
  return r ? round2(clamp(0.01 * (r - 8), -0.05, 0.12)) : 0;
}

/** Fitness coach: multiplier on the per-match injury chance, ×(1 − 0.02·(r − 8)) clamped 0.76..1.12 (1 without one). */
export function injuryFactor(club: Club): number {
  const r = staffRating(club, "fitness");
  return r ? clamp(1 - 0.02 * (r - 8), 0.76, 1.12) : 1;
}

/** Physio: multiplier on injury length, ×(1 − 0.03·(r − 8)) clamped 0.6..1.25 (1 without one). */
export function injuryDaysFactor(club: Club): number {
  const r = staffRating(club, "physio");
  return r ? clamp(1 - 0.03 * (r - 8), 0.6, 1.25) : 1;
}

/** The fitness coach's weekly recovery on every player (`scale` 0.5 for a cup midweek). Call after the base recovery. */
export function applyStaffRecovery(club: Club, scale = 1): void {
  const bonus = recoveryBonus(club) * scale;
  if (!bonus) return;
  for (const p of club.squad) p.condition = clamp(round2(p.condition + bonus), 0.2, 1);
}

/** Youth intake (user's club): "national" scouting without a good enough scout runs as "regional". */
export function scoutCapped(club: Club): boolean {
  return club.youth.scouting === "national" && staffRating(club, "scout") < NATIONAL_SCOUT_RATING;
}

/** Deterministic noise in [−1, 1) from a player id and the season (so a report does not flicker between screens). */
function noise(id: string, season: number): number {
  let h = 2166136261 ^ season;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 20001) / 10000 - 1;
}

export interface ScoutReport { potential: number; note: string }

/** The scout's estimate of a transfer target's ceiling: true potential ± (6 − rating/4). Undefined without a scout. */
export function scoutReport(club: Club, p: { id: string; potential: number }, season: number): ScoutReport | undefined {
  const scout = staffOf(club).filter((m) => m.role === "scout").sort((a, b) => b.rating - a.rating)[0];
  if (!scout) return undefined;
  const err = round1(6 - scout.rating / 4);
  const potential = round1(clamp(p.potential + noise(p.id, season) * err, 1, 20));
  const grade = potential >= 16 ? "리그 최상급 재목" : potential >= 13 ? "주전급 성장 가능" : potential >= 10 ? "로테이션 자원" : "성장 여지 적음";
  return { potential, note: `관찰 보고(${scout.name}): 잠재력 약 ${potential} (±${err}) — ${grade}` };
}

// ------------------------------------------------------------------ market and contracts

/** Season wage bill of a club's staff (억원). */
export const staffWageBill = (club: Club): number => round2(staffOf(club).reduce((s, m) => s + m.wage, 0));

/** Two markets a season: the pre-season pool and the winter one (from round 10); the rollover starts a new season's. */
export function staffMarketKey(s: GameState): string {
  return `${s.season}:${s.round < 10 ? "pre" : "winter"}`;
}

/** Fill the free pool with 8..12 coaches of every role; clears anyone left from the previous window. */
export function refreshStaffMarket(s: GameState): StaffMember[] {
  const key = staffMarketKey(s);
  const rng = new Rng(s.seed * 61 + s.season * 977 + (s.round < 10 ? 1 : 2) * 131 + 43);
  const n = rng.int(STAFF_MARKET_MIN, STAFF_MARKET_MAX);
  const pool: StaffMember[] = [];
  for (let i = 0; i < n; i++) {
    const role = i < STAFF_ROLES.length ? STAFF_ROLES[i]! : rng.pick(STAFF_ROLES);
    pool.push(makeStaff(rng, `ST${key.replace(":", "-")}-${i + 1}`, role, clamp(Math.round(rng.gauss(10, 3.5)), 4, 19), s.season));
  }
  s.staffMarket = pool;
  s.staffMarketKey = key;
  return pool;
}

/** The market (and the rollover marker) exist, whatever the save's age. */
export function ensureStaffMarket(s: GameState): StaffMember[] {
  if (!Array.isArray(s.staffMarket)) return refreshStaffMarket(s);
  return s.staffMarket;
}

const roleCount = (club: Club, role: StaffRole): number => staffOf(club).filter((m) => m.role === role).length;

/** Why a club cannot add this coach, or null. */
export function staffRoomProblem(club: Club, m: StaffMember): string | null {
  if (staffOf(club).length >= MAX_STAFF) return `코칭스태프 정원 ${MAX_STAFF}명`;
  if (roleCount(club, m.role) >= MAX_PER_ROLE[m.role]) return `${STAFF_ROLE_LABEL[m.role]} 자리가 없습니다 (최대 ${MAX_PER_ROLE[m.role]}명)`;
  return null;
}

/** Signing fee for a coach from the market: one season's wage. */
export const staffSigningFee = (m: StaffMember): number => round1(m.wage);

function sign(s: GameState, club: Club, m: StaffMember): void {
  s.staffMarket = ensureStaffMarket(s).filter((x) => x !== m);
  club.budget = round1(club.budget - staffSigningFee(m));
  m.contractUntil = s.season + STAFF_CONTRACT_YEARS;
  if (!Array.isArray(club.staff)) club.staff = [];
  club.staff.push(m);
}

/** Hire a coach from the market for the user's club (fee = one season's wage; room and budget permitting). */
export function hireStaff(s: GameState, staffId: string, clubId: number = s.userClub): string | null {
  const club = s.clubs[clubId]!;
  const m = ensureStaffMarket(s).find((x) => x.id === staffId);
  if (!m) return "해당 코치를 시장에서 찾을 수 없습니다";
  const room = staffRoomProblem(club, m);
  if (room) return room;
  const fee = staffSigningFee(m);
  if (club.budget < fee) return `계약금 부족 (필요 ${fee}억, 보유 ${club.budget}억)`;
  sign(s, club, m);
  s.news.unshift(`${club.shortName}: ${STAFF_ROLE_LABEL[m.role]} ${m.name}(능력 ${m.rating}) 영입 (연봉 ${m.wage}억, ~S${m.contractUntil}).`);
  return null;
}

/** Compensation for sacking a coach: half of what the contract still owes (this season counts). */
export function staffSeverance(s: GameState, m: StaffMember): number {
  const remaining = Math.max(1, m.contractUntil - s.season + 1);
  return round1(m.wage * remaining * 0.5);
}

/** The user sacks a coach, paying half the remaining contract. */
export function fireStaff(s: GameState, staffId: string): string | null {
  const me = s.clubs[s.userClub]!;
  const m = staffOf(me).find((x) => x.id === staffId);
  if (!m) return "코치를 찾을 수 없습니다";
  const fee = staffSeverance(s, m);
  if (me.budget < fee) return `위약금 부족 (필요 ${fee}억, 보유 ${me.budget}억)`;
  me.budget = round1(me.budget - fee);
  me.staff = me.staff.filter((x) => x !== m);
  s.news.unshift(`${me.shortName}: ${STAFF_ROLE_LABEL[m.role]} ${m.name} 계약 해지 (위약금 ${fee}억).`);
  return null;
}

/** Renewal fee: half a season's wage; the coach's wage follows his current rating. */
export const staffRenewalFee = (m: StaffMember): number => round1(Math.max(0.2, m.wage * 0.5));

/** The user extends a coach's deal by `years` seasons (from the current season or the contract's end, whichever is later). */
export function renewStaff(s: GameState, staffId: string, years: number = STAFF_CONTRACT_YEARS): string | null {
  const me = s.clubs[s.userClub]!;
  const m = staffOf(me).find((x) => x.id === staffId);
  if (!m) return "코치를 찾을 수 없습니다";
  const fee = staffRenewalFee(m);
  if (me.budget < fee) return `계약금 부족 (필요 ${fee}억, 보유 ${me.budget}억)`;
  me.budget = round1(me.budget - fee);
  m.wage = staffWage(m.rating);
  m.contractUntil = Math.max(m.contractUntil, s.season) + Math.max(1, Math.round(years));
  s.news.unshift(`${me.shortName}: ${STAFF_ROLE_LABEL[m.role]} ${m.name} ${years}년 재계약 (연봉 ${m.wage}억, ~S${m.contractUntil}).`);
  return null;
}

/** The user's coaches whose contracts end with the current season. */
export function expiringStaff(s: GameState): StaffMember[] {
  return staffOf(s.clubs[s.userClub]!).filter((m) => m.contractUntil <= s.season);
}

/**
 * An AI club fills its first vacant role (in AI_ROLE_PRIORITY order) with the best coach the market offers,
 * if it can pay the fee and still keep a reserve. One hire per call. Returns the hire, or null.
 */
export function aiHireStaff(s: GameState, club: Club): StaffMember | null {
  const market = ensureStaffMarket(s);
  if (staffOf(club).length >= MAX_STAFF) return null;
  for (const role of AI_ROLE_PRIORITY) {
    if (roleCount(club, role) >= 1) continue;
    const pick = market.filter((m) => m.role === role && club.budget - staffSigningFee(m) >= AI_STAFF_RESERVE).sort((a, b) => b.rating - a.rating)[0];
    if (!pick) continue;
    sign(s, club, pick);
    return pick;
  }
  return null;
}

/**
 * One staff week: the market is refreshed when a new window opens (and the rollover is caught up if the
 * season moved on), then every AI club with a hole in its staff tries to fill it. Runs from transferWeek.
 */
export function staffWeek(s: GameState): void {
  ensureStaffMarket(s);
  if (typeof s.staffSeason !== "number") s.staffSeason = s.season; // a state nobody stamped: no rollover is owed
  if (s.staffSeason !== s.season) staffRollover(s);
  if (s.staffMarketKey !== staffMarketKey(s)) refreshStaffMarket(s);
  for (const c of s.clubs) if (c.id !== s.userClub) aiHireStaff(s, c);
}

// ------------------------------------------------------------------ rollover

/**
 * Season rollover for the staff (call once `s.season` is the new season; idempotent): everyone ages a year,
 * ratings drift (+1 sometimes under 45, −1 sometimes over 60), the old retire, expiring AI coaches are renewed
 * when still rated ≥ AI_RENEW_RATING or let go, the user's expiring coaches leave with a news line unless they
 * were renewed during the season, and a fresh market is drawn.
 */
export function staffRollover(s: GameState): void {
  if (typeof s.staffSeason === "number" && s.staffSeason >= s.season) return;
  const rng = new Rng(s.seed * 67 + s.season * 1213 + 29);
  for (const c of s.clubs) {
    if (!Array.isArray(c.staff)) c.staff = [];
    const user = c.id === s.userClub;
    const keep: StaffMember[] = [];
    for (const m of c.staff) {
      m.age++;
      if (m.age < 45 && rng.chance(0.35)) m.rating = Math.min(20, m.rating + 1);
      else if (m.age > 60 && rng.chance(0.5)) m.rating = Math.max(1, m.rating - 1);
      if (m.age >= STAFF_RETIRE_AGE) {
        if (user) s.news.unshift(`${c.shortName}: ${STAFF_ROLE_LABEL[m.role]} ${m.name} 은퇴.`);
        continue;
      }
      if (m.contractUntil >= s.season) { keep.push(m); continue; }
      if (!user && m.rating >= AI_RENEW_RATING) {
        m.wage = staffWage(m.rating);
        m.contractUntil = s.season - 1 + STAFF_CONTRACT_YEARS;
        keep.push(m);
        continue;
      }
      if (user) s.news.unshift(`${c.shortName}: 코치 계약 만료 — ${STAFF_ROLE_LABEL[m.role]} ${m.name} 팀을 떠남.`);
    }
    c.staff = keep;
  }
  s.staffSeason = s.season;
  refreshStaffMarket(s);
}

// ------------------------------------------------------------------ migration

/** Saves from before the coaching staff: every club gets generated staff (the user's club its modest trio), the market its pool. */
export function migrateStaff(s: GameState): void {
  for (const c of s.clubs) {
    if (Array.isArray(c.staff)) continue;
    const rng = new Rng(s.seed * 53 + c.id * 1009 + 21);
    c.staff = c.id === s.userClub ? userStartingStaff(rng, c, s.season) : generateClubStaff(rng, c, s.season);
  }
  if (typeof s.staffSeason !== "number") s.staffSeason = s.season;
  ensureStaffMarket(s);
}
