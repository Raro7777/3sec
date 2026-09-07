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

// ---------------------------------------------------------------- 성격 아키타입 (world.md 6절 성격 태그 → 6가지 말투)
// 해설·경기 컷인·캠프 스토리가 같은 분류를 쓴다. 판정과 무관한 순수 표현 계층이다.
const ARCHETYPES = [
  ['fire', /승부|호승|도전|열정|다혈|직진|겁 없음|호쾌|호탕|큰 목소리|목소리 큼/],
  ['ice',  /침착|냉정|차분|쿨함|계산|효율|무표정|계획|관찰|지적|현실적|독서|바둑|다도/],
  ['sun',  /명랑|밝음|활발|낙천|웃음|리액션|응원|수다|장난|유머|엉뚱|덜렁|털털|SNS|노래|사진|간식|대식|먹는/],
  ['rock', /성실|노력|우직|꼼꼼|메모|든든|책임|리더|의리|언니|엄마|후배|배려|정 많음|잔소리|성숙|손재주/],
  ['shy',  /소심|수줍|부끄|걱정|겁 많음|순수|순둥|온화|온순|응석|막내|조용|말수|과묵|무뚝뚝|벌레/],
  ['show', /자신만만|카메라|우아|여유|천재|직감|자유분방|마이페이스|느긋|고양이|서핑|커피/],
];
export const ARCHETYPE_KO = { fire: '승부사', ice: '냉정파', sun: '분위기 메이커', rock: '노력파', shy: '수줍음', show: '스타 기질' };
/** 성격 태그 배열 → 아키타입 키. 첫 태그부터 훑어 처음 맞는 것. 없으면 노력파. */
export function archetypeOf(tags) {
  if (!tags || !tags.length) return 'rock';
  for (const t of tags) for (const [k, re] of ARCHETYPES) if (re.test(String(t))) return k;
  return 'rock';
}
const QUIPS = {
  fire: {
    clutchKill: ['승부욕에 불이 붙은 {n}, 클러치를 자기 손으로 끝냅니다!', '{n}, 도망가지 않았습니다. 정면 승부로 클러치를 가져옵니다!'],
    ace: ['{n}의 서브, 피하지 않고 정면으로 꽂았습니다!', '{n}, 가장 센 서브로 가장 센 리시버를 노렸습니다. 에이스!'],
    block: ['벽이 아니라 도전입니다. {n}, 정면으로 막아냅니다!', '{n}, 상대 에이스 앞에 먼저 손을 올렸습니다!'],
    error: ['{n}, 너무 세게 갔습니다. 그래도 고개를 들지 않습니다.', '{n}의 범실. 다음 공은 더 세게 옵니다.'],
  },
  ice: {
    clutchKill: ['표정 하나 바뀌지 않습니다. {n}, 계산대로 내리꽂습니다.', '{n}, 클러치에서도 맥박이 그대로입니다. 냉정한 마무리.'],
    ace: ['차갑게 노린 코스. {n}의 서브가 정확히 빈자리로.', '{n}, 리시버의 발이 멈춘 순간을 봤습니다. 에이스.'],
    block: ['타이밍을 읽었습니다. {n}, 조용히 손을 올려 막습니다.', '{n}, 세터의 눈을 먼저 봤습니다. 블로킹 득점.'],
    error: ['{n}답지 않은 실수. 바로 다음 공을 준비합니다.', '{n}, 짧게 눈을 감았다 뜹니다. 계산을 다시 합니다.'],
  },
  sun: {
    clutchKill: ['{n}, 웃으면서 때립니다! 벤치가 들썩입니다.', '클러치인데 {n}은 오히려 신이 났습니다. 강타!'],
    ace: ['{n}의 서브 에이스, 코트 안이 환해집니다!', '{n}, 에이스 뒤에 동료 전원과 손바닥을 부딪칩니다!'],
    block: ['막고 나서 먼저 소리 지르는 건 {n}입니다!', '{n}의 블로킹! 벤치까지 같이 뜁니다.'],
    error: ['{n}, 혀를 내밀며 미안하다는 손짓. 분위기는 안 죽습니다.', '{n}의 범실. 그래도 제일 먼저 웃는 사람은 본인입니다.'],
  },
  rock: {
    clutchKill: ['가장 필요한 순간에 가장 기본적인 스파이크. {n}, 해냅니다.', '{n}, 매일 하던 그대로. 클러치에서도 똑같이 때립니다.'],
    ace: ['매일 100개씩 넣던 그 서브. {n}, 에이스!', '{n}의 서브 에이스. 연습장에서 본 그 궤적입니다.'],
    block: ['자리를 지킨 사람이 벽이 됩니다. {n}의 블로킹 득점!', '{n}, 한 발도 늦지 않았습니다. 블로킹!'],
    error: ['{n}의 범실. 묵묵히 손을 들어 사과합니다.', '{n}, 실수 뒤에 바로 자세를 고쳐 잡습니다.'],
  },
  shy: {
    clutchKill: ['조용하던 {n}, 클러치에서 제일 큰 소리를 냈습니다!', '{n}, 떨리는 손으로 때렸는데 코스는 완벽했습니다!'],
    ace: ['{n}, 본인이 더 놀란 얼굴. 서브 에이스!', '{n}의 서브가 그대로 떨어집니다. 작게 주먹을 쥡니다.'],
    block: ['{n}, 눈을 질끈 감았지만 손은 정확했습니다. 블로킹 득점!', '{n}이 막았습니다! 동료들이 먼저 달려옵니다.'],
    error: ['{n}, 고개를 숙입니다. 동료들이 어깨를 두드립니다.', '{n}의 범실. 세터가 다가가 한마디 건넵니다.'],
  },
  show: {
    clutchKill: ['조명이 밝을수록 강해집니다. {n}, 클러치 강타!', '{n}, 모두가 보는 순간을 기다렸다는 듯 내리꽂습니다!'],
    ace: ['{n}, 서브 전에 관중석을 한 번 보고 갑니다. 에이스!', '{n}의 서브 에이스. 포즈까지 완벽합니다.'],
    block: ['우아하게 뛰어올라 막습니다. {n}의 블로킹 득점.', '{n}, 블로킹 뒤에 머리카락을 넘깁니다. 여유.'],
    error: ['{n}, 어깨를 으쓱. 다음 공은 더 세게 옵니다.', '{n}의 범실. 표정은 아직 무대 위입니다.'],
  },
};
/** 받침 유무로 조사를 고른다. 한글이 아니면 앞쪽(받침 없음)으로. */
export function josa(word, withBatchim, without) {
  const w = String(word || '');
  const ch = w.charCodeAt(w.length - 1);
  const has = ch >= 0xac00 && ch <= 0xd7a3 && ((ch - 0xac00) % 28) !== 0;
  return w + (has ? withBatchim : without);
}
const JOSA_PAIRS = { '은': ['은', '는'], '는': ['은', '는'], '이': ['이', '가'], '가': ['이', '가'], '을': ['을', '를'], '를': ['을', '를'], '과': ['과', '와'], '와': ['과', '와'] };
/** 템플릿의 {n} 을 이름으로 채운다. 바로 뒤에 조사(은/는·이/가·을/를·과/와)가 오면 받침에 맞게 바꾼다. */
export function fillName(text, name) {
  return String(text || '').replace(/\{n\}([은는이가을를과와])?/g, (m, j) => {
    if (!j) return name || '';
    const pair = JOSA_PAIRS[j];
    return josa(name || '', pair[0], pair[1]);
  });
}
/** 양념·서사용 짧은 이름 — 생성 선수의 "(육성 선수)"·"(영입)"·"(신인)" 꼬리와 "연습생 " 머리를 뗀다. */
export function shortName(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^연습생\s+/, '');
}
/** 아키타입·상황·이름으로 한 문장. seq 로 변형을 고른다(결정적). 없으면 빈 문자열. */
export function personalityQuip(arch, kind, name, seq) {
  const pool = QUIPS[arch] && QUIPS[arch][kind];
  if (!pool || !pool.length) return '';
  return fillName(pool[Math.abs(seq | 0) % pool.length], shortName(name));
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
    /** 성격 양념 — 선수 데이터에 personality 가 있을 때만. 없으면 빈 문자열(파리티 하네스의 최소 ctx 도 그대로 돈다). */
    quip(id, kind, seq) {
      if (id == null) return '';
      const pl = get(id);
      if (!pl || !pl.personality || !pl.personality.length) return '';
      return personalityQuip(archetypeOf(pl.personality), kind, pl.name, seq);
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
  let lastServer = null;

  for (const e of events) {
    if (e.type === EV.RallyStart) {
      if (buf.length > 0) { lines.push(buf); buf = ''; }
      rendered++;
      if (rendered > maxRallies) break;
    }
    if (e.type === EV.Serve) lastServer = e.playerId;
    let t = lineOf(e, c);
    if (t === null) continue;
    // 성격 양념(docs/world.md 6절): 클러치 강타·에이스·블로킹 득점·클러치 범실에만 붙인다. 줄 수는 늘리지 않는다.
    const q = quipFor(e, c, lastServer);
    if (q) t += ' ' + q;
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

function quipFor(e, c, lastServer) {
  switch (e.type) {
    case EV.Attack:
      if (e.outcome === OUT.Kill && e.clutch) return c.quip(e.playerId, 'clutchKill', e.seq);
      if (e.outcome === OUT.Error && e.clutch) return c.quip(e.playerId, 'error', e.seq);
      return '';
    case EV.Serve:
      return e.outcome === OUT.Error && e.clutch ? c.quip(e.playerId, 'error', e.seq) : '';
    case EV.Reception:
      return e.quality === Q.Error ? c.quip(lastServer, 'ace', e.seq) : '';
    case EV.Block:
      return e.outcome === OUT.BlockKill ? c.quip(e.playerId, 'block', e.seq) : '';
    default:
      return '';
  }
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
    case EV.Timeout:
      return `  ⏸ ${c.teamName(e.side)} 작전타임 — 상대 ${e.value}연속 득점을 끊습니다.`;
    case EV.SetEnd:
      return `[${e.value}세트 종료] ${c.teamName(e.side)} 세트 승리 (${e.homeScore}-${e.awayScore})`;
    case EV.MatchEnd:
      return `[경기 종료] ${c.teamName(e.side)} 승리! 세트 스코어 ${Math.floor(e.value / 10)}-${e.value % 10}`;
    default:
      return null;
  }
}
