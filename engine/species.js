// 生き物の形と動き（three.js のみに依存）。海のページ（creatures.js）と確認用ページで共通。
// 各関数は size（m）を受け取り、{ group, animate(t, speed) } を返す。group の原点が体の中心、+z が前、+y が上。
(() => {

// ---------- 共通: 濡れた半透明の皮膚 ----------
// 縁ほど明るく見える（ゼラチン質の体を光が透ける感じ）効果を、標準の材質に足す
function skin({ color, map = null, opacity = 1, vertexColors = false, rim = 0x7a3a34, rimAmount = 0.9, clearcoat = 0.7, roughness = 0.42, side = THREE.DoubleSide }) {
  const m = new THREE.MeshPhysicalMaterial({
    color, map, vertexColors, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.25,
    side, transparent: opacity < 1, opacity, depthWrite: opacity >= 1
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = { value: new THREE.Color(rim).multiplyScalar(rimAmount) };
    sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace(
      '#include <output_fragment>',
      `float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);
       outgoingLight += uRim * fres * (0.25 + 0.75 * clamp(length(outgoingLight) * 3.0, 0.0, 1.0));
       #include <output_fragment>`);
  };
  return m;
}
// 細かいまだら模様（外套膜用）
function mottleTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#f0b6a2'); grad.addColorStop(0.55, '#e39a86'); grad.addColorStop(1, '#c7735f');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256, y = Math.random() * 128, r = Math.random() * 2.2 + 0.4;
    g.fillStyle = `rgba(${150 + Math.random() * 40 | 0},${60 + Math.random() * 30 | 0},${55 + Math.random() * 25 | 0},${0.12 + Math.random() * 0.25})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  for (let i = 0; i < 60; i++) {                       // 淡い斑点
    const x = Math.random() * 256, y = Math.random() * 128, r = Math.random() * 7 + 3;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,225,210,.28)'); rg.addColorStop(1, 'rgba(255,225,210,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

// ---------- ジュウモンジダコ（ダンボ・オクトパス, Grimpoteuthis 属） ----------
function buildDumbo(size) {
  const BASE = 0.35;                                     // 設計上の大きさ（膜を広げたときの差し渡し, m）
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);

  // 外套膜と頭: 釣鐘形。目の位置をふくらませ、表面をわずかに不揃いにする
  const prof = [[0, 0.205], [0.035, 0.2], [0.07, 0.185], [0.095, 0.158], [0.108, 0.12], [0.108, 0.08], [0.1, 0.045], [0.088, 0.015], [0.07, -0.012], [0.05, -0.03]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const mantleGeo = new THREE.LatheGeometry(prof, 48);
  {
    const p = mantleGeo.attributes.position, v = new THREE.Vector3();
    const eyes = [[0.8, 0.045], [-0.8, 0.045]];          // [方位(rad, 0=前), 高さ]
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z); if (r < 1e-4) continue;
      const ang = Math.atan2(v.x, v.z);
      let k = 1 + 0.018 * Math.sin(ang * 5 + v.y * 40) + 0.012 * Math.sin(ang * 9 - v.y * 25);
      eyes.forEach(([ea, ey]) => { const da = Math.atan2(Math.sin(ang - ea), Math.cos(ang - ea)); k += 0.16 * Math.exp(-(da * da) / 0.05 - ((v.y - ey) ** 2) / 0.0008); });
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
    mantleGeo.computeVertexNormals();
  }
  const mantle = new THREE.Mesh(mantleGeo, skin({ color: 0xffffff, map: mottleTexture(), rim: 0xffc2b0, rimAmount: 0.55, clearcoat: 0.35, roughness: 0.55 }));
  body.add(mantle);

  // 目: 黒い瞳に、濡れた光
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0608, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const lidMat = skin({ color: 0xd99080, rim: 0xffc2b0, rimAmount: 0.4 });
  [0.8, -0.8].forEach(a => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.017, 16, 12), eyeMat);
    e.position.set(Math.sin(a) * 0.112, 0.045, Math.cos(a) * 0.112); body.add(e);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.004, 8, 20), lidMat);
    lid.position.copy(e.position); lid.lookAt(e.position.clone().multiplyScalar(2)); body.add(lid);
  });

  // ひれ（耳のように見える）: しゃもじ形。付け根から先へしなって羽ばたく
  const finShape = new THREE.Shape();
  finShape.moveTo(0, -0.012);
  finShape.bezierCurveTo(0.035, -0.02, 0.085, -0.04, 0.1, -0.005);
  finShape.bezierCurveTo(0.108, 0.025, 0.07, 0.038, 0.035, 0.03);
  finShape.bezierCurveTo(0.018, 0.024, 0.005, 0.016, 0, 0.012);
  const fins = [1, -1].map(side => {
    const geo = new THREE.ShapeGeometry(finShape, 16);
    geo.scale(1.25, 1.25, 1);
    geo.rotateX(-Math.PI / 2);                           // 水平な板にする（x が外向き）
    if (side < 0) { geo.scale(-1, 1, 1); }
    const mesh = new THREE.Mesh(geo, skin({ color: 0xe8a28c, opacity: 0.93, rim: 0xffd2c2, rimAmount: 0.9 }));
    mesh.position.set(side * 0.098, 0.135, 0.005);
    mesh.userData.base = geo.attributes.position.array.slice();
    mesh.userData.side = side;
    body.add(mesh); return mesh;
  });

  // 腕 8 本: 曲線に沿った先細りの管。1 本ずつ形を毎フレーム計算する
  const ARMS = 8, N = 18, RAD = 7, L = 0.215;
  const armMat = skin({ color: 0xd98474, rim: 0xffb8a4, rimAmount: 0.6 });
  const arms = [];
  for (let i = 0; i < ARMS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * RAD * 3), 3));
    const idx = [];
    for (let k = 0; k < N; k++) for (let j = 0; j < RAD; j++) {
      const a = k * RAD + j, b = k * RAD + (j + 1) % RAD, c = a + RAD, d = b + RAD;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, armMat);
    body.add(mesh);
    arms.push({ mesh, ang: (i + 0.5) / ARMS * Math.PI * 2, pts: Array.from({ length: N + 1 }, () => new THREE.Vector3()) });
  }

  // 腕の間の膜: 隣り合う腕の間に張る。縁は腕と腕の間でくぼむ
  const M = 9;
  const webGeo = new THREE.BufferGeometry();
  const webPos = new Float32Array(ARMS * (N + 1) * (M + 1) * 3), webCol = new Float32Array(ARMS * (N + 1) * (M + 1) * 3);
  const webIdx = [];
  for (let i = 0; i < ARMS; i++) {
    const o = i * (N + 1) * (M + 1);
    for (let k = 0; k <= N; k++) for (let j = 0; j <= M; j++) {
      const u = k / N, col = new THREE.Color().lerpColors(new THREE.Color(0xf0b4a4), new THREE.Color(0x8e3b4a), Math.pow(u, 1.3));
      const q = (o + k * (M + 1) + j) * 3; webCol[q] = col.r; webCol[q + 1] = col.g; webCol[q + 2] = col.b;
      if (k < N && j < M) { const a = o + k * (M + 1) + j, b = a + 1, c = a + (M + 1), d = c + 1; webIdx.push(a, c, b, b, c, d); }
    }
  }
  webGeo.setAttribute('position', new THREE.BufferAttribute(webPos, 3));
  webGeo.setAttribute('color', new THREE.BufferAttribute(webCol, 3));
  webGeo.setIndex(webIdx);
  const web = new THREE.Mesh(webGeo, skin({ color: 0xffffff, vertexColors: true, opacity: 0.86, rim: 0xffc6b8, rimAmount: 1.0, roughness: 0.5 }));
  web.renderOrder = 1;
  body.add(web);

  // 触毛（腕の内側に並ぶ細いひげ）
  const CIRRI = 9;
  const cirriGeo = new THREE.BufferGeometry();
  cirriGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARMS * CIRRI * 2 * 2 * 3), 3));
  const cirri = new THREE.LineSegments(cirriGeo, new THREE.LineBasicMaterial({ color: 0xffd9cc, transparent: true, opacity: 0.55 }));
  body.add(cirri);

  g.scale.setScalar(size / BASE);

  // ---------- 動き ----------
  const up = new THREE.Vector3(0, 1, 0), T = new THREE.Vector3(), Nn = new THREE.Vector3(), Bn = new THREE.Vector3();
  const out = new THREE.Vector3(), side = new THREE.Vector3(), tmp = new THREE.Vector3();
  const armPoint = (arm, u, target) => {                // 腕の途中の点（u: 0〜1）
    const f = u * N, k = Math.min(N - 1, Math.floor(f)), w = f - k;
    return target.copy(arm.pts[k]).lerp(arm.pts[k + 1], w);
  };
  function animate(t) {
    const open = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.28);           // 膜の開き具合（ゆっくり開閉）
    const flap = Math.sin(t * 2 * Math.PI * 1.05);                          // ひれの羽ばたき
    // 膜を閉じるときに少し浮く
    body.position.y = 0.012 * Math.sin(t * 2 * Math.PI * 0.28 - 1.2);
    body.rotation.x = 0.06 * Math.sin(t * 2 * Math.PI * 0.28 + 0.6);

    // ひれ: 付け根から先へ向かって、しなりながら羽ばたく
    fins.forEach(f => {
      const p = f.geometry.attributes.position, base = f.userData.base, s = f.userData.side;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
        const along = Math.abs(x) / 0.125;                                   // 付け根 0 → 先 1
        const ang = 0.6 + flap * (0.3 + 0.45 * along) + 0.25 * Math.sin(t * 6.6 - along * 2.2) * along;
        p.setXYZ(i, x * Math.cos(ang), y + Math.abs(x) * Math.sin(ang), z);
      }
      p.needsUpdate = true; f.geometry.computeVertexNormals();
    });

    // 腕: 付け根から下向きに出て、開き具合に応じて外へ広がり、先が反る
    arms.forEach((arm, i) => {
      out.set(Math.sin(arm.ang), 0, Math.cos(arm.ang));
      const ph = t * 2 * Math.PI * 0.28 - i * 0.35;
      const phi0 = 0.55 + 0.25 * open, phi1 = 1.25 + 0.75 * open;
      const curl = 0.35 + 0.3 * Math.sin(ph) + 0.12 * Math.sin(t * 1.7 + i);
      const p = tmp.set(out.x * 0.055, -0.02, out.z * 0.055);
      arm.pts[0].copy(p);
      for (let k = 1; k <= N; k++) {
        const u = k / N, phi = phi0 + (phi1 - phi0) * u + curl * u * u;
        p.addScaledVector(out, Math.sin(phi) * L / N).addScaledVector(up, -Math.cos(phi) * L / N);
        arm.pts[k].copy(p);
      }
      // 管の頂点
      const pos = arm.mesh.geometry.attributes.position;
      side.set(-out.z, 0, out.x);
      for (let k = 0; k <= N; k++) {
        const a = arm.pts[Math.max(0, k - 1)], b = arm.pts[Math.min(N, k + 1)];
        T.subVectors(b, a).normalize(); Nn.crossVectors(T, side).normalize(); Bn.crossVectors(T, Nn);
        const r = 0.011 * (1 - k / N) + 0.0018;
        for (let j = 0; j < RAD; j++) {
          const th = j / RAD * Math.PI * 2;
          pos.setXYZ(k * RAD + j,
            arm.pts[k].x + (Nn.x * Math.cos(th) + Bn.x * Math.sin(th)) * r,
            arm.pts[k].y + (Nn.y * Math.cos(th) + Bn.y * Math.sin(th)) * r,
            arm.pts[k].z + (Nn.z * Math.cos(th) + Bn.z * Math.sin(th)) * r);
        }
      }
      pos.needsUpdate = true; arm.mesh.geometry.computeVertexNormals();
    });

    // 膜: 隣の腕との間を結ぶ。腕と腕の真ん中ほど短く（縁がくぼむ）、内側へ少したるむ
    const wp = web.geometry.attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < ARMS; i++) {
      const A = arms[i], Bm = arms[(i + 1) % ARMS], o = i * (N + 1) * (M + 1);
      for (let k = 0; k <= N; k++) for (let j = 0; j <= M; j++) {
        const v = j / M, u = k / N, reach = 0.97 - 0.2 * Math.sin(Math.PI * v) * (0.7 + 0.3 * open);
        armPoint(A, u * reach, a); armPoint(Bm, u * reach, b);
        q.lerpVectors(a, b, v);
        const sag = Math.sin(Math.PI * v) * u * (0.022 - 0.012 * open);
        const rr = Math.hypot(q.x, q.z) || 1;
        q.x -= q.x / rr * sag; q.z -= q.z / rr * sag; q.y -= sag * 0.4;
        wp.setXYZ(o + k * (M + 1) + j, q.x, q.y, q.z);
      }
    }
    wp.needsUpdate = true; web.geometry.computeVertexNormals();

    // 触毛: 腕の内側（下側）に向けて、左右一対ずつ
    const cp = cirri.geometry.attributes.position; let n = 0;
    arms.forEach(arm => {
      side.set(-Math.cos(arm.ang), 0, Math.sin(arm.ang));
      for (let c = 0; c < CIRRI; c++) {
        const u = 0.25 + c / CIRRI * 0.65;
        armPoint(arm, u, a);
        [1, -1].forEach(sgn => {
          b.copy(a).addScaledVector(up, -0.009).addScaledVector(side, sgn * 0.005).addScaledVector(a, -0.04);
          cp.setXYZ(n++, a.x, a.y - 0.003, a.z); cp.setXYZ(n++, b.x, b.y, b.z);
        });
      }
    });
    cp.needsUpdate = true;
  }
  animate(0);
  return { group: g, animate };
}

// ---------- マリアナスネイルフィッシュ（Pseudoliparis swirei, クサウオの仲間） ----------
// 設計は体長 1（頭の先 z=+0.5 → 尾の先 z=-0.5）で作り、最後に size (m) に合わせて縮める
function buildSnailfish(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const NS = 56, NR = 24;
  // 体の太さ（s: 頭 0 → 尾 1）。頭は大きく丸く、尾は細く縦長
  // （尾の先で 0 をわずかに下回ると計算が壊れるので 0 で止める）
  const radius = s => s < 0.18 ? 0.17 * Math.pow(Math.sin(s / 0.18 * Math.PI / 2), 0.6) : 0.17 * Math.pow(Math.max(0, 1 - (s - 0.18) / 0.82), 1.6) + 0.004;
  const width = s => radius(s) * (1.08 - 0.52 * s), height = s => radius(s) * (0.92 + 0.3 * s);
  // 泳ぎ: 泳いでは流れに身をまかせるのを繰り返す（くねりの大きさが周期的に変わる）
  let swim = 1;
  const wave = (s, t) => swim * (0.085 * Math.pow(s, 1.6) * Math.sin(2 * Math.PI * (1.3 * s) - t * 2 * Math.PI * 0.95) - 0.01 * Math.sin(t * 2 * Math.PI * 0.95));

  // ---------- 体の模様（筋節・側線・色素点）と、頭から尾への透け具合 ----------
  function bodyTextures() {
    const W = 512, H = 256;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 0, 0, H);                  // 縦方向 = 頭(上) → 尾(下)
    grad.addColorStop(0, '#f1c6bc'); grad.addColorStop(0.3, '#f4d3cb'); grad.addColorStop(1, '#f8e8e3');
    x.fillStyle = grad; x.fillRect(0, 0, W, H);
    // 筋節: 体の側面（u=0 と u=0.5 付近）で頭のほうへとがる「く」の字の筋
    x.strokeStyle = 'rgba(190, 120, 110, 0.22)'; x.lineWidth = 1.4;
    for (let b = 0; b < 46; b++) {
      const v = 0.24 + b / 46 * 0.74;
      x.beginPath();
      for (let i = 0; i <= 64; i++) {
        const u = i / 64, yv = v + 0.028 * (1 - Math.abs(Math.cos(u * Math.PI * 2)));
        i ? x.lineTo(u * W, yv * H) : x.moveTo(u * W, yv * H);
      }
      x.stroke();
    }
    // 側線
    x.strokeStyle = 'rgba(200, 150, 140, 0.35)'; x.lineWidth = 1.2;
    [0.002, 0.5, 0.998].forEach(u => { x.beginPath(); x.moveTo(u * W, 0.1 * H); x.lineTo(u * W, 0.98 * H); x.stroke(); });
    // 頭の上の細かい黒い色素点
    for (let i = 0; i < 260; i++) {
      const u = 0.1 + Math.random() * 0.3, v = Math.random() * 0.35;
      x.fillStyle = `rgba(70, 40, 40, ${0.15 + Math.random() * 0.35})`;
      x.beginPath(); x.arc(u * W, v * H, Math.random() * 1.3 + 0.3, 0, 7); x.fill();
    }
    const map = new THREE.CanvasTexture(c); map.wrapS = THREE.RepeatWrapping;
    // 透け具合（白 = 不透明）: 頭はやや濃く、尾ほど透き通る
    const a = document.createElement('canvas'); a.width = 4; a.height = 128;
    const ag = a.getContext('2d'), gg = ag.createLinearGradient(0, 0, 0, 128);
    gg.addColorStop(0, '#f6f6f6'); gg.addColorStop(0.2, '#e6e6e6'); gg.addColorStop(0.4, '#b0b0b0'); gg.addColorStop(1, '#6c6c6c');
    ag.fillStyle = gg; ag.fillRect(0, 0, 4, 128);
    return { map, alpha: new THREE.CanvasTexture(a) };
  }
  const tex = bodyTextures();

  // ---------- 胴体 ----------
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NS + 1) * (NR + 1) * 3), 3));
  const uv = new Float32Array((NS + 1) * (NR + 1) * 2), idx = [];
  for (let i = 0; i <= NS; i++) for (let j = 0; j <= NR; j++) {
    uv[(i * (NR + 1) + j) * 2] = j / NR; uv[(i * (NR + 1) + j) * 2 + 1] = 1 - i / NS;
    // 三角形の頂点の並び順で面の表裏が決まる（外向きが表になる順にする）
    if (i < NS && j < NR) { const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  bodyGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bodyGeo.setIndex(idx);
  const bodyMat = skin({ color: 0xffffff, map: tex.map, opacity: 0.999, rim: 0xffffff, rimAmount: 0.7, clearcoat: 0.9, roughness: 0.32, side: THREE.FrontSide });
  bodyMat.alphaMap = tex.alpha;
  bodyMat.depthWrite = true;           // 体の奥にある反対側の目などを隠す（内臓は先に描くので透けて見える）
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.renderOrder = 2;
  body.add(bodyMesh);

  // ---------- 透けて見える内臓と背骨（淡く、ぼんやり） ----------
  const organ = (color, op) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true, opacity: op, depthWrite: false });
  const liver = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), organ(0xd9a092, 0.5)); liver.scale.set(0.05, 0.042, 0.085);
  const gut = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), organ(0xc98e86, 0.4)); gut.scale.set(0.03, 0.028, 0.06);
  const gonad = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), organ(0xe8c0a8, 0.35)); gonad.scale.set(0.022, 0.02, 0.05);
  [liver, gut, gonad].forEach(o => { o.renderOrder = 1; body.add(o); });
  const spineGeo = new THREE.BufferGeometry(); spineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
  const spine = new THREE.Line(spineGeo, new THREE.LineBasicMaterial({ color: 0xe0aea2, transparent: true, opacity: 0.45 }));
  body.add(spine);

  // ---------- 顔: 目、口、えらぶたの切れ目 ----------
  // 目は体のあとに描く（体の表面より奥にある目は隠れる）
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x07060a, roughness: 0.1, clearcoat: 1, transparent: true });
  const eyes = [1, -1].map(side => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), eyeMat);
    e.renderOrder = 5;
    body.add(e); return { e, side };
  });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x8a5a55, transparent: true, opacity: 0.7 });
  const mouthGeo = new THREE.BufferGeometry(); mouthGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  const mouth = new THREE.Line(mouthGeo, lineMat); body.add(mouth);
  const gills = [1, -1].map(() => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3)); const l = new THREE.Line(geo, lineMat); body.add(l); return l; });

  // ---------- 背びれ・しりびれ（軟条の筋入り）。尾の先で丸くすぼまる ----------
  const FS = 34;
  const finMat = skin({ color: 0xf2d2c8, opacity: 0.4, rim: 0xffffff, rimAmount: 0.55, clearcoat: 0.5 });
  const rayMat = new THREE.LineBasicMaterial({ color: 0xf6dcd4, transparent: true, opacity: 0.5 });
  const makeFin = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FS + 1) * 2 * 3), 3));
    const id = []; for (let i = 0; i < FS; i++) { const a = i * 2; id.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(id);
    const m = new THREE.Mesh(geo, finMat); m.renderOrder = 3;
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FS + 1) * 2 * 3), 3));
    const rays = new THREE.LineSegments(rg, rayMat);
    body.add(m, rays); return { m, rays };
  };
  const dorsal = makeFin(), anal = makeFin();

  // ---------- 胸びれ: 上の扇と、長い軟条が指のように伸びる下の部分 ----------
  const UP = 9, LO = 6, RAYS = UP + LO;
  const pects = [1, -1].map(side => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RAYS * 2 + 1) * 3), 3));
    const id = [];
    for (let r = 0; r < UP - 1; r++) id.push(0, 1 + r, 2 + r);                        // 上の扇（付け根〜先）
    for (let r = UP; r < RAYS - 1; r++) id.push(0, 1 + RAYS + r, 2 + RAYS + r);        // 下の部分（膜は軟条の途中まで）
    geo.setIndex(id);
    const mesh = new THREE.Mesh(geo, finMat); mesh.renderOrder = 3;
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAYS * 2 * 3), 3));
    const rays = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xfbe6df, transparent: true, opacity: 0.65 }));
    body.add(mesh, rays);
    return { side, mesh, rays };
  });

  g.scale.setScalar(size);

  // ---------- 動き ----------
  const P = new THREE.Vector3();
  const center = (s, t) => P.set(wave(s, t), -0.01 * s, 0.5 - s);
  function animate(t) {
    // 泳ぎの強さ: 数秒ごとに、しっかり泳ぐ → 流れに身をまかせる
    const cyc = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.12);
    swim = 0.3 + 0.7 * cyc * cyc;

    const pos = bodyGeo.attributes.position;
    for (let i = 0; i <= NS; i++) {
      const s = i / NS, w = width(s), h = height(s); center(s, t);
      const cx = P.x, cy = P.y, cz = P.z;
      for (let j = 0; j <= NR; j++) {
        const th = j / NR * Math.PI * 2, sn = Math.sin(th);
        const hy = sn < 0 && s < 0.3 ? h * (0.8 + 0.2 * s / 0.3) : h;       // 頭の下側は少し平ら
        pos.setXYZ(i * (NR + 1) + j, cx + Math.cos(th) * w, cy + sn * hy, cz);
      }
    }
    pos.needsUpdate = true; bodyGeo.computeVertexNormals();

    center(0.24, t); liver.position.set(P.x, P.y - 0.012, P.z);
    center(0.33, t); gut.position.set(P.x, P.y - 0.022, P.z);
    center(0.4, t); gonad.position.set(P.x, P.y - 0.005, P.z);
    const sp = spineGeo.attributes.position;
    for (let i = 0; i < 40; i++) { const s = 0.14 + i / 39 * 0.83; center(s, t); sp.setXYZ(i, P.x, P.y + height(s) * 0.22, P.z); }
    sp.needsUpdate = true;

    // 目と顔
    center(0.075, t);
    eyes.forEach(({ e, side }) => e.position.set(P.x + side * width(0.075) * 0.84, P.y + height(0.075) * 0.36, P.z));
    center(0.03, t); const mx = P.x, my = P.y, mz = P.z;
    const mp = mouthGeo.attributes.position;
    for (let i = 0; i < 16; i++) {
      const a = (i / 15 - 0.5) * Math.PI * 0.75;
      mp.setXYZ(i, mx + Math.sin(a) * width(0.03) * 0.9, my - height(0.03) * 0.45 - 0.004 * Math.cos(a), mz + Math.cos(a) * 0.012);
    }
    mp.needsUpdate = true;
    center(0.165, t);
    gills.forEach((l, k) => {
      const side = k ? -1 : 1, gp = l.geometry.attributes.position;
      for (let i = 0; i < 12; i++) {
        const a = -0.9 + i / 11 * 1.5;                                 // 体の側面を上から下へ
        gp.setXYZ(i, P.x + side * width(0.165) * Math.cos(a) * 1.01, P.y + height(0.165) * Math.sin(a), P.z + 0.01 * Math.cos(a * 1.4));
      }
      gp.needsUpdate = true;
    });

    // 背びれ・しりびれ: 縁は体より少し遅れてなびく。軟条を 2 本おきに描く
    [[dorsal, 1, 0.34], [anal, -1, 0.44]].forEach(([f, dir, s0]) => {
      const p = f.m.geometry.attributes.position, rp = f.rays.geometry.attributes.position;
      for (let i = 0; i <= FS; i++) {
        const u = i / FS, s = s0 + (1 - s0) * u, h = height(s);
        const fh = i === 0 ? 0 : (0.03 + 0.05 * u) * (u < 0.8 ? 1 : Math.cos((u - 0.8) / 0.2 * Math.PI / 2));
        center(s, t); const x0 = P.x, y0 = P.y, z0 = P.z;
        center(Math.min(1, s + 0.025), t);
        const bx = x0, by = y0 + dir * h * 0.96, ex = P.x, ey = y0 + dir * (h + fh), ez = z0 - 0.004;
        p.setXYZ(i * 2, bx, by, z0); p.setXYZ(i * 2 + 1, ex, ey, ez);
        if (i % 2 === 0) { rp.setXYZ(i * 2, bx, by, z0); rp.setXYZ(i * 2 + 1, ex, ey, ez); } else { rp.setXYZ(i * 2, bx, by, z0); rp.setXYZ(i * 2 + 1, bx, by, z0); }
      }
      p.needsUpdate = true; rp.needsUpdate = true; f.m.geometry.computeVertexNormals();
    });

    // 胸びれ: 上の扇はゆっくり漕ぎ、下の軟条は海底を探るように 1 本ずつ動く
    center(0.2, t); const bx = P.x, by = P.y - height(0.2) * 0.25, bz = P.z;
    pects.forEach(({ side, mesh, rays }) => {
      const p = mesh.geometry.attributes.position, rp = rays.geometry.attributes.position;
      const base = [bx + side * width(0.2) * 0.9, by, bz];
      p.setXYZ(0, ...base);
      const stroke = 0.3 + 0.3 * Math.sin(t * 2 * Math.PI * 0.7 + (side > 0 ? 0 : 0.5));
      for (let r = 0; r < RAYS; r++) {
        const lower = r >= UP, f = lower ? (r - UP) / (LO - 1) : r / (UP - 1);
        const len = lower ? 0.17 + 0.07 * f : 0.1 + 0.035 * Math.sin(f * Math.PI);
        const down = lower ? 1.05 + 0.35 * f + 0.12 * Math.sin(t * 2.2 + r * 1.3) : -0.25 + 0.95 * f;
        const out = (lower ? 0.55 : 0.95 - 0.25 * f) + (lower ? 0.08 * Math.sin(t * 1.7 + r) : 0.25 * stroke);
        const x = base[0] + side * Math.cos(down) * Math.sin(out) * len;
        const y = base[1] - Math.sin(down) * len * 0.95;
        const z = base[2] - Math.cos(down) * Math.cos(out) * len * 0.7 - 0.02;
        p.setXYZ(1 + r, x, y, z);                                       // 軟条の先
        const m = lower ? 0.55 : 1;                                     // 下の部分の膜は軟条の途中まで
        p.setXYZ(1 + RAYS + r, base[0] + (x - base[0]) * m, base[1] + (y - base[1]) * m, base[2] + (z - base[2]) * m);
        rp.setXYZ(r * 2, ...base); rp.setXYZ(r * 2 + 1, x, y, z);
      }
      p.needsUpdate = true; rp.needsUpdate = true; mesh.geometry.computeVertexNormals();
    });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- カイコウオオソコエビ（Hirondellea gigas, ヨコエビの仲間） ----------
// 設計は体長 1 で作り、最後に size (m) に合わせて縮める。頭が +z、背中が +y。体は C の字に曲がる
// 先細りの管（脚・触角・消化管）を、点の並びから毎フレーム作り直す
function makeTube(n, rad, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * rad * 3), 3));
  const idx = [];
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < rad; j++) {
    const a = k * rad + j, b = k * rad + (j + 1) % rad, c = a + rad, d = b + rad;
    idx.push(a, c, b, b, c, d);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), ref = new THREE.Vector3();
  mesh.userData.update = (pts, radiusAt) => {
    const p = geo.attributes.position;
    for (let k = 0; k < n; k++) {
      T.subVectors(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
      ref.set(0, 1, 0); if (Math.abs(T.y) > 0.9) ref.set(1, 0, 0);
      N.crossVectors(T, ref).normalize(); B.crossVectors(T, N);
      const r = radiusAt(k / (n - 1));
      for (let j = 0; j < rad; j++) {
        const th = j / rad * Math.PI * 2, c = Math.cos(th) * r, s = Math.sin(th) * r;
        p.setXYZ(k * rad + j, pts[k].x + N.x * c + B.x * s, pts[k].y + N.y * c + B.y * s, pts[k].z + N.z * c + B.z * s);
      }
    }
    p.needsUpdate = true; geo.computeVertexNormals();
  };
  return mesh;
}

function buildAmphipod(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const shell = skin({ color: 0xf4dccb, opacity: 0.8, rim: 0xffffff, rimAmount: 0.5, clearcoat: 1, roughness: 0.28, side: THREE.FrontSide });
  shell.depthWrite = true;
  const limb = skin({ color: 0xecd6c2, opacity: 0.92, rim: 0xfff4ec, rimAmount: 0.45, clearcoat: 0.8, roughness: 0.35 });
  const plateMat = skin({ color: 0xe9d2bf, opacity: 0.85, rim: 0xffffff, rimAmount: 0.5, clearcoat: 0.9, roughness: 0.3 });

  // 体の軸: C の字の円弧（θ: 頭 1.1 → 尾 -1.45）。腹は曲げ伸ばしする
  const R = 0.38;
  let flex = 0;
  const axis = (s, out) => {
    const th = 1.1 - 2.55 * s - flex * Math.max(0, s - 0.6) * 1.2;
    return out.set(0, R * Math.cos(th) - R * 0.6, R * Math.sin(th));
  };
  const tangentAngle = s => { const a = axis(s, new THREE.Vector3()), b = axis(Math.min(1, s + 0.01), new THREE.Vector3()); return Math.atan2(b.y - a.y, -(b.z - a.z)); };

  // 節: [位置 s, 長さ, 幅, 高さ]（頭・胸 7 節・腹 3 節・尾 3 節）
  const SEG = [[0.05, 0.13, 0.1, 0.16]];
  for (let i = 0; i < 7; i++) SEG.push([0.15 + i * 0.066, 0.078, 0.12 + 0.012 * Math.sin(i / 6 * Math.PI), 0.2 + 0.02 * Math.sin(i / 6 * Math.PI)]);
  for (let i = 0; i < 3; i++) SEG.push([0.63 + i * 0.07, 0.075, 0.11 - i * 0.012, 0.19 - i * 0.022]);
  for (let i = 0; i < 3; i++) SEG.push([0.84 + i * 0.045, 0.05, 0.07 - i * 0.008, 0.09 - i * 0.012]);
  const segs = SEG.map(([s, len, w, h]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), shell);
    m.scale.set(w / 2, h / 2, len / 2 * 2.1); m.renderOrder = 2;          // 前後に長くして重ね、なめらかな殻にする
    body.add(m); return { m, s };
  });

  // 胸の横に垂れる底節板（前の 4 節が大きい）
  const plates = [];
  for (let i = 1; i <= 7; i++) [1, -1].forEach(side => {
    const big = i <= 4;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), plateMat);
    m.scale.set(0.006, big ? 0.07 : 0.045, big ? 0.04 : 0.032); m.renderOrder = 3;
    body.add(m); plates.push({ m, seg: i, side, big });
  });

  // 目（深海のため色素の薄い、赤茶色の小さな目）
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x3e1c16, roughness: 0.4, transparent: true, opacity: 0.85 });
  const eyes = [1, -1].map(side => { const e = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), eyeMat); e.scale.set(0.007, 0.022, 0.011); e.renderOrder = 4; body.add(e); return { e, side }; });

  // 透けて見える消化管（オレンジ）
  const gut = makeTube(24, 6, new THREE.MeshStandardMaterial({ color: 0xc9783e, roughness: 0.7, transparent: true, opacity: 0.75, depthWrite: false }));
  gut.renderOrder = 1; body.add(gut);

  // 触角 2 対（第 1 触角は短め、第 2 触角は長い）
  const ants = [];
  [[1, 0.32, 0.05], [-1, 0.32, 0.05], [1, 0.46, -0.02], [-1, 0.46, -0.02]].forEach(([side, len, lift]) => {
    const t = makeTube(18, 5, limb); body.add(t); ants.push({ t, side, len, lift, pts: Array.from({ length: 18 }, () => new THREE.Vector3()) });
  });

  // 胸脚 7 対（前の 2 対は小さな鉤爪状、後ろの 3 対は長く後ろ向き）
  const legs = [];
  for (let i = 1; i <= 7; i++) [1, -1].forEach(side => {
    const t = makeTube(12, 5, limb); body.add(t);
    legs.push({ t, seg: i, side, pts: Array.from({ length: 12 }, () => new THREE.Vector3()) });
  });

  // 遊泳肢 3 対（腹の下で素早く打つ小さなかい）
  const pleo = [];
  for (let i = 0; i < 3; i++) [1, -1].forEach(side => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 14), plateMat);
    m.scale.set(0.02, 0.055, 1); body.add(m); pleo.push({ m, i, side });
  });

  // 尾の先の尾肢（二又の小さな突起）
  const uro = [1, -1].map(side => { const t = makeTube(8, 4, limb); body.add(t); return { t, side, pts: Array.from({ length: 8 }, () => new THREE.Vector3()) }; });

  g.scale.setScalar(size);

  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3();
  const frame = s => {                   // 軸上の点と、その場所の「前」「上」の向き
    axis(s, A); axis(Math.min(1, s + 0.01), Bv);
    fw.subVectors(A, Bv).normalize();     // 頭の方向（尾側の点から見た向き）
    up.set(0, fw.z, -fw.y);               // 背中側（YZ 平面で前に直交）
    return A;
  };
  function animate(t) {
    flex = 0.12 * Math.sin(t * 2 * Math.PI * 0.6) + 0.05 * Math.sin(t * 5.3);
    body.rotation.z = 0.06 * Math.sin(t * 0.9);

    segs.forEach(({ m, s }) => { frame(s); m.position.copy(A); m.rotation.set(tangentAngle(s), 0, 0); });
    plates.forEach(({ m, seg, side, big }) => {
      const s = SEG[seg][0], h = SEG[seg][3], w = SEG[seg][2];
      frame(s);
      m.position.copy(A).addScaledVector(up, -h * (big ? 0.42 : 0.36)).add(new THREE.Vector3(side * w * 0.47, 0, 0));
      m.rotation.set(tangentAngle(s) + 0.15, 0, side * 0.12);
    });
    eyes.forEach(({ e, side }) => { frame(0.045); e.position.copy(A).addScaledVector(up, 0.03).add(new THREE.Vector3(side * 0.045, 0, 0)).addScaledVector(fw, 0.01); e.rotation.x = tangentAngle(0.045); });

    // 消化管: 背中寄りに頭から腹まで
    const gp = []; for (let k = 0; k < 24; k++) { const s = 0.06 + k / 23 * 0.8; frame(s); gp.push(A.clone().addScaledVector(up, SEG[Math.min(SEG.length - 1, Math.floor(s * 13))][3] * 0.15)); }
    gut.userData.update(gp, u => 0.018 * (1 - 0.5 * u));

    // 触角: 頭の先から前上方へ伸び、先ほど大きくゆれる
    frame(0.0);
    ants.forEach(a => {
      const base = A.clone().addScaledVector(fw, 0.05).addScaledVector(up, 0.04 + a.lift).add(new THREE.Vector3(a.side * 0.03, 0, 0));
      for (let k = 0; k < 18; k++) {
        const u = k / 17, sway = Math.sin(t * 2.2 + a.side + a.len * 7 - u * 2.5) * 0.08 * u;
        a.pts[k].copy(base).addScaledVector(fw, a.len * u * 0.8).addScaledVector(up, a.len * u * (0.75 - 0.45 * u) + sway * 0.5)
          .add(new THREE.Vector3(a.side * (0.05 * u + sway), 0, 0));
      }
      a.t.userData.update(a.pts, u => 0.011 * (1 - u) + 0.0015);
    });

    // 胸脚: 付け根 → 関節 → 先。後ろの脚ほど長く後ろ向き。ときどき小さく動く
    legs.forEach(L => {
      const s = SEG[L.seg][0], h = SEG[L.seg][3]; frame(s);
      const back = L.seg >= 5, len = L.seg <= 2 ? 0.16 : back ? 0.3 + 0.03 * (L.seg - 5) : 0.24;
      const twitch = 0.12 * Math.sin(t * 3.1 + L.seg * 1.7 + L.side);
      const base = A.clone().addScaledVector(up, -h * 0.45).add(new THREE.Vector3(L.side * 0.035, 0, 0));
      const knee = base.clone().addScaledVector(up, -len * 0.45).addScaledVector(fw, back ? -len * (0.2 + twitch * 0.3) : len * (0.15 + twitch * 0.3)).add(new THREE.Vector3(L.side * len * 0.35, 0, 0));
      const tip = knee.clone().addScaledVector(up, -len * 0.3).addScaledVector(fw, back ? -len * 0.45 : len * (L.seg <= 2 ? 0.25 : -0.1)).add(new THREE.Vector3(L.side * len * 0.12, 0, 0));
      for (let k = 0; k < 12; k++) {
        const u = k / 11;
        if (u < 0.5) L.pts[k].lerpVectors(base, knee, u * 2); else L.pts[k].lerpVectors(knee, tip, (u - 0.5) * 2);
      }
      L.t.userData.update(L.pts, u => 0.012 * (1 - 0.7 * u) + 0.002);
    });

    // 遊泳肢: 腹の下で素早く前後に打つ（1 秒に 5 回ほど、前後の対が少しずれる）
    pleo.forEach(({ m, i, side }) => {
      const s = 0.63 + i * 0.07, h = SEG[8 + i][3]; frame(s);
      const beat = Math.sin(t * 2 * Math.PI * 5 - i * 0.9);
      m.position.copy(A).addScaledVector(up, -h * 0.5 - 0.04).add(new THREE.Vector3(side * 0.02, 0, 0));
      m.rotation.set(tangentAngle(s) + 0.6 + beat * 0.6, Math.PI / 2 + side * 0.2, 0);
    });

    // 尾肢: 尾の先から後ろ下へ二又に
    frame(0.975);
    uro.forEach(U => {
      const base = A.clone();
      for (let k = 0; k < 8; k++) { const u = k / 7; U.pts[k].copy(base).addScaledVector(fw, -0.09 * u).addScaledVector(up, -0.03 * u).add(new THREE.Vector3(U.side * 0.03 * u, 0, 0)); }
      U.t.userData.update(U.pts, u => 0.008 * (1 - 0.6 * u));
    });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- 共通の部品 ----------
// キャンバスに描いたテクスチャ
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = THREE.RepeatWrapping;
  return t;
}
// 軸に沿った胴体（断面は楕円）。center(s) で軸上の点、w(s)/h(s) で太さを与え、毎フレーム形を作り直す
// s: 0 = 前端 → 1 = 後端。uv は u = 周方向（0 = 右側面, 0.25 = 背中）, v = 1 - s
// warp を渡すと、輪の並び（s）を偏らせられる（丸い鼻先などを細かく作るため）
function makeBody(NS, NR, mat, warp = u => u) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NS + 1) * (NR + 1) * 3), 3));
  const uv = new Float32Array((NS + 1) * (NR + 1) * 2), idx = [];
  for (let i = 0; i <= NS; i++) for (let j = 0; j <= NR; j++) {
    uv[(i * (NR + 1) + j) * 2] = j / NR; uv[(i * (NR + 1) + j) * 2 + 1] = 1 - warp(i / NS);
    if (i < NS && j < NR) { const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat), P = new THREE.Vector3();
  mesh.userData.update = (center, w, h, shape) => {
    const p = geo.attributes.position;
    for (let i = 0; i <= NS; i++) {
      const s = warp(i / NS); center(s, P); const ws = w(s), hs = h(s);
      for (let j = 0; j <= NR; j++) {
        const th = j / NR * Math.PI * 2; let cx = Math.cos(th), sy = Math.sin(th);
        if (shape) { const r = shape(s, th); cx *= r; sy *= r; }
        p.setXYZ(i * (NR + 1) + j, P.x + cx * ws, P.y + sy * hs, P.z);
      }
    }
    p.needsUpdate = true; geo.computeVertexNormals();
    // 継ぎ目（周の始まりと終わり）の法線をそろえ、太さ 0 に閉じた端の法線は軸の向きにする（筋や尖りが見えないように）
    const nr = geo.attributes.normal;
    for (let i = 0; i <= NS; i++) {
      const a = i * (NR + 1), b = a + NR;
      const x = nr.getX(a) + nr.getX(b), y = nr.getY(a) + nr.getY(b), z = nr.getZ(a) + nr.getZ(b), l = Math.hypot(x, y, z) || 1;
      nr.setXYZ(a, x / l, y / l, z / l); nr.setXYZ(b, x / l, y / l, z / l);
      if (i === 0 || i === NS) {
        const o = (i === 0 ? 1 : NS - 1) * (NR + 1);
        if (Math.abs(p.getX(a) - p.getX(a + (NR >> 1))) + Math.abs(p.getY(a) - p.getY(a + (NR >> 2))) < 1e-7) {
          const dx = p.getX(a) - (p.getX(o) + p.getX(o + (NR >> 1))) / 2, dy = p.getY(a) - (p.getY(o + (NR >> 2)) + p.getY(o + 3 * (NR >> 2))) / 2, dz = p.getZ(a) - p.getZ(o), dl = Math.hypot(dx, dy, dz) || 1;
          for (let j = 0; j <= NR; j++) nr.setXYZ(a + j, dx / dl, dy / dl, dz / dl);
        }
      }
    }
    nr.needsUpdate = true;
  };
  return mesh;
}
// 平たいひれ（扇形）: 付け根の 1 点から、先の点の並びへ三角形を張る
function makeFan(n, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
  const id = []; for (let r = 1; r < n; r++) id.push(0, r, r + 1);
  geo.setIndex(id);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.update = (base, tips) => {
    const p = geo.attributes.position; p.setXYZ(0, base.x, base.y, base.z);
    tips.forEach((q, k) => p.setXYZ(k + 1, q.x, q.y, q.z));
    p.needsUpdate = true; geo.computeVertexNormals();
  };
  return mesh;
}
// 自分で光る点（生物発光）。近景では距離に関係なく数ピクセルの光として見える
function glowPoints(n, color, px) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: px, sizeAttenuation: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  pts.frustumCulled = false;
  return pts;
}

// 点の表 (xs, ys) をなめらかにつなぐ関数（体の太さの変化などに使う）
function curve(xs, ys) {
  const n = xs.length, m = ys.map((_, i) => i === 0 ? (ys[1] - ys[0]) / (xs[1] - xs[0]) : i === n - 1 ? (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2])
    : 0.5 * ((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) + (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1])));
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const d = xs[i + 1] - xs[i], u = (x - xs[i]) / d, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * d * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * d * m[i + 1];
  };
}
// 厚みのある平たい部品（尾びれ・胸びれ・イカのひれ）。x 方向へ伸び、z は前縁 → 後縁。断面は前縁が丸く厚く、後縁が薄い翼形
// a は付け根 0 → 先端 1。both = true なら左右（x の正負）両方へ伸ばす。le(a)/te(a) は前縁・後縁の z、th(a) は最大の厚さ
// geometry.userData.base に元の座標を残す（毎フレーム曲げるとき用）
function makeFoil({ span, both = false, nA = 14, nV = 10, le, te, th }) {
  const cols = both ? nA * 2 + 1 : nA + 1, pos = [], idx = [];
  for (const sy of [1, -1]) for (let i = 0; i < cols; i++) {
    const as = both ? (i - nA) / nA : i / nA, a = Math.abs(as);
    for (let j = 0; j <= nV; j++) { const v = j / nV, f = 2.6 * Math.sqrt(v) * (1 - v); pos.push(as * span, sy * 0.5 * th(a) * f, le(a) + (te(a) - le(a)) * v); }
  }
  const off = cols * (nV + 1);
  for (let i = 0; i < cols - 1; i++) for (let j = 0; j < nV; j++) {
    const a = i * (nV + 1) + j, b = a + nV + 1, c = a + 1, d = b + 1;
    idx.push(a, b, c, b, d, c, off + a, off + c, off + b, off + b, off + c, off + d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  geo.userData.base = Float32Array.from(pos);
  return geo;
}
// 帯状のひれ（背びれ・しりびれ）: 付け根の点の並びと先の点の並びの間に面を張る
function makeStrip(n, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  const id = []; for (let k = 0; k < n - 1; k++) { const a = k * 2; id.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  geo.setIndex(id);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.update = (base, tips) => {
    const p = geo.attributes.position;
    for (let k = 0; k < n; k++) { p.setXYZ(k * 2, base[k].x, base[k].y, base[k].z); p.setXYZ(k * 2 + 1, tips[k].x, tips[k].y, tips[k].z); }
    p.needsUpdate = true; geo.computeVertexNormals();
  };
  return mesh;
}
// ひれの筋（軟条）: 付け根（1 点または点の並び）から先の点へ細い線を引く
function makeRays(n, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  lines.frustumCulled = false;
  lines.userData.update = (base, tips) => {
    const p = geo.attributes.position;
    for (let k = 0; k < n; k++) { const b = Array.isArray(base) ? base[k] : base; p.setXYZ(k * 2, b.x, b.y, b.z); p.setXYZ(k * 2 + 1, tips[k].x, tips[k].y, tips[k].z); }
    p.needsUpdate = true;
  };
  return lines;
}
// ---------- アオウミガメ（Chelonia mydas） ----------
// 設計は甲羅の長さ 1。頭が +z
function buildTurtle(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  // 甲羅の模様（上から見た図）: 背骨に沿った椎甲板 5 枚、左右の肋甲板 4 枚ずつ、縁の縁甲板。各甲板に放射状の模様
  const shellTex = canvasTex(512, 512, (x, W, H) => {
    x.fillStyle = '#3e3a22'; x.fillRect(0, 0, W, H);
    const scute = (pts, cx, cy) => {
      x.save(); x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); x.clip();
      const gr = x.createRadialGradient(cx, cy, 2, cx, cy, 80);
      gr.addColorStop(0, '#3a2614'); gr.addColorStop(0.45, '#4e3c1e'); gr.addColorStop(1, '#3e3a20');
      x.fillStyle = gr; x.fillRect(0, 0, W, H);
      for (let k = 0; k < 22; k++) {                               // 放射状の淡い帯（日の出のような模様。くさび形でぼかす）
        const a = Math.random() * Math.PI * 2, L = 50 + Math.random() * 50, wd = 0.06 + Math.random() * 0.12;
        x.fillStyle = Math.random() < 0.55 ? 'rgba(170, 140, 70, .16)' : 'rgba(25, 16, 8, .2)';
        x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a - wd) * L, cy + Math.sin(a - wd) * L); x.lineTo(cx + Math.cos(a + wd) * L, cy + Math.sin(a + wd) * L); x.closePath(); x.fill();
      }
      for (let k = 0; k < 30; k++) { x.fillStyle = 'rgba(20, 14, 8, .18)'; x.beginPath(); x.arc(cx + (Math.random() - 0.5) * 120, cy + (Math.random() - 0.5) * 100, 3 + Math.random() * 9, 0, 7); x.fill(); }   // まだらのしみ
      x.restore();
      x.strokeStyle = 'rgba(185, 165, 110, .38)'; x.lineWidth = 2;
      x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); x.stroke();
    };
    const cxm = W / 2, rows = [0.16, 0.32, 0.48, 0.64, 0.8];      // 上が頭側
    rows.forEach((v, i) => {                                       // 椎甲板（中央の列）
      const y0 = v * H - 40, y1 = v * H + 40, hw = 46 - i * 2;
      scute([[cxm - hw, y0], [cxm + hw, y0], [cxm + hw + 10, (y0 + y1) / 2], [cxm + hw, y1], [cxm - hw, y1], [cxm - hw - 10, (y0 + y1) / 2]], cxm, v * H);
    });
    [-1, 1].forEach(sd => [0.24, 0.42, 0.6, 0.76].forEach((v, i) => {   // 肋甲板（左右）
      const xin = cxm + sd * 56, xout = cxm + sd * (190 - i * 18), y0 = v * H - 52, y1 = v * H + 40;
      scute([[xin, y0 + 10], [xout, y0], [xout + sd * 6, y1], [xin, y1 + 6]], (xin + xout) / 2, v * H);
    }));
    for (let k = 0; k < 24; k++) {                                 // 縁甲板（外周の小さな板）
      const a = k / 24 * Math.PI * 2, r0 = 200, r1 = 250;
      const p = (rr, aa) => [cxm + Math.sin(aa) * rr, H / 2 - Math.cos(aa) * rr * 1.1];
      scute([p(r0, a), p(r0, a + 0.26), p(r1, a + 0.26), p(r1, a)], p(225, a + 0.13)[0], p(225, a + 0.13)[1]);
    }
  }, false);
  const shellMat = skin({ color: 0xffffff, map: shellTex, rim: 0x3a3a22, rimAmount: 0.18, clearcoat: 0.35, roughness: 0.55, side: THREE.FrontSide });
  // 甲羅: ハート形（前が広く、後ろがすぼまる）のなだらかなドーム。模様は上から投影する
  const cGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  { const p = cGeo.attributes.position, uv = cGeo.attributes.uv, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const x = v.x * 0.42 * (1 + 0.12 * v.z), y = v.y * 0.19 * (1 - 0.15 * Math.max(0, -v.z)), z = v.z * 0.5;
      p.setXYZ(i, x, y, z);
      uv.setXY(i, 0.5 + x / 1.0, 0.5 + z / 1.04);
    }
    cGeo.computeVertexNormals(); }
  body.add(new THREE.Mesh(cGeo, shellMat));
  const plastron = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), skin({ color: 0xe8d9a8, rim: 0x6a6040, rimAmount: 0.2, clearcoat: 0.3, roughness: 0.7, side: THREE.FrontSide }));
  plastron.scale.set(0.4, 0.06, 0.47); body.add(plastron);
  // 頭・首・ひれのうろこ模様（明るい縁取りの多角形）
  const scaleTex = canvasTex(256, 128, (x, W, H) => {
    x.fillStyle = '#4e4a2e'; x.fillRect(0, 0, W, H);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 18; c++) {
      const px = c * 15 + (r % 2) * 7, py = r * 15, s = 6 + Math.random() * 4;
      x.fillStyle = `rgb(${70 + Math.random() * 30 | 0},${64 + Math.random() * 25 | 0},${36 + Math.random() * 20 | 0})`;
      x.strokeStyle = 'rgba(215, 200, 150, .55)'; x.lineWidth = 1.4;
      x.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; x.lineTo(px + Math.cos(a) * s, py + Math.sin(a) * s); } x.closePath(); x.fill(); x.stroke();
    }
  });
  const skinMat = skin({ color: 0xffffff, map: scaleTex, rim: 0x2a2a18, rimAmount: 0.25, clearcoat: 0.45, roughness: 0.5 });
  const neck = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin({ color: 0x8a8460, rim: 0x2a2a18, rimAmount: 0.2, roughness: 0.6 })); neck.scale.set(0.08, 0.065, 0.13); body.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skinMat); head.scale.set(0.078, 0.072, 0.115); body.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x3a3424, roughness: 0.45 }));
  beak.rotation.x = Math.PI / 2; beak.scale.set(1, 1, 0.75); body.add(beak);
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0f0b06, roughness: 0.05, clearcoat: 1 });
  const eyes = [1, -1].map(() => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), eyeMat); body.add(e); return e; });
  // ひれ: 前は長いかい（先に爪が 1 本）、後ろは小さな舵。裏側は淡い
  const flipShape = (L, W) => { const s = new THREE.Shape(); s.moveTo(0, -W * 0.3); s.bezierCurveTo(L * 0.4, -W * 0.75, L * 0.85, -W * 0.3, L, 0.02); s.bezierCurveTo(L * 0.7, W * 0.3, L * 0.3, W * 0.45, 0, W * 0.3); return s; };
  const flippers = [[1, 0.26, 0.3, 0.62, 0.2], [-1, 0.26, 0.3, 0.62, 0.2], [1, -0.33, 0.28, 0.26, 0.15], [-1, -0.33, 0.28, 0.26, 0.15]].map(([side, z, x0, L, W]) => {
    const geo = new THREE.ShapeGeometry(flipShape(L, W), 14); geo.rotateX(-Math.PI / 2); if (side < 0) geo.scale(-1, 1, 1);
    const pivot = new THREE.Group(); pivot.position.set(side * x0, -0.03, z);
    const top = new THREE.Mesh(geo, skinMat); pivot.add(top);
    const under = new THREE.Mesh(geo, skin({ color: 0xd8cfa8, rim: 0x6a6040, rimAmount: 0.2, roughness: 0.6, side: THREE.BackSide })); pivot.add(under);
    if (z > 0) { const claw = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 6), new THREE.MeshStandardMaterial({ color: 0x2a241a })); claw.position.set(side * L * 0.35, 0.005, -W * 0.25); claw.rotation.z = -side * Math.PI / 2; pivot.add(claw); }
    body.add(pivot);
    return { pivot, side, front: z > 0 };
  });
  g.scale.setScalar(size);
  function animate(t) {
    const ph = t * 2 * Math.PI * 0.32, stroke = Math.sin(ph);         // 前ひれで水中を「飛ぶ」ように漕ぐ
    flippers.forEach(f => {
      if (f.front) { f.pivot.rotation.z = f.side * (0.05 + 0.6 * stroke); f.pivot.rotation.y = f.side * (-0.55 + 0.3 * Math.cos(ph)); f.pivot.rotation.x = 0.25 * Math.cos(ph); }
      else { f.pivot.rotation.z = f.side * 0.12 * Math.sin(t * 1.3); f.pivot.rotation.y = f.side * 2.5; }
    });
    body.position.y = -0.025 * stroke; body.rotation.x = 0.04 * Math.cos(ph);
    const nod = 0.06 * Math.sin(t * 0.8);
    neck.position.set(0, 0.0, 0.5);
    head.position.set(0, 0.03 + nod * 0.2, 0.62); head.rotation.x = nod;
    beak.position.set(0, 0.015 + nod * 0.2, 0.73);
    eyes.forEach((e, k) => e.position.set((k ? -1 : 1) * 0.058, 0.05 + nod * 0.2, 0.665));
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ハダカイワシの群れ（Myctophidae） ----------
// size = 1 匹の体長。群れ全体を 1 つの「生き物」として返す（+z が進む向き）
function buildLanternfishSchool(size) {
  const g = new THREE.Group();
  const N = 28;
  const tex = canvasTex(128, 64, (x, W, H) => {
    const gr = x.createLinearGradient(0, 0, W, 0);                  // 周方向: 右側面 → 背中 → 左側面 → 腹
    gr.addColorStop(0, '#aebdc8'); gr.addColorStop(0.18, '#23303e'); gr.addColorStop(0.32, '#23303e'); gr.addColorStop(0.5, '#aebdc8'); gr.addColorStop(0.75, '#dfe8ee'); gr.addColorStop(1, '#aebdc8');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 18; c++) { x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 1; x.beginPath(); x.arc(c * 7.5 + (r % 2) * 3.5, r * 11 + 4, 4, 0.2, Math.PI - 0.2); x.stroke(); }   // うろこ
  });
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, metalness: 0.6, roughness: 0.25, clearcoat: 0.9, side: THREE.FrontSide });
  const finMat = skin({ color: 0x9fb0bc, opacity: 0.5, rim: 0xffffff, rimAmount: 0.4 });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x04060a, roughness: 0.03, clearcoat: 1, metalness: 0.3 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0xc8d4dc, metalness: 0.8, roughness: 0.2 });
  // 体: 頭が大きく丸い。目はとても大きい
  const r = s => (s < 0.25 ? 0.11 * Math.pow(Math.sin(Math.min(1, (s + 0.03) / 0.28) * Math.PI / 2), 0.55) : 0.11 * Math.pow(Math.max(0, 1 - (s - 0.25) / 0.72), 0.9) + 0.008);
  const fish = [];
  for (let i = 0; i < N; i++) {
    const f = new THREE.Group();
    const bodyM = makeBody(18, 12, bodyMat); f.add(bodyM);
    const tail = makeFan(9, finMat), dorsal = makeFan(7, finMat), anal = makeFan(7, finMat), adipose = makeFan(4, finMat);
    f.add(tail, dorsal, anal, adipose);
    const eyes = [1, -1].map(() => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), eyeMat); const ir = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 6, 18), irisMat); ir.rotation.y = Math.PI / 2; f.add(e, ir); return { e, ir }; });
    f.scale.setScalar(size);
    const off = new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 18).multiplyScalar(size);
    g.add(f); fish.push({ f, bodyM, tail, dorsal, anal, adipose, eyes, off, ph: Math.random() * 10, sp: 0.8 + Math.random() * 0.4 });
  }
  // 発光器: 腹側の 2 列と、尾の付け根の列（全個体ぶんをまとめて描く）
  const PH = 11;
  const glow = glowPoints(N * PH * 2, 0x7fd8ff, 2.2);
  g.add(glow);
  const P = new THREE.Vector3(), Q = new THREE.Vector3();
  function animate(t) {
    const gp = glow.geometry.attributes.position; let n = 0;
    fish.forEach(F => {
      const tt = t * F.sp + F.ph;
      const wave = s => 0.06 * Math.pow(s, 1.5) * Math.sin(2 * Math.PI * (1.1 * s) - tt * 2 * Math.PI * 2.2);
      const center = (s, out) => out.set(wave(s), -0.01 * s, 0.5 - s);
      F.bodyM.userData.update(center, r, s => r(s) * 1.3);
      center(1, P);
      const tips = []; for (let k = 0; k < 9; k++) { const a = (k / 8 - 0.5) * 1.7, fork = 1 - 0.4 * Math.cos(k / 8 * Math.PI * 2); tips.push(new THREE.Vector3(P.x + wave(1.1) * 1.5, P.y + Math.sin(a) * 0.17 * fork, P.z - Math.cos(a) * 0.15 * fork)); }
      F.tail.userData.update(new THREE.Vector3(P.x, P.y, P.z + 0.02), tips);
      const fin = (fan, s0, s1, dir, hgt, cnt) => { const pts = []; for (let k = 0; k < cnt; k++) { const s = s0 + (s1 - s0) * k / (cnt - 1); center(s, P); pts.push(new THREE.Vector3(P.x, P.y + dir * (r(s) * 1.3 + hgt * Math.sin(Math.PI * k / (cnt - 1))), P.z)); } center((s0 + s1) / 2, P); fan.userData.update(new THREE.Vector3(P.x, P.y + dir * r((s0 + s1) / 2) * 1.2, P.z), pts); };
      fin(F.dorsal, 0.36, 0.55, 1, 0.07, 7); fin(F.anal, 0.55, 0.75, -1, 0.05, 7); fin(F.adipose, 0.8, 0.86, 1, 0.025, 4);
      center(0.1, P);
      F.eyes.forEach(({ e, ir }, k) => { const sd = k ? -1 : 1; e.position.set(P.x + sd * 0.07, P.y + 0.025, P.z); ir.position.set(P.x + sd * 0.074, P.y + 0.025, P.z); });
      F.f.position.copy(F.off).add(Q.set(Math.sin(tt * 0.5) * size * 0.8, Math.sin(tt * 0.7) * size * 0.5, Math.sin(tt * 0.3) * size));
      F.f.rotation.y = 0.15 * Math.sin(tt * 0.5);
      for (let k = 0; k < PH; k++) {
        const s = k < 8 ? 0.18 + k / 8 * 0.5 : 0.72 + (k - 8) * 0.06; center(s, P);
        [1, -1].forEach(side => {
          Q.set(P.x + side * r(s) * (k < 8 ? 0.55 : 0.75), P.y - r(s) * 1.3 * (k < 8 ? 0.8 : 0.4), P.z).multiplyScalar(size).applyEuler(F.f.rotation).add(F.f.position);
          gp.setXYZ(n++, Q.x, Q.y, Q.z);
        });
      }
    });
    gp.needsUpdate = true;
    glow.material.opacity = 0.6 + 0.35 * Math.sin(t * 1.3);
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ダイオウイカ（Architeuthis dux） ----------
// 設計は全長 1（外套膜の先 +z → 触腕の先 -z）。外套膜を先にして泳ぐ。
// 外套膜は全長の約 2 割の細長い円錐で、先に小さな楕円形のひれ。頭には直径 25 cm にもなる大きな目。
// 腕 8 本は太く、内側に 2 列の吸盤。触腕 2 本は細長く、先のこん棒状の部分（触腕掌）に 4 列の吸盤が並ぶ。
// 色は色素胞の赤褐色で、背中ほど濃く、腹側は銀白色
function buildGiantSquid(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const TW = 512, TH = 1024;
  const tex = canvasTex(TW, TH, (x, W, H) => {                      // u（横）= 周方向: 0 = 右, 0.25 = 背中, 0.5 = 左, 0.75 = 腹
    const gr = x.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#9c4029'); gr.addColorStop(0.25, '#651c12'); gr.addColorStop(0.5, '#9c4029'); gr.addColorStop(0.75, '#dcc0b4'); gr.addColorStop(1, '#9c4029');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 12000; i++) {                                 // 色素胞: 背中ほど多く大きい。広がったものは暗い赤褐色、縮んだものは橙色の点
      const u = Math.random(), dors = 0.5 + 0.5 * Math.sin(u * Math.PI * 2);
      if (Math.random() > 0.2 + 0.8 * dors) continue;
      const big = Math.random() < 0.35, r = big ? 1.2 + Math.random() * (1.5 + 2.5 * dors) : 0.5 + Math.random() * 1.1;
      x.fillStyle = big ? `rgba(${85 + Math.random() * 40 | 0},${16 + Math.random() * 14 | 0},${12 + Math.random() * 10 | 0},${0.3 + 0.45 * dors})`
                        : `rgba(${180 + Math.random() * 50 | 0},${80 + Math.random() * 40 | 0},${45 + Math.random() * 30 | 0},${0.25 + 0.35 * dors})`;
      x.beginPath(); x.arc(u * W, Math.random() * H, r, 0, 7); x.fill();
    }
    for (let i = 0; i < 2500; i++) { x.fillStyle = 'rgba(255,244,236,.16)'; x.fillRect(W * (0.6 + Math.random() * 0.3), Math.random() * H, 2, 2); }   // 腹側の銀色のつや
    x.fillStyle = 'rgba(70,14,10,.3)'; x.fillRect(W * 0.25 - 2, 0, 4, H);   // 背中の中央を通る軟甲（甲の名残）の線
  });
  const bumpTex = canvasTex(TW, TH, (x, W, H) => {                  // 皮膚の細かなざらつき
    x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const c = Math.random() < 0.5 ? 70 : 190; x.fillStyle = `rgba(${c},${c},${c},.35)`; x.beginPath(); x.arc(Math.random() * W, Math.random() * H, 0.8 + Math.random() * 1.6, 0, 7); x.fill(); }
  });
  const skinM = skin({ color: 0xffffff, map: tex, rim: 0xffb49c, rimAmount: 0.32, clearcoat: 0.9, roughness: 0.32, side: THREE.DoubleSide });
  skinM.bumpMap = bumpTex; skinM.bumpScale = 0.0006 * size;
  const limbM = skin({ color: 0x8e3624, rim: 0xffc0aa, rimAmount: 0.3, clearcoat: 0.85, roughness: 0.32 });
  const finM = skin({ color: 0x7a2a1a, rim: 0xffc0aa, rimAmount: 0.3, clearcoat: 0.85, roughness: 0.32 });
  // 外套膜（先が細くとがった円錐。前の端は開いていて、頭がそこから出る）
  const ML = 0.21, ZO = 0.5 - ML;
  const mantle = makeBody(56, 28, skinM); body.add(mantle);
  const rM = curve([0, 0.05, 0.12, 0.25, 0.4, 0.6, 0.8, 0.95, 1], [0, 0.0035, 0.0075, 0.015, 0.021, 0.025, 0.0255, 0.0245, 0.024]);
  // 頭（外套膜の中から腕の付け根まで）
  const ZH0 = 0.305, ZB = 0.247, head = makeBody(28, 24, skinM); body.add(head);
  const rH = curve([0, 0.25, 0.5, 0.75, 0.92, 1], [0.019, 0.0172, 0.0192, 0.0178, 0.0152, 0.0135]);
  // ひれ: 外套膜の先の左右に、小さな楕円形（厚みあり。波打たせて泳ぐ）
  const finGeo = () => makeFoil({ span: 0.03, nA: 12, nV: 10, le: a => 0.468 - 0.004 * a + 0.027 * Math.sqrt(Math.max(0, 1 - a ** 2.2)), te: a => 0.468 - 0.004 * a - 0.027 * Math.sqrt(Math.max(0, 1 - a ** 2.2)), th: a => 0.0035 * (1 - a) ** 0.8 + 0.0004 });
  const fins = [1, -1].map(side => { const m = new THREE.Mesh(finGeo(), finM); m.scale.x = side; m.position.x = side * 0.002; body.add(m); return m; });
  // 目: 黒い大きな瞳、銀色がかった虹彩の輪、まわりの皮膚のふち
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x04060a, roughness: 0.03, clearcoat: 1, metalness: 0.2 });
  const irisM = new THREE.MeshStandardMaterial({ color: 0x7c705a, roughness: 0.35, metalness: 0.6 });
  [1, -1].forEach(side => {
    const e = new THREE.Group(); e.position.set(side * 0.012, 0.002, 0.276); body.add(e);
    e.add(new THREE.Mesh(new THREE.SphereGeometry(0.0145, 24, 16), eyeM));
    const iris = new THREE.Mesh(new THREE.TorusGeometry(0.0092, 0.0012, 8, 32), irisM); iris.rotation.y = Math.PI / 2; iris.position.x = side * 0.0112; e.add(iris);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.0142, 0.0024, 8, 32), limbM); lid.rotation.y = Math.PI / 2; lid.position.x = side * 0.004; e.add(lid);
  });
  // 漏斗: 腹側で外套膜の口から前へ突き出る
  const funnel = makeTube(10, 10, limbM); body.add(funnel);
  // 口（腕の輪の中心）: 口のまわりの膜と、黒褐色のくちばし
  const mouthDisc = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), new THREE.MeshStandardMaterial({ color: 0x4a1610, roughness: 0.6, side: THREE.DoubleSide }));
  mouthDisc.position.z = ZB - 0.0005; body.add(mouthDisc);
  const lips = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0018, 8, 20), limbM); lips.position.z = ZB - 0.002; body.add(lips);
  const beakM = new THREE.MeshPhysicalMaterial({ color: 0x2a1a0e, roughness: 0.2, clearcoat: 1 });
  [1, -1].forEach(sy => { const b = new THREE.Mesh(new THREE.ConeGeometry(0.0028, 0.007, 10), beakM); b.rotation.x = -Math.PI / 2 + sy * 0.25; b.position.set(0, sy * 0.0012, ZB - 0.005); body.add(b); });
  // 腕 8 本（I〜IV 対）と触腕 2 本（III と IV の間から出る）
  const H2 = Math.PI / 2, arms = [];
  [[H2 - 0.39, 0.15], [H2 + 0.39, 0.15], [H2 - 1.18, 0.165], [H2 + 1.18, 0.165], [-H2 + 1.18, 0.175], [-H2 - 1.18, 0.175], [-H2 + 0.39, 0.165], [-H2 - 0.39, 0.165]]
    .forEach(([ang, L]) => { const N = 30, t = makeTube(N, 8, limbM); body.add(t); arms.push({ t, ang, L, tent: false, N, pts: Array.from({ length: N }, () => new THREE.Vector3()) }); });
  [-H2 + 0.78, -H2 - 0.78].forEach(ang => { const N = 64, t = makeTube(N, 8, limbM); body.add(t); arms.push({ t, ang, L: 0.74, tent: true, N, pts: Array.from({ length: N }, () => new THREE.Vector3()) }); });
  const armR = u => 0.0062 * Math.pow(1 - u, 0.85) + 0.0006;
  const tentR = u => (u < 0.82 ? 0.004 - 0.0012 * Math.min(1, u / 0.3) : 0.0028 + 0.0028 * Math.pow(Math.sin(Math.PI * Math.min(1, (u - 0.82) / 0.18)), 0.8)) * (1 - 0.6 * ss(0.95, 1, u));
  // 吸盤（縁の盛り上がった小さなカップ）
  const cup = new THREE.LatheGeometry([[0.001, 0], [0.3, 0], [0.48, 0.12], [0.5, 0.3], [0.44, 0.36], [0.36, 0.3], [0.3, 0.12], [0.001, 0.1]].map(([a, b]) => new THREE.Vector2(a, b)), 12);
  const SUCK = 8 * 2 * 24 + 2 * (4 * 12 + 6);
  const suckers = new THREE.InstancedMesh(cup, new THREE.MeshStandardMaterial({ color: 0xc8a494, roughness: 0.5, side: THREE.DoubleSide }), SUCK);
  suckers.frustumCulled = false; body.add(suckers);
  g.scale.setScalar(size);
  const P = new THREE.Vector3(), Tn = new THREE.Vector3(), In = new THREE.Vector3(), E = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), dummy = new THREE.Object3D();
  const putSucker = (n, A, u, side, sz) => {                          // 腕の内側（腕の輪の中心側）に、腕の表面から外向きに置く
    const k = Math.min(A.N - 2, Math.round(u * (A.N - 1))), p = A.pts[k], r = A.tent ? tentR(u) : armR(u);
    Tn.subVectors(A.pts[k + 1], A.pts[Math.max(0, k - 1)]).normalize();
    In.set(-p.x, -p.y, 0); In.addScaledVector(Tn, -In.dot(Tn)); if (In.lengthSq() < 1e-10) In.set(0, -1, 0); In.normalize();
    E.crossVectors(Tn, In);
    dummy.position.copy(p).addScaledVector(In, r * 0.8).addScaledVector(E, side * r);
    dummy.quaternion.setFromUnitVectors(Y, In); dummy.scale.setScalar(sz); dummy.updateMatrix();
    suckers.setMatrixAt(n, dummy.matrix);
  };
  function animate(t) {
    const jet = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.22);       // 外套膜の収縮（ジェット推進）
    const sway = s => 0.003 * Math.sin(t * 0.7 + s * 3);
    mantle.userData.update((s, out) => out.set(sway(s), 0, 0.5 - ML * s), s => rM(s) * (1 - 0.07 * jet * ss(0.15, 0.4, s)), s => rM(s) * 0.94 * (1 - 0.07 * jet * ss(0.15, 0.4, s)));
    head.userData.update((s, out) => out.set(sway(1), 0, ZH0 - (ZH0 - ZB) * s), rH, s => rH(s) * 0.95);
    // ひれを波打たせる
    fins.forEach((m, k) => {
      const p = m.geometry.attributes.position, b = m.geometry.userData.base;
      for (let i = 0; i < p.count; i++) { const a = b[i * 3] / 0.03, z = b[i * 3 + 2]; p.setXYZ(i, b[i * 3], b[i * 3 + 1] + 0.007 * Math.pow(a, 1.5) * Math.sin(t * 2.8 - (z - 0.47) * 60 + k * Math.PI), z); }
      p.needsUpdate = true; m.geometry.computeVertexNormals();
    });
    const fp = []; for (let k = 0; k < 10; k++) { const u = k / 9; fp.push(new THREE.Vector3(0, -0.0172 + 0.0008 * u, 0.302 - 0.04 * u)); }
    funnel.userData.update(fp, u => 0.0075 * (1 - 0.45 * u) + 0.0012);
    // 腕と触腕: 後ろへなびき、ゆっくりうねる。ジェットに合わせて少し開く
    let n = 0;
    arms.forEach((A, i) => {
      const cs = Math.cos(A.ang), sn = Math.sin(A.ang), R0 = A.tent ? 0.0105 : 0.0115;
      for (let k = 0; k < A.N; k++) {
        const u = k / (A.N - 1);
        let rho, tw, rw;
        if (A.tent) {
          rho = R0 + A.L * 0.03 * Math.sin(Math.PI * u) - R0 * 0.5 * u;
          tw = A.L * 0.03 * Math.sin(t * 0.7 + i * 2 - u * 8) * u; rw = A.L * 0.02 * Math.sin(t * 0.9 + i - u * 6) * u;
        } else {
          rho = R0 + A.L * (0.16 * u + 0.12 * u * u * (0.6 + 0.4 * jet)) - A.L * 0.12 * ss(0.78, 1, u);   // 先は内側へ丸まる
          tw = A.L * 0.1 * Math.sin(t * 1.1 + i * 0.9 - u * 5) * Math.pow(u, 1.5); rw = A.L * 0.05 * Math.sin(t * 0.8 + i * 1.7 - u * 4) * Math.pow(u, 1.5);
        }
        A.pts[k].set(cs * (rho + rw) - sn * tw, sn * (rho + rw) + cs * tw, ZB - A.L * u * (1 - 0.04 * u));
      }
      A.t.userData.update(A.pts, A.tent ? tentR : armR);
      if (!A.tent) {                                                  // 腕の吸盤: 2 列、先ほど小さい
        for (let q = 0; q < 24; q++) { const u = 0.04 + q / 23 * 0.9; [-0.42, 0.42].forEach(sd => putSucker(n++, A, u + (sd > 0 ? 0.015 : 0), sd, armR(u) * 1.15)); }
      } else {                                                        // 触腕: 根元側の小さな吸盤と、こん棒部分の 4 列（中央の 2 列が大きい）
        for (let q = 0; q < 6; q++) putSucker(n++, A, 0.8 + q * 0.007, q % 2 ? 0.3 : -0.3, 0.0018);
        for (let q = 0; q < 12; q++) {
          const u = 0.845 + q / 11 * 0.145, big = u < 0.94 ? 1 : 0.45;
          [-0.75, -0.25, 0.25, 0.75].forEach(sd => putSucker(n++, A, u + (Math.abs(sd) > 0.5 ? 0.005 : 0), sd, tentR(u) * (Math.abs(sd) < 0.5 ? 1.1 * big : 0.55) * 1.1));
        }
      }
    });
    suckers.instanceMatrix.needsUpdate = true;
  }
  animate(0);
  return { group: g, animate };
}

// ---------- マッコウクジラ（Physeter macrocephalus） ----------
// 設計は体長 1（頭 +z）。体長のおよそ 3 分の 1 が、縦に高く前が切り立った四角い頭で、鼻先は下あごより前に突き出る。
// 頭はイカの吸盤や歯の傷跡で白っぽく、頭より後ろの皮膚はしわが寄ってでこぼこ。背中に低いこぶとその後ろのでこぼこ、
// 尾の付け根は左右に平たく下にもこぶ。尾びれは厚みのある三角形で中央に深い切れこみ。胸びれは小さなへら形。
// 噴気孔は頭の前端の左寄りに 1 つ（S 字）。細長い下あごに円すい形の歯が並び、口の縁と口の中は白い
function buildSpermWhale(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  // ---- 皮膚の模様と凹凸（色と凹凸に同じしわ・傷を描く）。u（横）= 周方向: 0 = 右, 0.25 = 背中, 0.5 = 左, 0.75 = 腹。v（縦）= 頭 → 尾
  const TW = 512, TH = 1024, rnd = Math.random;
  const wr = []; for (let i = 0; i < 2600; i++) { const y = TH * (0.28 + Math.pow(rnd(), 0.8) * 0.72); if (y < TH * 0.38 && rnd() > (y / TH - 0.28) / 0.1) continue; wr.push({ x0: rnd() * TW, y, L: 24 + rnd() * 70, a: (rnd() - 0.5) * 0.35, amp: 0.8 + rnd() * 1.6, f: 0.12 + rnd() * 0.2 }); }   // しわは主に体を巻く向きの、波打つ長いすじ
  const wavy = (x, o, dy) => { for (const sh of [-TW, 0, TW]) { x.beginPath(); for (let k = 0; k <= o.L; k += 2) { const px = o.x0 + sh + Math.cos(o.a) * k, py = o.y + Math.sin(o.a) * k + Math.sin(k * o.f) * o.amp + dy; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); } };   // 周の継ぎ目をまたぐ線は反対側にも描く
  // 傷跡: 仲間の歯による平行な引っかき傷（2〜4 本ひと組）、ゆるく曲がった細い傷、イカの吸盤の小さな丸い跡（欠けた輪）
  const scars = [];
  for (let i = 0; i < 150; i++) {
    const kind = rnd(), x0 = rnd() * TW, y0 = TH * (0.06 + rnd() * 0.3);   // 鼻先の正面（テクスチャが 1 点に集まる所）は避ける
    if (kind < 0.35) { const n = 2 + (rnd() * 3 | 0), a = (rnd() - 0.5) * 1.4, L = 15 + rnd() * 45, gap = 3 + rnd() * 3; for (let k = 0; k < n; k++) scars.push({ t: 'line', x: x0 + Math.sin(a) * gap * k, y: y0 - Math.cos(a) * gap * k, a, L: L * (0.8 + rnd() * 0.3), bend: (rnd() - 0.5) * 0.3, wd: 0.8 + rnd() * 0.6, al: 0.1 + rnd() * 0.1 }); }
    else if (kind < 0.65) scars.push({ t: 'line', x: x0, y: y0, a: (rnd() - 0.5) * 2, L: 8 + rnd() * 40, bend: (rnd() - 0.5) * 0.8, wd: 0.6 + rnd() * 0.8, al: 0.08 + rnd() * 0.1 });
    else { const n = 2 + (rnd() * 4 | 0); for (let k = 0; k < n; k++) scars.push({ t: 'ring', x: x0 + (rnd() - 0.5) * 40, y: y0 + (rnd() - 0.5) * 30, r: 1 + rnd() * 2, a0: rnd() * 6, al: 0.06 + rnd() * 0.06 }); }
  }
  const drawScar = (x, o, alMul) => { for (const sh of [-TW, 0, TW]) { x.save(); x.translate(sh, 0); drawScar1(x, o, alMul); x.restore(); } };
  const drawScar1 = (x, o, alMul) => {
    x.globalAlpha = Math.min(1, o.al * alMul); x.beginPath();
    if (o.t === 'ring') { x.lineWidth = 0.9; x.arc(o.x, o.y, o.r, o.a0, o.a0 + 4.6); }
    else { x.lineWidth = o.wd; x.moveTo(o.x, o.y); x.quadraticCurveTo(o.x + Math.cos(o.a + o.bend) * o.L * 0.5, o.y + Math.sin(o.a + o.bend) * o.L * 0.5, o.x + Math.cos(o.a) * o.L, o.y + Math.sin(o.a) * o.L); }
    x.stroke(); x.globalAlpha = 1;
  };
  const grooves = [-44, -34, -25, 25, 34, 44];                        // のどの短い溝
  const colTex = canvasTex(TW, TH, (x, W, H) => {
    const gr = x.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#4a4540'); gr.addColorStop(0.25, '#35312d'); gr.addColorStop(0.5, '#4a4540'); gr.addColorStop(0.75, '#5a534c'); gr.addColorStop(1, '#4a4540');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    const hg = x.createLinearGradient(0, 0, 0, H * 0.4); hg.addColorStop(0, 'rgba(160,154,146,.2)'); hg.addColorStop(1, 'rgba(160,154,146,0)');
    x.fillStyle = hg; x.fillRect(0, 0, W, H * 0.4);                 // 頭は傷跡で白っぽい
    x.lineWidth = 1.6; wr.forEach(o => { x.strokeStyle = 'rgba(22,19,17,.28)'; wavy(x, o, 0); x.strokeStyle = 'rgba(120,112,104,.12)'; wavy(x, o, 2); });
    x.strokeStyle = 'rgb(220,214,204)'; scars.forEach(o => drawScar(x, o, 1.6));
    // 上あごの縁と口角は白い
    const lg = x.createLinearGradient(W * 0.75 - 22, 0, W * 0.75 + 22, 0);
    lg.addColorStop(0, 'rgba(225,218,208,0)'); lg.addColorStop(0.25, 'rgba(225,218,208,.85)'); lg.addColorStop(0.75, 'rgba(225,218,208,.85)'); lg.addColorStop(1, 'rgba(225,218,208,0)');
    x.fillStyle = lg; x.fillRect(W * 0.75 - 22, H * 0.06, 44, H * 0.25);
    const blob = (cx, cy, rx, ry, a) => { x.save(); x.translate(cx, cy); x.scale(rx, ry); const rg = x.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, `rgba(228,222,212,${a})`); rg.addColorStop(1, 'rgba(228,222,212,0)'); x.fillStyle = rg; x.beginPath(); x.arc(0, 0, 1, 0, 7); x.fill(); x.restore(); };
    blob(W * 0.75 - 24, H * 0.31, 14, 22, 0.8); blob(W * 0.75 + 24, H * 0.31, 14, 22, 0.8);
    for (let i = 0; i < 7; i++) blob(W * (0.69 + rnd() * 0.12), H * (0.38 + rnd() * 0.32), 6 + rnd() * 14, 10 + rnd() * 30, 0.35 + rnd() * 0.3);   // 腹の白い斑
    x.strokeStyle = 'rgba(20,18,16,.25)'; x.lineWidth = 1.5; grooves.forEach(dx => { x.beginPath(); x.moveTo(W * 0.75 + dx, H * 0.25); x.lineTo(W * 0.75 + dx * 1.1, H * 0.31); x.stroke(); });
  });
  const bumpTex = canvasTex(TW, TH, (x, W, H) => {
    x.fillStyle = '#808080'; x.fillRect(0, 0, W, H);
    x.filter = 'blur(0.8px)';
    x.lineWidth = 2.6; wr.forEach(o => { x.strokeStyle = 'rgba(30,30,30,.5)'; wavy(x, o, 0); x.strokeStyle = 'rgba(230,230,230,.4)'; wavy(x, o, 2.6); });
    x.strokeStyle = 'rgb(40,40,40)'; scars.forEach(o => drawScar(x, o, 2.5));
    x.strokeStyle = 'rgba(20,20,20,.6)'; x.lineWidth = 3; grooves.forEach(dx => { x.beginPath(); x.moveTo(W * 0.75 + dx, H * 0.25); x.lineTo(W * 0.75 + dx * 1.1, H * 0.31); x.stroke(); });
    x.filter = 'none';
  });
  const skinM = skin({ color: 0xffffff, map: colTex, rim: 0x8a847c, rimAmount: 0.18, clearcoat: 0.5, roughness: 0.5, side: THREE.FrontSide });
  skinM.bumpMap = bumpTex; skinM.bumpScale = 0.002 * size;
  const darkM = skin({ color: 0x3c3733, rim: 0x8a847c, rimAmount: 0.15, clearcoat: 0.4, roughness: 0.55 });
  const whiteM = skin({ color: 0xe2d9cf, rim: 0xffffff, rimAmount: 0.12, clearcoat: 0.5, roughness: 0.5 });
  // ---- 体の形（半分の高さ h・半分の幅 w を体の前後 s で与える）
  const Hc = curve([0, 0.1, 0.2, 0.3, 0.38, 0.48, 0.58, 0.68, 0.78, 0.86, 0.93, 1], [0.088, 0.094, 0.096, 0.094, 0.091, 0.087, 0.078, 0.062, 0.044, 0.031, 0.022, 0.012]);
  const Wc = curve([0, 0.1, 0.2, 0.3, 0.38, 0.48, 0.58, 0.68, 0.78, 0.86, 0.93, 1], [0.058, 0.064, 0.068, 0.071, 0.076, 0.077, 0.07, 0.054, 0.034, 0.02, 0.012, 0.008]);
  const nose = s => Math.pow(Math.sin(Math.min(1, s / 0.05) * Math.PI / 2), 0.35);        // 頭の前面はほぼ垂直に切り立ち、角は丸い
  const endCap = s => Math.pow(Math.sin(Math.min(1, (1 - s) / 0.025) * Math.PI / 2), 0.5);   // 尾の先は閉じる（尾びれの中に入る）
  const drop = s => s < 0.2 ? 0.018 * (1 - s / 0.2) ** 2 : 0;                              // 頭の下側は前ほど引っこむ
  const h = s => Hc(s) * nose(s) * endCap(s) - drop(s), w = s => Wc(s) * nose(s) * endCap(s);
  const shape = (s, th) => {
    const sn = Math.sin(th), c = Math.abs(Math.cos(th)), q = Math.abs(sn), hk = 1 - ss(0.3, 0.42, s);
    let k = 1;
    if (hk > 0) k *= 1 + (Math.pow(c ** 3.5 + q ** 3.5, -1 / 3.5) * (1 - 0.15 * Math.max(0, -sn) * c) - 1) * hk;   // 頭は角の丸い四角の断面。あごの上はややすぼまる
    if (sn > 0.7) k *= 1 + (0.32 * Math.exp(-(((s - 0.63) / 0.035) ** 2)) + 0.1 * Math.max(0, Math.sin((s - 0.7) * 150)) * (s > 0.7 && s < 0.88 ? 1 : 0)) * (sn - 0.7) * 3.3;   // 背中のこぶと、その後ろのでこぼこ
    if (sn < -0.7) k *= 1 + 0.35 * Math.exp(-(((s - 0.86) / 0.04) ** 2)) * (-sn - 0.7) * 3.3;   // 尾の付け根の下のこぶ
    return k;
  };
  let ph = 0;
  const wave = s => 0.03 * Math.pow(Math.max(0, s - 0.36), 1.6) * 4.5 * Math.sin(ph - s * 3.2);   // 尾びれを上下に打つ波
  const center = (s, out) => out.set(0, drop(s) + wave(s), 0.5 - s);
  const P = new THREE.Vector3(), Q = new THREE.Vector3();
  const surf = (s, th, out) => { center(s, P); const k = shape(s, th); return out.set(P.x + Math.cos(th) * w(s) * k, P.y + Math.sin(th) * h(s) * k, P.z); };
  const bottom = s => drop(s) - h(s);
  const hull = makeBody(110, 44, skinM, u => Math.pow(u, 1.45)); body.add(hull);   // 鼻先ほど輪を細かく
  // ---- 下あご: 口角（s = 0.31）を軸に下へ開く、細長い棒。前の 3 分の 2 に円すい形の歯が並ぶ
  const HS = 0.31, JT = 0.08, hy = bottom(HS) - 0.003, hz = 0.5 - HS;
  const jawPivot = new THREE.Group(); jawPivot.position.set(0, hy, hz); body.add(jawPivot);
  const jaw = makeBody(28, 14, skin({ color: 0xc4bcb2, rim: 0xffffff, rimAmount: 0.12, clearcoat: 0.5, roughness: 0.5 })); jawPivot.add(jaw);
  const jS = u => JT + (HS + 0.02 - JT) * u, tip = u => Math.pow(Math.sin(Math.min(1, u / 0.08) * Math.PI / 2), 0.6);
  const jW = u => 0.0075 * tip(u) + 0.004 * ss(0.7, 1, u), jH = u => 0.009 * tip(u) + 0.006 * ss(0.7, 1, u);
  const jY = u => bottom(jS(u)) - jH(u) * 0.55 - hy;
  jaw.userData.update((u, out) => out.set(0, jY(u), 0.5 - jS(u) - hz), jW, jH);
  const toothM = new THREE.MeshPhysicalMaterial({ color: 0xeee6d2, roughness: 0.3, clearcoat: 0.8 });
  const toothGeo = new THREE.ConeGeometry(1, 1, 8); toothGeo.translate(0, 0.5, 0);
  const sockets = [];
  for (let k = 0; k < 22; k++) {
    const u = 0.1 + k / 21 * 0.62, L = 0.006 + 0.004 * Math.sin(Math.PI * k / 21);
    [1, -1].forEach(side => {
      const m = new THREE.Mesh(toothGeo, toothM); m.scale.set(0.0022, L, 0.0022);
      m.position.set(side * jW(u) * 0.55, jY(u) + jH(u) * 0.7, 0.5 - jS(u) - hz); m.rotation.set(-0.15, 0, -side * 0.15); jawPivot.add(m);
      sockets.push([side * jW(u) * 0.55, jS(u)]);
    });
  }
  // 口の中（上あごの白い帯と、歯がはまる穴）
  const palate = makeBody(20, 10, whiteM); body.add(palate);
  palate.userData.update((u, out) => { const s = 0.07 + (HS - 0.07) * u; return out.set(0, bottom(s) + 0.0012, 0.5 - s); }, u => 0.012 * tip(u), () => 0.0025);
  const sockM = new THREE.MeshStandardMaterial({ color: 0x3a2a26, roughness: 0.8 });
  sockets.forEach(([x, s]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 8, 6), sockM); m.scale.y = 0.4; m.position.set(x, bottom(s) - 0.0004, 0.5 - s); body.add(m); });
  // ---- 尾びれ: 厚みのある三角形。前縁は後ろへ流れ、後縁はまっすぐで中央に深い切れこみ
  const flukes = new THREE.Mesh(makeFoil({ span: 0.135, both: true, nA: 14, nV: 10, le: a => 0.02 - 0.125 * a ** 1.3, te: a => -0.045 - 0.05 * ss(0, 0.22, a) - 0.01 * a, th: a => 0.016 * (1 - a) ** 0.9 + 0.0008 }),
    skin({ color: 0x302c29, rim: 0x8a847c, rimAmount: 0.12, clearcoat: 0.15, roughness: 0.65 }));
  const flukePivot = new THREE.Group(); flukePivot.add(flukes); body.add(flukePivot);
  // ---- 胸びれ: 目の後ろ下の小さなへら形
  const flipGeo = makeFoil({ span: 0.062, nA: 10, nV: 8, le: a => 0.011 * Math.sqrt(Math.max(0, 1 - a ** 4)) - 0.012 * a, te: a => -0.017 * Math.sqrt(Math.max(0, 1 - a ** 3)) - 0.012 * a, th: a => 0.009 * (1 - 0.8 * a) });
  const flips = [1, -1].map(side => {
    const pv = new THREE.Group(); surf(0.35, side > 0 ? -0.6 : Math.PI + 0.6, pv.position); pv.position.x *= 0.95; body.add(pv);
    const m = new THREE.Mesh(flipGeo, darkM); m.scale.x = side; pv.add(m); pv.rotation.set(0, side * 0.55, -side * 0.45);
    return { pv, side };
  });
  // ---- 目（口角の少し上と後ろ。小さい）とまぶた
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x0a0806, roughness: 0.08, clearcoat: 1 });
  const lidM = skin({ color: 0x5a524a, rim: 0x8a847c, rimAmount: 0.15, roughness: 0.55 });
  [1, -1].forEach(side => {
    const e = new THREE.Group(); surf(0.295, side > 0 ? -0.62 : Math.PI + 0.62, e.position); body.add(e);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 14, 10), eyeM); ball.position.x = -side * 0.001; e.add(ball);
    const lid = new THREE.Mesh(new THREE.TorusGeometry(0.0046, 0.0013, 8, 20), lidM); lid.rotation.y = Math.PI / 2; lid.scale.set(1, 0.75, 1); e.add(lid);
  });
  // ---- 噴気孔: 頭の前端の左寄り（体の +x 側）に、斜めの S 字の切れこみ
  const blow = makeTube(12, 6, new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 0.7 })); body.add(blow);
  { const bp = []; for (let k = 0; k < 12; k++) { const q = k / 11; surf(0.03 + 0.026 * q, Math.PI / 2 - 0.22 - 0.14 * q + 0.07 * Math.sin(q * Math.PI * 2), Q); bp.push(Q.clone().multiplyScalar(1).add(new THREE.Vector3(0, 0.0008, 0))); } blow.userData.update(bp, u => 0.0012 * Math.sin(Math.PI * (0.1 + 0.8 * u))); }
  g.scale.setScalar(size);
  let mouth = 0, want = null, lastNow = null;
  function animate(t) {
    ph = t * 2 * Math.PI * 0.16;                                      // ゆっくり尾びれを上下に打つ
    hull.userData.update(center, w, h, shape);
    body.rotation.x = 0.012 * Math.sin(ph + 1.2);                     // 尾の動きに合わせて頭がわずかに上下する
    // 口: ふだんは 30 秒ごとに 6 秒ほど開ける。setMouth で開け閉めを指定すると、それに従う
    const now = performance.now() / 1000, dtR = lastNow == null ? 1 : Math.min(0.2, now - lastNow); lastNow = now;
    const c = ((t % 30) + 30) % 30, auto = ss(0, 1.5, c) * (1 - ss(4.5, 6, c));
    mouth += ((want == null ? auto : want) - mouth) * Math.min(1, dtR * 2.5);
    jawPivot.rotation.x = 1.25 * mouth;
    // 尾びれ: 尾の先の向きに沿わせ、少し遅れてしなる
    center(0.97, Q); center(1, P);
    flukePivot.position.copy(P); flukePivot.rotation.x = Math.atan2(P.y - Q.y, 0.03) + 0.18 * Math.sin(ph - 3.2 - 1.0);
    flips.forEach(({ pv, side }) => { pv.rotation.z = -side * (0.45 + 0.05 * Math.sin(ph)); });
  }
  animate(0);
  return { group: g, animate, setMouth: v => { want = v; } };
}

// ---------- コウモリダコ（Vampyroteuthis infernalis） ----------
// 設計は全長 1。赤黒いビロードのような体、頭の横の大きな目、腕の間の黒い膜と白い触毛、発光器
function buildVampireSquid(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const velvet = canvasTex(128, 128, (x, W, H) => { x.fillStyle = '#3e1016'; x.fillRect(0, 0, W, H); for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${60 + Math.random() * 50 | 0},${10 + Math.random() * 15 | 0},${18 + Math.random() * 15 | 0},.5)`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); } });
  const dark = skin({ color: 0xffffff, map: velvet, rim: 0xa04050, rimAmount: 0.55, clearcoat: 0.3, roughness: 0.75 });
  const inner = skin({ color: 0x0c0306, rim: 0x5a2230, rimAmount: 0.35, roughness: 0.7 });
  const mantle = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 22), dark); mantle.scale.set(0.165, 0.27, 0.19); mantle.position.set(0, 0.26, -0.02); body.add(mantle);   // 外套膜はやや縦長の釣り鐘形
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), dark); head.scale.set(0.2, 0.13, 0.19); head.position.set(0, 0.04, 0.02); body.add(head);
  const finGeo = new THREE.CircleGeometry(0.11, 18); finGeo.scale(1, 0.75, 1); finGeo.translate(0.09, 0, 0); finGeo.rotateX(-Math.PI / 2);
  const fins = [1, -1].map(side => { const p = new THREE.Group(); p.position.set(side * 0.13, 0.38, -0.03); const m = new THREE.Mesh(finGeo, dark); m.scale.x = side; p.add(m); body.add(p); return { p, side }; });
  // 目: 頭の横。光の加減で青く見える
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x1f5c9e, emissive: 0x081830, roughness: 0.08, clearcoat: 1, metalness: 0.3 });
  const pupilM = new THREE.MeshBasicMaterial({ color: 0x020306 });
  [1, -1].forEach(side => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 14), eyeM); e.position.set(side * 0.17, 0.06, 0.05); body.add(e); const pu = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), pupilM); pu.position.set(side * 0.215, 0.06, 0.06); body.add(pu); });
  const arms = [], N = 14;
  for (let i = 0; i < 8; i++) { const t = makeTube(N, 5, inner); body.add(t); arms.push({ t, ang: (i + 0.5) / 8 * Math.PI * 2, pts: Array.from({ length: N }, () => new THREE.Vector3()) }); }
  const webGeo = new THREE.BufferGeometry(), M = 6;
  webGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * N * (M + 1) * 3), 3));
  const wi = []; for (let i = 0; i < 8; i++) { const o = i * N * (M + 1); for (let k = 0; k < N - 1; k++) for (let j = 0; j < M; j++) { const a = o + k * (M + 1) + j, b = a + 1, c = a + M + 1, d = c + 1; wi.push(a, c, b, b, c, d); } }
  webGeo.setIndex(wi);
  const web = new THREE.Mesh(webGeo, skin({ color: 0x1a0509, rim: 0x6a2232, rimAmount: 0.45, roughness: 0.7 })); body.add(web);
  // 腕の内側の白い触毛
  const cirriGeo = new THREE.BufferGeometry(); cirriGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 8 * 2 * 3), 3));
  const cirri = new THREE.LineSegments(cirriGeo, new THREE.LineBasicMaterial({ color: 0xe8dcd8, transparent: true, opacity: 0.7 })); body.add(cirri);
  // 発光器: ひれの付け根の大きなもの 2 つ、腕先 8 つ、体の小さな点
  const lights = glowPoints(2 + 8 + 24, 0x7fc8ff, 3); body.add(lights);
  const spots = Array.from({ length: 24 }, () => { const a = Math.random() * Math.PI * 2, y = Math.random() * 0.35; return [Math.cos(a) * 0.17, 0.05 + y * 1.1, Math.sin(a) * 0.18 - 0.02]; });
  g.scale.setScalar(size);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function animate(t) {
    const open = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.28), flap = Math.sin(t * 2 * Math.PI * 0.9);
    fins.forEach(({ p, side }) => { p.rotation.z = side * (0.35 + 0.5 * flap); });
    arms.forEach(A => {
      for (let k = 0; k < N; k++) {
        const u = k / (N - 1), phi = 0.6 + (0.9 + 0.7 * open) * u + 0.3 * u * u;
        const rr = 0.09 + 0.42 * u * Math.sin(phi), y = -0.03 - 0.42 * u * Math.cos(phi) * 0.9;
        A.pts[k].set(Math.cos(A.ang) * rr, y, Math.sin(A.ang) * rr);
      }
      A.t.userData.update(A.pts, u => 0.026 * (1 - u) + 0.005);
    });
    const wp = webGeo.attributes.position;
    for (let i = 0; i < 8; i++) {
      const A = arms[i], B = arms[(i + 1) % 8], o = i * N * (M + 1);
      for (let k = 0; k < N; k++) for (let j = 0; j <= M; j++) {
        const v = j / M, kk = Math.min(N - 1, Math.round(k * (0.95 - 0.18 * Math.sin(Math.PI * v))));
        a.copy(A.pts[kk]); b.copy(B.pts[kk]); a.lerp(b, v);
        wp.setXYZ(o + k * (M + 1) + j, a.x * (1 - 0.05 * Math.sin(Math.PI * v)), a.y, a.z * (1 - 0.05 * Math.sin(Math.PI * v)));
      }
    }
    wp.needsUpdate = true; webGeo.computeVertexNormals();
    const cp = cirriGeo.attributes.position; let n = 0;
    arms.forEach(A => { for (let q = 0; q < 8; q++) { const k = 3 + q, p = A.pts[k], rr = Math.hypot(p.x, p.z) || 1; cp.setXYZ(n++, p.x, p.y, p.z); cp.setXYZ(n++, p.x - p.x / rr * 0.035, p.y - 0.02, p.z - p.z / rr * 0.035); } });
    cp.needsUpdate = true;
    const lp = lights.geometry.attributes.position;
    fins.forEach(({ side }, k) => lp.setXYZ(k, side * 0.14, 0.38, -0.03));
    arms.forEach((A, i) => { const q = A.pts[N - 1]; lp.setXYZ(2 + i, q.x, q.y, q.z); });
    spots.forEach((s, i) => lp.setXYZ(10 + i, s[0], s[1], s[2]));
    lp.needsUpdate = true;
    lights.material.opacity = 0.45 + 0.45 * Math.max(0, Math.sin(t * 1.1));
  }
  animate(0);
  return { group: g, animate };
}

