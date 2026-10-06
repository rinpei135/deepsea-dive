// 空・海面・水中の光。海面の波はゲルストナー波の重ね合わせ（単位は m、シーンは 1単位 = 1km）
(() => {
const T = window.__TRENCH;
const { scene, renderer, camera } = T;
// 太陽は西北西の空、高さ約 25°（夕方前）。低い太陽は海面に、こちらへ伸びるきらめきの道を作る
const SUN_AZ = 295 * Math.PI / 180, SUN_EL = 25 * Math.PI / 180;
const SUN = new THREE.Vector3(Math.sin(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.cos(SUN_AZ) * Math.cos(SUN_EL));
const startYaw = Math.atan2(-SUN.x, -SUN.z) - 0.25;                    // 潜航を始めるときは、太陽の少し右を向く
// 屈折して水中を進む太陽光の向き（実寸の m 単位）。水中から見上げたとき、太陽はこの逆向き（-refrSun）に見える
const refrSun = new THREE.Vector3(-SUN.x / 1.333, 0, -SUN.z / 1.333);
refrSun.y = -Math.sqrt(1 - refrSun.x ** 2 - refrSun.z ** 2);
const sunUw = refrSun.clone().negate();

// 貿易風（東北東から約 8 m/秒 = 15〜16 ノット）の吹くマリアナ近海の波を、Pierson–Moskowitz の風浪スペクトルから作る。
// 風浪は風下の西南西へ進み、長い波ほど向きがそろう。東から届く貿易風うねり（周期 9〜10 秒）を別に足す。
// 座標は +x が東、+z が南。向き（deg）は進む向きを北から時計回りに測る
const WAVES = (() => {
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = 9.81, U = 8, wp = 0.877 * g / U, alpha = 0.0081;          // ピークの角周波数（周期 約 5.8 秒、波長 約 53 m）
  const S = w => alpha * g * g / Math.pow(w, 5) * Math.exp(-1.25 * Math.pow(wp / w, 4));
  const dirOf = deg => { const b = deg * Math.PI / 180; return [Math.sin(b), -Math.cos(b)]; };
  const list = [], N = 16, w0 = wp * 0.75, w1 = wp * 5.5;
  for (let i = 0; i < N; i++) {
    const a = w0 * Math.pow(w1 / w0, i / N), b = w0 * Math.pow(w1 / w0, (i + 1) / N), w = Math.sqrt(a * b);
    const [x, z] = dirOf(250 + (rnd() * 2 - 1) * (25 + 40 * i / (N - 1)));   // 短い波ほど向きがばらける
    list.push([x, z, 2 * Math.PI * g / (w * w), Math.sqrt(2 * S(w) * (b - a)), true]);
  }
  [[265, 9.5, 0.35], [258, 10.5, 0.22]].forEach(([deg, T, A]) => { const [x, z] = dirOf(deg + (rnd() * 2 - 1) * 6); list.push([x, z, g * T * T / (2 * Math.PI), A, false]); });
  const QK = 0.75;                                                     // 波の鋭さの合計（1 を超えると波の形が裏返る）
  // sea: 風浪（島の風下では風が弱まって小さくなる）。うねりは遠くから届くので、そのまま
  return list.map(([x, z, L, A, sea]) => { const k = 2 * Math.PI / L; return { dx: x, dz: z, L, A, k, w: Math.sqrt(g * k), Q: Math.min(3, QK / (k * A * list.length)), sea }; });
})();
const AMP = WAVES.reduce((s, w) => s + w.A, 0);                        // 振幅の合計
const RMS = Math.sqrt(WAVES.reduce((s, w) => s + w.A * w.A / 2, 0));  // 海面の高さのばらつき（白波の出る高さの目安）
// 細かいさざ波（波長 0.2〜4m）: 形は動かさず、面の傾きだけに足す。これがないと海面がのっぺりして、太陽のきらめきが粒にならない。
// 1 本ごとの傾きは約 0.07 で、合わせた傾きのばらつきが Cox–Munk の実測（風速 8m/秒で約 0.044）に近づくようにする
const RIPPLES = (() => {
  let seed = 777; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 12 }, (_, i) => {
    const L = 4 * Math.pow(0.2 / 4, i / 11), k = 2 * Math.PI / L, b = (250 + (rnd() * 2 - 1) * 70) * Math.PI / 180;
    return { dx: Math.sin(b), dz: -Math.cos(b), L, k, w: Math.sqrt(9.81 * k + 0.074 / 1025 * k ** 3), s: 0.055 };
  });
})();
const glslRipples = RIPPLES.map((r, i) => `{ float f = 1.0 - smoothstep(${(r.L * 0.08).toFixed(4)}, ${(r.L * 0.3).toFixed(4)}, uFp); float ph = ${r.k.toFixed(4)} * dot(vec2(${r.dx.toFixed(4)}, ${r.dz.toFixed(4)}), pmL) - ${r.w.toFixed(4)} * uTime + ${(r.L * 7.3).toFixed(3)} + uPh[${WAVES.length + i}];
      nAcc.xz += vec2(${r.dx.toFixed(4)}, ${r.dz.toFixed(4)}) * ${r.s.toFixed(3)} * cos(ph) * f * rippleK; lost += 0.5 * ${(r.s * r.s).toFixed(5)} * (1.0 - f) * rippleK * rippleK; }`).join('\n      ');
const glslWaves = WAVES.map((w, i) => `W(pmL, uPh[${i}], vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), ${w.k.toFixed(5)}, ${w.w.toFixed(5)}, ${w.A.toFixed(4)}, ${w.Q.toFixed(3)}, ${w.L.toFixed(2)}, ${w.sea ? '1.0' : '0.0'});`).join('\n      ');
// 白波の跡を求めるための、波の山の高さ（長い波だけ。過去の時刻でも計算する）
const glslCrest = WAVES.map((w, i) => [w, i]).filter(([w]) => w.L >= 7).map(([w, i]) => `c += ${w.A.toFixed(4)} * ${w.sea ? 'windK' : '1.0'} * sin(${w.k.toFixed(5)} * dot(vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), p) + uPh[${i}] - ${w.w.toFixed(5)} * t);`).join('\n      ');
// 波の位相の、基準点（HI、カメラの近く 4,096m きざみ）の分。JS（倍精度）で計算して渡し、シェーダーは基準点からの座標（pmL）だけで計算する。
// 海面の座標は数十万 m あり、そのまま使うと画素ごとの補間の誤差（数 cm）で面の向きがぶれ、海面がざらつくため
const PH = { value: new Array(WAVES.length + RIPPLES.length).fill(0) };
function updatePhases(hx, hz) {
  const all = WAVES.concat(RIPPLES);
  for (let i = 0; i < all.length; i++) { const w = all[i], v = w.k * (w.dx * hx + w.dz * hz); PH.value[i] = v - Math.floor(v / (2 * Math.PI)) * 2 * Math.PI; }
}

// 水中の水の揺れ (m)。波の下の水は円を描いて動き、その大きさは深さとともに e^(-kd) で小さくなる（線形の波の理論）。
// 長いうねりほど深くまで届く（水深10mで周期約10秒・数十cm、50mでほぼ消える）。潜水艇もこの水と一緒に揺れる
function orbit(xm, zm, dm, t) {
  let x = 0, y = 0, z = 0;
  const wk = windAt(xm / 1000, zm / 1000), sd = shoreDampAt(T.floorDepth(xm / 1000, zm / 1000));
  for (const w of WAVES) {
    const e = w.A * (w.sea ? wk : 1) * sd * Math.exp(-w.k * dm); if (e < 0.002) continue;
    const ph = w.k * (w.dx * xm + w.dz * zm) - w.w * t, c = Math.cos(ph) * e;
    x += c * w.dx; z += c * w.dz; y += Math.sin(ph) * e;
  }
  return [x, y, z];
}
// JS 側: カメラ位置の水面の高さ (m)。水面の上か下かの判定に使う
function waveHeight(xm, zm, t) {
  const xk = xm / 1000, zk = zm / 1000, wk = windAt(xk, zk), hd = T.floorDepth(xk, zk);
  let h = 0;
  for (const w of WAVES) h += w.A * (w.sea ? wk : 1) * Math.sin(w.k * (w.dx * xm + w.dz * zm) - w.w * t);
  return h * shoreDampAt(hd) + shoreWaveJS(xk, zk, hd, t, wk);
}
// 浅瀬では沖の波が小さくなる（代わりに岸へ寄せる波になる）。シェーダーの shoreDamp と同じ
const shoreDampAt = h => 0.12 + 0.88 * Math.min(1, Math.max(0, (h - 1) / 21)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (h - 1) / 21)));

