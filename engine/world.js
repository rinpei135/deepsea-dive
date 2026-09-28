(() => {
const B = window.BATHY, SEA = window.SEA;
// ---------- 地形データの展開 ----------
const bin = atob(B.b64), buf = new ArrayBuffer(bin.length), u8 = new Uint8Array(buf);
for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
const elev = new Int16Array(buf);            // 北→南, 西→東
const NX = B.nlon, NZ = B.nlat, STEP = B.step;
// 範囲内で一番深い格子点 (lat/lon の範囲指定)
function deepestIn(latA, latB, lonA, lonB) {
  let best = -1;
  for (let r = 0; r < NZ; r++) {
    const lat = B.lat0 - r * STEP; if (lat < latA || lat > latB) continue;
    for (let c = 0; c < NX; c++) {
      const lon = B.lon0 + c * STEP; if (lon < lonA || lon > lonB) continue;
      const i = r * NX + c; if (best < 0 || elev[i] < elev[best]) best = i;
    }
  }
  return { lat: B.lat0 - Math.floor(best / NX) * STEP, lon: B.lon0 + (best % NX) * STEP, depth: -elev[best] };
}
// 潜航地点（海ごとの設定で決める。マリアナ海溝ならチャレンジャー海淵）
const CD = deepestIn(...SEA.origin.box);
const KX = 111.32 * Math.cos(CD.lat * Math.PI / 180), KZ = 110.57; // 1度あたりのkm
const toX = lon => (lon - CD.lon) * KX, toZ = lat => -(lat - CD.lat) * KZ;
function elevAt(lat, lon) {                  // 双一次補間 (m)
  const fx = (lon - B.lon0) / STEP, fz = (B.lat0 - lat) / STEP;
  const x0 = Math.max(0, Math.min(NX - 2, Math.floor(fx))), z0 = Math.max(0, Math.min(NZ - 2, Math.floor(fz)));
  const tx = fx - x0, tz = fz - z0, g = (x, z) => elev[z * NX + x];
  return (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
}

// ---------- three.js ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// スマホなど小さい画面では描画の細かさを少し抑えて、動作を軽くする
renderer.setPixelRatio(Math.min(devicePixelRatio, Math.min(innerWidth, innerHeight) < 600 ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06121c);
scene.fog = new THREE.FogExp2(0x06121c, 0);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.002, 5000);

const state = { ex: 4 };
const geo = new THREE.PlaneGeometry(1, 1, NX - 1, NZ - 1);
const pos = geo.attributes.position;
const elevAttr = new Float32Array(NX * NZ);
for (let i = 0; i < NX * NZ; i++) elevAttr[i] = elev[i];
geo.setAttribute('elev', new THREE.BufferAttribute(elevAttr, 1));
function setExaggeration(ex) {
  state.ex = ex;
  for (let i = 0; i < NX * NZ; i++) {
    const r = Math.floor(i / NX), c = i % NX;
    pos.setXYZ(i, toX(B.lon0 + c * STEP), elev[i] / 1000 * ex, toZ(B.lat0 - r * STEP));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}
setExaggeration(4);

const terrainMat = new THREE.ShaderMaterial({
  extensions: { derivatives: true },
  uniforms: {
    uCam: { value: new THREE.Vector3() }, uDive: { value: 0 }, uSonar: { value: 1 }, uTime: { value: 0 },
    uFog: { value: new THREE.Color() }, uFogDen: { value: 0 }, uLampR: { value: 1 },
    // ソナーの発信: xyz = 発信位置, w = 発信からの経過秒 (<0 は未使用)
    uPing: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, -1)) },
    // 水中の音速 約1,500 m/秒 = 1.5 km/秒（シーンの水平1単位 = 1km）。届く範囲は60km
    uPingSpeed: { value: 1.5 }, uHold: { value: 5 }, uRange: { value: 60 }, uEx: { value: 4 },
    uChest: { value: new THREE.Vector4(0, 0, 0, 0) }   // 宝箱の位置 (w=1 で金属反応を表示)
  },
  vertexShader: `
    attribute float elev; varying vec3 vW; varying vec3 vN; varying float vE;
    void main(){ vE = elev; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(normal);
      gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform vec3 uCam; uniform float uDive, uSonar, uTime, uFogDen, uLampR, uPingSpeed, uHold, uRange, uEx; uniform vec3 uFog; uniform vec4 uPing[6]; uniform vec4 uChest;
    varying vec3 vW; varying vec3 vN; varying float vE;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    vec3 ramp(float d){
      vec3 c = vec3(0.46, 0.74, 0.74);
      c = mix(c, vec3(0.28, 0.62, 0.70), smoothstep(0.0, 400.0, d));
      c = mix(c, vec3(0.19, 0.50, 0.66), smoothstep(400.0, 2000.0, d));
      c = mix(c, vec3(0.14, 0.33, 0.55), smoothstep(2000.0, 4000.0, d));
      c = mix(c, vec3(0.12, 0.22, 0.44), smoothstep(4000.0, 6000.0, d));
      c = mix(c, vec3(0.13, 0.13, 0.33), smoothstep(6000.0, 8500.0, d));
      c = mix(c, vec3(0.10, 0.05, 0.20), smoothstep(8500.0, 11000.0, d));
      return c; }
    float contour(float q){ float d = abs(fract(q + 0.5) - 0.5); return 1.0 - smoothstep(0.0, fwidth(q) * 1.4, d); }
    void main(){
      vec3 N = normalize(vN); float d = -vE;
      vec3 col;
      if (uDive < 0.5) {
        // 陸地（グアム島など）は緑がかった茶色、海底は水深の色。陰影は白飛びしない強さに
        vec3 base = d < 0.0 ? mix(vec3(0.30, 0.40, 0.24), vec3(0.50, 0.46, 0.34), clamp(-d / 300.0, 0.0, 1.0)) : ramp(d);
        float diff = 0.32 + 0.62 * max(dot(N, normalize(vec3(-0.45, 0.8, 0.35))), 0.0);
        col = min(base * diff, vec3(0.9));
        if (d > 0.0) col = mix(col, col * 0.5, contour(d / 1000.0) * 0.7);
      } else {
        vec3 toC = uCam - vW; float dist = length(toC);
        float grain = n2(vW.xz * 900.0) * 0.5 + n2(vW.xz * 90.0) * 0.5;
        vec3 sed = mix(vec3(0.42, 0.39, 0.34), vec3(0.62, 0.58, 0.50), grain);
        float sun = exp(-max(d, 0.0) / 70.0) * (0.35 + 0.65 * max(N.y, 0.0));
        float lamp = pow(max(dot(N, toC / dist), 0.0), 0.7) * (1.0 - smoothstep(0.0, uLampR, dist)) * 1.8;
        col = sed * (sun + lamp);
        col = mix(col, uFog, 1.0 - exp(-dist * uFogDen));
        // ソナー: 音の波面が届いた地形を一定時間だけ浮かび上がらせる
        float seen = 0.0, front = 0.0;
        for (int i = 0; i < 6; i++) {
          vec4 pg = uPing[i];
          if (pg.w < 0.0) continue;
          vec3 dv = vW - pg.xyz; dv.y /= uEx;            // 高さ強調を戻した実際の距離 (km)
          float dd = length(dv), r = pg.w * uPingSpeed;
          float since = pg.w - dd / uPingSpeed;
          float reach = 1.0 - smoothstep(uRange * 0.75, uRange, dd);
          if (since > 0.0) seen = max(seen, (1.0 - smoothstep(uHold, uHold + 2.5, since)) * reach);
          front = max(front, exp(-pow((r - dd) / (0.04 + r * 0.004), 2.0)) * reach);
        }
        float relief = 0.18 + 0.7 * max(dot(N, normalize(vec3(0.3, 1.0, 0.2))), 0.0);
        float lines = contour(d / 250.0) * 0.5 + contour(d / 1000.0) * 0.5;
        vec3 sonarCol = vec3(0.22, 0.78, 0.92) * relief * 0.55 + vec3(0.45, 0.95, 1.0) * lines * 0.6;
        col += uSonar * (sonarCol * seen + vec3(0.6, 1.0, 1.0) * front * 0.55);
        // 隠し要素: ソナーで見えている範囲にある宝箱の周囲だけ、うっすら金色に
        vec3 dc = vW - uChest.xyz; dc.y /= uEx;
        float gold = (1.0 - smoothstep(0.2, 0.7, length(dc))) * seen * uChest.w;
        col += uSonar * vec3(1.0, 0.74, 0.25) * gold * (0.35 + 0.2 * sin(uTime * 4.0));   // 目立ちすぎない程度に
      }
      gl_FragColor = vec4(col, 1.0);
    }`
});
const terrain = new THREE.Mesh(geo, terrainMat);
terrain.frustumCulled = false;
scene.add(terrain);

const rect = { x0: toX(B.lon0), x1: toX(B.lon1), z0: toZ(B.lat0), z1: toZ(B.lat1) };
const fromXZ = (x, z) => ({ lat: CD.lat - z / KZ, lon: CD.lon + x / KX });
const floorDepth = (x, z) => { const g = fromXZ(x, z); return -elevAt(g.lat, g.lon); };   // m, 下向き正

// ---------- マリンスノーと生物発光 ----------
function particles(count, box, fragColor, blink) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3), r = new Float32Array(count);
  for (let i = 0; i < count; i++) { p[i * 3] = Math.random() * box; p[i * 3 + 1] = Math.random() * box; p[i * 3 + 2] = Math.random() * box; r[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('rnd', new THREE.BufferAttribute(r, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAlpha: { value: 0 }, uBox: { value: box }, uPR: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float rnd; uniform vec3 uCam; uniform float uTime, uBox, uPR; varying float vR; varying float vD;
      void main(){ vR = rnd;
        vec3 p = position + vec3(sin(uTime * 0.3 + rnd * 6.0) * 0.004, -uTime * 0.0015 * (0.5 + rnd), 0.0);
        p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
        vec4 mv = viewMatrix * vec4(p, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv;
        gl_PointSize = uPR * clamp(${blink ? '0.9' : '0.05'} / max(vD, 0.001), 1.0, ${blink ? '9.0' : '5.0'}); }`,
    fragmentShader: `
      uniform float uAlpha, uTime, uBox; varying float vR; varying float vD;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        ${blink ? 'a *= pow(max(sin(uTime * (0.6 + vR * 1.8) + vR * 40.0), 0.0), 24.0);' : ''}
        a *= uAlpha * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, vD));
        gl_FragColor = vec4(${fragColor} * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false;
  scene.add(pts);
  return m;
}
const snow = particles(2500, 0.5, 'vec3(0.85, 0.9, 0.9)', false);
const glow = particles(500, 3.0, 'vec3(0.35, 0.95, 1.0)', true);

// ---------- 水中の見え方 ----------
const WATER = [[0, 0x2b8fb4], [60, 0x146a92], [200, 0x063553], [600, 0x021726], [1000, 0x010a12], [3000, 0x000306]];
const cA = new THREE.Color(), cB = new THREE.Color();
function waterColor(d, out) {
  for (let i = 1; i < WATER.length; i++) if (d <= WATER[i][0]) {
    const t = (d - WATER[i - 1][0]) / (WATER[i][0] - WATER[i - 1][0]);
    return out.copy(cA.setHex(WATER[i - 1][1])).lerp(cB.setHex(WATER[i][1]), t);
  }
  return out.setHex(WATER[WATER.length - 1][1]);
}

window.__TRENCH = { renderer, scene, camera, terrain, terrainMat, rect, fromXZ, floorDepth, deepestIn, elev, NX, NZ, snow, glow, state, CD, toX, toZ, elevAt, setExaggeration, waterColor };
})();
