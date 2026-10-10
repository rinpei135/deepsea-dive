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
function colorStrip(mesh, n, c0, c1, rays = false) {                   // makeStrip の帯: 付け根 c0 → 先 c1。rays: ひれの筋（軟条）を濃淡で
  const c = new Float32Array(n * 2 * 3); for (let k = 0; k < n; k++) { const r = rays && k % 2 ? 0.72 : 1; c.set(c0.map(v => v * r), k * 6); c.set(c1.map(v => v * r), k * 6 + 3); }
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
  const fins = (o.fins || []).map(f => { const n = f.n || 10, m = colorStrip(makeStrip(n, fm), n, f.c0, f.c1, f.rays); body.add(m); return { f, m, b: Array.from({ length: n }, () => new THREE.Vector3()), t: Array.from({ length: n }, () => new THREE.Vector3()) }; });
  const tailPv = new THREE.Group(); body.add(tailPv);
  (o.tails || []).forEach(tl => { const m = new THREE.Mesh(colorFoil(makeFoil(tl.foil), tl.foil.span, tl.c), fm); m.rotation.z = tl.rotZ; tailPv.add(m); });
  const pecs = (o.pecs || []).flatMap(pc => [1, -1].map(sd => { const pv = new THREE.Group(); body.add(pv); const m = new THREE.Mesh(colorFoil(makeFoil(pc.foil), pc.foil.span, pc.c), pc.mat || fm); m.scale.x = sd; pv.add(m); return { pv, sd, pc }; }));
  const ctx = { body, g, surf, center, hull };
  if (o.extra) o.extra(ctx);
  g.scale.setScalar(size);
  const R = new THREE.Vector3();
  function animate(t, speed = 1, rec) {
    const sp = Math.min(2, Math.max(0.3, speed || 1));
    ph = t * Math.PI * 2 * o.freq * (0.75 + 0.25 * sp); A = speed === 0 ? 0 : 0.85 + 0.15 * sp;   // 速さ 0: 体を曲げない、まっすぐな姿勢（焼き付け・図鑑の絵）
    hull.userData.update(center, o.W, o.H, o.shape);
    // 頭の振れ: 尾を振ると、反動で頭が反対へ少し振れる（体全体が、尾と逆の向きにわずかに揺れる）
    const rc = (o.recoil == null ? 0.004 : o.recoil) * A * Math.sin(ph + 0.6);
    if (o.vertical) body.position.y = -rc; else body.position.x = -rc;
    fins.forEach(({ f, m, b, t: tp }) => {
      const n = b.length;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1), s = f.s0 + (f.s1 - f.s0) * u, hh = f.h(u);
        if (f.side) {                                                     // 体の横のひれ（尾の付け根の隆起など）: 横へ張り出す
          surf(s, f.side > 0 ? 0 : Math.PI, b[k]); b[k].x -= f.side * 0.15 * o.W(s);
          tp[k].set(b[k].x + f.side * hh * 1.15, b[k].y, b[k].z - (f.back || 0) * hh);
        } else {
          surf(s, f.up > 0 ? Math.PI / 2 : -Math.PI / 2, b[k]); b[k].y -= f.up * 0.15 * o.H(s);   // 付け根は少し体に埋める
          tp[k].set(b[k].x + (f.flap ? f.flap * hh * Math.sin(ph * (f.flapF || 1)) : 0), b[k].y + f.up * hh * 1.15, b[k].z - (f.back || 0) * hh);
        }
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
    if (o.onAnim) o.onAnim(t, ph, ctx, rec);
  }
  animate(0);
  return { group: g, animate, ctx };
}
// 細い糸・管（腹びれの糸、口の線など）: pts の関数で毎フレーム作り直す
function addTube(ctx, n, rad, mat, ptsAt, r) {
  const tb = makeTube(n, rad, mat), pts = Array.from({ length: n }, () => new THREE.Vector3()); ctx.body.add(tb);
  return (t, ph) => { for (let k = 0; k < n; k++) ptsAt(k / (n - 1), pts[k], t, ph); tb.userData.update(pts, r); };
}
// ---------- 大物に付き従う小さな魚 ----------
// コバンザメ（Remora remora）: 頭の上の吸盤（横に並ぶひだ）で大きな魚の体に吸い付く。黒っぽい灰色に、体の横の淡い帯。下あごが突き出る
// ブリモドキ（Naucrates ductor）: サメなどの前を泳ぐ。銀青色に、黒い縦の帯が 5〜6 本
function escort(kind) {
  const remora = kind === 'remora';
  const W = remora ? curve([0, 0.12, 0.5, 0.85, 1], [0.035, 0.065, 0.06, 0.028, 0.012]) : curve([0, 0.2, 0.5, 0.85, 1], [0.025, 0.075, 0.07, 0.03, 0.012]);
  const H = remora ? curve([0, 0.12, 0.5, 0.85, 1], [0.025, 0.05, 0.06, 0.03, 0.012]) : curve([0, 0.2, 0.5, 0.85, 1], [0.03, 0.1, 0.095, 0.035, 0.013]);
  const map = remora ? tex('remora', 128, 128, (x, Wd, Ht) => { countershade(x, Wd, Ht, '#2a2c2e', '#4a4c4e', '#3a3c3e', 0.1); x.fillStyle = 'rgba(200,205,205,.55)'; for (const u of [0.02, 0.48]) x.fillRect(u * Wd - 4, 0.15 * Ht, 8, 0.8 * Ht); })
    : tex('pilotfish', 128, 128, (x, Wd, Ht) => { countershade(x, Wd, Ht, '#3a5a7a', '#9ab4c8', '#dfe8ee', 0.1); x.fillStyle = 'rgba(20,28,40,.8)'; for (let k = 0; k < 6; k++) x.fillRect(0, (0.15 + k * 0.13) * Ht, Wd, 0.06 * Ht); });
  const mat = skin({ color: 0xffffff, map, rim: 0x9aa8b0, rimAmount: 0.15, clearcoat: 0.5, roughness: 0.4, side: THREE.FrontSide });
  const g = new THREE.Group(), body = makeBody(20, 12, mat); body.userData.update((s, out) => out.set(0, 0, 0.5 - s), W, H); g.add(body);
  const fm = finMat(0.85), c = remora ? [0.2, 0.21, 0.22] : [0.25, 0.32, 0.4];
  const tail = makeFan(9, fm); colorFan(tail, 9, c); const tp = new THREE.Group(); tp.position.z = -0.5; tp.add(tail); g.add(tp);
  const tips = []; for (let k = 0; k < 9; k++) { const a = (k / 8 - 0.5) * 1.5, fork = remora ? 1 : 1 - 0.35 * Math.cos(k / 8 * Math.PI * 2); tips.push(new THREE.Vector3(0, Math.sin(a) * 0.12 * fork, -Math.cos(a) * 0.14 * fork)); }
  tail.userData.update(new THREE.Vector3(0, 0, 0.02), tips);
  if (remora) {                                                           // 吸盤: 頭の上の楕円の板に、横に並ぶひだ
    const disc = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), skin({ color: 0xffffff, vertexColors: true, rim: 0x9aa8b0, rimAmount: 0.1, roughness: 0.6 }));
    const dp = disc.geometry.attributes.position, dc = new Float32Array(dp.count * 3);
    for (let i = 0; i < dp.count; i++) { const v = Math.sin(dp.getZ(i) * 40) > 0.3 ? 0.18 : 0.42; dc.set([v, v, v * 1.02], i * 3); }
    disc.geometry.setAttribute('color', new THREE.BufferAttribute(dc, 3)); disc.scale.set(0.045, 0.012, 0.14); disc.position.set(0, 0.05, 0.3); g.add(disc);
  }
  return { g, tp, ph: rnd() * 10 };
}
function colorFan(mesh, n, c) { const col = new Float32Array((n + 1) * 3); for (let k = 0; k <= n; k++) col.set(c, k * 3); mesh.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
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
// 体長 3〜4m（くちばしを含む）。上あごが槍のように長く伸び（断面はやや平たい円）、下あごは短くとがる。背びれの前の方は体高ほども高く、
// 後ろへ急に低くなって尾の近くまで続く。尾びれは硬く大きな三日月形で、尾の付け根の左右に 2 本ずつの隆起（キール）。
// 胸びれは細長い鎌形、腹びれは細い糸。背は濃い紺で、つやのある青い光沢。腹は銀白色。興奮すると、わき腹に淡い青の縦じま（十数本）が浮かぶ
function buildMarlin(size) {
  const W = curve([0, 0.04, 0.18, 0.42, 0.7, 0.9, 1], [0.012, 0.036, 0.06, 0.058, 0.034, 0.014, 0.011]);
  const H = curve([0, 0.04, 0.18, 0.42, 0.7, 0.9, 1], [0.013, 0.05, 0.1, 0.096, 0.055, 0.019, 0.013]);
  const map = tex('marlin2', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#091634', '#3c5a80', '#eef1f2', 0.085);
    // 背のつや: 紺の中に、青みの強い所と黒っぽい所のまだら
    mottle(x, Wd, Ht, 140, 14, 46, 'rgba(30,70,150,.25)', 0, 1, [0.1, 0.4]);
    mottle(x, Wd, Ht, 80, 10, 30, 'rgba(5,10,25,.3)', 0, 1, [0.15, 0.35]);
    // わき腹の縦じま（淡い青。上ほど太く、下へ細く消える）
    for (let k = 0; k < 15; k++) {
      const y = (0.2 + k * 0.045) * Ht;
      for (const [u0, u1] of [[-0.04, 0.12], [0.38, 0.54]]) {
        const top = u0 < 0 ? u1 : u0, bot = u0 < 0 ? u0 : u1, n = 24;
        for (let q = 0; q < n; q++) { const a = q / n, u = top + (bot - top) * a, w = 6 * (1 - a) + 1; x.fillStyle = `rgba(150,200,245,${0.65 * (1 - a)})`; x.fillRect(((u + 1) % 1) * Wd - 3, y - w / 2 + Math.sin(a * 6) * 2, 7, w); }
      }
    }
  });
  const skinM = new THREE.MeshPhysicalMaterial({ map, metalness: 0.4, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 });
  const dark = [0.04, 0.07, 0.17], blue = [0.12, 0.22, 0.45], edge = [0.2, 0.3, 0.55];
  return swimmer(size, {
    W, H, skinM, NS: 64, NR: 30, amp: s => 0.05 * Math.pow(s, 2.6), k: 3.0, freq: 1.2, tailBeat: 0.22, recoil: 0.002, finOpacity: 0.88,
    fins: [{ s0: 0.11, s1: 0.78, up: 1, n: 30, rays: true, h: u => (u < 0.25 ? 0.14 * Math.sin(Math.min(1, u / 0.06) * Math.PI / 2) * (1 - u * 1.6) : 0.075 * Math.pow(1 - (u - 0.25) / 0.75, 0.6) * 0.35) + 0.006, back: 0.3, c0: dark, c1: blue },
      { s0: 0.87, s1: 0.9, up: 1, n: 4, h: u => 0.026 * Math.sin(Math.PI * u), back: 0.6, c0: dark, c1: dark },
      { s0: 0.57, s1: 0.68, up: -1, n: 8, rays: true, h: u => 0.07 * Math.pow(1 - u, 0.8) + 0.004, back: 0.5, c0: dark, c1: edge },
      { s0: 0.87, s1: 0.9, up: -1, n: 4, h: u => 0.022 * Math.sin(Math.PI * u), back: 0.6, c0: dark, c1: dark },
      ...[1, -1].flatMap(sd => [{ s0: 0.9, s1: 1.0, side: sd, n: 5, h: u => 0.018 * Math.sin(Math.PI * u), back: 0.2, c0: dark, c1: dark }])],   // 尾の付け根の隆起
    tails: [{ rotZ: Math.PI / 2, c: (a) => mix3(dark, [0.08, 0.12, 0.25], a), foil: { span: 0.23, both: true, le: a => -0.005 - 0.16 * Math.pow(a, 1.25), te: a => -0.005 - 0.16 * Math.pow(a, 1.25) - 0.05 * (1 - a) - 0.01, th: a => 0.014 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.22, th: -0.55, rot: [0.1, -1.0, -0.45], c: (a) => mix3(dark, blue, a * 0.7), foil: { span: 0.21, le: a => -0.07 * a * a, te: a => -0.07 * a * a - 0.04 * (1 - a) - 0.006, th: a => 0.009 * (1 - a) + 0.001 } }],
    extra: ctx => {
      const billM = skin({ color: 0x18202e, rim: 0x6a7a90, rimAmount: 0.15, clearcoat: 0.6, roughness: 0.45 });
      const bill = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.014, 0.3, 12, 6).rotateX(Math.PI / 2).translate(0, 0, 0.15), billM);
      { const bp = bill.geometry.attributes.position; for (let i = 0; i < bp.count; i++) { bp.setY(i, bp.getY(i) * 0.72 + 0.012 * Math.pow(bp.getZ(i) / 0.3, 2)); } bill.geometry.computeVertexNormals(); }   // やや平たく、先がわずかに上へ反る
      bill.position.set(0, 0.006, 0.497); ctx.body.add(bill);
      const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0, 0.025), skin({ color: 0x8a93a0, rim: 0xffffff, rimAmount: 0.15, roughness: 0.4 }));
      jaw.position.set(0, -0.012, 0.49); ctx.body.add(jaw);
      const lineM = new THREE.MeshBasicMaterial({ color: 0x141c2c });
      ctx.mouth = addTube(ctx, 12, 4, lineM, (u, out) => { const a = Math.abs(u - 0.5) * 2; ctx.surf(0.01 + 0.065 * a, -Math.PI / 2 + Math.sign(u - 0.5) * (0.6 * Math.pow(a, 0.5)), out); }, () => 0.0013);   // 口の線（くちばしの付け根から、目の下の後ろへ、ほぼまっすぐ）
      ctx.eyes = addEyes(ctx, 0.055, 0.1, 0.014, 0x4a5868);
      const filM = skin({ color: 0x223050, rim: 0x6a7a90, rimAmount: 0.2, roughness: 0.5 });
      ctx.pelv = [1, -1].map(sd => addTube(ctx, 10, 4, filM, (u, out, t) => { ctx.surf(0.24, -Math.PI / 2 + sd * 0.25, Q); out.set(Q.x + sd * 0.004 * u, Q.y - 0.02 * u + 0.004 * Math.sin(t * 3 + u * 4) * u, Q.z - 0.14 * u); }, u => 0.0022 * (1 - 0.6 * u)));
    },
    onAnim: (t, ph, ctx) => { ctx.eyes(); ctx.mouth(t, ph); ctx.pelv.forEach(f => f(t, ph)); }
  });
}

