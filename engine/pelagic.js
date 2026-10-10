// 外洋の海面近くの生き物と、ダイブポイントの見どころの体。
//   ハシナガイルカの群れ（海面でジャンプして回る）・トビウオ（海面から飛び出して滑空する）・キハダの群れ・流木につくシイラ、
//   沈船（東海丸）の体、タイマイ（アオウミガメの体の色を変える）。
// 潜っているときは近景の世界（creatures.js）に描き、海面にいるときは、海面より上に出た体だけを別に描く。
// 公開前（creatures.js の PREVIEW のときだけ表示）
(() => {
const L = window.__LIFE, A = L && L.reefApi, R = window.__REEF, T = window.__TRENCH, S = window.__DIVE, SEA = window.__SEA;
if (!A || !A.PREVIEW || !R || !R.kit) return;
const K = R.kit, { scene, REEF, floorAt } = A;
const h = (a, b, k) => T.hashJS(a, b, k);
const $V = new THREE.Vector3(), $Q = new THREE.Quaternion(), $Q2 = new THREE.Quaternion(), $M = new THREE.Matrix4(), $S = new THREE.Vector3(), $C = new THREE.Color();
const X = new THREE.Vector3(1, 0, 0);

// ---------- 海面より上に出た体だけを描く ----------
// 海面にいるとき（カメラが海面の上）、近景の世界は描かれない。外洋の生き物の体を、別の場面（空の光で照らす）に移して描き、
// 海面より下の部分は捨てる（水面の下は、海面ごしにしか見えないため）
const AIR = K.AIR, CAMD = K.CAMD;                                      // AIR: 1 = 海面より上だけ描く、CAMD: カメラの水深 (m。海面の上はマイナス)。材質は reef.js の swayMat
const airScene = new THREE.Scene(); airScene.fog = new THREE.FogExp2(0xc4dbe8, 0.0008);   // 霧の種類をそろえる（材質の作り直しを防ぐ。薄いので見た目は変わらない）
const airSun = new THREE.DirectionalLight(0xfff2dc, 2.4); airSun.position.copy((SEA && SEA.SUN) || new THREE.Vector3(0, 1, 0)); airScene.add(airSun);
airScene.add(new THREE.HemisphereLight(0xcfe6f5, 0x1d5566, 1.0));
const airCam = new THREE.PerspectiveCamera(50, 1, 0.05, 3000);
const AIR_MESHES = [];
let airOn = false;
function renderAir() {
  if (!airOn) return;
  const ms = AIR_MESHES.filter(m => m.visible && m.count > 0); if (!ms.length) return;
  const cam = T.camera, r = T.renderer;
  airCam.fov = cam.fov; airCam.aspect = cam.aspect; airCam.updateProjectionMatrix(); airCam.quaternion.copy(cam.quaternion); airCam.position.set(0, 0, 0);
  AIR.value = 1;
  ms.forEach(m => airScene.add(m));
  r.autoClear = false; r.clearDepth(); r.render(airScene, airCam); r.autoClear = true;
  ms.forEach(m => scene.add(m));
  AIR.value = 0;
}

// 体の材質と、まとめて描く形（近景の世界に置き、海面より上の部分は renderAir でも描く）
function mesh(geo, opts, mode, k, max, air = true) {                 // mode, k: 揺れ方（reef.js の swayMat）
  const m = K.instanced(geo, K.swayMat(opts, mode, k), max);
  m.castShadow = false;
  if (air) AIR_MESHES.push(m);
  return m;
}
const put = (m, i, x, y, z, q, s, tint = 1) => { $V.set(x, y, z); $S.setScalar(s); $M.compose($V, q, $S); m.setMatrixAt(i, $M); m.setColorAt(i, $C.setScalar(tint)); };
const done = (m, n) => { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } };
// 向き: 進む向き (hx, hy, hz) に頭（+x）を向け、体の軸のまわりに roll だけ回す
function orient(hx, hy, hz, roll = 0) {
  $V.set(hx, hy, hz).normalize(); $Q.setFromUnitVectors(X, $V);
  if (roll) $Q.multiply($Q2.setFromAxisAngle(X, roll));
  return $Q;
}

// ---------- ハシナガイルカ ----------
// 体長 1（頭 +x）。くちばしの細長い頭、背びれ、胸びれ、横に広がる尾びれ。背は濃い灰色、横は淡い灰色、腹は白い（3 色に分かれる）
function dolphinGeo() {
  const NU = 30, NV = 14, pos = [], col = [], idx = [];
  const rad = u => u > 0.9 ? 0.03 - 0.018 * (u - 0.9) / 0.1 : Math.max(0.012, 0.11 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, (u - 0.02) / 0.92))), 0.8));
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, r = rad(u), cy0 = u > 0.9 ? -0.012 : 0;
    for (let j = 0; j <= NV; j++) {
      const th = j / NV * Math.PI * 2, cy = Math.cos(th), sz = Math.sin(th);
      pos.push(u - 0.5, cy0 + cy * r * 1.08, sz * r * 0.92);
      const back = cy > 0.35 - 0.25 * Math.sin(u * 9), belly = cy < -0.35;
      col.push(...(back ? [0.2, 0.23, 0.28] : belly ? [0.92, 0.9, 0.88] : [0.5, 0.53, 0.58]));
      if (i < NU && j < NV) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
  }
  const body = new THREE.BufferGeometry(); body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); body.setIndex(idx); body.computeVertexNormals();
  const tri = (pts, c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.computeVertexNormals(); return K.paint(g, () => c); };
  const dark = [0.2, 0.23, 0.28], mid = [0.45, 0.48, 0.53];
  const parts = [body,
    tri([[0.08, rad(0.58) * 1.05, 0], [-0.06, rad(0.44) * 1.05, 0], [-0.08, rad(0.5) + 0.1, 0]], dark),                       // 背びれ（後ろへ反る）
    ...[-1, 1].map(sd => tri([[0.2, -0.04, sd * 0.07], [0.12, -0.05, sd * 0.07], [0.06, -0.08, sd * 0.2]], mid)),            // 胸びれ
    ...[-1, 1].map(sd => tri([[-0.46, 0, 0], [-0.56, 0, sd * 0.15], [-0.52, 0, sd * 0.02]], dark)),                           // 尾びれ（横に広がる）
    ...[-1, 1].map(sd => tri([[-0.46, 0, 0], [-0.5, 0, sd * 0.06], [-0.56, 0, sd * 0.15]], dark))
  ];
  return K.merge(parts);
}
// 尾を上下に振って泳ぐ（魚は左右、イルカは上下）
// 細かく作った体（species2.js）を焼き付けた形があれば、それを使う
const BAKE = n => window.SPECIES_BAKE && window.SPECIES && window.SPECIES[n] ? window.SPECIES_BAKE(n) : null;
const dolGeo = () => BAKE('spinnerDolphin') || dolphinGeo();
const dol = { mesh: mesh(dolGeo(), { roughness: 0.3, metalness: 0.05 }, 5, [], 24), pod: null, next: 25 + Math.random() * 30 };
function dolphinFrame(dt, t, px, pz, camD, floorHere, show) {
  const m = dol.mesh;
  if (!dol.pod) {
    dol.next -= dt;
    if (!show || dol.next > 0 || camD > 35 || floorHere < 15) { done(m, 0); return; }
    // 70m ほど先から、潜水艇の 8〜20m 横を通る群れ
    const a = Math.random() * 6.283, sx = px + Math.cos(a) * 70, sz = pz + Math.sin(a) * 70, side = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 12);
    let dx = px - sx, dz = pz - sz; const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
    const n = 10 + Math.floor(Math.random() * 7), list = [];
    for (let i = 0; i < n; i++) list.push({ al: (Math.random() - 0.5) * 14, ac: (Math.random() - 0.5) * 9, base: 1.5 + Math.random() * 4, per: 7 + Math.random() * 5, ph: Math.random(), jump: null, s: 1.7 + Math.random() * 0.4, x: 0, z: 0, d: 2, vd: 0 });
    dol.pod = { x: sx - dz * side, z: sz + dx * side, dx, dz, n, list, t: 0 };
  }
  const P = dol.pod; P.t += dt;
  P.x += P.dx * 3 * dt; P.z += P.dz * 3 * dt;
  if (P.t > 15 && Math.hypot(P.x - px, P.z - pz) > 90) { dol.pod = null; dol.next = 60 + Math.random() * 60; done(m, 0); return; }
  let k = 0;
  for (const q of P.list) {
    const wob = Math.sin(t * 0.5 + q.ph * 20);
    const x = P.x + P.dx * q.al - P.dz * (q.ac + wob), z = P.z + P.dz * q.al + P.dx * (q.ac + wob);
    let d, roll = 0, pitch;
    if (q.jump) {                                                       // ジャンプ: 海面から飛び出し、体の軸のまわりに 2〜3 回転して落ちる
      const tau = t - q.jump.t0, T0 = 2 * q.jump.v / 9.8;
      if (tau > T0) { q.jump = null; d = 0.2; }
      else { d = -(q.jump.v * tau - 4.9 * tau * tau); roll = tau / T0 * Math.PI * 2 * q.jump.turns; }
    }
    if (!q.jump) {
      // 息つぎ: 7〜12 秒ごとに、海面すれすれまで上がる（背中と背びれが海面に出る）
      const p = ((t / q.per + q.ph) % 1 + 1) % 1, pulse = Math.exp(-Math.pow((p - 0.5) / 0.07, 2));
      d = q.base + (-0.15 - q.base) * pulse;
      if (pulse > 0.95 && Math.random() < dt * 0.6 && P.t > 4) q.jump = { t0: t, v: 5 + Math.random() * 2, turns: Math.random() < 0.6 ? 2 + Math.floor(Math.random() * 2) : 0 };
    }
    q.vd = (d - q.d) / Math.max(dt, 1e-3); q.d = d;
    pitch = Math.max(-1.2, Math.min(1.2, -q.vd / 3));
    q.x = x; q.z = z;
    put(m, k++, x - px, camD - d, z - pz, orient(P.dx, pitch, P.dz, roll), q.s);
  }
  done(m, k);
}

