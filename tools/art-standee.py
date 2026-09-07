#!/usr/bin/env python3
"""전신(hero) 일러스트 → 코트 스탠디(누끼 컷아웃) 변환기.  (art-pipeline 16.8)

    python3 tools/art-standee.py                 # hero 가 있는 모든 pid 처리 (이미 있으면 건너뜀)
    python3 tools/art-standee.py --ids p001,p007 # 일부만
    python3 tools/art-standee.py --force         # 있어도 다시 만든다
    python3 tools/art-standee.py --check         # 쓰지 않고 검사만 — hero 가 있는데 stand 가 없거나 meta 가 빠지면 실패
    python3 tools/art-standee.py --preview out.png          # 전원을 한 장에 모아 눈으로 본다(발·머리 앵커 표시)
    python3 tools/art-standee.py --set p006 model=isnet-general-use facing=F 'cuts=[[0,360,312,65]]'
                                                 # 손으로 정한 값을 meta.standee_manual 에 적는다(다시 만들 때 우선)

입력  art/04_export/{pid}/{pid}_hero.webp        전신 액션 일러스트(배경 있음)
출력  art/04_export/{pid}/{pid}_stand.webp       RGBA 누끼, 세로 320px, 몸 상자로 자름
      art/04_export/{pid}/{pid}_meta.json        "standee" 키 — 발·머리 앵커, 몸 높이 구간, 바라보는 방향, 공 처리
                                                 "standee_manual" 키 — 사람이 정한 값(도구는 읽기만 한다)

왜 이렇게 만드는가:
  코트 렌더러(web/court-render.js)는 선수를 아크릴 스탠드처럼 세운다. 그림 한 장을 발 앵커에 맞춰
  세우고, 몸 높이(머리끝~발)를 같은 화면 높이로 맞춰야 포즈가 달라도 선수 크기가 같아 보인다.
  그래서 파일과 함께 앵커를 남긴다. 렌더러는 이 값만 읽고 그림 내용은 모른다.

처리 단계:
  ① rembg 로 배경을 지운다. 기본 모델은 isnet-anime(애니메 선화·머리카락용). 바닥·네트가 딸려 오는 그림은
     standee_manual.model 로 isnet-general-use 등으로 바꾼다.
  ② standee_manual.cuts(원본 좌표 사각형 [x,y,w,h] 목록) 안의 알파를 지운다 — 네트 줄처럼 몸 밖으로 뻗은 배경 조각용.
  ③ 공을 찾는다(허프 원 + 색 구성: 흰 바탕 + 청록/살구 패널). 공이 손끝에 걸쳐 있으면(둘레의 몸 접촉 ≤ 50%) 잘라내고,
     몸 앞을 가리고 있으면 그대로 둔다(잘라내면 구멍이 남는다). standee_manual.ball = keep|cut 로 강제할 수 있다.
     코트에서는 렌더러가 진짜 공을 따로 그리므로, 그림 속 공은 없을수록 좋다.
  ④ 알파 마스크의 연결 성분 중 가장 큰 것(선수)만 남긴다. 떨어져 있는 공·부스러기는 버린다.
  ⑤ 반투명 가장자리의 색 번짐을 지운다 — 불투명한 가장 가까운 픽셀 색으로 덮는다.
  ⑥ 몸 상자로 자르고 세로 320px 로 줄인다(프리멀티플라이 후 LANCZOS).
  ⑦ 앵커: 알파 질량의 세로 분포에서 3%·97% 지점을 몸 구간(top·bottom)으로, 맨 아래 질량의 x 중심을 발로,
     맨 위 질량의 x 중심을 머리로 잡는다. 팔을 뻗어도 몸 구간이 흔들리지 않는다.
  ⑧ 방향: 공이 선수 질량 중심의 오른쪽이면 R, 왼쪽이면 L, 거의 가운데면 F(정면). 공이 없으면 null.
     standee_manual.facing 이 있으면 그것을 쓴다. 렌더러는 R/L 만 뒤집기에 쓰고 F/null 은 뒤집지 않는다.

의존: pillow numpy scipy opencv-python-headless(<5) rembg onnxruntime  (처음 실행 때 모델 176MB 를 내려받는다)
"""
import argparse, json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORT = ROOT / 'art' / '04_export'
HEIGHT = 320
MODEL = 'isnet-anime'
CUT_TOUCH = 0.50          # 공 둘레 중 몸이 닿은 비율이 이 이하면 잘라낸다

