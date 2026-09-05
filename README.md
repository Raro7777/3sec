# 3sec — 여자 배구 매니저 게임

육성 수집형 모바일 스포츠 매니지먼트 게임. 가상 리그(블룸 리그)·가상 선수, 일본 애니메풍 카드 아트, 1인 개발.

**플레이 가능한 프로토타입이 `web/` 에 있습니다.** 스카우트 → 12턴 육성 → 졸업 → 라인업 → 리그 시즌(14매치데이 + 포스트시즌)이 한 바퀴 돌고, 경기는 쿼터뷰 코트에서 실제 물리로 재생됩니다.

```bash
node web/build.mjs        # web/dist/bloom.html — 브라우저에서 열면 됩니다
node web/app-test.mjs     # 화면 흐름 회귀 테스트 32건 (playwright 필요)
```

## 지금 어디까지 되어 있나

| 시스템 | 상태 |
|---|---|
| 경기 시뮬레이션 | 랠리 단위 판정, 실제 여자배구 지표로 캘리브레이션 |
| 육성 | 12턴 캠프, 피로·컨디션·부상, 서포터, 졸업 등급 |
| 리그 | 7팀 14매치데이, 승점·순위·개인 기록, 포스트시즌, 시즌 결산 |
| 수집 | 스카우트·10연·천장·포지션 지정, 중복 → 한계돌파 |
| 고유 스킬 | 24종이 판정에 관여하고 코트에 발동 연출로 표시 |
| 노화·세대 | 포지션별 전성기·하락·은퇴, 매 시즌 신인 5명 유입 |
| 아트 | **런칭 42명 카드·썸네일 완성**(5.78MB 인라인). 전신은 1장. 신인 세대는 아직 플레이스홀더 |

## 검증

숫자는 감으로 정하지 않습니다. 밸런스 상수를 바꾸면 해당 하네스를 돌려 문서 수치를 함께 갱신합니다.

```bash
node web/parity.mjs               # 경기·육성 지표가 목표 범위 안인가 (약 15초)
node web/season-check.mjs         # 시즌 1~3 난이도 목표 7건 (약 40초)
node web/season-check.mjs --long  # 시즌 1~15 장기 목표 20건 (약 60초)
node data/validate.mjs            # 로스터 스키마·분포
node tools/art-prompts.mjs --check # 아트 프롬프트 어휘 커버리지
node web/art-test.mjs             # 아트 슬롯인 회귀 12건 (playwright 필요)
```

## 문서

| 문서 | 내용 |
|---|---|
| [docs/GDD.md](docs/GDD.md) | 기획 총론 — 컨셉, 코어 루프, 비주얼 전략, 로드맵 |
| [docs/match-sim.md](docs/match-sim.md) | 경기 시뮬 설계 (랠리 상태기계·판정식·로테이션) |
| [docs/match-sim-balance-report.md](docs/match-sim-balance-report.md) | 몬테카를로 밸런스 리포트와 캘리브레이션 이력 |
| [docs/training-mode.md](docs/training-mode.md) | 육성 12턴 설계 — 성장 수식, 피로/부상, 졸업 |
| [docs/league-and-economy.md](docs/league-and-economy.md) | 리그 시즌·경제·노화·난이도 사다리 |
| [docs/skills.md](docs/skills.md) | 고유 스킬 시스템과 밸런스 밴드 |
| [docs/rookies.md](docs/rookies.md) | 신인 세대 생성 규칙 |
| [docs/world.md](docs/world.md) | 세계관 · 6구단 · 42명 런칭 로스터 |
| [docs/art-style-guide.md](docs/art-style-guide.md) | 아트 규격·프롬프트·리터치 QA·라이선스 |
| [docs/art-pipeline.md](docs/art-pipeline.md) | 그림 한 장을 게임 안까지 넣는 절차 |
| [docs/prototype-play.md](docs/prototype-play.md) | 콘솔 프로토타입 관찰 리포트 |
| [web/PARITY.md](web/PARITY.md) | 웹 엔진이 C# 과 어디까지 같고 어디서 갈라졌는가 |

## 저장소 구조

- `web/` — **기준 구현.** 엔진(`engine/`), 코트 렌더러, 앱 셸, 검증 하네스
- `data/` — 6구단·42명 런칭 로스터
- `docs/` — 기획·설계 문서
- `art/` — 아트 에셋. 런칭 42명 카드·썸네일이 `04_export/` 에 들어와 있다. [art/README.md](art/README.md)
- `tools/` — 파이썬 검증 시뮬레이터(육성·경제). 보조 모델이며 권위는 `web/` 하네스에 있습니다
- `sim/` — **C# 참고 구현(아카이브).** 경기·육성만 담고 있고 리그·스킬·노화는 없습니다. [sim/README.md](sim/README.md) 참조
