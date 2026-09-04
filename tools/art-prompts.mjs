/* 캐릭터별 이미지 생성 프롬프트 팩 생성기.
 *
 *   node tools/art-prompts.mjs           # art/00_guide/prompts/ 에 42명분 + 인덱스 생성
 *   node tools/art-prompts.mjs --check   # 파일을 쓰지 않고 어휘 커버리지만 검사 (CI 용)
 *   node tools/art-prompts.mjs --id p001 # 한 명만 표준출력으로
 *
 * 왜 필요한가:
 *   docs/art-style-guide.md 6절의 프롬프트는 `{hairStyle}` 같은 빈 슬롯이 뚫린 템플릿이고,
 *   data/players.json 의 외형 값은 "롱 하이 포니테일"·"플래티넘 블론드" 같은 한국어다.
 *   둘을 손으로 이어 붙이면 42명 × (카드 + 스탠딩 + 표정 4 + 토큰) = 250개 프롬프트를 사람이 타이핑해야 하고,
 *   그 과정에서 표기가 흔들리면 8.2절의 "42명이 같은 스타일인가" QA 가 통과할 수 없다.
 *
 * 이 파일이 지키는 것:
 *   1. **어휘는 닫혀 있다.** 런칭 42명과 신인 생성기(web/engine/rookies.js)가 쓰는 외형 값은 같은 목록이다.
 *      매핑에 없는 값이 하나라도 나오면 조용히 넘어가지 않고 **에러로 죽는다**(--check 가 CI 게이트).
 *   2. **작가명·작품명·스튜디오명을 쓰지 않는다**(art-style-guide 6절 · CLAUDE.md 작업 원칙).
 *   3. 데이터에 없는 값(피부톤·눈매)은 **결정적으로 배정**하고 그 사실을 프롬프트 파일에 적는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'art', '00_guide', 'prompts');
const META_OUT = path.join(ROOT, 'art', '00_guide', 'meta_seed');

const ARGV = process.argv.slice(2);
const CHECK = ARGV.includes('--check');
const ONE = (() => { const i = ARGV.indexOf('--id'); return i >= 0 ? ARGV[i + 1] : null; })();

// ────────────────────────────────────────────────────────────── 어휘 매핑
// 값 출처: data/players.json · web/engine/rookies.js 의 HAIR_STYLES / HAIR_COLORS_* / EYE_COLORS / BODY_TYPES.
// 태그는 Danbooru 계열 애니메 체크포인트가 이해하는 형태로 적는다(art-style-guide 6절 전제).

/** 헤어스타일 42종 → 태그. 길이 태그(long/medium/short hair)를 반드시 포함시킨다 — 실루엣 구분의 1축. */
const HAIR_STYLE = {
  '롱 하이 포니테일':        'high ponytail, long hair',
  '픽시 숏컷':               'pixie cut, very short hair',
  '로우 포니테일':           'low ponytail, long hair',
  '숏 보브':                 'bob cut, short hair',
  '일자 뱅 단발':            'bob cut, short hair, blunt bangs',
  '트윈 번':                 'double bun, hair bun, medium hair',
  '사이드 브레이드':         'side braid, long hair',
  '안쪽 컬 숏 보브':         'bob cut, short hair, inward curl',
  '롱 싱글 브레이드':        'single braid, long hair',
  '하프업 미디엄':           'half updo, medium hair',
  '롱 스트레이트':           'long hair, straight hair',
  '로우 트윈테일':           'low twintails, long hair',
  '울프컷 미디엄':           'wolf cut, layered hair, medium hair',
  '픽시 숏컷 정돈형':        'pixie cut, very short hair, neat hair',
  '사이드 포니테일 미디엄':  'side ponytail, medium hair',
  '하이 번':                 'hair bun, high bun, medium hair',
  '헤어밴드 롱 스트레이트':  'long hair, straight hair, hairband',
  '시스루 뱅 단발':          'bob cut, short hair, see-through bangs',
  '미디엄 웨이브':           'medium hair, wavy hair',
  '프렌치 브레이드':         'french braid, long hair',
  '짧은 트윈테일':           'short twintails, short hair',
  '사이드 뱅 레이어드 미디엄': 'medium hair, layered hair, swept bangs',
  '크롭 숏컷':               'very short hair, cropped hair',
  '미디엄 하이 포니테일':    'high ponytail, medium hair',
  '롱 웨이브':               'long hair, wavy hair',
  '턱선 단발 보브':          'bob cut, chin-length hair',
  '트윈 브레이드':           'twin braids, long hair',
  '사이드 핀 픽시 숏컷':     'pixie cut, very short hair, hair clip',
  '히메컷 롱 스트레이트':    'hime cut, long hair, straight hair',
  '아시메트릭 보브':         'asymmetrical bob cut, short hair',
  '롱 웨이브 로우 포니테일': 'low ponytail, wavy hair, long hair',
  '커튼 뱅 미디엄 스트레이트': 'medium hair, straight hair, curtained bangs',
  '귀 뒤로 넘긴 단발 보브':  'bob cut, short hair, hair behind ear',
  '짧은 사이드 포니테일':    'side ponytail, short hair',
  '컬리 숏':                 'short hair, curly hair',
  '레이어드 숏 보브':        'bob cut, short hair, layered hair',
  '스포츠 하이 포니테일':    'high ponytail, medium hair, tied hair',
  '롱 웨이브 하프업':        'half updo, wavy hair, long hair',
  '웨이비 보브':             'bob cut, short hair, wavy hair',
  '풀어 내린 롱 스트레이트': 'long hair, straight hair, hair down',
  '로우 번':                 'low bun, medium hair',
  '컬리 보브':               'bob cut, short hair, curly hair',
};

/**
 * 헤어 컬러 24종 → 태그 + art-style-guide 2.7 팔레트 번호.
 * palette:null 은 **가이드의 12색 팔레트에 대응 항목이 없다**는 뜻이다 — 리터치 색을 정할 수 없으므로
 * --check 가 경고로 보고한다(가이드에 색을 추가하거나 데이터 값을 바꿔야 하는 열린 결정).
 */
