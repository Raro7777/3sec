# 트리거탭 — 분석과 개발 계획

기준 문서: `TriggerTap_Android_Plan_v0.2.md` (이하 "명세")  
작성일: 2026-09-24  
상태: 계획. 아래의 API 동작 설명 중 "검증 필요"로 표시한 것은 실제 단말에서 확인하기 전까지 가정이다.

## 1. 요약

명세는 범위가 좁고 안전장치가 잘 정의되어 있어 구현 가능성이 높다. 핵심 기술 요소는 세 가지뿐이다.

1. **감지**: `AccessibilityService.takeScreenshotOfWindow()`의 오류 코드 중 `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW`만 트리거로 사용 (API 34+).
2. **실행**: `dispatchGesture()`로 30ms 탭을 한 번씩 보내고, 완료 콜백 후 "직전 시작 + 100ms"에 다음 탭.
3. **상태 관리**: 단일 직렬 스레드 + `sessionId/requestId/runId`로 중복·지연 콜백 차단, 한 회차 후 정지.

가장 큰 위험은 코드가 아니라 **대상 앱과 단말의 실제 동작**이다(4장). 따라서 기능 전체를 만들기 전에 실제 폰에서 "보안 오류가 나오는가 / 터치가 전달되는가"를 먼저 확인하는 0단계를 둔다.

## 2. 명세에서 보완이 필요한 점

| # | 명세 내용 | 문제 | 제안 |
|---|---|---|---|
| A | "대상 창이 교체되면 남은 탭 중단", "정상 캡처 확인 후 차단으로 바뀌면" | 보안 화면은 대부분 **새 Activity = 새 windowId**로 뜬다. 창 ID를 고정하면 정상→차단 전환 자체를 "창 교체"로 보고 무시하게 된다. | 감시 대상을 고정 windowId가 아니라 **"대상 패키지의 현재 활성(포커스) 애플리케이션 창"**으로 정의. 회차 **시작 후**에만 windowId를 고정하고, 그 이후 교체되면 중단. |
| B | 정상 기준 확인(`baselineSuccessCount`) | 기준 확인 이후 앱이 백그라운드로 갔다 돌아오면 기준이 유효한지 불명확. | 대상 패키지가 전면에서 벗어나면 기준을 리셋(ARMED → WAITING_BASELINE). |
| C | 탭 사이 유효성 확인 | 창 목록 조회(`getWindows`)는 비용이 있음. 100ms 주기 안에서 매번 해도 되는지 미측정. | 창 변화는 `TYPE_WINDOWS_CHANGED` / `TYPE_WINDOW_STATE_CHANGED` 이벤트로 "무효 플래그"를 세우고, 탭 직전에는 플래그 + 화면 켜짐·회전·크기만 가볍게 확인. |
| D | 잠금 감지 | 방법 미기재. | `ACTION_SCREEN_OFF` 수신 + `KeyguardManager.isKeyguardLocked` 확인. |
| E | `calibrationVerified` | 무엇으로 검증 완료가 되는지 미정. | 진단 모드에서 사용자가 "시험 탭 1회"를 실행하고 눈으로 확인 후 체크. 테스트벤치 앱에서는 수신 좌표를 표시해 자동 확인. |
| F | 로그 보관 | 기간·개수 미정. | 최근 200건 링버퍼, 화면 내용 없이 코드·ID·타이밍만. 사용자 삭제 버튼. |
| G | 테스트용 보안 전환 화면 | 같은 앱 안에 두면 "다른 앱 창" 조건을 재현하지 못함. | **별도 패키지의 테스트벤치 APK**로 분리(5장). |

## 3. 명세와 API의 대응 확인

