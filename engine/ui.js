// 計器・ルーラー・ボタン・ミニマップ・効果音（状態は nav.js と共有）
(() => {
const T = window.__TRENCH, O = window.SEA;
const { CD, state } = T;
const $ = id => document.getElementById(id);
const nf = (v, d = 0) => v.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: d });
const RULER_MAX = 11000;
const NAV = () => window.__NAV;

const S = window.__DIVE = {
  mode: null, x: 0, z: 0, depth: 0, dir: 0, goal: null, speed: 100, yaw: 0, pitch: -0.2,
  sonar: true, sound: false, vol: 0.3, surfaceOn: true, intro: null, keys: {}
};
// 音量は閲覧者ごとにこのブラウザへ記憶
try { const v = localStorage.getItem('deepsea-vol'); if (v !== null) { S.vol = +v; $('vol').value = Math.round(S.vol * 100); } } catch (_) {}
$('vol').addEventListener('input', e => { S.vol = e.target.value / 100; try { localStorage.setItem('deepsea-vol', S.vol); } catch (_) {} });
$('vol').addEventListener('change', () => { if (S.sound) pingSound(); });

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
[[1, '1 m/秒'], [10, '10'], [100, '100'], [1000, '1000 m/秒']].forEach(([v, l]) => {
  const b = document.createElement('button');
  b.className = 'btn'; b.type = 'button'; b.textContent = l;
  b.title = v === 1 ? '実際の有人潜水艇に近い速さ（Shiftで5倍）' : `毎秒${v}m（Shiftで5倍）`;
  b.setAttribute('aria-pressed', v === S.speed);
  b.onclick = () => { S.speed = v; [...$('speeds').children].forEach(c => c.setAttribute('aria-pressed', c === b)); };
  $('speeds').appendChild(b);
});
function syncGo() {
  $('go').textContent = S.dir > 0 ? '一時停止 ❚❚' : '潜航開始 ▼';
  $('up').textContent = S.dir < 0 ? '一時停止 ❚❚' : '浮上 ▲';
}
function syncMode() {
  const dive = S.mode === 'dive';
  $('mOver').setAttribute('aria-pressed', !dive);
  $('mDive').setAttribute('aria-pressed', dive);
  $('pad').hidden = $('mapbox').hidden = !dive;
  $('panel').classList.toggle('dive', dive);
  $('hint').textContent = dive
    ? '移動: W A S D · 上昇 E/Space · 下降 Q/C · Shiftで加速 · ドラッグで見回す'
    : 'ドラッグで回転 · ホイールで拡大 · 右ドラッグで移動 · ルーラーをクリックでその深さへ潜航';
  syncGo();
}
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
$('sound').onclick = e => { S.sound = !S.sound; e.currentTarget.setAttribute('aria-pressed', S.sound); if (S.sound) pingSound(); };
$('ping').onclick = () => NAV().ping(true);
const EXS = [1, 2, 4, 8];
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

// ---------- 効果音（ソナーのピン） ----------
let ac = null;
function pingSound() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const now = ac.currentTime;
    if (S.vol <= 0) return;
    [[0, 0.22], [0.9, 0.06], [1.7, 0.025]].map(([dt, g]) => [dt, g * S.vol]).forEach(([dt, g]) => {   // 本音と反響
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1180, now + dt); o.frequency.exponentialRampToValueAtTime(1040, now + dt + 1.2);
      v.gain.setValueAtTime(0, now + dt); v.gain.linearRampToValueAtTime(g, now + dt + 0.01);
      v.gain.exponentialRampToValueAtTime(0.0001, now + dt + 1.4);
      o.connect(v); v.connect(ac.destination); o.start(now + dt); o.stop(now + dt + 1.5);
    });
  } catch (e) { /* 音が使えない環境では無音 */ }
}

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
  $('depth').innerHTML = depth < 0 ? `${nf(-depth)}<small>m 海面上</small>` : `${nf(d)}<small>m</small>`;
  const atm = 1 + d / 10, g = T.fromXZ(S.x, S.z);
  const rows = [['水圧', `約 ${nf(atm)} 気圧`], ['水温（概算）', `${nf(temp(d), 1)} ℃`], ['太陽光', light(d)],
    ['海底まで', `${nf(Math.max(0, floorD - d))} m`], ['位置', `北緯 ${nf(g.lat, 3)}° 東経 ${nf(g.lon, 3)}°`]];
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
function renderRuler(depth, floorD, dive) {
  const n = $('now');
  n.style.top = pct(depth); n.style.display = dive ? '' : 'none';
  n.firstChild.textContent = depth < 0 ? '海面上' : `${nf(depth)} m`;
  $('floor').style.top = pct(floorD);
}