// ---------- ジンベエザメ（Rhincodon typus） ----------
// 世界最大の魚（10m 以上）。平たく幅の広い頭の、いちばん前に、横に大きく開いた口（頭の幅とほぼ同じ）。小さな目は口の両端のすぐ後ろ。
// 背と体の横に、前後に走る 3 本ずつの隆起があり、尾の付け根で強い稜になる。濃い灰青色の地に、白い斑点と淡い縦横の線の格子模様
// （1 匹ずつ違う）。腹は白い。5 対の大きなえらあな。尾びれは上の葉が大きい三日月形。体の下には、コバンザメが吸い付いていることが多い
function buildWhaleShark(size) {
  const W = curve([0, 0.03, 0.15, 0.35, 0.6, 0.85, 1], [0.08, 0.1, 0.115, 0.112, 0.078, 0.034, 0.016]);
  const H = curve([0, 0.03, 0.15, 0.35, 0.6, 0.85, 1], [0.03, 0.048, 0.072, 0.085, 0.066, 0.03, 0.013]);
  const map = tex('whaleshark2', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#26384a', '#46596a', '#e8eae8', 0.1);
    mottle(x, Wd, Ht, 60, 30, 90, 'rgba(15,25,38,.18)', 0, 1, [0.05, 0.45]);
    // 格子: 縦（体を巻く向き）と横（前後）の淡い線。線はところどころ途切れ、ゆるく曲がる
    x.lineCap = 'round';
    for (let k = 0; k < 22; k++) { const y = (0.17 + k * 0.038 + (rnd() - 0.5) * 0.008) * Ht; x.strokeStyle = `rgba(210,220,224,${0.35 + rnd() * 0.25})`; x.lineWidth = 2.5 + rnd() * 2;
      for (const [u0, u1] of [[-0.04, 0.14], [0.36, 0.54]]) { x.beginPath(); for (let u = u0; u <= u1; u += 0.01) { const yy = y + Math.sin(u * 25 + k) * 4; if (rnd() < 0.06) { x.stroke(); x.beginPath(); } x.lineTo(((u + 1) % 1) * Wd, yy); } x.stroke(); } }
    for (let k = 0; k < 9; k++) { const u = [0.03, 0.08, 0.13, 0.19, 0.25, 0.31, 0.37, 0.42, 0.47][k]; x.strokeStyle = 'rgba(210,220,224,.4)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(u * Wd, 0.2 * Ht); x.bezierCurveTo(u * Wd + 6, 0.45 * Ht, u * Wd - 6, 0.7 * Ht, u * Wd, 0.95 * Ht); x.stroke(); }
    // 白い斑点（線の間に並ぶ。頭は小さく細かい。腹側は少ない）
    for (let i = 0; i < 2600; i++) { const u = rnd() * 0.58 - 0.04, y = rnd(), r = (y < 0.17 ? 2 : 3.5 + rnd() * 3.5) * (1 - 0.4 * Math.abs(((u + 1) % 1) - 0.25) * 2); x.fillStyle = `rgba(234,238,238,${0.55 + rnd() * 0.4})`; x.beginPath(); x.arc(((u + 1) % 1) * Wd, y * Ht, Math.max(1.2, r), 0, 7); x.fill(); }
    gillLines(x, Wd, Ht, 0.15, 0.22, 5, 0.04, 0.085, 'rgba(18,24,32,.85)', 5);
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x9aa8b0, rimAmount: 0.12, clearcoat: 0.3, roughness: 0.62, side: THREE.FrontSide, bump: 0.5 });
  const finC = [0.16, 0.22, 0.28], finU = [0.82, 0.84, 0.84];
  const ridge = (th, c, wdt) => Math.exp(-Math.pow((th - c) / wdt, 2));
  return swimmer(size, {
    W, H, skinM, NS: 72, NR: 44, recoil: 0.003,
    shape: (s, th) => {
      const sn = Math.sin(th), c = Math.abs(Math.cos(th)), q = Math.abs(sn), head = 1 - ss(0.04, 0.3, s);
      let k = 1 + (Math.pow(c ** 3 + q ** 3, -1 / 3) - 1) * head * 0.85;  // 頭は平たい角の丸い四角
      if (s > 0.1) { const r = 0.08 * ss(0.1, 0.25, s) * (1 - 0.6 * ss(0.7, 0.95, s)); k *= 1 + r * (ridge(th, Math.PI / 2, 0.07) + ridge(th, 1.0, 0.07) + ridge(th, Math.PI - 1.0, 0.07) + ridge(th, 0.42, 0.06) + ridge(th, Math.PI - 0.42, 0.06)) + 0.12 * ss(0.85, 0.98, s) * (ridge(th, 0, 0.12) + ridge(th, Math.PI, 0.12)); }   // 背と横の隆起、尾の付け根の稜
      return k;
    },
    amp: s => 0.05 * Math.pow(s, 2), k: 3.2, freq: 0.22, tailBeat: 0.12,
    fins: [{ s0: 0.47, s1: 0.62, up: 1, n: 10, rays: false, h: u => 0.095 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - 0.3 * u), back: 0.6, c0: finC, c1: finC },
      { s0: 0.79, s1: 0.83, up: 1, n: 5, h: u => 0.03 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: finC },
      { s0: 0.8, s1: 0.84, up: -1, n: 5, h: u => 0.026 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: finC },
      { s0: 0.55, s1: 0.62, up: -1, n: 5, h: u => 0.035 * Math.sin(Math.PI * u), back: 0.5, c0: finU, c1: [0.7, 0.72, 0.72] }],
    tails: [{ rotZ: Math.PI / 2, c: () => finC, foil: { span: 0.24, le: a => 0.01 - 0.18 * Math.pow(a, 1.2), te: a => -0.065 - 0.12 * Math.pow(a, 1.2) - 0.012, th: a => 0.022 * (1 - a) + 0.002 } },
      { rotZ: -Math.PI / 2, c: () => finC, foil: { span: 0.14, le: a => -0.09 * Math.pow(a, 1.2), te: a => -0.05 - 0.06 * Math.pow(a, 1.2) - 0.012, th: a => 0.016 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.24, th: -0.15, rot: [0.22, -0.6, -0.3], c: (a, y) => y < 0 ? finU : finC, foil: { span: 0.2, le: a => -0.05 * a * a, te: a => -0.05 * a * a - 0.065 * (1 - a) - 0.012, th: a => 0.017 * (1 - a) + 0.002 } }],
    extra: ctx => {
      // 口: 頭の前の縁に、横一文字に大きく開く（中は暗く、上下の唇は白っぽい）
      const lipM = skin({ color: 0xc8cccc, rim: 0xffffff, rimAmount: 0.1, roughness: 0.55 }), inM = new THREE.MeshBasicMaterial({ color: 0x07090b, side: THREE.DoubleSide });
      ctx.gape = new THREE.Mesh(new THREE.CircleGeometry(1, 28), inM); ctx.body.add(ctx.gape);
      ctx.lips = [0.012, -0.012].map(dy => addTube(ctx, 16, 5, lipM, (u, out) => {   // 左の口角 → 右の口角。両端は少し後ろへ回りこむ
        ctx.center(0, P); const x = (u * 2 - 1); out.set(P.x + x * W(0) * 0.9, P.y - H(0) * 0.25 + dy * Math.sin(Math.PI * u), P.z + 0.004 - 0.012 * x * x); }, () => 0.0035));
      ctx.eyes = addEyes(ctx, 0.07, -0.08, 0.006, 0x50585e);
      // コバンザメ: 腹と胸びれの付け根の下に、3 匹
      ctx.rem = [[0.32, -1.25, 0.09], [0.36, -1.9, 0.08], [0.45, -1.5, 0.075]].map(([s2, th, l]) => { const e = escort('remora'); e.g.scale.setScalar(l); ctx.body.add(e.g); return { e, s2, th }; });
    },
    onAnim: (t, ph, ctx) => {
      ctx.center(0.0, P); const w = W(0) * 0.9; ctx.gape.position.set(P.x, P.y - H(0) * 0.25, P.z + 0.002); ctx.gape.scale.set(w, 0.012, 1);
      ctx.lips.forEach(f => f(t, ph)); ctx.eyes();
      ctx.rem.forEach(({ e, s2, th }) => {                               // 背の吸盤を体に向けて、体の面の少し外に
        const l = e.g.scale.x; ctx.surf(s2, th, e.g.position); e.g.position.x += Math.cos(th) * 0.055 * l; e.g.position.y += Math.sin(th) * 0.055 * l;
        e.g.rotation.set(0, 0.1 * Math.sin(t * 0.7 + e.ph), th + Math.PI / 2); e.tp.rotation.y = 0.15 * Math.sin(t * 3 + e.ph); });
    }
  });
}

// ---------- ヨゴレ（Carcharhinus longimanus） ----------
// 外洋のサメ（2〜3m）。先が丸い大きな第 1 背びれと、長く幅の広いへら形の胸びれ。ひれの先が、まだらに白い（英名 oceanic whitetip）。
// 吻は短く丸い。背は青銅色を帯びた灰色、腹は白い。下面の三日月形の口、5 対のえらあな。ゆったりと泳ぎ、前にはブリモドキが群れて泳ぐことが多い
function buildOceanicWhitetip(size) {
  const W = curve([0, 0.04, 0.15, 0.35, 0.62, 0.86, 1], [0.014, 0.05, 0.082, 0.09, 0.062, 0.028, 0.014]);
  const H = curve([0, 0.04, 0.15, 0.35, 0.62, 0.86, 1], [0.013, 0.046, 0.084, 0.1, 0.068, 0.03, 0.016]);
  const map = tex('oceanicwhitetip2', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#56503f', '#7c7666', '#eeede8', 0.08);
    mottle(x, Wd, Ht, 120, 10, 34, 'rgba(70,64,50,.2)', 0.05, 0.95, [0.08, 0.42]);
    mottle(x, Wd, Ht, 40, 6, 14, 'rgba(230,228,220,.12)', 0.05, 0.95, [0.08, 0.42]);   // 古い傷跡
    gillLines(x, Wd, Ht, 0.16, 0.225, 5, 0.035, 0.07, 'rgba(45,40,32,.6)', 2.5);
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0xb0a890, rimAmount: 0.12, clearcoat: 0.45, roughness: 0.48, side: THREE.FrontSide, bump: 0.45, grain: 90 });
  const finC = [0.36, 0.34, 0.29], tipC = [0.95, 0.95, 0.92];
  const tipped = (a, y, z) => mix3(finC, tipC, ss(0.42, 0.68, a + 0.08 * Math.sin(z * 90 + a * 30)));
  return swimmer(size, {
    W, H, skinM, NS: 64, NR: 32, amp: s => 0.065 * Math.pow(s, 1.6), k: 4.0, freq: 0.55, tailBeat: 0.15, recoil: 0.005,
    yc: s => 0.006 * (1 - ss(0, 0.08, s)),
    shape: (s, th) => 1 - 0.14 * Math.max(0, -Math.sin(th)) * (1 - ss(0, 0.2, s)),
    fins: [{ s0: 0.3, s1: 0.47, up: 1, n: 12, h: u => 0.18 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.5) * (1 - 0.25 * u), back: 0.45, c0: mix3(finC, tipC, 0.15), c1: tipC },
      { s0: 0.76, s1: 0.8, up: 1, n: 4, h: u => 0.025 * Math.sin(Math.PI * u), back: 0.6, c0: finC, c1: finC },
      { s0: 0.77, s1: 0.81, up: -1, n: 4, h: u => 0.026 * Math.sin(Math.PI * u), back: 0.6, c0: finC, c1: tipC },
      { s0: 0.58, s1: 0.64, up: -1, n: 5, h: u => 0.042 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: tipC }],
    tails: [{ rotZ: Math.PI / 2, c: tipped, foil: { span: 0.28, le: a => 0.01 - 0.21 * Math.pow(a, 1.2), te: a => -0.05 - 0.18 * Math.pow(a, 1.2) - 0.012, th: a => 0.014 * (1 - a) + 0.002 } },
      { rotZ: -Math.PI / 2, c: tipped, foil: { span: 0.13, le: a => -0.08 * Math.pow(a, 1.2), te: a => -0.045 - 0.05 * Math.pow(a, 1.2) - 0.01, th: a => 0.012 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.24, th: -0.62, rot: [0.15, -0.5, -0.28], c: tipped, foil: { span: 0.33, le: a => -0.08 * a * a, te: a => -0.08 * a * a - 0.08 * (1 - 0.5 * a) - 0.012, th: a => 0.012 * (1 - a) + 0.002 } }],
    extra: ctx => {
      const lineM = new THREE.MeshBasicMaterial({ color: 0x14110c });
      ctx.mouth = addTube(ctx, 12, 4, lineM, (u, out) => { ctx.surf(0.06 - 0.03 * Math.cos((u - 0.5) * Math.PI) , -Math.PI / 2 + (u - 0.5) * 1.6, out); }, () => 0.003);   // 下面の三日月形の口
      ctx.eyes = addEyes(ctx, 0.06, 0.02, 0.009, 0x4a4436);
      // ブリモドキ: 吻の前と、胸びれの上に、4 匹
      ctx.pilots = [[0.08, 0.0, -0.06], [-0.07, 0.03, -0.1], [0.12, -0.05, 0.12], [-0.11, -0.03, 0.1]].map(([x, y, z]) => { const e = escort('pilot'); e.g.scale.setScalar(0.13); ctx.g.add(e.g); return { e, x, y, z }; });
    },
    onAnim: (t, ph, ctx) => {
      ctx.mouth(t, ph); ctx.eyes();
      ctx.pilots.forEach(({ e, x, y, z }, i) => { e.g.position.set(x + 0.01 * Math.sin(t * 0.8 + i), y + 0.008 * Math.sin(t * 0.6 + i * 2), 0.55 + z + 0.015 * Math.sin(t * 0.5 + i)); e.g.rotation.y = 0.15 * Math.sin(t * 0.9 + i); e.tp.rotation.y = 0.4 * Math.sin(t * 9 + e.ph); });
    }
  });
}

