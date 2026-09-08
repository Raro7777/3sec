// 도메인 타입·열거형·팀 경기 상태. Domain/*.cs + Engine/TeamMatchState.cs 포팅.

// ---------------------------------------------------------------- 열거형
// Domain/Enums.cs:6 Position (정수값 = C# enum 값)
export const POS = { S: 0, OH: 1, OP: 2, MB: 3, L: 4 };
export const POS_CODES = ['S', 'OH', 'OP', 'MB', 'L'];
export const POSITIONS = ['S', 'OH', 'OP', 'MB', 'L'];
export const RARITIES = ['N', 'R', 'SR', 'SSR'];
export const RARITY = { N: 0, R: 1, SR: 2, SSR: 3 };

// Domain/Enums.cs:29 StatKind — 10종 스탯의 배열 인덱스
export const STAT = {
  serve: 0, receive: 1, set: 2, spike: 3, block: 4,
  dig: 5, speed: 6, power: 7, stamina: 8, mental: 9,
};
export const STAT_KEYS = ['serve', 'receive', 'set', 'spike', 'block', 'dig', 'speed', 'power', 'stamina', 'mental'];
export const STAT_NAMES_KO = ['서브', '리시브', '토스', '스파이크', '블로킹', '디그', '스피드', '파워', '스태미나', '멘탈'];

export const SIDE = { HOME: 0, AWAY: 1 };

// Log/MatchEvent.cs:8 EventType
export const EV = {
  MatchStart: 0, SetStart: 1, RallyStart: 2, Serve: 3, Reception: 4, Set: 5,
  Attack: 6, Block: 7, Dig: 8, Cover: 9, FreeBall: 10, Point: 11, Rotation: 12,
  LiberoIn: 13, LiberoOut: 14, Substitution: 15, SetEnd: 16, MatchEnd: 17,
  Timeout: 18,   // 흐름 모델: 작전타임(value = 끊은 상대 연속 득점 수). 기본 sim 은 내지 않는다
};
// Log/MatchEvent.cs:32 Quality
export const Q = { None: 0, Perfect: 1, Good: 2, Poor: 3, Error: 4 };
// Log/MatchEvent.cs:42 Outcome
export const OUT = {
  None: 0, InPlay: 1, Ace: 2, Kill: 3, Error: 4, BlockKill: 5,
  BlockTouch: 6, BlockOut: 7, Dug: 8, Covered: 9,
};
// Log/MatchEvent.cs:59 AttackType
export const ATK = { None: 0, Quick: 1, Open: 2, BackRow: 3, Delayed: 4, Dump: 5, FreeBall: 6 };
// Log/MatchEvent.cs:72 PointReason
export const REASON = { None: 0, Ace: 1, ServeError: 2, Kill: 3, AttackError: 4, BlockKill: 5, BlockOut: 6, RallyCap: 7 };
// Domain/Tactics.cs:4 ReceiveFormation
export const FORMATION = { Standard: 0, LiberoCentered: 1, Spread: 2 };

// ---------------------------------------------------------------- 선수
/**
 * 엔진 내부 선수 표현. stats/potential 은 길이 10 Int 배열(STAT 인덱스) — 객체 대신 배열이라 접근이 빠르다.
 * Domain/Player.cs:22
 */
export function makePlayer(o) {
  return {
    id: o.id, name: o.name || '', teamId: o.teamId || '',
    pos: o.pos, rarity: o.rarity | 0,
    jersey: o.jersey | 0, heightCm: o.heightCm || 175, age: o.age || 20,
    stats: o.stats, potential: o.potential || o.stats.slice(),
    skillName: o.skillName || '', skillDesc: o.skillDesc || '',
    // 고유 스킬 레벨(0 = 미해금 → 경기 판정에 아무 영향 없음). docs/skills.md 3절
    skillLevel: o.skillLevel | 0,
    isLibero: o.pos === POS.L,
  };
}

/** data.js 의 JSON 선수 → 엔진 선수. JsonDataLoader.cs:59 ParsePlayer */
export function playerFromJson(j) {
  const s = new Array(10), p = new Array(10);
  for (let i = 0; i < 10; i++) {
    const k = STAT_KEYS[i];
    s[i] = clampStat(j.stats ? (j.stats[k] | 0) : 0);
    p[i] = clampStat(j.potential ? (j.potential[k] | 0) : 0);
  }
  return makePlayer({
    id: j.id, name: j.name, teamId: j.teamId,
    pos: POS[j.position], rarity: RARITY[j.rarity] ?? 0,
    jersey: j.jerseyNumber, heightCm: j.heightCm ?? 175, age: j.age ?? 20,
    stats: s, potential: p,
    skillName: j.skill ? j.skill.name : '', skillDesc: j.skill ? j.skill.description : '',
    skillLevel: j.skill && j.skill.level !== undefined ? j.skill.level : 0,
  });
}