| 명세 요구 | 사용할 API / 설정 | 비고 |
|---|---|---|
| 창 단위 캡처 | `takeScreenshotOfWindow(windowId, executor, callback)` | 서비스 설정 `android:canTakeScreenshot="true"` |
| 오류 분류 | `ERROR_TAKE_SCREENSHOT_SECURE_WINDOW` 외 `INTERVAL_TIME_SHORT`, `INVALID_WINDOW`, `NO_ACCESSIBILITY_ACCESS`, `INTERNAL_ERROR` 등 | 보안 오류만 트리거, 나머지는 명세 7장 표대로 |
| 창 식별 | `getWindows()` + `AccessibilityWindowInfo` (type, isActive/isFocused, root packageName) | `canRetrieveWindowContent="true"`, `flagRetrieveInteractiveWindows` |
| 탭 | `GestureDescription.StrokeDescription(path, 0, 30)` 단일 점 경로 | `canPerformGestures="true"` |
| 완료/취소 | `GestureResultCallback.onCompleted / onCancelled`, `dispatchGesture` 반환값 false = 거부 | |
| 위치 편집 표식, 중지 버튼 | `TYPE_ACCESSIBILITY_OVERLAY` 창 | 별도 오버레이 권한 불필요 |
| 자원 해제 | `ScreenshotResult.hardwareBuffer.close()` | 지연·오래된 세션 결과도 반드시 닫음 |

## 4. 핵심 위험 (0단계에서 먼저 확인)

1. **대상 앱이 실제로 보안 오류를 반환하는가.** FLAG_SECURE를 쓰는 앱이면 반환될 가능성이 높지만, 앱이 원하는 순간에 보안 상태로 바뀌는지는 앱마다 다르다.
2. **대상 앱에 주입 터치가 먹히는가.** Android 14에는 접근성 도구가 아닌 서비스의 상호작용을 제한하는 `accessibilityDataSensitive` 속성이 있고, 일부 앱은 가려짐 필터(`filterTouchesWhenObscured`)나 자체 탐지로 접근성 입력을 무시하거나 경고한다. 주입 제스처가 어디까지 영향을 받는지는 **검증 필요**. 명세대로 `isAccessibilityTool`을 허위로 선언하지 않는다.
3. **캡처 요청 간격.** AOSP 소스상 333ms 제한이 있어 400ms 폴링이 제조사 기기에서 `INTERVAL_TIME_SHORT`를 자주 받는지 측정 필요.
4. **타이밍 편차.** 탭 시작 간격 100ms 목표의 실제 평균·편차는 단말·부하에 따라 다름. 테스트벤치에서 측정 후 조정.
5. **배포·정책.** 접근성 API를 쓰는 비(非)장애인용 자동화 앱은 Play 스토어 심사에서 별도 신고·고지가 필요하고 거절될 수 있다. 1차는 **직접 설치(APK) 전용**으로 가정. 또한 대상 앱의 이용약관이 자동 입력을 금지하는지는 사용자가 확인해야 한다.

1·2 중 하나라도 실패하면 이 방식 자체가 해당 앱에서 성립하지 않으므로, 전체 UI를 만들기 전에 판정한다.

## 5. 프로젝트 구조

Kotlin + Gradle(Kotlin DSL), 모듈 3개. 버전은 구현 시점의 안정판을 확인해 `gradle/libs.versions.toml`에 고정한다.

```text
triggertap/
├─ settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
├─ core/        순수 Kotlin(JVM) — Android 의존성 없음, JUnit으로 CI에서 바로 테스트
│   ├─ config/     TriggerConfig, 검증(좌표 범위, hold < interval, 1~10회, 80~200ms …)
│   ├─ capture/    CaptureOutcome(Success / Secure / IntervalShort / InvalidWindow / Fatal) 분류
│   ├─ poll/       PollLimiter — 동시 요청 1개, 400→500→750→1000ms 백오프
│   ├─ trigger/    TriggerStateMachine — IDLE, WAITING_BASELINE, ARMED, RUNNING, DONE, ABORTED
│   └─ tap/        TapScheduler — Clock·GestureSink 인터페이스 주입, "직전 시작+interval" 계산, 몰아치기 금지
├─ app/         Android 앱 (minSdk 34)
│   ├─ service/    TriggerTapService(AccessibilityService), WindowResolver, ScreenshotProbe, GestureSink 구현
│   ├─ overlay/    위치 표식 오버레이, 중지 버튼 오버레이
│   ├─ ui/         Compose: 대상 앱 선택, 위치 지정, 횟수·간격, 진단, 시작/중지, 결과, 고급 설정
│   └─ data/       DataStore 설정(schemaVersion 2), 진단 로그 링버퍼
└─ testbench/   별도 패키지의 테스트 대상 앱
    └─ FLAG_SECURE 토글(즉시/지연 N초), 큰 탭 영역, 수신 터치 카운터·시각·좌표 기록
```