const HAIR_COLOR = {
  '블랙':            { tag: 'black hair',                          palette: 1 },
  '다크 브라운':     { tag: 'brown hair, dark brown hair',         palette: 2 },
  '체스트넛 브라운': { tag: 'brown hair, chestnut hair',           palette: 3 },
  '라이트 브라운':   { tag: 'light brown hair',                    palette: 4 },
  '애쉬 브라운':     { tag: 'light brown hair, ashen hair',        palette: 6 },
  '애쉬 그레이':     { tag: 'grey hair, ash grey hair',            palette: 6 },
  '차콜 그레이':     { tag: 'grey hair, dark grey hair',           palette: 6 },
  '로즈 브라운':     { tag: 'brown hair, pinkish brown hair',      palette: 3 },
  '밀크티 베이지':   { tag: 'light brown hair, beige hair',        palette: 5 },
  '골든 브라운':     { tag: 'light brown hair, golden brown hair', palette: 4 },
  '허니 블론드':     { tag: 'blonde hair, honey blonde hair',      palette: 5 },
  '오번':            { tag: 'auburn hair, dark red hair',          palette: 8 },
  '플래티넘 블론드': { tag: 'platinum blonde hair, very light hair', palette: 7 },
  '와인 레드':       { tag: 'dark red hair, wine red hair',        palette: 8 },
  '민트 그린':       { tag: 'green hair, mint green hair',         palette: 11 },
  '네이비 블루':     { tag: 'blue hair, dark blue hair',           palette: 10 },
  '화이트':          { tag: 'white hair',                          palette: 7 },
  '화이트 실버':     { tag: 'silver hair, white hair',             palette: 7 },
  '코랄 핑크':       { tag: 'pink hair, coral pink hair',          palette: 9 },
  '크림슨 레드':     { tag: 'red hair, crimson hair',              palette: 8 },
  '선셋 오렌지':     { tag: 'orange hair',                         palette: null },
  '라벤더 퍼플':     { tag: 'purple hair, lavender hair',          palette: 12 },
  '스카이 블루':     { tag: 'blue hair, light blue hair',          palette: 10 },
  '피치 핑크':       { tag: 'pink hair, peach pink hair',          palette: 9 },
};

/** 눈 색 20종 → 태그. */
const EYE_COLOR = {
  '바이올렛':    'purple eyes',
  '다크 그레이': 'grey eyes, dark grey eyes',
  '헤이즐':      'brown eyes, hazel eyes',
  '그레이 블루': 'grey eyes, blue-grey eyes',
  '다크 브라운': 'brown eyes, dark brown eyes',
  '골드':        'yellow eyes, golden eyes',
  '앰버':        'orange eyes, amber eyes',
  '딥 블루':     'blue eyes, dark blue eyes',
  '그린':        'green eyes',
  '그레이':      'grey eyes',
  '브라운':      'brown eyes',
  '라이트 블루': 'blue eyes, light blue eyes',
  '아이스 블루': 'blue eyes, pale blue eyes',
  '다크 그린':   'green eyes, dark green eyes',
  '마젠타':      'pink eyes, magenta eyes',
  '오렌지 앰버': 'orange eyes, amber eyes',
  '레드 브라운': 'brown eyes, reddish brown eyes',
  '실버 그레이': 'grey eyes, silver eyes',
  '딥 그린':     'green eyes, deep green eyes',
  '블루':        'blue eyes',
};

/** 체형 15종 → 태그 (art-style-guide 3.1 의 포지션 토큰과 합쳐 쓴다). */
const BODY_TYPE = {
  '단신 다부진 체형':   'petite, compact sturdy build',
  '단신 민첩':          'petite, lean agile build',
  '장신':               'tall',
  '장신 균형형':        'tall, balanced athletic build',
  '장신 근육질':        'tall, muscular, toned',
  '장신 마른 체형':     'tall, slender build',
  '장신 슬림':          'tall, slim build',
  '장신 슬림 애슬레틱': 'tall, slim athletic build',
  '장신 애슬레틱':      'tall, athletic build, toned',
  '최장신 탄탄한 체형': 'very tall, solid athletic build',
  '표준':               'average build, athletic',
  '표준 균형형':        'balanced athletic build',
  '표준 마른 체형':     'slender build',
  '표준 슬림':          'slim build',
  '표준 애슬레틱':      'athletic build, toned',
};

/** 체형 자연어 — 태그(`tall, slim athletic build`)는 명사구라 "…build young woman" 이 된다. 문장용 형용사구를 따로 둔다. */
const BODY_NL = {
  '단신 다부진 체형':   'petite, compactly built',
  '단신 민첩':          'petite, lean and quick',
  '장신':               'tall',
  '장신 균형형':        'tall, evenly athletic',
  '장신 근육질':        'tall and muscular',
  '장신 마른 체형':     'tall and slender',
  '장신 슬림':          'tall and slim',
  '장신 슬림 애슬레틱': 'tall, slim and athletic',
  '장신 애슬레틱':      'tall and athletic',
  '최장신 탄탄한 체형': 'exceptionally tall, solidly built',
  '표준':               'averagely built and athletic',
  '표준 균형형':        'evenly athletic',
  '표준 마른 체형':     'slender',
  '표준 슬림':          'slim',
  '표준 애슬레틱':      'athletic and toned',
};

/**
 * 포지션 → 3.2 대표 포즈 · 공 위치 · 카메라 · **그 포지션에서만 나오는 신체 특징**(accent).
 * 체형 자체는 data 의 bodyType 이 담당한다 — 여기에 'athletic build' 를 또 넣으면 태그가 겹쳐 흐려진다.
 */
