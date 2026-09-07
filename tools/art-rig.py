#!/usr/bin/env python3
"""A-포즈 전신 한 장 → 리그 파츠 시트 (art-pipeline 16.9.2)

    python3 tools/art-rig.py                 # art/02_gen/rig/apose_{S,M,L}.png 전부
    python3 tools/art-rig.py --type M        # 하나만
    python3 tools/art-rig.py --preview out.png   # 자른 파츠를 다시 A-포즈로 조립해 눈으로 확인(관절·피벗 표시)
    python3 tools/art-rig.py --check         # 산출물 유무·rig.json 검사

입력  art/02_gen/rig/apose_{type}.png   정면 A-포즈, 흰 배경, 마젠타 민소매 저지 · 시안 반바지 · 검은 무릎 보호대 · 흰 양말·신발
      손은 손가락을 모은 자연스러운 손(편 손은 회전하면 갈고리처럼 보인다 — 3차, 원본을 편집 생성으로 손만 바꿨다)
출력  art/05_shared/rig/{type}/{part}.webp   파츠 RGBA (저지·반바지 자리는 회색 명도만 남긴다 → 런타임이 구단색을 곱한다)
      art/05_shared/rig/{type}/{part}_m.webp 저지·반바지 마스크(알파) — torso·pelvis 만
      art/05_shared/rig/rig.json              타입별 파츠 목록: 파일, 피벗(관절 a), 끝(관절 b), 폭, 몸 높이 대비 길이

관절은 색으로 찾는다 — 프롬프트가 색을 정해 두었기 때문이다:
  저지(마젠타) → 몸통·어깨 관절, 반바지(시안) → 골반·엉덩이 관절, 무릎 보호대(검정) → 무릎, 양말·신발(흰) → 발목·발,
  살색 = 팔·다리. 팔꿈치·손목은 어깨→손끝 축의 47%·85%. 머리는 목선(저지 위 가장 좁은 줄) 위쪽 — 런타임은 카드 얼굴을 쓰므로 참고용.

파츠 = 관절 a→b 축을 감싼 회전 사각형 ∩ 알파, 팔은 저지 픽셀 제외, 허벅지는 반바지 픽셀 제외. 관절 너머로 8% 더 잘라 회전해도 이음새가 벌어지지 않게.
의존: pillow numpy scipy opencv-python-headless rembg onnxruntime
"""
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / 'art' / '02_gen' / 'rig'
OUT = ROOT / 'art' / '05_shared' / 'rig'
TYPES = ['S', 'M', 'L', 'Sq', 'Mq', 'Lq']   # 정면 3종 + 4분의 3 측면(q) 3종. 측면은 있으면 달리기·강타·서브에 쓴다
PART_H = 0          # 0 = 원본 해상도 유지(1200px 전신 기준 파츠는 100~400px)

def load_deps():
    global Image, np, ndi, cv2
    from PIL import Image as _I
    import numpy as _np
    from scipy import ndimage as _ndi
    import cv2 as _cv
    Image, np, ndi, cv2 = _I, _np, _ndi, _cv

def log(*a): print(*a, flush=True)

