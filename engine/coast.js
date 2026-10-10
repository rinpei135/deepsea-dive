// 島の近くの細かい陸地と衛星写真（config の coast）。島に近づいたときに画像を読み込み、
// カメラのまわり数 km だけ、約 20m 間隔の細かい地形を描く（遠くは detail.js の約 120m 格子のまま）。
// 高さは頂点シェーダーで画像から読むので、カメラが動いても作り直さない（格子をずらすだけ）
(() => {
const T = window.__TRENCH, C = T.COAST, cfg = C.cfg, S = window.__DIVE;
if (!cfg) { window.__COAST = { update() {} }; return; }
const U = C.U;
const [bs, bn, bw, be] = cfg.box, X0 = T.toX(bw), X1 = T.toX(be), Z0 = T.toZ(bn), Z1 = T.toZ(bs);
const CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;

// ---------- 画像の読み込み（島から 60km 以内に来たら） ----------
let loading = false, satImg = null;
const loader = new THREE.TextureLoader();
function load() {
  if (loading) return; loading = true;
  const hi = (S && S.quality) === 'high';                              // 細かい写真（約 15m）は高画質だけ。GPU のメモリを約 75MB 使うため、中・低は約 29m の写真（約 19MB）
  const sat = loader.load(hi ? cfg.sat.hi : cfg.sat.lo, t => { U.uSatOn.value = 1; satImg = t.image; readVeg(t.image); waterFromSat(); });
  sat.flipY = false; sat.anisotropy = Math.min(4, T.renderer.capabilities.getMaxAnisotropy());
  U.uSat.value = sat;
  const dem = loader.load(cfg.dem, t => {
    U.uDemS.value.set(t.image.width, t.image.height);
    U.uDemOn.value = 1;
    readHeights(t.image);
  });
  dem.flipY = false; dem.magFilter = dem.minFilter = THREE.NearestFilter; dem.generateMipmaps = false;
  U.uDem.value = dem;
}
// 移動や海底の判定（JS）でも細かい陸地を使うため、高さを配列に読み出す
function readHeights(img) {
  const W = img.width, H = img.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const im = x.getImageData(0, 0, W, H), d = im.data, hgt = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) hgt[i] = d[i * 4] * 256 + d[i * 4 + 1];
  // 礁原の上の、高さ 1m 前後の「陸」のかけら（データの誤差。平たい小島に見える）を海に戻す。
  // 標高 2m 以上の陸地につながっている所だけを陸として残す（誤差のかけらは高くても 1.2m ほど。陸の判定は 0.3m 以上。値は cm）
  const LAND = 30, CORE = 200, keep = new Uint8Array(W * H), st = new Int32Array(W * H); let sp = 0;
  for (let i = 0; i < W * H; i++) if (hgt[i] >= CORE) { keep[i] = 1; st[sp++] = i; }
  while (sp) {
    const i = st[--sp], cx = i % W;
    const nb = [cx > 0 ? i - 1 : -1, cx < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
    for (const j of nb) if (j >= 0 && !keep[j] && hgt[j] >= LAND) { keep[j] = 1; st[sp++] = j; }
  }
  let removed = 0;
  for (let i = 0; i < W * H; i++) if (!keep[i] && hgt[i] > 0) { hgt[i] = 0; d[i * 4] = d[i * 4 + 1] = 0; removed++; }
  demData = { W, H, hgt, im, c, x };
  if (removed) uploadDem();
  T.land.at = (lat, lon) => {
    if (lat < bs || lat > bn || lon < bw || lon > be) return null;
    const fx = (lon - bw) / (be - bw) * W - 0.5, fy = (bn - lat) / (bn - bs) * H - 0.5;
    const ix = Math.max(0, Math.min(W - 2, Math.floor(fx))), iy = Math.max(0, Math.min(H - 2, Math.floor(fy))), tx = Math.min(1, Math.max(0, fx - ix)), ty = Math.min(1, Math.max(0, fy - iy));
    const g = (a, b) => hgt[(iy + b) * W + ix + a];
    return ((g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - ty) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * ty) / 100;
  };
  T.relandDetail(cfg.tile, T.land.at);                                  // 遠くから見える島の形も、細かい陸地に合わせる
  waterFromSat();
}
let demData = null, satChecked = false;
function uploadDem() {                                                // シェーダーが読む画像も、直したものに差し替える
  const D = demData; D.x.putImageData(D.im, 0, 0);
  const t = new THREE.CanvasTexture(D.c); t.flipY = false; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  U.uDem.value = t;
}
// 高さ 2m 未満の低い「陸」のうち、衛星写真が海の色の所は、海に戻す。
// 礁原の浅い海が、陸地のデータでは高さ 0.5m ほどの陸になっている所があり、写真の海の色で塗られた平らな陸（水色の四角や帯）に見えるため
function waterFromSat() {
  if (!demData || !satImg || satChecked) return;
  satChecked = true;
  const { W, H, hgt, im } = demData, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(satImg, 0, 0, W, H);
  const sd = x.getImageData(0, 0, W, H).data, d = im.data;
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (hgt[i] < 30 || hgt[i] >= 200) continue;
    const r = sd[i * 4], g = sd[i * 4 + 1], b = sd[i * 4 + 2];
    // 海の色: 青が赤より強く、青が緑と同じくらいか強い（礁原は写真では青みのある灰色。草木は緑が、砂浜は赤が強い）
    if (b - r > 6 && b >= g - 2) { hgt[i] = 0; d[i * 4] = d[i * 4 + 1] = 0; n++; }
  }
  if (n) T.relandDetail(cfg.tile, T.land.at);
  buildBeachCap();
  uploadDem();
}
// 浜の斜面: 地形のデータ（約 120m）では、浜から数十 m で急に深くなっていて、浜の斜面がない（波打ち際の寄せ返しや、崩れる波の帯が見えない）。
// 陸からの距離と、いちばん近い陸の高さを求め、近くの陸が低い（8m 未満 = 砂浜や礁原。崖はふつう 20m 以上）所だけ、水深に「岸からなだらかに深くなる」上限を付ける
// （0.3m + 距離 × 0.05。20m で約 1.3m、100m で約 5m）。80m より先は上限をだんだん速く深くし、沖の本当の水深になめらかにつなぐ
// （上限が途中で急に無くなると、そこで水深が数 m から数十 m へ跳び、浅瀬の水色と深い青の境目がくっきりした線になるため。160m で約 34m、260m で約 143m）。
// 崖の海岸はそのまま。上限は陸地の画像の B に入れる（上限 m = 120 × (B/254)²、255 = 上限なし）
const BEACH_SLOPE = 0.05, BEACH_R = 260;
const beachCapAt = d => 0.3 + d * BEACH_SLOPE + Math.max(0, d - 80) ** 2 * 0.004;
let capArr = null;
function buildBeachCap() {
  const { W, H, hgt, im } = demData, N = W * H, d = im.data;
  const px = (T.toX(be) - T.toX(bw)) * 1000 / W, pz = (T.toZ(bs) - T.toZ(bn)) * 1000 / H, pd = Math.hypot(px, pz);   // 1 画素 (m)
  const dist = new Float32Array(N).fill(1e9), src = new Uint16Array(N);
  for (let i = 0; i < N; i++) if (hgt[i] >= 30) { dist[i] = 0; src[i] = hgt[i]; }
  const relax = (i, j, w) => { const v = dist[j] + w; if (v < dist[i]) { dist[i] = v; src[i] = src[j]; } };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {              // 左上から
    const i = y * W + x; if (dist[i] === 0) continue;
    if (x > 0) relax(i, i - 1, px);
    if (y > 0) { relax(i, i - W, pz); if (x > 0) relax(i, i - W - 1, pd); if (x < W - 1) relax(i, i - W + 1, pd); }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {    // 右下から
    const i = y * W + x; if (dist[i] === 0) continue;
    if (x < W - 1) relax(i, i + 1, px);
    if (y < H - 1) { relax(i, i + W, pz); if (x < W - 1) relax(i, i + W + 1, pd); if (x > 0) relax(i, i + W - 1, pd); }
  }
  capArr = new Float32Array(N).fill(1e9);
  for (let i = 0; i < N; i++) {
    let b = 255;
    if (dist[i] > 0 && dist[i] < BEACH_R && src[i] < 800) { const cap = Math.min(120, beachCapAt(dist[i])); capArr[i] = cap; b = Math.min(254, Math.round(Math.sqrt(cap / 120) * 254)); }
    d[i * 4 + 2] = b;
  }
  T.land.cap = (lat, lon) => {                                          // JS 側（移動や海底の深さ）でも同じ上限を使う
    if (lat < bs || lat > bn || lon < bw || lon > be) return 1e9;
    const fx = (lon - bw) / (be - bw) * W - 0.5, fy = (bn - lat) / (bn - bs) * H - 0.5;
    const ix = Math.max(0, Math.min(W - 2, Math.floor(fx))), iy = Math.max(0, Math.min(H - 2, Math.floor(fy))), tx = Math.min(1, Math.max(0, fx - ix)), ty = Math.min(1, Math.max(0, fy - iy));
    const g = (a, b2) => capArr[(iy + b2) * W + ix + a];                // 上限のない所は 1e9（混ぜても大きいまま = 上限なし）
    return (g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - ty) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * ty;
  };
}

// ---------- カメラのまわりの細かい地形 ----------
const N = (S && S.quality) === 'low' ? 129 : (S && S.quality) === 'mid' ? 193 : 257, SPACING = (S && S.quality) === 'low' ? 0.035 : 0.025;   // 格子の数と間隔 (km)
const HALF = (N - 1) * SPACING / 2;
const geo = new THREE.PlaneGeometry(1, 1, N - 1, N - 1).rotateX(-Math.PI / 2);
const mat = new THREE.ShaderMaterial({
  extensions: { derivatives: true },
  uniforms: T.terrainMat.uniforms,                                     // 地形と同じ uniform（同じ色の付け方・霧・ソナー）
  vertexShader: `
    uniform float uEx;
    ${T.COAST_GLSL}
    ${T.CURVE_GLSL}
    varying vec3 vW; varying vec3 vN; varying float vE; varying float vDet;
    ${T.EXDEPTH_GLSL}
    uniform float uFlat; uniform vec4 uSink;
    float yOf(float e){ return e > 0.0 ? e / 1000.0 : -exDepth(-e, uFlat > 0.5 ? 1.0 : uEx) / 1000.0; }   // 海底だけ高さを強調（world.js の yOfElev と同じ。uFlat のときは実際の深さ）
    void main(){
      vec2 xz = uPatch.xy + position.xz * uPatch.z * 2.0;
      float edge = smoothstep(0.42, 0.5, max(abs(position.x), abs(position.z)));   // 縁は約 120m 格子の高さにそろえ、まわりの地形とつなぐ
      // 縁に寄せる約 120m 格子の高さは、細かい陸地で海の所は海面より下に保つ（そのままだと、礁原の一部が 120m の四角い陸になって海面の上に出る）
      float ce = coastElev(xz), gm = gmAt(xz), e = mix(ce, ce > 0.0 ? gm : min(gm, -0.4), edge), eTop = e;
      if (max(abs(position.x), abs(position.z)) > 0.4995) e -= 30.0;      // いちばん外の輪は下へ垂らし、まわりの地形とのすき間を隠す（スカート）
      float h = ${SPACING.toFixed(3)};
      float eL = coastElev(xz - vec2(h, 0.0)), eR = coastElev(xz + vec2(h, 0.0)), eD = coastElev(xz - vec2(0.0, h)), eU = coastElev(xz + vec2(0.0, h));
      vN = normalize(vec3(-(yOf(eR) - yOf(eL)) / (2.0 * h), 1.0, -(yOf(eU) - yOf(eD)) / (2.0 * h)));
      vE = eTop; vDet = 2.0; vW = vec3(xz.x, yOf(e), xz.y);                // 色はスカートも元の地面の高さで付ける（下げた高さだと、陸の縁に海の色の壁が見える）
      if (uSink.w > 0.0 && e < 0.0) vW.y -= uSink.w * (1.0 - smoothstep(uSink.z * 0.85, uSink.z, length(vW.xz - uSink.xy)));   // 近くの細かい海底（creatures.js）の下へ沈める（world.js と同じ）
      gl_Position = projectionMatrix * viewMatrix * curved(vec4(vW, 1.0));
    }`,
  fragmentShader: T.terrainMat.fragmentShader
});
const patch = new THREE.Mesh(geo, mat);
patch.frustumCulled = false; patch.visible = false; patch.layers.enable(2);   // 層 2: 浅瀬の海底を透かす画像にも描く
T.scene.add(patch);


// ---------- 木々（カメラのまわりの陸地に、1 本ずつ立てる） ----------
// 衛星写真で緑の所（森・草木）に広葉樹のかたまり、海に近い低い所にはヤシを置く。急な崖や町（灰色）には置かない。
// 同じ形をまとめて描く（InstancedMesh）。カメラが少し動くたびに並べ直す
const TREE_R = (S && S.quality) === 'low' ? 0 : (S && S.quality) === 'mid' ? 1.0 : 1.5;   // 木を置く範囲の半径 (km)
const TREE_STEP = (S && S.quality) === 'mid' ? 0.016 : 0.012;                          // 候補の間隔 (km)
let veg = null;                                                       // 衛星写真の色（木を置くかの判断用。低画質の画像の大きさ）
function readVeg(img) {
  const W = 854, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
  veg = { W, H, d: x.getImageData(0, 0, W, H).data };
}
function vegAt(lat, lon) {                                            // 0〜1: 草木らしさ（緑が赤・青より強く、暗めの所）
  if (!veg) return 0;
  const ix = Math.floor((lon - bw) / (be - bw) * veg.W), iy = Math.floor((bn - lat) / (bn - bs) * veg.H);
  if (ix < 0 || iy < 0 || ix >= veg.W || iy >= veg.H) return 0;
  const i = (iy * veg.W + ix) * 4, r = veg.d[i], g = veg.d[i + 1], b = veg.d[i + 2];
  return Math.max(0, Math.min(1, (g - Math.max(r, b) + 4) / 12)) * (g < 150 ? 1 : 0.3);
}
// 形: 広葉樹は幹＋もこもこした樹冠（高さ 1 の設計）、ヤシは少し曲がった細い幹と、垂れた葉
function mergeGeo(parts) {
  parts = parts.map(([g, p]) => [g.index ? g.toNonIndexed() : g, p]);   // 三角形ごとの頂点に直してから数える
  let n = 0; parts.forEach(([g]) => n += g.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), part = new Float32Array(n); let o = 0;
  parts.forEach(([g, p]) => {
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    part.fill(p, o, o + c); o += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setAttribute('part', new THREE.BufferAttribute(part, 1));
  return out;
}
// 葉の模様（キャンバスに描く）。すき間は透明にして、樹冠の縁をぎざぎざに、内側の葉も透けて見えるようにする
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
const leafTex = canvasTex(256, 256, (x, W, H) => {                    // 広葉樹: 小さな葉のかたまり（明るい葉・暗い葉）
  for (let i = 0; i < 1400; i++) {
    const px = Math.random() * W, py = Math.random() * H, r = 3 + Math.random() * 6, a = Math.random() * Math.PI, l = 0.55 + Math.random() * 0.6;
    x.fillStyle = `rgb(${Math.round(150 * l)},${Math.round(205 * l)},${Math.round(110 * l)})`;
    x.beginPath(); x.ellipse(px, py, r, r * 0.45, a, 0, 7); x.fill();
  }
});
const frondTex = canvasTex(128, 256, (x, W, H) => {                   // ヤシの葉: 中央の軸と、斜め後ろへ伸びる細い小葉
  x.strokeStyle = 'rgb(150,140,90)'; x.lineWidth = 4; x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, H); x.stroke();
  for (let j = 0; j < 46; j++) {
    const y = 4 + j * (H - 8) / 46, len = (W / 2 - 4) * Math.sin(Math.PI * (0.15 + 0.85 * j / 46)), l = 0.7 + Math.random() * 0.4;
    x.strokeStyle = `rgb(${Math.round(150 * l)},${Math.round(190 * l)},${Math.round(90 * l)})`; x.lineWidth = 2.2;
    [-1, 1].forEach(sd => { x.beginPath(); x.moveTo(W / 2, y); x.quadraticCurveTo(W / 2 + sd * len * 0.6, y + 6, W / 2 + sd * len, y + 16); x.stroke(); });
  }
});
// 広葉樹は近く用（樹冠を 3 つのふくらみで）と遠く用（1 つ）の 2 つ
const makeBroad = detail => {
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.5, detail ? 6 : 4).translate(0, 0.25, 0);
  const blobs = detail ? [[0, 0.66, 0, 0.38], [0.2, 0.56, 0.08, 0.27], [-0.16, 0.58, -0.12, 0.29]] : [[0, 0.64, 0, 0.42]];
  const parts = [[trunk, 0]];
  blobs.forEach(([bx, by, bz, br]) => {
    const g = new THREE.IcosahedronGeometry(br, detail ? 1 : 0),   // 葉の模様と切り抜きで細かさを出すので、形は粗くてよい
      p = g.attributes.position, nn = new Float32Array(p.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const k = 1 + 0.15 * Math.sin(v.x * 25 + v.z * 13) * Math.sin(v.y * 21);
      nn.set(v.clone().normalize().toArray(), i * 3);                  // 丸みのある陰影
      p.setXYZ(i, bx + v.x * k, by + v.y * k * 0.8, bz + v.z * k);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); parts.push([g, 1]);
  });
  return mergeGeo(parts);
};
const broadGeo = makeBroad(1), broadGeoFar = makeBroad(0), TREE_NEAR = 0.35;   // 近く用を使う距離 (km)
const palmGeo = (() => {
  const parts = [], trunkPts = [];
  for (let k = 0; k < 7; k++) { const u = k / 6; trunkPts.push(new THREE.Vector3(0.08 * u * u, u * 0.92, 0)); }
  const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPts), 8, 0.02, 6); parts.push([trunk, 0]);
  const top = trunkPts[6];
  for (let f = 0; f < 9; f++) {                                       // 葉: 先が垂れた長い葉（模様で小葉を描く）
    const a = f / 9 * Math.PI * 2 + (f % 2) * 0.2, droop = 0.18 + (f % 3) * 0.06, pts = [];
    for (let k = 0; k < 7; k++) { const u = k / 6; pts.push(new THREE.Vector3(top.x + Math.cos(a) * 0.42 * u, top.y + 0.1 * Math.sin(u * 2.4) - droop * u * u * 1.4, top.z + Math.sin(a) * 0.42 * u)); }
    const g = new THREE.BufferGeometry(), pos = [], uvs = [];
    const sx = -Math.sin(a), sz = Math.cos(a), w = 0.11;
    for (let k = 0; k < 6; k++) {
      const p0 = pts[k], p1 = pts[k + 1], v0 = k / 6, v1 = (k + 1) / 6, tilt = 0.03;   // 小葉が少し下へ折れる（V 字）
      const A = [p0.x + sx * w, p0.y - tilt, p0.z + sz * w], B = [p0.x - sx * w, p0.y - tilt, p0.z - sz * w], C = [p1.x + sx * w, p1.y - tilt, p1.z + sz * w], D = [p1.x - sx * w, p1.y - tilt, p1.z - sz * w];
      const M0 = [p0.x, p0.y, p0.z], M1 = [p1.x, p1.y, p1.z];
      pos.push(...A, ...M0, ...C, ...M0, ...M1, ...C, ...M0, ...B, ...M1, ...B, ...D, ...M1);
      uvs.push(0, v0, 0.5, v0, 0, v1, 0.5, v0, 0.5, v1, 0, v1, 0.5, v0, 1, v0, 0.5, v1, 1, v0, 1, v1, 0.5, v1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals();
    parts.push([g, 2]);
  }
  return mergeGeo(parts);
})();
const treeMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: Object.assign({}, T.terrainMat.uniforms, { uLeaf: { value: leafTex }, uFrond: { value: frondTex } }),
  vertexShader: `
    attribute float part; varying vec3 vN; varying vec3 vC; varying vec3 vW; varying float vP; varying vec2 vUv;
    ${T.CURVE_GLSL}
    void main(){
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vW = w.xyz; vP = part; vUv = uv;
      vC = part < 0.5 ? vec3(0.27, 0.22, 0.16) : instanceColor;
      gl_Position = projectionMatrix * viewMatrix * curved(w);
    }`,
  fragmentShader: `
    uniform vec3 uSunDir, uCam; uniform float uDive, uTime; uniform sampler2D uLeaf, uFrond;
    ${(window.__SEA && window.__SEA.SHARED_GLSL) || 'float cloudShade(vec2 xz, float t){ return 1.0; }'}
    varying vec3 vN; varying vec3 vC; varying vec3 vW; varying float vP; varying vec2 vUv;
    void main(){
      if (uDive > 0.5) discard;                                       // 水中からは見えない
      vec3 c = vC;
      if (vP > 0.5) {
        vec4 t = vP > 1.5 ? texture2D(uFrond, vUv) : texture2D(uLeaf, vUv * 2.0);
        if (t.a < 0.5) discard;                                        // 葉のすき間
        c *= t.rgb * 1.6;
      }
      vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
      float dif = max(dot(N, uSunDir), 0.0) * cloudShade(vW.xz, uTime), up = 0.5 + 0.5 * N.y;   // 日の光（流れる雲の影で弱まる）と、空からの光（上向きほど明るい）
      float trans = vP > 0.5 ? pow(max(dot(normalize(vW - uCam), uSunDir), 0.0), 4.0) * 0.5 : 0.0;   // 日に透ける葉
      c = c * (0.4 + 0.3 * up + 0.75 * dif) + vC * trans;
      c = mix(c, vec3(0.76, 0.84, 0.91), 1.0 - exp(-length(uCam - vW) * 0.035));   // 遠くは空気でかすむ
      gl_FragColor = vec4(c, 1.0);
    }`
});
const MAXT = TREE_R ? Math.round(Math.PI * TREE_R * TREE_R / (TREE_STEP * TREE_STEP) * 0.6) : 1;
const broad = new THREE.InstancedMesh(broadGeo, treeMat, Math.max(1, Math.round(MAXT * (TREE_NEAR / Math.max(TREE_R, TREE_NEAR)) ** 2 * 1.5))),
  broadFar = new THREE.InstancedMesh(broadGeoFar, treeMat, MAXT), palms = new THREE.InstancedMesh(palmGeo, treeMat, Math.max(1, Math.round(MAXT / 4)));
