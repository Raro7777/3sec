# 디자인 시스템 — 블룸 리그 매니저

> 앱 셸(`web/app-shell.html`)의 화면 디자인 기준 문서. 색·모양·연출을 바꾸면 여기 표를 함께 갱신한다.
> 방향: **밝고 캐주얼한 UI + 가챠 프리미엄 광택.** 메뉴·허브는 밝게, 카드 일러스트와 경기 코트는 어둡게 둬서
> "밝은 UI 위의 극적인 뽑기·경기 순간"을 만든다. 캐릭터 아트 파이프라인은 [art-pipeline.md](art-pipeline.md)·[art-style-guide.md](art-style-guide.md).
>
> **앱 안의 살아있는 짝**: 감독실 → 구단 운영 → **디자인 시스템**(`view='style'`, `vStyleGuide()`) 화면이 이 문서의 토큰·컴포넌트·연출을 실물로 모아 보여준다. 실제 클래스(`.btn`·`.gbtn`·`.pill`·`.grade`·`.gauge`)로 그려서 문서와 화면이 어긋나면 눈에 띈다. 색·컴포넌트를 바꾸면 그 화면도 함께 본다.

## 어디에 무엇이 있나 (단일 소스)

| 에셋 | 위치 | 비고 |
|---|---|---|
| **디자인 토큰**(색·그림자·라운드·타이포) | `web/app-shell.html` 최상단 `:root` "디자인 시스템 토큰" 블록 | 한 곳에 모음 |
| **UI 키트 스프라이트**(버튼 프레임 `--gframe`) | `app-shell.html` `:root` "UI 키트 스프라이트" 주석 아래 | 인라인 SVG data URI(9-슬라이스) |
| **컴포넌트 CSS**(버튼·카드·허브·소환·랠리 등) | `app-shell.html` `<style>` | 아래 컴포넌트 표 |
| **배경 씬**(허브·스카우트 로비·훈련장·라커룸·경기장) | `art/04_export/scene/{home,scout,train,roster,match}.webp` → `web/build.mjs` 가 `window.BLOOM_SCENE` 로 인라인 | `sceneOf(name)`·`roomHead(kind,…)` 로 읽음. 5개 주요 탭 전부 룸. 밝은 애니풍 체육관 톤 통일 |
| **캐릭터 아트**(카드·전신·스탠디·표정·리그 파츠) | `art/04_export/{pid|rkNN}/` → `window.BLOOM_ART`·`window.BLOOM_RIG` | art-pipeline.md |
| **폰트** | `app-shell.html` `<head>`의 Google Fonts `<link>` | 아래 타이포 |
| **연출 QA 훅** | `window.__fx = { grade, summon, eval }` | 순수 연출, 판정 무관. 회귀는 `localStorage['bloom-fx-off']` 로 건너뜀 |

## 색 토큰

| 토큰 | 값 | 역할 |
|---|---|---|
| `--bg` / `--bg2` | `#E7EFF8` / `#DCE8F5` | 앱 바탕(위→아래 그라데이션) |
| `--panel` / `--panel2` / `--panel3` | `#FFFFFF` / `#F1F6FC` / `#E5EEF7` | 카드·보조면·트랙 |
| `--line` / `--line2` | `#DCE6F1` / `#C4D4E4` | 테두리 |
| `--ink` / `--ink2` / `--ink3` | `#16242F` / `#57697A` / `#8F9EAD` | 본문·보조·흐린 글씨 |
| `--court` / `--court-2` / `--court-bg` | `#2E86E6` / `#57A6F5` / `#E3EEFC` | 주 액션(파랑)·밝은 변형·선택 배경 |
| `--hot` / `--hot-2` / `--hot-bg` | `#F1913C` / `#FFB05E` / `#FDEEDC` | 보상·경고(주황) |
| `--good` / `--bad` | `#1FB884` / `#E15748` | 성공/실패 |
| 등급 `--n` `--r` `--sr` `--ssr` | `#7C8B9A` `#4C8FE0` `#9B63E0` `#E0A81E` | N 회색·R 파랑·SR 보라·SSR 금 — 카드 프레임·소환·졸업 등급 리빌 공용 |

**어둡게 유지하는 영역(밝은 UI 예외)**: 카드 일러스트(`.rcard`), 경기 코트 캔버스(`.court`, `#0C1620`), 소환·등급 리빌 오버레이. 이들 위의 스크림은 `rgba(10,16,23,…)` 로 둔다.