const POSITION = {
  S:  { accent: 'long fingers', nlAction: 'mid-set — both arms raised above her forehead, elbows bent outward, fingers spread into a diamond, knees slightly bent and back gently arched', nlBall: 'the ball hovering a hand\u2019s width above her fingertips', nlCamera: 'seen from a slightly low angle in three-quarter view, looking up toward the ball',
        pose: 'setting a volleyball, both arms raised above forehead, elbows bent outward, fingers spread in a diamond shape, knees slightly bent, back arched slightly',
        ball: 'volleyball above fingertips, one ball diameter above forehead',
        camera: 'low angle 10 degrees, three-quarter view, looking up at the ball',
        note: '손가락 10개가 전부 노출 → 리터치 비용 최상(3.2① 주의)' },
  OH: { accent: '', nlAction: 'mid-spike — airborne, right arm fully extended overhead with an open palm, torso twisted like a drawn bow, knees folded back, hair flying upward', nlBall: 'the ball just in front of her striking palm', nlCamera: 'shot from a low angle with strong foreshortening, three-quarter view from her right',
        pose: 'spiking, jumping, right arm fully extended overhead, open hand, torso twisted like a drawn bow, knees folded back, hair flying up',
        ball: 'volleyball just in front of the striking palm',
        camera: 'low angle 15 degrees, dynamic angle, foreshortening, three-quarter view from the right',
        note: '' },
  OP: { accent: 'long legs, broad shoulders', nlBody: 'long-legged and broad-shouldered', nlAction: 'mid back-row attack — a long horizontal leap, body stretched forward on a diagonal, striking arm fully extended, the other arm reaching forward for balance', nlBall: 'the ball in front of her striking hand', nlCamera: 'shot at eye level from a three-quarter side view, wide enough that the attack line on the floor behind her is visible',
        pose: 'back row attack, long horizontal jump, body stretched forward at a 30 degree diagonal, striking arm fully extended, other arm reaching forward for balance, front knee bent',
        ball: 'volleyball in front of the striking hand',
        camera: 'eye level, three-quarter side view, wide framing, attack line visible on the floor behind the jump',
        note: '바닥의 3m 어택 라인이 보여야 "후위 공격"으로 읽힌다(3.2③)' },
  MB: { accent: 'long arms', nlBody: 'long-limbed', nlAction: 'blocking at the net — a straight vertical jump, torso upright, both arms extended straight up and over the net, palms open toward the viewer with thumbs close together', nlBall: 'the ball just in front of her palms, partly hidden by her hands', nlCamera: 'shot from a low angle head-on from the opposite court, the net band crossing at her chest',
        pose: 'blocking at the net, vertical jump, torso straight, both arms extended straight up and over the net, palms open facing the viewer, thumbs close together',
        ball: 'volleyball just in front of both palms, partly hidden by the hands',
        camera: 'low angle 10 degrees, front view from the opposite court, net band crossing at chest height',
        note: '손끝이 세이프 영역 상단선에 닿게 — 장신 강조(3.2④)' },
  L:  { accent: '', nlAction: 'digging — a very low stance, one leg extended far to the side, the other knee bent deep near the floor, torso leaning forward, both forearms joined into a flat platform with hands clasped', nlBall: 'the ball meeting the center of her forearm platform', nlCamera: 'shot from very low near the floor in three-quarter view, framing her whole body',
        pose: 'digging, very low stance, one leg extended far to the side, other knee deeply bent near the floor, torso leaning forward, both forearms joined into a flat platform, hands clasped with thumbs side by side',
        ball: 'volleyball touching the center of the forearm platform',
        camera: 'very low angle near the floor, three-quarter view, full body framing',
        note: '리베로는 구단 대비색 유니폼 — 이 카드만 봐도 리베로여야 한다(3.2⑤ · 5.4)' },
};

/** 등급 → 6.4 연출 태그 · 3.5 강도. */
const RARITY = {
  N:   { nlLight: 'soft even lighting against a plain background', light: 'soft even lighting, simple background',
         extra: 'standing, upper body, holding a volleyball at the hip',
         drop: 'rim light, lens flare, motion lines' },
  R:   { nlLight: 'soft gym lighting against a simple background', light: 'soft lighting, simple background', extra: 'sweat drop', drop: 'rim light, lens flare, light particles, motion lines' },
  SR:  { nlLight: 'a clear rim light along her silhouette, with wind and motion in her hair and jersey', light: 'rim light, motion lines, wind', extra: 'hair and fabric in motion, sweat drop', drop: 'lens flare, light particles' },
  SSR: { nlLight: 'a dramatic rim light and an overhead spotlight, lens flare and drifting light particles, the crowd behind her blurred into shallow depth of field', light: 'dramatic rim light, spotlight, lens flare, light particles, motion blur background, depth of field',
         extra: 'hair and fabric in strong motion, sweat drops', drop: '' },
};

/** 구단 → 유니폼 색 태그 (world.md 1.3 · art-style-guide 5.1 홈 기준). */
const CLUB = {
  t01: { name: '가온 프리즘', primary: 'violet',      secondary: 'cyan',      shorts: 'black',  libero: 'cyan',      hex: '#6C2BD9/#22E4F2' },
  t02: { name: '해솔 앵커스', primary: 'navy blue',   secondary: 'pale mint', shorts: 'navy',   libero: 'pale mint', hex: '#0F2C4C/#A8DCD1' },
  t03: { name: '태령 피크스', primary: 'dark green',  secondary: 'ice white', shorts: 'black',  libero: 'ice white', hex: '#1F6B45/#E3EEF0' },
  t04: { name: '적동 앤빌스', primary: 'crimson red', secondary: 'copper',    shorts: 'black',  libero: 'copper',    hex: '#A8201A/#D9853B' },
  t05: { name: '연화 크레인즈', primary: 'antique gold', secondary: 'ink black', shorts: 'black', libero: 'ink black', hex: '#C9A227/#2A2624' },
  t06: { name: '라온 브리즈', primary: 'coral orange', secondary: 'turquoise', shorts: 'navy',   libero: 'turquoise', hex: '#FF6B3D/#19B5A6' },
};

/** 피부 3톤 (2.7). 데이터에 필드가 없어 생성기가 배정한다 — 아래 assignDerived() 참조. */
const SKIN = { A: 'fair skin', B: 'medium skin tone', C: 'tan skin' };
/** 문장용 — "…with fair skin" 형태. */
const SKIN_NL = { A: 'fair', B: 'medium-toned', C: 'tanned' };
/** 눈매 3종 (2.5/6.2). 역시 데이터에 없어 배정한다. */
const EYE_SHAPE = { tsurime: 'tsurime, sharp eyes', tareme: 'tareme, gentle drooping eyes', neutral: 'almond shaped eyes' };
/** 문장용 — 눈 색과 한 덩어리로 만든다(둘 다 "eyes" 로 끝나면 문장이 깨진다). */
const EYE_SHAPE_NL = { tsurime: 'sharp, upturned', tareme: 'gentle, softly drooping', neutral: 'almond-shaped' };

/** 표정 4종 (6.5) — 스탠딩 인페인트용. */
const FACES = {
  neutral: { pos: 'neutral expression, slight smile, closed mouth, looking at viewer', neg: 'open mouth, blush' },
  joy:     { pos: 'happy, big smile, open mouth, sparkling eyes, blush, cheerful',      neg: 'sad, tears' },
  tired:   { pos: 'tired, exhausted, half-closed eyes, sweat, parted lips, slight frown', neg: 'smile, tears' },
  down:    { pos: 'frustrated, sad, downcast eyes, furrowed brows, tears in eyes, biting lip', neg: 'crying, streaming tears, smile' },
};

