// 追加の生き物の形と動き（species.js の道具を使う）。各関数は size（m）を受け取り、{ group, animate(t, speed) } を返す。
// group の原点が体の中心、+z が前（頭）、+y が上。設計は体長 1（size 倍して使う）。
// 本物の写真の比率（体高・頭・ひれの位置と大きさ）と配色に合わせて作る。規則正しい模様は避け、ぼかしやまだらで描く
(() => {
const K = window.SPECIES_KIT; if (!K) return;
const { skin, makeBody, makeFan, makeFoil, makeStrip, makeTube, glowPoints, curve, canvasTex, sharedTex } = K;
const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const P = new THREE.Vector3(), Q = new THREE.Vector3();
const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(9157);

// ---------- 共通 ----------
// 体の模様: 横（u）= 周方向（0 = 右側面, 0.25 = 背, 0.5 = 左側面, 0.75 = 腹）、縦（y）= 頭（上）→ 尾（下）
const tex = (key, W, H, draw) => sharedTex(key, () => canvasTex(W, H, draw));
function countershade(x, W, H, back, side, belly, edge = 0.12) {   // 背は暗く、腹は明るい（境目はぼかす）
  const gr = x.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, side); gr.addColorStop(0.25 - edge, back); gr.addColorStop(0.25, back); gr.addColorStop(0.25 + edge, back);
  gr.addColorStop(0.5, side); gr.addColorStop(0.75 - edge, belly); gr.addColorStop(0.75, belly); gr.addColorStop(0.75 + edge, belly); gr.addColorStop(1, side);
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
}
function mottle(x, W, H, n, r0, r1, rgba, yMin = 0, yMax = 1, uBand = null) {   // ぼかしたまだら（周の継ぎ目では反対側にも描く）
  for (let i = 0; i < n; i++) {
    const u = uBand ? uBand[0] + rnd() * (uBand[1] - uBand[0]) : rnd(), cx = u * W, cy = (yMin + rnd() * (yMax - yMin)) * H, r = r0 + rnd() * (r1 - r0);
    for (const sh of [-W, 0, W]) { const gr = x.createRadialGradient(cx + sh, cy, 0, cx + sh, cy, r); gr.addColorStop(0, rgba); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)')); x.fillStyle = gr; x.fillRect(cx + sh - r, cy - r, r * 2, r * 2); }
  }
}
// ひれの材質: 付け根から先へ色が変わる（頂点の色）。半透明
const finMat = (opacity = 0.9, roughness = 0.5) => skin({ color: 0xffffff, vertexColors: true, opacity, rim: 0x9ab0c0, rimAmount: 0.25, clearcoat: 0.3, roughness });
function colorStrip(mesh, n, c0, c1) {                                 // makeStrip の帯: 付け根 c0 → 先 c1
  const c = new Float32Array(n * 2 * 3); for (let k = 0; k < n; k++) { c.set(c0, k * 6); c.set(c1, k * 6 + 3); }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(c, 3)); return mesh;
}
function colorFoil(geo, span, f) {                                    // makeFoil: 付け根からの距離 a（0〜1）と表裏（y の正負）で色を決める
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(f(Math.min(1, Math.abs(p.getX(i)) / span), p.getY(i), p.getZ(i)), i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
const eyeM = () => new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.04, clearcoat: 1, metalness: 0.2 });

// 泳ぐ生き物の共通の作り（魚・サメ・クジラ）。
//   W(s), H(s): 半分の幅・高さ（s: 0 頭の先 → 1 尾の付け根）、shape(s, th): 断面の形の倍率、yc(s): 体の中心の上下
//   amp(s), k, freq: 体のくねり（振れ幅・波の数・1 秒の回数）。vertical: 尾を上下に振る（クジラ）。rigid: 体を曲げず尾だけ振る（マグロ類）
//   fins: [{ s0, s1, up(1 背 / -1 腹), h(u), back, c0, c1, flap }]、tails: [{ foil, rotZ, c }]、pecs: [{ s, th, foil, rot: [x, y, z], c, flap }]
function swimmer(size, o) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const hull = makeBody(o.NS || 56, o.NR || 28, o.skinM, o.warp); body.add(hull);
  let ph = 0, A = 1;
  const wave = s => o.rigid ? 0 : o.amp(s) * A * Math.sin(ph - s * o.k);
  const center = (s, out) => o.vertical ? out.set(0, (o.yc ? o.yc(s) : 0) + wave(s), 0.5 - s) : out.set(wave(s), o.yc ? o.yc(s) : 0, 0.5 - s);
  const surf = (s, th, out) => { center(s, P); const k = o.shape ? o.shape(s, th) : 1; return out.set(P.x + Math.cos(th) * o.W(s) * k, P.y + Math.sin(th) * o.H(s) * k, P.z); };
  const fm = finMat(o.finOpacity || 0.9);
  const fins = (o.fins || []).map(f => { const n = f.n || 10, m = colorStrip(makeStrip(n, fm), n, f.c0, f.c1); body.add(m); return { f, m, b: Array.from({ length: n }, () => new THREE.Vector3()), t: Array.from({ length: n }, () => new THREE.Vector3()) }; });
  const tailPv = new THREE.Group(); body.add(tailPv);
  (o.tails || []).forEach(tl => { const m = new THREE.Mesh(colorFoil(makeFoil(tl.foil), tl.foil.span, tl.c), fm); m.rotation.z = tl.rotZ; tailPv.add(m); });
  const pecs = (o.pecs || []).flatMap(pc => [1, -1].map(sd => { const pv = new THREE.Group(); body.add(pv); const m = new THREE.Mesh(colorFoil(makeFoil(pc.foil), pc.foil.span, pc.c), pc.mat || fm); m.scale.x = sd; pv.add(m); return { pv, sd, pc }; }));
  const ctx = { body, g, surf, center, hull };
  if (o.extra) o.extra(ctx);
  g.scale.setScalar(size);
  const R = new THREE.Vector3();
  function animate(t, speed = 1) {
    const sp = Math.min(2, Math.max(0.3, speed || 1));
    ph = t * Math.PI * 2 * o.freq * (0.75 + 0.25 * sp); A = 0.85 + 0.15 * sp;
    hull.userData.update(center, o.W, o.H, o.shape);
    fins.forEach(({ f, m, b, t: tp }) => {
      const n = b.length;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1), s = f.s0 + (f.s1 - f.s0) * u, hh = f.h(u);
        surf(s, f.up > 0 ? Math.PI / 2 : -Math.PI / 2, b[k]); b[k].y -= f.up * 0.15 * o.H(s);   // 付け根は少し体に埋める
        tp[k].set(b[k].x + (f.flap ? f.flap * hh * Math.sin(ph * (f.flapF || 1)) : 0), b[k].y + f.up * hh * 1.15, b[k].z - (f.back || 0) * hh);
      }
      m.userData.update(b, tp);
    });
    center(1, P); center(0.96, R);
    tailPv.position.copy(P);
    if (o.vertical) tailPv.rotation.x = Math.atan2(P.y - R.y, 0.04) * 1.3 + (o.tailBeat || 0) * Math.sin(ph - 1.2);
    else tailPv.rotation.y = -Math.atan2(P.x - R.x, 0.04) * 1.3 + (o.tailBeat || 0) * Math.sin(ph);
    pecs.forEach(({ pv, sd, pc }) => {
      surf(pc.s, sd > 0 ? pc.th : Math.PI - pc.th, pv.position);
      pv.rotation.set(pc.rot[0], -sd * pc.rot[1], sd * (pc.rot[2] + (pc.flap ? pc.flap * Math.sin(ph * (pc.flapF || 0.5)) : 0)), 'YXZ');   // rot[1] がマイナスなら、ひれの先を後ろへ流す
    });
    if (o.onAnim) o.onAnim(t, ph, ctx);
  }
  animate(0);
  return { group: g, animate, ctx };
}
// 目: 体の面（s, th）に、黒い瞳と、まわりの輪
function addEyes(ctx, s, th, r, ring = 0x8a8f96) {
  const ringM = new THREE.MeshStandardMaterial({ color: ring, metalness: 0.5, roughness: 0.35 }), em = eyeM(), eyes = [];
  [1, -1].forEach(sd => {
    const e = new THREE.Group(), ball = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), em), rg = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * 0.18, 8, 20), ringM);
    ball.scale.x = 0.55; rg.rotation.y = Math.PI / 2; e.add(ball, rg); ctx.body.add(e); eyes.push({ e, sd });
  });
  return () => eyes.forEach(({ e, sd }) => { ctx.surf(s, sd > 0 ? th : Math.PI - th, e.position); });
}
// エラ・えらあな: 体の模様に描く（頭の後ろの縦の線）
function gillLines(x, W, H, s0, s1, n, uMid, uHalf, rgba, wd) {
  x.strokeStyle = rgba; x.lineWidth = wd;
  for (const um of [uMid, 0.5 - uMid]) for (let k = 0; k < n; k++) { const y = (s0 + (s1 - s0) * k / Math.max(1, n - 1)) * H; x.beginPath(); x.moveTo((um - uHalf) * W, y); x.quadraticCurveTo(um * W, y + 4, (um + uHalf) * W, y); x.stroke(); }
}

