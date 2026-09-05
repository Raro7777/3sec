// 정합(파리티) 검증 하네스 — `node web/parity.mjs`
// C# 기준값(docs/match-sim-balance-report.md v0.2, docs/training-mode.md 12.4절 · OracleTests)과
// JS 포팅의 집계 지표를 비교한다. 비트 단위 일치가 아니라 집계 일치가 목표.
//
// 옵션: --matches N (기본 2000)  --runs N (기본 2000)  --skill N (기본 4000)  --json
//       --skill-table  스킬 24종 × Lv1/Lv3 단독 기여 표를 함께 뽑는다(문서 갱신용)
//                      표를 신뢰하려면 표본이 커야 한다: `node web/parity.mjs --skill 6000 --skill-table` (약 9분)

import { performance } from 'node:perf_hooks';
import { generateTeamState } from './engine/generator.js';
import { simulateMatch, totalPoints } from './engine/match.js';
import { mixSeed } from './engine/rng.js';
import { SIDE, POS, STAT, RARITY, makePlayer } from './engine/domain.js';
import {
  TrainingSession, POLICIES, runWithPolicy, emptySupport, buildSupport, stubEvaluationProvider,
} from './engine/training.js';
import { DEFAULT_TRAINING_CONFIG, gradeOf, ovrOf } from './engine/training-config.js';
import { SKILLS, createSkillRuntime, findSkill } from './engine/skills.js';
import { createSimConfig } from './engine/config.js';
import * as G from './engine/game.js';
import * as F from './engine/facility.js';
import { renderCommentary } from './engine/commentary.js';

// ---------------------------------------------------------------- 인자
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? Number(argv[i + 1]) : def;
}
const MATCHES = arg('matches', 2000);
const RUNS = arg('runs', 2000);
const SKILL_PAIRS = arg('skill', 4000);
const SKILL_TABLE = argv.includes('--skill-table');
const AS_JSON = argv.includes('--json');

const rows = [];
let failures = 0;
const esc = s => String(s).replace(/\|/g, '/');

/** 수치 비교 행. */
function check(section, label, actual, expected, tol, fmt = v => v.toFixed(1), note = '') {
  const ok = Math.abs(actual - expected) <= tol + 1e-9;
  if (!ok) failures++;
  rows.push({ section, label, csharp: fmt(expected), js: fmt(actual), tol: '±' + fmt(tol), verdict: ok ? '통과' : '실패', note });
}
/** 불리언(규칙 불변식) 행. */
function must(section, label, ok, note = '') {
  if (!ok) failures++;
  rows.push({ section, label, csharp: 'OK', js: ok ? 'OK' : 'NG', tol: '—', verdict: ok ? '통과' : '실패', note });
}
/** 상한 예산 행(성능·용량). */
function budget(section, label, actual, limit, fmt, note = '') {
  const ok = actual <= limit;
  if (!ok) failures++;
  rows.push({ section, label, csharp: '< ' + fmt(limit), js: fmt(actual), tol: '—', verdict: ok ? '통과' : '실패', note });
}
function info(section, label, value, note = '') {
  rows.push({ section, label, csharp: '—', js: value, tol: '—', verdict: '참고', note });
}

const P = v => (v * 100).toFixed(1) + '%';
const PP = v => (v * 100).toFixed(1) + '%p';

// ================================================================ 1. 경기 시뮬
function runMatchParity(n, seed = 42) {
  const a = {
    matches: 0, homeWins: 0, sets: 0, points: 0, rallies: 0,
    receiveRallies: 0, receiveRalliesWon: 0, serves: 0, aces: 0, serveErrors: 0,
    attacks: 0, kills: 0, attackErrors: 0, blocked: 0, blockTouches: 0, blockKills: 0,
    receptions: 0, rp: 0, rg: 0, rpo: 0, re: 0,
    firstBallAttacks: 0, firstBallKills: 0, freeBalls: 0,
  };
  const addStats = s => {
    a.receiveRallies += s.receiveRallies; a.receiveRalliesWon += s.receiveRalliesWon;
    a.serves += s.serves; a.aces += s.aces; a.serveErrors += s.serveErrors;
    a.attacks += s.attacks; a.kills += s.kills; a.attackErrors += s.attackErrors;
    a.blocked += s.blocked; a.blockTouches += s.blockTouches; a.blockKills += s.blockKills;
    a.receptions += s.receptions; a.rp += s.receptionPerfect; a.rg += s.receptionGood;
    a.rpo += s.receptionPoor; a.re += s.receptionErrors;
    a.firstBallAttacks += s.firstBallAttacks; a.firstBallKills += s.firstBallKills;
    a.freeBalls += s.freeBalls;
  };
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    // MonteCarlo.cs 의 베이스라인 시나리오: 경기마다 새 동급 랜덤 로스터(overall 67, ±6)
    const home = generateTeamState(mixSeed(seed, i, 1), 'HOME', '홈', 67);
    const away = generateTeamState(mixSeed(seed, i, 2), 'AWAY', '원정', 67);
    const r = simulateMatch(home, away, mixSeed(seed, i, 7), null, false);
    a.matches++;
    if (r.winner === SIDE.HOME) a.homeWins++;
    a.sets += r.sets.length;
    const tp = totalPoints(r);
    a.points += tp.home + tp.away;
    for (const s of r.sets) a.rallies += s.rallies;
    addStats(r.homeStats); addStats(r.awayStats);
  }
  a.ms = performance.now() - t0;
  return a;
}

const M = runMatchParity(MATCHES);
const SEC1 = `경기 시뮬 (동급 랜덤 팀 ${MATCHES}경기, seed 42)`;
check(SEC1, '사이드아웃', M.receiveRalliesWon / M.receiveRallies, 0.609, 0.015, P);
check(SEC1, 'kill%', M.kills / M.attacks, 0.423, 0.015, P);
check(SEC1, '서브 에이스', M.aces / M.serves, 0.067, 0.010, P);
check(SEC1, '서브 범실', M.serveErrors / M.serves, 0.101, 0.010, P);
check(SEC1, '유효 블로킹', M.blocked / M.attacks, 0.102, 0.015, P);
check(SEC1, '세트당 득점', M.points / M.sets, 44.2, 1.5, v => v.toFixed(2));
check(SEC1, '홈 승률', M.homeWins / M.matches, 0.495, 0.030, P);

const SEC1B = '경기 시뮬 — 보조 지표 (C# v0.2 리포트)';
check(SEC1B, '공격 범실률', M.attackErrors / M.attacks, 0.080, 0.010, P);
check(SEC1B, '블록 터치 비율', M.blockTouches / M.attacks, 0.156, 0.015, P);
check(SEC1B, '리시브 A', M.rp / M.receptions, 0.350, 0.015, P);
check(SEC1B, '리시브 B', M.rg / M.receptions, 0.363, 0.015, P);
check(SEC1B, '리시브 C', M.rpo / M.receptions, 0.212, 0.015, P);
check(SEC1B, '리시브 실패', M.re / M.receptions, 0.074, 0.010, P);
check(SEC1B, '퍼스트볼 성공률', M.firstBallKills / M.firstBallAttacks, 0.452, 0.015, P);
check(SEC1B, '랠리당 공격 시도', M.attacks / M.rallies, 1.38, 0.06, v => v.toFixed(2));
check(SEC1B, '세트당 블로킹 득점', M.blockKills / M.sets, 6.21, 0.30, v => v.toFixed(2));
check(SEC1B, '세트당 프리볼', M.freeBalls / M.sets, 3.12, 0.30, v => v.toFixed(2));
check(SEC1B, '경기당 세트 수', M.sets / M.matches, 4.12, 0.10, v => v.toFixed(2));

