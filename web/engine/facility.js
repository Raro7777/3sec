// 골드 소비처 — 구단 시설 투자 · 선수단 운영비 · 스카우트 리포트.
// docs/league-and-economy.md B.6(골드 소비처) 구현.
//
// 설계 제약(B.6.1): **이 파일의 어떤 값도 경기·육성 판정에 들어가지 않는다.**
// 골드로 전력을 사면 A.4.4 의 사다리 밴드가 그대로 깨지기 때문에, 채택한 소비처는
// 정보(스카우트 리포트) · 외형/명성(시설) · 유지비(운영비) 뿐이다.
// 이 불변식은 web/parity.mjs 9절("시설·리포트는 전력에 영향을 주지 않는다")이 자동 검증한다.
//
// 결정성(C.4): 여기서는 RNG 를 한 번도 쓰지 않는다 — 리포트는 카드 데이터의 순수 함수다.
// nextSeed(state) 를 호출하지 않으므로 seedIndex 가 움직이지 않고, 시설을 사도 경기 시드가 그대로다.

import { POS_CODES, RARITIES, STAT_KEYS, STAT_NAMES_KO } from './domain.js';
import { DEFAULT_TRAINING_CONFIG, APT_NAMES, ovrOf, gradeOf } from './training-config.js';
import {
  ECONOMY, cardById, activeCardPool, addHistory, spendGold,
  ageAt, agePhase, isRetiredAge, retireAgeOf, peakEndOf,
} from './game.js';

const TCFG = DEFAULT_TRAINING_CONFIG;

/**
 * 상수표. docs/league-and-economy.md B.6 · 부록 `sink:`.
 *
 * 가격 설계의 근거는 "언제 살 수 있느냐"다(B.6.4):
 *  - 시즌 1~3 잔액은 8.7k / 9.1k / 10.4k 이고 예비비(reserveGold)가 13,200 이라 **한 단계도 못 산다** →
 *    초반 골드는 전부 포지션 지정 스카우트에 남는다(요구사항).
 *  - 시즌 4 에 처음 1단계를 사고, 그 뒤로는 유지비·운영비가 잉여를 계속 걷어 간다.
 */
export const FACILITY = {
  maxLevel: 5,
  /** 시설 3종. 효과는 전부 비전력(정보·외형·명성)이다 — B.6.1. */
  tracks: [
    {
      id: 'analysis', name: '분석실', icon: '🔬',
      prices: [1500, 3500, 6000, 9500, 14000],
      effect: '스카우트 리포트가 단계마다 싸지고, 5단계에서 무료가 된다',
    },
    {
      id: 'stadium', name: '홈구장', icon: '🏟️',
      prices: [2000, 4000, 7000, 11000, 16000],
      effect: '관중 규모·홈 경기 연출 등급 (외형)',
    },
    {
      id: 'hall', name: '명예의 전당', icon: '🏆',
      prices: [1500, 3500, 6500, 10000, 15000],
      effect: '은퇴 선수 헌액·통산 기록 전시 규모 (외형)',
    },
  ],
  /** 시설 유지비 — 보유 등급 1단계당 시즌 결산에서 자동 차감. */
  upkeepPerLevel: 400,
  /**
   * 선수단 운영비 — 계약 선수가 **런칭 카드 풀 42명**(= 리그 6구단 정원)을 넘는 만큼 시즌마다 낸다.
   * 신인 세대(docs/rookies.md)가 매 시즌 5장씩 풀을 늘리므로 후반으로 갈수록 커진다.
   * 시즌 8 까지는 보유가 42장을 넘지 않아 **0원**이다 — 초·중반 경제를 건드리지 않기 위한 값이다.
   */
  squadFreeSlots: 42,
  squadUpkeepPerPlayer: 200,
  /** 스카우트 리포트 정가. 분석실 1단계마다 할인되어 5단계에서 0(무료). */
  reportBaseCost: 900,
  reportDiscountPerLevel: 180,
  /**
   * 권장 예비비. UI 가 "이만큼은 남기세요"로 쓰고, 검증 하네스(season-check)의
   * 자동 플레이어도 이 값을 남기고 남는 골드만 시설·리포트에 쓴다.
   * = 포지션 지정 스카우트 11회분. 다음 시즌 프리시즌에 티켓을 한꺼번에 털어도 지정으로 갈 수 있는 양.
   */
  reserveGold: 13200,
};

