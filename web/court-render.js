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
    trail: [], bursts: []   // 스킬 발동 이펙트 {x,y,side,name,t}
  };

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
    R.bursts.length = 0;
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
    var dt = Math.min(0.05, ((now || 0) - R.last) / 1000) * R.speed;
    R.last = now || 0;
    if (R.playing) step(dt);
    draw();
  }
  R.frame = function () { draw(); };

  function step(dt) {
    if (R.ended) {
      R.endHold += dt;
      if (R.endHold > 0.75 && R.onEnd) { var cb = R.onEnd; R.onEnd = null; cb(); }
      R.impact = Math.max(0, R.impact - dt * 3);
      R.shake = Math.max(0, R.shake - dt * 4);
      stepBursts(dt);
      return;
    }
    R.t += dt;
    R.impact = Math.max(0, R.impact - dt * 3);
    R.shake = Math.max(0, R.shake - dt * 4);
    stepBursts(dt);
    var f = R.flights[R.idx];
    if (!f) { R.ended = true; return; }
    if (R.t >= f.T) {
      R.t -= f.T; R.idx++;
      R.impact = 1; R.trail.length = 0;
      var nf = R.flights[R.idx];
      if (nf) {
        if (R.onTouch) R.onTouch(R.idx);
        spawnBursts(R.touches[R.idx]);
        if (nf.from && nf.from.type === EV.Attack) R.shake = 0.6;
      } else {
        R.ended = true;
        if (R.onTouch) R.onTouch(R.touches.length);
      }
    }
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
    if (R.shake > 0) c.translate((Math.random()-0.5)*R.shake*3, (Math.random()-0.5)*R.shake*3);
    c.clearRect(-10, -10, w+20, h+20);

    // 체육관 배경
    var sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0C1620'); sky.addColorStop(0.55, '#122335'); sky.addColorStop(1, '#0A1017');
    c.fillStyle = sky; c.fillRect(-10, -10, w+20, h+20);

    drawStands(c, cam);
    drawFloor(c, cam);
    drawLines(c, cam);

    var ball = ballAt();
    // 쿼터뷰에서는 회전 깊이 순으로 그린다(먼 쪽 먼저).
    var ps = collectPlayers();
    ps.forEach(function (p) { p.d = depthOf(cam, p.x, p.y); });
    ps.sort(function (a, b) { return b.d - a.d; });
    var netD = depthOf(cam, COURT.width / 2, COURT.net);
    ps.filter(function (p) { return p.d >= netD; }).forEach(function (p) { drawPlayer(c, cam, p, ball); });
    drawNet(c, cam);
    drawShadow(c, cam, ball);
    ps.filter(function (p) { return p.d < netD; }).forEach(function (p) { drawPlayer(c, cam, p, ball); });
    drawTrail(c, cam);
    drawBall(c, cam, ball);
    drawBursts(c, cam);
    c.restore();
  }

  /** 먼 쪽 관중석 — 밀도(R.crowd)만큼 점을 채운다. 결정적(시드 고정)이라 프레임마다 흔들리지 않는다. */
  function drawStands(c, cam) {
    if (R.crowd <= 0) return;
    var far = project(cam, 0, COURT.length + 2.4, 0), farR = project(cam, COURT.width, COURT.length + 2.4, 0);
    var top = Math.max(cam.h * 0.09, far.sy - cam.h * 0.30), bottom = far.sy - 4;   // 위쪽 팀 이름 라벨 자리를 남긴다
    var x0 = Math.min(far.sx, farR.sx) - cam.w * 0.18, x1 = Math.max(far.sx, farR.sx) + cam.w * 0.18;
    var rows = 6, rnd = rng(7331);
    c.save();
    c.fillStyle = 'rgba(8,14,22,.55)'; c.fillRect(x0, top, x1 - x0, bottom - top);   // 스탠드 그림자
    for (var r = 0; r < rows; r++) {
      var y = top + (bottom - top) * (r + 0.5) / rows;
      var cols = 26 + r * 4, sz = 2 + r * 0.35;
      for (var i = 0; i < cols; i++) {
        var u = rnd();
        if (u > R.crowd) continue;                       // 밀도만큼만 앉는다
        var x = x0 + (x1 - x0) * (i + 0.5) / cols + (rnd() - 0.5) * 3;
        var hue = rnd();
        c.fillStyle = hue < 0.5 ? 'rgba(95,176,255,.55)' : (hue < 0.8 ? 'rgba(230,236,242,.45)' : 'rgba(240,144,128,.5)');
        c.beginPath(); c.arc(x, y, sz, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }
  function drawFloor(c, cam) {
    // 코트 바닥(원근 사다리꼴) + 주변 여유 공간
    var out = quad(cam, -1.8, -2.4, COURT.width+1.8, COURT.length+2.4);
    c.fillStyle = 'rgba(18,48,73,.55)'; fillPoly(c, out);
    var inn = quad(cam, 0, 0, COURT.width, COURT.length);
    var g = c.createLinearGradient(0, project(cam,4.5,COURT.length,0).sy, 0, project(cam,4.5,0,0).sy);
    g.addColorStop(0, '#1B4B76'); g.addColorStop(1, '#20608F');
    c.fillStyle = g; fillPoly(c, inn);
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
  }

  function collectPlayers() {
    // 코트에는 항상 6인씩 선다. 공을 만진 선수만 이름과 동작을 얻는다.
    var actor = R.touches[Math.min(R.idx, R.touches.length-1)] || null;
    var byKey = {};
    for (var i = 0; i < R.touches.length; i++) {
      var t = R.touches[i];
      byKey[t.side + '-' + t.pos] = t;    // 이 랠리에서 그 자리에 선 선수
    }
    var out = [];
    [0,1].forEach(function (side) {
      [1,2,3,4,5,6].forEach(function (zone) {
        var p = zonePos(side, zone), t = byKey[side + '-' + zone];
        var isActor = !!(actor && actor.side === side && actor.pos === zone);
        out.push({ side:side, pos:zone, x:p.x, y:p.y,
                   name: isActor && t ? t.name : '', jersey: t ? t.jersey : 0, pid: t ? t.playerId : null,
                   known: !!t, active: isActor, type: isActor ? actor.type : 0 });
      });
    });
    return out;
  }
  function drawPlayer(c, cam, p, ball) {
    // 스파이크·블로킹 순간에는 점프 — 공 높이를 따라 뜬다
    var jump = 0;
    if (p.active && (p.type === EV.Attack || p.type === EV.Block)) jump = Math.min(0.80, Math.max(0, ball.z - 2.1) * 0.55);
    var F = STYLE.figure;
    var HIP = 0.95 * F, SHOULDER = 1.45 * F, HEAD = 1.68 * F;   // 인체 비율(m) × 가독성 보정
    var base = project(cam, p.x, p.y, jump);
    var hip  = project(cam, p.x, p.y, HIP + jump);
    var sho  = project(cam, p.x, p.y, SHOULDER + jump);
    var head = project(cam, p.x, p.y, HEAD + jump);
    var s = base.s;
    var col = p.side === R.mySide ? R.colors.home : R.colors.away;
    var lw = Math.max(2, 0.085 * s);
    c.globalAlpha = p.active ? 1 : (p.known ? 0.62 : 0.34);
    c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round';

    var legSpread = 0.28 * s;                          // 다리
    c.beginPath();
    c.moveTo(hip.sx - legSpread, base.sy); c.lineTo(hip.sx, hip.sy); c.lineTo(hip.sx + legSpread, base.sy);
    c.stroke();
    c.beginPath(); c.moveTo(hip.sx, hip.sy); c.lineTo(sho.sx, sho.sy); c.stroke();   // 몸통

    var up = (p.active && (p.type === EV.Attack || p.type === EV.Block || p.type === EV.Serve || p.type === EV.Set));
    var armY = up ? sho.sy - 0.62 * s : sho.sy + 0.30 * s;
    var armX = 0.42 * s;
    c.beginPath();
    c.moveTo(sho.sx - armX, armY); c.lineTo(sho.sx, sho.sy); c.lineTo(sho.sx + armX, armY);
    c.stroke();

    // 얼굴 마커(art-pipeline 16.2) — 앱이 R.faceOf(pid) 로 64px 원형 비트맵을 주면 머리 자리에 그린다. 없으면 점.
    var face = (p.pid !== null && p.pid !== undefined && R.faceOf) ? R.faceOf(p.pid) : null;
    var fr = 0;
    if (face) {
      fr = Math.max(7, 0.45 * s);                  // 폰에서 알아볼 최소 크기(지름 14px 이상)
      var fy = head.sy - 0.10 * s;
      c.save(); c.beginPath(); c.arc(head.sx, fy, fr, 0, 6.284); c.closePath(); c.clip();
      c.drawImage(face, head.sx - fr, fy - fr, fr * 2, fr * 2); c.restore();
      c.beginPath(); c.arc(head.sx, fy, fr, 0, 6.284);
      c.lineWidth = Math.max(1.5, 0.06 * s); c.strokeStyle = col; c.stroke();
    } else {
      c.fillStyle = col;
      c.beginPath(); c.arc(head.sx, head.sy, Math.max(2.6, 0.15 * s), 0, 6.284); c.fill();
    }
    // 강조 링 — 앱이 R.markOf(pid) 로 색을 주면(데뷔전 선수 등) 머리 둘레에 한 겹 더 그린다. 표현 전용.
    var mk = (p.pid !== null && p.pid !== undefined && R.markOf) ? R.markOf(p.pid) : null;
    if (mk) {
      var my = face ? (head.sy - 0.10 * s) : head.sy, mr = (face ? fr : Math.max(2.6, 0.15 * s)) + Math.max(3, 0.12 * s);
      c.beginPath(); c.arc(head.sx, my, mr, 0, 6.284);
      c.lineWidth = Math.max(1.5, 0.07 * s); c.strokeStyle = mk; c.stroke();
    }

    c.globalAlpha = 1;
    if (p.active && p.name) {
      var ly = face ? (head.sy - 0.10 * s - fr - 5) : (head.sy - 0.30 * s - 5);
      c.font = '600 11px "Gothic A1",sans-serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(233,240,247,.94)';
      c.strokeStyle = 'rgba(6,14,22,.85)'; c.lineWidth = 3;
      c.strokeText(p.name, head.sx, ly);
      c.fillText(p.name, head.sx, ly);
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
    if (R.trail.length < 2) return;
    c.strokeStyle = 'rgba(233,185,73,.30)'; c.lineWidth = 2;
    c.beginPath();
    for (var i=0;i<R.trail.length;i++) {
      var q = project(cam, R.trail[i].x, R.trail[i].y, R.trail[i].z);
      if (i===0) c.moveTo(q.sx,q.sy); else c.lineTo(q.sx,q.sy);
    }
    c.stroke();
  }
  function drawBall(c, cam, b) {
    R.trail.push({x:b.x,y:b.y,z:b.z}); if (R.trail.length > 14) R.trail.shift();
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
  var opp = t.side === 0 ? 1 : 0;                  // 상대 진영
  var reason = point ? point.reason : 0;
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
    case 5: /* 블로킹 득점 */ {                    // 공격한 쪽 코트로 떨어진다
      var y = t.side === 0 ? 1 + rand()*(COURT.net-2) : COURT.net + 1 + rand()*(COURT.net-2);
      return { x: 1 + rand()*(COURT.width-2), y: y, z: PHY.ballR };
    }
    case 6: /* 블록 아웃 */
      return { x: rand() < 0.5 ? -1.6 : COURT.width + 1.6, y: (t.side===0 ? COURT.net + 1 : COURT.net - 1) + (rand()-0.5)*3, z: PHY.ballR };
    default: return inOpp();
  }
}

global.CourtRender = { create: create, COURT: COURT, PHY: PHY, zonePos: zonePos };
})(typeof window !== 'undefined' ? window : this);
