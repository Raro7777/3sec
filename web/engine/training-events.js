// 육성 이벤트 카탈로그. TrainingEvent.cs 의 EventCatalog 전체를 텍스트까지 그대로 옮겼다.
import { STAT, STAT_NAMES_KO } from './domain.js';
import { archetypeOf, fillName, josa } from './commentary.js';

export const EVENT_KIND = { Story: 0, Senior: 1, Random: 2, Bond: 3 };

/** TrainingEvent.cs:8 EventEffect */
export function effect() {
  return { statGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], fatigue: 0, condition: 0, hint: 0, resultText: '' };
}
const st = (e, k, v) => { e.statGains[k] += v; return e; };
const fat = (e, v) => { e.fatigue += v; return e; };
const con = (e, v) => { e.condition += v; return e; };
const hin = (e, v) => { e.hint += v; return e; };
const txt = (e, t) => { e.resultText = t || ''; return e; };

/** 효과 요약 배지. TrainingEvent.cs:23 Badge */
export function effectBadge(e) {
  const parts = [];
  for (let i = 0; i < 10; i++) {
    if (Math.abs(e.statGains[i]) > 1e-9) {
      parts.push(`${STAT_NAMES_KO[i]} ${e.statGains[i] > 0 ? '+' : ''}${trimNum(e.statGains[i])}`);
    }
  }
  if (Math.abs(e.fatigue) > 1e-9) parts.push(`피로 ${e.fatigue > 0 ? '+' : ''}${e.fatigue}`);
  if (e.condition !== 0) parts.push(`컨디션 ${e.condition > 0 ? '+' : ''}${e.condition}`);
  if (e.hint !== 0) parts.push(`힌트 ${e.hint > 0 ? '+' : ''}${e.hint}`);
  return parts.length === 0 ? '효과 없음' : parts.join(', ');
}
function trimNum(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1); }

function choice(label, onSuccess, successRate = 1.0, onFail = null) {
  return { label, successRate, onSuccess, onFail, isBranch: successRate < 1.0 };
}

/**
 * 카드 스토리 3컷(docs/training-mode.md 6.3) — 캠프 초·중·후반의 단면. 텍스트는 카드의 성격 아키타입(commentary.js)으로
 * 갈라지고, 선택지·효과는 아키타입과 무관하게 같다(TrainingEvent.cs 원본 그대로 → 육성 캘리브레이션 불변).
 */
const STORY_TEXT = {
  fire: [
    '"감독님, 저 여기서 제일 세지려고 왔어요." 첫날부터 공을 제일 많이 때린 사람은 {n}이다. 그런데 밤에는 혼자 발목을 만지고 있다.',
    '같은 코스로 세 번 막혔다. {n}은 더 세게 때리는 것으로 답한다. 손목이 붉다. "한 번만 더요."',
    '최종 평가전 전날. {n}은 테이핑을 두 겹으로 감았다. "감독님, 저 내일 이길 수 있을까요." 처음 듣는 질문이다.',
  ],
  ice: [
    '{n}은 첫날 캠프 일정표를 전부 외웠다. "쓸데없는 훈련이 셋 있네요." 말투는 차갑지만 노트는 빼곡하다.',
    '수치는 다 맞는데 공이 안 넘어간다. {n}이 처음으로 노트를 덮었다. "…계산이 아닌 것 같아요."',
    '{n}이 상대 팀 분석 노트를 건넸다. 마지막 장에 한 줄. "그래도 떨립니다." 글씨가 조금 흔들렸다.',
  ],
  sun: [
    '첫날부터 숙소가 시끄럽다. {n}이 전원의 이름을 외우고 별명까지 붙였다. 정작 본인 침대 위에는 아직 못 푼 가방.',
    '{n}이 사흘째 같은 실수를 한다. 웃음은 그대로인데 목소리가 작아졌다. 숙소 불이 늦게 꺼진다.',
    '평가전 전날 숙소가 조용하다. {n}이 제일 먼저 잠자리에 들었다. 불 꺼진 뒤 작게, "…이기고 싶다."',
  ],
  rock: [
    '{n}은 제일 먼저 체육관에 와서 제일 늦게 나간다. "잘하는 게 아니라, 오래 하는 거예요." 손바닥에 벌써 굳은살.',
    '{n}은 안 되는 걸 횟수로 이긴다고 믿었다. 공 300개째, 처음으로 멈춰 섰다. "…왜 안 되지."',
    '{n}은 마지막 날에도 같은 100개를 때렸다. 라커룸에서 혼자 앉아 있다. "감독님, 저… 이길 수 있을까요."',
  ],
  shy: [
    '{n}은 사흘째 말을 거의 안 했다. 그런데 남이 놓친 공은 전부 {n}이 주워 온다. "…제가 정말 여기 있어도 되는 걸까요."',
    '실수 뒤에 {n}이 먼저 사과한다. 열 번째 사과에서 코치가 손을 들었다. "사과 말고 공을 봐."',
    '{n}이 처음으로 먼저 말을 걸었다. "감독님… 저, 내일 세게 때려도 돼요?" 눈은 바닥이지만 주먹은 쥐어져 있다.',
  ],
  show: [
    '{n}은 첫 훈련부터 시선을 모은다. 본인도 안다. "잘 보이는 자리에서 하는 게 편해요." 그런데 실수 뒤의 표정은 아무도 못 봤다.',
    '관중 없는 체육관에서 {n}의 공이 죽는다. "보는 사람이 없으면 이상하게 힘이 안 들어가요." 본인도 당황한 얼굴.',
    '{n}이 거울 앞에서 표정을 연습한다. 이기는 표정, 지는 표정. "지는 표정은 안 쓸 거예요." 그리고 조용히, "…쓸 수도 있겠죠."',
  ],
};
const STORY_GENERIC = [
  '숙소 불이 꺼진 뒤에도 잠들지 못한다. "제가 정말 여기 있어도 되는 걸까요."',
  '같은 실수가 사흘째 반복된다. 공을 주우며 중얼거린다. "왜 안 되지…"',
  '최종 평가전을 앞두고 라커룸에 혼자 앉아 있다. "감독님, 저… 이길 수 있을까요."',
];
export function storyText(index, card) {
  const i = Math.max(0, Math.min(2, index | 0));
  if (!card || !card.name || !card.personality || !card.personality.length) return STORY_GENERIC[i];
  return fillName(STORY_TEXT[archetypeOf(card.personality)][i], card.name);
}

