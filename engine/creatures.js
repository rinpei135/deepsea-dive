// 3D で泳ぐ生き物。地形の世界（1単位 = 1km、深さは強調あり）とは別に、カメラの周りを
// メートル単位の「近景」として重ねて描く。生き物はプレイヤーの周りにだけ出し、離れたら消す。
(() => {
const T = window.__TRENCH, S = window.__DIVE, SEA = window.SEA, UI = window.__UI;
const { renderer, camera } = T;
const DEFS = (SEA && SEA.creatures) || [];

// ---------- 近景の世界 ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.06);
const cam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.03, 250);
scene.add(new THREE.AmbientLight(0x1a2a36, 0.35));
// 潜水艇のライト（前方を照らすスポットライト）
const lamp = new THREE.SpotLight(0xe8f4ff, 1.3, 35, 0.55, 0.5, 1.6);
lamp.position.set(0, 0, 0); scene.add(lamp); scene.add(lamp.target);
const fill = new THREE.PointLight(0xcfe8ff, 0.25, 8, 2); scene.add(fill);

// 形と動きは engine/species.js（確認用ページとも共通）
const BUILDERS = window.SPECIES || {};

// ---------- 出現と消滅（プレイヤーの周りだけ） ----------
const live = [];                 // { def, body, x, z, depth(m), heading, vy, seed, met }
const met = new Set();
const fwd = new THREE.Vector3();
function spawn(def, near) {
  const b = BUILDERS[def.kind]; if (!b) return;
  const body = b(def.size || 0.3);
  // 視線の前方寄り、near のときは目の前
  camera.getWorldDirection(fwd);
  const yaw = Math.atan2(fwd.x, fwd.z) + (near ? 0 : (Math.random() - 0.5) * 2.4);
  const dist = near ? 2.2 : 12 + Math.random() * 30;
  const c = {
    def, body, seed: Math.random() * 100,
    x: S.x * 1000 + Math.sin(yaw) * dist, z: S.z * 1000 + Math.cos(yaw) * dist,
    depth: Math.max(def.from, Math.min(def.to, S.depth + (near ? -fwd.y * dist * 0 : (Math.random() - 0.5) * 12))),
    heading: Math.random() * Math.PI * 2
  };
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
  // その深さに住む種類だけ、決められた数まで出す
  if ((spawnTimer -= dt) <= 0) {
    spawnTimer = 0.5;
    DEFS.forEach(def => {
      const inRange = depth >= def.from && depth <= def.to;
      const n = live.filter(c => c.def === def).length;
      if (inRange && n < (def.count || 1)) spawn(def, false);
    });
  }
  live.slice().forEach(c => {
    const dx = c.x - px, dz = c.z - pz, dy = -(c.depth - depth), d = Math.hypot(dx, dy, dz);
    if (d > 120 || c.depth < c.def.from - 50 || c.depth > c.def.to + 50) { remove(c); return; }
    // ゆっくり漂い、ライトが近いと離れる
    const shy = d < 3 ? 1 : 0;
    c.heading += (Math.sin(t * 0.3 + c.seed) * 0.4 + (shy ? 1.2 : 0)) * dt;
    const sp = 0.12 + shy * 0.25;
    c.x += Math.sin(c.heading) * sp * dt; c.z += Math.cos(c.heading) * sp * dt;
    c.depth += Math.sin(t * 0.5 + c.seed) * 0.05 * dt;
    const floor = T.floorDepth(c.x / 1000, c.z / 1000) - 1;
    if (c.depth > floor) c.depth = floor;
    // 近景の座標（プレイヤーが原点、メートル単位、上が +y）
    const g = c.body.group;
    g.position.set(dx, dy + Math.sin(t * 1.6 + c.seed) * 0.03, dz);
    g.rotation.y = c.heading; g.rotation.z = Math.sin(t * 0.7 + c.seed) * 0.12;
    c.body.animate(t + c.seed, sp);
    // 近くで見たら「出会い」を知らせる（種類ごとに1回）
    camera.getWorldDirection(fwd);
    const inView = d < 6 && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > 0.75;
    if (inView && !met.has(c.def.name)) { met.add(c.def.name); UI.toast(`${c.def.name}に出会いました — ${c.def.note}`); }
  });
  // 水の色・見通し・ライト
  T.waterColor(depth, water);
  scene.fog.color.copy(water);
  scene.fog.density = 0.05;
  lamp.visible = fill.visible = depth > 150;
  camera.getWorldDirection(fwd);
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
function demo(kind) { const def = DEFS.find(d => !kind || d.kind === kind); return def && spawn(def, true); }

window.__LIFE = { update, render, demo, live };
})();