// ---------- マンボウ（Mola mola） ----------
// 左右に平たい円盤のような体（体長 1.5〜3m）。尾びれはなく、体の後ろは「舵びれ」で、縁は骨の小さなこぶが並んで波打つ。
// 背びれとしりびれは高く先がとがり、左右にそろって打ち振って泳ぐ。口は小さく、くちばし状の歯。胸びれの前に、丸い小さなえらあな。
// 灰色〜銀色で、白っぽいまだらと、こすれた傷。皮膚は厚く、ざらざら。海面近くでは体を横に倒して浮かび、日光浴をする
function buildMola(size) {
  const W = curve([0, 0.08, 0.3, 0.6, 0.85, 1], [0.026, 0.068, 0.1, 0.095, 0.075, 0.06]);
  const H = curve([0, 0.08, 0.3, 0.6, 0.85, 1], [0.05, 0.2, 0.33, 0.33, 0.25, 0.18]);
  const map = tex('mola2', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#56636c', '#86939a', '#cdd3d4', 0.16);
    mottle(x, Wd, Ht, 260, 6, 26, 'rgba(228,232,232,.32)');
    mottle(x, Wd, Ht, 90, 12, 40, 'rgba(55,64,72,.22)');
    x.strokeStyle = 'rgba(235,238,238,.35)'; x.lineWidth = 1.5;          // こすれた傷
    for (let i = 0; i < 40; i++) { const u = rnd(), y = rnd() * Ht; x.beginPath(); x.moveTo(u * Wd, y); x.lineTo(u * Wd + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 30); x.stroke(); }
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0xc0c8cc, rimAmount: 0.15, clearcoat: 0.12, roughness: 0.78, side: THREE.DoubleSide, bump: 0.6 });
  const finC = [0.38, 0.42, 0.45], finT = [0.5, 0.55, 0.58];
  return swimmer(size, {
    W, H, skinM, rigid: true, amp: () => 0, k: 0, freq: 0.5, NR: 36, recoil: 0,
    fins: [{ s0: 0.64, s1: 0.8, up: 1, n: 12, rays: true, h: u => 0.45 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.65) * (1 - 0.15 * u), back: 0.45, c0: finC, c1: finT, flap: 0.8, flapF: 1 },
      { s0: 0.64, s1: 0.8, up: -1, n: 12, rays: true, h: u => 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.65) * (1 - 0.15 * u), back: 0.45, c0: finC, c1: finT, flap: 0.8, flapF: 1 }],
    pecs: [{ s: 0.3, th: 0.12, rot: [0, -1.1, 0], c: () => finC, flap: 0.3, flapF: 2, foil: { span: 0.07, le: a => -0.01 * a, te: a => -0.01 * a - 0.04 * (1 - 0.4 * a), th: a => 0.006 } }],
    extra: ctx => {
      const clav = makeFan(41, skinM); ctx.body.add(clav); ctx.clav = clav;   // 舵びれ（縁に骨のこぶが並び、波打つ）
      const beak = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.008, 8, 16), skin({ color: 0xb8bfc0, rim: 0xffffff, rimAmount: 0.1, roughness: 0.5 }));
      beak.position.set(0, -0.006, 0.507); ctx.body.add(beak);
      const holeM = new THREE.MeshBasicMaterial({ color: 0x30383c });
      ctx.gills = [1, -1].map(sd => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.009, 14), holeM); m.scale.set(0.7, 2.2, 1); ctx.body.add(m); return { m, sd }; });   // 胸びれの前の、縦長の小さなえらあな
      ctx.eyes = addEyes(ctx, 0.12, 0.25, 0.017, 0x6a7276);
      ctx.roll = 0;
    },
    onAnim: (t, ph, ctx, rec) => {
      ctx.center(1, P); const tips = [];
      for (let k = 0; k < 41; k++) { const a = -Math.PI / 2 + Math.PI * k / 40, bump = 1 + 0.07 * Math.pow(Math.abs(Math.sin(a * 9)), 0.5); tips.push(new THREE.Vector3(P.x, P.y + Math.sin(a) * H(1) * 1.05 * bump, P.z - 0.04 - 0.06 * Math.cos(a) * bump)); }
      ctx.clav.userData.update(new THREE.Vector3(P.x, P.y, P.z + 0.02), tips);
      ctx.gills.forEach(({ m, sd }) => { ctx.surf(0.27, sd > 0 ? 0.32 : Math.PI - 0.32, m.position); m.position.x += sd * 0.002; m.rotation.y = sd * Math.PI / 2; });
      ctx.eyes();
      // 海面近く（水深 4m より浅い所）では、体を横に倒して浮かぶ（日光浴）
      const want = rec && rec.depth != null && rec.depth < 4 ? 1.25 : 0;
      ctx.roll += (want - ctx.roll) * 0.01; ctx.body.rotation.z = ctx.roll;
    }
  });
}

