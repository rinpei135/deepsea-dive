// 計器・ルーラー・ボタン・ダイブマップ・効果音（状態は nav.js と共有）
(() => {
const T = window.__TRENCH, O = window.SEA;
const { CD, state } = T;
const $ = id => document.getElementById(id);
const nf = (v, d = 0) => v.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: d });
const RULER_MAX = 11000;
const NAV = () => window.__NAV;

const S = window.__DIVE = {
  mode: null, x: 0, z: 0, depth: 0, dir: 0, goal: null, speed: 10, yaw: 0, pitch: -0.2,   // speed: 潜航艇の速さ (m/秒)。大きく深さを変えるときはホイールやルーラー、場所はダイブマップで
  sonar: true, lamp: true, sound: false, bgm: false, vol: 0.3, surfaceOn: true, intro: null, keys: {},
  // 画質: 'low' | 'mid' | 'high'。前に選んだものを覚えておく。初めてなら、スマホなどは「中」、それ以外は「高」
  quality: (() => { try { const q = localStorage.getItem('deepsea-quality'); if (q) return q; } catch (_) {} return matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600 ? 'mid' : 'high'; })()
};
// 音量は閲覧者ごとにこのブラウザへ記憶
try { const v = localStorage.getItem('deepsea-vol'); if (v !== null) { S.vol = +v; $('vol').value = Math.round(S.vol * 100); } } catch (_) {}
$('vol').addEventListener('input', e => { S.vol = e.target.value / 100; AUD()?.set('vol', S.vol); try { localStorage.setItem('deepsea-vol', S.vol); } catch (_) {} });
$('vol').addEventListener('change', () => { if (S.sound) pingSound(); });
const AUD = () => window.__AUDIO;
// 最初に音を再生するか確認する（ブラウザの決まりで、音はユーザー操作のあとでないと鳴らせない）
function setSound(bgm, se) {
  S.bgm = bgm; S.sound = se;
  $('bgm').setAttribute('aria-pressed', bgm); $('sound').setAttribute('aria-pressed', se);
  const a = AUD(); if (!a) return;
  if ((bgm || se) && !a.on) a.start();
  a.set('vol', S.vol); a.set('bgm', bgm); a.set('se', se);
}
$('soundYes').onclick = () => { $('soundAsk').hidden = true; setSound(true, true); };
$('soundNo').onclick = () => { $('soundAsk').hidden = true; setSound(false, false); };
$('bgm').onclick = () => setSound(!S.bgm, S.sound);

// ---------- ラベル ----------
const pins = [];
function pin(text, x, z, cls, yFn) {
  const el = document.createElement('div'); el.className = 'pin ' + (cls || ''); el.textContent = text;
  $('labels').appendChild(el);
  const p = { el, x, z, yFn }; pins.push(p); return p;
}
const ll = (lat, lon) => [T.toX(lon), T.toZ(lat)];
pin(O.origin.name, 0, 0, '', () => -CD.depth / 1000 * state.ex);
O.features.forEach(f => {
  if (f.deepest) {                                   // 範囲内の最深点に置く
    const d = T.deepestIn(...f.deepest);
    pin(f.name, ...ll(d.lat, d.lon), f.area ? 'area' : '', () => -d.depth / 1000 * state.ex);
  } else if (f.axisLon != null) {                    // その経度で一番深い所（海溝の軸）に置く
    const B = window.BATHY; let aLat = B.lat1, aMin = 0;
    for (let lat = B.lat1; lat <= B.lat0; lat += B.step) { const e = T.elevAt(lat, f.axisLon); if (e < aMin) { aMin = e; aLat = lat; } }
    pin(f.name, ...ll(aLat, f.axisLon), f.area ? 'area' : '', () => aMin / 1000 * state.ex);
  } else {
    pin(f.name, ...ll(f.lat, f.lon), f.area ? 'area' : '', () => f.y || 0);
  }
});
const divePin = pin('潜航地点', 0, 0, '', () => 0.2);
$('brand').textContent = `深海ダイブ · ${O.name} · ${O.origin.name} 北緯${CD.lat.toFixed(2)}° 東経${CD.lon.toFixed(2)}°`;