// ---------- クロカジキ（Makaira nigricans） ----------
// 体長 3〜4m（くちばしを含む）。上あごが槍のように長く伸び、背びれの前の方は高く、後ろへ急に低くなる。尾びれは三日月形。
// 背は濃い紺、腹は銀白色。興奮すると、わき腹に淡い青の縦じま（十数本）が浮かぶ。胸びれは細長く、体に沿ってたためる
function buildMarlin(size) {
  const W = curve([0, 0.05, 0.2, 0.42, 0.7, 0.9, 1], [0.012, 0.04, 0.062, 0.06, 0.036, 0.014, 0.01]);
  const H = curve([0, 0.05, 0.2, 0.42, 0.7, 0.9, 1], [0.014, 0.058, 0.1, 0.096, 0.056, 0.02, 0.014]);
  const map = tex('marlin', 512, 512, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#0b1a42', '#5f7895', '#e8edf0', 0.1);
    x.globalAlpha = 0.5; x.fillStyle = '#9ec8f0';                      // わき腹の縦じま（淡い青、ぼかす）
    for (let k = 0; k < 15; k++) { const y = (0.22 + k * 0.042) * Ht; for (const u of [0.07, 0.43]) { const gr = x.createLinearGradient(0, y - 4, 0, y + 4); gr.addColorStop(0, 'rgba(158,200,240,0)'); gr.addColorStop(0.5, 'rgba(158,200,240,.8)'); gr.addColorStop(1, 'rgba(158,200,240,0)'); x.fillStyle = gr; x.fillRect(u * Wd - 22, y - 4, 44, 8); } }
    x.globalAlpha = 1;
    mottle(x, Wd, Ht, 60, 6, 18, 'rgba(10,25,60,.25)', 0, 1, [0.15, 0.35]);
  });
  const skinM = new THREE.MeshPhysicalMaterial({ map, metalness: 0.45, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const dark = [0.05, 0.08, 0.2], blue = [0.12, 0.2, 0.42];
  return swimmer(size, {
    W, H, skinM, amp: s => 0.05 * Math.pow(s, 2.4), k: 3.0, freq: 1.1, tailBeat: 0.2, finOpacity: 0.85,
    fins: [{ s0: 0.12, s1: 0.5, up: 1, n: 14, h: u => 0.13 * Math.pow(1 - u, 1.1) * (0.7 + 0.3 * Math.sin(Math.min(1, u * 6) * Math.PI / 2)) + 0.012, back: 0.35, c0: dark, c1: blue },
      { s0: 0.86, s1: 0.9, up: 1, n: 4, h: u => 0.03 * Math.sin(Math.PI * u), back: 0.6, c0: dark, c1: dark },
      { s0: 0.58, s1: 0.68, up: -1, n: 6, h: u => 0.07 * (1 - u), back: 0.5, c0: dark, c1: blue },
      { s0: 0.87, s1: 0.9, up: -1, n: 4, h: u => 0.025 * Math.sin(Math.PI * u), back: 0.6, c0: dark, c1: dark }],
    tails: [{ rotZ: Math.PI / 2, c: () => dark, foil: { span: 0.22, both: true, le: a => -0.01 - 0.15 * Math.pow(a, 1.3), te: a => -0.01 - 0.15 * Math.pow(a, 1.3) - 0.055 * (1 - a) - 0.012, th: a => 0.012 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.24, th: -0.55, rot: [0.15, -1.15, -0.5], c: (a) => mix3(dark, blue, a), foil: { span: 0.2, le: a => -0.06 * a * a, te: a => -0.06 * a * a - 0.035 * (1 - a) - 0.008, th: a => 0.008 * (1 - a) + 0.001 } }],
    extra: ctx => {
      const bill = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.3, 10).rotateX(Math.PI / 2).translate(0, 0, 0.15), new THREE.MeshPhysicalMaterial({ color: 0x1a2236, roughness: 0.4, clearcoat: 0.6 }));
      bill.position.set(0, 0.004, 0.5); ctx.body.add(bill);                  // 上あごの槍
      const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.06, 8).rotateX(Math.PI / 2).translate(0, 0, 0.03), new THREE.MeshPhysicalMaterial({ color: 0x3a4258, roughness: 0.45 }));
      jaw.position.set(0, -0.01, 0.495); ctx.body.add(jaw);
      ctx.eyes = addEyes(ctx, 0.05, 0.1, 0.012, 0x6a7a90);
    },
    onAnim: (t, ph, ctx) => ctx.eyes()
  });
}

// ---------- ジンベエザメ（Rhincodon typus） ----------
// 世界最大の魚（10m 以上）。平たく幅の広い頭の先に、横に大きく開いた口。背と体の横に、前後に走る 3 本ずつの隆起。
// 濃い灰青色の地に、白い斑点と、淡い縦横の線の格子模様（1 頭ずつ違う）。腹は白い。尾びれは上の葉が大きい三日月形
function buildWhaleShark(size) {
  const W = curve([0, 0.04, 0.15, 0.35, 0.6, 0.85, 1], [0.075, 0.1, 0.115, 0.112, 0.078, 0.034, 0.014]);
  const H = curve([0, 0.04, 0.15, 0.35, 0.6, 0.85, 1], [0.035, 0.055, 0.074, 0.085, 0.066, 0.03, 0.012]);
  const map = tex('whaleshark', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#2a3b4c', '#4d6170', '#e6e8e6', 0.11);
    // 格子: 縦（体を巻く向き）と横（前後）の淡い線。背と体の横だけ
    x.strokeStyle = 'rgba(205,215,220,.45)'; x.lineWidth = 3;
    for (let k = 0; k < 20; k++) { const y = (0.18 + k * 0.042 + (rnd() - 0.5) * 0.01) * Ht; x.beginPath(); for (let u = -0.02; u <= 0.52; u += 0.02) { const yy = y + Math.sin(u * 30 + k) * 3; u > -0.02 ? x.lineTo(u * Wd, yy) : x.moveTo(u * Wd, yy); } x.stroke(); }
    for (const u of [0.05, 0.12, 0.19, 0.31, 0.38, 0.45]) { x.beginPath(); x.moveTo(u * Wd, 0.2 * Ht); x.lineTo(u * Wd + (rnd() - 0.5) * 8, 0.95 * Ht); x.stroke(); }
    // 白い斑点（線の間に並ぶ。頭は小さく細かい）
    for (let i = 0; i < 1400; i++) { const u = rnd() * 0.54 - 0.02, y = rnd(), r = (y < 0.18 ? 2.2 : 4.5) + rnd() * 2.5; x.fillStyle = `rgba(232,236,236,${0.55 + rnd() * 0.35})`; x.beginPath(); x.arc(((u + 1) % 1) * Wd, y * Ht, r, 0, 7); x.fill(); }
    gillLines(x, Wd, Ht, 0.16, 0.22, 5, 0.05, 0.07, 'rgba(25,32,40,.75)', 4);
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x9aa8b0, rimAmount: 0.12, clearcoat: 0.35, roughness: 0.6, side: THREE.FrontSide });
  const finC = [0.18, 0.24, 0.3];
  const ridge = (th, c, wdt) => Math.exp(-Math.pow((th - c) / wdt, 2));
  return swimmer(size, {
    W, H, skinM, NS: 64, NR: 36,
    shape: (s, th) => {
      const sn = Math.sin(th), c = Math.abs(Math.cos(th)), q = Math.abs(sn), head = 1 - ss(0.05, 0.3, s);
      let k = 1 + (Math.pow(c ** 3 + q ** 3, -1 / 3) - 1) * head * 0.8;    // 頭は平たい角の丸い四角
      if (s > 0.12 && s < 0.85) { const r = 0.05 * ss(0.12, 0.25, s) * (1 - ss(0.65, 0.85, s)); k *= 1 + r * (ridge(th, Math.PI / 2, 0.08) + ridge(th, 1.05, 0.08) + ridge(th, Math.PI - 1.05, 0.08) + ridge(th, 0.45, 0.07) + ridge(th, Math.PI - 0.45, 0.07)); }   // 背と横の隆起
      return k;
    },
    amp: s => 0.05 * Math.pow(s, 2), k: 3.2, freq: 0.22, tailBeat: 0.12,
    fins: [{ s0: 0.48, s1: 0.62, up: 1, n: 8, h: u => 0.095 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.3 * u), back: 0.55, c0: finC, c1: finC },
      { s0: 0.79, s1: 0.83, up: 1, n: 5, h: u => 0.032 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: finC },
      { s0: 0.8, s1: 0.84, up: -1, n: 5, h: u => 0.028 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: finC },
      { s0: 0.55, s1: 0.62, up: -1, n: 5, h: u => 0.035 * Math.sin(Math.PI * u), back: 0.5, c0: [0.8, 0.82, 0.82], c1: [0.7, 0.72, 0.72] }],   // 腹びれ
    tails: [{ rotZ: Math.PI / 2, c: () => finC, foil: { span: 0.23, le: a => 0.01 - 0.17 * Math.pow(a, 1.2), te: a => -0.06 - 0.12 * Math.pow(a, 1.2) - 0.012, th: a => 0.02 * (1 - a) + 0.002 } },
      { rotZ: -Math.PI / 2, c: () => finC, foil: { span: 0.14, le: a => 0.0 - 0.09 * Math.pow(a, 1.2), te: a => -0.05 - 0.06 * Math.pow(a, 1.2) - 0.012, th: a => 0.016 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.25, th: -0.15, rot: [0.25, -0.55, -0.35], c: (a, y) => y < 0 ? [0.85, 0.86, 0.86] : finC, foil: { span: 0.19, le: a => -0.05 * a * a, te: a => -0.05 * a * a - 0.06 * (1 - a) - 0.012, th: a => 0.016 * (1 - a) + 0.002 } }],
    extra: ctx => {
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.3), new THREE.MeshBasicMaterial({ color: 0x0b0d0f, side: THREE.DoubleSide }));
      mouth.scale.set(0.075, 0.03, 0.02); mouth.rotation.x = Math.PI / 2; ctx.body.add(mouth); ctx.mouth = mouth;
      ctx.eyes = addEyes(ctx, 0.06, -0.05, 0.006, 0x50585e);
    },
    onAnim: (t, ph, ctx) => { ctx.surf(0.0, -Math.PI / 2, P); ctx.mouth.position.set(P.x, P.y * 0.4, P.z + 0.003); ctx.eyes(); }
  });
}

