/**
 * Roster packs: the player's own club and squad names, loaded from a file and applied to a new game.
 *
 * The game ships with fictional clubs and players only. A pack is made and kept by the player on their
 * own device (see tools/roster/); nothing in it is distributed with the app. A pack names the 24 club
 * slots (0-11 first division, 12-23 second) or any subset of them, and the players it lists replace the
 * generated squad of that slot. Attributes are still generated here, from the club's reputation or the
 * player's own `rating`, so a pack needs nothing but names, ages and positions.
 */
import { Rng, generateAttributes, type Role } from "@3sec/engine";
import type { Club, SquadPlayer } from "./types";
import { overall } from "./rating";
import { wageFor } from "./contracts";
import { autoSelect } from "./selection";
import { ensureCaptain, ensurePersonality, lockerRoom } from "./morale";
import { newFans } from "./fans";
import { seasonBudget } from "./transfers";

export const ROSTER_FORMAT = "3sec-roster/1";
export const ROSTER_SLOTS = 24;
/** A pack squad shorter than this is topped up with generated players. */
export const ROSTER_MIN_SQUAD = 18;
export const ROSTER_MAX_SQUAD = 25;

const ROLES: Role[] = ["GK", "CB", "LB", "RB", "DM", "CM", "LM", "RM", "AM", "LW", "RW", "ST"];

export interface RosterPlayer {
  name: string;
  age: number;
  role: Role;
  number?: number;
  /** overall on the game's 1-20 scale; defaults to the club's level */
  rating?: number;
  potential?: number;
}

export interface RosterClub {
  /** 0-11 first division, 12-23 second */
  slot: number;
  name: string;
  shortName: string;
  /** #rrggbb */
  color?: string;
  stadium?: string;
  capacity?: number;
  /** club level on the game's scale (about 9-14); defaults to the slot's own */
  reputation?: number;
  players?: RosterPlayer[];
}

export interface RosterPack {
  format: typeof ROSTER_FORMAT;
  name: string;
  clubs: RosterClub[];
}

const isRole = (x: unknown): x is Role => typeof x === "string" && (ROLES as string[]).includes(x);
const isHex = (x: unknown): x is string => typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x);