const TRACK_BY_ID = new Map(FACILITY.tracks.map(t => [t.id, t]));
/** 명성 등급 이름 — 총 등급 합(0~15)을 5구간으로 나눈다. */
const PRESTIGE_NAMES = ['신생', '지역', '준수', '명문', '전통의 명문'];

// ---------------------------------------------------------------- 상태 접근
/** 상태에 시설 필드가 없으면(구 세이브) 0 으로 채워 넣는다. */
export function facilityLevels(state) {
  const cur = state.facilities;
  if (!cur || typeof cur !== 'object') {
    state.facilities = {};
    for (const t of FACILITY.tracks) state.facilities[t.id] = 0;
    return state.facilities;
  }
  // 저장본에서 온 값은 0~maxLevel 로 조인다(손상된 세이브 방어).
  for (const t of FACILITY.tracks) {
    cur[t.id] = Math.max(0, Math.min(FACILITY.maxLevel, cur[t.id] | 0));
  }
  return cur;
}

/** 시설 등급(0~5). */
export function facilityLevel(state, trackId) {
  return facilityLevels(state)[trackId] | 0;
}

/** 총 등급 합(0~15) = 구단 명성 점수. */
export function clubPrestige(state) {
  const lv = facilityLevels(state);
  let total = 0;
  for (const t of FACILITY.tracks) total += lv[t.id] | 0;
  const max = FACILITY.tracks.length * FACILITY.maxLevel;
  const tier = total === 0 ? 0 : Math.min(PRESTIGE_NAMES.length - 1, Math.floor((total - 1) / 3) + 1);
  return { total, max, tier, name: PRESTIGE_NAMES[tier] };
}

/** 다음 단계 가격. 이미 최대면 null. */
export function facilityPrice(state, trackId) {
  const t = TRACK_BY_ID.get(trackId);
  if (!t) throw new Error('알 수 없는 시설: ' + trackId);
  const lv = facilityLevel(state, trackId);
  return lv >= FACILITY.maxLevel ? null : t.prices[lv];
}

export function canUpgradeFacility(state, trackId) {
  const price = facilityPrice(state, trackId);
  return price !== null && (state.gold | 0) >= price;
}

/**
 * 시설 1단계 투자. 골드가 모자라거나 이미 최대면 예외.
 * @returns {{track, name, level, price, gold, prestige}}
 */
export function upgradeFacility(state, trackId) {
  const t = TRACK_BY_ID.get(trackId);
  if (!t) throw new Error('알 수 없는 시설: ' + trackId);
  const price = facilityPrice(state, trackId);
  if (price === null) throw new Error(`${t.name} 은 이미 최대 단계입니다`);
  if (!spendGold(state, price)) throw new Error(`골드가 부족합니다 (필요 ${price} · 보유 ${state.gold | 0})`);
  const lv = facilityLevels(state);
  lv[trackId] = (lv[trackId] | 0) + 1;
  addHistory(state, `시설 투자: ${t.name} ${lv[trackId]}단계 (−${price}골드)`);
  return { track: trackId, name: t.name, level: lv[trackId], price, gold: state.gold | 0, prestige: clubPrestige(state) };
}

// ---------------------------------------------------------------- 운영비
/** 계약 중인 선수(= 보유 카드 중 은퇴하지 않은 것) 수. */
export function squadSize(state) {
  let n = 0;
  for (const id of Object.keys(state.ownedCards || {})) {
    const c = cardById(state, id);
    if (c && !isRetiredAge(c.age, c.pos, state.season)) n++;
  }
  return n;
}

/**
 * 이번 시즌 결산에서 나갈 운영비. UI 는 시즌 중에도 미리 보여 줄 수 있다.
 * @returns {{facility, squad, total, levels, squadSize, over, perPlayer, perLevel}}
 */
