// 신인 세대 생성기 — 매 시즌 스카우트 명단에 합류하는 새 카드를 만든다.
// 명세: docs/rookies.md · 규칙 원본: docs/world.md 6절(네이밍·외형)·docs/GDD.md 2절(희귀도·스탯)
//       · docs/league-and-economy.md A.3.6(노화·세대교체)·A.3.6.6(카드 풀 고갈)
//
// 설계 요약
//  - **결정적**: (계정 시드, 시즌)에서만 파생한다. Math.random() 을 쓰지 않고,
//    세이브에 카드를 저장하지 않는다 — 불러올 때 같은 시드로 다시 만들면 같은 세대가 나온다.
//  - **세계를 순서대로 쌓는다**: 시즌 1→N 을 차례로 돌면서 ① 그 시즌의 신인 클래스를 만들고
//    ② 6구단의 42개 슬롯에 세대교체(승계)를 적용한다. 시즌 s 의 결과는 s−1 까지의 결과에만
//    의존하므로 재귀가 성립하고, 캐시를 뒤로만 늘리면 된다.
//  - **엔진 비의존**: 노화 규칙(전성기·은퇴)은 호출자(game.js)가 주입한다 → 순환 import 없음.
//  - **손으로 만든 카드 우선**: `data/players.json` 에 `debutSeason` 이 붙은 카드가 있으면
//    그 시즌의 정원을 먼저 채우고, 생성 카드는 남은 자리만 메운다(docs/rookies.md 7절).

import { POS, POS_CODES, RARITY, RARITIES, makePlayer, clampStat, statAverage } from './domain.js';
import { Rng, mixSeed } from './rng.js';
import { roundHalfEven } from './mathx.js';
import { SKILLS } from './skills.js';

// ---------------------------------------------------------------- 튜닝 상수
export const ROOKIES = {
  /**
   * 첫 신인 세대가 합류하는 시즌. 시즌 1~3 은 초반 경험 보호 구간이라 손대지 않는다
   * (A.3.6 이 "시즌 1~3 에는 은퇴자가 없다"로 잡아 둔 구간과 같은 경계).
   * → 시즌 1~3 의 스카우트 풀·난이도 목표 7개는 비트 단위로 그대로다.
   */
  firstSeason: 4,
  /** 시즌당 신규 카드 수. 은퇴 속도(시즌 8~15 평균 5.0명/시즌)와 균형을 맞춘 값 — docs/rookies.md 3절. */
  perSeason: 5,
  /** 신인 데뷔 나이(가중치). 어리게 뽑아 "몇 시즌 쓸 수 있는가" 축을 살린다. */
  debutAges: [18, 19, 19, 20],
  /**
   * 희귀도 배분 주머니(12장 주기). SSR 3 / SR 4 / R 5 = 25 / 33.3 / 41.7%
   * — 런칭 42명의 10/14/18 = 23.8 / 33.3 / 42.9% 와 거의 같다.
   * 스카우트는 희귀도를 먼저 뽑고 그 안에서 균등 추첨하므로, 이 비율이 어긋나면
   * 시즌이 갈수록 특정 희귀도 칸이 말라 버린다.
   */
  rarityBag: [RARITY.SSR, RARITY.R, RARITY.SR, RARITY.R, RARITY.SR, RARITY.R,
    RARITY.SSR, RARITY.R, RARITY.SR, RARITY.R, RARITY.SSR, RARITY.SR],
  /** 신인 초기치 = 같은 (희귀도·포지션) 런칭 카드 평균 − 이 값. 신인이 런칭 카드보다 세지 않게 하는 장치. */
  levelMargin: 1.5,
  levelJitter: 1.0,       // 위 값에 얹는 표준편차
  levelMaxDrop: 4.5,      // 평균 대비 최대 하락폭(이보다 약해지지 않는다)
  statNoiseSd: 2.4,       // 스탯 개별 노이즈
  potNoiseSd: 1.6,        // 잠재력 델타 노이즈
  potDeltaMin: 15,        // world.md 6.3 체크리스트: potential = 초기치 + 15~30
  potDeltaMax: 30,
  statMin: 15,
  statMax: 84,            // 런칭 최대치 85 미만 — 개별 스탯도 런칭 카드를 넘지 않는다
  /** AI 구단 슬롯을 물려받은 신인도 고유 스킬을 쓴다(런칭 SSR·SR 과 같은 규칙, skills.md 7.2). */
  clubSkill: true,
  /**
   * 다만 **레벨은 주전 연차로 오른다.** skills.md 7.2 가 원소속 SSR·SR 에게 Lv2~3 을 준 근거는
   * "이미 그 스킬로 리그에서 이름을 낸 완성형 주전"이라는 것인데, 갓 슬롯을 물려받은 신인은
   * 그 설명에 해당하지 않는다. 주전 1~2년차 Lv1 · 3~4년차 Lv2 · 5년차부터 Lv3
   * (상한은 그 시즌의 CLUB_SKILL_LEVEL). 플레이어가 힌트로 Lv1→3 을 쌓는 것과 같은 속도다.
   */
  clubSkillByTenure: [1, 1, 2, 2, 3],
  /** 파스텔·원색 헤어는 구단당 이 수까지(world.md 6.2). */
  vividPerClub: 2,
};