// ---------- トビウオ ----------
// 細長い銀青色の体に、翼のような大きな胸びれ。海面から飛び出し、胸びれを広げて数十 m 滑空する
function flyingGeo() {
  const body = K.fishGeo({ hgt: 0.17, wid: 0.12, mx: 0.55, snout: 0.8, top: 0.1, ped: 0.1, tail: { len: 0.3, fork: 0.6, lobe: 0.3, upper: -0.4 }, dorsal: [0.3, 0.5, 0.15], anal: [0.28, 0.45, 0.12], eye: [0.85, 0.85, 0.8],
    pat: (u, v) => K.mixc([0.82, 0.86, 0.9], [0.15, 0.25, 0.5], Math.max(0, v + 0.1) * 1.5), fin: () => [0.45, 0.55, 0.7] }, 0);
  // 胸びれ（翼）: 体長の 7 割ほどもある大きな扇。透けた青灰色に、濃い筋（ひれのすじ）。腹びれも小さな翼になる
  const wing = (sd, u0, span, back, c0) => {
    const N = 8, pos = [], col = [];
    for (let k = 0; k < N; k++) {
      const a0 = k / N, a1 = (k + 1) / N, tip = t => [u0 - 0.5 - back * t - 0.1 * t * t, 0.02 + 0.03 * t, sd * span * Math.sin(Math.PI * 0.5 * (0.35 + 0.65 * t))];
      pos.push(u0 - 0.5, 0.0, sd * 0.05, ...tip(a0), ...tip(a1));
      const dark = k % 2 ? 0.75 : 1; col.push(...c0, ...c0.map(v => v * dark), ...c0.map(v => v * dark));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  };
  return K.merge([body, wing(-1, 0.72, 0.62, 0.45, [0.45, 0.58, 0.78]), wing(1, 0.72, 0.62, 0.45, [0.45, 0.58, 0.78]), wing(-1, 0.42, 0.2, 0.2, [0.5, 0.6, 0.75]), wing(1, 0.42, 0.2, 0.2, [0.5, 0.6, 0.75])]);
}
const ffGeo = () => BAKE('flyingfish') || flyingGeo();
const ff = { mesh: mesh(ffGeo(), { roughness: 0.25, metalness: 0.3 }, 0, [], 30), list: [], next: 6 };
function flyingFrame(dt, t, px, pz, camD, floorHere, show, fwx, fwz) {
  ff.next -= dt;
  if (show && ff.next < 0 && camD < 6 && floorHere > 20 && ff.list.length < 20) {
    // 潜水艇の前方 12〜28m から、群れで飛び出す
    const n = 3 + Math.floor(Math.random() * 6), a0 = Math.atan2(fwz, fwx) + (Math.random() - 0.5) * 1.2, r0 = 12 + Math.random() * 16;
    const cx = px + Math.cos(a0) * r0, cz = pz + Math.sin(a0) * r0, dir = a0 + (Math.random() - 0.5) * 1.4;
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * 0.4, sp = 8 + Math.random() * 3;
      ff.list.push({ x: cx + (Math.random() - 0.5) * 6, z: cz + (Math.random() - 0.5) * 6, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, t0: t + Math.random() * 0.8, fly: 3 + Math.random() * 2, H: 0.7 + Math.random() * 0.9, s: 0.36 + Math.random() * 0.1 });
    }
    ff.next = 7 + Math.random() * 10;
  }
  let k = 0;
  ff.list = ff.list.filter(q => t < q.t0 + 0.5 + q.fly + 0.5);
  for (const q of ff.list) {
    const tau = t - q.t0; if (tau < 0) continue;
    let d, hy;
    if (tau < 0.5) { d = 0.8 - 1.6 * tau; hy = 0.5; }                                  // 水中で加速して、海面へ
    else if (tau < 0.5 + q.fly) { const s = (tau - 0.5) / q.fly; d = -q.H * Math.sin(Math.PI * s); hy = -Math.cos(Math.PI * s) * q.H * Math.PI / q.fly / 9; }   // 滑空
    else { d = (tau - 0.5 - q.fly) * 1.6; hy = -0.4; }                                 // 海へ戻る
    q.x += q.vx * dt; q.z += q.vz * dt;
    put(ff.mesh, k++, q.x - px, camD - d, q.z - pz, orient(q.vx, hy * 9, q.vz), q.s);
  }
  done(ff.mesh, k);
}