const COMMON = `
  uniform vec3 uSun; uniform float uTime;
  uniform vec3 uWater; uniform float uUw, uSunA; uniform vec3 uSunUw;   // 水の色、向きによる明るさの差の強さ、太陽のにじみの強さ、水中から見た太陽の向き
  uniform float uBeau;                                                   // 1 = 浅瀬の水中（美しさ優先: 見上げた海面のきらめきを強く）
  // 乱数: 格子の番号を 4096 で折り返してから混ぜる（海面の座標は数十万 m あり、sin を使う乱数ではそのままだと精度が足りず模様が消える）
  float hh(vec2 p){ vec3 q = fract(vec3(mod(p, 4096.0).xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hh(i), hh(i+vec2(1,0)), f.x), mix(hh(i+vec2(0,1)), hh(i+vec2(1,1)), f.x), f.y); }
  // ACES 近似トーンマッピング（明るい部分を白飛びさせずに圧縮）
  vec3 tm(vec3 c){ c *= 0.85; return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); }
  // 仕上げの後処理（post.js）があるときは、明るさを変換せずに HDR のまま渡す（変換は画面全体でまとめて行う）
  uniform float uTM;
  vec3 tmo(vec3 c){ return uTM > 0.5 ? tm(c) : c * 1.06; }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
  // ---------- 貿易風積雲 ----------
  // 空のドームに、平らな底ともこもこした頭の積雲を並べる（地平線に近い列ほど遠く小さい）。
  // 1 つの雲は、いくつかの丸いふくらみの重なり。上と太陽側は明るく、底は影で灰色になる
  float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
  vec3 cuN;                                                              // いちばん手前に出ているふくらみの面の向き（陰影用）
  float cumulus(vec2 uv, float id){
    float d = -1.0; vec3 nS = vec3(0.0);
    for (int i = 0; i < 9; i++) {
      float fi = float(i), x = (h1(id + fi * 7.13) * 2.0 - 1.0) * 0.66;
      vec2 c = vec2(x, 0.1 + (0.2 + 0.45 * h1(id + fi * 3.31)) * (1.0 - abs(x) * 0.85));
      float r = 0.17 + 0.2 * h1(id + fi * 5.77) * (1.0 - abs(x) * 0.5);
      vec2 q = (uv - c) / vec2(r * 1.15, r); float di = 1.0 - length(q);
      d = max(d, di);
      nS += vec3(q, sqrt(max(0.0, 1.0 - dot(q, q)))) * smoothstep(-0.15, 0.35, di);   // ふくらみの境目で向きをなめらかにつなぐ
    }
    cuN = normalize(nS + vec3(0.0, 0.0, 0.05));
    return d - smoothstep(0.12, -0.02, uv.y) * 2.0;                       // 底は平ら
  }
  vec4 clouds(vec3 r, bool fine){
    float az = atan(r.x, -r.z), el = asin(clamp(r.y, 0.0, 1.0)), sAz = ${Math.atan2(SUN.x, -SUN.z).toFixed(4)};
    vec4 acc = vec4(0.0);
    for (int k = 0; k < 4; k++) {                                         // 遠い列（地平線の近く）から近い列へ重ねる
      float fk = float(k), eb = 0.014 + 0.03 * fk + 0.022 * fk * fk, sc = 0.022 + 0.034 * fk;
      float nC = floor(6.2832 / (sc * 4.2)), cw = 6.2832 / nC;            // 一周にちょうど並ぶ区画（真後ろで雲が切れないように）
      float a = mod(az + uTime * 0.0008 * (1.0 + fk) + fk * 1.7, 6.2832), ci = floor(a / cw);
      for (int j = -1; j <= 1; j++) {
        float id = mod(ci + float(j), nC) + fk * 101.0;
        if (h1(id) > 0.5) continue;                                       // 雲のない区画
        float cx = (ci + float(j) + 0.5 + (h1(id * 1.3) - 0.5) * 0.5) * cw, w = sc * (1.1 + h1(id * 2.1) * 1.1);
        vec2 uv = vec2((a - cx) / w, (el - eb - (h1(id * 3.7) - 0.5) * sc * 0.8) / (sc * 1.25));
        if (abs(uv.x) > 1.2 || uv.y < -0.1 || uv.y > 1.3) continue;
        float d = cumulus(uv, id);
        if (fine) { float n = fbm(uv * vec2(8.0, 9.0) + id); d += (n - 0.5) * 0.5; cuN = normalize(cuN + vec3(n - 0.5, vn(uv * 15.0 + id) - 0.5, 0.0) * 0.9); }   // カリフラワーのような細かいでこぼこ
        float al = smoothstep(0.0, 0.07, d);
        if (al <= 0.0) continue;
        // ふくらみを球として照らす: 太陽の来る側（左右）と上が明るく、下と奥は空の青を受けた灰色
        vec3 Ld = normalize(vec3(sign(sin(sAz - cx)) * 0.75, 0.55 + 0.4 * uSun.y, 0.45));
        float dif = dot(cuN, Ld) * 0.6 + 0.4, lit = clamp(dif * dif * (0.6 + 0.4 * smoothstep(0.0, 0.6, uv.y)), 0.0, 1.0);
        vec3 cc = mix(vec3(0.42, 0.50, 0.63), vec3(1.12, 1.08, 1.02), lit);
        cc = mix(cc, vec3(0.62, 0.64, 0.68), smoothstep(0.25, 0.0, uv.y) * 0.5);   // 平らな底の影
        cc = mix(cc, vec3(0.80, 0.86, 0.92), (0.45 - 0.13 * fk) * (1.0 - smoothstep(0.0, 0.35, el)));   // 遠い雲は空気でかすむ
        acc.rgb = mix(acc.rgb, cc, al); acc.a = max(acc.a, al);
      }
    }
    return acc;
  }
  uniform samplerCube uSkyCube; uniform float uSkyOn, uDisk;               // uSkyOn: 0 = 毎回計算 / 1 = 映り込みだけ画像 / 2 = 空も画像
  vec3 sunDisk(vec3 r){ float s = max(dot(r, uSun), 0.0); return vec3(1.0, 0.95, 0.85) * (pow(s, 2400.0) * 40.0 + pow(s, 300.0) * 1.2); }
  vec3 skyAt(vec3 r, bool fine){
    float h = max(r.y, 0.0);
    vec3 c = mix(vec3(0.66, 0.80, 0.92), vec3(0.09, 0.28, 0.66), pow(h, 0.42));   // 水平線は白っぽく、天頂は深い青
    float s = max(dot(r, uSun), 0.0);
    c += vec3(1.0, 0.86, 0.62) * (pow(s, 6.0) * 0.22 + pow(s, 40.0) * 0.35);   // 太陽のまわりのまぶしさ
    c = mix(c, vec3(0.82, 0.88, 0.92), exp(-h * 22.0) * 0.75);         // 水平線のかすみ
    c += sunDisk(r) * uDisk;
    if (r.y > 0.0) {
      vec4 cl = clouds(r, fine);
      vec3 cc = cl.rgb + vec3(1.0, 0.9, 0.7) * pow(s, 10.0) * 1.3;      // 太陽の近くの雲は縁から光る
      c = mix(c, cc, cl.a);
    }
    return c;
  }
  // 空は数秒ごとに 6 方向の画像（キューブマップ）に描いておき、ふだんはそれを読むだけにする（雲の計算は重いので）。
  // 太陽の円盤だけは細かいので、読むたびに足す
  // 細かさ（ミップ）は決めて読む。自動にすると、海面の水平線ぎわ（隣の画素が空）で極端にぼけた空を読み、水平線に青い線が出る
  vec3 skyCube(vec3 r){ return textureCubeLodEXT(uSkyCube, r, 1.0).rgb + sunDisk(r); }
  vec3 skyCol(vec3 r){ return uSkyOn > 1.5 ? skyCube(r) : skyAt(r, true); }       // 空のドーム（画質「高」では毎回計算して細かく）
  vec3 skyColR(vec3 r){ return uSkyOn > 0.5 ? skyCube(r) : skyAt(r, false); }    // 海面に映る空
  // 水中の背景: 水平方向が水の色（霧と同じ）で、上ほど明るく下ほど暗い。浅い所では太陽の方向がにじんで光る。
  // 約 50m より深いと光は真上から来る形に落ち着き、上が明るいまま約 1,000m まで続く（Warrant & Locket 2004）
  vec3 waterBg(vec3 d){
    float up = d.y > 0.0 ? 1.0 + 1.3 * pow(d.y, 1.5) : mix(1.0, 0.3, smoothstep(0.0, 0.9, -d.y));
    vec3 c = uWater * up;
    float s = max(dot(d, uSunUw), 0.0);
    c += vec3(0.45, 0.8, 0.95) * (pow(s, 6.0) * 0.25 + pow(s, 40.0) * 0.6) * uSunA;
    return mix(uWater, c, uUw);
  }`;

// ---------- 雲の影と、波がレンズになって集める光（地形・海面・近景の生き物で共通） ----------
// cloudShade: 1 = 日なた、0.35 = 雲の影。雲は大きさ 1〜3km のまだらで、風下（西南西）へ約 8m/秒で流れる。
// waveFocus: 海面の波がレンズになって海底に光を集める度合い（1 = そのまま）。波の山の下（面がへこみ側に曲がる所）で明るく、
// 谷の下で暗い。水深 d が深いほど強く効く（屈折のずれ = 深さ × 面の傾き の変わり方）
const CLOUD_SPD = 0.008;
const SHARED_GLSL = `
  float csH(vec2 p){ vec3 q = fract(vec3(mod(p, 4096.0).xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float csN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(csH(i), csH(i + vec2(1, 0)), f.x), mix(csH(i + vec2(0, 1)), csH(i + vec2(1, 1)), f.x), f.y); }
  float cloudShade(vec2 xz, float t){
    vec2 p = (xz - vec2(-0.940, 0.342) * ${CLOUD_SPD} * t) * 0.55;            // 風下の向き（WIND_TO と同じ）
    float n = csN(p) * 0.55 + csN(p * 2.3 + 7.0) * 0.3 + csN(p * 5.1 + 3.0) * 0.15;
    return 1.0 - 0.65 * smoothstep(0.46, 0.56, n);                       // 空の 2〜3 割が雲（貿易風の積雲）
  }
  float waveFocus(vec2 p, float t, float d){
    float lap = 0.0;
    ${WAVES.map(w => `lap -= ${(w.A * w.k * w.k).toFixed(5)} * sin(${w.k.toFixed(5)} * dot(vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), p) - ${w.w.toFixed(5)} * t);`).join('\n    ')}
    float J = 1.0 + d * 0.25 * lap;
    return clamp(1.0 / max(abs(J), 0.3), 0.45, 2.2);
  }`;
// JS 側の雲の影（近景の生き物の日の光の強さに使う）。シェーダーの cloudShade と同じ式
function cloudShadeJS(xk, zk, t) {
  const H = (x, y) => { x = ((x % 4096) + 4096) % 4096; y = ((y % 4096) + 4096) % 4096; let a = (x * 0.1031) % 1, b = (y * 0.1031) % 1, c = a; const dd = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += dd; b += dd; c += dd; const v = (a + b) * c; return v - Math.floor(v); };   // シェーダーと同じ（足した後は fract しない）
  const N = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (H(ix, iy) * (1 - fx) + H(ix + 1, iy) * fx) * (1 - fy) + (H(ix, iy + 1) * (1 - fx) + H(ix + 1, iy + 1) * fx) * fy; };
  const px = (xk - WIND_TO[0] * CLOUD_SPD * t) * 0.55, pz = (zk - WIND_TO[1] * CLOUD_SPD * t) * 0.55;
  const n = N(px, pz) * 0.55 + N(px * 2.3 + 7, pz * 2.3 + 7) * 0.3 + N(px * 5.1 + 3, pz * 5.1 + 3) * 0.15;
  const u = Math.min(1, Math.max(0, (n - 0.46) / 0.10));
  return 1 - 0.65 * u * u * (3 - 2 * u);
}
T.terrainMat.fragmentShader = T.terrainMat.fragmentShader.replace(/\/\/@SEA_SHARED_BEGIN[\s\S]*?\/\/@SEA_SHARED_END/, SHARED_GLSL);