// ---------------------------------------------------------------- 이름 풀 (world.md 6.1)
/**
 * 성 — 런칭 42명이 쓴 42개 성과 겹치지 않고, 최상위 흔한 성(김·이·박·최·정)을 피한다.
 * "이름만으로 캐릭터가 구분되도록 흔하지 않은 성을 우선"이라는 6.1-① 을 그대로 옮긴 것.
 */
export const SURNAMES = [
  '견', '경', '계', '고', '곽', '권', '금', '길', '나', '단', '담', '당', '대', '돈', '동', '두',
  '라', '만', '매', '맹', '목', '묵', '민', '배', '범', '변', '보', '복', '부', '빈', '빙', '사',
  '삼', '상', '선', '성', '송', '수', '순', '승', '시', '안', '양', '어', '염', '영', '예', '오',
  '온', '용', '운', '원', '육', '윤', '은', '음', '자', '장', '전', '제', '조', '좌', '지', '차',
  '창', '초', '추', '태', '판', '평', '표', '피', '함', '해', '허', '형', '호', '화', '황', '후',
];

/**
 * 이름 — 순우리말·자연어 계열 2음절(6.1-②). 런칭 42명의 이름과 겹치지 않고,
 * 6.1-③ 회피 목록(연경·재영·다영·희진·정아·효진·소휘·소영·승주·수지·송이·연주·지윤·주아·
 * 세빈·유나·지영·해란·명옥·혜선·다인·원정·은진·호영 등)에 닿지 않는다.
 * 음절을 기계적으로 조합하면 어색한 결과가 섞이므로, 조합 결과를 확정해 목록으로 고정했다.
 */
export const GIVEN_NAMES = [
  '가람', '가온', '가율', '가을', '겨울', '고운', '그루', '그린', '나래', '나린', '나봄', '나비',
  '나슬', '나울', '나은', '늘봄', '늘해', '다솔', '다솜', '다슬', '다예', '다올', '단하', '도담',
  '도란', '도아', '두나', '두리', '들해', '라온', '로울', '마루', '마음', '모람', '모아', '미르',
  '미리', '미슬', '바다', '바람', '바로', '바림', '바오', '벼리', '별솔', '보늬', '보람', '봄결',
  '봄빛', '봄이', '부나', '부루', '빛나', '새길', '새나', '새라', '새롬', '새힘', '서리', '서율',
  '선하', '소담', '소이', '솔미', '솔비', '솔이', '시내', '시울', '신비', '아라', '아람', '아울',
  '아윤', '아침', '애슬', '여름', '여리', '열음', '예솔', '예온', '오늘', '오름', '오솔', '온별',
  '온새', '온하', '우리', '우주', '윤나', '은결', '은별', '은솔', '은유', '이랑', '이레', '이설',
  '이오', '자람', '잔디', '지새', '참나', '초록', '초롱', '초아', '초하', '하나', '하늘', '하늬',
  '하랑', '하리', '하봄', '하솔', '하솜', '하연', '한별', '한샘', '한솔', '한아', '한울', '해나',
  '해든', '해린', '해별', '해솔', '해솜', '해온', '해울', '햇살', '호야', '흰나', '힘찬',
];