// ---------- カツオ（Katsuwonus pelamis）の群れ ----------
// 体長 50〜80cm。断面がほぼ円い紡錘形で、頭は円錐形にとがる。背は濃い青紫で、わき腹へ鋼のような青、銀白色へ移る。
// 腹側のわき腹に 4〜6 本の黒っぽい縦じま（カツオの目印。背にはしまがない）。うろこは胸のまわり（胸甲）と側線だけで、肌はなめらかで金属のようなつや。
// 第 1 背びれ（とげ）は前が高く後ろへ低くなり、すぐ後ろに小さな第 2 背びれとしりびれ。その後ろに小離鰭が背に 8 個、腹に 7 個。
// 尾の付け根はとても細く、左右に大きな隆起（キール）。尾びれは硬く細長い三日月形。体はほとんど曲げず、尾だけを速く振って泳ぐ（マグロ類の泳ぎ方）。
// 群れはそろって同じ向きに泳ぎ、ときどき向きを変える波が群れを伝わって、わき腹が銀色にきらめく
function buildSkipjackSchool(size) {
  const g = new THREE.Group(), N = 32;
  const W = curve([0, 0.04, 0.15, 0.34, 0.6, 0.82, 0.93, 1], [0.008, 0.045, 0.088, 0.104, 0.082, 0.034, 0.012, 0.011]);
  const H = curve([0, 0.04, 0.15, 0.34, 0.6, 0.82, 0.93, 1], [0.008, 0.05, 0.1, 0.122, 0.094, 0.038, 0.014, 0.013]);
  const map = tex('skipjack2', 1024, 512, (x, Wd, Ht) => {
    // 背（u 0.25）は濃い青紫 → 鋼の青 → 銀 → 腹（u 0.75）は白
    const gr = x.createLinearGradient(0, 0, Wd, 0);
    [[0, '#aab4c4'], [0.09, '#4a5a86'], [0.17, '#1e2052'], [0.25, '#16173f'], [0.33, '#1e2052'], [0.41, '#4a5a86'], [0.5, '#aab4c4'], [0.6, '#dfe4ea'], [0.75, '#f4f5f6'], [0.9, '#dfe4ea'], [1, '#aab4c4']].forEach(([o, c]) => gr.addColorStop(o, c));
    x.fillStyle = gr; x.fillRect(0, 0, Wd, Ht);
    mottle(x, Wd, Ht, 70, 10, 30, 'rgba(70,60,140,.22)', 0.05, 0.9, [0.14, 0.36]);   // 背の紫がかったつや
    mottle(x, Wd, Ht, 60, 8, 24, 'rgba(150,175,215,.18)', 0.1, 0.9, [0.03, 0.12]);
    mottle(x, Wd, Ht, 60, 8, 24, 'rgba(150,175,215,.18)', 0.1, 0.9, [0.38, 0.47]);
    // 腹側の縦じま（左右に 5 本ずつ。胸びれの後ろから尾の手前まで。尾へ向かって寄り合い、ぼかす）
    x.lineCap = 'round'; x.filter = 'blur(3px)';
    for (const [uTop, dir] of [[0.5, 1], [1.0, -1]]) for (let k = 0; k < 5; k++) {
      const u0 = uTop + dir * (0.035 + k * 0.03), u1 = uTop + dir * (0.05 + k * 0.022), ww = 20 - k * 2;
      x.strokeStyle = `rgba(30,34,56,${0.62 - k * 0.05})`; x.lineWidth = ww;
      x.beginPath(); x.moveTo(u0 * Wd, (0.24 + k * 0.012) * Ht); x.bezierCurveTo(u0 * Wd, 0.45 * Ht, u1 * Wd + dir * 4, 0.65 * Ht, u1 * Wd, (0.84 - k * 0.025) * Ht); x.stroke();
    }
    x.filter = 'none';
    // えらぶたの縁（目の後ろの弓なりの線）と、胸甲（胸のまわりの、うろこのあるやや明るい所）
    x.strokeStyle = 'rgba(40,48,80,.5)'; x.lineWidth = 2.5;
    for (const um of [0.02, 0.48]) { x.beginPath(); x.moveTo((um - 0.07) * Wd, 0.17 * Ht); x.quadraticCurveTo(um * Wd, 0.19 * Ht, (um + 0.07) * Wd, 0.17 * Ht); x.stroke(); }
    for (const um of [0.02, 0.48]) { const gc = x.createRadialGradient(um * Wd, 0.27 * Ht, 4, um * Wd, 0.27 * Ht, 60); gc.addColorStop(0, 'rgba(200,210,225,.22)'); gc.addColorStop(1, 'rgba(200,210,225,0)'); x.fillStyle = gc; x.fillRect(um * Wd - 60, 0.27 * Ht - 60, 120, 120); }
    // 口の線（吻の先から目の下へ）
    x.strokeStyle = 'rgba(25,28,45,.7)'; x.lineWidth = 2;
    for (const um of [0.97, 0.53]) { x.beginPath(); x.moveTo(0.75 * Wd, 0.005 * Ht); x.lineTo(um * Wd, 0.07 * Ht); x.stroke(); }
  });
  const bodyMat = new THREE.MeshPhysicalMaterial({ map, metalness: 0.5, roughness: 0.26, clearcoat: 0.9 });
  const fm = finMat(1, 0.35);
  const dark = [0.1, 0.11, 0.24], gray = [0.32, 0.34, 0.42];
  const center = (s, out) => out.set(0, 0, 0.5 - s);
  const hull = makeBody(40, 22, bodyMat); hull.userData.update(center, W, H);
  // ひれ・小離鰭・隆起・目は、1 匹ぶんを 1 つの形にまとめる（32 匹ぶん描くので、部品の数を減らす）
  const parts = [];
  const add = (geo, m4) => { if (geo.index) geo = geo.toNonIndexed(); if (m4) geo.applyMatrix4(m4); geo.computeVertexNormals(); parts.push(geo); };
  const strip = (s0, s1, up, n, h, c0, c1, back = 0.3, side = 0) => {
    const m = colorStrip(makeStrip(n, fm), n, c0, c1), bs = [], tp = [];
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1), s = s0 + (s1 - s0) * u;
      if (side) { bs.push(new THREE.Vector3(side * W(s) * 0.85, 0, 0.5 - s)); tp.push(new THREE.Vector3(side * (W(s) * 0.85 + h(u)), 0, 0.5 - s - back * h(u))); }
      else { bs.push(new THREE.Vector3(0, up * H(s) * 0.85, 0.5 - s)); tp.push(new THREE.Vector3(0, up * (H(s) * 0.85 + h(u)), 0.5 - s - back * h(u))); }
    }
    m.userData.update(bs, tp); add(m.geometry);
  };
  strip(0.27, 0.47, 1, 12, u => 0.075 * Math.pow(1 - u, 1.4) + 0.004, dark, gray, 0.25);         // 第 1 背びれ（前が高く、後ろへ低く）
  strip(0.5, 0.56, 1, 5, u => 0.045 * Math.sin(Math.PI * Math.min(1, u * 1.1)), dark, gray, 0.6);  // 第 2 背びれ
  strip(0.54, 0.6, -1, 5, u => 0.04 * Math.sin(Math.PI * Math.min(1, u * 1.1)), [0.55, 0.57, 0.63], gray, 0.6);   // しりびれ
  for (let k = 0; k < 8; k++) { const s = 0.6 + k * 0.033; strip(s, s + 0.018, 1, 2, u => 0.016 - 0.008 * u, dark, gray, 0.8); }   // 背の小離鰭
  for (let k = 0; k < 7; k++) { const s = 0.63 + k * 0.033; strip(s, s + 0.018, -1, 2, u => 0.014 - 0.007 * u, gray, gray, 0.8); }   // 腹の小離鰭
  [1, -1].forEach(sd => { strip(0.86, 0.98, 0, 6, u => 0.016 * Math.sin(Math.PI * u), dark, dark, 0.2, sd); strip(0.985, 1.02, 0, 3, u => 0.006 * Math.sin(Math.PI * u), dark, dark, 0.2, sd); });   // 尾の付け根の隆起（大 1・小 1）
  const pecGeo = colorFoil(makeFoil({ span: 0.075, le: a => -0.015 * a, te: a => -0.015 * a - 0.035 * (1 - 0.7 * a) - 0.005, th: () => 0.006 }), 0.075, a => mix3(dark, gray, a));
  const pelGeo = colorFoil(makeFoil({ span: 0.035, le: a => -0.01 * a, te: a => -0.01 * a - 0.03 * (1 - 0.6 * a) - 0.004, th: () => 0.004 }), 0.035, a => mix3(gray, [0.5, 0.52, 0.58], a));
  const M4 = new THREE.Matrix4(), E = new THREE.Euler(), Sv = new THREE.Vector3(), Qt = new THREE.Quaternion();
  [1, -1].forEach(sd => {
    Sv.set(sd, 1, 1); Qt.setFromEuler(E.set(0.15, sd * -0.95, sd * -0.25, 'YXZ')); add(pecGeo.clone(), M4.compose(new THREE.Vector3(sd * W(0.25) * 0.85, -0.012, 0.25), Qt, Sv));   // 胸びれ（短い）
    Qt.setFromEuler(E.set(0.1, sd * -1.1, sd * -1.1, 'YXZ')); add(pelGeo.clone(), M4.compose(new THREE.Vector3(sd * 0.02, -H(0.28) * 0.9, 0.22), Qt, Sv));   // 腹びれ
    // 目: 黒い瞳と、まわりの銀色がかった輪（頂点の色で）
    const eg = new THREE.SphereGeometry(0.017, 14, 10), ep = eg.attributes.position, ec = new Float32Array(ep.count * 3);
    for (let i = 0; i < ep.count; i++) { const r = Math.hypot(ep.getY(i), ep.getZ(i)) / 0.017, c = ep.getX(i) > 0 && r < 0.55 ? [0.02, 0.02, 0.03] : r < 0.8 ? [0.55, 0.52, 0.42] : [0.3, 0.32, 0.38]; ec.set(c, i * 3); }
    eg.setAttribute('color', new THREE.BufferAttribute(ec, 3)); eg.scale(0.55, 1, 1); if (sd < 0) eg.rotateY(Math.PI);
    add(eg, M4.makeTranslation(sd * W(0.07) * 0.92, 0.012, 0.43));
  });
  const finGeo = (() => {                                              // まとめる（位置・向き・色）
    let n = 0; parts.forEach(q => n += q.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    parts.forEach(q => { const c = q.attributes.position.count; pos.set(q.attributes.position.array, o * 3); nor.set(q.attributes.normal.array, o * 3); col.set(q.attributes.color ? q.attributes.color.array : new Float32Array(c * 3).fill(0.3), o * 3); o += c; q.dispose(); });
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); gg.setAttribute('color', new THREE.BufferAttribute(col, 3)); return gg;
  })();
  const tailGeo = colorFoil(makeFoil({ span: 0.14, both: true, nA: 16, le: a => -0.004 - 0.1 * Math.pow(a, 1.5), te: a => -0.004 - 0.1 * Math.pow(a, 1.5) - 0.032 * (1 - a) - 0.006, th: a => 0.008 * (1 - a) + 0.0015 }), 0.14, a => mix3(dark, gray, a * 0.6));
  const fish = [];
  for (let i = 0; i < N; i++) {
    const f = new THREE.Group(); f.add(new THREE.Mesh(hull.geometry, bodyMat), new THREE.Mesh(finGeo, fm));
    const tp = new THREE.Group(); tp.position.set(0, 0, -0.5); const tm = new THREE.Mesh(tailGeo, fm); tm.rotation.z = Math.PI / 2; tp.add(tm); f.add(tp);
    f.scale.setScalar(size * (0.9 + rnd() * 0.2));
    const off = new THREE.Vector3((rnd() - 0.5) * 7, (rnd() - 0.5) * 3, (rnd() - 0.5) * 11).multiplyScalar(size);
    g.add(f); fish.push({ f, tp, off, ph: rnd() * 10, sp: 0.9 + rnd() * 0.2, side: rnd() < 0.5 ? 1 : -1 });
  }
  // 群れの動き: 群れ全体が曲がるとき、1 枚の板のように回さない。群れの形はゆっくり遅れて向きを変え、1 匹ずつは前の魚から順に向きを変える
  const V = new THREE.Vector3(), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  let lastT = null, schoolYaw = 0, wave = null, nextWave = 10 + rnd() * 20;
  const zMax = Math.max(...fish.map(F => F.off.z)), zMin = Math.min(...fish.map(F => F.off.z));
  function animate(t, speed, ctx) {
    const sc = (ctx && ctx.scare) || 0, fwd = size * 2.5;               // 群れの中を前へ進む速さ（群れ全体の動きは外で決まる）
    const Hg = g.rotation.y, dt = lastT == null ? 0 : Math.min(0.2, Math.max(0, t - lastT)); lastT = t;
    if (dt === 0) { schoolYaw = Hg; fish.forEach(F => { F.yaw = Hg; }); }
    schoolYaw += wrap(Hg - schoolYaw) * Math.min(1, dt * 0.7);
    const fy = schoolYaw - Hg, cf = Math.cos(fy), sf = Math.sin(fy);
    // 向きを変える波: ときどき（驚いたときはすぐ）、群れの前から後ろへ伝わる。波が通ると、体を少し傾けて向きを変え、わき腹が光る
    if (!wave && (t > nextWave || sc > 0.4)) { wave = { t0: t, side: rnd() < 0.5 ? 1 : -1 }; nextWave = t + 15 + rnd() * 25; }
    let front = null; if (wave) { const k = (t - wave.t0) / 2.5; if (k > 1.3 || k < 0) wave = null; else front = zMax + 2 * size - k * (zMax - zMin + 4 * size); }
    fish.forEach(F => {
      const tt = t * F.sp + F.ph;
      F.tp.rotation.y = 0.26 * Math.sin(tt * 2 * Math.PI * 3.2);              // 尾だけを速く振る
      // 群れの中での位置: ゆっくりさまよう（群れの形は、遅れて向きを変える）
      const ax = size * 0.5, ay = size * 0.25, az = size * 1.2;
      V.copy(F.off).multiplyScalar(1 + 1.8 * sc).add(Q.set(Math.sin(tt * 0.5) * ax, Math.sin(tt * 0.7) * ay, Math.sin(tt * 0.3) * az));
      F.f.position.set(V.x * cf + V.z * sf, V.y, -V.x * sf + V.z * cf);
      // 1 匹ずつの向き: 群れの向きを、前にいる魚ほど早く追う。さまよう動きの向きも少し
      const lead = (F.off.z - zMin) / Math.max(0.01, zMax - zMin);
      F.yaw = F.yaw == null ? Hg : F.yaw + wrap(Hg - F.yaw) * Math.min(1, dt * (0.6 + 1.6 * lead));
      const vx = Math.cos(tt * 0.5) * 0.5 * ax * F.sp, vy = Math.cos(tt * 0.7) * 0.7 * ay * F.sp, vz = Math.cos(tt * 0.3) * 0.3 * az * F.sp + fwd;
      const wv = front == null ? 0 : Math.exp(-Math.pow((F.off.z - front) / (1.6 * size), 2)) * wave.side;
      F.f.rotation.set(-Math.atan2(vy, vz) * 0.8, wrap(F.yaw - Hg) + Math.atan2(vx, vz) + 0.025 * Math.sin(tt * 2 * Math.PI * 3.2 + 1.5) + 0.22 * wv, 0.5 * wv, 'YXZ');
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
    x.strokeStyle = 'rgba(8,9,10,.85)'; x.lineWidth = 3;               // 口の線: 吻の先から、目の下へ弓なりに
    for (const [u0, u1] of [[0.75, 0.97], [0.75, 0.53]]) { x.beginPath(); x.moveTo(u0 * Wd, 0.005 * Ht); x.quadraticCurveTo((u0 + (u1 - u0) * 0.8) * Wd, 0.08 * Ht, u1 * Wd, 0.19 * Ht); x.stroke(); }
  });
  const pleat = tex('humpbackPleat', 512, 512, (x, Wd, Ht) => {          // のどの畝の凹凸
    x.fillStyle = '#808080'; x.fillRect(0, 0, Wd, Ht); x.strokeStyle = '#303030'; x.lineWidth = 3;
    for (let k = 0; k < 26; k++) { const u = 0.62 + k * 0.01; x.beginPath(); x.moveTo(u * Wd, 0.02 * Ht); x.quadraticCurveTo(u * Wd + Math.sin(k) * 2, 0.25 * Ht, (0.75 + (u - 0.75) * 0.4) * Wd, 0.5 * Ht); x.stroke(); }
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x8a9096, rimAmount: 0.12, clearcoat: 0.5, roughness: 0.5, side: THREE.FrontSide });
  skinM.bumpMap = pleat; skinM.bumpScale = 0.003 * size;
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
      // フジツボ: あごの先と胸びれの前の縁に、白いざらざらのかたまり
      const barM = skin({ color: 0xd8d4cc, rim: 0xffffff, rimAmount: 0.1, roughness: 0.9 }), bg = new THREE.IcosahedronGeometry(1, 1);
      ctx.barn = []; for (let k = 0; k < 18; k++) { const m = new THREE.Mesh(bg, barM); m.scale.set(0.006 + rnd() * 0.004, 0.003, 0.006 + rnd() * 0.004); ctx.body.add(m); ctx.barn.push({ m, s: 0.005 + rnd() * 0.04, th: -Math.PI / 2 + (rnd() - 0.5) * 1.2 }); }
      // 噴気孔: 頭の上の 2 つの切れこみと、その前の盛り上がり
      const holeM = new THREE.MeshBasicMaterial({ color: 0x050506 });
      ctx.blow = [1, -1].map(sd => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), holeM); m.scale.set(0.002, 0.0015, 0.008); ctx.body.add(m); return { m, sd }; });
    },
    onAnim: (t, ph, ctx) => {
      ctx.knobs.forEach(({ m, s, th }) => ctx.surf(s, th, m.position)); ctx.eyes();
      ctx.barn.forEach(({ m, s, th }) => ctx.surf(s, th, m.position));
      ctx.blow.forEach(({ m, sd }) => { ctx.surf(0.17, Math.PI / 2 + sd * 0.05, m.position); m.rotation.y = sd * 0.25; });
    }
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