# ─────────────────────────────────────────────── 마스크
def masks(rgb, a):
    hsv = cv2.cvtColor(np.ascontiguousarray(rgb[:, :, ::-1]), cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)
    body = a > 0.5
    jersey = body & (H >= 128) & (H <= 175) & (S > 60) & (V > 40)          # 마젠타
    shorts = body & (H >= 78) & (H <= 108) & (S > 70) & (V > 60)           # 시안 (신발의 푸른 그늘은 채도가 낮아 걸리지 않게 S>70)
    dark = body & (V < 90)                                                 # 무릎 보호대·머리카락
    white = body & (S < 34) & (V > 190)                                    # 양말·신발 (살색은 S 60 안팎이라 안 걸린다)
    out = {}
    for name, m in (('jersey', jersey), ('shorts', shorts)):
        m = ndi.binary_closing(m, iterations=3)
        big = largest(m, 1)                                                # 가장 큰 덩어리 하나(옷) + 안쪽 구멍(하이라이트) 메움
        m = ndi.binary_fill_holes(big[0]) if big else m
        out[name] = m
    # 트림(노랑): 저지 옆선·목선 — 구단 2색 자리. 살(H≈12, S≈64)과 겹치지 않게 S>110
    trim = body & (H >= 20) & (H <= 40) & (S > 110) & (V > 140)
    out['trim'] = trim
    # 느슨한 옷 마스크 — 어깨끈·하이라이트처럼 채도가 낮은 자리까지. 회색 변환(틴트 자리)에만 쓴다
    out['jersey_loose'] = (out['jersey'] | (body & (H >= 118) & (H <= 180) & (S > 25) & (V > 30))) & ~trim
    out['shorts_loose'] = out['shorts'] | (body & (H >= 70) & (H <= 118) & (S > 30) & (V > 40))
    out.update({'dark': dark, 'white': white, 'body': body})
    return out

def bbox(m):
    ys, xs = np.where(m)
    if not len(ys): return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())

def largest(m, k=1):
    lab, n = ndi.label(m)
    if n == 0: return []
    areas = ndi.sum(m, lab, index=range(1, n + 1))
    order = np.argsort(areas)[::-1][:k]
    return [(lab == int(i) + 1) for i in order]

# ─────────────────────────────────────────────── 관절
def find_joints(M, H, W):
    J = {}
    jb = bbox(M['jersey']); sb = bbox(M['shorts'])
    if jb is None or sb is None:
        raise RuntimeError('저지(마젠타) 또는 반바지(시안)를 못 찾았습니다')
    jx0, jy0, jx1, jy1 = jb; sx0, sy0, sx1, sy1 = sb
    cx = (sx0 + sx1) / 2.0
    # 목: 저지 위쪽에서 몸 폭이 가장 좁은 줄
    rows = M['body'][max(0, jy0 - int(0.12 * H)):jy0]
    widths = rows.sum(axis=1)
    neck_row = max(0, jy0 - int(0.12 * H)) + int(np.argmin(widths)) if len(widths) else jy0
    J['neck'] = (cx, float(neck_row))
    # 어깨: 저지 상단 8% 줄에서 저지의 좌우 끝 → 조금 안쪽
    r = jy0 + int(0.08 * (jy1 - jy0))
    xs = np.where(M['jersey'][r])[0]
    J['shoL'] = (float(xs.min()) + 6, float(r)); J['shoR'] = (float(xs.max()) - 6, float(r))
    # 엉덩이: 반바지 상단 45%, 좌우 1/4 지점
    hy = sy0 + 0.45 * (sy1 - sy0); hw = sx1 - sx0
    J['hipL'] = (sx0 + hw * 0.28, hy); J['hipR'] = (sx1 - hw * 0.28, hy)
    J['pelvis'] = (cx, hy)
    J['crotch'] = (cx, float(sy1))
    # 손끝: 어깨에서 가장 먼 몸 픽셀(저지·반바지 제외), 좌우 나눠서
    skin = M['body'] & ~M['jersey'] & ~M['shorts'] & ~M['white']
    ys, xs = np.where(skin)
    for side, sho, cond in (('L', J['shoL'], xs < cx), ('R', J['shoR'], xs > cx)):
        sel = cond & (ys > J['neck'][1]) & (ys < J['crotch'][1] + 0.05 * H)
        # 팔은 몸통 옆에서 바깥쪽으로 — 저지·반바지 폭 밖(10px 여유)의 픽셀 중 어깨에서 가장 먼 점.
        # 엉덩이 옆 허벅지 살은 반바지 폭 안이라 걸러진다(안 거르면 손끝 대신 허벅지를 잡는다).
        lim_l, lim_r = min(jx0, sx0) - 10, max(jx1, sx1) + 10
        outer = sel & ((xs < lim_l) if side == 'L' else (xs > lim_r))
        if outer.sum() < 50:
            raise RuntimeError(f'{side} 팔이 몸통 옆에서 안 떨어져 있습니다 — A-포즈(팔 30° 이상)로 다시 생성')
        d = (xs[outer] - sho[0]) ** 2 + (ys[outer] - sho[1]) ** 2
        k = int(np.argmax(d))
        tip = (float(xs[outer][k]), float(ys[outer][k]))
        J['hand' + side] = tip
        J['elb' + side] = (sho[0] + (tip[0] - sho[0]) * 0.47, sho[1] + (tip[1] - sho[1]) * 0.47)
        J['wri' + side] = (sho[0] + (tip[0] - sho[0]) * 0.84, sho[1] + (tip[1] - sho[1]) * 0.84)
    # 무릎: 반바지 아래 검은 덩어리 2개
    below = np.zeros_like(M['dark']); below[sy1:] = True
    pads = largest(M['dark'] & below, 2)
    if len(pads) < 2:
        raise RuntimeError('무릎 보호대 2개를 못 찾았습니다')
    cents = sorted([ndi.center_of_mass(p) for p in pads], key=lambda c: c[1])
    J['kneeL'] = (float(cents[0][1]), float(cents[0][0])); J['kneeR'] = (float(cents[1][1]), float(cents[1][0]))
    # 발목·발: 흰 덩어리(양말+신발) 좌우
    feet = largest(M['white'] & below, 2)
    if len(feet) < 2:
        raise RuntimeError('양말·신발 2개를 못 찾았습니다')
    feet = sorted(feet, key=lambda f: ndi.center_of_mass(f)[1])
    for side, f in (('L', feet[0]), ('R', feet[1])):
        fb = bbox(f)
        top = fb[1]
        xs_top = np.where(f[top:top + 6].any(axis=0))[0]
        J['ank' + side] = (float(xs_top.mean()), float(top) + 2)
        J['foot' + side] = ((fb[0] + fb[2]) / 2.0, float(fb[3]))
    J['top'] = (cx, float(bbox(M['body'])[1]))
    J['bottom'] = (cx, float(bbox(M['body'])[3]))
    return J

