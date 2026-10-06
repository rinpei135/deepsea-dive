# 海の一部だけを細かい地形に差し替えるためのデータ（detail.js）を作る。
# GMRT（Global Multi-Resolution Topography, CC BY 4.0）から船の音響測深に基づく細かい格子を取得し、
# ブラウザで扱える細かさに間引いて、bathy.js と同じ形式（16bit 整数の m、北→南・西→東）で書き出す。
#
#   python tools/make_detail.py
#
# 範囲や間引き方を変えるときは、下の AREAS を編集する。
import base64, json, sys, urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
# name: 表示用の名前 / box: [南, 北, 西, 東] / step: 間引き（元の格子の何点ごとに 1 点）/ out: 書き出し先
AREAS = [
    # 海溝の外側（南側）の斜面にある、階段状の断層まで入るように南へ広めに取る
    {'name': 'チャレンジャー海淵の周辺', 'box': [10.95, 11.6, 141.9, 143.0], 'step': 4, 'out': 'seas/mariana/detail.js'},
    {'name': 'シレナ海淵の周辺', 'box': [11.85, 12.25, 144.25, 144.9], 'step': 4, 'out': 'seas/mariana/detail.js'},
    {'name': '熱水噴出孔（スネイルサイト）の周辺', 'box': [12.85, 13.05, 143.5, 143.75], 'step': 2, 'out': 'seas/mariana/detail.js'},
    # 島の沿岸（海岸線・サンゴ礁の礁原・アプラ港・ココス礁湖）。陸地の高さも含む
    {'name': 'グアム島の周辺', 'box': [13.18, 13.72, 144.57, 145.03], 'step': 2, 'out': 'seas/mariana/detail.js'},
]
URL = 'https://www.gmrt.org/services/GridServer?north={n}&south={s}&west={w}&east={e}&layer=topo&format=esriascii&resolution=high'


def fetch(box):
    s, n, w, e = box
    with urllib.request.urlopen(URL.format(n=n, s=s, w=w, e=e), timeout=300) as r:
        lines = r.read().decode('ascii').splitlines()
    hdr = {}
    for line in lines[:6]:
        k, v = line.split()
        hdr[k] = float(v)
    a = np.array([[float(v) for v in line.split()] for line in lines[6:] if line.strip()], dtype=np.float64)
    a[a == hdr['nodata_value']] = np.nan
    return hdr, a


def main():
    tiles = {}
    for area in AREAS:
        hdr, a = fetch(area['box'])
        k = area['step']
        rows, cols = a.shape[0] // k * k, a.shape[1] // k * k
        b = np.nanmean(a[:rows, :cols].reshape(rows // k, k, cols // k, k), axis=(1, 3))   # k×k の平均で間引く
        cell = hdr['cellsize'] * k
        tile = {
            'name': area['name'],
            'lat0': hdr['yllcorner'] + a.shape[0] * hdr['cellsize'] - cell / 2,   # 北端の格子点の緯度
            'lon0': hdr['xllcorner'] + cell / 2,                                   # 西端の格子点の経度
            'step': cell, 'nlat': b.shape[0], 'nlon': b.shape[1],
            'source': f'GMRT（Global Multi-Resolution Topography）の高解像度格子を {k} 点ごとに平均',
            'b64': base64.b64encode(np.round(b).astype('<i2').tobytes()).decode('ascii'),
        }
        tiles.setdefault(area['out'], []).append(tile)
        print(f"{area['name']}: {b.shape[1]}×{b.shape[0]} 点, 格子 約{cell * 111000:.0f} m, 最深 {-np.nanmin(b):.0f} m", file=sys.stderr)
    for out, ts in tiles.items():
        body = ',\n'.join(json.dumps(t, ensure_ascii=False) for t in ts)
        (ROOT / out).write_text(
            '// 海の一部だけの細かい地形（tools/make_detail.py で作成）。\n'
            '// 出典: GMRT Synthesis — Ryan, W. B. F. et al. (2009), Global Multi-Resolution Topography synthesis,\n'
            '// Geochem. Geophys. Geosyst., 10, Q03014, doi:10.1029/2008GC002332（CC BY 4.0）\n'
            f'window.BATHY_DETAIL = [\n{body}\n];\n', encoding='utf-8')


if __name__ == '__main__':
    main()