// ---------- サンゴ礁の大物（reef.js が、ときどき礁の上を通らせる） ----------
// ネムリブカ（Triaenodon obesus）: 体長 1.5m ほどの細身のサメ。頭は平たく幅広で、吻は短く丸い。鼻の穴の前に小さな管状のひだ。
// 第 1 背びれは体の後ろ寄り（胸びれの後ろの端の上）。第 1 背びれと尾びれの上の葉の先が白い。背は灰褐色で、黒っぽい小さな斑点が散らばる。
// 目は楕円で、上に眉のような隆起。体をくねらせて、ゆっくり泳ぐ
function buildReefWhitetip(size) {
  const W = curve([0, 0.04, 0.14, 0.32, 0.6, 0.85, 1], [0.02, 0.05, 0.065, 0.068, 0.046, 0.022, 0.012]);
  const H = curve([0, 0.04, 0.14, 0.32, 0.6, 0.85, 1], [0.01, 0.028, 0.055, 0.068, 0.05, 0.024, 0.013]);
  const map = tex('reefwhitetip', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#5f5e57', '#7d7b72', '#e6e4dd', 0.07);
    mottle(x, Wd, Ht, 60, 18, 50, 'rgba(70,68,60,.2)', 0.05, 0.95, [0.05, 0.45]);
    for (let i = 0; i < 160; i++) { const u = 0.02 + rnd() * 0.46, y = (0.15 + rnd() * 0.75) * Ht, r = 1.5 + rnd() * 3; x.fillStyle = `rgba(40,38,34,${0.35 + rnd() * 0.3})`; x.beginPath(); x.arc(u * Wd, y, r, 0, 7); x.fill(); }   // 黒っぽい小さな斑点
    gillLines(x, Wd, Ht, 0.15, 0.21, 5, 0.03, 0.05, 'rgba(50,48,42,.55)', 2);
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0xa8a290, rimAmount: 0.12, clearcoat: 0.4, roughness: 0.5, side: THREE.FrontSide, bump: 0.45, grain: 90 });
  const finC = [0.36, 0.35, 0.31], tipC = [0.96, 0.96, 0.95];
  return swimmer(size, {
    W, H, skinM, NS: 60, NR: 30, amp: s => 0.04 + 0.06 * Math.pow(s, 1.5), k: 5.2, freq: 0.75, tailBeat: 0.12, recoil: 0.004,
    shape: (s, th) => 1 - 0.22 * Math.abs(Math.sin(th)) * (1 - ss(0, 0.18, s)),   // 頭は平たい
    fins: [{ s0: 0.38, s1: 0.5, up: 1, n: 10, h: u => 0.105 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.6) * (1 - 0.3 * u), back: 0.5, c0: finC, c1: tipC },
      { s0: 0.69, s1: 0.75, up: 1, n: 6, h: u => 0.05 * Math.sin(Math.PI * u), back: 0.55, c0: finC, c1: mix3(finC, tipC, 0.5) },
      { s0: 0.7, s1: 0.76, up: -1, n: 6, h: u => 0.045 * Math.sin(Math.PI * u), back: 0.55, c0: finC, c1: finC },
      { s0: 0.52, s1: 0.58, up: -1, n: 5, h: u => 0.04 * Math.sin(Math.PI * u), back: 0.5, c0: finC, c1: finC }],
    tails: [{ rotZ: Math.PI / 2, c: a => a > 0.78 ? tipC : finC, foil: { span: 0.2, le: a => 0.005 - 0.2 * Math.pow(a, 1.1), te: a => -0.04 - 0.17 * Math.pow(a, 1.1) - 0.012, th: a => 0.012 * (1 - a) + 0.002 } },
      { rotZ: -Math.PI / 2, c: () => finC, foil: { span: 0.08, le: a => -0.05 * Math.pow(a, 1.2), te: a => -0.035 - 0.04 * a - 0.01, th: a => 0.01 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.22, th: -0.5, rot: [0.12, -0.6, -0.3], c: () => finC, foil: { span: 0.15, le: a => -0.06 * a * a, te: a => -0.06 * a * a - 0.06 * (1 - 0.6 * a) - 0.01, th: a => 0.01 * (1 - a) + 0.002 } }],
    extra: ctx => {
      const lineM = new THREE.MeshBasicMaterial({ color: 0x1a1814 }), flapM = skin({ color: 0x8a867a, rim: 0xffffff, rimAmount: 0.1, roughness: 0.6 });
      ctx.mouth = addTube(ctx, 12, 4, lineM, (u, out) => { ctx.surf(0.07 - 0.035 * Math.cos((u - 0.5) * Math.PI), -Math.PI / 2 + (u - 0.5) * 1.7, out); }, () => 0.0025);
      ctx.nose = [1, -1].map(sd => addTube(ctx, 5, 4, flapM, (u, out) => { ctx.surf(0.012, -Math.PI / 2 + sd * 0.7, Q); out.set(Q.x, Q.y - 0.006 * u, Q.z - 0.004 * u); }, u => 0.0035 * (1 - 0.4 * u)));   // 鼻の前の管状のひだ
      ctx.eyes = addEyes(ctx, 0.07, 0.15, 0.008, 0x8a8a70);
      const browM = skin({ color: 0x6a685e, rim: 0xa8a290, rimAmount: 0.1, roughness: 0.55 });
      ctx.brow = [1, -1].map(sd => addTube(ctx, 6, 4, browM, (u, out) => { ctx.surf(0.06 + 0.022 * u, sd > 0 ? 0.32 : Math.PI - 0.32, out); }, u => 0.004 * Math.sin(Math.PI * u) + 0.0005));   // 眉のような隆起
    },
    onAnim: (t, ph, ctx) => { ctx.mouth(t, ph); ctx.nose.forEach(f => f(t, ph)); ctx.brow.forEach(f => f(t, ph)); ctx.eyes(); }
  });
}

// メガネモチノウオ（ナポレオンフィッシュ, Cheilinus undulatus）: 体長 1〜2m の大きなベラ。体は高く左右に平たい。
// 大人はおでこがこぶのように盛り上がり、唇は厚い。目の後ろに 2 本の黒い線。体は青緑で、うろこ 1 枚ずつに細い縦の波線（学名 undulatus）。
// 顔は黄緑〜橙の細かい迷路のような線。背びれ・しりびれの後ろの部分と尾びれは丸い。胸びれをオールのように漕いで、ゆったり進む
function buildNapoleon(size) {
  const W = curve([0, 0.05, 0.2, 0.42, 0.7, 0.88, 1], [0.025, 0.05, 0.072, 0.075, 0.05, 0.026, 0.02]);
  const H = curve([0, 0.05, 0.2, 0.42, 0.7, 0.88, 1], [0.035, 0.08, 0.15, 0.17, 0.13, 0.065, 0.05]);
  const map = tex('napoleon', 1024, 1024, (x, Wd, Ht) => {
    countershade(x, Wd, Ht, '#28504a', '#3a6c5e', '#86a490', 0.14);
    mottle(x, Wd, Ht, 120, 14, 44, 'rgba(30,60,70,.25)');
    mottle(x, Wd, Ht, 60, 10, 30, 'rgba(90,110,70,.18)');
    // うろこごとの細い縦の波線（ぼかして、ゆらぎを入れる。並びが目立たないように）
    x.lineWidth = 1.6;
    for (let i = 0; i < 2600; i++) {
      const u = rnd(), y = (0.2 + rnd() * 0.72) * Ht, a = 0.12 + rnd() * 0.18; if (Math.abs(((u + 0.25) % 0.5) - 0.25) < 0.04) continue;   // 背・腹の中心は少なく
      x.strokeStyle = `rgba(20,45,50,${a})`; x.beginPath(); x.moveTo(u * Wd, y - 6); x.quadraticCurveTo(u * Wd + 3, y, u * Wd, y + 6); x.stroke();
    }
    // 顔: 黄緑〜橙の細かい迷路のような線
    x.lineWidth = 2;
    for (let i = 0; i < 500; i++) { const u = rnd(), y = rnd() * 0.19 * Ht; x.strokeStyle = rnd() < 0.5 ? 'rgba(220,170,90,.55)' : 'rgba(170,200,110,.5)'; x.beginPath(); x.moveTo(u * Wd, y); x.bezierCurveTo(u * Wd + (rnd() - 0.5) * 20, y + (rnd() - 0.5) * 16, u * Wd + (rnd() - 0.5) * 20, y + (rnd() - 0.5) * 16, u * Wd + (rnd() - 0.5) * 24, y + (rnd() - 0.5) * 18); x.stroke(); }
    // 目の後ろの 2 本の黒い線（目は s 0.1, 左右の u = 0.06 / 0.44）
    x.strokeStyle = 'rgba(15,20,18,.9)'; x.lineWidth = 7; x.lineCap = 'round';
    for (const sd of [1, -1]) { const ue = sd > 0 ? 0.06 : 0.44;
      x.beginPath(); x.moveTo(ue * Wd + sd * 4, 0.1 * Ht + 6); x.quadraticCurveTo((ue + sd * 0.012) * Wd, 0.15 * Ht, (ue + sd * 0.02) * Wd, 0.2 * Ht); x.stroke();
      x.beginPath(); x.moveTo(ue * Wd - sd * 12, 0.1 * Ht + 8); x.quadraticCurveTo((ue - sd * 0.022) * Wd, 0.15 * Ht, (ue - sd * 0.03) * Wd, 0.205 * Ht); x.stroke(); }
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x8ac0b0, rimAmount: 0.15, clearcoat: 0.35, roughness: 0.48, side: THREE.FrontSide });
  const finC = [0.17, 0.33, 0.32], finE = [0.38, 0.5, 0.36];
  const lines = (a, y, z) => mix3(finC, finE, a * 0.6 + 0.25 * (Math.sin(z * 160 + a * 20) > 0.6 ? 1 : 0));
  return swimmer(size, {
    W, H, skinM, NS: 56, NR: 32, rigid: true, amp: () => 0, k: 0, freq: 0.5, tailBeat: 0.12, recoil: 0.001,
    yc: s => 0.012 * Math.exp(-Math.pow((s - 0.15) / 0.1, 2)),
    shape: (s, th) => { const sn = Math.sin(th); return 1 + (sn > 0 ? 0.38 * Math.exp(-Math.pow((s - 0.15) / 0.09, 2)) * Math.pow(sn, 1.5) : 0); },   // おでこのこぶ
    fins: [{ s0: 0.2, s1: 0.82, up: 1, n: 26, rays: true, h: u => 0.045 + 0.05 * ss(0.55, 0.85, u) * (1 - ss(0.92, 1, u) * 0.6), back: 0.5, c0: finC, c1: finE },
      { s0: 0.58, s1: 0.83, up: -1, n: 12, rays: true, h: u => 0.05 + 0.04 * Math.sin(Math.PI * u) * (1 - 0.3 * u), back: 0.5, c0: finC, c1: finE },
      { s0: 0.3, s1: 0.36, up: -1, n: 5, h: u => 0.05 * Math.sin(Math.PI * u), back: 0.7, c0: finC, c1: finE }],
    tails: [{ rotZ: Math.PI / 2, c: lines, foil: { span: 0.13, both: true, le: a => -0.005 - 0.01 * a, te: a => -0.03 - 0.14 * Math.sqrt(Math.max(0, 1 - 0.85 * a * a)), th: a => 0.01 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.25, th: -0.05, rot: [0.1, -0.6, 0.45], c: (a) => mix3([0.25, 0.38, 0.32], [0.5, 0.56, 0.4], a), flap: 0.55, flapF: 1.6, mat: finMat(0.5, 0.7), foil: { span: 0.1, le: a => -0.015 * a, te: a => -0.015 * a - 0.065 * Math.sqrt(Math.max(0, 1 - 0.8 * a * a)) - 0.005, th: a => 0.006 } }],
    extra: ctx => {
      const lipM = skin({ color: 0x4e7a6a, rim: 0xd0f0d0, rimAmount: 0.15, clearcoat: 0.4, roughness: 0.45 });
      ctx.lips = [[0.011, 0.009], [-0.007, 0.0085]].map(([dy, r]) => addTube(ctx, 14, 6, lipM, (u, out) => {   // 厚い唇（上・下）
        ctx.center(0, P); const x = u * 2 - 1; out.set(P.x + x * 0.022, P.y - 0.016 + dy - 0.006 * x * x, P.z - 0.001 - 0.022 * x * x); }, u => r * (1 - 0.45 * Math.pow(Math.abs(u * 2 - 1), 2))));
      ctx.eyes = addEyes(ctx, 0.1, 0.38, 0.016, 0xc08a3a);
    },
    onAnim: (t, ph, ctx) => { ctx.lips.forEach(f => f(t, ph)); ctx.eyes(); }
  });
}

// エイ（羽ばたいて泳ぐ）の共通の作り。体の幅 1（左右の羽の先から先）、+z が前、+y が背。
//   le(a), te(a): 羽の前の縁・後ろの縁の z（a: 0 中心 → 1 羽の先）、thick(u, a): 体の厚み、top / bottom: 背・腹の模様（canvas。横 = 左の羽の先 → 右の羽の先、縦 = 前 → 後ろ）
//   flap: 羽の先の上下の振れ幅、freq: 1 秒の羽ばたきの回数。羽ばたきの波は、付け根から羽の先へ、前から後ろへ伝わる
function rayFlyer(size, o) {
  const NU = 22, NV = 44, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const parts = [1, -1].map(side => {
    const n = (NU + 1) * (NV + 1), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), base = [], idx = [];
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
      const u = i / NU, v = j / NV * 2 - 1, a = Math.abs(v), k = i * (NV + 1) + j;
      const z = o.le(a) + (o.te(a) - o.le(a)) * u, y = side * o.thick(u, a) * (side > 0 ? 1 : 0.6);
      base.push([v * 0.5, y, z, a, u]); uv[k * 2] = (v + 1) / 2; uv[k * 2 + 1] = 1 - u;
      if (i < NU && j < NV) { const b = k + NV + 1; if (side > 0) idx.push(k, k + 1, b, b, k + 1, b + 1); else idx.push(k, b, k + 1, b, b + 1, k + 1); }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, side > 0 ? o.topM : o.botM); body.add(m);
    return { geo, base };
  });
  const yAt = (a, u, ph) => o.flap * Math.pow(a, 1.6) * Math.sin(ph - a * 1.3 - u * 0.9);   // 羽の上下
  const ctx = { g, body, yAt };
  if (o.extra) o.extra(ctx);
  g.scale.setScalar(size);
  function animate(t, speed = 1) {
    const sp = Math.min(2, Math.max(0.3, speed || 1)), ph = t * Math.PI * 2 * o.freq * (0.8 + 0.2 * sp);
    parts.forEach(({ geo, base }) => {
      const p = geo.attributes.position;
      for (let k = 0; k < base.length; k++) { const [x, y, z, a, u] = base[k]; p.setXYZ(k, x * (1 - 0.06 * Math.pow(a, 2) * (1 - Math.cos(ph - a * 1.3)) * 0.5), y + yAt(a, u, ph), z); }   // 羽を上げると、先が少し内へ寄る
      p.needsUpdate = true; geo.computeVertexNormals();
    });
    body.position.y = -0.012 * o.flap * 4 * Math.sin(ph + 0.4);         // 羽ばたきの反動で、体が少し上下する
    if (o.onAnim) o.onAnim(t, ph, ctx);
  }
  animate(0);
  return { group: g, animate };
}
// 背・腹の模様の canvas: 横 = 左の羽の先(0) → 右の羽の先(1)、縦 = 前(0) → 後ろ(1)。in(x, y) は体の形の内側か
function rayTex(key, o, draw) {
  return tex(key, 1024, 512, (x, Wd, Ht) => draw(x, Wd, Ht, (cx, cy) => { const a = Math.abs(cx * 2 - 1), z = o.le(a) + (o.te(a) - o.le(a)) * cy; return [a, z]; }));
}