`core`에 로직을 몰아두는 이유: 명세 10장 시험 중 상태·타이밍 관련 항목(중복 콜백, 6번째 탭 금지, 차단 유지 시 재실행 금지, 취소 후 재시도 금지, 두 번째 탭 후 중지 등)을 가짜 시계로 기기 없이 결정적으로 검증할 수 있다.

스레딩: 서비스 안에 전용 `HandlerThread` 하나를 두고 캡처 콜백·제스처 콜백·이벤트·사용자 중지를 모두 그 스레드로 보내 직렬 처리한다. 탭 예약은 `Handler.postAtTime(SystemClock.uptimeMillis 기준)`.

## 6. 상태 머신 (기본: NORMAL_TO_SECURE, ONE_SHOT)

```text
IDLE ──시작──▶ WAITING_BASELINE ──정상 캡처 N회──▶ ARMED
                     │                               │
                     │ 보안 오류: 무시(기본)           │ 보안 오류 M회 + 유효성 확인
                     │ (옵션 켜짐 시 확인 후 RUNNING)   ▼
                     │                           RUNNING ──5/5──▶ DONE
                     │                               │
                     └──── 중지/이탈/잠금/환경변경 ───┴──▶ ABORTED(전달 k/5, 이유)
대상 앱이 전면에서 벗어나면 ARMED → WAITING_BASELINE
DONE/ABORTED 이후 자동 재시작 없음. 서비스 재연결 시 항상 IDLE.
```

RUNNING 진입은 유효성 확인보다 **먼저** 잠금(명세 2장). RUNNING 동안 캡처 요청 중단.

## 7. 단계별 계획

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0. 타당성 스파이크** | 최소 서비스(포커스 창 캡처 결과 코드 표시 + 고정 좌표 시험 탭 1회 버튼) + 테스트벤치. CI로 디버그 APK 빌드. | 사용자 폰에서 ① 테스트벤치와 **실제 대상 앱**의 보안 오류 수신 ② 두 앱에 탭 전달 여부 ③ 400ms 폴링 시 간격 오류 빈도를 기록. 실패 시 여기서 중단·재검토. |
| 1. core | 설정·검증, 오류 분류, 폴링 제한기, 상태 머신, 탭 스케줄러 + 단위 테스트 | 명세 10장 항목 중 로직 항목을 JVM 테스트로 통과 |
| 2. 서비스 통합 | WindowResolver, ScreenshotProbe(버퍼 해제 포함), GestureSink, 무효화 이벤트, 잠금·회전 감지 | 테스트벤치로 정상→보안 전환 시 5탭, 차단 유지 시 추가 0탭 |
| 3. UI·오버레이 | 대상 앱 선택, 표식 위치 지정·저장(좌표+화면 환경), 진단 모드(탭 없음), 시작/중지, 결과, 고급 설정 | 첫 실행은 진단 모드, 검증 전에는 실제 실행 불가 |
| 4. 인수 시험 | 명세 10장 표 전체를 실제 폰 + 테스트벤치로 수행, 탭 간격 평균·범위·누락 측정 | 시험 결과표 작성(측정치 그대로, 보장 표현 없이) |
| 5. 배포 | 서명 APK 빌드 워크플로, 접근성 사용 고지 화면, 개인정보 문구(수집 없음) | 설치·활성화 안내 포함 APK |

CI: `triggertap/**` 경로에만 반응하는 별도 워크플로(`triggertap.yml`)에서 `:core:test` + `assembleDebug`(app, testbench). 기존 3sec의 `ci.yml`·Android 워크플로는 건드리지 않는다.

## 8. 결정이 필요한 사항

1. **저장소 위치** — 현재는 이 저장소의 `triggertap/` 폴더. 완전히 분리된 GitHub 저장소가 필요하면 새 저장소를 만들어 이 폴더를 옮긴다.
2. **패키지명** — 제안: `app.triggertap` / 테스트벤치 `app.triggertap.testbench`.
3. **배포 경로** — 직접 설치 APK 전용(제안) 또는 Play 스토어.
4. **테스트 단말** — 0단계는 사용자 실제 폰(제조사·Android 버전)과 실제 대상 앱에서만 판정 가능.
