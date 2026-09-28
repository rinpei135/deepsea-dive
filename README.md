# 深海ダイブ（deepsea-dive）

実際の海底地形データをもとに、世界の深い海を3Dで潜航・探査できるWebサイトです。three.js で動作し、ブラウザだけで遊べます。

## 潜れる海

| 海 | ページ | 潜航地点 |
|---|---|---|
| マリアナ海溝 | `seas/mariana/` | チャレンジャー海淵 |

## 遊び方

- **俯瞰モード**: ドラッグで回転、ホイールで拡大、右ドラッグで移動。
- **潜航モード**: 「潜航開始」を押すと、上空から海面へ降り、ゆっくり海中に入ります。
  - 移動: `W` `A` `S` `D`／上昇 `E`・`Space`／下降 `Q`・`C`／`Shift` で加速／ドラッグで見回す
  - 右の深度ルーラーをクリックすると、その深さへ移動します。
  - 右上のミニマップをクリックすると、その地点へ移動します。
- **ソナー**: 海中では10秒ごとに音波を発信します。波面は海水中の音速（約1,500 m/秒）で広がり、届いた地形が数秒間浮かび上がります。

## フォルダ構成

```
index.html            トップページ（潜れる海の一覧）
engine/               すべての海で共通の仕組み
  world.js            地形メッシュ・水中の見え方・ソナーの表示
  sea.js              空・海面（ゲルストナー波）・光の筋・泡
  ui.js               計器・深度ルーラー・ボタン・ミニマップ
  treasure.js         隠し要素
  nav.js              移動・入水演出・ソナー発信・描画ループ
  engine.css          共通スタイル
seas/<海のID>/
  index.html          その海のページ（出典の記載を含む）
  bathy.js            海底地形データ（下記の形式）
  config.js           その海の設定（潜航地点・地名・深さの区分・生き物など）
```

## 海の追加方法

1. `seas/mariana/` をコピーして `seas/<新しいID>/` を作る。
2. `bathy.js` を新しい海域の地形データに置き換える。形式は次のとおり:
   - `window.BATHY = { nlat, nlon, lat0（北端）, lat1（南端）, lon0（西端）, lon1（東端）, step（格子間隔・度） }`
   - `window.BATHY.b64` … 標高（m、整数）を北→南・西→東の順に並べた Int16 リトルエンディアン配列の Base64
3. `config.js` の `id`・`name`・`origin`（潜航地点を探す範囲）・`features`（地名）・`zones`・`life` などを書き換える。
4. `index.html` のタイトルと出典欄を書き換え、トップページの一覧にカードを追加する。

地形データは NOAA CoastWatch ERDDAP から CSV で取得できます（例: データセット `ETOPO_2022_v1_15s`）。

## データ出典と利用条件

- **海底地形**: NOAA National Centers for Environmental Information. 2022: ETOPO 2022 15 Arc-Second Global Relief Model. NOAA National Centers for Environmental Information. https://doi.org/10.25921/fd45-gt74 （2026-09-28 取得）
  - NOAA CoastWatch ERDDAP のデータセット `ETOPO_2022_v1_15s` から、1点おき（30秒角 ≈ 0.9 km 間隔）に取得。
  - 利用条件: **CC0 1.0**（パブリックドメイン）。**航行用には使用できません。**
- **チャレンジャー海淵の実測深度（約10,935 m）**: Greenaway ほか (2021), Deep-Sea Research Part I。
- 水温・太陽光・生き物の解説は一般的な知見にもとづく概算です。海面の波・雲・光の筋は表現用に作ったもので、観測データではありません。

## 使用しているライブラリ・フォント

- [three.js](https://threejs.org/) r128（MIT License）— CDN から読み込み
- Google Fonts: Shippori Mincho B1 / Zen Kaku Gothic New / IBM Plex Mono（SIL Open Font License）

## ライセンス

Copyright (C) 2026 rinpei135

このプログラムはフリーソフトウェアです。フリーソフトウェア財団が発行する GNU General Public License 第3版の条件のもとで、再配布および改変ができます。詳しくは [LICENSE](LICENSE) を参照してください。

海底地形データ（`seas/*/bathy.js`）は NOAA による CC0 1.0 のデータで、上記ライセンスの対象外です。
