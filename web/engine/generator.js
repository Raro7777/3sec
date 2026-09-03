// 시드 기반 랜덤 선수/팀 생성기. Data/RandomPlayerGenerator.cs 포팅.
// 파리티 하네스의 "동급 랜덤 팀"과 게임의 연습생·평가전 상대 생성에 쓴다.

import { POS, RARITY, makePlayer, statAverage, autoLineupFromRoster, makeTeamState } from './domain.js';
import { Rng } from './rng.js';
import { clamp, roundHalfEven } from './mathx.js';

export const DEFAULT_OVERALL = 67.0;   // RandomPlayerGenerator.cs:14
export const DEFAULT_SPREAD = 6.0;

// 순서: serve, receive, set, spike, block, dig, speed, power, stamina, mental — RandomPlayerGenerator.cs:18
const PROFILES = [
  /* S  */[62, 58, 82, 50, 58, 66, 70, 52, 68, 72],
  /* OH */[68, 72, 52, 74, 62, 66, 70, 68, 70, 64],
  /* OP */[70, 52, 48, 78, 64, 55, 64, 76, 66, 64],
  /* MB */[58, 45, 45, 70, 78, 50, 62, 70, 64, 62],
  /* L  */[40, 82, 60, 30, 30, 82, 78, 45, 72, 66],
];
const HEIGHT_MEAN = [174, 177, 180, 184, 166]; // S, OH, OP, MB, L

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN = ['서', '연', '지', '민', '수', '하', '은', '유', '예', '아', '채', '윤', '다', '현', '소', '진', '나', '희', '영', '주', '빈', '린', '슬', '혜', '정', '미', '율', '가', '온', '별'];
const HAIR_STYLES = ['포니테일', '숏컷', '단발', '긴 생머리', '트윈테일', '땋은 머리', '웨이브 단발'];
const HAIR_COLORS = ['흑발', '다크브라운', '밤색', '애쉬브라운', '적갈색', '은발'];
const EYE_COLORS = ['갈색', '다크브라운', '회색', '청록', '호박색'];
const BODY_TYPES = ['슬림', '탄탄한', '장신', '다부진', '민첩한'];
const PERSONALITIES = ['승부욕', '차분함', '낙천적', '완벽주의', '리더십', '수줍음', '장난기', '성실함', '냉정함', '열정적'];
const SKILL_NAMES = [
  ['실크 토스', '판을 읽는 눈', '속공 지휘'],
  ['천장 공격', '클러치 스파이크', '철벽 리시브'],
  ['대포알 백어택', '파워 서브', '라이트 폭격'],
  ['철벽 블로킹', '번개 속공', '이동 공격'],
  ['코트의 수호자', '다이빙 디그', '안정 리시브'],
];

/** 정규 근사(균등 3개 합). 평균 0, 표준편차 1. RandomPlayerGenerator.cs:59 */
function gauss(rng) {
  return (rng.nextDouble() + rng.nextDouble() + rng.nextDouble() - 1.5) * 2.0;
}

export function randomName(rng) {
  return SURNAMES[rng.nextInt(SURNAMES.length)] + GIVEN[rng.nextInt(GIVEN.length)] + GIVEN[rng.nextInt(GIVEN.length)];
}

/** RandomPlayerGenerator.cs:72 GeneratePlayer */
export function generatePlayer(rng, id, teamId, pos, jersey, overall = DEFAULT_OVERALL, spread = DEFAULT_SPREAD) {
  const prof = PROFILES[pos];
  const delta = overall - DEFAULT_OVERALL;
  const stats = new Array(10);
  for (let i = 0; i < 10; i++) {
    stats[i] = clamp(roundHalfEven(prof[i] + delta + gauss(rng) * spread), 20, 99);
  }
  const potential = new Array(10);
  for (let i = 0; i < 10; i++) {
    potential[i] = clamp(stats[i] + 3 + rng.nextInt(13), 0, 100);
  }
  const height = roundHalfEven(HEIGHT_MEAN[pos] + gauss(rng) * 4.0);
  const avg = statAverage(stats);
  const rarity = avg >= 74 ? RARITY.SSR : (avg >= 68 ? RARITY.SR : (avg >= 60 ? RARITY.R : RARITY.N));
  const name = randomName(rng);
  const age = 19 + rng.nextInt(12);
  const skillName = SKILL_NAMES[pos][rng.nextInt(3)];
  const personality = [
    PERSONALITIES[rng.nextInt(10)], PERSONALITIES[rng.nextInt(10)], PERSONALITIES[rng.nextInt(10)],
  ];
  const appearance = {
    hairStyle: HAIR_STYLES[rng.nextInt(HAIR_STYLES.length)],
    hairColor: HAIR_COLORS[rng.nextInt(HAIR_COLORS.length)],
    eyeColor: EYE_COLORS[rng.nextInt(EYE_COLORS.length)],
    bodyType: BODY_TYPES[rng.nextInt(BODY_TYPES.length)],
  };
  const p = makePlayer({
    id, name, teamId, pos, rarity, jersey, heightCm: height, age,
    stats, potential, skillName, skillDesc: '(프로토타입: 판정 미반영)',
  });
  p.personality = personality;
  p.appearance = appearance;
  return p;
}

const TEAM_PLAN = [POS.S, POS.OH, POS.OH, POS.OP, POS.MB, POS.MB, POS.L, POS.S, POS.OH, POS.OH, POS.OP, POS.MB];

/** 12인 로스터 + 표준 5-1 자동 라인업. RandomPlayerGenerator.cs:135 GenerateTeamState */
export function generateTeamState(seed, teamId, teamName, overall = DEFAULT_OVERALL, spread = DEFAULT_SPREAD, opts) {
  const rng = new Rng(seed);
  const team = {
    id: teamId, name: teamName, city: '가상시',
    colors: { primary: '#3355AA', secondary: '#FFFFFF' },
    emblemConcept: '', identity: '', homeArena: teamName + ' 체육관',
  };
  const roster = new Array(TEAM_PLAN.length);
  for (let i = 0; i < TEAM_PLAN.length; i++) {
    roster[i] = generatePlayer(rng, `${teamId}-p${String(i + 1).padStart(2, '0')}`, teamId, TEAM_PLAN[i], i + 1, overall, spread);
  }
  return makeTeamState(team, roster, autoLineupFromRoster(roster), opts);
}