/** 공통 네거티브 (6.3). 한 곳에서만 고친다. */
const NEGATIVE = [
  'lowres, worst quality, low quality, normal quality, jpeg artifacts, blurry, noisy',
  'bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra limbs, extra arms, extra legs, malformed limbs, deformed, long neck, bad proportions',
  'text, logo, letters, numbers, sponsor, emblem, watermark, signature, artist name, username, stripes on chest, pattern on clothes',
  'realistic, photorealistic, 3d, cgi, painting texture, sketch, monochrome',
  'nsfw, nude, deep cleavage, underwear, panties, see-through, crop top, bikini, swimsuit, thong, upskirt, cameltoe, sexual, explicit',
  'child, loli, kid, chibi',
  'multiple girls, 2girls, extra ball, multiple balls, basketball, soccer ball, tennis ball',
  'branded volleyball, blue and yellow volleyball, real brand ball, face too small, distant shot',
].join(',\n');

/** 토큰(6.7) 전용 네거티브 — 공용 네거티브에는 `chibi` 가 들어 있어 그대로 쓰면 안 된다. */
const TOKEN_NEGATIVE = [
  'lowres, worst quality, bad anatomy, bad hands, extra fingers',
  'text, logo, letters, numbers, watermark, signature',
  'detailed background, complex, realistic, photorealistic, 3d',
  'nsfw, nude, cleavage, suggestive',
  'multiple girls, 2girls',
].join(',\n');

// ────────────────────────────────────────────────────────────── 파생 값 배정
/**
 * 데이터에 없는 피부톤·눈매를 **결정적으로** 배정한다.
 *
 * 피부톤은 무작위 해시로 뿌리면 2.7절의 60/30/10 비율과 "같은 구단에 최소 2톤"을 못 맞춘다.
 * 그래서 id 정렬 순서로 A,A,B,A,A,C 패턴을 돌려 비율을 만들고, 구단별로 단일 톤이 되면
 * 그 구단의 마지막 선수를 한 단계 옮긴다. 42명 고정 입력이므로 결과도 고정이다.
 */
function assignDerived(players) {
  const sorted = [...players].sort((a, b) => a.id.localeCompare(b.id));
  const cycle = ['A', 'A', 'B', 'A', 'A', 'C', 'A', 'B', 'A', 'B'];   // 10명당 A6 B2 C1 A1 → 60/30/10 근사
  const skin = new Map();
  sorted.forEach((p, i) => skin.set(p.id, cycle[i % cycle.length]));

  const byClub = new Map();
  for (const p of sorted) {
    if (!byClub.has(p.teamId)) byClub.set(p.teamId, []);
    byClub.get(p.teamId).push(p);
  }
  for (const [, list] of byClub) {                       // 단일 톤 구단이 없게
    const tones = new Set(list.map(p => skin.get(p.id)));
    if (tones.size < 2 && list.length > 1) skin.set(list[list.length - 1].id, tones.has('A') ? 'B' : 'A');
  }

  const shapes = ['tsurime', 'neutral', 'tareme'];
  const eye = new Map(sorted.map((p, i) => [p.id, shapes[(i * 7 + p.position.length) % shapes.length]]));
  return { skin, eye };
}

// ────────────────────────────────────────────────────────────── 프롬프트 조립
function lookup(table, key, what, pid) {
  const v = table[key];
  if (v === undefined) throw new Error(`${pid}: ${what} "${key}" 가 매핑에 없습니다 — tools/art-prompts.mjs 의 표에 추가하세요.`);
  return v;
}

function buildCard(p, d) {
  const club = lookup(CLUB, p.teamId, '구단', p.id);
  const pos = lookup(POSITION, p.position, '포지션', p.id);
  const rar = lookup(RARITY, p.rarity, '등급', p.id);
  const hair = lookup(HAIR_STYLE, p.appearance.hairStyle, '헤어스타일', p.id);
  const hcol = lookup(HAIR_COLOR, p.appearance.hairColor, '헤어컬러', p.id);
  const eyes = lookup(EYE_COLOR, p.appearance.eyeColor, '눈 색', p.id);
  const body = lookup(BODY_TYPE, p.appearance.bodyType, '체형', p.id);
  const isLibero = p.position === 'L';
  const jersey = isLibero
    ? `plain ${club.libero} jersey, ${club.primary} trim`
    : `plain ${club.primary} jersey, ${club.secondary} trim`;

  return [
    `{quality_prefix}, {charLoRA},`,
    tags('1girl, solo, adult woman, young adult, mature face', SKIN[d.skin], body, pos.accent) + ',',
    tags(hair, hcol.tag, eyes, EYE_SHAPE[d.eye]) + ',',
    `volleyball uniform, ${jersey}, short sleeves, tucked in, ${club.shorts} shorts, mid-thigh shorts, knee pads, white socks, volleyball shoes,`,
    `no logo, no text, blank jersey, solid color clothes,`,
    `athletic build, toned muscles, sweat, dynamic motion, determined expression, face clearly visible,`,
    `${pos.pose}, volleyball, ${pos.ball}, ${pos.camera},`,
    tags('indoor gymnasium, volleyball court, volleyball net, simple background', rar.light) + ',',
    `anime style, clean lineart, cel shading, flat colors, bright colors, sharp focus, highly detailed eyes${rar.extra ? ', ' + rar.extra : ''}`,
  ].join('\n');
}

function buildStanding(p, d) {
  const club = lookup(CLUB, p.teamId, '구단', p.id);
  const pos = lookup(POSITION, p.position, '포지션', p.id);
  const hair = lookup(HAIR_STYLE, p.appearance.hairStyle, '헤어스타일', p.id);
  const hcol = lookup(HAIR_COLOR, p.appearance.hairColor, '헤어컬러', p.id);
  const eyes = lookup(EYE_COLOR, p.appearance.eyeColor, '눈 색', p.id);
  const body = lookup(BODY_TYPE, p.appearance.bodyType, '체형', p.id);
  const jersey = p.position === 'L'
    ? `plain ${club.libero} jersey, ${club.primary} trim`
    : `plain ${club.primary} jersey, ${club.secondary} trim`;
  return [
    `{quality_prefix}, {charLoRA},`,
    tags('1girl, solo, adult woman, young adult, mature face', SKIN[d.skin], body, pos.accent) + ',',
    tags(hair, hcol.tag, eyes, EYE_SHAPE[d.eye]) + ',',
    `volleyball uniform, ${jersey}, short sleeves, tucked in, ${club.shorts} shorts, knee pads, white socks, volleyball shoes,`,
    `no logo, no text, blank jersey, solid color clothes,`,
    `athletic build, toned muscles, sweat, dynamic motion, determined expression, face clearly visible,`,
    `standing, full body, facing viewer, body turned 15 degrees, one hand on hip, relaxed pose, no ball,`,
    `eye level, plain white background, even lighting, no rim light,`,
    `anime style, clean lineart, cel shading, flat colors, sharp focus, highly detailed eyes`,
  ].join('\n');
}

