// 3D で泳ぐ生き物。地形の世界（1単位 = 1km、深さは強調あり）とは別に、カメラの周りを
// メートル単位の「近景」として重ねて描く。生き物はプレイヤーの周りにだけ出し、離れたら消す。
//
// config.js の creatures の項目:
//   kind      形と動きの種類（engine/species.js）   name / note  表示名と説明
//   from / to 住む深さ (m)                           count        プレイヤーの周りに出す数
//   size      大きさ (m)                             status       'preview' なら公開前（通常は表示しない）
//   habitat   'mid'（水中・既定） / 'nearFloor'（海底の少し上を泳ぐ） / 'onFloor'（海底にいる）
//   dist      出す距離 [最小, 最大] (m)               speed        泳ぐ速さ (m/秒)。0 なら動かない
(() => {
const T = window.__TRENCH, S = window.__DIVE, SEA = window.SEA, UI = window.__UI;
const { renderer, camera } = T;
const $ = id => document.getElementById(id);

// ---------- 公開前の生き物とプレビュー表示 ----------
// URL に ?preview=on を付けて開くと有効になり（ブラウザが覚える）、?preview=off で元に戻る。
const PREVIEW = (() => {
  const q = new URLSearchParams(location.search).get('preview');
  try {
    if (q === 'on') localStorage.setItem('deepsea-preview', '1');
    if (q === 'off') localStorage.removeItem('deepsea-preview');
    return localStorage.getItem('deepsea-preview') === '1';
  } catch (_) { return q === 'on'; }
})();
const ALL = ((SEA && SEA.creatures) || []).filter(d => d.status !== 'preview' || PREVIEW);
// プレビュー中に「生き物の表示」で隠した種類（このブラウザだけの設定）
const OFF_KEY = 'deepsea-creatures-off';
let off = new Set();
try { off = new Set(JSON.parse(localStorage.getItem(OFF_KEY) || '[]')); } catch (_) {}
const enabled = def => !off.has(def.kind);
const habitat = def => def.habitat || (def.nearFloor ? 'nearFloor' : 'mid');

// ---------- 近景の世界 ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.05);
const cam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.02, 400);
const ambient = new THREE.AmbientLight(0x1a2a36, 0.35); scene.add(ambient);
// 浅い海では、上から差し込む太陽の光で見える
const sun = new THREE.DirectionalLight(0xbfe6f0, 0); sun.position.set(0.3, 1, 0.2); scene.add(sun);
// 潜水艇のライト（前方を照らすスポットライト）
const lamp = new THREE.SpotLight(0xe8f4ff, 1.3, 35, 0.55, 0.5, 1.6);
lamp.position.set(0, 0, 0); scene.add(lamp); scene.add(lamp.target);
const fill = new THREE.PointLight(0xcfe8ff, 0.25, 8, 2); scene.add(fill);

const BUILDERS = window.SPECIES || {};

// ---------- 出現と消滅（プレイヤーの周りだけ） ----------
const live = [];                 // { def, body, x, z, depth(m), heading, seed }
const met = new Set();
const fwd = new THREE.Vector3();
function spawn(def, near) {
  const b = BUILDERS[def.kind]; if (!b) return null;
  camera.getWorldDirection(fwd);
  const [dmin, dmax] = def.dist || [12, 42];
  const yaw = Math.atan2(fwd.x, fwd.z) + (near ? 0 : (Math.random() - 0.5) * 2.4);
  const dist = near ? Math.max(2.2, (def.size || 0.3) * 3) : dmin + Math.random() * (dmax - dmin);
  const x = S.x * 1000 + Math.sin(yaw) * dist, z = S.z * 1000 + Math.cos(yaw) * dist;
  let depth = Math.max(def.from, Math.min(def.to, S.depth + (near ? 0 : (Math.random() - 0.5) * Math.min(12, dist * 0.4))));
  const h = habitat(def);
  if (!near && h !== 'mid') {
    const floor = T.floorDepth(x / 1000, z / 1000);
    depth = h === 'onFloor' ? floor : floor - (0.5 + Math.random() * 3.5);
  }
  if (!near && (depth < def.from || depth > def.to)) return null;   // その深さに住まない場所なら出さない
  const body = b(def.size || 0.3);
  const c = { def, body, x, z, depth, heading: Math.random() * Math.PI * 2, seed: Math.random() * 100 };
  scene.add(body.group); live.push(c);
  return c;
}
function remove(c) { scene.remove(c.body.group); live.splice(live.indexOf(c), 1); }

// ---------- 毎フレーム ----------
const water = new THREE.Color();
let active = false, spawnTimer = 0;
function update(dt, t, { dive, under, depth }) {
  active = dive && under;
  if (!active) { while (live.length) remove(live[0]); return; }
  const px = S.x * 1000, pz = S.z * 1000;
  const floorHereP = T.floorDepth(S.x, S.z);
  // その深さに住む種類だけ、決められた数まで出す
  if ((spawnTimer -= dt) <= 0) {
    spawnTimer = 0.5;
    ALL.forEach(def => {
      if (!enabled(def)) return;
      const h = habitat(def);
      const floorOk = h === 'mid' || floorHereP - depth < 60;         // 海底の生き物は、海底から 60m 以内で
      const inRange = depth >= def.from - (h === 'mid' ? 0 : 60) && depth <= def.to && floorOk;
      const n = live.filter(c => c.def === def).length;
      if (inRange && n < (def.count || 1)) spawn(def, false);
    });
  }
  camera.getWorldDirection(fwd);
  live.slice().forEach(c => {
    const def = c.def, h = habitat(def), size = def.size || 0.3;
    const dx = c.x - px, dz = c.z - pz, dy = -(c.depth - depth), d = Math.hypot(dx, dy, dz);
    const far = def.despawn || Math.max(120, (def.dist ? def.dist[1] : 42) * 2.5);
    if (!enabled(def) || d > far || c.depth < def.from - 80 || c.depth > def.to + 80) { remove(c); return; }
    // 動き: ゆっくり向きを変えながら進む。小さな生き物はライトが近いと離れる
    const shy = size < 1 && d < 3 ? 1 : 0;
    const base = def.speed != null ? def.speed : 0.12;
    const sp = base > 0 ? base + shy * 0.25 : 0;
    if (sp > 0) {
      c.heading += (Math.sin(t * 0.3 + c.seed) * 0.4 * Math.min(1, 0.4 / Math.max(0.4, size)) + (shy ? 1.2 : 0)) * dt;
      c.x += Math.sin(c.heading) * sp * dt; c.z += Math.cos(c.heading) * sp * dt;
    }
    const floorHere = T.floorDepth(c.x / 1000, c.z / 1000);
    if (h === 'onFloor') c.depth = floorHere;                            // 海底にいる（原点が足元）
    else {
      c.depth += Math.sin(t * 0.5 + c.seed) * 0.05 * dt;
      if (h === 'nearFloor') c.depth += (floorHere - 1.5 - c.depth) * Math.min(1, dt * 0.3);   // 海底の少し上を保つ
      if (c.depth > floorHere - 0.3 - size * 0.3) c.depth = floorHere - 0.3 - size * 0.3;
    }
    // 近景の座標（プレイヤーが原点、メートル単位、上が +y）
    const g = c.body.group;
    g.position.set(dx, dy + (h === 'onFloor' ? 0 : Math.sin(t * 1.6 + c.seed) * 0.03 * Math.min(1, size * 5)), dz);
    g.rotation.y = c.heading; g.rotation.z = h === 'onFloor' ? 0 : Math.sin(t * 0.7 + c.seed) * 0.08;
    // 霧で見えない遠くの生き物は、動きの計算を省いて軽くする
    if (d < 60 + size * 4) c.body.animate(t + c.seed, sp);
    // 近くで見たら「出会い」を知らせる（種類ごとに1回）
    const near = Math.max(6, size * 3);
    const inView = d < near && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > 0.7;
    if (inView && !met.has(def.name)) { met.add(def.name); UI.toast(`${def.name}に出会いました — ${def.note}`); }
  });
  // 水の色・見通し・光
  T.waterColor(depth, water);
  scene.fog.color.copy(water);
  scene.fog.density = 0.05;
  sun.intensity = 1.1 * Math.exp(-depth / 70);
  ambient.intensity = 0.35 + 0.6 * Math.exp(-depth / 60);
  lamp.visible = fill.visible = depth > 150;
  lamp.target.position.copy(fwd).multiplyScalar(10);
}
function render() {
  if (!active || !live.length) return;
  cam.fov = camera.fov; cam.aspect = camera.aspect; cam.updateProjectionMatrix();
  cam.quaternion.copy(camera.quaternion); cam.position.set(0, 0, 0);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, cam);
  renderer.autoClear = true;
}
// 確認用: 目の前に1匹出す
function demo(kind) { const def = ALL.find(d => !kind || d.kind === kind); return def && spawn(def, true); }

