# ダイブマップの背景画像（map.webp）を作る。
# GMRT（Global Multi-Resolution Topography, CC BY 4.0）の約 120m 格子を取得し、ゲーム内の地図と同じ色分けと陰影で 1 枚の画像にする。
# ゲームの地形（bathy.js・detail.js）とは別の、地図表示専用の画像。
#
#   python tools/make_map.py            （取得した格子は tools/.cache に置き、2 回目からは使い回す）
#
import sys, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BOX = (10.0, 14.0, 140.5, 145.5)              # 南, 北, 西, 東（bathy.js と同じ範囲）
SCALE = 0.75                                   # 画像の縮小率（約 120m → 約 160m / 画素。スマホでも開ける約 900 万画素に収める）
OUT = ROOT / 'seas/mariana/map.webp'
CACHE = Path(__file__).resolve().parent / '.cache' / 'mariana_max.npy'
URL = 'https://www.gmrt.org/services/GridServer?north={n}&south={s}&west={w}&east={e}&layer=topo&format=esriascii&resolution={r}'

# 水深 → 色（engine/ui.js の depthRGB と同じ）
STOPS = [(0, (150, 225, 215)), (400, (80, 180, 200)), (2000, (48, 128, 168)), (4000, (36, 84, 140)), (6000, (30, 56, 112)), (8500, (34, 32, 84)), (11000, (26, 12, 50))]


def fetch_box(box, res):
    """1 枚分を取得して (配列, 西端経度, 北端緯度, 格子の大きさ) を返す。途中で切れたら取り直す"""
    s, n, w, e = box
    for attempt in range(4):
        try:
            with urllib.request.urlopen(URL.format(n=n, s=s, w=w, e=e, r=res), timeout=1800) as r:
                txt = r.read().decode('ascii')
            lines = txt.split('\n', 6)
            hdr = {l.split()[0]: float(l.split()[1]) for l in lines[:6]}
            rows, cols = int(hdr['nrows']), int(hdr['ncols'])
            vals = np.array(lines[6].split(), dtype=np.float32)
            if vals.size == rows * cols:
                a = vals.reshape(rows, cols); a[a == hdr['nodata_value']] = np.nan
                return a, hdr['xllcorner'], hdr['yllcorner'] + rows * hdr['cellsize'], hdr['cellsize']
        except ValueError:
            pass                                                   # 途中で切れた（数字が半端）
        print(f'  取り直し（{attempt + 1}）', file=sys.stderr)
    sys.exit('取得に失敗しました')


def fetch():
    """範囲を 2×2 に分けて取得し（1 回で取ると途中で切れるため）、約 120m の 1 枚の格子につなぐ"""
    if CACHE.exists():
        return np.load(CACHE)
    s, n, w, e = BOX
    C = 0.0011                                                     # つないだ格子の大きさ（度）
    H, W = round((n - s) / C), round((e - w) / C)
    lat = n - (np.arange(H) + 0.5) * (n - s) / H
    lon = w + (np.arange(W) + 0.5) * (e - w) / W
    out = np.full((H, W), np.nan, np.float32)
    ms, mw = (s + n) / 2, (w + e) / 2
    for bs, bn in ((s, ms), (ms, n)):
        for bw, be in ((w, mw), (mw, e)):
            print(f'GMRT から取得中… 北緯{bs}〜{bn}° 東経{bw}〜{be}°', file=sys.stderr)
            a, x0, y0, c = fetch_box((bs - 0.01, bn + 0.01, bw - 0.01, be + 0.01), 'high')
            ri = np.where((lat >= bs) & (lat <= bn))[0]; ci = np.where((lon >= bw) & (lon <= be))[0]
            fy = np.clip((y0 - lat[ri]) / c - 0.5, 0, a.shape[0] - 1.001); fx = np.clip((lon[ci] - x0) / c - 0.5, 0, a.shape[1] - 1.001)
            iy, ix = fy.astype(int), fx.astype(int); ty, tx = (fy - iy)[:, None], (fx - ix)[None, :]
            g = lambda dy, dx: a[np.ix_(iy + dy, ix + dx)]
            out[np.ix_(ri, ci)] = (g(0, 0) * (1 - tx) + g(0, 1) * tx) * (1 - ty) + (g(1, 0) * (1 - tx) + g(1, 1) * tx) * ty
    CACHE.parent.mkdir(exist_ok=True)
    np.save(CACHE, out)
    return out


def colorize(e):
    d = -e
    out = np.zeros(e.shape + (3,), np.float32)
    xs = [s[0] for s in STOPS]
    for k in range(3):
        out[..., k] = np.interp(d, xs, [s[1][k] for s in STOPS])
    shallow = (d > 0) & (d < 40)                                   # サンゴ礁の浅瀬は明るい水色
    s = np.clip(1 - d / 40, 0, 1)[..., None] * 0.5
    tgt = np.array([178, 238, 226], np.float32)
    out = np.where(shallow[..., None], out + (tgt - out) * s, out)
    out[(d >= 0) & (d < 2)] = (214, 226, 196)                       # 波打ち際・礁原
    land = e >= 0
    k = np.clip(e / 300, 0, 1)[..., None]
    landc = np.stack([96 + 60 * k[..., 0], 128 + 10 * k[..., 0], 72 + 30 * k[..., 0]], -1)
    out[land] = landc[land]
    return out


def main():
    a = fetch()
    a = np.where(np.isnan(a), np.nanmean(a), a)
    # 島のない所で海面より高い点（浅い礁がデータの誤差で陸になったもの）は、水深 6m の浅瀬に直す（config.js の islands と同じ）
    H, W = a.shape
    lat = BOX[1] - (np.arange(H) + 0.5) * (BOX[1] - BOX[0]) / H; lon = BOX[2] + (np.arange(W) + 0.5) * (BOX[3] - BOX[2]) / W
    isl = ((lat >= 13.18) & (lat <= 13.72))[:, None] & ((lon >= 144.57) & (lon <= 145.03))[None, :]
    a = np.where(~isl & (a > -6), np.minimum(a, -6), a)
    h, w = a.shape
    img = Image.fromarray(a).resize((round(w * SCALE), round(h * SCALE)), Image.BILINEAR)
    e = np.asarray(img, dtype=np.float32)
    cell = (BOX[1] - BOX[0]) / e.shape[0] * 111000                  # 1 画素の大きさ (m)
    # 北西から光を当てた陰影（ui.js と同じ強さ: 約 925m の格子で、海は 900m・陸は 400m の高さの差で ±1）
    dzx = e - np.roll(e, 1, axis=1); dzy = e - np.roll(e, 1, axis=0)
    dzx[:, 0] = 0; dzy[0, :] = 0
    g = (dzx + dzy) * (925 / cell)
    sh = np.clip(1 + g / np.where(e >= 0, 400, 900), 0.65, 1.25)
    rgb = np.clip(colorize(e) * sh[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(OUT, 'WEBP', quality=82, method=6)
    print(f'{OUT.name}: {rgb.shape[1]}×{rgb.shape[0]} 画素, 1 画素 約{cell:.0f} m, {OUT.stat().st_size / 1e6:.2f} MB', file=sys.stderr)


if __name__ == '__main__':
    main()