export function clampStat(v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }

export function statAverage(stats) {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += stats[i];
  return sum / 10;
}

export function clonePlayer(p) {
  return { ...p, stats: p.stats.slice(), potential: p.potential.slice() };
}

// ---------------------------------------------------------------- 전술
/** Domain/Tactics.cs:16 Tactics.Default */
export function defaultTactics() {
  return {
    quickWeight: 1.2, openWeight: 1.0, backRowWeight: 0.7, delayedWeight: 0.5,
    serveAggression: 0.5, formation: FORMATION.Standard,
  };
}

// ---------------------------------------------------------------- 라인업
/**
 * Domain/Lineup.cs:22 Standard51 — 1:S 2:OH1 3:MB1 4:OP 5:OH2 6:MB2
 * startingIds[i] 는 코트 포지션 (i+1) 에 서는 선수.
 */
export function standard51(setter, oh1, mb1, op, oh2, mb2, libero) {
  return { startingIds: [setter, oh1, mb1, op, oh2, mb2], liberoId: libero || null, benchIds: [] };
}

/** LineupBuilder.cs:15 Auto — 포지션별 핵심 스탯 기준 자동 5-1 편성. */
export function autoLineupFromRoster(roster) {
  if (!roster || roster.length < 6) throw new Error('라인업에는 리베로를 제외한 6명 이상이 필요합니다');
  const used = new Set();
  // 벤치 표시(isBench, AI 구단의 생성 벤치)는 선발 후보에서 뺀다 — 벤치가 주전을 밀어내면 캘리브레이션이 흔들린다.
  // 벤치를 빼고 6명이 안 되면(결원이 심한 경우) 전원을 후보로.
  const core = roster.filter(p => !p.isBench);
  const cand = core.filter(p => !p.isLibero).length >= 6 ? core : roster;
  const pick = (pos, score) => {
    let best = null, bestV = -Infinity;
    for (const p of cand) {
      if (p.pos !== pos || used.has(p.id)) continue;
      const v = score(p);
      if (v > bestV) { bestV = v; best = p; }
    }
    if (best) used.add(best.id);
    return best;
  };
  const S = STAT;
  const setter = pick(POS.S, p => p.stats[S.set] * 2.0 + p.stats[S.speed]);
  const oh1 = pick(POS.OH, p => p.stats[S.spike] + p.stats[S.receive]);
  const oh2 = pick(POS.OH, p => p.stats[S.spike] + p.stats[S.receive]);
  const op = pick(POS.OP, p => p.stats[S.spike] + p.stats[S.power]);
  const mb1 = pick(POS.MB, p => p.stats[S.block] * 2.0 + p.stats[S.spike]);
  const mb2 = pick(POS.MB, p => p.stats[S.block] * 2.0 + p.stats[S.spike]);
  const libero = pick(POS.L, p => p.stats[S.receive] + p.stats[S.dig]);

  const slots = [setter, oh1, mb1, op, oh2, mb2];
  for (let i = 0; i < 6; i++) {
    if (slots[i]) continue;
    let best = null, bestV = -Infinity;
    for (const p of cand) {
      if (p.isLibero || used.has(p.id)) continue;
      const v = statAverage(p.stats);
      if (v > bestV) { bestV = v; best = p; }
    }
    if (!best) throw new Error('라인업을 채울 비리베로 선수가 부족합니다');
    used.add(best.id);
    slots[i] = best;
  }
  const lineup = standard51(slots[0].id, slots[1].id, slots[2].id, slots[3].id, slots[4].id, slots[5].id, libero ? libero.id : null);
  for (const p of roster) if (!used.has(p.id)) lineup.benchIds.push(p.id);
  return lineup;
}

// ---------------------------------------------------------------- 팀 상태(경기 투입 직전)
/** Domain/TeamState.cs:35 TeamState */
export function makeTeamState(team, roster, lineup, opts = {}) {
  const index = new Map();
  for (const p of roster) index.set(p.id, p);
  return {
    team, roster, lineup,
    index,
    tactics: opts.tactics || defaultTactics(),
    teamCondition: opts.teamCondition ?? 1.0,
    playerCondition: opts.playerCondition || null, // Map<id, number> | null
    chemistry: opts.chemistry || null,             // Map<"setter|attacker", number> | null
  };
}

export function getPlayer(state, id) { return id == null ? null : (state.index.get(id) || null); }