// ---------- ヨゴレ（Carcharhinus longimanus） ----------
// 外洋のサメ（2〜3m）。先が丸く大きな第 1 背びれと、長いへら形の胸びれ。ひれの先が、まだらに白い。吻は短く丸い。
// 背は青銅色を帯びた灰色、腹は白い。ゆったりと泳ぐ
function buildOceanicWhitetip(size) {
  const W = curve([0, 0.04, 0.15, 0.35, 0.62, 0.86, 1], [0.012, 0.048, 0.08, 0.088, 0.062, 0.028, 0.014]);
  const H = curve([0, 0.04, 0.15, 0.35, 0.62, 0.86, 1], [0.012, 0.045, 0.082, 0.098, 0.068, 0.03, 0.016]);
  const map = tex('oceanicwhitetip', 512, 512, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#5a5548', '#7b766a', '#ecebe6', 0.09);
    mottle(x, Wd, Ht, 80, 8, 26, 'rgba(70,64,52,.22)', 0.05, 0.95, [0.1, 0.4]);
    gillLines(x, Wd, Ht, 0.17, 0.23, 5, 0.03, 0.06, 'rgba(40,36,30,.55)', 2);
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0xb0a890, rimAmount: 0.12, clearcoat: 0.45, roughness: 0.5, side: THREE.FrontSide });
  const finC = [0.36, 0.34, 0.29], tipC = [0.93, 0.93, 0.9];
  const tipped = (a, y, z) => mix3(finC, tipC, ss(0.45, 0.72, a) * (0.8 + 0.2 * Math.sin(z * 120 + a * 40)));
  return swimmer(size, {
    W, H, skinM, amp: s => 0.065 * Math.pow(s, 1.6), k: 4.0, freq: 0.55, tailBeat: 0.15,
    yc: s => 0.006 * (1 - ss(0, 0.08, s)),
    shape: (s, th) => 1 - 0.12 * Math.max(0, -Math.sin(th)) * (1 - ss(0, 0.2, s)),
    fins: [{ s0: 0.3, s1: 0.46, up: 1, n: 10, h: u => 0.17 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.55) * (1 - 0.25 * u), back: 0.45, c0: mix3(finC, tipC, 0.25), c1: tipC },
      { s0: 0.76, s1: 0.8, up: 1, n: 4, h: u => 0.025 * Math.sin(Math.PI * u), back: 0.6, c0: finC, c1: finC },
      { s0: 0.77, s1: 0.81, up: -1, n: 4, h: u => 0.025 * Math.sin(Math.PI * u), back: 0.6, c0: finC, c1: tipC },
      { s0: 0.58, s1: 0.64, up: -1, n: 5, h: u => 0.04 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: tipC }],
    tails: [{ rotZ: Math.PI / 2, c: tipped, foil: { span: 0.27, le: a => 0.01 - 0.2 * Math.pow(a, 1.2), te: a => -0.05 - 0.17 * Math.pow(a, 1.2) - 0.012, th: a => 0.014 * (1 - a) + 0.002 } },
      { rotZ: -Math.PI / 2, c: tipped, foil: { span: 0.13, le: a => -0.08 * Math.pow(a, 1.2), te: a => -0.045 - 0.05 * Math.pow(a, 1.2) - 0.01, th: a => 0.012 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.24, th: -0.6, rot: [0.18, -0.45, -0.3], c: tipped, foil: { span: 0.28, le: a => -0.07 * a * a, te: a => -0.07 * a * a - 0.075 * (1 - 0.55 * a) - 0.01, th: a => 0.012 * (1 - a) + 0.002 } }],
    extra: ctx => { ctx.eyes = addEyes(ctx, 0.06, 0.02, 0.008, 0x4a4436); },
    onAnim: (t, ph, ctx) => ctx.eyes()
  });
}

// ---------- マンボウ（Mola mola） ----------
// 左右に平たい円盤のような体（体長 1.5〜3m）。尾びれはなく、体の後ろは「舵びれ」で、縁が波打つ。背びれとしりびれは高く、
// 左右にそろって打ち振って泳ぐ。口は小さく、くちばし状の歯。灰色〜銀色で、白っぽいまだら。皮膚は厚く、ざらざら
function buildMola(size) {
  const W = curve([0, 0.08, 0.3, 0.6, 0.85, 1], [0.028, 0.07, 0.1, 0.095, 0.075, 0.06]);
  const H = curve([0, 0.08, 0.3, 0.6, 0.85, 1], [0.05, 0.2, 0.33, 0.33, 0.25, 0.18]);
  const map = tex('mola', 512, 512, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#5d6a72', '#87949a', '#c8cfd0', 0.15);
    mottle(x, Wd, Ht, 160, 6, 22, 'rgba(225,230,230,.35)');
    mottle(x, Wd, Ht, 60, 10, 30, 'rgba(60,70,78,.25)');
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0xc0c8cc, rimAmount: 0.15, clearcoat: 0.15, roughness: 0.75, side: THREE.DoubleSide, bump: 0.6 });
  const finC = [0.4, 0.44, 0.47], finT = [0.56, 0.6, 0.62];
  return swimmer(size, {
    W, H, skinM, rigid: true, amp: () => 0, k: 0, freq: 0.5, NR: 32,
    fins: [{ s0: 0.66, s1: 0.8, up: 1, n: 10, h: u => 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.7), back: 0.35, c0: finC, c1: finT, flap: 0.8, flapF: 1 },
      { s0: 0.66, s1: 0.8, up: -1, n: 10, h: u => 0.4 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.7), back: 0.35, c0: finC, c1: finT, flap: 0.8, flapF: 1 }],
    pecs: [{ s: 0.3, th: 0.15, rot: [0, -1.1, 0], c: () => finC, flap: 0.3, flapF: 2, foil: { span: 0.07, le: a => -0.01 * a, te: a => -0.01 * a - 0.04 * (1 - 0.4 * a), th: a => 0.006 } }],
    extra: ctx => {
      // 舵びれ: 体の後ろの切り口をふさぐ、縁が波打つ板
      const clav = makeFan(25, skinM); ctx.body.add(clav); ctx.clav = clav;
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.008, 8, 16), new THREE.MeshPhysicalMaterial({ color: 0x8a9294, roughness: 0.5 }));
      mouth.position.set(0, -0.005, 0.505); ctx.body.add(mouth);
      ctx.eyes = addEyes(ctx, 0.12, 0.25, 0.022, 0x9aa2a6);
    },
    onAnim: (t, ph, ctx) => {
      ctx.center(1, P); const tips = [];
      for (let k = 0; k < 25; k++) { const a = -Math.PI / 2 + Math.PI * k / 24, wav = 1 + 0.1 * Math.abs(Math.sin(a * 7)); tips.push(new THREE.Vector3(P.x, P.y + Math.sin(a) * H(1) * 1.05 * wav, P.z - 0.05 - 0.05 * Math.cos(a) * wav)); }
      ctx.clav.userData.update(new THREE.Vector3(P.x, P.y, P.z + 0.02), tips);
      ctx.eyes();
    }
  });
}