// ---------------------------------------------------------------- 외형 풀 (world.md 6.2 · art-style-guide 1.3)
/** 헤어스타일 — 런칭 42명이 쓰는 값을 그대로 재사용한다(새 아트 스펙을 만들지 않는다). */
export const HAIR_STYLES = [
  '롱 하이 포니테일', '픽시 숏컷', '로우 포니테일', '숏 보브', '일자 뱅 단발', '트윈 번',
  '사이드 브레이드', '안쪽 컬 숏 보브', '롱 싱글 브레이드', '하프업 미디엄', '롱 스트레이트',
  '로우 트윈테일', '울프컷 미디엄', '픽시 숏컷 정돈형', '사이드 포니테일 미디엄', '하이 번',
  '헤어밴드 롱 스트레이트', '시스루 뱅 단발', '미디엄 웨이브', '프렌치 브레이드', '짧은 트윈테일',
  '사이드 뱅 레이어드 미디엄', '크롭 숏컷', '미디엄 하이 포니테일', '롱 웨이브', '턱선 단발 보브',
  '트윈 브레이드', '사이드 핀 픽시 숏컷', '히메컷 롱 스트레이트', '아시메트릭 보브',
  '롱 웨이브 로우 포니테일', '커튼 뱅 미디엄 스트레이트', '귀 뒤로 넘긴 단발 보브',
  '짧은 사이드 포니테일', '컬리 숏', '레이어드 숏 보브', '스포츠 하이 포니테일',
  '롱 웨이브 하프업', '웨이비 보브', '풀어 내린 롱 스트레이트', '로우 번', '컬리 보브',
];
/** 자연색 계열 — 인원 제한 없음. */
export const HAIR_COLORS_NATURAL = [
  '블랙', '다크 브라운', '체스트넛 브라운', '라이트 브라운', '애쉬 브라운', '애쉬 그레이',
  '차콜 그레이', '로즈 브라운', '밀크티 베이지', '골든 브라운', '허니 블론드', '오번',
  '플래티넘 블론드', '와인 레드',
];
/** 파스텔·원색 계열 — 구단당 ROOKIES.vividPerClub 명까지(world.md 6.2). */
export const HAIR_COLORS_VIVID = [
  '민트 그린', '네이비 블루', '화이트', '화이트 실버', '코랄 핑크', '크림슨 레드',
  '선셋 오렌지', '라벤더 퍼플', '스카이 블루', '피치 핑크',
];
export const EYE_COLORS = [
  '바이올렛', '다크 그레이', '헤이즐', '그레이 블루', '다크 브라운', '골드', '앰버', '딥 블루',
  '그린', '그레이', '브라운', '라이트 블루', '아이스 블루', '다크 그린', '마젠타', '오렌지 앰버',
  '레드 브라운', '실버 그레이', '딥 그린', '블루',
];
/** 체형 — 포지션별 신장 경향이 실루엣에 남게 한다(GDD 9.1 3중 구분). */
const BODY_TYPES = [
  /* S  */['표준 슬림', '표준 균형형', '표준 애슬레틱', '표준'],
  /* OH */['표준 애슬레틱', '장신 슬림', '표준 균형형', '장신 균형형', '표준'],
  /* OP */['장신 슬림 애슬레틱', '장신 근육질', '장신 애슬레틱', '장신 균형형'],
  /* MB */['장신 균형형', '최장신 탄탄한 체형', '장신 마른 체형', '장신 근육질', '장신'],
  /* L  */['단신 민첩', '단신 다부진 체형', '표준 마른 체형'],
];
const PERSONALITIES = [
  '승부욕', '침착', '성실', '엉뚱', '낙천', '활발', '수다쟁이', '냉정', '관찰력', '책임감',
  '후배 챙김', '온화', '꼼꼼', '걱정 많음', '지적', '차분', '독서광', '씩씩', '부끄럼', '무뚝뚝',
  '의리', '순수', '노력파', '겁 많음', '든든함', '은근한 장난기', '호승심', '직진', '큰 목소리',
  '쿨함', '고양이 집사', '계획적', '조용함', '명랑', '덜렁', '간식 애호', '느긋', '마이페이스',
  '식물 키우기', '겁 없음', '호쾌', '리더십', '우직', '손재주', '승부사', '직설', '열정',
  '정 많음', '순둥이', '배려', '유머', '말수 적음', '우아', '여유', '온순', '예의 바름',
  '수줍음', '만화 애호', '리액션 부자', '노래', '자유분방', '직감', '도전', '밝음', '사진 애호',
  '요리', '그림', '털털', '웃음 많음', '응석', '막내', '대식가', '메모광',
];

// ---------------------------------------------------------------- 스탯 프로파일 (data/players.json 42명 실측)
/**
 * (희귀도 × 포지션) 별 초기치 평균 프로파일. 순서는 STAT 인덱스
 * [serve, receive, set, spike, block, dig, speed, power, stamina, mental].
 * 문서 값이 아니라 **실제 데이터에서 뽑은 값**이다(CLAUDE.md "문서와 데이터가 다르면 데이터 기준").
 * R/S 만 런칭 로스터에 표본이 없어 SR/S 를 R 수준(−9.4)으로 내려 채웠다.
 */
