// 육성 이벤트 카탈로그. TrainingEvent.cs 의 EventCatalog 전체를 텍스트까지 그대로 옮겼다.
import { STAT, STAT_NAMES_KO } from './domain.js';

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

/** TrainingEvent.cs:94 EventCatalog.Story */
export function storyEvent(index, pos, cfg) {
  const core = cfg.core3[pos];
  const ev = { kind: EVENT_KIND.Story, id: `story${index + 1}`, title: '', text: '', choices: [], oracleChoice: 0, supporterName: null };
  if (index === 0) {
    ev.title = '스토리 #1 · 입소 첫 주';
    ev.text = '숙소 불이 꺼진 뒤에도 잠들지 못한다. "제가 정말 여기 있어도 되는 걸까요."';
    ev.choices = [
      choice('네가 뽑힌 이유를 말해 준다', txt(hin(st(effect(), STAT.mental, 2), 1), '"…알겠습니다. 내일부터 제대로 할게요." 눈빛이 달라졌다.')),
      choice('일단 푹 자라고 한다', txt(con(effect(), 1), '다음 날 아침, 조금은 개운한 얼굴.')),
    ];
  } else if (index === 1) {
    ev.title = '스토리 #2 · 벽';
    ev.text = '같은 실수가 사흘째 반복된다. 공을 주우며 중얼거린다. "왜 안 되지…"';
    ev.choices = [
      choice('기본으로 돌아가자', txt(hin(st(st(effect(), core[1], 2), core[0], 1), 1), '가장 쉬운 공 100개. 소리가 조금씩 달라진다.')),
      choice('하루 쉬고 다시 보자', txt(st(effect(), STAT.mental, 2), '"…네." 다음 날, 표정이 조금 풀렸다.')),
    ];
  } else {
    ev.title = '스토리 #3 · 각오';
    ev.text = '최종 평가전을 앞두고 라커룸에 혼자 앉아 있다. "감독님, 저… 이길 수 있을까요."';
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
