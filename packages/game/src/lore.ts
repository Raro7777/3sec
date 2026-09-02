/**
 * 구단 역사와 라이벌전: every club has a founding year, a nickname, a short history, an honours count and one primary
 * rival (pairs by region and story). A fixture between rivals is a derby: news before and after, a doubled fan-mood
 * swing (fans.ts adjustMood on top of the weekly update), and ±DERBY_CONFIDENCE for the user's board.
 *
 * Hooks: `markDerbies` from buildFixtures (and lazily from prepareRound / the save migration), `derbyPreview` from
 * prepareRound, `derbyResult` from recordResult (league and cup alike).
 */
import type { Club, Fixture, GameState } from "./types";
import { clubOf } from "./season";
import { FAN_MOOD, adjustMood } from "./fans";

export interface ClubLore {
  /** club id (index in world.ts CLUBS) */
  id: number;
  founded: number;
  nickname: string;
  history: string;
  /** league titles + cups before the game starts */
  honours: number;
  /** primary rival's club id */
  rival: number;
  /** name of the derby against the primary rival */
  derby: string;
}

/** Board-confidence swing for the user on a derby result. */
export const DERBY_CONFIDENCE = 2;

/** Order matches world.ts CLUBS: 서울 부산 인천 대구 광주 대전 수원 울산 전주 포항 제주 창원. */
export const CLUB_LORE: ClubLore[] = [
  { id: 0, founded: 1983, nickname: "수도의 붉은 군단", history: "프로 원년부터 수도 서울을 지켜 온 명문. 90년대 황금기 이후 긴 침체를 겪었지만 팬층은 여전히 리그 최대다.", honours: 7, rival: 2, derby: "수도권 더비" },
  { id: 1, founded: 1979, nickname: "항구의 갈매기", history: "부두 노동자 클럽에서 출발한 리그 최고령 구단. 화끈한 공격 축구와 시끄러운 홈구장으로 이름났다.", honours: 5, rival: 7, derby: "동남 더비" },
  { id: 2, founded: 1996, nickname: "블루 웨이브", history: "공항 도시의 신흥 부호가 세운 젊은 구단. 외국인 감독과 데이터 축구로 빠르게 상위권에 자리 잡았다.", honours: 2, rival: 0, derby: "수도권 더비" },
  { id: 3, founded: 1988, nickname: "늑대들", history: "섬유 도시의 시민구단. 예산은 늘 빠듯하지만 유스에서 키운 선수로 버티는 끈질긴 팀이다.", honours: 1, rival: 9, derby: "영남 더비" },
  { id: 4, founded: 1992, nickname: "빛고을 레이즈", history: "대학 축구 명문에서 프로로 전환한 구단. 기술 축구를 고집하며 리그에 여러 스타를 배출했다.", honours: 2, rival: 8, derby: "호남 더비" },
  { id: 5, founded: 1997, nickname: "혜성", history: "과학 도시의 시민구단. 창단 3년 만의 컵 우승 이후로는 잔류 싸움이 잦았고, 그때마다 팬들이 구단을 지켜냈다.", honours: 1, rival: 11, derby: "중부 더비" },
  { id: 6, founded: 1995, nickname: "날개", history: "대기업 자본으로 창단해 단숨에 리그를 평정한 구단. 서울과의 대결은 매 시즌 최고의 흥행 카드다.", honours: 6, rival: 0, derby: "경부 더비" },
  { id: 7, founded: 1984, nickname: "닻", history: "조선소의 도시가 만든 강팀. 묵직한 수비와 세트피스로 우승을 쌓아 온 리그의 전통 강호다.", honours: 8, rival: 1, derby: "동남 더비" },
  { id: 8, founded: 1994, nickname: "초록 전사", history: "리그 최고의 유소년 시스템으로 유명한 호남의 자존심. 2000년대 후반 3연패의 왕조를 세웠다.", honours: 9, rival: 4, derby: "호남 더비" },
  { id: 9, founded: 1973, nickname: "강철", history: "제철소 실업팀에서 출발한 리그의 살아 있는 역사. 외부 영입보다 유스와 조직력을 믿는 구단이다.", honours: 6, rival: 3, derby: "영남 더비" },
  { id: 10, founded: 2006, nickname: "섬사람들", history: "리그에서 가장 젊은 섬 구단. 긴 원정길과 적은 관중이 약점이지만 바람 부는 홈에서는 누구도 쉽지 않다.", honours: 0, rival: 1, derby: "남해 더비" },
  { id: 11, founded: 2001, nickname: "돛", history: "기계 공단 도시의 시민구단. 승격과 강등을 오가다 최근 안정적인 1부 팀으로 자리 잡았다.", honours: 0, rival: 5, derby: "중부 더비" },
];