// ---------- 海岸: 海面の下の水深 ----------
// 地形の格子を、海面の描画用のテクスチャにする。R = 水深（0〜63.75m を 0.25m 刻み）、G = 陸の高さ（m）。
// 線形補間で、海岸線（水深 0 の線）がなめらかにつながる。全体の粗い格子（約 900m）と、細かい地形のある島のまわり（約 120m）の 2 枚
// B = 風の当たり方（1 = 開けた海、0.3 = 島のすぐ風下。粗い格子だけ）
function shoreTex(D, expo) {
  const n = D.nlon * D.nlat, a = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const e = D.e[i]; a[i * 4] = Math.min(255, Math.max(0, Math.round(-e * 4))); a[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(e))); a[i * 4 + 2] = expo ? Math.round(expo[i] * 255) : 255; a[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(a, D.nlon, D.nlat, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
  // 世界の座標 (km) → テクスチャの座標。u = x * a + b（格子点の中心が画素の中心に来るように）
  const x0 = T.toX(D.lon0), x1 = T.toX(D.lon0 + (D.nlon - 1) * D.step), z0 = T.toZ(D.lat0), z1 = T.toZ(D.lat0 - (D.nlat - 1) * D.step);
  const au = (D.nlon - 1) / D.nlon / (x1 - x0), av = (D.nlat - 1) / D.nlat / (z1 - z0);
  return { tex: t, map: new THREE.Vector4(au, 0.5 / D.nlon - au * x0, av, 0.5 / D.nlat - av * z0), box: new THREE.Vector4(x0, x1, z0, z1), size: new THREE.Vector2(D.nlon, D.nlat) };
}
// ---------- 島の風下 ----------
// 島の陸地から風下（西南西）へ線を引き、島の陰になる海は風が弱く、風浪と白波が小さくなるようにする。
// グアムでは、東岸の波高 約1.5m に対し、西岸の沖は 約0.5m。陰は風下へ数十 km 続き、離れるほど薄れる
const WIND_TO = [-0.940, 0.342];                                       // 風浪の進む向き（西南西、250°）
function windExposure(D) {
  const nx = D.nlon, nz = D.nlat, ex = new Float32Array(nx * nz).fill(1);
  const dx = (T.toX(D.lon0 + D.step) - T.toX(D.lon0)), dz = (T.toZ(D.lat0 - D.step) - T.toZ(D.lat0));   // 1 マスの大きさ (km)
  const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
    if (D.e[r * nx + c] <= 0) continue;
    for (let j = -2; j <= 2; j++) {                                     // 風の向きのぶれ（±約 11°）。端の線ほど陰が薄い
      const an = j * 0.1, ux = WIND_TO[0] * Math.cos(an) - WIND_TO[1] * Math.sin(an), uz = WIND_TO[0] * Math.sin(an) + WIND_TO[1] * Math.cos(an), edge = Math.abs(j) * 0.12;
      for (let s = 0.4; s < 90; s += 0.4) {
        const cc = Math.round(c + ux * s / dx), rr = Math.round(r + uz * s / dz);
        if (cc < 0 || cc >= nx || rr < 0 || rr >= nz) break;
        const i = rr * nx + cc; if (D.e[i] > 0) continue;
        const v = Math.min(1, 0.25 + 0.75 * sm(2, 70, s) + edge);
        if (v < ex[i]) ex[i] = v;
      }
    }
  }
  for (let pass = 0; pass < 1; pass++) {                                // 少しぼかす
    const o = ex.slice();
    for (let r = 1; r < nz - 1; r++) for (let c = 1; c < nx - 1; c++) {
      let s = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += o[(r + a) * nx + c + b];
      ex[r * nx + c] = s / 9;
    }
  }
  return ex;
}
const BB = window.BATHY;
const COARSE = { e: T.elev, nlon: T.NX, nlat: T.NZ, lon0: BB.lon0, lat0: BB.lat0, step: BB.step };
const EXPO = windExposure(COARSE);
const SH_A = shoreTex(COARSE, EXPO);
const ISLAND = (T.DETAIL || []).find(D => D.name && D.name.includes('グアム'));
const SH_G = ISLAND ? shoreTex(ISLAND) : SH_A;
// JS 側: その場所の風の当たり方（シェーダーの windExp と同じ）
function gridAt(arr, D, xk, zk) {
  const fx = (xk - T.toX(D.lon0)) / (T.toX(D.lon0 + D.step) - T.toX(D.lon0)), fz = (zk - T.toZ(D.lat0)) / (T.toZ(D.lat0 - D.step) - T.toZ(D.lat0));
  const c = Math.min(D.nlon - 2, Math.max(0, Math.floor(fx))), r = Math.min(D.nlat - 2, Math.max(0, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - c)), v = Math.min(1, Math.max(0, fz - r)), i = r * D.nlon + c;
  return (arr[i] * (1 - u) + arr[i + 1] * u) * (1 - v) + (arr[i + D.nlon] * (1 - u) + arr[i + D.nlon + 1] * u) * v;
}
const windAt = (xk, zk) => gridAt(EXPO, COARSE, xk, zk);