// ---------- ミニマップ ----------
const map = $('map'), mctx = map.getContext('2d');
const base = document.createElement('canvas'); base.width = map.width; base.height = map.height;
{
  const B = window.BATHY, bin = atob(B.b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const e = new Int16Array(u8.buffer);
  const bc = base.getContext('2d'), img = bc.createImageData(B.nlon, B.nlat);
  const stops = [[0, [150, 225, 215]], [400, [80, 180, 200]], [2000, [48, 128, 168]], [4000, [36, 84, 140]], [6000, [30, 56, 112]], [8500, [34, 32, 84]], [11000, [26, 12, 50]]];
  for (let i = 0; i < e.length; i++) {
    let c;
    if (e[i] >= 0) c = [150, 140, 100];
    else {
      const d = -e[i]; let j = 1; while (j < stops.length - 1 && d > stops[j][0]) j++;
      const t = Math.min(1, (d - stops[j - 1][0]) / (stops[j][0] - stops[j - 1][0]));
      c = stops[j - 1][1].map((v, k) => v + (stops[j][1][k] - v) * t);
    }
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  bc.putImageData(img, 0, 0);
}
const toMap = (x, z) => [(x - T.rect.x0) / (T.rect.x1 - T.rect.x0) * map.width, (z - T.rect.z0) / (T.rect.z1 - T.rect.z0) * map.height];
function drawMap(pings) {
  const q = map.width / 200;                 // 表示幅200pxに合わせた線の太さ
  mctx.drawImage(base, 0, 0);
  const [cx, cz] = toMap(0, 0);
  mctx.strokeStyle = 'rgba(255,255,255,.7)'; mctx.lineWidth = q;
  mctx.beginPath(); mctx.arc(cx, cz, 3 * q, 0, 7); mctx.stroke();
  const kx = map.width / (T.rect.x1 - T.rect.x0), speed = T.terrainMat.uniforms.uPingSpeed.value;
  pings.forEach(p => {
    if (p.w < 0 || p.w * speed > T.terrainMat.uniforms.uRange.value) return;
    const [px, pz] = toMap(p.x, p.z);
    mctx.strokeStyle = `rgba(142,230,242,${Math.max(0, 0.8 - p.w * 0.02)})`; mctx.lineWidth = q;
    mctx.beginPath(); mctx.arc(px, pz, p.w * speed * kx, 0, 7); mctx.stroke();
  });
  const [x, z] = toMap(S.x, S.z);
  mctx.fillStyle = '#8ee6f2'; mctx.beginPath(); mctx.arc(x, z, 3.5 * q, 0, 7); mctx.fill();
  mctx.strokeStyle = '#8ee6f2'; mctx.lineWidth = 2 * q; mctx.beginPath(); mctx.moveTo(x, z);
  mctx.lineTo(x - Math.sin(S.yaw) * 12 * q, z - Math.cos(S.yaw) * 12 * q); mctx.stroke();
}
map.addEventListener('click', e => {
  const r = map.getBoundingClientRect();
  const x = T.rect.x0 + (e.clientX - r.left) / r.width * (T.rect.x1 - T.rect.x0);
  const z = T.rect.z0 + (e.clientY - r.top) / r.height * (T.rect.z1 - T.rect.z0);
  NAV().teleport(x, z);
});

window.__UI = { pins, divePin, toast, splash, pingSound, renderPanel, renderRuler, drawMap, syncGo, syncMode, nf };
})();