def log(*a):
    print(*a, flush=True)

def load_deps():
    global Image, np, ndi, cv2
    from PIL import Image as _I
    import numpy as _np
    from scipy import ndimage as _ndi
    import cv2 as _cv
    Image, np, ndi, cv2 = _I, _np, _ndi, _cv

# ─────────────────────────────────────────────── ③ 공
def find_ball(rgb, alpha):
    """허프 원 후보 중 '흰 바탕 + 청록/살구 패널' 색 구성을 가진 것을 공으로 고른다. 없으면 None."""
    H, W = alpha.shape
    bgr = np.ascontiguousarray(rgb[:, :, ::-1])
    g = cv2.medianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), 5)
    circles = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1.2, minDist=int(H * 0.08), param1=120, param2=28,
                               minRadius=int(H * 0.045), maxRadius=int(H * 0.14))
    if circles is None:
        return None
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    Hh, S, V = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)
    white = (V > 165) & (S < 70)
    accent = (((Hh >= 78) & (Hh <= 100)) | (Hh <= 12) | (Hh >= 168)) & (S > 45) & (V > 110)
    yy, xx = np.ogrid[:H, :W]
    best = None
    for (x, y, r) in circles[0][:12]:
        x, y, r = float(x), float(y), float(r)
        d2 = (xx - x) ** 2 + (yy - y) ** 2
        disc = d2 <= (r * 0.92) ** 2
        n = disc.sum()
        if n < 50:
            continue
        w = white[disc].mean(); a = accent[disc].mean()
        if w < 0.30 or a < 0.05:
            continue
        ring = (d2 <= (r * 1.18) ** 2) & (d2 > (r * 1.0) ** 2)
        touch = float(alpha[ring].mean()) if ring.any() else 0.0
        inside = float(alpha[disc].mean())
        score = w + a
        if best is None or score > best['score']:
            best = {'x': x, 'y': y, 'r': r, 'touch': round(touch, 2), 'inside': round(inside, 2), 'score': score}
    return best

def cut_disc(alpha, x, y, r):
    H, W = alpha.shape
    yy, xx = np.ogrid[:H, :W]
    d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
    k = np.clip((d - r * 1.04) / 2.5, 0.0, 1.0)      # 원판 안 0, 바깥 1, 2.5px 페더
    return alpha * k

# ─────────────────────────────────────────────── ④ 성분
def is_ball_like(comp_area, bbox, char_area):
    y0, y1, x0, x1 = bbox
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if w < 8 or h < 8:
        return False
    aspect = w / h
    fill = comp_area / float(w * h)
    return 0.75 <= aspect <= 1.33 and 0.55 <= fill <= 0.95 and comp_area < char_area * 0.5

def keep_body(alpha):
    """가장 큰 성분(선수) + 큰 부속만 남긴다. 반환: (alpha, 떼어낸 공 중심 or None, 정보)"""
    mask = alpha > 0.16
    lab, n = ndi.label(mask)
    if n == 0:
        raise RuntimeError('알파 마스크가 비어 있습니다')
    areas = ndi.sum(mask, lab, index=range(1, n + 1))
    order = np.argsort(areas)[::-1]
    char = int(order[0]) + 1
    char_area = float(areas[char - 1])
    objs = ndi.find_objects(lab)
    keep = lab == char
    ball = None
    info = {'components': int(n), 'dropped': 0, 'kept_extra': 0}
    for k in order[1:]:
        cid = int(k) + 1
        area = float(areas[cid - 1])
        sl = objs[cid - 1]
        bbox = (sl[0].start, sl[0].stop - 1, sl[1].start, sl[1].stop - 1)
        if is_ball_like(area, bbox, char_area):
            if ball is None or area > ball['area']:
                ball = {'area': area, 'cx': (bbox[2] + bbox[3]) / 2.0, 'cy': (bbox[0] + bbox[1]) / 2.0}
            info['dropped'] += 1
            continue
        if area < char_area * 0.02:
            info['dropped'] += 1
            continue
        keep |= lab == cid
        info['kept_extra'] += 1
    region = ndi.binary_dilation(keep, iterations=3)
    return np.where(region, alpha, 0.0), ball, info, keep