// ---------- カツオ（Katsuwonus pelamis）の群れ ----------
// 体長 50〜80cm。紡錘形の体で、背は濃い青紫、腹は銀白色。腹側に 4〜6 本の黒い縦じま（カツオの目印）。
// 体はほとんど曲げず、三日月形の尾びれを速く振って泳ぐ（マグロ類の泳ぎ方）。尾の付け根の上下に小離鰭が並ぶ
function buildSkipjackSchool(size) {
  const g = new THREE.Group(), N = 32;
  const W = curve([0, 0.05, 0.3, 0.55, 0.8, 0.95, 1], [0.01, 0.06, 0.105, 0.09, 0.04, 0.015, 0.012]);
  const H = curve([0, 0.05, 0.3, 0.55, 0.8, 0.95, 1], [0.01, 0.066, 0.13, 0.11, 0.045, 0.016, 0.013]);
  const map = tex('skipjack', 256, 256, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#1c1f4a', '#6a7aa0', '#eef1f2', 0.08);
    x.strokeStyle = 'rgba(30,34,50,.75)'; x.lineWidth = 2.5;          // 腹の縦じま
    for (const u of [0.6, 0.64, 0.68, 0.82, 0.86, 0.9]) { x.beginPath(); x.moveTo(u * Wd, 0.25 * Ht); x.bezierCurveTo(u * Wd + 2, 0.5 * Ht, u * Wd - 2, 0.7 * Ht, (u + (u < 0.75 ? 0.04 : -0.04)) * Wd, 0.88 * Ht); x.stroke(); }
  });
  const bodyMat = new THREE.MeshPhysicalMaterial({ map, metalness: 0.5, roughness: 0.28, clearcoat: 0.9 });
  const fm = finMat(0.9), dark = [0.12, 0.13, 0.28];
  const center = (s, out) => out.set(0, 0, 0.5 - s);
  const hull = makeBody(28, 16, bodyMat); hull.userData.update(center, W, H);
  const strip = (s0, s1, up, n, h, c0, c1) => { const m = colorStrip(makeStrip(n, fm), n, c0, c1), b = [], tp = []; for (let k = 0; k < n; k++) { const u = k / (n - 1), s = s0 + (s1 - s0) * u; b.push(new THREE.Vector3(0, up * H(s) * 0.85, 0.5 - s)); tp.push(new THREE.Vector3(0, up * (H(s) * 0.85 + h(u)), 0.5 - s - 0.3 * h(u))); } m.userData.update(b, tp); return m.geometry; };
  const finGeos = [strip(0.28, 0.45, 1, 7, u => 0.065 * Math.pow(1 - u, 0.6), dark, dark), strip(0.5, 0.57, 1, 4, u => 0.05 * Math.sin(Math.PI * u), dark, dark), strip(0.55, 0.6, -1, 4, u => 0.04 * Math.sin(Math.PI * u), [0.8, 0.82, 0.85], [0.7, 0.72, 0.75])];
  for (let k = 0; k < 7; k++) { const s = 0.64 + k * 0.042; finGeos.push(strip(s, s + 0.02, 1, 2, () => 0.018, dark, [0.7, 0.62, 0.3]), strip(s, s + 0.02, -1, 2, () => 0.016, dark, [0.7, 0.62, 0.3])); }   // 小離鰭
  const tailGeo = colorFoil(makeFoil({ span: 0.18, both: true, le: a => -0.01 - 0.11 * Math.pow(a, 1.4), te: a => -0.01 - 0.11 * Math.pow(a, 1.4) - 0.045 * (1 - a) - 0.01, th: a => 0.01 * (1 - a) + 0.002 }), 0.18, () => dark);
  const pecGeo = colorFoil(makeFoil({ span: 0.09, le: a => -0.02 * a, te: a => -0.02 * a - 0.03 * (1 - a) - 0.006, th: () => 0.006 }), 0.09, () => dark);
  const em = eyeM();
  const fish = [];
  for (let i = 0; i < N; i++) {
    const f = new THREE.Group(); f.add(new THREE.Mesh(hull.geometry, bodyMat)); finGeos.forEach(gg => f.add(new THREE.Mesh(gg, fm)));
    const tp = new THREE.Group(); tp.position.set(0, 0, -0.5); const tm = new THREE.Mesh(tailGeo, fm); tm.rotation.z = Math.PI / 2; tp.add(tm); f.add(tp);
    [1, -1].forEach(sd => { const pm = new THREE.Mesh(pecGeo, fm); pm.scale.x = sd; pm.position.set(sd * 0.08, -0.03, 0.27); pm.rotation.set(0.2, sd * -0.9, sd * -0.3, 'YXZ'); f.add(pm);
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), em); e.scale.x = 0.5; e.position.set(sd * 0.042, 0.018, 0.43); f.add(e); });
    f.scale.setScalar(size);
    const off = new THREE.Vector3((rnd() - 0.5) * 9, (rnd() - 0.5) * 4, (rnd() - 0.5) * 14).multiplyScalar(size);
    g.add(f); fish.push({ f, tp, off, ph: rnd() * 10, sp: 0.85 + rnd() * 0.3 });
  }
  function animate(t, speed, ctx) {
    const sc = (ctx && ctx.scare) || 0;
    fish.forEach(F => {
      const tt = t * F.sp + F.ph;
      F.tp.rotation.y = 0.35 * Math.sin(tt * 2 * Math.PI * 2.6);              // 尾だけを速く振る
      F.f.rotation.y = 0.04 * Math.sin(tt * 2 * Math.PI * 2.6 + 1.5) + 0.12 * Math.sin(tt * 0.4);
      F.f.position.copy(F.off).multiplyScalar(1 + 1.8 * sc).add(Q.set(Math.sin(tt * 0.5) * size, Math.sin(tt * 0.7) * size * 0.4, Math.sin(tt * 0.3) * size * 1.5));
    });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ザトウクジラ（Megaptera novaeangliae） ----------
// 体長 13〜15m。体長の 3 分の 1 ほどもある、白く長い胸びれ（前の縁がこぶ状に波打つ）。頭の上とあごに、こぶ（結節）が並ぶ。
// のどから腹へ、たくさんの溝（畝）。背は黒く、のど・腹は白いまだら。尾びれの後ろの縁はぎざぎざで、裏の白黒の模様は 1 頭ずつ違う
function buildHumpback(size) {
  const Wc = curve([0, 0.04, 0.12, 0.3, 0.45, 0.65, 0.82, 0.95, 1], [0.02, 0.05, 0.076, 0.1, 0.1, 0.07, 0.034, 0.014, 0.01]);
  const Hc = curve([0, 0.04, 0.12, 0.3, 0.45, 0.65, 0.82, 0.95, 1], [0.014, 0.038, 0.058, 0.084, 0.09, 0.07, 0.04, 0.02, 0.012]);
  const map = tex('humpback', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#15171b', '#24272c', '#d9dbdc', 0.06);
    mottle(x, Wd, Ht, 50, 20, 60, 'rgba(230,232,232,.4)', 0.05, 0.6, [0.62, 0.88]);   // のど・腹の白いまだら
    mottle(x, Wd, Ht, 40, 15, 45, 'rgba(20,22,26,.45)', 0.1, 0.9, [0.62, 0.88]);
    x.strokeStyle = 'rgba(15,16,18,.5)'; x.lineWidth = 2;              // のどの畝（前後に走る溝）
    for (let k = 0; k < 26; k++) { const u = 0.62 + k * 0.01; x.beginPath(); x.moveTo(u * Wd, 0.02 * Ht); x.quadraticCurveTo(u * Wd + Math.sin(k) * 3, 0.25 * Ht, (0.75 + (u - 0.75) * 0.4) * Wd, 0.5 * Ht); x.stroke(); }
    mottle(x, Wd, Ht, 30, 4, 10, 'rgba(200,200,195,.35)', 0.1, 0.9, [0.05, 0.45]);   // 背の小さな傷・フジツボの跡
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x8a9096, rimAmount: 0.12, clearcoat: 0.5, roughness: 0.5, side: THREE.FrontSide });
  const top = [0.09, 0.1, 0.11], white = [0.88, 0.89, 0.89];
  const res = swimmer(size, {
    W: Wc, H: Hc, skinM, vertical: true, NS: 72, NR: 32, amp: s => 0.032 * Math.pow(Math.max(0, s - 0.35), 1.5) * 4.5, k: 3.0, freq: 0.17, tailBeat: 0.18,
    shape: (s, th) => { const sn = Math.sin(th), head = 1 - ss(0.1, 0.3, s); return 1 - 0.18 * Math.max(0, sn) * head; },   // 頭の上は平たい
    fins: [{ s0: 0.64, s1: 0.71, up: 1, n: 6, h: u => 0.026 * Math.sin(Math.PI * Math.min(1, u * 1.3)), back: 0.8, c0: top, c1: top }],
    // 尾びれの裏は、白地に黒い縁とまだら
    tails: [{ rotZ: 0, c: (a, y, z) => y < 0 ? (a > 0.88 || Math.sin(a * 6 + z * 30) * Math.sin(a * 11 - z * 50) > 0.55 ? top : white) : top, foil: { span: 0.16, both: true, le: a => 0.02 - 0.09 * Math.pow(a, 1.3), te: a => -0.05 - 0.035 * ss(0, 0.25, a) - 0.006 * Math.abs(Math.sin(a * 32)) - 0.01 * a, th: a => 0.014 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.3, th: -0.65, rot: [0.15, -0.85, -0.22], c: (a, y) => y > 0 ? mix3(top, white, ss(0.1, 0.4, a)) : white, flap: 0.12, flapF: 0.5,
      foil: { span: 0.33, le: a => 0.004 * Math.abs(Math.sin(a * 38)) - 0.05 * a * a, te: a => -0.05 * a * a - 0.05 * (1 - 0.6 * a) - 0.006, th: a => 0.012 * (1 - 0.8 * a) } }],
    extra: ctx => {
      // 頭の上・あごのこぶ
      const knobM = skin({ color: 0x1a1c20, rim: 0x8a9096, rimAmount: 0.12, roughness: 0.6 });
      const kg = new THREE.SphereGeometry(1, 8, 6); ctx.knobs = [];
      for (let k = 0; k < 26; k++) { const s = 0.015 + (k % 13) * 0.016, th = k < 13 ? Math.PI / 2 + (k % 2 ? 0.25 : -0.25) : -Math.PI / 2 + (k % 2 ? 0.55 : -0.55); const m = new THREE.Mesh(kg, knobM); m.scale.setScalar(0.0045); ctx.body.add(m); ctx.knobs.push({ m, s, th }); }
      ctx.eyes = addEyes(ctx, 0.18, -0.35, 0.005, 0x2a2c30);
    },
    onAnim: (t, ph, ctx) => { ctx.knobs.forEach(({ m, s, th }) => ctx.surf(s, th, m.position)); ctx.eyes(); }
  });
  return res;
}

// ---------- カツオノエボシ（Physalia physalis） ----------
// 海面に浮かぶ、青紫に透ける浮き袋（長さ 10〜30cm）。上にひだのような帆が立ち、風を受けて流される。
// 浮き袋の下に、青いポリプの房と、何 m も垂れ下がる青い触手。触手には強い毒がある
function buildManOWar(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const floatM = skin({ color: 0x9ab8ff, opacity: 0.55, rim: 0xe8c8ff, rimAmount: 0.8, clearcoat: 1, roughness: 0.12 });
  const crestM = skin({ color: 0xd8a8ff, opacity: 0.6, rim: 0xffc8e8, rimAmount: 0.7, clearcoat: 1, roughness: 0.15 });
  const tentM = skin({ color: 0x2a3cc0, opacity: 0.85, rim: 0x8aa0ff, rimAmount: 0.5, roughness: 0.4 });
  const fl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), floatM); fl.scale.set(0.38, 0.32, 1); body.add(fl);
  const crest = makeStrip(16, crestM); body.add(crest);
  const polyps = []; for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.035 + rnd() * 0.03, 8, 6), tentM); m.position.set((rnd() - 0.5) * 0.18, -0.16 - rnd() * 0.1, (rnd() - 0.6) * 0.5); body.add(m); polyps.push(m); }
  const tents = []; for (let i = 0; i < 9; i++) { const t = makeTube(30, 5, tentM); body.add(t); tents.push({ t, x: (rnd() - 0.5) * 0.2, z: (rnd() - 0.65) * 0.5, L: 6 + rnd() * 10, ph: rnd() * 6, pts: Array.from({ length: 30 }, () => new THREE.Vector3()) }); }
  g.scale.setScalar(size);
  function animate(t) {
    const b = [], tp = [];
    for (let k = 0; k < 16; k++) { const u = k / 15, z = 0.42 - 0.84 * u; b.push(new THREE.Vector3(0, 0.15 * Math.sqrt(Math.max(0, 1 - (z / 0.5) ** 2)), z)); tp.push(new THREE.Vector3(0.015 * Math.sin(u * 20 + t), b[k].y + 0.14 * Math.sin(Math.PI * u) * (0.85 + 0.15 * Math.sin(u * 14)), z - 0.02)); }
    crest.userData.update(b, tp);
    body.rotation.z = 0.12 * Math.sin(t * 0.7); body.rotation.x = 0.05 * Math.sin(t * 0.5);   // 波に揺られる
    tents.forEach(T => { for (let k = 0; k < 30; k++) { const u = k / 29, y = -0.2 - T.L * u; T.pts[k].set(T.x + 0.4 * u * Math.sin(t * 0.4 + T.ph + u * 3), y, T.z + 0.6 * u * Math.sin(t * 0.3 + T.ph * 2 + u * 2)); } T.t.userData.update(T.pts, u => 0.012 * (1 - 0.6 * u) * (1 + 0.5 * Math.max(0, Math.sin(u * 160)))); });   // ところどころ太い（刺胞の房）
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ミズクラゲ（Aurelia aurita） ----------
// 直径 15〜30cm の、平たい乳白色に透ける傘。傘の中に 4 つの馬蹄形の生殖腺（淡い紫〜桃色）が透けて見える。
// 傘の縁には短く細い触手が一面に並び、中央から 4 本のひだのある口腕が垂れる。傘を開いたり閉じたりして泳ぐ
function buildMoonJelly(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bellM = skin({ color: 0xdfe8f0, opacity: 0.3, rim: 0xffffff, rimAmount: 0.6, clearcoat: 1, roughness: 0.1 });
  const gonM = skin({ color: 0xc89ad8, opacity: 0.7, rim: 0xffd8ff, rimAmount: 0.4, roughness: 0.3 });
  const armM = skin({ color: 0xe8e0f0, opacity: 0.45, rim: 0xffffff, rimAmount: 0.5, roughness: 0.2 });
  const prof = [[0, 0.16], [0.15, 0.15], [0.3, 0.12], [0.4, 0.08], [0.47, 0.03], [0.5, -0.01], [0.48, -0.02], [0.4, 0.02], [0.2, 0.05], [0, 0.06]].map(([r, y]) => new THREE.Vector2(r, y));
  const bellGeo = new THREE.LatheGeometry(prof, 64), bell = new THREE.Mesh(bellGeo, bellM); bell.renderOrder = 3; body.add(bell);
  const base = bellGeo.attributes.position.array.slice();
  const gons = []; for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.017, 8, 24, Math.PI * 1.5), gonM); m.rotation.x = Math.PI / 2; m.rotation.z = i * Math.PI / 2 + Math.PI / 4; m.position.set(Math.cos(i * Math.PI / 2 + Math.PI / 4) * 0.13, 0.08, Math.sin(i * Math.PI / 2 + Math.PI / 4) * 0.13); body.add(m); gons.push(m); }
  const arms = []; for (let i = 0; i < 4; i++) { const t = makeTube(12, 6, armM); body.add(t); arms.push({ t, a: i * Math.PI / 2, pts: Array.from({ length: 12 }, () => new THREE.Vector3()) }); }
  const fringe = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.35 }));
  fringe.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(160 * 6), 3)); fringe.frustumCulled = false; body.add(fringe);
  g.scale.setScalar(size);
  function animate(t) {
    const pulse = Math.pow(Math.max(0, Math.sin(t * 2 * Math.PI * 0.6)), 2), p = bellGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2], r = Math.hypot(x, z), k = 1 - 0.14 * pulse * (r / 0.5); p.setXYZ(i, x * k, y + 0.04 * pulse * (r / 0.5) ** 2, z * k); }
    p.needsUpdate = true; bellGeo.computeVertexNormals();
    body.position.y = 0.03 * pulse;
    const rim = 0.5 * (1 - 0.14 * pulse), fp = fringe.geometry.attributes.position;
    for (let i = 0; i < 160; i++) { const a = i / 160 * Math.PI * 2, x = Math.cos(a) * rim, z = Math.sin(a) * rim; fp.setXYZ(i * 2, x, -0.01, z); fp.setXYZ(i * 2 + 1, x * 1.03, -0.09 - 0.03 * Math.sin(t * 2 + i), z * 1.03); }
    fp.needsUpdate = true;
    arms.forEach(A => { for (let k = 0; k < 12; k++) { const u = k / 11; A.pts[k].set(Math.cos(A.a) * (0.03 + 0.05 * u) + 0.02 * Math.sin(t + u * 4 + A.a), -0.02 - 0.32 * u, Math.sin(A.a) * (0.03 + 0.05 * u)); } A.t.userData.update(A.pts, u => 0.028 * (1 - 0.6 * u) * (1 + 0.35 * Math.sin(u * 40))); });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- クシクラゲの仲間（ウリクラゲ Beroe など） ----------