// ================================================================ 2. 육성
const TCFG = DEFAULT_TRAINING_CONFIG;
/** OracleFixtures.cs:19 SsrOh — 파이썬 오라클 CARD 와 동일 */
function ssrOhCard() {
  return makePlayer({
    id: 'card', name: 'SSR OH 예시', teamId: 't01', pos: POS.OH, rarity: RARITY.SSR,
    jersey: 1, heightCm: 180, age: 20,
    stats: [62, 66, 50, 72, 58, 60, 68, 66, 64, 60],
    potential: [82, 90, 60, 98, 74, 80, 88, 88, 84, 82],
  });
}
/** OracleFixtures.cs:63 Seed(baseSeed, i) */
const oracleSeed = (base, i) => (Math.imul(base, 1000003) + Math.imul(i, 7919) + 17) | 0;

/** OracleFixtures.cs:76~ 의 SSR S등급 서포터 3인(풀세팅). 동문 t01 · 라이벌 t05 태그가 걸린다. */
function fullSupporters() {
  const mk = (name, pos, club, over) => {
    const s = { id: name, name, pos, clubId: club, stats: new Array(10).fill(60) };
    for (const [k, v] of over) s.stats[k] = v;
    return s;
  };
  const S = STAT;
  return [
    mk('SSR OH S등급(동문)', POS.OH, 't01', [[S.serve, 82], [S.receive, 90], [S.spike, 98], [S.dig, 70], [S.power, 84], [S.stamina, 78], [S.mental, 76]]),
    mk('SSR MB S등급', POS.MB, 't03', [[S.serve, 70], [S.spike, 88], [S.block, 98], [S.power, 92], [S.speed, 76], [S.stamina, 78], [S.mental, 74]]),
    mk('SSR L S등급(라이벌)', POS.L, 't05', [[S.receive, 96], [S.dig, 94], [S.set, 66], [S.speed, 90], [S.stamina, 80], [S.mental, 80]]),
  ];
}