// ---------- 岸へ寄せるうねり ----------
// 東から届く周期 10 秒のうねりが、島のまわりの各点に届く時刻を求める（ファストマーチング法）。
// 波は浅いほど遅い（水深 h での速さ ≒ √(g·h)）ので、波の列は岸と平行に向きを変え（屈折）、岬を回り込み、波長が縮む。
// 沖（水深 100m 以上）は、まっすぐ進む波の時刻をそのまま与える
const SW_T = 10, SW_W = 2 * Math.PI / SW_T, SW_DIR = [-0.996, 0.087];   // 周期 (s)・角周波数・進む向き（西、265°）
function swellArrival(D) {
  const nx = D.nlon, nz = D.nlat, N = nx * nz, g = 9.81, k0 = SW_W * SW_W / g;
  const hx = (T.toX(D.lon0 + D.step) - T.toX(D.lon0)) * 1000, hz = (T.toZ(D.lat0 - D.step) - T.toZ(D.lat0)) * 1000;   // 1 マス (m)
  const x0 = T.toX(D.lon0) * 1000, z0 = T.toZ(D.lat0) * 1000;
  const slow = new Float32Array(N), tau = new Float64Array(N).fill(Infinity), done = new Uint8Array(N);
  // 1 / 波の速さ。陸の格子は水深 0.8m（礁原と同じくらい）として通す（この格子（約 120m）では、礁原の一部が陸になっていて、
  // 遅すぎる値にすると、そこだけ細かい波の線が詰まって白っぽい四角に見える）
  for (let i = 0; i < N; i++) { const h = D.e[i] > 0 ? 0.8 : Math.max(-D.e[i], 0.3); slow[i] = SW_W / (g * Math.sqrt(Math.tanh(k0 * h))); }
  // 小さい順に取り出す入れ物（ヒープ）
  const hv = [], hi = [];
  const push = (v, i) => { hv.push(v); hi.push(i); let k = hv.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hv[p] <= hv[k]) break; [hv[p], hv[k]] = [hv[k], hv[p]]; [hi[p], hi[k]] = [hi[k], hi[p]]; k = p; } };
  const pop = () => {
    const i = hi[0], lv = hv.pop(), li = hi.pop();
    if (hv.length) { hv[0] = lv; hi[0] = li; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < hv.length && hv[a] < hv[m]) m = a; if (b < hv.length && hv[b] < hv[m]) m = b; if (m === k) break; [hv[m], hv[k]] = [hv[k], hv[m]]; [hi[m], hi[k]] = [hi[k], hi[m]]; k = m; } }
    return i;
  };
  for (let i = 0; i < N; i++) if (-D.e[i] >= 100) { const x = x0 + (i % nx) * hx, z = z0 + Math.floor(i / nx) * hz; tau[i] = (SW_DIR[0] * x + SW_DIR[1] * z) * slow[i]; done[i] = 1; }
  const solve = i => {
    const c = i % nx, r = (i - c) / nx;
    const a = Math.min(c > 0 && done[i - 1] ? tau[i - 1] : Infinity, c < nx - 1 && done[i + 1] ? tau[i + 1] : Infinity);
    const b = Math.min(r > 0 && done[i - nx] ? tau[i - nx] : Infinity, r < nz - 1 && done[i + nx] ? tau[i + nx] : Infinity);
    const s = slow[i];
    if (a === Infinity) return b + s * hz;
    if (b === Infinity) return a + s * hx;
    const A = 1 / (hx * hx) + 1 / (hz * hz), B = -2 * (a / (hx * hx) + b / (hz * hz)), C = a * a / (hx * hx) + b * b / (hz * hz) - s * s, dd = B * B - 4 * A * C;
    const t = dd >= 0 ? (-B + Math.sqrt(dd)) / (2 * A) : Infinity;
    return t >= Math.max(a, b) ? t : Math.min(a + s * hx, b + s * hz);
  };
  const nb = i => { const c = i % nx, r = (i - c) / nx, o = []; if (c > 0) o.push(i - 1); if (c < nx - 1) o.push(i + 1); if (r > 0) o.push(i - nx); if (r < nz - 1) o.push(i + nx); return o; };
  for (let i = 0; i < N; i++) if (done[i]) for (const j of nb(i)) if (!done[j]) { const t = solve(j); if (t < tau[j]) { tau[j] = t; push(t, j); } }
  while (hv.length) {
    const i = pop(); if (done[i]) continue; done[i] = 1;
    for (const j of nb(i)) if (!done[j]) { const t = solve(j); if (t < tau[j]) { tau[j] = t; push(t, j); } }
  }
  let mn = Infinity; for (let i = 0; i < N; i++) if (tau[i] < mn) mn = tau[i];
  const out = new Float32Array(N), a = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const t = Math.min(tau[i] - mn, 160000); out[i] = t;
    const v = Math.round(t * 100); a[i * 4] = (v >> 16) & 255; a[i * 4 + 1] = (v >> 8) & 255; a[i * 4 + 2] = v & 255; a[i * 4 + 3] = 255;   // 0.01 秒きざみの 24bit
  }
  const tex = new THREE.DataTexture(a, nx, nz, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return { tau: out, tex };
}
const SWELL = { uSwT: { value: null }, uSwOn: { value: 0 } };
let SW_TAU = null;
if (ISLAND) setTimeout(() => { const r = swellArrival(ISLAND); SW_TAU = r.tau; SWELL.uSwT.value = r.tex; SWELL.uSwOn.value = 1; }, 0);   // 最初の表示を遅らせないよう、あとで計算
// JS 側: 岸へ寄せる波の高さ (m)。シェーダーの shoreWave と同じ式（カメラが水面の上か下かの判定に使う）
const SW_SM = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function swShapeJS(psi, a, n, br) {
  const q = psi + a * (Math.cos(6.2832 * psi) - 1) / 6.2832;
  const un = Math.pow(Math.max(0, 0.5 + 0.5 * Math.cos(6.2832 * q)), n), bore = Math.max(1 - psi, SW_SM(0.86, 1, psi));
  return un + (bore - un) * br - (0.5 / Math.sqrt(n) + (0.5 - 0.5 / Math.sqrt(n)) * br);
}
function shoreWaveJS(xk, zk, h, t, wk) {
  if (!SW_TAU || h > 26 || h < 0.05) return 0;
  const b = SH_G.box; if (xk <= b.x || xk >= b.y || zk <= b.z || zk >= b.w) return 0;
  const tau = gridAt(SW_TAU, ISLAND, xk, zk), xm = xk * 1000, zm = zk * 1000;
  const p = swParams(h, tau, t, xm, zm, wk);
  return p.H * swShapeJS(p.psi, p.a, p.n, p.br);
}
// 岸へ寄せる波の高さと形（JS とシェーダーで同じ式）
function swParams(h, tau, t, xm, zm, wk) {
  let H0 = (0.35 + 0.9 * wk) * (0.8 + 0.2 * Math.sin(xm * 0.011 + zm * 0.017) * Math.sin(xm * 0.023 - zm * 0.009));
  H0 *= 0.72 + 0.28 * Math.sin(0.0785 * (t - tau));
  const hh = Math.max(h, 0.05), Hs = H0 * Math.pow(20 / Math.max(hh, 0.3), 0.25), br = SW_SM(0.85, 1.05, Hs / (0.78 * hh));
  const H = Math.min(Hs, 0.78 * hh) * (1 - 0.35 * br) * (1 - SW_SM(14, 26, h)), sh = 1 - SW_SM(3, 16, h);
  const ph = SW_W * (t - tau) / 6.2832, psi = ph - Math.floor(ph);
  return { H, br, sh, psi, a: 0.8 * Math.max(sh, br), n: 1 + 2.5 * sh };
}
// 浅瀬の海底の画像（屈折用。下の「浅瀬の海底を透かす」で毎フレーム描く）
const REFR = { uRefr: { value: null }, uRefrOn: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
const SHORE_U = () => Object.assign({}, REFR, SWELL, { uShA: { value: SH_A.tex }, uShAm: { value: SH_A.map }, uShAs: { value: SH_A.size }, uShG: { value: SH_G.tex }, uShGm: { value: SH_G.map }, uShGs: { value: SH_G.size }, uShGb: { value: SH_G.box } }, T.COAST.U);   // 島の細かい陸地・衛星写真も共有
Object.assign(T.terrainMat.uniforms, SHORE_U());                       // 地形も、海が近いか（砂浜にするか）を知るために使う
const SHORE_GLSL = `
  uniform sampler2D uRefr; uniform float uRefrOn; uniform vec2 uRes;
  ${T.COAST_GLSL}
  uniform sampler2D uShA, uShG; uniform vec4 uShAm, uShGm, uShGb; uniform vec2 uShAs, uShGs;
  // その場所の水深 (m)。陸ではマイナス（陸の高さ）。
  // 補間は自前で行う（GPU の線形補間は 1 画素を 256 段階ほどにしか分けないため、大きく引き伸ばすと数 m の四角いタイル模様になる）
  vec4 shoreRaw(sampler2D t, vec2 uv, vec2 n){
    vec2 p = uv * n - 0.5, i = floor(p), f = p - i;
    vec4 a = texture2D(t, (i + vec2(0.5, 0.5)) / n), b = texture2D(t, (i + vec2(1.5, 0.5)) / n);
    vec4 c = texture2D(t, (i + vec2(0.5, 1.5)) / n), d = texture2D(t, (i + vec2(1.5, 1.5)) / n);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float shoreAt(sampler2D t, vec2 uv, vec2 n){ vec4 v = shoreRaw(t, uv, n); return v.r * 63.75 - v.g * 255.0; }
  // 風の当たり方（1 = 開けた海、0.3 = 島のすぐ風下）
  float windExp(vec2 xz){ return shoreRaw(uShA, vec2(xz.x * uShAm.x + uShAm.y, xz.y * uShAm.z + uShAm.w), uShAs).b; }
  // ---------- 岸へ寄せるうねり ----------
  // uSwT: 東からのうねりが届く時刻 (s)。0.01 秒きざみの 24bit（R・G・B）。グアムのまわりの約 120m 格子
  uniform sampler2D uSwT; uniform float uSwOn;
  float dec24(vec4 t){ return (t.r * 16711680.0 + t.g * 65280.0 + t.b * 255.0) * 0.01; }
  vec3 swellT(vec2 xz){                                                  // 届く時刻と、その傾き (s/m)。傾きの向きが波の進む向き
    vec2 n = uShGs, p = vec2(xz.x * uShGm.x + uShGm.y, xz.y * uShGm.z + uShGm.w) * n - 0.5, i = floor(p), f = p - i;
    float a = dec24(texture2D(uSwT, (i + vec2(0.5, 0.5)) / n)), b = dec24(texture2D(uSwT, (i + vec2(1.5, 0.5)) / n));
    float c = dec24(texture2D(uSwT, (i + vec2(0.5, 1.5)) / n)), d = dec24(texture2D(uSwT, (i + vec2(1.5, 1.5)) / n));
    vec2 g = vec2(mix(b - a, d - c, f.y) * n.x * uShGm.x, mix(c - a, d - b, f.x) * n.y * uShGm.z) / 1000.0;
    return vec3(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), g);
  }
  // 波の形（psi: 前の山が通ってからの位相 0〜1。1 に近いほど次の山の前の面）。
  // 浅くなると山がとがって前の面が切り立ち（a, n）、崩れた後は、前が急で後ろがなだらかな段（ボア）になる（br）
  float swShape(float psi, float a, float n, float br){
    float q = psi + a * (cos(6.2832 * psi) - 1.0) / 6.2832;
    float un = pow(max(0.5 + 0.5 * cos(6.2832 * q), 0.0), n), bore = max(1.0 - psi, smoothstep(0.86, 1.0, psi));   // 丸めの誤差で負になると pow が壊れるので 0 以上に
    return mix(un, bore, br) - mix(0.5 / sqrt(n), 0.5, br);
  }
  struct SWv { float eta; vec2 g; float H; float br; float sh; float psi; vec2 dir; float pf; float fresh; };
  // h: 水深 (m)、wk: 風の当たり方、fp: 1 画素の大きさ (m)。高さ eta (m)、傾き g、崩れ具合 br、浅さ sh、波の進む向き dir
  SWv shoreWave(vec2 xz, vec2 pm, float h, float t, float wk, float fp){
    SWv o; o.eta = 0.0; o.g = vec2(0.0); o.H = 0.0; o.br = 0.0; o.sh = 0.0; o.psi = 0.5; o.dir = vec2(-1.0, 0.0); o.pf = 0.0; o.fresh = 0.0;
    if (uSwOn < 0.5 || h > 26.0 || h < 0.05 || xz.x < uShGb.x || xz.x > uShGb.y || xz.y < uShGb.z || xz.y > uShGb.w) return o;
    vec3 tt = swellT(xz);
    // 沖での高さ: 風上（東）ほど高い。場所のむらと、数本ごとに大きな波が来る「セット」
    float H0 = (0.35 + 0.9 * wk) * (0.8 + 0.2 * sin(pm.x * 0.011 + pm.y * 0.017) * sin(pm.x * 0.023 - pm.y * 0.009));
    H0 *= 0.72 + 0.28 * sin(0.0785 * (t - tt.x));
    // 浅くなると波は高くなり（グリーンの法則 H ∝ h^-1/4）、水深の約 0.78 倍を超えると崩れる
    float hh = max(h, 0.05), Hs = H0 * pow(20.0 / max(hh, 0.3), 0.25);
    float rat = Hs / (0.78 * hh);
    o.br = smoothstep(0.85, 1.05, rat);
    o.fresh = mix(0.3, 1.0, 1.0 - smoothstep(1.1, 2.4, rat));             // 崩れた直後ほど泡が多く、礁原を進むうちに薄れる
    o.H = min(Hs, 0.78 * hh) * (1.0 - 0.35 * o.br) * (1.0 - smoothstep(14.0, 26.0, h));
    o.sh = 1.0 - smoothstep(3.0, 16.0, h);
    float ph = ${(SW_W / (2 * Math.PI)).toFixed(5)} * (t - tt.x); o.psi = fract(ph);
    float a = 0.8 * max(o.sh, o.br), n = 1.0 + 2.5 * o.sh, gl = length(tt.yz);
    o.dir = gl > 1e-6 ? tt.yz / gl : vec2(-1.0, 0.0);
    o.pf = fp * ${(SW_W / (2 * Math.PI)).toFixed(5)} * gl;                  // 1 画素に入る波の数（多いと形は見えないので平らにならす）
    float aa = 1.0 - smoothstep(0.12, 0.45, o.pf);
    o.eta = o.H * swShape(o.psi, a, n, o.br);
    float d = (swShape(fract(o.psi + 0.015), a, n, o.br) - swShape(fract(o.psi + 0.985), a, n, o.br)) / 0.03;
    o.g = o.H * d * ${(-SW_W / (2 * Math.PI)).toFixed(5)} * tt.yz * aa;
    return o;
  }
  float waterDepth(vec2 xz){
    bool inG = xz.x > uShGb.x && xz.x < uShGb.y && xz.y > uShGb.z && xz.y < uShGb.w;
    vec4 m = inG ? uShGm : uShAm;
    vec2 uv = vec2(xz.x * m.x + m.y, xz.y * m.z + m.w);
    float wd = inG ? shoreAt(uShG, uv, uShGs) : shoreAt(uShA, uv, uShAs);
    if (uDemOn > 0.5 && inCoast(xz)) { float l = demAt(xz); wd = l > 0.3 ? -l : min(max(wd, 0.3), beachCap(xz)); }   // 島の近くは、細かい陸地で海岸線を決め、浜はなだらかに深くする
    return wd;
  }`;

// 海面の法線と白波（ピクセルより細かい波は薄めて、ちらつきを防ぐ）
const SURFACE_FN = `
  ${SHORE_GLSL}
  ${SHARED_GLSL}
  float shoreDamp = 1.0;                                                 // 浅瀬では沖の波が小さくなる（代わりに岸へ寄せる波になる）
  float windK = 1.0, rippleK = 1.0;                                      // 風の当たり方（島の風下で小さい）。風浪とさざ波の大きさ
  vec3 nAcc; float crest; float uFp; float lost;
  // pmL: カメラの近く（4,096m きざみ）を基準にした座標 (m)。海面の座標は数十万 m あり、そのままでは
  // 数 cm〜数十 cm の精度しかないので、さざ波や泡の穴のような細かい模様はこちらで計算する
  vec2 pmL;
  uniform float uPh[${WAVES.length + RIPPLES.length}];
  void W(vec2 p, float ph0, vec2 d, float k, float w, float A, float Q, float L, float ws){
    float fade = (1.0 - smoothstep(L * 0.1, L * 0.35, uFp)) * shoreDamp * mix(1.0, windK, ws);
    float ph = k * dot(d, p) + ph0 - w * uTime, c = cos(ph), s = sin(ph);
    nAcc.xz += d * k * A * c * fade; nAcc.y += Q * k * A * s * fade;
    crest += A * s * fade;
  }
  vec3 surfNormal(vec2 p){
    nAcc = vec3(0.0); crest = 0.0; lost = 0.0;
      ${glslWaves}
      ${glslRipples}
    vec2 m = vec2(vn(pmL * 1.7 + uTime * 0.6), vn(pmL * 1.7 - uTime * 0.5 + 9.0)) - 0.5;
    nAcc.xz += m * 0.08 * (1.0 - smoothstep(0.1, 0.4, uFp));
    return normalize(vec3(-nAcc.x, 1.0 - nAcc.y, -nAcc.z));
  }
  float crestAt(vec2 p, float t){ float c = 0.0;
      ${glslCrest}
    return c * shoreDamp; }
  uniform float uCamUnder;
  vec4 shadeSurface(vec2 pm, vec3 wpos){
    vec3 toC = cameraPosition - wpos; float dist = length(toC); vec3 V = toC / dist;
    uFp = length(fwidth(pm));
    // 海岸: 水深（細かいでこぼこを足して、海岸線や礁の縁を不規則に）
    float hW = waterDepth(wpos.xz);
    // 水深の変わり方（m/m）。礁の縁や浜の斜面で大きい。隣の画素との差だと、位置の小さな誤差で画素ごとにぶれてざらつくので、
    // 少し離れた 2 点（5m 先、遠くは 1 画素先）の水深から求める
    float hE = max(0.005, uFp * 0.001);
    float hSlope = length(vec2(waterDepth(wpos.xz + vec2(hE, 0.0)) - hW, waterDepth(wpos.xz + vec2(0.0, hE)) - hW)) / (hE * 1000.0);
    hW += ((vn(pm * 0.045) - 0.5) * 0.9 + (vn(pm * 0.35) - 0.5) * 0.3) * (1.0 - smoothstep(3.0, 12.0, hW));
    shoreDamp = 0.12 + 0.88 * smoothstep(1.0, 22.0, hW);
    windK = windExp(wpos.xz); rippleK = 0.55 + 0.45 * windK;
    SWv sw = shoreWave(wpos.xz, pm, hW, uTime, windK, uFp);
    vec3 N = surfNormal(pm);
    if (sw.H > 0.0) N = normalize(N + vec3(-sw.g.x, 0.0, -sw.g.y));
    // 上から見るか下から見るかは、画素ごとの高さではなく、カメラが水中かどうかで決める
    // （海面すれすれの水中では、遠くの波の谷がカメラより低くなり、そこだけ「上から見た海面」になって、水平線に白い線が出るため）
    if (uCamUnder < 0.5) {
      float cs = cloudShade(wpos.xz, uTime);                              // 流れる雲の影（日の光が当たる分だけ暗くなる）
      float cosT = max(dot(N, V), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      vec3 R = reflect(-V, N); R.y = abs(R.y);
      vec3 refl = skyColR(R);
      vec3 deep = vec3(0.004, 0.05, 0.10);
      float cn = crest / ${AMP.toFixed(3)};                               // 波の高さ（-1〜1）
      // 波頭が透ける: 波の山の薄い所を日の光が通り、明るい青緑に光る（太陽の方を見たときに強い）
      float thin = clamp(cn * 1.8 + 0.35, 0.0, 1.0) * (0.6 + 0.4 * windK);
      // 岸へ寄せる波は、崩れる前の切り立った前の面が薄く、よく透ける
      float face = sw.H > 0.05 ? smoothstep(0.62, 0.93, sw.psi) * (1.0 - smoothstep(0.975, 1.0, sw.psi)) * sw.sh * (1.0 - 0.75 * sw.br) * smoothstep(0.15, 0.7, sw.H) * (1.0 - smoothstep(0.1, 0.4, sw.pf)) : 0.0;
      float back = pow(max(dot(V, -uSun + N * 0.6), 0.0), 3.0);
      float sss = (back * max(thin, face) + face * 0.35) * cs;
      vec3 body = deep + vec3(0.04, 0.42, 0.37) * sss * 0.8 + vec3(0.0, 0.05, 0.08) * max(N.y, 0.0) * (0.4 + uSun.y);
      // 浅い海: 海底（白いサンゴ砂と、サンゴや岩のまだら）が透けて見え、赤い光から水に吸われて青緑になる
      if (hW < 60.0) {
        // 見る向きの水の道のり: 光は海面で屈折して真下寄りに曲がるので、水平に近い向きから見ても、水深の約 1.5 倍までしか伸びない
        float cosT = sqrt(max(1.0 - (1.0 - V.y * V.y) / 1.777, 0.2));
        float hb = max(hW, 0.0), path = hb * (1.0 + 1.0 / cosT);
        float bh = 1.0 - smoothstep(20.0, 45.0, hb);                       // 浅瀬は美しさ優先: 本物より澄んで、赤・黄も残る（world.js の beautyK と同じ範囲）
        vec3 Tr = exp(-mix(vec3(0.6, 0.085, 0.055), vec3(0.3, 0.065, 0.045), bh) * path);
        vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * pm; pr += 7.0 * vec2(vn(pm * 0.025), vn(pm * 0.025 + 7.0));   // 回してゆがめ、四角い格子の模様にならないように
        float coral = smoothstep(0.5, 0.68, vn(pr * 0.06) * 0.5 + vn(pr * 0.17 + 3.0) * 0.3 + vn(pm * 0.5) * 0.2) * smoothstep(0.6, 3.0, hb);
        vec3 bottom = mix(vec3(0.95, 0.91, 0.78), vec3(0.34, 0.32, 0.24), coral);
        vec3 sh = bottom * Tr * (0.55 + 0.9 * uSun.y * cs) + vec3(0.0, 0.11, 0.17) * (1.0 - Tr.g) + vec3(0.03, 0.30, 0.31) * sss * 0.4;
        if (uRefrOn > 0.5) {
          // 屈折: 海底（地形を日の光で照らした画像）を、海面の傾きの分だけずらして見る。深いほど大きくゆがむ。
          // 海底まで届く光の弱まりは画像に入っているので、ここでは見る向きの水の道のりだけ吸収させる
          vec2 suv = gl_FragCoord.xy / uRes + N.xz * clamp(hb, 0.0, 10.0) * 0.012 * (1.0 - smoothstep(0.5, 3.0, uFp));
          vec3 seen = texture2D(uRefr, clamp(suv, 0.002, 0.998)).rgb;
          vec3 Tv = exp(-mix(vec3(0.45, 0.07, 0.045), vec3(0.22, 0.055, 0.04), bh) * hb / cosT);
          sh = seen * Tv + mix(vec3(0.0, 0.11, 0.17), vec3(0.0, 0.17, 0.2), bh) * (1.0 - Tv.g) * (0.6 + 0.6 * uSun.y * cs) + vec3(0.03, 0.30, 0.31) * sss * 0.4;
        }
        if (uSatOn > 0.5 && uRefrOn < 0.5 && inCoast(wpos.xz)) {          // 衛星写真で礁の浅瀬（はっきり青緑の所）が分かれば、その模様を重ねる（屈折で海底を見ているときは不要）
          vec3 s = satAt(wpos.xz);
          float tq = smoothstep(0.05, 0.16, s.g - s.r) * smoothstep(0.04, 0.12, s.b - s.r) * (1.0 - smoothstep(5.0, 16.0, hW));
          sh = mix(sh, s * 1.25, tq * 0.6);
        }
        // 水深による色の帯（ラグーンの色）: 白い砂の浅瀬は明るい水色、5〜15m は鮮やかな青緑、礁の縁から先は急に濃い青になる
        vec3 band = mix(vec3(0.16, 0.80, 0.76), vec3(0.03, 0.44, 0.68), smoothstep(3.0, 16.0, hb));
        band = mix(band, vec3(0.01, 0.12, 0.36), smoothstep(16.0, 34.0, hb));
        band *= 0.55 + 0.9 * uSun.y * cs;
        sh = mix(sh, band * (0.6 + 0.4 * dot(sh, vec3(0.3, 0.6, 0.1)) / max(dot(band, vec3(0.3, 0.6, 0.1)), 0.01)), mix(0.32, 0.42, smoothstep(1.0, 4.0, hb)) * smoothstep(0.0, 0.6, hb));   // ごく浅い白い砂の上も、明るい水色に
        body = mix(body, sh, 1.0 - smoothstep(28.0, 50.0, hW));
        body = mix(body, vec3(0.005, 0.045, 0.13) * (0.7 + 0.6 * uSun.y), smoothstep(0.03, 0.12, hSlope) * smoothstep(8.0, 22.0, hW) * (1.0 - smoothstep(45.0, 70.0, hW)) * 0.5);   // 礁の縁の急な落ち込みは濃い青
      }
      vec3 col = mix(body, refl, F);
      // 太陽のきらめき: さざ波の面の向きの分布（Beckmann）。遠くて描けないさざ波の傾きはぼけとして広げ、
      // 太陽の下に縦長の光の道ができる（Cox–Munk）
      float s2 = 0.0025 + lost + 0.03 * smoothstep(0.3, 6.0, uFp);
      vec3 H = normalize(V + uSun); float NH = max(dot(N, H), 0.02), NH2 = NH * NH;
      float D = exp(-(1.0 - NH2) / (NH2 * s2)) / (3.14159 * s2 * NH2 * NH2);
      float Fh = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
      col += vec3(1.0, 0.9, 0.74) * Fh * D / (4.0 * max(dot(N, V), 0.12)) * step(0.0, dot(N, uSun)) * 2.2 * smoothstep(0.4, 1.0, cs);   // 雲の影では太陽のきらめきが消える
      // 白波: 波の山が崩れかける所に出て、レース状にちぎれる
      vec2 wd = vec2(-0.94, 0.342);                                    // 風下の向き
      // 貿易風（約 8m/秒）では海面の数 % が白波になる。風上（東）の開けた海ほど多く、島の風下は少ない
      float lace = smoothstep(0.42, 0.58, fbm(pm * 0.45 + wd * uTime * 0.6)) * smoothstep(0.22, 0.48, vn(pm * 2.3 - wd * uTime));
      float cap = smoothstep(${(RMS * 1.15).toFixed(3)}, ${(RMS * 1.6).toFixed(3)}, crest) * lace * smoothstep(0.35, 0.9, windK);   // 高い波の山（ばらつきの約 1.4 倍以上）だけ。白波の量は風速の 3 乗以上で増えるので、風下ではほとんど立たない
      // （以前は風下へ伸びる細い泡の筋も描いていたが、斜めから見ると雨のような線に見えるのでやめた。泡の跡は下の resid で表す）
      float bub = mix(1.0, smoothstep(0.22, 0.62, vn(pmL * 6.5 + wd * uTime * 0.3)) * (0.45 + 0.55 * smoothstep(0.3, 0.7, vn(pmL * 17.0 - uTime * 0.2))), 1.0 - smoothstep(0.05, 0.4, uFp));   // 泡の中の細かい穴（近くだけ）
      // 泡が残って流れる: 白波が崩れた後の泡は数秒かけて消え、その間に網目や筋にちぎれていく。
      // 少し前の時刻に波の山がどこで崩れていたかを調べ、その跡に網目の泡を残す
      float resid = 0.0;
      if (uFp < 6.0) {
        for (int i = 1; i <= 5; i++) {
          float ago = float(i) * 0.8, tp = uTime - ago;
          float was = smoothstep(${(RMS * 1.05).toFixed(3)}, ${(RMS * 1.45).toFixed(3)}, crestAt(pmL, tp)) * smoothstep(0.5, 0.7, vn(pm * 0.45 + wd * tp * 0.6));
          resid = max(resid, was * exp(-ago / 3.0) * smoothstep(0.35, 0.9, windK));
        }
        // 残った泡は、白波より薄く、まだらにちぎれた形（風に流されてゆっくり動く）
        vec2 q = pm * 0.35 + wd * uTime * 0.1;
        float patchy = smoothstep(0.42, 0.62, fbm(q)) * smoothstep(0.3, 0.75, vn(pmL * 1.6 + 11.0));
        resid *= patchy * 0.45 * (1.0 - smoothstep(1.5, 6.0, uFp));
      }
      float foam = clamp(max(cap * bub, resid), 0.0, 1.0) * (1.0 - smoothstep(1.5, 6.0, uFp));
      float surf = 0.0, wash = 0.0;
      if (sw.H > 0.0) {
        // 岸へ寄せる波が崩れる: 山の先が白くはじけて前の面を流れ落ち、白い泡の段（ボア）が岸へ進む。後ろには泡が長く残る
        float wf = max(0.12, sw.pf);
        float white = smoothstep(0.98 - wf, 0.995, sw.psi) + (1.0 - smoothstep(0.0, 0.22 + sw.pf, sw.psi));
        float trail = exp(-sw.psi * 2.5) * 0.4;
        float lip = (1.0 - smoothstep(0.0, 0.05 + sw.pf, sw.psi)) * smoothstep(0.25, 0.7, sw.br);   // 崩れ始めの白いしぶき
        surf = sw.br * sw.fresh * clamp(white + trail, 0.0, 1.0) + lip;
        surf = mix(surf, sw.br * sw.fresh * 0.4, smoothstep(0.2, 0.6, sw.pf));   // 遠くは平均の白さ
        vec2 q = pm * 0.3 - sw.dir * uTime * 0.5;                           // 泡のまだら（岸の方へ流れる）
        float web = smoothstep(0.38, 0.62, fbm(q)) * (0.6 + 0.4 * smoothstep(0.3, 0.7, vn(pmL * 1.4 + 5.0)));
        surf *= mix(1.0, web * mix(1.0, bub, 0.5), smoothstep(0.1, 0.5, sw.psi) * (1.0 - smoothstep(0.85, 0.95, sw.psi)));   // 後ろに残る泡はまだらにちぎれる
        surf += sw.br * 0.1 * web;                                          // 崩れた後の海に残る泡
        // 礁の縁（崩れたばかりの所）: 次々に崩れる波で、いつも白く泡立った帯になる。大きな波が崩れた直後ほど白い
        float zone = sw.br * smoothstep(0.75, 0.97, sw.fresh) * smoothstep(0.25, 0.9, sw.H);
        surf += zone * (0.35 + 0.5 * exp(-sw.psi * 3.0)) * (0.55 + 0.45 * web) * mix(1.0, bub, 0.4);
        wash = (1.0 - smoothstep(0.0, 0.1, hW)) * smoothstep(0.004, 0.02, hSlope) * (0.4 + 0.6 * exp(-sw.psi * 2.5));
      } else {
        // 島から離れた浅瀬: 浅くなる所で波が崩れて白く泡立ち、帯になって寄せる
        float surfZone = 1.0 - smoothstep(0.6, 2.8, hW);
        float band = smoothstep(0.3, 0.95, sin(hW * 2.4 + uTime * 0.85 + vn(pm * 0.03) * 6.0) * 0.5 + 0.5);
        surf = surfZone * smoothstep(0.012, 0.05, hSlope) * band * band * mix(1.0, bub, 0.6) * smoothstep(0.2, 0.55, vn(pm * 0.8 + vec2(uTime * 0.25, 0.0)) * 0.6 + 0.4 * band);
        wash = (1.0 - smoothstep(0.0, 0.1, hW)) * smoothstep(0.004, 0.02, hSlope) * (0.5 + 0.5 * band);   // 浜に打ち寄せた波の泡（礁原の平らな所には出さない）
      }
      foam = max(foam, clamp(surf + wash * 0.55, 0.0, 1.0) * mix(1.0, 0.55, smoothstep(3.0, 30.0, uFp)));
      col = mix(col, vec3(0.9, 0.93, 0.95) * (0.55 + 0.55 * cs) * (0.75 + 0.35 * max(dot(N, uSun), 0.0)), foam * 0.85);
      col = mix(col, skyColR(normalize(vec3(-V.x, 0.002, -V.z))), exp(-abs(V.y) * 30.0) * 0.85);
      return vec4(tmo(col), F);
    } else {
      // 水中から見上げる: 屈折して見える空（スネルの窓）と、その外側の全反射
      vec3 I = -V;
      vec3 tr = refract(I, -N, 1.333);
      vec3 col;
      vec3 under = waterBg(reflect(I, -N));                             // 全反射: 下の水が鏡のように映る
      if (dot(tr, tr) < 0.001) col = under;
      else {
        float Ft = 0.02 + 0.98 * pow(1.0 - abs(dot(I, N)), 5.0);
        col = skyCol(normalize(tr)) * (1.0 - Ft) * 1.1 + under * Ft;
        col += vec3(1.0, 0.96, 0.88) * pow(max(dot(normalize(tr), uSun), 0.0), 900.0) * 10.0 * uBeau * (1.0 - Ft);   // 浅瀬: 波で砕けた太陽のきらめき
      }
      col = mix(col, waterBg(I), 1.0 - exp(-dist * uFogDen));             // 遠くは、その向きの水の明るさに溶ける（上ほど明るい）
      return vec4(col, 1.0);
    }
  }`;

// ---------- 空 ----------
const UTM = { value: 1 };                                              // 1 = 海と空がそれぞれ明るさを変換する（後処理がないとき）
const SKYU = { uSkyCube: { value: null }, uSkyOn: { value: 0 }, uDisk: { value: 1 } };   // 空の画像（下の「空を画像にしておく」）
const CAM_UNDER = { value: 0 };                                         // 1 = カメラが水中（海面を下から見る）
const BEAU_U = { value: 0 };
const UW = () => ({ uBeau: BEAU_U, uCamUnder: CAM_UNDER, uWater: { value: new THREE.Color() }, uUw: { value: 0 }, uSunA: { value: 1 }, uSunUw: { value: sunUw }, uTM: UTM, uSkyCube: SKYU.uSkyCube, uSkyOn: SKYU.uSkyOn, uDisk: SKYU.uDisk });
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({
  uniforms: Object.assign({ uSun: { value: SUN }, uTime: { value: 0 }, uUnder: { value: 0 } }, UW()), side: THREE.BackSide, depthWrite: false, extensions: { shaderTextureLOD: true },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
  fragmentShader: `${COMMON} uniform float uUnder; varying vec3 vD; void main(){ vec3 d = normalize(vD);
    if (uUnder > 0.5) { gl_FragColor = vec4(waterBg(d), 1.0); return; }   // 水中では、向きで明るさの変わる水の色
    // 水平線のすぐ下（海面の端と本当の水平線のすき間）は、水平線のかすみの色を続ける（暗い色だと、水平線に黒い線が出る）
    vec3 c = d.y < 0.0 ? mix(skyCol(normalize(vec3(d.x, 1e-4, d.z))), vec3(0.01,0.07,0.12), smoothstep(-0.02, -0.15, d.y)) : skyCol(d); gl_FragColor = vec4(tmo(c), 1.0); }`
}));
sky.renderOrder = -2;
scene.add(sky);