// マダラトビエイ（Aetobatus narinari）: 羽を広げると 2〜3m。菱形の大きな胸びれ（羽）を鳥のように羽ばたく。
// 頭は羽より前へ突き出し、アヒルのくちばしのように平たく丸い。目は頭の横。尾はむちのように細く長く（体の 2〜3 倍）、付け根に小さな背びれと毒のとげ。
// 背は濃い紺〜黒に、白い水玉（大きいものは輪の形）。腹は白い
function buildEagleRay(size) {
  const o = { le: a => 0.2 - 0.33 * Math.pow(a, 1.25), te: a => -0.28 + 0.15 * Math.pow(a, 0.75), flap: 0.13, freq: 0.42,
    thick: (u, a) => 0.065 * Math.pow(Math.max(0, 1 - a * 1.6), 1.4) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.5) + 0.004 * (1 - a) * Math.sin(Math.PI * u) };
  const topT = rayTex('eagleTop', o, (x, Wd, Ht) => {
    const gr = x.createLinearGradient(0, 0, 0, Ht); gr.addColorStop(0, '#141c2c'); gr.addColorStop(1, '#0d121d'); x.fillStyle = gr; x.fillRect(0, 0, Wd, Ht);
    mottle(x, Wd, Ht, 40, 20, 60, 'rgba(40,55,80,.2)');
    for (let i = 0; i < 260; i++) {                                    // 白い水玉（羽の縁へ小さく。大きいものは輪の形）
      const cx = rnd(), cy = rnd(), a = Math.abs(cx * 2 - 1), r = (5 + rnd() * 6) * (1 - 0.6 * a);
      x.fillStyle = 'rgba(232,236,240,.92)'; x.beginPath(); x.arc(cx * Wd, cy * Ht, r, 0, 7); x.fill();
      if (r > 8 && rnd() < 0.5) { x.fillStyle = '#121a29'; x.beginPath(); x.arc(cx * Wd, cy * Ht, r * 0.45, 0, 7); x.fill(); }
    }
  });
  const botT = rayTex('eagleBot', o, (x, Wd, Ht) => {
    x.fillStyle = '#eceae6'; x.fillRect(0, 0, Wd, Ht);
    for (let i = 0; i < 1024; i += 4) { const a = Math.abs(i / Wd * 2 - 1); if (a > 0.82) { x.fillStyle = `rgba(30,36,48,${(a - 0.82) * 3})`; x.fillRect(i, 0, 4, Ht); } }   // 羽の先の縁は暗い
    gillSlits(x, Wd, Ht, 0.06, 0.16, 0.4, 'rgba(150,145,140,.7)');
  });
  const topM = skin({ color: 0xffffff, map: topT, rim: 0x6a7a90, rimAmount: 0.15, clearcoat: 0.45, roughness: 0.42 });
  const botM = skin({ color: 0xffffff, map: botT, rim: 0xffffff, rimAmount: 0.08, clearcoat: 0.2, roughness: 0.55 });
  return rayFlyer(size, Object.assign(o, { topM, botM,
    extra: ctx => {
      const headM = skin({ color: 0xffffff, vertexColors: true, rim: 0x6a7a90, rimAmount: 0.15, clearcoat: 0.45, roughness: 0.45 });
      const hg = new THREE.SphereGeometry(1, 20, 12), hp = hg.attributes.position, hc = new Float32Array(hp.count * 3);
      for (let i = 0; i < hp.count; i++) { const y = hp.getY(i), z = hp.getZ(i); hp.setY(i, y * (y > 0 ? 1 : 0.7) * (1 - 0.35 * Math.max(0, z))); const c = y > -0.15 ? [0.08, 0.1, 0.15] : [0.9, 0.9, 0.88]; hc.set(c, i * 3); }
      hg.setAttribute('color', new THREE.BufferAttribute(hc, 3)); hg.computeVertexNormals();
      const head = new THREE.Mesh(hg, headM); head.scale.set(0.062, 0.042, 0.11); head.position.set(0, 0.012, 0.25); ctx.body.add(head);
      const eyeG = new THREE.SphereGeometry(0.011, 10, 8), em = eyeM();
      [1, -1].forEach(sd => { const e = new THREE.Mesh(eyeG, em); e.position.set(sd * 0.056, 0.03, 0.2); e.scale.x = 0.6; ctx.body.add(e);
        const sp = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0x05070a })); sp.scale.set(0.7, 0.4, 1.4); sp.position.set(sd * 0.045, 0.04, 0.16); ctx.body.add(sp); });   // 目の後ろの噴水孔
      const tailM = skin({ color: 0x141a24, rim: 0x6a7a90, rimAmount: 0.15, roughness: 0.45 });
      ctx.tail = addTube(ctx, 24, 5, tailM, (u, out, t) => out.set(0.025 * Math.sin(t * 1.3 - u * 5) * u, 0.02 - 0.03 * u + 0.025 * Math.sin(t * 2.7 - u * 4) * u * u, -0.26 - 1.25 * u), u => 0.012 * Math.pow(1 - u, 1.3) + 0.0008);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 6).scale(0.35, 1, 1).rotateX(-0.9), tailM); fin.position.set(0, 0.03, -0.3); ctx.body.add(fin);   // 尾の付け根の小さな背びれ
      [1, -1].forEach(sd => { const pv = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), headM); pv.scale.set(0.035, 0.008, 0.05); pv.position.set(sd * 0.04, -0.005, -0.28); ctx.body.add(pv); });   // 腹びれ
    },
    onAnim: (t, ph, ctx) => ctx.tail(t, ph)
  }));
}
function gillSlits(x, Wd, Ht, a0, y0, y1, rgba) {                   // 腹のえらあな（左右に 5 本ずつ）
  x.strokeStyle = rgba; x.lineWidth = 3;
  for (const sd of [1, -1]) for (let k = 0; k < 5; k++) { const y = (y0 + (y1 - y0) * k / 4) * Ht, cx = (0.5 + sd * (a0 + 0.005 * k)) * Wd; x.beginPath(); x.moveTo(cx, y); x.lineTo(cx + sd * 18, y + 2); x.stroke(); }
}

// ナンヨウマンタ（Mobula alfredi）: 羽を広げると 3〜5m。後ろへ反った鎌形の大きな羽、頭の前の左右に頭びれ（ふだんは内へ巻き、食べるときは広げる）、
// 頭の前の端に横一文字の大きな口。尾は短く、毒のとげはない。背は黒く、肩に白い模様（口と平行に、前から後ろへ流れる）。
// 腹は白く、えらあなの間と腹に黒い斑点（1 匹ずつ違う）、羽の後ろの縁は暗い灰色。ゆっくり大きく羽ばたいて、宙を舞うように泳ぐ
function buildManta(size) {
  const o = { le: a => 0.16 - 0.38 * Math.pow(a, 1.6), te: a => -0.22 + 0.1 * Math.sin(Math.PI * a) * Math.pow(1 - a, 0.3), flap: 0.16, freq: 0.3,
    thick: (u, a) => 0.07 * Math.pow(Math.max(0, 1 - a * 1.5), 1.3) * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.45) + 0.004 * (1 - a) * Math.sin(Math.PI * u) };
  const topT = rayTex('mantaTop', o, (x, Wd, Ht, at) => {
    x.fillStyle = '#0e1013'; x.fillRect(0, 0, Wd, Ht);
    mottle(x, Wd, Ht, 40, 20, 60, 'rgba(40,44,50,.25)');
    // 肩の白い模様: 頭の左右から、羽の前の縁に沿って外へ流れ、ぼかして消える
    for (const sd of [1, -1]) for (let i = 0; i < 380; i++) {
      const q = rnd(), a = 0.07 + q * 0.4, cy = 0.1 + q * 0.12 + rnd() * (0.22 - q * 0.12), r = 16 + rnd() * 22 * (1 - q);
      const gr = x.createRadialGradient((0.5 + sd * a / 2) * Wd, cy * Ht, 0, (0.5 + sd * a / 2) * Wd, cy * Ht, r);
      gr.addColorStop(0, `rgba(205,210,212,${0.12 * (1 - q * 0.8)})`); gr.addColorStop(1, 'rgba(220,224,226,0)'); x.fillStyle = gr; x.fillRect((0.5 + sd * a / 2) * Wd - r, cy * Ht - r, r * 2, r * 2);
    }
  });
  const botT = rayTex('mantaBot', o, (x, Wd, Ht) => {
    x.fillStyle = '#ecebe8'; x.fillRect(0, 0, Wd, Ht);
    for (let cy = 0; cy < Ht; cy += 4) for (let cx = 0; cx < Wd; cx += 4) {                // 羽の後ろの縁と先は暗い灰色
      const a = Math.abs(cx / Wd * 2 - 1), z = o.le(a) + (o.te(a) - o.le(a)) * cy / Ht, edge = Math.max(ss(0.72, 0.95, cy / Ht) * ss(0.25, 0.5, a), ss(0.8, 0.97, a));
      if (edge > 0.02) { x.fillStyle = `rgba(40,42,46,${edge * 0.9})`; x.fillRect(cx, cy, 4, 4); }
    }
    gillSlits(x, Wd, Ht, 0.07, 0.2, 0.48, 'rgba(120,118,115,.8)');
    for (let i = 0; i < 26; i++) { const cx = 0.5 + (rnd() - 0.5) * 0.22, cy = 0.22 + rnd() * 0.45, r = 3 + rnd() * 8; x.fillStyle = 'rgba(25,27,30,.85)'; x.beginPath(); x.ellipse(cx * Wd, cy * Ht, r * 1.3, r, rnd() * 3, 0, 7); x.fill(); }   // 腹の黒い斑点
  });
  const topM = skin({ color: 0xffffff, map: topT, rim: 0x6a7280, rimAmount: 0.12, clearcoat: 0.35, roughness: 0.5 });
  const botM = skin({ color: 0xffffff, map: botT, rim: 0xffffff, rimAmount: 0.08, clearcoat: 0.2, roughness: 0.55 });
  return rayFlyer(size, Object.assign(o, { topM, botM,
    extra: ctx => {
      const darkM = skin({ color: 0x15171a, rim: 0x6a7280, rimAmount: 0.15, roughness: 0.5 });
      // 頭びれ: 頭の前の左右に、内へ巻いた細長いひれ（巻いた板）
      ctx.lobes = [1, -1].map(sd => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.015, 0.095, 12, 4, true, 0, Math.PI * 1.5).scale(0.55, 1, 1).rotateX(Math.PI / 2).translate(0, 0, 0.045), darkM);
        m.position.set(sd * 0.068, 0.0, 0.135); m.rotation.z = sd * 2.2; m.rotation.y = -sd * 0.12; ctx.body.add(m); return { m, sd }; });
      const inM = new THREE.MeshBasicMaterial({ color: 0x0a0b0d, side: THREE.DoubleSide });
      const gape = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.022), inM); gape.position.set(0, -0.004, 0.161); ctx.body.add(gape);   // 横一文字の口
      ctx.lip = addTube(ctx, 12, 5, darkM, (u, out) => { const x = u * 2 - 1; out.set(x * 0.058, 0.006 - 0.004 * x * x, 0.158 - 0.01 * x * x); }, () => 0.004);
      const eyeG = new THREE.SphereGeometry(0.01, 10, 8), em = eyeM();
      [1, -1].forEach(sd => { const e = new THREE.Mesh(eyeG, em); e.position.set(sd * 0.088, 0.008, 0.12); e.scale.x = 0.55; ctx.body.add(e); });
      ctx.tail = addTube(ctx, 10, 5, darkM, (u, out, t) => out.set(0.01 * Math.sin(t * 1.1 - u * 3) * u, 0.01 - 0.01 * u, -0.2 - 0.17 * u), u => 0.008 * (1 - u) + 0.001);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 6).scale(0.35, 1, 1).rotateX(-1.0), darkM); fin.position.set(0, 0.02, -0.21); ctx.body.add(fin);
      [1, -1].forEach(sd => { const pv = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), darkM); pv.scale.set(0.03, 0.006, 0.04); pv.position.set(sd * 0.035, -0.002, -0.215); ctx.body.add(pv); });
    },
    onAnim: (t, ph, ctx) => {
      ctx.lobes.forEach(({ m, sd }) => { m.position.y = ctx.yAt(0.15, 0.05, ph) * 0.3; m.rotation.x = 0.15 + 0.06 * Math.sin(t * 0.7 + sd); });
      ctx.lip(t, ph); ctx.tail(t, ph);
    }
  }));
}

