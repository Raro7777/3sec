// 온보딩 미션 (docs/league-and-economy.md B.6.6 · GDD 13절)
//
// 코어 루프를 순서대로 가르치는 10개 미션. 달성 즉시 보상을 준다.
// 앱(app-shell)과 난이도 하네스(season-check --app)가 **같은 표·같은 판정**을 쓰기 위해 엔진에 둔다 —
// 앱에만 있던 시절에는 미션 티켓이 밸런스 측정 밖이었다(GDD 13절 미해결 항목).
//
// 진행도 함수는 순수하다: 상태를 읽기만 하고 RNG 를 건드리지 않는다(캘리브레이션 무영향).
import { representatives, myRoster, myTeamState, cardById, addTickets, addGold, addFragments } from './game.js';

/**
 * 온보딩 경제 — 앱이 시작 시 주는 티켓. 엔진 기본(createGame)과 같은 5장.
 * 한때 앱만 20장(+미션 티켓 56장)을 줬는데, season-check --app 으로 재보니 시즌 1 우승률 96%·스카우트 84회로
 * 난이도 목표(A.4.1)를 완전히 벗어났다. 시작 티켓 +3(8장)만으로도 시즌 1 우승률 22.5%(목표 ≤20%)라 티켓은 못 늘린다.
 * 측정 표: docs/league-and-economy.md B.6.6.
 */
export const ONBOARDING = {
  startingTickets: 5,
};

function ownedCount(state) { return Object.keys(state.ownedCards || {}).length; }
/** 라인업 일곱 자리(선발 6 + 리베로) 중 정식 카드가 선 자리 수. 연습생은 rarity N(0) 이다.
 *  연습생 7명은 로스터에 늘 남아 있으므로 "로스터의 연습생 수" 로 재면 이 미션은 영영 안 끝난다(앱 시절 버그). */
function lineupRealSlots(state) {
  let ts;
  try { ts = myTeamState(state); } catch { return 0; }
  const ids = ts.lineup.startingIds.concat([ts.lineup.liberoId]);
  let n = 0;
  for (const id of ids) { const p = ts.index.get(id); if (p && p.rarity > 0) n++; }
  return n;
}

/**
 * 미션 표. reward 는 { tickets?, gold?, fragments? } — 종류를 섞을 수 있게 객체다.
 * progress(state) → 현재 진행값(goal 이상이면 달성).
 *
 * 보상은 골드·조각뿐이고 티켓은 없다(B.6.6 측정): 시즌 1 에 티켓이 1장 늘 때마다 우승률이 3%p 안팎 오른다.
 * 골드 합 2,650 · 조각 6 은 목표 9건을 기준선과 같은 여유로 통과한 조합(H3). 골드 5,300 은 첫 우승 시즌 2~3 누적이 49% 로 떨어졌다.
 */
export const MISSIONS = [
  { id: 'scout1', title: '선수를 스카우트한다', desc: '명단에서 신인 한 명을 데려오세요.',
    reward: { fragments: 3 }, goal: 1,
    progress: s => Math.min(1, ownedCount(s)) },
  { id: 'grad1', title: '첫 선수를 키워낸다', desc: '캠프 12턴을 완주해 졸업시키세요.',
    reward: { gold: 150 }, goal: 1,
    progress: s => Math.min(1, s.trainingCount | 0) },
  { id: 'match1', title: '첫 경기를 치른다', desc: '구단 하나를 골라 경기를 해보세요.',
    reward: { fragments: 3 }, goal: 1,
    progress: s => Math.min(1, (s.wins | 0) + (s.losses | 0)) },
  { id: 'roster3', title: '주전을 셋 만든다', desc: '졸업시킨 선수 3명을 로스터에 채우세요.',
    reward: { gold: 250 }, goal: 3,
    progress: s => Math.min(3, representatives(s).length) },
  { id: 'win1', title: '첫 승리', desc: '여섯 구단 중 한 곳을 이기세요.',
    reward: { gold: 300 }, goal: 1,
    progress: s => Math.min(1, s.wins | 0) },
  { id: 'pos5', title: '모든 포지션을 갖춘다', desc: 'S · OH · OP · MB · L 을 한 명씩 보유하세요.',
    reward: { gold: 300 }, goal: 5,
    progress: s => { const set = new Set(); for (const i of representatives(s)) set.add(i.pos); return set.size; } },
  { id: 'gradA', title: 'A등급으로 졸업시킨다', desc: '캠프를 잘 굴려 A등급 이상을 만드세요.',
    reward: { gold: 400 }, goal: 1,
    progress: s => (representatives(s).some(i => i.grade <= 1) ? 1 : 0) },
  { id: 'team7', title: '한 팀을 완성한다', desc: '라인업 일곱 자리를 전부 정식 선수로 채우세요. 연습생 0명.',
    reward: { gold: 500 }, goal: 7,
    progress: s => lineupRealSlots(s) },
  { id: 'win3club', title: '세 구단을 격파한다', desc: '서로 다른 구단 세 곳에 승리하세요.',
    reward: { gold: 500 }, goal: 3,
    progress: s => { let n = 0; for (const k in (s.winsByClub || {})) if (s.winsByClub[k] > 0) n++; return Math.min(3, n); } },
  { id: 'sr1', title: 'SR 이상을 영입한다', desc: '희귀도 높은 카드를 뽑으세요. 천장이 보장합니다.',
    reward: { gold: 250 }, goal: 1,
    progress: s => (Object.keys(s.ownedCards || {}).some(id => { const c = cardById(s, id); return !!c && c.rarity >= 2; }) ? 1 : 0) },
];

/** 미션 보상 합계 — 문서·하네스 표기용. */
export function missionRewardTotal(missions = MISSIONS) {
  const t = { tickets: 0, gold: 0, fragments: 0 };
  for (const m of missions) { t.tickets += m.reward.tickets | 0; t.gold += m.reward.gold | 0; t.fragments += m.reward.fragments | 0; }
  return t;
}

/** 각 미션의 현재 진행 — [{ mission, progress, done }]. 상태를 바꾸지 않는다. */
export function missionProgress(state) {
  return MISSIONS.map(m => {
    let p = 0;
    try { p = m.progress(state); } catch { p = 0; }
    return { mission: m, progress: p, done: p >= m.goal };
  });
}

/**
 * 새로 달성된 미션의 보상을 지급한다. `claimed` 는 { id: 1 } 로 호출자가 보관한다(앱은 localStorage).
 * 돌려주는 값은 이번에 지급된 미션 목록. 티켓·골드는 state 에 바로 더한다.
 */
export function claimMissions(state, claimed) {
  const got = [];
  for (const { mission, done } of missionProgress(state)) {
    if (!done || claimed[mission.id]) continue;
    claimed[mission.id] = 1;
    addTickets(state, mission.reward.tickets | 0);
    addGold(state, mission.reward.gold | 0);
    if (mission.reward.fragments) addFragments(state, mission.reward.fragments | 0);   // 12조각 = 티켓 1 로 자동 환산
    got.push(mission);
  }
  return got;
}
