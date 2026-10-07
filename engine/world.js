(() => {
const B = window.BATHY, SEA = window.SEA;
// ---------- 地形データの展開 ----------
const bin = atob(B.b64), buf = new ArrayBuffer(bin.length), u8 = new Uint8Array(buf);
for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
const elev = new Int16Array(buf);            // 北→南, 西→東
const NX = B.nlon, NZ = B.nlat, STEP = B.step;
// 島のない所で海面より高く出ている点（浅い礁がデータの誤差で陸になったもの）は、浅瀬に直す（config の islands）
if (SEA.islands) {
  const isIsland = (lat, lon) => SEA.islands.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
  for (let i = 0; i < elev.length; i++) if (elev[i] > -SEA.shoalDepth && !isIsland(B.lat0 - Math.floor(i / NX) * STEP, B.lon0 + (i % NX) * STEP)) elev[i] = Math.min(elev[i], -SEA.shoalDepth);
}
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
// 格子の双一次補間 (m)。grid = { lat0（北端）, lon0（西端）, step, nlat, nlon, e（北→南, 西→東）}
function bilinear(G, lat, lon) {
  const fx = (lon - G.lon0) / G.step, fz = (G.lat0 - lat) / G.step;
  const x0 = Math.max(0, Math.min(G.nlon - 2, Math.floor(fx))), z0 = Math.max(0, Math.min(G.nlat - 2, Math.floor(fz)));
  const tx = fx - x0, tz = fz - z0, g = (x, z) => G.e[z * G.nlon + x];
  return (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
}
const COARSE = { lat0: B.lat0, lon0: B.lon0, step: STEP, nlat: NZ, nlon: NX, e: elev };
// 細かい地形（detail.js があれば）: 海の一部だけ、船の音響測深に基づく細かい格子に差し替える。
// 端の数格子では粗い地形となめらかにつなぐ
const DETAIL = (window.BATHY_DETAIL || []).map(t => {
  const s = atob(t.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  const D = Object.assign({}, t, { e: new Int16Array(u.buffer), lat1: t.lat0 - (t.nlat - 1) * t.step, lon1: t.lon0 + (t.nlon - 1) * t.step });
  fillFalseDeeps(D);
  return D;
});
// データの誤り（グアムのアプラ港の中などに、まわりは水深数十 m なのに 1,000〜2,600m になっている所がある）を直す。
// 水深 150m より深い所のかたまりのうち、外の深い海につながっておらず（格子の端に届かず）、まわりのほとんど（9 割以上）が
// 水深 80m より浅い所に囲まれているものは誤りとみなし、まわりの浅い所の高さから、なめらかに埋める
function fillFalseDeeps(D) {
  const W = D.nlon, H = D.nlat, e = D.e, seen = new Uint8Array(W * H), comp = [], st = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (seen[i0] || e[i0] > -150) continue;
    comp.length = 0; st.length = 0; st.push(i0); seen[i0] = 1;
    let edge = false, ring = 0, shallow = 0;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i - x) / W; comp.push(i);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (e[j] <= -150) { if (!seen[j]) { seen[j] = 1; st.push(j); } }
        else { ring++; if (e[j] > -80) shallow++; }
      }
      if (comp.length > 20000) { edge = true; break; }                   // 大きな海は調べない
    }
    if (edge || !ring || shallow / ring < 0.9) continue;
    // まわりの海（陸は除く）の平均から始めて、隣どうしの平均を何度もとり、なめらかにつなぐ
    const water = j => e[j] < 0 && e[j] > -150;
    let sum = 0, n = 0;
    comp.forEach(i => { const x = i % W; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const j = i + dy * W + dx; if (x + dx >= 0 && x + dx < W && j >= 0 && j < W * H && water(j)) { sum += e[j]; n++; } }); });
    const set = new Set(comp), v = new Float32Array(W * H), v0 = n ? sum / n : -10; comp.forEach(i => { v[i] = v0; });
    for (let it = 0; it < 60; it++) comp.forEach(i => {
      const x = i % W; let s2 = 0, m = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { if (x + dx < 0 || x + dx >= W) return; const j = i + dy * W + dx; if (j < 0 || j >= W * H) return; if (set.has(j)) { s2 += v[j]; m++; } else if (water(j)) { s2 += e[j]; m++; } });
      if (m) v[i] = s2 / m;
    });
    comp.forEach(i => { e[i] = Math.round(Math.min(v[i], -2)); });     // 海のまま（陸にはしない）
  }
}
// 潜航地点（海ごとの設定で決める。マリアナ海溝ならチャレンジャー海淵）。細かい地形があれば、その中の最深点にする
function deepestDetail(latA, latB, lonA, lonB) {
  let best = null;
  DETAIL.forEach(D => { for (let r = 0; r < D.nlat; r++) for (let c = 0; c < D.nlon; c++) {
    const lat = D.lat0 - r * D.step, lon = D.lon0 + c * D.step;
    if (lat < latA || lat > latB || lon < lonA || lon > lonB) continue;
    const e = D.e[r * D.nlon + c]; if (!best || e < -best.depth) best = { lat, lon, depth: -e };
  } });
  return best;
}
const CD = deepestDetail(...SEA.origin.box) || deepestIn(...SEA.origin.box);
const KX = 111.32 * Math.cos(CD.lat * Math.PI / 180), KZ = 110.57; // 1度あたりのkm
const toX = lon => (lon - CD.lon) * KX, toZ = lat => -(lat - CD.lat) * KZ;
const EDGE = 8;                              // つなぎの幅（格子の数）
function elevAt(lat, lon) {
  let v = bilinear(COARSE, lat, lon);
  for (const D of DETAIL) {
    if (lat > D.lat0 || lat < D.lat1 || lon < D.lon0 || lon > D.lon1) continue;
    const m = Math.min((lon - D.lon0) / D.step, (D.lon1 - lon) / D.step, (D.lat0 - lat) / D.step, (lat - D.lat1) / D.step);
    const w = Math.min(1, m / EDGE), k = w * w * (3 - 2 * w);
    v = v * (1 - k) + bilinear(D, lat, lon) * k;
  }
  return v;
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

const state = { ex: 4, chunksReady: false };   // chunksReady: 地形の区画を作り終えたか（作る前の高さの強調は、区画に写さない）
const geo = new THREE.PlaneGeometry(1, 1, NX - 1, NZ - 1);
const pos = geo.attributes.position;
const elevAttr = new Float32Array(NX * NZ);
for (let i = 0; i < NX * NZ; i++) elevAttr[i] = elev[i];
geo.setAttribute('elev', new THREE.BufferAttribute(elevAttr, 1));
geo.setAttribute('det', new THREE.BufferAttribute(new Float32Array(NX * NZ), 1));   // 0 = 粗い地形
// 細かい地形のメッシュ（高さはつなぎ込み済みの値）。粗い地形は、この範囲の中を描かない
const detailGeos = DETAIL.map(D => {
  const g = new THREE.PlaneGeometry(1, 1, D.nlon - 1, D.nlat - 1), n = D.nlon * D.nlat, ev = new Float32Array(n);
  for (let i = 0; i < n; i++) ev[i] = elevAt(D.lat0 - Math.floor(i / D.nlon) * D.step, D.lon0 + (i % D.nlon) * D.step);
  g.setAttribute('elev', new THREE.BufferAttribute(ev, 1));
  g.setAttribute('det', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  g.userData.D = D;
  return g;
});
// 高さ (km)。海底の深さだけを強調し、陸地は実際の高さのまま（島の山が何倍にも高くならないように）。
// 強調は水深 50m までは掛けず、50〜200m でなめらかに強め、それより深い所では ex 倍の割合で深くなる。
// （浅い海では、近くの海底・サンゴ・生き物は実際の深さで描くので、まわりの地形も実際の深さにそろえる。そろえないと、
// 見通しのよい浅い海で、近くの海底の縁が段のように見える）。深さ d (m) → 強調した深さ (m)。どこでも深いほど大きい
const EX_A = 50, EX_B = 200;
const exDepth = (d, ex) => d + (ex - 1) * (d <= EX_A ? 0 : d <= EX_B ? (d - EX_A) ** 2 / (2 * (EX_B - EX_A)) : d - (EX_A + EX_B) / 2);
const yOfElev = (e, ex) => e > 0 ? e / 1000 : -exDepth(-e, ex) / 1000;
const EXDEPTH_GLSL = `float exDepth(float d, float ex){ float g = d <= ${EX_A}.0 ? 0.0 : d <= ${EX_B}.0 ? (d - ${EX_A}.0) * (d - ${EX_A}.0) / ${2 * (200 - 50)}.0 : d - ${(50 + 200) / 2}.0; return d + (ex - 1.0) * g; }`;
function setExaggeration(ex) {
  state.ex = ex;
  for (let i = 0; i < NX * NZ; i++) {
    const r = Math.floor(i / NX), c = i % NX;
    pos.setXYZ(i, toX(B.lon0 + c * STEP), yOfElev(elev[i], ex), toZ(B.lat0 - r * STEP));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  detailGeos.forEach(g => {
    const D = g.userData.D, p = g.attributes.position, ev = g.attributes.elev.array;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, toX(D.lon0 + (i % D.nlon) * D.step), yOfElev(ev[i], ex), toZ(D.lat0 - Math.floor(i / D.nlon) * D.step));
    p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  });
  if (state.chunksReady) refreshChunks();
}
setExaggeration(4);

// ---------- 島の近くの細かい陸地（config の coast。engine/coast.js が画像を読み込み、カメラのまわりに細かい地形を描く） ----------
// 共有する uniform（地形・近くの細かい地形・海面の材質が同じものを使う）:
//   uDem  陸地の高さの画像（約 20m / 画素。R*256+G = 高さ cm、海は 0）  uSat  衛星写真
//   uGm   島のまわりの約 120m 格子（GMRT。海底も含む高さ。R*256+G = (高さ+3000)*10）
//   uCoM  世界の座標 (km) → 画像の座標 (au, bu, av, bv)  uCoB  範囲 (x0, x1, z0, z1)
//   uPatch  細かい地形の中心 x, z (km)・半分の幅 (km)・使うか (w > 0.5)
const COAST = (() => {
  const cfg = SEA.coast, U = {
    uDem: { value: null }, uSat: { value: null }, uGm: { value: null }, uDemS: { value: new THREE.Vector2(1, 1) }, uGmS: { value: new THREE.Vector2(1, 1) },
    uCoM: { value: new THREE.Vector4() }, uGmM: { value: new THREE.Vector4() }, uCoB: { value: new THREE.Vector4(1e9, -1e9, 1e9, -1e9) },
    uDemOn: { value: 0 }, uSatOn: { value: 0 }, uPatch: { value: new THREE.Vector4(0, 0, 0, 0) }
  };
  if (!cfg) return { U, cfg: null };
  const [s, n, w, e] = cfg.box, x0 = toX(w), x1 = toX(e), z0 = toZ(n), z1 = toZ(s);
  U.uCoM.value.set(1 / (x1 - x0), -x0 / (x1 - x0), 1 / (z1 - z0), -z0 / (z1 - z0)); U.uCoB.value.set(x0, x1, z0, z1);
  // 島のまわりの約 120m 格子（detail.js の島のタイル）を、海底の深さまで入る 16bit のテクスチャにする
  const D = DETAIL.find(t => t.name && t.name.includes(cfg.tile));
  if (D) {
    const a = new Uint8Array(D.nlon * D.nlat * 4);
    for (let i = 0; i < D.e.length; i++) { const v = Math.max(0, Math.min(65535, Math.round((D.e[i] + 3000) * 10))); a[i * 4] = v >> 8; a[i * 4 + 1] = v & 255; a[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(a, D.nlon, D.nlat, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
    const gx0 = toX(D.lon0), gx1 = toX(D.lon0 + (D.nlon - 1) * D.step), gz0 = toZ(D.lat0), gz1 = toZ(D.lat0 - (D.nlat - 1) * D.step);
    const au = (D.nlon - 1) / D.nlon / (gx1 - gx0), av = (D.nlat - 1) / D.nlat / (gz1 - gz0);
    U.uGm.value = t; U.uGmS.value.set(D.nlon, D.nlat); U.uGmM.value.set(au, 0.5 / D.nlon - au * gx0, av, 0.5 / D.nlat - av * gz0);
  }
  return { U, cfg };
})();
// 地形・海面のシェーダーで共通に使う関数
const COAST_GLSL = `
  uniform sampler2D uDem, uSat, uGm; uniform vec2 uDemS, uGmS; uniform vec4 uCoM, uGmM, uCoB, uPatch; uniform float uDemOn, uSatOn;
  bool inCoast(vec2 xz){ return xz.x > uCoB.x && xz.x < uCoB.y && xz.y > uCoB.z && xz.y < uCoB.w; }
  vec2 coastUV(vec2 xz){ return vec2(xz.x * uCoM.x + uCoM.y, xz.y * uCoM.z + uCoM.w); }
  // 16bit の値を 4 点読んで自前で補間する（GPU の補間は細かさが足りず、引き伸ばすと段になる）
  float dec16(vec4 t){ return t.r * 65280.0 + t.g * 255.0; }
  float bil16(sampler2D t, vec2 uv, vec2 n){
    vec2 p = uv * n - 0.5, i = floor(p), f = p - i;
    float a = dec16(texture2D(t, (i + vec2(0.5, 0.5)) / n)), b = dec16(texture2D(t, (i + vec2(1.5, 0.5)) / n));
    float c = dec16(texture2D(t, (i + vec2(0.5, 1.5)) / n)), d = dec16(texture2D(t, (i + vec2(1.5, 1.5)) / n));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float demAt(vec2 xz){ return bil16(uDem, coastUV(xz), uDemS) / 100.0; }                 // 陸地の高さ (m)。海は 0
  // 浜の斜面の、水深の上限 (m)（coast.js が陸地の画像の B に入れる。上限 = 120 × (B/254)²、255 = 上限なし）
  float beachCap(vec2 xz){
    vec2 n = uDemS, p = coastUV(xz) * n - 0.5, i = floor(p), f = p - i;
    float a = texture2D(uDem, (i + vec2(0.5, 0.5)) / n).b, b = texture2D(uDem, (i + vec2(1.5, 0.5)) / n).b, c = texture2D(uDem, (i + vec2(0.5, 1.5)) / n).b, d = texture2D(uDem, (i + vec2(1.5, 1.5)) / n).b;
    float v = mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 255.0 / 254.0;    // 上限なし（255）は約 121m として混ぜる（なめらかにつながる）
    return v > 0.999 || v < 0.02 ? 1e4 : 120.0 * v * v;                   // 0 は計算前（上限なし）
  }
  float gmAt(vec2 xz){ return bil16(uGm, vec2(xz.x * uGmM.x + uGmM.y, xz.y * uGmM.z + uGmM.w), uGmS) / 10.0 - 3000.0; }   // 約120m 格子の高さ (m)
  // 島の近くの高さ (m): 陸は細かい陸地の高さ、海は約 120m 格子の海底（細かい陸地で海になった所は、少なくとも 0.4m の浅瀬）
  float coastElev(vec2 xz){
    float g = gmAt(xz), l = demAt(xz);
    return l > 0.3 ? l : max(min(g, -0.4), -beachCap(xz));
  }
  vec3 satAt(vec2 xz){ return texture2D(uSat, coastUV(xz)).rgb; }
`;

// 地球の丸み: カメラから水平に d (km) 離れた所は d² / 2R だけ低く見える。大気の屈折で光が少し曲がるので、
// 半径は実際（6,371km）より大きい約 7,330km として計算する（60km 先で約 250m 下がる）
const CURVE_GLSL = `
  uniform float uCurv;
  vec4 curved(vec4 w){ vec2 d = w.xz - cameraPosition.xz; w.y -= uCurv * dot(d, d) / 14660.0; return w; }`;

// 礁のまだら（0〜1。大きいほどサンゴの岩場、小さいほど白い砂）。pm: 世界の座標 (m)。
// 地形（world.js）・近くの海底（creatures.js）で同じ式を使い、サンゴもこの値の大きい所に置く（遠くと近くで模様がそろうように）
// 格子の点 p（整数）と番号 k から決まる乱数（0〜1）。小数の計算だと、GPU（32bit）と JS（64bit）で精度が違い、
// 8 割ほどの点で値がまったく変わってしまう（遠くに描くサンゴと立体のサンゴの場所がずれる）。整数の計算なら、どちらでも同じ値になる
const HASH_GLSL = `
  #if __VERSION__ >= 300
  uint hU(uint x){ x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
  float h2u(vec2 p, float k){ vec2 m = mod(p, 4096.0); return float(hU(uint(m.x) + hU(uint(m.y) + hU(uint(k) + 1u)))) / 4294967296.0; }
  #else
  float h2u(vec2 p, float k){ vec3 q = fract(vec3(mod(p, 4096.0).xyx + k * 0.37) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  #endif`;
const hU = x => { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; };
const h2uJS = (px, py, k) => { const mx = ((px % 4096) + 4096) % 4096, my = ((py % 4096) + 4096) % 4096; return hU((mx + hU((my + hU((k + 1) >>> 0)) >>> 0)) >>> 0) / 4294967296; };
const REEF_GLSL = `
  ${HASH_GLSL}
  float rfH(vec2 p){ return h2u(p, 0.0); }
  float rfN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rfH(i), rfH(i + vec2(1, 0)), f.x), mix(rfH(i + vec2(0, 1)), rfH(i + vec2(1, 1)), f.x), f.y); }
  float reefMask(vec2 pm){
    vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * pm; pr += 6.0 * vec2(rfN(pm * 0.03), rfN(pm * 0.03 + 7.0));
    return rfN(pr * 0.08) * 0.5 + rfN(pr * 0.21 + 3.0) * 0.3 + rfN(pm * 0.5) * 0.2;
  }
  // 岩場の色（藻に覆われた死サンゴやがれき）。砂の色との混ぜ具合 = smoothstep(0.5, 0.65, reefMask)
  vec3 reefRock(vec2 pm){ return mix(vec3(0.46, 0.41, 0.33), vec3(0.52, 0.45, 0.47), rfN(pm * 0.9)); }`;
// サンゴの色（creatures.js の立体のサンゴと、遠くの海底に描くサンゴで共通）。
// 浅瀬は本物らしさより美しさを優先し、生きたサンゴの鮮やかな色だけにする（ミドリイシの青紫・ハナヤサイサンゴの桃色・ハマサンゴの黄緑・
// キクメイシの緑・紫・黄・橙・青緑・サーモン・淡い藤色・濃い桃色。白化したもの・藻に覆われた死サンゴの色は使わない）
const CORAL_COLS = [[0.30, 0.45, 1.00], [0.75, 0.35, 0.88], [1.00, 0.42, 0.65], [0.72, 0.88, 0.28], [0.25, 0.90, 0.55], [1.00, 0.80, 0.22], [1.00, 0.55, 0.22],
  [0.58, 0.30, 0.80], [0.30, 0.85, 0.85], [1.00, 0.60, 0.45], [0.85, 0.60, 0.95], [1.00, 0.35, 0.55]];
const CORAL_AVG = CORAL_COLS.reduce((a, c) => a.map((v, i) => v + c[i] / CORAL_COLS.length), [0, 0, 0]);
// ---------- 浅瀬は美しさを優先する ----------
// 浅い海（水深 20m まで）は、本物の海より赤・黄の光を多く残し（本物は 5m ほどで赤い光がほとんど消える）、サンゴや魚の色が鮮やかに見えるようにする。
// 20〜45m でなめらかに本物の値へ戻す（深い海は本物どおり）
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const beautyK = d => 1 - sstep(20, 45, d);                             // 1 = 浅瀬（美しさ優先）、0 = 本物どおり
const SUN_K = [0.25, 0.04, 0.018], SUN_K_B = [0.07, 0.028, 0.015];      // 上からの光が 1m あたりに弱まる割合（赤・緑・青。本物 / 浅瀬）
const sunK = d => { const b = beautyK(d); return SUN_K.map((v, i) => v + (SUN_K_B[i] - v) * b); };
const BEAUTY_GLSL = `
  float beautyK(float d){ return 1.0 - smoothstep(20.0, 45.0, d); }
  vec3 sunK(float d){ return mix(vec3(${SUN_K.join(', ')}), vec3(${SUN_K_B.join(', ')}), beautyK(d)); }`;
// ---------- サンゴの庭（見どころ） ----------
// config の sites のうち kind: 'garden' の場所。style: 'table'（テーブルサンゴが段々に重なる）/ 'branch'（枝サンゴの林）/
// 'anemone'（イソギンチャク畑。イソギンチャクは reef.js が置く）。庭の中はサンゴがびっしり育つ（遠くの海底に描くサンゴも同じ式で決める）。
// 公開前（status: 'preview'）の庭は、プレビュー表示のときだけ（creatures.js と同じ判定。設定の書き換えは creatures.js がする）
const PREVIEW_ON = (() => {
  const q = new URLSearchParams(location.search).get('preview');
  if (q === 'on' || q === 'off') return q === 'on';
  try { return localStorage.getItem('deepsea-preview') === '1'; } catch (_) { return false; }
})();
const GARDEN_STYLE = { table: 0, branch: 1, anemone: 2 };
const GARDENS = ((SEA && SEA.sites) || []).filter(s => s.kind === 'garden' && (s.status !== 'preview' || PREVIEW_ON)).slice(0, 4)
  .map(s => ({ x: toX(s.lon) * 1000, z: toZ(s.lat) * 1000, r: s.size / 2, st: GARDEN_STYLE[s.style] || 0 }));
// 庭の濃さ（0〜1。縁でなめらかに 0 へ）と種類。x, z: 世界の m
function gardenJS(x, z) {
  for (const g of GARDENS) { const d = Math.hypot(x - g.x, z - g.z); if (d < g.r) return { g: 1 - sstep(g.r * 0.55, g.r, d), st: g.st }; }
  return null;
}
const GARDEN_GLSL = `
  uniform vec4 uGarden[4];                                             // x, z (m)、半径 (m)、種類（使わない所は半径 0）
  vec2 garden(vec2 pm){
    for (int i = 0; i < 4; i++) { vec4 g = uGarden[i]; if (g.z <= 0.0) continue; float d = length(pm - g.xy); if (d < g.z) return vec2(1.0 - smoothstep(g.z * 0.55, g.z, d), g.w); }
    return vec2(0.0, -1.0);
  }`;
// ---------- サンゴの群体 ----------
// 海底を 3m 四方の区画に分け、区画ごとに 0〜1 個のサンゴを置く。あるか・種類・大きさ・向き・色は、区画の番号から決まる乱数で決める。
// 潜水艇のまわり約 90m は立体のサンゴ（creatures.js の coralCellJS）、その先は海底の色として描く（下の coralFloor）。
// どちらも同じ式で決めるので、立体のサンゴと、遠くの海底に描いたサンゴは、ちょうど同じ場所・同じ色になる
// （違うと、立体で描く範囲が潜水艇と一緒に動くとき、サンゴの絵が入れ替わって、海底が動いて見える）
const CELL = 3;
// 区画の乱数（0〜1）。c: 区画の番号、k: 何番目の値か（上の整数の乱数。番号 0 は礁のまだらが使うので 100 から）
const CORAL_HASH_GLSL = `
  float cH(vec2 c, float k){ return h2u(c, k + 100.0); }`;
const cHJS = (cx, cz, k) => h2uJS(cx, cz, k + 100);
// 色のまとまり（数 m〜十数 m ごとに、群れて育つサンゴの色。シェーダーの clusterCol と同じ）
function rfNJS(x, z) { const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const H = (a, b) => h2uJS(a, b, 0); return (H(ix, iz) * (1 - fx) + H(ix + 1, iz) * fx) * (1 - fz) + (H(ix, iz + 1) * (1 - fx) + H(ix + 1, iz + 1) * fx) * fz; }
const clusterColJS = (x, z) => { const m = rfNJS(x * 0.11, z * 0.11) * CORAL_COLS.length; return (Math.floor(m) + (m - Math.floor(m) > 0.5 ? 1 : 0)) % CORAL_COLS.length; };
// サンゴの多さ（0〜1）: 礁のまだらの岩場に多く、砂地にはまれ。浅すぎる所（礁原）と 25m より深い所では少ない
const coralDepthOK = d => Math.min(1, d / 2) * (1 - Math.min(1, Math.max(0, (d - 25) / 15)));
const coralDens = (rm, d) => (0.08 + 0.92 * Math.min(1, Math.max(0, (rm - 0.48) / 0.14))) * 0.85 * coralDepthOK(d);
// 区画 (cx, cz) のサンゴ。d: 海底の深さ (m)。ないときは null
const CORAL_KINDS = ['massive', 'brain', 'table', 'branch'], CORAL_FOOT = { massive: 1.0, brain: 1.0, table: 1.0, branch: 0.6 };   // 真上から見た広がり（大きさに対する半径）
function coralCellJS(cx, cz, d, rm) {
  if (d > 40 || d < 0.8) return null;
  const gd = gardenJS(cx * CELL, cz * CELL), gk = gd ? gd.g : 0;         // サンゴの庭の中は、びっしり育つ（イソギンチャク畑は、サンゴを減らす）
  const dn = coralDens(rm, d) * (gd && gd.st === 2 ? 1 - 0.6 * gk : 1);
  if (cHJS(cx, cz, 0) > Math.max(dn, gd && gd.st < 2 ? gk * 0.9 * coralDepthOK(d) : 0)) return null;
  const h = k => cHJS(cx, cz, k);
  let t = h(1);
  if (gk > 0 && gd.st < 2 && h(12) < gk * 0.85) t = gd.st === 0 ? 0.45 + 0.25 * h(13) : 0.7 + 0.3 * h(13);   // 庭の種類のサンゴを多く
  const kind = t < 0.3 ? 'massive' : t < 0.45 ? 'brain' : t < 0.7 ? 'table' : 'branch';
  const sc = (kind === 'massive' ? 0.4 + Math.pow(h(2), 1.5) * 1.6 : kind === 'brain' ? 0.3 + h(2) * 0.8 : kind === 'table' ? 0.5 + h(2) * 0.9 : 0.35 + h(2) * 0.6) * (kind === 'table' ? 1 + 0.5 * gk : kind === 'branch' ? 1 + 0.7 * gk : 1);   // 庭のサンゴは大きく育つ
  const sxz = 0.8 + 0.4 * h(6);
  const x = cx * CELL + (h(3) - 0.5) * 2.4, z = cz * CELL + (h(4) - 0.5) * 2.4;
  return {
    col: h(9) < 0.65 ? clusterColJS(x, z) : Math.min(CORAL_COLS.length - 1, Math.floor(h(11) * CORAL_COLS.length)),   // 6 割強はまわりと同じ色
    kind, x: cx * CELL + (h(3) - 0.5) * 2.4, z: cz * CELL + (h(4) - 0.5) * 2.4, rot: h(5) * 6.283,
    sx: sc * sxz, sy: sc * (kind === 'table' ? 0.8 + h(7) * 0.5 : 0.8 + h(7) * 0.4), sz: sc * sxz,
    v: 0.85 + h(10) * 0.3, foot: CORAL_FOOT[kind] * sc * sxz
  };
}
// 遠くの海底に、同じサンゴを色として描く（まわり 3×3 の区画を調べる。はみ出したサンゴも欠けないように）
const CORAL_FLOOR_GLSL = `
  ${CORAL_HASH_GLSL}
  vec3 coralPal(float i){
    ${CORAL_COLS.map((c, i) => `if (i < ${i}.5) return vec3(${c.map(v => v.toFixed(2)).join(', ')});`).join('\n    ')}
    return vec3(${CORAL_COLS[0].map(v => v.toFixed(2)).join(', ')});
  }
  vec3 coralFloor(vec3 sed, vec2 pm, float d){
    float dOK = min(1.0, d / 2.0) * (1.0 - clamp((d - 25.0) / 15.0, 0.0, 1.0));
    float pix = length(fwidth(pm)), dens = (0.08 + 0.92 * clamp((reefMask(pm) - 0.48) / 0.14, 0.0, 1.0)) * 0.85 * dOK;
    float dens0 = dens; vec2 gp = garden(pm); dens = gp.y > 1.5 ? dens * (1.0 - 0.6 * gp.x) : max(dens, gp.x * 0.9 * dOK);
    // 画素より小さいときは、覆う割合で色を混ぜる（ちらつかないように）。サンゴの色は数 m〜十数 m のまとまりごとに変わる
    // （同じ種類のサンゴは群れて育つ）ので、遠くから見ても、礁が色とりどりのまだらに見える
    float m1 = rfN(pm * 0.11) * ${CORAL_COLS.length}.0, m2 = rfN(pm * 0.29 + 5.0);
    vec3 macro = mix(coralPal(mod(floor(m1), ${CORAL_COLS.length}.0)), coralPal(mod(floor(m1) + 1.0, ${CORAL_COLS.length}.0)), smoothstep(0.3, 0.7, fract(m1)));
    vec3 farC = mix(sed, macro * (0.8 + 0.4 * m2) * vec3(1.5, 1.15, 0.95), dens * 0.8);   // 遠くから見ても、礁が色とりどりに見えるように
    float far = smoothstep(0.35, 1.2, pix);
    if (far > 0.999 || d > 40.0 || d < 0.8) return mix(sed, farC, far);
    vec3 c = sed; vec2 c0 = floor(pm / ${CELL}.0 + 0.5);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 cc = c0 + vec2(float(i), float(j)), gc = garden(cc * ${CELL}.0);
      if (cH(cc, 0.0) > max(dens0 * (gc.y > 1.5 ? 1.0 - 0.6 * gc.x : 1.0), gc.y < 1.5 ? gc.x * 0.9 * dOK : 0.0)) continue;
      float t = cH(cc, 1.0), h2 = cH(cc, 2.0);
      if (gc.x > 0.0 && gc.y < 1.5 && cH(cc, 12.0) < gc.x * 0.85) t = gc.y < 0.5 ? 0.45 + 0.25 * cH(cc, 13.0) : 0.7 + 0.3 * cH(cc, 13.0);
      float sc = (t < 0.3 ? 0.4 + pow(h2, 1.5) * 1.6 : t < 0.45 ? 0.3 + h2 * 0.8 : t < 0.7 ? 0.5 + h2 * 0.9 : 0.35 + h2 * 0.6) * (t >= 0.7 ? 1.0 + 0.7 * gc.x : t >= 0.45 ? 1.0 + 0.5 * gc.x : 1.0);
      float rad = (t < 0.7 ? 1.0 : 0.6) * sc * (0.8 + 0.4 * cH(cc, 6.0));
      vec2 cp = cc * ${CELL}.0 + (vec2(cH(cc, 3.0), cH(cc, 4.0)) - 0.5) * 2.4;
      float r = length(pm - cp);
      if (r > rad + pix) continue;
      float m = rfN(cp * 0.11) * ${CORAL_COLS.length}.0, ci = cH(cc, 9.0) < 0.65 ? mod(floor(m) + (fract(m) > 0.5 ? 1.0 : 0.0), ${CORAL_COLS.length}.0) : min(${CORAL_COLS.length - 1}.0, floor(cH(cc, 11.0) * ${CORAL_COLS.length}.0));
      vec3 col = coralPal(ci) * (0.85 + cH(cc, 10.0) * 0.3);
      col *= (t < 0.7 ? 0.7 + 0.45 * (1.0 - r / rad) : 0.8) * vec3(1.5, 1.15, 0.95);   // 群体の中ほどが明るい。蛍光で、水に吸われやすい赤〜黄も鮮やかに残る（立体のサンゴの蛍光と同じ）
      c = mix(c, col, (1.0 - smoothstep(rad - pix, rad + pix, r)) * (t < 0.7 ? 1.0 : 0.75));   // 枝サンゴはすき間から砂が見える
    }
    return mix(c, farC, far);
  }`;
// JS 側（サンゴの置き場所）。シェーダーの reefMask と同じ式
function reefMaskJS(x, z) {
  const H = (px, py) => h2uJS(px, py, 0);
  const N = (px, py) => { const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (H(ix, iy) * (1 - fx) + H(ix + 1, iy) * fx) * (1 - fy) + (H(ix, iy + 1) * (1 - fx) + H(ix + 1, iy + 1) * fx) * fy; };
  let rx = 0.8 * x + 0.6 * z, rz = -0.6 * x + 0.8 * z;                  // mat2(0.8,-0.6,0.6,0.8) * pm（列で並ぶ GLSL の mat2 と同じ）
  rx += 6 * N(x * 0.03, z * 0.03); rz += 6 * N(x * 0.03 + 7, z * 0.03 + 7);
  return N(rx * 0.08, rz * 0.08) * 0.5 + N(rx * 0.21 + 3, rz * 0.21 + 3) * 0.3 + N(x * 0.5, z * 0.5) * 0.2;
}
const terrainMat = new THREE.ShaderMaterial({
  extensions: { derivatives: true },
  uniforms: {
    uCam: { value: new THREE.Vector3() }, uDive: { value: 0 }, uSonar: { value: 1 }, uTime: { value: 0 },
    uFog: { value: new THREE.Color() }, uFogDen: { value: 0 }, uLampR: { value: 1 }, uCamDir: { value: new THREE.Vector3(0, 0, -1) },
    // ソナーの発信: xyz = 発信位置, w = 発信からの経過秒 (<0 は未使用)
    uPing: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, -1)) },
    // 水中の音速 約1,500 m/秒 = 1.5 km/秒（シーンの水平1単位 = 1km）。届く範囲は60km
    uPingSpeed: { value: 1.5 }, uHold: { value: 5 }, uRange: { value: 60 }, uEx: { value: 4 },
    uChest: { value: new THREE.Vector4(0, 0, 0, 0) },  // 宝箱の位置 (w=1 で金属反応を表示)
    // 潜航中に海面近くへ降りたとき、陸地を地図の色から写実的な色へ切り替える度合い（0〜1）と、太陽の向き（sea.js が入れる）
    uReal: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uUpw: { value: 0 },                                // 水中の明るさの向きの差（sea.js の uUw と同じ。1 = 上が明るい）
    // 地球の丸み（1 = 潜航中。カメラから離れるほど地面を下げ、遠くの島の根元が水平線に隠れる）。海面は平らなまま
    uCurv: { value: 0 },
    // 1 = 海底を強調しない実際の深さで描く（sea.js の「浅瀬の海底を透かす」画像だけ。生き物・サンゴは実際の深さで描くので、そろえる）
    uFlat: { value: 0 },
    // 細かい地形の範囲（x の最小・最大, z の最小・最大。最大 4 か所）。粗い地形はこの中を描かない
    uHoles: { value: [0, 1, 2, 3].map(i => DETAIL[i] ? new THREE.Vector4(toX(DETAIL[i].lon0), toX(DETAIL[i].lon1), toZ(DETAIL[i].lat0), toZ(DETAIL[i].lat1)) : new THREE.Vector4(1e9, -1e9, 1e9, -1e9)) },
    uGarden: { value: [0, 1, 2, 3].map(i => GARDENS[i] ? new THREE.Vector4(GARDENS[i].x, GARDENS[i].z, GARDENS[i].r, GARDENS[i].st) : new THREE.Vector4(0, 0, 0, 0)) },
    ...COAST.U
  },
  vertexShader: `
    attribute float elev; attribute float det; varying vec3 vW; varying vec3 vN; varying float vE; varying float vDet;
    uniform float uFlat, uEx;
    ${CURVE_GLSL}
    ${EXDEPTH_GLSL}
    void main(){ vE = elev; vDet = det; vec4 w = modelMatrix * vec4(position, 1.0);
      if (uFlat > 0.5 && elev < 0.0) w.y += (elev + exDepth(-elev, uEx)) / 1000.0;   // 強調した深さ → 実際の深さ（スカートの垂らし分はそのまま）
      vW = w.xyz; vN = normalize(normal);
      gl_Position = projectionMatrix * viewMatrix * curved(w); }`,
  fragmentShader: `
    uniform vec3 uCam; uniform vec3 uCamDir; uniform float uDive, uSonar, uTime, uFogDen, uLampR, uPingSpeed, uHold, uRange, uEx; uniform vec3 uFog; uniform vec4 uPing[6]; uniform vec4 uChest; uniform vec4 uHoles[4]; uniform float uReal, uUpw; uniform vec3 uSunDir;
    uniform sampler2D uShA, uShG; uniform vec4 uShAm, uShGm, uShGb; uniform vec2 uShAs, uShGs;
    varying vec3 vW; varying vec3 vN; varying float vE; varying float vDet;
    ${COAST_GLSL}
    ${REEF_GLSL}
    ${GARDEN_GLSL}
    ${CORAL_FLOOR_GLSL}
    ${BEAUTY_GLSL}
    //@SEA_SHARED_BEGIN（雲の影と、波がレンズになって海底に集める光。sea.js が本物に差し替える）
    float cloudShade(vec2 xz, float t){ return 1.0; } float waveFocus(vec2 p, float t, float d){ return 1.0; }
    //@SEA_SHARED_END
    // 乱数: 格子の番号を 4096 で折り返してから混ぜる（地形の座標は数十万 m あり、sin を使う乱数ではそのままだと精度が足りない）
    float h(vec2 p){ vec3 q = fract(vec3(mod(p, 4096.0).xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
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
    // （sea.js の waterDepth と同じ。テクスチャは sea.js が入れる）
  // その場所の水深 (m)。陸ではマイナス（陸の高さ）。
  // 補間は自前で行う（GPU の線形補間は 1 画素を 256 段階ほどにしか分けないため、大きく引き伸ばすと数 m の四角いタイル模様になる）
  float shoreAt(sampler2D t, vec2 uv, vec2 n){
    vec2 p = uv * n - 0.5, i = floor(p), f = p - i;
    vec4 a = texture2D(t, (i + vec2(0.5, 0.5)) / n), b = texture2D(t, (i + vec2(1.5, 0.5)) / n);
    vec4 c = texture2D(t, (i + vec2(0.5, 1.5)) / n), d = texture2D(t, (i + vec2(1.5, 1.5)) / n);
    vec4 v = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    return v.r * 63.75 - v.g * 255.0;
  }
  float waterDepth(vec2 xz){
    bool inG = xz.x > uShGb.x && xz.x < uShGb.y && xz.y > uShGb.z && xz.y < uShGb.w;
    vec4 m = inG ? uShGm : uShAm;
    vec2 uv = vec2(xz.x * m.x + m.y, xz.y * m.z + m.w);
    return inG ? shoreAt(uShG, uv, uShGs) : shoreAt(uShA, uv, uShAs);
  }
  // 岸へ寄せるうねりが届く時刻 (s) と、風の当たり方（sea.js の swellT・windExp と同じ。テクスチャは sea.js が入れる）
  uniform sampler2D uSwT; uniform float uSwOn;
  float swDec(vec4 t){ return (t.r * 16711680.0 + t.g * 65280.0 + t.b * 255.0) * 0.01; }
  float swArrive(vec2 xz){
    vec2 n = uShGs, p = vec2(xz.x * uShGm.x + uShGm.y, xz.y * uShGm.z + uShGm.w) * n - 0.5, i = floor(p), f = p - i;
    return mix(mix(swDec(texture2D(uSwT, (i + vec2(0.5, 0.5)) / n)), swDec(texture2D(uSwT, (i + vec2(1.5, 0.5)) / n)), f.x),
               mix(swDec(texture2D(uSwT, (i + vec2(0.5, 1.5)) / n)), swDec(texture2D(uSwT, (i + vec2(1.5, 1.5)) / n)), f.x), f.y);
  }
  float windAt(vec2 xz){
    vec2 n = uShAs, p = vec2(xz.x * uShAm.x + uShAm.y, xz.y * uShAm.z + uShAm.w) * n - 0.5, i = floor(p), f = p - i;
    return mix(mix(texture2D(uShA, (i + vec2(0.5, 0.5)) / n).b, texture2D(uShA, (i + vec2(1.5, 0.5)) / n).b, f.x),
               mix(texture2D(uShA, (i + vec2(0.5, 1.5)) / n).b, texture2D(uShA, (i + vec2(1.5, 1.5)) / n).b, f.x), f.y);
  }
    // 山や崖の影: その場所から太陽の方向へ地形をたどり、途中の地面が太陽の通り道より高ければ影（細かい陸地のある島の近くだけ）
    float landShadow(float e0){
      if (uDemOn < 0.5 || !inCoast(vW.xz) || length(uCam - vW) > 10.0) return 1.0;
      vec2 dir = normalize(uSunDir.xz); float tanE = uSunDir.y / length(uSunDir.xz);
      float lit = 1.0, s = 0.015;
      for (int i = 0; i < 14; i++) {
        vec2 q = vW.xz + dir * s; float rayH = e0 + 2.0 + s * 1000.0 * tanE, g = demAt(q);
        lit = min(lit, smoothstep(-6.0, 6.0, rayH - g));
        s *= 1.32;                                                       // 近くは細かく、遠くは粗く（約 2.5km 先まで）
      }
      return lit;
    }
    // 島の陸地: 熱帯の森、急な斜面は白っぽい石灰岩の崖、海岸のなだらかな所は砂浜、波打ち際は濡れて暗い。日の光で陰影を付ける
    vec3 landCol(vec3 N, float e){
      vec2 p = vW.xz * 1000.0;                                           // m
      // 地形の格子（約 120m）より細かい起伏: 面の向きを少しだけでこぼこさせて、木々や岩のかたまりの陰影を出す
      vec2 gb = vec2(n2(p * 0.025 + vec2(0.7, 0.0)) - n2(p * 0.025 - vec2(0.7, 0.0)), n2(p * 0.025 + vec2(0.0, 0.7)) - n2(p * 0.025 - vec2(0.0, 0.7)))
              + 0.6 * vec2(n2(p * 0.09 + vec2(0.5, 0.0)) - n2(p * 0.09 - vec2(0.5, 0.0)), n2(p * 0.09 + vec2(0.0, 0.5)) - n2(p * 0.09 - vec2(0.0, 0.5)));
      N = normalize(N + vec3(gb.x, 0.0, gb.y) * 0.9 * (1.0 - smoothstep(2.0, 12.0, length(uCam - vW))));
      float slope = 1.0 - N.y, n1 = n2(p * 0.004) * 0.55 + n2(p * 0.021) * 0.3 + n2(p * 0.11) * 0.15;
      vec3 veg = mix(vec3(0.10, 0.21, 0.07), vec3(0.25, 0.37, 0.14), n1);
      veg = mix(veg, vec3(0.30, 0.38, 0.16), smoothstep(0.55, 0.75, n2(p * 0.03 + 9.0)) * 0.6);   // 明るい草地や低い木のまとまり
      veg *= 0.7 + 0.6 * n2(p * 0.35) * n2(p * 0.9 + 3.0);                // 木々の樹冠のでこぼこ（明るい葉と暗いすき間）
      veg = mix(veg, vec3(0.30, 0.36, 0.15), smoothstep(0.58, 0.8, n2(p * 0.0017 + 5.0)) * 0.55);   // 草地（南部の山のススキの草原など）
      vec3 rock = mix(vec3(0.42, 0.41, 0.36), vec3(0.58, 0.56, 0.49), n2(p * 0.05));   // 風化した灰色の石灰岩
      vec3 sand = mix(vec3(0.86, 0.80, 0.64), vec3(0.95, 0.91, 0.80), n2(p * 0.3));
      vec3 c = mix(veg, rock, smoothstep(0.38, 0.62, slope + (n1 - 0.5) * 0.25) * 0.85);   // 熱帯では崖にも草木が付くので、かなり急な所だけ岩が見える
      // 砂浜: 海から 70m ほどの、低くてなだらかな所だけ（内陸の低地は砂浜にしない）
      float o = 0.07, sea = max(max(waterDepth(vW.xz + vec2(o, 0.0)), waterDepth(vW.xz - vec2(o, 0.0))), max(waterDepth(vW.xz + vec2(0.0, o)), waterDepth(vW.xz - vec2(0.0, o))));
      float beach = smoothstep(0.0, 0.6, sea) * (1.0 - smoothstep(1.5, 3.5 + n1 * 2.0, e)) * (1.0 - smoothstep(0.12, 0.3, slope));
      c = mix(c, sand, beach);
      if (uSatOn > 0.5 && inCoast(vW.xz)) {
        vec3 sat = satAt(vW.xz);
        vec3 cs = sat * (0.85 + 0.3 * n2(p * 0.35) * n2(p * 0.9 + 3.0)) * 1.12;   // 写真より細かい所は、木々のでこぼこで補う
        c = mix(cs, mix(rock, veg, 0.35), smoothstep(0.45, 0.75, slope));     // 崖の面は真上から撮った写真が縦に伸びるので、岩と草木の色にする
        c = mix(c, sand, beach * 0.75);                                    // 砂浜は写真（約 15〜30m の画素で、海や木の色が混ざる）より砂の色を優先
      }
      c = mix(c, c * 0.62, 1.0 - smoothstep(0.0, 0.7, e));
      float dif = max(dot(N, uSunDir), 0.0) * landShadow(e) * cloudShade(vW.xz, uTime);   // 山の影と、流れる雲の影
      c *= 0.45 + 0.85 * dif;
      // 波打ち際の寄せ返し（砂浜だけ）: 波が浜を駆け上がっては引く。波の届いた高さまでの砂は濡れて暗く光り、
      // 駆け上がった水の薄い膜は青緑に透け、先端には泡の線ができる。
      // 島のまわりでは、岸へ寄せる波（sea.js）の泡の段が浜に着いた瞬間に駆け上がり、ゆっくり引く。風上の浜ほど、大きな波（セット）ほど高く上がる
      // 水際から 20m 以内だけ（高さだけで決めると、低く平らな岩棚や礁原の上の陸が、広い面ごと波をかぶって見える）
      float o2 = 0.02, shore;
      if (uDemOn > 0.5 && inCoast(vW.xz))                                // 細かい陸地（約 20m）で、20m 先に海があるか
        shore = 0.3 - min(min(demAt(vW.xz + vec2(o2, 0.0)), demAt(vW.xz - vec2(o2, 0.0))), min(demAt(vW.xz + vec2(0.0, o2)), demAt(vW.xz - vec2(0.0, o2))));
      else shore = max(max(waterDepth(vW.xz + vec2(o2, 0.0)), waterDepth(vW.xz - vec2(o2, 0.0))), max(waterDepth(vW.xz + vec2(0.0, o2)), waterDepth(vW.xz - vec2(0.0, o2))));
      if (beach > 0.01 && e < 1.6 && length(uCam - vW) < 4.0 && shore > 0.0) {
        float run, top;
        if (uSwOn > 0.5 && vW.x > uShGb.x && vW.x < uShGb.y && vW.z > uShGb.z && vW.z < uShGb.w) {
          float ta = swArrive(vW.xz), ps = fract(0.1 * (uTime - ta));         // 前の波が着いてからの位相（周期 10 秒）
          float rise = ps < 0.2 ? sin(ps / 0.2 * 1.5708) : 1.0 - smoothstep(0.2, 0.95, ps);   // 速く駆け上がり、ゆっくり引く
          top = (0.25 + 0.6 * windAt(vW.xz)) * (0.72 + 0.28 * sin(0.0785 * (uTime - ta))) * (0.85 + 0.3 * n2(p * 0.03));
          run = 0.04 + top * rise;
          top += 0.12;
        } else {
          float ph = uTime * 0.63 + n2(p * 0.004) * 6.0 + n2(p * 0.03) * 1.5;
          run = 0.25 + 0.55 * pow(0.5 + 0.5 * sin(ph), 1.6);                   // 今の水の先端の高さ (m)
          top = 0.8;
        }
        float wet = 1.0 - smoothstep(top * 0.7, top * 1.15, e);              // 一番高く届いた所までは濡れている
        float sheet = 1.0 - smoothstep(run - 0.12, run, e);                   // 水の膜
        float edge = smoothstep(0.07, 0.0, abs(e - run)) * (0.5 + 0.5 * n2(p * 0.8 + vec2(uTime * 0.3, 0.0)));   // 先端の泡
        vec3 wc = c * mix(1.0, 0.68, wet * beach);
        float spec = pow(max(dot(reflect(-uSunDir, vec3(0.0, 1.0, 0.0)), normalize(uCam - vW)), 0.0), 40.0);
        wc += vec3(1.0, 0.95, 0.85) * spec * wet * beach * 0.6;               // 濡れた砂の照り返し
        wc = mix(wc, wc * vec3(0.62, 0.86, 0.88) + vec3(0.04, 0.1, 0.11), sheet * beach * 0.8);
        c = mix(wc, vec3(0.92, 0.95, 0.96), edge * beach * 0.85);
      }
      return mix(c, vec3(0.76, 0.84, 0.91), 1.0 - exp(-length(uCam - vW) * 0.035));   // 遠くは空気でかすむ
    }
    void main(){
      if (vDet < 0.5) for (int i = 0; i < 4; i++) { vec4 hb = uHoles[i]; if (vW.x > hb.x && vW.x < hb.y && vW.z > hb.z && vW.z < hb.w) discard; }   // 細かい地形がある所
      if (uPatch.w > 0.5 && vDet < 1.5 && abs(vW.x - uPatch.x) < uPatch.z * 0.985 && abs(vW.z - uPatch.y) < uPatch.z * 0.985) discard;   // 近くの細かい地形がある所
      vec3 N = normalize(vN); float d = -vE;
      // 島の近く: 陸か海かは、海面（sea.js）と同じく画素ごとに細かい陸地（約 20m）で決める。
      // 頂点の間の高さの補間のままだと、海面が描かれない所（陸）が海の中の色に塗られ、崖の下や礁原に水色の帯や四角が出る
      if (uDive < 0.5 && uDemOn > 0.5 && inCoast(vW.xz)) { float lh = demAt(vW.xz); if (lh > 0.3) d = min(d, -lh); }
      vec3 col;
      if (uDive < 0.5) {
        // 陸地（グアム島など）は緑がかった茶色、海底は水深の色。陰影は白飛びしない強さに
        vec3 base = d < 0.0 ? mix(vec3(0.30, 0.40, 0.24), vec3(0.50, 0.46, 0.34), clamp(-d / 300.0, 0.0, 1.0)) : ramp(d);
        float diff = 0.32 + 0.62 * max(dot(N, normalize(vec3(-0.45, 0.8, 0.35))), 0.0);
        col = min(base * diff, vec3(0.9));
        if (d > 0.0) col = mix(col, col * 0.5, contour(d / 1000.0) * 0.7);
        if (d < 0.3 && uReal > 0.001) col = mix(col, landCol(N, -d), uReal);   // 陸と波打ち際（海面を描かない、ごく浅い所）
      } else if (d < 0.0) {
        // 水中から陸は見えない（水面より上の物は、真上の空の窓を通してしか見えず、横は水の見通しの先）。描かずに、後ろの水の色を見せる
        discard;
      } else {
        vec3 toC = uCam - vW; float dist = length(toC);
        // 近くの細かい起伏（地形の格子は約 120m で、近くでは大きな平たい面に見えるため、面の向きに凹凸を足す）。
        // 礁の斜面（水深 3〜30m）には、斜面を下る向きに並ぶサンゴの尾根と砂の溝の縞（縁脚・縁溝、間隔 約 25m）
        float nearK = 1.0 - smoothstep(0.15, 0.6, dist);
        if (nearK > 0.0) {
          vec2 pq = vW.xz * 1000.0;
          vec2 gb = vec2(n2(pq * 0.06 + vec2(0.6, 0.0)) - n2(pq * 0.06 - vec2(0.6, 0.0)), n2(pq * 0.06 + vec2(0.0, 0.6)) - n2(pq * 0.06 - vec2(0.0, 0.6)))
                  + 0.5 * vec2(n2(pq * 0.25 + vec2(0.5, 0.0)) - n2(pq * 0.25 - vec2(0.5, 0.0)), n2(pq * 0.25 + vec2(0.0, 0.5)) - n2(pq * 0.25 - vec2(0.0, 0.5)));
          float sl = length(N.xz);
          if (d > 3.0 && d < 30.0 && sl > 0.05) {
            vec2 down = N.xz / sl, along = vec2(-down.y, down.x);         // 斜面を下る向きと、等深線の向き
            float ph = dot(pq, along) * 0.25 + n2(pq * 0.015) * 5.0;
            gb += along * cos(ph) * 1.2 * smoothstep(0.05, 0.2, sl) * (1.0 - smoothstep(20.0, 30.0, d));
          }
          N = normalize(N + vec3(gb.x, 0.0, gb.y) * 0.5 * nearK);
        }
        float grain = n2(vW.xz * 900.0) * 0.5 + n2(vW.xz * 90.0) * 0.5;
        vec3 sed = mix(vec3(0.42, 0.39, 0.34), vec3(0.62, 0.58, 0.50), grain);
        if (d < 60.0) {                                                   // サンゴ礁の海: 白いサンゴ砂と、サンゴ・岩のまだら
          vec2 pm = vW.xz * 1000.0;
          vec3 reef = mix(mix(vec3(0.86, 0.82, 0.70), vec3(0.93, 0.91, 0.82), beautyK(d)), reefRock(pm), smoothstep(0.5, 0.65, reefMask(pm)) * (1.0 - smoothstep(25.0, 50.0, d)));   // 浅瀬の砂は、より白く
          sed = mix(sed, reef, 1.0 - smoothstep(25.0, 60.0, d));
          if (d < 40.0) sed = coralFloor(sed, pm, d);                      // 海底一面のサンゴの群体（近くは立体のサンゴが重なって隠れる）
        }
        // 上からの光は、赤 → 緑 → 青の順に早く消える（1m あたり 赤 0.25・緑 0.04・青 0.018。浅瀬は赤・黄を多く残す: sunK）
        float bk = beautyK(max(d, 0.0));
        vec3 sun = vec3(0.75, 0.9, 0.94) * exp(-sunK(max(d, 0.0)) * max(d, 0.0)) * 1.45 * (1.0 - 0.2 * bk) * (0.35 + 0.65 * max(N.y, 0.0));   // 浅瀬は少し弱める（近景の creatures.js と同じ）
        if (d < 25.0) {                                                   // 浅い海底の光の網目（波がレンズになって日の光を集める）
          // 網目の細かさは場所によらず一定（近景の生き物・海底と同じ。深さで変えると、斜面で模様がゆがみ、上下に動くと滑るため）
          float sharp = mix(7.0, 2.5, smoothstep(2.0, 25.0, d));
          vec2 cp = mod(vW.xz * 1000.0, 2000.0) * 0.85, cq = cp + 0.6 * vec2(sin(cp.y * 1.3 + uTime * 0.8), sin(cp.x * 1.1 - uTime * 0.7));
          float ca = pow(max(1.0 - abs(sin(cq.x * 2.0) * sin(cq.y * 2.0)), 0.0), sharp) * 0.7;
          vec2 cr2 = mat2(0.8, -0.6, 0.6, 0.8) * cp * 1.37 + 3.1; cr2 += 0.6 * vec2(sin(cr2.y * 1.3 - uTime * 0.9), sin(cr2.x * 1.1 + uTime));
          ca += pow(max(1.0 - abs(sin(cr2.x * 2.0) * sin(cr2.y * 2.0)), 0.0), sharp) * 0.6;
          sun *= 1.0 + ca * mix(1.4, 2.2, bk) * exp(-d / mix(9.0, 13.0, bk)) * max(N.y, 0.0);   // 浅瀬は、明るくくっきり
          // 海面の波（長い波）がレンズになって、山の下に光を集め、谷の下を暗くする。波が通るたびに明るい帯が海底を進む
          sun *= mix(1.0, waveFocus(vW.xz * 1000.0, uTime, d), exp(-d / 18.0));
        }
        sun *= mix(1.0, cloudShade(vW.xz, uTime), 1.0 - 0.65 * bk);       // 流れる雲の影は、海の中にも落ちる（浅瀬は明るさを保つため弱める）
        // 潜水艇のライト: 前方の円すいの中だけ、数十 m まで届く（遠くの壁は照らさない）
        float cone = smoothstep(0.78, 0.93, dot(-toC / dist, uCamDir));
        float lamp = pow(max(dot(N, toC / dist), 0.0), 0.7) * pow(1.0 - smoothstep(0.0, uLampR, dist), 2.0) * cone * 1.6;
        // ライトの光も、行って戻る間に赤から吸われる（近景の生き物と同じ割合）
        col = sed * (sun + lamp * exp(-vec3(0.06, 0.02, 0.012) * dist * 2000.0));
        float vy = normalize(vW - uCam).y, up = vy > 0.0 ? 1.0 + 1.3 * pow(vy, 1.5) : mix(1.0, 0.3, smoothstep(0.0, 0.9, -vy));
        col = mix(col, uFog * mix(1.0, up, uUpw), 1.0 - exp(-dist * uFogDen));
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
      gl_FragColor = vec4(min(col, vec3(0.97)), 1.0);                  // 地形とソナーの表示は、光のにじみ（後処理）の対象にしない
    }`
});

// ---------- 地形を区画に分けて描く ----------
// 地形は 1 つの大きな形だと、画面の外や遠くでも毎回全部（約 150 万の三角形）を描いてしまう。
// 64×64 格子ずつの区画に分け、1) 画面の外の区画は描かない 2) 遠くの区画は格子を間引いて粗く描く 3) 細かい地形の範囲に
// すっぽり入る粗い区画は描かない。間引き方の違う区画のすき間は、縁から下へ垂らした「スカート」で隠す
const CHUNK = 64, LOD_K = 120;                // LOD_K: 1 格子がカメラまでの距離の 1/LOD_K より大きくならない細かさで描く
const chunks = [];
const samples = (n, s) => { const a = []; for (let k = 0; k < n - 1; k += s) a.push(k); a.push(n - 1); return a; };
function makeChunks(src, nx, nz, cell, holes) {
  const out = [];
  for (let j0 = 0; j0 < nz - 1; j0 += CHUNK) for (let i0 = 0; i0 < nx - 1; i0 += CHUNK) {
    const ni = Math.min(CHUNK, nx - 1 - i0) + 1, nj = Math.min(CHUNK, nz - 1 - j0) + 1, nv = ni * nj + 2 * ni + 2 * nj;
    const map = new Int32Array(nv);                                    // 区画の頂点 → 元の格子の頂点
    for (let b = 0; b < nj; b++) for (let a = 0; a < ni; a++) map[b * ni + a] = (j0 + b) * nx + i0 + a;
    const base = ni * nj, sk = [];                                     // スカートの頂点（上・下・左・右の縁）
    for (let a = 0; a < ni; a++) { map[base + a] = map[a]; map[base + ni + a] = map[(nj - 1) * ni + a]; }
    for (let b = 0; b < nj; b++) { map[base + 2 * ni + b] = map[b * ni]; map[base + 2 * ni + nj + b] = map[b * ni + ni - 1]; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('elev', new THREE.BufferAttribute(new Float32Array(nv), 1));
    g.setAttribute('det', new THREE.BufferAttribute(new Float32Array(nv), 1));
    // 間引き方ごとの三角形の並び（1, 2, 4, 8, 16 格子おき）
    const lods = {};
    for (let s = 1; s <= 16; s *= 2) {
      const xs = samples(ni, s), zs = samples(nj, s), idx = [];
      for (let q = 0; q < zs.length - 1; q++) for (let p = 0; p < xs.length - 1; p++) {
        const A = zs[q] * ni + xs[p], Bv = zs[q + 1] * ni + xs[p], C = zs[q + 1] * ni + xs[p + 1], D = zs[q] * ni + xs[p + 1];
        idx.push(A, Bv, D, Bv, C, D);
      }
      const quad = (e0, e1, s0, s1) => idx.push(e0, s0, e1, e1, s0, s1, e0, e1, s0, e1, s1, s0);   // 両面から見えるように
      for (let p = 0; p < xs.length - 1; p++) {
        quad(xs[p], xs[p + 1], base + xs[p], base + xs[p + 1]);
        quad((nj - 1) * ni + xs[p], (nj - 1) * ni + xs[p + 1], base + ni + xs[p], base + ni + xs[p + 1]);
      }
      for (let q = 0; q < zs.length - 1; q++) {
        quad(zs[q] * ni, zs[q + 1] * ni, base + 2 * ni + zs[q], base + 2 * ni + zs[q + 1]);
        quad(zs[q] * ni + ni - 1, zs[q + 1] * ni + ni - 1, base + 2 * ni + nj + zs[q], base + 2 * ni + nj + zs[q + 1]);
      }
      lods[s] = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    }
    g.setIndex(lods[1]);
    const mesh = new THREE.Mesh(g, terrainMat);
    const ch = { mesh, src, map, nskirt: nv - base, base, lods, lod: 1, cell, holes };
    out.push(ch);
  }
  return out;
}
// 元の格子の高さ・向きを、区画に写す（高さの強調を変えたときにも呼ぶ）
function refreshChunks() {
  const sphere = new THREE.Sphere();
  chunks.forEach(ch => {
    const g = ch.mesh.geometry, S = ch.src.attributes, P = g.attributes.position.array, N = g.attributes.normal.array, E = g.attributes.elev.array, Dt = g.attributes.det.array;
    const drop = (ch.cell * 0.4 + 0.05) * state.ex;                   // スカートを垂らす長さ (km)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = 0; v < ch.map.length; v++) {
      const i = ch.map[v];
      P[v * 3] = S.position.array[i * 3]; P[v * 3 + 1] = S.position.array[i * 3 + 1] - (v >= ch.base ? drop : 0); P[v * 3 + 2] = S.position.array[i * 3 + 2];
      N[v * 3] = S.normal.array[i * 3]; N[v * 3 + 1] = S.normal.array[i * 3 + 1]; N[v * 3 + 2] = S.normal.array[i * 3 + 2];
      E[v] = S.elev.array[i]; Dt[v] = S.det.array[i];
      x0 = Math.min(x0, P[v * 3]); x1 = Math.max(x1, P[v * 3]); z0 = Math.min(z0, P[v * 3 + 2]); z1 = Math.max(z1, P[v * 3 + 2]);
    }
    ['position', 'normal', 'elev', 'det'].forEach(k => g.attributes[k].needsUpdate = true);
    g.computeBoundingSphere();
    // 細かい地形の範囲にすっぽり入る粗い区画は描かない
    ch.hidden = !!ch.holes && ch.holes.some(h => x0 >= h[0] && x1 <= h[1] && z0 >= h[2] && z1 <= h[3]);
    ch.mesh.visible = !ch.hidden;
  });
}
// 毎フレーム: カメラからの距離で、区画の細かさを選ぶ
const _v = new THREE.Vector3();
function updateTerrain() {
  const cam = camera.position;
  chunks.forEach(ch => {
    if (ch.hidden) return;
    const bs = ch.mesh.geometry.boundingSphere, d = Math.max(0, cam.distanceTo(bs.center) - bs.radius);
    let s = 1; while (s < 16 && ch.cell * s * 2 <= d / LOD_K) s *= 2;
    if (s !== ch.lod) { ch.lod = s; ch.mesh.geometry.setIndex(ch.lods[s]); }
  });
}

{
  const holes = DETAIL.map(D => [toX(D.lon0), toX(D.lon1), toZ(D.lat0), toZ(D.lat1)]);
  chunks.push(...makeChunks(geo, NX, NZ, STEP * KZ, holes));                      // 粗い地形（約 0.9km 格子）
  detailGeos.forEach(g => { const D = g.userData.D; chunks.push(...makeChunks(g, D.nlon, D.nlat, D.step * KZ, null)); });   // 細かい地形
  chunks.forEach(ch => { ch.mesh.layers.enable(2); scene.add(ch.mesh); });   // 層 2: 浅瀬の海底を透かす画像（sea.js）にも描く
  refreshChunks(); state.chunksReady = true;
}
const terrain = { get visible() { return true; } };                             // （以前の 1 つの形の代わり。外からは使わない）

const rect = { x0: toX(B.lon0), x1: toX(B.lon1), z0: toZ(B.lat0), z1: toZ(B.lat1) };
const fromXZ = (x, z) => ({ lat: CD.lat - z / KZ, lon: CD.lon + x / KX });
// 細かい陸地（engine/coast.js が読み込んだら landAt を入れる）: 陸ならその高さ、海なら少なくとも 0.4m の浅瀬
const land = { at: null };
// 細かい陸地が読み込まれたら、その島の約 120m 格子の高さを直す（120m 格子には、港のクレーンや船による高さ 200m の
// とがった点が混じっていて、遠くからピラミッドのように見えるため）。陸は細かい高さの平均、細かい陸地で海の所は海にする
function relandDetail(name, at) {
  const g = detailGeos.find(q => q.userData.D.name && q.userData.D.name.includes(name)); if (!g) return;
  const D = g.userData.D, ev = g.attributes.elev.array, h = D.step / 3;
  for (let i = 0; i < ev.length; i++) {
    const lat = D.lat0 - Math.floor(i / D.nlon) * D.step, lon = D.lon0 + (i % D.nlon) * D.step;
    let sum = 0, n = 0, land = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = at(lat + a * h, lon + b * h); if (l == null) continue; n++; if (l > 0.3) { sum += l; land++; } }
    if (!n) continue;
    if (land >= 5) ev[i] = sum / land;                                 // ほぼ陸
    else if (ev[i] > -0.5) ev[i] = land ? 0.2 : -1.0;                   // 細かい陸地では海（岸ぎわは海面すれすれ）
  }
  g.attributes.elev.needsUpdate = true;
  setExaggeration(state.ex);
}
const floorDepth = (x, z) => {
  const g = fromXZ(x, z), e = elevAt(g.lat, g.lon);
  if (land.at) { const l = land.at(g.lat, g.lon); if (l != null) return l > 0.3 ? -l : Math.min(Math.max(-e, 0.4), land.cap ? land.cap(g.lat, g.lon) : 1e9); }
  return -e;
};   // m, 下向き正

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
        vec3 p = position + vec3(sin(uTime * 0.3 + rnd * 6.0) * 0.004, -uTime * 0.000001 * (0.5 + rnd), 0.0);
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
const WATER = [[0, 0x2cb8c9], [12, 0x22a3c6], [30, 0x1985b8], [60, 0x146a92], [200, 0x063553], [600, 0x021726], [1000, 0x010a12], [3000, 0x000306]];
const cA = new THREE.Color(), cB = new THREE.Color();
function waterColor(d, out, x, z) {
  let i = 1;
  for (; i < WATER.length; i++) if (d <= WATER[i][0]) break;
  if (i < WATER.length) out.copy(cA.setHex(WATER[i - 1][1])).lerp(cB.setHex(WATER[i][1]), (d - WATER[i - 1][0]) / (WATER[i][0] - WATER[i - 1][0]));
  else out.setHex(WATER[WATER.length - 1][1]);
  if (x !== undefined) {                                               // 場所ごとの濁り: 浅い所ほど、緑がかった濁りの色に寄る
    const k = turbidity(x, z) * Math.exp(-d / 40);
    if (k > 0.001) out.lerp(cA.setRGB(0.22, 0.48, 0.42), Math.min(0.75, k * 0.6));
  }
  return out;
}
// 場所ごとの濁り（0 = 澄んだ外洋、1 = 港の奥や河口）: config の murky と、波が砕ける浅瀬で舞い上がる砂
const MURKY = (SEA.murky || []).map(m => ({ x0: toX(m.box[2]), x1: toX(m.box[3]), z0: toZ(m.box[1]), z1: toZ(m.box[0]), turb: m.turb }));
// 濁った湾の中でも、ダイブポイント（config の sites の clear: 澄んでいる半径 m）のまわりは澄んでいる（アプラ湾の東海丸・フィンガーリーフ）
const CLEAR = ((SEA && SEA.sites) || []).filter(s => s.clear && (s.status !== 'preview' || PREVIEW_ON)).map(s => ({ x: toX(s.lon), z: toZ(s.lat), r: s.clear / 1000 }));
function turbidity(x, z) {
  let t = 0;
  for (const m of MURKY) {
    const dx = Math.max(m.x0 - x, 0, x - m.x1), dz = Math.max(m.z0 - z, 0, z - m.z1), d = Math.hypot(dx, dz);
    if (d < 0.5) t = Math.max(t, m.turb * (1 - d / 0.5) ** 2);
  }
  for (const c of CLEAR) { const d = Math.hypot(x - c.x, z - c.z); if (d < c.r) t *= 0.15 + 0.85 * sstep(c.r * 0.5, c.r, d); }
  const h = floorDepth(x, z);                                           // 波打ち際・礁の縁の浅瀬（4m より浅い所）は、砕けた波で砂が舞って白っぽく濁る
  if (h > 0 && h < 4) t = Math.max(t, 0.35 * (1 - h / 4));
  return t;
}

// 範囲内の最深点（細かい地形があればそちらを優先）
const deepest = (a, b, c, d) => deepestDetail(a, b, c, d) || deepestIn(a, b, c, d);
window.__TRENCH = { beautyK, sunK, BEAUTY_GLSL, gardenJS, GARDENS, hashJS: h2uJS, CORAL_COLS, coralCellJS, CELL, REEF_GLSL, reefMaskJS, exDepth, EXDEPTH_GLSL, CURVE_GLSL, turbidity, relandDetail, COAST, COAST_GLSL, land, yOfElev, updateTerrain, chunks, renderer, scene, camera, terrain, terrainMat, rect, fromXZ, floorDepth, deepestIn: deepest, elev, NX, NZ, snow, glow, state, CD, toX, toZ, elevAt, setExaggeration, waterColor, DETAIL };
})();