// ---------- 空を画像にしておく ----------
// 雲は 1 点ごとに何十回もノイズを計算するので、空のドームと海面の映り込み（画面の大半）で毎回計算すると重い。
// 2 秒ごとに 6 方向の画像に描き（雲はゆっくりしか動かない）、ふだんはそれを読むだけにする
const cubeOk = !!(renderer.capabilities.isWebGL2 || renderer.extensions.get('OES_texture_half_float_linear'));
const cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: cubeOk ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
const cubeCam = new THREE.CubeCamera(0.1, 10, cubeRT), cubeScene = new THREE.Scene();
const cubeSky = new THREE.Mesh(new THREE.SphereGeometry(5, 48, 24), new THREE.ShaderMaterial({
  uniforms: Object.assign({}, sky.material.uniforms, { uDisk: { value: 0 }, uSkyOn: { value: 0 }, uSkyCube: { value: null } }), side: THREE.BackSide, depthWrite: false, extensions: { shaderTextureLOD: true },   // 描いている画像そのものは読まない
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `${COMMON} varying vec3 vD; void main(){ vec3 d = normalize(vD);
    // 水平線より下も、水平線の空の色を続ける（画像をなめらかに読むと下の暗い色がにじみ、海面の映り込みで水平線に黒い線が出るため）
    vec3 c = skyAt(normalize(vec3(d.x, max(d.y, 0.0), d.z) + vec3(0.0, 1e-4, 0.0)), true); gl_FragColor = vec4(c, 1.0); }`
}));
cubeScene.add(cubeSky, cubeCam);
SKYU.uSkyCube.value = cubeRT.texture;
let cubeAt = -1e9;
function updateSkyCube(t, show) {
  const q = window.__DIVE && window.__DIVE.quality;
  SKYU.uSkyOn.value = q === 'high' ? 1 : 2;                             // 高画質: 空のドームは毎回計算して細かく、映り込みは画像
  if (!show || t - cubeAt < 2) return;                                  // 空が見えていないときは描き直さない
  cubeAt = t;
  const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
  renderer.autoClear = true; cubeCam.update(renderer, cubeScene); renderer.autoClear = ac; renderer.setRenderTarget(prev);
}