// 長さ 5〜15cm の、透明でやや桃色を帯びた袋のような体。体の表面に 8 列の櫛板（くしいた）が並び、
// 櫛板が波打つと光を散らして、虹色の光が列に沿って流れるように見える（自分で光るのではない）
function buildCombJelly(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bodyM = skin({ color: 0xf2dce0, opacity: 0.25, rim: 0xffffff, rimAmount: 0.7, clearcoat: 1, roughness: 0.08 });
  const prof = [[0, 0.5], [0.12, 0.48], [0.2, 0.4], [0.24, 0.2], [0.25, 0], [0.24, -0.2], [0.21, -0.38], [0.18, -0.48], [0.14, -0.5]].map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), bodyM); shell.renderOrder = 3; shell.rotation.x = Math.PI / 2; body.add(shell);   // 口を後ろへ向けて泳ぐ
  const NROW = 8, NP = 26;
  const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pts.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NROW * NP * 3), 3));
  pts.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NROW * NP * 3), 3)); pts.frustumCulled = false; body.add(pts);
  const rad = curve(prof.map(v => v.y).reverse(), prof.map(v => v.x).reverse());
  for (let r = 0; r < NROW; r++) for (let k = 0; k < NP; k++) { const y = 0.42 - 0.84 * k / (NP - 1), a = r / NROW * Math.PI * 2, rr = rad(y) * 1.02; pts.geometry.attributes.position.setXYZ(r * NP + k, Math.cos(a) * rr, Math.sin(a) * rr, y); }
  const C = new THREE.Color();
  g.scale.setScalar(size);
  function animate(t) {
    const col = pts.geometry.attributes.color;
    for (let r = 0; r < NROW; r++) for (let k = 0; k < NP; k++) { const w = Math.max(0, Math.sin(k * 0.9 - t * 9 + r)); C.setHSL(((k * 0.07 + t * 0.35 + r * 0.13) % 1 + 1) % 1, 1, 0.55); col.setXYZ(r * NP + k, C.r * w, C.g * w, C.b * w); }   // 櫛板の波（虹色が後ろへ流れる）
    col.needsUpdate = true;
    body.rotation.z = t * 0.15;
  }
  animate(0);
  return { group: g, animate };
}

