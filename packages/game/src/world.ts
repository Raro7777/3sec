import { Rng, defaultTactics, generateAttributes, type FormationName, type Role } from "@3sec/engine";
import type { Club, SquadPlayer } from "./types";
import { autoSelect } from "./selection";
import { seasonBudget } from "./transfers";

const FIRST = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍", "문", "양", "배", "백", "남"];
const GIVEN = ["민준", "서준", "도윤", "예준", "시우", "하준", "지호", "주원", "지훈", "준서", "현우", "우진", "선우", "은우", "재윤", "태양", "유준", "승민", "도현", "건우", "민석", "진우", "상호", "영진", "경민", "태현", "성민", "동현", "재현", "승현"];

/** Fictional clubs; reputation spreads the league from title favourites to relegation fodder. */
export const CLUBS: { name: string; shortName: string; color: string; reputation: number; formation: FormationName }[] = [
  { name: "서울 FC", shortName: "서울", color: "#e63946", reputation: 12.5, formation: "4-3-3" },
  { name: "부산 유나이티드", shortName: "부산", color: "#4cc9f0", reputation: 12, formation: "4-4-2" },
  { name: "인천 블루", shortName: "인천", color: "#3a86ff", reputation: 13.5, formation: "4-2-3-1" },
  { name: "대구 울브스", shortName: "대구", color: "#8ecae6", reputation: 11, formation: "3-5-2" },
  { name: "광주 레이즈", shortName: "광주", color: "#ffd166", reputation: 11.5, formation: "4-3-3" },
  { name: "대전 코메츠", shortName: "대전", color: "#c77dff", reputation: 10.5, formation: "4-4-2" },
  { name: "수원 윙스", shortName: "수원", color: "#06d6a0", reputation: 13, formation: "4-2-3-1" },
  { name: "울산 앵커스", shortName: "울산", color: "#f4a261", reputation: 14.5, formation: "4-3-3" },
  { name: "전주 그린", shortName: "전주", color: "#2a9d8f", reputation: 14, formation: "4-2-3-1" },
  { name: "포항 아이언", shortName: "포항", color: "#adb5bd", reputation: 12, formation: "4-4-2" },
  { name: "제주 아일랜더스", shortName: "제주", color: "#ff8fab", reputation: 10, formation: "3-5-2" },
  { name: "창원 세일즈", shortName: "창원", color: "#a7c957", reputation: 11, formation: "4-3-3" },
];

/** 20-man squad: two keepers, eight defenders, six midfielders, four forwards. */
const SQUAD_ROLES: Role[] = ["GK", "GK", "CB", "CB", "CB", "CB", "LB", "LB", "RB", "RB", "DM", "CM", "CM", "CM", "AM", "LW", "RW", "ST", "ST", "LM"];

export function buildSquad(rng: Rng, idPrefix: string, reputation: number): SquadPlayer[] {
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
      id: `${idPrefix}-${i + 1}`,
      name: `${rng.pick(FIRST)}${rng.pick(GIVEN)}`,
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
      squad: buildSquad(rng, `C${id}`, c.reputation),
      tactics: { ...defaultTactics(c.formation), mentality: 0.45 + rng.range(0, 0.1), pressing: 0.4 + rng.range(0, 0.2), directness: 0.4 + rng.range(0, 0.2) },
      selection: { formation: c.formation, starters: [], bench: [] },
    };
    club.selection = autoSelect(club, c.formation);
    return club;
  });
}