// ---------- 外洋の群れの魚とイルカ（pelagic.js が、細かい形を 1 つの形に焼き付けて、まとめて描く） ----------
// キハダ（Thunnus albacares）: 体長 1〜2m。紡錘形で、背は金属のような濃い紺、目から尾へ金色の帯。腹は銀白色で、細い白い線が縦に並ぶ。
// 大人は第 2 背びれとしりびれが鎌のように長く伸び、鮮やかな黄色。小離鰭も黄色で、縁が黒い。胸びれは長く、第 2 背びれの下まで届く
function buildYellowfin(size) {
  const W = curve([0, 0.04, 0.15, 0.35, 0.6, 0.82, 0.93, 1], [0.008, 0.045, 0.086, 0.1, 0.08, 0.032, 0.012, 0.011]);
  const H = curve([0, 0.04, 0.15, 0.35, 0.6, 0.82, 0.93, 1], [0.008, 0.052, 0.104, 0.126, 0.095, 0.036, 0.014, 0.013]);
  const map = tex('yellowfin', 1024, 512, (x, Wd, Ht) => {
    const gr = x.createLinearGradient(0, 0, Wd, 0);
    [[0, '#c4ccd6'], [0.07, '#3a4f7e'], [0.15, '#14204a'], [0.25, '#0c1638'], [0.35, '#14204a'], [0.43, '#3a4f7e'], [0.5, '#c4ccd6'], [0.6, '#e2e6ea'], [0.75, '#f2f3f4'], [0.9, '#e2e6ea'], [1, '#c4ccd6']].forEach(([o, c]) => gr.addColorStop(o, c));
    x.fillStyle = gr; x.fillRect(0, 0, Wd, Ht);
    mottle(x, Wd, Ht, 60, 10, 30, 'rgba(60,80,160,.2)', 0.05, 0.9, [0.12, 0.38]);
    // 金色の帯（目の後ろから尾の手前まで。後ろほど細く淡い）
    x.filter = 'blur(4px)';
    for (const u of [0.065, 0.435]) for (let i = 0; i < 40; i++) { const y = 0.1 + i * 0.019, w = 26 * (1 - i / 48); x.fillStyle = `rgba(235,195,60,${0.75 * (1 - i / 46)})`; x.fillRect(u * Wd - w / 2, y * Ht, w, 0.022 * Ht); }
    x.filter = 'none';
    // 腹の、縦に並ぶ細い白い線（切れ切れ）
    x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 2;
    for (let i = 0; i < 26; i++) { const y = (0.28 + i * 0.022) * Ht; for (const [u0, u1] of [[0.55, 0.68], [0.82, 0.95]]) { x.beginPath(); x.moveTo(u0 * Wd, y); for (let u = u0; u < u1; u += 0.012) x[rnd() < 0.25 ? 'moveTo' : 'lineTo'](u * Wd, y + Math.sin(u * 80) * 2); x.stroke(); } }
    x.strokeStyle = 'rgba(20,28,50,.6)'; x.lineWidth = 2.5;            // えらぶたの縁と口の線
    for (const um of [0.02, 0.48]) { x.beginPath(); x.moveTo((um - 0.07) * Wd, 0.17 * Ht); x.quadraticCurveTo(um * Wd, 0.19 * Ht, (um + 0.07) * Wd, 0.17 * Ht); x.stroke(); }
    for (const um of [0.97, 0.53]) { x.beginPath(); x.moveTo(0.75 * Wd, 0.005 * Ht); x.lineTo(um * Wd, 0.065 * Ht); x.stroke(); }
  });
  const skinM = new THREE.MeshPhysicalMaterial({ map, metalness: 0.45, roughness: 0.27, clearcoat: 0.9 });
  const dark = [0.08, 0.1, 0.22], yel = [1.0, 0.8, 0.12], yel2 = [0.95, 0.72, 0.1], gray = [0.25, 0.28, 0.36];
  const finlets = [];
  for (let k = 0; k < 8; k++) { const s = 0.6 + k * 0.034; finlets.push({ s0: s, s1: s + 0.02, up: 1, n: 2, h: u => 0.018 - 0.009 * u, back: 0.8, c0: yel2, c1: [0.25, 0.2, 0.05] }); }
  for (let k = 0; k < 7; k++) { const s = 0.63 + k * 0.034; finlets.push({ s0: s, s1: s + 0.02, up: -1, n: 2, h: u => 0.016 - 0.008 * u, back: 0.8, c0: yel2, c1: [0.25, 0.2, 0.05] }); }
  return swimmer(size, {
    W, H, skinM, NS: 72, NR: 36, rigid: true, amp: () => 0, k: 0, freq: 2.6, tailBeat: 0.3, recoil: 0.001,
    fins: [{ s0: 0.27, s1: 0.44, up: 1, n: 10, rays: true, h: u => 0.09 * Math.pow(1 - u, 1.3) + 0.004, back: 0.3, c0: dark, c1: mix3(dark, yel, 0.3) },
      { s0: 0.47, s1: 0.55, up: 1, n: 8, h: u => 0.19 * Math.pow(1 - u, 1.1) * Math.min(1, 0.35 + u * 6) + 0.006, back: 0.85, c0: yel2, c1: yel },     // 鎌のような第 2 背びれ
      { s0: 0.5, s1: 0.58, up: -1, n: 8, h: u => 0.18 * Math.pow(1 - u, 1.1) * Math.min(1, 0.35 + u * 6) + 0.006, back: 0.85, c0: yel2, c1: yel },     // しりびれ
      ...finlets,
      ...[1, -1].flatMap(sd => [{ s0: 0.86, s1: 0.98, side: sd, n: 6, h: u => 0.016 * Math.sin(Math.PI * u), back: 0.2, c0: dark, c1: dark }])],
    tails: [{ rotZ: Math.PI / 2, c: a => mix3(gray, [0.35, 0.33, 0.22], a), foil: { span: 0.17, both: true, nA: 16, le: a => -0.004 - 0.12 * Math.pow(a, 1.5), te: a => -0.004 - 0.12 * Math.pow(a, 1.5) - 0.036 * (1 - a) - 0.006, th: a => 0.009 * (1 - a) + 0.0015 } }],
    pecs: [{ s: 0.24, th: -0.1, rot: [0.12, -1.05, -0.3], c: a => mix3(dark, [0.4, 0.42, 0.5], a), foil: { span: 0.22, le: a => -0.05 * a * a, te: a => -0.05 * a * a - 0.04 * (1 - 0.8 * a) - 0.004, th: a => 0.007 * (1 - a) + 0.001 } }],
    extra: ctx => { ctx.eyes = addEyes(ctx, 0.07, 0.12, 0.016, 0x8a7a40); },
    onAnim: (t, ph, ctx) => ctx.eyes()
  });
}

// ハシナガイルカ（Stenella longirostris）: 体長 2m ほどの細身のイルカ。細く長いくちばし。体は 3 色: 背は濃い灰色（ケープ）、わき腹は淡い灰色、腹は白。
// 目から胸びれへ暗い線。背びれは三角形で立ち、尾びれは横に広がる。群れで泳ぎ、海面から跳び出してきりもみ回転する
function buildSpinnerDolphin(size) {
  const W = curve([0, 0.05, 0.16, 0.36, 0.6, 0.8, 0.92, 1], [0.018, 0.048, 0.078, 0.088, 0.07, 0.038, 0.016, 0.011]);
  const H = curve([0, 0.05, 0.16, 0.36, 0.6, 0.8, 0.92, 1], [0.018, 0.052, 0.085, 0.098, 0.082, 0.05, 0.026, 0.015]);
  const map = tex('spinner', 1024, 512, (x, Wd, Ht) => {
    const gr = x.createLinearGradient(0, 0, Wd, 0);
    [[0, '#737b85'], [0.08, '#5f6770'], [0.14, '#1f2329'], [0.25, '#16191e'], [0.36, '#1f2329'], [0.42, '#5f6770'], [0.5, '#737b85'], [0.6, '#b4b9bd'], [0.67, '#e6e5e2'], [0.75, '#f0efec'], [0.83, '#e6e5e2'], [0.9, '#b4b9bd'], [1, '#737b85']].forEach(([o, c]) => gr.addColorStop(o, c));
    x.fillStyle = gr; x.fillRect(0, 0, Wd, Ht);
    // ケープの下の縁は、背びれの下で少し下がる（波打つ境目）
    x.filter = 'blur(6px)'; x.fillStyle = 'rgba(28,31,37,.85)';
    for (const [u0, dir] of [[0.16, -1], [0.34, 1]]) { x.beginPath(); x.moveTo(u0 * Wd, 0); for (let y = 0; y <= 1.0001; y += 0.02) x.lineTo((u0 + dir * 0.05 * Math.sin(Math.PI * Math.min(1, Math.max(0, (y - 0.25) / 0.45)))) * Wd, y * Ht); x.lineTo(0.25 * Wd, Ht); x.lineTo(0.25 * Wd, 0); x.fill(); }
    // 目から胸びれへの暗い線
    x.strokeStyle = 'rgba(45,50,58,.85)'; x.lineWidth = 9;
    for (const [ue, dir] of [[0.03, 1], [0.47, -1]]) { x.beginPath(); x.moveTo(ue * Wd, 0.07 * Ht); x.quadraticCurveTo((ue - dir * 0.03) * Wd, 0.14 * Ht, (ue - dir * 0.09) * Wd, 0.22 * Ht); x.stroke(); }
    x.filter = 'none';
    mottle(x, Wd, Ht, 40, 6, 18, 'rgba(255,255,255,.1)', 0.1, 0.9, [0.1, 0.4]);   // 古い傷跡
  });
  const skinM = skin({ color: 0xffffff, map, rim: 0x9aa4ae, rimAmount: 0.15, clearcoat: 0.8, roughness: 0.3, side: THREE.FrontSide, bump: 0.2 });
  const dark = [0.2, 0.22, 0.26];
  return swimmer(size, {
    W, H, skinM, NS: 64, NR: 32, vertical: true, amp: s => 0.05 * Math.pow(s, 2), k: 2.5, freq: 1.5, tailBeat: 0.2,
    yc: s => 0.006 * Math.sin(Math.PI * s),
    fins: [{ s0: 0.42, s1: 0.56, up: 1, n: 10, h: u => 0.1 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.7) * (1 - 0.2 * u), back: 0.55, c0: dark, c1: dark }],
    tails: [{ rotZ: 0, c: () => dark, foil: { span: 0.13, both: true, le: a => -0.005 - 0.07 * Math.pow(a, 1.4), te: a => -0.03 - 0.06 * Math.pow(a, 1.4) + 0.02 * Math.exp(-a * 12) - 0.01, th: a => 0.012 * (1 - a) + 0.002 } }],
    pecs: [{ s: 0.21, th: -0.6, rot: [0.25, -0.75, -0.45], c: () => dark, foil: { span: 0.12, le: a => -0.03 * a * a, te: a => -0.03 * a * a - 0.04 * (1 - 0.6 * a) - 0.006, th: a => 0.01 * (1 - a) + 0.002 } }],
    extra: ctx => {
      const beakM = skin({ color: 0xffffff, vertexColors: true, rim: 0x9aa4ae, rimAmount: 0.15, clearcoat: 0.8, roughness: 0.32 });
      const bg = new THREE.CylinderGeometry(0.006, 0.016, 0.1, 12, 4).rotateX(Math.PI / 2).translate(0, 0, 0.05), bp = bg.attributes.position, bc = new Float32Array(bp.count * 3);
      for (let i = 0; i < bp.count; i++) { const c = bp.getY(i) > 0.002 ? [0.24, 0.26, 0.3] : [0.85, 0.85, 0.84]; bc.set(c, i * 3); bp.setY(i, bp.getY(i) * 0.75); }
      bg.setAttribute('color', new THREE.BufferAttribute(bc, 3)); bg.computeVertexNormals();
      const beak = new THREE.Mesh(bg, beakM); beak.position.set(0, -0.012, 0.49); ctx.body.add(beak);   // 細く長いくちばし（上は暗く、下は白い）
      const hole = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x15181c })); hole.scale.set(0.008, 0.002, 0.004); ctx.body.add(hole); ctx.hole = hole;   // 噴気孔
      ctx.eyes = addEyes(ctx, 0.07, -0.05, 0.007, 0x2a2e34);
    },
    onAnim: (t, ph, ctx) => { ctx.surf(0.13, Math.PI / 2, ctx.hole.position); ctx.eyes(); }
  });
}