// ---------- クロカムリクラゲ（Periphylla periphylla） ----------
// 設計は傘の高さ 1。透明なかぶと形の傘の中に暗い赤紫の胃。傘のくびれの溝、縁弁、12 本の太い触手
function buildHelmetJelly(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const deep = skin({ color: 0x5a0e1c, opacity: 0.88, rim: 0xff7a6a, rimAmount: 0.7, clearcoat: 0.9, roughness: 0.25 });
  const clear = skin({ color: 0xe0c4c4, opacity: 0.28, rim: 0xffffff, rimAmount: 0.7, clearcoat: 1, roughness: 0.15 });
  const prof = [[0, 1], [0.13, 0.98], [0.25, 0.88], [0.33, 0.72], [0.38, 0.6], [0.36, 0.55], [0.42, 0.4], [0.45, 0.2], [0.47, 0.05], [0.48, 0]].map(([r, y]) => new THREE.Vector2(r, y));
  const outerGeo = new THREE.LatheGeometry(prof, 56); const outer = new THREE.Mesh(outerGeo, clear); outer.renderOrder = 3; body.add(outer);
  outer.userData.base = outerGeo.attributes.position.array.slice();
  const stom = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.92], [0.16, 0.86], [0.24, 0.7], [0.27, 0.5], [0.26, 0.3], [0.2, 0.14], [0.1, 0.08]].map(([r, y]) => new THREE.Vector2(r, y)), 40), deep); stom.renderOrder = 1; body.add(stom);
  const groove = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.012, 8, 48), deep); groove.rotation.x = Math.PI / 2; groove.position.y = 0.56; body.add(groove);   // くびれの溝
  // 縁弁（傘の縁に並ぶ小さなひだ）
  const lappets = [];
  for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), deep); m.scale.set(0.05, 0.07, 0.018); lappets.push(m); body.add(m); }
  const tents = [];
  for (let i = 0; i < 12; i++) { const t = makeTube(14, 6, deep); body.add(t); tents.push({ t, ang: (i + 0.5) / 12 * Math.PI * 2, pts: Array.from({ length: 14 }, () => new THREE.Vector3()) }); }
  const glow = glowPoints(32, 0x6fb8ff, 2.5); body.add(glow);
  g.scale.setScalar(size);
  function animate(t) {
    const pulse = Math.max(0, Math.sin(t * 2 * Math.PI * 0.45)) ** 2;
    const p = outerGeo.attributes.position, base = outer.userData.base;
    for (let i = 0; i < p.count; i++) { const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2], k = 1 - 0.12 * pulse * (1 - y); p.setXYZ(i, x * k, y, z * k); }
    p.needsUpdate = true; outerGeo.computeVertexNormals();
    stom.scale.set(1 - 0.05 * pulse, 1, 1 - 0.05 * pulse);
    body.position.y = 0.04 * pulse;
    const rim = 0.48 * (1 - 0.12 * pulse);
    lappets.forEach((m, i) => { const a = i / 16 * Math.PI * 2; m.position.set(Math.cos(a) * rim, -0.02, Math.sin(a) * rim); m.rotation.y = -a + Math.PI / 2; m.rotation.x = 0.4 + 0.2 * pulse; });
    tents.forEach((T, i) => {
      for (let k = 0; k < 14; k++) {
        const u = k / 13, r = rim * 0.98 + 0.25 * u, sw = 0.05 * Math.sin(t * 1.1 + i - u * 3) * u;
        T.pts[k].set(Math.cos(T.ang) * r + sw, -0.04 + 0.32 * u - 0.22 * u * u, Math.sin(T.ang) * r + sw);
      }
      T.t.userData.update(T.pts, u => 0.026 * (1 - 0.75 * u));
    });
    // 生物発光: 傘の表面に散らばる青い光が、ときどき波のように明滅する
    const gp = glow.geometry.attributes.position;
    for (let i = 0; i < 32; i++) { const a = i * 2.39996, y = 0.15 + (i % 8) / 8 * 0.7, r = 0.45 * Math.sqrt(1 - y * y * 0.8); gp.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r); }
    gp.needsUpdate = true;
    glow.material.opacity = 0.15 + 0.75 * Math.max(0, Math.sin(t * 1.9)) ** 4;
  }
  animate(0);
  return { group: g, animate };
}