/** Parse and check a pack; every problem is reported in Korean so the settings screen can show it. */
export function parseRoster(json: string): { pack: RosterPack | null; errors: string[] } {
  const errors: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { pack: null, errors: ["JSON을 읽을 수 없습니다."] }; }
  const o = raw as Partial<RosterPack>;
  if (!o || typeof o !== "object") return { pack: null, errors: ["형식이 올바르지 않습니다."] };
  if (o.format !== ROSTER_FORMAT) errors.push(`format이 "${ROSTER_FORMAT}"이어야 합니다.`);
  if (!Array.isArray(o.clubs) || !o.clubs.length) errors.push("clubs 배열이 비어 있습니다.");
  const clubs: RosterClub[] = [];
  const seen = new Set<number>();
  for (const [i, c] of (Array.isArray(o.clubs) ? o.clubs : []).entries()) {
    const where = `clubs[${i}]`;
    if (!c || typeof c !== "object") { errors.push(`${where}: 객체가 아닙니다.`); continue; }
    const slot = Number((c as RosterClub).slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= ROSTER_SLOTS) { errors.push(`${where}: slot은 0~${ROSTER_SLOTS - 1}이어야 합니다.`); continue; }
    if (seen.has(slot)) { errors.push(`${where}: slot ${slot}이 중복됩니다.`); continue; }
    seen.add(slot);
    const name = String((c as RosterClub).name ?? "").trim();
    const shortName = String((c as RosterClub).shortName ?? name.slice(0, 2)).trim();
    if (!name) { errors.push(`${where}: name이 없습니다.`); continue; }
    if (name.length > 14) errors.push(`${where}: name은 14자 이내여야 합니다.`);
    if (shortName.length > 4) errors.push(`${where}: shortName은 4자 이내여야 합니다.`);
    const color = (c as RosterClub).color;
    if (color !== undefined && !isHex(color)) errors.push(`${where}: color는 #rrggbb 형식이어야 합니다.`);
    const players: RosterPlayer[] = [];
    for (const [j, p] of ((c as RosterClub).players ?? []).entries()) {
      const pw = `${where}.players[${j}]`;
      if (!p || typeof p !== "object") { errors.push(`${pw}: 객체가 아닙니다.`); continue; }
      const pn = String((p as RosterPlayer).name ?? "").trim();
      if (!pn) { errors.push(`${pw}: name이 없습니다.`); continue; }
      const age = Number((p as RosterPlayer).age);
      if (!Number.isFinite(age) || age < 15 || age > 45) { errors.push(`${pw}: age는 15~45여야 합니다.`); continue; }
      const role = (p as RosterPlayer).role;
      if (!isRole(role)) { errors.push(`${pw}: role은 ${ROLES.join("/")} 중 하나여야 합니다.`); continue; }
      const rating = (p as RosterPlayer).rating;
      if (rating !== undefined && !(Number(rating) >= 1 && Number(rating) <= 20)) errors.push(`${pw}: rating은 1~20이어야 합니다.`);
      const number = (p as RosterPlayer).number;
      players.push({ name: pn.slice(0, 12), age: Math.round(age), role, number: Number.isInteger(number) && number! >= 1 && number! <= 99 ? number : undefined, rating: rating === undefined ? undefined : Number(rating), potential: (p as RosterPlayer).potential === undefined ? undefined : Number((p as RosterPlayer).potential) });
      if (players.length >= ROSTER_MAX_SQUAD) break;
    }
    const rep = (c as RosterClub).reputation;
    clubs.push({ slot, name, shortName, color: isHex(color) ? color : undefined, stadium: (c as RosterClub).stadium ? String((c as RosterClub).stadium).slice(0, 16) : undefined, capacity: Number((c as RosterClub).capacity) > 0 ? Math.round(Number((c as RosterClub).capacity)) : undefined, reputation: rep === undefined ? undefined : Math.max(7, Math.min(15, Number(rep))), players });
  }
  if (errors.length) return { pack: null, errors };
  return { pack: { format: ROSTER_FORMAT, name: String(o.name ?? "로스터 팩").slice(0, 30), clubs }, errors };
}

/** Which of the game's roles a pack squad still lacks, in the order they should be generated. */
function missingRoles(have: Role[]): Role[] {
  const want: Role[] = ["GK", "GK", "CB", "CB", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "AM", "LW", "RW", "ST", "ST", "LM", "RM"];
  const pool = [...have];
  const out: Role[] = [];
  for (const r of want) {
    const i = pool.indexOf(r);
    if (i >= 0) pool.splice(i, 1); else out.push(r);
  }
  return out;
}

/** One squad player from a pack line (or a generated filler when `p` is a bare role). */
function makePlayer(rng: Rng, id: string, reputation: number, p: RosterPlayer | Role, numbers: Set<number>): SquadPlayer {
  const line: RosterPlayer = typeof p === "string" ? { name: "", age: Math.max(18, Math.min(34, Math.round(rng.gauss(25, 4)))), role: p } : p;
  const age = line.age;
  const ageAdj = age < 22 ? -1.5 : age < 25 ? -0.5 : age > 32 ? -1.5 : age > 30 ? -0.5 : 0;
  // a rated player is placed exactly; an unrated one sits around the club's level like a generated squad
  const quality = line.rating !== undefined ? line.rating : reputation + ageAdj + rng.gauss(0, 1.25);
  let number = line.number ?? (line.role === "GK" ? 1 : rng.int(2, 40));
  while (numbers.has(number)) number = rng.int(2, 99);
  numbers.add(number);
  const attrs = generateAttributes(rng, line.role, quality);
  // a pack rating is a promise: shift the generated profile until the overall lands on it
  if (line.rating !== undefined) {
    for (let k = 0; k < 6; k++) {
      const diff = line.rating - overall(attrs, line.role);
      if (Math.abs(diff) < 0.15) break;
      for (const key of Object.keys(attrs) as (keyof typeof attrs)[]) attrs[key] = Math.max(1, Math.min(20, attrs[key] + diff));
    }
  }
  const ovr = overall(attrs, line.role);
  const potential = line.potential !== undefined ? Math.max(ovr, Math.min(20, line.potential)) : Math.max(ovr, Math.min(20, Math.round((ovr + Math.max(0, 27 - age) * 0.55 + rng.gauss(0.5, 1)) * 10) / 10));
  const player: SquadPlayer = {
    id, name: line.name || fillerName(rng), number, role: line.role, attrs, age, potential, growth: 0, wage: 0,
    contractUntil: rng.int(1, 3), condition: 1, injuryDays: 0, ban: 0, seasonYellows: 0,
    stats: { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 },
  };
  ensurePersonality(player);
  player.wage = wageFor(player);
  return player;
}