function buildToken(p) {
  const club = lookup(CLUB, p.teamId, '구단', p.id);
  const hair = lookup(HAIR_STYLE, p.appearance.hairStyle, '헤어스타일', p.id);
  const hcol = lookup(HAIR_COLOR, p.appearance.hairColor, '헤어컬러', p.id);
  const eyes = lookup(EYE_COLOR, p.appearance.eyeColor, '눈 색', p.id);
  const jersey = p.position === 'L' ? club.libero : club.primary;
  return [
    `{quality_prefix}, chibi, 1girl, solo, full body, front view, standing, simple pose, 2 heads tall,`,
    `${hair}, ${hcol.tag}, ${eyes}, volleyball uniform, plain ${jersey} jersey, knee pads,`,
    `flat color, simple shading, thick outline, white background, centered, sticker style`,
  ].join('\n');
}

/** 태그 나열에서 중복을 없앤다 — 체형 토큰과 포지션 토큰이 겹치면 같은 태그가 두 번 실린다. */
function tags(...parts) {
  const seen = new Set(), out = [];
  for (const t of parts.join(', ').split(',').map(x => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.join(', ');
}

// ────────────────────────────────────────────────────────────── 자연어 변환
/* 태그 나열형은 Danbooru 를 학습한 로컬 애니메 SDXL 을 위한 형태다.
 * 호스팅 모델(Higgsfield Soul/Seedream/Flux · Midjourney 등)은 **문장**을 훨씬 잘 받는다.
 * 그래서 같은 매핑표에서 자연어 문단도 뽑는다 — 어휘를 두 벌 관리하지 않기 위해 태그에서 기계적으로 만든다. */

const LENGTH_RE = /^(very short|short|medium|long) hair$/;
/** 잘라 낸 머리 — 그 자체로 길이를 뜻하므로 "긴 머리를 픽시컷으로" 같은 말이 안 되게 한다. */
const CUT_STYLES = { 'bob cut': 'bob cut', 'pixie cut': 'pixie cut', 'wolf cut': 'wolf cut',
  'hime cut': 'hime cut', 'asymmetrical bob cut': 'asymmetrical bob cut', 'cropped hair': 'cropped cut' };
/** 묶은 머리 — "…hair worn in a high ponytail" 형태. */
const TIED_RE = /(ponytail|twintails?|braids?|bun|updo)$/;
/** 그 자체로는 정보가 없어 더 구체적인 값이 있으면 버리는 토큰. */
const TIED_GENERIC = ['hair bun'];
/** 질감·길이 — "with wavy hair" 가 아니라 형용사로 앞에 붙인다. */
const TEXTURE = { 'straight hair': 'straight', 'wavy hair': 'wavy', 'curly hair': 'curly',
  'layered hair': 'layered', 'chin-length hair': 'chin-length', 'neat hair': 'neatly kept' };
/** 문장 끝에 붙는 상태. */
const HAIR_SUFFIX = { 'hair down': 'worn loose', 'hair behind ear': 'tucked behind one ear',
  'inward curl': 'curled inward at the ends' };
const HAIR_ACCESSORY = { 'hair clip': 'a hair clip', 'hairband': 'a hairband' };
/** 묶은 머리와 뜻이 겹쳐 버리는 토큰. */
const HAIR_REDUNDANT = ['tied hair'];

/**
 * 헤어 태그 + 컬러 태그 → 문장 조각.
 *   'high ponytail, long hair' + 'platinum blonde hair' → "long platinum blonde hair worn in a high ponytail"
 *   'bob cut, short hair, curly hair' + 'light brown hair' → "a curly light brown bob cut"
 * 태그를 한 벌만 관리하려고 기계적으로 만든다 — 42종 전부 눈으로 확인했다.
 */
function hairPhrase(styleTag, colorTag) {
  const color = colorTag.split(',')[0].trim().replace(/\s*hair$/, '');
  const parts = styleTag.split(',').map(t => t.trim());

  const length = (parts.find(t => LENGTH_RE.test(t)) || '').replace(/\s*hair$/, '')
    .replace(/^medium$/, 'medium-length');   // 영어로는 "medium hair" 보다 "medium-length" 가 자연스럽다
  const cutKey = parts.find(t => CUT_STYLES[t]);
  const tiedAll = parts.filter(t => TIED_RE.test(t) && !CUT_STYLES[t]);
  const tied = tiedAll.find(t => !TIED_GENERIC.includes(t)) || tiedAll[0];

  const used = new Set([cutKey, ...tiedAll, ...parts.filter(t => LENGTH_RE.test(t))]);
  const rest = parts.filter(t => !used.has(t) && !HAIR_REDUNDANT.includes(t));
  const textures = rest.filter(t => TEXTURE[t]).map(t => TEXTURE[t]);
  const suffixes = rest.filter(t => HAIR_SUFFIX[t]).map(t => HAIR_SUFFIX[t]);
  const accessories = rest.filter(t => HAIR_ACCESSORY[t]).map(t => HAIR_ACCESSORY[t]);
  const bangs = rest.filter(t => /bangs$/.test(t));

  const adj = xs => xs.filter(Boolean).join(', ');
  let head;
  if (tied) {
    const article = /s$/.test(tied) ? '' : 'a ';
    head = `${adj([length, ...textures])} ${color} hair worn in ${article}${tied}`.replace(/^\s+/, '');
    if (!length && !textures.length) head = `${color} hair worn in ${article}${tied}`;
  } else if (cutKey) {
    const a = /^[aeiou]/.test(textures[0] || color) ? 'an' : 'a';
    head = `${a} ${adj(textures)}${textures.length ? ' ' : ''}${color} ${CUT_STYLES[cutKey]}`;
  } else {
    head = `${adj([length, ...textures])} ${color} hair`.replace(/^\s+/, '');
  }

  const tail = [...bangs.map(b => `with ${b}`), ...accessories.map(a => `with ${a}`), ...suffixes];
  return tail.length ? `${head}, ${tail.join(' and ')}` : head;
}

/** 카드 자연어 프롬프트 — 한 문단. */
/**
 * 프레이밍 지시 (art-pipeline 9·10).
 *
 * "머리가 화면 높이의 1/5" 같은 **비율** 지시는 모델이 무시한다(8라운드 전부 실패).
 * "무릎 아래는 프레임 밖" 같은 **자를 위치** 지시는 먹힌다. 그리고 **맨 앞**에 와야 한다 —
 * 스타일·인물 묘사 뒤에 두면 묻힌다.
 *
 * 두 프레이밍을 다 쓴다: 카드는 미디엄 샷(리스트에서 얼굴이 읽혀야 한다),
 * 선수 상세 화면은 전신(점프의 박력을 크게 본다).
 */
const FRAMING = {
  card: 'MEDIUM SHOT / WAIST-UP CROP. The bottom edge of the frame cuts her off at mid-thigh — her lower legs and feet are NOT in the picture. Her head, shoulders and torso fill most of the frame; her head alone is about one fifth of the total image height. This is a close hero portrait, not a full-body shot.',
  hero: 'FULL BODY ACTION SHOT. Her whole body is in frame, from her raised hand down to her feet, airborne with space around her — the dramatic full-figure illustration shown large on the player detail screen.',
};

function buildCardNatural(p, d, kind) {
  const club = CLUB[p.teamId], pos = POSITION[p.position], rar = RARITY[p.rarity];
  const hair = hairPhrase(HAIR_STYLE[p.appearance.hairStyle], HAIR_COLOR[p.appearance.hairColor].tag);
  const eyeColor = EYE_COLOR[p.appearance.eyeColor].split(',')[0].trim().replace(/\s*eyes$/, '');
  const eyes = `${EYE_SHAPE_NL[d.eye]} ${eyeColor} eyes`;
  const body = [BODY_NL[p.appearance.bodyType], pos.nlBody].filter(Boolean).join(', ');
  const isL = p.position === 'L';
  const jersey = isL
    ? `a plain ${club.libero} libero jersey with ${club.primary} trim — a deliberately different color from her teammates`
    : `a plain ${club.primary} volleyball jersey with ${club.secondary} trim`;

  return [
    FRAMING[kind === 'hero' ? 'hero' : 'card'],
    // 이 문장이 화풍을 결정한다. 초기 판은 태그형과 같은 `cel shading, flat colors, clean lineart` 를 썼는데,
    // 범용 모델(Nano Banana 등)은 그걸 **문자 그대로** 받아 초등학생 만화처럼 그렸다. 반대로 지시한다.
    `Ultra-detailed semi-realistic anime illustration, the quality of a high-end painted key visual for a premium mobile game — rendering pushed close to realism. Skin has real texture, soft subsurface scattering and a faint flush of exertion. Hair is drawn strand by strand in layered clumps with sharp specular highlights and stray flyaway hairs. Fabric behaves like real fabric: visible weave, stitched seams, stretch across the shoulder, creases where the body twists. Anatomically accurate athletic musculature. Hands fully articulated with correct fingers. Individual sweat droplets catching the light. Cinematic volumetric lighting, shallow depth of field, high dynamic range. NOT flat cel shading, NOT simple anime, NOT thick uniform outlines, NOT a cartoon.`,
    // 라운드 1 에서 한 장에 "SUPER SPIKE" 글자가 박혔다. 모델이 카드처럼 보이는 그림에 제목을 얹으려 하므로 맨 앞에서 막는다.
    `ABSOLUTELY NO TEXT anywhere in the picture: no words, letters, numbers, captions, titles, logos, watermarks or signage of any kind, on the uniform, the shoes, the walls or as an overlay.`,
    // 헤어스타일은 42명 구분의 1축(world.md 6.2)이고 **편집 패스로는 못 고친다**(구조 변경). 생성 단계에서 못박는다.
    `A ${body} young woman with ${SKIN_NL[d.skin]} skin and ${eyes}. HER HAIR: ${hair} — exactly this and nothing else.`,
    `She is ${pos.nlAction}, ${pos.nlBall}.`,
    `She wears ${jersey}, ${club.shorts} volleyball shorts, black knee pads, white socks and plain white volleyball shoes with no markings — a real athletic kit, fitted to her body, not a loose t-shirt.`,
    `The jersey is completely blank — no logo, number, text or pattern of any kind.`,
    // 1.4.1 — 금지선이 아니라 **요구 사항**이다. 12세 판에서 이걸 잃어 카드가 밋밋해졌다.
    `Give it the intensity of a real match: she is at the very top of her jump with her feet clearly off the floor, the low angle exaggerating her height and reach; an athlete's muscle definition visible in her arms, shoulders and thighs; a fierce competitive expression with her eyes locked on the ball; hair, jersey and beads of sweat all streaming in the direction of the motion.`,
    `${pos.nlCamera.charAt(0).toUpperCase() + pos.nlCamera.slice(1)}.`,
    `Indoor gymnasium with the volleyball net behind her, ${rar.nlLight}.`,
    `The ball is a plain white volleyball with mint green and coral panel stripes — not any real brand's color pattern.`,
    // 얼굴 크기는 카드가 96px 로 줄었을 때 읽히느냐의 문제다(4.2). 정숙 규정이 아니라 가독성 규정이라 남긴다.
    kind === 'hero'
      ? `Vertical 3:4 composition.`
      : `Vertical 3:4 composition: her face sits about 30% down from the top edge and stays clearly readable when the picture is shrunk to a tiny thumbnail.`,
    // 1.4.2 — 15세 등급의 금지선.
    `Keep it within a 15+ sports rating: she stays fully in her uniform — no nudity, no underwear, no see-through fabric, no upskirt angle and no sexual posing. The pose comes from the volleyball action itself.`,
  ].join(' ');
}

function section(title, body) { return `\n──────── ${title}\n${body}\n`; }

function renderPack(p, d, warn) {
  const club = lookup(CLUB, p.teamId, '구단', p.id);
  const pos = POSITION[p.position];
  const hcol = HAIR_COLOR[p.appearance.hairColor];
  const a = p.appearance;
  const head = [
    `# ${p.id} ${p.name} — ${p.position} · ${p.rarity} · ${club.name} (${p.teamId}) · ${p.heightCm}cm · #${p.jerseyNumber}`,
    `# 생성: node tools/art-prompts.mjs  (손으로 고치지 말 것 — 고칠 곳은 생성기의 매핑표)`,
    `#`,
    `# 외형(data/players.json): ${a.hairStyle} / ${a.hairColor} / ${a.eyeColor} 눈 / ${a.bodyType}`,
    `# 파생(데이터에 없어 생성기가 결정적으로 배정): 피부 ${d.skin}톤 · 눈매 ${d.eye}`,
    `# 헤어 팔레트(2.7): ${hcol.palette ? '#' + hcol.palette : '**없음 — 가이드 12색에 대응 항목이 없다**'}`,
    `# 고유 스킬: ${p.skill.name}`,
    pos.note ? `# 포즈 주의(3.2): ${pos.note}` : null,
    warn.length ? `#\n# ⚠ ${warn.join('\n# ⚠ ')}` : null,
    `#`,
    `# 고정 파라미터는 art/00_guide/prompts/_params.txt, 네거티브는 _negative.txt (전원 공용).`,
    `# {quality_prefix} 와 {charLoRA} 는 체크포인트·LoRA 가 정해지면 그 값으로 치환한다(6.1·6.2).`,
  ].filter(Boolean).join('\n');

  return head
    + section('CARD — POSITIVE · 태그형 (로컬 SD / 애니메 SDXL)', buildCard(p, d))
    + section('CARD — POSITIVE · 자연어형 · **미디엄 샷** (카드·리스트용 / Seedream 5 Pro · 3:4 · 2k)', buildCardNatural(p, d, 'card'))
    + section('HERO — POSITIVE · 자연어형 · **전신** (선수 상세 화면용 / 같은 모델·같은 설정)', buildCardNatural(p, d, 'hero'))
    + section('STANDING (1440×2560, 9:16) — POSITIVE', buildStanding(p, d))
    + section('SD TOKEN (256×256) — POSITIVE', buildToken(p))
    + section('SD TOKEN — NEGATIVE (공용 네거티브를 쓰지 말 것: chibi 가 서로 싸운다)', TOKEN_NEGATIVE)
    + section('FACE 4종 (스탠딩 face_rect 인페인트, denoise 0.45~0.6, only masked)',
        Object.entries(FACES).map(([k, v]) => `[${k}]\n  +  ${v.pos}\n  −  ${v.neg}`).join('\n'))
    + section('NEGATIVE (카드·스탠딩 공용)', NEGATIVE);
}

function metaSeed(p, d) {
  const hcol = HAIR_COLOR[p.appearance.hairColor];
  return {
    pid: p.id, team: p.teamId, position: p.position, rarity: p.rarity,
    height_cm: p.heightCm, jersey: p.jerseyNumber,
    skin: d.skin, hair: { style: p.appearance.hairStyle, color: p.appearance.hairColor, palette: hcol.palette },
    eye: { shape: d.eye, color: p.appearance.eyeColor },
    card: { face: { cx: 1024, cy: 820, h: 540 } },                 // 4.2 권장 기본값 — 리터치 후 실측으로 덮어쓴다
    stand: { face_rect: { x: 464, y: 200, w: 512, h: 512 }, has_hair_front: null },
    gen: { model: null, lora: null, seed_card: null, seed_stand: null },
    _note: '리터치 완료 후 face/face_rect/gen 을 실측값으로 채우고 art/04_export/{pid}/ 로 옮긴다.',
  };
}

// ────────────────────────────────────────────────────────────── 실행
const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'players.json'), 'utf8'));
const derived = assignDerived(players);

