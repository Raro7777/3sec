// 선수 고유 스킬 효과 시스템. docs/skills.md 가 명세, 이 파일이 구현.
//
// 설계 요약
//  - 스킬은 자유 서술이 아니라 { kind, ch(채널), target, mag, when } 배열로만 표현한다.
//    새 스킬은 SKILLS 배열에 데이터 1건을 추가하면 끝이고, 엔진 코드는 건드리지 않는다.
//  - 효과는 전부 기존 판정식의 **로짓에 가산**된다(확률을 직접 곱하지 않는다). match-sim.md 6.2 참조.
//  - 스킬을 가진 선수가 한 명도 없으면 createSkillRuntime 이 null 을 돌려주고,
//    match.js 는 훅 자체를 건너뛴다 → 스킬 미보유 경기는 비트 단위로 기존 결과와 같다.
//  - 난수를 전혀 쓰지 않는다(RNG 소비 0) → 결정성·시드 재현성 불변.

import { POS, ATK, Q, SIDE, STAT } from './domain.js';
import { clamp } from './mathx.js';

// ---------------------------------------------------------------- 채널(판정 지점)
/**
 * 로짓 가산이 들어가는 지점. C# `SkillTrigger` 열거형과 1:1 이 되도록 이름을 맞춘다
 * (기존 8개 + ServePressure/AntiBlock 2개 추가).
 */
export const CH = {
  serveError: 0,    // 서브 범실 로짓        (+ = 범실↑)   — 서브 팀
  serveAce: 1,      // 에이스 로짓           (+ = 에이스↑) — 서브 팀
  servePressure: 2, // 리시브 대결 x 감산    (+ = 상대 리시브 품질↓) — 서브 팀
  receive: 3,       // 리시브 대결 x 가산    (+ = 리시브 유리) — 리시브 팀
  set: 4,           // 토스 품질 x           (+ = 토스 정확↑) — 공격 팀
  attackKill: 5,    // 킬 로짓               (+ = 결정률↑)  — 공격 팀
  attackError: 6,   // 공격 범실 로짓        (+ = 범실↑)    — 공격 팀
  antiBlock: 7,     // 블로킹 로짓 감산      (+ = 피블로킹↓) — 공격 팀
  block: 8,         // 블로킹 로짓           (+ = 블로킹 득점·터치↑) — 수비 팀
  dig: 9,           // 킬 로짓 감산 + 디그 품질 x (+ = 디그 유리) — 수비 팀
};
export const CH_COUNT = 10;
export const CH_NAMES_KO = [
  '서브 범실', '에이스', '서브 압박', '리시브', '토스',
  '공격 결정', '공격 범실', '피블로킹', '블로킹', '디그',
];

/** 효과 종류. logit = 로짓 가산, weight = 공격 옵션 선택 가중치, fatigueImmune = 피로 면제. */
export const EFFECT = { logit: 0, weight: 1, fatigueImmune: 2 };

/** 누구의 판정에 붙는가. */
export const TARGET = {
  self: 0,    // 보유자가 그 판정의 행위자(서버·리시버·공격수·디거)일 때만
  setter: 1,  // 보유자가 그 공격의 토스를 올린 세터일 때
  blocker: 2, // 보유자가 그 블로킹에 참여 중일 때
  team: 3,    // 보유자가 코트에 있으면 팀 전체 판정에
};
export const TARGET_NAMES_KO = ['자신', '세터', '블로커', '팀'];

// ---------------------------------------------------------------- 조건 헬퍼
const L = (ch, target, mag, when) => ({ kind: EFFECT.logit, ch, target, mag, when: when || null });
const W = (target, type, mult, when) => ({ kind: EFFECT.weight, target, type, mult, when: when || null });
const F = (target, when) => ({ kind: EFFECT.fatigueImmune, target, when: when || null });

// ---------------------------------------------------------------- 스킬 레지스트리
/**
 * `data/players.json` 의 skill.name 과 정확히 같은 문자열로 찾는다.
 * mag 는 **Lv1 기준 로짓**이고 레벨 배수(config.skill.levelScale)를 곱한다.
 * 각 수치의 근거·해석은 docs/skills.md 4·5절.
 */