// ---------- 遠景の海面（平面＋法線だけの波） ----------
// HI: カメラの近くの基準点 (m)。4,096m きざみ（float でもちょうど表せる）
const HI = { value: new THREE.Vector2() }, HI_STEP = 4096;
const rect = T.rect;
const farMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({
    uSun: { value: SUN }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFogDen: { value: 6 },
    uRect: { value: new THREE.Vector4(rect.x0, rect.x1, rect.z0, rect.z1) }, uReal: { value: 0 }, uNear: { value: new THREE.Vector3(0, 0, 0) },
    uHi: HI, uLo: { value: new THREE.Vector2() }, uPh: PH
  }, UW(), SHORE_U()),
  transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true, shaderTextureLOD: true },
  vertexShader: 'uniform vec2 uLo; varying vec3 vW; varying vec2 vL; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = position.xz * 1000.0 + uLo; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `${COMMON} uniform vec3 uFog; uniform float uFogDen, uReal; uniform vec4 uRect; uniform vec3 uNear; uniform vec2 uHi; varying vec3 vW; varying vec2 vL;
    ${SURFACE_FN}
    void main(){
      if (uNear.z > 0.0 && distance(vW.xz, uNear.xy) < uNear.z) discard;   // 近景メッシュの範囲は描かない
      if (uReal > 0.5 && waterDepth(vW.xz) < 0.2) discard;                 // 陸と、ごく浅い波打ち際には海面を描かない（地形の濡れた砂を見せる）
      pmL = vL;
      if (cameraPosition.y < 0.0) { gl_FragColor = vec4(shadeSurface(uHi + vL, vW).rgb, 1.0); return; }
      // 地図風の海（俯瞰・上空）: データ範囲の上は半透明にして海溝を見せる
      vec3 V = normalize(cameraPosition - vW);
      float Fs = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
      vec3 styl = mix(vec3(0.05, 0.22, 0.32), vec3(0.50, 0.68, 0.78), Fs * 0.6);
      float inside = smoothstep(uRect.x, uRect.x + 8.0, vW.x) * smoothstep(uRect.y, uRect.y - 8.0, vW.x)
                   * smoothstep(uRect.z, uRect.z + 8.0, vW.z) * smoothstep(uRect.w, uRect.w - 8.0, vW.z);
      vec3 col = styl; float a = mix(1.0, mix(0.3, 0.9, Fs), inside);
      if (uReal > 0.001) {
        vec4 s = shadeSurface(uHi + vL, vW);
        col = mix(styl, s.rgb, uReal); a = mix(a, 1.0, uReal);
        a *= 1.0 - uReal * smoothstep(900.0, 1300.0, length(cameraPosition.xz - vW.xz));   // 海面の板の端（約 1,700km 先）は消し、空の水平線のかすみに任せる（端の 1 行が線に見えるため）
      }
      gl_FragColor = vec4(col, a);
    }`
});
// 板は細かく分け（1 マス約 27km）、カメラについて 4,096m きざみで動かす。
// 1 枚の大きな板のままだと、画素ごとの位置の補間の誤差が数十 cm になり、細かい模様が縦すじに崩れるため
const far = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400, 128, 128).rotateX(-Math.PI / 2), farMat);
far.renderOrder = 1;
scene.add(far);

// ---------- 近景の海面（頂点を動かす立体的な波。カメラに追従） ----------
const NEAR_R = 0.45, NEAR_SEG = 300;
const nearGeo = new THREE.PlaneGeometry(NEAR_R * 2, NEAR_R * 2, NEAR_SEG, NEAR_SEG);
nearGeo.rotateX(-Math.PI / 2);
const geoWaves = WAVES.filter(w => w.L >= 7).map(w =>
  `{ float ph = ${w.k.toFixed(5)} * dot(vec2(${w.dx.toFixed(4)}, ${w.dz.toFixed(4)}), p) - ${w.w.toFixed(5)} * uTime;
     off += vec3(${(w.Q * w.A * w.dx).toFixed(5)} * cos(ph), ${w.A.toFixed(4)} * sin(ph), ${(w.Q * w.A * w.dz).toFixed(5)} * cos(ph))${w.sea ? ' * wk' : ''}; }`).join('\n        ');
const nearMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uSun: { value: SUN }, uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFogDen: { value: 6 }, uR: { value: NEAR_R }, uLo: { value: new THREE.Vector2() }, uPh: PH }, UW(), SHORE_U()),
  side: THREE.DoubleSide, extensions: { derivatives: true, shaderTextureLOD: true },
  vertexShader: `uniform float uTime, uR; uniform vec2 uLo; varying vec3 vW; varying vec2 vP; varying vec2 vL; ${SHORE_GLSL}
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vec2 p = w.xz * 1000.0; vP = p; vL = position.xz * 1000.0 + uLo;
      vec3 off = vec3(0.0); float wk = windExp(w.xz);
        ${geoWaves}
      float taper = 1.0 - smoothstep(uR * 0.7, uR, length(position.xz)), hd = waterDepth(w.xz);
      off *= 0.12 + 0.88 * smoothstep(1.0, 22.0, hd);                   // 浅瀬では沖の波が低い（代わりに岸へ寄せる波）
      SWv sw = shoreWave(w.xz, p, hd, uTime, wk, 0.0);
      if (sw.H > 0.0) {
        off.y += sw.eta;
        // 崩れかけた波の山は、岸の方へ前のめりに倒れ込む
        float cr = exp(-pow(min(sw.psi, 1.0 - sw.psi) / 0.07, 2.0));
        off.xz += sw.dir * sw.H * 0.45 * cr * max(sw.sh, sw.br) * (1.0 - 0.6 * sw.br);
      }
      w.xyz += off / 1000.0 * taper;
      vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `${COMMON} uniform vec3 uFog; uniform float uFogDen, uR; varying vec3 vW; varying vec2 vP; varying vec2 vL;
    ${SURFACE_FN}
    void main(){ if (waterDepth(vW.xz) < 0.2) discard; pmL = vL; gl_FragColor = vec4(shadeSurface(vP, vW).rgb, 1.0); }`
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
    void main(){ float a = pow(clamp(1.0 - vT, 0.0, 1.0), 1.6) * (1.0 - abs(vS)) * uI;
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


// ---------- 礁の縁のしぶきともや ----------
// 岸へ寄せる波（上の swParams）が崩れたばかりの所から、白いしぶきを打ち上げ（1〜2 秒で落ちる）、
// 細かい水しぶきは薄いもやになって風下へ流れる（10 秒ほどで消える）。遠くからでも「波が砕けている海岸」と分かるように。
// 位置は世界の m で持ち、描くときはカメラからの差にする（大きな座標のままだと精度が足りない）
const SPRAY_N = 1600, MIST_N = 260, PN = SPRAY_N + MIST_N;
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
sprayGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(PN), 1));
sprayGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(PN), 1));
sprayGeo.setAttribute('aMist', new THREE.BufferAttribute(Float32Array.from({ length: PN }, (_, i) => (i >= SPRAY_N ? 1 : 0)), 1));
const sprayMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 }, uSun: { value: SUN } },
  vertexShader: `attribute float aSize, aAlpha, aMist; uniform float uScale; varying float vA, vM;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      float d = max(-mv.z, 0.001); vA = aAlpha * exp(-d * 0.35); vM = aMist;   // 遠くは空気にかすむ（km）
      gl_PointSize = clamp(aSize * 0.001 * uScale / d, 0.0, 400.0); }`,
  fragmentShader: `uniform vec3 uSun; varying float vA, vM;
    void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0; if (r > 1.0) discard;
      float a = vM > 0.5 ? pow(1.0 - r, 2.0) : smoothstep(1.0, 0.3, r) * (0.75 + 0.25 * fract(sin(dot(floor(gl_PointCoord * 6.0), vec2(12.9, 78.2))) * 43758.5));
      vec3 c = vec3(0.95, 0.97, 0.98) * (0.8 + 0.35 * uSun.y) + vec3(0.06, 0.04, 0.0) * (1.0 - vM);
      gl_FragColor = vec4(c, a * vA); }`,
  transparent: true, depthWrite: false
});
const spray = new THREE.Points(sprayGeo, sprayMat);
spray.frustumCulled = false; spray.renderOrder = 2; spray.scale.setScalar(0.001); spray.visible = false;
scene.add(spray);
const sp = { p: new Float64Array(PN * 3), v: new Float32Array(PN * 3), age: new Float32Array(PN).fill(1e9), life: new Float32Array(PN), s0: new Float32Array(PN), a0: new Float32Array(PN) };
let nextSpray = 0, nextMist = SPRAY_N;
// しぶきが出る所の候補（水深 0.8〜4m の、礁の縁や浜の手前）。カメラが 400m 動くたびに、まわり 4km 四方を少しずつ調べ直す
const BREAK = { list: [], scan: null, cx: NaN, cz: NaN };
function scanBreakers(camX, camZ) {
  if (!ISLAND || !SW_TAU) return;
  const b = SH_G.box;
  if (!BREAK.scan || Math.hypot(camX - BREAK.cx, camZ - BREAK.cz) > 0.4) {
    if (camX < b.x - 3 || camX > b.y + 3 || camZ < b.z - 3 || camZ > b.w + 3) { BREAK.list = []; return; }
    BREAK.cx = camX; BREAK.cz = camZ; BREAK.scan = { i: 0, out: [] };
  }
  const S2 = BREAK.scan, STEP = 0.025, NS = 160;                         // 25m 間隔、4km 四方
  for (let k = 0; k < 2500 && S2.i < NS * NS; k++, S2.i++) {
    const x = BREAK.cx + ((S2.i % NS) - NS / 2) * STEP, z = BREAK.cz + (Math.floor(S2.i / NS) - NS / 2) * STEP;
    if (x <= b.x || x >= b.y || z <= b.z || z >= b.w) continue;
    const h = T.floorDepth(x, z); if (h < 0.8 || h > 4) continue;
    S2.out.push({ x: x * 1000, z: z * 1000, h, tau: gridAt(SW_TAU, ISLAND, x, z), wk: windAt(x, z), wave: -1 });
  }
  if (S2.i >= NS * NS && S2.out) { BREAK.list = S2.out; S2.out = null; }
}
function emitSpray(c, H, t) {
  // 波の進む向き（届く時刻の傾き）と、風下の向き
  const e = 0.03, gx = gridAt(SW_TAU, ISLAND, c.x / 1000 + e, c.z / 1000) - gridAt(SW_TAU, ISLAND, c.x / 1000 - e, c.z / 1000), gz = gridAt(SW_TAU, ISLAND, c.x / 1000, c.z / 1000 + e) - gridAt(SW_TAU, ISLAND, c.x / 1000, c.z / 1000 - e);
  const gl = Math.hypot(gx, gz) || 1, dx = gx / gl, dz = gz / gl;
  const n = Math.round(6 + H * 10);
  for (let k = 0; k < n; k++) {
    const i = nextSpray; nextSpray = (nextSpray + 1) % SPRAY_N;
    const j = (Math.random() - 0.5) * 40;                                // 波の山に沿って広げる
    sp.p[i * 3] = c.x - dz * j + (Math.random() - 0.5) * 4; sp.p[i * 3 + 1] = H * (0.4 + Math.random() * 0.4); sp.p[i * 3 + 2] = c.z + dx * j + (Math.random() - 0.5) * 4;
    const up = (1.5 + Math.random() * 3) * Math.min(1.6, H), fw = 1 + Math.random() * 3;
    sp.v[i * 3] = dx * fw + WIND_TO[0] * 2; sp.v[i * 3 + 1] = up; sp.v[i * 3 + 2] = dz * fw + WIND_TO[1] * 2;
    sp.age[i] = 0; sp.life[i] = 1.4 + Math.random() * 1.4; sp.s0[i] = 2 + Math.random() * 4 * H; sp.a0[i] = 0.45 + Math.random() * 0.4;
  }
  if (Math.random() < 0.7 * Math.min(1, H)) {                          // 細かい水しぶきは、もやになって残る
    const i = nextMist; nextMist = SPRAY_N + ((nextMist - SPRAY_N + 1) % MIST_N);
    sp.p[i * 3] = c.x + (Math.random() - 0.5) * 20; sp.p[i * 3 + 1] = 1 + Math.random() * 2 * H; sp.p[i * 3 + 2] = c.z + (Math.random() - 0.5) * 20;
    sp.v[i * 3] = WIND_TO[0] * (3 + Math.random() * 2) + dx * 0.5; sp.v[i * 3 + 1] = 0.25; sp.v[i * 3 + 2] = WIND_TO[1] * (3 + Math.random() * 2) + dz * 0.5;
    sp.age[i] = 0; sp.life[i] = 10 + Math.random() * 8; sp.s0[i] = 18 + Math.random() * 22 * H; sp.a0[i] = 0.08 + 0.07 * Math.min(1, H);
  }
}
let sprayT = 0;
// 近くで波が砕ける音の大きさ（砕けるたびに増え、数秒で消える）。audio.js が低い波の音に使う
const SURF = { e: 0 };
function updateSpray(t, show, near) {
  const dt = Math.min(0.1, Math.max(0, t - sprayT)); sprayT = t;
  const cam = camera.position;
  spray.visible = show;
  SURF.e *= Math.exp(-dt / 2.5);
  if (!show && !near) return;
  scanBreakers(cam.x, cam.z);
  const cxm = cam.x * 1000, czm = cam.z * 1000;
  for (const c of BREAK.list) {
    const pr = swParams(c.h, c.tau, t, c.x, c.z, c.wk), wave = Math.floor(SW_W * (t - c.tau) / 6.2832);
    if (pr.br > 0.45 && pr.psi < 0.1 && wave !== c.wave && pr.H > 0.25) {
      c.wave = wave;
      if (show) emitSpray(c, pr.H, t);
      SURF.e += pr.H * Math.exp(-Math.hypot(c.x - cxm, c.z - czm) / 350) * 0.15;   // 近い砕け波ほど大きく聞こえる
    }
  }
  if (!show) return;
  const pa = sprayGeo.attributes.position, sz = sprayGeo.attributes.aSize, al = sprayGeo.attributes.aAlpha;
  for (let i = 0; i < PN; i++) {
    if (sp.age[i] > sp.life[i]) { al.array[i] = 0; continue; }
    sp.age[i] += dt;
    const mist = i >= SPRAY_N, u = sp.age[i] / sp.life[i];
    if (!mist) { sp.v[i * 3 + 1] -= 9.8 * dt; const k = Math.exp(-dt * 1.2); sp.v[i * 3] *= k; sp.v[i * 3 + 2] *= k; }
    sp.p[i * 3] += sp.v[i * 3] * dt; sp.p[i * 3 + 1] += sp.v[i * 3 + 1] * dt; sp.p[i * 3 + 2] += sp.v[i * 3 + 2] * dt;
    if (!mist && sp.p[i * 3 + 1] < 0) sp.age[i] = 1e9;                   // 海に落ちたら消える
    pa.array[i * 3] = sp.p[i * 3] - cxm; pa.array[i * 3 + 1] = sp.p[i * 3 + 1] - cam.y * 1000; pa.array[i * 3 + 2] = sp.p[i * 3 + 2] - czm;
    sz.array[i] = sp.s0[i] * (mist ? 1 + u * 1.5 : 1 + u * 0.8);
    al.array[i] = sp.a0[i] * (mist ? Math.sin(Math.PI * Math.min(1, u * 1.3)) : (1 - u) * Math.min(1, u * 8));
  }
  spray.position.copy(cam);
  pa.needsUpdate = sz.needsUpdate = al.needsUpdate = true;
  sprayMat.uniforms.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan(camera.fov * Math.PI / 360));
}

