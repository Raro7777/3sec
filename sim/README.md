# sim/ — C# 참고 구현 (아카이브)

이 디렉터리는 **더 이상 새 시스템이 들어가는 곳이 아닙니다.** 기준 구현은 `web/` 입니다.

## 왜 남겨 두는가

Unity(C#)로 가는 것이 최종 목표라, 경기 시뮬과 육성의 **검증된 C# 구현**을 버리지 않고 둡니다.
여기 있는 것은 그 두 시스템의 온전한 구현이고, 지금도 빌드되고 테스트를 통과합니다.

```bash
export DOTNET_ROOT=$HOME/.dotnet PATH=$HOME/.dotnet:$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet build sim/VolleySim.sln
dotnet test  sim/VolleySim.sln     # 109개 통과 (Core 45 · Training 48 · Play 16)
```

## 담고 있는 것

| 프로젝트 | 내용 |
|---|---|
| `VolleySim.Core` | 랠리 단위 경기 시뮬 (netstandard2.1, 외부 의존 0). 포지션 가치 v0.2 보정 포함 |
| `VolleySim.Training` | 육성 12턴 규칙 v0.2 (강도 곡선·부상·서포터·졸업) |
| `VolleySim.Play` | 콘솔 코어 루프 프로토타입 |
| `VolleySim.Cli` | 몬테카를로 밸런스 리포트 |

## 담고 있지 **않은** 것

`web/` 에만 있고 여기에는 없는 시스템입니다. 이식하려면 각 문서의 이식 메모를 보세요.

| 시스템 | 문서 | 이식 메모 |
|---|---|---|
| 리그 시즌·순위·포스트시즌·경제 | [docs/league-and-economy.md](../docs/league-and-economy.md) | C 절(구현 인터페이스 초안) |
| 선수 고유 스킬 | [docs/skills.md](../docs/skills.md) | 8절 |
| 노화·전성기·은퇴 | [docs/league-and-economy.md](../docs/league-and-economy.md) | A.3.6 |
| 신인 세대 생성 | [docs/rookies.md](../docs/rookies.md) | 10절 |

이식할 때의 정합 기준은 `web/PARITY.md` 에 있습니다. 특히 **"스킬 보유자가 없는 경기는 스킬 도입 전과 비트 단위로 동일"** 과 **"난수 소비량 불변"** 이 이식 검증의 기준선입니다.

## 주의

- `data/players.json` 스키마는 `web/` 과 공유합니다. 한쪽만 고치면 갈라집니다.
- 밸런스 상수(포지션 가치·육성 곡선)는 여기와 `web/` 양쪽에 있습니다. **웹 쪽이 권위**이며, 여기 값이 다르면 웹을 기준으로 맞춰야 합니다.
