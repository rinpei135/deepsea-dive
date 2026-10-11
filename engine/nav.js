// 移動・入水演出・ソナー・描画ループ
(() => {
const T = window.__TRENCH, O = window.SEA, SEA = window.__SEA, UI = window.__UI, S = window.__DIVE;
const { renderer, scene, camera, terrainMat, snow, glow, state, CD } = T;
const { nf } = UI;

// 海中は高さ強調あり（地形と合わせる）、海面より上は実寸（波の見え方をリアルに保つ）
const yOf = d => d > 0 ? -T.exDepth(d, state.ex) / 1000 : -d / 1000;   // 地形と同じ強調（浅い所は弱い）
const MIN_D = -30, HOVER = 1.2;          // HOVER: 海底からこれ以上は近づかない (m)。近景の海底で生き物を間近に見られる
const floorAt = () => T.floorDepth(S.x, S.z);
// 近づける限界の海底の深さ: 真下だけでなく、まわり（半径 3m）でいちばん浅い所に合わせる（急な斜面や礁の縁で、横の斜面にめり込まないように）
const CLEAR_R = 0.003;
const floorClear = () => {
  let f = floorAt();
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; f = Math.min(f, T.floorDepth(S.x + Math.cos(a) * CLEAR_R, S.z + Math.sin(a) * CLEAR_R)); }
  const L = window.__LIFE; if (L && L.obstacleDepth) f = Math.min(f, L.obstacleDepth(S.x * 1000, S.z * 1000, 1.5));
  if (L && L.seabedY && f < 50) for (let i = 0; i < 7; i++) {          // 近くの海底の起伏（根・縁脚）も越える
    const a = i / 6 * Math.PI * 2, r = i ? CLEAR_R * 1000 : 0; f = Math.min(f, L.seabedY(S.x * 1000 + Math.cos(a) * r, S.z * 1000 + Math.sin(a) * r));
  }   // サンゴや岩の上は、そのてっぺんを越える
  return f;
};
const clampDepth = d => Math.max(MIN_D, Math.min(floorClear() - HOVER, d));

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
    S.yaw = SEA.startYaw || 0; S.pitch = -0.2; S.dir = 0; S.goal = null; S.depth = INTRO.top; entered = false;
    const to = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ'));
    S.intro = { t: 0, from: camera.position.clone(), fromQ: camera.quaternion.clone(), toQ: to, then };
  } else if (S.mode === 'dive') {
    S.intro = null; S.goal = null; S.dir = 0;
    if (state.overEx != null) { T.setExaggeration(state.overEx); state.overEx = null; }   // 俯瞰に戻ったら、選んでいた高さの強調に戻す
    camera.position.copy(saved.pos); controls.target.copy(saved.tgt);
  }
  S.mode = m;
  controls.enabled = m === 'over';
  UI.syncMode();
}

