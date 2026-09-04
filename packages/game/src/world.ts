import { Rng, defaultTactics, generateAttributes, type FormationName, type Role } from "@3sec/engine";
import type { Club, SquadPlayer } from "./types";
import { autoSelect } from "./selection";
import { seasonBudget } from "./transfers";
import { overall } from "./rating";
import { wageFor } from "./contracts";
import { generateManager, managerTraining } from "./managers";
import { generateClubStaff } from "./staff";
import { newFans } from "./fans";
import { ensureCaptain, ensurePersonality, lockerRoom } from "./morale";

const FIRST = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍", "문", "양", "배", "백", "남"];
const GIVEN = ["민준", "서준", "도윤", "예준", "시우", "하준", "지호", "주원", "지훈", "준서", "현우", "우진", "선우", "은우", "재윤", "태양", "유준", "승민", "도현", "건우", "민석", "진우", "상호", "영진", "경민", "태현", "성민", "동현", "재현", "승현"];

export const randomName = (rng: Rng): string => `${rng.pick(FIRST)}${rng.pick(GIVEN)}`;

/** Fictional clubs; reputation spreads the league from title favourites to relegation fodder. */
/** `capacity` = stadium seats; the viewer's stadiums.ts mirrors these numbers (keep them in step). */
export const CLUBS: { name: string; shortName: string; color: string; reputation: number; formation: FormationName; capacity: number }[] = [
  { name: "서울 FC", shortName: "서울", color: "#e63946", reputation: 12.3, formation: "4-3-3", capacity: 58000 },
  { name: "부산 유나이티드", shortName: "부산", color: "#4cc9f0", reputation: 12, formation: "4-4-2", capacity: 43000 },
  { name: "인천 블루", shortName: "인천", color: "#3a86ff", reputation: 13.2, formation: "4-2-3-1", capacity: 38000 },
  { name: "대구 울브스", shortName: "대구", color: "#8ecae6", reputation: 11.3, formation: "3-5-2", capacity: 26000 },
  { name: "광주 레이즈", shortName: "광주", color: "#ffd166", reputation: 11.5, formation: "4-3-3", capacity: 22000 },
  { name: "대전 코메츠", shortName: "대전", color: "#c77dff", reputation: 10.8, formation: "4-4-2", capacity: 31000 },
  { name: "수원 윙스", shortName: "수원", color: "#06d6a0", reputation: 12.9, formation: "4-2-3-1", capacity: 44000 },
  { name: "울산 앵커스", shortName: "울산", color: "#f4a261", reputation: 14, formation: "4-3-3", capacity: 40000 },
  { name: "전주 그린", shortName: "전주", color: "#2a9d8f", reputation: 13.7, formation: "4-2-3-1", capacity: 36000 },
  { name: "포항 아이언", shortName: "포항", color: "#adb5bd", reputation: 12, formation: "4-4-2", capacity: 20000 },
  { name: "제주 아일랜더스", shortName: "제주", color: "#ff8fab", reputation: 10.5, formation: "3-5-2", capacity: 18000 },
  { name: "창원 세일즈", shortName: "창원", color: "#a7c957", reputation: 11.2, formation: "4-3-3", capacity: 24000 },
];

/**
 * The second division's twelve clubs. Reputation runs 8.2-11.0 against the top flight's 10.5-14, so
 * the two leagues overlap at the edges: a strong second-division side is a match for a poor
 * first-division one, which is what makes a promotion season survivable.
 */
