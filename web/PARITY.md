# web/ 엔진 정합(파리티) 리포트

C# 프로토타입(`sim/VolleySim.*`)을 브라우저용 순수 자바스크립트(`web/engine.js` + `web/engine/*.js`)로 포팅한 결과의 정합 기록.
**검증 방법**: `node web/parity.mjs` (약 3초, 종료 코드 0 = 전 항목 통과). 표본은 각 표 제목에 명시.

> 목표는 비트 단위 일치가 **아니라** 집계 지표 일치다. RNG 알고리즘이 다르므로(아래 3절) 개별 랠리는 C# 과 다르지만,
> 판정 체인·상수·수식은 1:1 이므로 대수의 법칙 아래 모든 집계 지표가 허용 오차 안에서 일치한다.

---

## 1. 정합 결과표

### 1.1 경기 시뮬 — 필수 지표 (동급 랜덤 팀 **2,000경기**, seed 42, overall 67±6, 경기마다 새 로스터)

| 지표 | C# 기준 | JS 실측 | 허용 | 판정 |
|---|---|---|---|---|
| 사이드아웃 | 60.9% | **60.9%** | ±1.5%p | 통과 |
| kill% | 42.3% | **42.3%** | ±1.5%p | 통과 |
| 서브 에이스 | 6.7% | **6.8%** | ±1.0%p | 통과 |
| 서브 범실 | 10.1% | **10.1%** | ±1.0%p | 통과 |
| 유효 블로킹 | 10.2% | **10.1%** | ±1.5%p | 통과 |
| 세트당 득점 | 44.2 | **44.22** | ±1.5 | 통과 |
| 홈 승률 | 49.5% | **50.5%** | ±3%p | 통과 |

C# 기준값 출처: `docs/match-sim-balance-report.md` v0.2-1 표 (`dotnet run -c Release --project sim/VolleySim.Cli -- --matches 2000 --seed 42` 로 재확인함, 위 값과 동일).

### 1.2 경기 시뮬 — 보조 지표 (같은 표본)

| 지표 | C# 기준 | JS 실측 | 허용 | 판정 |
|---|---|---|---|---|
| 공격 범실률 | 8.0% | 7.9% | ±1.0%p | 통과 |
| 블록 터치(유효 접촉) 비율 | 15.6% | 15.6% | ±1.5%p | 통과 |
| 리시브 A | 35.0% | 34.9% | ±1.5%p | 통과 |
| 리시브 B | 36.3% | 36.5% | ±1.5%p | 통과 |
| 리시브 C | 21.2% | 21.2% | ±1.5%p | 통과 |
| 리시브 실패 | 7.4% | 7.5% | ±1.0%p | 통과 |
| 퍼스트볼 성공률 | 45.2% | 45.1% | ±1.5%p | 통과 |
| 랠리당 공격 시도 | 1.38 | 1.38 | ±0.06 | 통과 |
| 세트당 블로킹 득점 | 6.21 | 6.18 | ±0.30 | 통과 |
| 세트당 프리볼 | 3.12 | 3.11 | ±0.30 | 통과 |
| 경기당 세트 수 | 4.12 | 4.13 | ±0.10 | 통과 |

### 1.3 육성 — 필수 지표 (SSR OH 예시 카드, 서포터 없음, 스텁 평가전, **정책당 2,000회**, seed 1)