# ─────────────────────────────────────────────── 파츠 자르기
def band_mask(shape, a, b, w, ext, capsule=True):
    """a→b 축을 감싼 폭 w 의 띠. capsule 이면 양 끝이 반지름 w/2 의 반원(관절에서 회전해도 모서리가 안 튀어나온다), 아니면 ext 만큼 직선 연장"""
    H, W = shape
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay; L = max(1e-6, (dx * dx + dy * dy) ** 0.5)
    ux, uy = dx / L, dy / L
    yy, xx = np.mgrid[:H, :W]
    t = (xx - ax) * ux + (yy - ay) * uy
    s = -(xx - ax) * uy + (yy - ay) * ux
    body = (t >= 0) & (t <= L) & (np.abs(s) <= w / 2.0)
    if not capsule:
        return (t >= -ext) & (t <= L + ext) & (np.abs(s) <= w / 2.0)
    r = max(w / 2.0, ext)
    capA = (xx - ax) ** 2 + (yy - ay) ** 2 <= r * r
    capB = (xx - bx) ** 2 + (yy - by) ** 2 <= r * r
    return body | capA | capB

def limb_width(M, a, b, exclude=None):
    """축 중간에서 수직 방향 몸 픽셀 수 (파츠 폭)"""
    body = M['body'].copy()
    if exclude is not None: body &= ~exclude
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    dx, dy = b[0] - a[0], b[1] - a[1]; L = max(1e-6, (dx * dx + dy * dy) ** 0.5)
    nx, ny = -dy / L, dx / L
    cnt = 0
    for s in range(-200, 201):
        x, y = int(round(mid[0] + nx * s)), int(round(mid[1] + ny * s))
        if 0 <= x < body.shape[1] and 0 <= y < body.shape[0] and body[y, x]: cnt += 1
    return max(8, cnt)