// ---------- サルパ（Salpa maxima など）の連鎖 ----------
// 透明な樽の形の個体（長さ数 cm〜10cm）が、何十個もつながって、長い鎖になって漂う。体の中に、細い筋肉の帯と、橙色の内臓のかたまりが透ける
function buildSalpChain(size) {
  const g = new THREE.Group(), N = 20;
  const barrelM = skin({ color: 0xe8f0f4, opacity: 0.22, rim: 0xffffff, rimAmount: 0.7, clearcoat: 1, roughness: 0.08 });
  const bandM = new THREE.MeshBasicMaterial({ color: 0xd8e4ea, transparent: true, opacity: 0.35 });
  const gutM = new THREE.MeshPhysicalMaterial({ color: 0xd8742a, roughness: 0.4, clearcoat: 0.6 });
  const L = 1 / N, zo = [];
  for (let i = 0; i < N; i++) {
    const z = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, L * 1.6, 16, 1, true), barrelM); b.rotation.z = Math.PI / 2; b.renderOrder = 3; z.add(b);
    for (let k = 0; k < 4; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0012, 4, 20), bandM); r.rotation.y = Math.PI / 2; r.position.x = (k / 3 - 0.5) * L * 1.3; z.add(r); }
    const gut = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), gutM); gut.position.set(L * 0.5, -0.012, 0); z.add(gut);
    g.add(z); zo.push({ z, i });
  }
  g.scale.setScalar(size);
  function animate(t) {
    zo.forEach(({ z, i }) => { const u = i / (N - 1) - 0.5; z.position.set(0.04 * Math.sin(t * 0.4 + u * 6), 0.06 * Math.sin(t * 0.3 + u * 4), u); z.rotation.set(0, 0.25 * Math.sin(t * 0.5 + i), 0.15 * Math.cos(t * 0.4 + u * 6)); });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ヒカリボヤ（Pyrosoma atlanticum） ----------
// 小さな個体が何千も集まってできた、片方が閉じた筒形の群体（長さ 10cm〜数十 cm）。桃色〜乳白色に透け、表面はいぼだらけ。
// 刺激を受けると、青緑の光が群体の中を波のように伝わって光る（名前の由来）
function buildPyrosome(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bump = tex('pyrosomeBump', 256, 256, (x, W, H) => { x.fillStyle = '#606060'; x.fillRect(0, 0, W, H); for (let i = 0; i < 700; i++) { const cx = rnd() * W, cy = rnd() * H, r = 3 + rnd() * 3; const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, '#f0f0f0'); gr.addColorStop(1, '#606060'); x.fillStyle = gr; x.fillRect(cx - r, cy - r, r * 2, r * 2); } });
  const m = skin({ color: 0xf0c8c8, opacity: 0.65, rim: 0xffe8f0, rimAmount: 0.6, clearcoat: 0.8, roughness: 0.3 }); m.bumpMap = bump; m.bumpScale = 0.004 * size;
  const prof = [[0, 0.5], [0.05, 0.48], [0.09, 0.42], [0.11, 0.3], [0.125, 0.0], [0.13, -0.3], [0.13, -0.5], [0.105, -0.5], [0.1, -0.3]].map(([r, y]) => new THREE.Vector2(r, y));
  const tube = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), m); tube.rotation.x = Math.PI / 2; body.add(tube);   // 閉じた先を前（+z）へ
  const NG = 220, glow = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NG * 3), 3)); glow.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NG * 3), 3)); glow.frustumCulled = false; body.add(glow);
  const zs = []; for (let i = 0; i < NG; i++) { const z = 0.45 - rnd() * 0.93, a = rnd() * Math.PI * 2, r = (z > 0.3 ? 0.11 * (0.5 - z) / 0.2 : 0.13) * 1.03; glow.geometry.attributes.position.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r, z); zs.push(z); }
  g.scale.setScalar(size);
  function animate(t) {
    const col = glow.geometry.attributes.color, front = ((t * 0.35) % 1.6) - 0.3;   // 光の波が前から後ろへ伝わる
    for (let i = 0; i < NG; i++) { const w = Math.exp(-Math.pow((0.5 - zs[i] - front) / 0.08, 2)) + 0.08; col.setXYZ(i, 0.2 * w, 0.95 * w, 0.85 * w); }
    col.needsUpdate = true;
    body.rotation.z = 0.2 * Math.sin(t * 0.2);
  }
  animate(0);
  return { group: g, animate };
}

