# 로스터 팩

게임에는 가상의 구단과 선수만 들어 있습니다. 실제 이름으로 플레이하고 싶으면 **본인 기기에서** 로스터 팩을 만들어 설정 화면에서 불러오세요. 새 게임을 시작할 때 적용되고, 파일은 기기 밖으로 나가지 않습니다.

실제 구단명·엠블럼·선수 이름에는 각 구단, 연맹, 선수의 권리가 있습니다. 만든 팩을 배포하지 마세요. 이 도구는 변환기만 제공합니다.

## 형식

```json
{
  "format": "3sec-roster/1",
  "name": "내 로스터 2026",
  "clubs": [
    {
      "slot": 0,
      "name": "구단 이름",
      "shortName": "약칭",
      "color": "#e63946",
      "stadium": "홈구장 이름",
      "capacity": 40000,
      "reputation": 13.2,
      "players": [
        { "name": "선수 이름", "age": 27, "role": "ST", "number": 9, "rating": 15.5, "potential": 17 }
      ]
    }
  ]
}
```

- `slot` 0~11은 1부, 12~23은 2부입니다. 일부 슬롯만 넣어도 됩니다.
- `role`은 GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST 중 하나입니다.
- `rating`(1~20)을 주면 종합치가 그 값에 맞춰지고, 없으면 구단 수준 근처로 생성됩니다.
- 선수가 18명보다 적으면 생성 선수로 채우고, 골키퍼는 항상 2명 이상이 됩니다.
- `reputation`은 구단 수준(대략 9~14)으로 예산·기대 순위·관중에 영향을 줍니다.
- 설정 화면의 **템플릿 복사**를 누르면 24개 슬롯이 채워진 시작용 JSON이 클립보드에 들어옵니다.

## API-Football로 만들기

[api-sports.io](https://api-sports.io) 무료 키(하루 100요청)로 충분합니다. 26요청을 씁니다.

```sh
API_FOOTBALL_KEY=여기에_키 node tools/roster/from-api-football.mjs --season 2026 --out my-roster.json
```

생성된 파일을 폰으로 옮겨 설정 → 로스터 팩 → 로스터 파일 불러오기.

리그 id 기본값은 K리그1 292, K리그2 293이며 `--league1`, `--league2`로 바꿀 수 있습니다. 스쿼드 API에는 능력치가 없으므로 아는 선수의 `rating`은 손으로 채우세요.
