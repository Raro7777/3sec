# 3sec — 여자 배구 매니저 게임

육성 수집형 모바일 스포츠 매니지먼트 게임 프로젝트. 가상 리그·가상 선수, 일본 애니메풍 카드 아트, Unity 2D 예정, 1인 개발.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/GDD.md](docs/GDD.md) | 기획 총론 — 컨셉, 코어 루프, 시스템 개요, 비주얼 전략, 기술 스택, 로드맵 |
| [docs/match-sim.md](docs/match-sim.md) | 경기 시뮬레이션 상세 설계 (랠리 상태기계, 판정식, 로테이션, 이벤트 스키마) |
| [docs/match-sim-balance-report.md](docs/match-sim-balance-report.md) | 몬테카를로 밸런스 리포트와 캘리브레이션 이력 |
| [docs/training-mode.md](docs/training-mode.md) | 육성 모드(신인 → 졸업) 상세 설계 — 12턴 캠프, 성장 수식, 피로/부상, 졸업 판정 |
| [docs/world.md](docs/world.md) | 세계관 · 블룸 리그 · 6구단 · 42명 런칭 로스터 설정 |
| [docs/art-style-guide.md](docs/art-style-guide.md) | 아트 스타일 가이드 — 규격, 프롬프트 템플릿, 리터치 QA, 라이선스 체크리스트 |

## 데이터

- `data/teams.json` — 6구단, `data/players.json` — 42명 (시뮬 코어와 공유하는 스키마)
- 검증: `node data/validate.mjs`

## 경기 시뮬레이션 코어 (`sim/`)

순수 C# 라이브러리(netstandard2.1, 외부 의존 없음 — Unity·서버 공용) + xUnit 테스트 + 몬테카를로 CLI.

```bash
# .NET 8 SDK (없을 경우)
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir $HOME/.dotnet
export DOTNET_ROOT=$HOME/.dotnet PATH=$HOME/.dotnet:$PATH

dotnet build sim/VolleySim.sln
dotnet test  sim/VolleySim.sln

# 랜덤 동급 팀 2,000경기 밸런스 리포트
dotnet run --project sim/VolleySim.Cli -- --matches 2000 --seed 42
# 실제 로스터로 실행 + 한국어 텍스트 중계
dotnet run --project sim/VolleySim.Cli -- --matches 1 --seed 3 \
  --players data/players.json --teams data/teams.json --commentary
```

## 육성 모드 + 코어 루프 프로토타입 (`sim/VolleySim.Training`, `sim/VolleySim.Play`)

`VolleySim.Training`(netstandard2.1)은 training-mode.md v0.2 규칙의 C# 구현이고, `VolleySim.Play`(net8.0 콘솔)는 "스카우트 → 육성 → 졸업 → 로스터/서포터 → 라인업 → 경기"가 한 바퀴 도는 한국어 텍스트 프로토타입이다. 실행법·설계 편차·관찰 리포트는 [docs/prototype-play.md](docs/prototype-play.md).

```bash
dotnet run --project sim/VolleySim.Play                                  # 대화형
dotnet run --project sim/VolleySim.Play -- --script sim/VolleySim.Play/scripts/demo.txt
dotnet run --project sim/VolleySim.Play -- --auto --runs 8 --seed 1 --matches 3   # 정책 자동 육성 후 6구단과 경기
dotnet run --project sim/VolleySim.Play -- --oracle-table                # 파이썬 오라클 정책표 재현
```

## 도구

- `tools/training-sim/train_sim.py` — 육성 모드 수식 검증용 파이썬 몬테카를로 (`python3 tools/training-sim/train_sim.py`)
