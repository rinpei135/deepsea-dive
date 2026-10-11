// サンゴ礁の生き物: 礁の魚の群れと、イソギンチャク・シャコガイ・ウニ・ナマコ・ウミウチワ・ソフトコーラル・海草。
// 近景の世界（creatures.js）の中に置く。置き場所はサンゴと同じく 3m 四方の区画ごとの乱数で決まり、いつ来ても同じ所にいる。
// 魚は、すみかのサンゴのまわりを泳ぎ回り、潜水艇が近づくと逃げる（デバスズメダイは枝サンゴの中へ隠れる）。
(() => {
const L = window.__LIFE, A = L && L.reefApi, T = window.__TRENCH;
if (!A || !T.coralCellJS) return;
const { REEF, scene, withCaustics, fadeByDistance, BED_R, floorAt, seabedY } = A;
const CELL = T.CELL, h = (cx, cz, k) => T.hashJS(cx, cz, k);          // 区画の乱数（0〜1）
const RANGE = BED_R - 6;                                               // 置く範囲（潜水艇から、m）

// ---------- 共通: 体の揺れ（時間 uT、個体ごとの位相 aPh）を付けた材質 ----------
// サンゴ礁・外洋の生き物の材質は、すべて同じシェーダー 1 つにまとめ、揺れ方は uniform（uMode と uK1〜uK3）で選ぶ。
// 種類ごとに別のシェーダーにすると、初めて描くときに 1 つずつ作られ（1 つに 0.1 秒ほど）、そのたびに画面が止まるため
//   uMode 0: 揺れない / 1: 魚が泳ぐ（尾の方ほど大きく左右に）/ 2: 海底の生き物が波の下で揺れる（uK1: 強さ）/
//   3: 大きな魚がゆっくり泳ぐ（uK1: 速さ、uK2: 振れ幅）/ 4: エイの羽ばたき（uK1: 速さ、uK2: 振れ幅、uK3: 前後の波）/ 5: イルカ（尾を上下に）
//   uGlint 1: 銀色の魚のきらめき（体の横がこちらを向いたとき、ときどき光る。光る時刻は群れの中の位置でずれ、きらめきの波が群れを渡る）
const TIME = { value: 0 };
const AIR = { value: 0 }, CAMD = { value: 0 };                         // 外洋の生き物（pelagic.js）: 1 = 海面より上の部分だけ描く、カメラの水深 (m)
const SWAY_GLSL = `
  float hy = max(position.y, 0.0);
  if (uMode > 0.5 && uMode < 1.5) {
    transformed.z += sin(uT * 9.0 + aPh - position.x * 5.0) * 0.12 * pow(max(0.0, 0.55 - position.x), 2.0);
    if (abs(position.z) > 0.03 && position.x > 0.05 && position.x < 0.22) transformed.z += sign(position.z) * sin(uT * 6.0 + aPh) * 0.02 * (0.22 - position.x) / 0.17;   // 胸びれ
  } else if (uMode > 1.5 && uMode < 2.5) {
    transformed.x += sin(uT * 0.9 + aPh) * 0.25 * hy * hy * uK1;
    transformed.z += cos(uT * 0.7 + aPh * 1.3) * 0.15 * hy * hy * uK1;
  } else if (uMode > 2.5 && uMode < 3.5) {
    transformed.z += sin(uT * uK1 + aPh - position.x * 4.0) * uK2 * pow(max(0.0, 0.5 - position.x), 2.0);
  } else if (uMode > 3.5 && uMode < 4.5) {
    float span = abs(position.z);
    transformed.y += sin(uT * uK1 + aPh - position.x * uK3) * uK2 * span * span;
  } else if (uMode > 4.5) {
    float kd = max(0.0, 0.1 - position.x);
    transformed.y += sin(uT * 6.0 + aPh - position.x * 5.0) * 0.17 * kd * kd;
  }
  vec3 gpI = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vGl = uGlint * pow(max(0.0, sin(uT * 1.3 + gpI.x * 0.9 + gpI.z * 0.7 + gpI.y * 0.5 + aPh * 0.03)), 24.0);`;
function swayMat(opts, mode = 0, k = [], glint = 0) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.55, metalness: 0, vertexColors: true }, opts, { side: THREE.DoubleSide }));   // 裏も描く（表裏で別のシェーダーにならないように、すべてそろえる）
  const U = { uMode: { value: mode }, uK1: { value: k[0] || 0 }, uK2: { value: k[1] || 0 }, uK3: { value: k[2] || 0 }, uGlint: { value: glint } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, { uT: TIME, uAirMode: AIR, uCamD: CAMD });
    sh.vertexShader = 'uniform float uT, uMode, uK1, uK2, uK3, uGlint; attribute float aPh; varying float vGl, vAY;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_GLSL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vAY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = 'uniform float uAirMode, uCamD; varying float vGl, vAY;\n' + sh.fragmentShader
      .replace('void main() {', 'void main() {\n  if (uAirMode > 0.5 && uCamD - vAY > 0.03) discard;   // 海面より上だけを描くときは、水の中の部分を捨てる')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += (diffuseColor.rgb * 0.6 + vec3(0.2, 0.22, 0.25)) * vGl * pow(abs(normal.z), 3.0) * 0.9;');   // 体の色を残したまま明るく光る（白く飛ばない）
  };
  m.customProgramCacheKey = () => 'reef_sway';
  fadeByDistance(m, 'reef_sway');
  return m;
}
function instanced(geo, mat, max) {
  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(Float32Array.from({ length: max }, () => Math.random() * 100), 1));
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.setColorAt(0, new THREE.Color(1, 1, 1)); m.count = 0; m.frustumCulled = false; m.visible = false; m.castShadow = true;
  scene.add(withCaustics(m));
  return m;
}
// いくつかの形をまとめて 1 つにする（色の属性つき）
function merge(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; parts.forEach(g => { if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  parts.forEach(g => {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3);
    o += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const paint = (g, fn) => {                                              // 頂点の位置から色を決める
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); c.set(v, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
};

// ---------- 魚の形 ----------
// 体長 1 の魚（頭が +x、尾が -x、背が +y）。体は、尾の付け根から口先までの輪切りをつないで作る。
//   hgt: 体高（体長に対する割合）、wid: 体の厚み、top: 背の盛り上がり（0 = 上下対称）、mx: いちばん高い所（0 尾 〜 1 頭）、
//   snout: 口先のとがり（大きいほど細長い口）、ped: 尾の付け根の細さ、
//   dorsal / anal: [始まり, 終わり, 高さ] のひれ（u は 0 尾 〜 1 頭）、tail: { len, fork（切れ込み）, lobe（上下の葉の伸び）, round（丸さ） }、
//   pat(u, v): 体の色（u: 0 尾 〜 1 頭、v: -1 腹 〜 1 背）、fin(part, s): ひれの色（s: 0 付け根 〜 1 先）
function fishGeo(o, lod = 0) {                                          // lod 1: 遠く用（面を少なく、胸びれ・目なし）
  const { hgt, wid = 0.14, top = 0.15, mx = 0.5, snout = 1, ped = 0.12, pat } = o;
  const fin = o.fin || ((part, s) => mixc(part === 'tail' ? pat(0.02, 0) : part === 'dorsal' ? pat(0.5, 1) : pat(0.5, -1), [0.85, 0.9, 0.9], s * 0.35));
  const U0 = 0.1;                                                         // 尾の付け根（ここから後ろが尾びれ）
  // 体の高さ（u の関数）: 尾の付け根は細く、mx でいちばん高く、口先へ向かって細くなる
  const H = u => {
    const t = Math.min(1, Math.max(0, (u - U0) / (1 - U0)));
    const back = Math.pow(Math.sin(Math.PI * Math.min(1, t / mx * 0.5)), 0.7), front = Math.pow(Math.max(0, Math.cos(Math.PI * 0.5 * Math.max(0, t - mx) / (1 - mx))), 0.55 * snout);
    return Math.max(ped * hgt * (1 - t), hgt * (t < mx ? back : front));
  };
  const Wd = u => wid * Math.pow(H(u) / hgt, 0.8);
  const lo = window.__DIVE && window.__DIVE.quality === 'low';           // 画質「低」では、近く用も面を少なく（軽く）
  const NU = lod ? 10 : lo ? 22 : 32, NV = lod ? 8 : lo ? 14 : 28, pos = [], col = [], idx = [];   // 近く用は面を細かく（模様の境目がガタガタにならないように）
  // 模様は、まわりの点の色も平均して決める（はっきりした境目の模様が、面の大きさの階段にならないように）
  const patAA = (u, cy) => { if (lod) return pat(u, cy); const du = (1 - U0) / NU * 0.35, dv = 0.5 / NV; let r = 0, g = 0, b = 0;
    for (const a of [-1, 0, 1]) for (const c of [-1, 0, 1]) { const q = pat(u + a * du, Math.max(-1, Math.min(1, cy + c * dv))); r += q[0]; g += q[1]; b += q[2]; } return [r / 9, g / 9, b / 9]; };
  for (let i = 0; i <= NU; i++) {
    const u = U0 + (1 - U0) * i / NU, h = H(u), w = Wd(u), c = h * top * 0.5;
    for (let j = 0; j <= NV; j++) {
      const th = j / NV * Math.PI * 2, cy = Math.cos(th), sz = Math.sin(th);
      const y = c + cy * h * 0.5 * (cy > 0 ? 1 + top * 0.3 : 1 - top * 0.3), z = sz * w * 0.5 * (0.75 + 0.25 * Math.sqrt(Math.abs(sz)));   // 背と腹は少し細く（平たい魚らしい断面）
      pos.push(u - 0.5, y, z);
      let cc = patAA(u, cy);
      cc = cc.map(v => v * (0.82 + 0.22 * (cy * 0.5 + 0.5)) + (cy < -0.4 ? 0.06 : 0));   // 背は少し濃く、腹は明るい（カウンターシェーディング）
      if (Math.abs(cy) < 0.85) cc = cc.map(v => v * (1 - 0.22 * Math.exp(-(((u - 0.74 - 0.02 * cy * cy) / 0.014) ** 2))));   // えらぶたの線（弓なり）
      if (!lod && u > 0.955 && cy > -0.45 && cy < -0.02) cc = cc.map(v => v * (1 - 0.45 * Math.min(1, (u - 0.955) / 0.02)));   // 口の線（口先の少し下）
      col.push(...cc);
      if (i < NU && j < NV) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); body.setIndex(idx); body.computeVertexNormals();
  const parts = [body];
  // ひれ: 付け根の線から先の線までの帯（N 区切り）。先の方ほど薄い色・縁取り
  const strip = (base, tip, part) => {
    const g = new THREE.BufferGeometry(), p = [], c = [], ix = [], N = base.length - 1;
    for (let i = 0; i <= N; i++) {
      p.push(...base[i], ...tip[i]);
      const ray = part === 'pectoral' || part === 'filament' || part === 'finlet' ? 1 : (i % 2 ? 0.86 : 1);   // ひれの筋（軟条）を濃淡で
      c.push(...fin(part, 0).map(v => v * ray), ...fin(part, 1).map(v => v * ray));
      if (i < N) { const a = i * 2; ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.setIndex(ix); g.computeVertexNormals();
    return g;
  };
  const topY = u => H(u) * top * 0.5 + H(u) * 0.5 * (1 + top * 0.3), botY = u => H(u) * top * 0.5 - H(u) * 0.5 * (1 - top * 0.3);
  const longFin = ([u0, u1, fh, front = 1], up) => {                     // 背びれ・しりびれ: 前の方が高く、後ろへ向かって低く丸くなる。先は後ろへ流れる
    const b = [], t = [], N = lod ? 6 : 28;
    for (let i = 0; i <= N; i++) {
      const s = i / N, u = u1 - (u1 - u0) * s, y = up ? topY(u) : botY(u);   // s: 0 前 〜 1 後ろ
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.55) * (1 - 0.35 * s) * (1 + (front - 1) * Math.exp(-(((s - 0.12) / 0.12) ** 2)));
      const hh = fh * hgt * env;
      b.push([u - 0.5 + 0.004, y * 0.96, 0]);
      t.push([u - 0.5 - hh * (0.35 + 0.4 * s), y + (up ? 1 : -1) * hh, 0]);
    }
    return strip(b, t, up ? 'dorsal' : 'anal');
  };
  if (o.dorsal) parts.push(longFin(o.dorsal, true));
  if (o.dorsal2) parts.push(longFin(o.dorsal2, true));                   // 第 2 背びれ（サメなど）
  if (o.anal) parts.push(longFin(o.anal, false));
  if (o.finlets && !lod) for (let k = 0; k < o.finlets; k++) {           // 小離鰭: マグロ類の、尾の付け根の背と腹に並ぶ小さなひれ
    const u = 0.14 + k * 0.03, sz = 0.025 * hgt / 0.26;
    [true, false].forEach(up => { const y = up ? topY(u) : botY(u), sg = up ? 1 : -1;
      parts.push(strip([[u - 0.5 + 0.012, y * 0.97, 0], [u - 0.5 - 0.004, y * 0.97, 0]], [[u - 0.5 - 0.004, y + sg * sz, 0], [u - 0.5 - 0.012, y + sg * sz * 0.4, 0]], 'finlet')); });
  }
  // 尾びれ: 付け根の上下から、扇の縁へ。fork で真ん中がへこみ、lobe で上下の端が伸びる
  { const T = Object.assign({ len: 0.28, fork: 0.3, lobe: 0, round: 0 }, o.tail), N = lod ? 6 : 24, b = [], t = [], hb = H(U0) * 0.5;
    for (let i = 0; i <= N; i++) {
      const s = i / N * 2 - 1, up = s > 0 ? 1 + (T.upper || 0) : 1 - (T.upper || 0) * 0.4, edge = T.len * up * (1 - T.fork * (1 - Math.abs(s) ** 1.5) + T.lobe * Math.abs(s) ** 4 - T.round * Math.abs(s) ** 2 * 0.3);
      b.push([U0 - 0.5 + 0.01, s * hb, 0]);
      t.push([U0 - 0.5 - edge, s * up * (hb + T.len * 0.85 * (1 + T.lobe * 0.4)), 0]);
    }
    parts.push(strip(b, t, 'tail')); }
  // 胸びれ: えらぶたの後ろ、左右に（体の横に沿って、後ろ向きに少し開く）
  if (o.bigPecs) [-1, 1].forEach(sd => {                                // サメの胸びれ: 体の下の方から、横へ大きく張り出す
    const u = 0.66, y = H(u) * (top * 0.5 - 0.3), z = Wd(u) * 0.45 * sd, L = o.bigPecs, N = 6, b = [], t = [];
    for (let i = 0; i <= N; i++) { const s2 = i / N; b.push([u - 0.5 - s2 * 0.12, y, z]); t.push([u - 0.5 - 0.05 - L * 0.55 - s2 * 0.1, y - L * 0.25, z + sd * L * (1 - s2 * 0.8)]); }
    parts.push(strip(b, t, 'pectoral'));
  });
  if (!lod && !o.bigPecs) [-1, 1].forEach(sd => {                       // 胸びれ: 付け根から扇形に開く丸いひれ。透けて体の色が見えるので、体の色に寄せる
    const u = 0.69, y = H(u) * (top * 0.5 - 0.1), z = Wd(u) * 0.5 * sd, L = 0.14 * Math.max(0.6, hgt), N = 10, g = new THREE.BufferGeometry(), p = [u - 0.5, y, z], c = [], ix = [];
    const bodyC = pat(u, 0), finC = fin('pectoral', 0.6), cc = k => mixc(bodyC, finC, 0.35).map(v => v * (0.82 + 0.1 * (k % 2)));
    c.push(...cc(0));
    for (let i = 0; i <= N; i++) { const a = -0.9 + 1.5 * i / N, r = L * (0.75 + 0.25 * Math.cos((i / N - 0.45) * Math.PI)); p.push(u - 0.5 - Math.cos(a) * r, y + Math.sin(a) * r * 0.75, z + sd * r * 0.32); c.push(...cc(i)); if (i < N) ix.push(0, i + 1, i + 2); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.setIndex(ix); g.computeVertexNormals();
    parts.push(g);
  });
  // 目: 金色や白の輪と、黒い瞳（左右）
  const eu = 0.9 - 0.03 * snout, ey = H(eu) * (top * 0.5 + 0.12), er = Math.max(0.028, H(eu) * 0.13) * (o.eyeK || 1);   // eyeK: 目の大きさ（夜の魚は大きい）
  [-1, 1].forEach(sd => {
    const ez = Wd(eu) * 0.42 * sd;
    if (lod) { parts.push(paint(new THREE.SphereGeometry(er * 0.8, 5, 3).scale(1, 1, 0.45).translate(eu - 0.5, ey, ez), () => [0.05, 0.05, 0.06])); return; }
    const iris = mixc(o.eye || [0.85, 0.75, 0.35], [0.1, 0.1, 0.1], 0.35);
    parts.push(paint(new THREE.SphereGeometry(er, 12, 6).scale(1, 1, 0.22).translate(eu - 0.5, ey, ez), (x, y2) => { const r = Math.hypot(x - (eu - 0.5), y2 - ey) / er; return r > 0.86 ? [0.12, 0.12, 0.12] : iris; }));   // 虹彩（縁は暗い）
    parts.push(paint(new THREE.SphereGeometry(er * 0.66, 10, 6).scale(1, 1, 0.22).translate(eu - 0.5, ey, ez + sd * er * 0.1), () => [0.01, 0.01, 0.015]));   // 大きな黒い瞳
  });
  // 種類ごとの飾り（ツノダシ・トゲチョウチョウウオの、背びれから長く伸びる糸）
  if (o.filament) {
    const [fu, fl] = o.filament, y0 = topY(fu), N = 8, b = [], t = [];
    for (let i = 0; i <= N; i++) { const s = i / N, x = fu - 0.5 - s * fl * 0.85, y = y0 + fl * (0.75 * Math.sin(s * 1.6) - s * s * 0.25); b.push([x, y, 0]); t.push([x - 0.012, y + 0.018 * (1 - s), 0]); }
    parts.push(strip(b, t, 'filament'));
  }
  return merge(parts);
}
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
const band = (u, c, w) => Math.max(0, 1 - Math.abs(u - c) / w);
const W = [1, 1, 1], K = [0.04, 0.04, 0.05];
// 種類ごとの形・色・群れ方。len: 体長 (m)、n: 群れの数、R: 泳ぎ回る範囲 (m)、up: 海底からの高さ (m)、spd: 速さ (m/秒)
// home: すみか（branch: 枝サンゴ / coral: どのサンゴでも / anemone: イソギンチャク）、w: 出会いやすさ、curious: 人に寄ってくる
const FISH = [
  { kind: 'chromis', name: 'デバスズメダイ', len: 0.07, n: [12, 22], R: 0.9, up: [0.3, 1.1], spd: 0.25, home: 'branch', w: 3, hide: true,
    geo: { hgt: 0.46, mx: 0.55, snout: 0.8, tail: { len: 0.3, fork: 0.75, lobe: 0.3 }, dorsal: [0.3, 0.78, 0.22], anal: [0.25, 0.5, 0.2], eye: [0.75, 0.85, 0.85],
      pat: (u, v) => mixc([0.55, 0.95, 0.85], [0.35, 0.8, 0.95], (v + 1) / 2 + 0.2 * Math.sin(u * 30)),
      fin: (p, s) => mixc([0.5, 0.9, 0.85], [0.7, 0.95, 1.0], s) } },
  { kind: 'anthias', name: 'キンギョハナダイ', len: 0.1, n: [14, 26], R: 2.6, up: [0.8, 2.6], spd: 0.3, home: 'coral', w: 2, curious: 0.5, deep: 3,
    geo: { hgt: 0.36, mx: 0.5, snout: 0.9, tail: { len: 0.32, fork: 0.85, lobe: 0.9 }, dorsal: [0.25, 0.8, 0.28, 1.6], anal: [0.25, 0.45, 0.3], eye: [0.95, 0.6, 0.3],
      pat: (u, v) => mixc(mixc([1.0, 0.48, 0.2], [1.0, 0.7, 0.55], (v + 1) / 2 * 0.5), [0.75, 0.35, 0.85], band(v, -0.1, 0.12) * band(u, 0.8, 0.12) * 1.5),   // 目の下から胸へ、紫の線
      fin: (p, s) => p === 'tail' ? mixc([1.0, 0.5, 0.25], [1.0, 0.85, 0.3], s) : mixc([1.0, 0.55, 0.3], [0.95, 0.4, 0.6], s) } },
  { kind: 'hepatus', name: 'ナンヨウハギ', len: 0.22, n: [3, 6], R: 5, up: [0.5, 1.8], spd: 0.45, home: 'coral', w: 1.2, curious: 0.7, hide: true,
    geo: { hgt: 0.52, mx: 0.5, snout: 0.9, tail: { len: 0.26, fork: 0.15, lobe: 0.2 }, dorsal: [0.15, 0.78, 0.13], anal: [0.15, 0.55, 0.11], eye: [0.15, 0.2, 0.4],
      pat: (u, v) => {
        const pal = v > 0.05 && u > 0.22 && u < 0.88 && v < 0.62 + 0.25 * Math.sin(u * 6.5) && !(u > 0.4 && u < 0.62 && v > 0.15 && v < 0.42);   // 黒いパレット形の模様（中に青の抜け）
        return u < 0.16 ? [1.0, 0.85, 0.1] : pal ? [0.03, 0.04, 0.1] : [0.08, 0.3, 0.98];
      },
      fin: (p, s) => p === 'tail' ? mixc([1.0, 0.85, 0.1], K, s > 0.85 ? 1 : 0) : p === 'pectoral' ? [1.0, 0.85, 0.15] : mixc([0.08, 0.3, 0.95], K, s > 0.75 ? 1 : 0) } },
  { kind: 'flavescens', name: 'キイロハギ', len: 0.16, n: [4, 8], R: 4, up: [0.4, 1.5], spd: 0.4, home: 'coral', w: 1.5, curious: 0.6,
    geo: { hgt: 0.72, mx: 0.45, snout: 1.7, top: 0.05, tail: { len: 0.24, fork: 0.0, round: 0.4 }, dorsal: [0.12, 0.66, 0.3], anal: [0.12, 0.5, 0.26], eye: [0.95, 0.8, 0.15],
      pat: (u, v) => mixc([1.0, 0.85, 0.05], [1.0, 0.95, 0.75], band(u, 0.17, 0.025)),       // 尾の付け根の白いとげ
      fin: (p, s) => mixc([1.0, 0.82, 0.05], [1.0, 0.92, 0.35], s) } },
  { kind: 'auriga', name: 'トゲチョウチョウウオ', len: 0.18, n: [2, 2], R: 5, up: [0.4, 1.4], spd: 0.35, home: 'coral', w: 1.2, curious: 0.6, filament: true, pair: true,
    geo: { hgt: 0.72, mx: 0.5, snout: 1.4, top: 0.05, tail: { len: 0.2, fork: 0.0, round: 0.5 }, dorsal: [0.12, 0.66, 0.26], anal: [0.12, 0.5, 0.22], filament: [0.3, 0.35], eye: K,
      pat: (u, v) => {
        if (band(u, 0.88, 0.035) > 0 && v > -0.6) return K;                                  // 目を通る黒い帯
        if (u > 0.5) return [0.98, 0.98, 0.95];
        const chev = Math.abs(((u * 9 + Math.abs(v) * 3) % 1) - 0.5) < 0.08;                // 斜めの細い線（くの字）
        return v > 0.2 && u < 0.45 ? [1.0, 0.82, 0.15] : chev ? [0.45, 0.45, 0.48] : [0.97, 0.97, 0.94];
      },
      fin: (p, s) => p === 'dorsal' && s > 0.6 ? K : p === 'tail' ? [1.0, 0.82, 0.2] : p === 'filament' ? [0.95, 0.85, 0.5] : [1.0, 0.85, 0.25] } },
  { kind: 'zanclus', name: 'ツノダシ', len: 0.18, n: [2, 3], R: 6, up: [0.5, 2.0], spd: 0.35, home: 'coral', w: 0.8, curious: 0.7, deep: 0.8,
    geo: { hgt: 0.85, mx: 0.55, snout: 2.4, top: 0.0, tail: { len: 0.2, fork: 0.15 }, dorsal: [0.25, 0.66, 0.35, 2.6], anal: [0.2, 0.55, 0.42, 1.6], filament: [0.6, 0.85], eye: [0.95, 0.85, 0.3],
      pat: (u, v) => {
        if (u > 0.92 && v < 0.4) return [1.0, 0.6, 0.2];                                     // 口先の橙
        if (u > 0.82 && u < 0.92 && v > 0.1) return [1.0, 0.88, 0.25];
        if ((u > 0.6 && u < 0.8) || (u > 0.22 && u < 0.36)) return K;                        // 2 本の太い黒い帯
        return u > 0.36 && u < 0.6 ? [1.0, 0.9, 0.3] : [0.98, 0.98, 0.95];
      },
      fin: (p, s) => p === 'tail' ? (s > 0.5 ? K : [0.98, 0.98, 0.95]) : p === 'filament' ? [0.98, 0.98, 0.94] : p === 'anal' ? K : [0.98, 0.98, 0.94] } },
  { kind: 'parrot', name: 'ブダイ', len: 0.45, n: [1, 3], R: 9, up: [0.3, 0.9], spd: 0.5, home: 'coral', w: 0.9, curious: 0.4,
    geo: { hgt: 0.34, wid: 0.18, mx: 0.55, snout: 0.6, top: 0.2, tail: { len: 0.24, fork: 0.25, lobe: 0.5 }, dorsal: [0.18, 0.75, 0.1], anal: [0.15, 0.45, 0.1], eye: [0.95, 0.75, 0.2],
      pat: (u, v) => {
        if (u > 0.96) return [0.85, 0.9, 0.85];                                              // くちばしのような歯
        const scale = (Math.sin(u * 70) * Math.sin(v * 9) > 0.55) ? 0.82 : 1;                // うろこの縁取り
        return mixc(mixc([0.15, 0.7, 0.55], [0.25, 0.5, 0.92], band(u, 0.55, 0.35)), [0.98, 0.55, 0.7], band(v, 0.0, 0.08) * (u > 0.8 ? 1 : 0)).map(c => c * scale);
      },
      fin: (p, s) => mixc([0.2, 0.6, 0.85], [0.95, 0.55, 0.7], p === 'tail' ? s : s * 0.5) } },
  // ホンソメワケベラ: 「掃除屋」。決まった場所（掃除場）で、来た魚の体の寄生虫を食べる。黒い帯は口先から尾まで、後ろほど太い
  { kind: 'cleaner', name: 'ホンソメワケベラ', len: 0.09, n: [1, 2], R: 0.25, up: [0.2, 0.6], spd: 0.3, home: 'station', w: 0,
    geo: { hgt: 0.22, wid: 0.1, mx: 0.5, snout: 1.5, tail: { len: 0.2, fork: 0.0, round: 0.6 }, dorsal: [0.15, 0.75, 0.25], anal: [0.15, 0.45, 0.25], eye: K,
      pat: (u, v) => { const w = 0.12 + 0.3 * (1 - u); return Math.abs(v) < w ? K : v > 0 ? mixc([0.85, 0.92, 1.0], [0.2, 0.55, 1.0], 1 - u) : [0.95, 0.96, 0.97]; },
      fin: (p, s) => p === 'tail' ? (s > 0.3 && s < 0.7 ? K : [0.2, 0.55, 1.0]) : [0.3, 0.6, 1.0] } },
  // ヨスジフエダイ: 黄色い体に 4 本の青い線。根のまわりに大きな群れで、ゆったり浮かぶ
  { kind: 'kasmira', name: 'ヨスジフエダイ', len: 0.25, n: [10, 22], R: 3, up: [1.0, 3.0], spd: 0.25, home: 'coral', w: 0.9, school: true, deep: 2,
    geo: { hgt: 0.36, mx: 0.45, snout: 1.1, top: 0.25, tail: { len: 0.26, fork: 0.45 }, dorsal: [0.2, 0.7, 0.2], anal: [0.2, 0.42, 0.2], eye: [0.9, 0.8, 0.4],
      pat: (u, v) => { if (v < -0.55) return [0.97, 0.95, 0.85]; const ln = [0.55, 0.15, -0.2, -0.45].some(c => Math.abs(v - c - 0.05 * Math.sin(u * 4)) < 0.045); return ln ? [0.35, 0.7, 1.0] : [1.0, 0.8, 0.12]; },
      fin: () => [1.0, 0.85, 0.2] } },
  // ムラサメモンガラ: 砂地との境の岩場にすむ、模様の派手なモンガラカワハギ。巣穴の近くを守り、近づく相手を追い払う
  { kind: 'picasso', name: 'ムラサメモンガラ', len: 0.22, n: [1, 1], R: 2.5, up: [0.2, 0.7], spd: 0.35, home: 'coral', w: 0.6, curious: 0.3,
    geo: { hgt: 0.5, mx: 0.45, snout: 1.6, top: 0.1, tail: { len: 0.22, fork: 0.0, round: 0.5 }, dorsal: [0.18, 0.48, 0.3], anal: [0.18, 0.45, 0.3], eye: [0.95, 0.5, 0.2],
      pat: (u, v) => {
        if (u > 0.93 && v < 0.2) return [1.0, 0.7, 0.2];                                    // 黄色い唇
        if (u > 0.68 && u < 0.92 && Math.abs(v - 0.05 - (u - 0.8) * 2) < 0.08) return [0.25, 0.45, 0.95];   // 目を通る青い線
        if (u > 0.3 && u < 0.62 && v < 0.1) return Math.sin((u + v * 0.6) * 55) > 0.2 ? K : [0.85, 0.82, 0.72];   // 腹の、斜めの黒い縞
        if (u < 0.3 && v < 0.0 && u > 0.12) return K;
        return mixc([0.75, 0.68, 0.5], [0.95, 0.93, 0.88], (v + 1) / 2 < 0.5 ? 1 : 0.3);
      },
      fin: (p, s) => p === 'tail' ? [0.9, 0.88, 0.8] : [0.92, 0.9, 0.82] } },
  // ギンガメアジ: 銀色の大きな群れ。礁の外側の少し深い所の中層で、渦を巻くように回る。向きを変えると、体がいっせいにきらっと光る
  { kind: 'jack', name: 'ギンガメアジ', len: 0.5, n: [45, 70], R: 4.5, up: [2.5, 8], spd: 0.6, home: 'open', w: 0, school: true, silver: true,
    geo: { hgt: 0.36, wid: 0.13, mx: 0.5, snout: 1.0, top: 0.2, ped: 0.08, tail: { len: 0.32, fork: 0.85, lobe: 0.6 }, dorsal: [0.2, 0.55, 0.22, 1.6], anal: [0.2, 0.45, 0.2, 1.5], eye: [0.9, 0.85, 0.6],
      pat: (u, v) => (u > 0.8 && u < 0.84 && v > 0.15 && v < 0.55) ? [0.15, 0.17, 0.2] : mixc([0.85, 0.88, 0.92], [0.35, 0.45, 0.56], Math.max(0, v) * 1.2),   // 銀白色、背は青灰色。えらぶたの上に黒い点
      fin: (p, s) => p === 'tail' ? mixc([0.45, 0.5, 0.55], [0.15, 0.17, 0.2], s) : p === 'dorsal' && s > 0.8 ? [0.95, 0.95, 0.95] : [0.55, 0.6, 0.65] } },
  // ---- ダイブポイントにすむ魚（config の sites の fish で、決まったポイントに群れる。home: 'point'） ----
  // ブラックフィンバラクーダ: 銀色の細長い体に、くの字の黒っぽい縞と黒い尾。何十〜何百匹もの群れで、柱のように渦を巻く
  { kind: 'barracuda', name: 'ブラックフィンバラクーダ', len: 0.9, n: [60, 90], R: 3.5, up: [3, 14], spd: 0.45, home: 'point', w: 0, school: true, silver: true, maxN: 200,
    where: 'グアム北部のピナクル・ブルーアステール（潮の当たる根のまわり）',
    geo: { hgt: 0.15, wid: 0.1, mx: 0.45, snout: 2.2, top: 0.05, ped: 0.25, tail: { len: 0.2, fork: 0.7, lobe: 0.3 }, dorsal: [0.5, 0.58, 0.45, 1.2], anal: [0.28, 0.34, 0.4], eye: [0.85, 0.85, 0.7],
      pat: (u, v) => (Math.sin(u * 48 + Math.abs(v) * 4) > 0.55 && v > -0.2 && u > 0.2 && u < 0.85) ? [0.35, 0.4, 0.45] : mixc([0.85, 0.88, 0.92], [0.45, 0.52, 0.6], Math.max(0, v)),
      fin: (p, s) => p === 'tail' ? mixc([0.3, 0.32, 0.36], [0.1, 0.11, 0.13], s) : [0.4, 0.44, 0.5] } },
  // イソマグロ: 外洋に面した根を、数匹で回る大きなマグロの仲間。背は青黒く、腹は銀白色
  { kind: 'dogtooth', name: 'イソマグロ', len: 1.3, n: [3, 5], R: 14, up: [2, 12], spd: 1.1, home: 'point', w: 0, silver: true, maxN: 24,
    where: 'グアム北部のピナクル（外洋に面した根）',
    geo: { hgt: 0.24, wid: 0.17, mx: 0.5, snout: 1.4, top: 0.15, ped: 0.06, tail: { len: 0.3, fork: 0.9, lobe: 0.8 }, dorsal: [0.42, 0.66, 0.35, 1.8], anal: [0.3, 0.4, 0.3], eye: [0.85, 0.8, 0.6],
      pat: (u, v) => mixc([0.82, 0.85, 0.88], [0.15, 0.2, 0.32], Math.max(0, v + 0.1) * 1.4),
      fin: (p, s) => p === 'tail' ? [0.2, 0.24, 0.32] : [0.3, 0.34, 0.42] } },
  // マルコバンアジ: 銀色の平たいアジ。胸びれとひれの先が黄色みを帯びる
  { kind: 'pompano', name: 'マルコバンアジ', len: 0.5, n: [8, 14], R: 3, up: [1, 4], spd: 0.45, home: 'point', w: 0, school: true, silver: true, maxN: 60,
    where: 'グアム北部のブルーアステール（浅い礁の上）',
    geo: { hgt: 0.55, wid: 0.12, mx: 0.5, snout: 0.6, top: 0.1, ped: 0.07, tail: { len: 0.3, fork: 0.85, lobe: 0.8 }, dorsal: [0.2, 0.5, 0.45, 2.0], anal: [0.2, 0.45, 0.45, 2.0], eye: [0.8, 0.8, 0.7],
      pat: (u, v) => mixc([0.88, 0.9, 0.9], [0.55, 0.6, 0.62], Math.max(0, v)),
      fin: (p, s) => p === 'pectoral' ? [0.9, 0.85, 0.5] : mixc([0.55, 0.55, 0.5], [0.85, 0.7, 0.3], s) } },
  // ドウクツハタンポの仲間: 洞窟や沈船の暗がりに、何百匹も群れる、赤銅色の小さな魚
  { kind: 'sweeper', name: 'ドウクツハタンポの仲間', len: 0.12, n: [80, 110], R: 1.8, up: [0, 3], spd: 0.25, home: 'point', w: 0, school: true, mill: true, maxN: 340,
    where: '沈船（東海丸）や洞窟の暗がり',
    geo: { hgt: 0.46, wid: 0.09, mx: 0.72, snout: 0.45, top: -0.12, ped: 0.1, tail: { len: 0.22, fork: 0.35 }, dorsal: [0.55, 0.72, 0.42, 1.8], anal: [0.13, 0.56, 0.16], eye: [0.7, 0.66, 0.55], eyeK: 1.25,
      pat: (u, v) => mixc(mixc([0.9, 0.66, 0.42], [0.62, 0.36, 0.2], Math.max(0, v) * 1.2), [0.95, 0.85, 0.75], v < -0.5 ? 0.5 : 0),
      fin: (p, s) => p === 'anal' && s > 0.7 ? [0.12, 0.08, 0.06] : p === 'dorsal' && s > 0.75 ? [0.2, 0.12, 0.08] : [0.95, 0.72, 0.5] } },
  // ツマグロ: ひれの先が黒い、浅い礁のサメ
  { kind: 'blacktip', name: 'ツマグロ', len: 1.3, n: [2, 3], R: 11, up: [0.8, 2.2], spd: 0.8, home: 'point', w: 0, maxN: 12,
    where: 'グアム北部のブルーアステール（浅い礁）',
    geo: { hgt: 0.17, wid: 0.15, mx: 0.42, snout: 1.5, top: 0.12, ped: 0.18, bigPecs: 0.24, tail: { len: 0.3, fork: 0.55, upper: 0.5 }, dorsal: [0.52, 0.66, 0.8, 1.5], dorsal2: [0.2, 0.25, 0.3], anal: [0.18, 0.26, 0.45], eye: [0.15, 0.17, 0.15],
      pat: (u, v) => (u > 0.7 && u < 0.79 && Math.abs(v) < 0.45 && Math.sin(u * 300) > 0.8) ? [0.4, 0.38, 0.33] : mixc([0.93, 0.92, 0.9], [0.55, 0.52, 0.45], (v + 0.35) / 0.5),   // えらあな 5 本
      fin: (p, s) => s > 0.72 ? [0.05, 0.05, 0.06] : [0.52, 0.5, 0.45] } },
  // ナンヨウマンタ: 翼のような胸びれで、ゆっくり羽ばたきながら旋回する。背は黒く、肩に白い模様
  { kind: 'manta', name: 'ナンヨウマンタ', len: 1.9, n: [2, 3], R: 7, up: [2.5, 6], spd: 0.6, home: 'point', w: 0, ray: true, maxN: 8,
    where: 'グアム北部のマンタポイント' },
  // クマノミ（グアムのイソギンチャクにすむのはこの仲間。カクレクマノミはマリアナにはいない）: 体の横は黒褐色、顔と腹・ひれは橙、白い帯が 3 本、尾は淡い黄色
  { kind: 'clown', name: 'クマノミ', len: 0.1, n: [2, 3], R: 0.35, up: [0.15, 0.5], spd: 0.15, home: 'anemone', w: 0,
    geo: { hgt: 0.46, mx: 0.5, snout: 0.6, tail: { len: 0.24, fork: 0.25, round: 0.3 }, dorsal: [0.2, 0.8, 0.26], anal: [0.18, 0.45, 0.28], eye: [0.95, 0.65, 0.2],
      pat: (u, v) => { const wb = Math.max(band(u, 0.8, 0.06), band(u, 0.5, 0.07), band(u, 0.14, 0.045));
        if (wb > 0.25) return [0.97, 0.97, 0.95];
        const dark = u > 0.18 && u < 0.76 && v > -0.35 ? 1 : 0;
        return mixc([1.0, 0.55, 0.1], [0.14, 0.08, 0.05], dark * (0.8 + 0.2 * v)); },
      fin: (p, s) => p === 'tail' ? [1.0, 0.9, 0.55] : p === 'dorsal' ? mixc([0.18, 0.1, 0.06], [1.0, 0.55, 0.1], s) : [1.0, 0.55, 0.12] } }
];
// 近く（潜水艇から 8m 以内）は細かい形、遠くは面の少ない形で描く（数百匹を軽く描くため）
const FISH_NEAR = 8, fishMat = swayMat({ roughness: 0.32, metalness: 0.05 }, 1);
// 銀色の魚（ギンガメアジなど）: ときどき、きらっと光る
const silverMat = swayMat({ roughness: 0.25, metalness: 0.25 }, 1, [], 1);
// エイの体（頭が +x、体長 1 = 胸びれの幅の約半分）: 背の面と腹の面を別に作り、胸びれの縁で合わせる（背と腹で色が違う）。
//   half(u): 胸びれの広がり（u: 0 前 〜 1 後ろ）、sweep: 翼の先が後ろへ反る量、thick: 体の厚み、top / bottom(u, av): 背・腹の色（av: 0 中心 〜 1 翼の先）
function rayBody({ half, sweep, thick, top, bottom }) {
  const NU = 20, NV = 28, parts = [];
  [1, -1].forEach(side => {
    const pos = [], col = [], idx = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, hw = half(u);
      for (let j = 0; j <= NV; j++) {
        const v = j / NV * 2 - 1, av = Math.abs(v), x = 0.5 - u - sweep * Math.pow(av, 1.6);
        const body = Math.pow(Math.max(0, 1 - av * 1.25), 1.5) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.6);   // 中ほどは厚く、翼の縁で 0
        pos.push(x, side * thick * body * (side > 0 ? 1 : 0.55), v * hw);
        col.push(...(side > 0 ? top(u, av, x, v * hw) : bottom(u, av, x, v * hw)));
        if (i < NU && j < NV) { const a = i * (NV + 1) + j, b = a + NV + 1; if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    parts.push(g);
  });
  return parts;
}
// ナンヨウマンタ: 後ろへ反った大きな翼、頭の前の左右に巻いた頭びれ、横一文字の大きな口、短い尾。
// 背は黒く、肩に白い模様（左右の Y 字形）。腹は白く、翼の縁が灰色で、黒い小さな斑点が散らばる
function mantaGeo() {
  const parts = rayBody({
    half: u => 1.15 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.25)), 0.7) * (1 - 0.45 * u), sweep: 0.3, thick: 0.09,
    top: (u, av) => (av > 0.12 && av < 0.55 && u > 0.1 && u < 0.38 && av - 0.12 > (u - 0.1) * 0.9) ? [0.85, 0.86, 0.87] : av > 0.85 ? [0.16, 0.17, 0.18] : [0.06, 0.065, 0.075],
    bottom: (u, av, x, z) => av > 0.8 ? [0.12, 0.12, 0.14] : (Math.sin(x * 47 + z * 13) * Math.sin(z * 41 - x * 9) > 0.93 && u > 0.3) ? [0.1, 0.1, 0.12] : [0.93, 0.93, 0.92]
  });
  // 頭びれ: 頭の前の左右に、内側へ巻いた細長いひれ
  [-1, 1].forEach(sd => { const g = new THREE.CylinderGeometry(0.035, 0.05, 0.24, 8, 1, true, 0, Math.PI * 1.4).rotateZ(Math.PI / 2).rotateX(sd * 0.6).translate(0.58, 0.0, sd * 0.15); parts.push(paint(g, () => [0.07, 0.07, 0.08])); });
  parts.push(paint(new THREE.BoxGeometry(0.03, 0.02, 0.24).translate(0.5, -0.005, 0), () => [0.03, 0.03, 0.04]));   // 口
  parts.push(paint(new THREE.CylinderGeometry(0.004, 0.025, 0.45, 5).rotateZ(Math.PI / 2).translate(-0.72, 0.01, 0), () => [0.07, 0.07, 0.08]));   // 尾
  return merge(parts);
}
const mantaMat = swayMat({ roughness: 0.5 }, 4, [1.1, 0.3, 1.0]);       // ゆっくり羽ばたく
FISH.forEach(f => {
  if (f.ray && window.SPECIES && window.SPECIES.reefManta) f.bodies = [];   // マンタは 1 匹ずつ、細かく作った体で（下の「マンタの体」）
  const max = f.maxN || (f.home === 'anemone' ? 520 : f.kind === 'jack' ? 200 : 400), mat = f.ray ? mantaMat : f.silver ? silverMat : fishMat;
  f.mesh = instanced(f.ray ? mantaGeo() : fishGeo(f.geo, 1), mat, max);
  f.near = instanced(f.ray ? mantaGeo() : fishGeo(f.geo, 0), mat, Math.min(max, 80));
  f.max = max;
});

// ---------- 底の生き物の形 ----------
const ROUNDN = g => { const p = g.attributes.position, n = new Float32Array(p.count * 3), v = new THREE.Vector3();   // 丸い陰影
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); n.set([v.x, v.y, v.z], i * 3); } g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); return g; };
const GEO = {
  // イソギンチャク（センジュイソギンチャク）: 平たい台と、たくさんの短い触手。台は紫、触手は先が緑がかったクリーム色
  anemone: (() => {
    const parts = [paint(new THREE.CylinderGeometry(0.42, 0.36, 0.12, 18).translate(0, 0.06, 0), () => [0.55, 0.22, 0.5])];
    for (let i = 0; i < 120; i++) {
      const a = i * 2.39996, r = 0.41 * Math.sqrt((i + 0.5) / 120), len = 0.12 + 0.06 * Math.sin(i * 1.7);
      const t = new THREE.CylinderGeometry(0.007, 0.018, len, 4).translate(0, len / 2, 0);
      t.rotateZ(0.35 * r / 0.4 * Math.cos(a)); t.rotateX(-0.35 * r / 0.4 * Math.sin(a)); t.translate(Math.cos(a) * r, 0.11, Math.sin(a) * r);
      parts.push(paint(t, (x, y) => mixc([0.92, 0.88, 0.7], [0.62, 0.86, 0.45], (y - 0.12) / 0.2)));
    }
    return merge(parts);
  })(),
  // ヒメシャコガイ: 岩に半分埋まった、厚い 2 枚の殻。殻には 5 本ほどの大きな波形の折れ目と、うろこ状の細い筋があり、口はジグザグにかみ合う。
  // 口から、色鮮やかな外套膜（濃い青・青緑のまだらと、縁の細い線）が広がり、真ん中に水を出し入れする穴がある
  clam: (() => {
    const shell = new THREE.SphereGeometry(0.5, 40, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), fold = Math.sin(x * 2.8 * Math.PI);   // 殻の長さ方向に並ぶ、大きな波形の折れ目
      const k = 1 + 0.1 * fold * Math.sqrt(Math.max(0, -y * 2)) + 0.02 * Math.sin(y * 60);    // 口の近くほど折れ目が大きい。うろこ状の筋
      p.setXYZ(i, x * 1.45 * k, 0.25 + y * 0.65 * k + 0.07 * fold * Math.max(0, 1 + y * 3), z * 0.62 * k);   // 上へ口を開けた器の形（底は岩に少し埋まる）
    }
    shell.computeVertexNormals();
    const mantle = new THREE.RingGeometry(0.001, 0.5, 48, 10).rotateX(-Math.PI / 2);
    const mp = mantle.attributes.position;
    for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), z = mp.getZ(i); mp.setXYZ(i, x * 1.4, 0.27 + 0.07 * Math.sin(x * 2.8 * Math.PI) - 0.02 * (x * x + z * z * 3), z * 0.52); }
    mantle.computeVertexNormals();
    return merge([
      paint(shell, (x, y, z) => { const g = 0.5 + 0.5 * Math.sin(x * 2.8 * Math.PI / 1.45); return mixc([0.62, 0.6, 0.52], [0.9, 0.88, 0.8], g * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(y * 60))); }),
      paint(mantle, (x, y, z) => {
        const r = Math.hypot(x / 1.4, z / 0.52);
        if (r < 0.06) return [0.15, 0.1, 0.12];                                                        // 水を出し入れする穴
        if (r > 0.42) return [0.3, 0.75, 0.85];                                                        // 縁の明るい線
        const spot = Math.sin(x * 38) * Math.sin(z * 55) > 0.45;
        return spot ? [0.35, 0.85, 0.75] : mixc([0.05, 0.2, 0.75], [0.1, 0.5, 0.85], 0.5 + 0.5 * Math.sin(x * 9 + z * 14));
      })
    ]);
  })(),
  // ガンガゼ: 黒い丸い体から、細く長いとげ（体の 3〜4 倍）が四方に伸びる。てっぺんに橙の輪（肛門のまわり）、体の 5 か所に青く光る点
  urchin: (() => {
    const parts = [paint(ROUNDN(new THREE.IcosahedronGeometry(0.2, 2).scale(1, 0.72, 1).translate(0, 0.12, 0)), () => [0.05, 0.04, 0.07])];
    parts.push(paint(new THREE.TorusGeometry(0.035, 0.012, 6, 14).rotateX(Math.PI / 2).translate(0, 0.27, 0), () => [0.95, 0.45, 0.12]));
    for (let k = 0; k < 5; k++) { const a = k * Math.PI * 0.4; parts.push(paint(new THREE.SphereGeometry(0.022, 6, 4).translate(Math.cos(a) * 0.12, 0.23, Math.sin(a) * 0.12), () => [0.2, 0.55, 1.0])); }
    for (let i = 0; i < 60; i++) {
      const y = 1 - (i + 0.5) / 60 * 1.35, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.39996, d = new THREE.Vector3(Math.cos(a) * r, Math.abs(y) * 0.85 + 0.15, Math.sin(a) * r).normalize();
      const L = 0.55 + 0.35 * Math.abs(Math.sin(i * 1.7)), s = new THREE.CylinderGeometry(0.002, 0.009, L, 4).translate(0, L / 2, 0);
      s.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d))); s.translate(0, 0.12, 0);
      parts.push(paint(s, (x, yy, z) => Math.hypot(x, yy - 0.12, z) < 0.22 ? [0.12, 0.1, 0.16] : [0.06, 0.05, 0.08]));
    }
    return merge(parts);
  })(),
  // ナマコ: 砂の上に横たわる、こぶのある細長い体
  cucumber: (() => {
    const g = new THREE.SphereGeometry(0.15, 12, 8).scale(1, 2.6, 1);
    g.rotateZ(Math.PI / 2).translate(0, 0.08, 0);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setY(i, p.getY(i) * 0.75 + (p.getY(i) > 0.08 ? 0.015 * Math.sin(x * 40) : 0)); }
    g.computeVertexNormals();
    return paint(g, (x, y) => mixc([0.12, 0.09, 0.07], [0.3, 0.22, 0.15], (y - 0.02) / 0.12));
  })(),
  // ウミウチワ（ヤギ）: 平たい扇のような網目の枝（赤・橙・紫）。流れに直角に立つ
  fan: (() => {
    const parts = [], rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const grow = (x, y, a, len, d) => {
      if (d > 5 || len < 0.05) return;
      const x2 = x + Math.sin(a) * len, y2 = y + Math.cos(a) * len, c = new THREE.CylinderGeometry(0.008 * (6 - d) / 3, 0.01 * (6 - d) / 3, len, 4);
      c.translate(0, len / 2, 0).rotateZ(-a).translate(x, y, 0); parts.push(c);
      grow(x2, y2, a - 0.35 - rnd() * 0.25, len * 0.78, d + 1); grow(x2, y2, a + 0.35 + rnd() * 0.25, len * 0.78, d + 1);
    };
    grow(0, 0, 0, 0.28, 0);
    return paint(merge(parts), () => [1, 1, 1]);
  })(),
  // ソフトコーラル（ウミキノコ）: なめらかな柄の上に、縁が大きく波打つ（ひだの寄った）笠。笠の上には細かいポリプが開き、薄い黄土色の地に、
  // ポリプの白っぽい点が一面に散らばる。柄はクリーム色で、縦のしわがある
  leather: (() => {
    const stem = new THREE.CylinderGeometry(0.11, 0.17, 0.26, 16, 3).translate(0, 0.13, 0);
    { const p = stem.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.06 * Math.sin(a * 11); p.setX(i, x * k); p.setZ(i, z * k); } stem.computeVertexNormals(); }
    const cap = new THREE.SphereGeometry(0.36, 48, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.3, 1).translate(0, 0.23, 0);
    const p = cap.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z) / 0.36; p.setY(i, p.getY(i) + 0.07 * Math.sin(a * 9 + Math.sin(a * 3) * 1.5) * r * r - 0.02 * r * r); }   // 縁ほど大きく波打つひだ
    cap.computeVertexNormals();
    return merge([paint(stem, (x, y, z) => mixc([0.66, 0.6, 0.44], [0.76, 0.72, 0.56], y / 0.26)),
      paint(cap, (x, y, z) => (Math.sin(x * 95) * Math.sin(z * 95) > 0.55 ? [0.72, 0.7, 0.55] : mixc([0.48, 0.43, 0.25], [0.38, 0.42, 0.26], 0.5 + 0.5 * Math.sin(x * 11 + z * 7))))]);
  })(),
  // カイメンの仲間（ツツカイメン）: 岩から何本も立ち上がる、口の開いた筒。筒の内側は暗く、縁は少し厚い。色（紫・橙・黄・青紫・桃）は株ごとに
  sponge: (() => {
    const parts = [], tubes = [[0, 0, 0.55, 0.075, 0], [0.11, 0.05, 0.42, 0.06, 0.18], [-0.09, 0.07, 0.36, 0.055, -0.22], [0.04, -0.11, 0.3, 0.05, 0.12], [-0.06, -0.08, 0.24, 0.045, -0.1]];
    tubes.forEach(([x, z, L, r, lean]) => {
      const out = new THREE.CylinderGeometry(r, r * 0.8, L, 10, 3, true).translate(0, L / 2, 0), inn = new THREE.CylinderGeometry(r * 0.82, r * 0.6, L * 0.92, 10, 1, true).translate(0, L * 0.54, 0);
      const op = out.attributes.position; for (let i = 0; i < op.count; i++) { const a = Math.atan2(op.getZ(i), op.getX(i)), y = op.getY(i), k = 1 + 0.06 * Math.sin(a * 5 + y * 20) + 0.05 * Math.sin(y * 31); op.setX(i, op.getX(i) * k); op.setZ(i, op.getZ(i) * k); }   // でこぼこした筒
      out.computeVertexNormals(); inn.scale(-1, 1, 1);                 // 内側の面を内向きに
      const rim = new THREE.TorusGeometry(r * 0.91, r * 0.12, 4, 10).rotateX(Math.PI / 2).translate(0, L, 0);
      [out, inn, rim].forEach(g => { g.rotateZ(lean).rotateX(lean * 0.6).translate(x, 0, z); });
      parts.push(paint(out, (px, y) => { const k = 0.75 + 0.35 * Math.min(1, y / L); return [k, k, k]; }), paint(inn, () => [0.18, 0.15, 0.17]), paint(rim, () => [1.05, 1.05, 1.05]));
    });
    return merge(parts);
  })(),
  // ソフトコーラル（トゲトサカの仲間）: 半透明の白っぽい幹と枝の先に、小さなポリプのかたまりが、カリフラワーのように集まる（桃・赤・紫・橙・黄）
  softcoral: (() => {
    const parts = [], rnd = (() => { let s = 23; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(), UPv = new THREE.Vector3(0, 1, 0);
    const branch = (base, dir, len, rad, lvl) => {
      const c = new THREE.CylinderGeometry(rad * 0.7, rad, len, 6, 1, true).translate(0, len / 2, 0);
      c.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UPv, dir))); c.translate(base.x, base.y, base.z);
      parts.push(paint(c, () => [1.05, 1.0, 1.02]));                     // 幹は白っぽい（半透明に見えるよう、明るめ）
      const tip = base.clone().addScaledVector(dir, len);
      if (lvl >= 3) {                                                  // 枝先のポリプのかたまり
        for (let k = 0; k < 6; k++) { const o = new THREE.Vector3(rnd() - 0.5, rnd() * 0.7, rnd() - 0.5).multiplyScalar(0.055); const s = ROUNDN(new THREE.IcosahedronGeometry(0.016 + rnd() * 0.014, 0)).translate(tip.x + o.x, tip.y + o.y, tip.z + o.z); const w = 0.85 + rnd() * 0.3; parts.push(paint(s, () => [w, w, w])); }   // 小さなポリプの束（陰影は丸く、面は少ないまま）
        return;
      }
      for (let k = 0; k < (lvl ? 2 : 3); k++) { const ax = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize(), d2 = dir.clone().applyAxisAngle(ax, 0.45 + rnd() * 0.4).lerp(UPv, 0.15).normalize(); branch(tip, d2, len * (0.6 + rnd() * 0.2), rad * 0.65, lvl + 1); }
    };
    branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.18, 0.05, 0);
    return merge(parts);
  })(),
  // ムチヤギの仲間: 岩から伸びる、細く長いむちのような枝（1〜数本）。ゆるく曲がり、流れに揺れる（赤・橙・黄・緑がかった色）
  whip: (() => {
    const parts = [];
    [[0, 0, 1.0, 0.25, 0], [0.05, 0.03, 0.8, -0.3, 1.6], [-0.04, 0.05, 0.65, 0.4, 3.4]].forEach(([x, z, L, bend, a]) => {
      const g = new THREE.CylinderGeometry(0.006, 0.014, L, 5, 12, true).translate(0, L / 2, 0), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), t = y / L; p.setX(i, p.getX(i) + bend * L * t * t * 0.5); }
      g.computeVertexNormals(); g.rotateY(a).translate(x, 0, z);
      parts.push(paint(g, (px, y) => { const k = 0.8 + 0.25 * Math.min(1, y / 0.8); return [k, k, k]; }));
    });
    return merge(parts);
  })(),
  // サンゴのかけら: 波で折れた枝サンゴのかけらと、小さな板のかけらが、礁のまわりの砂の上に散らばる（白っぽく、藻が付いて少し緑がかる）
  rubble: (() => {
    const parts = [], rnd = (() => { let s = 31; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < 14; i++) {
      const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.9, x = Math.cos(a) * r, z = Math.sin(a) * r, L = 0.08 + rnd() * 0.16;
      const g = i % 3 ? new THREE.CylinderGeometry(0.012, 0.016, L, 5).rotateZ(Math.PI / 2 - 0.15 + rnd() * 0.3).rotateY(rnd() * 6.3) : new THREE.BoxGeometry(0.1 + rnd() * 0.1, 0.012, 0.07 + rnd() * 0.08).rotateY(rnd() * 6.3).rotateX(rnd() * 0.3);
      g.translate(x, 0.012, z);
      const c = rnd(), col = c < 0.6 ? [0.85, 0.83, 0.78] : c < 0.85 ? [0.62, 0.66, 0.5] : [0.8, 0.6, 0.62];
      parts.push(paint(g, () => col));
    }
    return merge(parts);
  })(),
  // 海草（リュウキュウスガモなど）: 細長い葉の束。流れに揺れる
  grass: (() => {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, len = 0.35 + 0.25 * Math.sin(i * 1.9) ** 2, b = new THREE.PlaneGeometry(0.025, len, 1, 4).translate(0, len / 2, 0);
      const p = b.attributes.position; for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, 0.12 * (y / len) ** 2); }
      b.rotateY(a).translate(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06);
      parts.push(paint(b, (x, y) => mixc([0.25, 0.42, 0.15], [0.48, 0.66, 0.25], y / 0.6)));
    }
    return merge(parts);
  })()
};
const BOTTOM = {
  anemone: { max: 420, sway: 1.6, mat: { roughness: 0.6, emissive: 0x0a1408 } },
  clam: { max: 80, sway: 0, mat: { roughness: 0.35 } },
  urchin: { max: 260, sway: 0, mat: { roughness: 0.4 } },
  cucumber: { max: 160, sway: 0, mat: { roughness: 0.8 } },
  fan: { max: 140, sway: 0.5, mat: { roughness: 0.7, side: THREE.DoubleSide } },
  leather: { max: 160, sway: 0.4, mat: { roughness: 0.8 } },
  grass: { max: 2400, sway: 2.2, mat: { roughness: 0.7, side: THREE.DoubleSide } },
  sponge: { max: 360, sway: 0, mat: { roughness: 0.85 } },
  softcoral: { max: 160, sway: 0.35, mat: { roughness: 0.6, emissive: 0x100608 } },
  whip: { max: 200, sway: 1.4, mat: { roughness: 0.6 } },
  rubble: { max: 500, sway: 0, mat: { roughness: 0.9 }, plain: true }   // plain: 図鑑に載せない（生き物ではない）
};
Object.entries(BOTTOM).forEach(([k, b]) => { b.mesh = instanced(GEO[k], swayMat(b.mat, 2, [b.sway]), b.max); b.n = 0;
  if (!['anemone', 'fan', 'leather'].includes(k)) b.mesh.castShadow = false;   // 小さなものは影を落とさない（ほとんど見えないのに、影を描く手間がかかる）
});
const ANEMONE_TINT = [[1, 1, 1], [1.35, 0.65, 0.75], [0.75, 0.9, 1.35], [0.95, 1.2, 0.9], [1.2, 1.0, 0.7]];   // イソギンチャク畑の色（紫・赤・青・緑・黄みがかった株）
const FAN_COLS = [[0.85, 0.2, 0.2], [0.95, 0.5, 0.15], [0.6, 0.25, 0.65], [0.95, 0.75, 0.2]];
const SPONGE_COLS = [[0.62, 0.3, 0.68], [0.95, 0.5, 0.18], [0.95, 0.82, 0.25], [0.42, 0.38, 0.85], [0.95, 0.5, 0.62], [0.55, 0.5, 0.45]];   // 紫・橙・黄・青紫・桃・灰褐色
const SOFT_COLS = [[1.0, 0.45, 0.6], [0.95, 0.2, 0.25], [0.75, 0.35, 0.85], [1.0, 0.6, 0.2], [1.0, 0.85, 0.35]];
const WHIP_COLS = [[0.9, 0.3, 0.2], [0.95, 0.6, 0.2], [0.95, 0.85, 0.3], [0.55, 0.7, 0.35]];