function runTrainingBatch(policy, n, base = 1, sups = null) {
  const ovrs = new Float64Array(n);
  let injured = 0, severe = 0, hot = 0, rests = 0, trains = 0, hints = 0;
  let S = 0, A = 0, core = 0, all = 0;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const card = ssrOhCard();
    const prof = sups ? buildSupport(card.pos, card.teamId, sups, TCFG) : emptySupport(TCFG);
    const s = new TrainingSession(card, prof, TCFG, stubEvaluationProvider, oracleSeed(base, i));
    const r = runWithPolicy(s, policy);
    ovrs[i] = r.ovrRaw;
    if (s.trainee.injuries > 0) injured++;
    if (s.trainee.severeInjuries > 0) severe++;
    hot += s.trainee.hotTrains; rests += s.trainee.rests; trains += s.trainee.trains;
    hints += r.hints; core += r.coreReach; all += r.allReach;
    const g = gradeOf(TCFG, r.ovrRaw);
    if (g === 4) S++; else if (g === 3) A++;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += ovrs[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (ovrs[i] - mean) * (ovrs[i] - mean);
  const sorted = Array.from(ovrs).sort((x, y) => x - y);
  return {
    n, mean, sd: Math.sqrt(v / n), p10: sorted[Math.floor(n / 10)], p90: sorted[Math.floor(n * 9 / 10)],
    injury: injured / n, severe: severe / n, S: S / n, A: A / n,
    hot: hot / n, rests: rests / n, trains: trains / n, hints: hints / n,
    core: core / n, all: all / n, ms: performance.now() - t0,
  };
}

const SEC2 = `육성 (SSR OH · 서포터 없음 · 스텁 평가전 · ${RUNS}회, seed 1)`;
const safe = runTrainingBatch(POLICIES.safe, RUNS);
check(SEC2, '안전 — 기대 OVR', safe.mean, 76.2, 0.8, v => v.toFixed(2));
check(SEC2, '안전 — 부상률', safe.injury, 0.005, 0.005, P, '목표 0~1%');
const optimal = runTrainingBatch(POLICIES.optimal, RUNS);
check(SEC2, '최적 — 기대 OVR', optimal.mean, 78.4, 0.9, v => v.toFixed(2));
check(SEC2, '최적 — 부상률', optimal.injury, 0.17, 0.05, P);
const norest = runTrainingBatch(POLICIES.norest, RUNS);
check(SEC2, '무휴식 — 기대 OVR', norest.mean, 74.4, 1.0, v => v.toFixed(2));
must(SEC2, '무휴식 — 부상률 ≥ 90%', norest.injury >= 0.90, P(norest.injury) + ' (C# 96%)');

const SEC2B = '육성 — 보조 지표 (docs/training-mode.md 12.4절)';
const push = runTrainingBatch(POLICIES.push, RUNS);
const rand = runTrainingBatch(POLICIES.random, RUNS);
const spike = runTrainingBatch(POLICIES.spike, RUNS);
check(SEC2B, '푸시 — OVR', push.mean, 77.5, 0.8, v => v.toFixed(2));
check(SEC2B, '푸시 — 부상률', push.injury, 0.43, 0.06, P);
check(SEC2B, '랜덤 — OVR', rand.mean, 73.2, 0.9, v => v.toFixed(2));
check(SEC2B, '스파이크만 — OVR', spike.mean, 74.2, 0.7, v => v.toFixed(2));
check(SEC2B, '안전 — A 이상 비율', safe.A + safe.S, 0.97, 0.06, P);
check(SEC2B, '최적 — S 비율', optimal.S, 0.16, 0.06, P);
check(SEC2B, '최적 — 핵심 도달률', optimal.core, 0.82, 0.05, P);
check(SEC2B, '안전 — 핵심 도달률', safe.core, 0.66, 0.05, P);
check(SEC2B, '최적 − 안전 (도박 성립)', optimal.mean - safe.mean, 2.2, 0.8, v => v.toFixed(2));
check(SEC2B, '최적 − 랜덤 (실력 > 운)', optimal.mean - rand.mean, 5.2, 1.2, v => v.toFixed(2));
check(SEC2B, '안전 — 힌트', safe.hints, 6.7, 0.7, v => v.toFixed(2));
check(SEC2B, '최적 — 힌트', optimal.hints, 7.9, 0.7, v => v.toFixed(2));
check(SEC2B, '최적 — 핫존 훈련 수', optimal.hot, 2.9, 0.6, v => v.toFixed(2));
check(SEC2B, '최적 — 휴식 수', optimal.rests, 2.0, 0.5, v => v.toFixed(2));

// 서포터 효과(9절) — 풀세팅 3인, seed 4
const supFull = fullSupporters();
const optSup = runTrainingBatch(POLICIES.optimal, RUNS, 4, supFull);
const safeSup = runTrainingBatch(POLICIES.safe, RUNS, 4, supFull);
check(SEC2B, '최적+서포터 풀세팅 — OVR', optSup.mean, 79.52, 0.8, v => v.toFixed(2));
check(SEC2B, '최적+서포터 풀세팅 — S 비율', optSup.S, 0.49, 0.08, P);
check(SEC2B, '최적+서포터 풀세팅 — 핵심 도달률', optSup.core, 0.88, 0.05, P);
check(SEC2B, '안전+서포터 풀세팅 — S 비율', safeSup.S, 0.01, 0.03, P);

// ================================================================ 3. 결정성
const SEC3 = '결정성 (같은 시드 + 같은 입력 = 같은 결과)';
{
  const sig = (seed) => {
    const h = generateTeamState(mixSeed(seed, 0, 1), 'HOME', '홈', 67);
    const a = generateTeamState(mixSeed(seed, 0, 2), 'AWAY', '원정', 67);
    const r = simulateMatch(h, a, seed, null, false);
    return `${r.homeSets}:${r.awaySets}|${r.sets.map(s => s.home + '-' + s.away).join(',')}|${r.homeStats.kills},${r.awayStats.kills},${r.homeStats.aces},${r.awayStats.digs}`;
  };
  const s1 = sig(12345), s2 = sig(12345), s3 = sig(12346);
  must(SEC3, '경기 재현(동일 시드)', s1 === s2, esc(s1));
  must(SEC3, '경기 분리(다른 시드)', s1 !== s3);

  const tsig = (seed) => {
    const s = new TrainingSession(ssrOhCard(), emptySupport(TCFG), TCFG, stubEvaluationProvider, seed);
    const r = runWithPolicy(s, POLICIES.optimal);
    return r.instance.finalStats.join(',') + '|' + r.hints;
  };
  must(SEC3, '육성 재현(동일 시드)', tsig(999) === tsig(999));
  must(SEC3, '육성 분리(다른 시드)', tsig(999) !== tsig(1000));

  // 저장/복원 후에도 같은 결과
  const g1 = G.createGame({ seed: 4242, clubName: '테스트' });
  for (let i = 0; i < 5; i++) G.scout(g1);
  const before = G.playMatch(g1, 't02', { seed: 777, record: false, collectEvents: false });
  const g2 = G.loadGame(JSON.parse(JSON.stringify(G.saveGame(g1))));
  const after = G.playMatch(g2, 't02', { seed: 777, record: false, collectEvents: false });
  const same = before.sets.home === after.sets.home && before.sets.away === after.sets.away
    && JSON.stringify(before.setScores) === JSON.stringify(after.setScores);
  must(SEC3, '저장→복원 후 재현', same);
}

// ================================================================ 4. 규칙 불변식
const SEC4 = '규칙 불변식';
{
  const home = generateTeamState(mixSeed(1, 0, 1), 'HOME', '홈', 67);
  const away = generateTeamState(mixSeed(1, 0, 2), 'AWAY', '원정', 67);
  const r = simulateMatch(home, away, 31337, null, true);
  let setOk = true, finalOk = true;
  for (const s of r.sets) {
    const target = s.setIndex === 5 ? 15 : 25;
    const hi = Math.max(s.home, s.away), lo = Math.min(s.home, s.away);
    if (!(hi >= target && hi - lo >= 2)) setOk = false;
    if (s.setIndex === 5 && target !== 15) finalOk = false;
  }
  must(SEC4, '세트 종료 규칙(25/15·2점차)', setOk && finalOk);
  must(SEC4, '3선승 종료', r.homeSets === 3 || r.awaySets === 3);
  // 리베로가 블로킹/공격/서브를 하지 않는지 (엔진이 예외를 던지므로 여기선 이벤트로 재확인)
  const liberoIds = new Set([home.lineup.liberoId, away.lineup.liberoId]);
  let liberoViolation = 0;
  for (const e of r.events) {
    if (!liberoIds.has(e.playerId)) continue;
    if (e.type === 6 /* Attack */ || e.type === 7 /* Block */) liberoViolation++;
    if (e.type === 3 /* Serve */) liberoViolation++;
  }
  must(SEC4, '리베로 서브·공격·블로킹 없음', liberoViolation === 0, `위반 ${liberoViolation}건`);
  info(SEC4, '경기당 이벤트 수', String(r.eventCount));
  const lines = renderCommentary(r.events, {
    players: [...home.roster, ...away.roster].map(p => ({ id: p.id, name: p.name, jersey: p.jersey })),
    homeName: home.team.name, awayName: away.team.name,
  });
  must(SEC4, '중계 렌더러 출력', lines.length > 100, `${lines.length}줄`);
  // 조사 이/가 처리
  const { ga } = await import('./engine/commentary.js');
  must(SEC4, '조사 이/가 (받침 O/X)', ga('채보름') === '채보름이' && ga('하담희') === '하담희가', '채보름이 / 하담희가');
}

// ================================================================ 5. 의도적 차이 2건
const SEC5 = '의도적 차이 (PARITY.md 참조)';
{
  const g = G.createGame({ seed: 11 });
  const clubOvrs = (growth) => G.CLUBS.map(c => {
    const ts = G.clubTeamState(g, c.id, growth === undefined ? {} : { growth });
    let s = 0, n = 0;
    for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
      const p = ts.index.get(id);
      if (!p) continue;
      s += ovrOf(TCFG, p.stats, p.pos); n++;
    }
    return s / n;
  });
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

  // ①-a 성장 수식 오라클: g 를 문서 값으로 고정하면 A.3.1 표를 그대로 재현해야 한다.
  //     (사다리 상수 SEASON_GROWTH 의 튜닝과 무관하게 수식 자체를 검증한다)
  const o35 = clubOvrs(0.35), o58 = clubOvrs(0.58), o80 = clubOvrs(0.80);
  check(SEC5, '①-a 성장 수식 g=35% — 평균 OVR (문서 A.3.1)', mean(o35), 65.3, 0.5, v => v.toFixed(2));
  check(SEC5, '①-a 성장 수식 g=35% — 최약', Math.min(...o35), 62.9, 0.5, v => v.toFixed(2));
  check(SEC5, '①-a 성장 수식 g=35% — 최강', Math.max(...o35), 67.0, 0.5, v => v.toFixed(2));
  check(SEC5, '①-a 성장 수식 g=58% — 평균 OVR (문서 A.3.1 시즌 3)', mean(o58), 70.2, 0.5, v => v.toFixed(2));
  check(SEC5, '①-a 성장 수식 g=80%(상한) — 평균 OVR (문서 A.3.1 시즌 7+)', mean(o80), 74.9, 0.5, v => v.toFixed(2));

  // ①-b 실제 사다리(SEASON_GROWTH): 시즌 1 = 52%. 문서 초기값 35% 에서 재캘리브레이션한 값이다.
  //     근거·변경 전후는 PARITY.md "6. 리그 시즌 계층" 절, 재측정은 web/season-check.mjs.
  const ladder = clubOvrs();
  must(SEC5, '①-b 시즌 1 사다리 g = 52% (문서 초기값 35% 에서 튜닝)', G.growthFor(1) === 0.52, `g=${G.growthFor(1)}`);
  check(SEC5, '①-b 시즌 1 AI 구단 평균 OVR', mean(ladder), 68.7, 0.5, v => v.toFixed(2));
  check(SEC5, '①-b 시즌 1 AI 구단 최약', Math.min(...ladder), 66.6, 0.5, v => v.toFixed(2));
  check(SEC5, '①-b 시즌 1 AI 구단 최강', Math.max(...ladder), 70.3, 0.5, v => v.toFixed(2));

  // ② 졸업시킨 선수는 원소속 구단에서 빠지고 대체 선수가 들어간다
  const card = G.CARD_POOL.find(p => p.teamId === 't05' && p.rarity === RARITY.SSR);
  const before = G.clubTeamState(g, 't05').roster.some(p => p.id === card.id);
  const s = G.startTraining(g, card.id, []);
  while (s.phase !== 2) {
    if (s.phase === 0) s.apply(POLICIES.safe.choose(s));
    else s.resolveEvent(s.pendingEvent.oracleChoice);
  }
  G.graduate(s, 0);
  const clubAfter = G.clubTeamState(g, 't05');
  const stillThere = clubAfter.roster.some(p => p.id === card.id);
  const subs = clubAfter.roster.filter(p => p.isSubstitute).length;
  must(SEC5, '② 졸업생 원소속 이탈', before && !stillThere, `${card.name}(t05)`);
  must(SEC5, '② 결원 = 대체 선수 1명', subs === 1, `대체 ${subs}명`);
  must(SEC5, '② 구단 인원 7명 유지', clubAfter.roster.length === 7, `${clubAfter.roster.length}명`);

  // ③ 노화·전성기·은퇴 (league-and-economy.md A.3.6 · v0.3). C# 프로토타입에는 없는 계층이다.
  const g3 = G.createGame({ seed: 12 });
  const POSN = { S: 0, OH: 1, OP: 2, MB: 3, L: 4 };
  // 나이는 저장하지 않고 파생한다 — 카드 나이 + (시즌 − 1)
  must(SEC5, '③ 나이 = 카드 나이 + (시즌 − 1)',
    G.ageAt(20, 1) === 20 && G.ageAt(20, 6) === 25, 'ageAt(20, 6) = 25');
  // 하락 곡선: 전성기 안에서는 1.0, 첫 해 −7%, 이후 매년 −1.5%p
  must(SEC5, '③ 전성기 안에서는 배수 1.0', G.ageFactor(25, POSN.MB, 1) === 1, 'age 25 MB');
  check(SEC5, '③ 하락 첫 해 배수 (MB 26세)', G.ageFactor(26, POSN.MB, 1), 0.93, 0.001, v => v.toFixed(3));
  check(SEC5, '③ 하락 4년째 배수 (MB 29세)', G.ageFactor(29, POSN.MB, 1), 0.915, 0.001, v => v.toFixed(3));
  must(SEC5, '③ 세터·리베로는 전성기 +2년 (27세까지 배수 1.0)',
    G.ageFactor(27, POSN.S, 1) === 1 && G.ageFactor(27, POSN.L, 1) === 1 && G.ageFactor(27, POSN.MB, 1) < 1);
  // 시즌 1~3 에는 은퇴자가 없다 — 시즌 1 에 뽑아 키운 선수가 최소 3시즌 주전으로 뛴다(A.3.6 초반 보호)
  let ret13 = 0;
  for (let n = 1; n <= 3; n++) { g3.season = n; ret13 += G.CARD_POOL.length - G.activeCardPool(g3).length; }
  g3.season = 1;
  must(SEC5, '③ 시즌 1~3 에 은퇴 선수 없음', ret13 === 0, `은퇴 ${ret13}명`);
  // 세대교체: 결원이 없으면 구단 평균 OVR 은 사다리 상한(74.9)에 고정된다 — 노화가 벽을 무너뜨리지 않는다
  const ladderAt = (n) => {
    g3.season = n;
    const v = G.CLUBS.map(c => {
      const ts = G.clubTeamState(g3, c.id);
      let sum = 0, k = 0;
      for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
        const pl = ts.index.get(id);
        if (!pl) continue;
        sum += ovrOf(TCFG, pl.stats, pl.pos); k++;
      }
      return sum / k;
    });
    return { ovr: v.reduce((a, b) => a + b, 0) / v.length, size: G.clubTeamState(g3, 't01').roster.length };
  };
  const L8 = ladderAt(8), L12 = ladderAt(12);
  g3.season = 1;
  check(SEC5, '③ 세대교체 후에도 사다리 유지 — 시즌 8 AI 평균 OVR', L8.ovr, 74.91, 0.30, v => v.toFixed(2));
  check(SEC5, '③ 세대교체 후에도 사다리 유지 — 시즌 12 AI 평균 OVR', L12.ovr, 74.91, 0.30, v => v.toFixed(2));
  must(SEC5, '③ 세대교체해도 구단 인원 7명 유지', L8.size === 7 && L12.size === 7, `${L8.size}/${L12.size}명`);
}

