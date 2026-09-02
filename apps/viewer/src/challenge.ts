/**
 * 도전 모드: short scenario matches (≈3 minutes) that live outside the season. A scenario picks the kick-off
 * point (the engine fast-forwards headlessly), forces a scoreline, tweaks the sides and states a win condition.
 * Results are kept in localStorage["3sec.challenge"] only — never in the save, never in the league.
 */
import { Match, generateTeam, type FormationName, type PlayerDef, type TeamDef, type TeamId } from "@3sec/engine";
import { autoSelect, clubOf, selectionProblem, teamDef, type Club, type GameState } from "@3sec/game";

export const CHALLENGE_KEY = "3sec.challenge";

export interface ChallengeRecord {
  tries: number;
  wins: number;
  /** best result, as shown ("성공 · 2-2") */
  best?: string;
  /** ordering key of the best result (higher is better) */
  bestKey?: number;
}

export interface ChallengeScenario {
  id: string;
  icon: string;
  title: string;
  /** what the situation is */
  desc: string;
  /** what counts as success, one line */
  goal: string;
  stars: 1 | 2 | 3;
  /** "shootout": no match screen — 90 headless minutes at 0-0, then the penalty sheet */
  kind: "match" | "shootout";
  /** match seconds at which the user takes over (0 = kick-off) */
  startAt: number;
  /** forced scoreline at the start, from the user's side: [mine, theirs] */
  score: [number, number];
  /** which side the user plays */
  side: TeamId;
  /** opponent quality relative to the user's club reputation (generated teams) */
  oppDelta: number;
  oppName: string;
  oppShort: string;
  oppColor: string;
  oppFormation?: FormationName;
  /** the opponent is a real league club instead of a generated one */
  realOpponent?: boolean;
  /** attribute shift applied to the user's players */
  myDelta?: number;
  /** a man down from the start */
  tenMen?: boolean;
  /** stoppage time forced at the start (seconds) */
  addedTime?: number;
  derby?: boolean;
  win: (mine: number, theirs: number) => boolean;
}