| 정책 | 지표 | C# 기준 | JS 실측 | 허용 | 판정 |
|---|---|---|---|---|---|
| 안전 | 기대 OVR | 76.2 | **76.21** | ±0.8 | 통과 |
| 안전 | 부상률 | 0~1% | **0.1%** | — | 통과 |
| 최적 | 기대 OVR | 78.4 | **78.42** | ±0.9 | 통과 |
| 최적 | 부상률 | 17% | **14.8%** | ±5%p | 통과 |
| 무휴식 | 기대 OVR | 74.4 | **74.39** | ±1.0 | 통과 |
| 무휴식 | 부상률 | ≥90% (C# 96%) | **95.5%** | — | 통과 |

카드 픽스처는 `sim/VolleySim.Training.Tests/OracleFixtures.cs:19 SsrOh` 와 동일(stats 62/66/50/72/58/60/68/66/64/60, potential 82/90/60/98/74/80/88/88/84/82, 소속 t01).
시드도 같은 규칙(`baseSeed × 1000003 + i × 7919 + 17`)을 쓴다.

### 1.4 육성 — 보조 지표 (`docs/training-mode.md` 12.4절 · 9.5절)

| 지표 | C# 기준 | JS 실측 | 허용 | 판정 |
|---|---|---|---|---|
| 푸시 — OVR / 부상률 | 77.5 / 43% | 77.50 / 43.6% | ±0.8 / ±6%p | 통과 |
| 랜덤 — OVR | 73.2 | 73.16 | ±0.9 | 통과 |
| 스파이크만 — OVR | 74.2 | 74.26 | ±0.7 | 통과 |
| 안전 — A 이상 비율 | 97% | 97.2% | ±6%p | 통과 |
| 최적 — S 비율 | 16% | 14.5% | ±6%p | 통과 |
| 최적 / 안전 — 핵심 도달률 | 82% / 66% | 81.7% / 65.8% | ±5%p | 통과 |
| 최적 − 안전 (도박 성립) | +2.2 | +2.21 | ±0.8 | 통과 |
| 최적 − 랜덤 (실력 > 운) | +5.2 | +5.26 | ±1.2 | 통과 |
| 안전 / 최적 — 힌트 | 6.7 / 7.9 | 6.66 / 7.84 | ±0.7 | 통과 |
| 최적 — 핫존 훈련 / 휴식 수 | 2.9 / 2.0 | 2.91 / 2.00 | ±0.6 / ±0.5 | 통과 |
| 최적 + 서포터 풀세팅 — OVR | 79.52 | 79.46 | ±0.8 | 통과 |
| 최적 + 서포터 풀세팅 — S 비율 | 49% | 49.0% | ±8%p | 통과 |
| 최적 + 서포터 풀세팅 — 핵심 도달률 | 88% | 88.0% | ±5%p | 통과 |
| 안전 + 서포터 풀세팅 — S 비율 | 1% | 0.6% | ±3%p | 통과 |

서포터 3인 픽스처도 `OracleFixtures.cs:76~` 의 SSR S등급 3인(동문 t01 / 라이벌 t05 태그 포함)과 동일.

### 1.5 결정성 · 규칙 불변식

| 항목 | 결과 |
|---|---|
| 같은 시드 → 같은 경기 결과 | 통과 |
| 다른 시드 → 다른 경기 결과 | 통과 |
| 같은 시드 → 같은 육성 결과(확정 스탯·힌트까지) | 통과 |
| `saveGame` → `loadGame` 후 같은 시드 재현 | 통과 |
| 세트 종료 규칙(25점/최종 15점, 2점차) | 통과 |
| 3선승 종료 | 통과 |
| 리베로가 서브·공격·블로킹하지 않음 | 통과(위반 0건) |
| 중계 렌더러 출력(576줄/경기), 조사 이/가("채보름이" / "하담희가") | 통과 |

### 1.6 의도적 차이 2건 검증 (아래 2절)

| 항목 | 기준(`docs/league-and-economy.md` A.3.1) | JS 실측 | 판정 |
|---|---|---|---|
| ① AI 구단 성장 35% — 6구단 라인업 OVR 평균 | 65.3 | **65.30** | 통과 |
| ① 최약 구단(라온) / 최강 구단(연화) | 62.9 / 67.0 | **62.83 / 66.96** | 통과 |
| ② 졸업생이 원소속 구단 로스터에서 빠짐 | — | OK | 통과 |
| ② 같은 포지션 대체 선수 1명 충원, 구단 7명 유지 | — | OK | 통과 |

---

## 2. 의도적 차이 (지시된 개선 2건)

### ① AI 구단은 초기치가 아니라 **시즌 사다리로 성장한 능력치**로 출전한다

- **C# 현황**: `Play/Game.cs:249 ClubTeamState` 는 `OpponentGrowth` 가 기본 0 이라 `players.json` 초기치를 그대로 썼다(관찰용 옵션으로만 존재).
- **JS 구현**: `web/engine/game.js` → `grownPlayer()` / `clubTeamState()`.
  실효 스탯 = `round(clamp(stats + g × (potential − stats), 0, 100))`, `g` 는 `SEASON_GROWTH[season−1]`(시즌 1 = **0.35**, 이후 0.48 / 0.58 / 0.66 / 0.72 / 0.76 / 0.80 상한).
  반올림은 C# `Math.Round(..., ToEven)` 과 같은 은행가 반올림(`mathx.js roundHalfEven`).
  `state.season` 은 기본 1 이며 UI 가 올릴 수 있다. `clubTeamState(state, id, { growth })` 로 개별 지정도 가능.
- **효과 검증**: 6구단 라인업 OVR 평균 58.6 → **65.3**(문서 A.3.1 시즌 1 표와 소수 둘째 자리까지 일치), 최약 62.83 / 최강 66.96.
  즉 연습생만으로는 거의 못 이기고, 졸업생을 쌓아야 이기는 "예측 가능한 벽"이 실제로 생긴다.

### ② 플레이어가 **졸업시킨** 선수는 원소속 구단에서 빠지고 대체 선수가 들어간다

- **C# 현황**: 미구현(`docs/league-and-economy.md` A.3.5 에 "시뮬에는 아직 미반영"으로 명시). 스카우트한 선수가 원소속 구단에서도 계속 뛰었다.
- **JS 구현**: `web/engine/game.js` → `departedCardIds()` / `clubTeamState()`.
  - 이탈 판정 기준은 **스카우트 시점이 아니라 졸업 시점**(지시대로). `state.instances` 에 인스턴스가 하나라도 있는 `cardId` 가 대상.
  - 빈 자리는 **같은 포지션의 연습생급 대체 선수**로 채운다. 강도 = `구단 7명의 스탯 평균 − 8`(A.3.5), 생성기는 `RandomPlayerGenerator` 포팅(`generator.js`), 잡음 ±4.
  - 대체 선수는 `id = "<clubId>-sub-<cardId>"`, 이름 뒤에 `(육성 선수)` 배지, `isSubstitute: true`, 희귀도 N. **저장하지 않고** `clubId + cardId` 해시 시드로 매번 같은 선수를 재생성한다.
  - 구단 평균은 **이탈 전 7명 기준**으로 고정 → 여러 명이 빠져도 대체 선수 강도가 연쇄적으로 무너지지 않는다.
- **효과**: 강한 카드를 뽑아 키울수록 그 구단이 실제로 약해진다(뽑기 성공이 리그에서 두 번 보상된다).

---

## 3. C# 과 다른 점 (구현상 불가피하거나 문서화된 것)

| # | 항목 | 내용 |
|---|---|---|
| 3-1 | **RNG** | C# 은 xoshiro256\*\*(64비트) + SplitMix64. JS 는 **xorshift128 + SplitMix32**(`engine/rng.js`)를 직접 구현했다. `Math.random()` 은 쓰지 않는다. `nextDouble()` 정밀도는 32비트(C# 53비트) — 판정 임계값 비교에는 충분. 따라서 **같은 시드라도 C# 과 랠리 단위 결과는 다르다**(집계는 일치). |
| 3-2 | **정규분포 난수** | C# `TrainingRandom.Gauss` 는 Box-Muller(`Math.Log`·`Math.Cos`). JS 는 `Math.cos` 의 엔진별 오차를 피하려 **Marsaglia 극좌표법**으로 바꿨다(분포는 동일한 N(μ,σ), sqrt 는 JS 명세상 정확 반올림). |
| 3-3 | **exp / ln** | `SimMath.cs` 의 자체 결정적 Exp/Ln(테일러 14차 · atanh 급수, IEEE 기본 연산만)을 그대로 포팅(`engine/mathx.js`). `Math.exp`/`Math.log` 는 엔진마다 마지막 비트가 달라질 수 있어 쓰지 않는다 → **브라우저가 달라도 같은 시드 = 같은 결과**. |
| 3-4 | **저장 포맷** | C# `System.Text.Json` 전체 직렬화 대신 JS 자체 압축 포맷(4절). 호환되지 않는다(설계상 허용). |
| 3-5 | **경기 시드 파생** | `MonteCarlo.MixSeed` 와 `GameState.NextSeed` 의 정수 해시는 그대로 포팅(`rng.js mixSeed`/`derivedSeed`)해 시나리오 대응·저장 가능한 시드 카운터를 유지한다. |
| 3-6 | **스카우트 천장(추가)** | C# `Game.Scout` 에는 천장이 없다. 지시(포팅 범위 "천장")에 따라 `docs/league-and-economy.md` B.2.2 규칙을 구현: **SR 이상 10회 보장 / SSR 60회 보장, 카운터 공유**. 천장 SR 발동 시 SSR 비중 = 3/(3+17). `scout()` 반환의 `pity` 에 남은 횟수·발동 여부가 들어간다. |
| 3-7 | **포지션 지정 스카우트(추가)** | `scout(state, { position: 'MB' })` 로 해당 포지션 풀만 뽑는다(B.2.1). 프로토타입에 골드 재화가 없어 **추가 비용은 부과하지 않았다**(티켓 1만 소모). |
| 3-8 | **중복 조각(추가)** | C# 은 중복 = 즉시 한계돌파만. 지시(포팅 범위 "중복 조각")에 따라 중복 시 **한계돌파 +1 과 조각 +1 을 함께** 준다(조각 3개 = 티켓 1 은 프로토타입 눈금 그대로). 문서 B.4 의 "중복 = 조각 10 / 30 = 한계돌파" 눈금은 골드·희귀도별 조각이 있는 정식 경제 전제라 도입하지 않았다. |
| 3-9 | **한계돌파 상한** | C# 은 무제한 누적. 문서 B.4 의 **최대 5단계**(potential +15)를 적용했다. |
| 3-10 | **구단별 전술** | `docs/league-and-economy.md` A.3.3 의 구단별 `Tactics` 를 `CLUB_TACTICS` 로 넣어 두었지만 **기본은 꺼져 있다**(C# 과 동일하게 `Tactics.Default()` 사용). `createGame({ useClubTactics: true })` 또는 `playMatch(state, id, { useClubTactics: true })` 로 켠다 — 켜면 밸런스 리포트 기준값과 달라진다. |
| 3-11 | **전적 로그 상한** | `state.history` 를 최근 **60줄**로 자른다(C# 무제한). 저장 용량 때문. |
| 3-12 | **연습생 재생성** | C# 은 연습생 7명을 저장 파일에 넣는다. JS 는 저장하지 않고 `derivedSeed(seed, 0)` 에서 재생성한다(항상 동일). |

---

## 4. 미포팅 · 단순화 항목

| 항목 | 상태 | 이유 |
|---|---|---|
| `ISkillEffectProvider` / `MatchContext.SkillLogit` | **미포팅** | C# 프로토타입도 `SkillProvider = null` 이라 판정에 전혀 반영되지 않는 빈 훅. 로짓 가산이 항상 0 이므로 결과에 영향 없음. 개인 스킬은 데이터(`skillName`)로만 보존. |
| `TeamMatchState.TrySubstitute` (일반 선수교체) | **미포팅** | C# 도 "AI 가 호출하지 않는다"고 명시한 준비 코드. 리베로 자동 교체는 완전 포팅. |
| 인연(Bond) 이벤트 T7 | **미포팅** | C# 도 "카드 데이터 부재로 미구현"(`TrainingSession.cs:449` 주석). `bondTurn` 상수만 보존. |
| 특훈 종류 중 체력 특훈 / 멘탈 캠프 | **구현했으나 미등장** | `specialKindWeights = [1, 0, 0]` 이라 포지션 특훈만 나온다(C# 기본값과 동일). 가중치를 바꾸면 즉시 동작. |
| `SimConfig` CLI 오버라이드(`--set`), `--oracle-table`, `--calibrate-eval` | **미포팅** | 콘솔 도구. 설정 객체는 그대로 가변이라 `createSimConfig()` 결과를 수정하면 같은 캘리브레이션이 가능. |
| `Play/Screens.cs`·`Input.cs`·`Ui` (콘솔 UI) | **미포팅** | UI 는 다른 담당. 엔진은 DOM 을 참조하지 않는다. |
| 리그 일정·순위표·포스트시즌·골드·젬·10연 스카우트 | **미포팅** | C# 프로토타입에도 없다(`league-and-economy.md` 의 정식 설계). 시즌 사다리 `g` 값만 개선 ① 에 사용. |
| `MiniJson` | **불필요** | JS 내장 `JSON`. |
| 육성 이벤트 텍스트 | **전량 포팅** | `EventCatalog` 의 스토리 3종 · 선배 3변형 · 랜덤 5종 · 행동 플레이버 24줄을 문장까지 그대로 옮겼다(`engine/training-events.js`). 축약 없음. |
| 선수 외모·성격·바이오 | **데이터만 보존** | C# 과 동일하게 판정에 미반영. `data.js` 에 원본 그대로 들어 있다. |
| `TrainingSession.Deterministic` (워크드 예시 모드) | **포팅함** | 생성자 6번째 인자. ε=0, 부상·랜덤 이벤트 없음. |

---

## 5. 성능 · 저장 용량 (모바일 예산)

측정 환경: Node 22 / x86 리눅스. **중급 스마트폰은 대략 5~8배 느리다**고 보면 된다.

| 항목 | 실측 | 목표 | 비고 |
|---|---|---|---|
| 경기 1회 (이벤트 로그 수집 포함) | **0.83 ~ 0.99 ms** | < 100 ms | 폰 환산 약 5~8 ms |
| 경기 1회 (이벤트 미수집) | 0.66 ms | — | 리그 일괄 시뮬용 |
| 육성 12턴 1회 (실제 시뮬 평가전 3경기 포함) | 1.36 ms | — | 스텁 평가전이면 0.05 ms |
| 2,000경기 몬테카를로 | 1.9 s | — | `parity.mjs` |
| `node web/parity.mjs` 전체 | **3.1 s** | < 30 s | 경기 2,000 + 육성 2,000×8 |

**경기당 이벤트 수**: 동급 팀 기준 평균 **1,665개**(최소 1,163 / 최대 2,259, 300경기 표본). 4.1세트 × 약 180랠리 × 이벤트 9개 수준.
이벤트 객체 하나는 필드 15개의 평면 객체이며, 랠리 안에서는 스크래치 버퍼를 재사용해 **랠리당 신규 할당은 이벤트 객체뿐**이다.
이벤트 배열을 JSON 으로 굳히면 경기당 약 370KB 이므로 **`localStorage` 에 저장하지 말 것** — 중계 렌더링용 휘발성 데이터다.
대량 시뮬(리그 일괄 진행 등)에서는 `playMatch(state, id, { collectEvents: false })` 로 끄면 배열 자체가 만들어지지 않는다.

**저장 크기**: 육성 40회 + 경기 40회를 돌린 헤비 세이브가 **9.8 KB**. 실사용(육성 10~20회)은 3~5 KB 수준.
파생 가능한 값은 저장하지 않고 `loadGame` 에서 재계산한다:

- 연습생 7명 → 시드에서 재생성
- 인스턴스의 이름·포지션·희귀도·소속·등번호·신장·나이·스킬명·**초기 스탯** → `cardId` 로 카드 풀에서 조회
- OVR·등급·완성도·전체 도달률·스킬 레벨 → 확정 스탯 + 잠재력에서 재계산
- AI 구단 로스터·대체 선수 → 시즌 `g` 와 이탈 목록에서 재계산
- 저장하는 것: 시드/시드 인덱스, 재화, 천장 카운터, 보유 카드 맵, 인스턴스별 `확정 스탯 10 + 잠재력 10 + 힌트 + 캠프 기록 11`, 라인업 id, 전적 60줄

---

## 6. 파일 구성

| 파일 | 줄 수 | 내용 |
|---|---|---|
| `web/engine.js` | 50 | 공개 API 재수출(진입점) |
| `web/engine/mathx.js` | 113 | 결정적 exp/ln/sigmoid/logit/contest, 은행가 반올림 (`SimMath.cs`) |
| `web/engine/rng.js` | 136 | xorshift128 시드 RNG, `mixSeed`/`derivedSeed` (`DeterministicRandom.cs`) |
| `web/engine/config.js` | 129 | 경기 시뮬 상수 전량 (`SimConfig.cs`) |
| `web/engine/domain.js` | 319 | 열거형·선수·라인업·팀 상태·로테이션·리베로 규칙 (`Domain/*.cs`, `TeamMatchState.cs`) |
| `web/engine/ratings.js` | 30 | 복합 레이팅 6종 (`Ratings.cs`) |
| `web/engine/match.js` | 928 | 랠리 판정 체인 + 세트/경기 진행 (`RallyEngine.cs`, `SetEngine.cs`, `MatchEngine.cs`, `MatchContext.cs`) |
| `web/engine/generator.js` | 96 | 시드 기반 선수·팀 생성 (`RandomPlayerGenerator.cs`) |
| `web/engine/training-config.js` | 216 | 육성 튜닝 테이블 전량 (`TrainingConfig.cs`) |
| `web/engine/training-events.js` | 184 | 이벤트 카탈로그·플레이버 텍스트 (`TrainingEvent.cs`) |
| `web/engine/training.js` | 952 | 12턴 상태기계·서포터·평가전·정책 (`TrainingSession.cs` 외) |
| `web/engine/commentary.js` | 150 | 한국어 중계 렌더러 (`KoreanCommentary.cs`) |
| `web/engine/game.js` | 811 | 게임 루프·스카우트·라인업·경기·저장 (`Play/Game.cs`, `Play/GameState.cs`) + 개선 ①② |
| `web/data.js` | 2,181 | `data/players.json`(42명) · `data/teams.json`(6구단) 그대로 (자동 생성) |
| `web/build-data.mjs` | 23 | `web/data.js` 생성 스크립트 |
| `web/parity.mjs` | 390 | 정합 검증 하네스 |

엔진 코드 합계 약 **4,000줄**(데이터 제외). 브라우저에서 번들러 없이 `<script type="module">` 로 바로 로드된다(모든 import 가 확장자를 포함한 상대 경로, Node 전용 API 없음).

---

## 7. 공개 API

```js
import {
  createGame, loadGame, saveGame,
  scout, startTraining, trainingOptions, applyTrainingChoice, graduate,
  recommendSupporters, autoLineup, setLineupSlot, playMatch, renderCommentary,
  CLUBS, POSITIONS, RARITIES,
} from './engine.js';
```

| 함수 | 반환 |
|---|---|
| `createGame({ seed, clubName })` | `GameState` |
| `loadGame(json)` | `GameState` (문자열/객체 모두 허용) |
| `saveGame(state)` | 직렬화 가능한 순수 객체 |
| `scout(state, { position })` | `{ card, rarity, isDuplicate, limitBreak, fragments:{total,gained,perTicket}, pity:{triggered,srIn,ssrIn,...}, tickets }` |
| `startTraining(state, cardId, supporterIds)` | `TrainingSession` |
| `trainingOptions(session)` | `{ kind: 'action' / 'event' / 'graduated', turn, fatigue, zone, condition, ovr, options:[...] }` — 행동 선택지에는 `expectedGains[10]`·`weightedGain`·`fatigueDelta`·`injuryP`·`injuryBadge{percent,level}`·`aptitudeLabel` 포함 |
| `applyTrainingChoice(session, choiceId)` | `{ events:[turn/event/evaluation/graduated…], nextState }` — `choiceId` 는 `'spike'`·`'rest'`·`'special'` 또는 `'event:0'` |
| `graduate(session, decision)` | `{ instance, grade, ovr, deltas[10], skillLevel, unlockedSkills, completion, camp, summary }` (decision 0 대표교체 / 1 보관 / 2 방출) |
| `recommendSupporters(state, cardId)` | 추천 서포터 인스턴스 id 배열(최대 3) |
| `autoLineup(state)` | `{ startingIds[6], liberoId }` |
| `setLineupSlot(state, slot, playerId)` | `boolean` (slot 0~5 선발, 6 리베로) |
| `playMatch(state, opponentTeamId)` | `{ setScores, sets, won, box:{home,away}, events, eventCount, highlights, ctx, reward, opponent, seed }` |
| `renderCommentary(events, ctx)` | 한국어 중계 문자열 배열 (`ctx` 는 `playMatch` 결과의 `ctx` 를 그대로) |
| `CLUBS` / `POSITIONS` / `RARITIES` | 구단 6개 / `['S','OH','OP','MB','L']` / `['N','R','SR','SSR']` |

보조 API: `clubList(state)`(상대 선택 화면용 구단 OVR·전적·대체 선수 수), `myRoster`·`myTeamState`·`lineupOvr`·`representatives`·`promoteInstance`·`releaseInstance`·`canScout`·`trainingCard`, 열거형(`STAT_NAMES_KO`, `COND_NAMES_KO`, `ZONE_NAMES_KO`, `ACT_NAMES_KO`, `GRADE_NAMES`, `EV`/`Q`/`OUT`/`ATK`), 저수준(`simulateMatch`, `generateTeamState`, `Rng`, `POLICIES`, `runWithPolicy`).

---

## 8. 남은 격차 · 열린 이슈

- **최적 정책 부상률 14.8% vs C# 17%** (허용 ±5%p 안). 원인은 RNG 스트림 차이로 인한 표본 변동으로 보이며, 부상 확률식·위험 계수·정책 임계값은 C# 과 문자 그대로 같다. 같은 방향으로 S 비율도 14.5% vs 16% 로 1.5%p 낮다(허용 ±6%p 안). 기준값은 손대지 않았다.
- **홈 승률 50.5% vs C# 49.5%** (2,000경기 표준오차 ±1.1%p). `HomeCourtLogit = 0` 이므로 이론값 50% 이며 양쪽 모두 잡음 범위.
- 구단별 전술(3-10)을 켜면 위 기준값과 달라진다. 켤지 여부는 UI/기획 결정 사항으로 남긴다.
- C# `--set` 상수 오버라이드에 해당하는 캘리브레이션 CLI 는 없다. 필요하면 `createSimConfig()` 결과를 수정해 `simulateMatch(home, away, seed, cfg)` 로 넘기면 된다.