// ================================================================ 6. 성능·용량 (모바일 예산)
const SEC6 = '성능 · 저장 용량';
{
  const g = G.createGame({ seed: 5 });
  for (let i = 0; i < 5; i++) G.scout(g);
  // 워밍업
  for (let i = 0; i < 20; i++) G.playMatch(g, 't01', { seed: i, record: false });
  let t0 = performance.now(), ev = 0;
  const N = 200;
  for (let i = 0; i < N; i++) { const m = G.playMatch(g, 't01', { seed: 5000 + i, record: false }); ev += m.eventCount; }
  const withEvents = (performance.now() - t0) / N;
  t0 = performance.now();
  for (let i = 0; i < N; i++) G.playMatch(g, 't01', { seed: 5000 + i, record: false, collectEvents: false });
  const noEvents = (performance.now() - t0) / N;
  budget(SEC6, '경기 1회(이벤트 포함)', withEvents, 100, v => v.toFixed(2) + 'ms', 'Node 22 / x86. 목표 100ms 는 중급 스마트폰 기준');
  info(SEC6, '경기 1회(이벤트 없음)', noEvents.toFixed(2) + 'ms');
  info(SEC6, '경기당 이벤트 수', (ev / N).toFixed(0) + '개');

  // 육성 12턴 자동 진행 1회(실제 시뮬 평가전 3경기 포함)
  const gg = G.createGame({ seed: 6 });
  for (let i = 0; i < 3; i++) G.scout(gg);
  const cid = Object.keys(gg.ownedCards)[0];
  t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    const s = G.startTraining(gg, cid, []);
    while (s.phase !== 2) {
      if (s.phase === 0) s.apply(POLICIES.optimal.choose(s));
      else s.resolveEvent(s.pendingEvent.oracleChoice);
    }
  }
  info(SEC6, '육성 12턴 1회(실제 평가전 3경기)', ((performance.now() - t0) / 20).toFixed(2) + 'ms');

  // 저장 크기
  const heavy = G.createGame({ seed: 9 });
  heavy.unlimitedTickets = true;
  for (let i = 0; i < 40; i++) {
    G.scout(heavy);
    const id = Object.keys(heavy.ownedCards)[i % Object.keys(heavy.ownedCards).length];
    const s = G.startTraining(heavy, id, G.recommendSupporters(heavy, id));
    while (s.phase !== 2) {
      if (s.phase === 0) s.apply(POLICIES.safe.choose(s));
      else s.resolveEvent(s.pendingEvent.oracleChoice);
    }
    G.graduate(s, 1);
    G.playMatch(heavy, 't0' + (1 + (i % 6)), { collectEvents: false });
  }
  const bytes = JSON.stringify(G.saveGame(heavy)).length;
  budget(SEC6, '저장 JSON 크기(육성 40회·경기 40회)', bytes / 1024, 50, v => v.toFixed(1) + 'KB', 'localStorage 예산');
}