export const CHALLENGES: ChallengeScenario[] = [
  {
    id: "comeback", icon: "🔥", title: "역전극", stars: 2, kind: "match",
    desc: "후반 60분, 0:2로 끌려가는 홈 경기. 30분 안에 따라잡으세요.",
    goal: "무승부 이상이면 성공", startAt: 60 * 60, score: [0, 2], side: 0,
    oppDelta: 0, oppName: "강북 유나이티드", oppShort: "강북", oppColor: "#c8102e", oppFormation: "4-4-2",
    win: (a, b) => a >= b,
  },
  {
    id: "holdon", icon: "🧱", title: "지키기", stars: 2, kind: "match",
    desc: "후반 75분, 1:0으로 앞선 원정 경기. 상대는 리그 최강급 팀입니다.",
    goal: "실점 없이 끝내면 성공", startAt: 75 * 60, score: [1, 0], side: 1,
    oppDelta: 4, oppName: "한강 로얄스", oppShort: "로얄", oppColor: "#5b2c83", oppFormation: "4-3-3",
    win: (a, b) => b === 0 && a > b,
  },
  {
    id: "tenmen", icon: "🟥", title: "10명으로", stars: 3, kind: "match",
    desc: "후반 55분, 1:1 상황에서 우리 선수 한 명이 퇴장당했습니다. 열 명으로 버티고 이기세요.",
    goal: "승리하면 성공", startAt: 55 * 60, score: [1, 1], side: 0, tenMen: true,
    oppDelta: 1, oppName: "동해 파도", oppShort: "동해", oppColor: "#1e6fb8", oppFormation: "4-2-3-1",
    win: (a, b) => a > b,
  },
  {
    id: "derby", icon: "⚡", title: "더비 결승골", stars: 2, kind: "match",
    desc: "라이벌전 90분, 1:1 동점. 추가시간은 5분입니다. 관중은 이미 일어섰습니다.",
    goal: "추가시간 안에 득점해 이기면 성공", startAt: 90 * 60, score: [1, 1], side: 0, addedTime: 5 * 60, derby: true,
    oppDelta: 0, oppName: "강남 시티", oppShort: "강남", oppColor: "#f2a900", oppFormation: "4-4-2",
    win: (a, b) => a > b,
  },
  {
    id: "daily", icon: "📅", title: "오늘의 한 경기", stars: 1, kind: "match",
    desc: "리그의 다른 팀과 전반 30분부터. 상대는 날마다 바뀝니다.",
    goal: "이기면 성공", startAt: 30 * 60, score: [0, 0], side: 0, realOpponent: true,
    oppDelta: 0, oppName: "", oppShort: "", oppColor: "#888",
    win: (a, b) => a > b,
  },
  {
    id: "shootout", icon: "🥅", title: "승부차기", stars: 1, kind: "shootout",
    desc: "90분 0:0. 남은 것은 승부차기뿐 — 우리 키커들의 마무리와 침착성에 달렸습니다.",
    goal: "승부차기에서 이기면 성공", startAt: 0, score: [0, 0], side: 0,
    oppDelta: 0, oppName: "남산 타이거즈", oppShort: "남산", oppColor: "#e07a10", oppFormation: "4-3-3",
    win: (a, b) => a > b,
  },
  {
    id: "underdog", icon: "🐺", title: "언더독", stars: 3, kind: "match",
    desc: "우리 선수 능력치 -3, 상대는 +2. 킥오프부터 90분 원정 경기입니다.",
    goal: "무승부 이상이면 성공", startAt: 0, score: [0, 0], side: 1, myDelta: -3,
    oppDelta: 2, oppName: "서해 마린", oppShort: "서해", oppColor: "#0a9396", oppFormation: "4-3-3",
    win: (a, b) => a >= b,
  },
  {
    id: "fireworks", icon: "🎆", title: "골 폭죽", stars: 2, kind: "match",
    desc: "전반 20분부터 홈 경기. 상대는 약하지만 골은 넣어야 합니다.",
    goal: "4골 이상 넣으면 성공", startAt: 20 * 60, score: [0, 0], side: 0,
    oppDelta: -3, oppName: "북한산 FC", oppShort: "북산", oppColor: "#6a994e", oppFormation: "3-5-2",
    win: (a) => a >= 4,
  },
];

export function challengeById(id: string): ChallengeScenario | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

/** Local calendar day as a number (20260902): seeds change at midnight, retries the same day replay the same match. */
export function dayNumber(d = new Date()): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function challengeSeed(id: string, day = dayNumber()): number {
  return (hash(id) ^ Math.imul(day, 0x9e3779b1)) >>> 0;
}

/** Attribute shift for every player of a side (clamped to 1..20). */
function shiftTeam(t: TeamDef, delta: number): TeamDef {
  if (!delta) return t;
  const sh = (p: PlayerDef): PlayerDef => ({
    ...p,
    attrs: Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [k, Math.max(1, Math.min(20, v + delta))])) as unknown as PlayerDef["attrs"],
  });
  return { ...t, players: t.players.map(sh), bench: t.bench.map(sh) };
}

/** The user's current squad and tactics, with the selection repaired if it cannot start as it stands. */
function userTeam(s: GameState, side: TeamId): TeamDef {
  const me = clubOf(s, s.userClub);
  const c: Club = selectionProblem(me) ? { ...me, selection: autoSelect(me, me.selection.formation) } : me;
  return teamDef(c, side);
}

export interface BuiltChallenge {
  match: Match;
  side: TeamId;
  seed: number;
  opponent: { name: string; shortName: string; color: string; clubId?: number };
}