/** Domain/TeamState.cs:12 ChemistryTable.Get — 기본 50 */
export function chemistryOf(state, setterId, attackerId) {
  if (!state.chemistry || setterId == null || attackerId == null) return 50;
  const v = state.chemistry.get(setterId + '|' + attackerId);
  return v === undefined ? 50 : v;
}

export function conditionOf(state, playerId) {
  if (!state.playerCondition) return 1.0;
  const v = state.playerCondition.get(playerId);
  return v === undefined ? 1.0 : v;
}

/** Domain/TeamState.cs:76 Validate */
export function validateTeamState(state) {
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const id = state.lineup.startingIds[i];
    if (!id) throw new Error(`라인업 ${i + 1}번 자리가 비었습니다`);
    if (seen.has(id)) throw new Error(`선발 중복: ${id}`);
    seen.add(id);
    const p = getPlayer(state, id);
    if (!p) throw new Error(`선발 ${id} 이(가) 로스터에 없습니다`);
    if (p.isLibero) throw new Error(`리베로 ${id} 는 선발 6인이 될 수 없습니다`);
  }
  const lid = state.lineup.liberoId;
  if (lid) {
    const l = getPlayer(state, lid);
    if (!l) throw new Error(`리베로 ${lid} 이(가) 로스터에 없습니다`);
    if (!l.isLibero) throw new Error(`${lid} 는 리베로가 아닙니다`);
    if (seen.has(lid)) throw new Error(`리베로 ${lid} 가 선발에도 있습니다`);
  }
  return true;
}