// ================================================================ 7. 스킬 (docs/skills.md)
// 스킬은 "있으면 확실히 유리하지만 능력치를 뒤집지는 않는" 수준이어야 한다.
// 동일 능력치(overall 67) 두 팀 중 한쪽 선수에게만 스킬을 주고 승률 상승폭을 잰다.
// 홈/원정을 뒤집어 두 번 돌려 홈 선서브 편향을 상쇄한다 → 한 조건당 경기 수 = pairs × 2.
const SEC7 = `스킬 (동일 능력치 · 한쪽만 보유 · 조건당 ${SKILL_PAIRS * 2}경기, 홈·원정 교대)`;
{
  // 라인업 슬롯: 0=S 1=OH1 2=MB1 3=OP 4=OH2 5=MB2 (+ 리베로). domain.js standard51
  const SLOT = { [POS.S]: [0], [POS.OH]: [1, 4], [POS.OP]: [3], [POS.MB]: [2, 5] };
  function applySkills(ts, specs) {
    const used = {};
    for (const sp of specs) {
      const nth = used[sp.pos] = (used[sp.pos] === undefined ? 0 : used[sp.pos] + 1);
      const id = sp.pos === POS.L ? ts.lineup.liberoId : ts.lineup.startingIds[SLOT[sp.pos][Math.min(nth, SLOT[sp.pos].length - 1)]];
      const p = ts.index.get(id);
      p.skillName = sp.name;
      p.skillLevel = sp.level;
    }
  }
  /** specs 를 가진 팀의 승률(사이드 상쇄). specs = [] 면 베이스라인. */
  function skillWinRate(specs, pairs = SKILL_PAIRS, seed = 42) {
    let wins = 0;
    for (let i = 0; i < pairs; i++) {
      for (let side = 0; side < 2; side++) {
        const home = generateTeamState(mixSeed(seed, i, 1), 'HOME', '홈', 67);
        const away = generateTeamState(mixSeed(seed, i, 2), 'AWAY', '원정', 67);
        if (specs.length) applySkills(side === 0 ? home : away, specs);
        const r = simulateMatch(home, away, mixSeed(seed, i, 7 + side), null, false);
        if (side === 0 ? r.winner === SIDE.HOME : r.winner === SIDE.AWAY) wins++;
      }
    }
    return wins / (pairs * 2);
  }
  const one = name => [{ pos: findSkill(name).pos, name, level: 0 }];
  const lvl = (specs, level) => specs.map(x => ({ ...x, level }));

  // --- 7.1 스킬이 없으면 판정이 완전히 그대로인가 (가장 중요한 안전장치) ---
  {
    const off = createSimConfig();
    off.skill.enabled = false;
    const sig = (cfg) => {
      const out = [];
      for (let i = 0; i < 40; i++) {
        const h = generateTeamState(mixSeed(7, i, 1), 'HOME', '홈', 67);
        const a = generateTeamState(mixSeed(7, i, 2), 'AWAY', '원정', 67);
        const r = simulateMatch(h, a, mixSeed(7, i, 3), cfg, false);
        out.push(`${r.homeSets}:${r.awaySets}|${r.sets.map(x => x.home + '-' + x.away).join(',')}|${r.homeStats.kills},${r.awayStats.blockKills},${r.homeStats.aces}`);
      }
      return out.join(';');
    };
    must(SEC7, '7.1 스킬 미보유 = 훅 이전과 동일한 판정', sig(null) === sig(off), '스킬 on/off 설정이 결과에 무영향');
    const h = generateTeamState(mixSeed(7, 0, 1), 'HOME', '홈', 67);
    const a = generateTeamState(mixSeed(7, 0, 2), 'AWAY', '원정', 67);
    must(SEC7, '7.1 활성 스킬 0명 → 런타임 null', createSkillRuntime(createSimConfig(), { side: 0, state: h, positionOf: () => 0 }, { side: 1, state: a, positionOf: () => 0 }) === null);
  }

  // --- 7.2 결정성 ---
  {
    const specs = lvl(one('스포트라이트'), 3);
    const sig = () => {
      const h = generateTeamState(mixSeed(9, 0, 1), 'HOME', '홈', 67);
      const a = generateTeamState(mixSeed(9, 0, 2), 'AWAY', '원정', 67);
      applySkills(h, specs);
      const r = simulateMatch(h, a, 24680, null, false);
      return `${r.homeSets}:${r.awaySets}|${r.homeStats.kills},${r.awayStats.digs}`;
    };
    must(SEC7, '7.2 스킬 보유 경기 재현(동일 시드)', sig() === sig(), esc(sig()));
  }

  // --- 7.3 승률 기여 목표 범위 (docs/skills.md 6절) ---
  const base = skillWinRate([]);
  const MID = '스포트라이트';                       // 기여도 중앙값 근처의 대표 SSR
  const SIX = ['한 수 앞', '스포트라이트', '학의 날개', '천둥 왼손', '설벽(雪壁)', '모루 위에서'];
  const sixSpecs = SIX.map(n => ({ pos: findSkill(n).pos, name: n, level: 0 }));
  const d1 = (skillWinRate(lvl(one(MID), 1)) - base) * 100;
  const d3 = (skillWinRate(lvl(one(MID), 3)) - base) * 100;
  const d6 = (skillWinRate(lvl(sixSpecs, 3)) - base) * 100;
  const se = Math.sqrt(0.5 / (SKILL_PAIRS * 2)) * 100;
  info(SEC7, '베이스라인(스킬 0) 승률', P(base), `표준오차 ±${se.toFixed(2)}%p`);
  must(SEC7, `7.3 SSR 1개 Lv1 = +1~3%p (${MID})`, d1 >= 1.0 && d1 <= 3.0, `+${d1.toFixed(2)}%p`);
  must(SEC7, `7.3 SSR 1개 Lv3 = +3~6%p (${MID})`, d3 >= 3.0 && d3 <= 6.0, `+${d3.toFixed(2)}%p`);
  must(SEC7, '7.3 SSR 6개 Lv3 = +10~18%p', d6 >= 10.0 && d6 <= 18.0, `+${d6.toFixed(2)}%p`);
  must(SEC7, '7.3 레벨 단조 증가(Lv1 < Lv3)', d1 < d3, `${d1.toFixed(2)} < ${d3.toFixed(2)}`);
  must(SEC7, '7.3 능력치를 뒤집지 않음(6개 Lv3 < 전원 +5 = 76%)', base + d6 / 100 < 0.76, P(base + d6 / 100));

  // --- 7.4 양 팀 모두 스킬을 가져도 리그 KPI 가 유지되는가 ---
  {
    const a = { receiveRallies: 0, receiveRalliesWon: 0, attacks: 0, kills: 0, serves: 0, aces: 0, serveErrors: 0, blocked: 0, points: 0, sets: 0 };
    const n = Math.max(300, Math.round(SKILL_PAIRS / 3));
    for (let i = 0; i < n; i++) {
      const home = generateTeamState(mixSeed(77, i, 1), 'HOME', '홈', 67);
      const away = generateTeamState(mixSeed(77, i, 2), 'AWAY', '원정', 67);
      applySkills(home, lvl(sixSpecs, 3));
      applySkills(away, lvl(sixSpecs, 3));
      const r = simulateMatch(home, away, mixSeed(77, i, 7), null, false);
      a.sets += r.sets.length;
      for (const s of r.sets) a.points += s.home + s.away;
      for (const s of [r.homeStats, r.awayStats]) {
        a.receiveRallies += s.receiveRallies; a.receiveRalliesWon += s.receiveRalliesWon;
        a.attacks += s.attacks; a.kills += s.kills; a.serves += s.serves;
        a.aces += s.aces; a.serveErrors += s.serveErrors; a.blocked += s.blocked;
      }
    }
    check(SEC7, '7.4 양 팀 6스킬 Lv3 — 사이드아웃', a.receiveRalliesWon / a.receiveRallies, 0.609, 0.025, P, '기본 ±1.5%p 보다 넓은 허용');
    check(SEC7, '7.4 양 팀 6스킬 Lv3 — kill%', a.kills / a.attacks, 0.423, 0.025, P);
    check(SEC7, '7.4 양 팀 6스킬 Lv3 — 에이스', a.aces / a.serves, 0.067, 0.015, P);
    check(SEC7, '7.4 양 팀 6스킬 Lv3 — 유효 블로킹', a.blocked / a.attacks, 0.102, 0.025, P);
    check(SEC7, '7.4 양 팀 6스킬 Lv3 — 세트당 득점', a.points / a.sets, 44.2, 2.0, v => v.toFixed(2));
  }

  // --- 7.5 스킬별 단독 기여 표(옵션) ---
  if (SKILL_TABLE) {
    for (const def of SKILLS) {
      const s1 = (skillWinRate([{ pos: def.pos, name: def.name, level: 1 }]) - base) * 100;
      const s3 = (skillWinRate([{ pos: def.pos, name: def.name, level: 3 }]) - base) * 100;
      info(SEC7 + ` — 스킬별 단독 기여 (SE ±${se.toFixed(2)}%p)`, `${def.rarity} ${def.name}`, `Lv1 ${s1 >= 0 ? '+' : ''}${s1.toFixed(2)}%p · Lv3 ${s3 >= 0 ? '+' : ''}${s3.toFixed(2)}%p`, se > 0.8 ? '표본 부족 — --skill 6000 권장' : '');
    }
  }
}