def cut_part(rgba, M, a, b, w, ext, exclude=None, include=None):
    keep = band_mask(M['body'].shape, a, b, w, ext) & M['body']
    if exclude is not None: keep &= ~exclude
    if include is not None: keep |= include
    if keep.sum() < 20: return None
    ys, xs = np.where(keep)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
    out = rgba[y0:y1 + 1, x0:x1 + 1].copy()
    out[:, :, 3] = np.where(keep[y0:y1 + 1, x0:x1 + 1], out[:, :, 3], 0)
    return out, (int(x0), int(y0))

def gray_where(rgba, mask):
    """마스크 자리를 명도만 남긴 회색으로 — 런타임이 구단색을 곱해 쓴다. 마스크 알파 이미지도 돌려준다."""
    out = rgba.copy()
    lum = (0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2])
    # 구단색을 곱했을 때 밝은 면이 제 색으로 나오게 — 옷 자리 명도의 상위 20% 지점을 238 로 맞춘다(그림자는 상대 비율 유지)
    ref = float(np.percentile(lum[mask], 80)) if mask.any() else 200.0
    lum = np.clip(lum * (238.0 / max(60.0, ref)), 0, 255).astype(np.uint8)
    for ch in range(3):
        out[:, :, ch] = np.where(mask, lum, out[:, :, ch])
    m = np.zeros(rgba.shape[:2], dtype=np.uint8); m[mask] = 255
    return out, m