// ---------- 毎フレームの更新 ----------
const water = new THREE.Color();
const RAYK = { k: 1 };                                                 // 光の筋の強さ（creatures.js が浅い礁で弱める）
function update(t, { dive, under, depth, ex, surfaceOn }) {
  CAM_UNDER.value = under ? 1 : 0;
  BEAU_U.value = under ? T.beautyK(Math.max(0, depth)) : 0;
  far.visible = dive || surfaceOn;
  const camY = camera.position.y;
  [sky.material, farMat, nearMat, rayMat].forEach(m => m.uniforms.uTime.value = t);
  sky.position.copy(camera.position);
  updateSkyCube(t, !under || camera.position.y > -0.4);
  sky.visible = true;
  sky.material.uniforms.uUnder.value = under ? 1 : 0;
  T.waterColor(Math.max(0, depth), water, camera.position.x, camera.position.z);
  const silt = window.__LIFE ? window.__LIFE.silt : 0;                  // 舞い上がった泥の濁りも、地形の霧（nav.js）と同じ色にそろえる
  if (under && silt > 0.01) water.lerp(window.__LIFE.siltColor, silt * 0.8);
  const dd = Math.max(0, depth), uw = under ? 1 - Math.min(1, Math.max(0, (dd - 1000) / 500)) : 1, sa = under ? Math.exp(-dd / 60) : 1;
  [sky.material, farMat, nearMat].forEach(m => { m.uniforms.uWater.value.copy(water); m.uniforms.uUw.value = uw; m.uniforms.uSunA.value = sa; });
  T.terrainMat.uniforms.uUpw.value = under ? uw : 0;
  // 水中から見上げた海面も、遠くは水の色に溶ける
  const turb = T.turbidity(camera.position.x, camera.position.z) * Math.exp(-dd / 40);   // 港の中や河口は濁って、見上げた海面も近くしか見えない
  [farMat, nearMat].forEach(m => { m.uniforms.uFog.value.copy(water); m.uniforms.uFogDen.value = under ? 12 * (1 + 3 * turb) : 25 / ex; });   // 見上げる向きは光が上から来るので、横より遠くまで見える
  // 高度2kmから300mまで降りる間に、写実的な海面へ切り替える
  const k = Math.min(1, Math.max(0, (camY - 0.3) / 1.7));
  farMat.uniforms.uReal.value = dive ? 1 - k * k * (3 - 2 * k) : 0;
  T.terrainMat.uniforms.uReal.value = farMat.uniforms.uReal.value;
  T.terrainMat.uniforms.uSunDir.value.copy(SUN);
  // 近景メッシュは、潜航中にカメラが海面付近にいるときだけ使う
  const useNear = dive && camY < 0.35 && camY > -0.4;
  near.visible = useNear;
  if (useNear) {
    const cell = NEAR_R * 2 / NEAR_SEG;
    near.position.set(Math.round(camera.position.x / cell) * cell, 0, Math.round(camera.position.z / cell) * cell);
  }
  farMat.uniforms.uNear.value.set(near.position.x, near.position.z, useNear ? NEAR_R * 0.98 : 0);
  // 細かい模様の基準点（カメラの近く、4,096m きざみ）。遠景の板はちょうど基準点に置く
  HI.value.set(Math.floor(camera.position.x * 1000 / HI_STEP) * HI_STEP, Math.floor(camera.position.z * 1000 / HI_STEP) * HI_STEP);
  updatePhases(HI.value.x, HI.value.y);
  far.position.set(HI.value.x / 1000, 0, HI.value.y / 1000);
  farMat.uniforms.uLo.value.set(far.position.x * 1000 - HI.value.x, far.position.z * 1000 - HI.value.y);
  nearMat.uniforms.uLo.value.set(near.position.x * 1000 - HI.value.x, near.position.z * 1000 - HI.value.y);
  // 光芒: 浅いところほど強い
  rayMat.uniforms.uCam.value.copy(camera.position);
  rayMat.uniforms.uDir.value.set(refrSun.x, refrSun.y * ex, refrSun.z).normalize();
  rayMat.uniforms.uLen.value = 0.03 * ex;
  rayMat.uniforms.uI.value = under ? Math.exp(-depth / 35) * Math.min(1, depth / 2) * RAYK.k : 0;
  rays.visible = rayMat.uniforms.uI.value > 0.01;
  bubMat.uniforms.uEx.value = ex;
  updateSpray(t, (dive || surfaceOn) && camY > -0.002 && camY < 1.5 && farMat.uniforms.uReal.value > 0.5, dive && depth < 80);   // しぶきは海面より上から見ているときだけ。砕ける音は浅い海の中でも
}
function splashBubbles(origin) { bubMat.uniforms.uOrigin.value.copy(origin); bubMat.uniforms.uAge.value = 0; }
function tickBubbles(dt) { bubMat.uniforms.uAge.value += dt; }

