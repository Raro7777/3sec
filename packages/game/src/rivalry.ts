/**
 * 감독 라이벌: the user's record against every opposing manager (managerH2H), a feud level per manager
 * that the derby press week (story.ts rivalTaunt) raises or cools, and the rival manager's quote after
 * a derby. A feud makes the derby matter more: a bigger fan and dressing-room swing either way.
 *
 * Hooks: `recordManagerH2H` from recordResult, `derbyQuote` from lore.derbyResult.
 */
import type { Club, Fixture, GameState, Manager } from "./types";
import { clubOf, table } from "./season";
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

/**
 * What the opposing manager told the press this week, in his own words — the line on the wall of the
 * 감독실 before the match. It is not scouting (that is managerPreview in the viewer): it is temperament,
 * the feud between the two benches, the record between them and where the two sides sit in the table.
 * Deterministic per fixture so the room does not change its mind between renders.
 */
export function pressQuote(s: GameState, m: Manager, me: Club, opp: Club, seed = s.round + s.season * 40): string {
  const t = m.traits;
  const feud = feudWith(s, m.id);
  const rec = s.managerH2H?.[m.id];
  const games = rec ? rec.w + rec.d + rec.l : 0;
  const rows = table(s);
  const posOf = (id: number): number => rows.findIndex((r) => r.club === id) + 1;
  const myPos = posOf(me.id), theirPos = posOf(opp.id);
  const played = rows.find((r) => r.club === me.id)?.played ?? 0;
  const gap = opp.reputation - me.reputation;
  const home = s.fixtures.some((f) => f.round === s.round && f.home === opp.id && f.away === me.id);
  const pick = (arr: string[]): string => arr[Math.abs(seed * 31 + m.id.length * 7) % arr.length]!;
  const you = `${s.managerName} 감독`;
  // the feud speaks first
  if (feud >= FEUD_AT) return pick([
    `"${you}과는 할 말이 없다. 경기장에서 보자."`,
    `"지난번 일은 잊지 않았다. 우리 선수들도 마찬가지다."`,
    `"${you}이 뭐라고 하든 관심 없다. 우리가 이기면 그걸로 끝이다."`,
  ]);
  // then the record between the two benches
  if (rec && games >= 2 && rec.w === 0 && rec.l >= 2) return pick([
    `"${me.shortName}에게 계속 당할 수는 없다. 이번엔 다르다."`,
    `"우리가 ${me.shortName} 상대로 약했던 건 사실이다. 그래서 더 준비했다."`,
  ]);
  if (rec && games >= 2 && rec.l === 0 && rec.w >= 2) return pick([
    `"${me.shortName}은 우리에게 편한 상대였다. 방심만 안 하면 된다."`,
    `"기록이 말해 준다. 우리는 ${me.shortName}을 어떻게 이기는지 안다."`,
  ]);
  // the table, once it means something
  if (played >= 5 && myPos > 0 && theirPos > 0) {
    if (theirPos <= 3 && myPos >= rows.length - 3) return pick([
      `"순위표대로 되는 경기는 없다. 하지만 우리가 어디 있는지는 안다."`,
      `"강등권 팀은 죽기 살기로 나온다. 그래서 더 냉정하게 이기겠다."`,
    ]);
    if (myPos <= 3 && theirPos >= rows.length - 3) return pick([
      `"${me.shortName}이 잘나가는 건 안다. 그런 팀을 잡아야 우리가 산다."`,
      `"잃을 게 없는 쪽이 우리다. 부담은 ${me.shortName}이 가져가라."`,
    ]);
    if (Math.abs(myPos - theirPos) <= 2) return pick([
      `"승점 6점짜리 경기다. 선수들도 안다."`,
      `"${me.shortName}과 우리는 같은 자리를 놓고 싸운다. 물러설 이유가 없다."`,
    ]);
  }
  // otherwise temperament
  if (t.temper > 0.65) return pick([
    `"${me.shortName}이 어떻게 나오든 우리는 우리 축구를 한다. 상대 걱정은 안 한다."`,
    `"심판만 제대로 보면 된다. 나머지는 우리가 알아서 한다."`,
  ]);
  if (t.stubborn > 0.65) return pick([
    `"바꿀 건 없다. 시즌 내내 이렇게 해 왔고 이번에도 그렇다."`,
    `"우리 방식이 옳다는 걸 90분 안에 보여 주겠다."`,
  ]);
  if (t.attack > 0.65) return pick([
    `"골을 넣으러 간다. ${home ? "홈 팬들 앞에서" : "원정이라고"} 잠글 생각은 없다."`,
    `"두 골 먹으면 세 골 넣으면 된다. 우리는 그런 팀이다."`,
  ]);
  if (t.pragmatism > 0.6 && gap <= -1) return pick([
    `"${me.shortName}이 더 좋은 팀이다. 그래서 우리는 더 영리하게 뛰어야 한다."`,
    `"점유율은 내줘도 된다. 중요한 건 마지막 30미터다."`,
  ]);
  if (gap >= 1) return pick([
    `"우리가 이겨야 하는 경기다. 그 부담은 즐기면 된다."`,
    `"${me.shortName}을 얕보지 않는다. 하지만 우리 홈 팬들은 승리를 기대한다."`,
  ]);
  return pick([
    `"${you}의 팀은 준비가 잘 돼 있을 것이다. 우리도 그렇다."`,
    `"특별한 말은 없다. 90분 동안 뛰고, 결과로 이야기하겠다."`,
    `"${home ? "홈에서" : "원정이지만"} 승점 3점을 가져오는 것만 생각한다."`,
  ]);
}