export function facilityUpkeep(state) {
  const p = clubPrestige(state);
  const size = squadSize(state);
  const over = Math.max(0, size - FACILITY.squadFreeSlots);
  const facility = p.total * FACILITY.upkeepPerLevel;
  const squad = over * FACILITY.squadUpkeepPerPlayer;
  return {
    facility, squad, total: facility + squad,
    levels: p.total, squadSize: size, over,
    perPlayer: FACILITY.squadUpkeepPerPlayer, perLevel: FACILITY.upkeepPerLevel,
    freeSlots: FACILITY.squadFreeSlots,
  };
}

/**
 * 운영비 정산(시즌 결산에서 season.js 가 부른다).
 * 골드가 모자라면 있는 만큼 내고 **가장 높은 시설 1단계를 강등**한다(환불 없음).
 * @returns {{facility, squad, total, paid, shortfall, demoted}}
 */
export function payUpkeep(state) {
  const u = facilityUpkeep(state);
  if (u.total <= 0) return { ...u, paid: 0, shortfall: 0, demoted: null };
  const have = state.gold | 0;
  const paid = Math.min(have, u.total);
  state.gold = have - paid;
  const shortfall = u.total - paid;
  let demoted = null;
  if (shortfall > 0) {
    const lv = facilityLevels(state);
    let best = null;
    for (const t of FACILITY.tracks) {
      if ((lv[t.id] | 0) <= 0) continue;
      if (best === null || (lv[t.id] | 0) > (lv[best] | 0)) best = t.id;
    }
    if (best !== null) {
      lv[best] = (lv[best] | 0) - 1;
      demoted = best;
      addHistory(state, `운영비 미납 — ${TRACK_BY_ID.get(best).name} 이 ${lv[best]}단계로 내려갔습니다`);
    }
  }
  return { ...u, paid, shortfall, demoted };
}

// ---------------------------------------------------------------- 스카우트 리포트
/** 리포트 1장 가격(분석실 등급 반영). 5단계면 0 = 무료. */
export function reportCost(state) {
  const lv = facilityLevel(state, 'analysis');
  return Math.max(0, FACILITY.reportBaseCost - lv * FACILITY.reportDiscountPerLevel);
}

function reportSet(state) {
  if (!state.reports) state.reports = [];
  return state.reports;
}

/** 이 카드의 리포트를 이미 샀는가(카드당 1회 결제 · 영구 보관). */
export function hasScoutReport(state, cardId) {
  return reportSet(state).indexOf(cardId) >= 0;
}

/** 리포트를 살 수 있는가 — 아직 안 샀고 골드가 충분(무료면 항상 true). */
export function canBuyScoutReport(state, cardId) {
  if (!cardById(state, cardId)) return false;
  if (hasScoutReport(state, cardId)) return false;
  return (state.gold | 0) >= reportCost(state);
}

/**
 * 스카우트 리포트 구매. 카드당 1회만 결제하고 이후에는 무료로 다시 열람한다.
 * **전력에는 아무 영향이 없다** — 이미 카드 데이터에 있는 값을 보여 줄 뿐이다(B.6.1).
 */
export function buyScoutReport(state, cardId) {
  const card = cardById(state, cardId);
  if (!card) throw new Error('알 수 없는 카드: ' + cardId);
  if (hasScoutReport(state, cardId)) return scoutReport(state, cardId);
  const cost = reportCost(state);
  if (cost > 0 && !spendGold(state, cost)) {
    throw new Error(`스카우트 리포트는 골드 ${cost} 이 필요합니다 (보유 ${state.gold | 0})`);
  }
  reportSet(state).push(cardId);
  addHistory(state, `스카우트 리포트: ${card.name}${cost > 0 ? ` (−${cost}골드)` : ' (무료)'}`);
  return scoutReport(state, cardId);
}

/**
 * 리포트 내용. 아직 안 샀으면 **null** — UI 는 그때 자물쇠 배지와 [구매] 버튼을 그린다(E.5 #17).
 * 전부 카드 데이터의 순수 함수 — RNG 없음, 상태 변경 없음.
 */