// ================================================================ 8. 신인 세대 생성기 (docs/rookies.md)
// 생성기는 "규칙을 코드로" 옮긴 것이므로, 검증도 규칙 그대로다 —
// world.md 6절(이름·외형·번호)·6.3 체크리스트(스탯·신장·나이·스킬)·A.3.6.4(사다리 유지)·C.4(결정성).
const SEC8 = '신인 세대 생성기 (docs/rookies.md)';
{
  const { HAIR_COLORS_VIVID, launchLevel } = await import('./engine/rookies.js');
  const HORIZON = 20;                       // 검증 지평 — 시즌 15 목표보다 넉넉히 본다
  const mk = (seed, season) => { const g = G.createGame({ seed }); g.season = season; return g; };

  // --- 8.1 결정성 (C.4) ---
  const sig = (g, n) => G.rookieCards(g, n)
    .map(c => `${c.id}|${c.name}|${c.teamId}|${c.pos}|${c.rarity}|${c.jersey}|${c.heightCm}|${c.age}|${c.stats.join(',')}|${c.potential.join(',')}|${c.skillName}|${c.appearance.hairStyle}/${c.appearance.hairColor}`)
    .join('\n');
  const A = sig(mk(20260904, HORIZON), HORIZON);
  must(SEC8, '8.1 결정성 — 같은 시드 = 같은 세대', A === sig(mk(20260904, HORIZON), HORIZON));
  must(SEC8, '8.1 결정성 — 다른 시드 = 다른 세대', A !== sig(mk(20260905, HORIZON), HORIZON));
  {   // 시즌을 하나씩 올려도(= 실제 플레이 순서) 한 번에 쌓은 것과 같아야 한다
    const g = G.createGame({ seed: 20260904 });
    for (let n = 1; n <= HORIZON; n++) { g.season = n; G.activeCardPool(g); }
    must(SEC8, '8.1 결정성 — 시즌을 하나씩 올려도 동일(캐시 단조성)', sig(g, HORIZON) === A);
  }
  {   // 세이브에 카드를 넣지 않는다 → 재로드해도 같은 세대
    const g = mk(20260904, 12);
    const saved = JSON.parse(JSON.stringify(G.saveGame(g)));
    const json = JSON.stringify(saved);
    must(SEC8, '8.1 세이브에 신인 카드를 저장하지 않는다', json.indexOf('"r0') < 0 && json.indexOf('r0401') < 0);
    must(SEC8, '8.1 세이브 재로드 후 같은 세대 재현', sig(G.loadGame(saved), 12) === sig(g, 12));
  }
  must(SEC8, '8.1 시즌 1~3 은 손대지 않는다(초반 보호)',
    G.rookieCards(mk(1, 3), 3).length === 0 && G.activeCardPool(mk(1, 3)).length === G.LAUNCH_CARDS.length);

  // --- 8.2 유일성 (world.md 6.1 · 6.2 · art-style-guide 1.3) ---
  // 외형은 미리 그린 풀(ROOKIE_LOOKS, docs/art-pipeline.md 15절)에서 고르므로 **풀이 활동 신인 수를 덮는 동안**
  // 자유 조합 때의 규칙(조합 유일·구단 내 컬러 유일·파스텔 상한)이 그대로 성립해야 하고, 풀이 바닥난 뒤에는
  // "같은 구단 안에서는 같은 그림이 없다"만 남는다. 풀 크기 60 은 시즌 15(장기 목표 지평)까지를 덮는다.
  const { ROOKIE_LOOKS } = await import('./engine/rookies.js');
  const LOOK_IDS = new Set(ROOKIE_LOOKS.map(l => l.id));
  let dupName = 0, dupSurnameInClub = 0, dupHair = 0, dupColorInClub = 0, vividOver = 0, dupJersey = 0;
  let noLook = 0, dupLookInClub = 0, poolOutAt = Infinity, poolSeasons = 0;
  for (const seed of [1, 7, 42, 20260904]) {
    const g = mk(seed, HORIZON);
    const jerseyEver = new Map();          // 구단별 등번호는 역대 전체에서 유일해야 한다
    for (const c of G.allCards(g, HORIZON)) {
      const k = c.teamId;
      if (!jerseyEver.has(k)) jerseyEver.set(k, new Set());
      if (jerseyEver.get(k).has(c.jersey)) dupJersey++;
      jerseyEver.get(k).add(c.jersey);
    }
    for (let n = 1; n <= HORIZON; n++) {   // 나머지는 "그 시즌에 살아 있는 카드" 기준
      g.season = n;
      const active = G.activeCardPool(g);
      const rookiesActive = active.filter(c => G.isRookieCard(c)).length;
      const poolOk = rookiesActive <= ROOKIE_LOOKS.length;    // 풀이 덮는 동안만 자유 조합 규칙을 요구한다
      if (!poolOk && n < poolOutAt) poolOutAt = n;
      if (poolOk) poolSeasons++;
      const names = new Set(), hair = new Set();
      const clubSur = new Map(), clubColor = new Map(), clubVivid = new Map(), clubLook = new Map();
      for (const c of active) {
        if (names.has(c.name)) dupName++;
        names.add(c.name);
        const a = c.appearance || {};
        const combo = a.hairStyle + '|' + a.hairColor;
        if (poolOk && hair.has(combo)) dupHair++;
        hair.add(combo);
        const sur = c.name.slice(0, 1);
        if (!clubSur.has(c.teamId)) { clubSur.set(c.teamId, new Set()); clubColor.set(c.teamId, new Set()); clubVivid.set(c.teamId, 0); clubLook.set(c.teamId, new Set()); }
        if (clubSur.get(c.teamId).has(sur)) dupSurnameInClub++;
        clubSur.get(c.teamId).add(sur);
        if (poolOk && clubColor.get(c.teamId).has(a.hairColor)) dupColorInClub++;
        clubColor.get(c.teamId).add(a.hairColor);
        if (HAIR_COLORS_VIVID.indexOf(a.hairColor) >= 0) clubVivid.set(c.teamId, clubVivid.get(c.teamId) + 1);
        if (G.isRookieCard(c)) {
          if (!c.look || !LOOK_IDS.has(c.look)) noLook++;
          else { if (clubLook.get(c.teamId).has(c.look)) dupLookInClub++; clubLook.get(c.teamId).add(c.look); }
        }
      }
      if (poolOk) for (const v of clubVivid.values()) if (v > G.ROOKIES.vividPerClub) vividOver++;
    }
  }
  must(SEC8, '8.2 이름 중복 0 (활성 카드 전체 · 시드 4종 × 20시즌)', dupName === 0, `중복 ${dupName}`);
  must(SEC8, '8.2 구단 내 성 중복 0', dupSurnameInClub === 0, `중복 ${dupSurnameInClub}`);
  must(SEC8, `8.2 헤어스타일+컬러 조합 중복 0 (외형 풀 ${ROOKIE_LOOKS.length}종이 덮는 시즌)`, dupHair === 0, `중복 ${dupHair}`);
  must(SEC8, '8.2 구단 내 헤어 컬러 중복 0 (같은 범위)', dupColorInClub === 0, `중복 ${dupColorInClub}`);
  must(SEC8, `8.2 파스텔·원색 헤어 구단당 ≤ ${G.ROOKIES.vividPerClub} (같은 범위)`, vividOver === 0, `초과 ${vividOver}`);
  must(SEC8, '8.2 신인 전원이 외형 풀의 그림(look)을 가리킨다', noLook === 0, `없음 ${noLook}`);
  must(SEC8, '8.2 같은 구단 안에 같은 그림 0 (풀 소진 뒤에도 · 20시즌)', dupLookInClub === 0, `중복 ${dupLookInClub}`);
  must(SEC8, '8.2 외형 풀이 시즌 15(장기 목표 지평)까지 활동 신인을 덮는다', poolOutAt > 15, `소진 시즌 ${poolOutAt === Infinity ? '없음' : 'S' + poolOutAt}`);
  info(SEC8, '8.2 외형 풀 소진 시점 (시드 4종 × 20시즌)', poolOutAt === Infinity ? '20시즌 안에 소진 없음' : `S${poolOutAt} 부터 다른 구단끼리 같은 그림이 생긴다`);
  must(SEC8, '8.2 구단 내 등번호 중복 0 (역대 전체)', dupJersey === 0, `중복 ${dupJersey}`);

  // --- 8.3 스탯·신장·나이 범위 (world.md 6.3 체크리스트) ---
  const HEIGHT_RANGE = [[172, 180], [175, 185], [178, 188], [182, 192], [165, 172]];
  let statOut = 0, potOut = 0, deltaOut = 0, hOut = 0, ageOut = 0, liberoOut = 0, strongerThanLaunch = 0, n8 = 0;
  const byRarity = { 1: [], 2: [], 3: [] };
  for (const seed of [1, 7, 42, 20260904]) {
    for (const c of G.rookieCards(mk(seed, HORIZON), HORIZON)) {
      n8++;
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        const v = c.stats[i], q = c.potential[i];
        if (v < G.ROOKIES.statMin || v > G.ROOKIES.statMax) statOut++;
        if (q > 100 || q < v) potOut++;
        const d = q - v;
        if (d < G.ROOKIES.potDeltaMin || d > G.ROOKIES.potDeltaMax) deltaOut++;
        sum += v;
      }
      const avg = sum / 10;
      byRarity[c.rarity].push(avg);
      if (avg > launchLevel(c.rarity, c.pos)) strongerThanLaunch++;
      const hr = HEIGHT_RANGE[c.pos];
      if (c.heightCm < hr[0] || c.heightCm > hr[1]) hOut++;
      if (c.debutAge < 18 || c.debutAge > 20) ageOut++;
      if (c.pos === POS.L && (c.stats[STAT.spike] > 30 || c.stats[STAT.block] > 30)) liberoOut++;
    }
  }
  must(SEC8, `8.3 개별 스탯 ${G.ROOKIES.statMin}~${G.ROOKIES.statMax} 이탈 0 (신인 ${n8}장)`, statOut === 0, `이탈 ${statOut}`);
  must(SEC8, '8.3 잠재력 = 초기치 + 15~30 · ≤ 100 이탈 0', deltaOut === 0 && potOut === 0, `Δ ${deltaOut} · 상한 ${potOut}`);
  must(SEC8, '8.3 신인 스탯 평균이 같은 (희귀도·포지션) 런칭 평균을 넘지 않는다', strongerThanLaunch === 0, `초과 ${strongerThanLaunch}`);
  must(SEC8, '8.3 포지션별 신장 범위 이탈 0 (world.md 6.3)', hOut === 0, `이탈 ${hOut}`);
  must(SEC8, '8.3 데뷔 나이 18~20 이탈 0', ageOut === 0, `이탈 ${ageOut}`);
  must(SEC8, '8.3 리베로 spike·block ≤ 30 이탈 0', liberoOut === 0, `이탈 ${liberoOut}`);
  const meanOf = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  info(SEC8, '8.3 신인 스탯 평균 (R / SR / SSR)',
    `${meanOf(byRarity[1]).toFixed(1)} / ${meanOf(byRarity[2]).toFixed(1)} / ${meanOf(byRarity[3]).toFixed(1)}`,
    '런칭 45.7 / 54.8 / 63.6');

  // --- 8.4 스킬 배정 (docs/skills.md 재사용 — 새 스킬을 만들지 않는다) ---
  let skillBad = 0, rNoSkill = 0, srSsr = 0;
  for (const seed of [1, 7, 42, 20260904]) {
    for (const c of G.rookieCards(mk(seed, HORIZON), HORIZON)) {
      if (c.rarity === RARITY.R || c.rarity === RARITY.N) { if (c.skillName) rNoSkill++; continue; }
      srSsr++;
      const def = findSkill(c.skillName);
      const want = c.rarity === RARITY.SSR ? 'SSR' : 'SR';
      if (!def || def.pos !== c.pos || def.rarity !== want) skillBad++;
    }
  }
  must(SEC8, `8.4 SSR·SR 은 기존 레지스트리의 같은 (희귀도·포지션) 스킬만 쓴다 (${srSsr}장)`, skillBad === 0, `불일치 ${skillBad}`);
  must(SEC8, '8.4 R 카드는 스킬 없음', rNoSkill === 0, `보유 ${rNoSkill}`);
  must(SEC8, '8.4 새 스킬을 만들지 않았다 (레지스트리 24종 유지)', SKILLS.length === 24, `${SKILLS.length}종`);

  // --- 8.5 카드 풀이 마르지 않는다 (A.3.6.6 의 해답) ---
  let poolMin = Infinity, poolMinAt = 0;
  const poolRow = [];
  for (const seed of [1, 7, 42, 20260904]) {
    const g = G.createGame({ seed });
    for (let n = 1; n <= HORIZON; n++) {
      g.season = n;
      const k = G.activeCardPool(g).length;
      if (n >= 4 && k < poolMin) { poolMin = k; poolMinAt = n; }
      if (seed === 1) poolRow.push(k);
    }
  }
  must(SEC8, '8.5 시즌 4~20 스카우트 가능 카드 ≥ 40 (시드 4종)', poolMin >= 40, `최솟값 ${poolMin}장 (S${poolMinAt})`);
  info(SEC8, '8.5 카드 풀 추이 (seed 1 · 시즌 1~20)', poolRow.join(' '));

  // --- 8.6 사다리와 구단 로스터가 흔들리지 않는다 (A.3.1 · A.3.6.4) ---
  {
    const g = G.createGame({ seed: 12 });
    const ladderAt = (n) => {
      g.season = n;
      let sum = 0, k = 0, size = 0, heirs = 0;
      for (const c of G.CLUBS) {
        const ts = G.clubTeamState(g, c.id);
        size += ts.roster.length;
        heirs += ts.roster.filter(x => x.isRookieHeir).length;
        for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
          const pl = ts.index.get(id);
          if (!pl) continue;
          sum += ovrOf(TCFG, pl.stats, pl.pos); k++;
        }
      }
      return { ovr: sum / k, size, heirs };
    };
    const L8 = ladderAt(8), L12 = ladderAt(12), L15 = ladderAt(15);
    check(SEC8, '8.6 신인 승계 후에도 사다리 유지 — 시즌 8 AI 평균 OVR', L8.ovr, 74.91, 0.30, v => v.toFixed(2));
    check(SEC8, '8.6 신인 승계 후에도 사다리 유지 — 시즌 12 AI 평균 OVR', L12.ovr, 74.91, 0.30, v => v.toFixed(2));
    check(SEC8, '8.6 신인 승계 후에도 사다리 유지 — 시즌 15 AI 평균 OVR', L15.ovr, 74.91, 0.30, v => v.toFixed(2));
    must(SEC8, '8.6 구단 인원 42명(6×7) 유지', L8.size === 42 && L12.size === 42 && L15.size === 42, `${L8.size}/${L12.size}/${L15.size}`);
    info(SEC8, '8.6 신인이 채운 구단 슬롯 (S8 / S12 / S15)', `${L8.heirs} / ${L12.heirs} / ${L15.heirs} (42중)`);
  }
}

