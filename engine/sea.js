// 空・海面・水中の光。海面の波はゲルストナー波の重ね合わせ（単位は m、シーンは 1単位 = 1km）
(() => {
const T = window.__TRENCH;
const { scene, renderer, camera } = T;
const SUN = new THREE.Vector3(-0.45, 0.62, 0.35).normalize();

// 貿易風の吹くマリアナ近海の、うねりと風浪（波長 m, 振幅 m, 鋭さ Q）
const WAVES = [
  [1.0, 0.30, 110, 0.60, 0.55], [0.8, -0.55, 64, 0.38, 0.60], [0.35, 1.0, 37, 0.24, 0.65],
  [-0.6, 0.8, 21, 0.15, 0.70], [1.0, -0.2, 12.5, 0.09, 0.75], [0.25, -1.0, 7.3, 0.055, 0.8],
  [-1.0, -0.45, 4.1, 0.03, 0.8], [0.6, 0.8, 2.3, 0.016, 0.8]
].map(([x, z, L, A, Q]) => { const l = Math.hypot(x, z); return { dx: x / l, dz: z / l, L, A, Q, k: 2 * Math.PI / L, w: Math.sqrt(9.81 * 2 * Math.PI / L) }; });
const glslWaves = WAVES.map(w => `W(p, vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), ${w.k.toFixed(5)}, ${w.w.toFixed(5)}, ${w.A.toFixed(4)}, ${w.Q.toFixed(3)}, ${w.L.toFixed(2)});`).join('\n      ');

// JS 側: カメラ位置の水面の高さ (m)。水面の上か下かの判定に使う
function waveHeight(xm, zm, t) {
  let h = 0;
  for (const w of WAVES) h += w.A * Math.sin(w.k * (w.dx * xm + w.dz * zm) - w.w * t);
  return h;
}

const COMMON = `
  uniform vec3 uSun; uniform float uTime;
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
  // ACES 近似トーンマッピング（明るい部分を白飛びさせずに圧縮）
  vec3 tm(vec3 c){ c *= 0.85; return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
  vec3 skyCol(vec3 r){
    float h = max(r.y, 0.0);
    vec3 c = mix(vec3(0.74, 0.86, 0.93), vec3(0.18, 0.44, 0.78), pow(h, 0.5));
    float s = max(dot(r, uSun), 0.0);
    c += vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.25;
    if (r.y > 0.01) {                       // 貿易風積雲
      vec2 q = r.xz / (r.y + 0.06) * 1.3 + vec2(uTime * 0.004, 0.0);
      float cl = smoothstep(0.52, 0.78, fbm(q));
      vec3 cc = mix(vec3(0.62, 0.68, 0.76), vec3(1.0, 0.99, 0.97), smoothstep(0.5, 0.9, fbm(q + uSun.xz * 0.15)));
      c = mix(c, cc, cl * smoothstep(0.01, 0.12, r.y) * 0.95);
    }
    c = mix(c, vec3(0.80, 0.88, 0.92), exp(-h * 18.0) * 0.8);   // 水平線のかすみ
    return c + vec3(1.0, 0.95, 0.85) * (pow(s, 2400.0) * 40.0 + pow(s, 300.0) * 1.2);
  }`;

// 海面の法線と白波（ピクセルより細かい波は薄めて、ちらつきを防ぐ）
const SURFACE_FN = `
  vec3 nAcc; float crest; float uFp;
  void W(vec2 p, vec2 d, float k, float w, float A, float Q, float L){
    float fade = 1.0 - smoothstep(L * 0.1, L * 0.35, uFp);
    float ph = k * dot(d, p) - w * uTime, c = cos(ph), s = sin(ph);
    nAcc.xz += d * k * A * c * fade; nAcc.y += Q * k * A * s * fade;
    crest += A * s * fade;
  }
  vec3 surfNormal(vec2 p){
    nAcc = vec3(0.0); crest = 0.0;
      ${glslWaves}
    vec2 m = vec2(vn(p * 1.7 + uTime * 0.6), vn(p * 1.7 - uTime * 0.5 + 9.0)) - 0.5;
    nAcc.xz += m * 0.08 * (1.0 - smoothstep(0.1, 0.4, uFp));
    return normalize(vec3(-nAcc.x, 1.0 - nAcc.y, -nAcc.z));
  }
  vec4 shadeSurface(vec2 pm, vec3 wpos){
    vec3 toC = cameraPosition - wpos; float dist = length(toC); vec3 V = toC / dist;
    uFp = length(fwidth(pm));
    vec3 N = surfNormal(pm);
    if (cameraPosition.y >= wpos.y) {
      float cosT = max(dot(N, V), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      vec3 R = reflect(-V, N); R.y = abs(R.y);
      vec3 refl = skyCol(R);
      vec3 deep = vec3(0.004, 0.05, 0.10);
      float sss = pow(max(dot(V, -uSun + N * 0.6), 0.0), 3.0) * clamp(crest * 0.9 + 0.3, 0.0, 1.0);
      vec3 body = deep + vec3(0.02, 0.26, 0.28) * sss * 0.55 + vec3(0.0, 0.04, 0.06) * max(N.y, 0.0);
      vec3 col = mix(body, refl, F);
      float rough = mix(1400.0, 90.0, smoothstep(0.02, 2.0, uFp));
      col += vec3(1.0, 0.93, 0.8) * pow(max(dot(R, uSun), 0.0), rough) * mix(3.0, 0.3, smoothstep(0.02, 2.0, uFp));
      float foam = smoothstep(0.62, 0.95, crest) * smoothstep(0.45, 0.8, fbm(pm * 0.35 + uTime * 0.05));
      col = mix(col, vec3(0.86, 0.91, 0.93), foam * 0.5 * (1.0 - smoothstep(1.0, 4.0, uFp)));
      col = mix(col, skyCol(normalize(vec3(-V.x, 0.002, -V.z))), exp(-abs(V.y) * 30.0) * 0.85);
      return vec4(tm(col), F);
    } else {
      // 水中から見上げる: 屈折して見える空（スネルの窓）と、その外側の全反射
      vec3 I = -V;
      vec3 tr = refract(I, -N, 1.333);
      vec3 col;
      if (dot(tr, tr) < 0.001) col = vec3(0.02, 0.20, 0.27);
      else {
        float Ft = 0.02 + 0.98 * pow(1.0 - abs(dot(I, N)), 5.0);
        col = skyCol(normalize(tr)) * (1.0 - Ft) * 1.1 + vec3(0.02, 0.2, 0.27) * Ft;
      }
      col = mix(col, uFog, 1.0 - exp(-dist * uFogDen));
      return vec4(col, 1.0);
    }
  }`;

// ---------- 空 ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN }, uTime: { value: 0 } }, side: THREE.BackSide, depthWrite: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
  fragmentShader: `${COMMON} varying vec3 vD; void main(){ vec3 d = normalize(vD); vec3 c = d.y < 0.0 ? mix(vec3(0.74,0.86,0.93), vec3(0.01,0.07,0.12), smoothstep(0.0, -0.1, d.y)) : skyCol(d); gl_FragColor = vec4(tm(c), 1.0); }`
}));
sky.renderOrder = -2;
scene.add(sky);