export const SKILLS = [
  // ============================================================ SSR 10
  {
    id: 'spotlight', name: '스포트라이트', owner: 'p001', rarity: 'SSR', pos: POS.OH,
    desc: '세트 스코어 20점 이후 자신의 스파이크 성공률이 상승한다. 홈 경기에서는 상승 폭이 더 커진다.',
    effects: [
      L(CH.attackKill, TARGET.self, 0.34, { minScoreFromEnd: 5 }),
      L(CH.attackKill, TARGET.self, 0.17, { minScoreFromEnd: 5, home: true }),
    ],
  },
  {
    id: 'thunder-left', name: '천둥 왼손', owner: 'p002', rarity: 'SSR', pos: POS.OP,
    desc: '후위 공격(백어택) 시 파워가 상승한다. 상대 블로커가 1인 이하일 때 결정률이 크게 오른다.',
    effects: [
      L(CH.attackKill, TARGET.self, 0.11, { types: [ATK.BackRow] }),
      L(CH.attackError, TARGET.self, -0.05, { types: [ATK.BackRow] }),
      L(CH.attackKill, TARGET.self, 0.14, { blockersMax: 1 }),
    ],
  },
  {
    id: 'drop-anchor', name: '닻을 내리다', owner: 'p008', rarity: 'SSR', pos: POS.L,
    desc: '상대의 강서브를 리시브에 성공하면 그 랠리 동안 팀 전체의 디그 성공률이 상승한다.',
    effects: [
      L(CH.dig, TARGET.team, 0.25, { strongServeReceived: true }),
    ],
  },
  {
    id: 'lighthouse', name: '등대', owner: 'p009', rarity: 'SSR', pos: POS.OH,
    desc: '팀이 2연속 실점하면 발동한다. 다음 랠리에서 팀 전원의 리시브와 멘탈이 상승한다.',
    effects: [
      L(CH.receive, TARGET.team, 0.10, { concededStreak: 2 }),
      L(CH.attackError, TARGET.team, -0.07, { concededStreak: 2 }),
      L(CH.serveError, TARGET.team, -0.07, { concededStreak: 2 }),
    ],
  },
  {
    id: 'snow-wall', name: '설벽(雪壁)', owner: 'p015', rarity: 'SSR', pos: POS.MB,
    desc: '블로킹 득점을 올리면 다음 랠리 동안 팀 전체의 블로킹 성공률이 상승한다. 상대의 오픈 공격에 특히 강하다.',
    effects: [
      L(CH.block, TARGET.team, 0.13, { afterOwnBlockKill: true }),
      L(CH.block, TARGET.blocker, 0.13, { types: [ATK.Open] }),
    ],
  },
  {
    id: 'red-hot-iron', name: '달군 쇠', owner: 'p022', rarity: 'SSR', pos: POS.OP,
    desc: '팀이 2점 이상 연속 득점 중일 때 자신의 스파이크 파워와 성공률이 상승한다. 연속 득점이 끊기면 초기화된다.',
    effects: [
      L(CH.attackKill, TARGET.self, 0.70, { pointStreak: 2 }),
      L(CH.attackError, TARGET.self, -0.30, { pointStreak: 2 }),
    ],
  },
  {
    id: 'on-the-anvil', name: '모루 위에서', owner: 'p023', rarity: 'SSR', pos: POS.MB,
    desc: '세트 20점 이후에도 스태미나 저하로 인한 블로킹 페널티를 받지 않는다. 상대 속공 블로킹 성공률이 상승한다.',
    effects: [
      F(TARGET.blocker, { minScoreFromEnd: 5 }),
      L(CH.block, TARGET.blocker, 0.55, { types: [ATK.Quick] }),
    ],
  },
  {
    id: 'one-move-ahead', name: '한 수 앞', owner: 'p029', rarity: 'SSR', pos: POS.S,
    desc: '랠리가 3회 이상 이어진 뒤의 토스에서 시간차·이동 공격 성공률이 상승한다. 상대 블로커 위치를 예측하는 보너스를 받는다.',
    effects: [
      L(CH.attackKill, TARGET.setter, 0.24, { minAttackIndex: 2, types: [ATK.Delayed, ATK.Quick] }),
      L(CH.antiBlock, TARGET.setter, 0.14, { minAttackIndex: 2 }),
    ],
  },
  {
    id: 'crane-wings', name: '학의 날개', owner: 'p030', rarity: 'SSR', pos: POS.OH,
    desc: '상대 블로커가 2인 이상일 때 페인트와 코스 공략으로 스파이크 성공률이 상승한다.',
    effects: [
      L(CH.attackKill, TARGET.self, 0.165, { blockersMin: 2 }),
    ],
  },
  {
    id: 'tailwind', name: '순풍', owner: 'p036', rarity: 'SSR', pos: POS.S,
    desc: '리시브가 정확(A패스)했을 때 속공과 이동 공격 성공률이 크게 상승한다. 랠리 템포가 빨라진다.',
    effects: [
      L(CH.attackKill, TARGET.setter, 0.225, { passQuality: [Q.Perfect], types: [ATK.Quick] }),
      W(TARGET.setter, ATK.Quick, 0.11, { passQuality: [Q.Perfect] }),
    ],
  },

  // ============================================================ SR 14
  {
    id: 'veteran-distribution', name: '노련한 배급', owner: 'p003', rarity: 'SR', pos: POS.S,
    desc: '세트당 첫 로테이션 동안 팀 공격 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.team, 0.30, { maxRotations: 1 })],
  },
  {
    id: 'quick-feet', name: '빠른 발', owner: 'p004', rarity: 'SR', pos: POS.MB,
    desc: '속공(A퀵) 시도 시 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.self, 0.11, { types: [ATK.Quick] })],
  },
  {
    id: 'broken-path', name: '흐트러진 공도', owner: 'p010', rarity: 'SR', pos: POS.S,
    desc: '리시브가 흔들린 상황(B/C패스)에서 토스 정확도 하락 폭이 감소한다.',
    effects: [L(CH.set, TARGET.self, 0.066, { passQuality: [Q.Good, Q.Poor] })],
  },
  {
    id: 'reading', name: '읽기', owner: 'p011', rarity: 'SR', pos: POS.MB,
    desc: '상대 세터의 토스 방향을 읽어 블로킹 위치 선정 성공률이 소폭 상승한다.',
    effects: [L(CH.block, TARGET.blocker, 0.052, null)],
  },
  {
    id: 'slide-attack', name: '이동 공격', owner: 'p016', rarity: 'SR', pos: POS.MB,
    desc: '이동 공격(슬라이드) 시도 시 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.self, 0.11, { types: [ATK.Quick] })],
  },
  {
    id: 'high-drop', name: '고공 낙하', owner: 'p017', rarity: 'SR', pos: POS.OP,
    desc: '블로킹 성공 직후 자신의 다음 스파이크 파워가 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.self, 0.70, { afterOwnBlockKill: true })],
  },
  {
    id: 'high-lift', name: '높이 띄우기', owner: 'p018', rarity: 'SR', pos: POS.S,
    desc: '미들블로커에게 토스할 때 속공 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.setter, 0.057, { types: [ATK.Quick] })],
  },
  {
    id: 'feed-the-ace', name: '몰아주기', owner: 'p024', rarity: 'SR', pos: POS.S,
    desc: '팀 내 스파이크가 가장 높은 공격수에게 토스할 때 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.setter, 0.053, { topSpiker: true })],
  },
  {
    id: 'serve-pressure', name: '강서브 압박', owner: 'p025', rarity: 'SR', pos: POS.OH,
    desc: '강서브 성공 시 상대 리시브 품질 하락 폭이 소폭 증가한다.',
    effects: [L(CH.servePressure, TARGET.self, 0.136, { minAggression: 0.5 })],
  },
  {
    id: 'tempo-shift', name: '시간차', owner: 'p031', rarity: 'SR', pos: POS.MB,
    desc: '시간차 공격(B퀵/C퀵) 시도 시 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.self, 0.11, { types: [ATK.Quick, ATK.Delayed] })],
  },
  {
    id: 'find-the-gap', name: '빈 곳 찌르기', owner: 'p032', rarity: 'SR', pos: POS.OP,
    desc: '상대 리베로가 코트 밖(전위 로테이션)일 때 스파이크 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.self, 0.28, { opponentLiberoOff: true })],
  },
  {
    id: 'second-toss', name: '2단 토스', owner: 'p033', rarity: 'SR', pos: POS.L,
    desc: '세터가 첫 번째 터치를 했을 때 자신의 2단 토스 정확도가 상승한다.',
    effects: [L(CH.set, TARGET.self, 0.75, { nonSetterToss: true })],
  },
  {
    id: 'jump-serve', name: '점프 서브', owner: 'p037', rarity: 'SR', pos: POS.OH,
    desc: '서브 에이스 확률이 소폭 상승한다. 대신 서브 범실 확률도 약간 상승한다.',
    effects: [
      L(CH.serveAce, TARGET.self, 0.40, null),
      L(CH.serveError, TARGET.self, 0.14, null),
    ],
  },
  {
    id: 'pipe', name: '파이프', owner: 'p038', rarity: 'SR', pos: POS.OP,
    desc: '후위 중앙(파이프) 공격 시도 시 성공률이 소폭 상승한다.',
    effects: [L(CH.attackKill, TARGET.self, 0.126, { types: [ATK.BackRow] })],
  },
];