export const CLUBS_D2: { name: string; shortName: string; color: string; reputation: number; formation: FormationName; capacity: number }[] = [
  { name: "청주 스톤즈", shortName: "청주", color: "#8d99ae", reputation: 12.2, formation: "4-4-2", capacity: 15000 },
  { name: "안양 퍼플", shortName: "안양", color: "#7b2cbf", reputation: 11.9, formation: "4-2-3-1", capacity: 17000 },
  { name: "김포 타이드", shortName: "김포", color: "#118ab2", reputation: 11.6, formation: "4-3-3", capacity: 12000 },
  { name: "천안 브릭스", shortName: "천안", color: "#bc6c25", reputation: 11.4, formation: "4-4-2", capacity: 14000 },
  { name: "여수 게일즈", shortName: "여수", color: "#00b4d8", reputation: 11.1, formation: "3-5-2", capacity: 11000 },
  { name: "원주 하이랜더스", shortName: "원주", color: "#606c38", reputation: 10.9, formation: "4-4-2", capacity: 13000 },
  { name: "군산 하버", shortName: "군산", color: "#264653", reputation: 10.6, formation: "4-2-3-1", capacity: 10000 },
  { name: "충주 밀즈", shortName: "충주", color: "#e07a5f", reputation: 10.4, formation: "4-3-3", capacity: 9000 },
  { name: "속초 웨일스", shortName: "속초", color: "#457b9d", reputation: 10.2, formation: "4-4-2", capacity: 8000 },
  { name: "구미 서킷", shortName: "구미", color: "#ffb703", reputation: 10.0, formation: "4-3-3", capacity: 12000 },
  { name: "목포 앵커스", shortName: "목포", color: "#5f0f40", reputation: 9.7, formation: "3-5-2", capacity: 9000 },
  { name: "정선 마운티스", shortName: "정선", color: "#3d5a80", reputation: 9.4, formation: "4-4-2", capacity: 7000 },
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
    // Squads are uneven: a poor club still has a couple of players above its station, a rich one has passengers.
    const quality = reputation + ageAdj + rng.gauss(0, 1.25) + (i >= 11 ? -0.8 : 0);
    let number = i === 0 ? 1 : i === 1 ? 12 : rng.int(2, 40);
    while (numbers.has(number)) number = rng.int(2, 99);
    numbers.add(number);
    const attrs = generateAttributes(rng, role, quality);
    const ovr = overall(attrs, role);
    // Young players carry headroom; from the late twenties the ceiling is where they stand.
    const potential = Math.max(ovr, Math.min(20, Math.round((ovr + Math.max(0, 27 - age) * 0.55 + rng.gauss(0.5, 1)) * 10) / 10));
    squad.push({
      id: `${idPrefix}-${i + 1}`,
      name: randomName(rng),
      number,
      role,
      attrs,
      age,
      potential,
      growth: 0,
      wage: 0,
      contractUntil: rng.int(1, 3),
      condition: 1,
      injuryDays: 0,
      ban: 0,
      seasonYellows: 0,
      stats: { apps: 0, goals: 0, minutes: 0, yellows: 0, reds: 0 },
    });
  });
  // personality and morale come from the id (morale.ts), so the squad's dice are untouched
  for (const p of squad) ensurePersonality(p);
  return squad;
}

export function buildClubs(seed: number): Club[] {
  // Ids run through the first division and then the second, so `CLUBS[id]` still names a top-flight
  // club and the second division starts at id 12 (divisions.ts).
  const defs = [...CLUBS.map((c) => ({ ...c, division: 1 })), ...CLUBS_D2.map((c) => ({ ...c, division: 2 }))];
  return defs.map((c, id) => {
    const rng = new Rng(seed * 31 + id * 1009 + 7);
    const club: Club = {
      id,
      name: c.name,
      shortName: c.shortName,
      color: c.color,
      reputation: c.reputation,
      division: c.division,
      budget: seasonBudget(c.reputation, null),
      seasonStartBudget: seasonBudget(c.reputation, null),
      squad: buildSquad(rng, `C${id}`, c.reputation),
      tactics: { ...defaultTactics(c.formation), mentality: 0.45 + rng.range(0, 0.1), pressing: 0.4 + rng.range(0, 0.2), directness: 0.4 + rng.range(0, 0.2) },
      selection: { formation: c.formation, starters: [], bench: [] },
      training: { focus: "balanced", intensity: "normal" },
      youth: { prospects: [], scouting: "local", coaching: 1, nextId: 1 },
      staff: [],
      manager: null,
      pressure: 0,
      capacity: c.capacity,
      fans: newFans(c.reputation, c.capacity),
    };
    for (const p of club.squad) p.wage = wageFor(p);
    // The dugout: a personality drawn after the squad so squads are unchanged by the manager's dice.
    club.manager = generateManager(rng, 1, `M${id}-S1`);
    club.training = managerTraining(club.manager);
    club.selection = autoSelect(club, c.formation);
    // The backroom: drawn last so neither squad nor manager changes with the staff dice.
    club.staff = generateClubStaff(rng, club, 1);
    // The armband goes to the most experienced player; the locker room starts from the squad's morale (morale.ts).
    ensureCaptain(club);
    lockerRoom(club);
    return club;
  });
}
