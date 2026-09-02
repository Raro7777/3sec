import { Rng, defaultTactics, generateAttributes, type FormationName, type Role } from "@3sec/engine";
import type { Club, SquadPlayer } from "./types";
import { autoSelect } from "./selection";
import { seasonBudget } from "./transfers";

const FIRST = ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Ryu", "Hong", "Moon", "Yang", "Bae", "Baek", "Nam"];
const GIVEN = ["Minjun", "Seojun", "Doyun", "Yejun", "Siwoo", "Hajun", "Jiho", "Juwon", "Jihoon", "Junseo", "Hyunwoo", "Woojin", "Sunwoo", "Eunwoo", "Jaeyoon", "Taeyang", "Yujun", "Seungmin", "Dohyun", "Geonwoo", "Minseok", "Jinwoo", "Sangho", "Youngjin", "Kyungmin"];

/** Fictional clubs; reputation spreads the league from title favourites to relegation fodder. */
export const CLUBS: { name: string; shortName: string; color: string; reputation: number; formation: FormationName }[] = [
  { name: "Seoul FC", shortName: "SEO", color: "#e63946", reputation: 12.5, formation: "4-3-3" },
  { name: "Busan United", shortName: "BUS", color: "#4cc9f0", reputation: 12, formation: "4-4-2" },
  { name: "Incheon Blue", shortName: "INC", color: "#3a86ff", reputation: 13.5, formation: "4-2-3-1" },
  { name: "Daegu Wolves", shortName: "DAE", color: "#8ecae6", reputation: 11, formation: "3-5-2" },
  { name: "Gwangju Rays", shortName: "GWA", color: "#ffd166", reputation: 11.5, formation: "4-3-3" },
  { name: "Daejeon Comets", shortName: "DJN", color: "#c77dff", reputation: 10.5, formation: "4-4-2" },
  { name: "Suwon Wings", shortName: "SUW", color: "#06d6a0", reputation: 13, formation: "4-2-3-1" },
  { name: "Ulsan Anchors", shortName: "ULS", color: "#f4a261", reputation: 14.5, formation: "4-3-3" },
  { name: "Jeonju Green", shortName: "JEO", color: "#2a9d8f", reputation: 14, formation: "4-2-3-1" },
  { name: "Pohang Iron", shortName: "POH", color: "#adb5bd", reputation: 12, formation: "4-4-2" },
  { name: "Jeju Islanders", shortName: "JEJ", color: "#ff8fab", reputation: 10, formation: "3-5-2" },
  { name: "Changwon Sails", shortName: "CHA", color: "#a7c957", reputation: 11, formation: "4-3-3" },
];

/** 20-man squad: two keepers, eight defenders, six midfielders, four forwards. */
const SQUAD_ROLES: Role[] = ["GK", "GK", "CB", "CB", "CB", "CB", "LB", "LB", "RB", "RB", "DM", "CM", "CM", "CM", "AM", "LW", "RW", "ST", "ST", "LM"];

export function buildSquad(rng: Rng, shortName: string, reputation: number): SquadPlayer[] {
  const numbers = new Set<number>();
  const squad: SquadPlayer[] = [];
  SQUAD_ROLES.forEach((role, i) => {
    const age = Math.max(18, Math.min(35, Math.round(rng.gauss(26, 4.5))));
    // Peak years 25-30; youngsters and veterans are a little short of the club's level.
    const ageAdj = age < 22 ? -1.5 : age < 25 ? -0.5 : age > 32 ? -1.5 : age > 30 ? -0.5 : 0;
    const quality = reputation + ageAdj + rng.gauss(0, 0.8) + (i >= 11 ? -0.8 : 0);
    let number = i === 0 ? 1 : i === 1 ? 12 : rng.int(2, 40);
    while (numbers.has(number)) number = rng.int(2, 99);
    numbers.add(number);
    squad.push({
      id: `${shortName}-${i + 1}`,
      name: `${rng.pick(FIRST)} ${rng.pick(GIVEN)}`,
      number,
      role,
      attrs: generateAttributes(rng, role, quality),
      age,
      condition: 1,
      injuryDays: 0,
      ban: 0,
      seasonYellows: 0,
      stats: { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 },
    });
  });
  return squad;
}

export function buildClubs(seed: number): Club[] {
  return CLUBS.map((c, id) => {
    const rng = new Rng(seed * 31 + id * 1009 + 7);
    const club: Club = {
      id,
      name: c.name,
      shortName: c.shortName,
      color: c.color,
      reputation: c.reputation,
      budget: seasonBudget(c.reputation, null),
      squad: buildSquad(rng, c.shortName, c.reputation),
      tactics: { ...defaultTactics(c.formation), mentality: 0.45 + rng.range(0, 0.1), pressing: 0.4 + rng.range(0, 0.2), directness: 0.4 + rng.range(0, 0.2) },
      selection: { formation: c.formation, starters: [], bench: [] },
    };
    club.selection = autoSelect(club, c.formation);
    return club;
  });
}
