# 코드 리뷰 — 시뮬 코어 · 육성 · 코어 루프 프로토타입 (2026-09)

> 대상: `sim/VolleySim.Core`(v0.2 재캘리브레이션 경로 중심) · `sim/VolleySim.Training` 전체 · `sim/VolleySim.Play` 전체 · `sim/VolleySim.Cli`.
> 목적: 여러 에이전트가 빠르게 작성한 코드의 **정확성 버그**와 **설계 문서 불일치**를 찾아 고치는 것. 새 기능·리팩터링·공개 API 변경은 하지 않았다.
> 참조 문서: [match-sim.md](match-sim.md) · [training-mode.md](training-mode.md) v0.2 · [prototype-play.md](prototype-play.md).

## 0. 결과 요약

| 항목 | 값 |
|---|---|
| 빌드 | `dotnet build sim/VolleySim.sln` — 경고 0 / 오류 0 |
| 테스트 | **109개 통과**(Core 45 · Training 48 · Play 16). 리뷰 전 85개(Core 39 · Training 46) → 회귀 테스트 24개 추가, 기존 테스트의 허용 오차는 넓히지 않음 |
| 파이썬 오라클 | `python3 tools/training-sim/train_sim.py --quick` 정상, 워크드 예시 OVR 80.4 S 재현 (C# 결정론 모드와 일치) |
| 성능 | `--auto --runs 8 --seed 1 --matches 3` = **0.38초**(문서 6.1절 시드 1 행 11/22/17/17/17/22/56/72/50% 을 그대로 재현). 명백한 O(n²) 낭비 없음 |
| 발견 | **18건 — High 1 · Med 4 · Low 13.** 코드 수정 9건(1절, 회귀 테스트 동반) · 문서·테스트로 해소 4건(2절) · 부채로 기록 5건(4절) |

심각도 기준: **High** = 플레이어 데이터·판정 결과가 조용히 어긋남, **Med** = 규칙/문서와 동작이 어긋나지만 복구 가능, **Low** = 표시·개발 편의·잠재 위험.

## 1. 수정한 발견

| # | 심각도 | 위치 | 증상 | 수정 | 회귀 테스트 |
|---|---|---|---|---|---|
| F1 | **High** | `sim/VolleySim.Play/Screens.cs:24`(수정 전: 루프 밖에서 `var st = _g.State` 한 번) | **불러오기 후 화면과 실제 상태가 어긋남.** `7) 불러오기` 는 `_g` 를 새 게임으로 교체하지만 메뉴 헤더·`8) 구단명 변경`·`9) 기록` 은 루프 진입 전에 잡아 둔 **옛 상태**를 계속 참조했다. 티켓·로스터·전적이 옛 값으로 표시되고, 불러온 뒤 바꾼 구단명은 저장되지 않은 채 사라졌다(사용자 조작 유실) | 상태 참조를 루프 안으로 이동해 매 반복마다 현재 `_g.State` 를 읽게 함 | `ScreensTests.AfterLoad_MainMenuUsesLoadedState` |
| F2 | **Med** | `sim/VolleySim.Play/Game.cs:118,140,289` | **조각 → 티켓 변환이 방출 경로에만 누락.** UI 와 문서는 "조각 3개 = 티켓 1"을 안내하는데, 졸업 비교 화면의 [신규 방출]·로스터 화면의 `x` 방출로 쌓인 조각은 영원히 변환되지 않고 무한 누적됐다(패배 보상 경로에만 변환 코드가 있었다) | 변환을 `AddFragment()` 하나로 모으고 패배·방출 세 경로가 모두 쓰게 함 | `EconomyTests.Fragments_FromRelease_ConvertToTicket` |
| F3 | **Med** | `sim/VolleySim.Play/GameState.cs:58` | **세이브 파일에 파생 뷰가 새어 나감.** `Representatives` 는 `Instances` 를 걸러 내는 계산 속성인데 `System.Text.Json` 이 이를 직렬화해 대표 인스턴스가 세이브에 두 번 기록됐다(로드 시엔 무시되는 유령 필드 + 파일 크기 증가) | `[JsonIgnore]` 부여. 옛 세이브(해당 키 포함)도 그대로 읽히는지 함께 고정 | `SaveLoadTests.Save_DoesNotDuplicateRepresentativesView` |
| F4 | **Med** | `sim/VolleySim.Play/Game.cs:289` | 패배 보상 문구가 변환 **후**의 `Fragments % 3` 을 출력해 "조각 3/3" 이 화면에 나오지 않고 0/3 으로 건너뛴 것처럼 보였다 | F2 와 함께 정리(변환 여부를 반환값으로 받아 문구 구성) | `EconomyTests.Loss_GivesFragment_ThirdLossGivesTicket_AndWinGivesTicket` |
| F5 | **Low** | `sim/VolleySim.Play/Screens.cs:261`(LoadScreen) | 불러오기로 `Game` 을 새로 만들 때 `OpponentGrowth` 를 넘기지 않아 `--opponent-growth 0.6` 로 시작한 관찰 세션이 불러오기 후 상대 강도를 초기치로 되돌렸다(관찰 리포트 오염) | 새 `Game` 에 기존 값을 인계 | `ScreensTests.AfterLoad_OpponentGrowthIsPreserved` |
| F6 | **Low** | `sim/VolleySim.Play/TrainingScreen.cs:54` | 턴 화면의 피로를 정수로 반올림해 표시(`{Fatigue:0}`)하는 바람에 피로 44.6 이 "**45** [적정 ×1.00]"으로 보였다 — 구간 경계(45 = 핫존)와 모순된 화면 | 소수 첫째 자리까지 표시(`{Fatigue:0.#}`) | 표시 전용이라 테스트 없음(경계 계산 자체는 `BoundaryValues_ZoneInjuryAndRestDepth` 가 고정) |
| F7 | **Low** | `sim/VolleySim.Play/Program.cs:82` | `--load` 경로가 없으면 아무 말 없이 새 게임을 시작해, 경로 오타를 진행 상황 소실로 오해할 수 있었다 | stderr 경고 1줄 추가(동작은 유지) | 수동 확인 |
| F8 | **Low** | `sim/VolleySim.Play/Program.cs:19,52,91` | `--runs abc` 같은 인자 오류가 `FormatException` 스택트레이스로 튀고, `--policy bogus` 는 `ArgumentException` 으로 죽었다 | 인자 파싱을 try/catch 로 감싸 한 줄 메시지 + 종료 코드 2, 정책 이름 오류는 사용 가능 목록을 함께 출력 | 수동 확인(`인자 오류: …`, `알 수 없는 정책: bogus — 사용 가능: safe / optimal / …`) |
| F9 | **Low** | `sim/VolleySim.Training/TrainingSession.cs:250` | `WeightedPreview` 가 훈련 경로(`WeightedPreviews`)에는 `PositionScale` 을 적용하지 않으면서 특훈·휴식 경로에만 곱해, 리베로(0.95)에서 두 값을 나란히 비교할 수 없었다. 정책의 EV 비교는 이 값을 절대 손실 가중(`EvLossWeight = 2.0`)과 같은 눈금에서 쓴다 | 특훈·휴식 경로에서도 `PositionScale` 을 빼 훈련과 같은 눈금으로 통일(정책 판정·오라클 수치 불변) | `RulesTests.WeightedPreview_UsesSameScaleForTrainingAndSpecial` |

## 2. 문서로 해소한 발견 (코드는 의도된 동작)

| # | 심각도 | 위치 | 증상 / 판정 | 조치 |
|---|---|---|---|---|
| F10 | **Med** | `sim/VolleySim.Core/Engine/RallyEngine.cs:59,104,328,358` | **리베로 역할 게인의 스트레치에 클램프가 없다.** `r_eff = 80 + 2.0×(r − 80)` 는 5.1절이 약속한 "0~100 스케일"을 벗어난다(전 스탯 0 리베로 → 음수, 만렙 리베로 → 100 초과). 판정은 로짓 차이만 쓰고 `SimMath.Logit/Sigmoid` 가 확률을 묶으므로 NaN·발산은 없지만, 스탯 양 끝에서 리베로 가치가 선형보다 빠르게 벌어진다 | **코드 유지**(의도된 대칭 보정, 6.9절). match-sim.md 6.9 표에 "클램프 없음 + 결과" 를 명시하고, 극단값에서 확률이 유한·유효하며 방향이 단조임을 테스트로 고정: `PositionValueRegressionTests.LiberoRoleGain_ExtremeRatings_KeepProbabilitiesValid`, `…_IsMonotonic_GoodLiberoBeatsBadLibero` |
| F11 | **Low** | `sim/VolleySim.Core/Engine/MatchEngine.cs:44` | `SetsToWin = 1`(육성 평가전)에서는 1세트가 곧 "최종 세트"라 `HomeServesFirst` 가 무시되고 **첫 서브가 동전 던지기**가 된다. 규칙 위반은 아니지만 문서만 읽고는 알 수 없다 | match-sim.md 4.1 절에 한 줄 명시(코드 무수정 — 바꾸면 평가전 캘리브레이션 값이 흔들린다) |
| F12 | **Low** | `docs/training-mode.md` 3.4 / 7.1 / 7.2 / 9.4 | 설계 문서 4항이 스크립트(오라클)·구현과 어긋나 있었다: 특훈 유효 기간, 특훈 종류 배분, 스텁의 컨디션 보정 제외, 선배 이벤트 동문 70% | 문서를 코드·오라클에 맞춰 최소 수정(3절 편차 판정 #1·#2·#3·#5·#7 참조). 동문 70% 를 실제로 켜는 절차는 training-mode 13절 열린 이슈로 신설 |
| F13 | **Low** | `sim/VolleySim.Play/AutoMode.cs:144` | `--calibrate-eval` 이 포지션 프로파일을 평행이동할 때 `Math.Clamp(…, 20, 99)` 가 걸려, Δ = −10 케이스의 **비핵심 스탯이 의도보다 높게** 잡힌다(예: L 의 스파이크 11.3 → 20). 캘리브레이션 표에 미세 편향 | 측정 도구이고 핵심3 평균 자체는 정확해 코드 유지. 아래 4절 부채로 기록 |

## 3. 설계 편차 16항 판정

`docs/prototype-play.md` 3절 표에 **판정 열**을 추가했다(근거·조치 포함). 요약:

| 판정 | 항목 | 개수 |
|---|---|---|
| **문서 수정** | #1 특훈 유효 기간, #5 강도 → 상대 팀 환산, #7 선배 이벤트 동문 70% | 3 |
| **코드 수정** | #13 재화(조각 3개 = 티켓 1 을 방출 경로에도 적용, F2) | 1 |
| **확정 스텁** | #2 특훈 종류 배분, #3 스텁 컨디션 보정, #4 활약도 공식 소재, #6 랜덤 이벤트 풀, #10 한계돌파, #11 6구단 로스터, #12 연습생, #14 난수 구현체, #15 스토리 정답, #16 서포터 편성 기억·슬롯 해금 | 10 |
| **편차 아님** | #8 졸업 등급(오라클 비교용 `OvrRaw` 병기), #9 부상 이력 미기록 | 2 |

판정 원칙: **오라클 스크립트와 C# 구현이 같은 동작이면 문서 쪽이 틀린 것**으로 보고 문서를 고쳤다(문서 수치 표 전체가 스크립트 출력이기 때문). 문서가 맞는데 코드가 틀린 경우는 #13 하나였고 코드를 고쳤다 — 이때 오라클(파이썬)은 육성 규칙만 다루고 재화를 모르므로 수정이 필요 없었다.

문서를 고치면서 **수치 표는 하나도 건드리지 않았다**. 유일하게 수치가 걸린 후보였던 #7(동문 70%)은 켜는 순간 9.5·12절 표를 다시 뽑아야 해서, "미적용 + 재측정 절차"를 문서화하는 쪽을 택했다(새 기능 추가 금지 범위와도 맞는다).

## 4. 확인했으나 고치지 않은 것 (기술 부채)

| # | 위치 | 내용 | 미수정 사유 |
|---|---|---|---|
| D1 | `sim/VolleySim.Play/Game.cs:140` `ReleaseInstance` | **대표 인스턴스를 방출하면** 같은 카드의 보관 인스턴스가 자동 승격되지 않아, 카드에 대표가 없는 상태가 된다(로스터 화면 `p<번호>` 로 수동 승격 가능, 라인업은 자동 재구성) | 승격 규칙(최고 OVR? 최근?)이 문서(8.6절)에 없다. 규칙 결정이 먼저 — prototype-play 7절 열린 이슈에 기록 |
| D2 | `sim/VolleySim.Training/TrainingRunner.cs:25` `Batch` | 몬테카를로가 **세션 객체 전부를 리스트로 보관**한다. 현재 호출자(오라클 표·테스트)는 스텁 평가전이라 무해하지만, 실제 시뮬 + 이벤트 수집으로 n=2,000 을 돌리면 경기 로그가 그대로 쌓여 메모리가 급증한다 | 집계만 남기도록 고치면 `RunSummary.From` 의 시그니처(공개 API)가 바뀐다. 리팩터링 금지 범위 |
| D3 | `sim/VolleySim.Play/AutoMode.cs:144` | F13 과 같은 항목(캘리브레이션 표의 클램프 편향) — 부채로만 재기재하고 건수는 F13 으로 센다 | 도구 전용, 핵심3 평균은 정확 |
| D4 | `sim/VolleySim.Core/Engine/TeamMatchState.cs:176` `TrySubstitute` | 실제 배구의 **재입장 제한**(교체돼 나간 선발은 자신을 대체한 선수와만 재교체) 미구현. 세트당 6회 한도·리베로 제외만 있다 | 프로토타입 AI 가 교체를 호출하지 않는다(match-sim 4.4절이 이미 "데이터 구조·한도만 준비"라고 명시) |
| D5 | `sim/VolleySim.Core/Engine/SetEngine.cs:41` | 안전장치 `MaxRalliesPerSet = 400` 이 발동하면 **2점차를 만족하지 않는 세트 스코어**가 기록되고, 동점이면 원정이 세트를 가져간다 | 동급 팀 수만 경기에서 발동 사례 없음(랠리 상한은 무한 루프 방지용). 발동 자체가 버그 신호이므로 조용히 보정하지 않는 편이 낫다 |
| D6 | `sim/VolleySim.Play/GameState.cs:28` / `Screens.cs:67` | 육성 카드 목록 번호가 `Dictionary<string,int> OwnedCards` 의 열거 순서에 의존한다. 삭제가 없어 실제로는 삽입 순서로 안정적이고 JSON 왕복도 순서를 보존하지만, 계약상 보장은 아니다 | 화면 번호에만 영향(판정·난수 경로 아님). 고치려면 표시 순서 정책(획득순/희귀도순)을 정해야 한다 |

## 5. 결정성 점검 (판정 경로)

- **시드 외 난수원 없음.** `sim/` 비테스트 코드 전체에서 `new Random(`·`Guid.`·`DateTime.`·`Environment.TickCount`·`Task.Run`·`Parallel.` 을 검색해, 판정 경로에서 쓰이는 곳이 하나도 없음을 확인했다(유일한 `DateTime.UtcNow` 는 `VolleySim.Cli` 리포트 헤더 문자열).
- **컬렉션 열거 순서 의존 없음.** `HashSet` 은 중복 검사(`TeamState.Validate`, `LineupBuilder`)에만, `Dictionary` 는 조회(`TeamState.GetPlayer` 인덱스, 박스스코어)에만 쓰인다. CLI 집계의 사전 순회는 정수 합이라 순서 무관.
- **부동소수점 누적 순서**는 코드에 고정돼 있고(`RunSummary` 는 고정 순서 리스트 위의 LINQ), 병렬 실행 경로가 없다.
- **저장/불러오기 후 재현성**: 저장 → 로드 → 이어 진행한 결과가 무중단 진행과 **세이브 JSON 바이트 단위로 동일**함을 실제 시뮬 평가전 포함으로 고정했다(`SaveLoadTests.SaveLoad_ThenContinue_MatchesUninterruptedRun`). 시드 상태는 `GameState.Seed` + `SeedIndex` 로 완전히 복원된다.
- **육성 세션**: 같은 시드 = 같은 로그·같은 난수 소비량(기존 `DeterminismTests`), 실제 시뮬 제공자 포함.

## 6. Core v0.2 재캘리브레이션 검증

match-sim.md 6.9 절의 **"중립값으로 되돌리면 v0.1 과 비트 단위로 같다"** 를 실측했다.

- 방법: v0.1 커밋 `f6ad79f` 의 `sim/VolleySim.Core` 를 그대로 빌드한 실행 파일과, 현재 Core 에 중립값(`Receive/Dig.LiberoRoleGain = 1.0`, `Block.MbStrengthWeight = 1.0`, `Attack.MbDecoyK = 0`, `Dig.WeightLibero = 1.5`, `Attack.DigTeamBlend = 0.30`, `Attack.QuickAvailGoodPass = 0.6`)을 넣은 실행 파일로 같은 시드·같은 로스터의 `MatchResult.Signature()` 를 뽑아 비교.
- 범위: 6개 시나리오 **160경기** — 기본 전술 60, 속공 100% 20, 리베로 중심 + 강서브 vs 분산 20, 전 스탯 99 리베로 20, 전 스탯 0 리베로 20, 전 스탯 99 MB 20. 즉 스트레치·MB 가중·디코이 경로를 모두 지난다.
- 결과: **160/160 서명 일치**(세트 스코어·팀 통계·난수 소비량 전부). 코드 경로상으로도 `MbDecoyK ≤ 0` 이면 디코이 계산 자체를 건너뛰고, `_quickThreatMb` 계산·`QuickShareFactor` 는 난수를 소비하지 않으며, MB 가중 1.0 의 가중 평균은 옛 산술 평균과 같은 연산 순서를 유지한다.
- 고정: 이 중 6건을 골든 값으로 `sim/VolleySim.Tests/PositionValueRegressionTests.cs` 에 넣었다. 앞으로 "중립이어야 할" 경로에 난수 소비나 연산 순서 변화가 생기면 이 테스트가 깨진다. 기본값이 중립값과 실제로 다른지도 함께 검사한다(골든 테스트가 무의미해지는 것을 막기 위해).

## 7. 배구 규칙 재확인 (코드 대조)

문서 4절과 코드를 대조해 다음을 확인했다(모두 기존 테스트가 이미 고정하고 있거나, 이번에 경계 테스트를 보강했다).

- **로테이션·서브권**: 사이드아웃일 때만 리시브 팀이 시계방향 1칸 회전 후 서브권 획득(`SetEngine`). 브레이크 포인트에서는 회전 없음.
- **리베로**: 후위 `6 → 5 → 1` 순으로 MB 를 대체하되 **서브권 보유 시 1번은 제외**(리베로 서브 금지). 표준 5-1 에서 두 MB 는 항상 대각(3·6)이라 후위에 정확히 한 명 → 교체 대상이 유일하다. 전위·서브·공격 후보에서 제외되고, 대상이 바뀌면 `LiberoOut → LiberoIn` 을 발행한다.
- **후위 블로킹 금지**: 블로커는 전위(2·3·4)에서만 고르고, 후위·리베로가 지명되면 불변식 예외를 던진다(`AddBlocker`).
- **세트 종료·경기 종료**: `max ≥ 목표점 && 차이 ≥ 2`, 5세트 15점, 3선승, 세트 수 3~5.
- **교체 한도**: 세트당 6회, 리베로 제외(D4 의 재입장 제한만 미구현).
- **육성 경계값**: 콜드/적정 30, 적정/핫존 45(부상 배지 등장선과 일치), 핫존/과열 80, 깊은 휴식 50 — 부등호 방향을 `RulesTests.BoundaryValues_ZoneInjuryAndRestDepth` 로 고정했다(29.999/30, 44.999/45/45.001, 79.999/80, 49.999/50).

## 8. 재현 방법

```bash
export DOTNET_ROOT=$HOME/.dotnet PATH=$HOME/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet build sim/VolleySim.sln
dotnet test  sim/VolleySim.sln                                   # 109개
python3 tools/training-sim/train_sim.py --quick                  # 파이썬 오라클
dotnet run --project sim/VolleySim.Play -- --auto --runs 8 --seed 1 --matches 3   # 0.4초, 6.1절 시드 1 행 재현
dotnet run --project sim/VolleySim.Play -- --script sim/VolleySim.Play/scripts/demo.txt --seed 7
```