export const SKILL_BY_NAME = new Map(SKILLS.map(s => [s.name, s]));
export const SKILL_BY_ID = new Map(SKILLS.map(s => [s.id, s]));
export const SKILL_BY_OWNER = new Map(SKILLS.map(s => [s.owner, s]));

/** 스킬 정의를 찾는다(이름 또는 id). 없으면 null. */
export function findSkill(key) {
  if (!key) return null;
  return SKILL_BY_NAME.get(key) || SKILL_BY_ID.get(key) || null;
}

/** 판정에 실제로 반영되는 스킬인지. 레벨 0(미해금)이면 아무 효과도 없다. */
export function hasActiveSkill(p) {
  return !!p && (p.skillLevel | 0) > 0 && SKILL_BY_NAME.has(p.skillName);
}

// ---------------------------------------------------------------- 조건 판정
function inList(list, v) {
  for (let i = 0; i < list.length; i++) if (list[i] === v) return true;
  return false;
}

function topSpikerOnCourt(team) {
  let best = null, bestV = -1;
  for (let pos = 1; pos <= 6; pos++) {
    const p = team.playerAt(pos);
    if (p.isLibero) continue;
    const v = p.stats[STAT.spike];
    if (v > bestV) { bestV = v; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- 런타임
/**
 * 경기 1회 동안의 스킬 상태(연속 득점·직전 랠리 블로킹 득점·랠리 플래그)와 판정 훅.
 * 난수를 쓰지 않으므로 RNG 스트림에 영향이 없다.
 */
export class SkillRuntime {
  /** @param {object} cfg SimConfig.skill @param {TeamMatchState} home @param {TeamMatchState} away */
  constructor(cfg, home, away) {
    this.cfg = cfg;
    this.scale = cfg.levelScale;
    this.cap = cfg.channelCap;
    this.gs = cfg.globalScale;
    this.teams = [home, away];
    this.entries = [[], []];
    this.chMask = [0, 0];
    this.hasWeight = [false, false];
    this.hasFatigue = [false, false];

    for (let side = 0; side < 2; side++) {
      const t = this.teams[side];
      for (const p of t.state.roster) {
        if (!hasActiveSkill(p)) continue;
        const def = SKILL_BY_NAME.get(p.skillName);
        const level = clamp(p.skillLevel | 0, 1, this.scale.length - 1);
        this.entries[side].push({ p, def, level, blockKillPrev: false, blockKillThis: false, strongRecv: false });
        for (const e of def.effects) {
          if (e.kind === EFFECT.logit) this.chMask[side] |= (1 << e.ch);
          else if (e.kind === EFFECT.weight) this.hasWeight[side] = true;
          else if (e.kind === EFFECT.fatigueImmune) this.hasFatigue[side] = true;
        }
      }
    }

    this.pointsToWin = 25;
    this.streak = [0, 0];    // 연속 득점(상대 기준 = 연속 실점)
    this.rotations = [0, 0]; // 세트 내 로테이션 횟수
    this.lastRot = [0, 0];
    // 공격 시퀀스 스크래치 컨텍스트(랠리마다 재사용 — 할당 없음)
    this.cx = {
      actor: null, setter: null, attacker: null, type: ATK.None,
      attackIndex: 0, pass: Q.None, blockN: 0, blockers: null,
      nonSetter: false, aggression: 0.5,
    };
  }

  /** 활성 스킬이 하나도 없으면 훅을 붙일 필요가 없다. */
  get empty() { return this.entries[0].length === 0 && this.entries[1].length === 0; }

  // -------------------------------------------------- 상태 갱신
  startSet(pointsToWin) {
    this.pointsToWin = pointsToWin;
    this.streak[0] = 0; this.streak[1] = 0;
    this.rotations[0] = 0; this.rotations[1] = 0;
    this.lastRot[0] = this.teams[0].rotationIndex; this.lastRot[1] = this.teams[1].rotationIndex;
    for (let s = 0; s < 2; s++) {
      for (const e of this.entries[s]) { e.blockKillPrev = false; e.blockKillThis = false; e.strongRecv = false; }
    }
  }

  /** 랠리 시작: 랠리 스코프 플래그 초기화 + 로테이션 관찰. */
  beginRally() {
    for (let s = 0; s < 2; s++) {
      const ri = this.teams[s].rotationIndex;
      if (ri !== this.lastRot[s]) { this.rotations[s]++; this.lastRot[s] = ri; }
      for (const e of this.entries[s]) e.strongRecv = false;
    }
  }

  /** 랠리 종료: 연속 득점 갱신 + "다음 랠리" 플래그 승격. */
  endRally(winnerSide) {
    this.streak[winnerSide]++;
    this.streak[1 - winnerSide] = 0;
    for (let s = 0; s < 2; s++) {
      for (const e of this.entries[s]) { e.blockKillPrev = e.blockKillThis; e.blockKillThis = false; }
    }
  }

  /** 블로킹 득점 기록. 주 블로커뿐 아니라 그 블록에 참여한 전원을 '블로킹 성공'으로 본다. */
  noteBlockKill(defending, blockers, blockN) {
    const list = this.entries[defending.side];
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < blockN; j++) if (list[i].p === blockers[j]) { list[i].blockKillThis = true; break; }
    }
  }

  /** 리시브 결과 기록 — '강서브를 받아냈다' 플래그. */
  noteReceive(receiving, receiver, quality, aggression) {
    const list = this.entries[receiving.side];
    if (list.length === 0) return;
    const ok = (quality === Q.Perfect || quality === Q.Good);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.p === receiver && ok && aggression >= 0.5) e.strongRecv = true;
    }
  }

  // -------------------------------------------------- 내부 평가
  /** 채널 ch 의 side 팀 합계 로짓. */
  sum(ch, side) {
    if ((this.chMask[side] & (1 << ch)) === 0) return 0;
    const list = this.entries[side], team = this.teams[side], cx = this.cx;
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      if (team.positionOf(ent.p) === 0) continue; // 코트 밖 = 미발동
      const effs = ent.def.effects;
      const mult = this.scale[ent.level];
      for (let j = 0; j < effs.length; j++) {
        const ef = effs[j];
        if (ef.kind !== EFFECT.logit || ef.ch !== ch) continue;
        if (!this.targetOk(ef.target, ent, cx)) continue;
        if (!this.whenOk(ef.when, ent, side, cx)) continue;
        total += ef.mag * mult;
      }
    }
    if (total === 0) return 0;
    total *= this.gs;
    return total > this.cap ? this.cap : (total < -this.cap ? -this.cap : total);
  }

  targetOk(target, ent, cx) {
    switch (target) {
      case TARGET.self: return cx.actor === ent.p;
      case TARGET.setter: return cx.setter === ent.p;
      case TARGET.blocker: {
        const b = cx.blockers;
        if (b === null) return false;
        for (let i = 0; i < cx.blockN; i++) if (b[i] === ent.p) return true;
        return false;
      }
      default: return true; // TARGET.team
    }
  }

  whenOk(w, ent, side, cx) {
    if (w === null) return true;
    if (w.minScoreFromEnd !== undefined && this.teams[side].score < this.pointsToWin - w.minScoreFromEnd) return false;
    if (w.home === true && side !== SIDE.HOME) return false;
    if (w.pointStreak !== undefined && this.streak[side] < w.pointStreak) return false;
    if (w.concededStreak !== undefined && this.streak[1 - side] < w.concededStreak) return false;
    if (w.maxRotations !== undefined && this.rotations[side] >= w.maxRotations) return false;
    if (w.afterOwnBlockKill === true && !ent.blockKillPrev) return false;
    if (w.strongServeReceived === true && !ent.strongRecv) return false;
    if (w.types !== undefined && !inList(w.types, cx.type)) return false;
    if (w.blockersMax !== undefined && cx.blockN > w.blockersMax) return false;
    if (w.blockersMin !== undefined && cx.blockN < w.blockersMin) return false;
    if (w.passQuality !== undefined && !inList(w.passQuality, cx.pass)) return false;
    if (w.minAttackIndex !== undefined && cx.attackIndex < w.minAttackIndex) return false;
    if (w.nonSetterToss === true && !cx.nonSetter) return false;
    if (w.minAggression !== undefined && cx.aggression < w.minAggression) return false;
    if (w.topSpiker === true && cx.attacker !== topSpikerOnCourt(this.teams[side])) return false;
    if (w.opponentLiberoOff === true && this.teams[1 - side].liberoReplacing !== null) return false;
    return true;
  }

  // -------------------------------------------------- 판정 훅 (match.js 에서 호출)
  /** 서브 범실 로짓(+ = 범실↑). */
  serveErrorLogit(serving, server, aggression) {
    const cx = this.cx;
    cx.actor = server; cx.aggression = aggression;
    return this.sum(CH.serveError, serving.side);
  }

  /** 리시브 대결 x 의 가산분 = 리시브 팀 보너스 − 서브 팀 압박. */
  receiveXLogit(receiving, receiver, serving) {
    const cx = this.cx;
    cx.actor = receiver;
    const r = this.sum(CH.receive, receiving.side);
    cx.actor = serving.playerAt(1);
    const s = this.sum(CH.servePressure, serving.side);
    return r - s;
  }

  /** 에이스 로짓(+ = 에이스↑). receiveXLogit 뒤에 부른다. */
  aceLogit(serving, server) {
    this.cx.actor = server;
    return this.sum(CH.serveAce, serving.side);
  }

  /**
   * 공격 시퀀스 컨텍스트 확정(토스 판정 직전). 블로커는 아직 미정이라 0 으로 둔다.
   * @returns 토스 품질 x 의 가산분
   */
  setLogit(attacking, setter, attacker, type, pass, nonSetter, attackIndex) {
    const cx = this.cx;
    cx.actor = setter; cx.setter = setter; cx.attacker = attacker;
    cx.type = type; cx.pass = pass; cx.nonSetter = nonSetter; cx.attackIndex = attackIndex;
    cx.blockN = 0; cx.blockers = null;
    return this.sum(CH.set, attacking.side);
  }

  /** 블로커 확정 후 컨텍스트 갱신. */
  noteBlockers(blockN, blockers) {
    this.cx.blockN = blockN;
    this.cx.blockers = blockers;
  }

  /** 공격 범실 로짓(+ = 범실↑). */
  attackErrorLogit(attacking, attacker) {
    this.cx.actor = attacker;
    return this.sum(CH.attackError, attacking.side);
  }

  /** 블로킹 대결 로짓 = 수비 팀 블로킹 − 공격 팀 예측(피블로킹 회피). */
  blockLogit(defending, attacking, attacker) {
    this.cx.actor = attacker;
    const d = this.sum(CH.block, defending.side);
    const a = this.sum(CH.antiBlock, attacking.side);
    return d - a;
  }

  /** 킬 로짓(+ = 결정률↑). */
  attackKillLogit(attacking, attacker) {
    this.cx.actor = attacker;
    return this.sum(CH.attackKill, attacking.side);
  }

  /** 디그 유리 로짓(+ = 킬 확률↓ · 디그 품질↑). */
  digLogit(defending, digger) {
    this.cx.actor = digger;
    return this.sum(CH.dig, defending.side);
  }

  /** 공격 옵션 선택 가중치 배수(1.0 = 변화 없음). */
  weightMult(attacking, setter, type, pass) {
    const side = attacking.side;
    if (!this.hasWeight[side]) return 1.0;
    const list = this.entries[side], team = this.teams[side], cx = this.cx;
    cx.setter = setter; cx.actor = setter; cx.attacker = null;
    cx.type = type; cx.pass = pass; cx.blockN = 0; cx.blockers = null;
    let m = 1.0;
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      if (team.positionOf(ent.p) === 0) continue;
      const effs = ent.def.effects;
      for (let j = 0; j < effs.length; j++) {
        const ef = effs[j];
        if (ef.kind !== EFFECT.weight || ef.type !== type) continue;
        if (!this.targetOk(ef.target, ent, cx)) continue;
        if (!this.whenOk(ef.when, ent, side, cx)) continue;
        m *= 1.0 + ef.mult * this.scale[ent.level] * this.gs;
      }
    }
    return m;
  }

  /** 블로킹 강도 계산에서 피로 감소를 면제받는가. */
  blockFatigueImmune(defending, p) {
    const side = defending.side;
    if (!this.hasFatigue[side]) return false;
    const list = this.entries[side], cx = this.cx;
    for (let i = 0; i < list.length; i++) {
      const ent = list[i];
      if (ent.p !== p) continue;
      const effs = ent.def.effects;
      for (let j = 0; j < effs.length; j++) {
        const ef = effs[j];
        if (ef.kind !== EFFECT.fatigueImmune) continue;
        if (!this.targetOk(ef.target, ent, cx)) continue;
        if (!this.whenOk(ef.when, ent, side, cx)) continue;
        return true;
      }
    }
    return false;
  }
}

