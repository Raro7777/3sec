/**
 * Painted manager portraits (public/art/mgr-NN.webp).
 *
 * Managers are generated and replaced during a career, so a portrait is not tied to a club: there is a
 * pool of 24 paintings in three age bands, and each manager is given one by his id. Incumbents keep their
 * portrait when a newcomer arrives: assignment runs oldest-appointment-first and a newcomer takes the
 * nearest free painting in his band, so nothing changes under an existing manager's feet.
 */
import type { GameState, Manager } from "@3sec/game";

/** Pool indices by age band: 36-44, 45-53, 54-62. */
const BANDS: [number, number, number[]][] = [
  [36, 44, [0, 1, 3, 4, 5, 6, 7, 22]],
  [45, 53, [8, 9, 10, 11, 12, 13, 21, 23]],
  [54, 62, [2, 14, 15, 16, 17, 18, 19, 20]],
];

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
};

const bandFor = (age: number): number[] => (BANDS.find(([lo, hi]) => age >= lo && age <= hi) ?? BANDS[1]!)[2];

let cacheKey = "";
let cache = new Map<string, number>();

/** Portrait index for every current manager; recomputed when the set of managers changes. */
function assignments(s: GameState): Map<string, number> {
  const managers = s.clubs.map((c) => c.manager).filter((m): m is Manager => !!m);
  const key = managers.map((m) => `${m.id}:${m.since}`).join(",") + `|${s.managerName}`;
  if (key === cacheKey) return cache;
  const taken = new Set<number>();
  const out = new Map<string, number>();
  // the human's own portrait is reserved first
  const mine = userPortraitIndex(s);
  taken.add(mine);
  const order = [...managers].sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  for (const m of order) {
    const band = bandFor(m.age);
    const start = hash(m.id) % band.length;
    let pick = -1;
    for (let i = 0; i < band.length; i++) { const cand = band[(start + i) % band.length]!; if (!taken.has(cand)) { pick = cand; break; } }
    if (pick < 0) { for (let i = 0; i < 24; i++) { const cand = (hash(m.id) + i) % 24; if (!taken.has(cand)) { pick = cand; break; } } }
    if (pick < 0) pick = hash(m.id) % 24;
    taken.add(pick);
    out.set(m.id, pick);
  }
  cacheKey = key;
  cache = out;
  return out;
}

/** The human manager's portrait: chosen once from the name, from the middle band. */
export function userPortraitIndex(s: GameState): number {
  const band = BANDS[1]![2];
  return band[hash(`user:${s.managerName}`) % band.length]!;
}

export const managerArtSrc = (index: number): string => `./art/mgr-${String(index).padStart(2, "0")}.webp`;

/** <img> of an AI manager's portrait, round, `size` px; the club colour rims it. */
export function managerArt(s: GameState, m: Manager, size: number, color?: string): string {
  const idx = assignments(s).get(m.id) ?? hash(m.id) % 24;
  return `<img class="mgrArt" src="${managerArtSrc(idx)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;${color ? `box-shadow:0 0 0 2px ${color}` : ""}" loading="lazy">`;
}

/** <img> of the human manager's portrait. */
export function userArt(s: GameState, size: number, color?: string): string {
  return `<img class="mgrArt" src="${managerArtSrc(userPortraitIndex(s))}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;${color ? `box-shadow:0 0 0 2px ${color}` : ""}" loading="lazy">`;
}