def process(t, height):
    src = next((GEN / f'apose_{t}{ext}' for ext in ('.png', '.webp') if (GEN / f'apose_{t}{ext}').exists()), None)
    if src is None: return None
    from rembg import remove, new_session
    im = Image.open(src).convert('RGBA')
    rgb = np.asarray(im)[:, :, :3].copy()
    cut = np.asarray(remove(im, session=new_session('isnet-anime')))
    a = cut[:, :, 3].astype(np.float32) / 255.0
    Hh, Ww = a.shape
    M = masks(rgb, a)
    J = find_joints(M, Hh, Ww)
    rgba = np.dstack([rgb, (a * 255).astype(np.uint8)])
    body_h = J['bottom'][1] - J['top'][1]
    d = OUT / t; d.mkdir(parents=True, exist_ok=True)
    parts = {}
    def save(name, res, pivot, tip, mask_kind=None):
        if res is None:
            log(f'  ! {t}/{name}: 비어 있음'); return
        arr, (ox, oy) = res
        maskimg = None; trimimg = None
        if mask_kind:
            alpha_ok = arr[:, :, 3] > 0
            mk = M[mask_kind + '_loose'][oy:oy + arr.shape[0], ox:ox + arr.shape[1]] & alpha_ok
            tr = M['trim'][oy:oy + arr.shape[0], ox:ox + arr.shape[1]] & alpha_ok if mask_kind == 'jersey' else None
            arr, maskimg = gray_where(arr, mk)
            if tr is not None and tr.sum() > 30:
                arr, trimimg = gray_where(arr, tr)
        Image.fromarray(arr, 'RGBA').save(d / f'{name}.webp', 'WEBP', quality=88, method=6)
        if maskimg is not None:
            Image.fromarray(maskimg, 'L').save(d / f'{name}_m.webp', 'WEBP', quality=88, method=6)
        if trimimg is not None:
            Image.fromarray(trimimg, 'L').save(d / f'{name}_t.webp', 'WEBP', quality=88, method=6)
        L = ((tip[0] - pivot[0]) ** 2 + (tip[1] - pivot[1]) ** 2) ** 0.5
        parts[name] = {'file': f'{name}.webp', 'mask': f'{name}_m.webp' if maskimg is not None else None,
                       'trim': f'{name}_t.webp' if trimimg is not None else None,
                       'w': int(arr.shape[1]), 'h': int(arr.shape[0]),
                       'pivot': [round(pivot[0] - ox, 1), round(pivot[1] - oy, 1)], 'tip': [round(tip[0] - ox, 1), round(tip[1] - oy, 1)],
                       'len': round(L / body_h, 4)}
    ext = 0.045 * body_h                                             # 관절 너머 4.5% — 회전해도 이음새가 벌어지지 않게
    # 몸통(저지 + 목 살) : 골반 → 목
    torso_inc = M['jersey'] | (M['body'] & ~M['shorts'] & ~M['white'] & (np.arange(Hh)[:, None] >= J['neck'][1] - 4) & (np.arange(Hh)[:, None] <= J['hipL'][1]) & (np.abs(np.arange(Ww)[None, :] - J['pelvis'][0]) < (J['shoR'][0] - J['shoL'][0]) * 0.55) & ~band_mask(M['body'].shape, J['shoL'], J['handL'], 1, 0) & ~band_mask(M['body'].shape, J['shoR'], J['handR'], 1, 0))
    tw = (J['shoR'][0] - J['shoL'][0]) * 1.35
    save('torso', cut_part(rgba, M, J['pelvis'], J['neck'], tw, ext, exclude=(M['shorts'] | band_mask(M['body'].shape, J['shoL'], J['handL'], limb_width(M, J['shoL'], J['handL'], M['jersey']) * 1.3, 0) & ~M['jersey'] | band_mask(M['body'].shape, J['shoR'], J['handR'], limb_width(M, J['shoR'], J['handR'], M['jersey']) * 1.3, 0) & ~M['jersey']), include=M['jersey']), J['pelvis'], J['neck'], 'jersey')
    # 골반(반바지) : 골반 중심, 끝은 가랑이
    save('pelvis', cut_part(rgba, M, J['pelvis'], J['crotch'], (J['hipR'][0] - J['hipL'][0]) * 2.6, ext, include=M['shorts'], exclude=M['jersey']), J['pelvis'], J['crotch'], 'shorts')
    # 팔 (좌우) — 저지 제외
    for side in ('L', 'R'):
        sho, elb, wri, hand = J['sho' + side], J['elb' + side], J['wri' + side], J['hand' + side]
        w = limb_width(M, sho, hand, M['jersey']) * 1.5
        # 팔은 저지·반바지 픽셀을 뺀다 — 손가락을 모은 손은 엉덩이 옆에 가까워 손 띠가 반바지를 물어 온다
        cloth = M['jersey_loose'] | M['shorts_loose']
        save('uarm' + side, cut_part(rgba, M, sho, elb, w, ext, exclude=cloth), sho, elb)
        save('farm' + side, cut_part(rgba, M, elb, wri, w, ext, exclude=cloth), elb, wri)
        save('hand' + side, cut_part(rgba, M, wri, hand, w * 1.6, ext * 2, exclude=cloth), wri, hand)
        hip, knee, ank, foot = J['hip' + side], J['knee' + side], J['ank' + side], J['foot' + side]
        half = (np.arange(Ww)[None, :] < J['pelvis'][0]) if side == 'L' else (np.arange(Ww)[None, :] >= J['pelvis'][0])
        half = np.broadcast_to(half, M['body'].shape)
        lw = limb_width(M, knee, ank, exclude=~half) * 1.7
        save('thigh' + side, cut_part(rgba, M, hip, knee, lw * 1.15, ext, exclude=M['shorts_loose'] | ~half), hip, knee)
        save('shin' + side, cut_part(rgba, M, knee, ank, lw, ext, exclude=~half), knee, ank)
        save('foot' + side, cut_part(rgba, M, ank, foot, lw * 1.8, ext * 1.5, exclude=~half, include=(M['white'] & half & (np.arange(Hh)[:, None] > ank[1] - 6))), ank, foot)
    # 머리(참고용): 목 위 전부
    head_inc = M['body'] & (np.arange(Hh)[:, None] < J['neck'][1] + 4)
    save('head', cut_part(rgba, M, J['neck'], J['top'], (J['shoR'][0] - J['shoL'][0]) * 1.2, ext, exclude=M['jersey_loose'], include=head_inc), J['neck'], J['top'])
    joints = {k: [round(v[0], 1), round(v[1], 1)] for k, v in J.items()}
    return {'src': src.name, 'size': [Ww, Hh], 'body_h': round(body_h, 1), 'joints': joints, 'parts': parts}