// ---------- キハダの群れ ----------
// 背は濃い青、横に金色の帯、腹は銀白色。長く伸びた黄色い第 2 背びれ・しりびれ
const tunaGeo = () => K.fishGeo({ hgt: 0.26, wid: 0.18, mx: 0.45, snout: 1.3, top: 0.12, ped: 0.05, tail: { len: 0.32, fork: 0.95, lobe: 1.0 }, dorsal: [0.38, 0.52, 0.55, 2.4], dorsal2: [0.62, 0.78, 0.22], anal: [0.3, 0.42, 0.6, 2.6], finlets: 7, eye: [0.8, 0.75, 0.6],
  pat: (u, v) => Math.abs(v - 0.22) < 0.07 && u > 0.2 && u < 0.8 ? [0.95, 0.8, 0.25] : K.mixc([0.86, 0.88, 0.9], [0.08, 0.13, 0.35], Math.max(0, v + 0.05) * 1.6),
  fin: (p, s) => p === 'dorsal' || p === 'anal' || p === 'finlet' ? [1.0, 0.85, 0.2] : p === 'tail' ? [0.15, 0.2, 0.35] : [0.3, 0.35, 0.5] }, 0);
const tunaGeo2 = () => BAKE('yellowfin') || tunaGeo();
const tuna = { mesh: K.instanced(tunaGeo2(), K.silverMat, 60), sc: null, next: 40 + Math.random() * 40 };
function tunaFrame(dt, t, px, pz, camD, floorHere, show) {
  const m = tuna.mesh;
  if (!tuna.sc) {
    tuna.next -= dt;
    if (!show || tuna.next > 0 || camD < 1 || camD > 45 || floorHere < 50) { done(m, 0); return; }
    const a = Math.random() * 6.283, sx = px + Math.cos(a) * 55, sz = pz + Math.sin(a) * 55, side = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 12);
    let dx = px - sx, dz = pz - sz; const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
    const n = 30 + Math.floor(Math.random() * 25), list = [];
    for (let i = 0; i < n; i++) list.push({ al: (Math.random() - 0.5) * 12, ac: (Math.random() - 0.5) * 7, ad: (Math.random() - 0.5) * 5, ph: Math.random() * 6.3, s: 1.0 + Math.random() * 0.4 });
    tuna.sc = { x: sx - dz * side, z: sz + dx * side, d: Math.max(5, Math.min(camD + (Math.random() - 0.3) * 10, 25)), dx, dz, list, t: 0 };
  }
  const P = tuna.sc; P.t += dt;
  P.x += P.dx * 2.6 * dt; P.z += P.dz * 2.6 * dt;
  if (P.t > 10 && Math.hypot(P.x - px, P.z - pz) > 80) { tuna.sc = null; tuna.next = 70 + Math.random() * 70; done(m, 0); return; }
  let k = 0;
  const q0 = orient(P.dx, 0, P.dz).clone();
  for (const q of P.list) {
    const w = Math.sin(t * 0.8 + q.ph);
    put(m, k++, P.x + P.dx * q.al - P.dz * (q.ac + w * 0.6) - px, camD - (P.d + q.ad + Math.sin(t * 0.6 + q.ph) * 0.4), P.z + P.dz * q.al + P.dx * (q.ac + w * 0.6) - pz, q0, q.s);
  }
  done(m, k);
}