const PROFILE = {
  [RARITY.R]: {
    [POS.S]: [43, 43, 61, 32, 38, 46, 49, 36, 49, 54],
    [POS.OH]: [43.7, 51.4, 40.6, 50.6, 43.7, 49.4, 52.9, 46.9, 51.7, 44],
    [POS.OP]: [50, 34, 34, 58, 48, 36, 48, 60, 50, 42],
    [POS.MB]: [37.7, 32, 36, 49, 56, 34.7, 48.3, 51.7, 50, 42],
    [POS.L]: [33, 59, 45, 25, 21, 60, 62, 33, 52, 44.5],
  },
  [RARITY.SR]: {
    [POS.S]: [52.3, 52, 71.5, 41, 47, 55.5, 58.5, 45, 58.5, 64],
    [POS.OH]: [68, 51, 42, 66, 50, 51, 62, 63, 60, 53],
    [POS.OP]: [60.7, 42.7, 42, 69.3, 58, 44, 58.7, 66.7, 57.3, 54.7],
    [POS.MB]: [48, 40, 43, 64, 69.5, 43, 58, 61, 58, 55],
    [POS.L]: [40, 72, 56, 24, 22, 74, 70, 40, 62, 64],
  },
  [RARITY.SSR]: {
    [POS.S]: [61, 57, 83.5, 46, 51, 63, 73, 47, 65, 75],
    [POS.OH]: [68.7, 68.7, 53.3, 75.3, 58.7, 66.7, 70, 64, 68, 71.3],
    [POS.OP]: [73, 45.5, 45.5, 84.5, 65, 49, 59, 84.5, 70, 60],
    [POS.MB]: [56.5, 45.5, 47, 71, 83.5, 49, 54, 77, 75, 67],
    [POS.L]: [45, 84, 62, 25, 22, 85, 82, 48, 74, 78],
  },
};
/** 같은 축의 잠재력 델타(= potential − stats) 평균. 전부 15~30 안에 있다. */
const POT_DELTA = {
  [RARITY.R]: {
    [POS.S]: [22, 21, 19, 20, 21, 21, 20, 20, 23, 25],
    [POS.OH]: [22.9, 23.1, 18.3, 25.4, 22, 22.6, 20.9, 23.4, 23.1, 25.7],
    [POS.OP]: [24, 22, 18, 28, 24, 20, 22, 26, 24, 26],
    [POS.MB]: [24, 23.7, 20.3, 27, 27.7, 22.7, 23.7, 25.3, 26, 27.7],
    [POS.L]: [15.8, 23.5, 20.5, 15, 15, 23.5, 20.5, 16, 23, 25.5],
  },
  [RARITY.SR]: {
    [POS.S]: [19, 18, 21, 16.3, 18, 18, 17.3, 16.5, 20, 22.5],
    [POS.OH]: [18, 22, 18, 21, 20, 20, 18, 19, 21, 25],
    [POS.OP]: [20, 20, 18, 20.7, 20, 20, 19.3, 19.3, 22, 24],
    [POS.MB]: [19, 18.5, 18, 20.5, 20, 19.5, 19.5, 19.5, 21.5, 23.5],
    [POS.L]: [16, 18, 20, 15, 15, 18, 18, 18, 20, 22],
  },
  [RARITY.SSR]: {
    [POS.S]: [20, 20, 16.5, 20, 20, 20, 17.5, 20, 22, 20],
    [POS.OH]: [19.3, 18.7, 20, 18.7, 20.7, 18.7, 18, 20.7, 20.7, 20.3],
    [POS.OP]: [19, 23, 19, 15, 20, 23, 21, 15.5, 21, 26],
    [POS.MB]: [20, 20, 18, 20, 15.5, 20, 22, 18, 17.5, 22],
    [POS.L]: [15, 15, 20, 15, 15, 15, 16, 18, 20, 20],
  },
};
/** 런칭 카드의 (희귀도 × 포지션) 스탯 평균 상한 — 생성 결과를 이 아래로 묶는다. */
const LEVEL_CAP = {};
for (const r of [RARITY.R, RARITY.SR, RARITY.SSR]) {
  LEVEL_CAP[r] = {};
  for (const p of [POS.S, POS.OH, POS.OP, POS.MB, POS.L]) LEVEL_CAP[r][p] = statAverage(PROFILE[r][p]);
}
export function launchLevel(rarity, pos) { return LEVEL_CAP[rarity][pos]; }

/** 포지션별 신장(평균·표준편차·world.md 6.3 허용 범위). */
const HEIGHT = [
  /* S  */{ mean: 175.5, sd: 2.0, lo: 172, hi: 180 },
  /* OH */{ mean: 179.3, sd: 2.2, lo: 175, hi: 185 },
  /* OP */{ mean: 184.8, sd: 2.6, lo: 178, hi: 188 },
  /* MB */{ mean: 186.9, sd: 2.4, lo: 182, hi: 192 },
  /* L  */{ mean: 167.5, sd: 1.9, lo: 165, hi: 172 },
];
/** 리베로의 spike·block 상한(world.md 6.3). 런칭 리베로 6명 전원이 이 아래다. */
const LIBERO_ATTACK_CAP = 30;

/** 희귀도별 스킬 후보(기존 레지스트리 재사용 — 새 스킬을 만들지 않는다. docs/skills.md 6절 밴드 보존). */
const SKILL_POOL = (() => {
  const m = { [RARITY.SSR]: {}, [RARITY.SR]: {} };
  for (const s of SKILLS) {
    const r = s.rarity === 'SSR' ? RARITY.SSR : RARITY.SR;
    (m[r][s.pos] = m[r][s.pos] || []).push(s);
  }
  for (const r of Object.keys(m)) for (const p of Object.keys(m[r])) m[r][p].sort((a, b) => (a.id < b.id ? -1 : 1));
  return m;
})();