# ─────────────────────────────────────────────── ⑤~⑦
def decontaminate(rgb, a):
    solid = a > 0.92
    if not solid.any():
        return rgb
    _, (iy, ix) = ndi.distance_transform_edt(~solid, return_indices=True)
    out = rgb.copy()
    edge = (a > 0) & ~solid
    out[edge] = rgb[iy[edge], ix[edge]]
    return out

def crop_rgba(rgb, a, pad=2):
    ys, xs = np.where(a > 0.01)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    y0 = max(0, y0 - pad); x0 = max(0, x0 - pad)
    y1 = min(a.shape[0] - 1, y1 + pad); x1 = min(a.shape[1] - 1, x1 + pad)
    out = np.dstack([rgb[y0:y1 + 1, x0:x1 + 1], (a[y0:y1 + 1, x0:x1 + 1] * 255).round().astype(np.uint8)])
    return out, [int(x0), int(y0), int(x1 - x0 + 1), int(y1 - y0 + 1)]

def resize_premul(arr, height):
    h, w = arr.shape[:2]
    nw = max(1, int(round(w * height / float(h))))
    a = arr[:, :, 3:4].astype(np.float32) / 255.0
    pm = np.concatenate([arr[:, :, :3].astype(np.float32) * a, a * 255.0], axis=2)
    im = Image.fromarray(pm.round().clip(0, 255).astype(np.uint8), 'RGBA').resize((nw, height), Image.LANCZOS)
    r = np.asarray(im).astype(np.float32)
    a2 = r[:, :, 3:4] / 255.0
    rgb = np.where(a2 > 0.002, r[:, :, :3] / np.maximum(a2, 0.002), 0)
    return np.dstack([rgb.round().clip(0, 255).astype(np.uint8), r[:, :, 3].round().astype(np.uint8)])

def anchors(arr):
    h, w = arr.shape[:2]
    a = arr[:, :, 3].astype(np.float32) / 255.0
    rows = a.sum(axis=1)
    cum = np.cumsum(rows) / rows.sum()
    y_at = lambda q: int(np.searchsorted(cum, q))
    top, bottom, foot_y = y_at(0.03), y_at(0.97), y_at(0.995)
    xs = np.arange(w, dtype=np.float32)
    def x_center(r0, r1):
        band = a[r0:r1 + 1]; s = band.sum()
        return float((band * xs).sum() / s) if s > 0 else w / 2.0
    foot_x = x_center(max(bottom, foot_y - int(h * 0.06)), min(h - 1, foot_y))
    head_x = x_center(top, min(h - 1, top + int(h * 0.10)))
    return {
        'w': int(w), 'h': int(h),
        'foot': [round(foot_x / w, 3), round(min(h - 1, foot_y + 1) / h, 3)],
        'head': [round(head_x / w, 3), round((top + int(h * 0.05)) / h, 3)],
        'top': round(top / h, 3), 'bottom': round(bottom / h, 3),
    }

# ─────────────────────────────────────────────── 한 명
_sessions = {}
def session_for(model):
    if model not in _sessions:
        from rembg import new_session
        _sessions[model] = new_session(model)
    return _sessions[model]

def read_meta(pid):
    f = EXPORT / pid / f'{pid}_meta.json'
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text(encoding='utf-8'))
    except Exception:
        return {}

