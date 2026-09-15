/**
 * 감독 라이벌: the user's record against every opposing manager (managerH2H), a feud level per manager
 * that the derby press week (story.ts rivalTaunt) raises or cools, and the rival manager's quote after
 * a derby. A feud makes the derby matter more: a bigger fan and dressing-room swing either way.
 *
 * Hooks: `recordManagerH2H` from recordResult, `derbyQuote` from lore.derbyResult.
 */
import type { Club, Fixture, GameState, Manager } from "./types";
import { clubOf } from "./season";
import { rivalOf } from "./lore";
import { adjustSquadMorale } from "./morale";
import { adjustMood } from "./fans";

export interface ManagerH2H { name: string; club: number; w: number; d: number; l: number; last: number }

/** From this feud level the two are 앙숙 in the papers and the derby swings harder. */
export const FEUD_AT = 2;
export const FEUD_MAX = 5;

export const feudWith = (s: GameState, managerId: string): number => s.feud?.[managerId] ?? 0;
export function adjustFeud(s: GameState, managerId: string, d: number): number {
  const f = Math.max(0, Math.min(FEUD_MAX, feudWith(s, managerId) + d));
  (s.feud ??= {})[managerId] = f;
  return f;
}

/** The manager of the user's traditional rival (lore.ts), if the club has one at the moment. */
export function rivalManager(s: GameState): { club: Club; manager: Manager } | null {
  const club = clubOf(s, rivalOf(s.userClub));
  return club?.manager ? { club, manager: club.manager } : null;
}

export function recordManagerH2H(s: GameState, f: Pick<Fixture, "home" | "away" | "score">): void {
  if (!f.score || (f.home !== s.userClub && f.away !== s.userClub)) return;
  const oppId = f.home === s.userClub ? f.away : f.home;
  const opp = clubOf(s, oppId);
  const m = opp?.manager;
  if (!m) return;
  const mine = f.home === s.userClub ? f.score[0] : f.score[1], theirs = f.home === s.userClub ? f.score[1] : f.score[0];
  const h = (s.managerH2H ??= {});
  const r = (h[m.id] ??= { name: m.name, club: opp.id, w: 0, d: 0, l: 0, last: s.season });
  r.name = m.name; r.club = opp.id; r.last = s.season;
  if (mine > theirs) r.w++; else if (mine < theirs) r.l++; else r.d++;
}

/** The managers the user has met most, most-played first. */
export function h2hTable(s: GameState, n = 8): (ManagerH2H & { id: string; feud: number; games: number })[] {
  return Object.entries(s.managerH2H ?? {})
    .map(([id, r]) => ({ id, ...r, feud: feudWith(s, id), games: r.w + r.d + r.l }))
    .sort((a, b) => b.games - a.games || b.last - a.last)
    .slice(0, n);
}

/** What the opposing manager says in the derby press week, by temperament. */
export function tauntLine(m: Manager, userName: string): string {
  const t = m.traits;
  if (t.temper > 0.65) return `"${userName} 감독의 축구는 솔직히 보기 힘들다. 우리 팬들이 실망할 일은 없을 것이다."`;
  if (t.stubborn > 0.65) return `"결과는 이미 정해져 있다고 본다. 상대가 누구든 우리는 우리 방식대로 이긴다."`;
  if (t.attack > 0.65) return `"그쪽은 골문 앞에 버스를 세울 것이다. 우리는 골을 넣으러 나간다."`;
  return `"${userName} 감독은 좋은 지도자지만, 이 도시에서 진짜 팀이 누구인지는 90분이 말해 줄 것이다."`;
}

/**
 * After a derby the user played: the rival manager's line, and with a feud the swing on top of lore.ts.
 * Returns the news line (already pushed).
 */
export function derbyQuote(s: GameState, f: Pick<Fixture, "home" | "away" | "score">): string | null {
  if (!f.score || (f.home !== s.userClub && f.away !== s.userClub)) return null;
  const oppId = f.home === s.userClub ? f.away : f.home;
  const opp = clubOf(s, oppId), me = clubOf(s, s.userClub);
  const m = opp?.manager;
  if (!m) return null;
  const mine = f.home === s.userClub ? f.score[0] : f.score[1], theirs = f.home === s.userClub ? f.score[1] : f.score[0];
  const feud = feudWith(s, m.id);
  const hot = feud >= FEUD_AT;
  let line: string;
  if (mine > theirs) {
    line = hot ? `${m.name} 감독: "심판 판정에 대해서는 말하지 않겠다. 다음에 보자." — 앙숙에게 진 뒤 기자회견을 3분 만에 끝냈습니다.` : `${m.name} 감독: "오늘은 ${me.shortName}이(가) 더 나았다. 축하한다."`;
    if (hot) { adjustSquadMorale(me, feud); adjustMood(me, feud); }
    adjustFeud(s, m.id, 0);
  } else if (mine < theirs) {
    line = hot ? `${m.name} 감독: "말은 누구나 할 수 있다. 오늘 경기장에서 답했다." — 앙숙의 한마디가 우리 팬들의 속을 긁었습니다.` : `${m.name} 감독: "더비는 늘 어렵다. 선수들이 자랑스럽다."`;
    if (hot) adjustMood(me, -feud);
  } else {
    line = `${m.name} 감독: "양 팀 다 지지 않으려 했다. 팬들에게는 미안하다."`;
  }
  s.news.unshift(line);
  return line;
}

/** A season cools every feud by one; a manager the user no longer meets is forgotten from the feud list. */
export function rivalryRollover(s: GameState): void {
  if (!s.feud) return;
  for (const id of Object.keys(s.feud)) { s.feud[id] = Math.max(0, (s.feud[id] ?? 0) - 1); if (!s.feud[id]) delete s.feud[id]; }
}