// ---------- ルーラー ----------
const ruler = $('ruler');
const pct = d => `${Math.max(0, Math.min(RULER_MAX, d)) / RULER_MAX * 100}%`;
let html = '';
O.zones.forEach(z => {
  html += `<div class="band" style="top:${pct(z.from)};height:${pct(Math.min(z.to, RULER_MAX) - z.from)};background:${z.color}"></div>`;
  html += `<div class="bandLbl" style="top:${pct(z.from)}">${z.short}</div>`;
});
for (let d = 1000; d < RULER_MAX; d += 1000) html += `<div class="tick" style="top:${pct(d)}"><span>${d / 1000}km</span></div>`;
O.marks.forEach(m => html += `<div class="mark" style="top:${pct(m.d)}"><span>${m.label}</span></div>`);
html += `<div id="floor"></div><div id="now"><span></span></div>`;
ruler.innerHTML = html;
const rulerDepth = e => { const r = ruler.getBoundingClientRect(); return (e.clientY - r.top) / r.height * RULER_MAX; };
let rulerDrag = false;
ruler.addEventListener('pointerdown', e => {
  const d = rulerDepth(e);
  if (S.mode === 'over') return NAV().setMode('dive', d);
  if (S.intro) { S.intro.then = d; return; }
  rulerDrag = true; ruler.setPointerCapture(e.pointerId);
  S.dir = 0; S.goal = null; S.depth = NAV().clampDepth(d); syncGo();
});
ruler.addEventListener('pointermove', e => { if (rulerDrag) S.depth = NAV().clampDepth(rulerDepth(e)); });
ruler.addEventListener('pointerup', () => rulerDrag = false);