// ---------- 置き直す（潜水艇が 3m 動くたび。creatures.js の updateBed から） ----------
// 区画の角（サンゴの中心の間）に、海底の生き物を置く。礁のまだらの岩場（サンゴの多い所）と砂地で、置くものを変える
const schools = new Map();
const SPOTS = [];                                                     // 海底の生き物の場所（図鑑の出会い用）                                             // 魚の群れ（すみかの区画ごと）。範囲に入っている間は同じ群れが泳ぎ続ける
const anemones = [];
let origin = [0, 0];
const POINTS = () => ((L && L.sites) || []).filter(s => s.fish);   // ダイブポイント（creatures.js が表示するものを選び、位置 x, z (m) を入れた見どころ）
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), SC = new THREE.Vector3(), C = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
// 礁の外側の深い斜面（メソフォティック。サンゴはまばらでも魚はいる）の下限 (m)。真下の海底がこれより浅いと、サンゴ礁の生き物を置く
const DEEP_MAX = 95;
function rebuild(ox, oz, floorHere) {
  origin = [ox, oz];
  const show = floorHere < DEEP_MAX;
  Object.values(BOTTOM).forEach(b => { b.n = 0; });
  anemones.length = 0; SPOTS.length = 0;
  const seen = new Set();
  if (show) {
    const c0x = Math.round(ox / CELL), c0z = Math.round(oz / CELL), NR = Math.ceil(RANGE / CELL);
    for (let j = -NR; j <= NR; j++) for (let i = -NR; i <= NR; i++) {
      const cx = c0x + i, cz = c0z + j, wx = cx * CELL, wz = cz * CELL;
      if (Math.hypot(wx - ox, wz - oz) > RANGE) continue;
      const d = floorAt(wx, wz); if (d > DEEP_MAX || d < 0.6) continue;
      if (d > 40) {                                                    // 礁の外側の深い斜面（40〜95m）: サンゴはまばらでも、深い所にもすむ魚がいる（浅いほど多い）
        if (h(cx, cz, 304) < 0.03 * (1 - 0.75 * (d - 40) / (DEEP_MAX - 40))) {   // 浅いサンゴ礁の半分ほど。深いほど減る
          const pool = FISH.filter(f => f.deep); let r = h(cx, cz, 305) * pool.reduce((a, f) => a + f.deep, 0), f = pool[0];
          for (const q of pool) { r -= q.deep; if (r <= 0) { f = q; break; } }
          const key = 'd' + cx + ',' + cz; seen.add(key);
          if (!schools.has(key)) schools.set(key, newSchool(f, wx, wz, d, cx, cz));
        }
        continue;
      }
      const rm = T.reefMaskJS(wx, wz), onReef = Math.min(1, Math.max(0, (rm - 0.48) / 0.14));
      // 魚の群れ: サンゴのある区画をすみかにする
      const coral = T.coralCellJS(cx, cz, d, rm);
      if (coral && h(cx, cz, 300) < 0.16) {
        const pool = FISH.filter(f => f.home === 'coral' || (f.home === 'branch' && coral.kind === 'branch'));
        let tot = pool.reduce((a, f) => a + f.w, 0), r = h(cx, cz, 301) * tot, f = pool[0];
        for (const q of pool) { r -= q.w; if (r <= 0) { f = q; break; } }
        const key = cx + ',' + cz; seen.add(key);
        if (!schools.has(key)) schools.set(key, newSchool(f, coral.x, coral.z, d, cx, cz, seabedY(coral.x, coral.z) - 0.75 * coral.sy));
      }
      // ギンガメアジの群れ: 礁の外側の少し深い所（8〜30m）の中層に、まれに
      if (d > 8 && d < 30 && h(cx, cz, 303) < 0.0006) {
        const key = 'j' + cx + ',' + cz; seen.add(key);
        if (!schools.has(key)) schools.set(key, newSchool(FISH.find(q => q.kind === 'jack'), wx, wz, d, cx, cz));
      }
      // 掃除場: 大きめのサンゴのそばに、ホンソメワケベラがいる
      if (coral && coral.sy > 0.6 && h(cx, cz, 302) < 0.012) {
        const key = 's' + cx + ',' + cz; seen.add(key);
        if (!schools.has(key)) schools.set(key, Object.assign(newSchool(FISH.find(q => q.kind === 'cleaner'), coral.x, coral.z, d, cx, cz, seabedY(coral.x, coral.z) - 0.75 * coral.sy), { key }));
      }
      // 区画の角に、海底の生き物
      const ax = wx + CELL / 2, az = wz + CELL / 2, ad = floorAt(ax, az), r1 = h(cx, cz, 310), r2 = h(cx, cz, 311);
      const put = (k, s, rotY, col, slot = 0) => {                    // slot: 1 区画に 2 つ目を置くとき（場所をずらす）
        const b = BOTTOM[k]; if (b.n >= b.max) return;
        const jx = (h(cx, cz, 312 + slot * 7) - 0.5) * (slot ? 2.4 : 1.2), jz = (h(cx, cz, 313 + slot * 7) - 0.5) * (slot ? 2.4 : 1.2), x = (slot ? wx : ax) + jx, z = (slot ? wz : az) + jz;
        P.set(x - ox, -seabedY(x, z) - 0.03, z - oz); Q.setFromAxisAngle(UP, rotY); SC.setScalar(s);
        M.compose(P, Q, SC); b.mesh.setMatrixAt(b.n, M); b.mesh.setColorAt(b.n, C.setRGB(...(col || [1, 1, 1]))); b.n++;
        if (!b.plain) SPOTS.push({ k, x, z, d: seabedY(x, z) });
        if (k === 'anemone') anemones.push({ x, z, d: seabedY(x, z), key: 'a' + cx + ',' + cz });
      };
      const gd = T.gardenJS ? T.gardenJS(ax, az) : null, spr = A.spireH ? A.spireH(ax, az) : 0;
      if (spr > 2) {                                                   // 岩の塔（ピナクル）の壁: ウミウチワとソフトコーラルがびっしり
        if (r1 < 0.45) put('fan', 1.2 + r2 * 1.8, h(cx, cz, 316) * 6.3, FAN_COLS[Math.floor(h(cx, cz, 315) * FAN_COLS.length)]);
        else if (r1 < 0.7) put('leather', 0.7 + r2 * 0.9, r2 * 6.3);
      } else if (gd && gd.st === 2) {                                         // イソギンチャク畑: 1 区画に 3 つまで、大きなイソギンチャクが並ぶ（半分ほどにクマノミ）
        for (let k = 0; k < 3; k++) {
          const b = BOTTOM.anemone; if (b.n >= b.max || h(cx, cz, 370 + k) > 0.55 * gd.g) continue;
          const x = wx + (h(cx, cz, 373 + k) - 0.5) * CELL, z = wz + (h(cx, cz, 376 + k) - 0.5) * CELL, s2 = 1.1 + h(cx, cz, 379 + k) * 1.1;
          P.set(x - ox, -seabedY(x, z) - 0.03, z - oz); Q.setFromAxisAngle(UP, h(cx, cz, 382 + k) * 6.3); SC.setScalar(s2);
          M.compose(P, Q, SC); b.mesh.setMatrixAt(b.n, M); b.mesh.setColorAt(b.n, C.setRGB(...ANEMONE_TINT[Math.floor(h(cx, cz, 385 + k) * ANEMONE_TINT.length)])); b.n++;
          if (k === 0) SPOTS.push({ k: 'anemone', x, z, d: seabedY(x, z) });
          if (h(cx, cz, 388 + k) < 0.5) anemones.push({ x, z, d: seabedY(x, z), key: 'a' + cx + ',' + cz + '_' + k });
        }
      } else if (onReef > 0.3) {
        if (r1 < 0.018) put('anemone', 0.8 + r2 * 0.6, r2 * 6.3);
        else if (r1 < 0.034) put('clam', 0.35 + r2 * 0.35, r2 * 6.3, mixc([0.6, 0.85, 1.0], [0.9, 0.7, 1.0], h(cx, cz, 314)));
        else if (r1 < 0.075) put('urchin', 0.7 + r2 * 0.5, r2 * 6.3);
        else if (r1 < 0.1 && ad > 6) put('fan', 1.0 + r2 * 1.6, Math.PI / 2 + (r2 - 0.5) * 0.4, FAN_COLS[Math.floor(h(cx, cz, 315) * FAN_COLS.length)]);
        else if (r1 < 0.13) put('leather', 0.6 + r2 * 0.9, r2 * 6.3);
        // もう 1 つ: カイメン・ソフトコーラル・ムチヤギ・サンゴのかけら（礁の岩場をにぎやかに）
        const r3 = h(cx, cz, 400), r4 = h(cx, cz, 401), ci = h(cx, cz, 402);
        if (r3 < 0.12) put('sponge', 0.9 + r4 * 1.1, r4 * 6.3, SPONGE_COLS[Math.floor(ci * SPONGE_COLS.length)], 1);
        else if (r3 < 0.21) put('softcoral', 0.8 + r4 * 1.1, r4 * 6.3, SOFT_COLS[Math.floor(ci * SOFT_COLS.length)], 1);
        else if (r3 < 0.26 && ad > 4) put('whip', 0.8 + r4 * 0.8, r4 * 6.3, WHIP_COLS[Math.floor(ci * WHIP_COLS.length)], 1);
        else if (r3 < 0.36) put('rubble', 0.8 + r4 * 0.6, r4 * 6.3, null, 1);
      } else if (onReef > 0.02 && h(cx, cz, 403) < 0.35) {             // 礁のすぐ外の砂地: サンゴのかけらが散らばり、ところどころにカイメン
        const r4 = h(cx, cz, 404);
        if (h(cx, cz, 405) < 0.15) put('sponge', 0.7 + r4 * 0.8, r4 * 6.3, SPONGE_COLS[Math.floor(h(cx, cz, 406) * SPONGE_COLS.length)], 1);
        else put('rubble', 0.9 + r4 * 0.6, r4 * 6.3, null, 1);
        if (r1 < 0.03) put('cucumber', 0.8 + r2 * 0.6, r2 * 6.3);
      } else {
        if (r1 < 0.03) put('cucumber', 0.8 + r2 * 0.6, r2 * 6.3);
        else if (ad < 7 && rm < 0.42) {                               // 浅い砂地は海草の藻場（ところどころ、まとまって）
          const meadow = Math.min(1, Math.max(0, (0.42 - rm) / 0.1));
          for (let k = 0; k < 4; k++) if (h(cx, cz, 320 + k) < meadow * 0.9) {
            const b = BOTTOM.grass; if (b.n >= b.max) break;
            const x = wx + (h(cx, cz, 330 + k) - 0.5) * CELL, z = wz + (h(cx, cz, 340 + k) - 0.5) * CELL;
            P.set(x - ox, -seabedY(x, z) - 0.02, z - oz); Q.setFromAxisAngle(UP, h(cx, cz, 350 + k) * 6.3); SC.setScalar(0.8 + h(cx, cz, 360 + k) * 0.7);
            M.compose(P, Q, SC); b.mesh.setMatrixAt(b.n, M); b.mesh.setColorAt(b.n, C.setRGB(1, 1, 1)); b.n++;
            if (k === 0) SPOTS.push({ k: 'grass', x, z, d: seabedY(x, z) });
          }
        }
      }
    }
    // ダイブポイント（config の sites の fish）: 決まったポイントに、決まった魚が群れる（何度来ても、いつもいる）
    POINTS().forEach(st => {
      if (Math.hypot(st.x - ox, st.z - oz) > 260) return;
      st.fish.forEach((r, j) => {
        const f = FISH.find(q => q.kind === r.kind); if (!f) return;
        for (let k = 0; k < (r.n || 1); k++) {
          const key = 'P' + st.i + '_' + j + '_' + k; seen.add(key);
          if (schools.has(key)) continue;
          const id = j * 16 + k, a = h(st.i, id, 390) * 6.283, rr = (r.r != null ? r.r : 8) * Math.sqrt(h(st.i, id, 391));
          let x = st.x + Math.cos(a) * rr, z = st.z + Math.sin(a) * rr;
          if (r.along) {                                               // 沈船: 船体に沿って、横（side m）の暗がりに
            const sa = (h(st.i, id, 392) - 0.5) * r.along, sd = r.side || 0, c = Math.cos(st.heading), s2 = Math.sin(st.heading);
            x = st.x + c * sa + s2 * sd; z = st.z - s2 * sa + c * sd;
          }
          const d = seabedY(x, z) - (r.lift || 0);
          schools.set(key, Object.assign(newSchool(f, x, z, d, 0, 0, d), { key }));
        }
      });
    });
    // イソギンチャクには、クマノミが住む
    const clown = FISH.find(f => f.home === 'anemone');
    anemones.forEach(a => { seen.add(a.key); if (!schools.has(a.key)) schools.set(a.key, newSchool(clown, a.x, a.z, a.d, 0, 0)); });
  }
  for (const k of schools.keys()) if (!seen.has(k)) schools.delete(k);   // 範囲を出た群れは消す
  Object.values(BOTTOM).forEach(b => { b.mesh.count = b.n; b.mesh.instanceMatrix.needsUpdate = true; if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true; });
}
// 群れを作る。魚ごとに、すみかのまわりを回る半径・高さ・向き・速さを少しずつ変える
function newSchool(f, hx, hz, hd, cx, cz, top = hd) {   // top: すみかのサンゴのてっぺんの水深
  const n = f.n[0] + Math.floor(Math.random() * (f.n[1] - f.n[0] + 1)), fish = [];
  for (let i = 0; i < n; i++) {
    const r = f.R * (0.3 + 0.7 * Math.random()), a = Math.random() * 6.283, up = f.up[0] + Math.random() * (f.up[1] - f.up[0]);
    fish.push({ x: hx + Math.cos(a) * r, d: hd - up, z: hz + Math.sin(a) * r, vx: 0, vd: 0, vz: 0, r, a, up, w: (0.3 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1) * f.spd / Math.max(0.3, r),
      s: f.len * (0.8 + Math.random() * 0.4), ph: Math.random() * 100, hx: 1, hz: 0, hy: 0, tint: 0.85 + Math.random() * 0.3, scare: 0 });
  }
  // 群れでそろって動く魚（キンギョハナダイ・デバスズメダイ）は、回る向きをそろえる
  if (f.kind === 'anthias' || f.kind === 'chromis' || f.school) { const sgn = Math.random() < 0.5 ? -1 : 1; fish.forEach(q => { q.w = Math.abs(q.w) * sgn; }); }
  return { f, hx, hz, hd, top, fish, ax: hx, az: hz, ad: hd, cur: 0, curT: 0, curOff: 0 };   // ax, az, ad: いま回っている中心（ふだんはすみか）
}


