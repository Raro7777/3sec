/**
 * 시나리오 모드: a career started under a named constraint and judged at the end of its first season.
 * A scenario picks the club, bends the opening state (budget, squad, board) and may forbid a kind of
 * signing for the whole season; `judgeScenario` reads the finished season and marks it cleared or failed.
 *
 * Hooks: `newScenarioGame` (viewer onboarding), `scenarioBlock` from transfers.ts (the rules),
 * `judgeScenario` from startNextSeason, `clearedScenarios` for the hall of fame.
 */
import type { Club, GameState, SeasonRecord, SquadPlayer } from "./types";
import { clubsIn, divisionOf } from "./divisions";
import { isForeignPlayer } from "./foreign";
import { overall } from "./rating";
import { CUP_STAGES, CUP_NAME } from "./cup";

/** What a scenario forbids for its season; every rule is checked in transfers.ts through `scenarioBlock`. */
export interface ScenarioRules {
  /** no transfer in, at any fee */
  noTransfersIn?: boolean;
  /** no loan signings */
  noLoansIn?: boolean;
  /** no free agents */
  noFreeAgents?: boolean;
  /** no foreign player may be signed (the 외국인 quota still applies on top) */
  noForeign?: boolean;
}

export type ScenarioOutcome = "running" | "cleared" | "failed";

export interface ScenarioState {
  id: string;
  /** the season the run is judged on (the first one) */
  season: number;
  outcome: ScenarioOutcome;
  /** how it ended, for the review screen */
  note?: string;
}

