// 生き物の形と動き（three.js のみに依存）。海のページ（creatures.js）と確認用ページで共通。
// 各関数は size（m）を受け取り、{ group, animate(t, speed) } を返す。group の原点が体の中心、+z が前、+y が上。
(() => {

// ---------- 共通: 濡れた半透明の皮膚 ----------
// 縁ほど明るく見える（ゼラチン質の体を光が透ける感じ）効果を、標準の材質に足す
function skin({ color, map = null, opacity = 1, vertexColors = false, rim = 0x7a3a34, rimAmount = 0.9, clearcoat = 0.7, roughness = 0.42 }) {
  const m = new THREE.MeshPhysicalMaterial({
    color, map, vertexColors, roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.25,
    side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1
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

window.SPECIES = Object.assign(window.SPECIES || {}, { dumbo: buildDumbo });
})();