// ---------- 大きな生き物（ときどき礁の上を通り過ぎる） ----------
// ネムリブカ・マダラトビエイ・メガネモチノウオ（ナポレオンフィッシュ）。1 種類 1 匹まで、潜水艇から 40m ほど離れた所に現れ、
// 潜水艇の近く（5〜10m）を通り過ぎて、遠くへ去る。しばらくすると、また現れる
// マダラトビエイの形: 菱形の大きな胸びれ（羽）、アヒルのくちばしのように突き出た頭、細く長い尾。背は濃い紺に白い水玉、腹は白い
const rayGeo = (() => {
  const parts = rayBody({
    half: u => 1.05 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.8) * (1 - 0.35 * u), sweep: 0.18, thick: 0.08,
    top: (u, av, x, z) => { const sx = x * 26 + Math.sin(z * 9) * 0.6, sz = z * 26, d = Math.hypot(sx - Math.round(sx), sz - Math.round(sz) - 0.5 * (Math.round(sx) % 2)); return d < 0.22 && av < 0.92 ? [0.92, 0.93, 0.95] : [0.07, 0.09, 0.15]; },
    bottom: (u, av) => av > 0.9 ? [0.1, 0.12, 0.16] : [0.94, 0.94, 0.93]
  });
  parts.push(paint(new THREE.SphereGeometry(0.11, 12, 8).scale(1.6, 0.55, 0.9).translate(0.6, -0.005, 0), (x, y) => y > -0.01 ? [0.08, 0.1, 0.16] : [0.85, 0.85, 0.84]));   // くちばしのような頭
  [-1, 1].forEach(sd => parts.push(paint(new THREE.SphereGeometry(0.018, 6, 4).translate(0.52, 0.035, sd * 0.07), () => [0.02, 0.02, 0.02])));   // 目
  parts.push(paint(new THREE.CylinderGeometry(0.003, 0.014, 1.8, 5).rotateZ(Math.PI / 2).translate(-1.4, 0.01, 0), () => [0.08, 0.08, 0.1]));
  return merge(parts);
})();
const BIG = [
  { kind: 'whitetip', name: 'ネムリブカ', sci: 'Triaenodon obesus', len: 1.5, spd: 0.7, up: 1.0, every: [60, 120], build: 'reefWhitetip', size: 1.5,
    note: '昼は岩陰や洞窟の砂の上でじっと休み、夜になると礁を泳ぎ回って、岩の割れ目の魚を狩る。背びれと尾の先が白い。おとなしく、人を襲うことはほとんどない。',
    sway: [3, [2.5, 0.08]],                                            // ゆっくり泳ぐ（速さ・振れ幅）
    geo: { hgt: 0.17, wid: 0.15, mx: 0.42, snout: 1.6, top: 0.12, ped: 0.18, bigPecs: 0.24, tail: { len: 0.3, fork: 0.55, upper: 0.5 }, dorsal: [0.52, 0.66, 0.8, 1.5], dorsal2: [0.2, 0.26, 0.4, 1.3], anal: [0.18, 0.26, 0.45], eye: [0.15, 0.17, 0.15],
      pat: (u, v) => (u > 0.7 && u < 0.79 && Math.abs(v) < 0.45 && Math.sin(u * 300) > 0.8) ? [0.3, 0.32, 0.34] : mixc([0.92, 0.92, 0.9], [0.42, 0.45, 0.48], (v + 0.35) / 0.5),   // えらあな 5 本
      fin: (p, s) => (p === 'dorsal' || p === 'tail') && s > 0.75 ? [0.95, 0.96, 0.96] : [0.38, 0.4, 0.43] } },
  { kind: 'eagleray', name: 'マダラトビエイ', sci: 'Aetobatus narinari', len: 1.0, spd: 0.9, up: 3.0, every: [70, 140], ray: true, build: 'eagleRay', size: 2.1,
    note: '翼を広げると 2m を超える大きなエイ。鳥のように羽ばたいて泳ぎ、砂の中の貝を硬い歯で割って食べる。背中の白い水玉模様が目印。' },
  { kind: 'napoleon', name: 'メガネモチノウオ（ナポレオンフィッシュ）', sci: 'Cheilinus undulatus', len: 1.3, spd: 0.4, up: 1.5, every: [80, 150], curious: true, build: 'napoleon', size: 1.3,
    note: '体長 2m にもなる大きなベラ。おでこがこぶのように盛り上がり、目の後ろに 2 本の黒い線がある。好奇心が強く、ダイバーに近づいてくることもある。数が減り、守られている。',
    sway: [3, [1.6, 0.06]],
    geo: { hgt: 0.38, wid: 0.2, mx: 0.5, snout: 0.7, top: 0.4, tail: { len: 0.22, fork: 0.0, round: 0.5 }, dorsal: [0.15, 0.7, 0.14], anal: [0.15, 0.4, 0.16], eye: [0.85, 0.7, 0.3],
      pat: (u, v) => {
        if (u > 0.78 && u < 0.92 && (Math.abs(v - 0.3 - (u - 0.85) * 3) < 0.04 || Math.abs(v + 0.05 - (u - 0.85) * 3) < 0.04)) return [0.1, 0.12, 0.1];   // 目の後ろの 2 本の線
        if (u > 0.75) return mixc([0.3, 0.6, 0.55], [0.85, 0.65, 0.45], (Math.sin(u * 90 + v * 20) > 0.5) ? 0.6 : 0);   // 顔の細かい模様
        const sc2 = Math.sin(u * 60) * Math.sin(v * 12) > 0.4 ? 0.85 : 1;
        return mixc([0.18, 0.45, 0.42], [0.3, 0.62, 0.5], (v + 1) / 2).map(c => c * sc2);
      },
      fin: (p, s) => mixc([0.2, 0.45, 0.45], [0.55, 0.75, 0.6], s) } }
];
// 細かく作った体（engine/species2.js）: +z が前。あれば、簡単な形の代わりに使う。シーンに入れておき（見えなくして）、潜航の始めに材質を準備させる
const SP = window.SPECIES || {}, ROT_Z2X = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);   // +z 前 → +x 前（このファイルの魚の向き）
function makeBody(name, size) { const b = SP[name](size); withCaustics(b.group); b.group.visible = false; scene.add(b.group); return b; }
BIG.forEach(b => {
  b.next = 15 + Math.random() * 40; b.on = null;
  if (b.build && SP[b.build]) { b.body = makeBody(b.build, b.size); b.mesh = b.body.group; return; }
  const geo = b.ray ? rayGeo : fishGeo(b.geo, 0);
  const sw = b.ray ? [4, [1.8, 0.32, 1.2]] : b.sway;                   // エイは羽ばたく（羽の先ほど大きく上下に。前から後ろへ波が伝わる）
  b.mesh = instanced(geo, swayMat({ roughness: 0.45 }, sw[0], sw[1]), 1);
  b.next = 15 + Math.random() * 40; b.on = null;
});
let bigT = 0;
function bigFrame(dt, t, px, pz, depth, subD) {
  bigT += dt;
  for (const b of BIG) {
    const m = b.mesh;
    if (!b.on) {
      m.visible = false;
      if (bigT < b.next || !(depth > 0.5) || A.above) continue;
      // 40m ほど離れた所から、潜水艇の 5〜10m 横を通る道すじ
      const a = Math.random() * 6.283, sx = px + Math.cos(a) * 42, sz = pz + Math.sin(a) * 42, side = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 5);
      const dx = px - sx, dz = pz - sz, dl = Math.hypot(dx, dz), wx = px - dz / dl * side, wz = pz + dx / dl * side;
      const fd = floorAt(sx, sz); if (fd > 40 || fd < 4) { b.next = bigT + 5; continue; }
      b.on = { x: sx, z: sz, d: seabedY(sx, sz) - b.up, wx, wz, ex: wx + (wx - sx) * 1.5, ez: wz + (wz - sz) * 1.5, leg: 0, hx: dx / dl, hz: dz / dl, vy: 0 };
      continue;
    }
    const o = b.on, tx = o.leg ? o.ex : o.wx, tz = o.leg ? o.ez : o.wz;
    let dx = tx - o.x, dz = tz - o.z, dl = Math.hypot(dx, dz) || 1;
    if (!o.leg && dl < 3) o.leg = 1;
    // ナポレオンフィッシュは、潜水艇の近くでしばらく止まって、こちらを見る
    let sp = b.spd;
    const ex = px - o.x, ez = pz - o.z, e = Math.hypot(ex, ez, subD - o.d);
    if (b.curious && e < 6 && !o.looked) { o.look = (o.look || 0) + dt; sp *= 0.2; dx = ex; dz = ez; dl = Math.hypot(dx, dz) || 1; if (o.look > 8) o.looked = true; }
    if (!b.curious && e < 3) { dx = -ex; dz = -ez; dl = Math.hypot(dx, dz) || 1; }   // 近すぎると離れる
    const kk = Math.min(1, dt * 0.6);
    o.hx += (dx / dl - o.hx) * kk; o.hz += (dz / dl - o.hz) * kk; const hl = Math.hypot(o.hx, o.hz) || 1;
    o.x += o.hx / hl * sp * dt; o.z += o.hz / hl * sp * dt;
    const td = Math.max(1, seabedY(o.x, o.z) - b.up); o.d += (td - o.d) * Math.min(1, dt * 0.5);
    if (Math.hypot(o.x - px, o.z - pz) > 80 || (o.leg && Math.hypot(o.ex - o.x, o.ez - o.z) < 3)) { b.on = null; b.next = bigT + b.every[0] + Math.random() * (b.every[1] - b.every[0]); m.visible = false; continue; }
    P.set(o.x - px, depth - o.d, o.z - pz);
    if (b.body) {                                                      // 細かく作った体: 向きを変えて、泳ぐ動きを進める
      const g = b.body.group; g.position.copy(P); g.rotation.set(0, Math.atan2(o.hx, o.hz), b.ray ? Math.sin(t * 0.5) * 0.12 : 0, 'YXZ'); g.visible = true;
      b.body.animate(t, sp / b.spd);
      continue;
    }
    headQ(Q, o.hx / hl, 0, o.hz / hl);
    if (b.ray) Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(t * 0.5) * 0.12));   // ゆっくり傾く
    SC.setScalar(b.len); M.compose(P, Q, SC);
    m.setMatrixAt(0, M); m.setColorAt(0, C.setScalar(1)); m.count = 1; m.visible = true; m.instanceMatrix.needsUpdate = true;
  }
}