def write_meta(pid, meta):
    (EXPORT / pid / f'{pid}_meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def process(pid, height, force):
    d = EXPORT / pid
    hero = next((d / f'{pid}_hero{ext}' for ext in ('.webp', '.png') if (d / f'{pid}_hero{ext}').exists()), None)
    if hero is None:
        return None
    out = d / f'{pid}_stand.webp'
    if out.exists() and not force:
        return {'pid': pid, 'skipped': True}
    from rembg import remove
    t = time.time()
    meta = read_meta(pid)
    manual = meta.get('standee_manual') or {}
    model = manual.get('model') or MODEL
    im = Image.open(hero).convert('RGBA')
    src = np.asarray(im)
    cut = np.asarray(remove(im, session=session_for(model)))
    rgb = src[:, :, :3].copy()
    a = cut[:, :, 3].astype(np.float32) / 255.0
    H, W = a.shape
    # ② 손으로 정한 사각형
    for rect in manual.get('cuts') or []:
        x, y, w, h = [int(v) for v in rect]
        a[max(0, y):y + h, max(0, x):x + w] = 0.0
    # ③ 공
    ball = find_ball(rgb, a)
    ball_state = 'none'
    ball_pos = None
    if ball is not None:
        want = manual.get('ball')
        do_cut = (want == 'cut') or (want != 'keep' and ball['touch'] <= CUT_TOUCH)
        if do_cut:
            a = cut_disc(a, ball['x'], ball['y'], ball['r'])
            ball_state = 'cut'
        else:
            ball_state = 'attached'
        ball_pos = (ball['x'], ball['y'])
    # ④ 성분
    a, detached, info, keep = keep_body(a)
    if detached is not None and ball_pos is None:
        ball_pos = (detached['cx'], detached['cy']); ball_state = 'removed'
    # ⑧ 방향
    facing, facing_src = None, None
    if ball_pos is not None:
        cy, cx = ndi.center_of_mass(keep)
        dx = ball_pos[0] - cx
        facing = 'F' if abs(dx) < 0.06 * W else ('R' if dx > 0 else 'L')
        facing_src = 'ball'
    if manual.get('facing'):
        facing, facing_src = manual['facing'], 'manual'
    # ⑤~⑦
    rgb = decontaminate(rgb, a)
    arr, crop = crop_rgba(rgb, a)
    small = resize_premul(arr, height)
    anc = anchors(small)
    Image.fromarray(small, 'RGBA').save(out, 'WEBP', quality=86, method=6, exact=False)
    meta['standee'] = {
        **anc,
        'facing': facing, 'facing_src': facing_src,
        'ball': ball_state, 'ball_touch': ball['touch'] if ball else None,
        'src': hero.name, 'crop': crop, 'model': model,
    }
    write_meta(pid, meta)
    return {'pid': pid, 'bytes': out.stat().st_size, 'size': (anc['w'], anc['h']), 'facing': facing,
            'ball': ball_state, 'touch': ball['touch'] if ball else None, 'extra': info['kept_extra'],
            'model': model, 'sec': round(time.time() - t, 1)}

# ─────────────────────────────────────────────── 검사·미리보기·수동값
def check():
    problems = []
    n = 0
    for d in sorted(EXPORT.iterdir()):
        if not d.is_dir():
            continue
        pid = d.name
        has_hero = any((d / f'{pid}_hero{ext}').exists() for ext in ('.webp', '.png'))
        stand = d / f'{pid}_stand.webp'
        if not has_hero:
            if stand.exists():
                problems.append(f'{pid}: hero 없이 stand 만 있습니다')
            continue
        n += 1
        if not stand.exists():
            problems.append(f'{pid}: stand 가 없습니다 — python3 tools/art-standee.py --ids {pid}')
            continue
        try:
            s = read_meta(pid)['standee']
            for k in ('w', 'h', 'foot', 'head', 'top', 'bottom'):
                if k not in s:
                    problems.append(f'{pid}: meta.standee.{k} 가 없습니다')
            if s.get('h') != HEIGHT:
                problems.append(f'{pid}: 세로 {s.get("h")}px — 규격은 {HEIGHT}px')
            if not (0 <= s['top'] < s['bottom'] <= 1):
                problems.append(f'{pid}: 몸 구간 top {s["top"]} bottom {s["bottom"]} 이 이상합니다')
        except Exception as e:
            problems.append(f'{pid}: meta.standee 를 읽을 수 없습니다 ({e})')
    return n, problems

def preview(out_path, ids=None):
    from PIL import ImageDraw
    cols, cell_w, cell_h = 7, 200, 360
    items = []
    for d in sorted(EXPORT.iterdir()):
        pid = d.name
        if ids and pid not in ids:
            continue
        f = d / f'{pid}_stand.webp'
        if f.exists():
            items.append((pid, f, read_meta(pid).get('standee') or {}))
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell_w, max(1, rows) * cell_h), (191, 138, 90))
    dr = ImageDraw.Draw(sheet)
    for i, (pid, f, s) in enumerate(items):
        cx, cy = (i % cols) * cell_w, (i // cols) * cell_h
        im = Image.open(f).convert('RGBA')
        w, h = im.size
        x = cx + (cell_w - w) // 2; y = cy + 12
        sheet.paste(im, (x, y), im)
        if s:
            fx, fy = x + s['foot'][0] * w, y + s['foot'][1] * h
            hx, hy = x + s['head'][0] * w, y + s['head'][1] * h
            dr.ellipse([fx - 5, fy - 5, fx + 5, fy + 5], outline=(255, 255, 0), width=2)
            dr.ellipse([hx - 5, hy - 5, hx + 5, hy + 5], outline=(0, 255, 255), width=2)
            dr.line([x, y + s['top'] * h, x + w, y + s['top'] * h], fill=(0, 255, 255), width=1)
            dr.line([x, y + s['bottom'] * h, x + w, y + s['bottom'] * h], fill=(255, 255, 0), width=1)
        dr.text((cx + 6, cy + cell_h - 18), f'{pid} {s.get("facing") or "?"}/{s.get("facing_src") or "-"} {s.get("ball")}', fill=(255, 255, 255))
    sheet.save(out_path)
    return len(items)

def set_manual(pid, kvs):
    meta = read_meta(pid)
    man = meta.get('standee_manual') or {}
    for kv in kvs:
        k, _, v = kv.partition('=')
        if k in ('cuts',):
            v = json.loads(v)
        elif v in ('', 'null', 'none'):
            man.pop(k, None); continue
        man[k] = v
    meta['standee_manual'] = man
    write_meta(pid, meta)
    return man

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ids', default='', help='쉼표로 나눈 pid 목록')
    ap.add_argument('--height', type=int, default=HEIGHT)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--preview', default='', help='미리보기 시트 PNG 경로')
    ap.add_argument('--set', nargs='+', metavar='ARG', help='pid key=value ... → meta.standee_manual (다시 만들지는 않는다)')
    args = ap.parse_args()
    ids = [s for s in args.ids.split(',') if s]

    if args.set:
        pid, kvs = args.set[0], args.set[1:]
        log(pid, json.dumps(set_manual(pid, kvs), ensure_ascii=False))
        return

    if args.check:
        n, problems = check()
        log(f'hero {n}장 검사')
        for p in problems:
            log(' -', p)
        log('이상 없음 ✅' if not problems else f'{len(problems)}건 문제')
        sys.exit(1 if problems else 0)

    load_deps()
    if args.preview and not ids and not args.force:
        n = preview(args.preview, None)
        log(f'미리보기 {n}장 → {args.preview}')
        return

    pids = ids or sorted(d.name for d in EXPORT.iterdir() if d.is_dir())
    done, skipped, total_bytes = 0, 0, 0
    log('| pid | 크기 | bytes | 방향 | 공 | 접촉 | 추가성분 | 모델 | 초 |')
    log('|---|---|---|---|---|---|---|---|---|')
    for pid in pids:
        try:
            r = process(pid, args.height, args.force)
        except Exception as e:
            log(f'| {pid} | 실패 | {e} |')
            continue
        if r is None:
            continue
        if r.get('skipped'):
            skipped += 1
            continue
        done += 1
        total_bytes += r['bytes']
        log(f'| {pid} | {r["size"][0]}×{r["size"][1]} | {r["bytes"]//1024}KB | {r["facing"] or "?"} | {r["ball"]} | {r["touch"] if r["touch"] is not None else "-"} | {r["extra"]} | {r["model"]} | {r["sec"]} |')
    log(f'\n{done}장 생성 · {skipped}장 건너뜀 · 합계 {total_bytes/1024/1024:.2f}MB')
    if args.preview:
        n = preview(args.preview, ids or None)
        log(f'미리보기 {n}장 → {args.preview}')

if __name__ == '__main__':
    main()
