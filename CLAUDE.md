# 3sec — 여자 배구 매니저 게임

## 프로젝트

카드 수집·육성형 모바일 스포츠 매니지먼트 게임. 가상 리그(블룸 리그)·가상 선수, 일본 애니메풍 아트,
Unity 2D 예정, 1인 개발. 기획 문서는 `docs/`, 시작점은 `docs/GDD.md`.

## 사용자 환경 (중요)

- **사용자는 휴대폰으로 확인하고 플레이한다.** 웹 프로토타입·아티팩트·산출물은 전부 **모바일 우선**으로 만들 것:
  세로 화면 기준 레이아웃, 터치 타깃 44px 이상, 호버에 의존하는 인터랙션 금지, 가로 스크롤 금지,
  긴 표는 카드형으로 재배치, 본문 16px 이상.
- 사용자는 터미널에서 직접 명령을 실행하기 어려운 환경일 수 있다. 결과는 링크나 이미지로 보여줄 것.
- 대화는 한국어로 한다.

## 코드

**`web/` 이 기준 구현이다.** 새 시스템은 여기에 들어간다.

- `web/engine/` — 경기·육성·리그·경제·스킬·노화·신인 (순수 JS, DOM 비참조)
- `web/app-shell.html` — 모바일 앱 셸(화면). `web/court-render.js` — 쿼터뷰 코트 렌더러
- `data/` — 6구단·42명 런칭 로스터. 신인 세대는 시드에서 런타임 생성한다
- `tools/` — 파이썬 보조 시뮬레이터 + `art-prompts.mjs`(캐릭터별 프롬프트 생성). **권위는 `web/` 하네스에 있다**
- `art/` — 아트 에셋. 런칭 42명 **카드·전신** + 신인 외형 풀 **72종**(`04_export/{pid|rkNN}/`, 빌드가 data: URI 로 인라인, 9.75MB).
  썸네일 파일은 없다 — 초상·상반신·코트 얼굴은 카드에서 오린다. 연습생·결원 대체 선수도 풀의 얼굴을 쓴다. `docs/art-pipeline.md`(화면 활용은 16절)
- `sim/` — C# 참고 구현(아카이브). 경기·육성만 있고 리그·스킬·노화·신인은 없다. `sim/README.md` 참조

### 빌드·검증

```bash
node web/build.mjs                # web/dist/bloom.html
node web/app-test.mjs             # 화면 흐름 회귀 114건 (playwright 필요)
node web/parity.mjs               # 경기·육성 지표 정합
node web/season-check.mjs         # 시즌 1~3 난이도 목표 9건 (엔진 기본 경제)
node web/season-check.mjs --app   # 같은 목표를 앱 경제(시작 티켓·온보딩 미션)로
node web/season-check.mjs --long  # 시즌 1~15 장기 목표 20건
node web/season-check.mjs --no-subs --no-bench --no-condition --no-injury --no-chemistry --no-ops   # 경기 엔진 2단계(match-sim 16~19절) 도입 전 수치 재현
node data/validate.mjs            # 로스터 스키마
node tools/art-prompts.mjs --check # 아트 프롬프트 어휘 커버리지
python3 tools/art-standee.py --check # 전신 42장 → 코트 스탠디(누끼) 유무·앵커 (만들기: --force, 미리보기: --preview)
python3 tools/art-rig.py --check     # 리그 파츠 시트 S/M/L — A-포즈 생성본을 관절로 자른 것 (만들기: 인자 없이, 미리보기: --preview)
python3 tools/art-faces.py --check   # 표정 얼굴 42명 × 3종(집중·환호·낙담) — 카드 참조 표정 시트에서 오린 것 (만들기: 인자 없이, 미리보기: --preview)
node web/art-test.mjs             # 아트 슬롯인 회귀 20건
```

밸런스 상수를 바꾸면 위 하네스를 돌려 **문서 수치를 함께 갱신한다.** 하네스 목표를 넓혀서 통과시키지 않는다.

## 작업 원칙

- **수치는 감으로 정하지 않는다.** 밸런스 상수를 바꾸면 해당 하네스를 돌려 문서 수치를 함께 갱신한다.
- **권위는 `web/` 하네스에 있다.** 파이썬 보조 모델(`tools/`)이나 문서 값과 어긋나면 실제 엔진이 맞다.
  문서에는 어느 리비전에서 측정한 값인지 남긴다.
- 테스트·목표의 허용 범위를 넓혀서 통과시키지 않는다.
- 기존 캘리브레이션을 깨지 않는 것이 새 기능보다 우선한다. 새 시스템은 "그 기능이 꺼진 상태에서
  기존 지표가 그대로인가"를 먼저 확인한다.
- 실존 선수·구단·기업명, 특정 작품(하이큐 등) 연상 요소를 넣지 않는다.