/** TrainingEvent.cs:94 EventCatalog.Story — card 가 있으면 성격에 맞는 텍스트, 효과는 동일. */
export function storyEvent(index, pos, cfg, card) {
  const core = cfg.core3[pos];
  const ev = { kind: EVENT_KIND.Story, id: `story${index + 1}`, title: '', text: storyText(index, card), choices: [], oracleChoice: 0, supporterName: null };
  if (index === 0) {
    ev.title = '스토리 #1 · 입소 첫 주';
    ev.choices = [
      choice('네가 뽑힌 이유를 말해 준다', txt(hin(st(effect(), STAT.mental, 2), 1), '"…알겠습니다. 내일부터 제대로 할게요." 눈빛이 달라졌다.')),
      choice('일단 푹 자라고 한다', txt(con(effect(), 1), '다음 날 아침, 조금은 개운한 얼굴.')),
    ];
  } else if (index === 1) {
    ev.title = '스토리 #2 · 벽';
    ev.choices = [
      choice('기본으로 돌아가자', txt(hin(st(st(effect(), core[1], 2), core[0], 1), 1), '가장 쉬운 공 100개. 소리가 조금씩 달라진다.')),
      choice('하루 쉬고 다시 보자', txt(st(effect(), STAT.mental, 2), '"…네." 다음 날, 표정이 조금 풀렸다.')),
    ];
  } else {
    ev.title = '스토리 #3 · 각오';
    ev.choices = [
      choice('네 무기를 믿어라', txt(hin(st(st(effect(), core[0], 2), STAT.mental, 1), 1), '고개를 끄덕인다. "제 무기, 알고 있어요."')),
      choice('져도 괜찮다', txt(con(st(effect(), core[1], 1), 1), '"…그래도 이기고 싶어요." 웃는다.')),
    ];
  }
  return ev;
}