// ---------- デメニギス（Macropinna microstoma） ----------
// 体長 15cm ほど。頭の上が透明なドームでおおわれ、その中に緑色の筒形の目が上を向いている（上から落ちてくる獲物の影を探す）。
// 口の上の 2 つの黒い点は、目に見えるが鼻（嗅覚器）。体は黒褐色で大きなうろこ、胸びれは大きな扇形
function buildBarreleye(size) {
  const W = curve([0, 0.06, 0.2, 0.5, 0.8, 1], [0.02, 0.05, 0.07, 0.06, 0.035, 0.015]);
  const H = curve([0, 0.06, 0.2, 0.5, 0.8, 1], [0.025, 0.07, 0.1, 0.085, 0.045, 0.018]);
  const map = tex('barreleye', 256, 256, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#2a2018', '#4a3a28', '#5a4630', 0.15);
    x.strokeStyle = 'rgba(160,130,90,.35)'; x.lineWidth = 1.2;        // 大きなうろこ（輪郭はぼかす）
    for (let r = 0; r < 12; r++) for (let c = 0; c < 16; c++) { x.beginPath(); x.arc(c * 16 + (r % 2) * 8, r * 22 + 60, 9, 0.3, Math.PI - 0.3); x.stroke(); }
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x8a6a40, rimAmount: 0.25, clearcoat: 0.6, roughness: 0.35, side: THREE.FrontSide });
  const finC = [0.35, 0.28, 0.2], finT = [0.5, 0.42, 0.32];
  return swimmer(size, {
    W, H, skinM, amp: s => 0.04 * Math.pow(s, 2), k: 3, freq: 0.6, finOpacity: 0.65,
    fins: [{ s0: 0.45, s1: 0.55, up: 1, n: 5, h: u => 0.06 * Math.sin(Math.PI * u), back: 0.4, c0: finC, c1: finT }, { s0: 0.6, s1: 0.72, up: -1, n: 5, h: u => 0.05 * Math.sin(Math.PI * u), back: 0.4, c0: finC, c1: finT }],
    tails: [{ rotZ: Math.PI / 2, c: () => finC, foil: { span: 0.1, both: true, le: a => -0.02 * a, te: a => -0.12 + 0.03 * a * a, th: () => 0.006 } }],
    pecs: [{ s: 0.25, th: -0.3, rot: [0.1, -0.2, -0.2], flap: 0.25, flapF: 1.5, c: (a) => mix3(finC, finT, a), foil: { span: 0.22, le: a => 0.04 * Math.sin(a * 2), te: a => -0.12 * Math.sqrt(1 - Math.min(1, a) * 0.6), th: () => 0.004 } }],
    extra: ctx => {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), skin({ color: 0xdff0ec, opacity: 0.18, rim: 0xffffff, rimAmount: 0.9, clearcoat: 1, roughness: 0.04 }));
      dome.scale.set(0.8, 1, 1.7); dome.renderOrder = 4; ctx.body.add(dome); ctx.dome = dome;   // 透明なドーム
      const eyeG = new THREE.CylinderGeometry(0.018, 0.02, 0.05, 14), lensG = new THREE.SphereGeometry(0.02, 12, 8);
      const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x2a8a3a, emissive: 0x0a3a14, roughness: 0.1, clearcoat: 1 }), lensMat = new THREE.MeshPhysicalMaterial({ color: 0x8aff9a, emissive: 0x1a6a2a, roughness: 0.02, clearcoat: 1 });
      ctx.tubes = [1, -1].map(sd => { const e = new THREE.Group(), c = new THREE.Mesh(eyeG, eyeMat), l = new THREE.Mesh(lensG, lensMat); l.position.y = 0.025; e.add(c, l); ctx.body.add(e); return { e, sd }; });
      const nM = new THREE.MeshBasicMaterial({ color: 0x050505 }); ctx.nares = [1, -1].map(sd => { const n = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), nM); ctx.body.add(n); return { n, sd }; });
    },
    onAnim: (t, ph, ctx) => {
      ctx.center(0.22, P); ctx.dome.position.set(P.x, P.y + H(0.22) * 0.55, P.z + 0.03);
      ctx.tubes.forEach(({ e, sd }) => e.position.set(P.x + sd * 0.022, P.y + H(0.22) * 0.75, P.z + 0.02));
      ctx.nares.forEach(({ n, sd }) => { ctx.surf(0.05, sd > 0 ? 0.6 : Math.PI - 0.6, n.position); });
    }
  });
}

// ---------- リュウグウノツカイ（Regalecus glesne） ----------
// 体長 3〜8m（記録は 11m）の、銀色のリボンのような細長い体。背びれは頭から尾まで続く赤いひれで、頭の上では長く伸びて冠のよう。
// 腹びれは細長いオールのような 2 本の赤い糸。体はまっすぐに保ち、背びれを波打たせて泳ぐ（立ち泳ぎもする）
function buildOarfish(size) {
  const W = curve([0, 0.02, 0.08, 0.6, 0.9, 1], [0.008, 0.012, 0.014, 0.011, 0.006, 0.002]);
  const H = curve([0, 0.02, 0.08, 0.6, 0.9, 1], [0.012, 0.026, 0.031, 0.028, 0.018, 0.003]);
  const map = tex('oarfish', 256, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#8a96a4', '#c8d0d8', '#dfe4ea', 0.15);
    for (let i = 0; i < 400; i++) { const u = rnd() * 0.5, v = rnd(); x.fillStyle = `rgba(40,50,70,${0.25 + rnd() * 0.35})`; x.beginPath(); x.ellipse(((u + 0.0) % 1) * Wd, v * Ht, 1.5 + rnd() * 2, 4 + rnd() * 10, 0, 0, 7); x.fill(); }   // 黒っぽい斑点と短い筋
    x.strokeStyle = 'rgba(70,90,120,.35)'; x.lineWidth = 1; for (let k = 0; k < 60; k++) { const y = rnd() * Ht; x.beginPath(); x.moveTo(0, y); x.lineTo(Wd, y + (rnd() - 0.5) * 40); x.stroke(); }
  });
  const skinM = new THREE.MeshPhysicalMaterial({ map, metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide });   // 映すものがないので、金属らしさは控えめにして明るい銀色に
  const red = [0.85, 0.15, 0.12], redT = [0.95, 0.35, 0.3];
  return swimmer(size, {
    W, H, skinM, NS: 110, NR: 14, amp: s => 0.012 + 0.01 * s, k: 9, freq: 0.25,
    fins: [{ s0: 0.06, s1: 0.99, up: 1, n: 60, h: u => 0.032 * (1 - 0.5 * u), back: 0.1, c0: red, c1: redT, flap: 0.9, flapF: 3 }],
    extra: ctx => {
      const rayM = skin({ color: 0xd8302a, rim: 0xff8070, rimAmount: 0.4, roughness: 0.4 });
      ctx.crest = []; for (let k = 0; k < 7; k++) { const tb = makeTube(10, 4, rayM); ctx.body.add(tb); ctx.crest.push({ tb, k, pts: Array.from({ length: 10 }, () => new THREE.Vector3()) }); }
      ctx.pelv = [1, -1].map(sd => { const tb = makeTube(16, 4, rayM); ctx.body.add(tb); const pad = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), rayM); pad.scale.set(1, 0.4, 2.5); ctx.body.add(pad); return { tb, pad, sd, pts: Array.from({ length: 16 }, () => new THREE.Vector3()) }; });
      ctx.eyes = addEyes(ctx, 0.012, 0.2, 0.006, 0xb0b8c0);
    },
    onAnim: (t, ph, ctx) => {
      ctx.crest.forEach(({ tb, k, pts }) => { ctx.surf(0.015 + k * 0.006, Math.PI / 2, P); for (let q = 0; q < 10; q++) { const u = q / 9; pts[q].set(P.x + 0.005 * Math.sin(t * 2 + k + u * 3) * u, P.y + (0.12 - k * 0.012) * u, P.z - 0.06 * u * u - 0.01 * k * u); } tb.userData.update(pts, u => 0.0018 * (1 - 0.5 * u)); });
      ctx.pelv.forEach(({ tb, pad, sd, pts }) => { ctx.surf(0.035, -Math.PI / 2 + sd * 0.2, P); for (let q = 0; q < 16; q++) { const u = q / 15; pts[q].set(P.x + sd * 0.01 * u, P.y - 0.04 * u, P.z - 0.2 * u + 0.01 * Math.sin(t + u * 4)); } tb.userData.update(pts, () => 0.0012); pad.position.copy(pts[15]); });
      ctx.eyes();
    }
  });
}