// ---------- 流木とシイラ ----------
// 外洋（水深 80m より深い所）には、ところどころ流木や流れ藻が浮かび、その下にシイラが集まる。場所は 500m 四方の区画ごとの乱数で決まる
const FLOT = 500;
const logGeo = (() => {
  const trunk = K.paint(new THREE.CylinderGeometry(0.22, 0.28, 4.2, 9).rotateZ(Math.PI / 2), (x, y) => [0.42 + 0.06 * Math.sin(x * 9), 0.32, 0.22]);
  const br = [[1.2, 0.6], [-0.8, -0.7], [0.3, 0.9]].map(([x, a]) => K.paint(new THREE.CylinderGeometry(0.05, 0.09, 1.1, 6).translate(0, 0.55, 0).rotateZ(a).translate(x, 0.1, 0.05), () => [0.36, 0.28, 0.2]));
  const weed = [];
  for (let i = 0; i < 14; i++) weed.push(K.paint(new THREE.IcosahedronGeometry(0.22 + (i % 3) * 0.06, 0).scale(1, 0.5, 1).translate(-1.8 + i * 0.27, -0.12 + 0.05 * Math.sin(i), Math.sin(i * 2.3) * 0.35), () => [0.55, 0.45, 0.15]));   // 流れ藻（ホンダワラ）
  return K.merge([trunk, ...br, ...weed]);
})();
const logs = { mesh: mesh(logGeo, { roughness: 0.95 }, 0, [], 6) };
const mahiGeo = () => K.fishGeo({ hgt: 0.3, wid: 0.12, mx: 0.8, snout: 0.35, top: 0.45, ped: 0.06, tail: { len: 0.3, fork: 0.9, lobe: 0.6 }, dorsal: [0.15, 0.95, 0.22], anal: [0.15, 0.5, 0.15], eye: [0.85, 0.75, 0.3],
  pat: (u, v) => (Math.sin(u * 60) * Math.sin(v * 9) > 0.7 ? [0.25, 0.55, 0.95] : v > 0.3 ? [0.1, 0.5, 0.5] : v < -0.4 ? [1.0, 0.88, 0.35] : [0.6, 0.8, 0.25]),
  fin: (p, s) => p === 'dorsal' ? [0.15, 0.4, 0.75] : p === 'tail' ? [0.75, 0.75, 0.3] : [0.4, 0.6, 0.6] }, 0);