/**
 * 경기용 스킬 런타임. 활성 스킬이 하나도 없거나 설정이 꺼져 있으면 **null** 을 돌려준다
 * (match.js 가 훅을 통째로 건너뛴다 → 기존 결과와 비트 단위로 동일).
 */
export function createSkillRuntime(cfg, home, away) {
  const sc = cfg && cfg.skill;
  if (!sc || sc.enabled === false) return null;
  const rt = new SkillRuntime(sc, home, away);
  return rt.empty ? null : rt;
}

// ---------------------------------------------------------------- UI 보조
const CH_SIGN_KO = [
  ['범실↓', '범실↑'], ['에이스↓', '에이스↑'], ['압박↓', '상대 리시브↓'], ['리시브↓', '리시브↑'],
  ['토스↓', '토스↑'], ['결정률↓', '결정률↑'], ['범실↓', '범실↑'], ['피블로킹↑', '피블로킹↓'],
  ['블로킹↓', '블로킹↑'], ['디그↓', '디그↑'],
];

const WHEN_KO = {
  minScoreFromEnd: v => `세트 ${25 - v}점 이후`,
  home: () => '홈 경기',
  pointStreak: v => `${v}연속 득점 중`,
  concededStreak: v => `${v}연속 실점 직후`,
  maxRotations: v => (v === 1 ? '세트 첫 로테이션' : `세트 로테이션 ${v}회 이전`),
  afterOwnBlockKill: () => '블로킹 득점 다음 랠리',
  strongServeReceived: () => '강서브 리시브 성공 랠리',
  types: v => v.map(t => ATK_KO[t]).join('·'),
  blockersMax: v => `상대 블로커 ${v}인 이하`,
  blockersMin: v => `상대 블로커 ${v}인 이상`,
  passQuality: v => v.map(q => Q_KO[q]).join('/') + '패스',
  minAttackIndex: v => `랠리 ${v + 1}번째 공격부터`,
  nonSetterToss: () => '세터가 첫 터치',
  minAggression: v => `서브 공격성 ${v} 이상`,
  topSpiker: () => '팀 최고 스파이커에게',
  opponentLiberoOff: () => '상대 리베로 코트 밖',
};
const ATK_KO = ['—', '속공', '오픈', '후위', '시간차', '덤프', '프리볼'];
const Q_KO = ['—', 'A', 'B', 'C', '실패'];