export function scoutReport(state, cardId) {
  if (!hasScoutReport(state, cardId)) return null;
  const card = cardById(state, cardId);
  if (!card) return null;
  const lb = state.ownedCards && Object.prototype.hasOwnProperty.call(state.ownedCards, cardId)
    ? (state.ownedCards[cardId] | 0) : 0;
  const pot = card.potential.slice();
  const potLb = pot.map(v => Math.min(100, v + lb * ECONOMY.limitBreakPotential));
  const apt = TCFG.positionAptitude[card.pos];
  const core3 = TCFG.core3[card.pos];
  const stats = [];
  for (let i = 0; i < 10; i++) {
    stats.push({
      key: STAT_KEYS[i], name: STAT_NAMES_KO[i],
      now: card.stats[i], potential: pot[i], withLimitBreak: potLb[i],
      headroom: pot[i] - card.stats[i],
      isCore: core3.indexOf(i) >= 0,
    });
  }
  const age = ageAt(card.age, state.season);
  const peakEnd = peakEndOf(card.pos);
  const retireAt = retireAgeOf(card.pos);
  const analysis = facilityLevel(state, 'analysis');
  return {
    cardId, name: card.name, posCode: POS_CODES[card.pos], pos: card.pos,
    rarity: RARITIES[card.rarity], rarityLevel: card.rarity,
    heightCm: card.heightCm, jersey: card.jersey, clubId: card.teamId,
    age, agePhase: agePhase(card.age, card.pos, state.season),
    peakEnd, retireAt, seasonsToPeakEnd: Math.max(0, peakEnd - age), seasonsToRetire: Math.max(0, retireAt - age),
    // 잠재 OVR = 잠재력 스탯을 전부 채웠을 때의 OVR. "이 카드의 천장"이다.
    ovrNow: round1(ovrOf(TCFG, card.stats, card.pos)),
    ovrPotential: round1(ovrOf(TCFG, pot, card.pos)),
    ovrPotentialLb: round1(ovrOf(TCFG, potLb, card.pos)),
    gradePotential: gradeOf(TCFG, ovrOf(TCFG, pot, card.pos)),
    limitBreak: lb, limitBreakMax: ECONOMY.maxLimitBreak,
    // 훈련 5종(서브/리시브/토스/스파이크/블로킹) 적성 — 육성 화면과 같은 눈금
    aptitudes: apt.map((a, i) => ({ act: i, apt: a, name: APT_NAMES[a] })),
    coreStats: core3.map(i => STAT_NAMES_KO[i]),
    stats,
    skill: card.skillName ? { name: card.skillName, desc: card.skillDesc } : null,
    analysisLevel: analysis,
    // 분석실 3단계 이상에서만 붙는 심화 항목(추가 정보이지 추가 전력이 아니다)
    advanced: analysis >= 3 ? {
      headroomTotal: pot.reduce((s, v, i) => s + (v - card.stats[i]), 0),
      coreHeadroom: core3.reduce((s, i) => s + (pot[i] - card.stats[i]), 0),
      bestApt: APT_NAMES[Math.max(...apt)],
    } : null,
  };
}
function round1(v) { return Math.round(v * 10) / 10; }

/** 아직 리포트를 안 산 스카우트 명단 카드 목록(UI 목록용). */
export function reportableCards(state) {
  return activeCardPool(state).filter(c => !hasScoutReport(state, c.id));
}

// ---------------------------------------------------------------- UI 통합 뷰
/**
 * 구단 시설 화면 한 번에 쓰는 뷰.
 * @returns {{gold, reserve, prestige, tracks, upkeep, report}}
 */
export function facilityView(state) {
  const gold = state.gold | 0;
  const lv = facilityLevels(state);
  return {
    gold,
    reserve: FACILITY.reserveGold,
    spendable: Math.max(0, gold - FACILITY.reserveGold),
    prestige: clubPrestige(state),
    upkeep: facilityUpkeep(state),
    report: { cost: reportCost(state), owned: reportSet(state).length, base: FACILITY.reportBaseCost },
    tracks: FACILITY.tracks.map(t => {
      const level = lv[t.id] | 0;
      const price = level >= FACILITY.maxLevel ? null : t.prices[level];
      return {
        id: t.id, name: t.name, icon: t.icon, effect: t.effect,
        level, maxLevel: FACILITY.maxLevel,
        price, canBuy: price !== null && gold >= price,
        afterReserve: price !== null && gold - price >= FACILITY.reserveGold,
        upkeep: level * FACILITY.upkeepPerLevel,
      };
    }),
  };
}