// ---------------------------------------------------------------- 경기 중 팀 상태
export function newTeamMatchStats() {
  return {
    points: 0,
    serveRallies: 0, serveRalliesWon: 0, receiveRallies: 0, receiveRalliesWon: 0,
    serves: 0, aces: 0, serveErrors: 0,
    receptions: 0, receptionPerfect: 0, receptionGood: 0, receptionPoor: 0, receptionErrors: 0,
    attacks: 0, kills: 0, attackErrors: 0, blocked: 0,
    firstBallAttacks: 0, firstBallKills: 0, transitionAttacks: 0,
    blockKills: 0, blockTouches: 0, blockOuts: 0,
    digAttempts: 0, digs: 0, freeBalls: 0, dumps: 0,
    clutchRallies: 0, clutchRalliesWon: 0,
    liberoSwaps: 0, substitutions: 0,
    attacksByType: [0, 0, 0, 0, 0, 0, 0, 0],
    killsByType: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

export function isFrontRow(position) { return position >= 2 && position <= 4; }

/**
 * 경기 중 한 팀의 가변 상태. Engine/TeamMatchState.cs:12
 * 코트 포지션: 1=후위 오른쪽(서버), 2=전위 오른쪽, 3=전위 중앙, 4=전위 왼쪽, 5=후위 왼쪽, 6=후위 중앙.
 */
export class TeamMatchState {
  constructor(side, state) {
    this.side = side;
    this.state = state;
    this.tactics = { ...state.tactics };   // 경기 안에서 세트 간 조정을 할 수 있게 사본(흐름 모델). 읽기에는 원본과 동일
    validateTeamState(state);
    this.starters = new Array(6);
    for (let i = 0; i < 6; i++) this.starters[i] = getPlayer(state, state.lineup.startingIds[i]);
    this.baseStarters = this.starters.slice();     // 세트 시작 라인업(교체는 세트 안에서만 유효)
    this.libero = state.lineup.liberoId ? getPlayer(state, state.lineup.liberoId) : null;
    // 벤치(선수 교체용, 리베로 제외). lineup.benchIds 가 없으면 빈 벤치 = 교체 없음
    this.bench = [];
    for (const id of (state.lineup.benchIds || [])) { const p = getPlayer(state, id); if (p && !p.isLibero) this.bench.push(p); }
    this.benchUsed = new Set();                     // 이 세트에 들어간 벤치 선수 id
    this.subbedOut = new Set();                     // 이 세트에 빠진 선발 id
    this.setStats = new Map();                      // 이 세트 개인 공격 기록 {a, k, e} — 부진 판단용(RNG 무관)
    this.rotationIndex = 0;
    this.onCourt = new Array(6);
    this.liberoReplacing = null;
    this.substitutionsUsed = 0;
    this.score = 0;
    this.setsWon = 0;
    this.setter = null;
    this.stats = newTeamMatchStats();
    this.resetForSet();
  }

  get teamId() { return this.state.team.id; }

  /** TeamMatchState.cs:57 ResetForSet */
  resetForSet() {
    this.rotationIndex = 0;
    this.score = 0;
    this.substitutionsUsed = 0;
    this.liberoReplacing = null;
    for (let i = 0; i < 6; i++) this.starters[i] = this.baseStarters[i];
    this.benchUsed.clear(); this.subbedOut.clear(); this.setStats.clear();
    this.rebuildCourt();
  }

  /** 이 세트 개인 공격 기록. kind 0 시도 · 1 범실(피블로킹 포함) · 2 킬 */
  noteAtk(p, kind) {
    let s = this.setStats.get(p.id);
    if (s === undefined) { s = { a: 0, k: 0, e: 0 }; this.setStats.set(p.id, s); }
    if (kind === 0) s.a++; else if (kind === 1) s.e++; else s.k++;
  }

  /**
   * 선수 교체(랠리 사이). 선발 자리 slot(0~5)의 선수를 벤치 sub 로 바꾼다. 로테이션 자리는 그대로.
   * 빠진 선수는 이 세트에 못 돌아오고, 들어온 선수는 다시 벤치로 못 나간다(단순화한 FIVB 규칙). docs/match-sim.md 16절
   */
  substitute(slot, sub) {
    const out = this.starters[slot];
    this.starters[slot] = sub;
    this.subbedOut.add(out.id); this.benchUsed.add(sub.id);
    this.substitutionsUsed++; this.stats.substitutions++;
    if (this.liberoReplacing === out) this.liberoReplacing = null;   // 리베로가 대신 서던 선수가 빠지면 리베로 규칙을 다시 본다
    this.rebuildCourt();
    return out;
  }

  /** 시계방향 로테이션(2→1→6→5→4→3→2). TeamMatchState.cs:66 Rotate */
  rotate() {
    this.rotationIndex = (this.rotationIndex + 1) % 6;
    this.rebuildCourt();
  }

  basePlayerAt(position) { return this.starters[(position - 1 + this.rotationIndex) % 6]; }

  playerAt(position) { return this.onCourt[position - 1]; }

  positionOf(p) {
    for (let i = 0; i < 6; i++) if (this.onCourt[i] === p) return i + 1;
    return 0;
  }

  rebuildCourt() {
    const lr = this.liberoReplacing, l = this.libero;
    for (let p = 1; p <= 6; p++) {
      const bp = this.basePlayerAt(p);
      this.onCourt[p - 1] = (lr !== null && bp === lr && l !== null) ? l : bp;
    }
    this.setter = this.findSetter();
  }

  /** TeamMatchState.cs:100 FindSetter — 포지션 S 우선, 없으면 세트 스탯 최고(리베로 제외). */
  findSetter() {
    for (let i = 0; i < 6; i++) if (this.onCourt[i].pos === POS.S) return this.onCourt[i];
    let best = null;
    for (let i = 0; i < 6; i++) {
      const p = this.onCourt[i];
      if (p.isLibero) continue;
      if (best === null || p.stats[STAT.set] > best.stats[STAT.set]) best = p;
    }
    return best || this.onCourt[0];
  }

  /**
   * 리베로 자동 교체(랠리 사이). 후위(6→5→1 순)의 MB 를 대신한다.
   * 단 1번(서버) 자리는 서브권 보유 시 교체 불가(리베로 서브 금지). TeamMatchState.cs:120 ApplyLiberoRule
   */
  applyLiberoRule(serving, log, set, rally, homeScore, awayScore) {
    if (this.libero === null) { this.liberoReplacing = null; return; }
    let target = null, targetPos = 0;
    const order = LIBERO_ORDER;
    for (let i = 0; i < 3; i++) {
      const pos = order[i];
      if (pos === 1 && serving) continue;
      const bp = this.basePlayerAt(pos);
      if (bp.pos === POS.MB) { target = bp; targetPos = pos; break; }
    }
    if (target === this.liberoReplacing) { this.rebuildCourt(); return; }
    if (this.liberoReplacing !== null && log) {
      const e = log.add(EV.LiberoOut, set, rally, this.side, homeScore, awayScore);
      if (e) { e.playerId = this.libero.id; e.courtPosition = this.positionOf(this.libero); e.secondary = [this.liberoReplacing.id]; }
    }
    this.liberoReplacing = target;
    this.rebuildCourt();
    if (target !== null) {
      this.stats.liberoSwaps++;
      if (log) {
        const e = log.add(EV.LiberoIn, set, rally, this.side, homeScore, awayScore);
        if (e) { e.playerId = this.libero.id; e.courtPosition = targetPos; e.secondary = [target.id]; }
      }
    }
  }
}

const LIBERO_ORDER = [6, 5, 1];