// ---------- 浅瀬の海底を透かす ----------
// 海面より上から浅い海を見ているとき、海面を描く前に、海底の地形だけを日の光で照らした画像（半分の大きさ）に描いておく。
// 海面はそれを、波の傾きでずらして読む（屈折）。地形は「水中の見え方」（砂・サンゴ・光の網目・水深による光の弱まり）で描き、霧はかけない
let refrRT = null;
const REFR_LAYER = 2;
function refractPass() {
  const cam = camera.position, q = window.__DIVE && window.__DIVE.quality;
  const on = q !== 'low' && cam.y > 0 && cam.y < 2 && farMat.uniforms.uReal.value > 0.5 && T.floorDepth(cam.x, cam.z) < 400;
  REFR.uRefrOn.value = on ? 1 : 0;
  if (!on) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(1, size.x >> 1), h = Math.max(1, size.y >> 1);
  if (!refrRT || refrRT.width !== w || refrRT.height !== h) {
    if (refrRT) refrRT.dispose();
    const hdr = renderer.capabilities.isWebGL2;
    refrRT = new THREE.WebGLRenderTarget(w, h, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: true });   // 奥行きは 24bit（post.js と同じ理由）
    REFR.uRefr.value = refrRT.texture;
  }
  REFR.uRes.value.set(size.x, size.y);
  const U = T.terrainMat.uniforms, keep = { d: U.uDive.value, f: U.uFogDen.value, l: U.uLampR.value, s: U.uSonar.value };
  U.uDive.value = 1; U.uFogDen.value = 0; U.uLampR.value = 0; U.uSonar.value = 0; U.uFlat.value = 1;   // 海底は実際の深さで（近くのサンゴ・生き物とそろえる）
  const prev = renderer.getRenderTarget(), bg = scene.background, mask = camera.layers.mask, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  scene.background = null; camera.layers.set(REFR_LAYER);
  renderer.setRenderTarget(refrRT); renderer.setClearColor(0x0a3a4a, 1); renderer.clear();
  renderer.render(scene, camera);
  window.__LIFE?.renderRefr?.();                                         // 浅瀬の生き物・サンゴ・近くの海底も、海面ごしに見えるように
  camera.layers.mask = mask; scene.background = bg; renderer.setClearColor(cc, ca); renderer.setRenderTarget(prev);
  U.uDive.value = keep.d; U.uFogDen.value = keep.f; U.uLampR.value = keep.l; U.uSonar.value = keep.s; U.uFlat.value = 0;
}
window.__SEA = { setRayScale: k => { RAYK.k = k; }, surfLevel: () => SURF.e, SHARED_GLSL, cloudShadeJS, refractPass, REFR_LAYER, update, waveHeight, orbit, splashBubbles, tickBubbles, SUN, startYaw, setToneMap: on => { UTM.value = on ? 1 : 0; } };
})();
