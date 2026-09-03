// 정합(파리티) 검증 하네스 — `node web/parity.mjs`
// C# 기준값(docs/match-sim-balance-report.md v0.2, docs/training-mode.md 12.4절 · OracleTests)과
// JS 포팅의 집계 지표를 비교한다. 비트 단위 일치가 아니라 집계 일치가 목표.
//
// 옵션: --matches N (기본 2000)  --runs N (기본 2000)  --json

import { performance } from 'node:perf_hooks';
import { generateTeamState } from './engine/generator.js';
import { simulateMatch, totalPoints } from './engine/match.js';
import { mixSeed } from './engine/rng.js';
import { SIDE, POS, STAT, RARITY, makePlayer } from './engine/domain.js';
import {
  TrainingSession, POLICIES, runWithPolicy, emptySupport, buildSupport, stubEvaluationProvider,
} from './engine/training.js';
import { DEFAULT_TRAINING_CONFIG, gradeOf, ovrOf } from './engine/training-config.js';
import * as G from './engine/game.js';
import { renderCommentary } from './engine/commentary.js';

// ---------------------------------------------------------------- 인자
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? Number(argv[i + 1]) : def;
}
const MATCHES = arg('matches', 2000);
const RUNS = arg('runs', 2000);
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
  const ovrs = G.CLUBS.map(c => {
    const ts = G.clubTeamState(g, c.id);
    let s = 0, n = 0;
    for (const id of ts.lineup.startingIds.concat([ts.lineup.liberoId])) {
      const p = ts.index.get(id);
      if (!p) continue;
      s += ovrOf(TCFG, p.stats, p.pos); n++;
    }
    return s / n;
  });
  const avg = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
  // league-and-economy.md A.3.1 시즌 1: 평균 65.3 / 최약 62.9 / 최강 67.0
  check(SEC5, '① AI 구단 성장 35% — 평균 OVR', avg, 65.3, 0.5, v => v.toFixed(2));
  check(SEC5, '① AI 구단 성장 35% — 최약', Math.min(...ovrs), 62.9, 0.5, v => v.toFixed(2));
  check(SEC5, '① AI 구단 성장 35% — 최강', Math.max(...ovrs), 67.0, 0.5, v => v.toFixed(2));

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