// 1) 어휘 커버리지 — 런칭 42명 + 신인 생성기의 풀 전체
const rookieSrc = fs.readFileSync(path.join(ROOT, 'web', 'engine', 'rookies.js'), 'utf8');
const listOf = name => {
  const m = rookieSrc.match(new RegExp(name + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
};
const pools = {
  헤어스타일: { table: HAIR_STYLE, values: [...new Set([...players.map(p => p.appearance.hairStyle), ...listOf('HAIR_STYLES')])] },
  헤어컬러:   { table: HAIR_COLOR, values: [...new Set([...players.map(p => p.appearance.hairColor), ...listOf('HAIR_COLORS_NATURAL'), ...listOf('HAIR_COLORS_VIVID')])] },
  '눈 색':    { table: EYE_COLOR,  values: [...new Set([...players.map(p => p.appearance.eyeColor), ...listOf('EYE_COLORS')])] },
  체형:       { table: BODY_TYPE,  values: [...new Set([...players.map(p => p.appearance.bodyType), ...listOf('BODY_TYPES')])] },
};

const missing = [];
for (const [what, { table, values }] of Object.entries(pools))
  for (const v of values) if (table[v] === undefined) missing.push(`${what}: "${v}"`);

console.log('## 어휘 커버리지 (런칭 42명 + 신인 생성기 풀)\n');
console.log('| 항목 | 값 개수 | 매핑됨 | 판정 |');
console.log('|---|---|---|---|');
for (const [what, { table, values }] of Object.entries(pools)) {
  const ok = values.filter(v => table[v] !== undefined).length;
  console.log(`| ${what} | ${values.length} | ${ok} | ${ok === values.length ? '통과' : '**누락 ' + (values.length - ok) + '**'} |`);
}

// 2) 팔레트 공백 — 12색 팔레트에 대응 항목이 없는 헤어 컬러
const noPalette = Object.entries(HAIR_COLOR).filter(([, v]) => v.palette === null).map(([k]) => k);
const usedNoPalette = players.filter(p => noPalette.includes(p.appearance.hairColor));

// 3) 팔레트 충돌 — 서로 다른 이름이 같은 팔레트 색으로 수렴하는데 같은 구단인 경우
//    (world.md 6.2 "같은 구단 안에서 헤어 컬러 중복 없음" 이 팔레트 수준에서 깨지는 지점)
const clash = [];
const byClubPal = new Map();
for (const p of players) {
  const pal = HAIR_COLOR[p.appearance.hairColor]?.palette;
  if (!pal) continue;
  const key = p.teamId + '#' + pal;
  if (!byClubPal.has(key)) byClubPal.set(key, []);
  byClubPal.get(key).push(p);
}
for (const [key, list] of byClubPal)
  if (list.length > 1) clash.push(`${CLUB[list[0].teamId].name} 팔레트 #${key.split('#')[1]}: ` +
    list.map(p => `${p.name}(${p.appearance.hairColor})`).join(' · '));

console.log('\n## 스타일 가이드 2.7 팔레트와의 정합\n');
console.log(`- 12색 팔레트에 대응 항목이 없는 헤어 컬러: **${noPalette.length}건** ${noPalette.length ? '— ' + noPalette.join(', ') : ''}`);
if (usedNoPalette.length) console.log(`  - 실제로 쓰는 선수: ${usedNoPalette.map(p => `${p.name}(${p.id})`).join(', ')}`);
console.log(`- 같은 구단 안에서 팔레트 색이 겹치는 조합: **${clash.length}건**`);
for (const c of clash) console.log(`  - ${c}`);

// 4) 피부톤 분포 (2.7 권장 60/30/10)
const skinCount = { A: 0, B: 0, C: 0 };
for (const p of players) skinCount[derived.skin.get(p.id)]++;
const clubTones = [...new Set(players.map(p => p.teamId))]
  .map(t => new Set(players.filter(p => p.teamId === t).map(p => derived.skin.get(p.id))).size);
console.log('\n## 파생 값 (데이터에 없어 생성기가 배정)\n');
console.log(`- 피부톤 A/B/C = ${skinCount.A}/${skinCount.B}/${skinCount.C} ` +
  `(${(skinCount.A / 42 * 100).toFixed(0)}/${(skinCount.B / 42 * 100).toFixed(0)}/${(skinCount.C / 42 * 100).toFixed(0)}%, 권장 60/30/10)`);
console.log(`- 구단별 최소 톤 수: ${Math.min(...clubTones)} (규칙: 2 이상)`);

if (missing.length) {
  console.error('\n어휘 누락:\n  ' + missing.join('\n  '));
  process.exit(1);
}
if (ONE) {
  const p = players.find(x => x.id === ONE);
  if (!p) { console.error(`${ONE} 을 찾을 수 없습니다.`); process.exit(1); }
  console.log('\n' + renderPack(p, { skin: derived.skin.get(p.id), eye: derived.eye.get(p.id) }, []));
  process.exit(0);
}
if (CHECK) {
  const fail = Math.min(...clubTones) < 2;
  console.log('\n결과: ' + (fail ? '구단별 피부톤 규칙 위반 ❌' : '어휘 전건 매핑 ✅'));
  process.exit(fail ? 1 : 0);
}

// 5) 파일 출력
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(META_OUT, { recursive: true });
for (const p of players) {
  const d = { skin: derived.skin.get(p.id), eye: derived.eye.get(p.id) };
  const warn = [];
  if (HAIR_COLOR[p.appearance.hairColor].palette === null)
    warn.push(`헤어 컬러 "${p.appearance.hairColor}" 는 스타일 가이드 2.7 의 12색 팔레트에 없다. 리터치 색을 정하기 전에 가이드를 먼저 확정할 것.`);
  fs.writeFileSync(path.join(OUT, `${p.id}.txt`), renderPack(p, d, warn) + '\n');
  fs.writeFileSync(path.join(META_OUT, `${p.id}_meta.json`), JSON.stringify(metaSeed(p, d), null, 2) + '\n');
}
fs.writeFileSync(path.join(OUT, '_negative.txt'), NEGATIVE + '\n');
fs.writeFileSync(path.join(OUT, '_params.txt'), [
  '# 고정 파라미터 (art-style-guide 6.1).',
  '#',
  '# 실측으로 정해진 것 (docs/art-pipeline.md 5.4):',
  '#   자연어형 모델  : Seedream 4.5 (quality=high, 3:4) — Higgsfield MCP',
  '#   보정 편집      : Seedream 5.0 Pro + 원본을 image_references 로 (옷 길이 등 국소 수정)',
  '#   쓰지 말 것     : Nano Banana 계열 — 범용 모델이라 화풍 태그를 문자 그대로 받아 납작하게 그린다',
  '체크포인트   : <로컬 SD 를 쓸 경우 이름 + 파일 해시>  # 교체 시 42명 전원 재검증',
  'VAE          : <체크포인트 권장 VAE>',
  '해상도 카드  : 960x1280 (3:4)  → Hires ×1.5 → 업스케일 ×1.4~1.6 → 2048x2732',
  '해상도 스탠딩: 768x1344 (9:16) → 1440x2560',
  '샘플러/스텝  : Euler a 또는 DPM++ 2M Karras / 28 (표정 인페인트 24)',
  'CFG          : 5.5 (4.5~7)     Clip skip: 모델 카드 권장값',
  'ControlNet   : OpenPose 0.8 (end 0.7) + 옵션 Depth 0.4 / 스탠딩 OpenPose 0.6',
  'LoRA         : 캐릭터 0.7~0.85, 스타일 LoRA 사용 금지',
  '배치         : 4장 × 2회 = 8장에서 선택',
  '시드         : 캐릭터별 기본 시드 1개, 변형은 +1~+9 안에서만 (6.6)',
  '',
  '# {quality_prefix} = 모델 카드가 권장하는 품질 태그 그대로',
  '# {charLoRA}      = <lora:{pid}_v1:0.8> {pid}char   (LoRA 학습 전에는 빈 값)',
].join('\n') + '\n');

const index = [
  '# 캐릭터 프롬프트 팩 (자동 생성)',
  '',
  '`node tools/art-prompts.mjs` 가 만든다. **이 폴더의 .txt 를 손으로 고치지 말 것** — 고칠 곳은 생성기의 매핑표다.',
  '고정 파라미터는 `_params.txt`, 공용 네거티브는 `_negative.txt`.',
  '',
  '| pid | 이름 | 포지션 | 등급 | 구단 | 헤어 | 눈 | 피부 | 팔레트 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...players.map(p => {
    const h = HAIR_COLOR[p.appearance.hairColor];
    return `| [${p.id}](${p.id}.txt) | ${p.name} | ${p.position} | ${p.rarity} | ${CLUB[p.teamId].name} | ` +
      `${p.appearance.hairStyle} · ${p.appearance.hairColor} | ${p.appearance.eyeColor} | ${derived.skin.get(p.id)} | ` +
      `${h.palette ? '#' + h.palette : '**없음**'} |`;
  }),
].join('\n');
fs.writeFileSync(path.join(OUT, '_index.md'), index + '\n');

console.log(`\n생성: ${players.length}명 프롬프트 → art/00_guide/prompts/ · 메타 시드 → art/00_guide/meta_seed/`);
