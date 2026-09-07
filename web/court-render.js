/* 코트 3/4 시점 렌더러 — 실제 규격과 물리로 공의 궤적을 그린다.
 *
 * 원칙: 랠리의 결과는 엔진(match.js)이 이미 정했다. 여기서는 그 결과를 만족하는
 * 물리적으로 타당한 궤적을 역산해서 보여줄 뿐이며, 물리가 판정에 개입하지 않는다.
 *
 * 좌표계(월드, 미터):
 *   x 0..9   코트 폭 (왼쪽→오른쪽)
 *   y 0..18  코트 길이 (홈 엔드라인 0, 네트 9, 원정 엔드라인 18)
 *   z 0..    높이
 */
(function (global) {
'use strict';

// ---------------------------------------------------------------- 실제 규격·물리 상수
var COURT = {
  width: 9, length: 18, net: 9, attackLine: 3,   // FIVB 규격(m)
  netHeight: 2.24,                                // 여자 국제 규격
  netBandTop: 2.24, netBandBottom: 1.24,
  antennaH: 0.8                                   // 네트 위로 솟은 안테나
};
var PHY = {
  g: 9.81,                 // 중력가속도 m/s²
  // 공기저항 a = -k|v|v.  k = ½·ρ·Cd·A / m
  //   ρ 1.225 kg/m³, Cd 0.45(구형), A = πr² (r=0.105m) = 0.0346m², m = 0.270kg
  k: 0.5 * 1.225 * 0.45 * 0.0346 / 0.270,   // ≈ 0.0353 /m
  ballR: 0.105
};

// 로테이션 존 → 코트 좌표(자기 진영 기준). 홈은 y 0..9, 원정은 미러.
var ZONE_HOME = {
  4: [1.6, 6.9], 3: [4.5, 7.4], 2: [7.4, 6.9],
  5: [1.6, 2.2], 6: [4.5, 1.6], 1: [7.4, 2.2]
};
function zonePos(side, zone) {           // side 0=홈(아래), 1=원정(위)
  var z = ZONE_HOME[zone] || ZONE_HOME[6];
  return side === 0 ? { x: z[0], y: z[1] } : { x: COURT.width - z[0], y: COURT.length - z[1] };
}
// 터치 종류별 타점 높이(m). 스파이크는 점프 최고타점, 리시브·디그는 낮게.
var EV = { Serve:3, Reception:4, Set:5, Attack:6, Block:7, Dig:8, Cover:9, FreeBall:10 };
var ATK = { Quick:1, Open:2, BackRow:3, Delayed:4, Dump:5, FreeBall:6 };
function contactHeight(t) {
  switch (t.type) {
    case EV.Serve:     return 2.35;                       // 점프 서브 타점
    case EV.Reception: return 0.55;                       // 언더핸드 플랫폼
    case EV.Set:       return 2.25;                       // 오버헤드 토스
    case EV.Attack:
      if (t.attackType === ATK.Dump) return 2.45;
      if (t.attackType === ATK.Quick) return 2.95;
      if (t.attackType === ATK.BackRow) return 2.85;
      if (t.attackType === ATK.FreeBall) return 1.9;
      return 3.00;                                        // 오픈·시간차 최고타점
    case EV.Block:     return 2.90;                       // 네트 위 블로킹
    case EV.Dig:       return 0.40;
    case EV.Cover:     return 0.60;
    case EV.FreeBall:  return 1.80;
    default:           return 1.2;
  }
}
// 터치 종류별 비행 시간(s). 강타는 짧고(=빠르고) 토스·디그는 길다(=높다).
function flightTime(t, dist) {
  switch (t.type) {
    case EV.Serve:     return 0.72 + dist * 0.020;
    case EV.Reception: return 1.05;
    case EV.Set:       return 1.15;
    case EV.Attack:
      if (t.attackType === ATK.Quick) return 0.34;
      if (t.attackType === ATK.Dump) return 0.75;
      if (t.attackType === ATK.FreeBall) return 1.30;
      return 0.42 + dist * 0.010;
    case EV.Block:     return 0.55;
    case EV.Dig:       return 1.35;
    case EV.Cover:     return 1.10;
    case EV.FreeBall:  return 1.40;
    default:           return 0.9;
  }
}

// ---------------------------------------------------------------- 탄도 역산
// 중력 + 2차 공기저항 아래에서 T초 뒤 정확히 p1 에 닿는 초기속도를 슈팅법으로 구한다.
function integrate(p0, v0, T, steps) {
  var dt = T / steps, p = { x:p0.x, y:p0.y, z:p0.z }, v = { x:v0.x, y:v0.y, z:v0.z };
  var path = [{ x:p.x, y:p.y, z:p.z }];
  for (var i = 0; i < steps; i++) {
    var sp = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
    var d = PHY.k * sp;
    var ax = -d * v.x, ay = -d * v.y, az = -d * v.z - PHY.g;
    v.x += ax*dt; v.y += ay*dt; v.z += az*dt;
    p.x += v.x*dt; p.y += v.y*dt; p.z += v.z*dt;
    path.push({ x:p.x, y:p.y, z:p.z });
  }
  return { end:p, path:path };
}
function solveFlight(p0, p1, T) {
  var steps = Math.max(12, Math.round(T * 90));
  // 무저항 포물선을 초기 추정으로
  var v = {
    x: (p1.x - p0.x) / T,
    y: (p1.y - p0.y) / T,
    z: (p1.z - p0.z) / T + 0.5 * PHY.g * T
  };
  var r = null;
  for (var it = 0; it < 6; it++) {                 // 슈팅법: 낙하지점 오차를 초기속도로 되먹임
    r = integrate(p0, v, T, steps);
    var ex = p1.x - r.end.x, ey = p1.y - r.end.y, ez = p1.z - r.end.z;
    if (Math.abs(ex) + Math.abs(ey) + Math.abs(ez) < 0.02) break;
    v.x += ex / T; v.y += ey / T; v.z += ez / T;
  }
  return { v:v, path:r.path, T:T, steps:steps };
}

// ---------------------------------------------------------------- 카메라(등각 쿼터뷰)
// 직교(orthographic) 투영이라 원근 축소가 없다 → 양 팀이 같은 크기로 보인다.
//   theta: 코트를 비스듬히 돌리는 방위각, phi: 올려다보는 각(90°면 완전 평면도)
//   지면은 sin(phi) 만큼 눌리고, 높이(z)는 cos(phi) 만큼 화면 위로 올라간다.
var VIEW = { theta: 28 * Math.PI / 180, phi: 45 * Math.PI / 180, headroom: 5.0 };
// 가독성 보정: 궤적은 실제 물리 그대로이고, 사람과 공만 화면에서 알아보기 쉽게 키운다.
var STYLE = { figure: 1.35, ball: 1.9 };

function makeCamera(w, h) {
  var ct = Math.cos(VIEW.theta), st = Math.sin(VIEW.theta);
  var sp = Math.sin(VIEW.phi), cp = Math.cos(VIEW.phi);
  var hw = COURT.width / 2, hl = COURT.length / 2;
  // 회전한 코트의 화면상 크기로 배율을 맞춘다(여백 포함).
  var extX = hw * ct + hl * st;                 // 가로 반폭(m)
  var extY = (hw * st + hl * ct) * sp;          // 세로 반폭(m, 눌린 뒤)
  var sX = (w - 18) / (2 * extX);
  var sY = (h - 24) / (2 * extY + VIEW.headroom * cp);   // 공이 뜰 여유까지
  var s = Math.min(sX, sY);
  return {
    w: w, h: h, s: s, ct: ct, st: st, sp: sp, cp: cp,
    cx: w / 2,
    cy: (h - 12) - extY * s          // 코트 중심을 아래쪽에 두고 위를 공 궤적에 내준다
  };
}
/** 월드(m) → 화면(px). 직교 투영이라 s 는 거리와 무관하게 일정하다. */
function project(cam, x, y, z) {
  var dx = x - COURT.width / 2, dy = y - COURT.length / 2;
  var rx = dx * cam.ct - dy * cam.st;
  var ry = dx * cam.st + dy * cam.ct;
  return {
    sx: cam.cx + rx * cam.s,
    sy: cam.cy - (ry * cam.sp + z * cam.cp) * cam.s,
    s: cam.s,
    depth: ry                          // 클수록 화면 위쪽(=멀리)
  };
}
function depthOf(cam, x, y) {
  var dx = x - COURT.width / 2, dy = y - COURT.length / 2;
  return dx * cam.st + dy * cam.ct;
}

// ---------------------------------------------------------------- 렌더러
function create(canvas, opts) {
  var ctx = canvas.getContext('2d');
  var R = {
    canvas: canvas, ctx: ctx, cam: null, dpr: 1,
    touches: [], flights: [], point: null, mySide: 0,
    colors: opts && opts.colors || { home:'#3E8FE0', away:'#E3705F' },
    // 관중 밀도 0~1 — 홈구장 시설 등급(E.5 ⑲). 0 이면 빈 체육관, 1 이면 만원. 외형뿐이라 판정과 무관하다.
    crowd: Math.max(0, Math.min(1, (opts && opts.crowd) || 0)),
    t: 0, idx: 0, playing: false, speed: 1, raf: 0, last: 0,
    onTouch: null, onEnd: null, faceOf: null, markOf: null, impact: 0, shake: 0, ended: false, endHold: 0,
    trail: [], bursts: [],   // 스킬 발동 이펙트 {x,y,side,name,t}
    // 연출 1단계(art-pipeline 16.7): 카메라 줌·포커스, 슬로모션, 착지 충격, 네트 흔들림, 관중 환호, 시계
    zoom: 1, zoomT: 1, fx: 0, fy: 0, fxT: 0, fyT: 0, slow: 1, land: null, netWobble: 0, cheer: null, clock: 0,
    // 선수 이동(16.8): 현재 위치와 이번 비행 동안의 이동 계획. 공을 만질 선수는 접점으로 뛰어가고, 친 뒤에는 자리로 돌아온다.
    pp: {}, plan: {},
    // 박진감(16.9): 큰 득점·스킬 직전에 느려지고(예고), 때리는 순간 멈췄다가(히트스톱), 공은 빠르게 꽂힌다
    hitstop: 0, pre: 0, anticip: 0,
    // 스탠디(16.8): 앱이 R.standOf(pid) 로 {img, m} 을 주면 실루엣 대신 누끼 그림을 세운다. _stand 는 pid 별 캐시(팀색 림 포함).
    // lineup: [[{id,name,jersey}×6 홈], [×6 원정]] 자리 1~6 순 — 있으면 공을 안 만진 선수도 이름·그림을 얻는다.
    // figure(16.9): 'rig' | 'standee' | 'silhouette'. headOf(pid) → {face, hair:[팔레트, 스타일], skin}, kitOf(side) → {primary, secondary}
    standOf: null, _stand: {}, lineup: null, figure: 'rig', headOf: null, kitOf: null, debug: { standees: 0, rigs: 0, parts: 0 },
    _rigPose: {}, _rigFx: [],  // 리그(16.9): 선수별 지난 자세(블렌딩)·착지 먼지
    rigParts: null, _rigImg: {}  // 파츠 시트(16.9.2): 앱이 BLOOM_RIG 를 주면 디코드해 캐시
  };
  /** 득점 뒤 관중 반응 — 앱이 부른다. side 가 내 쪽이면 홈 관중이 들썩이고, 아니면 잠깐 조용해진다. */
  R.cheerFor = function (side) { R.cheer = { side: side, t: 0 }; };

  R.resize = function () {
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var w = canvas.clientWidth || 340, h = canvas.clientHeight || 420;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.dpr = dpr; R.cam = makeCamera(w, h);
  };

  /** 랠리 하나를 물리 궤적으로 변환해 재생 준비. */
  R.setRally = function (touches, point, seed) {
    R.touches = touches || []; R.point = point || null;
    R.flights = buildFlights(R.touches, R.point, seed || 1);
    R.t = 0; R.idx = 0; R.ended = false; R.endHold = 0; R.trail.length = 0;
    R.bursts.length = 0; R.land = null; R.slow = 1;
    R.pp = {};
    [0,1].forEach(function (side) { [1,2,3,4,5,6].forEach(function (z) { var q = zonePos(side, z); R.pp[side + '-' + z] = { x: q.x, y: q.y, mv: 0 }; }); });
    // 서브 직전: 서버는 이미 엔드라인 뒤에 서 있다
    if (R.touches[0]) { var s0 = R.touches[0], c0 = contactPoint(s0); var k0 = s0.side + '-' + s0.pos; if (R.pp[k0]) { R.pp[k0].x = c0.x; R.pp[k0].y = c0.y; } }
    planFlight(0);
    R.hitstop = 0; R.anticip = 0;
    var firstSkill = !!(R.touches[0] && R.touches[0].skills && R.touches[0].skills.length);
    R.pre = (R.speed < 4 && ((bigFinish() && R.flights.length === 1) || firstSkill)) ? 0.55 : 0;   // 에이스·스킬 서브: 서브 전 숨 고르기
    if (R.onTouch && R.touches.length) R.onTouch(0);
    if (R.touches.length) spawnBursts(R.touches[0]);
  };

  /** 이 터치에서 발동한 스킬을 코트 이펙트로 띄운다. */
  function spawnBursts(t) {
    if (!t || !t.skills || !t.skills.length) return;
    var seen = {};
    for (var i = 0; i < t.skills.length; i++) {
      var sk = t.skills[i];
      if (seen[sk.key]) continue;
      seen[sk.key] = 1;
      var owner = null;
      for (var j = 0; j < R.touches.length; j++) {
        if (R.touches[j].playerId === sk.playerId) { owner = R.touches[j]; break; }
      }
      var pos = owner ? zonePos(owner.side, owner.pos) : zonePos(sk.side, t.pos);
      R.bursts.push({ x: pos.x, y: pos.y, side: sk.side, name: sk.skillName, t: 0,
                      boon: sk.mag > 0 });
    }
  }

  R.play = function () { if (!R.playing) { R.playing = true; R.last = 0; loop(); } };
  R.pause = function () { R.playing = false; if (R.raf) cancelAnimationFrame(R.raf); R.raf = 0; };

  function loop(now) {
    R.raf = requestAnimationFrame(loop);
    if (!R.last) R.last = now || 0;
    var raw = Math.min(0.05, ((now || 0) - R.last) / 1000);
    R.last = now || 0;
    R.clock += raw;
    var dt = raw * R.speed * R.slow;
    if (R.playing) step(dt, raw);
    stepFx(raw * Math.max(1, R.speed));
    draw();
  }
  R.frame = function () { draw(); };

  /** 이 랠리의 마지막 비행이 "큰 득점"(에이스·강타·블로킹·클러치)인가 — 슬로모션과 큰 충격의 조건. */
  function bigFinish() {
    var pt = R.point; if (!pt) return false;
    return !!(pt.clutch || pt.reason === 1 || pt.reason === 3 || pt.reason === 5);
  }
  /** 이 터치에서 스킬이 발동하는가. */
  function hasSkill(t) { return !!(t && t.skills && t.skills.length); }
  /** 결정적 터치 — 큰 득점을 만든 쪽의 마지막 터치(강타·서브·블로킹). 상대 블록 터치가 뒤에 붙어도 예고·히트스톱은 여기에 건다. */
  function decisiveIndex() {
    if (!bigFinish()) return -1;
    var pt = R.point;
    for (var i = R.touches.length - 1; i >= 0; i--) if (R.touches[i].side === pt.side) return i;
    return -1;
  }
  /**
   * 시간 배율. 원칙: 느려지는 건 "때리기 전", 때리는 순간은 멈추고, 공은 빠르다.
   *  · 다음 터치가 큰 마무리(에이스·강타·블로킹·클러치)이거나 스킬 발동이면 이 비행의 마지막 35% 를 0.3배 (예고)
   *  · 마무리 비행 자체는 1.35배
   */
  function timeScale() {
    var f = R.flights[R.idx]; if (!f || R.speed >= 4) return 1;
    var u = R.t / f.T, dec = decisiveIndex();
    var nextT = R.touches[R.idx + 1];
    if (((dec >= 0 && R.idx + 1 === dec) || hasSkill(nextT)) && u > 0.65) return 0.3;   // 예고: 결정적 터치·스킬 직전
    if (dec >= 0 && R.idx >= dec) return 1.35;                                           // 결정적 터치 뒤로는 빠르게
    return 1;
  }
  function step(dt, raw) {
    if (R.ended) {
      R.endHold += dt;
      if (R.endHold > (bigFinish() && R.speed < 4 ? 0.7 : 0.75) && R.onEnd) { var cb = R.onEnd; R.onEnd = null; cb(); }
      R.impact = Math.max(0, R.impact - dt * 3);
      stepBursts(dt);
      return;
    }
    // 서브 전 숨 고르기 / 히트스톱: 시간이 멈춘다
    if (R.pre > 0) { R.pre -= raw; R.anticip = 1; return; }
    if (R.hitstop > 0) { R.hitstop -= raw; return; }
    R.t += dt;
    R.impact = Math.max(0, R.impact - dt * 3);
    stepBursts(dt);
    var f = R.flights[R.idx];
    if (!f) { R.ended = true; return; }
    R.slow = timeScale();
    R.anticip = R.slow < 1 ? 1 : 0;
    if (R.t >= f.T) {
      R.t -= f.T; R.idx++;
      R.impact = 1; R.trail.length = 0;
      var nf = R.flights[R.idx];
      if (nf) {
        planFlight(R.idx);
        if (R.onTouch) R.onTouch(R.idx);
        spawnBursts(R.touches[R.idx]);
        var t = R.touches[R.idx], decNow = R.idx === decisiveIndex();
        // 때리는 순간: 결정적 터치는 0.09초, 스킬 발동은 0.06초 멈춘다 — 그 뒤 공이 빠르게 나간다
        if (R.speed < 4) R.hitstop = decNow ? 0.09 : (hasSkill(t) ? 0.06 : 0);
        if (nf.from && nf.from.type === EV.Attack) R.shake = decNow ? 0.9 : 0.5;
        R.slow = 1; R.anticip = 0;
      } else {
        R.ended = true; R.slow = 1;
        planReturn();
        var end = f.path[f.path.length - 1];
        var big = bigFinish();
        R.land = { x: end.x, y: end.y, z: end.z, t: 0, big: big };
        R.shake = big ? 1.0 : 0.35;
        if (Math.abs(end.y - COURT.net) < 0.35 && end.z > 0.5) R.netWobble = 1;   // 네트에 걸렸다
        if (R.onTouch) R.onTouch(R.touches.length);
      }
    }
  }
  /** 실시간(재생 속도·슬로모션과 무관)으로 흐르는 연출 — 흔들림 감쇠, 착지 링, 네트, 환호, 카메라 보간. */
  function stepFx(dt) {
    R.shake = Math.max(0, R.shake - dt * 4);
    if (R.land) { R.land.t += dt; if (R.land.t > 0.9) R.land = null; }
    R.netWobble = Math.max(0, R.netWobble - dt * 1.4);
    if (R.cheer) { R.cheer.t += dt; if (R.cheer.t > 1.4) R.cheer = null; }
    // 카메라: 강타가 날아가는 동안 살짝 당기고, 공을 따라 미세하게 판다
    var f = R.flights[R.idx], b = ballAt();
    var zt = 1, fx = COURT.width / 2, fy = COURT.net;
    var nt = R.touches[R.idx + (R.pre > 0 ? 0 : 1)];
    var nq = nt ? R.pp[nt.side + '-' + nt.pos] : null;
    if (R.anticip > 0 && nq) { zt = 1.2; fx = nq.x; fy = nq.y; }              // 예고: 때릴 선수에게 당긴다
    else if (f && !R.ended) {
      var from = f.path[0], to = f.path[f.path.length - 1];
      if (f.from && f.from.type === EV.Attack) { zt = 1.13; fx = (from.x + to.x) / 2; fy = (from.y + to.y) / 2; }
      else if (f.from && f.from.type === EV.Set) { zt = 1.05; fx = b.x; fy = b.y; }
      else { zt = 1.02; fx = COURT.width / 2 + (b.x - COURT.width / 2) * 0.4; fy = COURT.net + (b.y - COURT.net) * 0.4; }
    } else if (R.ended && R.land) { zt = R.land.big ? 1.10 : 1.04; fx = R.land.x; fy = R.land.y; }
    var k = Math.min(1, dt * (R.anticip > 0 ? 6 : 3.2));
    R.zoom += (zt - R.zoom) * k;
    R.fx += (fx - R.fx) * k; R.fy += (fy - R.fy) * k;
  }

  function stepBursts(dt) {
    for (var i = R.bursts.length - 1; i >= 0; i--) {
      R.bursts[i].t += dt;
      if (R.bursts[i].t > 1.5) R.bursts.splice(i, 1);
    }
  }

  function drawBursts(c, cam) {
    for (var i = 0; i < R.bursts.length; i++) {
      var b = R.bursts[i], u = b.t / 1.5;
      var col = b.side === R.mySide ? '#E9B949' : '#E3705F';
      var base = project(cam, b.x, b.y, 0);
      // 바닥 링이 퍼지며 옅어진다
      var rr = (0.5 + u * 2.2) * cam.s;
      c.globalAlpha = Math.max(0, 0.55 * (1 - u));
      c.strokeStyle = col; c.lineWidth = Math.max(1.5, 0.09 * cam.s);
      c.beginPath();
      c.ellipse(base.sx, base.sy, rr, rr * cam.sp, 0, 0, 6.284);
      c.stroke();
      // 스킬명이 떠오른다
      var lift = project(cam, b.x, b.y, 2.5 + u * 1.1);
      c.globalAlpha = u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 0.85);
      c.font = '700 12px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.strokeStyle = 'rgba(6,14,22,.9)'; c.lineWidth = 3.5;
      c.strokeText(b.name, lift.sx, lift.sy);
      c.fillStyle = col;
      c.fillText(b.name, lift.sx, lift.sy);
      c.globalAlpha = 1;
    }
  }

  function ballAt() {
    var f = R.flights[R.idx];
    if (!f) {
      var lastF = R.flights[R.flights.length - 1];
      return lastF ? lastF.path[lastF.path.length - 1] : { x:4.5, y:9, z:1 };
    }
    var u = Math.max(0, Math.min(1, R.t / f.T));
    var i = Math.min(f.path.length - 1, Math.floor(u * (f.path.length - 1)));
    var j = Math.min(f.path.length - 1, i + 1);
    var a = f.path[i], b = f.path[j];
    var w = u * (f.path.length - 1) - i;
    return { x: a.x + (b.x-a.x)*w, y: a.y + (b.y-a.y)*w, z: Math.max(PHY.ballR, a.z + (b.z-a.z)*w) };
  }

  // ------------------------------------------------------------ 그리기
  function draw() {
    var cam = R.cam, c = ctx, w = cam.w, h = cam.h;
    c.save();
    c.clearRect(-10, -10, w+20, h+20);
    // 체육관 배경(줌 밖에 고정)
    var sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0B141E'); sky.addColorStop(0.5, '#122335'); sky.addColorStop(1, '#0A1017');
    c.fillStyle = sky; c.fillRect(-10, -10, w+20, h+20);
    drawLights(c, cam);

    // 카메라: 포커스 지점을 축으로 줌 + 흔들림
    var fp = project(cam, R.fx, R.fy, 0);
    var ax = fp.sx + (cam.cx - fp.sx) * 0.35, ay = fp.sy + (cam.cy - fp.sy) * 0.35;
    c.translate(ax, ay); c.scale(R.zoom, R.zoom); c.translate(-ax, -ay);
    if (R.shake > 0) c.translate((Math.random()-0.5)*R.shake*4, (Math.random()-0.5)*R.shake*4);

    drawStands(c, cam);
    drawFloor(c, cam);
    drawLines(c, cam);
    drawLanding(c, cam);

    var ball = ballAt();
    // 쿼터뷰에서는 회전 깊이 순으로 그린다(먼 쪽 먼저).
    R.debug.standees = 0; R.debug.rigs = 0; R.debug.parts = 0;
    var ps = collectPlayers();
    ps.forEach(function (p) { p.d = depthOf(cam, p.x, p.y); });
    ps.sort(function (a, b) { return b.d - a.d; });
    var netD = depthOf(cam, COURT.width / 2, COURT.net);
    ps.filter(function (p) { return p.d >= netD; }).forEach(function (p) { drawPlayer(c, cam, p, ball); });
    drawNet(c, cam);
    drawShadow(c, cam, ball);
    ps.filter(function (p) { return p.d < netD; }).forEach(function (p) { drawPlayer(c, cam, p, ball); });
    drawRigFx(c);
    drawTrail(c, cam);
    drawBall(c, cam, ball);
    drawBursts(c, cam);
    c.restore();
    // 슬로모션·큰 착지에는 가장자리를 어둡게 (비네트)
    var vig = (R.slow < 1 || R.anticip > 0) ? 0.45 : (R.land && R.land.big ? Math.max(0, 0.45 * (1 - R.land.t / 0.9)) : 0);
    if (vig > 0) {
      var vg = c.createRadialGradient(w/2, h/2, Math.min(w, h) * 0.35, w/2, h/2, Math.max(w, h) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + vig + ')');
      c.fillStyle = vg; c.fillRect(0, 0, w, h);
    }
  }
  /** 천장 조명 — 위쪽에 부드러운 빛 무리 셋. */
  function drawLights(c, cam) {
    var w = cam.w, h = cam.h;
    [0.22, 0.5, 0.78].forEach(function (u, i) {
      var g = c.createRadialGradient(w * u, -h * 0.05, 4, w * u, -h * 0.05, h * (i === 1 ? 0.55 : 0.42));
      g.addColorStop(0, 'rgba(210,228,250,.22)'); g.addColorStop(0.35, 'rgba(160,200,240,.07)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
  }
  /** 착지 충격 — 바닥에 퍼지는 링과 먼지. 큰 득점이면 두 겹 + 섬광. */
  function drawLanding(c, cam) {
    var L = R.land; if (!L) return;
    var u = L.t / 0.9, g = project(cam, L.x, L.y, 0);
    var col = (R.point && R.point.side === R.mySide) ? '255,236,170' : '255,190,170';
    c.save();
    var rr = (0.25 + u * (L.big ? 2.6 : 1.4)) * cam.s;
    c.globalAlpha = Math.max(0, (L.big ? 0.8 : 0.5) * (1 - u));
    c.strokeStyle = 'rgba(' + col + ',1)'; c.lineWidth = Math.max(1.5, 0.08 * cam.s);
    c.beginPath(); c.ellipse(g.sx, g.sy, rr, rr * cam.sp, 0, 0, 6.284); c.stroke();
    if (L.big) {
      var r2 = (0.1 + u * 1.5) * cam.s;
      c.globalAlpha = Math.max(0, 0.6 * (1 - u * 1.3));
      c.beginPath(); c.ellipse(g.sx, g.sy, r2, r2 * cam.sp, 0, 0, 6.284); c.stroke();
      if (u < 0.25) {                                  // 섬광
        var fl = c.createRadialGradient(g.sx, g.sy, 1, g.sx, g.sy, cam.s * 1.6);
        fl.addColorStop(0, 'rgba(' + col + ',' + (0.55 * (1 - u / 0.25)) + ')'); fl.addColorStop(1, 'rgba(0,0,0,0)');
        c.globalAlpha = 1; c.fillStyle = fl; c.fillRect(g.sx - cam.s * 2, g.sy - cam.s * 2, cam.s * 4, cam.s * 4);
      }
      // 먼지 알갱이
      var rnd = rng(31 + Math.round(L.x * 10)), n = 7;
      c.fillStyle = 'rgba(' + col + ',1)';
      for (var i = 0; i < n; i++) {
        var a = rnd() * 6.283, d = (0.3 + rnd() * 1.6) * u * cam.s, lift = Math.sin(Math.min(1, u * 1.4) * 3.14) * (0.25 + rnd() * 0.5) * cam.s;
        c.globalAlpha = Math.max(0, 0.7 * (1 - u));
        c.beginPath(); c.arc(g.sx + Math.cos(a) * d, g.sy + Math.sin(a) * d * cam.sp - lift, Math.max(1, 0.035 * cam.s), 0, 6.284); c.fill();
      }
    }
    c.restore();
  }

  /** 먼 쪽 관중석 — 밀도(R.crowd)만큼 점을 채운다. 결정적(시드 고정)이라 프레임마다 흔들리지 않는다. */
  function drawStands(c, cam) {
    var density = 0.35 + 0.65 * R.crowd;                  // 신생 구단도 관중은 있다 — 시설 등급은 만원 여부를 바꾼다(E.5 ⑲)
    var far = project(cam, 0, COURT.length + 2.4, 0), farR = project(cam, COURT.width, COURT.length + 2.4, 0);
    var top = Math.max(cam.h * 0.09, far.sy - cam.h * 0.30), bottom = far.sy - 4;   // 위쪽 팀 이름 라벨 자리를 남긴다
    var x0 = -cam.w * 0.3, x1 = cam.w * 1.3;                 // 화면 폭 전체(줌·흔들림 여유 포함) — 끊기는 모서리가 없게
    var rows = 6, rnd = rng(7331);
    var cheer = R.cheer && R.cheer.side === R.mySide ? Math.sin(Math.min(1, R.cheer.t / 1.4) * 3.14159) : 0;
    var hush = R.cheer && R.cheer.side !== R.mySide ? Math.max(0, 1 - R.cheer.t / 1.4) : 0;
    c.save();
    // 스탠드 단(계단식 어두운 띠)
    for (var r = 0; r < rows; r++) {
      var y0 = top + (bottom - top) * r / rows, y1 = top + (bottom - top) * (r + 1) / rows;
      c.fillStyle = r % 2 ? 'rgba(10,18,28,.62)' : 'rgba(14,24,36,.62)';
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    for (var r2 = 0; r2 < rows; r2++) {
      var y = top + (bottom - top) * (r2 + 0.5) / rows;
      var cols = 26 + r2 * 4, sz = 2.2 + r2 * 0.4;
      for (var i = 0; i < cols; i++) {
        var u = rnd();
        var x = x0 + (x1 - x0) * (i + 0.5) / cols + (rnd() - 0.5) * 3;
        var hue = rnd(), ph = rnd() * 6.283;
        if (u > density) continue;                       // 밀도만큼만 앉는다
        var bounce = cheer > 0 ? Math.max(0, Math.sin(R.clock * 14 + ph)) * cheer * 3.5 : (Math.sin(R.clock * 1.3 + ph) * 0.5);
        var alpha = hush > 0 ? 0.35 : 1;
        c.globalAlpha = alpha;
        c.fillStyle = hue < 0.5 ? 'rgba(95,176,255,.6)' : (hue < 0.8 ? 'rgba(230,236,242,.5)' : 'rgba(240,144,128,.55)');
        c.beginPath(); c.arc(x, y - bounce, sz, 0, Math.PI * 2); c.fill();
        if (cheer > 0.3 && rnd() < 0.06 && Math.sin(R.clock * 23 + ph) > 0.7) {   // 휴대폰 플래시
          c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.arc(x + 1, y - bounce - 2, 1.3, 0, 6.283); c.fill();
        }
      }
    }
    c.globalAlpha = 1;
    var fade = c.createLinearGradient(0, top, 0, bottom);                  // 아래로 갈수록 어둡게(조명은 위에서 온다)
    fade.addColorStop(0, 'rgba(8,14,22,0)'); fade.addColorStop(1, 'rgba(8,14,22,.55)');
    c.fillStyle = fade; c.fillRect(x0, top, x1 - x0, bottom - top);
    // 앞쪽 펜스 + 구단 색 현수막 띠
    var fenceY = bottom - 2, fh = Math.max(6, cam.h * 0.028);
    var g = c.createLinearGradient(0, fenceY - fh, 0, fenceY);
    g.addColorStop(0, R.colors.away); g.addColorStop(0.5, R.colors.away); g.addColorStop(0.5, R.colors.home); g.addColorStop(1, R.colors.home);
    c.fillStyle = 'rgba(6,12,20,.9)'; c.fillRect(x0, fenceY - fh - 3, x1 - x0, fh + 5);
    c.globalAlpha = 0.85; c.fillStyle = g;
    var seg = (x1 - x0) / 6;
    for (var k2 = 0; k2 < 6; k2++) { if (k2 % 2 === 0) c.fillRect(x0 + seg * k2 + 2, fenceY - fh, seg - 4, fh); }
    c.globalAlpha = 1;
    c.restore();
  }
  function drawFloor(c, cam) {
    // 프리존(마루) → 코트(타라플렉스 파랑) → 마루 결 → 스포트라이트 → 네트 앞 광택
    var out = quad(cam, -2.2, -2.8, COURT.width+2.2, COURT.length+2.8);
    var wg = c.createLinearGradient(0, project(cam,4.5,COURT.length+2.8,0).sy, 0, project(cam,4.5,-2.8,0).sy);
    wg.addColorStop(0, '#3A2C1E'); wg.addColorStop(1, '#5A4530');
    c.fillStyle = wg; fillPoly(c, out);
    c.save();
    c.beginPath(); c.moveTo(out[0].sx, out[0].sy); for (var i = 1; i < 4; i++) c.lineTo(out[i].sx, out[i].sy); c.closePath(); c.clip();
    c.strokeStyle = 'rgba(0,0,0,.16)'; c.lineWidth = 1;
    for (var px = -2.2; px <= COURT.width + 2.2; px += 0.75) {      // 마루 널 결(코트 세로 방향)
      var a = project(cam, px, -2.8, 0), b = project(cam, px, COURT.length + 2.8, 0);
      c.beginPath(); c.moveTo(a.sx, a.sy); c.lineTo(b.sx, b.sy); c.stroke();
    }
    c.restore();
    var inn = quad(cam, 0, 0, COURT.width, COURT.length);
    var g = c.createLinearGradient(0, project(cam,4.5,COURT.length,0).sy, 0, project(cam,4.5,0,0).sy);
    g.addColorStop(0, '#1B4B76'); g.addColorStop(1, '#24699C');
    c.fillStyle = g; fillPoly(c, inn);
    c.save();
    c.beginPath(); c.moveTo(inn[0].sx, inn[0].sy); for (var j = 1; j < 4; j++) c.lineTo(inn[j].sx, inn[j].sy); c.closePath(); c.clip();
    var mid = project(cam, COURT.width / 2, COURT.net, 0);              // 스포트라이트
    var sp = c.createRadialGradient(mid.sx, mid.sy, 2, mid.sx, mid.sy, cam.s * 9);
    sp.addColorStop(0, 'rgba(255,255,255,.14)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sp; c.fillRect(0, 0, cam.w * 3, cam.h * 3);
    c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
    for (var qx = 0.75; qx < COURT.width; qx += 0.75) {                 // 코트 위 결
      var a2 = project(cam, qx, 0, 0), b2 = project(cam, qx, COURT.length, 0);
      c.beginPath(); c.moveTo(a2.sx, a2.sy); c.lineTo(b2.sx, b2.sy); c.stroke();
    }
    var gl = quad(cam, 0, COURT.net - 1.2, COURT.width, COURT.net + 1.2);   // 네트 앞 광택
    var gg = c.createLinearGradient(0, gl[2].sy, 0, gl[0].sy);
    gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(0.5, 'rgba(255,255,255,.07)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gg; fillPoly(c, gl);
    c.restore();
  }
  function quad(cam, x0, y0, x1, y1) {
    return [project(cam,x0,y0,0), project(cam,x1,y0,0), project(cam,x1,y1,0), project(cam,x0,y1,0)];
  }
  function fillPoly(c, pts) {
    c.beginPath(); c.moveTo(pts[0].sx, pts[0].sy);
    for (var i=1;i<pts.length;i++) c.lineTo(pts[i].sx, pts[i].sy);
    c.closePath(); c.fill();
  }
  function line3(c, cam, x0,y0,x1,y1, width, color) {
    var a = project(cam,x0,y0,0), b = project(cam,x1,y1,0);
    c.strokeStyle = color; c.lineWidth = Math.max(1, width * cam.s * 0.055);
    c.beginPath(); c.moveTo(a.sx,a.sy); c.lineTo(b.sx,b.sy); c.stroke();
  }
  function drawLines(c, cam) {
    var W = COURT.width, L = COURT.length, col = 'rgba(233,240,247,.72)';
    line3(c, cam, 0,0, W,0, 1, col); line3(c, cam, 0,L, W,L, 1, col);
    line3(c, cam, 0,0, 0,L, 1, col); line3(c, cam, W,0, W,L, 1, col);
    line3(c, cam, 0,COURT.net-COURT.attackLine, W,COURT.net-COURT.attackLine, .8, 'rgba(233,240,247,.42)');
    line3(c, cam, 0,COURT.net+COURT.attackLine, W,COURT.net+COURT.attackLine, .8, 'rgba(233,240,247,.42)');
    line3(c, cam, 0,COURT.net, W,COURT.net, .8, 'rgba(233,240,247,.3)');
  }
  function drawNet(c, cam) {
    var W = COURT.width, N = COURT.net, top = COURT.netBandTop, bot = COURT.netBandBottom;
    var tl = project(cam,0,N,top), tr = project(cam,W,N,top);
    var bl = project(cam,0,N,bot), br = project(cam,W,N,bot);
    var wob = R.netWobble > 0 ? Math.sin(R.clock * 28) * R.netWobble * 3.5 : 0;   // 공이 걸리면 그물이 출렁인다
    if (wob) { c.save(); c.translate(0, wob * 0.4); }
    c.fillStyle = 'rgba(200,220,240,.10)';
    c.beginPath(); c.moveTo(tl.sx,tl.sy); c.lineTo(tr.sx,tr.sy); c.lineTo(br.sx,br.sy); c.lineTo(bl.sx,bl.sy); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(210,228,244,.30)'; c.lineWidth = 1;
    for (var i=0;i<=18;i++) {                      // 그물눈
      var x = W*i/18, a = project(cam,x,N,top), b = project(cam,x,N,bot);
      c.beginPath(); c.moveTo(a.sx,a.sy); c.lineTo(b.sx,b.sy); c.stroke();
    }
    for (var j=0;j<=4;j++) {
      var z = bot + (top-bot)*j/4, a2 = project(cam,0,N,z), b2 = project(cam,W,N,z);
      c.beginPath(); c.moveTo(a2.sx,a2.sy); c.lineTo(b2.sx,b2.sy); c.stroke();
    }
    c.strokeStyle = '#E9F0F7'; c.lineWidth = 3;    // 흰 밴드
    c.beginPath(); c.moveTo(tl.sx,tl.sy); c.lineTo(tr.sx,tr.sy); c.stroke();
    // 안테나
    [0, W].forEach(function (x) {
      var a = project(cam,x,N,top), b = project(cam,x,N,top+COURT.antennaH);
      c.strokeStyle = '#E9A13B'; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(a.sx,a.sy); c.lineTo(b.sx,b.sy); c.stroke();
    });
    if (wob) c.restore();
  }

  // ------------------------------------------------------------ 선수 이동 계획
  function easeInOut(u) { u = Math.max(0, Math.min(1, u)); return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  /** key → { fx, fy, tx, ty, d0, d1 }: 비행 진행도 d0 에서 출발해 d1 에 도착한다. */
  function setPlan(key, tx, ty, d0, d1) {
    var cur = R.pp[key]; if (!cur) return;
    R.plan[key] = { fx: cur.x, fy: cur.y, tx: tx, ty: ty, d0: d0, d1: d1 };
  }
  /**
   * idx 번째 비행(터치 idx → idx+1) 동안 열두 명이 어디로 움직이는가.
   *  · 방금 친 선수: 접점에 잠시 있다가 자기 자리로 돌아온다
   *  · 다음에 만질 선수: 자기 접점으로 달려가 공보다 먼저 도착한다(80%)
   *  · 다다음이 블로킹이면 그 블로커는 미리 공격수 앞 네트로 옮겨 서고, 이웃 전위는 반쯤 따라간다(더블 블록)
   *  · 나머지: 자기 자리에서 공의 낙하 방향으로 살짝 쏠린다
   */
  function planFlight(idx) {
    var f = R.flights[idx]; if (!f) return;
    var t0 = R.touches[idx], t1 = R.touches[idx + 1] || null, t2 = R.touches[idx + 2] || null;
    var to = f.path[f.path.length - 1];
    var taken = {};
    [0,1].forEach(function (side) { [1,2,3,4,5,6].forEach(function (z) {
      var key = side + '-' + z, home = zonePos(side, z);
      var shade = 0;
      if (to && side !== t0.side) shade = (to.x - COURT.width / 2) * 0.12;       // 수비 쪽은 공이 오는 방향으로 쏠린다
      setPlan(key, home.x + shade, home.y, 0.15, 1);
    }); });
    // 방금 친 선수: 접점 → (35% 뒤) 자리로
    var k0 = t0.side + '-' + t0.pos, c0 = contactPoint(t0), h0 = zonePos(t0.side, t0.pos);
    R.pp[k0].x = c0.x; R.pp[k0].y = c0.y;
    setPlan(k0, h0.x, h0.y, 0.35, 1); taken[k0] = 1;
    // 다음 선수: 접점으로
    if (t1) { var k1 = t1.side + '-' + t1.pos, c1 = contactPoint(t1); setPlan(k1, c1.x, c1.y, 0, 0.8); taken[k1] = 1; }
    // 블로커 사전 배치
    if (t2 && t2.type === EV.Block && t1 && t1.type === EV.Attack) {
      var k2 = t2.side + '-' + t2.pos, c2 = contactPoint(t2), c1a = contactPoint(t1);
      setPlan(k2, c1a.x, c2.y, 0, 0.9); taken[k2] = 1;
      var mate = nearestFront(t2.side, c1a.x, k2);
      if (mate) { var hm = zonePos(t2.side, mate.zone); setPlan(mate.key, (hm.x + c1a.x) / 2, c2.y, 0.1, 0.95); taken[mate.key] = 1; }
    } else if (t1 && t1.type === EV.Attack && !t2) {
      // 공격이 마지막 터치(득점·범실) — 상대 전위 하나가 늦게 따라가 본다
      var opp = t1.side === 0 ? 1 : 0, c1b = contactPoint(t1);
      var m2 = nearestFront(opp, c1b.x, null);
      if (m2) setPlan(m2.key, c1b.x, opp === 0 ? COURT.net - 0.5 : COURT.net + 0.5, 0.2, 1);
    }
  }
  /** side 의 전위(2·3·4존) 중 x 에 가장 가까운 선수. */
  function nearestFront(side, x, excludeKey) {
    var best = null;
    [2,3,4].forEach(function (z) {
      var key = side + '-' + z; if (key === excludeKey) return;
      var q = R.pp[key]; if (!q) return;
      var d = Math.abs(q.x - x);
      if (!best || d < best.d) best = { key: key, zone: z, d: d };
    });
    return best;
  }
  /** 랠리가 끝나면 모두 자기 자리로. */
  function planReturn() {
    [0,1].forEach(function (side) { [1,2,3,4,5,6].forEach(function (z) {
      var key = side + '-' + z, home = zonePos(side, z);
      setPlan(key, home.x, home.y, 0.1, 1);
    }); });
  }
  /** 이번 프레임의 위치 — 계획을 진행도로 보간하고 이동량을 기록한다(달리기 자세용). */
  function advancePositions() {
    var f = R.flights[R.idx], u;
    if (R.ended) u = Math.min(1, R.endHold / 0.75);
    else u = f ? Math.max(0, Math.min(1, R.t / f.T)) : 0;
    for (var key in R.plan) {
      var pl = R.plan[key], q = R.pp[key]; if (!q) continue;
      var k = easeInOut((u - pl.d0) / Math.max(0.05, pl.d1 - pl.d0));
      var nx = pl.fx + (pl.tx - pl.fx) * k, ny = pl.fy + (pl.ty - pl.fy) * k;
      q.mv = Math.abs(nx - q.x) + Math.abs(ny - q.y);
      q.dx = nx - q.x; q.dy = ny - q.y;          // 이동 방향(스탠디가 달리는 쪽을 보게)
      q.x = nx; q.y = ny;
    }
  }

  function collectPlayers() {
    // 코트에는 항상 6인씩 선다. 공을 만진 선수만 이름과 동작을 얻는다. 다음에 만질 선수는 준비 자세를 잡는다.
    advancePositions();
    var actor = R.touches[Math.min(R.idx, R.touches.length-1)] || null;
    var nextT = (!R.ended && R.idx + 1 < R.touches.length) ? R.touches[R.idx + 1] : null;
    var tellT = R.anticip > 0 ? (R.pre > 0 ? actor : nextT) : null;   // 예고 중 강조할 선수
    var byKey = {};
    for (var i = 0; i < R.touches.length; i++) {
      var t = R.touches[i];
      byKey[t.side + '-' + t.pos] = t;    // 이 랠리에서 그 자리에 선 선수
    }
    var out = [];
    [0,1].forEach(function (side) {
      [1,2,3,4,5,6].forEach(function (zone) {
        var q = R.pp[side + '-' + zone], p = q || zonePos(side, zone), t = byKey[side + '-' + zone];
        var isActor = !!(actor && actor.side === side && actor.pos === zone);
        var isNext = !!(nextT && nextT.side === side && nextT.pos === zone);
        var isTell = !!(tellT && tellT.side === side && tellT.pos === zone);
        // 화면상 이동 방향(회전한 x축) — 스탠디 뒤집기·기울임용
        var sd = (q && R.cam) ? (q.dx || 0) * R.cam.ct - (q.dy || 0) * R.cam.st : 0;
        var lu = (R.lineup && R.lineup[side]) ? R.lineup[side][zone - 1] : null;   // 공을 안 만진 선수의 신원
        out.push({ side:side, pos:zone, x:p.x, y:p.y, moving: q ? q.mv > 0.004 : false, tell: isTell,
                   dir: sd > 0.0005 ? 1 : (sd < -0.0005 ? -1 : 0),
                   tellSkill: isTell && hasSkill(tellT) ? tellT.skills[0].skillName : '',
                   name: (isActor || isTell) && t ? t.name : '', jersey: t ? t.jersey : (lu ? lu.jersey : 0),
                   pid: t ? t.playerId : (lu ? lu.id : null),
                   known: !!t || !!lu, active: isActor, type: isActor ? actor.type : 0,
                   next: isNext ? nextT.type : 0, attackType: isActor ? actor.attackType : 0 });
      });
    });
    return out;
  }
  /** 색을 어둡게/밝게 (0 < k: 밝게, k < 0: 어둡게). */
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  /**
   * 선수 — 유니폼 색으로 채운 실루엣(다리·몸통·팔) + 등번호 + 얼굴. 막대 인간을 면으로 바꾼 것이 연출 1단계의 핵심이다.
   * 자세: 공을 막 친 선수는 터치 종류(서브·토스·강타·블로킹·디그)의 자세, 다음에 만질 선수는 준비 자세(공이 다가오면 블로커는 뛴다).
   */
  function drawPlayer(c, cam, p, ball) {
    var F = STYLE.figure;
    var u = 0; { var f = R.flights[R.idx]; if (f && !R.ended) u = Math.max(0, Math.min(1, R.t / f.T)); }
    var pose = p.active ? p.type : 0, ready = p.next;
    // 점프: 강타·블로킹 순간은 공 높이를 따라, 다음 블로커는 공이 다가오면 솟는다
    var jump = 0;
    if (p.active && (p.type === EV.Attack || p.type === EV.Block)) jump = Math.min(0.85, Math.max(0, ball.z - 2.0) * 0.6) * Math.max(0, 1 - u * 1.6);
    if (ready === EV.Block && u > 0.55) jump = Math.sin((u - 0.55) / 0.45 * 3.14159) * 0.7;
    var crouch = (pose === EV.Reception || pose === EV.Dig || pose === EV.Cover) ? 0.78
               : ((ready === EV.Reception || ready === EV.Dig || ready === EV.Cover) ? 0.88 : 1);
    if (!p.active && !ready) crouch = 0.97 + Math.sin(R.clock * 1.7 + p.pos * 1.3 + p.side * 2) * 0.012;   // 숨쉬기
    var HIP = 0.95 * F * crouch, SHO = 1.45 * F * crouch, HEAD = 1.68 * F * crouch;
    var base = project(cam, p.x, p.y, 0);
    var foot = project(cam, p.x, p.y, jump);
    var hip  = project(cam, p.x, p.y, HIP + jump);
    var sho  = project(cam, p.x, p.y, SHO + jump);
    var head = project(cam, p.x, p.y, HEAD + jump);
    var s = base.s;
    var mine = p.side === R.mySide;
    var col = mine ? R.colors.home : R.colors.away;
    var dark = shade(col, -0.45), light = shade(col, 0.25);
    var alpha = p.active ? 1 : (p.known ? 0.92 : 0.6);
    var faceUp = p.side === 0;                                        // 홈은 위(네트)를 본다 — 등번호는 뒤에서 보인다
    c.save();
    // 예고 링: 곧 때릴 선수의 발밑에서 금색 링이 좁혀 들어온다 (스킬이면 스킬 이름)
    if (p.tell) {
      var ph = (R.clock * 2.2) % 1, rr0 = (0.55 + (1 - ph) * 0.9) * s;
      c.globalAlpha = 0.25 + ph * 0.6; c.strokeStyle = p.tellSkill ? '#E9B949' : '#FFF'; c.lineWidth = Math.max(1.5, 0.07 * s);
      c.beginPath(); c.ellipse(base.sx, base.sy, rr0, rr0 * 0.42, 0, 0, 6.284); c.stroke();
      var gl = c.createRadialGradient(base.sx, base.sy, 1, base.sx, base.sy, 0.9 * s);
      gl.addColorStop(0, p.tellSkill ? 'rgba(233,185,73,.35)' : 'rgba(255,255,255,.25)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 1; c.fillStyle = gl; c.fillRect(base.sx - s, base.sy - s * 0.6, s * 2, s * 1.2);
    }
    c.globalAlpha = alpha;
    // 그림자 — 뛰면 작아진다
    c.fillStyle = 'rgba(4,10,16,' + (0.38 * Math.max(0.3, 1 - jump * 0.8)) + ')';
    c.beginPath(); c.ellipse(base.sx, base.sy, 0.34 * s, 0.14 * s, 0, 0, 6.284); c.fill();
    // 그림 방식(16.9): rig(공용 바디 리그, 기본) → standee(전신 누끼) → silhouette(1단계). 앱이 R.figure 로 고른다.
    var fig = R.figure || 'rig';
    if (fig === 'rig') {
      drawRig(c, cam, p, ball, { u:u, pose:pose, ready:ready, jump:jump, crouch:crouch, base:base, foot:foot, s:s, col:col,
                                 alpha: p.active ? 1 : (p.known ? 1 : 0.8) });
      c.restore();
      return;
    }
    // 스탠디(16.8): 누끼 그림이 있으면 실루엣 대신 세운다. 없는 선수(신인 풀 등)는 아래 실루엣 그대로.
    var st = (fig === 'standee' && p.pid !== null && p.pid !== undefined && R.standOf) ? standSprite(p.pid) : null;
    if (st) {
      drawStandee(c, cam, p, st, { u:u, pose:pose, ready:ready, jump:jump, crouch:crouch, base:base, foot:foot, s:s, col:col,
                                    alpha: p.active ? 1 : (p.known ? 1 : 0.8) });
      c.restore();
      return;
    }
    c.lineCap = 'round'; c.lineJoin = 'round';
    // 다리(반바지 색), 점프하면 모이고, 달리면 앞뒤로 엇갈린다
    var spread = (jump > 0.1 ? 0.10 : 0.20) * s;
    var run = (p.moving && jump < 0.1) ? Math.sin(R.clock * 15 + p.pos * 2) * 0.16 * s : 0;
    c.strokeStyle = dark; c.lineWidth = Math.max(3, 0.15 * s);
    c.beginPath(); c.moveTo(hip.sx - 0.08 * s, hip.sy); c.lineTo(foot.sx - spread + run, foot.sy - 0.02 * s - Math.max(0, run) * 0.5); c.stroke();
    c.beginPath(); c.moveTo(hip.sx + 0.08 * s, hip.sy); c.lineTo(foot.sx + spread - run, foot.sy - 0.02 * s - Math.max(0, -run) * 0.5); c.stroke();
    // 몸통(어깨가 넓은 사다리꼴, 둥근 모서리)
    var shw = 0.27 * s, hpw = 0.19 * s;
    c.fillStyle = col; c.strokeStyle = col; c.lineWidth = Math.max(2, 0.10 * s);
    c.beginPath();
    c.moveTo(sho.sx - shw, sho.sy); c.lineTo(sho.sx + shw, sho.sy); c.lineTo(hip.sx + hpw, hip.sy); c.lineTo(hip.sx - hpw, hip.sy); c.closePath();
    c.fill(); c.stroke();
    // 가슴 하이라이트
    c.fillStyle = light; c.globalAlpha = alpha * 0.35;
    c.beginPath(); c.moveTo(sho.sx - shw * 0.9, sho.sy + 0.02 * s); c.lineTo(sho.sx + shw * 0.2, sho.sy + 0.02 * s); c.lineTo(hip.sx - hpw * 0.6, hip.sy - 0.04 * s); c.lineTo(hip.sx - hpw * 0.95, hip.sy - 0.04 * s); c.closePath(); c.fill();
    c.globalAlpha = alpha;
    // 등번호
    if (p.jersey) {
      c.font = '700 ' + Math.max(8, 0.30 * s) + 'px "Barlow Condensed",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.fillText(String(p.jersey), (sho.sx + hip.sx) / 2, (sho.sy + hip.sy) / 2 + 0.01 * s);
      c.textBaseline = 'alphabetic';
    }
    // 팔 — 자세별 손 위치 (어깨 기준, 화면 px)
    var A = 0.62 * s;                                                  // 팔 길이(화면)
    var lh, rh;                                                        // 왼손·오른손
    if (pose === EV.Serve)            { lh = [-0.25 * A, -0.55 * A]; rh = [0.30 * A, -1.0 * A]; }
    else if (pose === EV.Set)         { lh = [-0.28 * A, -0.95 * A]; rh = [0.28 * A, -0.95 * A]; }
    else if (pose === EV.Block)       { lh = [-0.22 * A, -1.0 * A];  rh = [0.22 * A, -1.0 * A]; }
    else if (pose === EV.Attack)      { var sw = Math.min(1, u * 3); lh = [-0.55 * A, -0.55 * A]; rh = [0.55 * A * (1 - sw) + 0.25 * A * sw, -0.95 * A * (1 - sw) + 0.35 * A * sw]; }
    else if (pose === EV.Reception || pose === EV.Dig || pose === EV.Cover || pose === EV.FreeBall) { lh = [-0.10 * A, 0.75 * A]; rh = [0.10 * A, 0.75 * A]; }
    else if (ready === EV.Block)      { var rb = Math.min(1, Math.max(0, (u - 0.35) / 0.4)); lh = [-0.30 * A, -(0.3 + 0.7 * rb) * A]; rh = [0.30 * A, -(0.3 + 0.7 * rb) * A]; }
    else if (ready === EV.Set)        { lh = [-0.30 * A, -0.7 * A]; rh = [0.30 * A, -0.7 * A]; }
    else if (ready === EV.Attack)     { lh = [-0.45 * A, 0.1 * A]; rh = [0.45 * A, -0.4 * A]; }
    else if (ready)                   { lh = [-0.25 * A, 0.6 * A]; rh = [0.25 * A, 0.6 * A]; }
    else if (p.moving)                { var sw2 = Math.sin(R.clock * 15 + p.pos * 2) * 0.35; lh = [-0.30 * A, (0.35 + sw2) * A]; rh = [0.30 * A, (0.35 - sw2) * A]; }
    else                              { lh = [-0.42 * A, 0.45 * A]; rh = [0.42 * A, 0.45 * A]; }
    c.strokeStyle = col; c.lineWidth = Math.max(2.5, 0.12 * s);
    var armAt = function (h, sign) {
      var sx = sho.sx + sign * shw * 0.85, sy = sho.sy + 0.02 * s;
      var ex = sx + h[0] * 0.5 + sign * 0.12 * A, ey = sy + h[1] * 0.5 + 0.10 * A;   // 팔꿈치는 살짝 바깥·아래
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(sx + h[0], sy + h[1]); c.stroke();
    };
    armAt(lh, -1); armAt(rh, 1);
    // 강타 순간 손끝 스윙 잔상
    if (pose === EV.Attack && u < 0.25) {
      c.globalAlpha = alpha * (1 - u / 0.25) * 0.6; c.strokeStyle = '#FFF'; c.lineWidth = Math.max(1.5, 0.05 * s);
      c.beginPath(); c.arc(sho.sx + shw * 0.85, sho.sy, A * 0.95, -1.9, -0.3); c.stroke();
      c.globalAlpha = alpha;
    }
    // 얼굴 마커(art-pipeline 16.2) — 앱이 R.faceOf(pid) 로 64px 원형 비트맵을 주면 머리 자리에 그린다. 없으면 유니폼색 머리.
    var face = (p.pid !== null && p.pid !== undefined && R.faceOf) ? R.faceOf(p.pid) : null;
    var fr = Math.max(7, 0.45 * s), fy = head.sy - 0.10 * s;
    if (face) {
      c.save(); c.beginPath(); c.arc(head.sx, fy, fr, 0, 6.284); c.closePath(); c.clip();
      c.drawImage(face, head.sx - fr, fy - fr, fr * 2, fr * 2); c.restore();
      c.beginPath(); c.arc(head.sx, fy, fr, 0, 6.284);
      c.lineWidth = Math.max(1.5, 0.06 * s); c.strokeStyle = col; c.stroke();
    } else {
      var hr = Math.max(4, 0.22 * s);
      c.fillStyle = '#F1D6C2'; c.beginPath(); c.arc(head.sx, fy, hr, 0, 6.284); c.fill();
      c.fillStyle = dark; c.beginPath(); c.arc(head.sx, fy - hr * 0.25, hr, 3.3, 6.1); c.fill();   // 머리카락
    }
    // 강조 링 — 앱이 R.markOf(pid) 로 색을 주면(데뷔전 선수 등) 머리 둘레에 한 겹 더 그린다. 표현 전용.
    var mk = (p.pid !== null && p.pid !== undefined && R.markOf) ? R.markOf(p.pid) : null;
    if (mk) {
      var mr = (face ? fr : Math.max(4, 0.22 * s)) + Math.max(3, 0.12 * s);
      c.beginPath(); c.arc(head.sx, fy, mr, 0, 6.284);
      c.lineWidth = Math.max(1.5, 0.07 * s); c.strokeStyle = mk; c.stroke();
    }
    c.globalAlpha = 1;
    if (p.tell && p.tellSkill) {                                          // 스킬 예고: 이름 위에 스킬명
      var sy2 = fy - (face ? fr : Math.max(4, 0.22 * s)) - 20;
      c.font = '700 12px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.strokeStyle = 'rgba(6,14,22,.9)'; c.lineWidth = 3.5; c.strokeText(p.tellSkill, head.sx, sy2);
      c.fillStyle = '#E9B949'; c.fillText(p.tellSkill, head.sx, sy2);
    }
    if ((p.active || p.tell) && (p.name || p.tell)) {
      var ly = fy - (face ? fr : Math.max(4, 0.22 * s)) - 6;
      c.font = '700 11px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(233,240,247,.96)';
      c.strokeStyle = 'rgba(6,14,22,.85)'; c.lineWidth = 3;
      c.strokeText(p.name, head.sx, ly);
      c.fillText(p.name, head.sx, ly);
    }
    c.restore();
  }
  // ---------------------------------------------------------------- 스탠디 (art-pipeline 16.8)
  // 전신 누끼 한 장을 아크릴 스탠드처럼 발 앵커에 세운다. 그림 내용은 모르고 meta 앵커(m)만 읽는다:
  //   m = [발x, 발y, 몸위, 몸아래, 머리x, 머리y, 방향(1=R,-1=L,0=모름)]  — 전부 이미지 기준 0~1
  // 크기: 몸 구간(위~아래, 알파 질량 3%~97%)이 같은 화면 높이가 되게 맞춘다 → 포즈가 달라도 선수 크기가 비슷하다.
  // 방향: 기본은 네트 쪽을 보고, 달리는 중이면 달리는 쪽. 자세는 스쿼시·스트레치·기울임으로만 표현한다(그림은 한 장뿐).
  var STAND = { body: 2.35, rim: 0.055, lean: 0.14 };
  var STAND_DEFAULT = [0.5, 1.0, 0.03, 0.97, 0.5, 0.08, 0];
  function standSprite(pid) {
    var e = R._stand[pid];
    if (e) return e;
    var got = R.standOf(pid); if (!got || !got.img) return null;
    var img = got.img, W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    if (!W || !H) return null;
    // ghost: 그림이 없는 선수의 대역 — 윤곽만 팀색으로 칠하고 얼굴을 얹는다(앱이 기증자 스탠디를 골라 준다)
    e = { img: img, W: W, H: H, m: (got.m && got.m.length >= 7) ? got.m : STAND_DEFAULT, rim: {}, ghost: !!got.ghost };
    // 포즈 세트(16.10): {name: {img, m}} — 상태별로 그림을 바꿔 세운다
    var wrap = function (pg) {
      if (!pg || !pg.img) return null;
      var pw = pg.img.naturalWidth || pg.img.width, ph = pg.img.naturalHeight || pg.img.height; if (!pw || !ph) return null;
      return { img: pg.img, W: pw, H: ph, m: (pg.m && pg.m.length >= 7) ? pg.m : STAND_DEFAULT, rim: {} };
    };
    if (got.poses) {
      e.poses = {};
      for (var k in got.poses) { var w1 = wrap(got.poses[k]); if (w1) e.poses[k] = w1; }
    }
    // 동작 애니메이션(16.10): {name: {frames:[{img,m}], c}} — 영상에서 뽑은 프레임. 접촉 프레임 c 를 공이 닿는 순간에 맞춘다.
    if (got.anims) {
      e.anims = {};
      for (var an in got.anims) {
        var A = got.anims[an], fr = [];
        for (var i = 0; i < A.frames.length; i++) { var w2 = wrap(A.frames[i]); if (w2) fr.push(w2); }
        if (fr.length >= 2) e.anims[an] = { frames: fr, c: Math.max(0, Math.min(fr.length - 1, A.c | 0)) };
      }
    }
    R._stand[pid] = e;
    return e;
  }
  /** 포즈 세트에서 이번 프레임의 그림 — 리그 클립과 같은 규칙. 예비 동작은 공이 오기 직전에, 마무리는 친 직후 잠깐. */
  function standPose(p, g) {
    if (R.ended && R.point) return R.point.side === p.side ? 'cheer' : 'sad';
    if (p.active && g.pose) return g.u < 0.4 ? clipOf(g.pose) : (p.moving ? 'run' : 'ready');
    if (g.ready) return g.u >= 0.55 ? clipOf(g.ready) : (p.moving ? 'run' : 'ready');
    if (p.moving && g.jump < 0.1) return 'run';
    return 'idle';
  }
  /** 동작 애니메이션이 있으면 그 프레임 — 다음 차례(예비 동작)는 첫 프레임→접촉, 방금 침(마무리)은 접촉→끝. */
  function standAnimFrame(e, p, g) {
    if (!e.anims) return null;
    var name = null, ph = 0;
    if (p.active && g.pose && g.u < 0.5) { name = clipOf(g.pose); ph = 0.5 + 0.5 * (g.u / 0.5); }
    else if (g.ready && !p.active) { name = clipOf(g.ready); ph = 0.5 * Math.max(0, (g.u - 0.15) / 0.85); }
    if (!name || !e.anims[name]) return null;
    var A = e.anims[name], n = A.frames.length, c = A.c;
    var idx = ph < 0.5 ? Math.round((ph / 0.5) * c) : c + Math.round(((ph - 0.5) / 0.5) * (n - 1 - c));
    return A.frames[Math.max(0, Math.min(n - 1, idx))];
  }
  /** 팀색으로 칠한 실루엣(림용) — 색마다 한 번만 만든다. */
  function rimOf(e, col) {
    var cv = e.rim[col]; if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = e.W; cv.height = e.H;
    var g = cv.getContext('2d'); g.drawImage(e.img, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, e.W, e.H);
    e.rim[col] = cv; return cv;
  }
  function drawStandee(c, cam, p, e, g) {
    var posed = false;
    var af = standAnimFrame(e, p, g);
    if (af) { e = af; posed = true; }
    else if (e.poses) { var pn = standPose(p, g); var pe = e.poses[pn] || e.poses.idle; if (pe) { e = pe; posed = true; } }
    var m = e.m, W = e.W, H = e.H, s = g.s;
    var fx = m[0] * W, fy = m[1] * H, span = Math.max(0.2, m[3] - m[2]) * H;
    var bodyPx = STAND.body * s;
    var k = bodyPx / span;
    var toNet = project(cam, p.x, p.y + (p.side === 0 ? 1 : -1), 0).sx - g.base.sx;
    var want = (p.moving && p.dir) ? p.dir : (toNet >= 0 ? 1 : -1);
    var flip = (m[6] || 1) === want ? 1 : -1;
    var sx = 1, sy = 1, lean = 0, ph = p.pos * 1.3 + p.side * 2;
    var q = posed ? 0.35 : 1;                                                                             // 포즈 그림은 자세가 이미 있어 변형을 줄인다
    if (g.pose === EV.Attack && g.u < 0.2) { var pk = 1 + 0.12 * q * (1 - g.u / 0.2); sx *= pk; sy *= pk; }   // 타격 펀치
    if (g.jump > 0.05) { sy *= 1 + 0.10 * q * g.jump; sx *= 1 - 0.06 * q * g.jump; }                          // 점프 스트레치
    if (!posed) { if (g.crouch < 0.85) { sy *= 0.86; sx *= 1.08; } else if (g.crouch < 0.95) { sy *= 0.93; sx *= 1.04; } }   // 리시브 스쿼시
    if (p.moving && g.jump < 0.1) {                                                                       // 달리기: 기울임 + 들썩임
      lean = (p.dir || want) * STAND.lean;
      var bob = Math.abs(Math.sin(R.clock * 12 + ph)); sy *= 1 - 0.03 * bob; sx *= 1 + 0.02 * bob;
    } else if (!p.active && !g.ready) { var br = Math.sin(R.clock * 1.7 + ph) * 0.012; sy *= 1 + br; sx *= 1 - br * 0.5; }   // 숨쉬기
    if (p.tell) { var tp = 1 + 0.03 * Math.sin(R.clock * 9); sx *= tp; sy *= tp; }
    c.save();
    c.translate(g.foot.sx, g.foot.sy);
    c.rotate(lean);
    c.scale(k * sx * flip, k * sy);
    c.translate(-fx, -fy);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    // 팀색 림 — 색칠한 실루엣을 여덟 방향으로 살짝 밀어 그린다(아크릴 스탠드 테두리 + 팀 구분)
    var rim = rimOf(e, g.col), r = Math.max(1.2, STAND.rim * s) / k, rd = r * 0.7;
    c.globalAlpha = g.alpha * (p.active || p.tell ? 0.95 : 0.75);
    c.drawImage(rim, -r, 0); c.drawImage(rim, r, 0); c.drawImage(rim, 0, -r); c.drawImage(rim, 0, r);
    c.drawImage(rim, -rd, -rd); c.drawImage(rim, rd, -rd); c.drawImage(rim, -rd, rd); c.drawImage(rim, rd, rd);
    c.globalAlpha = g.alpha;
    if (e.ghost) c.drawImage(rimOf(e, shade(g.col, -0.55)), 0, 0);   // 대역: 어두운 팀색 윤곽
    else c.drawImage(e.img, 0, 0);
    // 강조 링(데뷔전 선수 등) — 머리 둘레
    var mk = R.markOf ? R.markOf(p.pid) : null;
    if (mk) {
      var hr = span * 0.11;
      c.beginPath(); c.arc(m[4] * W, m[5] * H + hr * 0.6, hr, 0, 6.284);
      c.lineWidth = Math.max(1.5, 0.07 * s) / k; c.strokeStyle = mk; c.stroke();
    }
    c.restore();
    R.debug.standees++;
    // 이름·스킬 예고 — 화면 좌표로 머리 위에
    var hx = (m[4] * W - fx) * k * sx * flip, hy = (m[5] * H - fy) * k * sy;
    var cl = Math.cos(lean), sl = Math.sin(lean);
    var headX = g.foot.sx + hx * cl - hy * sl, headY = g.foot.sy + hx * sl + hy * cl;
    var topY = Math.min(headY, g.foot.sy - (fy - m[2] * H) * k * sy);
    if (e.ghost) {                                                       // 대역: 머리 자리에 얼굴(카드에서 오린 원형)
      var face = R.faceOf ? R.faceOf(p.pid) : null;
      var fr = Math.max(6, 0.36 * s), fcy = headY + fr * 0.55;
      c.globalAlpha = g.alpha;
      if (face) {
        c.save(); c.beginPath(); c.arc(headX, fcy, fr, 0, 6.284); c.closePath(); c.clip();
        c.drawImage(face, headX - fr, fcy - fr, fr * 2, fr * 2); c.restore();
      } else { c.fillStyle = '#F1D6C2'; c.beginPath(); c.arc(headX, fcy, fr * 0.7, 0, 6.284); c.fill(); }
      c.beginPath(); c.arc(headX, fcy, fr, 0, 6.284); c.lineWidth = Math.max(1.5, 0.06 * s); c.strokeStyle = g.col; c.stroke();
      topY = Math.min(topY, fcy - fr);
    }
    c.globalAlpha = 1;
    if (p.tell && p.tellSkill) {
      c.font = '700 12px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.strokeStyle = 'rgba(6,14,22,.9)'; c.lineWidth = 3.5; c.strokeText(p.tellSkill, headX, topY - 20);
      c.fillStyle = '#E9B949'; c.fillText(p.tellSkill, headX, topY - 20);
    }
    if ((p.active || p.tell) && p.name) {
      c.font = '700 11px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(233,240,247,.96)'; c.strokeStyle = 'rgba(6,14,22,.85)'; c.lineWidth = 3;
      c.strokeText(p.name, headX, topY - 6); c.fillText(p.name, headX, topY - 6);
    }
  }
  // ---------------------------------------------------------------- 공용 바디 리그 (art-pipeline 16.9)
  // 뼈대 하나에 체형 3종, 파츠는 코드 도형(유니폼 = 구단색), 머리는 카드에서 오린 얼굴 + 머리색·스타일별 뒷머리.
  // 자세는 클립(키프레임)으로 낸다 — 대기·달리기·서브·리시브·토스·강타·블로킹·디그·준비·환호·낙담.
  // 좌표는 "몸 높이 = 1" 인 그림 공간(발 = 원점, 위 = +y, 앞 = +x). 각도는 아래(0)에서 앞(+)으로 재는 라디안.
  // Unity 이행 시 파츠 시트가 이 도형을 1:1 로 대체한다(피벗·레이어 순서는 문서 16.9).
  var RIG = {
    body: 2.55,                       // 화면 높이 = body × s (스탠디보다 9% 크게 — 리그가 기본이라 얼굴 가독성 우선)
    types: { S: 0.94, M: 1.0, L: 1.06 },
    // 6등신 — 실제 그림(6.5등신)보다 머리를 키워 49px 에서도 얼굴이 읽히게(가독성 보정, STYLE.figure 와 같은 뜻)
    hip: 0.50, knee: 0.27, shoulder: 0.745, neck: 0.785, head: 0.862, headR: 0.112,
    hipX: 0.045, shoX: 0.07, thigh: 0.23, shin: 0.25, uarm: 0.15, farm: 0.15,
    wThigh: 0.075, wShin: 0.058, wUarm: 0.056, wFarm: 0.046, wSho: 0.19, wWaist: 0.14, wHip: 0.165, hand: 0.024,
    line: 0.012
  };
  var SKIN = { A: ['#FBE4D4', '#F0B9A6'], B: ['#EAC5A6', '#D69A7E'], C: ['#C9966F', '#A87252'] };
  var HAIR_PAL = [null, ['#2B2D3A', '#1A1B26'], ['#4A3328', '#33221A'], ['#7A4F35', '#563524'], ['#A9764F', '#7E5539'],
                  ['#E8C97A', '#C29A4E'], ['#9B9BA8', '#6F7083'], ['#E3E6F0', '#B4B9CC'], ['#B7412E', '#822B22'],
                  ['#E98BA8', '#C25F84'], ['#4C7BD9', '#3356A8'], ['#4FA37A', '#357455'], ['#7A5BB5', '#553D86'],
                  ['#E07A3C', '#B05520']];   // 13 = 선셋 오렌지(가이드 팔레트 밖)
  // 자세 파라미터 기본값. ua/fa = 위팔/아래팔, th/sh = 허벅지/정강이, N = 앞쪽(가까운 쪽), F = 먼 쪽
  var POSE0 = { spine: 0, head: 0, uaN: 0.12, faN: 0.15, uaF: 0.12, faF: 0.15, thN: 0.05, shN: -0.08, thF: -0.05, shF: -0.08, root: 0, crouch: 0, lean: 0 };
  function P(o) { var r = {}; for (var k in POSE0) r[k] = o[k] !== undefined ? o[k] : POSE0[k]; return r; }
  // 클립: [위상 0~1, 자세]. 동작 클립은 위상 0.5 가 공과 닿는 순간이다(앞은 예비 동작, 뒤는 마무리).
  var CLIPS = {
    // 편한 자세(서브 전): 무릎 살짝, 손은 앞에서 늘어뜨리고 숨쉬기
    idle:  [[0, P({ spine: 0.06, uaN: 0.3, faN: 0.45, uaF: 0.28, faF: 0.4, thN: 0.14, shN: -0.22, thF: -0.1, shF: -0.16, crouch: 0.05 })],
            [0.5, P({ spine: 0.08, uaN: 0.27, faN: 0.4, uaF: 0.25, faF: 0.36, thN: 0.14, shN: -0.22, thF: -0.1, shF: -0.16, crouch: 0.07 })],
            [1, P({ spine: 0.06, uaN: 0.3, faN: 0.45, uaF: 0.28, faF: 0.4, thN: 0.14, shN: -0.22, thF: -0.1, shF: -0.16, crouch: 0.05 })]],
    // 후위 준비 자세: 낮게, 손은 무릎 앞. 위상으로 좌우 체중 이동
    ready: [[0, P({ spine: 0.24, uaN: 0.75, faN: 0.85, uaF: 0.7, faF: 0.9, thN: 0.5, shN: -0.75, thF: -0.35, shF: -0.5, crouch: 0.17 })],
            [0.5, P({ spine: 0.2, uaN: 0.7, faN: 0.9, uaF: 0.75, faF: 0.85, thN: 0.4, shN: -0.6, thF: -0.45, shF: -0.6, crouch: 0.14 })],
            [1, P({ spine: 0.24, uaN: 0.75, faN: 0.85, uaF: 0.7, faF: 0.9, thN: 0.5, shN: -0.75, thF: -0.35, shF: -0.5, crouch: 0.17 })]],
    // 전위 대기: 네트 앞에서 손을 가슴 높이로, 무릎은 조금만
    front: [[0, P({ spine: 0.1, uaN: 1.3, faN: 1.5, uaF: 1.25, faF: 1.55, thN: 0.25, shN: -0.4, thF: -0.2, shF: -0.35, crouch: 0.1 })],
            [0.5, P({ spine: 0.12, uaN: 1.4, faN: 1.45, uaF: 1.2, faF: 1.6, thN: 0.22, shN: -0.35, thF: -0.24, shF: -0.4, crouch: 0.12 })],
            [1, P({ spine: 0.1, uaN: 1.3, faN: 1.5, uaF: 1.25, faF: 1.55, thN: 0.25, shN: -0.4, thF: -0.2, shF: -0.35, crouch: 0.1 })]],
    run:   [[0,    P({ spine: 0.18, uaN: -0.7, faN: 1.3, uaF: 0.8, faF: 1.2, thN: 0.7, shN: -0.4, thF: -0.5, shF: -1.1 })],
            [0.25, P({ spine: 0.18, uaN: 0.0, faN: 1.2, uaF: 0.0, faF: 1.2, thN: 0.1, shN: -0.9, thF: 0.0, shF: -0.4, root: 0.03 })],
            [0.5,  P({ spine: 0.18, uaN: 0.8, faN: 1.2, uaF: -0.7, faF: 1.3, thN: -0.5, shN: -1.1, thF: 0.7, shF: -0.4 })],
            [0.75, P({ spine: 0.18, uaN: 0.0, faN: 1.2, uaF: 0.0, faF: 1.2, thN: 0.0, shN: -0.4, thF: 0.1, shF: -0.9, root: 0.03 })],
            [1,    P({ spine: 0.18, uaN: -0.7, faN: 1.3, uaF: 0.8, faF: 1.2, thN: 0.7, shN: -0.4, thF: -0.5, shF: -1.1 })]],
    serve: [[0,    P({ uaN: -0.6, faN: 0.6, uaF: 1.6, faF: 0.4, thN: 0.15, shN: -0.2, thF: -0.15, shF: -0.1 })],
            [0.3,  P({ spine: -0.12, uaN: -1.4, faN: 1.2, uaF: 2.9, faF: -0.2, thN: 0.2, shN: -0.5, thF: -0.2, shF: -0.3, crouch: 0.12 })],
            [0.45, P({ spine: -0.1, uaN: 2.6, faN: 1.2, uaF: 2.6, faF: -0.4, thN: 0.3, shN: -0.1, thF: -0.4, shF: -0.1, root: 0.14 })],
            [0.5,  P({ spine: 0.1, uaN: 2.4, faN: 0.1, uaF: 1.4, faF: 0.3, thN: 0.3, shN: -0.1, thF: -0.4, shF: -0.1, root: 0.16 })],
            [0.7,  P({ spine: 0.25, uaN: 0.9, faN: 0.2, uaF: 0.6, faF: 0.5, thN: 0.35, shN: -0.4, thF: -0.3, shF: -0.3, root: 0.02 })],
            [1,    P({ spine: 0.1, uaN: 0.4, faN: 0.4, uaF: 0.4, faF: 0.4, thN: 0.2, shN: -0.4, thF: -0.2, shF: -0.3, crouch: 0.08 })]],
    recv:  [[0,    P({ spine: 0.22, uaN: 0.7, faN: 0.9, uaF: 0.7, faF: 0.9, thN: 0.45, shN: -0.7, thF: -0.35, shF: -0.5, crouch: 0.16 })],
            [0.5,  P({ spine: 0.45, uaN: 1.05, faN: 0.0, uaF: 1.05, faF: 0.0, thN: 0.7, shN: -1.0, thF: -0.6, shF: -0.5, crouch: 0.32 })],
            [0.75, P({ spine: 0.4, uaN: 1.2, faN: 0.0, uaF: 1.2, faF: 0.0, thN: 0.6, shN: -0.9, thF: -0.5, shF: -0.5, crouch: 0.26 })],
            [1,    P({ spine: 0.22, uaN: 0.7, faN: 0.9, uaF: 0.7, faF: 0.9, thN: 0.45, shN: -0.7, thF: -0.35, shF: -0.5, crouch: 0.16 })]],
    dig:   [[0,    P({ spine: 0.3, uaN: 0.8, faN: 0.8, uaF: 0.8, faF: 0.8, thN: 0.5, shN: -0.8, thF: -0.4, shF: -0.5, crouch: 0.2 })],
            [0.5,  P({ spine: 0.75, uaN: 1.5, faN: 0.0, uaF: 1.5, faF: 0.0, thN: 1.1, shN: -1.4, thF: -0.9, shF: -0.3, crouch: 0.48 })],
            [0.8,  P({ spine: 0.6, uaN: 1.3, faN: 0.1, uaF: 1.3, faF: 0.1, thN: 0.9, shN: -1.2, thF: -0.7, shF: -0.4, crouch: 0.4 })],
            [1,    P({ spine: 0.3, uaN: 0.8, faN: 0.8, uaF: 0.8, faF: 0.8, thN: 0.5, shN: -0.8, thF: -0.4, shF: -0.5, crouch: 0.2 })]],
    set:   [[0,    P({ spine: 0.05, uaN: 1.6, faN: 1.3, uaF: 1.6, faF: 1.3, thN: 0.3, shN: -0.6, thF: -0.3, shF: -0.4, crouch: 0.14 })],
            [0.5,  P({ spine: -0.05, uaN: 2.95, faN: -0.55, uaF: 2.95, faF: -0.55, thN: 0.15, shN: -0.2, thF: -0.15, shF: -0.2, root: 0.05, head: -0.25 })],
            [0.75, P({ spine: 0.0, uaN: 2.7, faN: -0.3, uaF: 2.7, faF: -0.3, thN: 0.2, shN: -0.4, thF: -0.2, shF: -0.3, crouch: 0.06, head: -0.15 })],
            [1,    P({ spine: 0.05, uaN: 1.2, faN: 0.9, uaF: 1.2, faF: 0.9, thN: 0.3, shN: -0.6, thF: -0.3, shF: -0.4, crouch: 0.12 })]],
    spike: [[0,    P({ spine: 0.2, uaN: -0.6, faN: 1.2, uaF: 0.7, faF: 1.2, thN: 0.6, shN: -0.4, thF: -0.4, shF: -1.0 })],
            [0.25, P({ spine: 0.15, uaN: -1.2, faN: 0.6, uaF: -1.2, faF: 0.6, thN: 0.5, shN: -1.0, thF: 0.5, shF: -1.0, crouch: 0.22 })],
            [0.42, P({ spine: -0.15, uaN: 3.0, faN: -0.9, uaF: 2.3, faF: 0.2, thN: 0.4, shN: -0.9, thF: -0.3, shF: -0.9, root: 0.3 })],
            [0.5,  P({ spine: 0.15, uaN: 2.2, faN: 0.0, uaF: 1.2, faF: 0.4, thN: 0.35, shN: -0.7, thF: -0.35, shF: -0.7, root: 0.32 })],
            [0.62, P({ spine: 0.35, uaN: 0.9, faN: 0.2, uaF: 0.6, faF: 0.5, thN: 0.3, shN: -0.5, thF: -0.3, shF: -0.5, root: 0.2 })],
            [0.78, P({ spine: 0.3, uaN: 0.5, faN: 0.4, uaF: 0.5, faF: 0.4, thN: 0.45, shN: -0.8, thF: -0.35, shF: -0.6, crouch: 0.22 })],
            [1,    P({ spine: 0.12, uaN: 0.3, faN: 0.4, uaF: 0.3, faF: 0.4, thN: 0.2, shN: -0.4, thF: -0.2, shF: -0.3, crouch: 0.06 })]],
    block: [[0,    P({ spine: 0.1, uaN: 1.4, faN: 1.4, uaF: 1.4, faF: 1.4, thN: 0.3, shN: -0.6, thF: -0.3, shF: -0.6, crouch: 0.14 })],
            [0.3,  P({ spine: 0.15, uaN: 1.2, faN: 1.5, uaF: 1.2, faF: 1.5, thN: 0.5, shN: -1.0, thF: -0.5, shF: -1.0, crouch: 0.26 })],
            [0.45, P({ spine: -0.05, uaN: 3.05, faN: 0.0, uaF: 3.05, faF: 0.0, thN: 0.1, shN: -0.3, thF: -0.1, shF: -0.3, root: 0.28 })],
            [0.62, P({ spine: -0.05, uaN: 3.1, faN: 0.0, uaF: 3.1, faF: 0.0, thN: 0.1, shN: -0.3, thF: -0.1, shF: -0.3, root: 0.28 })],
            [0.82, P({ spine: 0.1, uaN: 2.0, faN: 0.4, uaF: 2.0, faF: 0.4, thN: 0.4, shN: -0.8, thF: -0.4, shF: -0.8, crouch: 0.2 })],
            [1,    P({ spine: 0.1, uaN: 1.4, faN: 1.4, uaF: 1.4, faF: 1.4, thN: 0.3, shN: -0.6, thF: -0.3, shF: -0.6, crouch: 0.14 })]],
    cheer: [[0,    P({ spine: -0.05, uaN: 2.6, faN: 0.4, uaF: 2.6, faF: 0.4, thN: 0.1, shN: -0.2, thF: -0.1, shF: -0.2, head: -0.2 })],
            [0.5,  P({ spine: -0.1, uaN: 2.9, faN: 0.2, uaF: 2.9, faF: 0.2, thN: 0.15, shN: -0.1, thF: -0.15, shF: -0.1, root: 0.1, head: -0.3 })],
            [1,    P({ spine: -0.05, uaN: 2.6, faN: 0.4, uaF: 2.6, faF: 0.4, thN: 0.1, shN: -0.2, thF: -0.1, shF: -0.2, head: -0.2 })]],
    sad:   [[0,    P({ spine: 0.35, uaN: 0.2, faN: 0.1, uaF: 0.2, faF: 0.1, thN: 0.1, shN: -0.3, thF: -0.1, shF: -0.3, crouch: 0.1, head: 0.5 })],
            [1,    P({ spine: 0.4, uaN: 0.2, faN: 0.1, uaF: 0.2, faF: 0.1, thN: 0.1, shN: -0.3, thF: -0.1, shF: -0.3, crouch: 0.12, head: 0.55 })]]
  };
  function clipOf(type) {
    switch (type) {
      case EV.Serve: return 'serve';
      case EV.Reception: case EV.Cover: case EV.FreeBall: return 'recv';
      case EV.Dig: return 'dig';
      case EV.Set: return 'set';
      case EV.Attack: return 'spike';
      case EV.Block: return 'block';
      default: return 'ready';
    }
  }
  /** 클립을 위상으로 샘플링(선형 보간, 구간마다 ease). */
  function samplePose(name, ph) {
    var kf = CLIPS[name] || CLIPS.idle;
    ph = Math.max(0, Math.min(1, ph));
    var i = 0; while (i < kf.length - 2 && ph > kf[i + 1][0]) i++;
    var a = kf[i], b = kf[i + 1], t = easeInOut((ph - a[0]) / Math.max(1e-6, b[0] - a[0]));
    var out = {};
    for (var k in POSE0) out[k] = a[1][k] + (b[1][k] - a[1][k]) * t;
    return out;
  }
  /** 이번 프레임 이 선수의 클립과 위상 — 엔진 상태(누가 방금 쳤고 누가 다음에 치는가)에서 정한다. */
  function rigClip(p, g) {
    var ph;
    if (R.ended && R.point) {
      ph = Math.min(1, R.endHold / 0.75);
      return R.point.side === p.side ? ['cheer', 0.5 + 0.5 * Math.sin(ph * 6.28) * 0.5 + 0.25 * ph] : ['sad', ph];
    }
    if (p.active && g.pose) return [clipOf(g.pose), 0.5 + 0.5 * Math.min(1, g.u / 0.45)];      // 방금 침: 마무리 절반
    if (g.ready) return [clipOf(g.ready), 0.5 * g.u];                                            // 다음 차례: 예비 동작 절반
    if (p.moving && g.jump < 0.1) return ['run', ((R.clock * 2.4) + p.pos * 0.37 + p.side * 0.5) % 1];
    // 랠리 중 나머지: 후위(1·5·6)는 낮은 준비 자세, 전위(2·3·4)는 네트 앞에서 손을 든 블로킹 대기. 서브 전 숨 고르기(R.pre)만 편한 자세
    var live = R.flights.length > 0 && R.pre <= 0;
    var ph2 = ((R.clock * 0.35) + p.pos * 0.17 + p.side * 0.3) % 1;
    if (!live) return ['idle', ph2];
    return [(p.pos >= 2 && p.pos <= 4) ? 'front' : 'ready', ph2];
  }
  function rigHead(pid) {
    if (!R.headOf || pid === null || pid === undefined) return null;
    return R.headOf(pid) || null;
  }
  // ---------------------------------------------------------------- 파츠 시트 리그 (art-pipeline 16.9.2)
  // 앱이 R.rigParts(= window.BLOOM_RIG) 를 주면 코드 도형 대신 그림 파츠를 뼈대에 입힌다.
  // 파츠는 정면 A-포즈 한 장을 관절로 자른 것(tools/art-rig.py). 피벗(p)→끝(t) 축을 뼈 A→B 에 맞춰 회전·배율.
  // 저지·반바지는 회색 명도로 저장돼 있고 마스크(m)로 구단색을 곱한다(팀마다 한 번 만들어 캐시).
  function rigSet(type) {
    var src = R.rigParts; if (!src) return null;
    var t = src[type] ? type : (src.M ? 'M' : Object.keys(src)[0]); if (!t) return null;
    var e = R._rigImg[t]; if (e) return e.ready ? e : null;
    e = R._rigImg[t] = { ready: false, left: 0, parts: {}, bh: src[t].bh, sho: src[t].sho, hip: src[t].hip, neck: src[t].neck, tint: {} };
    var P = src[t].parts;
    var done = function () { if (--e.left <= 0) e.ready = true; };
    Object.keys(P).forEach(function (name) {
      var d = P[name], img = new Image(); e.left++;
      var part = e.parts[name] = { img: img, w: d.w, h: d.h, p: d.p, t: d.t, l: d.l, mask: null, trim: null };
      img.onload = done; img.onerror = done; img.src = d.u;
      if (d.m) { var mi = new Image(); e.left++; mi.onload = function () { part.mask = mi; done(); }; mi.onerror = done; mi.src = d.m; }
      if (d.t2) { var ti = new Image(); e.left++; ti.onload = function () { part.trim = ti; done(); }; ti.onerror = done; ti.src = d.t2; }
    });
    return null;
  }
  /** 구단색으로 물들인 파츠(저지·반바지) — 마스크 밝기를 알파로 바꿔 색을 채우고 곱한다. 색마다 한 번. */
  function tintedPart(e, name, col, col2) {
    var part = e.parts[name]; if (!part) return null;
    if (!part.mask) return part.img;
    var key = col + '|' + (col2 || '') + '|' + name, cv = e.tint[key]; if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = part.w; cv.height = part.h;
    var g = cv.getContext('2d'); g.drawImage(part.img, 0, 0);
    var stamp = function (maskImg, color) {                            // 마스크 밝기 → 알파, 색 채움, 곱하기
      var mc = document.createElement('canvas'); mc.width = part.w; mc.height = part.h;
      var mg = mc.getContext('2d'); mg.drawImage(maskImg, 0, 0);
      var id = mg.getImageData(0, 0, part.w, part.h), d = id.data;
      for (var i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }
      mg.putImageData(id, 0, 0);
      mg.globalCompositeOperation = 'source-in'; mg.fillStyle = color; mg.fillRect(0, 0, part.w, part.h);
      g.globalCompositeOperation = 'multiply'; g.drawImage(mc, 0, 0);
    };
    try {
      stamp(part.mask, col);
      if (part.trim && col2) stamp(part.trim, col2);
    } catch (err) { e.tint[key] = part.img; return part.img; }
    g.globalCompositeOperation = 'destination-in'; g.drawImage(part.img, 0, 0);
    e.tint[key] = cv; return cv;
  }
  /** 파츠 한 장을 뼈 A→B(그림 공간 좌표, 이미 X/Y 로 변환된 화면 px)에 맞춰 그린다. */
  function drawPart(c, img, part, A, B, extraRot) {
    if (!img) return;
    var ang1 = Math.atan2(B.y - A.y, B.x - A.x);
    var ang0 = Math.atan2(part.t[1] - part.p[1], part.t[0] - part.p[0]);
    var len0 = Math.sqrt((part.t[0] - part.p[0]) * (part.t[0] - part.p[0]) + (part.t[1] - part.p[1]) * (part.t[1] - part.p[1])) || 1;
    var len1 = Math.sqrt((B.x - A.x) * (B.x - A.x) + (B.y - A.y) * (B.y - A.y));
    var k = len1 / len0;
    c.save(); c.translate(A.x, A.y); c.rotate(ang1 - ang0 + (extraRot || 0)); c.scale(k, k); c.drawImage(img, -part.p[0], -part.p[1]); c.restore();
  }
  /** 2뼈 IK — 뿌리(ax,ay)에서 목표(tx,ty)로 길이 l1·l2. bend +1 이면 관절이 앞(+x)쪽, -1 이면 뒤쪽. 각도는 아래(0)에서 앞(+)으로. */
  function ik2(ax, ay, tx, ty, l1, l2, bend) {
    var dx = tx - ax, dy = ty - ay, d = Math.sqrt(dx * dx + dy * dy);
    var maxd = l1 + l2 - 0.004;
    if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
    if (d < 0.01) { d = 0.01; dx = 0; dy = -0.01; }
    var cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    var a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    var ang = Math.atan2(dx, -dy) + bend * a;
    return { jx: ax + Math.sin(ang) * l1, jy: ay - Math.cos(ang) * l1, ex: ax + dx, ey: ay + dy };
  }
  /** 두 자세를 섞는다(클립이 바뀔 때 툭 튀지 않게). */
  function mixPose(a, b, k) { var o = {}; for (var key in POSE0) o[key] = a[key] + (b[key] - a[key]) * k; return o; }
  function drawRig(c, cam, p, ball, g) {
    var s = g.s, dirWant;
    var toNet = project(cam, p.x, p.y + (p.side === 0 ? 1 : -1), 0).sx - g.base.sx;
    dirWant = (p.moving && p.dir) ? p.dir : (toNet >= 0 ? 1 : -1);
    var head = rigHead(p.pid);
    var type = head && head.type ? head.type : 'M';
    var U = RIG.body * s * (RIG.types[type] || 1);                        // 그림 공간 1 = U px
    var RS = (quarter && rigSet(type + 'q')) || rigSet(type);
    var B = RS ? { thigh: RS.parts.thighR.l, shin: RS.parts.shinR.l, foot: RS.parts.footR.l, uarm: RS.parts.uarmR.l, farm: RS.parts.farmR.l, hand: RS.parts.handR.l,
                   torso: RS.parts.torso.l, pelvis: RS.parts.pelvis.l, hipX: RS.hip ? Math.abs(RS.hip[0]) : RIG.hipX * 0.6,
                   shoX: RS.sho ? Math.abs(RS.sho[0]) : RIG.shoX * 0.5, shoK: (RS.sho && RS.neck && RS.neck[1] > 0) ? Math.max(0.6, Math.min(0.98, RS.sho[1] / RS.neck[1])) : 0.86 }
               : { thigh: RIG.thigh, shin: RIG.shin, foot: 0.02, uarm: RIG.uarm, farm: RIG.farm, hand: 0.05, torso: RIG.shoulder - RIG.hip + 0.05, pelvis: 0.05,
                   hipX: RIG.hipX * 0.6, shoX: RIG.shoX * 0.5, shoK: (RIG.shoulder - RIG.hip) / (RIG.shoulder - RIG.hip + 0.05) };
    B.hip = RS ? (B.thigh + B.shin + B.foot) : RIG.hip;
    var cp = rigClip(p, g), target = samplePose(cp[0], cp[1]);
    // 4분의 3 측면 세트(있으면): 달리기·강타·서브처럼 방향이 있는 동작. 아직 안 실렸으면 정면으로
    var quarter = (cp[0] === 'run' || cp[0] === 'spike' || cp[0] === 'serve');
    // 자세 블렌딩: 지난 프레임 자세에서 목표 자세로 초당 ~16 의 속도로 따라간다(클립 전환이 부드럽다)
    var key = p.side + '-' + p.pos, prev = R._rigPose[key], pose = target;
    if (prev && R.clock - prev.t < 0.5) { var dt = Math.max(0, Math.min(0.2, R.clock - prev.t)); pose = mixPose(prev.pose, target, 1 - Math.exp(-dt * 16)); }
    var kit = (R.kitOf && R.kitOf(p.side)) || { primary: g.col, secondary: '#FFFFFF' };
    var skin = SKIN[head && head.skin ? head.skin : 'A'] || SKIN.A;
    var hairIdx = head && head.hair ? head.hair[0] : 0, hairStyle = head && head.hair ? head.hair[1] : 'short';
    var hair = HAIR_PAL[hairIdx] || ['#4A3328', '#33221A'];
    var alpha = g.alpha;
    var rootUp = Math.max(pose.root, g.jump * 0.35);
    var crouch = Math.max(pose.crouch, (1 - g.crouch) * 0.6);
    // 착지 먼지: 공중에서 땅으로 내려오는 순간
    if (prev && prev.root > 0.08 && rootUp < 0.03) R._rigFx.push({ x: g.foot.sx, y: g.base.sy, t: R.clock, s: s });
    R._rigPose[key] = { pose: pose, root: rootUp, t: R.clock };
    var lineW = Math.max(0.8, RIG.line * U);
    var mirror = dirWant;
    var sq = p.tell ? 1 + 0.03 * Math.sin(R.clock * 9) : 1;
    var sy = sq, sx = 1 / sq;
    c.save();
    c.translate(g.foot.sx, g.base.sy);
    c.globalAlpha = alpha;
    c.scale(mirror, 1);
    c.scale(sx, sy);
    var X = function (x) { return x * U; }, Y = function (y) { return -y * U; };
    var stroke = 'rgba(14,20,32,.62)';
    function limb(ax, ay, bx, by, w, col, hi) {                         // 테두리 → 색 → 왼쪽 위 하이라이트
      c.lineCap = 'round';
      c.strokeStyle = stroke; c.lineWidth = w * U + lineW * 2;
      c.beginPath(); c.moveTo(X(ax), Y(ay)); c.lineTo(X(bx), Y(by)); c.stroke();
      c.strokeStyle = col; c.lineWidth = w * U;
      c.beginPath(); c.moveTo(X(ax), Y(ay)); c.lineTo(X(bx), Y(by)); c.stroke();
      if (hi) {
        c.strokeStyle = hi; c.lineWidth = w * U * 0.34;
        c.beginPath(); c.moveTo(X(ax - 0.006), Y(ay + 0.006)); c.lineTo(X(bx - 0.006), Y(by + 0.006)); c.stroke();
      }
    }
    function blob(x, y, rx, ry, col, hi) {
      c.fillStyle = col; c.strokeStyle = stroke; c.lineWidth = lineW;
      c.beginPath(); c.ellipse(X(x), Y(y), rx * U, ry * U, 0, 0, 6.284); c.fill(); c.stroke();
      if (hi) { c.fillStyle = hi; c.beginPath(); c.ellipse(X(x - rx * 0.25), Y(y + ry * 0.3), rx * 0.45 * U, ry * 0.35 * U, 0, 0, 6.284); c.fill(); }
    }
    // ---- 순운동학
    var hipY = B.hip * (1 - crouch * 0.45) + rootUp;
    var torsoLen = B.torso * (1 - crouch * 0.25);                        // 골반 → 목
    var neckX = Math.sin(pose.spine) * torsoLen, neckY = hipY + Math.cos(pose.spine) * torsoLen;
    var shoX = Math.sin(pose.spine) * torsoLen * B.shoK, shoY = hipY + Math.cos(pose.spine) * torsoLen * B.shoK;
    var headTilt = pose.spine * 0.6 + pose.head;
    // 공을 본다: 공이 머리보다 높으면 고개를 젖히고, 낮으면 숙인다(랠리 중, 환호·낙담 제외)
    if (ball && !R.ended) {
      var bl = project(cam, ball.x, ball.y, ball.z);
      var blx = (bl.sx - g.foot.sx) / (mirror * U * sx), bly = (g.base.sy - bl.sy) / (U * sy);
      var look = Math.atan2(blx - (neckX + 0.0), bly - (neckY + 0.06));          // 앞(+)/뒤(-), 위 0
      var lookTilt = -Math.max(-0.2, Math.min(0.2, (Math.abs(look) < 1.2 ? (0.2 - Math.abs(look) * 0.17) : -0.12)));
      headTilt += lookTilt * (Math.abs(blx) < 4 && Math.abs(bly) < 4 ? 1 : 0.3);
    }
    var headX = neckX + Math.sin(headTilt) * (RIG.head - RIG.neck), headY = neckY + Math.cos(headTilt) * (RIG.head - RIG.neck);
    function leg(side, th, sh) {
      var hx = side * B.hipX, hy = hipY;
      var kx = hx + Math.sin(th) * B.thigh, ky = hy - Math.cos(th) * B.thigh;
      var a2 = th + sh;
      var fx = kx + Math.sin(a2) * B.shin, fy = ky - Math.cos(a2) * B.shin;
      if (rootUp < 0.02) {                                               // 땅에 선 다리: 발을 땅에 놓고 무릎을 IK 로
        var r = ik2(hx, hy, fx, B.foot * (RS ? 1 : 0), B.thigh, B.shin, 1);
        return { hx: hx, hy: hy, kx: r.jx, ky: r.jy, fx: r.ex, fy: r.ey };
      }
      return { hx: hx, hy: hy, kx: kx, ky: ky, fx: fx, fy: fy };
    }
    function arm(side, ua, fa) {
      var sxp = shoX + side * B.shoX, syp = shoY;
      var ex = sxp + Math.sin(ua) * B.uarm, ey = syp - Math.cos(ua) * B.uarm;
      var a2 = ua + fa;
      return { sx: sxp, sy: syp, ex: ex, ey: ey, hx: ex + Math.sin(a2) * B.farm, hy: ey - Math.cos(a2) * B.farm };
    }
    var legF = leg(-1, pose.thF, pose.shF), legN = leg(1, pose.thN, pose.shN);
    var armF = arm(-1, pose.uaF, pose.faF), armN = arm(1, pose.uaN, pose.faN);
    // ---- 공 IK: 치는 순간 손이 공에 닿는다. 방금 친 선수는 비행 앞 18%, 다음 차례는 뒤 20% 동안 공을 향해 팔을 편다
    var reach = 0, reachType = 0;
    if (p.active && g.pose && g.u < 0.18) { reach = 1 - g.u / 0.18; reachType = g.pose; }
    else if (g.ready && g.u > 0.8) { reach = (g.u - 0.8) / 0.2; reachType = g.ready; }
    if (reach > 0 && ball) {
      var bs = project(cam, ball.x, ball.y, ball.z);
      var bx = (bs.sx - g.foot.sx) / (mirror * U * sx), by = (g.base.sy - bs.sy) / (U * sy);
      var both = !(reachType === EV.Attack || reachType === EV.Serve);
      var low = (reachType === EV.Reception || reachType === EV.Dig || reachType === EV.Cover || reachType === EV.FreeBall);
      var tx = bx, ty = by - (low ? 0.05 : 0.02);
      var pull = function (a, side) {
        var r = ik2(a.sx, a.sy, tx + (both ? side * 0.03 : 0), ty, B.uarm, B.farm, -1);
        a.ex += (r.jx - a.ex) * reach; a.ey += (r.jy - a.ey) * reach; a.hx += (r.ex - a.hx) * reach; a.hy += (r.ey - a.hy) * reach;
      };
      pull(armN, 1); if (both) pull(armF, -1);
    }
    if (RS) {
      // ---- 파츠 시트로 그린다: 먼 팔 → 먼 다리 → 가까운 다리 → 뒷머리 → 반바지 → 몸통 → 가까운 팔 (머리는 아래 공통)
      var PT = function (x, y) { return { x: X(x), y: Y(y) }; };
      var partImg = function (name) { var pp = RS.parts[name]; return pp ? pp.img : null; };
      var paintArm = function (A, sfx) {
        var dirx = A.hx - A.ex, diry = A.hy - A.ey, dl = Math.sqrt(dirx * dirx + diry * diry) || 1;
        var handTip = { x: A.hx + dirx / dl * B.hand, y: A.hy + diry / dl * B.hand };
        drawPart(c, partImg('uarm' + sfx), RS.parts['uarm' + sfx], PT(A.sx, A.sy), PT(A.ex, A.ey));
        drawPart(c, partImg('farm' + sfx), RS.parts['farm' + sfx], PT(A.ex, A.ey), PT(A.hx, A.hy));
        drawPart(c, partImg('hand' + sfx), RS.parts['hand' + sfx], PT(A.hx, A.hy), PT(handTip.x, handTip.y));
      };
      var paintLeg = function (L, sfx) {
        drawPart(c, partImg('thigh' + sfx), RS.parts['thigh' + sfx], PT(L.hx, L.hy), PT(L.kx, L.ky));
        drawPart(c, partImg('shin' + sfx), RS.parts['shin' + sfx], PT(L.kx, L.ky), PT(L.fx, L.fy));
        // 발: 땅에 있으면 곧게, 공중이면 정강이 방향을 40% 따라간다
        var shinAng = Math.atan2(L.fx - L.kx, -(L.fy - L.ky));
        var fa = (rootUp > 0.02 ? shinAng * 0.4 : 0);
        drawPart(c, partImg('foot' + sfx), RS.parts['foot' + sfx], PT(L.fx, L.fy), PT(L.fx + Math.sin(fa) * B.foot, L.fy - Math.cos(fa) * B.foot));
      };
      paintArm(armF, 'L');
      paintLeg(legF, 'L');
      paintLeg(legN, 'R');
      drawHairBack(c, X, Y, headX, headY, headTilt, hairStyle, hair, U, p, cp);
      var pelvisTip = { x: Math.sin(pose.spine * 0.25) * B.pelvis, y: hipY - Math.cos(pose.spine * 0.25) * B.pelvis };
      drawPart(c, tintedPart(RS, 'pelvis', shade(kit.primary, -0.5)), RS.parts.pelvis, PT(0, hipY), PT(pelvisTip.x, pelvisTip.y));   // 반바지는 어둡게
      drawPart(c, tintedPart(RS, 'torso', kit.primary, kit.secondary), RS.parts.torso, PT(0, hipY), PT(neckX, neckY));
      R.debug.parts++;
      if (p.jersey) {                                                      // 등번호(가슴)
        c.save(); c.translate(X(shoX * 0.55), Y(hipY + torsoLen * 0.62)); c.rotate(pose.spine); c.scale(mirror, 1);
        c.font = '700 ' + (0.09 * U) + 'px "Barlow Condensed",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = 'rgba(255,255,255,.95)'; c.fillText(String(p.jersey), 0, 0); c.restore();
      }
      paintArm(armN, 'R');
      if (g.pose === EV.Attack && p.active && g.u < 0.14) {                 // 강타 스윙 잔상
        c.strokeStyle = 'rgba(255,255,255,' + (0.7 * (1 - g.u / 0.14)) + ')'; c.lineWidth = Math.max(1, 0.012 * U); c.lineCap = 'round';
        for (var si2 = 1; si2 <= 3; si2++) { var a0 = -0.4 - si2 * 0.28; c.beginPath(); c.arc(X(armN.sx), Y(armN.sy), (B.uarm + B.farm) * 0.95 * U, a0, a0 + 0.22); c.stroke(); }
      }
    } else {
    var shorts = '#1E2432', shortsHi = '#2C3446', pad = '#171B26', shoe = '#F4F5F8', sock = '#F4F5F8';
    var skinHiN = shade(skin[0], 0.35);
    // ---- 그리기: 먼 팔 → 먼 다리 → 가까운 다리 → 뒷머리 → 반바지 → 몸통 → 가까운 팔 → 목 → 머리
    function drawLeg(L, near) {
      var sk = near ? skin[0] : skin[1], hi = near ? skinHiN : null;
      limb(L.hx, L.hy, L.kx, L.ky, RIG.wThigh, sk, hi);
      var a2 = Math.atan2(L.fx - L.kx, -(L.fy - L.ky));                  // 정강이 방향(아래 0)
      var ax = L.kx + Math.sin(a2) * RIG.shin * 0.8, ay = L.ky - Math.cos(a2) * RIG.shin * 0.8;   // 발목(양말 시작)
      limb(L.kx, L.ky, ax, ay, RIG.wShin, sk, hi);
      limb(ax, ay, L.fx, L.fy + 0.01, RIG.wShin * 0.92, sock, null);      // 양말
      blob(L.kx, L.ky, RIG.wShin * 0.62, RIG.wShin * 0.56, pad, '#2A3040');   // 무릎 보호대
      blob(L.fx + 0.022, L.fy + 0.014, 0.052, 0.024, shoe, null);          // 신발
      c.strokeStyle = 'rgba(14,20,32,.5)'; c.lineWidth = lineW * 1.2;      // 밑창
      c.beginPath(); c.moveTo(X(L.fx - 0.028), Y(L.fy + 0.002)); c.lineTo(X(L.fx + 0.072), Y(L.fy + 0.002)); c.stroke();
    }
    function drawArm(A, near) {
      var sk = near ? skin[0] : skin[1], hi = near ? skinHiN : null;
      limb(A.sx, A.sy, A.ex, A.ey, RIG.wUarm, sk, hi);
      limb(A.ex, A.ey, A.hx, A.hy, RIG.wFarm, sk, hi);
      blob(A.hx, A.hy, RIG.hand, RIG.hand * 0.9, sk, null);
    }
    drawArm(armF, false);
    drawLeg(legF, false);
    drawLeg(legN, true);
    drawHairBack(c, X, Y, headX, headY, headTilt, hairStyle, hair, U, p, cp);
    // 반바지
    var hipW = RIG.wHip;
    c.fillStyle = shorts; c.strokeStyle = stroke; c.lineWidth = lineW; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(X(-hipW / 2), Y(hipY + 0.03)); c.lineTo(X(hipW / 2), Y(hipY + 0.03));
    c.lineTo(X(hipW / 2 + 0.012), Y(hipY - 0.11)); c.lineTo(X(0.012), Y(hipY - 0.13)); c.lineTo(X(-0.012), Y(hipY - 0.13)); c.lineTo(X(-hipW / 2 - 0.012), Y(hipY - 0.11)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = shortsHi; c.beginPath(); c.moveTo(X(hipW / 2 - 0.02), Y(hipY + 0.02)); c.lineTo(X(hipW / 2 - 0.004), Y(hipY + 0.02)); c.lineTo(X(hipW / 2 + 0.008), Y(hipY - 0.1)); c.lineTo(X(hipW / 2 - 0.008), Y(hipY - 0.1)); c.closePath(); c.fill();
    // 몸통(유니폼): 허리 → 어깨 사다리꼴 + 옆선 트림 + 목선
    var shW = RIG.wSho, wsW = RIG.wWaist;
    var wx = Math.sin(pose.spine) * torsoLen * 0.45, wy = hipY + Math.cos(pose.spine) * torsoLen * 0.45;
    c.fillStyle = kit.primary; c.strokeStyle = stroke; c.lineWidth = lineW;
    c.beginPath();
    c.moveTo(X(-wsW / 2), Y(hipY)); c.lineTo(X(wsW / 2), Y(hipY));
    c.lineTo(X(wx + wsW / 2), Y(wy)); c.lineTo(X(shoX + shW / 2), Y(shoY + 0.025)); c.lineTo(X(shoX - shW / 2), Y(shoY + 0.025));
    c.lineTo(X(wx - wsW / 2), Y(wy)); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.16)';                                      // 옆구리 그늘(먼 쪽)
    c.beginPath(); c.moveTo(X(-wsW / 2), Y(hipY)); c.lineTo(X(-wsW / 2 + 0.03), Y(hipY)); c.lineTo(X(shoX - shW / 2 + 0.035), Y(shoY + 0.02)); c.lineTo(X(shoX - shW / 2), Y(shoY + 0.02)); c.closePath(); c.fill();
    c.fillStyle = kit.secondary; c.globalAlpha = alpha * 0.85;             // 옆선(앞쪽 가장자리)
    c.beginPath(); c.moveTo(X(wsW / 2 - 0.018), Y(hipY)); c.lineTo(X(wsW / 2), Y(hipY)); c.lineTo(X(shoX + shW / 2), Y(shoY + 0.02)); c.lineTo(X(shoX + shW / 2 - 0.02), Y(shoY + 0.02)); c.closePath(); c.fill();
    c.strokeStyle = kit.secondary; c.lineWidth = Math.max(1, 0.012 * U);   // 목선(V)
    c.beginPath(); c.moveTo(X(shoX - 0.045), Y(shoY + 0.02)); c.lineTo(X(shoX), Y(shoY - 0.035)); c.lineTo(X(shoX + 0.045), Y(shoY + 0.02)); c.stroke();
    c.globalAlpha = alpha;
    if (p.jersey) {
      c.save(); c.translate(X((wx + shoX) / 2 * 0.9), Y((wy + shoY) / 2 - 0.01)); c.scale(mirror, 1);
      c.font = '700 ' + (0.095 * U) + 'px "Barlow Condensed",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(255,255,255,.94)'; c.fillText(String(p.jersey), 0, 0); c.restore();
    }
    drawArm(armN, true);
    // 강타 스윙 잔상
    if (g.pose === EV.Attack && p.active && g.u < 0.14) {
      c.strokeStyle = 'rgba(255,255,255,' + (0.7 * (1 - g.u / 0.14)) + ')'; c.lineWidth = Math.max(1, 0.012 * U); c.lineCap = 'round';
      for (var si = 1; si <= 3; si++) {
        var ang0 = -0.4 - si * 0.28, ang1 = ang0 + 0.22;
        c.beginPath(); c.arc(X(armN.sx), Y(armN.sy), (RIG.uarm + RIG.farm) * 0.95 * U, ang0, ang1); c.stroke();
      }
    }
    }
    // 목 · 머리(타원 마스크 + 앞머리 캡) — 파츠 모드는 몸통에 목이 있다
    if (!RS) limb(neckX, neckY - 0.02, headX, headY - RIG.headR * 0.6, 0.05, skin[1], null);
    var hr = RIG.headR, hry = hr * 1.1;
    c.fillStyle = hair[0]; c.strokeStyle = stroke; c.lineWidth = lineW;
    c.beginPath(); c.ellipse(X(headX - 0.006), Y(headY + 0.014), hr * 1.1 * U, hry * 1.12 * U, 0, 0, 6.284); c.fill(); c.stroke();
    var face = head && head.face ? head.face : null;
    if (face) {
      c.save(); c.translate(X(headX), Y(headY)); c.scale(mirror, 1);
      c.beginPath(); c.ellipse(0, 0, hr * 1.0 * U, hry * U, 0, 0, 6.284); c.closePath(); c.clip();
      c.drawImage(face, -hr * 1.0 * U, -hry * U, hr * 2.0 * U, hry * 2 * U); c.restore();
      c.fillStyle = 'rgba(30,20,40,.16)';                                 // 턱 아래 그늘
      c.beginPath(); c.ellipse(X(headX), Y(headY - hry * 0.72), hr * 0.75 * U, hry * 0.3 * U, 0, 0, 6.284); c.fill();
    } else {
      blob(headX, headY, hr, hry, skin[0], null);
      c.fillStyle = hair[0]; c.beginPath(); c.arc(X(headX), Y(headY), hr * U, 3.3, 6.1); c.fill();
    }
    c.strokeStyle = hair[0]; c.lineWidth = hr * 0.26 * U; c.lineCap = 'round';
    c.beginPath(); c.ellipse(X(headX), Y(headY), hr * 0.94 * U, hry * 0.94 * U, 0, 3.4 + headTilt, 6.0 + headTilt); c.stroke();
    var mk = R.markOf ? R.markOf(p.pid) : null;
    if (mk) { c.beginPath(); c.ellipse(X(headX), Y(headY), hr * 1.32 * U, hry * 1.32 * U, 0, 0, 6.284); c.lineWidth = Math.max(1.5, 0.07 * s); c.strokeStyle = mk; c.stroke(); }
    c.restore();
    R.debug.rigs++;
    // 이름·스킬 예고 — 화면 좌표
    var hsx = g.foot.sx + mirror * headX * U * sx, topY = g.base.sy - (headY + hry * 1.35) * U * sy;
    c.globalAlpha = 1;
    if (p.tell && p.tellSkill) {
      c.font = '700 12px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.strokeStyle = 'rgba(6,14,22,.9)'; c.lineWidth = 3.5; c.strokeText(p.tellSkill, hsx, topY - 20);
      c.fillStyle = '#E9B949'; c.fillText(p.tellSkill, hsx, topY - 20);
    }
    if ((p.active || p.tell) && p.name) {
      c.font = '700 11px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(233,240,247,.96)'; c.strokeStyle = 'rgba(6,14,22,.85)'; c.lineWidth = 3;
      c.strokeText(p.name, hsx, topY - 6); c.fillText(p.name, hsx, topY - 6);
    }
  }
  /** 착지 먼지 — 공중에서 내려온 발밑에 번지는 고리 두 개(0.35초). 선수를 그린 뒤 코트 위에 겹친다. */
  function drawRigFx(c) {
    if (!R._rigFx.length) return;
    var keep = [];
    for (var i = 0; i < R._rigFx.length; i++) {
      var f = R._rigFx[i], age = R.clock - f.t; if (age > 0.35 || age < 0) continue;
      keep.push(f);
      var k = age / 0.35, r = (0.25 + 0.55 * k) * f.s;
      c.globalAlpha = 0.45 * (1 - k); c.strokeStyle = 'rgba(233,240,247,.9)'; c.lineWidth = Math.max(1, 0.05 * f.s * (1 - k));
      c.beginPath(); c.ellipse(f.x, f.y, r, r * 0.38, 0, 0, 6.284); c.stroke();
      c.beginPath(); c.ellipse(f.x, f.y, r * 0.6, r * 0.24, 0, 0, 6.284); c.stroke();
    }
    c.globalAlpha = 1;
    R._rigFx = keep;
  }
  /** 뒷머리 — 스타일 묶음(short·medium·long·pony·twin·braid·bun)별 도형. 달릴 때 꼬리가 흔들린다. */
  function drawHairBack(c, X, Y, hx, hy, tilt, style, hair, U, p, cp) {
    var hr = RIG.headR, back = hx - 0.02, top = hy + 0.02;
    var swing = (cp[0] === 'run') ? Math.sin(cp[1] * 6.28) * 0.12 : Math.sin(R.clock * 1.3 + p.pos) * 0.03;
    c.fillStyle = hair[1]; c.strokeStyle = 'rgba(16,22,34,.45)'; c.lineWidth = Math.max(0.8, RIG.line * U);
    function blob(cx, cy, rx, ry, rot) { c.beginPath(); c.ellipse(X(cx), Y(cy), rx * U, ry * U, rot || 0, 0, 6.284); c.fill(); c.stroke(); }
    switch (style) {
      case 'long':   blob(back - 0.03, hy - 0.12, hr * 0.95, 0.19, 0.1 + swing); break;
      case 'medium': blob(back - 0.02, hy - 0.06, hr * 0.95, 0.12, 0.08 + swing); break;
      case 'pony':   blob(back - 0.02, top, hr * 0.7, hr * 0.7, 0);
                     blob(back - 0.085 - swing * 0.3, hy - 0.06 + swing * 0.2, 0.03, 0.11, 0.45 + swing * 1.5); break;
      case 'twin':   blob(hx - hr * 0.95, hy - 0.08, 0.028, 0.09, 0.15 + swing);
                     blob(hx + hr * 0.95, hy - 0.08, 0.028, 0.09, -0.15 - swing); break;
      case 'braid':  blob(back - 0.03, hy - 0.11, 0.022, 0.15, 0.12 + swing); break;
      case 'bun':    blob(back - 0.04, top + hr * 0.5, hr * 0.42, hr * 0.42, 0); break;
      default:       blob(back - 0.005, top - 0.005, hr * 0.98, hr * 0.98, 0); break;   // short: 원 뒤에 살짝
    }
  }
  function drawShadow(c, cam, b) {
    var g = project(cam, b.x, b.y, 0);
    var k = Math.max(0.25, 1 - b.z / 7);
    c.fillStyle = 'rgba(4,10,16,' + (0.42 * k) + ')';
    c.beginPath();
    var rs = PHY.ballR * STYLE.ball * g.s * (1 + b.z * 0.22);
    c.ellipse(g.sx, g.sy, Math.max(3, rs), Math.max(1.6, rs * 0.5), 0, 0, 6.284);
    c.fill();
  }
  function drawTrail(c, cam) {
    var n = R.trail.length; if (n < 2) return;
    var f = R.flights[R.idx], fast = f && f.from && (f.from.type === EV.Attack || f.from.type === EV.Serve);
    c.lineCap = 'round';
    for (var i = 1; i < n; i++) {
      var a = project(cam, R.trail[i-1].x, R.trail[i-1].y, R.trail[i-1].z), b = project(cam, R.trail[i].x, R.trail[i].y, R.trail[i].z);
      var u = i / n;
      c.strokeStyle = 'rgba(255,220,120,' + (u * u * (fast ? 0.75 : 0.35)) + ')';
      c.lineWidth = Math.max(1, u * (fast ? 7 : 3.5));
      c.beginPath(); c.moveTo(a.sx, a.sy); c.lineTo(b.sx, b.sy); c.stroke();
    }
  }
  function drawBall(c, cam, b) {
    R.trail.push({x:b.x,y:b.y,z:b.z}); if (R.trail.length > 18) R.trail.shift();
    var p = project(cam, b.x, b.y, b.z);
    var r = Math.max(4, PHY.ballR * STYLE.ball * p.s);
    var g = c.createRadialGradient(p.sx - r*0.35, p.sy - r*0.4, r*0.1, p.sx, p.sy, r);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.55, '#E9B949'); g.addColorStop(1, '#B9821C');
    c.fillStyle = g;
    c.beginPath(); c.arc(p.sx, p.sy, r, 0, 6.284); c.fill();
    if (R.impact > 0) {                          // 임팩트 링
      c.strokeStyle = 'rgba(255,240,200,' + (R.impact*0.8) + ')';
      c.lineWidth = 2;
      c.beginPath(); c.arc(p.sx, p.sy, r + (1-R.impact)*16, 0, 6.284); c.stroke();
    }
    if (R.hitstop > 0) {                         // 히트스톱: 타점에 섬광 + 방사선
      var hg = c.createRadialGradient(p.sx, p.sy, r, p.sx, p.sy, r * 6);
      hg.addColorStop(0, 'rgba(255,255,255,.85)'); hg.addColorStop(0.4, 'rgba(255,230,160,.35)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = hg; c.fillRect(p.sx - r * 6, p.sy - r * 6, r * 12, r * 12);
      c.strokeStyle = 'rgba(255,245,210,.9)'; c.lineWidth = 2;
      for (var k3 = 0; k3 < 8; k3++) { var a3 = k3 * 0.785 + 0.3; c.beginPath(); c.moveTo(p.sx + Math.cos(a3) * r * 2.2, p.sy + Math.sin(a3) * r * 2.2); c.lineTo(p.sx + Math.cos(a3) * r * 4.5, p.sy + Math.sin(a3) * r * 4.5); c.stroke(); }
    }
  }

  R.resize();
  return R;
}

// ---------------------------------------------------------------- 랠리 → 비행 목록
function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s<<13; s ^= s>>>17; s ^= s<<5; s >>>= 0; return s / 4294967296; }; }

function buildFlights(touches, point, seed) {
  var rand = rng(seed), out = [];
  if (!touches.length) return out;
  for (var i = 0; i < touches.length; i++) {
    var t = touches[i];
    var from = contactPoint(t);
    var to;
    if (i + 1 < touches.length) to = contactPoint(touches[i+1]);
    else to = landingPoint(t, point, rand);
    var dist = Math.sqrt((to.x-from.x)*(to.x-from.x) + (to.y-from.y)*(to.y-from.y));
    var T = flightTime(t, dist);
    var f = solveFlight(from, to, T);
    f.from = t;
    out.push(f);
  }
  return out;
}
function contactPoint(t) {
  var p = zonePos(t.side, t.pos), z = contactHeight(t);
  if (t.type === EV.Serve) {                       // 서브는 엔드라인 뒤
    return { x: p.x, y: t.side === 0 ? -0.6 : COURT.length + 0.6, z: z };
  }
  if (t.type === EV.Attack || t.type === EV.Block) { // 공격·블로킹은 네트 가까이
    var ny = t.side === 0 ? COURT.net - 0.5 : COURT.net + 0.5;
    if (t.attackType === ATK.BackRow) ny = t.side === 0 ? COURT.net - 3.4 : COURT.net + 3.4;
    return { x: p.x, y: ny, z: z };
  }
  return { x: p.x, y: p.y, z: z };
}
/** 마지막 터치의 낙하점 — 득점 사유가 곧 물리적 결말이 된다. */
function landingPoint(t, point, rand) {
  var reason = point ? point.reason : 0;
  // 득점(에이스·강타·블로킹)은 득점한 쪽의 반대 코트에 떨어진다 — 마지막 터치가 상대 블록 터치여도 공은 그쪽으로 넘어간 것이다
  var scorer = (point && (reason === 1 || reason === 3 || reason === 5)) ? point.side : t.side;
  var opp = scorer === 0 ? 1 : 0;                  // 상대 진영
  var inOpp = function (m) {                       // 상대 코트 안쪽 임의 지점
    var x = 1 + rand() * (COURT.width - 2);
    var y = opp === 0 ? 0.8 + rand() * (COURT.net - 2) : COURT.net + 1.2 + rand() * (COURT.net - 2);
    return { x:x, y:y, z: PHY.ballR };
  };
  switch (reason) {
    case 1: /* 서브 에이스 */ return inOpp();
    case 3: /* 강타 득점 */   return inOpp();
    case 2: /* 서브 범실 */
      return rand() < 0.5
        ? { x: 1 + rand()*(COURT.width-2), y: COURT.net + (t.side===0 ? 0.05 : -0.05), z: 1.1 }   // 네트에 걸림
        : { x: 1 + rand()*(COURT.width-2), y: opp === 0 ? -1.4 : COURT.length + 1.4, z: PHY.ballR };
    case 4: /* 공격 범실 */
      return rand() < 0.45
        ? { x: rand() < 0.5 ? -1.2 : COURT.width + 1.2, y: opp === 0 ? 2 + rand()*5 : COURT.net + 2 + rand()*5, z: PHY.ballR }
        : { x: 1 + rand()*(COURT.width-2), y: opp === 0 ? -1.5 : COURT.length + 1.5, z: PHY.ballR };
    case 5: /* 블로킹 득점 */ return inOpp();    // 공격한 쪽(= 득점한 쪽의 상대) 코트로 떨어진다
    case 6: /* 블록 아웃 */
      return { x: rand() < 0.5 ? -1.6 : COURT.width + 1.6, y: (t.side===0 ? COURT.net + 1 : COURT.net - 1) + (rand()-0.5)*3, z: PHY.ballR };
    default: return inOpp();
  }
}

global.CourtRender = { create: create, COURT: COURT, PHY: PHY, zonePos: zonePos };
})(typeof window !== 'undefined' ? window : this);