// ---------- 自由移動 ----------
// 潜水艇が入れる水深 (m)。これより浅い所（陸地・干上がる礁原）には入らない
const MIN_WATER = 1.5;
// (x, z) のまわりで、いちばん近い MIN_WATER 以上の海を探す（100m 刻みで外へ広げる。見つからなければ null）
function nearestWater(x, z, maxKm = 8) {
  if (T.floorDepth(x, z) >= MIN_WATER + 0.5) return [x, z];
  for (let r = 0.1; r <= maxKm; r += 0.1) {
    const n = Math.max(8, Math.round(r * 2 * Math.PI / 0.1));
    let best = null;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, f = T.floorDepth(px, pz); if (f >= MIN_WATER + 0.5 && (!best || f < best[2])) best = [px, pz, f]; }
    if (best) return [best[0], best[1]];
  }
  return null;
}
function teleport(x, z) {
  const r = T.rect;
  x = Math.max(r.x0 + 2, Math.min(r.x1 - 2, x)); z = Math.max(r.z0 + 2, Math.min(r.z1 - 2, z));
  const w = nearestWater(x, z);
  if (!w) { UI.toast('近くに潜れる海がありません。'); return false; }
  const snapped = w[0] !== x || w[1] !== z; [x, z] = w;
  S.x = x; S.z = z; S.goal = null;
  if (S.mode === 'dive' && !S.intro) S.depth = clampDepth(S.depth);
  UI.toast(`${snapped ? '陸地だったので、いちばん近い海（' : ''}北緯 ${nf(T.fromXZ(x, z).lat, 3)}° 東経 ${nf(T.fromXZ(x, z).lon, 3)}°${snapped ? '）' : ''}へ移動しました（水深 約${nf(T.floorDepth(x, z))} m）`);
  return true;
}
const vel = new THREE.Vector3();
function move(dt) {
  const k = S.keys;
  const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
  const u = (k.KeyE || k.Space ? 1 : 0) - (k.KeyQ || k.KeyC ? 1 : 0);
  if (k.ArrowLeft) S.yaw += dt * 1.2;
  if (k.ArrowRight) S.yaw -= dt * 1.2;
  const cp = Math.cos(S.pitch), sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
  // 目標速度 (m/秒): 前後は視線の向き（上下も含む）、左右は水平、上昇下降は鉛直
  const tx = (-sy * cp * f + cy * r), ty = Math.sin(S.pitch) * f + u, tz = (-cy * cp * f - sy * r);
  const sp = S.speed;
  vel.lerp(new THREE.Vector3(tx * sp, ty * sp, tz * sp), 1 - Math.exp(-dt * 4));
  if (vel.lengthSq() < 1e-6) return false;
  const nx = S.x + vel.x * dt / 1000, nz = S.z + vel.z * dt / 1000, rc = T.rect;
  if (nx > rc.x0 + 2 && nx < rc.x1 - 2 && nz > rc.z0 + 2 && nz < rc.z1 - 2 && T.floorDepth(nx, nz) >= MIN_WATER) { S.x = nx; S.z = nz; }   // 浅瀬にも入れるが、陸には上がらない
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
  const c = UI.soundSpeed(S.depth);
  if (S.sound) UI.pingSound(2 * Math.max(0, floorAt() - S.depth) / c);   // 海底からのこだまは、往復の時間だけ遅れて返る
  if (!pinged) { pinged = true; UI.toast(`ソナーを発信しました。音は海水中を毎秒約${nf(c)}m（深さで変わります）で広がり、届いた地形が見えてきます。`); }
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
  const rawDt = (now - last) / 1000, dt = Math.min(0.1, rawDt); last = now;
  const t = now / 1000;
  UI.autoRes(rawDt, t);               // 動きが重ければ、描画の細かさを自動で下げる
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
      // 沈む深さは、浅い海では海底の少し上まで（12m より浅い所で、地面の中まで沈まないように）
      const k = ease(Math.min(1, (I.t - INTRO.fly) / INTRO.sink)), end = Math.min(INTRO.end, Math.max(0, floorClear() - HOVER));
      S.depth = INTRO.top + (end - INTRO.top) * k;
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
      const lim = floorClear() - HOVER;
      if (S.depth >= lim) { S.depth = lim; S.dir = 0; UI.syncGo(); }
      if (S.depth <= 0) { S.depth = 0; S.dir = 0; UI.syncGo(); }
    }
  }
  const fc = dive ? floorClear() : 0;
  if (dive && !I && S.depth > fc - HOVER) S.depth = Math.max(0, fc - HOVER);   // 念のため: どんな操作のあとでも、海底より下には入らない
  const d = S.depth, floorD = floorAt();

  if (dive && (!I || I.t >= INTRO.fly)) {
    camera.position.set(S.x, yOf(d), S.z);
    if (d > 0.5 && !I) {                                               // 浅い所では、波の下の水と一緒にゆっくり円を描いて揺れる
      const o = SEA.orbit(S.x * 1000, S.z * 1000, d, t);
      camera.position.x += o[0] / 1000; camera.position.y += o[1] / 1000; camera.position.z += o[2] / 1000;
    }
    camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ');
  }
  // 描き始める距離: 小さいほど、遠くの奥行きの精度が落ちる（1km 先の海面と、そのすぐ下の礁を見分けられず、礁が海面の上に四角く出る）。
  // 海面の上では、高さの約 4 割（足元の海面が欠けない範囲）まで遠くし、最大 80m。海面すれすれでは近くまで（足元の海面が欠けないように）。
  // 海の中は、目の前の生き物（別の画面に描く）以外に近い物がないので 2m のまま
  const cy = camera.position.y;
  const nearZ = dive && cy > 0 ? Math.min(0.08, Math.max(0.0003, cy * 0.4)) : 0.002;
  if (Math.abs(camera.near - nearZ) > 1e-5) { camera.near = nearZ; camera.updateProjectionMatrix(); }
  if (!dive) controls.update();

  // 水面の上か下か（波の高さも考える）
  const surfY = SEA.waveHeight(camera.position.x * 1000, camera.position.z * 1000, t) / 1000;
  // 平均の海面（y = 0）より下なら、波の谷が下を通っていても水中とみなす（遠くの海面は平らな板なので、その下で「水の上」として描くと、
  // 海も海底も描かれない）。平均の海面より上でも、波の山の中なら水中
  const under = dive && (camera.position.y < 0 || camera.position.y < surfY);
  // 入水・浮上の演出。潜水艇の水深（波では変わらない）が 1m を超えたら「入水」、海面から 1m 以上出たら「浮上」とみなし、
  // その間では切り替えない（行き来しても連発しない）。浅い海では 1m まで潜れないことがあるので、そこで潜れる深さの 8 割で「入水」
  const SPLASH_IN = Math.min(1, Math.max(0.2, (fc - HOVER) * 0.8)), SPLASH_OUT = 1;
  const wet = !dive ? false : d > SPLASH_IN ? true : d < -SPLASH_OUT ? false : wasUnder;
  if (dive && wet !== wasUnder) {
    if (wet) {
      // 海の中は実際の縦横比で描く（近くの海底・生き物・潜水艇の深さは実際の m なので、遠くの地形だけ強調すると、近くの海底の縁に段ができ、
      // 上下に動くと遠くの海底だけが強調の倍率の速さで動いてしまう）。入水は浅い所なので、切り替えても見た目は変わらない
      if (state.ex !== 1) { state.overEx = state.ex; T.setExaggeration(1); }
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
    O.marks.forEach(m => { if ((prev < m.d) !== (d < m.d)) UI.toast(m.note && d > prev ? m.note : `${m.label} の深さを通過`); });
    O.zones.slice(1).forEach(z => { if (prev < z.from && d >= z.from) UI.toast(`${z.name}（${nf(z.from)}m〜）に入りました`); });
    const lim = fc - HOVER;
    if (d >= lim - 1 && prev < lim - 1) UI.toast(Math.hypot(S.x, S.z) < 3 && O.origin.arrival
      ? O.origin.arrival(nf(floorD))
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
  window.__LIFE?.update(dt, t, { dive, under, depth: Math.max(0, d), view: d });
  window.__ZUKAN?.update(dt, { under, depth: Math.max(0, d), floorD });
  // 音: 深さ・水中かどうか・潜水艇の速さ（m/秒）を渡す
  // 音の処理で何か起きても、画面の更新は止めない
  try { window.__AUDIO?.update(dt, { dive, under, depth: d, motor: dive && !S.intro ? Math.max(vel.length(), S.dir ? S.speed : 0) : 0 }); } catch (e) { console.error(e); }

  // 地形と水中の見え方
  u.uDive.value = under ? 1 : 0;
  u.uTime.value = t;
  u.uCurv.value = dive ? 1 : 0;                                       // 地球の丸み（潜航中だけ。俯瞰の地図では平らに）
  u.uCam.value.copy(camera.position);
  T.waterColor(Math.max(0, d), water, S.x, S.z);
  const turb = T.turbidity(S.x, S.z) * Math.exp(-Math.max(0, d) / 40);   // 港の中や河口・砕ける波の近くは濁って、見通しが短い
  const silt = window.__LIFE ? window.__LIFE.silt : 0;              // 舞い上がった泥で、遠くの地形も見えにくくなる
  if (silt > 0.01) water.lerp(window.__LIFE.siltColor, silt * 0.8);
  // 見通し: 外洋の澄んだ水でも、水中で見えるのは横に数十 m まで（km あたりの濃さ 45 = 約 65m でほぼ見えない）。ソナーで浮かぶ地形は霧の後に重ねるので見える
  const clear = 1 - Math.min(1, Math.max(0, (Math.max(d, floorD) - 40) / 40));   // 浅い澄んだ礁の海は、遠くまで見える（creatures.js と同じ）
  u.uFog.value.copy(water); u.uFogDen.value = (45 - 23 * clear + silt * 25) * (1 + 2.2 * turb);
  const LF = window.__LIFE, bedOn = under && LF && LF.bed.visible;
  u.uFogDen2.value = bedOn ? LF.reefApi.scene.fog.density * 1000 : 0;   // 近くの海底の霧の濃さ（km あたり）
  u.uSink.value.set(S.x, S.z, 0.086, bedOn ? 0.006 : 0);              // 近くの海底の下へ、粗い地形を 6m 沈める
  u.uPingSpeed.value = UI.soundSpeed(Math.max(0, d)) / 1000;          // ソナーの波面は、今いる深さの音速で広がる（km/秒）
  u.uLampR.value = d > 150 && S.lamp ? 0.065 : 0;                 // ライトの届く距離 (km)。実際の潜水艇のライトは数十 m
  camera.getWorldDirection(u.uCamDir.value);
  // ソナーで浮かぶ地形: 日の光が届く浅い海では目で見える景色を邪魔しないよう薄く、暗い深さでははっきり
  // 日の光で見える浅い所（20m より浅い所）では重ねず、深くなるにつれて少しずつ（霧の上から遠くの島の地形が浮かんで、水平線に一直線の線が見えるので。
  // 近くの海底が見える所では、粗い三角形やソナーの波面の線も浮いて見える）。宝箱は 2,000m より深い所だけ
  u.uSonar.value = (0.2 + 0.8 * Math.min(1, Math.max(0, (d - 50) / 250))) * Math.min(1, Math.max(0, (d - 20) / 60)) * (bedOn ? Math.min(1, Math.max(0, (d - 25) / 35)) : 1); u.uEx.value = state.ex;
  snow.uniforms.uAlpha.value = under ? Math.min(1, Math.max(0, (d - 40) / 300)) * 0.3 : 0;   // 近くのマリンスノーは creatures.js がライトに合わせて描く
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
  UI.drawMap();
  window.__COAST?.update();          // 島の近くの細かい地形をカメラのまわりへ
  T.updateTerrain();                  // 地形の区画: 遠いほど粗く
  SEA.refractPass();                  // 浅瀬の海底を、海面ごしに透かして見るための画像
  window.__POST?.begin();           // 後処理があれば、HDR の画像に描く
  renderer.render(scene, camera);
  window.__LIFE?.render();          // 生き物（近景）を重ねて描く
  window.__POST?.end();             // にじみと明るさの変換をして画面へ
  window.__ZUKAN?.afterRender(renderer.domElement);   // 撮影はここで（描いた直後でないと画面を写せない）
  window.__UI?.afterRender(renderer.domElement);     // 画像保存も
  requestAnimationFrame(frame);
}

window.__NAV = { setMode, clampDepth, teleport, ping, pings };
setMode('over');
requestAnimationFrame(frame);
})();
