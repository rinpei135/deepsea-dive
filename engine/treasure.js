// 隠し機能の宝探し: 海溝の底に沈んだ宝箱。画面に入口は出さず、ソナーの金属反応で偶然気づくか、
// 隠しコマンド（キーボードで「takara」と入力、または URL 末尾に #takara）でヒント付きのパネルが開く
(() => {
const T = window.__TRENCH, UI = window.__UI, S = window.__DIVE, SEA = window.SEA;
const { scene, camera, state, terrainMat } = T;
const $ = id => document.getElementById(id);
const nf = UI.nf;

// ---------- 日替わりの置き場所 ----------
// 日本時間の日付から乱数を作るので、同じ日に遊ぶ人は全員同じ場所を探す
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function rng(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const SPOT = (() => {
  const B = window.BATHY, r = rng(SEA.id + '-treasure-' + TODAY), M = 0.15;
  for (let n = 0; n < 20000; n++) {
    const row = Math.floor(r() * T.NZ), col = Math.floor(r() * T.NX);
    const lat = B.lat0 - row * B.step, lon = B.lon0 + col * B.step;
    if (lat < B.lat1 + M || lat > B.lat0 - M || lon < B.lon0 + M || lon > B.lon1 - M) continue;   // 端は避ける
    if (-T.elev[row * T.NX + col] >= (SEA.treasureMinDepth || 2000)) return { lat, lon };
  }
  return { lat: T.CD.lat, lon: T.CD.lon };
})();
const X = T.toX(SPOT.lon), Z = T.toZ(SPOT.lat);
const floorD = T.floorDepth(X, Z);
const DIRS16 = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const dir16 = (dx, dz) => DIRS16[Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360) / 22.5) % 16];
const HINTS = [
  `今日の宝箱は、水深およそ${nf(Math.round(floorD / 500) * 500)}mの海底に沈んでいる。`,
  `${SEA.origin.name}から見て${dir16(X, Z)}の方角、およそ${nf(Math.round(Math.hypot(X, Z) / 10) * 10)}km。`,
  `北緯${SPOT.lat.toFixed(1)}°・東経${SPOT.lon.toFixed(1)}°のあたり。ミニマップをクリックすれば近くまで移動できる。`
];
const KEY = `deepsea-${SEA.id}-treasure-${TODAY}`;
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
let rec = load(KEY) || { hints: 0, found: null, diveSecs: 0 };

// ---------- 宝箱の模型 ----------
const U = 0.012;                  // 模型の単位（シーン単位。宝箱の幅 ≈ 3U）
const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.8, metalness: 0.05, emissive: 0x080402 });
const gold = new THREE.MeshStandardMaterial({ color: 0xe6b84a, roughness: 0.35, metalness: 0.9, emissive: 0x120b00 });
const chest = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(3 * U, 1.6 * U, 2 * U), wood);
body.position.y = 0.8 * U; chest.add(body);
[-1.1, 0, 1.1].forEach(x => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.22 * U, 1.64 * U, 2.04 * U), gold); b.position.set(x * U, 0.8 * U, 0); chest.add(b); });
const lidPivot = new THREE.Group(); lidPivot.position.set(0, 1.6 * U, -U); chest.add(lidPivot);
const lid = new THREE.Mesh(new THREE.CylinderGeometry(U, U, 3 * U, 24, 1, false, 0, Math.PI), wood);
lid.rotation.z = Math.PI / 2; lid.position.set(0, 0, U); lidPivot.add(lid);
[-1.1, 0, 1.1].forEach(x => { const b = new THREE.Mesh(new THREE.CylinderGeometry(1.03 * U, 1.03 * U, 0.22 * U, 24, 1, false, 0, Math.PI), gold); b.rotation.z = Math.PI / 2; b.position.set(x * U, 0, U); lidPivot.add(b); });
const lock = new THREE.Mesh(new THREE.BoxGeometry(0.5 * U, 0.6 * U, 0.15 * U), gold); lock.position.set(0, 1.4 * U, 1.05 * U); chest.add(lock);
const coins = new THREE.Mesh(new THREE.CylinderGeometry(1.3 * U, 1.4 * U, 0.5 * U, 20), new THREE.MeshStandardMaterial({ color: 0xffd36b, metalness: 1, roughness: 0.25, emissive: 0x2a1c04 }));
coins.scale.set(1, 1, 0.65); coins.position.y = 1.45 * U; coins.visible = false; chest.add(coins);
chest.rotation.y = -0.6;
scene.add(chest);