/** Build the engine match of a scenario (the user's side is human-managed). Fast-forward and setup follow in `applyScenario`. */
export function buildChallenge(s: GameState, scen: ChallengeScenario, day = dayNumber()): BuiltChallenge {
  const seed = challengeSeed(scen.id, day);
  const me = clubOf(s, s.userClub);
  const side = scen.side;
  const oppSide: TeamId = side === 0 ? 1 : 0;
  let opp: TeamDef;
  let clubId: number | undefined;
  if (scen.realOpponent) {
    const pool = s.clubs.filter((c) => c.id !== me.id);
    const club = pool[seed % pool.length]!;
    const c: Club = selectionProblem(club) ? { ...club, selection: autoSelect(club, club.selection.formation) } : club;
    opp = teamDef(c, oppSide);
    clubId = club.id;
  } else {
    const quality = Math.max(6, Math.min(19, Math.round(me.reputation + scen.oppDelta)));
    opp = generateTeam({ id: oppSide, name: scen.oppName, shortName: scen.oppShort, color: scen.oppColor, formation: scen.oppFormation, quality, seed });
  }
  const mine = shiftTeam(userTeam(s, side), scen.myDelta ?? 0);
  const home = side === 0 ? mine : opp;
  const away = side === 0 ? opp : mine;
  const match = new Match(home, away, { seed, aiManaged: [oppSide] });
  return { match, side, seed, opponent: { name: opp.name, shortName: opp.shortName, color: opp.color, clubId } };
}

/**
 * After the headless fast-forward: force the scoreline, drop the simulated period's noise (its events and
 * injuries — the user was not there to react) but keep the red cards, then apply the scenario's twists.
 */
export function applyScenario(m: Match, scen: ChallengeScenario, side: TeamId): void {
  const s = m.state;
  const mine = scen.score[0], theirs = scen.score[1];
  m.setScore(side === 0 ? mine : theirs, side === 0 ? theirs : mine);
  const keep = s.events.filter((e) => e.type === "RED_CARD");
  s.events.length = 0;
  s.events.push(...keep);
  for (const p of s.players) p.injured = false;
  if (scen.addedTime) s.addedTime = scen.addedTime;
  if (scen.tenMen) {
    // the most advanced outfielder in the lineup (last slot) walks: the side must reshape with ten
    const ids = s.lineups[side];
    const id = [...ids].reverse().find((x) => !m.player(x).sentOff && ids.indexOf(x) > 0);
    if (id) m.sendOff(id, "퇴장 (시나리오)");
  }
}

/** Success and the user's score from the finished match. */
export function challengeOutcome(m: Match, scen: ChallengeScenario, side: TeamId, penalties?: [number, number]): { ok: boolean; mine: number; theirs: number } {
  const mine = penalties ? penalties[side] : m.state.score[side];
  const theirs = penalties ? penalties[side === 0 ? 1 : 0] : m.state.score[side === 0 ? 1 : 0];
  return { ok: scen.win(mine, theirs), mine, theirs };
}

// ------------------------------------------------------------ records (localStorage only)

export function loadChallengeRecords(): Record<string, ChallengeRecord> {
  try {
    const raw = localStorage.getItem(CHALLENGE_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, ChallengeRecord>) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveChallengeRecords(r: Record<string, ChallengeRecord>): void {
  try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

/** Add one attempt; the best result is the win with the biggest margin, otherwise the closest defeat. */
export function recordChallenge(id: string, ok: boolean, mine: number, theirs: number, note = ""): ChallengeRecord {
  const all = loadChallengeRecords();
  const rec: ChallengeRecord = all[id] ?? { tries: 0, wins: 0 };
  rec.tries++;
  if (ok) rec.wins++;
  const key = (ok ? 1000 : 0) + (mine - theirs) * 10 + mine;
  if (rec.bestKey === undefined || key > rec.bestKey) {
    rec.bestKey = key;
    rec.best = `${ok ? "성공" : "실패"} · ${mine}-${theirs}${note}`;
  }
  all[id] = rec;
  saveChallengeRecords(all);
  return rec;
}

export function clearChallengeRecords(): void {
  try { localStorage.removeItem(CHALLENGE_KEY); } catch { /* ignore */ }
}

export const stars = (n: number): string => "★".repeat(n) + "☆".repeat(3 - n);
