// 外洋の海面近くの生き物と、ダイブポイントの見どころの体。
//   ハシナガイルカの群れ（海面でジャンプして回る）・トビウオ（海面から飛び出して滑空する）・キハダの群れ・小魚の群れ（ベイトボール）とそれを襲うキハダ・
//   流木につくシイラ・ブリモドキ・ツムブリ・クロトガリザメ、海面に浮かぶカツオノカンムリ、
//   沈船（東海丸）の体、タイマイ（アオウミガメの体の色を変える）。
// 潜っているときは近景の世界（creatures.js）に描き、海面にいるときは、海面より上に出た体だけを別に描く。
(() => {
const L = window.__LIFE, A = L && L.reefApi, R = window.__REEF, T = window.__TRENCH, S = window.__DIVE, SEA = window.__SEA;
if (!A || !R || !R.kit) return;
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
// 向き: 進む向き (hx, hy, hz) に頭（+x）を向け、体の軸のまわりに roll だけ回す。
// 左右の向き → 上下の傾き → 体の軸のまわり、の順に回す（最短の回転で向けると、向きによっては背と腹がひっくり返り、くるっと回って見えるため）
const $E = new THREE.Euler();
function orient(hx, hy, hz, roll = 0) {
  return $Q.setFromEuler($E.set(roll, Math.atan2(-hz, hx), Math.atan2(hy, Math.hypot(hx, hz)), 'YZX'));
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
  // 声: 群れが 80m 以内にいると、ときどきホイッスルやクリック音が聞こえる（近いほど大きく、来る方向から）
  { const e = Math.hypot(P.x - px, P.z - pz); P.voice = (P.voice || 0) - dt;
    if (e < 80 && P.voice <= 0 && window.__AUDIO && window.__AUDIO.dolphin) {
      const fl = Math.hypot(FWD.x, FWD.z) || 1, a = Math.atan2(P.x - px, P.z - pz) - Math.atan2(FWD.x / fl, FWD.z / fl);
      window.__AUDIO.dolphin(0.05 + 0.25 * Math.pow(1 - e / 80, 1.5), Math.sin(a)); P.voice = 0.3 + Math.random() * 1.6;
    } }
  if (P.t > 15 && Math.hypot(P.x - px, P.z - pz) > 90) { dol.pod = null; dol.next = 60 + Math.random() * 60; done(m, 0); return; }
  let k = 0;
  for (const q of P.list) {
    const wob = Math.sin(t * 0.5 + q.ph * 20);
    const x = P.x + P.dx * q.al - P.dz * (q.ac + wob), z = P.z + P.dz * q.al + P.dx * (q.ac + wob);
    let d, roll = 0, pitch;
    if (q.jump) {                                                       // ジャンプ: 海面から飛び出し、体の軸のまわりに 2〜3 回転して落ちる
      const tau = t - q.jump.t0, T0 = 2 * q.jump.v / 9.8;
      if (tau > T0) { q.back = { t0: q.jump.t0 + T0, v: q.jump.v }; q.jump = null; }   // 水に戻る: 飛び込んだ勢いのまま潜る（下で続ける）
      else { d = -(q.jump.v * tau - 4.9 * tau * tau); roll = tau / T0 * Math.PI * 2 * q.jump.turns; }
    }
    if (!q.jump) {
      // 息つぎ: 7〜12 秒ごとに、海面すれすれまで上がる（背中と背びれが海面に出る）
      const p = ((t / q.per + q.ph) % 1 + 1) % 1, pulse = Math.exp(-Math.pow((p - 0.5) / 0.07, 2));
      d = q.base + (-0.15 - q.base) * pulse;
      if (q.back) {                                                    // ジャンプのあと: 飛び込んだ勢いで数 m 潜り、1〜2 秒かけて、ふだんの深さへなめらかに戻る
        const u = t - q.back.t0, dv = Math.max(0, q.back.v * u - 2.5 * u * u), w = Math.min(1, Math.max(0, (u - 0.6) / 1.6));
        d = dv + (d - dv) * w * w * (3 - 2 * w);
        if (u > 2.2) q.back = null;
      }
      else if (pulse > 0.95 && Math.random() < dt * 0.6 && P.t > 4) q.jump = { t0: t, v: 5 + Math.random() * 2, turns: Math.random() < 0.6 ? 2 + Math.floor(Math.random() * 2) : 0 };
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

// ---------- 小魚の群れ（ベイトボール）と、それを襲うキハダ ----------
// クサヤモロ（ムロアジの仲間。体長 25cm ほど）の群れが、キハダに追われて球のように固まる。外洋でいちばん見ごたえのある光景のひとつ。
// 逃げ場をなくした小魚は、すき間なく集まって渦を巻く。キハダは群れのまわりを回り、ときどき群れの中へ突っ込む。
// 突っ込まれた所だけ小魚が割れて広がり、銀色にきらめく。追われた群れは、だんだん海面へ押し上げられ、しばらくすると、ほどけて散っていく
const scadO = { hgt: 0.21, wid: 0.11, mx: 0.5, snout: 1.2, top: 0.06, ped: 0.1, tail: { len: 0.22, fork: 0.85, lobe: 0.45 }, dorsal: [0.3, 0.62, 0.15], anal: [0.25, 0.45, 0.1], finlets: 1, eye: [0.86, 0.78, 0.7],
  pat: (u, v) => (u > 0.77 && u < 0.8 && v > 0.15 && v < 0.4) ? [0.1, 0.12, 0.14] : K.mixc([0.88, 0.9, 0.92], [0.16, 0.36, 0.55], Math.max(0, v + 0.1) * 1.4),   // 背は青緑、横と腹は銀白色。えらぶたに小さな黒い点
  fin: (p, s) => p === 'tail' ? K.mixc([0.7, 0.68, 0.55], [0.5, 0.45, 0.32], s) : [0.6, 0.65, 0.7] };
// 群れの数と大きさは画質で決める（本物のベイトボールは数千〜数万匹。魚どうしの間は体 1 つ分ほどで、外からは銀色の壁のように見える）
const BAIT_Q = { high: [2400, 2.8], mid: [1200, 2.4], low: [500, 1.9] }[S.quality] || [1200, 2.4];
const BAIT_N = BAIT_Q[0], BAIT_NEAR = 120, HUNT_N = 8;
// はがれた鱗: 襲われた所に散り、日の光にちらちら光りながら、ゆらゆら沈む
const SCALE_N = 1500;
const scales = (() => {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(SCALE_N * 3), col = new Float32Array(SCALE_N * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setDrawRange(0, 0);
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const x = cv.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.022, map: new THREE.CanvasTexture(cv), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; pts.visible = false; scene.add(pts);
  return { pts, pos, col, list: [] };
})();
function spawnScales(x, z, d, n) {
  for (let k = 0; k < n; k++) {
    if (scales.list.length >= SCALE_N) scales.list.shift();
    scales.list.push({ x: x + (Math.random() - 0.5) * 1.6, z: z + (Math.random() - 0.5) * 1.6, d: d + (Math.random() - 0.5) * 1.2, vs: 0.05 + Math.random() * 0.07, age: 0, life: 25 + Math.random() * 15, ph: Math.random() * 6.3, sp: 2 + Math.random() * 5, fl: 0.4 + Math.random() * 0.8 });
  }
}
function scalesFrame(dt, t, px, pz, camD) {
  const L2 = scales.list = scales.list.filter(q => (q.age += dt) < q.life);
  let n = 0;
  for (const q of L2) {
    q.d += q.vs * dt; q.x += Math.sin(t * q.fl + q.ph) * 0.04 * dt; q.z += Math.cos(t * q.fl * 0.8 + q.ph) * 0.04 * dt;   // ゆらゆら沈む
    const e = Math.hypot(q.x - px, q.d - camD, q.z - pz); if (e > 30) continue;
    const tw = 0.12 + 0.88 * Math.pow(Math.max(0, Math.sin(t * q.sp + q.ph)), 6), fade = Math.min(1, q.age * 2) * Math.min(1, (q.life - q.age) / 4);   // 向きが変わるたびに、ちらっと光る
    scales.pos[n * 3] = q.x - px; scales.pos[n * 3 + 1] = camD - q.d; scales.pos[n * 3 + 2] = q.z - pz;
    const b = tw * fade; scales.col[n * 3] = 0.85 * b; scales.col[n * 3 + 1] = 0.92 * b; scales.col[n * 3 + 2] = 1.0 * b; n++;
  }
  scales.pts.geometry.setDrawRange(0, n); scales.pts.visible = n > 0;
  if (n) { scales.pts.geometry.attributes.position.needsUpdate = true; scales.pts.geometry.attributes.color.needsUpdate = true; }
}
// 捕食者が群れの真ん中を突き抜けたとき: 群れ全体が一瞬はじけるように広がり（フラッシュ拡散）、襲われた側から銀色のきらめきの波が走る。
// 何匹か食べられて、鱗が散る
function attack(P, h, eat) {
  P.flash = Math.max(P.flash, 0.8);
  const ax = h.x - P.x, az = h.z - P.z, al = Math.hypot(ax, az) || 1;
  P.wave = { t0: P.t, x: ax / al, z: az / al, amp: 1 };
  let k = 0; for (const q of P.fish) { if (k >= eat) break; if (q.alive && Math.random() < 0.02) { q.alive = false; P.alive--; k++; } }
  spawnScales(P.x, P.z, P.d, 60 + Math.floor(Math.random() * 80));
}
const bait = {
  far: K.instanced(K.fishGeo(scadO, 1), K.silverMat, BAIT_N),          // 遠く（6m より先）の魚は、面の少ない形で
  near: K.instanced(K.fishGeo(scadO, 0), K.silverMat, BAIT_NEAR),
  hunt: K.instanced(tunaGeo2(), K.silverMat, HUNT_N),
  ball: null, next: 20 + Math.random() * 20                            // 潜ってから最初の群れは早めに
};
[bait.far, bait.near, bait.hunt].forEach(m => { m.castShadow = false; });
// クロカジキ: ベイトボールに遠くからやって来て、まわりを大きく回り、ときどき群れへ突っ込む。
// 群れの中で、くちばしを左右に大きく振って小魚を打ち、弱った小魚を食べる（体は species2.js のクロカジキを使う）
const MARLIN_SIZE = 3.4;
function marlinFrame(P, end, dt, t, px, pz, camD) {
  const B = bait;
  if (P.t < P.marlinAt) { if (B.mBody) B.mBody.group.visible = false; return; }
  if (!B.mBody) {
    if (!window.SPECIES || !window.SPECIES.marlin) { P.marlinAt = Infinity; return; }
    B.mBody = window.SPECIES.marlin(MARLIN_SIZE); A.withCaustics(B.mBody.group); scene.add(B.mBody.group);
  }
  const m = P.marlin || (P.marlin = { th: Math.random() * 6.283, rc: 40, dd: (Math.random() - 0.5) * 2, wait: 6, dash: null, x: P.x, z: P.z, d: P.d, vx: 0, vy: 0, vz: 1, yaw: 0, sp: 2.5 });
  const ox = m.x, oy = m.d, oz = m.z;
  let slash = 0;
  if (end > 0) { m.dash = null; m.rc += 4 * dt; }
  if (m.dash) {
    const D = m.dash, k = Math.min(1, (P.t - D.t0) / D.dur), e = k * k * (3 - 2 * k);
    m.x = D.ax + (D.bx - D.ax) * e; m.z = D.az + (D.bz - D.az) * e; m.d = D.ad + (D.bd - D.ad) * e;
    if (k > 0.35 && k < 0.75) {                                        // 群れの中: くちばしを左右に振って、小魚を打つ
      slash = 0.45 * Math.sin((k - 0.35) / 0.4 * Math.PI * 3);
      if (!D.hit) { D.hit = true; attack(P, m, 10 + Math.floor(Math.random() * 10)); }
    }
    if (k >= 1) { m.th = D.thB; m.dash = null; m.wait = 8 + Math.random() * 8; }
  } else {
    if (end === 0) m.rc += (12 - m.rc) * Math.min(1, dt * 0.25);       // 遠くから近づいてくる
    m.th += 2.5 / m.rc * dt * -P.dir; m.wait -= dt;                      // キハダと反対まわりに
    m.x = P.x + Math.cos(m.th) * m.rc; m.z = P.z + Math.sin(m.th) * m.rc; m.d = P.d + m.dd + Math.sin(t * 0.3) * 0.6;
    if (m.wait < 0 && end === 0 && m.rc < 14) {
      const thB = m.th + Math.PI + (Math.random() - 0.5) * 0.6;
      m.dash = { t0: P.t, dur: m.rc * 2 / 8, ax: m.x, az: m.z, ad: m.d, bx: P.x + Math.cos(thB) * m.rc, bz: P.z + Math.sin(thB) * m.rc, bd: P.d + (Math.random() - 0.5) * 1.5, thB };
    }
  }
  if (dt > 0) { const k6 = Math.min(1, dt * 4); m.vx += ((m.x - ox) / dt - m.vx) * k6; m.vy += ((m.d - oy) / dt - m.vy) * k6; m.vz += ((m.z - oz) / dt - m.vz) * k6; }
  m.yaw += (slash - m.yaw) * Math.min(1, dt * 10);
  const g = B.mBody.group, hv = Math.hypot(m.vx, m.vz) || 1;
  g.position.set(m.x - px, camD - m.d, m.z - pz);
  g.rotation.set(Math.atan2(m.vy, hv) * 0.6, Math.atan2(m.vx, m.vz) + m.yaw, 0, 'YXZ');
  g.visible = true;
  B.mBody.animate(t, Math.min(2, hv / 1.6));
}
function baitFrame(dt, t, px, pz, camD, floorHere, fwx, fwz) {
  const B = bait;
  if (!B.ball) {
    B.next -= dt;
    if (B.next > 0 || camD < 2 || camD > 45 || floorHere < 80) { done(B.far, 0); done(B.near, 0); done(B.hunt, 0); return; }
    // 前方 32〜42m（霧の向こうに、ぼんやり見えはじめる所）に、水深 6〜25m で
    const a = Math.atan2(fwz, fwx) + (Math.random() - 0.5) * 1.4, r = 32 + Math.random() * 10, R0 = BAIT_Q[1] + Math.random() * 0.5;   // すき間なく固まった、直径 4〜6m ほどの群れ
    const fish = [];
    for (let i = 0; i < BAIT_N; i++) {
      // 球の中の位置: 中心からの水平の距離 rho・高さ y（球の半径を 1 として）。真ん中は少しあける（いちばん内側の魚も、小さく回りすぎないように）
      const u = Math.cbrt(0.1 + 0.9 * Math.random()), ct = Math.random() * 2 - 1;
      fish.push({ rho: Math.max(0.28, u * Math.sqrt(1 - ct * ct)), y: u * ct, a: Math.random() * 6.283, w: 0.9 + Math.random() * 0.3, ph: Math.random() * 6.3, s: 0.2 + Math.random() * 0.06, ox: 0, oy: 0, oz: 0, fl: 0, alive: true, lobe: i % 2 ? 1 : -1 });   // lobe: 群れが 2 つに分かれたとき、どちらに入るか
    }
    const hunters = [];
    for (let j = 0, n = 5 + Math.floor(Math.random() * 4); j < n; j++)
      hunters.push({ th: Math.random() * 6.283, rc: 8 + Math.random() * 5, dd: (Math.random() - 0.5) * 4, wait: 2 + Math.random() * 6, dash: null, s: 1.0 + Math.random() * 0.4, x: 0, z: 0, d: 0, vx: 1, vy: 0, vz: 0 });
    B.ball = { x: px + Math.cos(a) * r, z: pz + Math.sin(a) * r, d: Math.max(6, Math.min(25, camD + (Math.random() - 0.3) * 8)), R: R0, dir: Math.random() < 0.5 ? 1 : -1, t: 0, life: 80 + Math.random() * 40, fish, hunters,
      marlinAt: Math.random() < 0.4 ? 12 + Math.random() * 20 : Infinity, marlin: null,
      alive: BAIT_N, flash: 0, wave: null, nextWave: 3 + Math.random() * 4, split: null, nextSplit: 15 + Math.random() * 15, ph: [0, 1, 2, 3].map(() => Math.random() * 6.3) };
  }
  const P = B.ball; P.t += dt;
  const end = Math.max(0, P.t - P.life);                               // 終わり: キハダが去り、群れがほどける
  if (end > 7 || Math.hypot(P.x - px, P.z - pz) > 140) { B.ball = null; B.next = 60 + Math.random() * 60; done(B.far, 0); done(B.near, 0); done(B.hunt, 0); if (B.mBody) B.mBody.group.visible = false; return; }
  P.d += (2.5 - P.d) * Math.min(1, dt * 0.012);                        // 追われて、だんだん海面へ
  P.x += Math.sin(t * 0.05) * 0.15 * dt; P.z += Math.cos(t * 0.04) * 0.15 * dt;
  const spread = 1 + end * end * 0.6;
  // キハダ: 群れのまわりを回り、ときどき群れの中を突っ切る（反対側へ抜けて、また回る）
  let kh = 0;
  for (const h of P.hunters) {
    const ox = h.x, oy = h.d, oz = h.z;
    if (end > 0) {                                                     // 去っていく
      h.dash = null; h.rc += 5 * dt;
      h.th += 3 / h.rc * dt * P.dir;
      h.x = P.x + Math.cos(h.th) * h.rc; h.z = P.z + Math.sin(h.th) * h.rc; h.d = P.d + h.dd;
    } else if (h.dash) {
      const D = h.dash, k = Math.min(1, (P.t - D.t0) / D.dur), e = k * k * (3 - 2 * k);
      h.x = D.ax + (D.bx - D.ax) * e; h.z = D.az + (D.bz - D.az) * e; h.d = D.ad + (D.bd - D.ad) * e + Math.sin(Math.PI * k) * D.arc;
      if (k >= 1) { h.th = D.thB; h.dash = null; h.wait = 3 + Math.random() * 6; }
      else if (!D.ate && k > 0.4 && k < 0.6) {                         // 群れの真ん中を突き抜ける
        D.ate = true; attack(P, h, 5 + Math.floor(Math.random() * 8));
      }
    } else {
      h.th += 3 / h.rc * dt * P.dir; h.wait -= dt;
      h.x = P.x + Math.cos(h.th) * h.rc; h.z = P.z + Math.sin(h.th) * h.rc; h.d = P.d + h.dd + Math.sin(t * 0.4 + h.rc) * 0.8;
      if (h.wait < 0 && P.t > 4) {
        const thB = h.th + Math.PI + (Math.random() - 0.5) * 0.8, len = h.rc * 2;
        h.dash = { t0: P.t, dur: len / 7.5, ax: h.x, az: h.z, ad: h.d, bx: P.x + Math.cos(thB) * h.rc, bz: P.z + Math.sin(thB) * h.rc, bd: P.d + (Math.random() - 0.5) * 3, thB, arc: (Math.random() - 0.5) * 1.5, ate: false };
      }
    }
    if (dt > 0) { const vx = (h.x - ox) / dt, vy = (h.d - oy) / dt, vz = (h.z - oz) / dt; if (Math.hypot(vx, vz) > 0.1) { const k6 = Math.min(1, dt * 6); h.vx += (vx - h.vx) * k6; h.vy += (vy - h.vy) * k6; h.vz += (vz - h.vz) * k6; } }
    put(B.hunt, kh++, h.x - px, camD - h.d, h.z - pz, orient(h.vx, -h.vy, h.vz), h.s);
  }
  done(B.hunt, kh);
  marlinFrame(P, end, dt, t, px, pz, camD);
  // 小魚: 群れの中を渦を巻いて回る。群れの形はたえず変わる（つぶれる・横に伸びる・縁が波打つ・ときどき 2 つに分かれてまた合わさる）。
  // 突っ込んでくる捕食者の近くでは、通り道から押しのけられて割れ（噴水のように割れて、後ろで閉じる）、きらめく
  const dashing = P.hunters.filter(h => h.dash);
  if (P.marlin && P.marlin.dash) dashing.push(P.marlin);
  P.flash *= Math.exp(-dt * 2.5);
  if (!P.wave && P.t > P.nextWave) { const a = Math.random() * 6.283; P.wave = { t0: P.t, x: Math.cos(a), z: Math.sin(a), amp: 0.55 }; P.nextWave = P.t + 5 + Math.random() * 5; }   // 襲われていなくても、ときどき小さな波
  let wf = null; const W = P.wave; if (W) { wf = 1.25 - (P.t - W.t0) * 2.4; if (wf < -1.5) { P.wave = null; wf = null; } }   // 波の先（群れの半径を 1 として、襲われた側 +1 → 反対側 -1）
  if (!P.split && P.t > P.nextSplit && end === 0) { P.split = { t0: P.t, hold: 4 + Math.random() * 3, a: Math.random() * 6.283 }; P.nextSplit = P.t + 22 + Math.random() * 15; }
  let sp = 0; if (P.split) { const u = P.t - P.split.t0, H2 = P.split.hold; sp = u < 3 ? u / 3 : u < 3 + H2 ? 1 : u < 7 + H2 ? 1 - (u - 3 - H2) / 4 : 0; sp = sp * sp * (3 - 2 * sp); if (u > 7 + H2) P.split = null; }
  const R1 = P.R * spread * Math.cbrt(Math.max(0.2, P.alive / BAIT_N)) * (1 + 0.32 * P.flash) * (1 - 0.2 * sp);   // 食べられて小さくなる。分かれると 1 つずつは小さい
  const ex = 1 + 0.22 * Math.sin(P.t * 0.11 + P.ph[0]), ey = 1 - 0.22 * Math.sin(P.t * 0.09 + P.ph[1]), ea = P.t * 0.05 + P.ph[2], ce = Math.cos(ea), se = Math.sin(ea);
  const sa = P.split ? P.split.a : 0, sep = sp * R1 * 1.15;
  let nf = 0, nn = 0;
  for (const q of P.fish) {
    if (!q.alive) continue;
    const Rb = R1 * (1 + 0.06 * Math.sin(t * 0.7 + q.ph)) * (1 + 0.09 * Math.sin(2 * q.a + P.t * 0.6 + P.ph[3]) * Math.cos(3 * q.y + P.t * 0.4)), rr = q.rho * Rb;   // 縁が波打つ
    q.a += P.dir * q.w * 1.1 / Math.max(0.8, rr) * dt;
    let lx = Math.cos(q.a) * rr, lz = Math.sin(q.a) * rr;
    const pe = (lx * ce + lz * se) * ex, pp = (-lx * se + lz * ce) / Math.sqrt(ex); lx = pe * ce - pp * se; lz = pe * se + pp * ce;   // 横に伸びる・縮む
    const ly = q.y * Rb * 0.75 * ey;
    const cx = P.x + q.lobe * Math.cos(sa) * sep, cz = P.z + q.lobe * Math.sin(sa) * sep;
    const x0 = cx + lx, z0 = cz + lz, d0 = P.d - ly + 0.12 * Math.sin(t * 0.9 + q.ph);
    let tx = 0, ty = 0, tz = 0, fl = 0;
    for (const h of dashing) {
      const ex2 = x0 - h.x, ey2 = d0 - h.d, ez2 = z0 - h.z, e = Math.hypot(ex2, ey2, ez2) || 1;
      if (e < 2.4) { const k = (2.4 - e) / 2.4, push = k * 1.5; tx += ex2 / e * push; ty += ey2 / e * push; tz += ez2 / e * push; fl = Math.max(fl, k); }
    }
    const grow = tx * tx + ty * ty + tz * tz > q.ox * q.ox + q.oy * q.oy + q.oz * q.oz, kk = Math.min(1, dt * (grow ? 8 : 1.2));   // さっと割れて、ゆっくり戻る
    q.ox += (tx - q.ox) * kk; q.oy += (ty - q.oy) * kk; q.oz += (tz - q.oz) * kk;
    q.fl += (fl - q.fl) * Math.min(1, dt * 5);
    const x = x0 + q.ox, d = d0 + q.oy, z = z0 + q.oz;
    // きらめきの波: 波の先が通ると、体を傾けて、わき腹が光る
    let wv = 0; if (wf != null) { const c = (lx * W.x + lz * W.z) / Math.max(0.5, R1); wv = W.amp * Math.exp(-Math.pow((c - wf) / 0.22, 2)); }
    // 向き: 渦の向き（ほどけるときは外へ）。押しのけられた向きにも少し
    const hx = -Math.sin(q.a) * P.dir + q.ox * 0.8 + Math.cos(q.a) * end * 0.5, hz = Math.cos(q.a) * P.dir + q.oz * 0.8 + Math.sin(q.a) * end * 0.5, hy = -q.oy * 0.5 + 0.1 * Math.cos(t * 0.9 + q.ph);
    const e = Math.hypot(x - px, d - camD, z - pz), near = e < 6 && nn < BAIT_NEAR;
    put(near ? B.near : B.far, near ? nn++ : nf++, x - px, camD - d, z - pz, orient(hx, hy, hz, wv * 1.25 * q.lobe), q.s, 1 + 0.6 * q.fl + 1.7 * wv);
  }
  done(B.far, nf); done(B.near, nn);
}

// ---------- 流木に集まる仲間・海面に浮かぶ生き物 ----------
// ブリモドキ: 青みのある銀色に、5〜6 本の濃い横帯。尾びれの先が白い。流木のすぐ下に群れて、流木と一緒に漂う
const pilotGeo = () => K.fishGeo({ hgt: 0.27, wid: 0.13, mx: 0.5, snout: 0.9, top: 0.12, ped: 0.08, tail: { len: 0.28, fork: 0.85, lobe: 0.55 }, dorsal: [0.3, 0.55, 0.14], anal: [0.28, 0.48, 0.12], eye: [0.85, 0.85, 0.75],
  pat: (u, v) => (u > 0.12 && u < 0.85 && v > -0.75 && Math.sin((u - 0.12) / 0.73 * Math.PI * 5.5) > 0.35) ? [0.12, 0.16, 0.24] : K.mixc([0.82, 0.86, 0.9], [0.35, 0.48, 0.62], Math.max(0, v + 0.2)),
  fin: (p, s) => p === 'tail' && s > 0.85 ? [0.92, 0.94, 0.95] : [0.2, 0.25, 0.32] }, 0);
// ツムブリ: すらりとした紡錘形。背は濃い青緑、2 本の水色の線の間に黄色い帯、腹は白い。尾びれは黄色く、深く切れ込む
const runnerGeo = () => K.fishGeo({ hgt: 0.17, wid: 0.11, mx: 0.45, snout: 1.4, top: 0.04, ped: 0.06, tail: { len: 0.22, fork: 0.9, lobe: 0.5 }, dorsal: [0.3, 0.68, 0.1], anal: [0.28, 0.45, 0.08], finlets: 1, eye: [0.85, 0.8, 0.6],
  pat: (u, v) => v > 0.42 ? [0.12, 0.22, 0.3] : v > 0.35 ? [0.45, 0.75, 0.95] : v > 0.2 ? [0.78, 0.74, 0.32] : v > 0.13 ? [0.45, 0.75, 0.95] : K.mixc([0.9, 0.92, 0.93], [0.7, 0.75, 0.78], Math.max(0, v + 0.2)),
  fin: (p, s) => p === 'tail' ? [0.86, 0.78, 0.35] : [0.4, 0.5, 0.5] }, 0);
// カツオノカンムリ: 青い楕円の浮き（長さ 6cm ほど。同心円の模様）に、透明な三角の帆が斜めに立つ。浮きの縁には短い青い触手
const velFloatGeo = () => K.paint(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2).scale(1, 1, 0.62), (x, y, z) => { const r = Math.hypot(x, z / 0.62); return r > 0.86 ? [0.2, 0.42, 0.92] : Math.sin(r * 24) > 0.3 ? [0.55, 0.75, 1.0] : [0.12, 0.32, 0.85]; });
const velSailGeo = () => K.paint(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.75, 0, -0.35), new THREE.Vector3(0.75, 0, 0.35), new THREE.Vector3(0.05, 0.95, 0.02)]).setIndex([0, 1, 2]), () => [0.88, 0.92, 0.96]);
const pilot = { mesh: mesh(pilotGeo(), { roughness: 0.35, metalness: 0.15 }, 1, [], 140, false) };
const runner = { mesh: mesh(runnerGeo(), { roughness: 0.3, metalness: 0.2 }, 1, [], 90, false) };
const vel = { float: mesh((() => { const g = velFloatGeo(); g.computeVertexNormals(); return g; })(), { roughness: 0.3 }, 0, [], 360),
  sail: mesh((() => { const g = velSailGeo(); g.computeVertexNormals(); return g; })(), { roughness: 0.2, transparent: true, opacity: 0.5, depthWrite: false }, 0, [], 360) };
// クロトガリザメ: 流木の半分ほどに 1〜2 匹。体は species2.js（少しだけ作って使い回す）
const sharks = { bodies: [], max: 4 };
function sharkBody(i) {
  if (sharks.bodies[i]) return sharks.bodies[i];
  if (!window.SPECIES || !window.SPECIES.silky) return null;
  const b = window.SPECIES.silky(2.2); A.withCaustics(b.group); scene.add(b.group); b.group.visible = false;
  return (sharks.bodies[i] = b);
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
  let nl = 0, nm = 0, np = 0, nr = 0, ns = 0;
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
    // ブリモドキ: 流木のすぐ下に群れて、みな流木と同じ向きで漂う（ときどき少しずつ位置を変える）
    const hx = Math.cos(rot), hz = -Math.sin(rot);
    for (let k = 0, n = 8 + Math.floor(h(f.cx, f.cz, 530) * 9); k < n && np < 140; k++) {
      const ox = (h(k, f.cx, 531) - 0.5) * 3.2 + 0.25 * Math.sin(t * 0.35 + k), oz = (h(k, f.cz, 532) - 0.5) * 1.6 + 0.2 * Math.sin(t * 0.3 + k * 2), d = 0.5 + h(k, f.cx + 3, 533) * 1.4 + 0.1 * Math.sin(t * 0.5 + k);
      const x = f.x + hx * ox - hz * oz, z = f.z + hz * ox + hx * oz;
      put(pilot.mesh, np++, x - px, camD - d, z - pz, orient(hx + 0.08 * Math.sin(t * 0.4 + k), 0, hz + 0.08 * Math.cos(t * 0.37 + k)), 0.28 + 0.06 * h(k, f.cz, 534));
      if (k === 0) f.pilot = { x, z, d };
    }
    // ツムブリ: 流木の 7 割に、3〜8 匹の群れ。流木のまわりを大きく速く回る
    if (h(f.cx, f.cz, 535) < 0.7) for (let k = 0, n = 3 + Math.floor(h(f.cx, f.cz, 536) * 6); k < n && nr < 90; k++) {
      const r = 5.5 + 2.5 * h(k, f.cx, 537), dir = h(f.cx, f.cz, 538) < 0.5 ? 1 : -1, a = t * 2.4 / r * dir + k * 0.42, d = 2 + 3 * h(k, f.cz, 539) + 0.5 * Math.sin(t * 0.6 + k);
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      put(runner.mesh, nr++, x - px, camD - d, z - pz, orient(-Math.sin(a) * dir, 0.05 * Math.cos(t * 0.6 + k), Math.cos(a) * dir), 0.75 + 0.2 * h(k, f.cx, 541));
      if (k === 0) f.runner = { x, z, d };
    }
    // クロトガリザメ: 流木の半分ほどに 1〜2 匹。少し離れて、ゆっくり大きく回る（近くの流木だけ体を出す）
    if (h(f.cx, f.cz, 542) < 0.5 && Math.hypot(f.x - px, f.z - pz) < 80) for (let k = 0, n = 1 + (h(f.cx, f.cz, 543) < 0.4 ? 1 : 0); k < n && ns < sharks.max; k++) {
      const b = sharkBody(ns); if (!b) break;
      const r = 10 + 4 * h(k, f.cz, 544), dir = k ? -1 : 1, a = t * 1.1 / r * dir + k * 2.5 + h(f.cx, f.cz, 545) * 6.3, d = 4 + 5 * h(k, f.cx, 546) + 1.2 * Math.sin(t * 0.2 + k);
      const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
      b.group.position.set(x - px, camD - d, z - pz); b.group.rotation.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), 0, 'YXZ'); b.group.visible = true; b.animate(t + k * 3, 1);
      (f.sharks = f.sharks || []).push({ x, z, d }); ns++;
    }
  }
  done(logs.mesh, nl); done(mahi.mesh, nm); done(pilot.mesh, np); done(runner.mesh, nr);
  for (let i = ns; i < sharks.bodies.length; i++) sharks.bodies[i].group.visible = false;
  return flots;
}