const mahiGeo2 = () => BAKE('mahi') || mahiGeo();
const mahi = { mesh: mesh(mahiGeo2(), { roughness: 0.3, metalness: 0.1 }, 1, [], 30, false) };
function flotFrame(dt, t, px, pz, camD, show) {
  let nl = 0, nm = 0;
  const flots = [];
  if (show) {
    const c0x = Math.round(px / FLOT), c0z = Math.round(pz / FLOT);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = c0x + i, cz = c0z + j; if (h(cx, cz, 520) > 0.3) continue;
      const x = (cx + h(cx, cz, 521) - 0.5) * FLOT, z = (cz + h(cx, cz, 522) - 0.5) * FLOT;
      if (Math.hypot(x - px, z - pz) > 150 || floorAt(x, z) < 80) continue;
      flots.push({ x, z, cx, cz });
    }
  }
  for (const f of flots) {
    const bob = 0.12 + 0.06 * Math.sin(t * 0.9 + f.cx), rot = h(f.cx, f.cz, 523) * 6.3;
    put(logs.mesh, nl++, f.x - px, camD - bob, f.z - pz, $Q.setFromAxisAngle($V.set(0, 1, 0), rot).multiply($Q2.setFromAxisAngle(X, 0.08 * Math.sin(t * 0.7))), 1);
    // シイラ: 流木の下を、2〜6m の輪を描いて回る
    const n = 3 + Math.floor(h(f.cx, f.cz, 524) * 4);
    for (let k = 0; k < n; k++) {
      const r = 2.5 + 3.5 * h(f.cx * 7 + k, f.cz, 525), sp = (0.9 + 0.4 * h(k, f.cx, 526)) / r * (k % 2 ? 1 : -1), a = t * sp + k * 1.7, d = 1.2 + 2.5 * h(k, f.cz, 527) + 0.3 * Math.sin(t * 0.5 + k);
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      put(mahi.mesh, nm++, x - px, camD - d, z - pz, orient(-Math.sin(a) * Math.sign(sp), 0, Math.cos(a) * Math.sign(sp)), 0.9 + 0.3 * h(k, f.cx, 528));
      f.mahi = f.mahi || []; f.mahi.push({ x, z, d });
    }
  }
  done(logs.mesh, nl); done(mahi.mesh, nm);
  return flots;
}