// ---------- 毎フレーム ----------
const PH = { value: 0 };
// 寄ってくる魚: 潜水艇がゆっくり動いているか止まっているとき、近くの好奇心の強い群れが、目の前 2〜3m まで来てしばらく泳ぐ
let lastSub = null, subSpeed = 0, nextCurious = 0, nextVisit = 0;
// 魚の向き: 進む向き (hx, hy, hz) に頭（+x）を向ける。左右の向き → 上下の傾きの順に回し、背はいつも上に
// （最短の回転で向けると、向きによっては背と腹がひっくり返り、泳ぎながらくるっと回って見えるため）
const HEAD_E = new THREE.Euler();
const headQ = (q, hx, hy, hz) => q.setFromEuler(HEAD_E.set(0, Math.atan2(-hz, hx), Math.atan2(hy, Math.hypot(hx, hz)), 'YZX'));
function frame(dt, t, px, pz, depth, show) {
  TIME.value = t;
  if (lastSub && dt > 0) { const v = Math.hypot(px - lastSub[0], pz - lastSub[1], depth - lastSub[2]) / dt; if (v < 500) subSpeed += (v - subSpeed) * Math.min(1, dt * 3); }
  lastSub = [px, pz, depth];
  const vis = show;
  Object.values(BOTTOM).forEach(b => { b.mesh.visible = vis && b.n > 0; b.mesh.position.set(origin[0] - px, depth, origin[1] - pz); });
  FISH.forEach(f => { f.cnt = 0; f.ncnt = 0; });
  if (!vis) { FISH.forEach(f => { f.mesh.visible = f.near.visible = false; if (f.bodies) f.bodies.forEach(b => { b.group.visible = false; }); }); return; }
  dt = Math.min(dt, 0.1);
  const subD = Math.max(0, depth);                                     // 潜水艇の深さ（海面の上なら 0）
  // 寄ってくる群れを選ぶ（同時に 2 つまで）
  const S = window.__DIVE, under = depth > 0.5 && !(L.reefApi.above);
  let nCur = 0; schools.forEach(sc => { if (sc.cur > t) nCur++; });
  if (under && subSpeed < 0.8 && nCur < 2 && t > nextCurious) {
    let best = null;
    schools.forEach(sc => { if (!sc.f.curious || sc.cur > t) return; const d = Math.hypot(sc.hx - px, sc.hz - pz); if (d < 18 && Math.random() < sc.f.curious && (!best || d < best[1])) best = [sc, d]; });
    if (best) { best[0].cur = t + 14 + Math.random() * 16; best[0].curOff = (Math.random() - 0.5) * 1.6; }
    nextCurious = t + 3 + Math.random() * 5;
  }
  const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);                    // 潜水艇の前（水平）
  // 掃除場へ通う魚: ときどき、近くの大きめの魚が 1 匹、掃除場へ行って、体をきれいにしてもらう（じっと浮かんで、ひれを広げる）
  if (t > nextVisit) {
    nextVisit = t + 2 + Math.random() * 3;
    schools.forEach(st => {
      if (st.f.kind !== 'cleaner' || (st.client && st.client.visit)) return;
      let pick = null;
      schools.forEach(sc => { if (sc.f.len < 0.15 || sc.f.kind === 'cleaner' || Math.hypot(sc.hx - st.hx, sc.hz - st.hz) > 10) return; const q = sc.fish[Math.floor(Math.random() * sc.fish.length)]; if (q && !q.visit && q.scare < 0.1 && Math.random() < 0.5) pick = q; });
      if (pick) { pick.visit = { st, until: t + 30 + Math.random() * 10, done: 0 }; st.client = pick; }
    });
  }
  schools.forEach(sc => {
    const f = sc.f;
    // 回る中心: ふだんはすみか。寄ってくるときは、潜水艇の目の前（2〜3m 先、少し横）。速く動き出したら帰る
    if (sc.cur > t && subSpeed > 1.5) sc.cur = 0;
    const curious = sc.cur > t, dist = 2.2 + Math.abs(sc.curOff);
    const gx = curious ? px + fx * dist - fz * sc.curOff : sc.hx, gz = curious ? pz + fz * dist + fx * sc.curOff : sc.hz;
    const gd = curious ? Math.min(seabedY(gx, gz) - 0.4, Math.max(0.6, subD + 0.2)) : sc.hd;
    const kk0 = Math.min(1, dt * (curious ? 0.5 : 0.25));
    sc.ax += (gx - sc.ax) * kk0; sc.az += (gz - sc.az) * kk0; sc.ad += (gd - sc.ad) * kk0;
    for (const q of sc.fish) {
      if (f.cnt >= f.max) break;
      let tx, tz, td;
      if (f.mill || f.len >= 0.4) {
        // 渦を巻く群れ（ギンガメアジ・バラクーダ・ハタンポ）と大きな魚: すみかのまわりを大きく回る。ゆっくり揺らぐ
        q.a += q.w * dt;
        const wob = Math.sin(t * 0.4 + q.ph) * 0.3;
        const rr = curious ? Math.min(q.r, 0.9) : q.r, uu = curious ? 0 : q.up;
        tx = sc.ax + Math.cos(q.a) * rr * (1 + wob * 0.3); tz = sc.az + Math.sin(q.a) * rr * (1 + wob * 0.3); td = sc.ad - uu - 0.2 * Math.sin(t * 0.6 + q.ph);
      } else {
        // 小さな礁の魚: 円を描いて回り続けず、すみかの範囲の中をぶらぶら泳ぐ。次に向かう所は、いま向いている方の少し左右（すみかの端まで来たら、内側へ引き返す）
        const kc = curious ? Math.min(1, 0.9 / Math.max(0.01, q.r)) : 1;   // 寄ってくるときは、目の前の小さな範囲に
        if (q.wx == null || t > q.wt) {
          const ox = (q.x - sc.ax) / kc, oz = (q.z - sc.az) / kc, s = Math.min(q.r, 0.4 + f.len * 6) * (0.5 + 0.5 * Math.random());
          const a = Math.atan2(q.hz, q.hx) + (Math.random() - 0.5) * 2;
          let nx = ox + Math.cos(a) * s, nz = oz + Math.sin(a) * s;
          if (Math.hypot(nx, nz) > q.r) { const b = Math.random() * 6.283, c = q.r * 0.6 * Math.sqrt(Math.random()); nx = Math.cos(b) * c; nz = Math.sin(b) * c; }
          q.wx = nx; q.wz = nz; q.wu = Math.max(0, q.up + (Math.random() - 0.5) * Math.min(0.6, q.r * 0.4));
          q.wt = t + (1.5 + Math.random() * 4) * Math.max(1, Math.min(3, 0.8 / q.r));   // すみかが狭い魚（クマノミなど）ほど、着いた所でしばらくとどまる
        }
        tx = sc.ax + q.wx * kc; tz = sc.az + q.wz * kc; td = sc.ad - (curious ? 0 : q.wu) - 0.08 * Math.sin(t * 0.6 + q.ph);
      }
      let slow = 1, pose = null;
      // つがいで泳ぐ（トゲチョウチョウウオ）: 2 匹目は、1 匹目のすぐ横を同じ向きで
      if (f.pair && sc.fish[0] !== q) { const L0 = sc.fish[0]; tx = L0.x - L0.hx * 0.12 - L0.hz * 0.18; tz = L0.z - L0.hz * 0.12 + L0.hx * 0.18; td = L0.d + 0.05; }
      // ブダイ: ときどきサンゴにとまって、くちばしでかじる（頭を下げて、小刻みに）
      if (f.kind === 'parrot') {
        if (!q.bite && Math.random() < dt * 0.06) { const a = Math.random() * 6.283; q.bite = { t: t + 5 + Math.random() * 4, x: sc.hx + Math.cos(a) * 0.4, z: sc.hz + Math.sin(a) * 0.4, n: 0 }; }
        if (q.bite) {
          if (t > q.bite.t) q.bite = null;
          else { tx = q.bite.x; tz = q.bite.z; td = sc.top + 0.05;
            if (Math.hypot(q.x - tx, q.z - tz) < 0.35) { slow = 0.15; pose = -0.55; if (t > q.bite.n) { q.bite.n = t + 0.5 + Math.random() * 0.6; q.nod = 0.25; if (Math.hypot(q.x - px, q.d - subD, q.z - pz) < 12) window.__AUDIO?.crunch?.(Math.hypot(q.x - px, q.z - pz)); } } }
        }
      }
      // 掃除場へ通う魚
      if (q.visit) {
        const st = q.visit.st;
        if (t > q.visit.until || q.scare > 0.5 || !schools.has(st.key)) { q.visit = null; if (st.client === q) st.client = null; }
        else { tx = st.hx; tz = st.hz; td = st.top - 0.35;
          if (Math.hypot(q.x - tx, q.z - tz, q.d - td) < 0.5) { slow = 0.05; pose = 0.45; q.cleaning = true; if (!q.visit.done) q.visit.done = 1, q.visit.until = Math.min(q.visit.until, t + 8 + Math.random() * 6); } }   // 着いたら 8〜14 秒、掃除してもらう
      } else q.cleaning = false;
      // ホンソメワケベラ: 客の体のまわりを、すばやく行き来する。客がいないときは、掃除場で上下に踊って、客を呼ぶ
      if (f.kind === 'cleaner') {
        const c = sc.client;
        if (c && c.cleaning) { const a = q.ph + 2.2 * Math.sin(t * 0.8 + q.ph);   // 客の体に沿って、行ったり来たり（ぐるぐる回らない）
          tx = c.x + Math.cos(a) * c.s * 0.35; tz = c.z + Math.sin(a) * c.s * 0.35; td = c.d + Math.sin(a * 1.7) * c.s * 0.2; slow = 1.6; }
        else { tx = sc.hx + q.wx; tz = sc.hz + q.wz; td = sc.top - 0.25 - 0.12 * Math.sin(t * 3 + q.ph); }
      }
      // 潜水艇が近いと逃げる（デバスズメダイは枝サンゴの中へ、ナンヨウハギはサンゴのすき間へ隠れる）。止まっていれば 1m 近くまで平気で、速く動くほど遠くから逃げる
      const ex = q.x - px, ed = q.d - subD, ez = q.z - pz, e = Math.hypot(ex, ed, ez), near = depth > -1 && e < 0.9 + Math.min(3, subSpeed * 1.2);
      q.scare = Math.max(0, q.scare - dt * 0.5); if (near) q.scare = 1;
      if (q.scare > 0) {
        if (f.hide) { tx = sc.hx; tz = sc.hz; td = Math.max(sc.top + 0.1, sc.hd - 0.6); }
        else if (e > 0.01) { tx = q.x + ex / e * 4; tz = q.z + ez / e * 4; td = q.d + ed / e * 1.5; }
      }
      const sp = f.spd * (1 + q.scare * 2.5) * (q.scare > 0 ? 1 : slow), dx = tx - q.x, dd = td - q.d, dz = tz - q.z, dl = Math.hypot(dx, dd, dz) || 1;
      const k = Math.min(1, dt * 2.5);
      q.vx += (dx / dl * Math.min(sp, dl * 1.5) - q.vx) * k; q.vd += (dd / dl * Math.min(sp, dl * 1.5) * 0.6 - q.vd) * k; q.vz += (dz / dl * Math.min(sp, dl * 1.5) - q.vz) * k;
      q.x += q.vx * dt; q.d += q.vd * dt; q.z += q.vz * dt;
      const fl = seabedY(q.x, q.z); q.d = Math.min(q.d, fl - 0.08); q.d = Math.max(q.d, 0.3);   // 海底にも海面にも出ない
      // 向き: 進む向きへ、なめらかに
      const vl = Math.hypot(q.vx, q.vz);
      const kk = Math.min(1, dt * 4);
      // 止まりかけの小さな動きでは向きを変えない（目標の近くで向きが細かく揺れないように）
      if (vl > Math.max(0.01, f.spd * 0.25) && (pose === null || vl > 0.08)) { q.hx += (q.vx / vl - q.hx) * kk; q.hz += (q.vz / vl - q.hz) * kk; }
      const wantHy = pose !== null ? pose - (q.nod > 0 ? 0.35 : 0) : Math.max(-0.5, Math.min(0.5, -q.vd / Math.max(vl, 0.05)));
      q.hy += (wantHy - q.hy) * kk; if (q.nod > 0) q.nod -= dt;
      const hl = Math.hypot(q.hx, q.hz) || 1;
      P.set(q.x - px, depth - q.d, q.z - pz);
      headQ(Q, q.hx / hl, q.hy * 0.5, q.hz / hl);
      SC.setScalar(q.s); M.compose(P, Q, SC);
      C.setScalar(q.tint);
      if (f.bodies) { mantaBody(f, f.cnt++, q, t); continue; }
      if (e < FISH_NEAR && f.ncnt < f.near.instanceMatrix.count) { f.near.setMatrixAt(f.ncnt, M); f.near.setColorAt(f.ncnt, C); f.ncnt++; }
      else { f.mesh.setMatrixAt(f.cnt, M); f.mesh.setColorAt(f.cnt, C); f.cnt++; }
    }
  });
  bigFrame(dt, t, px, pz, depth, subD);
  checkMeet(dt, px, pz, depth);
  FISH.forEach(f => {
    if (f.bodies) { f.bodies.forEach((b, i) => { b.group.visible = i < f.cnt; }); f.mesh.visible = f.near.visible = false; return; }
    [[f.mesh, f.cnt], [f.near, f.ncnt]].forEach(([m, n]) => { m.count = n; m.visible = n > 0; if (n) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } });
  });
}
// マンタの体: 足りなければ作る（最初の 1 匹は、材質の準備のために始めから作っておく）。翼の幅は体長の約 2.3 倍
function mantaBody(f, i, q, t) {
  const b = f.bodies[i] || (f.bodies[i] = makeBody('reefManta', 1)), g = b.group;
  g.position.copy(P); g.quaternion.copy(Q).multiply(ROT_Z2X); g.scale.setScalar(q.s * 2.3); g.visible = true;
  b.animate(t + q.ph, 1);
}
FISH.forEach(f => { if (f.bodies) mantaBody(f, 0, { s: 1, ph: 0 }, 0); });
FISH.forEach(f => { if (f.bodies) f.bodies[0].group.visible = false; });
function hide() { Object.values(BOTTOM).forEach(b => { b.mesh.visible = false; }); FISH.forEach(f => { f.mesh.visible = f.near.visible = false; if (f.bodies) f.bodies.forEach(b => { b.group.visible = false; }); }); BIG.forEach(b => { b.mesh.visible = false; b.on = null; }); }