// カツオノカンムリ: 外洋の 4 割ほどの区画（400m 四方）に、60〜160 個の密な群れ。風下（西南西）へゆっくり流され、波に合わせて上下する。
// 海の中からは、海面に青い粒が並んで見える（潜水艇が海面から 25m より深いときは描かない）
const VEL = 400;
function velellaFrame(t, px, pz, camD) {
  let n = 0; vel.near = null;                                          // いちばん近い 1 個（出会い・撮影に使う）
  if (camD < 25) {
    const c0x = Math.round(px / VEL), c0z = Math.round(pz / VEL), wx = -0.92, wz = 0.38;   // 西南西へ流される
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = c0x + i, cz = c0z + j; if (h(cx, cz, 600) > 0.4) continue;
      const bx = (cx + h(cx, cz, 601) - 0.5) * VEL + wx * ((t * 0.12) % VEL), bz = (cz + h(cx, cz, 602) - 0.5) * VEL + wz * ((t * 0.12) % VEL);
      if (Math.hypot(bx - px, bz - pz) > 75 || floorAt(bx, bz) < 50) continue;
      for (let k = 0, m = 60 + Math.floor(h(cx, cz, 603) * 100); k < m && n < 360; k++) {
        const a = h(k, cx, 604) * 6.283, r = 9 * Math.sqrt(h(k, cz, 605)), x = bx + Math.cos(a) * r * 1.6, z = bz + Math.sin(a) * r;   // 風の向きに細長い群れ
        if (Math.hypot(x - px, z - pz) > 50) continue;
        const wh = SEA.waveHeight(x, z, t), yaw = h(k, cx + cz, 606) * 6.283, s = 0.06 + 0.03 * h(k, cx, 607);
        $Q.setFromAxisAngle($V.set(0, 1, 0), yaw);
        put(vel.float, n, x - px, camD + wh - 0.004, z - pz, $Q, s); put(vel.sail, n, x - px, camD + wh - 0.004, z - pz, $Q, s); n++;
        if (n === 1 || Math.hypot(x - px, z - pz) < (vel.near ? vel.near.e : 99)) vel.near = { x, z, e: Math.hypot(x - px, z - pz) };
      }
    }
  }
  done(vel.float, n); done(vel.sail, n);
}
// ---------- 図鑑 ----------
const D = (k, name, sci, from, to, where, note, geo, rot) => K.D(k, name, sci, from, to, where, note, K.thumbMesh(geo, 0xffffff, rot));
const DEF = {
  dolphin: D('dolphin', 'ハシナガイルカ', 'Stenella longirostris', 0, 50, '外洋の海面近く（グアムの西の湾に、毎朝のように群れが来る）',
    '細長いくちばしのイルカ。数十頭の群れで泳ぎ、海面から高く跳び上がって、体の軸のまわりにくるくる回る。昼は湾で休み、夜は沖へ出てイカや小魚を食べる。', dolGeo),
  flyfish: D('flyfish', 'トビウオの仲間', 'Exocoetidae（トビウオ科）', 0, 20, '外洋の海面近く',
    '翼のような大きな胸びれを持つ魚。シイラなどに追われると、海面から飛び出して胸びれを広げ、数十 m も滑空して逃げる。', ffGeo, 0.5),
  yellowfin: D('yellowfin', 'キハダ', 'Thunnus albacares', 0, 250, '外洋（水深 50m より深い海の、表層。小魚が球のように固まった群れのまわりにも集まる）',
    '長く伸びた黄色い背びれとしりびれが目印のマグロ。群れで外洋を速く泳ぎ回り、小魚やイカを食べる。', tunaGeo2),
  mahi: D('mahi', 'シイラ', 'Coryphaena hippurus', 0, 30, '外洋の海面近く（流木や流れ藻の下）',
    '金色と青緑にかがやく、額の切り立った魚。流木や流れ藻の下に集まる小魚を狙って、そのまわりを泳ぐ。グアムでも人気の釣りの魚。', mahiGeo2),
  pilotfish: D('pilotfish', 'ブリモドキ', 'Naucrates ductor', 0, 50, '外洋の流木や流れ藻の下（大きなサメやエイのそばにも）',
    '青みのある銀色の体に、5〜6 本の濃い横帯がある小さなアジの仲間。流木や、大きなサメ・エイ・ウミガメのそばについて、一緒に旅をする。', pilotGeo),
  runner: D('runner', 'ツムブリ', 'Elagatis bipinnulata', 0, 50, '外洋の流木や流れ藻のまわり',
    'すらりとした紡錘形の体に、水色の線と黄色い帯が走るアジの仲間。群れで流木のまわりを速く泳ぎ回り、小魚を追う。', runnerGeo),
  velella: K.D('velella', 'カツオノカンムリ', 'Velella velella', 0, 1, '外洋の海面（風に吹かれて、群れで漂う）',
    '青い楕円の浮きに、透明な三角の帆を立てたヒドロ虫の仲間。帆に風を受けて群れで海面を漂い、ときには浜に大量に打ち上げられる。', K.thumbMesh(() => K.merge([velFloatGeo(), velSailGeo()]), 0xffffff, 0.6, 0.7)),
  scad: D('scad', 'クサヤモロ', 'Decapterus macarellus', 0, 60, '外洋の表層（キハダなどに追われると、海面近くで球のように固まる）',
    'ムロアジの仲間で、体長 25cm ほどの細長い銀色の魚。大きな群れで外洋を泳ぎ、プランクトンを食べる。大きな魚に追われると、すき間なく集まって球のような群れ（ベイトボール）を作り、渦を巻いて身を守る。', () => K.fishGeo(scadO, 0))
};
Object.values(DEF).forEach(d => R.species.push(d));
// 左の欄の「この深さで出会える生き物」: 外洋（水深 50m より深い海の上）の水深 40m より浅い所
R.nearbyExtra.push((px, pz, depth, floorD) => floorD > 50 && depth < 40 ? [DEF.dolphin, DEF.yellowfin, DEF.scad, DEF.mahi, DEF.runner, DEF.pilotfish, DEF.velella, DEF.flyfish] : []);
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
  if (camD > 0.5) for (const f of flots) {
    if (f.pilot && seen(f.pilot.x, f.pilot.d, f.pilot.z, px, pz, camD, 12)) K.meetDef(DEF.pilotfish, md);
    if (f.runner && seen(f.runner.x, f.runner.d, f.runner.z, px, pz, camD, 20)) K.meetDef(DEF.runner, md);
    const sk = f.sharks && L.species.find(d => d.kind === 'silky'); if (sk && f.sharks.some(q => seen(q.x, q.d, q.z, px, pz, camD, 30))) K.meetDef(sk, md);
  }
  if (vel.near && vel.near.e < 8 && seen(vel.near.x, 0, vel.near.z, px, pz, camD, 8)) K.meetDef(DEF.velella, md);
  if (camD > 0.5 && bait.ball) { const P = bait.ball; if (seen(P.x, P.d, P.z, px, pz, camD, 30)) K.meetDef(DEF.scad, md); if (P.hunters.some(h => seen(h.x, h.d, h.z, px, pz, camD, 25))) K.meetDef(DEF.yellowfin, md);
    const mk = P.marlin && L.species.find(d => d.kind === 'marlin'); if (mk && seen(P.marlin.x, P.marlin.d, P.marlin.z, px, pz, camD, 40)) K.meetDef(mk, md); }
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
  if (bait.ball) { const P = bait.ball; check(DEF.scad, P.x, P.d, P.z, P.R * 1.5); P.hunters.forEach(h => check(DEF.yellowfin, h.x, h.d, h.z, 1.2));
    const mk = P.marlin && L.species.find(d => d.kind === 'marlin'); if (mk) check(mk, P.marlin.x, P.marlin.d, P.marlin.z, MARLIN_SIZE); }
  lastFlots.forEach(f => (f.mahi || []).forEach(q => check(DEF.mahi, q.x, q.d, q.z, 1)));
  lastFlots.forEach(f => { if (f.pilot) check(DEF.pilotfish, f.pilot.x, f.pilot.d, f.pilot.z, 0.4); if (f.runner) check(DEF.runner, f.runner.x, f.runner.d, f.runner.z, 0.9);
    const sk = f.sharks && L.species.find(d => d.kind === 'silky'); if (sk) f.sharks.forEach(q => check(sk, q.x, q.d, q.z, 2.2)); });
  if (vel.near) check(DEF.velella, vel.near.x, 0, vel.near.z, 0.25);
  return best && { def: best, score };
}