// 金色の光（近づくと暗闇に見える目印）と照明
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,225,150,1)'); gr.addColorStop(0.25, 'rgba(255,190,80,.45)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
scene.add(beacon);
const chestLight = new THREE.PointLight(0xffc873, 1.2, 0.08, 2); scene.add(chestLight);
const lamp = new THREE.PointLight(0xe8f6ff, 1.6, 0.35, 2); scene.add(lamp);
scene.add(new THREE.AmbientLight(0x223344, 0.25));

// 発見時に舞い上がる金の粒
const SPARK = 160, sparkGeo = new THREE.BufferGeometry(), sp = new Float32Array(SPARK * 3), sv = [];
for (let i = 0; i < SPARK; i++) sv.push([(Math.random() - 0.5) * 0.6, 0.6 + Math.random(), (Math.random() - 0.5) * 0.6]);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
const sparkMat = new THREE.PointsMaterial({ color: 0xffd36b, size: 3, sizeAttenuation: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const sparks = new THREE.Points(sparkGeo, sparkMat); sparks.frustumCulled = false; scene.add(sparks);
let openT = rec.found ? 99 : -1;

// ---------- 画面 ----------
const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const bearing = (dx, dz) => { const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360; return DIRS[Math.round(deg / 22.5) % 16]; };
const fmtTime = s => { const m = Math.floor(s / 60), r = Math.round(s % 60); return m ? `${m}分${r}秒` : `${r}秒`; };
function renderQuest() {
  $('hintList').innerHTML = HINTS.slice(0, rec.hints).map(h => `<li>${h}</li>`).join('');
  $('hintBtn').hidden = rec.hints >= HINTS.length;
  $('hintBtn').textContent = rec.hints >= HINTS.length ? '' : rec.hints ? `次のヒント（${rec.hints + 1}/${HINTS.length}）` : 'ヒントを見る';
  $('questStatus').textContent = rec.found
    ? `${TODAY} の宝箱 発見済み：${new Date(rec.found.at).toLocaleString('ja-JP')}（潜航時間 ${fmtTime(rec.found.secs)}）`
    : `${TODAY} の宝箱 未発見 · 潜航時間 ${fmtTime(rec.diveSecs)}`;
}
function openQuest() { $('quest').hidden = false; renderQuest(); }
$('questClose').onclick = () => { $('quest').hidden = true; };
// 隠しコマンド
if (location.hash === '#takara') openQuest();
addEventListener('hashchange', () => { if (location.hash === '#takara') openQuest(); });
let typed = '';
addEventListener('keydown', e => {
  if (e.key.length !== 1 || e.target.closest?.('input, textarea')) return;
  typed = (typed + e.key.toLowerCase()).slice(-6);
  if (typed === 'takara') openQuest();
});
$('hintBtn').onclick = () => { rec.hints = Math.min(HINTS.length, rec.hints + 1); save(KEY, rec); renderQuest(); };
$('foundClose').onclick = () => { $('found').hidden = true; };
$('copyBtn').onclick = () => {
  const ta = $('foundShare');
  const done = () => { $('copyBtn').textContent = 'コピーしました'; setTimeout(() => $('copyBtn').textContent = '結果をコピー', 2000); };
  const fallback = () => { ta.focus(); ta.select(); $('copyBtn').textContent = '選択した文をコピーしてください'; };
  try { navigator.clipboard.writeText(ta.value).then(done, fallback); } catch (_) { fallback(); }
};
function showFound() {
  const f = rec.found;
  $('foundText').textContent = `${TODAY} の宝箱を、水深 ${nf(floorD)} m の海底で見つけました。潜航時間 ${fmtTime(f.secs)}、使ったヒント ${f.hints} 個。`;
  $('foundShare').value = `深海ダイブ（${SEA.name}）で、${TODAY}の宝箱（水深${nf(floorD)}m）を発見！ 潜航時間 ${fmtTime(f.secs)}／ヒント ${f.hints}個 #深海ダイブ`;
  $('found').hidden = false;
}
renderQuest();

// ---------- 毎フレーム ----------
const echoes = new WeakMap();
let echoUntil = 0, saveTick = 0;
function update(dt, t, { dive, under, pings }) {
  const y = -floorD / 1000 * state.ex;
  chest.position.set(X, y + 0.002, Z);
  chestLight.position.set(X, y + 0.05, Z);
  beacon.position.set(X, y + 0.02, Z);
  const near = Math.hypot(S.x - X, S.z - Z);                 // km
  const vert = Math.abs(Math.max(0, S.depth) - floorD) / 1000;
  const d3 = Math.hypot(near, vert);
  // 金色の光は宝箱の近く（約1.5km以内）でだけ、ほのかに見える
  beacon.visible = under && d3 < 1.5;
  beacon.scale.setScalar(0.05 * (1 + 0.12 * Math.sin(t * 2.5)));
  beacon.material.opacity = 0.55 * Math.min(1, (1.5 - d3) / 1.0);
  lamp.position.copy(camera.position); lamp.visible = under && S.depth > 150;
  // ソナー地形の金色は宝箱から 5km 以内でだけ、近いほど濃く（海面からは見えない）
  terrainMat.uniforms.uChest.value.set(X, y, Z, rec.found ? 0 : Math.max(0, Math.min(1, (5 - d3) / 3)) * 0.7);

  if (!dive || !under) return;
  if (!rec.found) {
    rec.diveSecs += dt;
    if ((saveTick += dt) > 5) { saveTick = 0; save(KEY, rec); }
    // 発見: 水平 120m 以内、上下 250m 以内
    if (near < 0.12 && vert < 0.25) {
      rec.found = { at: Date.now(), secs: rec.diveSecs, hints: rec.hints };
      save(KEY, rec); openT = 0; renderQuest(); showFound();
      S.dir = 0; S.goal = null; UI.syncGo();
      S.yaw = Math.atan2(-(X - S.x), -(Z - S.z)); S.pitch = -0.9;   // 宝箱の方を向く
      UI.toast('宝箱を発見しました！'); window.__AUDIO?.found();
    }
    // 金属反応: 音が宝箱まで行って戻ってきた時刻に、方位と距離を表示
    const c = 1.5;
    pings.forEach(p => {
      if (p.w < 0) return;
      let e = echoes.get(p);
      if (!e || p.w < e.lastW) { e = { done: false, x: S.x, z: S.z, depth: Math.max(0, S.depth) }; echoes.set(p, e); }
      e.lastW = p.w;
      if (e.done) return;
      const dist = Math.hypot(Math.hypot(X - e.x, Z - e.z), (floorD - e.depth) / 1000);
      if (dist > 20) { e.done = true; return; }                 // 気づけるのは 20km 以内だけ
      if (p.w >= 2 * dist / c) {
        e.done = true;
        $('echo').textContent = `不明な金属反応 · 方位 ${bearing(X - e.x, Z - e.z)} · 距離 約${nf(dist, dist < 10 ? 1 : 0)} km`;
        $('echo').hidden = false; echoUntil = t + 12;
      }
    });
  }
  if (echoUntil && t > echoUntil) { $('echo').hidden = true; echoUntil = 0; }

  // ふたが開いて金の粒が舞う
  if (openT >= 0) {
    openT += dt;
    const k = Math.min(1, openT / 2);
    lidPivot.rotation.x = -1.9 * (1 - Math.pow(1 - k, 3));
    coins.visible = true;
    const a = Math.max(0, 1 - openT / 6);
    sparkMat.opacity = a;
    if (a > 0) {
      for (let i = 0; i < SPARK; i++) {
        const v = sv[i], s = openT * 0.02;
        sp[i * 3] = X + v[0] * s; sp[i * 3 + 1] = y + 0.02 + v[1] * s; sp[i * 3 + 2] = Z + v[2] * s;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }
  }
}
if (rec.found) { lidPivot.rotation.x = -1.9; coins.visible = true; }

window.__TREASURE = { update };
})();
