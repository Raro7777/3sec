# 트리거탭 (TriggerTap)

사용자가 지정한 앱의 창이 보안 캡처 거부(`ERROR_TAKE_SCREENSHOT_SECURE_WINDOW`)로 바뀌면, 사용자가 지정한 한 좌표를 약 100ms 간격으로 5회 터치하는 Android 14+ 앱.

이 폴더는 3sec(풋볼 매니저) 모노레포와 **무관한 별개 프로젝트**다. pnpm 워크스페이스(`apps/*`, `packages/*`)에 속하지 않으며, 기존 빌드·CI·릴리스 워크플로를 공유하지 않는다. 독립 저장소로 옮길 때는 이 폴더를 그대로 루트로 쓰면 된다.

| 문서 | 내용 |
|---|---|
| [docs/TriggerTap_Android_Plan_v0.2.md](docs/TriggerTap_Android_Plan_v0.2.md) | 요구사항·설계 원문 (v0.2) |
| [docs/PLAN.md](docs/PLAN.md) | 분석, 설계 보완점, 모듈 구조, 단계별 개발 계획 |

상태: 계획 단계. 아직 소스·APK 없음. 기기 호환성과 타이밍은 미검증.