// ---------------------------------------------------------------- 유틸
function pickWeighted(rng, arr) { return arr[rng.nextInt(arr.length)]; }
function clampRange(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/** 후보 목록에서 "아직 안 쓴 것"을 우선 고른다. 전부 소진되면 전체에서 고른다(전역 유일성은 상위에서 보장). */
function pickUnused(rng, list, usedSet) {
  const free = [];
  for (const v of list) if (!usedSet.has(v)) free.push(v);
  const src = free.length > 0 ? free : list;
  return src[rng.nextInt(src.length)];
}

// ---------------------------------------------------------------- 카드 1장 생성
/**
 * @param {object} W       월드 상태(사용 중인 이름·외형·번호 집합)
 * @param {number} seed    이 카드의 시드
 * @param {object} spec    { id, clubId, pos, rarity, debutSeason }
 *
 * 난수 스트림을 **이름 / 외형 / 능력치** 셋으로 분리한다. 이름·외형은 "이미 쓴 값"을 피하느라
 * 뽑는 횟수가 상황에 따라 달라지는데, 한 스트림을 공유하면 그 흔들림이 스탯까지 밀려 내려간다
 * (= 이름 풀에 단어 하나만 더해도 리그 밸런스가 바뀐다). 분리하면 그런 결합이 없다.
 */
function makeRookie(W, seed, spec) {
  const { clubId, pos, rarity, debutSeason } = spec;
  const rngName = new Rng(mixSeed(seed, 0x14A3, 1));
  const rngLook = new Rng(mixSeed(seed, 0x14A3, 2));
  const rng = new Rng(mixSeed(seed, 0x14A3, 3));

  // ---- 이름: 전체 유일 + 같은 구단 안에서 성 중복 금지(world.md 6.1-①)
  const clubSurnames = W.clubSurnames.get(clubId);
  let surname = null, given = null;
  for (let tries = 0; tries < 64 && surname === null; tries++) {
    const s = pickUnused(rngName, SURNAMES, tries < 48 ? W.usedSurnames : clubSurnames);
    if (tries < 56 && clubSurnames.has(s)) continue;
    const g = pickUnused(rngName, GIVEN_NAMES, W.usedGiven);
    if (W.usedNames.has(s + g)) continue;
    if (tries < 56 && s === g.charAt(0)) continue;      // 하하늘·초초록 같은 겹음절 회피
    surname = s; given = g;
  }
  if (surname === null) {                       // 이론상 도달하지 않는다(80 × 131 조합)
    surname = SURNAMES[rngName.nextInt(SURNAMES.length)];
    let n = 0;
    do { given = GIVEN_NAMES[rngName.nextInt(GIVEN_NAMES.length)]; } while (W.usedNames.has(surname + given) && ++n < 200);
  }
  const name = surname + given;
  W.usedNames.add(name);
  W.usedSurnames.add(surname);
  W.usedGiven.add(given);
  clubSurnames.add(surname);

  // ---- 외형: hairStyle+hairColor 조합은 전체 유일, 구단 안에서 헤어 컬러 중복 금지,
  //      파스텔·원색은 구단당 vividPerClub 명까지(world.md 6.2 · art-style-guide 1.3)
  const clubColors = W.clubHairColors.get(clubId);
  const vividLeft = ROOKIES.vividPerClub - (W.clubVivid.get(clubId) || 0);
  const colorPool = [];
  for (const c of HAIR_COLORS_NATURAL) if (!clubColors.has(c)) colorPool.push(c);
  if (vividLeft > 0) for (const c of HAIR_COLORS_VIVID) if (!clubColors.has(c)) colorPool.push(c);
  const colors = colorPool.length > 0 ? colorPool : HAIR_COLORS_NATURAL;
  let hairColor = colors[rngLook.nextInt(colors.length)];
  let hairStyle = null;
  for (let tries = 0; tries < 96 && hairStyle === null; tries++) {
    const st = pickUnused(rngLook, HAIR_STYLES, W.usedStyles);
    if (!W.usedHair.has(st + '|' + hairColor)) hairStyle = st;
    else if (tries % 24 === 23) hairColor = colors[rngLook.nextInt(colors.length)];   // 색을 바꿔 다시 시도
  }
  if (hairStyle === null) {           // 이론상 도달하지 않는다(42 스타일 × 14 색) — 그래도 남은 조합을 훑는다
    outer:
    for (const st of HAIR_STYLES) {
      for (const c of colors) {
        if (!W.usedHair.has(st + '|' + c)) { hairStyle = st; hairColor = c; break outer; }
      }
    }
    if (hairStyle === null) hairStyle = HAIR_STYLES[rngLook.nextInt(HAIR_STYLES.length)];
  }
  W.usedHair.add(hairStyle + '|' + hairColor);
  W.usedStyles.add(hairStyle);
  clubColors.add(hairColor);
  if (HAIR_COLORS_VIVID.indexOf(hairColor) >= 0) W.clubVivid.set(clubId, (W.clubVivid.get(clubId) || 0) + 1);

  // ---- 스탯: (희귀도 × 포지션) 런칭 평균 프로파일 + 노이즈 → 평균을 런칭 평균 아래로 내려 고정
  const prof = PROFILE[rarity][pos], dprof = POT_DELTA[rarity][pos];
  const stats = new Array(10);
  for (let i = 0; i < 10; i++) stats[i] = prof[i] + rng.gauss(0, ROOKIES.statNoiseSd);
  const cap = LEVEL_CAP[rarity][pos];
  const target = clampRange(
    cap - ROOKIES.levelMargin + rng.gauss(0, ROOKIES.levelJitter),
    cap - ROOKIES.levelMaxDrop, cap - 0.4);
  const shift = target - statAverage(stats);
  for (let i = 0; i < 10; i++) {
    stats[i] = clampRange(roundHalfEven(stats[i] + shift), ROOKIES.statMin, ROOKIES.statMax);
  }
  if (pos === POS.L) {                     // world.md 6.3 — 리베로의 공격 스탯 상한
    stats[3] = Math.min(stats[3], LIBERO_ATTACK_CAP);
    stats[4] = Math.min(stats[4], LIBERO_ATTACK_CAP);
  }
  const potential = new Array(10);
  for (let i = 0; i < 10; i++) {
    const d = clampRange(roundHalfEven(dprof[i] + rng.gauss(0, ROOKIES.potNoiseSd)), ROOKIES.potDeltaMin, ROOKIES.potDeltaMax);
    potential[i] = clampStat(stats[i] + d);
  }

  // ---- 신장·나이·등번호
  const h = HEIGHT[pos];
  const heightCm = clampRange(roundHalfEven(h.mean + rng.gauss(0, h.sd)), h.lo, h.hi);
  const debutAge = ROOKIES.debutAges[rng.nextInt(ROOKIES.debutAges.length)];
  const jerseys = W.clubJerseys.get(clubId);
  let jersey = 0;
  for (let n = 1; n <= 30 && jersey === 0; n++) { const v = 1 + rng.nextInt(30); if (!jerseys.has(v)) jersey = v; }
  for (let v = 1; v <= 99 && jersey === 0; v++) if (!jerseys.has(v)) jersey = v;
  jerseys.add(jersey);

  // ---- 스킬 계승(SSR·SR). 기존 레지스트리에서 같은 (희귀도·포지션) 스킬 중 보유자가 가장 적은 것.
  let skillName = '', skillDesc = '';
  if (rarity === RARITY.SSR || rarity === RARITY.SR) {
    const cands = SKILL_POOL[rarity][pos] || [];
    if (cands.length > 0) {
      let best = null, bestN = Infinity;
      for (const s of cands) {
        const n = W.skillHolders.get(s.name) || 0;
        if (n < bestN) { bestN = n; best = [s]; } else if (n === bestN) best.push(s);
      }
      const chosen = best[rng.nextInt(best.length)];
      W.skillHolders.set(chosen.name, bestN + 1);
      skillName = chosen.name;
      skillDesc = chosen.desc;
    }
  }

  const personality = [];
  while (personality.length < 3) {
    const t = PERSONALITIES[rngLook.nextInt(PERSONALITIES.length)];
    if (personality.indexOf(t) < 0) personality.push(t);
  }

  // 나이는 상태로 저장하지 않고 `card.age + (시즌 − 1)` 로 파생한다(A.3.6.1).
  // 신인은 debutSeason 에 debutAge 여야 하므로 기준 나이(= 시즌 1 환산)를 역산해 넣는다.
  const baseAge = debutAge - (debutSeason - 1);
  const card = makePlayer({
    id: spec.id, name, teamId: clubId, pos, rarity, jersey, heightCm, age: baseAge,
    stats, potential, skillName, skillDesc,
  });
  card.appearance = { hairStyle, hairColor, eyeColor: EYE_COLORS[rngLook.nextInt(EYE_COLORS.length)], bodyType: pickWeighted(rngLook, BODY_TYPES[pos]) };
  card.personality = personality;
  card.isRookieCard = true;
  card.debutSeason = debutSeason;
  card.debutAge = debutAge;
  card.bio = `${debutSeason}시즌 신인 드래프트로 ${W.clubName(clubId)} 육성 명단에 오른 ${POS_CODES[pos]}. ${personality[0]}·${personality[1]}.`;
  return card;
}

// ---------------------------------------------------------------- 월드(세대 + 승계) 빌더
/**
 * @param {object} cfg
 *   seed          계정 시드
 *   launchCards   런칭 카드 배열(= debutSeason 이 없는 data/players.json 카드)
 *   clubs         [{ id, name }]
 *   pastPeak(card, season)  그 시즌에 전성기를 지났는가(= 구단이 교체하는 조건)
 *   retired(card, season)   그 시즌에 은퇴했는가
 *   authoredBySeason  Map<season, card[]>  손으로 만든 신규 카드(있으면 정원을 먼저 채운다)
 */
export function createRookieWorld(cfg) {
  const clubIds = cfg.clubs.map(c => c.id);
  const clubName = new Map(cfg.clubs.map(c => [c.id, c.name]));
  const W = {
    seed: cfg.seed | 0,
    built: 0,                       // 여기까지 시즌을 쌓았다
    cfg,
    clubIds,
    clubName: id => clubName.get(id) || id,
    classes: new Map(),             // season -> card[]
    all: [],                        // 생성·수록된 모든 신인 카드
    byId: new Map(),
    // 유일성 장부
    usedNames: new Set(), usedSurnames: new Set(), usedGiven: new Set(),
    usedHair: new Set(), usedStyles: new Set(),
    clubSurnames: new Map(), clubHairColors: new Map(), clubVivid: new Map(), clubJerseys: new Map(),
    skillHolders: new Map(),
    // 구단 슬롯 승계
    slots: new Map(),               // clubId -> [{ id(런칭 카드 id), pos, occupant, since }]
    stock: new Map(),               // clubId -> card[]  (1군 슬롯을 아직 못 잡은 육성 명단)
    occupants: new Map(),           // season -> Map(런칭 카드 id -> { card|null, since })
    genericSlots: new Map(),        // season -> 신인 카드를 못 붙인 슬롯 수(계측용)
    rarityIndex: 0,
  };
  for (const id of clubIds) {
    W.clubSurnames.set(id, new Set());
    W.clubHairColors.set(id, new Set());
    W.clubVivid.set(id, 0);
    W.clubJerseys.set(id, new Set());
    W.stock.set(id, []);
    W.slots.set(id, []);
  }
  for (const c of cfg.launchCards) {
    W.usedNames.add(c.name);
    W.usedSurnames.add(c.name.slice(0, 1));
    W.usedGiven.add(c.name.slice(1));
    const a = c.appearance;
    if (a) {
      W.usedHair.add(a.hairStyle + '|' + a.hairColor);
      W.usedStyles.add(a.hairStyle);
      const cc = W.clubHairColors.get(c.teamId);
      if (cc) {
        cc.add(a.hairColor);
        if (HAIR_COLORS_VIVID.indexOf(a.hairColor) >= 0) W.clubVivid.set(c.teamId, (W.clubVivid.get(c.teamId) || 0) + 1);
      }
    }
    const cs = W.clubSurnames.get(c.teamId);
    if (cs) cs.add(c.name.slice(0, 1));
    const cj = W.clubJerseys.get(c.teamId);
    if (cj) cj.add(c.jersey);
    if (c.skillName) W.skillHolders.set(c.skillName, (W.skillHolders.get(c.skillName) || 0) + 1);
    const sl = W.slots.get(c.teamId);
    if (sl) sl.push({ id: c.id, pos: c.pos, occupant: c, since: 1 });
  }
  for (const id of clubIds) W.slots.get(id).sort((a, b) => (a.id < b.id ? -1 : 1));
  return W;
}

/** 시즌 s 의 구단별 결원 예보 = 지금·다음·다다음 시즌에 전성기를 넘기는 슬롯 수 − 대기 중인 신인 수. */
function demandTable(W, season) {
  const out = [];
  for (const clubId of W.clubIds) {
    const need = [0, 0, 0, 0, 0];
    for (const slot of W.slots.get(clubId)) {
      const o = slot.occupant;
      if (o === null) { need[slot.pos] += 3; continue; }            // 이미 빈 슬롯 — 최우선
      if (W.cfg.pastPeak(o, season)) need[slot.pos] += 3;
      else if (W.cfg.pastPeak(o, season + 1)) need[slot.pos] += 2;
      else if (W.cfg.pastPeak(o, season + 2)) need[slot.pos] += 1;
    }
    for (const r of W.stock.get(clubId)) if (!W.cfg.pastPeak(r, season)) need[r.pos] -= 3;
    for (let p = 0; p < 5; p++) out.push({ clubId, pos: p, score: need[p] });
  }
  return out;
}

/** 결원 예보가 전부 0 이하일 때 쓰는 기본 배분(구단 로스터 구성 비율 S1·OH2·OP1·MB2·L1). */
const FALLBACK_PLAN = [POS.OH, POS.MB, POS.S, POS.OH, POS.MB, POS.OP, POS.L];

/**
 * 외형 장부를 **그 시즌에 살아 있는 카드** 기준으로 다시 만든다.
 * 헤어스타일 42종·컬러 24종은 유한하므로 은퇴한 선수의 조합까지 영구히 묶어 두면 몇 시즌 만에 고갈된다.
 * 구분이 필요한 것은 "지금 같은 화면에 뜨는 카드들"이므로(art-style-guide 1.3), 은퇴하면 풀어 준다.
 * 반대로 **이름과 등번호는 풀지 않는다** — 은퇴한 선수의 기록·서포터 카드가 계속 남기 때문이다.
 */
function refreshActiveLedgers(W, season) {
  W.usedHair = new Set();
  W.usedStyles = new Set();
  for (const id of W.clubIds) { W.clubHairColors.set(id, new Set()); W.clubVivid.set(id, 0); W.clubSurnames.set(id, new Set()); }
  const consider = (c, debut) => {
    if (debut > season) return;
    if (W.cfg.retired(c, season)) return;
    const a = c.appearance;
    if (a) {
      W.usedHair.add(a.hairStyle + '|' + a.hairColor);
      W.usedStyles.add(a.hairStyle);
      const cc = W.clubHairColors.get(c.teamId);
      if (cc) {
        cc.add(a.hairColor);
        if (HAIR_COLORS_VIVID.indexOf(a.hairColor) >= 0) W.clubVivid.set(c.teamId, W.clubVivid.get(c.teamId) + 1);
      }
    }
    const cs = W.clubSurnames.get(c.teamId);
    if (cs) cs.add(c.name.slice(0, 1));
  };
  for (const c of W.cfg.launchCards) consider(c, 1);
  for (const c of W.all) consider(c, c.debutSeason);
}

function generateClass(W, season) {
  refreshActiveLedgers(W, season);
  const authored = (W.cfg.authoredBySeason && W.cfg.authoredBySeason.get(season)) || [];
  const list = authored.slice();
  const quota = Math.max(0, ROOKIES.perSeason - authored.length);
  if (quota > 0) {
    const rng = new Rng(mixSeed(W.seed, 0x0BADD1E, season));
    const demand = demandTable(W, season);
    // 결정적 셔플 후 점수 내림차순 — 동점은 시드로 갈린다.
    for (let i = demand.length - 1; i > 0; i--) { const j = rng.nextInt(i + 1); const t = demand[i]; demand[i] = demand[j]; demand[j] = t; }
    demand.sort((a, b) => b.score - a.score);
    let fallbackAt = rng.nextInt(FALLBACK_PLAN.length);
    for (let k = 0; k < quota; k++) {
      let clubId, pos;
      if (k < demand.length && demand[k].score > 0) {
        clubId = demand[k].clubId; pos = demand[k].pos;
        for (let j = k + 1; j < demand.length; j++) {          // 같은 (구단,포지션) 중복 배정 완화
          if (demand[j].clubId === clubId && demand[j].pos === pos) demand[j].score -= 3;
        }
        demand.sort((a, b) => b.score - a.score);
      } else {
        clubId = W.clubIds[(season + k) % W.clubIds.length];
        pos = FALLBACK_PLAN[(fallbackAt + k) % FALLBACK_PLAN.length];
      }
      const rarity = ROOKIES.rarityBag[W.rarityIndex % ROOKIES.rarityBag.length];
      W.rarityIndex++;
      const id = `r${String(season).padStart(2, '0')}${String(k + 1).padStart(2, '0')}`;
      list.push(makeRookie(W, mixSeed(W.seed, 0x8007 + k, season), { id, clubId, pos, rarity, debutSeason: season }));
    }
  }
  for (const c of list) {
    W.all.push(c);
    W.byId.set(c.id, c);
    const st = W.stock.get(c.teamId);
    if (st) st.push(c);
  }
  W.classes.set(season, list);
  return list;
}

/** 시즌 s 의 세대교체 — 전성기를 넘긴 점유자를 그 구단 육성 명단의 신인으로 갈아 끼운다. */
function applySuccession(W, season) {
  let generic = 0;
  for (const clubId of W.clubIds) {
    const stock = W.stock.get(clubId);
    for (const slot of W.slots.get(clubId)) {
      const o = slot.occupant;
      if (o !== null && !W.cfg.pastPeak(o, season)) continue;     // 아직 현역
      let idx = -1;
      for (let i = 0; i < stock.length; i++) {
        const r = stock[i];
        if (r.pos !== slot.pos) continue;
        if (r.debutSeason > season) continue;
        if (W.cfg.pastPeak(r, season)) continue;                  // 대기하다 늙은 카드는 1군에 올리지 않는다
        idx = i; break;                                           // 먼저 등록된 순(= 데뷔가 이른 순)
      }
      if (idx >= 0) { slot.occupant = stock[idx]; stock.splice(idx, 1); slot.since = season; } else { slot.occupant = null; slot.since = season; generic++; }
    }
  }
  const snap = new Map();
  for (const clubId of W.clubIds) for (const slot of W.slots.get(clubId)) snap.set(slot.id, { card: slot.occupant, since: slot.since });
  W.occupants.set(season, snap);
  W.genericSlots.set(season, generic);
}

/** 시즌 upto 까지 월드를 쌓는다(이미 쌓은 구간은 건너뛴다). */
export function growRookieWorld(W, upto) {
  const target = Math.max(1, upto | 0);
  for (let s = W.built + 1; s <= target; s++) {
    if (s >= ROOKIES.firstSeason || (W.cfg.authoredBySeason && W.cfg.authoredBySeason.has(s))) generateClass(W, s);
    applySuccession(W, s);
    W.built = s;
  }
  return W;
}

/** 시즌 season 까지 데뷔한 신인 카드 전부. */
export function rookiesUpTo(W, season) {
  const n = Math.max(1, season | 0);
  return W.all.filter(c => c.debutSeason <= n);
}
/** 그 시즌에 새로 합류한 카드. */
export function rookieClass(W, season) { return (W.classes.get(Math.max(1, season | 0)) || []).slice(); }
/**
 * 구단 슬롯(런칭 카드 id)의 그 시즌 점유자.
 *  - 런칭 카드 자신 = 아직 현역
 *  - 다른 카드      = 세대교체된 신인
 *  - null           = 교체 대상인데 붙일 신인이 없다(제네릭 육성 선수로 메운다)
 */
export function slotOccupant(W, slotCardId, season) {
  const snap = W.occupants.get(Math.max(1, season | 0));
  if (!snap || !snap.has(slotCardId)) return undefined;
  return snap.get(slotCardId).card;
}
/** 그 점유자가 주전이 된 시즌(= 연차 계산용). */
export function slotSince(W, slotCardId, season) {
  const snap = W.occupants.get(Math.max(1, season | 0));
  return snap && snap.has(slotCardId) ? snap.get(slotCardId).since : 1;
}
/** 계측용 — 그 시즌에 신인을 못 붙이고 제네릭으로 메운 슬롯 수. */
export function genericSlotCount(W, season) { return W.genericSlots.get(Math.max(1, season | 0)) || 0; }

/** 세대 요약(문서·UI 표기용). */
export function rookieSummary(W, season) {
  const list = rookieClass(W, season);
  return list.map(c => ({
    id: c.id, name: c.name, clubId: c.teamId, pos: POS_CODES[c.pos], rarity: RARITIES[c.rarity],
    jersey: c.jersey, heightCm: c.heightCm, age: c.debutAge, skillName: c.skillName,
    appearance: c.appearance,
  }));
}