// ---------- 図鑑 ----------
const D = (k, name, sci, from, to, where, note, geo, rot) => K.D(k, name, sci, from, to, where, note, K.thumbMesh(geo, 0xffffff, rot));
const DEF = {
  dolphin: D('dolphin', 'ハシナガイルカ', 'Stenella longirostris', 0, 50, '外洋の海面近く（グアムの西の湾に、毎朝のように群れが来る）',
    '細長いくちばしのイルカ。数十頭の群れで泳ぎ、海面から高く跳び上がって、体の軸のまわりにくるくる回る。昼は湾で休み、夜は沖へ出てイカや小魚を食べる。', dolGeo),
  flyfish: D('flyfish', 'トビウオの仲間', 'Exocoetidae（トビウオ科）', 0, 20, '外洋の海面近く',
    '翼のような大きな胸びれを持つ魚。シイラなどに追われると、海面から飛び出して胸びれを広げ、数十 m も滑空して逃げる。', ffGeo, 0.5),
  yellowfin: D('yellowfin', 'キハダ', 'Thunnus albacares', 0, 250, '外洋（水深 50m より深い海の、表層）',
    '長く伸びた黄色い背びれとしりびれが目印のマグロ。群れで外洋を速く泳ぎ回り、小魚やイカを食べる。', tunaGeo2),
  mahi: D('mahi', 'シイラ', 'Coryphaena hippurus', 0, 30, '外洋の海面近く（流木や流れ藻の下）',
    '金色と青緑にかがやく、額の切り立った魚。流木や流れ藻の下に集まる小魚を狙って、そのまわりを泳ぐ。グアムでも人気の釣りの魚。', mahiGeo2)
};
Object.values(DEF).forEach(d => R.species.push(d));
// 左の欄の「この深さで出会える生き物」: 外洋（水深 50m より深い海の上）の水深 40m より浅い所
R.nearbyExtra.push((px, pz, depth, floorD) => floorD > 50 && depth < 40 ? [DEF.dolphin, DEF.yellowfin, DEF.mahi, DEF.flyfish] : []);
// 出会い: 30m 以内（シイラは 12m 以内）で、画面の正面近くに見えたとき。トビウオとイルカは、海面にいるときも
const FWD = new THREE.Vector3();
let meetT = 0;
function seen(x, d, z, px, pz, camD, R0) {
  const dx = x - px, dy = camD - d, dz = z - pz, e = Math.hypot(dx, dy, dz);
  return e < R0 && e > 0.1 && (dx * FWD.x + dy * FWD.y + dz * FWD.z) / e > 0.8;
}
function checkMeet(dt, px, pz, camD, flots) {
  if ((meetT -= dt) > 0) return; meetT = 0.3;
  T.camera.getWorldDirection(FWD);
  const md = Math.max(0, camD);
  if (dol.pod && dol.pod.list.some(q => seen(q.x, q.d, q.z, px, pz, camD, 30))) K.meetDef(DEF.dolphin, md);
  if (ff.list.some(q => seen(q.x, 0, q.z, px, pz, camD, 30))) K.meetDef(DEF.flyfish, md);
  if (camD > 0.5 && tuna.sc) { const P = tuna.sc; if (seen(P.x, P.d, P.z, px, pz, camD, 30)) K.meetDef(DEF.yellowfin, md); }
  if (camD > 0.5) for (const f of flots) if ((f.mahi || []).some(q => seen(q.x, q.d, q.z, px, pz, camD, 12))) K.meetDef(DEF.mahi, md);
}
// 撮影: 画面の中央近くに大きく写っているもの
let lastFlots = [];
function subject(fwd, px, pz, depth) {
  let best = null, score = 0;
  const check = (def, x, d, z, size) => {
    const dx = x - px, dy = depth - d, dz = z - pz, e = Math.max(0.01, Math.hypot(dx, dy, dz));
    if (e > Math.max(3, size * 40)) return;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / e; if (dot < 0.8) return;
    if (size / e * dot > score) { score = size / e * dot; best = def; }
  };
  if (dol.pod) dol.pod.list.forEach(q => check(DEF.dolphin, q.x, q.d, q.z, 1.8));
  ff.list.forEach(q => check(DEF.flyfish, q.x, 0, q.z, 0.3));
  if (tuna.sc) check(DEF.yellowfin, tuna.sc.x, tuna.sc.d, tuna.sc.z, 1.2);
  lastFlots.forEach(f => (f.mahi || []).forEach(q => check(DEF.mahi, q.x, q.d, q.z, 1)));
  return best && { def: best, score };
}