def preview(rig, out_path, types):
    from PIL import ImageDraw
    tiles = []
    for t in types:
        r = rig.get(t)
        if not r: continue
        W, H = r['size']
        can = Image.new('RGBA', (W, H), (191, 138, 90, 255))
        order = ['uarmL', 'farmL', 'handL', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'pelvis', 'torso', 'head', 'uarmR', 'farmR', 'handR']
        J = r['joints']
        for name in order:
            p = r['parts'].get(name)
            if not p: continue
            im = Image.open(OUT / t / p['file']).convert('RGBA')
            # 피벗을 원본 관절 위치에 놓는다(A-포즈 그대로 → 원본과 겹쳐야 정상)
            jname = {'uarmL': 'shoL', 'farmL': 'elbL', 'handL': 'wriL', 'uarmR': 'shoR', 'farmR': 'elbR', 'handR': 'wriR',
                     'thighL': 'hipL', 'shinL': 'kneeL', 'footL': 'ankL', 'thighR': 'hipR', 'shinR': 'kneeR', 'footR': 'ankR',
                     'pelvis': 'pelvis', 'torso': 'pelvis', 'head': 'neck'}[name]
            jx, jy = J[jname]
            can.alpha_composite(im, (int(round(jx - p['pivot'][0])), int(round(jy - p['pivot'][1]))))
        dr = ImageDraw.Draw(can)
        for k, (x, y) in J.items():
            dr.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 255, 0), width=2)
        dr.text((8, 8), t, fill=(255, 255, 255))
        can.thumbnail((450, 600))
        tiles.append(can.convert('RGB'))
    if not tiles: return 0
    w = sum(t.size[0] for t in tiles); h = max(t.size[1] for t in tiles)
    sheet = Image.new('RGB', (w, h), (30, 30, 30)); x = 0
    for t in tiles: sheet.paste(t, (x, 0)); x += t.size[0]
    sheet.save(out_path); return len(tiles)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--type', default='')
    ap.add_argument('--preview', default='', help='자른 파츠를 A-포즈로 다시 조립한 확인용 PNG')
    ap.add_argument('--preview-only', action='store_true', help='자르지 않고 rig.json 으로 미리보기만')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    rig_f = OUT / 'rig.json'
    rig = json.loads(rig_f.read_text(encoding='utf-8')) if rig_f.exists() else {}
    types = [args.type] if args.type else TYPES
    if args.check:
        missing = [t for t in ('S', 'M', 'L') if t not in rig or not (OUT / t / 'torso.webp').exists()]
        log('리그 파츠:', ', '.join(f'{t} {len(rig[t]["parts"])}개' for t in rig) or '없음')
        if missing: log('빠짐:', missing); sys.exit(1)
        log('이상 없음 ✅'); return
    load_deps()
    if not args.preview_only:
        for t in types:
            try:
                r = process(t, PART_H)
            except Exception as e:
                log(f'{t}: 실패 — {e}'); continue
            if r is None:
                if not t.endswith('q'): log(f'{t}: 원본 없음 (art/02_gen/rig/apose_{t}.png)')
                continue
            rig[t] = r
            log(f'{t}: 파츠 {len(r["parts"])}개 · 몸 높이 {r["body_h"]}px')
        OUT.mkdir(parents=True, exist_ok=True)
        rig_f.write_text(json.dumps(rig, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    if args.preview:
        n = preview(rig, args.preview, types)
        log(f'미리보기 {n}장 → {args.preview}')

if __name__ == '__main__':
    main()