// シイラ（Coryphaena hippurus）: 体長 1m ほど。左右に平たく、頭から尾へ細くなる体。大人の雄はおでこが四角く盛り上がる。
// 頭のすぐ後ろから尾の手前まで、長い背びれ（濃い青）。体は金色がかった黄緑から、背は青緑、腹は黄色。わき腹に青や黒の小さな斑点。尾びれは深く二股
function buildMahi(size) {
  const W = curve([0, 0.05, 0.2, 0.45, 0.75, 0.92, 1], [0.012, 0.035, 0.05, 0.046, 0.03, 0.014, 0.01]);
  const H = curve([0, 0.05, 0.12, 0.3, 0.6, 0.85, 0.95, 1], [0.03, 0.1, 0.13, 0.12, 0.085, 0.04, 0.018, 0.014]);
  const map = tex('mahi', 1024, 512, (x, Wd, Ht) => {
    const gr = x.createLinearGradient(0, 0, Wd, 0);
    [[0, '#b9c84a'], [0.12, '#4a9a7a'], [0.25, '#1e5f78'], [0.38, '#4a9a7a'], [0.5, '#b9c84a'], [0.62, '#e8d64a'], [0.75, '#f2df5a'], [0.88, '#e8d64a'], [1, '#b9c84a']].forEach(([o, c]) => gr.addColorStop(o, c));
    x.fillStyle = gr; x.fillRect(0, 0, Wd, Ht);
    mottle(x, Wd, Ht, 80, 14, 40, 'rgba(60,170,170,.25)', 0, 1, [0.05, 0.45]);   // 青緑のつや
    for (let i = 0; i < 260; i++) { const u = rnd(), y = 0.12 + rnd() * 0.75; if (Math.abs(((u + 0.25) % 0.5) - 0.25) < 0.05) continue; x.fillStyle = rnd() < 0.7 ? 'rgba(40,90,200,.75)' : 'rgba(20,30,40,.7)'; x.beginPath(); x.arc(u * Wd, y * Ht, 2 + rnd() * 3.5, 0, 7); x.fill(); }   // 青と黒の斑点
  });
  const skinM = new THREE.MeshPhysicalMaterial({ map, metalness: 0.35, roughness: 0.3, clearcoat: 0.8 });
  const blue = [0.1, 0.25, 0.6], gold = [0.85, 0.82, 0.3];
  return swimmer(size, {
    W, H, skinM, NS: 64, NR: 32, amp: s => 0.04 + 0.05 * s * s, k: 4.5, freq: 1.8, tailBeat: 0.2,
    yc: s => 0.03 * Math.exp(-Math.pow((s - 0.05) / 0.08, 2)),
    shape: (s, th) => { const sn = Math.sin(th); return 1 + (sn > 0 ? 0.25 * (1 - ss(0.02, 0.15, s)) * sn : 0); },   // 四角く盛り上がったおでこ
    fins: [{ s0: 0.08, s1: 0.9, up: 1, n: 30, rays: true, h: u => 0.07 * (1 - 0.55 * u) * Math.min(1, u * 12 + 0.3) + 0.004, back: 0.4, c0: blue, c1: [0.15, 0.35, 0.75] },
      { s0: 0.5, s1: 0.9, up: -1, n: 14, rays: true, h: u => 0.045 * (1 - 0.5 * u) + 0.003, back: 0.4, c0: gold, c1: [0.75, 0.75, 0.4] }],
    tails: [{ rotZ: Math.PI / 2, c: a => mix3(gold, [0.7, 0.8, 0.4], a), foil: { span: 0.17, both: true, nA: 16, le: a => -0.005 - 0.11 * Math.pow(a, 1.3), te: a => -0.005 - 0.11 * Math.pow(a, 1.3) - 0.05 * (1 - a) - 0.008, th: a => 0.008 * (1 - a) + 0.0015 } }],
    pecs: [{ s: 0.2, th: -0.25, rot: [0.15, -0.9, -0.2], c: () => [0.6, 0.7, 0.5], foil: { span: 0.08, le: a => -0.02 * a, te: a => -0.02 * a - 0.035 * (1 - 0.6 * a) - 0.004, th: () => 0.005 } }],
    extra: ctx => { ctx.eyes = addEyes(ctx, 0.06, 0.05, 0.013, 0x8a8a40); },
    onAnim: (t, ph, ctx) => ctx.eyes()
  });
}

// トビウオ（ツクシトビウオの仲間, Cheilopogon spp.）: 体長 30cm ほど。円筒形の体と、体長ほどもある大きな胸びれ（翼）、大きな腹びれ。
// 背は濃い青、腹は銀白色。翼は透けた青灰色に、濃い筋。尾びれは下の葉が長い（海面をたたいて飛び立つ）
function buildFlyingfish(size) {
  const W = curve([0, 0.06, 0.25, 0.55, 0.85, 1], [0.02, 0.055, 0.075, 0.065, 0.03, 0.016]);
  const H = curve([0, 0.06, 0.25, 0.55, 0.85, 1], [0.02, 0.055, 0.08, 0.07, 0.034, 0.018]);
  const map = tex('flyingfish', 512, 256, (x, Wd, Ht) => {
    const gr = x.createLinearGradient(0, 0, Wd, 0);
    [[0, '#a8b8cc'], [0.1, '#2a4a8a'], [0.25, '#16285a'], [0.4, '#2a4a8a'], [0.5, '#a8b8cc'], [0.62, '#dfe6ec'], [0.75, '#f0f3f5'], [0.88, '#dfe6ec'], [1, '#a8b8cc']].forEach(([o, c]) => gr.addColorStop(o, c));
    x.fillStyle = gr; x.fillRect(0, 0, Wd, Ht);
  });
  const skinM = new THREE.MeshPhysicalMaterial({ map, metalness: 0.45, roughness: 0.28, clearcoat: 0.8 });
  const wing = (a, y, z) => mix3([0.3, 0.42, 0.62], [0.55, 0.68, 0.82], a).map(v => v * (Math.sin(z * 140 + a * 3) > 0.55 ? 0.7 : 1));   // 翼の筋
  const dark = [0.15, 0.25, 0.45];
  return swimmer(size, {
    W, H, skinM, NS: 48, NR: 24, amp: s => 0.03 + 0.05 * s * s, k: 4, freq: 3, tailBeat: 0.2,
    fins: [{ s0: 0.6, s1: 0.75, up: 1, n: 6, h: u => 0.05 * Math.sin(Math.PI * u), back: 0.5, c0: dark, c1: dark },
      { s0: 0.62, s1: 0.76, up: -1, n: 6, h: u => 0.04 * Math.sin(Math.PI * u), back: 0.5, c0: [0.6, 0.65, 0.72], c1: [0.6, 0.65, 0.72] }],
    tails: [{ rotZ: Math.PI / 2, c: () => dark, foil: { span: 0.12, le: a => -0.08 * a, te: a => -0.08 * a - 0.05 * (1 - a) - 0.01, th: a => 0.008 * (1 - a) + 0.0015 } },
      { rotZ: -Math.PI / 2, c: () => dark, foil: { span: 0.17, le: a => -0.12 * a, te: a => -0.12 * a - 0.06 * (1 - a) - 0.01, th: a => 0.008 * (1 - a) + 0.0015 } }],   // 下の葉が長い
    pecs: [{ s: 0.22, th: 0.1, rot: [0.02, -0.55, -0.08], c: wing, mat: finMat(0.8, 0.4), foil: { span: 0.62, nA: 16, le: a => -0.1 * a * a, te: a => -0.1 * a * a - 0.16 * Math.sin(Math.PI * Math.min(1, 0.25 + a * 0.85)) - 0.02, th: a => 0.006 * (1 - a) + 0.001 } },   // 大きな翼
      { s: 0.5, th: -0.6, rot: [0.02, -0.5, -0.05], c: wing, mat: finMat(0.8, 0.4), foil: { span: 0.22, le: a => -0.05 * a * a, te: a => -0.05 * a * a - 0.07 * (1 - 0.5 * a) - 0.01, th: () => 0.004 } }],   // 腹びれ（小さな翼）
    extra: ctx => { ctx.eyes = addEyes(ctx, 0.07, 0.15, 0.018, 0x9aa8b8); },
    onAnim: (t, ph, ctx) => ctx.eyes()
  });
}

// 細かく作った体を、1 つの形に焼き付ける（まっすぐ泳ぐ姿勢で。模様の画像の色は、頂点の色に写す）。
// 頭を +x、体長 1、中心が原点にそろえる（reef.js の魚の形と同じ向き。揺れはシェーダーで付ける）
const BAKE_PIX = new WeakMap();
function bakePixels(t) {
  if (BAKE_PIX.has(t)) return BAKE_PIX.get(t);
  let r = null; const im = t.image;
  if (im && im.width) { const c = document.createElement('canvas'); c.width = Math.min(512, im.width); c.height = Math.min(512, im.height); const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height); r = { W: c.width, H: c.height, d: x.getImageData(0, 0, c.width, c.height).data }; }
  BAKE_PIX.set(t, r); return r;
}
function bakeSpecies(name) {
  const b = window.SPECIES[name](1); b.animate(0, 0);
  const g = b.group; g.updateMatrixWorld(true);
  const parts = [], white = new THREE.Color(1, 1, 1);
  g.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const m = [].concat(o.material)[0];
    const geo = o.geometry.clone(); if (!geo.attributes.normal) geo.computeVertexNormals();   // 頂点を共有したまま（番号付きのまま）まとめる（頂点の数を少なく）
    geo.applyMatrix4(o.matrixWorld);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3), base = m.color || white, vc = m.vertexColors && geo.attributes.color, uv = geo.attributes.uv, px = m.map && uv ? bakePixels(m.map) : null;
    for (let i = 0; i < n; i++) {
      let r = 1, gg = 1, bb = 1;
      if (px) { let u = uv.getX(i), v = uv.getY(i); u -= Math.floor(u); v = Math.min(1, Math.max(0, v)); const k = (Math.min(px.H - 1, Math.floor((m.map.flipY ? 1 - v : v) * px.H)) * px.W + Math.min(px.W - 1, Math.floor(u * px.W))) * 4; r = px.d[k] / 255; gg = px.d[k + 1] / 255; bb = px.d[k + 2] / 255; }
      col[i * 3] = base.r * r * (vc ? vc.getX(i) : 1); col[i * 3 + 1] = base.g * gg * (vc ? vc.getY(i) : 1); col[i * 3 + 2] = base.b * bb * (vc ? vc.getZ(i) : 1);
    }
    const idx = geo.index ? Array.from(geo.index.array) : Array.from({ length: n }, (_, i) => i);
    parts.push({ pos: geo.attributes.position.array, nor: geo.attributes.normal.array, col, idx, n });
  });
  let n = 0, ni = 0; parts.forEach(q => { n += q.n; ni += q.idx.length; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), index = new Uint32Array(ni); let o = 0, oi = 0;
  parts.forEach(q => { pos.set(q.pos, o * 3); nor.set(q.nor, o * 3); col.set(q.col, o * 3); for (let k = 0; k < q.idx.length; k++) index[oi + k] = q.idx[k] + o; o += q.n; oi += q.idx.length; });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3)); out.setIndex(new THREE.BufferAttribute(index, 1));
  out.rotateY(Math.PI / 2);                                             // +z 前 → +x 前
  out.computeBoundingBox(); const bx = out.boundingBox, L = bx.max.x - bx.min.x;
  out.translate(-(bx.max.x + bx.min.x) / 2, 0, 0); out.scale(1 / L, 1 / L, 1 / L);
  if (b.dispose) b.dispose();
  return out;
}
window.SPECIES_BAKE = bakeSpecies;

window.SPECIES = Object.assign(window.SPECIES || {}, {
  marlin: buildMarlin, whaleshark: buildWhaleShark, oceanicwhitetip: buildOceanicWhitetip, mola: buildMola, skipjack: buildSkipjackSchool,
  humpback: buildHumpback, manowar: buildManOWar, moonjelly: buildMoonJelly, combjelly: buildCombJelly, salp: buildSalpChain,
  pyrosome: buildPyrosome, barreleye: buildBarreleye, oarfish: buildOarfish, siphonophore: buildSiphonophore, frilledshark: buildFrilledShark, giantascidian: buildGiantAscidian,
  reefWhitetip: buildReefWhitetip, napoleon: buildNapoleon, eagleRay: buildEagleRay, reefManta: buildManta,
  yellowfin: buildYellowfin, spinnerDolphin: buildSpinnerDolphin, mahi: buildMahi, flyingfish: buildFlyingfish
});
})();