/** TrainingEvent.cs:122 EventCatalog.Senior */
export function seniorEvent(supporterName, tag, signature, cfg) {
  const stat = cfg.trainingStats[signature][0];
  const statName = STAT_NAMES_KO[stat];
  const ev = { kind: EVENT_KIND.Senior, id: 'senior', title: '', text: '', choices: [], oracleChoice: 0, supporterName };
  const rival = !!tag && tag.indexOf('라이벌') >= 0;
  const alumni = !!tag && tag.indexOf('동문') >= 0;
  if (rival) {
    ev.title = `선배 이벤트 · ${supporterName}의 도발`;
    ev.text = `${supporterName} 선배가 팔짱을 끼고 본다. "그 정도 ${statName}로 이기겠어? 더 해 봐."`;
  } else if (alumni) {
    ev.title = `선배 이벤트 · 동문 ${supporterName}`;
    ev.text = `같은 구단 출신 ${supporterName} 선배가 캠프에 들렀다. "네 ${statName}, 예전 내 폼이랑 똑같네. 하나만 고치자."`;
  } else {
    ev.title = `선배 이벤트 · ${supporterName}`;
    ev.text = `${supporterName} 선배가 ${statName} 폼을 봐주겠다고 한다.`;
  }
  ev.choices = [
    choice('배운다', txt(hin(st(effect(), stat, cfg.seniorEventGain), 1), '손목 각도 하나. 공 소리가 달라졌다.')),
    choice('지금 방식대로', txt(st(st(effect(), stat, 1), STAT.mental, 1), '"…나중에 후회한다?" 웃으며 공을 던져 준다.')),
  ];
  return ev;
}

/** TrainingEvent.cs:150 RandomStatBranch */
export function randomStatBranchEvent(stat, cfg) {
  const n = STAT_NAMES_KO[stat];
  return {
    kind: EVENT_KIND.Random, id: 'rand-branch-' + stat, title: `${n} 응용 훈련`,
    text: `코치가 ${n} 응용 훈련을 제안한다. 지금 폼을 바꾸면 흔들릴 수도 있다.`,
    choices: [
      choice('도전한다',
        txt(st(effect(), stat, cfg.eventBranchGain), '30분 만에 소리가 달라졌다.'),
        cfg.eventBranchSuccessP,
        txt(con(effect(), -1), '폼이 흔들린다. "…원래대로 돌아갈게요."')),
      choice('기본기대로', txt(st(effect(), stat, 1), '"제 방식이 있어요." 고집도 재능이다.')),
    ],
    oracleChoice: 0, supporterName: null,
  };
}

/** TrainingEvent.cs:167 RandomStat */
export function randomStatEvent(stat, v) {
  const n = STAT_NAMES_KO[stat];
  return {
    kind: EVENT_KIND.Random, id: 'rand-stat-' + stat, title: `${n}, 감이 왔다`,
    text: `훈련 중 ${n}에서 "됐다" 싶은 순간이 왔다. 오늘은 이걸 붙잡을까.`,
    choices: [
      choice('집중한다', txt(st(effect(), stat, v), '공 100개를 더 때리고 나서야 체육관을 나왔다.')),
      choice('평소대로', txt(st(effect(), STAT.mental, 1), '"내일도 될 거예요." 차분하다.')),
    ],
    oracleChoice: 0, supporterName: null,
  };
}

/** TrainingEvent.cs:177 RandomFatigue */
export function randomFatigueEvent(d) {
  const ev = { kind: EVENT_KIND.Random, id: 'rand-fatigue' + d, title: '', text: '', choices: [], oracleChoice: 0, supporterName: null };
  if (d <= -15) {
    ev.title = '구단 온천 휴가';
    ev.text = '구단에서 하루 온천 휴가를 보내 줬다. 본인은 훈련장에 남고 싶어 한다.';
    ev.choices = [
      choice('다녀오게 한다', txt(fat(effect(), d), '돌아온 얼굴이 하루 사이에 가벼워졌다.')),
      choice('남는 걸 허락한다', txt(st(effect(), STAT.mental, 1), '텅 빈 체육관에서 혼자 서브를 넣는다.')),
    ];
  } else if (d < 0) {
    ev.title = '빗속의 러닝';
    ev.text = '새벽부터 폭우. 예정된 외부 러닝을 강행할지 결정해야 한다.';
    ev.choices = [
      choice('실내 스트레칭', txt(fat(effect(), d), '매트 위에서 조용한 오전. 몸이 가볍다.')),
      choice('강행한다', txt(fat(st(effect(), STAT.stamina, 1), 5), '흠뻑 젖은 채 웃는다. "이 정도는 괜찮아요."')),
    ];
  } else {
    ev.title = '야간 자율 훈련';
    ev.text = '훈련이 끝났는데 체육관 불이 켜져 있다. 혼자 공을 때리고 있다.';
    ev.choices = [
      choice('같이 남는다', txt(fat(effect(), d), "'감독님, 토스 좀요!' 밤 10시까지 이어진 연습.")),
      choice('그만 쉬게 한다', txt(st(fat(effect(), -10), STAT.mental, 1), "'…네.' 아쉬운 얼굴로 공을 정리한다.")),
    ];
  }
  return ev;
}

