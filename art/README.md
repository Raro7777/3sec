# art/ — 아트 에셋

절차는 [docs/art-pipeline.md](../docs/art-pipeline.md), 규격·스타일은 [docs/art-style-guide.md](../docs/art-style-guide.md).

## 지금 상태

**런칭 42명 카드·썸네일·전신 완성** — `04_export/{pid}/` 에 126장(카드 42 · 썸네일 42 · 전신 42), 인라인 8.80MB.
신인 세대(런타임 생성)는 아직 SVG 플레이스홀더를 쓴다.
전원 머리 20% · 얼굴 (50%, 30%) 규격에 맞춰져 있다(4.2). 제작 기록은 art-pipeline 12~13절.

## 폴더

| 폴더 | 내용 | 커밋 |
|---|---|---|
| `00_guide/prompts/` | **자동 생성** — 캐릭터별 프롬프트 팩. `node tools/art-prompts.mjs` | ✅ |
| `00_guide/meta_seed/` | **자동 생성** — `{pid}_meta.json` 뼈대. 리터치 후 실측값으로 채워 `04_export` 로 | ✅ |
| `00_guide/` (그 외) | 스타일 시트, 카드 가이드 오버레이, 비교 보드 | ✅ |
| `01_refs/{pid}/` | 설정 시트·3면도·승인 기록 | ✅ |
| `02_gen/{pid}/` | AI 원본 출력 + `gen_log.csv`(프롬프트·시드·모델) | ❌ 용량 — 별도 백업 |
| `03_work/{pid}/` | 레이어 작업 파일(.kra/.psd/.clip). **삭제 금지 — 저작권 입증 자료** | ❌ 용량 — 별도 백업 |
| `04_export/{pid}/` | **최종 PNG/WebP + meta.json.** 여기 넣으면 게임에 들어간다 | ✅ |
| `05_shared/` | 포즈 뱅크·공식구·유니폼 벡터·배경·프레임 | ✅ |
| `06_lora/{pid}/` | LoRA 데이터셋·설정·결과 | ❌ 용량 — 별도 백업 |

`00_guide/prompts/` 와 `00_guide/meta_seed/` 는 **손으로 고치지 말 것.** 고칠 곳은 `tools/art-prompts.mjs` 의 매핑표다.

## 넣는 법

```
art/04_export/p001/
  p001_card.webp     3:4  (권장 2048×2732, 웹 프로토타입에는 200KB 이하 축소본)
  p001_thumb.webp    1:1  (권장 512×512)
```

```bash
node web/art-pack.mjs     # 무엇이 들어왔는지 · 비율·용량 확인
node web/build.mjs        # web/dist/bloom.html 에 인라인 → 화면에 뜬다
node web/art-test.mjs     # 슬롯인 회귀 12건
```
