# グアム島の「細かい陸地の高さ」と「衛星写真」を作る（島の近くで使う。遠くは detail.js の約120m 格子のまま）。
#
#   python tools/make_guam.py        （取得したタイルは tools/.cache に置き、2 回目からは使い回す）
#
# 出典（どちらも帰属表示が必要）:
#   衛星写真: Sentinel-2 cloudless 2016 - https://s2maps.eu by EOX IT Services GmbH
#             (Contains modified Copernicus Sentinel data 2016 & 2017)  … CC BY 4.0
#   陸地の高さ: Mapzen Terrain Tiles（AWS Open Data, Terrarium 形式）。グアムは USGS の標高データにもとづく
#
# 書き出すもの（seas/mariana/）:
#   guam_sat_hi.webp / guam_sat_lo.webp  衛星写真（緯度経度に沿った画像。高画質 4096 / 低画質 2048 画素の高さ）
#   guam_dem.webp                         陸地の高さ（約 20m / 画素。R*256+G = 高さ×100 cm、海は 0。可逆圧縮）
import io, math, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'seas/mariana'
CACHE = Path(__file__).resolve().parent / '.cache' / 'guam'
BOX = (13.18, 13.72, 144.57, 145.03)            # 南, 北, 西, 東（detail.js のグアム島の範囲と同じ）
Z = 14                                           # タイルのズーム（約 9.3m / 画素）
SAT = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'
DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'


def merc(lat, lon, z):
    n = 2 ** Z
    return (lon + 180) / 360 * n * 256, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n * 256


def get(url, name):
    p = CACHE / name
    if not p.exists():
        for k in range(4):
            try:
                p.write_bytes(urllib.request.urlopen(url, timeout=60).read()); break
            except Exception as e:
                if k == 3: raise
    return p.read_bytes()


def mosaic(kind):
    """範囲をおおうタイルを集めて、Web メルカトルの 1 枚にする。左上の画素座標も返す"""
    x0, y0 = merc(BOX[1], BOX[2], Z); x1, y1 = merc(BOX[0], BOX[3], Z)
    tx0, ty0, tx1, ty1 = int(x0 // 256), int(y0 // 256), int(x1 // 256), int(y1 // 256)
    W, H = (tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256
    CACHE.mkdir(parents=True, exist_ok=True)
    jobs = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    def load(j):
        tx, ty = j
        if kind == 'sat':
            return j, np.asarray(Image.open(io.BytesIO(get(SAT.format(z=Z, x=tx, y=ty), f'sat_{Z}_{tx}_{ty}.jpg'))).convert('RGB'))
        t = np.asarray(Image.open(io.BytesIO(get(DEM.format(z=Z, x=tx, y=ty), f'dem_{Z}_{tx}_{ty}.png'))).convert('RGB'), dtype=np.float64)
        return j, t[..., 0] * 256 + t[..., 1] + t[..., 2] / 256 - 32768
    out = np.zeros((H, W, 3) if kind == 'sat' else (H, W), np.float32)
    with ThreadPoolExecutor(8) as ex:
        for (tx, ty), a in ex.map(load, jobs):
            out[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = a
    print(f'{kind}: {len(jobs)} タイル', file=sys.stderr)
    return out, tx0 * 256, ty0 * 256


def to_latlon(a, ox, oy, H, W):
    """Web メルカトルの画像を、緯度経度に沿った H×W の格子に描き直す（双線形補間）"""
    lat = BOX[1] - (np.arange(H) + 0.5) * (BOX[1] - BOX[0]) / H
    lon = BOX[2] + (np.arange(W) + 0.5) * (BOX[3] - BOX[2]) / W
    py = np.array([merc(la, BOX[2], Z)[1] for la in lat]) - oy - 0.5
    px = np.array([merc(BOX[1], lo, Z)[0] for lo in lon]) - ox - 0.5
    iy = np.clip(py.astype(int), 0, a.shape[0] - 2); ix = np.clip(px.astype(int), 0, a.shape[1] - 2)
    ty = np.clip(py - iy, 0, 1)[:, None]; tx = np.clip(px - ix, 0, 1)[None, :]
    if a.ndim == 3: ty, tx = ty[..., None], tx[..., None]
    g = lambda dy, dx: a[np.ix_(iy + dy, ix + dx)]
    return (g(0, 0) * (1 - tx) + g(0, 1) * tx) * (1 - ty) + (g(1, 0) * (1 - tx) + g(1, 1) * tx) * ty


def main():
    lat_m = (BOX[1] - BOX[0]) * 110570; lon_m = (BOX[3] - BOX[2]) * 111320 * math.cos(math.radians(sum(BOX[:2]) / 2))
    sat, ox, oy = mosaic('sat')
    sox, soy = ox, oy
    for name, H in (('guam_sat_hi.webp', 4096), ('guam_sat_lo.webp', 2048)):
        W = round(H * lon_m / lat_m)
        img = to_latlon(sat, ox, oy, H, W)
        Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(OUT / name, 'WEBP', quality=78, method=6)
        print(f'{name}: {W}×{H}, 約{lat_m / H:.0f} m/画素, {(OUT / name).stat().st_size / 1e6:.2f} MB', file=sys.stderr)
    dem, ox, oy = mosaic('dem')
    H = round(lat_m / 20); W = round(lon_m / 20)
    e = to_latlon(dem, ox, oy, H, W)
    e[e > 450] = 0                                                  # 壊れたタイル（グアムの最高点は約 406m）
    # このタイルの海岸近くの海は粗いデータでならされ、海面より少し高く出ている（島のまわりのにじみ）。
    # GMRT（tools/make_map.py が取得した約120m 格子）で水深 8m より深い所は、海として 0 にする
    g = np.load(Path(__file__).resolve().parent / '.cache' / 'mariana_max.npy')
    gs, gn, gw, ge = 10.0, 14.0, 140.5, 145.5
    lat = BOX[1] - (np.arange(H) + 0.5) * (BOX[1] - BOX[0]) / H; lon = BOX[2] + (np.arange(W) + 0.5) * (BOX[3] - BOX[2]) / W
    gy = np.clip(((gn - lat) / (gn - gs) * g.shape[0] - 0.5).astype(int), 0, g.shape[0] - 1)
    gx = np.clip(((lon - gw) / (ge - gw) * g.shape[1] - 0.5).astype(int), 0, g.shape[1] - 1)
    e[g[np.ix_(gy, gx)] < -8] = 0
    # 礁原（浅いサンゴ礁の平らな所）も、にじみで陸になっている。衛星写真で水の色（赤より青がはっきり強い）の低い所は海にする
    sw = to_latlon(sat, sox, soy, H, W)
    water = (sw[..., 2] - sw[..., 0] > 22) & (e < 15)
    e[water] = 0
    v = np.clip(np.round(np.clip(e, 0, 655) * 100), 0, 65535).astype(np.uint32)   # 海（0 以下）は 0
    rgb = np.stack([v >> 8, v & 255, np.zeros_like(v)], -1).astype(np.uint8)
    Image.fromarray(rgb).save(OUT / 'guam_dem.webp', 'WEBP', lossless=True, quality=100, method=6)
    print(f'guam_dem.webp: {W}×{H}, 約20 m/画素, 最高 {e.max():.0f} m, {(OUT / "guam_dem.webp").stat().st_size / 1e6:.2f} MB', file=sys.stderr)


if __name__ == '__main__':
    main()