// ---------- クダクラゲの仲間（管クラゲ目） ----------
// たくさんの個虫がつながってできた群体。前に泳ぐための透明な鐘（泳鐘）が集まり、その後ろに長い幹が何 m も続く。
// 幹には、食べる個虫（橙〜桃色）と、獲物を捕るための細い触手が、くり返し並ぶ。触れると青く光る
function buildSiphonophore(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const bellM = skin({ color: 0xe8f0f8, opacity: 0.25, rim: 0xffffff, rimAmount: 0.8, clearcoat: 1, roughness: 0.06 });
  const stemM = skin({ color: 0xf0e0d8, opacity: 0.6, rim: 0xffffff, rimAmount: 0.4, roughness: 0.3 });
  const gastM = skin({ color: 0xf08a5a, opacity: 0.85, rim: 0xffc0a0, rimAmount: 0.4, roughness: 0.35 });
  const bells = []; for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 12, 1, true), bellM); m.renderOrder = 3; body.add(m); bells.push(m); }
  const NS = 60, stem = makeTube(NS, 5, stemM); body.add(stem);
  const pts = Array.from({ length: NS }, () => new THREE.Vector3());
  const NC = 40, gasts = [], tents = [];
  for (let i = 0; i < NC; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), gastM); m.scale.y = 1.8; body.add(m); gasts.push(m); }
  const tl = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf0d0c8, transparent: true, opacity: 0.35 }));
  tl.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NC * 6), 3)); tl.frustumCulled = false; body.add(tl);
  const glow = glowPoints(NC, 0x6ab8ff, 2.2); body.add(glow);
  g.scale.setScalar(size);
  const at = (u, t, out) => out.set(0.03 * Math.sin(t * 0.3 + u * 7) * u, 0.02 * Math.sin(t * 0.25 + u * 5) * u - 0.01 * u, 0.48 - u * 0.98);
  function animate(t) {
    for (let k = 0; k < NS; k++) at(k / (NS - 1), t, pts[k]);
    stem.userData.update(pts, u => u < 0.05 ? 0.004 : 0.0018);
    bells.forEach((m, i) => { const a = i * 2.4, r = 0.012; m.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.48 - (i % 4) * 0.012); m.rotation.x = -Math.PI / 2; m.scale.setScalar(1 + 0.12 * Math.sin(t * 4 + i)); });
    const tp = tl.geometry.attributes.position, gp = glow.geometry.attributes.position;
    gasts.forEach((m, i) => { const u = 0.08 + i / NC * 0.9; at(u, t, P); m.position.set(P.x, P.y - 0.006, P.z); tp.setXYZ(i * 2, P.x, P.y - 0.008, P.z); tp.setXYZ(i * 2 + 1, P.x + 0.01 * Math.sin(t + i), P.y - 0.06 - 0.02 * Math.sin(t * 0.7 + i), P.z - 0.01); gp.setXYZ(i, P.x, P.y, P.z); });
    tp.needsUpdate = true; gp.needsUpdate = true;
    glow.material.opacity = 0.25 + 0.6 * Math.pow(Math.max(0, Math.sin(t * 0.8)), 6);
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ラブカ（Chlamydoselachus anguineus） ----------
// 体長 1.5〜2m の、ウナギのように細長いサメ。「生きた化石」。口は頭の先端にあり、三つまたの小さな歯が並ぶ。
// 6 対のえらあなの縁がひだ飾りのように波打ち、いちばん前のえらはのどを横切ってつながる。背びれ・しりびれ・尾びれは体の後ろにかたまる。暗い褐色
function buildFrilledShark(size) {
  const W = curve([0, 0.04, 0.1, 0.4, 0.75, 0.95, 1], [0.02, 0.038, 0.044, 0.044, 0.034, 0.014, 0.008]);
  const H = curve([0, 0.04, 0.1, 0.4, 0.75, 0.95, 1], [0.014, 0.034, 0.046, 0.05, 0.04, 0.02, 0.01]);
  const map = tex('frilled', 256, 512, (x, Wd, Ht) => { countershade(x, Wd, Ht, '#2e2620', '#4a3d32', '#5e4e40', 0.15); mottle(x, Wd, Ht, 60, 6, 18, 'rgba(25,20,16,.3)'); });
  const skinM = skin({ color: 0xffffff, map, rim: 0x8a7060, rimAmount: 0.2, clearcoat: 0.5, roughness: 0.45, side: THREE.FrontSide });
  const finC = [0.27, 0.22, 0.18];
  return swimmer(size, {
    W, H, skinM, NS: 80, NR: 20, amp: s => 0.05 * (0.2 + s), k: 7, freq: 0.45,
    shape: (s, th) => 1 - 0.25 * Math.max(0, Math.sin(th)) * (1 - ss(0, 0.08, s)),   // 頭は平たい
    fins: [{ s0: 0.66, s1: 0.74, up: 1, n: 5, h: u => 0.025 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: finC },
      { s0: 0.6, s1: 0.76, up: -1, n: 7, h: u => 0.03 * Math.sin(Math.PI * u), back: 0.4, c0: finC, c1: finC },
      { s0: 0.8, s1: 0.99, up: -1, n: 8, h: u => 0.04 * Math.sin(Math.PI * Math.min(1, u * 1.2)), back: 0.3, c0: finC, c1: finC },
      { s0: 0.86, s1: 0.99, up: 1, n: 6, h: u => 0.015 * Math.sin(Math.PI * u), back: 0.3, c0: finC, c1: finC }],
    pecs: [{ s: 0.17, th: -0.6, rot: [0.1, -0.6, -0.3], c: () => finC, foil: { span: 0.06, le: a => -0.02 * a, te: a => -0.02 * a - 0.04 * (1 - 0.5 * a), th: () => 0.005 } }],
    extra: ctx => {
      const frillM = skin({ color: 0x5a3e34, rim: 0xc08070, rimAmount: 0.35, roughness: 0.5 });
      ctx.frills = []; for (let k = 0; k < 6; k++) { const tb = makeTube(24, 4, frillM); ctx.body.add(tb); ctx.frills.push({ tb, s: 0.075 + k * 0.016, pts: Array.from({ length: 24 }, () => new THREE.Vector3()) }); }
      const toothM = new THREE.MeshPhysicalMaterial({ color: 0xf0ece0, roughness: 0.3, clearcoat: 0.8 });
      ctx.teeth = []; for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(new THREE.ConeGeometry(0.0018, 0.006, 5), toothM); ctx.body.add(m); ctx.teeth.push({ m, a: (k / 13 - 0.5) * 2.4 }); }
      ctx.eyes = addEyes(ctx, 0.045, 0.15, 0.007, 0x6a6a50);
    },
    onAnim: (t, ph, ctx) => {
      ctx.frills.forEach(({ tb, s, pts }) => { for (let q = 0; q < 24; q++) { const th = (k => -Math.PI * 0.5 + k)(q / 23 * Math.PI * 2 - Math.PI * 0.5); ctx.surf(s, th, P); const n = 1.06 + 0.04 * Math.sin(q * 3 + t * 2); pts[q].set(P.x * n, P.y * n, P.z); } tb.userData.update(pts, () => 0.0025); });
      ctx.teeth.forEach(({ m, a }) => { ctx.surf(0.002, -Math.PI / 2 + a * 0.5, P); m.position.set(P.x * 0.8, P.y * 0.6, P.z + 0.004); m.rotation.x = Math.PI / 2 + 0.6; });
      ctx.eyes();
    }
  });
}

// ---------- オオグチボヤ（Megalodicopia hians） ----------
// 深海の海底に立つ、高さ 20〜30cm のホヤ。細い柄の先に、大きな口を開けた頭がつく。口を流れの来る方へ向けて開き、
// 流れてきた小さな生き物が入ると、すばやく口を閉じて食べる。体は半透明で、桃色〜赤みがかった乳白色
function buildGiantAscidian(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const m = skin({ color: 0xf2c8c0, opacity: 0.75, rim: 0xffe0e0, rimAmount: 0.6, clearcoat: 0.8, roughness: 0.3 });
  const inner = skin({ color: 0x5a1418, rim: 0xc04040, rimAmount: 0.3, roughness: 0.55 });   // 口の中は暗い赤
  const stalk = makeTube(12, 8, m); body.add(stalk);
  const head = new THREE.Group(); body.add(head);
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), m); back.scale.set(0.9, 1, 1.15); head.add(back);
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 12), inner); throat.scale.set(1, 0.8, 0.6); throat.position.z = 0.1; head.add(throat);
  const lipG = new THREE.SphereGeometry(0.19, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const upper = new THREE.Group(), lower = new THREE.Group(); head.add(upper, lower);
  const ul = new THREE.Mesh(lipG, m); ul.rotation.x = Math.PI / 2; ul.scale.set(1.25, 1.2, 0.95); upper.add(ul);
  const ll = new THREE.Mesh(lipG, m); ll.rotation.x = Math.PI / 2; ll.scale.set(1.25, 1.2, 0.95); lower.add(ll);
  upper.position.z = lower.position.z = 0.06;
  g.scale.setScalar(size);
  function animate(t) {
    const sp = []; for (let k = 0; k < 12; k++) { const u = k / 11; sp.push(new THREE.Vector3(0.02 * Math.sin(u * 2), u * 0.6, 0.03 * u * u)); }
    stalk.userData.update(sp, u => 0.03 * (1 - 0.5 * u));
    head.position.set(sp[11].x, 0.72, sp[11].z + 0.02); head.rotation.x = 0.15 + 0.03 * Math.sin(t * 0.3);
    const c = ((t % 25) + 25) % 25, shut = ss(0, 0.3, c) * (1 - ss(2.5, 5, c));   // ときどき、すばやく閉じて、ゆっくり開く
    const open = 0.85 * (1 - shut);
    upper.rotation.x = -open; lower.rotation.x = Math.PI + open; lower.scale.y = -1;
  }
  animate(0);
  return { group: g, animate };
}

window.SPECIES = Object.assign(window.SPECIES || {}, {
  marlin: buildMarlin, whaleshark: buildWhaleShark, oceanicwhitetip: buildOceanicWhitetip, mola: buildMola, skipjack: buildSkipjackSchool,
  humpback: buildHumpback, manowar: buildManOWar, moonjelly: buildMoonJelly, combjelly: buildCombJelly, salp: buildSalpChain,
  pyrosome: buildPyrosome, barreleye: buildBarreleye, oarfish: buildOarfish, siphonophore: buildSiphonophore, frilledshark: buildFrilledShark, giantascidian: buildGiantAscidian
});
})();