// ---------- 毎フレーム（creatures.js の update から。深い海の上・海面の上でも呼ばれる） ----------
const ALL = [dol.mesh, ff.mesh, tuna.mesh, logs.mesh, mahi.mesh];
function frame(dt, t, { dive, under, depth }) {
  dt = Math.min(dt, 0.1);
  K.TIME.value = t;
  const camD = under ? depth : -T.camera.position.y * 1000;               // カメラの水深（海面の上はマイナス）
  CAMD.value = camD;
  const show = dive && camD < 60 && camD > -60;
  airOn = show && !under;
  if (!show) { ALL.forEach(m => done(m, 0)); lastFlots = []; return; }
  const px = S.x * 1000, pz = S.z * 1000, floorHere = floorAt(px, pz);
  T.camera.getWorldDirection(FWD); const fl = Math.hypot(FWD.x, FWD.z) || 1;
  dolphinFrame(dt, t, px, pz, camD, floorHere, true);
  flyingFrame(dt, t, px, pz, camD, floorHere, true, FWD.x / fl, FWD.z / fl);
  tunaFrame(dt, t, px, pz, camD, floorHere, true);
  lastFlots = flotFrame(dt, t, px, pz, camD, true);
  checkMeet(dt, px, pz, camD, lastFlots);
}
REEF.pelagic = frame;
REEF.warm = () => {                                                   // 潜航の始めに、海面より上を描く場面の材質も作っておく（creatures.js の warmAll から）
  AIR_MESHES.forEach(m => airScene.add(m)); T.renderer.compile(airScene, airCam); AIR_MESHES.forEach(m => scene.add(m));
};
window.__PELAGIC = { dol, ff, tuna, DEF };                                // 確認用
REEF.renderAir = renderAir;
// （サンゴ礁の生き物を隠す REEF.hide は、海面の上でも呼ばれるので、ここでは使わない。見せるかどうかは frame が決める）
{ const prevSub = REEF.subject; REEF.subject = (fwd, px, pz, depth) => {
  const a = prevSub && prevSub(fwd, px, pz, depth), b = subject(fwd, px, pz, depth);
  return a && b ? (a.score >= b.score ? a : b) : a || b;
}; }