// ---------- チョウチンアンコウの仲間（Melanocetus 属のメス） ----------
// 設計は体長 1（頭 +z）。丸く黒いビロードのような体、体の半分近くある頭と大きな口、内側へ向いた細長い歯、
// 額から伸びる誘引突起（イリシウム）と、その先で光るエスカ。口は下あごを落として開く（ときどき自分で開く）
function buildAnglerfish(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const tex = canvasTex(256, 128, (x, W, H) => {
    x.fillStyle = '#16110e'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600; i++) { const c = 18 + Math.random() * 24 | 0; x.fillStyle = `rgba(${c + 6},${c},${c - 4},.6)`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }   // ビロードのようなざらつき
    for (let i = 0; i < 80; i++) { x.fillStyle = 'rgba(150,130,115,.35)'; x.beginPath(); x.arc(Math.random() * W, Math.random() * H, 1.2, 0, 7); x.fill(); }   // 側線の感覚器（小さな突起）
  });
  const black = skin({ color: 0xffffff, map: tex, rim: 0x5a4a44, rimAmount: 0.3, clearcoat: 0.25, roughness: 0.85, side: THREE.FrontSide });
  const inside = new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: 0.6, side: THREE.BackSide });   // 口の中も黒い（飲みこんだ獲物の光を隠すため）
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const nose = s => Math.pow(Math.sin(Math.min(1, s / 0.06) * Math.PI / 2), 0.5);
  const r = s => (s < 0.45 ? 0.32 * Math.pow(Math.sin(Math.min(1, (s + 0.1) / 0.55) * Math.PI / 2), 0.45) : 0.295 * Math.pow(Math.max(0, 1 - (s - 0.45) / 0.55), 1.25) + 0.025) * nose(s);
  const w = s => r(s) * 0.9, h = s => r(s);
  // 頭の下半分は平らにして、その下に下あごがはまる
  const shape = (s, th) => { const sn = Math.sin(th); return sn < 0 ? 1 - (1 - ss(0.3, 0.46, s)) * (-sn) * 0.85 : 1; };
  const hull = makeBody(40, 24, black); body.add(hull);
  // 下あご: 後ろの端（口角）を軸に回る、大きなさじ形。前へ少し突き出る
  const ZH = 0.08, ZC = 0.305, JL = 0.225, JW = 0.27, JD = 0.25;
  const jaw = new THREE.Group(); jaw.position.set(0, -0.02, ZH); body.add(jaw);
  const jawGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  [black, inside].forEach(m => { const j = new THREE.Mesh(jawGeo, m); j.scale.set(JW, JD, JL); j.position.z = ZC - ZH; jaw.add(j); });
  // 歯: 細長く、口の内側へ向く。前ほど長い。下あごの歯は口を閉じても前に見える
  const toothM = new THREE.MeshPhysicalMaterial({ color: 0xece6da, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.85 });
  const toothGeo = new THREE.ConeGeometry(0.0075, 1, 6); toothGeo.translate(0, 0.5, 0);
  const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const addTooth = (parent, x, y, z, dx, dy, dz, L) => { const m = new THREE.Mesh(toothGeo, toothM); m.position.set(x, y, z); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(UP, dir.set(dx, dy, dz).normalize()); parent.add(m); };
  for (let i = 0; i < 16; i++) {                                   // 上あご
    const f = (i / 15 - 0.5) * Math.PI * 0.85, sn = Math.sin(f), cs = Math.cos(f);
    addTooth(body, JW * 0.88 * sn, -0.025, ZC + JL * 0.8 * cs, -0.35 * sn, -1, -0.35 * cs, (0.04 + 0.05 * cs) * (0.7 + 0.3 * Math.random()));
  }
  for (let i = 0; i < 18; i++) {                                   // 下あご
    const f = (i / 17 - 0.5) * Math.PI * 0.85, sn = Math.sin(f), cs = Math.cos(f);
    addTooth(jaw, JW * 0.92 * sn, 0, ZC - ZH + JL * 0.92 * cs, -0.4 * sn, 1, -0.4 * cs, (0.05 + 0.065 * cs) * (0.7 + 0.3 * Math.random()));
  }
  // 誘引突起とエスカ（共生する発光バクテリアで光る。根元は黒く、先が明るい）
  const rod = makeTube(14, 5, black); body.add(rod);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), skin({ color: 0x3a2a26, rim: 0x8a6a60, rimAmount: 0.4, roughness: 0.5 })); body.add(bulb);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshBasicMaterial({ color: 0xcdeeff })); body.add(tip);
  const escaGlow = glowPoints(1, 0x9fdcff, 14); body.add(escaGlow);
  // 小さな目（頭の上寄り）
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x1a1c22, roughness: 0.1, clearcoat: 1 });
  [1, -1].forEach(side => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), eyeM); e.position.set(side * 0.168, 0.223, 0.33); body.add(e); });
  // ひれ: 胸びれ（小さなうちわ）、背びれ・しりびれ（尾の近く）、丸い尾びれ。どれも筋（軟条）が見える
  const finM = skin({ color: 0x2a2220, opacity: 0.75, rim: 0x6a5a54, rimAmount: 0.3, roughness: 0.6 });
  const pects = [1, -1].map(() => { const f = makeFan(8, finM), ry = makeRays(8, 0x6a5a50, 0.6); body.add(f, ry); return { f, ry }; });
  const dorsal = makeStrip(6, finM), anal = makeStrip(6, finM), tail = makeFan(11, finM);
  const dRays = makeRays(6, 0x6a5a50, 0.6), aRays = makeRays(6, 0x6a5a50, 0.6), tRays = makeRays(11, 0x6a5a50, 0.6);
  body.add(dorsal, anal, tail, dRays, aRays, tRays);
  g.scale.setScalar(size);
  const P = new THREE.Vector3();
  let mouth = 0, want = null, lastNow = null;
  function animate(t) {
    // 口: ふだんは 13 秒ごとに 3 秒ほど開ける。setMouth で開け閉めを指定すると、それに従う
    const now = performance.now() / 1000, dtR = lastNow == null ? 1 : Math.min(0.2, now - lastNow); lastNow = now;
    const c = ((t % 13) + 13) % 13, auto = ss(0, 0.5, c) * (1 - ss(2.2, 3, c));
    mouth += ((want == null ? auto : want) - mouth) * Math.min(1, dtR * 5);
    jaw.rotation.x = 0.95 * mouth;
    const center = (s, out) => out.set(0.02 * Math.pow(Math.max(0, s - 0.4), 2) * Math.sin(t * 3 - s * 4) * 3, 0, 0.5 - s);
    hull.userData.update(center, w, h, shape);
    // 誘引突起: 額から前上方へ弧を描き、ゆっくり揺れる
    const sw = Math.sin(t * 0.9) * 0.04, pts = [];
    for (let k = 0; k < 14; k++) { const u = k / 13; pts.push(new THREE.Vector3(sw * u, 0.22 + 0.2 * Math.sin(u * Math.PI * 0.55), 0.42 + 0.22 * u - 0.05 * u * u)); }
    rod.userData.update(pts, u => 0.011 * (1 - 0.55 * u));
    bulb.position.copy(pts[13]); tip.position.copy(pts[13]).add(P.set(0, 0.022, 0.012)); escaGlow.position.copy(tip.position);
    escaGlow.material.opacity = 0.55 + 0.45 * Math.sin(t * 1.7);
    // 胸びれ: 頭のすぐ後ろで小さくはためく
    pects.forEach(({ f, ry }, k) => {
      const side = k ? -1 : 1, fl = Math.sin(t * 4 + k * 1.3), base = new THREE.Vector3(side * w(0.5) * 0.95, -0.02, 0), tp = [];
      for (let q = 0; q < 8; q++) { const a = (q / 7 - 0.5) * 1.7; tp.push(new THREE.Vector3(side * (0.29 + 0.03 * fl), -0.02 + 0.09 * Math.sin(a), -0.11 * Math.cos(a * 0.8) - 0.02 * fl)); }
      f.userData.update(base, tp); ry.userData.update(base, tp);
    });
    // 背びれ・しりびれ: 尾の近くの上と下
    const db = [], dtp = [], ab = [], atp = [];
    for (let q = 0; q < 6; q++) {
      const s = 0.7 + q * 0.03; center(s, P); const wave = 0.015 * Math.sin(t * 3 - q);
      db.push(new THREE.Vector3(P.x, h(s) * 0.92, P.z)); dtp.push(new THREE.Vector3(P.x + wave, h(s) + 0.09 * Math.sin(Math.PI * (q + 0.5) / 6), P.z - 0.05));
      ab.push(new THREE.Vector3(P.x, -h(s) * 0.92, P.z)); atp.push(new THREE.Vector3(P.x + wave, -h(s) - 0.08 * Math.sin(Math.PI * (q + 0.5) / 6), P.z - 0.05));
    }
    dorsal.userData.update(db, dtp); dRays.userData.update(db, dtp); anal.userData.update(ab, atp); aRays.userData.update(ab, atp);
    // 尾びれ: 丸いうちわ形
    center(1, P); const tb = new THREE.Vector3(P.x, 0, P.z + 0.03), tt = [];
    for (let q = 0; q < 11; q++) { const a = (q / 10 - 0.5) * 2.0; tt.push(new THREE.Vector3(P.x + 0.04 * Math.sin(t * 3 - 1), Math.sin(a) * 0.15, P.z - 0.17 * Math.cos(a * 0.7))); }
    tail.userData.update(tb, tt); tRays.userData.update(tb, tt);
  }
  animate(0);
  return { group: g, animate, setMouth: v => { want = v; } };
}

