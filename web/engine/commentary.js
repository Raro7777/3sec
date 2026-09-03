// 이벤트 로그 → 한국어 텍스트 중계. Commentary/KoreanCommentary.cs 포팅(조사 이/가 처리 포함).
import { EV, Q, OUT, ATK, SIDE } from './domain.js';

/**
 * 주격 조사 이/가를 마지막 글자의 받침 유무로 붙인다.
 * (예: "채보름" → "채보름이", "하담희" → "하담희가") KoreanCommentary.cs:65 Ga
 */
export function ga(s) {
  if (!s) return (s || '') + '가';
  const ch = s.charCodeAt(s.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return s + (((ch - 0xac00) % 28) !== 0 ? '이' : '가');
  return s + '가';
}

function makeCtx(ctx) {
  let get;
  const p = ctx.players;
  if (p instanceof Map) get = (id) => p.get(id);
  else if (Array.isArray(p)) {
    const m = new Map();
    for (const x of p) m.set(x.id, x);
    get = (id) => m.get(id);
  } else if (p && typeof p === 'object') get = (id) => p[id];
  else get = () => null;
  return {
    who(id) {
      if (id == null) return '?';
      const pl = get(id);
      if (!pl) return id;
      const num = pl.jersey ?? pl.jerseyNumber;
      return num == null ? pl.name : `${num}번 ${pl.name}`;
    },
    teamName(side) { return side === SIDE.HOME ? (ctx.homeName || '홈') : (ctx.awayName || '원정'); },
  };
}

/**
 * @param {Array} events  playMatch 결과의 events
 * @param {{players: object|Map|Array, homeName: string, awayName: string, maxRallies?: number}} ctxIn
 * @returns {string[]} 중계 문자열 배열
 */
export function renderCommentary(events, ctxIn) {
  const c = makeCtx(ctxIn || {});
  const maxRallies = (ctxIn && ctxIn.maxRallies) || Infinity;
  const lines = [];
  if (!events || events.length === 0) return lines;
  let buf = '';
  let rendered = 0;

  for (const e of events) {
    if (e.type === EV.RallyStart) {
      if (buf.length > 0) { lines.push(buf); buf = ''; }
      rendered++;
      if (rendered > maxRallies) break;
    }
    const t = lineOf(e, c);
    if (t === null) continue;
    if (e.type === EV.SetStart || e.type === EV.SetEnd || e.type === EV.MatchEnd
      || e.type === EV.Point || e.type === EV.LiberoIn || e.type === EV.LiberoOut || e.type === EV.Rotation) {
      if (buf.length > 0) { lines.push(buf); buf = ''; }
      lines.push(t);
    } else {
      if (buf.length > 0) buf += ' ';
      buf += t;
    }
  }
  if (buf.length > 0) lines.push(buf);
  return lines;
}

/** KoreanCommentary.cs:76 Line */
function lineOf(e, c) {
  const who = c.who(e.playerId);
  switch (e.type) {
    case EV.MatchStart:
      return `[경기 시작] ${c.teamName(SIDE.HOME)} vs ${c.teamName(SIDE.AWAY)}`;
    case EV.SetStart:
      return `[${e.set}세트 시작] ${c.teamName(e.side)} 서브로 시작합니다. (${e.value}점 선취)`;
    case EV.RallyStart:
      return null;
    case EV.Serve:
      if (e.outcome === OUT.Error) return `${who}의 서브… 범실! 네트에 걸립니다.`;
      return e.value >= 65 ? `${who}의 강서브!` : (e.value <= 35 ? `${who}의 안정적인 서브.` : `${who}의 서브.`);
    case EV.Reception:
      switch (e.quality) {
        case Q.Error: return `${who}, 리시브 실패! 서브 에이스!`;
        case Q.Perfect: return `${who}의 정확한 리시브, 세터에게 완벽하게 연결됩니다.`;
        case Q.Good: return `${who}의 리시브가 살짝 흔들리지만 연결.`;
        default: return `${who}의 리시브가 크게 흔들립니다…`;
      }
    case EV.Set: {
      let how;
      switch (e.attackType) {
        case ATK.Quick: how = '속공으로'; break;
        case ATK.BackRow: how = '후위로 길게'; break;
        case ATK.Delayed: how = '시간차로'; break;
        case ATK.Dump: return `세터 ${who}, 직접 밀어넣습니다!`;
        default: how = e.quality === Q.Poor ? '급히 오픈으로' : '오픈으로'; break;
      }
      const q = e.quality === Q.Perfect ? '깔끔하게' : (e.quality === Q.Poor ? '불안하게' : '');
      return `세터 ${ga(who)} ${how} ${q} 올리고,`.replace('  ', ' ');
    }
    case EV.Attack:
      switch (e.outcome) {
        case OUT.Kill: return `${who}의 강타! 득점!`;
        case OUT.BlockOut: return `${who}의 공격이 블로커 손을 맞고 밖으로! 득점!`;
        case OUT.Error: return `${who}의 공격… 라인을 벗어납니다. 범실.`;
        case OUT.BlockKill: return `${who}의 공격이`;
        case OUT.BlockTouch: return `${who}의 공격, 블로킹에 걸리고…`;
        case OUT.Dug: return `${who}의 공격!`;
        default: return `${who}의 공격.`;
      }
    case EV.Block: {
      const n = e.value >= 3 ? '3인 블로킹' : (e.value === 2 ? '2인 블로킹' : '블로킹');
      if (e.outcome === OUT.BlockKill) return `${who}의 ${n}에 완벽하게 막힙니다! 블로킹 득점!`;
      return `${who}의 ${n}이 손끝에 닿습니다.`;
    }
    case EV.Dig:
      if (e.attackType === ATK.FreeBall) return `${ga(who)} 여유 있게 받아냅니다.`;
      switch (e.quality) {
        case Q.Error: return null;
        case Q.Perfect: return `${who}의 완벽한 디그! 랠리가 이어집니다.`;
        case Q.Good: return `${ga(who)} 받아냅니다!`;
        default: return `${ga(who)} 가까스로 살려냅니다…`;
      }
    case EV.Cover:
      if (e.outcome === OUT.Error) return `${who}의 커버 실패. 블로킹 득점입니다.`;
      return `${ga(who)} 커버해서 다시 공격 기회!`;
    case EV.FreeBall:
      return `${who}, 공격 대신 프리볼로 넘깁니다.`;
    case EV.Point: {
      const tag = e.clutch ? ' (클러치!)' : '';
      return `  ▶ ${c.teamName(e.side)} 득점${tag}  [${c.teamName(SIDE.HOME)} ${e.homeScore} : ${e.awayScore} ${c.teamName(SIDE.AWAY)}]`;
    }
    case EV.Rotation:
      return `  ↻ ${c.teamName(e.side)} 로테이션. 서버 ${who}.`;
    case EV.LiberoIn:
      return `  ⇄ ${c.teamName(e.side)} 리베로 ${who} 투입 (OUT: ${c.who(e.secondary ? e.secondary[0] : null)}).`;
    case EV.LiberoOut:
      return `  ⇄ ${c.teamName(e.side)} 리베로 ${who} 아웃, ${c.who(e.secondary ? e.secondary[0] : null)} 복귀.`;
    case EV.Substitution:
      return `  ⇄ ${c.teamName(e.side)} 선수교체: ${who} IN, ${c.who(e.secondary ? e.secondary[0] : null)} OUT (${e.value}/6).`;
    case EV.SetEnd:
      return `[${e.value}세트 종료] ${c.teamName(e.side)} 세트 승리 (${e.homeScore}-${e.awayScore})`;
    case EV.MatchEnd:
      return `[경기 종료] ${c.teamName(e.side)} 승리! 세트 스코어 ${Math.floor(e.value / 10)}-${e.value % 10}`;
    default:
      return null;
  }
}