export interface Scenario {
  id: string;
  name: string;
  /** one line under the name in the picker */
  tagline: string;
  /** what the manager is walking into */
  brief: string;
  /** what clears it, in the player's words */
  goal: string;
  /** 1 (한 시즌 안에 해볼 만함) .. 3 (거의 무리) */
  stars: 1 | 2 | 3;
  rules?: ScenarioRules;
  /** the club this scenario is played with, chosen from the built world */
  pick: (s: GameState) => number;
  /** bend the opening state (runs after the club is set, before the first round) */
  setup?: (s: GameState) => void;
  /** cleared? read from the state at the moment the season closes, plus its record */
  judge: (s: GameState, record: SeasonRecord) => boolean;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const byReputation = (s: GameState, division: number, worstFirst: boolean): Club[] =>
  [...clubsIn(s, division)].sort((a, b) => (worstFirst ? a.reputation - b.reputation : b.reputation - a.reputation));
/** The user's finishing place in his own division (the record's position is the same table). */
const finished = (record: SeasonRecord): number => record.userPosition;
const clubOfUser = (s: GameState): Club => s.clubs[s.userClub]!;
/** Cup rounds the user survived: the stage his tie was lost at (cup.ts stages count down to the final). */
const wonCup = (record: SeasonRecord, s: GameState): boolean => record.cupWinner === s.userClub;

export const SCENARIOS: Scenario[] = [
  {
    id: "brokePromotion",
    name: "무일푼 승격",
    tagline: "2부 최하위 예산으로 한 시즌 만에 올라가기",
    brief: "구단주가 통장을 비우고 떠났습니다. 2부에서 가장 가난한 구단, 영입할 돈은 없고 있는 선수뿐입니다.",
    goal: "첫 시즌에 1부로 승격",
    stars: 3,
    pick: (s) => byReputation(s, 2, true)[0]!.id,
    setup: (s) => { const me = clubOfUser(s); me.budget = 0; me.seasonStartBudget = 0; },
    judge: (s, r) => (r.promoted ?? []).includes(s.userClub),
  },
  {
    id: "survival",
    name: "잔류 청부사",
    tagline: "1부 최약체를 데리고 살아남기",
    brief: "승격 직후 전력은 리그 최하위, 이사회는 이미 후임을 알아보고 있다는 소문입니다. 강등만 면하면 됩니다.",
    goal: "1부 잔류 (강등권 밖에서 시즌 종료)",
    stars: 2,
    pick: (s) => byReputation(s, 1, true)[0]!.id,
    setup: (s) => { if (s.board) s.board.confidence = 40; },
    judge: (s, r) => !(r.relegated ?? []).includes(s.userClub),
  },
  {
    id: "youthOnly",
    name: "유스 아카데미",
    tagline: "한 명도 사지 않고 중위권",
    brief: "새 구단주의 방침은 하나입니다. \"돈 쓰지 마세요. 키워서 씁니다.\" 이적도 임대도 자유계약도 없습니다.",
    goal: "영입 없이 리그 중위권(6위 이내) 이상",
    stars: 2,
    rules: { noTransfersIn: true, noLoansIn: true, noFreeAgents: true },
    pick: (s) => byReputation(s, 2, true)[3]!.id,
    judge: (_s, r) => finished(r) <= 6,
  },
  {
    id: "homegrown",
    name: "토종 군단",
    tagline: "외국인 없이 컵 4강",
    brief: "\"우리 돈으로 외국인은 못 씁니다.\" 국내 선수만으로 컵에서 사고를 쳐야 합니다.",
    goal: `외국인 영입 없이 ${CUP_NAME} 4강 진출`,
    stars: 2,
    rules: { noForeign: true },
    pick: (s) => byReputation(s, 1, true)[4]!.id,
    setup: (s) => { const me = clubOfUser(s); me.squad = me.squad.filter((p) => !isForeignPlayer(p)); },
    judge: (s) => cupRounds(s) >= CUP_STAGES - 1,
  },
  {
    id: "debt",
    name: "빚더미",
    tagline: "구단주 대출을 갚고 살아남기",
    brief: "전임 감독이 남긴 것은 순위표의 빈칸과 구단주에게 진 빚입니다. 매주 상환금이 빠져나갑니다.",
    goal: "시즌 종료 시 예산 흑자 + 강등 없음",
    stars: 3,
    pick: (s) => byReputation(s, 2, true)[1]!.id,
    setup: (s) => {
      const me = clubOfUser(s);
      me.budget = round1(Math.min(me.budget, 3));
      s.emergencyLoan = { remaining: 30, weekly: 1.5, season: 1 };
    },
    judge: (s, r) => clubOfUser(s).budget >= 0 && !(r.relegated ?? []).includes(s.userClub) && (s.emergencyLoan?.remaining ?? 0) <= 0,
  },
  {
    id: "fireSale",
    name: "매각 지시",
    tagline: "주축을 팔고도 순위를 지키기",
    brief: "이사회가 시즌 시작과 함께 주축 셋을 팔아 치웠습니다. 남은 선수로 작년 순위를 지키라고 합니다.",
    goal: "리그 8위 이내",
    stars: 2,
    pick: (s) => byReputation(s, 1, true)[6]!.id,
    setup: (s) => {
      const me = clubOfUser(s);
      const best = [...me.squad].filter((p) => p.role !== "GK").sort((a, b) => overall(b.attrs, b.role) - overall(a.attrs, a.role)).slice(0, 3);
      const ids = new Set(best.map((p) => p.id));
      me.squad = me.squad.filter((p) => !ids.has(p.id));
      me.budget = round1(me.budget + best.reduce((n, p) => n + 8, 0));
    },
    judge: (_s, r) => finished(r) <= 8,
  },
  {
    id: "titleRun",
    name: "우승 청부사",
    tagline: "부자 구단, 우승 말고는 실패",
    brief: "돈은 있습니다. 변명도 없습니다. 이사회가 원하는 것은 하나, 우승컵입니다.",
    goal: "1부 우승",
    stars: 2,
    pick: (s) => byReputation(s, 1, false)[1]!.id,
    setup: (s) => { if (s.board) s.board.confidence = 55; },
    judge: (s, r) => r.champion === s.userClub && divisionOf(clubOfUser(s)) === 1,
  },
];

/** How many cup rounds the user has won this season (0 = out in the first round or not entered). */
export function cupRounds(s: GameState): number {
  let n = 0;
  for (const t of s.cup.ties) {
    if (t.home !== s.userClub && t.away !== s.userClub) continue;
    if (!t.score) continue;
    const [hg, ag] = t.score;
    const mine = t.home === s.userClub ? hg : ag, theirs = t.home === s.userClub ? ag : hg;
    const pens = t.penalties;
    const won = mine > theirs || (mine === theirs && !!pens && (t.home === s.userClub ? pens[0]! > pens[1]! : pens[1]! > pens[0]!));
    if (won) n++;
  }
  return n;
}

export const scenarioById = (id: string | undefined): Scenario | undefined => (id ? SCENARIOS.find((x) => x.id === id) : undefined);
export const activeScenario = (s: GameState): Scenario | undefined => (s.scenario?.outcome === "running" ? scenarioById(s.scenario.id) : undefined);

/**
 * Why a signing is refused under the running scenario, or null when it is allowed.
 * `kind`: a transfer, a loan, a free agent; `player` is who is being signed.
 */
export function scenarioBlock(s: GameState, kind: "transfer" | "loan" | "free", player?: Pick<SquadPlayer, "nat">): string | null {
  const sc = activeScenario(s);
  const r = sc?.rules;
  if (!sc || !r) return null;
  if (r.noForeign && player && isForeignPlayer(player)) return `${sc.name}: 외국인 선수는 영입할 수 없습니다`;
  if (kind === "transfer" && r.noTransfersIn) return `${sc.name}: 선수를 영입할 수 없습니다`;
  if (kind === "loan" && r.noLoansIn) return `${sc.name}: 임대 영입을 할 수 없습니다`;
  if (kind === "free" && r.noFreeAgents) return `${sc.name}: 자유계약 영입을 할 수 없습니다`;
  return null;
}

/** Judge the season that just closed (called from startNextSeason, before the state rolls on). */
export function judgeScenario(s: GameState, record: SeasonRecord): ScenarioState | undefined {
  const st = s.scenario;
  const sc = activeScenario(s);
  if (!st || !sc || st.season !== record.season) return st;
  const ok = sc.judge(s, record);
  st.outcome = ok ? "cleared" : "failed";
  st.note = ok ? `${sc.name} 성공 — ${sc.goal}` : `${sc.name} 실패 — ${sc.goal}`;
  s.news.unshift(ok ? `시나리오 «${sc.name}» 성공! ${sc.goal}을(를) 해냈습니다.` : `시나리오 «${sc.name}» 실패. 목표는 ${sc.goal}이었습니다.`);
  (s.scenariosCleared ??= []);
  if (ok && !s.scenariosCleared.includes(sc.id)) s.scenariosCleared.push(sc.id);
  return st;
}

/** A sacking ends the run then and there. */
export function failScenarioOnSack(s: GameState): void {
  const sc = activeScenario(s);
  if (!sc || !s.scenario) return;
  s.scenario.outcome = "failed";
  s.scenario.note = `${sc.name} 실패 — 경질`;
}

export const clearedScenarios = (s: GameState): Scenario[] => (s.scenariosCleared ?? []).map(scenarioById).filter((x): x is Scenario => !!x);
