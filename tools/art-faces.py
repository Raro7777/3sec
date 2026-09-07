#!/usr/bin/env python3
"""표정 시트 → 표정 얼굴 3종 (art-pipeline 16.11)

    python3 tools/art-faces.py                 # art/02_gen/{pid}/expr.png 전부
    python3 tools/art-faces.py --ids p001,p002
    python3 tools/art-faces.py --preview out.png   # 카드 얼굴 + 표정 3종을 한 줄씩 늘어놓아 눈으로 확인
    python3 tools/art-faces.py --check         # 산출물 유무

입력  art/02_gen/{pid}/expr.png   카드를 참조로 생성한 2×2 표정 시트(흰 배경): 평상 · 집중 / 환호 · 낙담
출력  art/04_export/{pid}/{pid}_face_{focus|cheer|sad}.webp   128px 정사각 얼굴(원형은 런타임이 오린다)
      art/04_export/{pid}/{pid}_meta.json  faces: {name: {cx, cy, side}}  (시트 좌표, 기록용)

평상은 카드에서 오린 얼굴을 그대로 쓴다(더 크고 정확하다) — 시트의 평상 칸은 버린다.
얼굴 찾기: 턱(가장 큰 살색 덩어리에서 가장 넓은 줄 아래로 폭이 절반으로 꺾이는 줄)과 정수리(이마에서 흰 배경까지 올라간 줄) 높이의
1.5배 정사각형, 정수리를 상자 위 6% 에. 살색 범위는 금발(H 20 안팎)이 안 걸리게 좁다. 카드 원형 초상과 비슷한 얼굴 크기.
의존: pillow numpy scipy opencv-python-headless
"""
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / 'art' / '02_gen'
EXPORT = ROOT / 'art' / '04_export'
NAMES = [None, 'focus', 'cheer', 'sad']      # 2×2 순서: 좌상(평상, 버림) · 우상 · 좌하 · 우하
SIZE = 128

def log(*a): print(*a, flush=True)

def load_deps():
    global Image, np, ndi, cv2
    from PIL import Image as _I
    import numpy as _np
    from scipy import ndimage as _ndi
    import cv2 as _cv
    Image, np, ndi, cv2 = _I, _np, _ndi, _cv

def skin_mask(rgb):
    hsv = cv2.cvtColor(np.ascontiguousarray(rgb[:, :, ::-1]), cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)
    # 살색: 주황~살구(H 3~17), 채도 20~110, 밝기 120 이상. 금발(H 20 안팎·채도 높음)·머리카락·저지는 걸러진다
    return (H >= 3) & (H <= 17) & (S >= 20) & (S <= 110) & (V >= 120)

def find_face(cell):
    """칸 하나(RGB ndarray) → (cx, cy, side) 칸 좌표. 못 찾으면 None.
    턱 = 가장 큰 살색 덩어리에서 가장 넓은 줄 아래로 폭이 절반으로 꺾이는 줄(목). 정수리 = 살색 맨 윗줄(이마)에서
    얼굴 가운데 세로 띠를 따라 흰 배경이 나올 때까지 올라간 줄(앞머리·정수리). 상자 = 정수리~턱 높이의 1.5배 정사각형,
    정수리를 상자 위에서 6% 자리에 놓는다(카드 원형 초상처럼 얼굴이 위쪽 가운데, 아래는 어깨).
    시트의 2×2 칸이 정확히 4등분이 아니어도(윗줄 어깨가 아랫줄 칸으로 넘어와도) 정수리는 살색에서 올라가 찾으므로 어긋나지 않는다."""
    h, w = cell.shape[:2]
    nonwhite = cell.min(axis=2) < 235
    m = skin_mask(cell)
    m = ndi.binary_opening(m, iterations=2)
    lab, n = ndi.label(m)
    if n == 0: return None
    areas = ndi.sum(m, lab, index=range(1, n + 1))
    k = int(np.argmax(areas)) + 1
    if areas[k - 1] < h * w * 0.008: return None
    ys, xs = np.where(lab == k)
    rows = np.bincount(ys, minlength=h)
    top = int(ys.min())
    wrow = top + int(np.argmax(rows[top:]))
    maxw = rows[wrow]
    chin = int(ys.max())
    for r in range(wrow, h):
        if rows[r] < 0.5 * maxw: chin = r - 1; break
    sel = (ys >= top) & (ys <= chin)
    x0, x1 = int(xs[sel].min()), int(xs[sel].max())
    cx = (x0 + x1) / 2.0
    face_h = max(12, chin - top)
    band = nonwhite[:, max(0, int(cx - w * 0.12)):min(w, int(cx + w * 0.12))].any(axis=1)
    head_top = top
    floor = max(0, int(top - face_h * 0.9))               # 머리카락이 얼굴 높이의 90% 넘게 위로 솟지는 않는다(윗줄 초상으로 넘어가지 않게)
    while head_top > floor and band[head_top - 1]: head_top -= 1
    head_h = max(12, chin - head_top)
    side = max(head_h * 1.5, (x1 - x0) * 1.5)
    cy = head_top - 0.06 * side + side / 2
    gap = h                                                  # 턱 아래로 띠가 완전히 흰 첫 줄(어깨 끝) — 그 아래(다음 줄 초상)는 흰색으로 지운다
    for r in range(chin + 1, h):
        if not band[r]: gap = r; break
    return cx, cy, side, gap