// ---------- ボタン ----------
function syncGo() {
  $('go').textContent = S.dir > 0 ? '一時停止 ❚❚' : '潜航開始 ▼';
  $('up').textContent = S.dir < 0 ? '一時停止 ❚❚' : '浮上 ▲';
}
function syncMode() {
  const dive = S.mode === 'dive';
  $('mOver').setAttribute('aria-pressed', !dive);
  $('mDive').setAttribute('aria-pressed', dive);
  $('pad').hidden = $('lamp').hidden = !dive;
  if ($('shot')) $('shot').hidden = !dive;                            // 撮影ボタンは、生き物がいる海だけ（zukan.js が外す）
  $('panel').classList.toggle('dive', dive);
  $('hint').textContent = dive
    ? '移動: W A S D（毎秒10m） · 上昇 E/Space · 下降 Q/C · ホイールで深さを大きく変える · L でライト · P で撮影 · ドラッグで見回す'
    : 'ドラッグで回転 · ホイールで拡大 · 右ドラッグで移動 · ルーラーをクリックでその深さへ潜航';
  syncGo();
}
// スマホ表示の開閉（計器の詳細、設定ボタン群）
$('panelToggle').onclick = () => {
  const open = $('panel').classList.toggle('open');
  $('panelToggle').setAttribute('aria-expanded', open); $('panelToggle').textContent = open ? '閉じる ▴' : '詳細 ▾';
};
$('moreBtn').onclick = () => {
  const open = $('controls').classList.toggle('open');
  document.body.classList.toggle('more-open', open);
  $('moreBtn').setAttribute('aria-expanded', open); $('moreBtn').textContent = open ? '閉じる ▾' : '設定 ▴';
};
$('mOver').onclick = () => NAV().setMode('over');
$('mDive').onclick = () => NAV().setMode('dive');
$('go').onclick = () => {
  if (S.mode !== 'dive') return NAV().setMode('dive', 'go');
  if (S.intro) { S.intro.then = 'go'; return; }
  S.goal = null; S.dir = S.dir > 0 ? 0 : 1; syncGo();
};
$('up').onclick = () => {
  if (S.mode !== 'dive') return NAV().setMode('dive');
  if (S.intro) return;
  S.goal = null; S.dir = S.dir < 0 ? 0 : -1; syncGo();
};
const toggleBtn = (id, key) => $(id).onclick = e => { S[key] = !S[key]; e.currentTarget.setAttribute('aria-pressed', S[key]); };
toggleBtn('surf', 'surfaceOn');
toggleBtn('sonar', 'sonar');
$('lamp').onclick = () => setLamp(!S.lamp);
// 潜水艇のライト。消すと深海は真っ暗になり、自分で光る生き物だけが見える（L キーでも切り替え）
function setLamp(on) {
  S.lamp = on; $('lamp').setAttribute('aria-pressed', on);
  if (!on && S.mode === 'dive' && S.depth > 150) toast('ライトを消しました。光る生き物を探してみましょう。動くと、まわりのプランクトンも光ります。');
}
addEventListener('keydown', e => { if (e.code === 'KeyL' && S.mode === 'dive' && !e.target.closest?.('input, textarea')) setLamp(!S.lamp); });
$('sound').onclick = () => { setSound(S.bgm, !S.sound); if (S.sound) pingSound(); };
$('ping').onclick = () => NAV().ping(true);
const EXS = [1, 2, 4, 8];
// ---------- 画質 ----------
// 低: 描画の細かさ 1 倍・後処理なし・衛星写真と島の近くの地形を粗く / 中: 1.5 倍まで・後処理あり / 高: 2 倍まで・後処理と縁のなめらかさ（MSAA）
const QL = { low: '低', mid: '中', high: '高' };
// 描画の細かさの上限（画質で決まる）と、動きが重いときに自動で下げる倍率（0.5〜1）
const prMax = () => ({ low: 1, mid: Math.min(devicePixelRatio, 1.5), high: Math.min(devicePixelRatio, 2) }[S.quality] || 1);
let autoScale = 1;
function setPR() {
  const R = T.renderer, pr = Math.max(0.6, prMax() * autoScale);
  if (Math.abs(R.getPixelRatio() - pr) < 0.01) return;
  R.setPixelRatio(pr); R.setSize(innerWidth, innerHeight);
  window.__POST && window.__POST.apply();
}
function applyQuality() {
  autoScale = 1; T.renderer.setPixelRatio(0); setPR();
  window.__POST && window.__POST.apply();
  $('qual').textContent = `画質 ${QL[S.quality]}`;
}
// 自動調整: 2 秒ごとに、1 フレームの間隔の中央値を見る。目標（約 55fps）より遅ければ細かさを 15% 下げ、
// 十分に速ければ 10% 戻す。画面を切り替えた直後や、タブが裏にあるあいだは数えない
const frameDts = []; let autoNext = 0;
function autoRes(dt, now) {
  if (dt <= 0 || dt > 0.25) return;
  frameDts.push(dt);
  if (now < autoNext) return;
  autoNext = now + 2;
  if (frameDts.length < 30) { frameDts.length = 0; return; }
  frameDts.sort((a, b) => a - b); const med = frameDts[frameDts.length >> 1]; frameDts.length = 0;
  const before = autoScale;
  if (med > 1 / 50) autoScale = Math.max(0.5, autoScale * 0.85);
  else if (med < 1 / 58 && autoScale < 1) autoScale = Math.min(1, autoScale * 1.1);
  if (autoScale !== before) setPR();
}
$('qual').onclick = () => {
  S.quality = { high: 'mid', mid: 'low', low: 'high' }[S.quality] || 'high';
  try { localStorage.setItem('deepsea-quality', S.quality); } catch (_) {}
  applyQuality();
  toast(`画質を「${QL[S.quality]}」にしました。島の地形と衛星写真の細かさは、次に開いたときから変わります。`);
};
applyQuality();
$('exag').onclick = e => {
  const ex = EXS[(EXS.indexOf(state.ex) + 1) % EXS.length];
  T.setExaggeration(ex);
  e.currentTarget.textContent = `高さ ×${ex}`;
  toast(ex === 1 ? '高さ ×1：実際の縦横比です。海溝は意外となだらかに見えます。' : `高さを${ex}倍に強調しています。`);
};
// 画面上の移動パッド（押している間だけ動く）
document.querySelectorAll('#pad [data-k]').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); S.keys[k] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = () => { S.keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, off));
});