/** TrainingEvent.cs:203 RandomCondition */
export function randomConditionEvent(d) {
  const ev = { kind: EVENT_KIND.Random, id: 'rand-cond' + d, title: '', text: '', choices: [], oracleChoice: 0, supporterName: null };
  if (d > 0) {
    ev.title = '첫 팬레터';
    ev.text = '구단 앞으로 첫 팬레터가 왔다. 답장을 어떻게 할까.';
    ev.choices = [
      choice('구단이 대신', txt(con(effect(), d), "'…다음엔 제가 쓸게요.' 살짝 붉어진 얼굴.")),
      choice('직접 쓰게 한다', txt(fat(st(effect(), STAT.mental, 2), 5), '세 번을 고쳐 쓰고 나서야 봉투를 닫았다.')),
    ];
  } else {
    ev.title = '감기 기운';
    ev.text = '아침부터 목이 잠겼다. 본인은 괜찮다는데.';
    ev.choices = [
      choice('약 먹고 버틴다', txt(con(effect(), d), '훈련은 했지만 하루 종일 멍한 얼굴.')),
      choice('병원에 보낸다', txt(fat(effect(), 5), '주사 한 대. 저녁엔 목소리가 돌아왔다.')),
    ];
  }
  return ev;
}

/** 행동별 플레이버 텍스트. TrainingEvent.cs:222 Flavor / FlavorOf */
const FLAVOR = [
  ['서브 100개. 라인 안에 꽂힌다.', '토스 없이 혼자 서브 반복.', '배짱 서브 연습. 실패해도 웃는다.'],
  ['낮은 자세로 공을 받아낸다.', '긴 랠리 수비 훈련. 무릎이 검게 됐다.', '코트 바닥과 친해지는 하루.'],
  ['판단력 훈련. 눈이 빨라졌다.', '잔발 스텝 반복.', '세터 코치와 1:1 토스.'],
  ['점프, 점프, 또 점프.', '오픈 강타 100개.', '타점이 조금 올라갔다.'],
  ['손끝 반응 훈련.', '네트 앞 사이드스텝 반복.', '블로킹 타이밍이 몸에 붙는다.'],
  ['휴식. 아이스팩과 낮잠.', '휴식. 숙소에서 만화책.', '휴식. 산책과 이른 취침.'],
  ['특훈! 코치가 열의를 알아봤다.', '특훈. 오늘은 쓰러질 때까지.', '특훈. 프로 선배의 메뉴 그대로.'],
  ['치료. 트레이너실에서 하루.', '치료. 얼음찜질과 재활.', '치료. 붕대를 감은 채 관전.'],
];

export function flavorOf(action, turn) {
  if (action < 0 || action >= FLAVOR.length) return '';
  const pool = FLAVOR[action];
  return pool[(turn * 7 + action * 3) % pool.length];
}

/**
 * 인연 순간(docs/training-mode.md 6.4, T7). 서포터 중 동문·라이벌이 있으면 그 사람과의 장면 하나.
 * **효과도 난수도 없다** — 선택지 없이 피드에 흐르는 서사라 육성 캘리브레이션이 그대로다. 효과는 하네스로 정한 뒤 붙인다.
 */
export function bondMoment(support, traineeName) {
  if (!support || !support.supporters || !support.supporters.length) return null;
  let pick = -1, kind = '';
  for (let i = 0; i < support.supporters.length; i++) {
    const tag = support.tags[i] || '';
    if (tag.indexOf('동문') >= 0) { pick = i; kind = 'alumni'; break; }
    if (pick < 0 && tag.indexOf('라이벌') >= 0) { pick = i; kind = 'rival'; }
  }
  if (pick < 0) return null;
  const s = support.supporters[pick].name, n = traineeName || '';
  const text = kind === 'alumni'
    ? `동문 ${s} 선배가 훈련 뒤 ${josa(n, '을', '를')} 불렀다. "네가 뛰던 코트, 나도 알아." 밤늦게까지 이어진 이야기. 다음 날 ${n}의 발이 조금 가벼웠다.`
    : `라이벌 구단 출신 ${s} 선배가 네트 건너편에 섰다. "우리 팀이 왜 너희를 싫어했는지 알려 줄게." 그날 ${n}의 서브는 유난히 세게 들어갔다.`;
  return { kind, supporterName: s, supporterId: support.supporters[pick].id, title: (kind === 'alumni' ? '인연 · 동문 ' : '인연 · 라이벌 ') + s, text };
}