def process(pid, force=False):
    src = next((GEN / pid / f'expr{ext}' for ext in ('.png', '.webp', '.jpg') if (GEN / pid / f'expr{ext}').exists()), None)
    if src is None: return None
    im = Image.open(src).convert('RGB')
    W, H = im.size
    arr = np.asarray(im)
    out_dir = EXPORT / pid; out_dir.mkdir(parents=True, exist_ok=True)
    meta_f = out_dir / f'{pid}_meta.json'
    meta = json.loads(meta_f.read_text(encoding='utf-8')) if meta_f.exists() else {'pid': pid}
    faces = {}
    cw, ch = W // 2, H // 2
    for i, name in enumerate(NAMES):
        if name is None: continue
        r, c = divmod(i, 2)
        x0, y0 = c * cw, r * ch
        cell = arr[y0:y0 + ch, x0:x0 + cw]
        f = find_face(cell)
        if f is None:
            log(f'  ! {pid}/{name}: 얼굴을 못 찾음 — 칸 중앙으로'); f = (cw / 2, ch * 0.42, min(cw, ch) * 0.6, ch)
        cx, cy, side, gap = f
        half = side / 2
        box = (int(round(x0 + cx - half)), int(round(y0 + cy - half)), int(round(x0 + cx + half)), int(round(y0 + cy + half)))
        # 시트 밖으로 나가면 흰색으로 채운다
        crop = Image.new('RGB', (box[2] - box[0], box[3] - box[1]), (255, 255, 255))
        crop.paste(im.crop((max(0, box[0]), max(0, box[1]), min(W, box[2]), min(H, box[3]))), (max(0, -box[0]), max(0, -box[1])))
        gy = y0 + gap - box[1]                                 # 어깨 아래 빈 줄부터는 다음 줄 초상이 걸려 들어오므로 지운다
        if 0 < gy < crop.size[1]:
            from PIL import ImageDraw
            ImageDraw.Draw(crop).rectangle([0, gy, crop.size[0], crop.size[1]], fill=(255, 255, 255))
        crop = crop.resize((SIZE, SIZE), Image.LANCZOS)
        crop.save(out_dir / f'{pid}_face_{name}.webp', 'WEBP', quality=82, method=6)
        faces[name] = {'cx': round(x0 + cx), 'cy': round(y0 + cy), 'side': round(side)}
    meta['faces'] = faces
    meta['faces_src'] = {'file': src.name, 'size': [W, H]}
    meta_f.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    return faces

def preview(ids, out_path):
    from PIL import ImageDraw
    rows = []
    for pid in ids:
        d = EXPORT / pid
        tiles = []
        # 카드 얼굴(런타임 faceBitmap 과 같은 오리기: meta.card.face 의 2.2×h 정사각)
        card = next((d / f'{pid}_card{ext}' for ext in ('.webp', '.png') if (d / f'{pid}_card{ext}').exists()), None)
        meta_f = d / f'{pid}_meta.json'
        meta = json.loads(meta_f.read_text(encoding='utf-8')) if meta_f.exists() else {}
        if card:
            ci = Image.open(card).convert('RGB'); cw, ch = ci.size
            fc = (meta.get('card') or {}).get('face') or {'cx': cw * 0.5, 'cy': ch * 0.3, 'h': ch * 0.2}
            side = 2.2 * fc['h']; sx = fc['cx'] - side / 2; sy = fc['cy'] + 0.15 * fc['h'] - side / 2
            tiles.append(ci.crop((int(sx), int(sy), int(sx + side), int(sy + side))).resize((SIZE, SIZE)))
        for name in NAMES[1:]:
            f = d / f'{pid}_face_{name}.webp'
            tiles.append(Image.open(f).convert('RGB').resize((SIZE, SIZE)) if f.exists() else Image.new('RGB', (SIZE, SIZE), (60, 60, 60)))
        row = Image.new('RGB', (SIZE * len(tiles) + 60, SIZE), (30, 30, 30))
        ImageDraw.Draw(row).text((6, SIZE // 2 - 6), pid, fill=(255, 255, 255))
        for i, t in enumerate(tiles): row.paste(t, (60 + i * SIZE, 0))
        rows.append(row)
    if not rows: return 0
    sheet = Image.new('RGB', (max(r.size[0] for r in rows), SIZE * len(rows)), (30, 30, 30))
    for i, r in enumerate(rows): sheet.paste(r, (0, i * SIZE))
    sheet.save(out_path); return len(rows)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ids', default='')
    ap.add_argument('--preview', default='')
    ap.add_argument('--preview-only', action='store_true')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    ids = [s for s in args.ids.split(',') if s] or sorted(p.name for p in EXPORT.iterdir() if p.is_dir() and p.name.startswith('p'))
    if args.check:
        have = [pid for pid in ids if all((EXPORT / pid / f'{pid}_face_{n}.webp').exists() for n in NAMES[1:])]
        log(f'표정 얼굴: {len(have)}/{len(ids)}명 (focus·cheer·sad)')
        missing = [pid for pid in ids if pid not in have]
        if missing: log('빠짐:', ', '.join(missing)); sys.exit(1)
        log('이상 없음 ✅'); return
    load_deps()
    if not args.preview_only:
        n = 0
        for pid in ids:
            try:
                r = process(pid)
            except Exception as e:
                log(f'{pid}: 실패 — {e}'); continue
            if r is None: continue
            n += 1; log(f'{pid}: {", ".join(r.keys())}')
        log(f'{n}명 처리')
    if args.preview:
        k = preview([pid for pid in ids if (EXPORT / pid / f'{pid}_face_focus.webp').exists()], args.preview)
        log(f'미리보기 {k}명 → {args.preview}')

if __name__ == '__main__':
    main()
