// data/players.json · data/teams.json → web/data.js 생성 스크립트.
// 실행: node web/build-data.mjs   (결과 web/data.js 는 그대로 커밋 가능한 ES 모듈)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const players = JSON.parse(readFileSync(join(root, 'data', 'players.json'), 'utf8'));
const teams = JSON.parse(readFileSync(join(root, 'data', 'teams.json'), 'utf8'));

const head = `// 자동 생성 파일 — 수정하지 말 것. 생성: node web/build-data.mjs
// 원본: data/players.json (${players.length}명), data/teams.json (${teams.length}구단)
// 스키마는 sim/VolleySim.Core/Data/JsonDataLoader.cs 의 파서와 1:1.
`;

const body =
  head +
  '\nexport const PLAYERS = ' + JSON.stringify(players, null, 1) + ';\n' +
  '\nexport const TEAMS = ' + JSON.stringify(teams, null, 1) + ';\n';

writeFileSync(join(here, 'data.js'), body);
console.log(`web/data.js 생성 완료: 선수 ${players.length}명, 구단 ${teams.length}개, ${(body.length / 1024).toFixed(1)}KB`);