const FILL_FIRST = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
const FILL_GIVEN = ["민준", "서준", "도윤", "예준", "시우", "하준", "지호", "주원", "지훈", "준서", "현우", "우진"];
const fillerName = (rng: Rng): string => `${rng.pick(FILL_FIRST)}${rng.pick(FILL_GIVEN)}`;

/**
 * Apply a pack to freshly built clubs (before the season starts). Names, colours, grounds and squads
 * change; ids, divisions, lore slots, managers and staff stay, so everything keyed by club id keeps
 * working. Returns the slots that were changed.
 */
export function applyRoster(clubs: Club[], pack: RosterPack, seed: number): number[] {
  const changed: number[] = [];
  for (const rc of pack.clubs) {
    const club = clubs[rc.slot];
    if (!club) continue;
    const rng = new Rng((seed * 131 + rc.slot * 7919 + 11) >>> 0);
    if (!club.baseName) club.baseName = club.name;
    club.name = rc.name;
    club.shortName = rc.shortName;
    if (rc.color) club.color = rc.color;
    if (rc.stadium) club.stadiumName = rc.stadium;
    if (rc.capacity) { club.capacity = rc.capacity; club.fans = newFans(club.reputation, rc.capacity); }
    if (rc.reputation !== undefined) {
      club.reputation = Math.round(rc.reputation * 10) / 10;
      club.budget = seasonBudget(club.reputation, null);
      club.seasonStartBudget = club.budget;
      club.fans = newFans(club.reputation, club.capacity);
    }
    if (rc.players && rc.players.length) {
      const numbers = new Set<number>();
      const squad: SquadPlayer[] = rc.players.map((p, i) => makePlayer(rng, `R${club.id}-${i + 1}`, club.reputation, p, numbers));
      const fill = missingRoles(squad.map((p) => p.role)).slice(0, Math.max(0, ROSTER_MIN_SQUAD - squad.length));
      // a thin pack squad is topped up so the season can be played; the fillers are plainly generated
      fill.forEach((role, i) => squad.push(makePlayer(rng, `R${club.id}-F${i + 1}`, club.reputation - 0.8, role, numbers)));
      // never fewer than two keepers, whatever the pack says
      while (squad.filter((p) => p.role === "GK").length < 2) squad.push(makePlayer(rng, `R${club.id}-G${squad.length}`, club.reputation - 0.8, "GK", numbers));
      club.squad = squad;
      club.selection = autoSelect(club, club.selection.formation);
      ensureCaptain(club);
      lockerRoom(club);
    }
    changed.push(rc.slot);
  }
  return changed;
}

/** A pack with every slot named after the club it replaces: the template a player edits. */
export function rosterTemplate(clubs: Pick<Club, "id" | "name" | "shortName" | "color" | "capacity" | "reputation">[]): RosterPack {
  return {
    format: ROSTER_FORMAT,
    name: "내 로스터",
    clubs: clubs.slice(0, ROSTER_SLOTS).map((c) => ({ slot: c.id, name: c.name, shortName: c.shortName, color: c.color, capacity: c.capacity, reputation: c.reputation, players: [{ name: "선수 이름", age: 25, role: "ST", number: 9 }] })),
  };
}