// ---------- 見どころの体: 沈船（東海丸） ----------
// 1930 年代の貨物船（全長約 137m）。左舷を下に横倒しで沈み、船体は錆と海綿・サンゴに覆われている。体の大きさは size（全長 m）
function buildWreck(size) {
  const g = new THREE.Group();
  const B = 0.065, Dh = 0.085;                                          // 船幅の半分・船の深さ（全長 1 に対して）
  const half = x => B * Math.min(Math.pow(Math.max(0, (0.5 - x) / 0.14), 0.55), Math.pow(Math.max(0, (x + 0.5) / 0.04), 0.35), 1);   // 船首は細く、船尾は丸く切れる
  const keelY = x => Dh * 0.6 * Math.pow(Math.max(0, (x - 0.36) / 0.14), 2);   // 船首の下は持ち上がる
  const noise = (x, y, z) => 0.5 + 0.25 * Math.sin(x * 61 + y * 37) * Math.sin(z * 53 - x * 29) + 0.25 * Math.sin(x * 211 + z * 177) * Math.sin(y * 193);
  const crust = (x, y, z) => {                                          // 錆・ピンクの石灰藻・橙の海綿のまだら
    const n = noise(x, y, z), m = noise(z * 1.3 + 5, x * 0.7, y + 3);
    let c = [0.42 + 0.15 * n, 0.3 + 0.08 * n, 0.22];
    if (m > 0.68) c = [0.75, 0.42, 0.55]; else if (m < 0.22) c = [0.9, 0.55, 0.22]; else if (n > 0.72) c = [0.3, 0.42, 0.3];
    return c;
  };
  const NU = 60, NV = 18, pos = [], col = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const x = -0.5 + i / NU, b = half(x), k0 = keelY(x), top = Dh + 0.012 * Math.pow(2 * x, 2);
    for (let j = 0; j <= NV; j++) {
      const th = Math.PI * j / NV, c = Math.cos(th), s = Math.sin(th);
      const z = b * Math.sign(c) * Math.pow(Math.abs(c), 0.35), y = k0 + (top - k0) * (1 - Math.pow(s, 4));
      pos.push(x, y, z); col.push(...crust(x, y, z));
      if (i < NU && j < NV) { const a = i * (NV + 1) + j, bb = a + NV + 1; idx.push(a, bb, a + 1, bb, bb + 1, a + 1); }
    }
  }
  const hull = new THREE.BufferGeometry(); hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); hull.setIndex(idx); hull.computeVertexNormals();
  const parts = [hull];
  // 甲板（船体の上の縁を結ぶ板）
  { const dp = [], dc = [], di = [];
    for (let i = 0; i <= NU; i++) { const x = -0.5 + i / NU, b = half(x) * 0.98, y = Dh + 0.012 * Math.pow(2 * x, 2) - 0.002; dp.push(x, y, -b, x, y, b); dc.push(...crust(x, y, -b), ...crust(x, y, b)); if (i < NU) { const a = i * 2; di.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
    const deck = new THREE.BufferGeometry(); deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); deck.setAttribute('color', new THREE.Float32BufferAttribute(dc, 3)); deck.setIndex(di); deck.computeVertexNormals(); parts.push(deck); }
  const box = (x, y, z, sx, sy, sz) => K.paint(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), (a, b2, c2) => crust(a + x, b2 + y, c2 + z));
  [0.33, 0.2, -0.28, -0.38].forEach(x => parts.push(box(x, Dh + 0.008, 0, 0.07, 0.014, 0.06)));              // 船倉のハッチ
  parts.push(box(-0.08, Dh + 0.03, 0, 0.13, 0.05, 0.09), box(-0.07, Dh + 0.065, 0, 0.07, 0.025, 0.07));   // 船橋（ブリッジ）
  parts.push(K.paint(new THREE.CylinderGeometry(0.012, 0.013, 0.05, 10).translate(-0.12, Dh + 0.08, 0), (a, b2, c2) => crust(a, b2, c2)));   // 煙突
  [0.26, -0.33].forEach(x => parts.push(K.paint(new THREE.CylinderGeometry(0.003, 0.005, 0.13, 6).translate(x, Dh + 0.065, 0), () => [0.35, 0.28, 0.22])));   // マスト
  const geo = K.merge(parts);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  m.castShadow = m.receiveShadow = true;
  // 左舷を下に、横倒し（少し起き上がった向き）。いちばん低い所を海底（y = 0）に合わせる
  const lie = new THREE.Group(); lie.add(m); lie.rotation.x = -Math.PI / 2 * 0.93; lie.position.y = B * 0.8;   // 少し砂に埋まる
  g.add(lie); g.scale.setScalar(size);
  // 障害物（潜水艇がめり込まないように）: 船体に沿って、円と高さ（m）
  const obst = [];
  for (let x = -0.46; x <= 0.47; x += 0.05) obst.push({ x: x * size, z: -Dh * 0.45 * size, r: Math.max(half(x), Dh * 0.5) * 1.15 * size, h: (B * 0.8 + half(x) * 0.98) * size });
  return { group: g, animate() {}, obst };
}
// タイマイ: アオウミガメの体を使い、べっこう色にする
const SP = window.SPECIES || (window.SPECIES = {});
SP.wreck = buildWreck;
if (SP.turtle) SP.hawksbill = size => {
  const b = SP.turtle(size);
  b.group.traverse(o => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.color) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(1.45, 1.05, 0.62)); } });
  return b;
};
})();
