// マリアナ海溝の設定。新しい海を追加するときは、このファイルと bathy.js を用意する
window.SEA = {
  id: 'mariana',
  name: 'マリアナ海溝',
  // 潜航地点: この範囲 [南緯端, 北緯端, 西経端, 東経端] の中で一番深い格子点
  origin: {
    name: 'チャレンジャー海淵',
    box: [11.2, 11.5, 142.0, 142.8],
    arrival: depth => `チャレンジャー海淵の底に到着しました。このデータでは ${depth}m、最新の測量では約10,935m です。`,
    recordTitle: 'チャレンジャー海淵への到達記録'
  },
  // ダイブマップの背景画像（tools/make_map.py で作る、約 160m / 画素）と、その範囲 [南, 北, 西, 東]
  map: { src: 'map.webp', box: [10.0, 14.0, 140.5, 145.5] },
  // 本当に陸地（島）がある範囲 [南, 北, 西, 東]。これ以外で地形データが海面より高い所（サンタローサ礁・ガルベス堆などの浅い礁）は、
  // データの誤差なので、水深 shoalDepth m の浅瀬として扱う（この範囲の島はグアム島とココス島だけ）
  islands: [[13.18, 13.72, 144.57, 145.03]], shoalDepth: 6,
  // 島の細かい陸地（約 20m）と衛星写真（tools/make_guam.py で作る）。島に近づいたときに読み込む。tile は detail.js の島のタイルの名前
  coast: { box: [13.18, 13.72, 144.57, 145.03], tile: 'グアム', dem: 'guam_dem.webp', sat: { hi: 'guam_sat_hi.webp', lo: 'guam_sat_lo.webp' } },
  // 濁った海域 [南, 北, 西, 東]。turb: 濁り（1 で見通しが約 1/3、緑がかる）。範囲の外 0.5km でなめらかに消える。
  // 外洋に面した礁は見通し 30m 以上と澄んでいるが、港の中や川の流れ込む湾は、泥や植物プランクトンで 10〜18m ほど
  murky: [
    { name: 'アプラ港の内側（サッサ湾）', box: [13.415, 13.45, 144.655, 144.695], turb: 1.0 },
    { name: 'アプラ港', box: [13.435, 13.47, 144.625, 144.67], turb: 0.55 },
    { name: 'タロフォフォ湾（川の流れ込み）', box: [13.348, 13.362, 144.758, 144.772], turb: 0.8 },
    { name: 'パゴ湾', box: [13.42, 13.432, 144.785, 144.8], turb: 0.6 },
    { name: 'ハガニア（川の流れ込み）', box: [13.475, 13.485, 144.745, 144.76], turb: 0.45 }
  ],
  // 俯瞰で表示する地名。deepest は範囲内の最深点、axisLon はその経度での海溝の軸
  features: [
    { name: 'シレナ海淵', deepest: [11.85, 12.2, 144.2, 144.8] },
    { name: 'グアム島', lat: 13.45, lon: 144.78, y: 0.4 },
    { name: 'フィリピン海プレート', lat: 13.5, lon: 141.4, area: true },
    { name: '太平洋プレート', lat: 10.4, lon: 144.2, area: true },
    { name: 'マリアナ海溝', axisLon: 143.1, area: true }
  ],
  // 隠し要素の宝箱を置く海底の最小水深 (m)
  treasureMinDepth: 2000,
  // 3D で泳ぐ生き物（項目の意味は engine/creatures.js の先頭を参照）。出会った生き物は図鑑に登録される。
  // density は 1 区画あたりの平均の数（水中は 100m 立方、海底は 100m 四方）。rare はめったに出会えない生き物。
  // status: 'preview' の生き物は公開前で、通常は表示しない（プレビュー表示を有効にしたブラウザでだけ出る）。
  creatures: [
    { kind: 'turtle', name: 'アオウミガメ', sci: 'Chelonia mydas', from: 0, to: 100, size: 1.0, density: 6, speed: 0.4, status: 'preview',
      note: '海草や藻を食べるウミガメ。前あしのひれで水中を飛ぶように泳ぐ。' },
    { kind: 'hawksbill', name: 'タイマイ', sci: 'Eretmochelys imbricata', from: 0, to: 60, size: 0.8, density: 1, speed: 0.35, status: 'preview',
      note: 'べっこう色の甲羅のウミガメ。とがったくちばしで、サンゴのすき間の海綿を食べる。数が減り、守られている。' },
    { kind: 'spermwhale', name: 'マッコウクジラ', sci: 'Physeter macrocephalus', from: 0, to: 2000, size: 15, rare: true, speed: 0.8, behavior: 'migrate', cruise: 1.2, dive: 1000,
      pods: [{ lat: 11.42, lon: 142.52, km: 3, n: 2 }, { lat: 11.75, lon: 143.3, km: 4, n: 3 }, { lat: 13.2, lon: 144.5, km: 2.5, n: 1 }], status: 'preview',
      note: '大きな四角い頭を持つハクジラ。イカを求めて深く潜る、息を止めて潜る哺乳類のチャンピオン。' },
    { kind: 'lanternfish', name: 'ハダカイワシ', sci: 'Myctophidae（ハダカイワシ科）', from: 200, to: 1000, size: 0.08, density: 6, view: 0.5, speed: 0.3, behavior: 'school', glow: true, status: 'preview',
      note: '体の下側の発光器で青く光る小さな魚の群れ。昼は深く、夜は浅いところへ上がる。' },
    { kind: 'giantsquid', name: 'ダイオウイカ', sci: 'Architeuthis dux', from: 300, to: 1000, size: 8, density: 0.15, rare: true, speed: 0.3, status: 'preview',
      note: '全長10mを超えることもある巨大なイカ。目の直径は25cmほどで、動物の中で最大級。' },
    { kind: 'viperfish', name: 'ホウライエソ', sci: 'Chauliodus sloani', from: 200, to: 1500, size: 0.25, density: 2.5, glow: true, speed: 0.15, status: 'preview',
      note: '下あごから頭の前へ突き出す長い牙と、背びれの先の光る軟条を持つ深海魚。腹側に並ぶ発光器で、下から見上げたときの自分の影を消す。' },
    { kind: 'fangtooth', name: 'オニキンメ', sci: 'Anoplogaster cornuta', from: 500, to: 2000, size: 0.15, density: 2, speed: 0.1, status: 'preview',
      note: '体の大きさに比べて、魚類で最大級の牙を持つ。下あごの長い牙は、口を閉じると頭の中のくぼみに収まる。' },
    { kind: 'helmetjelly', name: 'クロカムリクラゲ', sci: 'Periphylla periphylla', from: 400, to: 4000, size: 0.2, density: 8, speed: 0.05, glow: true, status: 'preview',
      note: '世界の深海に広く住む、暗い赤色のかぶと形のクラゲ。青く光る。' },
    { kind: 'vampire', name: 'コウモリダコ', sci: 'Vampyroteuthis infernalis', from: 600, to: 1200, size: 0.25, density: 4, glow: true, status: 'preview',
      note: '赤黒い体と大きな青い目を持つ、タコとイカの中間のような生き物。酸素がきわめて少ない層でも生きられる。' },
    { kind: 'tripodfish', name: 'ナガヅエエソ', sci: 'Bathypterois grallator', from: 900, to: 4700, size: 0.3, density: 4, habitat: 'onFloor', speed: 0, status: 'preview',
      note: '長いひれを三脚のように立てて海底から浮き、流れてくる獲物を待つ魚。' },
    { kind: 'dumbo', name: 'ジュウモンジダコ', sci: 'Grimpoteuthis 属', from: 1000, to: 7000, size: 0.35, density: 3, status: 'preview',
      note: '耳のようなひれで泳ぐ、ダンボ・オクトパスとも呼ばれるタコの仲間。最も深い場所に住むタコのひとつ。' },
    { kind: 'anglerfish', name: 'チョウチンアンコウの仲間', sci: 'Melanocetus 属のメス', from: 1000, to: 4000, size: 0.12, density: 2.5, view: 0.4, speed: 0.03, glow: true, status: 'preview',
      note: '頭の先の誘引突起が、共生する発光バクテリアの光で光り、獲物をおびき寄せる。' },
    { kind: 'swimcucumber', name: 'ユメナマコ', sci: 'Enypniastes eximia', from: 1000, to: 6000, size: 0.25, density: 2, habitat: 'nearFloor', glow: true, speed: 0.08, status: 'preview',
      note: '泳ぐナマコ。半透明の赤い体の中に、泥の詰まった腸が透けて見える。前の帆を波打たせて海底の少し上を泳ぎ、刺激されると光る。' },
    { kind: 'rattail', name: 'ソコダラの仲間', sci: 'Coryphaenoides 属', from: 2000, to: 7000, size: 0.45, density: 3, habitat: 'nearFloor', speed: 0.15, status: 'preview',
      note: '大きな頭と、ネズミの尾のように細く伸びる体を持つ。深海の海底で最もふつうに見られる魚のひとつで、水深6,000mを超える海溝の斜面でも見つかる。' },
    { kind: 'brittlestar', name: 'クモヒトデの仲間', sci: 'Ophiuroidea', from: 1000, to: 8500, size: 0.15, density: 12, habitat: 'onFloor', speed: 0.01, status: 'preview',
      note: 'ヒトデの仲間だが、細長い腕をくねらせて意外と素早く動く。深海の海底に一面に広がっていることもある。' },
    { kind: 'hairysnail', name: 'アルビンガイ', sci: 'Alviniconcha hessleri', from: 1400, to: 3700, size: 0.06, view: 0.3, density: 0, habitat: 'onFloor', speed: 0, where: '熱水噴出孔のまわりの岩の上', status: 'preview',
      note: '殻が毛に覆われた巻貝。マリアナトラフの熱水噴出孔にだけ住む。えらの中の細菌が、熱水に含まれる成分から栄養を作る。' },
    { kind: 'ventcrab', name: 'ユノハナガニの仲間', sci: 'Bythograeidae（ユノハナガニ科）', from: 1400, to: 3700, size: 0.06, view: 0.12, density: 0, habitat: 'onFloor', speed: 0.04, where: '熱水噴出孔のまわり', status: 'preview',
      note: '熱水噴出孔のまわりを歩き回るカニ。目はほとんど退化していて、体は白い。' },
    { kind: 'seacucumber', name: 'ナマコの仲間', sci: 'Elasipodida（板足目）', from: 3000, to: 10900, size: 0.2, density: 10, habitat: 'onFloor', speed: 0.02, behavior: 'crawl', status: 'preview',
      note: '超深海の海底で最も多い生き物のひとつ。積もった有機物を食べて暮らす。' },
    { kind: 'xenophyophore', name: 'クセノフィオフォア', sci: 'Xenophyophorea', from: 6000, to: 10900, size: 0.1, density: 15, habitat: 'onFloor', speed: 0, status: 'preview',
      note: '単細胞なのに10cmほどにもなる巨大な原生生物。海底の泥の粒を固めて殻をつくる。' },
    { kind: 'amphipod', name: 'カイコウオオソコエビ', sci: 'Hirondellea gigas', from: 6000, to: 10900, size: 0.04, density: 30, habitat: 'nearFloor', speed: 0.25, behavior: 'bait', status: 'preview',
      note: 'チャレンジャー海淵の底にも群れで暮らすヨコエビの仲間。木の成分を分解する酵素を持つ。' },
    { kind: 'snailfish', name: 'マリアナスネイルフィッシュ', sci: 'Pseudoliparis swirei', from: 6900, to: 8000, size: 0.11, density: 8, habitat: 'nearFloor', behavior: 'hunt', status: 'preview',
      note: 'マリアナ海溝の水深7,000〜8,000mだけに住むクサウオの仲間。うろこのない半透明の体で、胸びれの長い軟条で海底をさぐる。' }
  ],
  // 見どころ: 決まった場所の海底に置く。guests はそのまわりに集まる生き物。status: 'preview' は公開前（生き物と同じ）
  sites: [
    { kind: 'whalefall', name: '鯨骨', lat: 11.76, lon: 142.64, size: 12, guests: [{ kind: 'rattail', n: 6 }, { kind: 'brittlestar', n: 20 }, { kind: 'seacucumber', n: 3 }], status: 'preview' },
    { kind: 'wood', name: '沈んだ木', lat: 11.18, lon: 142.6, size: 2.5, guests: [{ kind: 'amphipod', n: 40 }, { kind: 'snailfish', n: 3 }], status: 'preview' },
    // 実在の熱水噴出孔（マリアナトラフ南部のスネイルサイト。北緯12°57.2′・東経143°37.1′、水深約2,860m）
    { kind: 'vent', name: '熱水噴出孔（スネイルサイト）', lat: 12.9536, lon: 143.6191, size: 20, guests: [{ kind: 'hairysnail', n: 10 }, { kind: 'ventcrab', n: 10 }], status: 'preview' },
    // チャレンジャー海淵の最深部の近く: 観測装置と、海底のプラスチック袋（位置は表現用。袋は 1998 年に水深 10,898m で撮影された記録にもとづく）
    { kind: 'lander', name: '観測装置', lat: 11.3357, lon: 142.2062, size: 2, guests: [{ kind: 'amphipod', n: 50 }], status: 'preview' },
    { kind: 'bag', name: 'プラスチック袋', lat: 11.3334, lon: 142.2078, size: 0.45, status: 'preview' },
    // サンゴの庭（浅瀬の見どころ）: 中はサンゴがびっしり育つ。size: 直径 (m)、style: 'branch'（枝サンゴの林）/ 'table'（テーブルサンゴの段々）/ 'anemone'（イソギンチャク畑）
    { kind: 'garden', style: 'branch', name: 'フィンガーリーフ', lat: 13.443, lon: 144.652, size: 140, clear: 500, status: 'preview' },
    { kind: 'garden', style: 'table', name: 'テーブルサンゴの段々（グアム東岸）', lat: 13.374, lon: 144.778, size: 140, status: 'preview' },
    { kind: 'garden', style: 'anemone', name: 'イソギンチャク畑（リティディアン沖）', lat: 13.642, lon: 144.886, size: 60, status: 'preview' },
    // グアムのダイブポイント（実在のポイント。位置はおおよそ）。fish: そこに群れる魚（reef.js の種類。n: 群れの数、r: 中心からの散らばり (m)、
    // along: 船体に沿って並べる長さ (m)、side: 船体の横へのずれ (m。マイナスは甲板の側)、lift: 海底からの高さ (m)）。guests: まわりにいる 3D の生き物。spire: 海底からそびえる岩の塔（高さ・太さ m）。
    // clear: 濁った湾の中でも澄んでいる半径 (m)
    { kind: 'point', name: 'ピナクル', lat: 13.545, lon: 144.807, size: 40, spire: { h: 18, r: 11 },
      fish: [{ kind: 'barracuda', n: 1, r: 8 }, { kind: 'dogtooth', n: 1, r: 4 }, { kind: 'jack', n: 1, r: 14 }], status: 'preview' },
    { kind: 'point', name: 'マンタポイント', lat: 13.563, lon: 144.810, size: 30, fish: [{ kind: 'manta', n: 1, r: 2 }, { kind: 'cleaner', n: 2, r: 5 }], status: 'preview' },
    { kind: 'point', name: 'ブルーアステール', lat: 13.584, lon: 144.831, size: 40, guests: [{ kind: 'turtle', n: 3 }, { kind: 'hawksbill', n: 2 }],
      fish: [{ kind: 'blacktip', n: 1, r: 5 }, { kind: 'pompano', n: 2, r: 12 }, { kind: 'barracuda', n: 1, r: 18 }], status: 'preview' },
    { kind: 'wreck', name: '東海丸（沈船）', lat: 13.462, lon: 144.654, size: 137, clear: 600, fish: [{ kind: 'sweeper', n: 3, along: 90, side: -15, lift: 3, r: 0 }, { kind: 'jack', n: 1, r: 30 }], status: 'preview' }
  ],
  // 実績。when の条件: enter（海に入る）/ depth（その深さより深く）/ floor（海底に着く）/
  // place（'origin' か features の名前）と km（その地点からの距離）/ site（見どころの kind）と m（そこからの距離）/
  // zukan（図鑑の登録数。'all' ですべて）/ photo（写真を撮った種類の数）。hint は、まだ達成していないときに出す手がかり
  achievements: [
    { id: 'enter', title: 'はじめての入水', note: '海面から海の中へ入った。', when: { enter: true } },
    { id: 'depth-200', title: '薄明の世界へ', note: '中深層（水深200m〜）に入った。ここから先は光合成ができない。', when: { depth: 200 } },
    { id: 'depth-634', title: 'スカイツリーより深く', note: '東京スカイツリーの高さ 634m より深く潜った。', when: { depth: 634 } },
    { id: 'depth-1000', title: '光の届かない海', note: '漸深層（水深1,000m〜）に入った。太陽の光はもう届かない。', when: { depth: 1000 } },
    { id: 'depth-3776', title: '富士山が沈む深さ', note: '富士山の高さ 3,776m より深く潜った。タイタニック号が眠る深さに近い。', when: { depth: 3776 } },
    { id: 'depth-6000', title: '超深海へ', note: '海溝の中にだけある超深海層（水深6,000m〜）に入った。', when: { depth: 6000 } },
    { id: 'depth-6500', title: 'しんかい6500 の先へ', note: '有人潜水調査船「しんかい6500」の最大潜航深度より深く潜った。', when: { depth: 6500 } },
    { id: 'fishless', title: '魚のいない世界', note: '魚がすめる限界とされる水深約8,200mを越えた。これまでに撮影された最も深い魚は、2022年に伊豆・小笠原海溝の8,336mで見つかったクサウオの仲間。ここから先で出会えるのは、ほとんどがヨコエビやナマコなどの無脊椎動物。', when: { depth: 8200 } },
    { id: 'depth-8849', title: 'エベレストが沈む深さ', note: 'エベレストの高さ 8,849m より深く潜った。', when: { depth: 8849 } },
    { id: 'floor', title: 'はじめての海底', note: '海の底に着いた。', when: { floor: true } },
    { id: 'challenger', title: 'チャレンジャー海淵の底', note: '地球でいちばん深い場所の底に着いた。', when: { place: 'origin', km: 3, floor: true } },
    { id: 'sirena', title: 'シレナ海淵の底', note: 'チャレンジャー海淵の東にある、マリアナ海溝で2番目に深い海淵の底に着いた。', when: { place: 'シレナ海淵', km: 3, floor: true } },
    { id: 'guam', title: 'グアム島の海', note: 'グアム島のそばの海に潜った。', when: { place: 'グアム島', km: 20 } },
    { id: 'vent', title: '熱水噴出孔を見つけた', hint: 'グアム島から西南西へおよそ140km、マリアナトラフの海底（水深約2,900m）に、本物の熱水噴出孔がある。',
      note: '熱水噴出孔「スネイルサイト」を見つけた。地下で熱せられた海水が噴き出し、その成分をもとに生きる生き物が集まる。', when: { site: 'vent', m: 40 } },
    { id: 'lander', title: '海底の観測装置', hint: 'チャレンジャー海淵の最深部（潜航地点）から北へ300mほどの海底に、調査のための装置が置かれているらしい。',
      note: '餌とカメラを付けて海底に沈め、集まってくる生き物を撮影する観測装置（ランダー）を見つけた。超深海の生き物の多くは、こうした装置で調べられてきた。', when: { site: 'lander', m: 15 } },
    { id: 'bag', title: '海の底のプラスチック', hint: 'チャレンジャー海淵の最深部（潜航地点）から東へ200mほどの海底に、人が出したものが沈んでいるらしい。',
      note: '1998年、水深10,898mの海底で、半分泥に埋もれたプラスチック袋が撮影されていた（JAMSTEC 深海デブリデータベース）。人の出したごみは、地球でいちばん深い場所にも届いている。', when: { site: 'bag', m: 8 } },
    { id: 'whalefall', title: '鯨骨を見つけた', hint: 'チャレンジャー海淵（潜航地点）から北東へおよそ65km、水深約4,100mの海底に、クジラの骨が沈んでいるらしい。',
      note: '海底に沈んだクジラの骨を見つけた。骨は何十年もかけて、たくさんの生き物の住みかになる（鯨骨生物群集）。', when: { site: 'whalefall', m: 30 } },
    { id: 'wood', title: '沈んだ木を見つけた', hint: 'チャレンジャー海淵（潜航地点）から東南東へおよそ45km、水深約8,100mの海底に、流木が沈んでいるらしい。',
      note: '超深海に沈んだ流木を見つけた。カイコウオオソコエビは、木の成分を分解する酵素を持っている。', when: { site: 'wood', m: 20 } },
    { id: 'photo-5', title: '深海カメラマン', note: '5種類の生き物を撮影して、図鑑に写真を貼った。', when: { photo: 5 } },
    { id: 'photo-all', title: '深海写真集', note: 'この海の生き物すべての写真を撮った。', when: { photo: 'all' } },
    { id: 'zukan-5', title: '深海の観察者', note: '図鑑に5種類の生き物を登録した。', when: { zukan: 5 } },
    { id: 'zukan-all', title: '深海図鑑 完成', note: 'この海の生き物をすべて図鑑に登録した。', when: { zukan: 'all' } }
  ],
  zones: [
    { from: 0, to: 200, name: '表層', en: 'Epipelagic', short: '表層', color: '#2f93b3',
      note: '太陽光が届き、植物プランクトンが光合成できる層。海の生き物の多くがここに集まる。' },
    { from: 200, to: 1000, name: '中深層', en: 'Mesopelagic', short: '中深層', color: '#15557a',
      note: 'わずかな青い光だけが届く薄明の世界。光合成はできない。' },
    { from: 1000, to: 4000, name: '漸深層', en: 'Bathypelagic', short: '漸深層', color: '#0a2a45',
      note: '太陽光はまったく届かない。見える光はすべて生き物が自ら出す光（生物発光）。' },
    { from: 4000, to: 6000, name: '深海層', en: 'Abyssopelagic', short: '深海層', color: '#071a2e',
      note: '水温は1〜2℃。海洋の海底の大部分はこの深さの平原になっている。' },
    { from: 6000, to: 11000, name: '超深海層', en: 'Hadal zone', short: '超深海', color: '#0a0f24',
      note: '海溝の中だけに存在する層。名前はギリシャ神話の冥界ハデスに由来する。' }
  ],
  life: [
    { name: 'サンゴ礁', from: 0, to: 50, note: '体内の褐虫藻が光合成するため、光の届く浅い海にしかできない。グアム島の周りにも広がる。' },
    { name: 'アオウミガメ', from: 0, to: 100, note: '海草や藻を食べる。グアム周辺のサンゴ礁でよく見られる。' },
    { name: 'ハダカイワシ', from: 200, to: 1000, note: '昼は深く、夜は表層へ上がる日周鉛直移動をする。世界で最も数の多い魚の一つ。' },
    { name: 'ダイオウイカ', from: 300, to: 1000, note: '2012年、小笠原諸島沖の深海で生きた姿が初めて撮影された。' },
    { name: 'マッコウクジラ', from: 0, to: 2000, note: 'イカを求めて1,000mより深くまで潜る、息を止めて潜る哺乳類のチャンピオン。' },
    { name: 'コウモリダコ', from: 600, to: 1200, note: '酸素がきわめて少ない層でも生きられる。危険を感じると光る粘液を吐く。' },
    { name: 'チョウチンアンコウの仲間', from: 1000, to: 4000, note: '頭の先の発光する突起で獲物をおびき寄せる。' },
    { name: 'ナガヅエエソ', from: 900, to: 4700, note: '長いひれを三脚のように立てて海底に立ち、流れてくる獲物を待つ。' },
    { name: 'ジュウモンジダコ', from: 1000, to: 7000, note: '耳のようなひれで泳ぐ。最も深い場所に住むタコの仲間。' },
    { name: 'ナマコの仲間', from: 3000, to: 10900, note: '海溝の底では最も多い生き物の一つ。積もった有機物を食べて暮らす。' },
    { name: 'マリアナスネイルフィッシュ', from: 6900, to: 8000, note: '2014年に見つかったクサウオの仲間。魚は約8,200mより深くでは体を保てないと考えられている。' },
    { name: 'カイコウオオソコエビ', from: 6000, to: 10900, note: 'チャレンジャー海淵の底にも群れで暮らす端脚類。沈んできた木を分解する酵素を持つ。' },
    { name: 'クセノフィオフォア', from: 6000, to: 10900, note: '単細胞なのに10cmほどにもなる巨大な原生生物。超深海の泥の上に広がる。' }
  ],
  marks: [
    { d: 634, label: '東京スカイツリー 634m' },
    { d: 3776, label: '富士山 3,776m／タイタニック号 約3,800m' },
    { d: 6500, label: 'しんかい6500 の最大潜航深度' },
    { d: 8200, label: '魚がすめる限界 約8,200m', note: '魚がすめる限界とされる水深約8,200mを越えた。魚は細胞を水圧から守る物質（TMAO）をこれ以上ためられないと考えられている。これまでに撮影された最も深い魚は8,336m（2022年、伊豆・小笠原海溝のクサウオの仲間）で、限界は約8,200〜8,400mとみられる。' },
    { d: 8849, label: 'エベレスト 8,849m' }
  ],
  dives: [
    '1960年 トリエステ号（ピカール、ウォルシュ）が人類初到達',
    '1995年 無人探査機「かいこう」（JAMSTEC）が到達',
    '2012年 ジェームズ・キャメロンが単独潜航',
    '2019年以降 リミティング・ファクター号が繰り返し潜航'
  ]
};