// ---------- ナガヅエエソ（Bathypterois grallator） ----------
// 設計は体長 1（頭 +z）。細長い体と平たい頭、小さな目。長い腹びれ 2 本と尾びれの下の軟条で三脚のように立ち、
// 胸びれの長い軟条を触角のように前上方へ広げて、流れてくる獲物を感じ取る。group の原点は「足元（海底）」
function buildTripodFish(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  // 体の模様（u = 周方向: 0 = 右側面, 0.25 = 背中, 0.5 = 左側面, 0.75 = 腹）: 背中が濃い灰褐色、小さなうろこ、淡い側線
  const tex = canvasTex(256, 128, (x, W, H) => {
    const gr = x.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, '#6e665e'); gr.addColorStop(0.25, '#3c3630'); gr.addColorStop(0.5, '#6e665e'); gr.addColorStop(0.75, '#8c837a'); gr.addColorStop(1, '#6e665e');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(28,24,20,.3)'; x.lineWidth = 1;
    for (let i = -H; i < W + H; i += 7) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + H, H); x.stroke(); x.beginPath(); x.moveTo(i, H); x.lineTo(i + H, 0); x.stroke(); }   // うろこ
    x.strokeStyle = 'rgba(205,195,180,.45)'; x.lineWidth = 1.5;
    [W * 0.04, W * 0.46].forEach(px => { x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); });   // 側線
  });
  const skinM = skin({ color: 0xffffff, map: tex, rim: 0xa0948a, rimAmount: 0.25, clearcoat: 0.5, roughness: 0.45, side: THREE.FrontSide });
  const hull = makeBody(40, 18, skinM); body.add(hull);
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const r = s => (0.058 * Math.pow(Math.sin(Math.PI * Math.min(1, (s + 0.06) / 1.12)), 0.6) * (1 - 0.55 * ss(0.7, 1, s)) + 0.005) * Math.pow(Math.sin(Math.min(1, s / 0.05) * Math.PI / 2), 0.5);
  const w = s => r(s) * (1.35 - 0.4 * ss(0.05, 0.4, s)), h = s => r(s) * (0.8 + 0.4 * ss(0.05, 0.4, s));   // 頭は上下に平たく、尾は左右に平たい
  const shape = (s, th) => { const sn = Math.sin(th); return s < 0.3 && sn > 0 ? 1 - 0.25 * sn * sn * (1 - s / 0.3) : 1; };
  // 大きな口の線と小さな目
  const lip = makeTube(13, 4, new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.6 })); body.add(lip);
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.1, clearcoat: 1 });
  [1, -1].forEach(side => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), eyeM); e.position.set(side * 0.03, 0.02, 0.42); body.add(e); });
  // ひれ（黒っぽく半透明）と軟条
  const finM = skin({ color: 0x2e2824, opacity: 0.7, rim: 0xa0948a, rimAmount: 0.3, roughness: 0.6 });
  const dorsal = makeStrip(6, finM), anal = makeStrip(6, finM), tail = makeFan(11, finM);
  const dRays = makeRays(6, 0xb0a698, 0.5), aRays = makeRays(6, 0xb0a698, 0.5), tRays = makeRays(11, 0xb0a698, 0.5);
  body.add(dorsal, anal, tail, dRays, aRays, tRays);
  const pfins = [1, -1].map(() => { const f = makeFan(10, finM); body.add(f); return f; });
  // 胸びれの長い軟条（10 本ずつ、少し曲がった線）
  const NR = 10, SEG = 7;
  const feelers = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd8d0c4, transparent: true, opacity: 0.8 }));
  feelers.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * NR * SEG * 2 * 3), 3)); feelers.frustumCulled = false; body.add(feelers);
  // 三脚: 腹びれ 2 本と尾びれの下の軟条。先は少し太く、海底に置いた足のよう
  const stiltM = skin({ color: 0xcfc4b6, rim: 0xffffff, rimAmount: 0.25, roughness: 0.5 });
  const stilts = [0, 1, 2].map(() => { const t = makeTube(12, 4, stiltM); g.add(t); const pad = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), stiltM); pad.scale.set(1, 0.4, 1.6); g.add(pad); return { t, pad }; });
  const H = 0.9;                                                  // 立ったときの体の高さ（体長の何倍か）
  g.scale.setScalar(size);
  const P = new THREE.Vector3(), Q = new THREE.Vector3();
  const feet = [new THREE.Vector3(0.26, 0, 0.62), new THREE.Vector3(-0.26, 0, 0.62), new THREE.Vector3(0, 0, -0.95)];
  function animate(t) {
    const sway = 0.012 * Math.sin(t * 0.6);
    body.position.set(0, H, 0); body.rotation.x = -0.04 + sway; body.updateMatrix();
    const center = (s, out) => out.set(0.004 * Math.sin(t * 0.8 + s * 3), 0, 0.5 - s);
    hull.userData.update(center, w, h, shape);
    // 口の線: 吻の先から両側へ
    const lp = []; for (let k = 0; k < 13; k++) { const a = (k / 12 - 0.5) * 2, s = 0.012 + 0.15 * Math.abs(a); center(s, P); lp.push(new THREE.Vector3(P.x + Math.sign(a) * w(s) * 0.97 * Math.sin(Math.abs(a) * Math.PI / 2), -0.012, P.z)); }
    lip.userData.update(lp, () => 0.0035);
    // 胸びれの軟条: 頭の後ろの両わきから、前上方へ弧を描いて広がる
    const fp = feelers.geometry.attributes.position; let n = 0;
    [1, -1].forEach((side, k) => {
      center(0.18, P); const base = new THREE.Vector3(side * w(0.18) * 0.9, 0.02, P.z), tips = [];
      for (let q = 0; q < NR; q++) {
        const al = 0.22 + q * 0.07, L = 0.62 - q * 0.025, tw = 0.015 * Math.sin(t * 1.3 + q * 0.7 + side);
        const at = u => Q.set(base.x + side * Math.sin(al) * L * u, base.y + L * (0.3 * Math.sin(u * Math.PI / 2) - 0.07 * u * u) + tw * u * u, base.z + Math.cos(al) * L * u);
        for (let m = 0; m < SEG; m++) { at(m / SEG); fp.setXYZ(n++, Q.x, Q.y, Q.z); at((m + 1) / SEG); fp.setXYZ(n++, Q.x, Q.y, Q.z); }
        tips.push(at(0.13).clone());                               // 付け根の短い膜
      }
      pfins[k].userData.update(base, tips);
    });
    fp.needsUpdate = true;
    // 背びれ（体の中ほど）・しりびれ
    const db = [], dtp = [], ab = [], atp = [];
    for (let q = 0; q < 6; q++) {
      const sd = 0.36 + q * 0.028, sa = 0.62 + q * 0.025;
      center(sd, P); db.push(new THREE.Vector3(P.x, h(sd) * 0.9, P.z)); dtp.push(new THREE.Vector3(P.x, h(sd) + 0.1 * (1 - q / 7), P.z - 0.06));
      center(sa, P); ab.push(new THREE.Vector3(P.x, -h(sa) * 0.9, P.z)); atp.push(new THREE.Vector3(P.x, -h(sa) - 0.05 * Math.sin(Math.PI * (q + 0.5) / 6), P.z - 0.03));
    }
    dorsal.userData.update(db, dtp); dRays.userData.update(db, dtp); anal.userData.update(ab, atp); aRays.userData.update(ab, atp);
    // 尾びれ: 上の葉はふつう、下の葉の軟条が長く伸びて三本目の足になる
    center(1, P); const tb = new THREE.Vector3(P.x, 0, P.z + 0.02), tt = [];
    for (let q = 0; q < 11; q++) { const a = (q / 10 - 0.5) * 1.6, fork = 1 - 0.35 * Math.exp(-a * a * 12); tt.push(new THREE.Vector3(P.x, Math.sin(a) * 0.1, P.z - 0.13 * Math.cos(a) * fork)); }
    tail.userData.update(tb, tt); tRays.userData.update(tb, tt);
    // 三脚（group の座標で計算する。足先は海底に固定）
    center(0.33, P); const pb = h(0.33) * 0.9;
    const bases = [new THREE.Vector3(0.015, -pb, P.z), new THREE.Vector3(-0.015, -pb, P.z), tt[0].clone()].map(b => b.applyMatrix4(body.matrix));
    stilts.forEach(({ t: st, pad }, k) => {
      const pts = []; for (let q = 0; q < 12; q++) { const u = q / 11, p = bases[k].clone().lerp(feet[k], u); p.y += Math.sin(u * Math.PI) * 0.06; if (k < 2) p.x += Math.sin(u * Math.PI) * 0.04 * Math.sign(feet[k].x); pts.push(p); }
      st.userData.update(pts, u => 0.005 * (1 - 0.5 * u) + 0.0025 + 0.004 * ss(0.85, 1, u));
      pad.position.copy(feet[k]); pad.position.y = 0.003; pad.rotation.y = Math.atan2(feet[k].x - bases[k].x, feet[k].z - bases[k].z);
    });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- ナマコの仲間（板足目。超深海の海底で最も多い生き物のひとつ） ----------
// 設計は体長 1（口 +z）。半透明の淡い体の中に、泥の詰まった黒っぽい消化管が透けて見える。
// 背中の長い突起、腹側の管足、口の触手。group の原点は海底
function buildSeaCucumber(size) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const tex = canvasTex(128, 128, (x, W, H) => {
    x.fillStyle = '#d6b4c4'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(${170 + Math.random() * 50 | 0},${120 + Math.random() * 40 | 0},${150 + Math.random() * 40 | 0},.35)`; x.beginPath(); x.arc(Math.random() * W, Math.random() * H, Math.random() * 3 + 1, 0, 7); x.fill(); }
    for (let i = 0; i < 40; i++) { x.strokeStyle = 'rgba(255,240,248,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, Math.random() * H); x.lineTo(W, Math.random() * H); x.stroke(); }   // 体壁のすじ
  });
  const skinM = skin({ color: 0xffffff, map: tex, opacity: 0.62, rim: 0xffe8f4, rimAmount: 0.8, clearcoat: 0.9, roughness: 0.25, side: THREE.FrontSide });
  skinM.depthWrite = true;
  const hull = makeBody(30, 18, skinM); hull.renderOrder = 2; body.add(hull);
  const r = s => 0.12 * Math.pow(Math.sin(Math.PI * Math.min(1, (s + 0.03) / 1.03)), 0.5) + 0.01;
  // 消化管: 泥（食べた堆積物）が詰まって黒っぽく見える、くねった管
  const gut = makeTube(24, 6, new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9, transparent: true, opacity: 0.85, depthWrite: false }));
  gut.renderOrder = 1; body.add(gut);
  const limbM = skin({ color: 0xc89aae, opacity: 0.72, rim: 0xffd8e6, rimAmount: 0.3, clearcoat: 0.6, roughness: 0.35 });   // 体と同じ半透明の肌
  const papillae = [], feet = [], tentacles = [];
  for (let i = 0; i < 6; i++) { const t = makeTube(8, 5, limbM); body.add(t); papillae.push({ t, s: 0.12 + i * 0.13, side: i % 2 ? -1 : 1 }); }
  for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.017, 0.075, 7), limbM); body.add(m); feet.push({ m, s: 0.07 + (i >> 1) * 0.11, side: i % 2 ? -1 : 1 }); }
  for (let i = 0; i < 10; i++) { const t = makeTube(7, 4, limbM); body.add(t); tentacles.push({ t, ang: i / 10 * Math.PI * 2 }); }
  g.scale.setScalar(size);
  const P = new THREE.Vector3();
  function animate(t) {
    const center = (s, out) => out.set(0.01 * Math.sin(t * 0.4 + s * 2), 0.13 + 0.01 * Math.sin(t * 0.8 - s * 6), 0.5 - s);
    hull.userData.update(center, s => r(s) * (1 + 0.06 * Math.sin(t * 0.8 - s * 6)), s => r(s) * 0.8, (s, th) => Math.sin(th) < -0.4 ? 0.85 : 1);
    const gp = []; for (let k = 0; k < 24; k++) { const s = 0.06 + k / 23 * 0.88; center(s, P); gp.push(new THREE.Vector3(P.x + 0.035 * Math.sin(s * 14), P.y - 0.01 + 0.02 * Math.cos(s * 9), P.z)); }
    gut.userData.update(gp, u => 0.022 * (0.7 + 0.3 * Math.sin(u * 20)));
    papillae.forEach(p => { center(p.s, P); const pts = []; for (let k = 0; k < 8; k++) { const u = k / 7, sw = 0.03 * Math.sin(t * 0.9 + p.s * 10) * u; pts.push(new THREE.Vector3(P.x + p.side * (0.04 + 0.04 * u) + sw, P.y + r(p.s) * 0.7 + 0.2 * u, P.z - 0.05 * u)); } p.t.userData.update(pts, u => 0.022 * (1 - 0.75 * u)); });
    feet.forEach(f => { center(f.s, P); const step = Math.sin(t * 1.2 + f.s * 12 + f.side); f.m.position.set(P.x + f.side * 0.08, 0.04 + 0.01 * step, P.z + 0.01 * step); f.m.rotation.z = f.side * 0.3; });
    center(0, P);
    tentacles.forEach((T, i) => { const pts = []; for (let k = 0; k < 7; k++) { const u = k / 6, curl = 0.3 * Math.sin(t * 1.5 + i); pts.push(new THREE.Vector3(P.x + Math.cos(T.ang) * 0.05 * (1 + u), P.y + Math.sin(T.ang) * 0.04 * (1 + u) - 0.02 * u, P.z + 0.06 * u + curl * 0.02 * u)); } T.t.userData.update(pts, u => 0.01 * (1 - 0.5 * u)); });
  }
  animate(0);
  return { group: g, animate };
}

// ---------- クセノフィオフォア（巨大な単細胞生物） ----------
// 設計は差し渡し 1。泥の粒を固めた薄い板が何枚も折り重なった、もろい花のような塊。まったく動かない。group の原点は海底
function buildXenophyophore(size) {
  const g = new THREE.Group();
  const tex = canvasTex(256, 256, (x, W, H) => {
    x.fillStyle = '#95866e'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) { const c = 105 + Math.random() * 75 | 0; x.fillStyle = `rgba(${c},${c - 12},${c - 30},.55)`; x.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5); }   // 泥の粒
    for (let i = 0; i < 220; i++) { x.fillStyle = 'rgba(70,58,44,.5)'; x.beginPath(); x.arc(Math.random() * W, Math.random() * H, Math.random() * 2.5 + 0.8, 0, 7); x.fill(); }   // 小さな穴
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
  const seed = Math.random() * 10, v = new THREE.Vector3();
  // 中心の小さな塊
  const core = new THREE.IcosahedronGeometry(0.16, 3), cp = core.attributes.position;
  for (let i = 0; i < cp.count; i++) { v.fromBufferAttribute(cp, i); const k = 1 + 0.2 * Math.sin(v.x * 30 + seed) * Math.sin(v.y * 25); cp.setXYZ(i, v.x * k, v.y * k * 0.8, v.z * k); }
  core.computeVertexNormals();
  const coreM = new THREE.Mesh(core, mat); coreM.position.y = 0.14; g.add(coreM);
  // 折り重なった薄い板（縁が波打つ、ゆがんだ扇形）
  for (let i = 0; i < 14; i++) {
    const geo = new THREE.CircleGeometry(0.2 + Math.random() * 0.12, 24, 0, Math.PI * (0.8 + Math.random() * 0.5));
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k); const rr = Math.hypot(v.x, v.y);
      p.setXYZ(k, v.x, v.y, 0.05 * Math.sin(Math.atan2(v.y, v.x) * 7 + seed + i) * rr / 0.25 + 0.06 * rr * rr / 0.06);   // 縁ほど波打って反る
    }
    geo.computeVertexNormals();
    const plate = new THREE.Mesh(geo, mat);
    const a = i / 14 * Math.PI * 2 + seed + Math.random() * 0.3;
    plate.position.set(Math.cos(a) * 0.06, 0.08 + Math.random() * 0.16, Math.sin(a) * 0.06);
    plate.rotation.set(-Math.PI / 2 + 0.6 + Math.random() * 0.7, a, Math.random() * 0.6);
    g.add(plate);
  }
  g.scale.setScalar(size);
  return { group: g, animate() {} };
}

window.SPECIES = Object.assign(window.SPECIES || {}, {
  dumbo: buildDumbo, snailfish: buildSnailfish, amphipod: buildAmphipod,
  turtle: buildTurtle, lanternfish: buildLanternfishSchool, giantsquid: buildGiantSquid, spermwhale: buildSpermWhale,
  vampire: buildVampireSquid, helmetjelly: buildHelmetJelly, anglerfish: buildAnglerfish, tripodfish: buildTripodFish,
  seacucumber: buildSeaCucumber, xenophyophore: buildXenophyophore
});
})();