// ---------- 効果音（ソナーのピン）: 実際の音は audio.js で鳴らす ----------
function pingSound(echo) { AUD()?.ping(echo); }

// ---------- トースト・入水効果 ----------
let toastTimer, splashTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}
function splash() {
  const el = $('splash'); el.classList.add('show');
  clearTimeout(splashTimer); splashTimer = setTimeout(() => el.classList.remove('show'), 250);
}

// ---------- 計器 ----------
const TEMP = [[0, 29], [50, 28.5], [150, 25], [300, 15], [500, 9], [1000, 4.5], [2000, 2.3], [4000, 1.5], [6000, 1.6], [8000, 2.0], [11000, 2.5]];
// 海水中の音速 (m/秒)。Mackenzie (1981) の式に、水温（概算）・塩分 34.7・深さを入れる。
// 水温が下がる水深 1,000m 付近で最も遅く（約 1,485）、そこから深いほど水圧で速くなる（海溝の底で約 1,655）
function soundSpeed(d) {
  const T = temp(Math.max(0, d)), S = 34.7, D = Math.max(0, d);
  return 1448.96 + 4.591 * T - 0.05304 * T * T + 2.374e-4 * T ** 3 + 1.34 * (S - 35) + 0.0163 * D + 1.675e-7 * D * D - 0.01025 * T * (S - 35) - 7.139e-13 * T * D ** 3;
}
function temp(d) {
  for (let i = 1; i < TEMP.length; i++) if (d <= TEMP[i][0]) {
    const [a, ta] = TEMP[i - 1], [b, tb] = TEMP[i];
    return ta + (tb - ta) * (d - a) / (b - a);
  }
  return 2.5;
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function light(d) {
  const p = 100 * Math.exp(-0.035 * d);
  if (p >= 1) return `海面の ${nf(p)}%`;
  if (p >= 0.01) return `海面の ${nf(p, 2)}%`;
  if (d >= 1000) return '太陽光は届かない';
  const k = Math.ceil(-Math.log10(p / 100));
  return `海面の 10⁻${String(k).split('').map(c => SUP[c]).join('')} 以下`;
}
const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
function heading(yaw) { const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360; return `${DIRS[Math.round(deg / 45) % 8]} ${nf(deg)}°`; }
const zoneOf = d => O.zones.find(z => d < z.to) || O.zones[O.zones.length - 1];

let infoKey = '';
function renderPanel(depth, floorD) {
  const d = Math.max(0, depth);
  // 高度計: 海底から 60m 以内では、画面の下に海底までの距離を大きく出す（3m 以内は注意の色）
  const alt = floorD - depth, showAlt = S.mode === 'dive' && !S.intro && depth > 0 && alt < 60;
  $('alt').hidden = !showAlt;
  if (showAlt) { $('alt').lastChild.textContent = `${alt < 10 ? alt.toFixed(1) : nf(alt)} m`; $('alt').classList.toggle('warn', alt < 3); }
  $('depth').innerHTML = depth < 0 ? `${nf(-depth)}<small>m 海面上</small>` : `${nf(d)}<small>m</small>`;
  const atm = 1 + d / 10, g = T.fromXZ(S.x, S.z);
  const rows = [['水圧', `約 ${nf(atm)} 気圧`], ['水温（概算）', `${nf(temp(d), 1)} ℃`], ['太陽光', light(d)],
    ['音速', `約 ${nf(soundSpeed(d))} m/秒`], ['海底まで', `${nf(Math.max(0, floorD - d))} m`], ['位置', `北緯 ${nf(g.lat, 3)}° 東経 ${nf(g.lon, 3)}°`]];
  if (S.mode === 'dive') rows.push(['向き', heading(S.yaw)]);
  $('gauges').innerHTML = rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('');
  const z = zoneOf(d), atCD = Math.hypot(S.x, S.z) < 3 && d >= floorD - 40;
  const here = O.life.filter(l => d >= l.from && d <= l.to);
  const key = z.name + here.map(l => l.name).join() + atCD;
  if (key === infoKey) return;
  infoKey = key;
  $('zone').innerHTML = `<h2>${z.name}<small>${z.en} · ${nf(z.from)}–${nf(Math.min(z.to, CD.depth))}m</small></h2><p>${z.note}</p>`;
  const list = here.length ? `<ul>${here.map(l => `<li><b>${l.name}</b><span>${l.note}</span></li>`).join('')}</ul>` : '<div class="none">この深さの代表的な生き物は登録されていません。</div>';
  const record = atCD && O.dives ? `<div class="sub">${O.origin.recordTitle}</div><ul>${O.dives.map(t => `<li><span>${t}</span></li>`).join('')}</ul>` : '';
  $('life').innerHTML = `<div class="sub">この深さで出会える生き物</div>${list}${record}`;
}
const NARROW = matchMedia('(max-width: 760px), (max-height: 520px)');
function renderRuler(depth, floorD, dive) {
  const n = $('now');
  n.style.top = pct(depth); n.style.display = dive ? '' : 'none';
  // スマホ（細いルーラー）では km 表記にして幅に収める
  n.firstChild.textContent = depth < 0 ? '海面上' : NARROW.matches ? `${(depth / 1000).toFixed(1)}km` : `${nf(depth)} m`;
  $('floor').style.top = pct(floorD);
}

// ---------- ダイブマップ（タブで 3D の景色と切り替える。好きな地点を選んで、そこへ潜る） ----------
const STOPS = [[0, [150, 225, 215]], [400, [80, 180, 200]], [2000, [48, 128, 168]], [4000, [36, 84, 140]], [6000, [30, 56, 112]], [8500, [34, 32, 84]], [11000, [26, 12, 50]]];
function depthRGB(e) {                           // 標高 e (m) → 地図の色
  if (e >= 0) { const k = Math.min(1, e / 300); return [96 + 60 * k, 128 + 10 * k, 72 + 30 * k]; }
  const d = -e; if (d < 2) return [214, 226, 196];                                  // 波打ち際・礁原
  let j = 1; while (j < STOPS.length - 1 && d > STOPS[j][0]) j++;
  const t = Math.min(1, (d - STOPS[j - 1][0]) / (STOPS[j][0] - STOPS[j - 1][0]));
  const c = STOPS[j - 1][1].map((v, k) => v + (STOPS[j][1][k] - v) * t);
  if (d < 40) { const s = 1 - d / 40; return [c[0] + (178 - c[0]) * s * 0.5, c[1] + (238 - c[1]) * s * 0.5, c[2] + (226 - c[2]) * s * 0.5]; }   // サンゴ礁の浅瀬は明るい水色
  return c;
}
function gridImage(D) {                          // 格子（北→南, 西→東）を、陰影を付けた画像にする
  const c = document.createElement('canvas'); c.width = D.nlon; c.height = D.nlat;
  const x = c.getContext('2d'), img = x.createImageData(D.nlon, D.nlat), e = D.e;
  for (let r = 0; r < D.nlat; r++) for (let q = 0; q < D.nlon; q++) {
    const i = r * D.nlon + q, col = depthRGB(e[i]);
    const dzx = e[i] - e[r * D.nlon + Math.max(0, q - 1)], dzy = e[i] - e[Math.max(0, r - 1) * D.nlon + q];
    const sh = Math.max(0.65, Math.min(1.25, 1 + (dzx + dzy) * (D.step ? BB.step / D.step : 1) / (e[i] >= 0 ? 400 : 900)));   // 北西から光を当てた陰影（格子の細かさで傾きをそろえる）
    img.data[i * 4] = col[0] * sh; img.data[i * 4 + 1] = col[1] * sh; img.data[i * 4 + 2] = col[2] * sh; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0); return c;
}
const BB = window.BATHY;
const baseImg = gridImage({ e: T.elev, nlat: T.NZ, nlon: T.NX });
const box = D => ({ x0: T.toX(D.lon0 - D.step / 2), x1: T.toX(D.lon0 + (D.nlon - 0.5) * D.step), z0: T.toZ(D.lat0 + D.step / 2), z1: T.toZ(D.lat0 - (D.nlat - 0.5) * D.step) });
const baseBox = box({ lon0: BB.lon0, lat0: BB.lat0, step: BB.step, nlon: T.NX, nlat: T.NZ });
// 細かい背景画像（config の map。地図を初めて開いたときに読み込む）。読み込むまでは粗い格子の画像を使う
const hiMap = O.map ? { img: null, b: { x0: T.toX(O.map.box[2]), x1: T.toX(O.map.box[3]), z0: T.toZ(O.map.box[1]), z1: T.toZ(O.map.box[0]) } } : null;
function loadHiMap() {
  if (!hiMap || hiMap.loading) return; hiMap.loading = true;
  const im = new Image(); im.onload = () => { hiMap.img = im; drawMap(); }; im.src = O.map.src;
}
// 島の衛星写真は、陸と浅い礁だけを切り抜いて重ねる（写真の外洋は灰色や暗い色で、地図の海の色と合わないため）
let satMaskImg = null;
function satMasked(co) {
  if (satMaskImg) return satMaskImg;
  if (!co.satImg || !T.land.at) return null;
  const src = co.satImg, W = src.width, H = src.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0);
  // 切り抜き: 陸地、または水深 15m より浅い所（40m で消える）。小さめの格子で決めて、なめらかに引き伸ばす
  const mw = Math.round(W / 4), mh = Math.round(H / 4), m = document.createElement('canvas'); m.width = mw; m.height = mh;
  const mx = m.getContext('2d'), md = mx.createImageData(mw, mh), b = co.box;
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const wx = b.x0 + (i + 0.5) / mw * (b.x1 - b.x0), wz = b.z0 + (j + 0.5) / mh * (b.z1 - b.z0), f = T.floorDepth(wx, wz);
    md.data[(j * mw + i) * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (40 - f) / 25)));
  }
  mx.putImageData(md, 0, 0);
  x.globalCompositeOperation = 'destination-in'; x.imageSmoothingEnabled = true; x.drawImage(m, 0, 0, W, H);
  return (satMaskImg = c);
}
// 島のまわり（陸地を含む細かい地形）は、拡大したときのために、さらに細かい画像を重ねる
const detailImgs = (T.DETAIL || []).filter(D => D.name && D.name.includes('島')).map(D => ({ img: gridImage(D), b: box(D) }));
const dmap = $('dmap'), dctx = dmap.getContext('2d');
const view = { cx: 0, cz: 0, k: 1 };            // 画面の中心（km）と、1km あたりの画素数
let sel = null, mapOpen = false;
function fitAll() {
  const r = T.rect, w = dmap.clientWidth, h = dmap.clientHeight;
  view.cx = (r.x0 + r.x1) / 2; view.cz = (r.z0 + r.z1) / 2; view.k = Math.min(w / (r.x1 - r.x0), h / (r.z1 - r.z0)) * 0.96;
}
const toScr = (x, z) => [(x - view.cx) * view.k + dmap.clientWidth / 2, (z - view.cz) * view.k + dmap.clientHeight / 2];
const toWorld = (sx, sz) => [(sx - dmap.clientWidth / 2) / view.k + view.cx, (sz - dmap.clientHeight / 2) / view.k + view.cz];
function drawMap() {
  if (!mapOpen) return;
  const dpr = Math.min(2, devicePixelRatio || 1), W = dmap.clientWidth, H = dmap.clientHeight;
  if (dmap.width !== Math.round(W * dpr) || dmap.height !== Math.round(H * dpr)) { dmap.width = Math.round(W * dpr); dmap.height = Math.round(H * dpr); }
  const c = dctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#061420'; c.fillRect(0, 0, W, H);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  const img = (im, b) => { const [ax, az] = toScr(b.x0, b.z0), [bx, bz] = toScr(b.x1, b.z1); c.drawImage(im, ax, az, bx - ax, bz - az); };
  if (hiMap && hiMap.img) img(hiMap.img, hiMap.b); else img(baseImg, baseBox);
  if (view.k > 4 && !(hiMap && hiMap.img)) detailImgs.forEach(d => img(d.img, d.b));   // 細かい背景画像がまだのときだけ、島の格子の画像で補う（両方重ねると境目が見える）
  const co = window.__COAST;                                            // さらに拡大したら、島の衛星写真（読み込みも、このとき始める）
  if (co && co.box && view.k > 6) { const m = satMasked(co); if (m) img(m, co.box); else co.load(); }
  // 地名・見どころ
  c.font = '12px "Zen Kaku Gothic New", sans-serif'; c.textBaseline = 'middle';
  // 点はどの縮尺でも描く。文字は、先に描いた文字と重なるときだけ省く（縮小したとき、近い地点の名前が重ならないように）
  const used = [];
  const label = (x, z, text, color, dot = true) => {
    const [sx, sz] = toScr(x, z); if (sx < -80 || sx > W + 80 || sz < -20 || sz > H + 20) return;
    if (dot) { c.lineWidth = 2; c.strokeStyle = 'rgba(0,10,18,.85)'; c.fillStyle = color; c.beginPath(); c.arc(sx, sz, 3.5, 0, 7); c.stroke(); c.fill(); }
    const w = c.measureText(text).width, r = [sx + 5, sz - 8, sx + 9 + w, sz + 8];
    if (used.some(u => r[0] < u[2] && r[2] > u[0] && r[1] < u[3] && r[3] > u[1])) return;
    used.push(r);
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,10,18,.85)'; c.strokeText(text, sx + 7, sz); c.fillStyle = color; c.fillText(text, sx + 7, sz);
  };
  label(0, 0, O.origin.name, '#8ee6f2');
  mapSites().forEach(s => label(s.x, s.z, s.name, '#f3d6a0'));          // 見どころ（スポット）を地名より先に（重なったら地名の方を省く）
  O.features.forEach(f => { if (f.lat != null && f.lon != null && !f.area) label(T.toX(f.lon), T.toZ(f.lat), f.name, '#e9f3f5'); });
  // 今いる場所と向き
  const [px, pz] = toScr(S.x, S.z);
  c.fillStyle = '#8ee6f2'; c.beginPath(); c.arc(px, pz, 5, 0, 7); c.fill();
  c.strokeStyle = '#8ee6f2'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, pz); c.lineTo(px - Math.sin(S.yaw) * 16, pz - Math.cos(S.yaw) * 16); c.stroke();
  // 選んだ地点
  if (sel) {
    const [sx, sz] = toScr(sel.x, sel.z);
    c.strokeStyle = '#f3d6a0'; c.lineWidth = 2; c.beginPath(); c.arc(sx, sz, 9, 0, 7); c.moveTo(sx - 15, sz); c.lineTo(sx - 5, sz); c.moveTo(sx + 5, sz); c.lineTo(sx + 15, sz);
    c.moveTo(sx, sz - 15); c.lineTo(sx, sz - 5); c.moveTo(sx, sz + 5); c.lineTo(sx, sz + 15); c.stroke();
  }
  // 縮尺
  const km = [1, 2, 5, 10, 20, 50, 100, 200].find(v => v * view.k > 70) || 200, L = km * view.k;
  c.fillStyle = 'rgba(217,238,242,.85)'; c.fillRect(16, H - 22, L, 2); c.fillText(`${km} km`, 16 + L + 6, H - 21);
}
// 見どころ（スポット）の位置 (km)
const mapSites = () => ((window.__LIFE && window.__LIFE.sites) || []).map(s => ({ x: s.x / 1000, z: s.z / 1000, name: s.name }));
function selectAt(x, z) {
  // スポットの近く（画面で 14 画素以内）をクリックしたら、ちょうどその地点を選ぶ
  let best = null, bd = 14 / view.k;
  mapSites().forEach(s => { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } });
  if (best) { x = best.x; z = best.z; }
  const r = T.rect; x = Math.max(r.x0 + 2, Math.min(r.x1 - 2, x)); z = Math.max(r.z0 + 2, Math.min(r.z1 - 2, z));
  const f = T.floorDepth(x, z), g = T.fromXZ(x, z);
  sel = { x, z };
  $('dmapWhere').textContent = `${best ? best.name + '　' : ''}北緯 ${nf(g.lat, 3)}° 東経 ${nf(g.lon, 3)}°`;
  $('dmapDepth').textContent = f > 0 ? `水深 約${nf(f)} m` : `陸地（標高 約${nf(-f)} m）· いちばん近い海から潜ります`;
  $('dmapGo').disabled = false;
}
function openMap(open) {
  mapOpen = open;
  $('divemap').hidden = !open;
  $('tab3d').setAttribute('aria-selected', !open); $('tabMap').setAttribute('aria-selected', open);
  if (open) { loadHiMap(); if (!view.set) { fitAll(); view.set = true; } sel = null; $('dmapWhere').textContent = '地図をクリック（タップ）して、潜る地点を選んでください'; $('dmapDepth').textContent = ''; $('dmapGo').disabled = true; drawMap(); }
}
$('tab3d').onclick = () => openMap(false);
$('tabMap').onclick = () => openMap(true);
addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.target.closest?.('input, textarea')) openMap(!mapOpen); });
$('dmapGo').onclick = () => {
  if (!sel) return;
  if (NAV().teleport(sel.x, sel.z) === false) return;
  if (S.mode !== 'dive') NAV().setMode('dive');
  openMap(false);
};
$('dmapFit').onclick = () => { fitAll(); drawMap(); };
const zoomAt = (f, sx = dmap.clientWidth / 2, sz = dmap.clientHeight / 2) => {
  const [wx, wz] = toWorld(sx, sz);
  view.k = Math.max(0.8, Math.min(400, view.k * f));
  view.cx = wx - (sx - dmap.clientWidth / 2) / view.k; view.cz = wz - (sz - dmap.clientHeight / 2) / view.k; drawMap();
};
$('dmapIn').onclick = () => zoomAt(1.6); $('dmapOut').onclick = () => zoomAt(1 / 1.6);
dmap.addEventListener('wheel', e => { e.preventDefault(); const r = dmap.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
// ドラッグで動かす・2 本指で拡大縮小・動かさずに離したらその地点を選ぶ
const ptrs = new Map(); let moved = 0, pinch = 0;
dmap.addEventListener('pointerdown', e => { dmap.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
dmap.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [ox, oy] = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = dmap.getBoundingClientRect();
    if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch = d; moved = 99; return;
  }
  moved += Math.abs(e.clientX - ox) + Math.abs(e.clientY - oy);
  view.cx -= (e.clientX - ox) / view.k; view.cz -= (e.clientY - oy) / view.k; drawMap();
});
dmap.addEventListener('pointerup', e => {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0;
  if (moved < 6 && ptrs.size === 0) { const r = dmap.getBoundingClientRect(), [x, z] = toWorld(e.clientX - r.left, e.clientY - r.top); selectAt(x, z); drawMap(); }
});
dmap.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch = 0; });
addEventListener('resize', () => drawMap());

window.__UI = { autoRes, get autoScale() { return autoScale; }, pins, divePin, toast, splash, pingSound, soundSpeed, renderPanel, renderRuler, drawMap, syncGo, syncMode, nf };
})();