// ---------- 毎フレーム（creatures.js の update から。深い海の上・海面の上でも呼ばれる） ----------
const ALL = [dol.mesh, ff.mesh, tuna.mesh, logs.mesh, mahi.mesh, bait.far, bait.near, bait.hunt, pilot.mesh, runner.mesh, vel.float, vel.sail];
function frame(dt, t, { dive, under, depth }) {
  dt = Math.min(dt, 0.1);
  K.TIME.value = t;
  const camD = under ? depth : -T.camera.position.y * 1000;               // カメラの水深（海面の上はマイナス）
  CAMD.value = camD;
  const show = dive && camD < 60 && camD > -60;
  airOn = show && !under;
  if (!show) { ALL.forEach(m => done(m, 0)); scales.pts.visible = false; if (bait.mBody) bait.mBody.group.visible = false; sharks.bodies.forEach(b => { b.group.visible = false; }); vel.near = null; lastFlots = []; return; }
  const px = S.x * 1000, pz = S.z * 1000, floorHere = floorAt(px, pz);
  T.camera.getWorldDirection(FWD); const fl = Math.hypot(FWD.x, FWD.z) || 1;
  dolphinFrame(dt, t, px, pz, camD, floorHere, true);
  flyingFrame(dt, t, px, pz, camD, floorHere, true, FWD.x / fl, FWD.z / fl);
  tunaFrame(dt, t, px, pz, camD, floorHere, true);
  baitFrame(dt, t, px, pz, camD, floorHere, FWD.x / fl, FWD.z / fl);
  scalesFrame(dt, t, px, pz, camD);
  lastFlots = flotFrame(dt, t, px, pz, camD, true);
  velellaFrame(t, px, pz, camD);
  checkMeet(dt, px, pz, camD, lastFlots);
}
REEF.pelagic = frame;
REEF.warm = () => {                                                   // 潜航の始めに、海面より上を描く場面の材質も作っておく（creatures.js の warmAll から）
  AIR_MESHES.forEach(m => airScene.add(m)); T.renderer.compile(airScene, airCam); AIR_MESHES.forEach(m => scene.add(m));
};
window.__PELAGIC = { dol, ff, tuna, bait, pilot, runner, sharks, vel, DEF, get flots() { return lastFlots; } };                                // 確認用
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