// ---------- 図鑑 ----------
// サンゴ礁の生き物も、出会うと図鑑に登録される（潜って、4m 以内で正面に見たとき）。図鑑の絵は、その場で形を作って撮る
const thumbMesh = (geo, col, rotY = 1.07, rotX = 0) => () => {        // rotX: 平たい生き物（エイ）は、背が見えるように傾ける
  const g = new THREE.Group(), m = new THREE.Mesh(geo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide, color: col || 0xffffff }));
  m.rotation.y = rotY; g.add(m);
  if (rotX) g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0.35, 0.55).normalize().lerp(new THREE.Vector3(0, 1, 0), 1 - rotX).normalize());   // 背を図鑑のカメラの方へ向ける（rotX: 0〜1）
  return { group: g, animate() {} };
};
const D = (kind, name, sci, from, to, where, note, make) => ({ kind: 'reef_' + kind, name, sci, from, to, where, note, make, reef: true });
const thumbBody = (name, size, ray) => () => {                         // 細かく作った体（species2.js）の図鑑の絵
  const body = SP[name](size), g = new THREE.Group(); g.add(body.group);
  if (ray) g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0.35, 0.55).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize());
  return { group: g, animate: (t, s) => body.animate(t, s) };
};
const FISH_INFO = {
  chromis: ['Chromis viridis', 'デバスズメダイ', '枝サンゴの上に群れる、青緑色の小さな魚。危ないと感じると、群れごと枝のすき間へ逃げ込む。'],
  anthias: ['Pseudanthias squamipinnis', 'キンギョハナダイ', '礁の斜面に何百匹も群れて、流れてくるプランクトンを食べる。群れの多くは雌で、1 匹の雄が死ぬと雌の 1 匹が雄に変わる。'],
  hepatus: ['Paracanthurus hepatus', 'ナンヨウハギ', '鮮やかな青に黒いパレット模様、黄色い尾。尾の付け根に、刃物のような鋭いとげを隠し持つ。'],
  flavescens: ['Zebrasoma flavescens', 'キイロハギ', '全身が明るい黄色。サンゴや岩に生える藻を、細長い口で食べる。夜は色がくすみ、白い帯が出る。'],
  auriga: ['Chaetodon auriga', 'トゲチョウチョウウオ', '背びれの後ろから糸のように伸びるとげが目印。目を隠す黒い帯と、背びれの黒い斑点で、敵の目をあざむく。'],
  zanclus: ['Zanclus cornutus', 'ツノダシ', '長く伸びた背びれの糸と、突き出た口。海綿を好んで食べる。1 属 1 種の、ほかに仲間のいない魚。'],
  parrot: ['Scaridae（ブダイ科）', 'ブダイの仲間', 'くちばしのような歯で、サンゴや岩の表面の藻をかじり取る。かじった石灰は細かい砂になって出され、白いサンゴ砂のもとになる。'],
  cleaner: ['Labroides dimidiatus', 'ホンソメワケベラ', '「掃除屋」の魚。決まった掃除場で上下に踊って客を呼び、来た魚の体や口の中の寄生虫を食べる。大きな魚も、掃除の間はじっとしている。'],
  kasmira: ['Lutjanus kasmira', 'ヨスジフエダイ', '黄色い体に 4 本の青い線。昼は根のまわりに大きな群れで浮かび、夜になると散らばって、エビやカニを探す。'],
  picasso: ['Rhinecanthus aculeatus', 'ムラサメモンガラ', '絵の具で描いたような模様のモンガラカワハギ。砂地と岩場の境に巣穴を持ち、近づく相手には向かってくることもある。'],
  jack: ['Caranx sexfasciatus', 'ギンガメアジ', '銀色の体のアジの仲間。昼は何百匹もの群れになり、渦を巻くように回りながら礁の外側の中層を泳ぐ。夜になると散らばって、小魚を狩る。'],
  barracuda: ['Sphyraena qenie', 'ブラックフィンバラクーダ', '銀色の細長い体に、くの字の黒っぽい縞と黒い尾びれ。昼は何百匹もの群れになり、柱のように渦を巻いて、潮の当たる根のまわりに浮かぶ。'],
  dogtooth: ['Gymnosarda unicolor', 'イソマグロ', '体長 2m にもなるマグロの仲間。外洋に面した根や切り立った壁のまわりを、数匹で回りながら小魚を狩る。口には犬のような鋭い歯が並ぶ。'],
  pompano: ['Trachinotus blochii', 'マルコバンアジ', '銀色の平たい体のアジの仲間。浅い礁や砂地の上を、小さな群れで泳ぐ。'],
  sweeper: ['Pempheris spp.', 'ドウクツハタンポの仲間', '洞窟や沈船の暗がりに何百匹も群れる、赤銅色の小さな魚。昼は暗がりに集まってじっとしていて、夜になると外へ出てプランクトンを食べる。'],
  blacktip: ['Carcharhinus melanopterus', 'ツマグロ', 'ひれの先が黒い、体長 1.5m ほどのサメ。浅い礁やラグーンを泳ぎ回って小魚を狩る。おくびょうで、人を襲うことはまれ。'],
  manta: ['Mobula alfredi', 'ナンヨウマンタ', '翼を広げると 3〜5m になる大きなエイ。プランクトンをこして食べる。掃除場に通い、ホンソメワケベラに体をきれいにしてもらう。'],
  clown: ['Amphiprion clarkii', 'クマノミ', 'イソギンチャクの触手の間にすむ。体の粘液のおかげで、触手の毒針に刺されない。グアムのイソギンチャクで見られるのは、主にこの種。']
};
const REEF_SPECIES = [];
FISH.forEach(f => {
  const [sci, name, note] = FISH_INFO[f.kind];
  f.def = D(f.kind, name, sci, 1, f.deep ? DEEP_MAX : 40, f.where ? f.where : f.deep ? 'サンゴ礁と、礁の外側の深い斜面（水深 90m ほどまで）' : f.home === 'anemone' ? '浅いサンゴ礁の、イソギンチャクのまわり' : f.home === 'station' ? '浅いサンゴ礁の、大きなサンゴのそば（掃除場）' : f.home === 'open' ? '礁の外側（水深 8〜30m）の中層' : '浅いサンゴ礁（水深 40m より浅い所）', note, f.bodies ? thumbBody('reefManta', 4, true) : thumbMesh(() => f.ray ? mantaGeo() : fishGeo(f.geo, 0), 0xffffff, f.ray ? 0.4 : 1.07, f.ray ? 1 : 0));
  REEF_SPECIES.push(f.def);
});
const BOTTOM_INFO = {
  anemone: ['センジュイソギンチャク', 'Heteractis magnifica', '浅い礁の岩場', '直径 1m にもなる大きなイソギンチャク。触手の中の褐虫藻が光合成をする。クマノミのすみか。'],
  clam: ['ヒメシャコガイ', 'Tridacna maxima', '浅い礁の岩場', '殻の間から開いた外套膜は、青・緑・紫の模様。体の中の褐虫藻に日の光を当てて、養分をもらって育つ。'],
  urchin: ['ガンガゼの仲間', 'Diadema spp.', '浅い礁の岩場', '黒く長いとげのウニ。とげは折れやすく、刺さると抜けにくい。夜に出歩いて藻を食べる。'],
  cucumber: ['クロナマコ', 'Holothuria atra', '浅い砂地', '砂を飲み込んで、中の有機物を食べ、きれいになった砂を出す。礁の砂の掃除屋。'],
  fan: ['ウミウチワの仲間', 'Annella spp.（ヤギ目）', '礁の斜面（水深 6m より深い所）', '平たい扇の形に枝を広げる。流れに直角に立って、流れてくるプランクトンを小さなポリプでとらえる。'],
  leather: ['ウミキノコの仲間', 'Sarcophyton spp.', '浅い礁の岩場', '骨格を持たない、やわらかいサンゴ（ソフトコーラル）。きのこのような笠に、細かなポリプが開く。'],
  grass: ['ウミショウブ', 'Enhalus acoroides', '浅い砂地（礁湖の藻場）', '海の中で花を咲かせる海草。グアムのココス島の礁湖などに藻場をつくり、ウミガメのえさ場になる。'],
  sponge: ['カイメンの仲間', 'Porifera（海綿動物）', '浅い礁の岩場', '体じゅうの小さな穴から海水を吸い込み、中の小さな粒をこしとって、筒の口から吐き出す。いちばん古いタイプの動物のひとつ。'],
  softcoral: ['トゲトサカの仲間', 'Dendronephthya spp.', '礁の岩場（潮の流れる所）', '骨格を持たないソフトコーラル。半透明の幹と枝の先に、色鮮やかなポリプが集まる。流れがあると体をふくらませてプランクトンを捕る。'],
  whip: ['ムチヤギの仲間', 'Ellisellidae（ムチヤギ科）', '礁の斜面（水深 4m より深い所）', '細く長いむちのような群体。流れに向かって揺れながら、ポリプでプランクトンを捕る。'],
  rubble: ['', '', '', '']
};
Object.entries(BOTTOM_INFO).forEach(([k, [name, sci, where, note]]) => {
  const b = BOTTOM[k]; if (b.plain) return;
  b.def = D(k, name, sci, 1, 40, where, note, thumbMesh(() => GEO[k].clone(), { fan: 0xd93a33, sponge: 0x9e4cae, softcoral: 0xff7399, whip: 0xe6733a }[k] || 0xffffff, 0));
  REEF_SPECIES.push(b.def);
});
BIG.forEach(b => {
  b.def = D(b.kind, b.name, b.sci, 1, 40, '浅いサンゴ礁（ときどき通り過ぎる）', b.note, b.body ? thumbBody(b.build, b.size, b.ray) : thumbMesh(() => b.ray ? rayGeo.clone() : fishGeo(b.geo, 0), 0xffffff, b.ray ? 0.4 : 1.07, b.ray ? 1 : 0));
  b.def.rare = true; REEF_SPECIES.push(b.def);
});
const CG = A.coralGeos, CC = A.CORAL_COLS;
const CORAL_INFO = {
  massive: ['ハマサンゴの仲間', 'Porites spp.', 'でこぼこした大きなかたまりになるサンゴ。1 年に 1cm ほどずつ育ち、何百年も生きて、家ほどの大きさになるものもある。', CC[3]],
  brain: ['ノウサンゴの仲間', 'Platygyra spp.', '脳のように曲がりくねった溝のある、丸いサンゴ。溝の 1 本 1 本に、口がいくつも並んでいる。夜には触手を伸ばしてプランクトンを食べる。', CC[4]],
  table: ['テーブル状のミドリイシ', 'Acropora spp.', '足の上に、平たい板を広げるサンゴ。日の光を広く受けるため。成長が速く、白化や台風の波にも弱い。', CC[4]],
  branch: ['枝状のミドリイシ', 'Acropora spp.', '細い枝を茂らせるサンゴ。枝のすき間は、小魚のかくれ家になる。枝の先が青紫に光るものも多い。', CC[0]]
};
const CORAL_DEFS = {};
Object.entries(CORAL_INFO).forEach(([k, [name, sci, note, c]]) => {
  CORAL_DEFS[k] = D('coral_' + k, name, sci, 1, 40, '浅いサンゴ礁', note, thumbMesh(() => CG[k].clone(), new THREE.Color(...c).getHex(), 0));
  REEF_SPECIES.push(CORAL_DEFS[k]);
});
// 出会い: 潜っているとき、4m 以内（小さな生き物は近いほど）で、画面の正面近く（約 35°以内）に見えたら
const metNow = new Set(), FWD = new THREE.Vector3();
let meetT = 0;
function meetDef(def, depth) {
  if (metNow.has(def.kind)) return; metNow.add(def.kind);
  const Z = window.__ZUKAN, first = Z ? Z.meet(def, depth) : false;
  if (!first && window.__UI) window.__UI.toast(`${def.name}に出会いました`);
}
function inView(x, d, z, px, pz, depth, R) {
  const dx = x - px, dy = -(d - depth), dz = z - pz, e = Math.hypot(dx, dy, dz);
  return e < R && e > 0.05 && (dx * FWD.x + dy * FWD.y + dz * FWD.z) / e > 0.82;
}
function checkMeet(dt, px, pz, depth) {
  if ((meetT -= dt) > 0) return; meetT = 0.3;
  if (!(depth > 0.5) || A.above) return;
  T.camera.getWorldDirection(FWD);
  schools.forEach(sc => { if (metNow.has(sc.f.def.kind)) return; for (const q of sc.fish) if (inView(q.x, q.d, q.z, px, pz, depth, Math.max(2.5, sc.f.len * 25))) { meetDef(sc.f.def, depth); break; } });
  for (const b of BIG) if (b.on && !metNow.has(b.def.kind) && inView(b.on.x, b.on.d, b.on.z, px, pz, depth, 18)) meetDef(b.def, depth);
  for (const p of SPOTS) { const def = BOTTOM[p.k].def; if (!metNow.has(def.kind) && inView(p.x, p.d, p.z, px, pz, depth, 3.5)) meetDef(def, depth); }
  // サンゴ: まわりの区画を調べる
  const c0x = Math.round(px / CELL), c0z = Math.round(pz / CELL);
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    const cx = c0x + i, cz = c0z + j, c = T.coralCellJS(cx, cz, floorAt(cx * CELL, cz * CELL), T.reefMaskJS(cx * CELL, cz * CELL));
    if (c && !metNow.has(CORAL_DEFS[c.kind].kind) && inView(c.x, seabedY(c.x, c.z) - c.sy * 0.4, c.z, px, pz, depth, 4.5)) meetDef(CORAL_DEFS[c.kind], depth);
  }
}
// 撮影（creatures.js の subject から）: 画面の中央近くに大きく写っている、サンゴ礁の生き物
function subject(fwd, px, pz, depth) {
  let best = null, score = 0;
  const check = (def, x, d, z, size) => {
    const dx = x - px, dy = -(d - depth), dz = z - pz, e = Math.max(0.01, Math.hypot(dx, dy, dz));
    if (e > Math.max(3, size * 40)) return;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / e; if (dot < 0.8) return;
    if (size / e * dot > score) { score = size / e * dot; best = def; }
  };
  schools.forEach(sc => sc.fish.forEach(q => check(sc.f.def, q.x, q.d, q.z, q.s)));
  SPOTS.forEach(p => check(BOTTOM[p.k].def, p.x, p.d, p.z, p.k === 'grass' ? 0.3 : 0.4));
  BIG.forEach(b => b.on && check(b.def, b.on.x, b.on.d, b.on.z, b.len));
  return best && { def: best, score };
}
// 「この深さで出会える生き物」（ui.js の左の欄）に、いまいる場所の浅い海の生き物を出す。
// ダイブポイントの近くはそこに群れる魚とまわりの生き物、サンゴ礁の上は代表的な礁の魚。外洋の生き物は pelagic.js が nearbyExtra に足す
const nearbyExtra = [];
function nearby(px, pz, depth, floorD) {
  // 説明は図鑑の文の、はじめの 1〜2 文（1 文目が短いときは 2 文目まで）
  const brief = note => { const ss = note.split('。').filter(Boolean).map(t => t + '。'); return ss[0].length < 30 && ss[1] ? ss[0] + ss[1] : ss[0]; };
  const out = [], add = def => { if (def && def.name && def.note && !out.some(o => o.name === def.name)) out.push({ name: def.name, note: brief(def.note) }); };
  if (depth > DEEP_MAX) return out;
  POINTS().forEach(st => {
    if (Math.hypot(st.x - px, st.z - pz) > 400) return;
    st.fish.forEach(r => { const f = FISH.find(q => q.kind === r.kind); add(f && f.def); });
    (st.guests || []).forEach(gs => add(((window.SEA && window.SEA.creatures) || []).find(d => d.kind === gs.kind)));
  });
  if (floorD < 45) ['anthias', 'hepatus', 'chromis', 'parrot', 'clown'].forEach(k => add(FISH.find(f => f.kind === k).def));
  else if (floorD < DEEP_MAX) FISH.filter(f => f.deep).forEach(f => add(f.def));   // 礁の外側の深い斜面
  nearbyExtra.forEach(fn => fn(px, pz, depth, floorD).forEach(add));
  return out.slice(0, 6);
}
REEF.rebuild = rebuild; REEF.frame = frame; REEF.hide = hide; REEF.subject = subject;
window.__REEF = { FISH, BOTTOM, BIG, schools, species: REEF_SPECIES, nearby, nearbyExtra,
  kit: { fishGeo, swayMat, instanced, merge, paint, mixc, silverMat, D, thumbMesh, meetDef, TIME, AIR, CAMD } };   // 外洋の生き物（pelagic.js）が使う
})();