// ================================================================ 9. 골드 소비처 (league-and-economy.md B.6)
// 이 절의 존재 이유 하나: **골드로 산 것이 전력을 바꾸지 않는다**는 것을 기계로 못박는 것.
// 바꾸는 순간 A.4.4 의 사다리 밴드(시즌 4~15 우승률)가 재캘리브레이션 대상이 된다.
const SEC9 = '골드 소비처 (B.6 시설·운영비·리포트)';
{
  // --- 9.1 가격표·등급 상한 ---
  let priceOk = true, lenOk = true;
  for (const t of F.FACILITY.tracks) {
    if (t.prices.length !== F.FACILITY.maxLevel) lenOk = false;
    for (let i = 1; i < t.prices.length; i++) if (t.prices[i] <= t.prices[i - 1]) priceOk = false;
  }
  must(SEC9, '9.1 시설 가격표가 단계마다 오른다 · 길이 = maxLevel', priceOk && lenOk,
    F.FACILITY.tracks.map(t => `${t.name} ${t.prices.join('/')}`).join(' · '));
  {
    const g = G.createGame({ seed: 5001 });
    g.gold = 1e7;
    let spent = 0;
    for (const t of F.FACILITY.tracks) {
      for (let i = 0; i < F.FACILITY.maxLevel; i++) spent += F.upgradeFacility(g, t.id).price;
      let capped = false;
      try { F.upgradeFacility(g, t.id); } catch (e) { capped = true; }
      must(SEC9, `9.1 ${t.name} 은 ${F.FACILITY.maxLevel}단계가 상한`, capped && F.facilityLevel(g, t.id) === 5);
    }
    const total = F.FACILITY.tracks.reduce((a, t) => a + t.prices.reduce((x, y) => x + y, 0), 0);
    must(SEC9, '9.1 만렙 총투자 = 가격표 합', spent === total, `${spent.toLocaleString()}골드`);
    must(SEC9, '9.1 만렙 명성 = 15 (전통의 명문)', F.clubPrestige(g).total === 15 && F.clubPrestige(g).name === '전통의 명문');
  }

  // --- 9.2 초반 잠금: 초기 골드로는 아무 시설도 못 사고, 지정 스카우트는 살 수 있다 (B.6.4) ---
  {
    const g = G.createGame({ seed: 5002 });
    const cheapest = Math.min(...F.FACILITY.tracks.map(t => t.prices[0]));
    must(SEC9, '9.2 초기 골드 1,200 = 지정 스카우트 1회 · 시설은 0단계',
      g.gold === G.ECONOMY.positionScoutGold && g.gold < cheapest,
      `초기 ${g.gold} · 최저가 시설 ${cheapest}`);
    must(SEC9, '9.2 예비비 > 시즌 1~3 잔액대(8.7k~10.4k) → 초반에는 소비처가 잠긴다',
      F.FACILITY.reserveGold > 10400, `예비비 ${F.FACILITY.reserveGold}`);
  }

  // --- 9.3 결정성: 시설·리포트는 RNG 를 쓰지 않는다 ---
  {
    const g = G.createGame({ seed: 5003 });
    g.gold = 1e6;
    const si0 = g.seedIndex;
    for (const t of F.FACILITY.tracks) F.upgradeFacility(g, t.id);
    for (const c of G.CARD_POOL.slice(0, 10)) F.buyScoutReport(g, c.id);
    F.payUpkeep(g);
    must(SEC9, '9.3 시설·리포트·운영비가 시드를 소비하지 않는다 (seedIndex 불변)', g.seedIndex === si0, `si ${si0} → ${g.seedIndex}`);
  }

  // --- 9.4 전력 불변식 (핵심) ---
  // 같은 시드로 ① 아무것도 안 산 게임 ② 시설 만렙 + 리포트 30장을 산 게임을 만들고,
  // 같은 순서로 스카우트 20회 · 육성 1회 · 경기 1회를 돌려 **모든 결과가 같은지** 본다.
  {
    const run = (sink) => {
      const g = G.createGame({ seed: 20260904, unlimitedTickets: true, evaluation: 'stub' });
      g.gold = 500000;
      if (sink) {
        for (const t of F.FACILITY.tracks) for (let i = 0; i < F.FACILITY.maxLevel; i++) F.upgradeFacility(g, t.id);
        for (const c of G.CARD_POOL.slice(0, 30)) F.buyScoutReport(g, c.id);
      }
      const picks = [];
      for (let i = 0; i < 20; i++) picks.push(G.scout(g).card.id);
      const s = G.startTraining(g, picks[0], G.recommendSupporters(g, picks[0]));
      while (s.phase !== 2) {
        if (s.phase === 0) s.apply(POLICIES.optimal.choose(s));
        else s.resolveEvent(s.pendingEvent.oracleChoice);
      }
      const grad = G.graduate(s, 0);
      G.autoLineup(g);
      const m = G.playMatch(g, 't03', { collectEvents: false });
      return JSON.stringify({
        picks, ovr: grad.ovr, hints: grad.hints, skill: grad.skillLevel,
        sets: m.setScores, won: m.won, si: g.seedIndex,
      });
    };
    const plain = run(false), rich = run(true);
    must(SEC9, '9.4 **시설·리포트를 사도 스카우트·육성·경기 결과가 한 글자도 바뀌지 않는다**', plain === rich,
      plain === rich ? '동일' : '차이 발생');
  }

  // --- 9.5 운영비 공식 (B.6.3) ---
  {
    const g = G.createGame({ seed: 5005 });
    g.gold = 1e6;
    g.season = 8;   // 신인 세대가 들어와 카드 풀이 42장을 넘는 시점 (docs/rookies.md)
    F.upgradeFacility(g, 'analysis'); F.upgradeFacility(g, 'stadium');
    // 계약 선수를 무료 슬롯 + 5명으로 만든다
    const pool = G.activeCardPool(g).slice(0, F.FACILITY.squadFreeSlots + 5);
    for (const c of pool) g.ownedCards[c.id] = 0;
    const u = F.facilityUpkeep(g);
    const want = 2 * F.FACILITY.upkeepPerLevel + 5 * F.FACILITY.squadUpkeepPerPlayer;
    must(SEC9, '9.5 운영비 = 시설 등급합 × 400 + (계약 − 42) × 200', u.total === want && u.over === 5,
      `${u.facility} + ${u.squad} = ${u.total}`);
    const before = g.gold;
    const paid = F.payUpkeep(g);
    must(SEC9, '9.5 결산에서 운영비만큼 차감', g.gold === before - want && paid.shortfall === 0);
  }
  {
    const g = G.createGame({ seed: 5006 });
    g.gold = 1e6;
    F.upgradeFacility(g, 'hall'); F.upgradeFacility(g, 'hall'); F.upgradeFacility(g, 'analysis');
    g.gold = 10;
    const r = F.payUpkeep(g);
    must(SEC9, '9.5 미납 = 있는 만큼 내고 최고 등급 시설 1단계 강등',
      g.gold === 0 && r.shortfall === 1190 && r.demoted === 'hall' && F.facilityLevel(g, 'hall') === 1,
      `미납 ${r.shortfall} · 강등 ${r.demoted}`);
  }

  // --- 9.6 스카우트 리포트 = 카드 데이터의 순수 함수 (B.6.2) ---
  {
    const g = G.createGame({ seed: 5007 });
    g.gold = 1e6;
    const card = G.CARD_POOL.find(c => c.rarity === RARITY.SSR);
    const r1 = F.buyScoutReport(g, card.id);
    const r2 = F.scoutReport(g, card.id);
    must(SEC9, '9.6 같은 상태 → 같은 리포트(순수 함수)', JSON.stringify(r1) === JSON.stringify(r2));
    must(SEC9, '9.6 잠재 OVR ≥ 현재 OVR · 10스탯 전부 실림',
      r1.ovrPotential >= r1.ovrNow && r1.stats.length === 10 && r1.aptitudes.length === 5,
      `${r1.name} ${r1.ovrNow} → ${r1.ovrPotential}`);
    // 한계돌파가 오르면 리포트의 "돌파 반영 천장"도 오른다(표시값이지 전력이 아니다)
    g.ownedCards[card.id] = 5;
    const r3 = F.scoutReport(g, card.id);
    must(SEC9, '9.6 한계돌파 5단계 반영 천장이 더 높다', r3.ovrPotentialLb > r3.ovrPotential,
      `${r3.ovrPotential} → ${r3.ovrPotentialLb}`);
    must(SEC9, '9.6 안 산 카드의 리포트는 null', F.scoutReport(g, G.CARD_POOL[41].id) === null);
  }
}