## 고도·모양·터치

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--sh1` | 얕은 2겹 그림자 | 카드·선수 행·자원 배지 |
| `--sh2` | 깊은 그림자 | 히어로·플로팅 플레이트 |
| `--shg` | 코트블루 발광 | 주 버튼 |
| `--rad` | `16px` | 카드·패널 기본 라운드 |
| `--tap` | `48px` | 최소 터치 타깃(모바일 규칙) |

## 타이포

| 용도 | 폰트 | 비고 |
|---|---|---|
| 본문 | `Gothic A1` (400~800) | 16px 이상(iOS 확대 방지) |
| 숫자 | `Barlow Condensed` (500~800) | OVR·점수·스탯. `.num` |
| 디스플레이(로고·헤더·큰 숫자·등급) | `Black Han Sans` = `--display` | `.disp`, `h1`(허브), `.rib`, `.gbtn`, `.sm-grade` |

섹션 헤더 `h2` 는 좌측 액센트 바(코트블루)를 단다. 허브 헤더는 `.rib` 리본형.

## 컴포넌트 키트

| 컴포넌트 | 클래스 | 규격 |
|---|---|---|
| 상단바 | `.topbar` | 흰 반투명+블러, 자원은 `.res span` 알약 배지 |
| 하단 탭바 | `.nav` | 흰 반투명, 활성 탭 발광 필(`::before`)+상단 인디케이터(`::after`)+아이콘 확대 |
| 카드 | `.card` (`.flat`) | 흰색, `--rad`, `--sh1` |
| 플로팅 플레이트 | `.plate` (`.dark`) | 유리 반투명 프레임(허브 HUD) |
| 버튼(주/고스트) | `.btn` (`.ghost`) | 그라데이션+`--gframe` 9-슬라이스 프레임. 고스트는 흰 카드형 |
| 큰 게임 버튼 | `.gbtn` (`.play`·`.ghost2`) | 디스플레이 폰트+프레임+하단 입술 그림자. 허브 도크 |
| 허브 씬 | `.hub`·`.hub-char`·`.hub-in`·`.hub-dock`·`.hub-stats`·`.namep`·`.hub-mission` | 배경 씬+누끼 캐릭터(대기 애니)+떠있는 HUD |
| 씬 룸(탭 헤더) | `.room`(`.scout`·`.train`·`.roster`·`.match`)·`.rin`·`.rplate`·`.rib` | `roomHead(kind,title,sub,badge)`. 배경 씬 배너 위에 홈 HUD 같은 유리 플레이트 제목. 씬 없으면 화면별 CSS 그라데이션. 시즌 중 리그 헤더(`leagueHeader`)는 경기장 씬 룸 안에 순위 스탯을 얹음 |
| 자원 HUD 연출 | `.res span.res-pop`(`.res-up`·`.res-dn`) | 티켓·골드·조각이 바뀌면 알약 팝 + 숫자 색 번쩍(획득 초록·소비 주황). `bumpRes()` 가 이전값 대비 감지 |
| 화면 전환 | `#view.v-fwd`·`.v-back`·`.v-fade` | 탭/하위화면 깊이로 방향 판정(`applyViewTransition`). 앞으로=오른쪽서, 뒤로=왼쪽서. 전환마다 `sfx('ui')` 톡 + 가벼운 햅틱(설정 존중) |
| 데일리 인사·출석 | `.daily`·`.daily-card`·`.daily-char`·`.daily-week`·`.daily-bonus`·`.daily-streak` | 접속 시 하루 한 번 대표 선수가 인사 + 출석 보상(골드). 연속 출석 표시·7일차 개근 보너스(축포+ssr). `maybeDaily`/`showDaily`/`claimDaily`. 경제 근거는 league-and-economy.md 출석 보상 |
| 경기 결과 히어로 | `.rhero`(`.win`·`.loss`)·`.rmvp` | 세트 차로 문구(완승/승리/짜릿한 승리 · 석패/패배) + 이 경기 최고 선수(MVP) 초상. 승리 시 `finishViewer` 가 `confetti()`+cheer |
| 축포 | `.cfti` | `confetti()` — 승리·개근 등 큰 순간에 잠깐. 연출만(fx-off·reduce 면 생략) |
| 소환 연출(가챠) | `.summon` + `.charge`/`.tell`/`.burst`, `.rk-SR`/`.rk-SSR` | 암전→충전→등급색 예고→폭발. 등급 색은 실제 결과와 일치(B.2.3, 가짜 아쉬움 금지) |
| 졸업 등급 리빌 | `.summon.show-grade`+`.sm-grade` | `runGradeReveal(grade)`. S 금·A 보라·B 파랑·C/D 회색 |
| 평가전 순간 | `.evalflash` (`.mvp`) | `evalFlash(text)`. 화면 중앙 배너+사운드·햅틱 |
| 랠리 스트립 | `.rally`·`.touches` | 한 줄 필름스트립(가로 스크롤, 세로로 안 늘어남), 최신 접점 자동 스크롤 |
| 등급 카드 | `.rcard` + `.N/.R/.SR/.SSR` | 뒤집기·등급 프레임·SSR 광·shine. 스카우트 결과·도감 |

## 스프라이트 — 버튼 프레임 `--gframe`

인라인 SVG 9-슬라이스(`viewBox 0 0 100 100`, `border-image` 슬라이스 27 / 폭 13px). 색 없는 림(상단 흰 유리광 → 하단 어두운 베벨)+안쪽 하이라이트 선+모서리 리벳 4개. 버튼 배경색은 각 변형이 담당하고 프레임만 위에 얹는다. 벡터라 어느 크기에서도 선명. 규격을 바꾸면 이 값과 아래 컴포넌트를 함께 본다.

## 배경 씬 추가하는 법

1. `art/04_export/scene/<이름>.webp` (모바일 세로, 720px 폭 내외, q80) 저장.
2. `node web/build.mjs` 가 `window.BLOOM_SCENE["<이름>"]` 로 자동 인라인.
3. 화면에서 `sceneOf("<이름>")` 로 배경 지정. 하단은 UI 가려도 되게 여백을 둔 구도로.

## 모션

- 전환·눌림은 `.08~.35s`. 카드 뒤집기 `.85s`. 소환/등급 리빌 `~1.0~2.4s`(등급·등급색에 따라).
- 화면 전환 `.26s`(슬라이드), 자원 팝 `.5s`. 방을 옮기는 느낌을 주되 조작을 막지 않을 만큼 짧게.
- **모두 `prefers-reduced-motion` 을 존중**한다(reduce 면 애니메이션 끄거나 대폭 단축).
- 연출은 전부 표현 계층 — 결과가 정해진 뒤 재생하며 판정·확률·RNG 를 건드리지 않는다.

## 모바일 규칙 (CLAUDE.md)

세로 화면 기준 · 터치 타깃 44px 이상(`--tap` 48) · 호버 의존 금지 · **페이지 가로 스크롤 금지**(랠리 스트립처럼 상자 안 가로 스크롤은 허용) · 본문 16px 이상 · 긴 표는 카드형.
