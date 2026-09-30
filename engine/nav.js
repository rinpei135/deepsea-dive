// 移動・入水演出・ソナー・描画ループ
(() => {
const T = window.__TRENCH, O = window.SEA, SEA = window.__SEA, UI = window.__UI, S = window.__DIVE;
const { renderer, scene, camera, terrainMat, snow, glow, state, CD } = T;
const { nf } = UI;

// 海中は高さ強調あり（地形と合わせる）、海面より上は実寸（波の見え方をリアルに保つ）
const yOf = d => d > 0 ? -d / 1000 * state.ex : -d / 1000;
const MIN_D = -30, HOVER = 20;
const floorAt = () => T.floorDepth(S.x, S.z);
const clampDepth = d => Math.max(MIN_D, Math.min(floorAt() - HOVER, d));

// ---------- 俯瞰カメラ ----------
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxDistance = 1500; controls.minDistance = 5;
controls.maxPolarAngle = Math.PI * 0.49;
camera.position.set(-40, 230, 330);
controls.target.set(70, -20, -60);
const saved = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };

// ---------- モード切り替えと入水演出 ----------
const INTRO = { fly: 4.5, sink: 13, top: MIN_D, end: 12 };
let entered = false, firstPingAt = -1, wasUnder = false;
function setMode(m, then = null) {
  if (m === S.mode) return UI.syncGo();
  if (m === 'dive') {
    saved.pos.copy(camera.position); saved.tgt.copy(controls.target);
    S.yaw = 0; S.pitch = -0.2; S.dir = 0; S.goal = null; S.depth = INTRO.top; entered = false;
    const to = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ'));
    S.intro = { t: 0, from: camera.position.clone(), fromQ: camera.quaternion.clone(), toQ: to, then };
  } else if (S.mode === 'dive') {
    S.intro = null; S.goal = null; S.dir = 0;
    camera.position.copy(saved.pos); controls.target.copy(saved.tgt);
  }
  S.mode = m;
  controls.enabled = m === 'over';
  UI.syncMode();
}

// ---------- 自由移動 ----------
function teleport(x, z) {
  const r = T.rect;
  x = Math.max(r.x0 + 2, Math.min(r.x1 - 2, x)); z = Math.max(r.z0 + 2, Math.min(r.z1 - 2, z));
  if (T.floorDepth(x, z) < HOVER + 10) return UI.toast('陸地や浅瀬には移動できません。');
  S.x = x; S.z = z; S.goal = null;
  if (S.mode === 'dive' && !S.intro) S.depth = clampDepth(S.depth);
  UI.toast(`北緯 ${nf(T.fromXZ(x, z).lat, 2)}° 東経 ${nf(T.fromXZ(x, z).lon, 2)}° へ移動しました`);
}
const vel = new THREE.Vector3();
function move(dt) {
  const k = S.keys, boost = k.ShiftLeft || k.ShiftRight ? 5 : 1;
  const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
  const u = (k.KeyE || k.Space ? 1 : 0) - (k.KeyQ || k.KeyC ? 1 : 0);
  if (k.ArrowLeft) S.yaw += dt * 1.2;
  if (k.ArrowRight) S.yaw -= dt * 1.2;
  const cp = Math.cos(S.pitch), sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
  // 目標速度 (m/秒): 前後は視線の向き（上下も含む）、左右は水平、上昇下降は鉛直
  const tx = (-sy * cp * f + cy * r), ty = Math.sin(S.pitch) * f + u, tz = (-cy * cp * f - sy * r);
  const sp = S.speed * boost;
  vel.lerp(new THREE.Vector3(tx * sp, ty * sp, tz * sp), 1 - Math.exp(-dt * 4));
  if (vel.lengthSq() < 1e-6) return false;
  const nx = S.x + vel.x * dt / 1000, nz = S.z + vel.z * dt / 1000, rc = T.rect;
  if (nx > rc.x0 + 2 && nx < rc.x1 - 2 && nz > rc.z0 + 2 && nz < rc.z1 - 2 && T.floorDepth(nx, nz) > HOVER + 10) { S.x = nx; S.z = nz; }
  S.depth = clampDepth(S.depth - vel.y * dt);
  return f || r || u;
}

// ---------- ソナー ----------
const PING_EVERY = 10, pings = [0, 1, 2, 3, 4, 5].map(() => ({ x: 0, y: 0, z: 0, w: -1 }));
let slot = 0, sinceP = 0, pinged = false;
function ping(manual) {
  if (S.mode !== 'dive' || !(S.depth > 0)) { if (manual) UI.toast('ソナーは海中で使えます。'); return; }
  const p = pings[slot]; slot = (slot + 1) % pings.length;
  p.x = camera.position.x; p.y = camera.position.y; p.z = camera.position.z; p.w = 0;
  sinceP = 0;
  if (S.sound) UI.pingSound();
  if (!pinged) { pinged = true; UI.toast('ソナーを発信しました。音は海水中を毎秒約1,500mで広がり、届いた地形が見えてきます。'); }
}

// ---------- 入力 ----------
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { if (S.mode === 'dive' && !S.intro) drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => {
  if (!drag) return;
  S.yaw += (e.clientX - drag[0]) * 0.004; S.pitch = Math.max(-1.45, Math.min(1.45, S.pitch + (e.clientY - drag[1]) * 0.004));
  drag = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('wheel', e => {
  if (S.mode !== 'dive') return;
  e.preventDefault(); if (S.intro) return;
  S.dir = 0; S.goal = null; UI.syncGo();
  S.depth = clampDepth(S.depth + e.deltaY * 3);
}, { passive: false });
const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyC', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
addEventListener('keydown', e => {
  if (!KEYS.includes(e.code) || e.target.closest?.('input, textarea')) return;
  if (S.mode !== 'dive') { if (e.code === 'Space' || e.code.startsWith('Arrow')) return; }
  e.preventDefault(); S.keys[e.code] = true;
});
addEventListener('keyup', e => { S.keys[e.code] = false; });
addEventListener('blur', () => { S.keys = {}; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- ループ ----------
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const v = new THREE.Vector3(), introPos = new THREE.Vector3(), water = new THREE.Color(), SKY_BG = new THREE.Color(0xbcd9e6);
let last = performance.now(), prev = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  const dive = S.mode === 'dive';
  const I = S.intro;

  if (I) {
    I.t += dt;
    if (I.t < INTRO.fly) {
      // 上空から潜航地点の真上、海面30mへ降りる
      const k = ease(I.t / INTRO.fly);
      introPos.set(S.x, yOf(INTRO.top), S.z);
      camera.position.lerpVectors(I.from, introPos, k);
      camera.quaternion.copy(I.fromQ).slerp(I.toQ, k);
    } else {
      // 波立つ海面を見ながらゆっくり沈む
      const k = ease(Math.min(1, (I.t - INTRO.fly) / INTRO.sink));
      S.depth = INTRO.top + (INTRO.end - INTRO.top) * k;
      S.pitch = -0.2 + 0.14 * k;
      if (k >= 1) {
        S.intro = null;
        if (I.then === 'go') { S.dir = 1; UI.syncGo(); }
        else if (typeof I.then === 'number') S.goal = I.then;
      }
    }
  } else if (dive) {
    const moving = move(dt);
    if (moving && (S.dir || S.goal != null)) { S.dir = 0; S.goal = null; UI.syncGo(); }
    if (S.goal != null) {
      const g = clampDepth(S.goal), step = (g - S.depth) * (1 - Math.exp(-dt * 1.2));
      S.depth += Math.sign(step) * Math.max(Math.abs(step), Math.min(Math.abs(g - S.depth), 30 * dt));
      if (Math.abs(g - S.depth) < 0.5) { S.depth = g; S.goal = null; }
    } else if (S.dir) {
      S.depth += S.dir * S.speed * dt;
      const lim = floorAt() - HOVER;
      if (S.depth >= lim) { S.depth = lim; S.dir = 0; UI.syncGo(); }
      if (S.depth <= 0) { S.depth = 0; S.dir = 0; UI.syncGo(); }
    }
  }
  const d = S.depth, floorD = floorAt();

  if (dive && (!I || I.t >= INTRO.fly)) {
    camera.position.set(S.x, yOf(d), S.z);
    camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ');
  }
  if (!dive) controls.update();

  // 水面の上か下か（波の高さも考える）
  const surfY = SEA.waveHeight(camera.position.x * 1000, camera.position.z * 1000, t) / 1000;
  const under = dive && camera.position.y < surfY;
  // 入水・浮上の演出。波で水面が上下しても連発しないよう、海面から 3m 以上
  // 潜ったら「入水」、3m 以上出たら「浮上」とみなし、その間では切り替えない
  const SPLASH_MARGIN = 3;
  const wet = !dive ? false : d > SPLASH_MARGIN ? true : d < -SPLASH_MARGIN ? false : wasUnder;
  if (dive && wet !== wasUnder) {
    if (wet) {
      UI.splash(); UI.toast('海中に入りました'); window.__AUDIO?.splash();
      SEA.splashBubbles(camera.position);
      if (!entered) firstPingAt = t + 1.5;
      entered = true;
    } else {
      window.__AUDIO?.surface();
    }
  }
  wasUnder = wet;
  if (dive && d !== prev && entered) {
    O.marks.forEach(m => { if ((prev < m.d) !== (d < m.d)) UI.toast(`${m.label} の深さを通過`); });
    O.zones.slice(1).forEach(z => { if (prev < z.from && d >= z.from) UI.toast(`${z.name}（${nf(z.from)}m〜）に入りました`); });
    const lim = floorD - HOVER;
    if (d >= lim - 1 && prev < lim - 1) UI.toast(Math.hypot(S.x, S.z) < 3 && O.origin.arrival
      ? O.origin.arrival(nf(CD.depth))
      : `海底に到着しました（水深 ${nf(floorD)} m）`);
  }
  prev = d;

  // ソナー: 海中では一定間隔で自動発信
  SEA.tickBubbles(dt);
  if (under) {
    sinceP += dt;
    if (firstPingAt > 0 && t >= firstPingAt) { firstPingAt = -1; if (S.sonar) ping(); }
    else if (S.sonar && sinceP >= PING_EVERY) ping();
  }
  const U0 = terrainMat.uniforms, life = U0.uRange.value / U0.uPingSpeed.value + U0.uHold.value + 3;
  pings.forEach(p => { if (p.w >= 0) { p.w += dt; if (p.w > life) p.w = -1; } });
  const u = terrainMat.uniforms;
  pings.forEach((p, i) => u.uPing.value[i].set(p.x, p.y, p.z, p.w));

  if (window.__TREASURE) window.__TREASURE.update(dt, t, { dive, under, pings });
  window.__LIFE?.update(dt, t, { dive, under, depth: Math.max(0, d) });
  // 音: 深さ・水中かどうか・潜水艇の速さ（m/秒）を渡す
  window.__AUDIO?.update(dt, { dive, under, depth: d, motor: dive && !S.intro ? Math.max(vel.length(), S.dir ? S.speed : 0) : 0 });

  // 地形と水中の見え方
  u.uDive.value = under ? 1 : 0;
  u.uTime.value = t;
  u.uCam.value.copy(camera.position);
  T.waterColor(Math.max(0, d), water);
  u.uFog.value.copy(water); u.uFogDen.value = 0.03;
  u.uLampR.value = d > 150 ? 0.35 : 0;
  u.uSonar.value = 1; u.uEx.value = state.ex;
  snow.uniforms.uAlpha.value = under ? Math.min(1, Math.max(0, (d - 40) / 300)) * 0.8 : 0;
  glow.uniforms.uAlpha.value = under ? Math.min(1, Math.max(0, (d - 200) / 400)) * (1 - Math.min(1, Math.max(0, (d - 5000) / 2000))) : 0;
  [snow, glow].forEach(m => { m.uniforms.uCam.value.copy(camera.position); m.uniforms.uTime.value = t; });
  scene.background = under ? water : SKY_BG;
  SEA.update(t, { dive, under, depth: Math.max(0, d), ex: state.ex, surfaceOn: S.surfaceOn });

  // ラベル・計器
  UI.divePin.x = S.x; UI.divePin.z = S.z;
  UI.pins.forEach(p => {
    if (dive) { p.el.style.display = 'none'; return; }
    v.set(p.x, p.yFn(), p.z).project(camera);
    if (v.z > 1) { p.el.style.display = 'none'; return; }
    p.el.style.display = '';
    p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth - 6}px, ${(-v.y * 0.5 + 0.5) * innerHeight - 8}px)`;
  });
  UI.renderRuler(d, floorD, dive);
  UI.renderPanel(d, floorD);
  if (dive) UI.drawMap(pings);
  renderer.render(scene, camera);
  window.__LIFE?.render();          // 生き物（近景）を重ねて描く
  requestAnimationFrame(frame);
}

window.__NAV = { setMode, clampDepth, teleport, ping, pings };
setMode('over');
requestAnimationFrame(frame);
})();