// ================================================================ 출력
const totalMs = M.ms + safe.ms + optimal.ms + norest.ms + push.ms + rand.ms + spike.ms + optSup.ms + safeSup.ms;
if (AS_JSON) {
  console.log(JSON.stringify({ rows, failures }, null, 2));
} else {
  let cur = '';
  for (const r of rows) {
    if (r.section !== cur) {
      cur = r.section;
      console.log('\n### ' + cur);
      console.log('| 지표 | C# 기준 | JS 실측 | 허용 | 판정 |');
      console.log('|---|---|---|---|---|');
    }
    console.log(`| ${r.label}${r.note ? ` <sub>${r.note}</sub>` : ''} | ${r.csharp} | ${r.js} | ${r.tol} | ${r.verdict} |`);
  }
  console.log(`\n표본: 경기 ${MATCHES}회 / 육성 정책당 ${RUNS}회 (6정책 + 서포터 풀세팅 2)`);
  console.log(`시뮬 소요: ${(totalMs / 1000).toFixed(1)}s · 전체 실행: ${(performance.now() / 1000).toFixed(1)}s`);
  console.log(failures === 0 ? '\n결과: 전 항목 통과 ✅' : `\n결과: ${failures}개 항목 실패 ❌`);
}
process.exit(failures === 0 ? 0 : 1);