/** 카드 UI 용 효과 설명 줄. 레벨을 주면 실제 수치를 함께 낸다. */
export function describeSkill(key, level = 1, cfg = null) {
  const def = findSkill(key);
  if (!def) return null;
  const scale = cfg && cfg.skill ? cfg.skill.levelScale : [0, 1.0, 1.5, 2.0];
  const m = scale[clamp(level | 0, 1, scale.length - 1)];
  const lines = def.effects.map(e => {
    const cond = e.when ? Object.keys(e.when).map(k => (WHEN_KO[k] ? WHEN_KO[k](e.when[k]) : k)).join(' · ') : '상시';
    if (e.kind === EFFECT.weight) return `${cond}: ${ATK_KO[e.type]} 선택 비중 ×${(1 + e.mult * m).toFixed(2)}`;
    if (e.kind === EFFECT.fatigueImmune) return `${cond}: 블로킹 피로 페널티 면제`;
    const v = e.mag * m;
    const label = CH_SIGN_KO[e.ch][v >= 0 ? 1 : 0];
    return `${cond}: ${CH_NAMES_KO[e.ch]} ${label} (로짓 ${v >= 0 ? '+' : ''}${v.toFixed(2)})`;
  });
  return { id: def.id, name: def.name, rarity: def.rarity, desc: def.desc, level, lines };
}
