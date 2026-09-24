# 트리거탭 (TriggerTap)

사용자가 지정한 앱의 창이 보안 캡처 거부(`ERROR_TAKE_SCREENSHOT_SECURE_WINDOW`)로 바뀌면, 사용자가 지정한 한 좌표를 약 100ms 간격으로 5회 터치하는 Android 14+ 앱.

이 폴더는 3sec(풋볼 매니저) 모노레포와 **무관한 별개 프로젝트**다. pnpm 워크스페이스(`apps/*`, `packages/*`)에 속하지 않으며, 기존 빌드·CI·릴리스 워크플로를 공유하지 않는다. 독립 저장소로 옮길 때는 이 폴더를 그대로 루트로 쓰면 된다.

| 문서 | 내용 |
|---|---|
| [docs/TriggerTap_Android_Plan_v0.2.md](docs/TriggerTap_Android_Plan_v0.2.md) | 요구사항·설계 원문 (v0.2) |
| [docs/PLAN.md](docs/PLAN.md) | 분석, 설계 보완점, 모듈 구조, 단계별 개발 계획 |
| [docs/STAGE0.md](docs/STAGE0.md) | 0단계 실제 폰 시험 절차와 판정 기준 |

## 현재 상태: 0단계 (타당성 확인)

| 모듈 | 내용 |
|---|---|
| `app/` (`app.triggertap.probe`) | 진단 앱. 대상 창 캡처 결과 코드 기록 + 플로팅 패널에서 누를 때만 시험 탭. 자동 트리거 없음 |
| `testbench/` (`app.triggertap.testbench`) | 시험 대상 앱. 보안 전환(같은 창/새 창), 수신 터치 수·간격 기록, 뷰 보안 필터 토글 |

빌드 확인은 됐지만 실제 기기 동작은 아직 검증하지 않았다.

## 빌드

JDK 17+, Android SDK(platform 36). `local.properties`에 `sdk.dir` 지정 후:

```bash
./gradlew assembleDebug   # app/build/outputs/apk/debug, testbench/build/outputs/apk/debug
```

CI: `.github/workflows/triggertap.yml` — `triggertap/**` 변경 시 두 APK를 빌드해 `triggertap-latest` 프리릴리스에 올린다. 디버그 서명 키(`debug.keystore`)는 업데이트 설치가 이어지도록 커밋되어 있으며 디버그 빌드에만 쓴다.