const FALLBACK: Omit<ClubLore, "id" | "rival"> = { founded: 2000, nickname: "", history: "역사가 짧은 구단입니다.", honours: 0, derby: "라이벌전" };

/** Lore of a club (a club outside the roster gets a bland fallback and no rival). */
export function clubLore(id: number): ClubLore {
  return CLUB_LORE[id] ?? { id, rival: -1, ...FALLBACK };
}

export const rivalOf = (id: number): number => clubLore(id).rival;

/** Two clubs meet in a derby when either counts the other as its primary rival. */
export const isDerby = (homeId: number, awayId: number): boolean => homeId !== awayId && (rivalOf(homeId) === awayId || rivalOf(awayId) === homeId);

/** Name of the derby between two clubs (the primary pair's name), or null when it is no derby. */
export function derbyName(a: number, b: number): string | null {
  if (!isDerby(a, b)) return null;
  return rivalOf(a) === b ? clubLore(a).derby : clubLore(b).derby;
}

/** Flag every derby in a fixture list (idempotent; buildFixtures and the save migration call it). */
export function markDerbies<T extends { home: number; away: number; derby?: boolean }>(fixtures: T[]): T[] {
  for (const f of fixtures) if (isDerby(f.home, f.away)) f.derby = true;
  return fixtures;
}

export interface DerbyInfo { name: string; home: Club; away: Club; /** the user's opponent when the user plays, else null */ rival: Club | null }

/** Derby details for a fixture (or a cup tie shaped like one), null when the clubs are no rivals. Used by the viewer. */
export function derbyFor(s: GameState, f: Pick<Fixture, "home" | "away">): DerbyInfo | null {
  const name = derbyName(f.home, f.away);
  if (!name) return null;
  const home = clubOf(s, f.home), away = clubOf(s, f.away);
  const rival = f.home === s.userClub ? away : f.away === s.userClub ? home : null;
  return { name, home, away, rival };
}

/**
 * Before a round (prepareRound): flags the round's derbies for saves built before lore and announces the user's
 * derby once ("더비 데이: …"; the flag on the fixture keeps the news from repeating on later prepareRound calls).
 */
export function derbyPreview(s: GameState, fixtures: Fixture[]): void {
  for (const f of fixtures) {
    if (f.score || !isDerby(f.home, f.away)) continue;
    const mine = f.home === s.userClub || f.away === s.userClub;
    if (mine && !f.derby) {
      const info = derbyFor(s, f)!;
      const opp = info.rival!;
      s.news.unshift(`더비 데이: ${info.name} — ${opp.name}(${clubLore(opp.id).nickname}) 상대로 ${f.home === s.userClub ? "홈" : "원정"} 라이벌전. 팬들이 승리를 요구합니다.`);
    }
    f.derby = true;
  }
}

/**
 * After a derby (recordResult, league or cup): the winner's headline, an extra mood swing for both sets of fans on
 * top of the weekly one, and ±DERBY_CONFIDENCE for the user's board when the user played. A draw moves nothing.
 */
export function derbyResult(s: GameState, f: Pick<Fixture, "home" | "away" | "score">, cup = false): void {
  if (!f.score || !isDerby(f.home, f.away)) return;
  const home = clubOf(s, f.home), away = clubOf(s, f.away);
  const name = derbyName(f.home, f.away)!;
  const [hg, ag] = f.score;
  if (hg === ag) {
    s.news.unshift(`${name}${cup ? " (컵)" : ""}: ${home.shortName}과(와) ${away.shortName}이(가) ${hg}-${ag}로 비겼습니다. 양쪽 팬 모두 아쉬움을 삼켰습니다.`);
    return;
  }
  const winner = hg > ag ? home : away, loser = hg > ag ? away : home;
  if (winner.fans) adjustMood(winner, FAN_MOOD.win);
  if (loser.fans) adjustMood(loser, -FAN_MOOD.loss);
  const margin = Math.abs(hg - ag);
  s.news.unshift(`${name}${cup ? " (컵)" : ""}: ${winner.name}, 라이벌 ${loser.shortName}을(를) ${Math.max(hg, ag)}-${Math.min(hg, ag)}로 ${margin >= 3 ? "대파" : "제압"}! ${winner.shortName} 팬들이 밤새 축제를 벌였습니다.`);
  if (s.board && !s.board.sacked && (winner.id === s.userClub || loser.id === s.userClub)) {
    const d = winner.id === s.userClub ? DERBY_CONFIDENCE : -DERBY_CONFIDENCE;
    s.board.confidence = Math.round(Math.max(0, Math.min(100, s.board.confidence + d)) * 10) / 10;
  }
}
