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

window.SPECIES = Object.assign(window.SPECIES || {}, { dumbo: buildDumbo, snailfish: buildSnailfish });
})();