// ---------- プレビュー中だけ: 表示する生き物を選ぶパネル ----------
if (PREVIEW && ALL.length) {
  setTimeout(() => UI.toast('プレビュー表示中: 公開前の生き物も表示されます（?preview=off で元に戻ります）'), 1200);
  const btn = document.createElement('button');
  btn.className = 'btn more'; btn.type = 'button'; btn.id = 'lifeBtn'; btn.textContent = '生き物の表示'; btn.setAttribute('aria-expanded', 'false');
  $('controls').appendChild(btn);
  const panel = document.createElement('section');
  panel.className = 'hud'; panel.id = 'lifeSel'; panel.hidden = true; panel.setAttribute('aria-label', '生き物の表示');
  const fmt = n => n.toLocaleString('ja-JP');
  panel.innerHTML = `<header><h3>生き物の表示（プレビュー）</h3><button class="btn" id="lifeClose" type="button" aria-label="閉じる">×</button></header>
    <p>オフにした生き物は出なくなります。この設定はこのブラウザだけのもので、ほかの人の表示は変わりません。公開する生き物が決まったら、その生き物の「公開前」の印を外します。</p>
    <div class="row"><button class="btn" id="lifeAll" type="button">すべて表示</button><button class="btn" id="lifeNone" type="button">すべて隠す</button></div>
    <ul>${ALL.map(d => `<li><label><input type="checkbox" id="life-${d.kind}" data-kind="${d.kind}"${enabled(d) ? ' checked' : ''}> <b>${d.name}</b> <span>${fmt(d.from)}–${fmt(d.to)} m</span></label></li>`).join('')}</ul>`;
  document.body.appendChild(panel);
  const save = () => { try { localStorage.setItem(OFF_KEY, JSON.stringify([...off])); } catch (_) {} };
  const sync = () => panel.querySelectorAll('input[data-kind]').forEach(cb => { cb.checked = !off.has(cb.dataset.kind); });
  panel.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.kind; if (!k) return; e.target.checked ? off.delete(k) : off.add(k); save(); });
  btn.onclick = () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', !panel.hidden); };
  $('lifeClose').onclick = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  $('lifeAll').onclick = () => { off.clear(); save(); sync(); };
  $('lifeNone').onclick = () => { ALL.forEach(d => off.add(d.kind)); save(); sync(); };
}

window.__LIFE = { update, render, demo, live };
})();