// ---------- 遠景の海面（平面＋法線だけの波） ----------
const rect = T.rect;
const farMat = new THREE.ShaderMaterial({
  uniforms: {
    uSun: { value: SUN }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFogDen: { value: 6 },
    uRect: { value: new THREE.Vector4(rect.x0, rect.x1, rect.z0, rect.z1) }, uReal: { value: 0 }, uNear: { value: new THREE.Vector3(0, 0, 0) }
  },
  transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `${COMMON} uniform vec3 uFog; uniform float uFogDen, uReal; uniform vec4 uRect; uniform vec3 uNear; varying vec3 vW;
    ${SURFACE_FN}
    void main(){
      if (uNear.z > 0.0 && distance(vW.xz, uNear.xy) < uNear.z) discard;   // 近景メッシュの範囲は描かない
      if (cameraPosition.y < 0.0) { gl_FragColor = vec4(shadeSurface(vW.xz * 1000.0, vW).rgb, 1.0); return; }
      // 地図風の海（俯瞰・上空）: データ範囲の上は半透明にして海溝を見せる
      vec3 V = normalize(cameraPosition - vW);
      float Fs = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
      vec3 styl = mix(vec3(0.05, 0.22, 0.32), vec3(0.50, 0.68, 0.78), Fs * 0.6);
      float inside = smoothstep(uRect.x, uRect.x + 8.0, vW.x) * smoothstep(uRect.y, uRect.y - 8.0, vW.x)
                   * smoothstep(uRect.z, uRect.z + 8.0, vW.z) * smoothstep(uRect.w, uRect.w - 8.0, vW.z);
      vec3 col = styl; float a = mix(1.0, mix(0.3, 0.9, Fs), inside);
      if (uReal > 0.001) {
        vec4 s = shadeSurface(vW.xz * 1000.0, vW);
        col = mix(styl, s.rgb, uReal); a = mix(a, 1.0, uReal);
      }
      gl_FragColor = vec4(col, a);
    }`
});
const far = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400), farMat);
far.rotation.x = -Math.PI / 2;
far.position.set((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2);
far.renderOrder = 1;
scene.add(far);

// ---------- 近景の海面（頂点を動かす立体的な波。カメラに追従） ----------
const NEAR_R = 0.45, NEAR_SEG = 300;
const nearGeo = new THREE.PlaneGeometry(NEAR_R * 2, NEAR_R * 2, NEAR_SEG, NEAR_SEG);
nearGeo.rotateX(-Math.PI / 2);
const geoWaves = WAVES.filter(w => w.L >= 7).map(w =>
  `{ float ph = ${w.k.toFixed(5)} * dot(vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), p) - ${w.w.toFixed(5)} * uTime;
     off += vec3(${(w.Q * w.A * w.dx).toFixed(5)} * cos(ph), ${w.A.toFixed(4)} * sin(ph), ${(w.Q * w.A * w.dz).toFixed(5)} * cos(ph)); }`).join('\n        ');
const nearMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: SUN }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFogDen: { value: 6 }, uR: { value: NEAR_R } },
  side: THREE.DoubleSide, extensions: { derivatives: true },
  vertexShader: `uniform float uTime, uR; varying vec3 vW; varying vec2 vP;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vec2 p = w.xz * 1000.0; vP = p;
      vec3 off = vec3(0.0);
        ${geoWaves}
      float taper = 1.0 - smoothstep(uR * 0.7, uR, length(position.xz));
      w.xyz += off / 1000.0 * taper;
      vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `${COMMON} uniform vec3 uFog; uniform float uFogDen, uR; varying vec3 vW; varying vec2 vP;
    ${SURFACE_FN}
    void main(){ gl_FragColor = vec4(shadeSurface(vP, vW).rgb, 1.0); }`
});
const near = new THREE.Mesh(nearGeo, nearMat);
near.frustumCulled = false;
near.renderOrder = 1;
scene.add(near);

// ---------- 光芒（水中に差し込む光の筋） ----------
const RAYS = 90, rayGeo = new THREE.BufferGeometry();
{
  const c = [], side = [], tt = [], rnd = [], idx = [];
  for (let i = 0; i < RAYS; i++) {
    const cx = Math.random(), cz = Math.random(), r = Math.random();
    for (let j = 0; j < 4; j++) { c.push(cx, 0, cz); side.push(j % 2 ? 1 : -1); tt.push(j < 2 ? 0 : 1); rnd.push(r); }
    const b = i * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(c, 3));
  rayGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  rayGeo.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  rayGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 1));
  rayGeo.setIndex(idx);
}
// 屈折して水中を進む太陽光の向き（実寸の m 単位）
const refrSun = new THREE.Vector3(-SUN.x / 1.333, 0, -SUN.z / 1.333);
refrSun.y = -Math.sqrt(1 - refrSun.x ** 2 - refrSun.z ** 2);
const rayMat = new THREE.ShaderMaterial({
  uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uI: { value: 0 }, uDir: { value: new THREE.Vector3() }, uBox: { value: 0.12 }, uLen: { value: 0.12 } },
  vertexShader: `attribute float aSide, aT, aRnd; uniform vec3 uCam, uDir; uniform float uTime, uBox, uLen; varying float vT, vS, vR;
    void main(){ vT = aT; vS = aSide; vR = aRnd;
      vec2 c = mod(position.xz * uBox - uCam.xz + uBox * 0.5, uBox) + uCam.xz - uBox * 0.5;
      vec3 top = vec3(c.x, 0.0, c.y);
      vec3 p = top + uDir * aT * uLen * (0.6 + aRnd * 0.8);
      vec3 right = normalize(cross(uDir, uCam - p));
      p += right * aSide * (0.0008 + aRnd * 0.0022);
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `uniform float uI, uTime; varying float vT, vS, vR;
    void main(){ float a = pow(1.0 - vT, 1.6) * (1.0 - abs(vS)) * uI;
      a *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.4 + vR) + vR * 30.0), 2.0);
      gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a * 0.35, a * 0.35); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
});
const rays = new THREE.Mesh(rayGeo, rayMat);
rays.frustumCulled = false;
scene.add(rays);

// ---------- 入水時の泡 ----------
const BUB = 420, bubGeo = new THREE.BufferGeometry();
{
  const p = [], r = [];
  for (let i = 0; i < BUB; i++) { const a = Math.random() * 6.283, d = Math.pow(Math.random(), 0.6) * 3; p.push(Math.cos(a) * d, -Math.random() * 6, Math.sin(a) * d); r.push(Math.random()); }
  bubGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  bubGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(r, 1));
}
const bubMat = new THREE.ShaderMaterial({
  uniforms: { uAge: { value: 99 }, uOrigin: { value: new THREE.Vector3() }, uEx: { value: 4 }, uPR: { value: renderer.getPixelRatio() } },
  vertexShader: `attribute float aRnd; uniform float uAge, uEx, uPR; uniform vec3 uOrigin; varying float vA;
    void main(){
      vec3 m = position; m.y += uAge * (0.4 + aRnd * 1.6);
      m.x += sin(uAge * 3.0 + aRnd * 20.0) * 0.08;
      vA = (1.0 - smoothstep(3.0, 7.0, uAge)) * step(m.y, 0.0);
      vec3 w = uOrigin + vec3(m.x / 1000.0, m.y / 1000.0 * uEx, m.z / 1000.0);
      vec4 mv = viewMatrix * vec4(w, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = uPR * clamp((0.00002 + aRnd * 0.00005) * 900.0 / max(-mv.z, 0.0001), 1.0, 28.0); }`,
  fragmentShader: `varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float rim = smoothstep(0.55, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
      float hl = smoothstep(0.35, 0.0, length(gl_PointCoord - vec2(0.35, 0.3)));
      float a = (rim * 0.8 + hl * 0.9) * vA; gl_FragColor = vec4(vec3(0.9, 0.98, 1.0) * a, a); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
});
const bubbles = new THREE.Points(bubGeo, bubMat);
bubbles.frustumCulled = false;
scene.add(bubbles);

// ---------- 毎フレームの更新 ----------
const water = new THREE.Color();
function update(t, { dive, under, depth, ex, surfaceOn }) {
  far.visible = dive || surfaceOn;
  const camY = camera.position.y;
  [sky.material, farMat, nearMat, rayMat].forEach(m => m.uniforms.uTime.value = t);
  sky.position.copy(camera.position);
  sky.visible = !under;
  T.waterColor(Math.max(0, depth), water);
  [farMat, nearMat].forEach(m => { m.uniforms.uFog.value.copy(water); m.uniforms.uFogDen.value = 25 / ex; });
  // 高度2kmから300mまで降りる間に、写実的な海面へ切り替える
  const k = Math.min(1, Math.max(0, (camY - 0.3) / 1.7));
  farMat.uniforms.uReal.value = dive ? 1 - k * k * (3 - 2 * k) : 0;
  // 近景メッシュは、潜航中にカメラが海面付近にいるときだけ使う
  const useNear = dive && camY < 0.35 && camY > -0.4;
  near.visible = useNear;
  if (useNear) {
    const cell = NEAR_R * 2 / NEAR_SEG;
    near.position.set(Math.round(camera.position.x / cell) * cell, 0, Math.round(camera.position.z / cell) * cell);
  }
  farMat.uniforms.uNear.value.set(near.position.x, near.position.z, useNear ? NEAR_R * 0.98 : 0);
  // 光芒: 浅いところほど強い
  rayMat.uniforms.uCam.value.copy(camera.position);
  rayMat.uniforms.uDir.value.set(refrSun.x, refrSun.y * ex, refrSun.z).normalize();
  rayMat.uniforms.uLen.value = 0.03 * ex;
  rayMat.uniforms.uI.value = under ? Math.exp(-depth / 35) * Math.min(1, depth / 2) : 0;
  rays.visible = rayMat.uniforms.uI.value > 0.01;
  bubMat.uniforms.uEx.value = ex;
}
function splashBubbles(origin) { bubMat.uniforms.uOrigin.value.copy(origin); bubMat.uniforms.uAge.value = 0; }
function tickBubbles(dt) { bubMat.uniforms.uAge.value += dt; }

window.__SEA = { update, waveHeight, splashBubbles, tickBubbles, SUN };
})();