[broad, broadFar, palms].forEach(m => { m.setColorAt(0, new THREE.Color()); m.count = 0; m.frustumCulled = false; T.scene.add(m); });   // 色の配列は本数ぶん作られるので、本数を 0 にする前に
// 木の影: 太陽と反対側の地面に、細長く柔らかい影を落とす（長さと位置は、木の高さと太陽の高さで決まる）。
// 影がないと、木が地面から浮いて見える
const shadowMat = new THREE.ShaderMaterial({
  uniforms: { uCurv: T.terrainMat.uniforms.uCurv, uDive: T.terrainMat.uniforms.uDive },
  vertexShader: `${T.CURVE_GLSL} varying vec2 vQ;
    void main(){ vQ = position.xz; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * curved(w); }`,
  fragmentShader: `uniform float uDive; varying vec2 vQ;
    void main(){ if (uDive > 0.5) discard; float r = length(vQ); gl_FragColor = vec4(0.02, 0.035, 0.02, 0.45 * (1.0 - smoothstep(0.3, 1.0, r))); }`,
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
});
const shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), shadowMat, broad.instanceMatrix.count + broadFar.instanceMatrix.count + palms.instanceMatrix.count);
shadows.count = 0; shadows.frustumCulled = false; T.scene.add(shadows);
let treeAt = null;
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), COL = new THREE.Color(), UPV = new THREE.Vector3(0, 1, 0);
function hash(a, b) { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
// 太陽の方向へ地形をたどって、影の中か（1 = 日なた、0 = 影）。地形の影と同じ考え方（world.js の landShadow）
let COL_SH = 1;
const SUN_D = (() => { const s = (window.__SEA && window.__SEA.SUN) || new THREE.Vector3(0, 1, 0), h = Math.hypot(s.x, s.z) || 1; return { x: s.x / h, z: s.z / h, tanE: s.y / h }; })();
function shadowAt(x, z, e0) {
  let lit = 1, s = 0.015;
  for (let i = 0; i < 14; i++) {
    const g = T.fromXZ(x + SUN_D.x * s, z + SUN_D.z * s), h = T.land.at(g.lat, g.lon);
    if (h != null) { const d = e0 + 8 + s * 1000 * SUN_D.tanE - h; lit = Math.min(lit, Math.max(0, Math.min(1, (d + 6) / 12))); }
    s *= 1.32;
  }
  return lit;
}
function placeTrees(cx, cz) {
  treeAt = [cx, cz];
  let nb = 0, nf = 0, np = 0, ns = 0;
  const shDir = Math.atan2(SUN_D.z, -SUN_D.x);                          // 影の伸びる向き（太陽と反対）へ回す角度
  const g0x = Math.floor((cx - TREE_R) / TREE_STEP), g1x = Math.ceil((cx + TREE_R) / TREE_STEP), g0z = Math.floor((cz - TREE_R) / TREE_STEP), g1z = Math.ceil((cz + TREE_R) / TREE_STEP);
  for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
    const r1 = hash(gx, gz), r2 = hash(gz + 77, gx - 31), r3 = hash(gx * 3 + 5, gz * 7 - 2);
    const x = (gx + r1) * TREE_STEP, z = (gz + r2) * TREE_STEP;   // 格子の中で少しずらす（同じ場所にはいつも同じ木）
    if ((x - cx) ** 2 + (z - cz) ** 2 > TREE_R * TREE_R) continue;
    const g = T.fromXZ(x, z), e = T.land.at(g.lat, g.lon);
    if (e == null || e < 1.2) continue;
    const v = vegAt(g.lat, g.lon); if (v < 0.25 || r3 > v) continue;
    const ex = T.land.at(g.lat, g.lon + 0.0002), ez = T.land.at(g.lat + 0.0002, g.lon);   // 約 20m 先との高さの差で、急な崖をよける
    if (ex == null || ez == null || Math.hypot(ex - e, ez - e) > 12) continue;
    const coast = e < 6 && [[0.0006, 0], [-0.0006, 0], [0, 0.0006], [0, -0.0006]].some(([a, b]) => (T.land.at(g.lat + a, g.lon + b) || 0) < 0.3);
    const palm = coast && hash(gx - 9, gz + 13) < 0.7;
    const hgt = palm ? 9 + 7 * hash(gx, gz + 5) : 6 + 9 * hash(gx + 3, gz) * v;   // 高さ (m)
    const s = hgt / 1000;
    P.set(x, e / 1000, z); Q.setFromAxisAngle(UPV, hash(gx + 1, gz + 1) * 6.28); SC.set(s * (palm ? 1 : 0.8 + 0.5 * hash(gx, gz - 3)), s, s * (palm ? 1 : 0.8 + 0.5 * hash(gx - 3, gz)));
    M.compose(P, Q, SC);
    const t = hash(gx + 11, gz - 11), sh = shadowAt(x, z, e);           // 山や崖の影の中の木は暗く
    if (sh > 0.3 && ns < shadows.instanceMatrix.count) {               // 日の当たる木だけ、地面に影を落とす（樹冠の中ほどの高さの影が、太陽と反対側へずれる）
      const cr = (palm ? 0.42 : 0.4) * SC.x, off = 0.6 * s / Math.max(0.2, SUN_D.tanE), keep = M.clone();
      P.set(x - SUN_D.x * off, e / 1000 + 0.0002, z - SUN_D.z * off); Q.setFromAxisAngle(UPV, shDir);
      M.compose(P, Q, new THREE.Vector3(cr * (1 + 0.8 / Math.max(0.3, SUN_D.tanE)), 1, cr));   // 太陽が低いほど細長い
      shadows.setMatrixAt(ns++, M); M.copy(keep);
    }
    COL_SH = 0.45 + 0.55 * sh;
    if (palm) { if (np >= palms.instanceMatrix.count) continue; palms.setMatrixAt(np, M); palms.setColorAt(np, COL.setRGB(0.34 + 0.1 * t, 0.46 + 0.1 * t, 0.2).multiplyScalar(COL_SH)); np++; }
    else {
      COL.setRGB(0.18 + 0.08 * t, 0.30 + 0.10 * t * v, 0.11 + 0.04 * t).multiplyScalar(COL_SH);
      const near = (x - cx) ** 2 + (z - cz) ** 2 < TREE_NEAR * TREE_NEAR;
      if (near && nb < broad.instanceMatrix.count) { broad.setMatrixAt(nb, M); broad.setColorAt(nb, COL); nb++; }
      else if (nf < broadFar.instanceMatrix.count) { broadFar.setMatrixAt(nf, M); broadFar.setColorAt(nf, COL); nf++; }
    }
  }
  broad.count = nb; broadFar.count = nf; palms.count = np; shadows.count = ns;
  [broad, broadFar, palms, shadows].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
}
function updateTrees(on) {
  // 水中に潜っているときは描かない（木は水中から見えない。描くと、島の 2 万本近い木と足元の影の形の計算だけが毎回かかる）
  const cam = T.camera.position, show = on && TREE_R > 0 && veg && T.land.at && cam.y < 1.5 && !(T.terrainMat.uniforms.uDive.value > 0.5);
  broad.visible = broadFar.visible = palms.visible = shadows.visible = !!show;
  if (!show) return;
  if (!treeAt || Math.hypot(cam.x - treeAt[0], cam.z - treeAt[1]) > Math.min(TREE_NEAR * 0.5, TREE_R * 0.25)) placeTrees(cam.x, cam.z);   // 近く用の範囲がずれないよう、こまめに並べ直す
}

function update() {
  const cam = T.camera.position;
  if (!loading && Math.hypot(cam.x - CX, cam.z - CZ) < 60) load();
  // 島の範囲の中で、カメラが高さ 4km より低いときだけ使う
  const on = U.uDemOn.value > 0.5 && cam.y < 4 && cam.x > X0 + HALF && cam.x < X1 - HALF && cam.z > Z0 + HALF && cam.z < Z1 - HALF;
  patch.visible = on;
  U.uPatch.value.set(Math.round(cam.x / SPACING) * SPACING, Math.round(cam.z / SPACING) * SPACING, HALF, on ? 1 : 0);
  updateTrees(on);
}
window.__COAST = { update, load, get satImg() { return satImg; }, box: { x0: X0, x1: X1, z0: Z0, z1: Z1 } };
})();
