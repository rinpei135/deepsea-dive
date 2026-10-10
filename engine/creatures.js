// 3D で泳ぐ生き物。地形の世界（1単位 = 1km、深さは強調あり）とは別に、カメラの周りを
// メートル単位の「近景」として重ねて描く。
// 生き物は海の中の決まった場所に住む: 海を 1 辺 CELL m の区画に分け、区画ごとに「どの生き物が、どこに何匹いるか」を
// 区画の番号から決まる乱数で決める。同じ場所に戻れば同じ個体に会える。体（3D モデル）は近くの個体にだけ割り当てる。
//
// config.js の creatures の項目:
//   kind      形と動きの種類（engine/species.js）   name / sci / note  表示名・学名・説明
//   from / to 住む深さ (m)                           density   1 区画あたりの平均の数（水中: 100m 立方、海底: 100m 四方）
//   size      大きさ (m)                             status    'preview' なら公開前（通常は表示しない）
//   habitat   'mid'（水中・既定） / 'nearFloor'（海底の少し上を泳ぐ） / 'onFloor'（海底にいる）
//   speed     泳ぐ速さ (m/秒)。0 なら動かない          rare      true ならめったに出会えない（図鑑のヒントに使う）
//   view      見つけやすさの大きさ (m)。群れや発光で体より目立つ生き物に（省略時は size）
//   glow      true なら自分で光る（ライトを消していても見つけられる）
//   behavior  動き方: 'migrate'（pods の場所を回遊し、深く潜っては浮上する）/ 'school'（群れ。近づくと散る）/
//             'bait'（潜水艇が止まっていると寄ってくる）/ 'crawl'（海底を這い、跡を残す）/ 'hunt'（近くのヨコエビを追って食べる）。
//             省略時は住みかの近くを泳ぐ
//   roam      住みかから離れてよい距離 (m)。大きいほど、大きな弧を描いて遠くまで泳ぐ（省略時は体の大きさで決まる。外洋の群れなどに）
//   agility   向きの変えやすさ（1 が既定。小さいほど、ゆるやかに曲がる）
(() => {
const T = window.__TRENCH, S = window.__DIVE, SEA = window.SEA, UI = window.__UI;
const { renderer, camera } = T;
const $ = id => document.getElementById(id);

// ---------- 公開前の生き物とプレビュー表示 ----------
// URL に ?preview=on を付けて開くと有効になり（ブラウザが覚える）、?preview=off で元に戻る。
const PREVIEW = (() => {
  const q = new URLSearchParams(location.search).get('preview');
  try {
    if (q === 'on') localStorage.setItem('deepsea-preview', '1');
    if (q === 'off') localStorage.removeItem('deepsea-preview');
    return localStorage.getItem('deepsea-preview') === '1';
  } catch (_) { return q === 'on'; }
})();
const ALL = ((SEA && SEA.creatures) || []).filter(d => d.status !== 'preview' || PREVIEW);
// プレビュー中に「生き物の表示」で隠した種類（このブラウザだけの設定）
const OFF_KEY = 'deepsea-creatures-off';
let off = new Set();
try { off = new Set(JSON.parse(localStorage.getItem(OFF_KEY) || '[]')); } catch (_) {}
const enabled = def => !off.has(def.kind);
const habitat = def => def.habitat || (def.nearFloor ? 'nearFloor' : 'mid');
const sizeOf = def => def.size || 0.3;

// ---------- 近景の世界 ----------
// 水は赤い光ほどよく吸う（1m あたり 赤 0.06・緑 0.02・青 0.012 として、ライトから物まで行って戻る道のりで減らす）。
// 遠くの生き物ほど赤みが消えて青緑がかる。霧の濃さが 0 の地形の世界には効かない
const ABSORB = 'vec3(0.06, 0.02, 0.012)';
// 浅瀬（美しさ優先）は、この吸収を弱める（離れた魚やサンゴの赤・黄も残る）。弱め方 uAbsK は全部の材質で 1 つの値を共有する
// （Vector3 でない普通の物にすると、材質ごとに複製されず、同じ物を読む）。uAbsK を持たない材質は 0（吸収なし）になる
const ABS_K = { x: 1, y: 1, z: 1 };
['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap', 'points', 'sprite'].forEach(k => { const L = THREE.ShaderLib[k]; if (L && L.uniforms.fogDensity) L.uniforms.uAbsK = { value: ABS_K }; });
THREE.ShaderChunk.fog_pars_fragment += '\n#ifdef USE_FOG\n  uniform vec3 uAbsK;\n#endif\n';
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
    if (fogDensity > 0.001) gl_FragColor.rgb *= exp(-${ABSORB} * uAbsK * fogDepth * 2.0);
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.05);
const cam = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.02, 400);
const ambient = new THREE.AmbientLight(0x1a2a36, 0.35); scene.add(ambient);
// 浅い海では、上から差し込む太陽の光で見える
const sun = new THREE.DirectionalLight(0xbfe6f0, 0); sun.position.set(0.3, 1, 0.2); scene.add(sun); scene.add(sun.target);
// ---------- 浅い海の影（画質「高」だけ）と光の筋（画質「中」以上） ----------
// 日の光（海面で屈折して、真下寄りに曲がった向き）から見た影の地図を作り、サンゴ・岩・魚の影を海底に落とす。
// 光の筋も、この地図を読んで、サンゴや魚の下で途切れる
const SHADOW_ON = S && S.quality === 'high', SHAFTS_ON = S && S.quality !== 'low';
renderer.shadowMap.enabled = SHADOW_ON; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const REFR_SUN = (() => { const s0 = (window.__SEA && window.__SEA.SUN) || new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(-s0.x / 1.333, 0, -s0.z / 1.333); v.y = -Math.sqrt(1 - v.x * v.x - v.z * v.z); return v; })();   // 光の進む向き（下向き）
if (SHADOW_ON) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera; c.left = -32; c.right = 32; c.top = 32; c.bottom = -32; c.near = 1; c.far = 160; c.updateProjectionMatrix();
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
}
// 光の筋: 潜水艇のまわり 50m 四方に、海面から海底まで斜めに差し込む細い板を並べる（潜水艇が動いても、その場に止まって見えるように、50m ごとに折り返す）
const SHAFT_N = 70, SHAFT_BOX = 50;
const shaftGeo = new THREE.BufferGeometry();
{
  const base = [], side = [], tt = [], rnd = [], idx = [];
  for (let i = 0; i < SHAFT_N; i++) {
    const bx = Math.random(), bz = Math.random(), r = Math.random();
    for (let j = 0; j < 4; j++) { base.push(bx, 0, bz); side.push(j % 2 ? 1 : -1); tt.push(j < 2 ? 0 : 1); rnd.push(r); }
    const b = i * 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  shaftGeo.setAttribute('position', new THREE.Float32BufferAttribute(base, 3)); shaftGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  shaftGeo.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1)); shaftGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(rnd, 1)); shaftGeo.setIndex(idx);
}
const shaftMat = new THREE.ShaderMaterial({
  uniforms: { uOff: { value: new THREE.Vector2() }, uTop: { value: 0 }, uLen: { value: 10 }, uDir: { value: REFR_SUN }, uI: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color() },
    uShadowMap: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uFogDen: { value: 0.03 } },
  vertexShader: `attribute float aSide, aT, aRnd; uniform vec2 uOff; uniform float uTop, uLen; uniform vec3 uDir; varying float vT, vS, vR; varying vec3 vW;
    void main(){ vT = aT; vS = aSide; vR = aRnd;
      vec2 c = mod(position.xz * ${SHAFT_BOX}.0 - uOff + ${SHAFT_BOX / 2}.0, ${SHAFT_BOX}.0) - ${SHAFT_BOX / 2}.0;   // 潜水艇のまわりに折り返す（m）
      vec3 top = vec3(c.x, uTop, c.y);                                     // 海面の点
      vec3 p = top + uDir * aT * uLen * (0.85 + aRnd * 0.3);
      vec3 right = normalize(cross(uDir, -p));
      p += right * aSide * (0.3 + aRnd * 1.4);
      vW = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `#include <packing>
    uniform float uI, uTime, uShadowOn, uFogDen; uniform vec3 uCol; uniform sampler2D uShadowMap; uniform mat4 uShadowMat; varying float vT, vS, vR; varying vec3 vW;
    void main(){
      float a = pow(1.0 - abs(vS), 1.5) * smoothstep(0.0, 0.08, vT) * pow(1.0 - vT, 0.7) * uI;
      a *= 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (0.35 + vR * 0.5) + vR * 40.0), 2.0);   // 波で、明るさがゆっくり揺らぐ
      if (uShadowOn > 0.5) {                                                   // サンゴや魚の影の中では、光の筋が途切れる
        vec4 sc = uShadowMat * vec4(vW, 1.0); sc.xyz /= sc.w;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) a *= step(sc.z - 0.004, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy)));
      }
      a *= exp(-length(vW) * uFogDen);
      gl_FragColor = vec4(uCol * a, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
});
const shafts = new THREE.Mesh(shaftGeo, shaftMat); shafts.frustumCulled = false; shafts.visible = false; shafts.renderOrder = 5; scene.add(shafts);
let shadowWas = true;                                                  // 最初の 1 回は、影の地図を必ず作る（作らないと、全部が影の中になる）
function updateShafts(t, px, pz, depth, floorHere, lampOn) {
  const on = SHAFTS_ON && !above && depth > 0.5 && floorHere < 40;
  shafts.visible = on;
  // 影の有無で材質のシェーダーが変わらないように、日の光はいつも影を落とす設定のまま（切り替えると全部の材質が作り直しになり、画面が止まる）。
  // 影がいらない間は、影を写す範囲を遠くへ離して一度だけ描き（何も写らない＝影なし）、あとは描き直さない
  if (SHADOW_ON) {
    renderer.shadowMap.autoUpdate = on;
    if (!on && shadowWas) {
      sun.target.position.set(0, 1e6, 0); sun.position.copy(sun.target.position).addScaledVector(REFR_SUN, -80); sun.target.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
    }
    shadowWas = on;
  }
  if (window.__SEA && window.__SEA.setRayScale) window.__SEA.setRayScale(on ? 0.35 : 1);
  if (!on) return;
  // 影の地図は、潜水艇の少し前の海底のまわり（64m 四方）
  camera.getWorldDirection(fwd);
  const fy = depth - floorHere, tx = fwd.x * 18, tz = fwd.z * 18;
  sun.target.position.set(tx, fy, tz); sun.position.set(tx - REFR_SUN.x * 80, fy - REFR_SUN.y * 80, tz - REFR_SUN.z * 80);
  sun.target.updateMatrixWorld();
  const u = shaftMat.uniforms;
  u.uOff.value.set(((px % SHAFT_BOX) + SHAFT_BOX) % SHAFT_BOX, ((pz % SHAFT_BOX) + SHAFT_BOX) % SHAFT_BOX);
  u.uTop.value = depth; u.uLen.value = floorHere / -REFR_SUN.y; u.uTime.value = t;
  u.uI.value = (0.22 + 0.3 * T.beautyK(depth)) * Math.exp(-depth / 30) * sun.intensity / 1.6;   // 浅瀬は、はっきりした光の帯に
  u.uCol.value.copy(sun.color).lerp(new THREE.Color(0.75, 0.95, 1.0), 0.5);
  u.uShadowMap.value = sun.shadow.map ? sun.shadow.map.texture : null; u.uShadowOn.value = sun.shadow.map ? 1 : 0;
  u.uShadowMat.value.copy(sun.shadow.matrix); u.uFogDen.value = scene.fog.density;
}
// ---------- 光の粒（浅瀬）: 日の光の中を漂う小さな粒が、ときどき、きらっと光る ----------
// 潜水艇のまわり 22m の箱に置き、その場に止まって見えるように折り返す（動かすのはシェーダー）
const SPK_N = 900, SPK_BOX = 22;
const spkGeo = new THREE.BufferGeometry();
spkGeo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from({ length: SPK_N * 3 }, () => Math.random()), 3));
spkGeo.setAttribute('aRnd', new THREE.Float32BufferAttribute(Float32Array.from({ length: SPK_N }, () => Math.random()), 1));
const spkMat = new THREE.ShaderMaterial({
  uniforms: { uOff: { value: new THREE.Vector3() }, uTime: { value: 0 }, uI: { value: 0 }, uCol: { value: new THREE.Color() }, uScale: { value: 600 }, uFogDen: { value: 0.03 }, uDepth: { value: 0 } },
  vertexShader: `attribute float aRnd; uniform vec3 uOff; uniform float uTime, uScale, uDepth; varying float vA, vD;
    void main(){
      vec3 p = mod(position * ${SPK_BOX}.0 - uOff + vec3(0.0, uTime * 0.03 * (aRnd - 0.5), 0.0), ${SPK_BOX}.0) - ${SPK_BOX / 2}.0;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      vA = pow(max(0.0, sin(uTime * (0.5 + aRnd * 1.3) + aRnd * 60.0)), 14.0) * step(p.y, uDepth - 0.2);   // ときどき光る（海面より上には出さない）
      vD = length(p);
      gl_PointSize = clamp(uScale * (0.01 + 0.012 * aRnd) / max(-mv.z, 0.1), 1.0, 6.0);
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uI, uFogDen; uniform vec3 uCol; varying float vA, vD;
    void main(){
      float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
      a *= (0.08 + 0.92 * vA) * uI * exp(-vD * uFogDen) * (1.0 - smoothstep(${(SPK_BOX * 0.32).toFixed(1)}, ${(SPK_BOX * 0.5).toFixed(1)}, vD));
      gl_FragColor = vec4(uCol * a, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
});
const sparkles = new THREE.Points(spkGeo, spkMat); sparkles.frustumCulled = false; sparkles.visible = false; sparkles.renderOrder = 6; scene.add(sparkles);
const spkSize = new THREE.Vector2();
function updateSparkles(t, px, pz, depth) {
  const k = T.beautyK(depth) * Math.min(1, depth / 1.5);
  sparkles.visible = !above && k > 0.01; if (!sparkles.visible) return;
  const u = spkMat.uniforms, m = v => ((v % SPK_BOX) + SPK_BOX) % SPK_BOX;
  u.uOff.value.set(m(px), m(-depth), m(pz)); u.uTime.value = t; u.uDepth.value = depth;
  u.uI.value = 2.2 * k * sun.intensity / 1.6; u.uCol.value.copy(sun.color).lerp(new THREE.Color(1, 1, 0.95), 0.6); u.uFogDen.value = scene.fog.density;
  u.uScale.value = renderer.getDrawingBufferSize(spkSize).y / (2 * Math.tan(camera.fov * Math.PI / 360));
}
// 潜水艇のライト（前方を照らすスポットライト）。点けたり消したりすると全部の材質の作り直しが起きて止まるので、
// いつも置いておき、明るさだけを変える
// 本物の潜水艇のように、ライトは窓（カメラ）から左右に離して付ける。カメラのすぐ横に光源がないので、
// 目の前の粒が白く光って視界がつぶれる（後方散乱）ことが減り、少し斜めから照らされて立体感が出る
const LAMP_RANGE = 35;
const LAMP_AT = [new THREE.Vector3(-0.8, 0.45, 0), new THREE.Vector3(0.8, 0.45, 0)];  // カメラから見た取り付け位置 (m)
const lamps = LAMP_AT.map(() => {
  const l = new THREE.SpotLight(0xe8f4ff, 0, LAMP_RANGE, 0.55, 0.5, 1.6);
  scene.add(l); scene.add(l.target); return l;
});
const fill = new THREE.PointLight(0xcfe8ff, 0, 8, 2); scene.add(fill);
// 光の筋: 水の中の細かい粒に光が当たって、ライトの円すいがうっすら見える
const BEAM_LEN = 14;
const beamGeo = new THREE.ConeGeometry(BEAM_LEN * Math.tan(0.42), BEAM_LEN, 32, 1, true).rotateX(-Math.PI / 2).translate(0, 0, BEAM_LEN / 2);
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uI: { value: 0 }, uColor: { value: new THREE.Color(0xd8ecff) }, uFogDen: { value: 0.05 } },
  vertexShader: `
    varying float vT; varying float vEdge; varying float vD;
    void main(){
      vT = position.z / ${BEAM_LEN.toFixed(1)};
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vEdge = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
      vD = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uI, uFogDen; uniform vec3 uColor; varying float vT; varying float vEdge; varying float vD;
    void main(){
      float a = uI * pow(clamp(1.0 - vT, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.06, vT) * pow(clamp(vEdge, 0.0, 1.0), 1.2) * exp(-uFogDen * vD);   // pow に負の数を渡すと値が壊れ、光のにじみで白い輪になる   // 円すいの中心ほど光の中を長く通るので明るく、縁は消える
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
});
const beams = LAMP_AT.map(() => { const m = new THREE.Mesh(beamGeo, beamMat); m.frustumCulled = false; m.visible = false; scene.add(m); return m; });
// 底層流: 深海の底近くの水は、1 秒に数 cm でゆっくり流れている。マリンスノーと泥はこれに流される
const current = new THREE.Vector3(), drift = new THREE.Vector2();

// ---------- 浅い所の光の網目（コースティクス） ----------
// 波打つ海面がレンズになって日の光を集め、海底や生き物の体に明るい網目が揺れる。深いほど網目は大きくぼやけ、20m ほどで消える。
// 網目は、毎フレーム 1 回、潜水艇のまわり 96m 四方の画像（1 画素 約 9cm）に描いておき、光を受ける材質（標準・物理）は、その画像を読んで
// 上向きの面ほど網目の光を足す（以前は材質ごとに網目・波・雲を計算していて、描くのも、シェーダーを作るのも重かった）。
// 画像の色: r = 鋭い網目（浅い所）、g = ぼやけた網目（深い所）、b・a = 波が集める光の帯（水深 4m・12m）
const CAU_N = S && S.quality === 'low' ? 512 : 1024, CAU_L = 96;
const cauRT = new THREE.WebGLRenderTarget(CAU_N, CAU_N, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
const CAU = { uCauTex: { value: cauRT.texture }, uCauO: { value: new THREE.Vector2() }, uCauP: { value: new THREE.Vector3() }, uCauI: { value: 0 }, uCauC: { value: new THREE.Color() }, uCauB: { value: 0 }, uCauCS: { value: 1 } };   // uCauB: 浅瀬の美しさ優先の度合い、uCauCS: 雲の影
const SEA_GLSL = (window.__SEA && window.__SEA.SHARED_GLSL) || 'float cloudShade(vec2 xz, float t){ return 1.0; } float waveFocus(vec2 p, float t, float d){ return 1.0; }';
const cauMat = new THREE.ShaderMaterial({
  uniforms: { uC: { value: new THREE.Vector2() }, uCm: { value: new THREE.Vector2() }, uT: { value: 0 } },   // uC: 画像の中心（世界の m）、uCm: その 2,000m の折り返し（地形の網目と同じ並び）
  vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform vec2 uC, uCm; uniform float uT; varying vec2 vUv;
    ${SEA_GLSL}
    // 網目の細かさは場所によらず一定にする（深さで細かさを変えると、深さの違う所や上下に動いたときに模様が大きく滑るため）。
    // 深い所では網目の線を太く・ぼんやりさせる（sharp: 線の鋭さ）
    float cauL(vec2 p, float t, float sharp){
      p += 0.55 * vec2(sin(p.y * 1.3 + t * 0.8), sin(p.x * 1.1 - t * 0.7));
      p += 0.3 * vec2(sin(p.y * 2.6 - t * 1.1), sin(p.x * 2.9 + t * 0.9));
      return pow(max(1.0 - abs(sin(p.x * 2.0) * sin(p.y * 2.0)), 0.0), sharp);   // 丸めの誤差でわずかに負になると、pow が壊れた値（NaN）を返す
    }
    float caustic(vec2 p, float t, float sharp){ return cauL(p, t, sharp) * 0.7 + cauL(mat2(0.8, -0.6, 0.6, 0.8) * p * 1.37 + 3.1, t * 1.2, sharp) * 0.6; }
    void main(){
      vec2 o = (vUv - 0.5) * ${CAU_L}.0, cq = (uCm + o) * 0.85, cw = uC + o;
      gl_FragColor = vec4(caustic(cq, uT, 7.0) * 0.5, caustic(cq, uT, 2.5) * 0.5, waveFocus(cw, uT, 4.0) / 2.5, waveFocus(cw, uT, 12.0) / 2.5);
    }`,
  depthTest: false, depthWrite: false
});
const cauScene = new THREE.Scene(), cauCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
{ const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); const q = new THREE.Mesh(g, cauMat); q.frustumCulled = false; cauScene.add(q); }
function updateCaustics(t, px, pz, depth) {
  const tx = CAU_L / CAU_N, cx = Math.round(px / tx) * tx, cz = Math.round(pz / tx) * tx;   // 画像の中心は画素の格子にそろえる（動いても網目がちらつかないように）
  const u = cauMat.uniforms; u.uC.value.set(cx, cz); u.uCm.value.set(((cx % 2000) + 2000) % 2000, ((cz % 2000) + 2000) % 2000); u.uT.value = t;
  CAU.uCauO.value.set(px - cx, pz - cz);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(cauRT); renderer.render(cauScene, cauCam); renderer.setRenderTarget(prev);
}
const CAU_GLSL = `
  uniform sampler2D uCauTex; uniform vec2 uCauO; uniform vec3 uCauP, uCauC; uniform float uCauI, uCauB, uCauCS;   // uCauO: 画像の中心からカメラまで (m)
`;
function withCaustics(obj) {
  obj.traverse(o => [].concat(o.material || []).forEach(m => {
    if (!(m.isMeshStandardMaterial) || m.userData.cau) return;
    m.userData.cau = true;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return;
      Object.assign(sh.uniforms, CAU);
      sh.fragmentShader = CAU_GLSL + sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (uCauI > 0.001) {
          mat3 cR = mat3(viewMatrix); vec3 cv = geometry.position - viewMatrix[3].xyz;
          vec3 cl = vec3(dot(cR[0], cv), dot(cR[1], cv), dot(cR[2], cv));   // カメラから見た位置（世界の向き、m）
          vec3 cwn = vec3(dot(cR[0], geometry.normal), dot(cR[1], geometry.normal), dot(cR[2], geometry.normal));
          float cd = max(-(cl.y + uCauP.y), 0.0);                           // その場所の深さ (m)
          vec2 cuv = (cl.xz + uCauO) / ${CAU_L}.0 + 0.5;
          float cfar = 1.0 - smoothstep(0.4, 0.5, max(abs(cuv.x - 0.5), abs(cuv.y - 0.5)));   // 画像の外（48m より先）は、平均の明るさに
          vec4 ct = texture2D(uCauTex, cuv);
          float cbl = smoothstep(2.0, 25.0, cd), ck0 = mix(ct.r, ct.g, cbl) * 2.0;
          vec3 ck = vec3(ck0);
          if (uCauB > 0.01 && cd < 18.0) {                                  // 浅瀬: 網目の縁に、少し虹色のにじみ（光の色ごとに曲がり方が違う）
            vec2 co = vec2(0.06, 0.035) / ${CAU_L}.0;
            vec3 cc3 = vec3(mix(texture2D(uCauTex, cuv + co).r, texture2D(uCauTex, cuv + co).g, cbl) * 2.0, ck0, mix(texture2D(uCauTex, cuv - co).r, texture2D(uCauTex, cuv - co).g, cbl) * 2.0);
            ck = mix(ck, cc3, 0.7 * uCauB * (1.0 - smoothstep(10.0, 18.0, cd)));
          }
          ck = mix(vec3(mix(0.2, 0.4, cbl)), ck, cfar);
          ck *= max(cwn.y, 0.0) * exp(-cd / mix(11.0, 15.0, uCauB));         // 深いほどぼやけて弱い（浅瀬は深くまで届く）
          float cwf = mix(mix(ct.b, ct.a, clamp((cd - 4.0) / 8.0, 0.0, 1.0)) * 2.5, 1.0, 1.0 - cfar);
          ck *= mix(1.0, cwf, exp(-cd / 18.0)) * mix(1.0, uCauCS, 1.0 - 0.65 * uCauB);   // 波が集める光の帯と、雲の影（浅瀬は弱める）
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            { DirectionalLightShadow dls = directionalLightShadows[0];   // サンゴや魚の影の中には、光の網目も届かない（影を落とすのは日の光だけ）
              ck *= getShadow(directionalShadowMap[0], dls.shadowMapSize, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[0]); }
          #endif
          reflectedLight.directDiffuse += material.diffuseColor * uCauC * ck * uCauI;
        }`);
    };
    const prevKey = m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
    m.customProgramCacheKey = () => (prevKey ? prevKey() : prev.toString()) + '|caustic';
    m.needsUpdate = true;
  }));
  return obj;
}

// ---------- 近景の海底: プレイヤーの近くだけ、本当の縮尺の海底面を描く（海底の生き物を間近で見られるように） ----------
const BED_R = 90, BED_N = 60, BED_STEP = BED_R * 2 / BED_N, BED_TILE = 12;
const bedTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#857b6c'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 95 + Math.random() * 70 | 0; x.fillStyle = `rgba(${v + 8},${v},${v - 12},.35)`; x.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }   // 泥の粒
  for (let i = 0; i < 70; i++) { x.fillStyle = 'rgba(60,52,44,.35)'; x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2.5, 0, 7); x.fill(); }   // 生き物の巣穴
  for (let i = 0; i < 6; i++) {                                      // 生き物がはった跡
    x.strokeStyle = 'rgba(70,62,52,.3)'; x.lineWidth = 2; x.beginPath();
    let px = Math.random() * 256, py = Math.random() * 256; x.moveTo(px, py);
    for (let k = 0; k < 12; k++) { px += (Math.random() - 0.5) * 30; py += (Math.random() - 0.5) * 30; x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();
const bedGeo = new THREE.PlaneGeometry(BED_R * 2, BED_R * 2, BED_N, BED_N); bedGeo.rotateX(-Math.PI / 2);
// 岩場の模様（玄武岩のような暗い岩と割れ目）。斜面が急な所ほど、泥の代わりにこの岩が出る
const rockTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#4a4744'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) { const v = 45 + Math.random() * 45 | 0; x.fillStyle = `rgba(${v},${v - 2},${v - 5},.45)`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  for (let i = 0; i < 40; i++) {                                     // 割れ目
    x.strokeStyle = 'rgba(15,14,13,.4)'; x.lineWidth = 0.6 + Math.random() * 0.8; x.beginPath();
    let px = Math.random() * 256, py = Math.random() * 256; x.moveTo(px, py);
    for (let k = 0; k < 8; k++) { px += (Math.random() - 0.5) * 22; py += (Math.random() - 0.5) * 22; x.lineTo(px, py); }
    x.stroke();
  }
  for (let i = 0; i < 60; i++) { x.fillStyle = 'rgba(150,140,125,.12)'; x.beginPath(); x.ellipse(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1.5 + Math.random() * 3, Math.random() * 3, 0, 7); x.fill(); }   // 岩のくぼみにたまった泥
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();
bedGeo.setAttribute('rock', new THREE.BufferAttribute(new Float32Array(bedGeo.attributes.position.count), 1));
const bedMat = new THREE.MeshStandardMaterial({ map: bedTex, roughness: 1, metalness: 0 });
bedMat.onBeforeCompile = sh => {
  sh.uniforms.rockMap = { value: rockTex };
  sh.vertexShader = 'attribute float rock; varying float vRock;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n vRock = rock;');
  sh.uniforms.uShallow = SHALLOW; sh.uniforms.uEdge = BED_EDGE;
  sh.uniforms.uFade = FADE;
  sh.vertexShader = 'varying vec2 vBP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBP = (modelMatrix * vec4(position, 1.0)).xz;');
  // 海面の上から見ているときは、潜水艇のまわりの円の外へ向かってなめらかに透明にする（外の地形との明るさの違いが、境目に見えないように）
  sh.fragmentShader = 'uniform float uEdge; uniform vec2 uFade; varying vec2 vBP;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
    `#include <dithering_fragment>
    gl_FragColor.a *= mix(1.0, 1.0 - smoothstep(uFade.x, uFade.y, length(vBP)), uEdge);`);
  sh.vertexShader = 'varying float vBD;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBD = -position.y;');
  sh.uniforms.uBeau = BEAU;
  sh.fragmentShader = 'uniform sampler2D rockMap; uniform float uShallow, uBeau; varying float vRock; varying float vBD;\n' + T.REEF_GLSL + '\n' + sh.fragmentShader.replace('#include <map_fragment>',
    `#include <map_fragment>
    // 浅い海: 白いサンゴ砂。うねりでできた砂紋（波長 約 0.8m、東からのうねりに直角な南北の縞）と、ところどころの砂のまだら
    vec2 wp = vUv * ${BED_TILE.toFixed(1)};
    float ph = wp.x * 7.8 + sin(wp.y * 0.9) * 1.5 + sin(wp.y * 0.23 + wp.x * 0.1) * 3.0;
    float rip = 0.5 + 0.5 * sin(ph), ripSide = cos(ph);                // 砂紋の山の、日の当たる側と陰の側
    vec3 sand = mix(vec3(0.93, 0.89, 0.78), vec3(0.98, 0.95, 0.87), uBeau) * (0.8 + 0.12 * rip + 0.16 * ripSide * smoothstep(0.0, 0.3, uShallow)) * (0.92 + 0.08 * texture2D(map, vUv * 3.0).r);
    diffuseColor.rgb = mix(diffuseColor.rgb, sand, uShallow);
    // 礁のまだら（地形と同じ模様）: サンゴの集まる岩場は、藻に覆われたがれきの色。サンゴはこの上に置く
    diffuseColor.rgb = mix(diffuseColor.rgb, reefRock(wp) * (0.9 + 0.2 * texture2D(map, vUv * 2.0).r), smoothstep(0.5, 0.65, reefMask(wp)) * (1.0 - smoothstep(25.0, 50.0, vBD)) * uShallow);
    diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(rockMap, vUv * 2.2).rgb * mix(1.15, 1.5, uShallow), vRock);`);
};
const SHALLOW = { value: 0 };                                          // 1 = 浅い海（サンゴ砂）
const BEAU = { value: 0 };                                             // 1 = 浅瀬（美しさ優先: 砂をより白く）
const BED_EDGE = { value: 0 };                                         // 1 = 海面の上から見ている（縁を透明にする）
const FADE = { value: new THREE.Vector2(40, 80) };                     // 消し始める・消し終わる距離 (m)（サンゴを置き切れた範囲の内側）
// 岩・サンゴ: 海面の上から見るときは、距離でなめらかに半透明にして消す
function fadeByDistance(m, key) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uEdge = BED_EDGE; sh.uniforms.uFade = FADE;
    sh.vertexShader = 'varying vec2 vFP;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vFP = (modelMatrix * ${'instanceMatrix'} * vec4(transformed, 1.0)).xz;`);
    sh.fragmentShader = 'uniform float uEdge; uniform vec2 uFade; varying vec2 vFP;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (uEdge > 0.5) gl_FragColor.a *= 1.0 - smoothstep(uFade.x, uFade.y, length(vFP));`);
  };
  const prevKey = m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
  m.customProgramCacheKey = () => (prevKey ? prevKey() : key) + '|fade';
  m.transparent = true;                                                // ふだんは不透明（a = 1）のまま
  m.needsUpdate = true;
}
bedMat.transparent = true;                                             // 縁を透明にできるように（ふだんは不透明のまま）
const bed = withCaustics(new THREE.Mesh(bedGeo, bedMat));
bed.visible = false; bed.receiveShadow = true; scene.add(bed);
// 岩場に転がる岩（形をまとめて描き、岩ごとに向き・大きさ・縦横の比を変える）。
// 丸みのある石灰岩の塊（サンゴのかけらが固まったもの）: 大小のこぶと、割れてできた平らな面。陰影はなめらかに（角ばった多面体に見えないように）
const ROCK_MAX = 220;
// 岩とかたまりのサンゴの面の細かさ（画質で変える。低: 粗く軽い / 高: なめらか）
const GEO_DETAIL = S && S.quality === 'low' ? 3 : S && S.quality === 'mid' ? 4 : 5;
const rnoise = (() => {                                                 // なめらかな 3 次元のノイズ（-1〜1）と、それを重ねたもの
  const h = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
  const n = (x, y, z) => { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t;
    return 2 * L(L(L(h(ix, iy, iz), h(ix + 1, iy, iz), u), L(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), u), v), L(L(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), u), L(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), u), v), w) - 1; };
  return { n, fbm: (x, y, z, o = 4) => { let a = 0, f = 1, s = 0.5; for (let i = 0; i < o; i++) { a += s * n(x * f, y * f, z * f); f *= 2.03; s *= 0.5; } return a; } };
})();
// 同じ位置の頂点（面ごとに分かれている）の向きをそろえて、なめらかな陰影にする
function smoothNormals(g, keyOf) {
  const p = g.attributes.position, acc = new Map(), keys = [], A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) keys.push(keyOf(i));
  for (let i = 0; i < p.count; i += 3) {
    A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2); N.crossVectors(B.sub(A), C.sub(A));   // 面の大きさで重みづけ
    for (let k = 0; k < 3; k++) { const a = acc.get(keys[i + k]) || [0, 0, 0]; a[0] += N.x; a[1] += N.y; a[2] += N.z; acc.set(keys[i + k], a); }
  }
  const nn = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1; nn.set([a[0] / l, a[1] / l, a[2] / l], i * 3); }
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
}
const rockGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, GEO_DETAIL), p = g.attributes.position, d = new THREE.Vector3(), keys = [];
  const cuts = [[0.3, 0.9, 0.2, 0.86], [-0.8, 0.35, 0.4, 0.88], [0.5, 0.1, -0.85, 0.9], [-0.3, -0.2, -0.9, 0.92]].map(([x, y, z, o]) => [new THREE.Vector3(x, y, z).normalize(), o]);   // 割れてできた平らな面
  const ao = new Float32Array(p.count), alg = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize(); keys.push(`${d.x.toFixed(4)},${d.y.toFixed(4)},${d.z.toFixed(4)}`);
    const big = rnoise.fbm(d.x * 1.3 + 3, d.y * 1.3, d.z * 1.3, 3), fine = rnoise.fbm(d.x * 5 + 7, d.y * 5, d.z * 5, 3);
    let r = 1 + 0.24 * big + 0.06 * fine;
    for (const [n, o] of cuts) { const c = d.dot(n); if (c > 0.05) r = Math.min(r, (o + 0.04 * fine) / c + 0.02 * (1 - c)); }   // 平らな面（縁は少し丸く）
    const y = d.y * r * 0.62; p.setXYZ(i, d.x * r, y < -0.3 ? -0.3 + (y + 0.3) * 0.3 : y, d.z * r);   // 下は平たく（海底に座る）
    ao[i] = Math.min(1.05, Math.max(0.45, 0.82 + 2.2 * (0.06 * fine) + 0.35 * big)) * (y < -0.15 ? 0.75 : 1);   // くぼみと底は暗い
  }
  smoothNormals(g, i => keys[i]);
  const nr = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {                                  // 浅い海の岩の色: 上は芝のような藻（黄土〜緑がかった褐色）、横は石灰藻の淡い桃色のしみ、下は灰色
    d.fromBufferAttribute(p, i); const up = nr.getY(i), pk = rnoise.fbm(d.x * 3 + 11, d.y * 3, d.z * 3, 3), mo = rnoise.fbm(d.x * 6 + 5, d.y * 6, d.z * 6, 2);
    let c = up > 0.35 ? [1.35, 1.33, 0.92] : [1.4, 1.3, 1.22];
    c = c.map((v, k) => v + (up > 0.35 ? [0.05, 0.12, -0.04][k] * mo * 2 : 0));
    if (pk > 0.12 && up < 0.7) c = c.map((v, k) => v + [0.45, -0.05, 0.12][k] * Math.min(1, (pk - 0.12) * 5));
    alg.set(c, i * 3);
  }
  g.setAttribute('aAo', new THREE.BufferAttribute(ao, 1)); g.setAttribute('aAlg', new THREE.BufferAttribute(alg, 3));
  return g;
})();
const rockMat = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95 });
rockMat.extensions = { derivatives: true };
rockMat.onBeforeCompile = sh => {                                     // くぼみの暗さと、浅い海（サンゴ礁）の藻の色。表面のざらざらした凹凸（画素ごとに面の向きを揺らす）
  sh.uniforms.uShallow = SHALLOW;
  sh.vertexShader = 'attribute float aAo; attribute vec3 aAlg; varying float vAo; varying vec3 vAlg, vRP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vAo = aAo; vAlg = aAlg; vRP = position;');
  sh.fragmentShader = 'uniform float uShallow; varying float vAo; varying vec3 vAlg, vRP;\n' + CORAL_NOISE + '\n' + sh.fragmentShader
    .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.295, 0.29), uShallow * 0.7);')   // 浅い海では、深海の岩の細かい斑点を弱める（藻に覆われている）
    .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vAo * mix(vec3(1.0), vAlg, uShallow);')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float n1 = cdN(vRP * 3.0), n2 = cdN(vRP * 8.0 + 3.0), n3 = cdN(vRP * 20.0 + 7.0);
        float a2 = 1.0 - smoothstep(0.15, 0.45, length(fwidth(vRP * 8.0))), a3 = 1.0 - smoothstep(0.15, 0.45, length(fwidth(vRP * 20.0)));   // 遠くで画素より細かい凹凸は消す（ざらつきがちらつかないように）
        float hgt = n1 * 0.5 + n2 * 0.3 * a2 + n3 * 0.15 * a3;   // 大小のでこぼこ
        vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * 0.5;
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1);
        if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
        diffuseColor.rgb *= 0.85 + 0.25 * n1;
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.92, 0.95, 0.98), vec3(1.06, 1.02, 0.9), cdN(vRP * 2.5 + 11.0)), uShallow);   // 藻の付き方のむら
      }`);
};
rockMat.customProgramCacheKey = () => 'rock2';
const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_MAX);
fadeByDistance(rocks.material, 'rock');
const rockCol = new THREE.Color();
rocks.setColorAt(0, rockCol.setScalar(1));                          // 岩ごとの色を最初から使う（あとから足すと材質の作り直しが起きるため）。色の配列は数を 0 にする前に作る（0 だと空の配列になり、岩が真っ黒になる）
rocks.count = 0; rocks.frustumCulled = false; rocks.visible = false; rocks.castShadow = rocks.receiveShadow = true; scene.add(withCaustics(rocks));
const rockDummy = new THREE.Object3D();
// 海底の格子点を、中心（プレイヤー）に近い順に並べたもの（岩は近くから置く）
const nearFirst = Array.from({ length: bedGeo.attributes.position.count }, (_, i) => i)
  .sort((a, b) => Math.hypot(bedGeo.attributes.position.getX(a), bedGeo.attributes.position.getZ(a)) - Math.hypot(bedGeo.attributes.position.getX(b), bedGeo.attributes.position.getZ(b)));
// ゆるやかな起伏（波長 20m 以上だけにする。細かい起伏は 3m 格子では再現できず、小さな生き物が埋もれるため）
// ---------- 礁の起伏（浅い海） ----------
// 根（ね）: 礁のまだらの岩場（サンゴの多い所）は、岩とサンゴが積み重なって、まわりの砂地より 1〜3m 盛り上がる。
// 縁脚・縁溝: 礁の斜面（水深 4〜30m）には、斜面を下る向きにサンゴの尾根と砂の溝が、約 25m 間隔で交互に並ぶ。
// 地形の格子（約 120m）より細かいので、近くの海底だけに付ける。計算が重いので、海底を作り直すとき（3m 動くたび）に
// 3m 格子で計算しておき、あとはその格子から読む
const smooth01 = v => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };
// ピナクルなど、海底からそびえる岩の塔（config の sites の spire: { h: 高さ, r: 太さ } (m)）。切り立った側面と、でこぼこした頂上
function spireH(x, z) {
  let h = 0;
  for (const st of sites) if (st.spire) {
    const r0 = Math.hypot(x - st.x, z - st.z) / st.spire.r; if (r0 > 2.6) continue;
    const r = r0 * (0.8 + 0.4 * vnoise(x * 0.12 + st.i * 7, z * 0.12));
    h += st.spire.h * (1 - smooth01((r - 0.5) / 1.1)) * (0.75 + 0.35 * vnoise(x * 0.35, z * 0.35 + 9));
  }
  return h;
}
function reliefAt(x, z) {
  const d = floorAt(x, z); if (d > 45 || d < 1.5) return 0;
  const rm = T.reefMaskJS(x, z);
  let h = 2.6 * smooth01((rm - 0.55) / 0.17) * (0.55 + 0.45 * vnoise(x * 0.07 + 3, z * 0.07)) * smooth01((d - 1.5) / 3);
  if (d > 4 && d < 32) {
    const e = 25, gx = (floorAt(x + e, z) - floorAt(x - e, z)) / (2 * e), gz = (floorAt(x, z + e) - floorAt(x, z - e)) / (2 * e), gl = Math.hypot(gx, gz);
    if (gl > 0.02) {
      const ax = -gz / gl, az = gx / gl;                                   // 等深線の向き（尾根はこれに直角＝斜面を下る向きに伸びる）
      const ridge = 0.5 + 0.5 * Math.cos((x * ax + z * az) / 25 * 6.283 + vnoise(x * 0.02, z * 0.02) * 4);
      h += 1.8 * ridge * ridge * smooth01((gl - 0.02) / 0.08) * smooth01((d - 4) / 4) * (1 - smooth01((d - 22) / 10));
    }
  }
  h += spireH(x, z);
  return Math.max(0, Math.min(h, d - 1.2));                            // 海面の近くまでは盛り上げない
}
const RELIEF = { ox: NaN, oz: NaN, n: 0, step: 3, h: null };
function buildRelief(ox, oz) {
  const n = Math.round(BED_R * 2 / RELIEF.step) + 1, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = reliefAt(ox - BED_R + i * RELIEF.step, oz - BED_R + j * RELIEF.step);
  Object.assign(RELIEF, { ox, oz, n, h });
}
function reliefSample(x, z) {
  if (!RELIEF.h) return 0;
  const fx = (x - RELIEF.ox + BED_R) / RELIEF.step, fz = (z - RELIEF.oz + BED_R) / RELIEF.step, n = RELIEF.n;
  if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = RELIEF.h;
  return (H[j * n + i] * (1 - u) + H[j * n + i + 1] * u) * (1 - v) + (H[(j + 1) * n + i] * (1 - u) + H[(j + 1) * n + i + 1] * u) * v;
}
const bump = (x, z) => 0.3 * Math.sin(x * 0.19 + Math.sin(z * 0.11) * 2) * Math.sin(z * 0.15 + 1.3) + reliefSample(x, z);
let bedX = NaN, bedZ = NaN;
// ---------- サンゴ礁（水深 40m より浅い海底） ----------
// 浅い海底は、泥ではなく白いサンゴ砂（波でできた砂紋）にし、サンゴの群体を置く。
// ハマサンゴ（こぶの盛り上がったかたまり）・ノウサンゴ（脳のような溝の半球）・テーブル状のミドリイシ（足の上に平たい板）・枝状のミドリイシ（二股に分かれる枝）の 4 つの形。
// グアムでは 2013〜17 年の白化でサンゴが大きく減ったので、色のあせたものや、藻に覆われた死サンゴの色も混ぜる
// 1 種類あたりのサンゴの数の上限（潜水艇のまわり約 90m を埋められるだけ。画質で変える）
const CORAL_MAX = S && S.quality === 'low' ? 260 : S && S.quality === 'mid' ? 550 : 900;
let coralReach = Infinity;                                             // サンゴを数の上限まで置いたときの、いちばん遠いサンゴの距離 (m)。それより先は置けていない
// 形をまとめる（色の属性があれば、それも）
function concatGeo(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  parts.forEach(g => { if (!g.attributes.normal) g.computeVertexNormals(); });
  let n = 0; parts.forEach(g => n += g.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1); let o = 0;
  parts.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.color) col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const setCol = (g, fn) => { const p = g.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) c.set(fn(p.getX(i), p.getY(i), p.getZ(i)), i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
// 球の向きごとの半径で決まる形（ハマサンゴ・ノウサンゴ）。面の向きは、まわりの点から計算して、なめらかにする
function radialGeo(detail, R, squash, base, shade) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, nn = new Float32Array(p.count * 3), cc = new Float32Array(p.count * 3);
  const d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), q = new THREE.Vector3();
  const P = v => { const r = R(v); return new THREE.Vector3(v.x * r, Math.max(base, v.y) * r * squash, v.z * r); };
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    t1.set(-d.z, 0, d.x); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); t1.normalize(); t2.crossVectors(d, t1);
    const e = 0.03, a1 = P(q.copy(d).addScaledVector(t1, e).normalize()), b1 = P(q.copy(d).addScaledVector(t1, -e).normalize());
    const a2 = P(q.copy(d).addScaledVector(t2, e).normalize()), b2 = P(q.copy(d).addScaledVector(t2, -e).normalize());
    const n = new THREE.Vector3().crossVectors(a1.sub(b1), a2.sub(b2)).normalize(); if (n.dot(d) < 0) n.negate();
    const v = P(d); p.setXYZ(i, v.x, v.y, v.z); nn.set([n.x, n.y, n.z], i * 3);
    cc.set(shade(d, v), i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return g;
}
const ao = y => 0.5 + 0.5 * Math.min(1, Math.max(0, (y + 0.1) / 0.6));     // 根元ほど暗い（すき間に光が届きにくい）
const coralGeos = {
  // ハマサンゴ: 半分埋まった大きなかたまりに、丸いこぶがいくつも盛り上がる。くぼみは暗い
  massive: (() => {
    const lumps = [[0, 1, 0], [0.6, 0.7, 0.2], [-0.5, 0.75, 0.4], [0.1, 0.65, -0.7], [-0.6, 0.55, -0.45], [0.8, 0.3, -0.4], [-0.85, 0.3, 0.2], [0.35, 0.35, 0.85], [-0.2, 0.4, 0.9]].map(a => new THREE.Vector3(...a).normalize());
    const R = v => { let r = 1 + 0.035 * rnoise.fbm(v.x * 4, v.y * 4, v.z * 4, 2); lumps.forEach((c, i) => { r += (0.1 + 0.03 * (i % 3)) * Math.exp(-(1 - v.dot(c)) / 0.035); }); return r; };   // 丸いこぶが盛り上がる
    return radialGeo(GEO_DETAIL, R, 0.72, -0.25, (d, v) => { const k = ao(v.y) * (0.8 + 0.9 * (R(d) - 1.05)); return [k, k, k]; });
  })(),
  // ノウサンゴ（キクメイシの仲間）: なめらかな丸い半球。脳のような溝は、表面の模様として描く（下のシェーダー）
  brain: radialGeo(Math.max(2, GEO_DETAIL - 1), v => 1 + 0.03 * Math.sin(v.x * 4 + v.z * 3), 0.62, -0.2, (d, v) => { const k = ao(v.y); return [k, k, k]; }),
  // テーブル状のミドリイシ: 太い足の上に、縁が少し反り上がった平たい板。上は明るく、裏は影で暗い
  table: (() => {
    const NR = 6, NA = 40, Rr = a => 1 + 0.1 * Math.sin(a * 5) + 0.05 * Math.sin(a * 13), parts = [];
    const sheet = (topSide) => {
      const pos = [], idx = [], col = [];
      for (let i = 0; i <= NR; i++) for (let j = 0; j <= NA; j++) {
        const a = j / NA * Math.PI * 2, r = i / NR * Rr(a), y = 0.45 + 0.09 * r * r + 0.03 * Math.sin(a * 4) * r - (topSide ? 0 : 0.03 + 0.06 * (1 - r));
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r); const k = topSide ? 0.9 + 0.15 * (i / NR) : 0.35 + 0.15 * (i / NR); col.push(k, k, k);
        if (i < NR && j < NA) { const A = i * (NA + 1) + j, B = A + NA + 1; topSide ? idx.push(A, A + 1, B, B, A + 1, B + 1) : idx.push(A, B, A + 1, B, B + 1, A + 1); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
    };
    parts.push(sheet(true), sheet(false));
    parts.push(setCol(new THREE.CylinderGeometry(0.09, 0.16, 0.46, 8, 1, true).translate(0, 0.21, 0), (x, y) => { const k = 0.35 + 0.3 * y; return [k, k, k]; }));
    return concatGeo(parts);
  })(),
  // 枝状のミドリイシ: 根元から何本も伸び、二股に分かれながら上へ広がる。枝先は色が淡い（伸びている所で、褐虫藻が少ない）
  branch: (() => {
    const parts = []; let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const UP = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), Q = new THREE.Quaternion();
    const grow = (base, dir, len, rad, lvl) => {
      const c = new THREE.CylinderGeometry(rad * 0.72, rad, len, 5, 1, true).translate(0, len / 2, 0);
      c.applyMatrix4(M.makeRotationFromQuaternion(Q.setFromUnitVectors(UP, dir))); c.translate(base.x, base.y, base.z);
      parts.push(setCol(c, (x, y, z) => { const tip = lvl >= 2 ? Math.min(1, Math.max(0, (new THREE.Vector3(x, y, z).sub(base).dot(dir) / len - 0.4) / 0.6)) : 0, k = ao(y) * (1 + 0.5 * tip); return [k, k, k + 0.15 * tip]; }));
      if (lvl >= 3) return;
      const tip = base.clone().addScaledVector(dir, len);
      const n = lvl === 0 ? 2 : 2;
      for (let k = 0; k < n; k++) {
        const ax = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize(), d2 = dir.clone().applyAxisAngle(ax, 0.3 + rnd() * 0.35).lerp(UP, 0.25).normalize();
        grow(tip, d2, len * (0.7 + rnd() * 0.2), rad * 0.72, lvl + 1);
      }
    };
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + rnd() * 0.5; grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45).normalize(), 0.32 + rnd() * 0.1, 0.06, 0); }
    return concatGeo(parts);
  })()
};
// 表面の細かい形（画素ごとに、面の向きを少し揺らして陰影を付け、色も変える）。座標は 1 つのサンゴの中の位置
const CORAL_DETAIL = {
  // ポリプの小さな穴（1〜2mm のくぼみ）が一面に並ぶ
  massive: `vec3 cp = vOP * 26.0, ci = floor(cp), cf = fract(cp) - 0.5 - (vec3(cdH(ci), cdH(ci + 7.1), cdH(ci + 3.3)) - 0.5) * 0.5;
    float aa = 1.0 - smoothstep(0.2, 0.6, length(fwidth(cp))), pit = (1.0 - smoothstep(0.08, 0.32, length(cf))) * aa, mot = cdN(vOP * 3.0);
    hgt = -pit * 0.35 + 0.3 * cdN(vOP * 7.0); shade = (1.0 - 0.12 * pit) * (0.86 + 0.28 * mot); tint = mix(vec3(0.96, 1.0, 1.04), vec3(1.05, 1.0, 0.86), mot);`,
  // 脳のように曲がりくねった溝と峰: ほぼ平行な筋を、ゆっくり曲げる。溝の底は暗く緑がかり、峰の稜線は明るい
  brain: `float ph = (vOP.x * 0.8 + vOP.z * 0.6) * 40.0 + cdN(vOP * 2.6) * 22.0 + cdN(vOP * 6.0 + 3.0) * 6.0;
    float sn = sin(ph), aa = clamp(fwidth(ph) * 0.6, 0.0, 1.0);
    float val = mix(smoothstep(0.35, 0.85, sn), 0.3, aa), crest = mix(1.0 - smoothstep(0.85, 1.0, -sn), 0.0, aa);
    hgt = -val * 0.8; shade = (1.0 - 0.45 * val) * (1.0 + 0.15 * (1.0 - crest)); tint = mix(vec3(1.0), vec3(0.7, 1.0, 0.65), val);`,
  // 上の面: 中心から外へ、細かな枝が放射状に並んだ筋（遠くでは細かすぎてちらつくので、画素より細かい筋は消す）
  table: `float r = length(vOP.xz), a = atan(vOP.z, vOP.x), ph = a * 40.0 + sin(r * 11.0) * 1.5;
    float aa = 1.0 - smoothstep(0.25, 0.8, fwidth(ph)), rr = mix(0.5, abs(sin(ph)), aa);
    float top = smoothstep(0.42, 0.47, vOP.y); hgt = (rr * 0.5 + 0.35 * cdN(vOP * 25.0)) * top * aa; shade = 1.0 - 0.18 * (1.0 - rr) * top;`,
  // 枝の表面: 小さなポリプの突起（サンゴ個体）がびっしり
  branch: `vec3 cp = vOP * 55.0, ci = floor(cp), cf = fract(cp) - 0.5; float bump = 1.0 - smoothstep(0.1, 0.4, length(cf - (vec3(cdH(ci), cdH(ci + 5.0), cdH(ci + 2.0)) - 0.5) * 0.4));
    bump *= 1.0 - smoothstep(0.2, 0.6, length(fwidth(cp))); hgt = bump * 0.5; shade = 0.9 + 0.12 * bump;`
};
const CORAL_NOISE = `
  float cdH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float cdN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(cdH(i), cdH(i + vec3(1,0,0)), f.x), mix(cdH(i + vec3(0,1,0)), cdH(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(cdH(i + vec3(0,0,1)), cdH(i + vec3(1,0,1)), f.x), mix(cdH(i + vec3(0,1,1)), cdH(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
// 4 種類の模様を 1 つのシェーダーにまとめ、種類は uniform（uKind）で選ぶ（種類ごとに別のシェーダーにすると、初めて描くときに 1 つずつ作られ、画面が止まる）
const CORAL_KIND = { massive: 0, brain: 1, table: 2, branch: 3 };
const CORAL_DETAIL_ALL = Object.keys(CORAL_KIND).map((k, i) => `${i ? 'else ' : ''}if (uKind < ${i}.5) { ${CORAL_DETAIL[k]} }`).join('\n        ');
const corals = {};
Object.entries(coralGeos).forEach(([k, g]) => {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, vertexColors: true });
  mat.extensions = { derivatives: true };
  // 蛍光: 多くのサンゴは、海中に多い青い光を受けて緑・黄・橙・赤の光を出す（蛍光タンパク質）。水に吸われにくく、浅い海で色が鮮やかに見える
  mat.onBeforeCompile = sh => {
    sh.uniforms.uFluor = CORAL_FLUOR; sh.uniforms.uKind = { value: CORAL_KIND[k] };
    sh.vertexShader = 'varying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vOP = position;');
    sh.fragmentShader = 'uniform float uFluor, uKind; varying vec3 vOP;\n' + CORAL_NOISE + '\n' + sh.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float hgt = 0.0, shade = 1.0; vec3 tint = vec3(1.0);
        ${CORAL_DETAIL_ALL}
        vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * 0.6;
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1);
        if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
        diffuseColor.rgb *= shade * tint;
      }`)
      .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance += pow(max(diffuseColor.rgb, vec3(0.0)), vec3(2.2)) * vec3(2.4, 1.5, 0.9) * uFluor;   // 色の濃い所ほど強く（白っぽくならないように）');
  };
  mat.customProgramCacheKey = () => 'coral';
  fadeByDistance(mat, 'coral');
  const m = new THREE.InstancedMesh(g, mat, CORAL_MAX);
  m.setColorAt(0, new THREE.Color(1, 1, 1)); m.count = 0; m.frustumCulled = false; m.visible = false; m.castShadow = m.receiveShadow = true; scene.add(withCaustics(m)); corals[k] = m;
});
// サンゴの色（生きているもの: 褐色・黄土・緑がかった褐色・紫がかった色 / 白化してあせたもの / 藻に覆われた死サンゴ）
// 生きたサンゴの色（ミドリイシの青紫の枝先・ハナヤサイサンゴの桃色・ハマサンゴの黄緑・キクメイシの緑・紫・黄・橙）を多めに、
// 白化してあせたものと、藻に覆われた死サンゴを少し
const CORAL_COLS = T.CORAL_COLS;                                       // 色は world.js と共通（遠くの海底に描くサンゴと同じ）
const CORAL_FLUOR = { value: 0 };                                       // 蛍光の強さ（浅いほど強い。下の updateBed で決める）
const vnoise = (x, z) => {                                             // なめらかな 2 次元のノイズ（0〜1）
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const h = (a, b) => (hash(a, b, 77) % 10007) / 10007;
  return (h(ix, iz) * (1 - sx) + h(ix + 1, iz) * sx) * (1 - sz) + (h(ix, iz + 1) * (1 - sx) + h(ix + 1, iz + 1) * sx) * sz;
};
// サンゴと岩の、てっぺんの深さ（潜水艇がその上を越えるように、nav.js が近づける限界に使う）。
// x, z: 世界の m、r: 横の半径 (m)、top: てっぺんの水深 (m)
const OBST = [];
const CORAL_TOP = { massive: 0.82, brain: 0.64, table: 0.6, branch: 1.0 }, CORAL_RAD = { massive: 1.15, brain: 1.05, table: 1.15, branch: 0.7 };
const SITE_OBST = [];                                                  // 見どころの体（沈船）が持つ障害物（置いた後は動かない）
function obstacleDepth(x, z, rad) {
  let d = Infinity;
  for (const o of SITE_OBST) { const dx = o.x - x, dz = o.z - z, rr = o.r + rad; if (dx * dx + dz * dz < rr * rr && o.top < d) d = o.top; }
  for (const o of OBST) { const dx = o.x - x, dz = o.z - z, rr = o.r + rad; if (dx * dx + dz * dz < rr * rr && o.top < d) d = o.top; }
  return d;
}
// ダイブポイントの近く（150m 以内）は、潜水艇の下が深くても、サンゴ礁の生き物とサンゴを置く（ピナクルのまわりは 45m より深く落ち込む）
const nearPoint = (x, z) => sites.some(st => (st.fish || st.spire) && Math.hypot(st.x - x, st.z - z) < 150);
function placeCorals(ox, oz, p, floorHere) {
  const show = floorHere < 45 || nearPoint(ox, oz);
  Object.values(corals).forEach(m => { m.count = 0; m.visible = show; });
  if (!show) return;
  const n = { massive: 0, brain: 0, table: 0, branch: 0 };
  coralReach = Infinity;
  // 区画（3m 四方）ごとに、world.js の coralCellJS で決める（遠くの海底に描くサンゴと同じ場所・色・大きさ）。近い区画から置く
  for (const i of nearFirst) {
    const lx = p.getX(i), lz = p.getZ(i); if (Math.abs(lx) > BED_R - 4 || Math.abs(lz) > BED_R - 4) continue;
    const wx = ox + lx, wz = oz + lz, cx = Math.round(wx / T.CELL), cz = Math.round(wz / T.CELL);
    const sp = spireH(cx * T.CELL, cz * T.CELL);                        // 岩の塔の上は、塔の高さの分だけ浅い所として、サンゴを育てる
    const c = T.coralCellJS(cx, cz, floorAt(cx * T.CELL, cz * T.CELL) - sp, sp > 1 ? 0.75 : T.reefMaskJS(wx, wz)); if (!c) continue;
    const m = corals[c.kind];
    if (n[c.kind] >= CORAL_MAX) { coralReach = Math.min(coralReach, Math.hypot(lx, lz) - BED_STEP); continue; }
    const by = -floorAt(c.x, c.z) + bump(c.x, c.z);
    rockDummy.position.set(c.x - ox, by - 0.05, c.z - oz);
    rockDummy.rotation.set(0, c.rot, 0); rockDummy.scale.set(c.sx, c.sy, c.sz); rockDummy.updateMatrix();
    const cc = CORAL_COLS[c.col];
    m.setMatrixAt(n[c.kind], rockDummy.matrix); m.setColorAt(n[c.kind], rockCol.setRGB(cc[0] * c.v, cc[1] * c.v, cc[2] * c.v)); n[c.kind]++;
    OBST.push({ x: c.x, z: c.z, r: CORAL_RAD[c.kind] * Math.max(c.sx, c.sz), top: -(by - 0.05 + CORAL_TOP[c.kind] * c.sy) });
  }
  Object.entries(corals).forEach(([k, m]) => { m.count = n[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
}

// 岩場らしさ（0 = 泥、1 = 岩）: 海底の傾きが急な所ほど岩が出る（泥がたまりにくい）。境目は少しまだらに
function rockiness(x, z) {
  const e = 30, gx = (floorAt(x + e, z) - floorAt(x - e, z)) / (2 * e), gz = (floorAt(x, z + e) - floorAt(x, z - e)) / (2 * e);
  const slope = Math.hypot(gx, gz) + 0.06 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 3) * Math.sin(z * 0.13);
  const u = Math.min(1, Math.max(0, (slope - 0.18) / 0.22)); return u * u * (3 - 2 * u);
}
function updateBed(px, pz, depth, show) {
  bed.visible = show; if (!show) { rocks.visible = false; Object.values(corals).forEach(m => m.visible = false); return; }
  const ox = Math.round(px / BED_STEP) * BED_STEP, oz = Math.round(pz / BED_STEP) * BED_STEP;
  if (ox !== bedX || oz !== bedZ) {                                  // 格子ひとつ分動いたら、海底の形を作り直す
    bedX = ox; bedZ = oz;
    buildRelief(ox, oz);                                               // 礁の起伏（根・縁脚）
    const p = bedGeo.attributes.position, uv = bedGeo.attributes.uv, rk = bedGeo.attributes.rock;
    for (let i = 0; i < p.count; i++) {
      const wx = ox + p.getX(i), wz = oz + p.getZ(i);
      p.setY(i, -T.floorDepth(wx / 1000, wz / 1000) + bump(wx, wz));
      uv.setXY(i, wx / BED_TILE, wz / BED_TILE);
      rk.setX(i, Math.max(rockiness(wx, wz), smooth01(reliefSample(wx, wz) / 1.4) * 0.85));   // 根や尾根の上は、岩（藻に覆われた死サンゴ）
    }
    p.needsUpdate = uv.needsUpdate = rk.needsUpdate = true; bedGeo.computeVertexNormals(); bedGeo.computeBoundingSphere();
    // 岩: 海底の格子点ごとに、岩場らしさに応じて置く（場所ごとにいつも同じ並び）
    let n = 0; OBST.length = 0;
    for (const i of nearFirst) {
      if (n >= ROCK_MAX) break;
      const lx = p.getX(i), lz = p.getZ(i); if (Math.abs(lx) > BED_R - 4 || Math.abs(lz) > BED_R - 4) continue;
      const cx = Math.round((ox + lx) / BED_STEP), cz = Math.round((oz + lz) / BED_STEP), r = rng(hash(cx, cz, 404));
      if (r() > rk.getX(i) * 0.6) continue;
      const sc = 0.15 + Math.pow(r(), 2.5) * 1.4, jx = (r() - 0.5) * BED_STEP, jz = (r() - 0.5) * BED_STEP;
      rockDummy.position.set(lx + jx, p.getY(i) + sc * 0.2, lz + jz);
      rockDummy.rotation.set(r() * 0.6, r() * 6.3, r() * 0.6); rockDummy.scale.set(sc * (0.8 + r() * 0.5), sc, sc * (0.8 + r() * 0.5)); rockDummy.updateMatrix();
      OBST.push({ x: ox + lx + jx, z: oz + lz + jz, r: 1.15 * Math.max(rockDummy.scale.x, rockDummy.scale.z), top: -(rockDummy.position.y + 0.8 * sc) });
      rocks.setMatrixAt(n, rockDummy.matrix); rocks.setColorAt(n++, rockCol.setScalar(1.15 + r() * 0.6).multiply(rockCol.clone().setRGB(1, 0.97 + r() * 0.06, 0.93)));   // 岩ごとに少し明るさと色を変える
    }
    rocks.count = n; rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    placeCorals(ox, oz, p, floorAt(px, pz));
    if (REEF.rebuild) REEF.rebuild(ox, oz, nearPoint(ox, oz) ? Math.min(40, floorAt(px, pz)) : floorAt(px, pz));           // サンゴ礁の生き物（reef.js）も置き直す
  }
  bed.position.set(ox - px, depth, oz - pz);                         // 頂点の高さは「-水深」なので、今の水深だけ持ち上げる
  rocks.position.copy(bed.position); rocks.visible = true;
  Object.values(corals).forEach(m => m.position.copy(bed.position));
  SHALLOW.value = Math.max(0, Math.min(1, (60 - floorAt(px, pz)) / 25));
  BEAU.value = T.beautyK(floorAt(px, pz));
  CORAL_FLUOR.value = 1.4 * Math.exp(-Math.max(0, depth) / 30) * (1 - 0.6 * T.beautyK(depth));   // 青い光が多く届く浅い所ほど、蛍光で鮮やかに（浅瀬は日の光の赤・黄が多く残るので、光りすぎないように控える）
  const k = Math.min(1, Math.max(0, depth) / 9000);
  bed.material.color.setRGB(0.95 - 0.25 * k, 0.92 - 0.25 * k, 0.88 - 0.2 * k);   // 深いほど暗い灰色の泥
}
const floorAt = (x, z) => T.floorDepth(x / 1000, z / 1000);
const seabedY = (x, z) => floorAt(x, z) - bump(x, z);              // 近景の海底面の水深（起伏込み）

// ---------- 体の使い回し ----------
// 体を作るのは重い（形・材質・テクスチャの準備）。消えた体は捨てずに取っておき、次に使う。
const BUILDERS = window.SPECIES || {};
const pool = {};                 // kind → 使っていない体
const POOL_MAX = 12;
let builtThisFrame = 0;

// ---------- 遠くの小さな生き物は、種類ごとにまとめて描く ----------
// 生き物の体は部品が多く（クモヒトデは約 90、ヨコエビは約 60）、1 匹ずつ部品ごとに描くと、集まる所で描く回数が 1,000 を超える。
// 画面で小さく見える個体は、その種類の「止まった姿」を 1 つの形にしたものを、同じ形をまとめて描く方法（InstancedMesh）で描き、
// 形の作り直し（動き）も止める。自分で光る生き物は、まとめると光が消えるので、いつも 1 匹ずつ描く
const FAR_LOOK = 0.05, FAR_MAX = 256;
const FAR = {};
const ONE = new THREE.Vector3(1, 1, 1), FAR_M = new THREE.Matrix4();
function mergeParts(list) {
  let n = 0; list.forEach(p => n += p.geo.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  list.forEach(p => { const c = p.geo.attributes.position.count; pos.set(p.geo.attributes.position.array, o * 3); nor.set(p.geo.attributes.normal.array, o * 3); col.set(p.col, o * 3); o += c; p.geo.dispose(); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// 模様の画像（canvas）の色を読む（遠くの簡単な形に、体の模様の色を写すため）。画像ごとに 1 度だけ縮めて読む
const TEX_PIX = new WeakMap();
function texPixels(t) {
  if (TEX_PIX.has(t)) return TEX_PIX.get(t);
  let r = null; const im = t.image;
  if (im && im.width && im.height) {
    const W = Math.min(128, im.width), H = Math.min(128, im.height), c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, W, H); r = { W, H, d: x.getImageData(0, 0, W, H).data };
  }
  TEX_PIX.set(t, r); return r;
}
function farFor(def) {
  if (FAR[def.kind] !== undefined) return FAR[def.kind];
  const b = BUILDERS[def.kind];
  if (def.glow || !b) return (FAR[def.kind] = null);
  const body = b(sizeOf(def));
  const g = body.group; g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
  const parts = { solid: [], clear: [] }; let opSum = 0, opN = 0;
  g.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const m = [].concat(o.material)[0]; if (!m || m.visible === false) return;
    const clear = m.transparent && m.opacity < 0.8;
    let geo = o.geometry.clone(); if (!geo.attributes.normal) geo.computeVertexNormals();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(o.matrixWorld);
    const base = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3), vc = m.vertexColors && geo.attributes.color;
    // 模様の画像があれば、頂点ごとに、その位置の模様の色を写す（ないと白い体になってしまう）
    const px = m.map && geo.attributes.uv ? texPixels(m.map) : null, uv = px && geo.attributes.uv, wrapU = px && m.map.wrapS === THREE.RepeatWrapping, wrapV = px && m.map.wrapT === THREE.RepeatWrapping;
    if (m.map && !px) base.multiplyScalar(0.8);
    for (let i = 0; i < n; i++) {
      let tr = 1, tg = 1, tb = 1;
      if (px) {
        let u = uv.getX(i), v = uv.getY(i); u = wrapU ? u - Math.floor(u) : Math.min(1, Math.max(0, u)); v = wrapV ? v - Math.floor(v) : Math.min(1, Math.max(0, v));
        const k = ((Math.min(px.H - 1, Math.floor((m.map.flipY ? 1 - v : v) * px.H)) * px.W) + Math.min(px.W - 1, Math.floor(u * px.W))) * 4;
        tr = px.d[k] / 255; tg = px.d[k + 1] / 255; tb = px.d[k + 2] / 255;
      }
      col[i * 3] = base.r * tr * (vc ? vc.getX(i) : 1); col[i * 3 + 1] = base.g * tg * (vc ? vc.getY(i) : 1); col[i * 3 + 2] = base.b * tb * (vc ? vc.getZ(i) : 1);
    }
    (clear ? parts.clear : parts.solid).push({ geo, col });
    if (clear) { opSum += m.opacity; opN++; }
  });
  dispose(body);
  const make = (list, mat) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(mergeParts(list), mat, FAR_MAX);
    im.count = 0; im.frustumCulled = false; withCaustics(im); scene.add(im); return im;
  };
  const f = {
    solid: make(parts.solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide })),
    clear: make(parts.clear, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: opN ? opSum / opN : 0.5 })),
    n: 0
  };
  return (FAR[def.kind] = f);
}

function dispose(body) {
  // 形・材質・テクスチャをGPUから解放する（使い回しのテクスチャは残す）
  body.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    [].concat(o.material || []).forEach(m => { ['map', 'bumpMap'].forEach(k => { if (m[k] && !(m[k].userData && m[k].userData.shared)) m[k].dispose(); }); m.dispose(); });
  });
  if (body.dispose) body.dispose();
}
// 新しく作った体は、すぐに材質の準備（シェーダーの組み立て）まで済ませておく。初めて画面に出た瞬間に止まらないように
function build(def) {
  const b = BUILDERS[def.kind]; if (!b) return null;
  const body = b(sizeOf(def)); withCaustics(body.group);
  scene.add(body.group); renderer.compile(scene, cam); scene.remove(body.group);
  builtThisFrame++;
  return body;
}
function takeBody(def) {
  const p = pool[def.kind];
  if (p && p.length) return p.pop();
  if (builtThisFrame >= 1) return null;                              // 1 フレームに作るのは 1 体まで（残りは次のフレーム）
  return build(def);
}
function giveBack(def, body) {
  scene.remove(body.group);
  const p = pool[def.kind] || (pool[def.kind] = []);
  if (p.length < POOL_MAX && enabled(def)) p.push(body); else dispose(body);
}

// ---------- 区画と個体 ----------
const CELL = 100;
// 区画の番号から決まる乱数（同じ区画ならいつも同じ並び）
const hash = (...n) => { let h = 2166136261; n.forEach(v => { h ^= v | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }); return h >>> 0; };
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const ALL_IX = new Map(ALL.map(d => [d, SEA.creatures.indexOf(d)]));   // 種類ごとの乱数の並びを固定（表示する種類が変わっても他がずれない）
const count = (lam, r) => Math.floor(lam) + (r() < lam % 1 ? 1 : 0);
function newRec(def, x, z, depth, r) {
  return { def, x, z, depth, hx: x, hz: z, hd: depth, heading: r() * Math.PI * 2, seed: r() * 100, slot: r() * 6 | 0, body: null };
}
function midCell(ix, iy, iz) {                                       // 水中の区画（100m 立方）
  const recs = [], top = iy * CELL, bot = top + CELL;
  ALL.forEach(def => {
    if (habitat(def) !== 'mid' || def.behavior === 'migrate') return;   // 回遊する生き物は区画に住まない
    const a = Math.max(top, def.from), b = Math.min(bot, def.to); if (b <= a) return;
    const r = rng(hash(ix, iy, iz, ALL_IX.get(def), 11)), n = count((def.density == null ? 1 : def.density) * (b - a) / CELL, r);
    for (let k = 0; k < n; k++) {
      const x = (ix + r()) * CELL, z = (iz + r()) * CELL, d = a + r() * (b - a);
      if (d > floorAt(x, z) - 1 - sizeOf(def)) continue;              // 岩の中には置かない
      recs.push(newRec(def, x, z, d, r));
    }
  });
  return recs;
}
function floorCell(ix, iz) {                                         // 海底の区画（100m 四方）
  const recs = [];
  // 超深海では、まわりより深い所（海溝の軸や谷底）ほど、斜面から流れこむ有機物がたまって生き物が多い
  const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL, c = floorAt(cx, cz), R = 1500;
  const around = (floorAt(cx + R, cz) + floorAt(cx - R, cz) + floorAt(cx, cz + R) + floorAt(cx, cz - R)) / 4;
  const axis = c > 6000 ? 1 + 1.5 * Math.min(1, Math.max(0, (c - around) / 300)) : 1;
  ALL.forEach(def => {
    const h = habitat(def); if (h === 'mid') return;
    const r = rng(hash(ix, iz, ALL_IX.get(def), 23)), n = count((def.density == null ? 1 : def.density) * axis, r);
    for (let k = 0; k < n; k++) {
      const x = (ix + r()) * CELL, z = (iz + r()) * CELL, floor = floorAt(x, z);
      const lift = h === 'onFloor' ? 0 : 0.5 + r() * 3;
      const rec = newRec(def, x, z, floor - lift, r);
      if (floor >= def.from && floor <= def.to) recs.push(rec);
    }
  });
  return recs;
}
const cells = new Map();         // key → 個体の並び
function release(rec) {
  if (rec.body) { giveBack(rec.def, rec.body); rec.body = null; }
  if (rec.trail) { scene.remove(rec.trail); rec.trail.geometry.dispose(); rec.trail = null; }   // 這い跡の形は消すが、道筋は覚えておく
}
function syncCells(px, pz, depth, floorHere) {
  const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL), cy = Math.floor(depth / CELL), want = new Set();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) if (cy + dy >= 0) want.add(`m${cx + dx},${cy + dy},${cz + dz}`);
    if (floorHere - depth < 150) want.add(`f${cx + dx},${cz + dz}`);   // 海底が近いときだけ海底の区画を見る
  }
  cells.forEach((recs, key) => { if (!want.has(key) && key !== 'demo' && key[0] !== 's') { recs.forEach(release); cells.delete(key); } });   // 見どころ（s）は別に管理
  want.forEach(key => {
    if (cells.has(key)) return;
    const n = key.slice(1).split(',').map(Number);
    cells.set(key, key[0] === 'm' ? midCell(n[0], n[1], n[2]) : floorCell(n[0], n[1]));
  });
}
function clearAll() { cells.forEach(recs => recs.forEach(release)); cells.clear(); }
const inUse = def => { for (const recs of cells.values()) for (const r of recs) if (r.def === def && r.body) return true; return false; };

// ---------- 先に体を作っておく ----------
// 入水の演出（上空から海面へ降りる間）に、各種類の体を 1 体ずつ先に作っておく（浅い所に住む種類から順に）。
// 潜っている間も、手が空いているフレームで、今の深さの近くに住む種類を準備する。
const warmOrder = ALL.slice().sort((a, b) => a.from - b.from);
// ---------- 潜航を始めるときに、まとめて準備する ----------
// 材質のシェーダーは、初めて描くときに作られ、1 つに 0.05〜0.5 秒ほどかかる（Windows では特に遅い）。降下中や海面に近づいたときに
// そのつど作ると、画面が一瞬止まる。そこで潜航の始めに「準備中」と出して、海面近くで使うもの（水深 200m より浅い所の生き物の体・
// 近くの見どころの体・サンゴ礁や外洋の生き物・海底・光の筋など、近景のすべての材質）のシェーダーをまとめて作る。
// 深い所の生き物は、潜っていく途中で、その深さに近づいたものから 1 種類ずつ作る（2 回目からは、ブラウザが作ったものを覚えているので速い）
let warmed = false, warmWait = 0;
// 潜る場所に合わせて、すぐには使わないものは外す（初めて出会う直前に作る）: 海底が 40m より深ければサンゴと光の筋、150m より深ければ
// 近くの海底と岩、300m より深ければ見どころ（海底にある）。回遊する生き物（マッコウクジラ）は回遊の中心から 15km 以内のときだけ
function warmAll() {
  const made = [], px = S.x * 1000, pz = S.z * 1000, floor0 = floorAt(px, pz), off = [];
  const hide = o => { if (o.parent === scene) { scene.remove(o); off.push(o); } };
  if (floor0 >= 40) { Object.values(corals).forEach(hide); hide(shafts); }
  if (floor0 >= 150) { hide(bed); hide(rocks); }
  const nearPod = def => (def.pods || []).some(p => Math.hypot(T.toX(p.lon) * 1000 - px, T.toZ(p.lat) * 1000 - pz) < 15000);
  warmOrder.forEach(def => {
    if (def.from >= 200 || (def.behavior === 'migrate' && !nearPod(def)) || !enabled(def) || !BUILDERS[def.kind] || (pool[def.kind] && pool[def.kind].length)) return;
    const body = BUILDERS[def.kind](sizeOf(def)); withCaustics(body.group); scene.add(body.group); made.push([def, body]);
  });
  const near = floor0 < 300 ? sites.filter(st => BUILDERS[st.kind] && Math.hypot(st.x - px, st.z - pz) < 5000) : [];   // 見どころは海底にあるので、深い海の上から潜るときは外す
  near.forEach(st => { if (!st.body) makeSiteBody(st); if (!st.body.group.parent) scene.add(st.body.group); });
  renderer.compile(scene, cam);
  renderer.compile(T.scene, camera);                                  // 海面・空・水しぶきなど（地形の世界）も
  renderer.compile(cauScene, cauCam);                                 // 光の網目を画像に描くシェーダー（水深 60m まではどこでも使う）
  made.forEach(([def, body]) => giveBack(def, body));
  near.forEach(st => scene.remove(st.body.group));
  off.forEach(o => scene.add(o));
  if (REEF.warm) REEF.warm();                                         // 海面より上を描く場面（pelagic.js）の材質も
}
function prewarm(depth, all) {
  if (builtThisFrame) return;
  const def = warmOrder.find(d => enabled(d) && BUILDERS[d.kind] && !(pool[d.kind] && pool[d.kind].length) && !inUse(d)
    && (all || Math.abs(Math.max(d.from, Math.min(d.to, depth)) - depth) < 600));
  if (def) { const b = build(def); if (b) giveBack(def, b); }
}

// ---------- 回遊する生き物（マッコウクジラなど）: 区画に住まず、時刻で決まる道筋を泳ぎ続ける ----------
// 見ていない間も時間は進むので、また来たときには別の場所にいる。config の pods に回遊の中心と半径を書く
const wanderers = [];
ALL.filter(d => d.behavior === 'migrate').forEach(def => (def.pods || []).forEach((p, pi) => {
  for (let k = 0; k < (p.n || 1); k++) wanderers.push(Object.assign(newRec(def, 0, 0, 0, rng(hash(pi, k, 77))), {
    cx: T.toX(p.lon) * 1000, cz: T.toZ(p.lat) * 1000, R: (p.km || 2) * 1000, th0: pi * 2.1, lag: k * 45, side: (k - (p.n - 1) / 2) * 25, cyc: pi * 900 + k * 40
  }));
}));
const DIVE_CYCLE = 3000;         // 潜水の 1 周期（秒）: 海面近くで呼吸 → 深く潜って狩り → 浮上
function wanderAt(w, now) {
  const v = w.def.cruise || 1.2, tt = now - w.lag, th = w.th0 + v * tt / w.R;
  const wob = 1 + 0.08 * Math.sin(tt / 700 + w.th0);
  w.x = w.cx + Math.cos(th) * w.R * wob + Math.cos(th) * w.side; w.z = w.cz + Math.sin(th) * w.R * wob + Math.sin(th) * w.side;
  w.heading = Math.atan2(-Math.sin(th), Math.cos(th));             // 道筋の進む向き（円の接線）
  const c = ((now + w.cyc) % DIVE_CYCLE) / DIVE_CYCLE, deep = w.def.dive || 1000, ss = x => x * x * (3 - 2 * x);
  w.depth = c < 0.2 ? 8 : c < 0.3 ? 8 + (deep - 8) * ss((c - 0.2) / 0.1) : c < 0.8 ? deep + 150 * Math.sin(c * 40) : c < 0.9 ? deep - (deep - 8) * ss((c - 0.8) / 0.1) : 8;
  w.pitch = c >= 0.2 && c < 0.3 ? 0.5 : c >= 0.8 && c < 0.9 ? -0.5 : 0;   // 潜るときは頭を下げ、浮上するときは上げる
  const floor = floorAt(w.x, w.z); if (w.depth > floor - 40) w.depth = floor - 40;
}

// ---------- 見どころ（鯨骨・沈んだ木など）: 決まった場所の海底に置き、まわりに生き物が集まる ----------
const sites = (SEA.sites || []).filter(s => s.status !== 'preview' || PREVIEW).map((s, i) => Object.assign({}, s, { i, x: T.toX(s.lon) * 1000, z: T.toZ(s.lat) * 1000, body: null, heading: (i * 2.4) % 6.28 }));
sites.forEach(st => { st.depth = floorAt(st.x, st.z); });
function guestsOf(st) {                                              // まわりに集まる生き物（いつも同じ並び）
  const r = rng(hash(st.i, 99)), recs = [];
  (st.guests || []).forEach(gs => {
    const def = ALL.find(d => d.kind === gs.kind); if (!def) return;
    for (let k = 0; k < gs.n; k++) {
      const a = r() * Math.PI * 2, rr = (0.25 + r() * 0.9) * st.size * 0.6, x = st.x + Math.sin(a) * rr, z = st.z + Math.cos(a) * rr, h = habitat(def);
      const floor = floorAt(x, z), d = h === 'onFloor' ? floor : h === 'nearFloor' ? floor - 0.5 - r() * 2 : floor - 2 - r() * 4;
      recs.push(newRec(def, x, z, d, r));
    }
  });
  return recs;
}
function makeSiteBody(st) {
  st.body = BUILDERS[st.kind](st.size); withCaustics(st.body.group);
  // 体の障害物（体の向き・大きさに合わせて世界の位置へ。潜水艇がめり込まないように）
  const c = Math.cos(st.heading), s2 = Math.sin(st.heading), base = seabedY(st.x, st.z);
  (st.body.obst || []).forEach(o => SITE_OBST.push({ x: st.x + o.x * c + o.z * s2, z: st.z - o.x * s2 + o.z * c, r: o.r, top: base - o.h }));
}
function updateSites(px, pz, depth) {
  sites.forEach(st => {
    const d = Math.hypot(st.x - px, st.z - pz, st.depth - depth), key = 's' + st.i;
    if (d < 400 && !cells.has(key)) cells.set(key, guestsOf(st));
    else if (d > 500 && cells.has(key)) { cells.get(key).forEach(release); cells.delete(key); }
    if (d < 160) {
      if (!st.body) { if (builtThisFrame || !BUILDERS[st.kind]) return; makeSiteBody(st); builtThisFrame++; }
      if (!st.body.group.parent) scene.add(st.body.group);
      st.body.group.position.set(st.x - px, depth - seabedY(st.x, st.z), st.z - pz); st.body.group.rotation.y = st.heading;
      shown++;
    } else if (st.body && st.body.group.parent) scene.remove(st.body.group);
  });
}

// ---------- 発光プランクトン: 潜水艇が動くと、まわりの水が青く光る（かき乱されると光る性質） ----------
const PN = 700, PBOX = 26;
const plank = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
plank.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
plank.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
plank.frustumCulled = false; plank.visible = false; scene.add(plank);
const pBase = Float32Array.from({ length: PN * 3 }, () => Math.random() * PBOX), pGlow = new Float32Array(PN);
const wrap = v => ((v % PBOX) + PBOX) % PBOX - PBOX / 2;
function updatePlankton(dt, px, pz, depth, speed, lampOn) {
  const vis = Math.min(1, Math.max(0, (depth - 200) / 300));
  plank.visible = vis > 0; if (!plank.visible) return;
  plank.material.opacity = vis * (lampOn ? 0.45 : 1);
  // 光る生き物の多さ: 600m 付近で最も多く（1m³ に約 80）、3,000m より深いと 1m³ に 1 ほどとまれになる（Craig ほか 2015）
  const many = depth < 1500 ? 1 : Math.max(0.03, Math.exp(-(depth - 1500) / 700));
  const p = plank.geometry.attributes.position, col = plank.geometry.attributes.color, stir = Math.min(1, speed / 3) * many;
  for (let i = 0; i < PN; i++) {
    const x = wrap(pBase[i * 3] - px), y = wrap(pBase[i * 3 + 1] + depth), z = wrap(pBase[i * 3 + 2] - pz);
    p.setXYZ(i, x, y, z);
    const r2 = x * x + y * y + z * z;
    if (r2 < 9 && Math.random() < stir * dt * 6) pGlow[i] = 1;   // 潜水艇のすぐまわりで、動いているときに光る
    else if (Math.random() < dt * 0.01 * many) pGlow[i] = 0.6;       // ときどき自分でも光る
    pGlow[i] *= Math.exp(-dt * 2.2);
    col.setXYZ(i, 0.35 * pGlow[i], 0.8 * pGlow[i], 1.0 * pGlow[i]);
  }
  p.needsUpdate = col.needsUpdate = true;
}

// ---------- ナマコの這い跡: 体の後ろに、泥の上を這った跡を残す ----------
const trailMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const TRAIL_N = 40;
function makeTrail(c) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  const id = []; for (let k = 0; k < TRAIL_N - 1; k++) { const a = k * 2; id.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } geo.setIndex(id);
  const mesh = new THREE.Mesh(geo, trailMat); mesh.frustumCulled = false; scene.add(mesh);
  if (!c.path) {                                                    // 前から這ってきた跡（住みかごとに決まった曲がり方）
    c.path = []; let x = c.x, z = c.z, a = c.heading + Math.PI, r = rng(hash(c.seed * 1000 | 0, 5));
    for (let k = 0; k < TRAIL_N; k++) { c.path.unshift([x, z]); a += (r() - 0.5) * 0.25; x += Math.sin(a) * 0.18; z += Math.cos(a) * 0.18; }
  }
  return mesh;
}
function updateTrail(c, px, pz, depth) {
  const last = c.path[c.path.length - 1];
  if (Math.hypot(c.x - last[0], c.z - last[1]) > 0.15) { c.path.push([c.x, c.z]); if (c.path.length > TRAIL_N) c.path.shift(); }
  const geo = c.trail.geometry, p = geo.attributes.position, col = geo.attributes.color, n = c.path.length, wd = 0.05;
  for (let k = 0; k < TRAIL_N; k++) {
    const [x, z] = c.path[Math.min(n - 1, k)], [x2, z2] = c.path[Math.min(n - 1, k + 1)], [x0, z0] = c.path[Math.max(0, k - 1)];
    let ex = z2 - z0, ez = -(x2 - x0); const l = Math.hypot(ex, ez) || 1; ex *= wd / l; ez *= wd / l;
    const y = depth - seabedY(x, z) + 0.01, f = 0.25 + 0.75 * k / (TRAIL_N - 1);   // 新しい跡ほど濃い
    p.setXYZ(k * 2, x + ex - px, y, z + ez - pz); p.setXYZ(k * 2 + 1, x - ex - px, y, z - ez - pz);
    const v = 0.42 - 0.18 * f; col.setXYZ(k * 2, v, v * 0.9, v * 0.8); col.setXYZ(k * 2 + 1, v, v * 0.9, v * 0.8);
  }
  p.needsUpdate = col.needsUpdate = true;
}

// ---------- ライトに照らされる粒（マリンスノーと、舞い上がった泥）----------
// 深海の映像らしさの多くは、潜水艇のライトの光の中に白い粒が浮かび、流れていく様子にある。
// 粒ごとに「ライトの円すいの中か」「近いか」で明るさを決める（ライトの外や遠くの粒はほとんど見えない）
const LAMP_COS = [Math.cos(0.55), Math.cos(0.3)];                    // スポットライトの外側・内側の角度
function litPoints(n, { color, snow = false, additive = true }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from({ length: n }, () => 0.5 + Math.random()), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const mat = new THREE.ShaderMaterial({
    defines: snow ? { SNOW: 1 } : {},
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uLampDir: { value: new THREE.Vector3(0, 0, -1) }, uCone: { value: new THREE.Vector2(...LAMP_COS) },
      uL1: { value: new THREE.Vector3() }, uL2: { value: new THREE.Vector3() },
      uRange: { value: LAMP_RANGE }, uLamp: { value: 0 }, uAmb: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uBase: { value: snow ? 16 : 40 },
      uFogDen: { value: 0.05 }, uOff: { value: new THREE.Vector3() }, uBox: { value: 24 }, uTime: { value: 0 }
    },
    vertexShader: `
      attribute float aSize; attribute float aAlpha;
      uniform vec3 uLampDir, uL1, uL2; uniform vec2 uCone; uniform float uRange, uLamp, uAmb, uPR, uBase, uFogDen;
      uniform vec3 uOff; uniform float uBox, uTime;
      varying float vA; varying float vL;
      void main(){
        vec3 p = position;
        #ifdef SNOW
          // 粒は海の中を漂っていて（1 秒に約 1mm 沈み、流れに乗って動く）、潜水艇が動くと流れていくように見える
          p = position - uOff + vec3(sin(uTime * 0.3 + position.x) * 0.05, -uTime * 0.001, cos(uTime * 0.25 + position.z) * 0.05);
          p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
          vA = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(p));
        #else
          vA = aAlpha;
        #endif
        float d = length(p);
        vec3 q1 = p - uL1, q2 = p - uL2; float d1 = max(length(q1), 0.001), d2 = max(length(q2), 0.001);
        float l1 = smoothstep(uCone.x, uCone.y, dot(q1 / d1, uLampDir)) * pow(max(0.0, 1.0 - d1 / uRange), 2.0);
        float l2 = smoothstep(uCone.x, uCone.y, dot(q2 / d2, uLampDir)) * pow(max(0.0, 1.0 - d2 / uRange), 2.0);
        vL = uAmb + uLamp * (l1 + l2) * 1.9;
        vA *= exp(-pow(uFogDen * d, 2.0));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPR * clamp(uBase * aSize / max(-mv.z, 0.05), 1.0, ${snow ? '14.0' : '90.0'});
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA; varying float vL;
      void main(){
        float a = smoothstep(0.5, ${snow ? '0.15' : '0.0'}, length(gl_PointCoord - 0.5)) * vA;
        ${additive ? 'gl_FragColor = vec4(uColor * vL * a, a);' : 'gl_FragColor = vec4(uColor * min(vL, 1.2), a * clamp(vL * 1.5, 0.15, 1.0));'}
      }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.visible = false; scene.add(pts);
  return pts;
}
// マリンスノー: 24m 四方の箱の中に粒を置き、潜水艇の位置に合わせて箱をずらす
const SNOW_N = 2200, marineSnow = litPoints(SNOW_N, { color: 0xe8f0f2, snow: true });
{ const p = marineSnow.geometry.attributes.position; for (let i = 0; i < SNOW_N * 3; i++) p.array[i] = Math.random() * 24; }
// 舞い上がった泥: 海底すれすれを進んだり着底したりすると、足元から広がって、ゆっくり沈む
const SILT_N = 600, silt = litPoints(SILT_N, { color: 0x9a8c78, additive: false });
const sP = new Float32Array(SILT_N * 3), sV = new Float32Array(SILT_N * 3), sAge = new Float32Array(SILT_N).fill(1e9), sLife = new Float32Array(SILT_N), sS0 = new Float32Array(SILT_N);
let siltNext = 0, siltAcc = 0, siltLevel = 0, touched = false;
function emitSilt(x, y, z, n, spread, power) {                        // x, z: 世界の m、y: 上が正（= -水深）
  for (let k = 0; k < n; k++) {
    const i = siltNext; siltNext = (siltNext + 1) % SILT_N;
    const a = Math.random() * Math.PI * 2, r = Math.random() * spread, v = power * (0.3 + Math.random() * 0.7);
    sP[i * 3] = x + Math.cos(a) * r; sP[i * 3 + 1] = y + Math.random() * 0.2; sP[i * 3 + 2] = z + Math.sin(a) * r;
    sV[i * 3] = Math.cos(a) * v; sV[i * 3 + 1] = (0.15 + Math.random() * 0.4) * power; sV[i * 3 + 2] = Math.sin(a) * v;
    sAge[i] = 0; sLife[i] = 12 + Math.random() * 14; sS0[i] = 0.6 + Math.random() * 1.2;
  }
}
function updateParticles(dt, t, px, pz, depth, lampOn, alt) {
  const deep = depth > 150, amb = deep ? (lampOn ? 0.035 : 0.006) : 0.5 * Math.exp(-depth / 90);
  [marineSnow, silt].forEach(m => { const u = m.material.uniforms; u.uLampDir.value.copy(fwd); u.uL1.value.copy(lamps[0].position); u.uL2.value.copy(lamps[1].position); u.uLamp.value = lampOn ? 1 : 0; u.uAmb.value = amb; u.uFogDen.value = scene.fog.density; u.uTime.value = t; });
  // 水中の粒: 深い所はライトに浮かぶマリンスノー。日の光が届く浅い所でも、小さな浮遊物が日に照らされて淡く光って見える
  marineSnow.visible = depth > 0.5;
  if (!deep) marineSnow.material.uniforms.uAmb.value = amb * (depth < 20 ? 0.45 + 0.55 * depth / 20 : 1);
  // 流れ: 1 秒に約 3cm。潮の周期（約 12.4 時間）で向きが回るので、1 回の潜航中はほぼ同じ向き（Taira 2004）。粒の箱を流された分だけずらす
  const tide = 0.8 + t * 2 * Math.PI / 44700;
  current.set(Math.cos(tide), 0, Math.sin(tide)).multiplyScalar(0.03 * (0.75 + 0.25 * Math.cos(tide * 2)));
  drift.x = (drift.x + current.x * dt) % 24; drift.y = (drift.y + current.z * dt) % 24;
  const m24 = v => ((v % 24) + 24) % 24;
  marineSnow.material.uniforms.uOff.value.set(m24(px - drift.x), m24(-depth), m24(pz - drift.y));
  // 泥を舞い上げる: 海底から 4m 以内を進むと少しずつ、着底するとまとめて。
  // 浅い海（海底が水深 40m より浅い所）の底は、粒の粗いサンゴ砂で、舞ってもすぐ沈むので濁らない。40〜80m で少しずつ泥の海底になる
  const bedY = -seabedY(px, pz), muddy = Math.min(1, Math.max(0, (seabedY(px, pz) - 40) / 40));
  if (alt < 4 && pSpeed > 0.3 && muddy > 0) { siltAcc += dt * 70 * (1 - alt / 4) * Math.min(1, pSpeed / 4) * muddy; const n = siltAcc | 0; siltAcc -= n; if (n) emitSilt(px, bedY + 0.05, pz, n, 1.5, 0.5 + pSpeed * 0.1); }
  if (alt < 1.6 && !touched) {
    touched = true;
    if (muddy > 0.05) emitSilt(px, bedY + 0.05, pz, Math.round(180 * muddy), 1.2, 1.1);
    if (!saidTouch && muddy > 0.5) { saidTouch = true; UI.toast('着底しました。泥が舞い上がり、しばらく視界が悪くなります。'); }
  }
  if (alt > 3) touched = false;
  // 泥の粒を動かす（広がって勢いが落ち、ゆっくり沈む）。潜水艇のまわりの濃さで、見通しを悪くする
  const p = silt.geometry.attributes.position, al = silt.geometry.attributes.aAlpha, sz = silt.geometry.attributes.aSize;
  let near = 0, any = false;
  for (let i = 0; i < SILT_N; i++) {
    if (sAge[i] > sLife[i]) { al.array[i] = 0; continue; }
    any = true; sAge[i] += dt;
    const k = Math.exp(-dt * 0.7);
    sV[i * 3] *= k; sV[i * 3 + 2] *= k; sV[i * 3 + 1] = sV[i * 3 + 1] * k - 0.012 * dt;
    sP[i * 3] += (sV[i * 3] + current.x) * dt; sP[i * 3 + 1] += sV[i * 3 + 1] * dt; sP[i * 3 + 2] += (sV[i * 3 + 2] + current.z) * dt;
    const floorY = -seabedY(sP[i * 3], sP[i * 3 + 2]); if (sP[i * 3 + 1] < floorY + 0.02) { sP[i * 3 + 1] = floorY + 0.02; sV[i * 3 + 1] = 0; }
    const x = sP[i * 3] - px, y = sP[i * 3 + 1] + depth, z = sP[i * 3 + 2] - pz, life = sAge[i] / sLife[i];
    p.setXYZ(i, x, y, z);
    const a = 0.32 * Math.min(1, sAge[i] * 3) * Math.pow(Math.max(0, 1 - life), 1.4);
    al.array[i] = a; sz.array[i] = sS0[i] * (1 + sAge[i] * 0.18);
    if (x * x + y * y + z * z < 36) near += a;
  }
  silt.visible = any;
  if (any) p.needsUpdate = al.needsUpdate = sz.needsUpdate = true;
  siltLevel += (Math.min(1, near / 25) - siltLevel) * Math.min(1, dt * 2);
}
let saidTouch = false;

// ---------- 毎フレーム ----------
const fwd = new THREE.Vector3(), water = new THREE.Color(), siltCol = new THREE.Color(0x1c1915);
let preyPrev = [], preyNow = [], saidHunt = false;   // ヨコエビ（食べられる側）の一覧: 前のフレームのものを使って探す
let active = false, above = false, frameNo = 0, shown = 0, lastP = null, pSpeed = 0, heardWhale = false;   // above: 海面の上から浅い海を見ている（生き物は海面ごしに透けて見える）
const met = new Set();           // この回に出会った種類（図鑑に登録済みの生き物との出会いは控えめに知らせる）
const nearestWhale = { d: Infinity, pan: 0 };                       // いちばん近い回遊個体（クジラの声の大きさと向きに使う）
function update(dt, t, { dive, under, depth, view }) {
  builtThisFrame = 0;
  // 海面の上（高さ 60m まで）から水深 40m より浅い海を見ているときも、生き物・サンゴ・海底を動かす。
  // そのときは画面に重ねず、海面ごしに透かして見るための画像（sea.js の refractPass）に描く。位置はカメラの高さ（マイナスの水深）で計算する
  above = dive && !under && !S.intro && view !== undefined && view < 0 && view > -60 && floorAt(S.x * 1000, S.z * 1000) < 40;
  if (above) depth = view;
  active = dive && (under || above);
  if (REEF.pelagic) REEF.pelagic(dt, t, { dive: dive && !S.intro, under, depth });   // 外洋の生き物（pelagic.js）は、深い海の上でも動かす
  nearestWhale.d = Infinity;
  if (!dive || !(dive && (under || above))) REEF.hide && REEF.hide();   // サンゴ礁の生き物（reef.js）も隠す
  if (!dive) { if (cells.size) clearAll(); wanderers.forEach(release); bed.visible = plank.visible = marineSnow.visible = silt.visible = false; siltLevel = 0; return; }
  if (!active) { if (cells.size) clearAll(); wanderers.forEach(release); bed.visible = plank.visible = marineSnow.visible = silt.visible = false; siltLevel = 0;
    if (S.intro) {
      // 準備: 「準備中」の知らせを画面に出してから（2 フレーム待つ）、まとめて作る
      if (!warmed) { if (warmWait++ === 0) UI.toast('潜航の準備をしています…'); else if (warmWait > 2) { warmAll(); warmed = true; } }   // 降下の演出の間は、ほかには作らない（画面が止まらないように）
    }
    return; }
  frameNo++;
  const px = S.x * 1000, pz = S.z * 1000, floorHere = floorAt(px, pz);
  // 潜水艇の速さ（m/秒。ワープのような瞬間移動は数えない）
  if (lastP && dt > 0) { const v = Math.hypot(px - lastP[0], pz - lastP[1], depth - lastP[2]) / dt; if (v < 2000) pSpeed += (v - pSpeed) * Math.min(1, dt * 5); }
  lastP = [px, pz, depth];
  const lampOn = depth > 150 && S.lamp !== false;
  syncCells(px, pz, depth, floorHere);
  updateBed(px, pz, depth, floorHere - depth < 120);
  if (REEF.frame) REEF.frame(dt, t, px, pz, depth, bed.visible && (floorHere < 45 || nearPoint(px, pz)));   // サンゴ礁の生き物（reef.js）
  camera.getWorldDirection(fwd);
  shown = 0;
  Object.values(FAR).forEach(f => { if (f) f.n = 0; });                // まとめて描く遠くの個体を、毎フレーム数え直す
  const now = Date.now() / 1000;
  const step = c => {
    const def = c.def, h = habitat(def), size = sizeOf(def), beh = def.behavior;
    if (!enabled(def)) { release(c); return; }
    if (c.eaten) return;                                               // 食べられた個体（区画を作り直すまで出ない）
    if (beh === 'migrate') wanderAt(c, now);
    const dx = c.x - px, dz = c.z - pz, dy = -(c.depth - depth), d = Math.hypot(dx, dy, dz);
    if (beh === 'migrate' && d < nearestWhale.d) { nearestWhale.d = d; const a = Math.atan2(dx, dz) - Math.atan2(fwd.x, fwd.z); nearestWhale.pan = Math.sin(a); }
    // 体は近くの個体にだけ（遠ざかったら返す）
    const R = Math.max(45, size * 6);
    if (!c.body) { if (d > R || !(c.body = takeBody(def))) return; scene.add(c.body.group); if (beh === 'crawl') c.trail = makeTrail(c); }
    else if (d > R * 1.25) { release(c); return; }
    shown++;
    if (def.kind === 'amphipod') preyNow.push(c);
    // 動き方は種類ごと
    const base = def.speed != null ? def.speed : 0.12;
    let sp = base;
    if (beh !== 'migrate') {
      // 寄ってくる生き物（ヨコエビ）: 潜水艇が近くで止まっていると、まわりに集まる
      const lure = beh === 'bait' && d < 25 && pSpeed < 3;
      // 驚く生き物（ハダカイワシの群れ）: ライトを当てて近づくと散る
      c.scare = (c.scare || 0) + ((beh === 'school' && d < (lampOn ? 7 : 3) ? 1 : 0) - (c.scare || 0)) * Math.min(1, dt * (c.scare > 0.5 ? 0.6 : 3));
      const shy = size < 1 && d < 3 && !lure ? 1 : 0;
      // 狩りをする生き物（スネイルフィッシュ）: 近くのヨコエビを追いかけて食べる。食べたあとはしばらく休む
      if (beh === 'hunt' && (c.full || 0) < t) {
        const tg = c.target;
        if (!tg || tg.eaten || !tg.body || Math.hypot(tg.x - c.x, tg.z - c.z) > 5) {
          c.target = null; let best = 4;
          preyPrev.forEach(q => { const e = Math.hypot(q.x - c.x, q.z - c.z, q.depth - c.depth); if (!q.eaten && q.body && e < best) { best = e; c.target = q; } });
        }
      } else c.target = null;
      const prey = c.target;
      sp = base > 0 ? base + shy * 0.25 + (c.scare || 0) * 0.6 + (lure ? 0.2 : 0) + (prey ? 0.3 : 0) : 0;
      if (sp > 0) {
        const away = Math.hypot(c.x - c.hx, c.z - c.hz), leash = beh === 'crawl' ? 8 : def.roam || Math.max(6, size * 4);
        let turn = beh === 'crawl' ? Math.sin(t * 0.05 + c.seed) * 0.05 : Math.sin(t * 0.3 + c.seed) * 0.4 * Math.min(1, 0.4 / Math.max(0.4, size)) * (def.agility || 1) + (shy ? 1.2 : 0);
        const steer = (tx, tz, k) => { const want = Math.atan2(tx - c.x, tz - c.z), diff = Math.atan2(Math.sin(want - c.heading), Math.cos(want - c.heading)); turn += Math.max(-k, Math.min(k, diff * 2)); };
        if (prey) steer(prey.x, prey.z, 3);
        else if (lure) steer(px + fwd.x * 1.5, pz + fwd.z * 1.5, 2.5);
        else if (away > leash) steer(c.hx, c.hz, beh === 'crawl' ? 0.1 : 0.6 * (def.agility || 1));
        if (c.scare > 0.3) steer(c.x + dx, c.z + dz, 1.5);              // 潜水艇から離れる向きへ
        c.heading += turn * dt;
        c.x += Math.sin(c.heading) * sp * dt; c.z += Math.cos(c.heading) * sp * dt;
      }
      const floorC = seabedY(c.x, c.z);
      if (h === 'onFloor') c.depth = floorC;                             // 海底にいる（原点が足元）
      else {
        c.depth += Math.sin(t * 0.5 + c.seed) * 0.05 * dt;
        if (prey) c.depth += (prey.depth - c.depth) * Math.min(1, dt * 2);
        else if (lure) c.depth += (depth + 0.8 - c.depth) * Math.min(1, dt * 0.5);   // 潜水艇の少し下へ
        else if (h === 'nearFloor') c.depth += (floorC - 1.5 - c.depth) * Math.min(1, dt * 0.3);   // 海底の少し上を保つ
        else c.depth += (c.hd - c.depth) * Math.min(1, dt * 0.05);     // 水中の生き物は住みかの深さへゆっくり戻る
        if (c.depth > floorC - 0.3 - size * 0.3) c.depth = floorC - 0.3 - size * 0.3;
      }
      if (prey && Math.hypot(prey.x - c.x, prey.z - c.z, prey.depth - c.depth) < size * 1.2) {   // 食べた
        prey.eaten = true; release(prey); c.target = null; c.full = t + 25;
        if (d < 15 && !saidHunt) { saidHunt = true; UI.toast(`${def.name}がヨコエビを食べた。超深海では、ヨコエビがスネイルフィッシュのおもな食べ物になっている。`); }
      }
    }
    // 近景の座標（プレイヤーが原点、メートル単位、上が +y）
    const g = c.body.group;
    g.position.set(c.x - px, -(c.depth - depth) + (h === 'onFloor' ? 0 : Math.sin(t * 1.6 + c.seed) * 0.03 * Math.min(1, size * 5)), c.z - pz);
    g.rotation.set(c.pitch || 0, c.heading, h === 'onFloor' || beh === 'school' ? 0 : Math.sin(t * 0.7 + c.seed) * 0.08, 'YXZ');   // 群れは全体を傾けない（1 枚の板のように揺れて見えるので）
    if (c.trail) updateTrail(c, px, pz, depth);
    // 画面で小さく見えるもの・霧で薄いものほど、形の更新を間引く。とても小さく見えるものは、種類ごとにまとめて描く
    const look = size / Math.max(0.1, d) * Math.exp(-Math.pow(scene.fog.density * d, 2)), every = look > 0.4 ? 1 : look > 0.12 ? 2 : look > 0.04 ? 3 : 5;
    const far = look < FAR_LOOK ? farFor(def) : null;
    if (far && far.n < FAR_MAX) {
      g.visible = false;
      FAR_M.compose(g.position, g.quaternion, ONE);
      if (far.solid) far.solid.setMatrixAt(far.n, FAR_M);
      if (far.clear) far.clear.setMatrixAt(far.n, FAR_M);
      far.n++;
    } else {
      g.visible = true;
      if ((frameNo + c.slot) % every === 0) c.body.animate(t + c.seed, sp, c);
    }
    // 出会い: 画面の正面近くに、ある程度の大きさで見えたとき（体の大きさの 40 倍の距離まで）。
    // ライトを消しているときは、自分で光る生き物（glow）だけが見える
    const near = Math.min(LAMP_RANGE, Math.max(4, (def.view || size) * 40));
    const seen = depth < 150 || lampOn || def.glow;
    if (seen && d < near && ((c.x - px) * fwd.x + dy * fwd.y + (c.z - pz) * fwd.z) / Math.max(d, 0.01) > 0.6) meet(def, depth);
  };
  updateSites(px, pz, depth);
  preyPrev = preyNow; preyNow = [];
  cells.forEach(recs => recs.forEach(step));
  wanderers.forEach(step);
  Object.values(FAR).forEach(f => { if (!f) return; [f.solid, f.clear].forEach(im => { if (!im) return; im.count = f.n; im.visible = f.n > 0; if (f.n) im.instanceMatrix.needsUpdate = true; }); });
  updatePlankton(dt, px, pz, depth, pSpeed, lampOn);
  updateParticles(dt, t, px, pz, depth, lampOn, seabedY(px, pz) - depth);
  if (nearestWhale.d < 12000 && !heardWhale && S.sound) {             // 初めてクジラの音が届いたときだけ、何の音か知らせる
    heardWhale = true; UI.toast('カチッ、カチッ…と規則正しい音が聞こえる。マッコウクジラが獲物を探す音だ。音が大きくなる方へ進めば会えるかもしれない。');
  }
  // 水の色・見通し・光（海面の上から見ているときは、海底の近くの深さの光で照らす）
  const ld = above ? Math.min(floorHere * 0.6, 30) : depth;
  T.waterColor(ld, water, S.x, S.z);
  const turb = T.turbidity(S.x, S.z) * Math.exp(-ld / 40);            // 場所ごとの濁り（港の中・河口・砕ける波の近く）
  // 舞い上がった泥が濃いと、見通しが悪くなり、水が泥の色になる（ライトが泥に当たって明るく濁る）
  // 舞い上がった泥の色: 深海ではライトに照らされた暗い泥色。日の光が届く浅い海では、白い砂が日に照らされて明るく白っぽく濁る
  siltCol.setHex(0x1c1915).multiplyScalar(lampOn ? 1 : 0.25).lerp(water.clone().lerp(new THREE.Color(0.78, 0.8, 0.72), 0.45), Math.exp(-ld / 40));
  scene.fog.color.copy(water).lerp(siltCol, siltLevel * 0.8);
  // 見通し: 外洋に面した浅い礁の澄んだ水は、30m 以上先まで見える（深い所は 0.05 のまま）
  // 浅瀬（美しさ優先）は、さらに澄んで遠くまで見える
  const clear = 1 - Math.min(1, Math.max(0, (Math.max(depth, floorHere) - 40) / 40));
  scene.fog.density = (0.05 - 0.028 * clear + 0.3 * siltLevel) * (1 + 2.2 * turb);
  // 上からの光は、赤 → 緑 → 青の順に早く消える（浅瀬は赤・黄を多く残す: world.js の sunK）。雲の影の下では弱い（浅瀬は弱め方を控えめに）
  const bk = T.beautyK(ld), sk = T.sunK(ld);
  const cs = window.__SEA && window.__SEA.cloudShadeJS ? window.__SEA.cloudShadeJS(px / 1000, pz / 1000, t) : 1;
  sun.intensity = 1.6 * (1 + (cs - 1) * (1 - 0.65 * bk)) * (1 - 0.2 * bk);   // 浅瀬は赤・黄が多く残る分、少し弱めて白飛びを防ぐ
  sun.color.setRGB(0.75 * Math.exp(-sk[0] * ld), 0.9 * Math.exp(-sk[1] * ld), 0.94 * Math.exp(-sk[2] * ld));
  ABS_K.x = 1 - 0.65 * bk; ABS_K.y = ABS_K.z = 1 - 0.4 * bk;          // 見る向きの吸収も弱める
  updateShafts(t, px, pz, depth, floorHere, lampOn);
  updateSparkles(t, px, pz, depth);
  CAU.uCauI.value = ld < 60 ? 1.7 + 0.4 * bk : 0;                     // 光の網目（深いほど大きくぼやけ、弱くなる。浅瀬は明るく）
  CAU.uCauB.value = bk;
  CAU.uCauC.value.copy(sun.color).multiplyScalar(sun.intensity);
  CAU.uCauP.value.set(0, -depth, 0);
  CAU.uCauCS.value = cs;
  if (CAU.uCauI.value > 0) updateCaustics(t, px, pz, depth);
  // まわりの水から届く散乱光（あらゆる向きから来るので、影の側も青く見える）。これも赤から消える
  ambient.color.setRGB(0.10 + 0.9 * Math.exp(-sk[0] * ld), 0.165 + 0.9 * Math.exp(-sk[1] * ld), 0.21 + 0.9 * Math.exp(-sk[2] * ld));
  ambient.intensity = (0.35 + 0.6 * Math.exp(-ld / 60)) * (ld > 150 && !lampOn ? 0.12 : 1) * (1 - 0.2 * bk);   // ライトを消すと深海は真っ暗
  // ライトはカメラと一緒に向きを変え、少し内向きに、前方 12m あたりで重なるように向ける
  fill.intensity = lampOn ? 0.25 : 0;
  lamps.forEach((l, i) => {
    l.intensity = lampOn ? 1.0 : 0;
    l.position.copy(LAMP_AT[i]).applyQuaternion(camera.quaternion);
    l.target.position.copy(fwd).multiplyScalar(12);
    const b = beams[i]; b.visible = lampOn; b.position.copy(l.position); b.lookAt(l.target.position);
  });
  beamMat.uniforms.uI.value = 0.045 + 0.1 * siltLevel;               // 泥で濁ると、光の筋がはっきり見える
  beamMat.uniforms.uFogDen.value = scene.fog.density;
  if (depth > 60) prewarm(depth, false);                              // 深い所の生き物は、60m より深く潜ってから準備する（入水の直後に画面が止まらないように）
}
// 撮影: 画面の中央付近に、いちばん大きく写っている生き物（写真を図鑑に貼るため）
function subject() {
  if (!active) return null;
  camera.getWorldDirection(fwd);
  const px = S.x * 1000, pz = S.z * 1000, depth = Math.max(0, S.depth), lampOn = depth > 150 && S.lamp !== false;
  let best = null, score = 0;
  const check = c => {
    if (!c.body) return;
    const def = c.def, v = def.view || sizeOf(def), dx = c.x - px, dy = -(c.depth - depth), dz = c.z - pz, d = Math.max(0.01, Math.hypot(dx, dy, dz));
    if (!(depth < 150 || lampOn || def.glow) || d > Math.min(LAMP_RANGE, Math.max(4, v * 40))) return;
    const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d; if (dot < 0.8) return;
    if (v / d * dot > score) { score = v / d * dot; best = c; }
  };
  cells.forEach(r => r.forEach(check)); wanderers.forEach(check);
  const rs = REEF.subject && REEF.subject(fwd, px, pz, depth);         // サンゴ礁の生き物（reef.js）
  if (rs && rs.score > score) return { def: rs.def, depth };
  return best && { def: best.def, depth };
}
function meet(def, depth) {
  if (above || met.has(def.kind)) return;                             // 図鑑に載るのは、海に潜って出会ったときだけ
  met.add(def.kind);
  const Z = window.__ZUKAN;
  const first = Z ? Z.meet(def, depth) : false;                      // 初めての出会いは図鑑が知らせる
  if (!first) UI.toast(`${def.name}に出会いました`);
}
function render() {
  if (REEF.renderAir) REEF.renderAir();                                 // 海面より上に出た外洋の生き物（イルカのジャンプ・トビウオ）
  if (!active || above || (!shown && !bed.visible && !plank.visible && !marineSnow.visible)) return;
  // 海の中でも、近くの海底の縁（約 60〜90m）はなめらかに透明にする（水のかすみ方の計算が、まわりの地形と少し違い、縁が帯に見えるため）
  BED_EDGE.value = 1; FADE.value.set(BED_R * 0.66, BED_R * 0.97);
  draw();
  BED_EDGE.value = 0;
}
function draw() {
  cam.fov = camera.fov; cam.aspect = camera.aspect; cam.updateProjectionMatrix();
  cam.quaternion.copy(camera.quaternion); cam.position.set(0, 0, 0);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, cam);
  renderer.autoClear = true;
}
// 海面の上から見ているとき: 海面ごしに透かして見る画像（sea.js の refractPass が描いている最中）に重ねる。
// 水の中の見通し・吸収は海面の側で計算するので、ここでは霧をかけない
function renderRefr() {
  if (!active || !above) return;
  const fd = scene.fog.density; scene.fog.density = 0;
  // 近くの海底の縁は透明にし、サンゴは中心に近いものだけにする（外の地形との境目が、まっすぐな線に見えないように）
  // 海底・岩・サンゴは、潜水艇のまわりの円の外へ向かってなめらかに消す（サンゴを置き切れた距離の内側で消し終える）
  const r1 = Math.max(20, Math.min(BED_R * 0.92, coralReach * 0.95));
  FADE.value.set(r1 * 0.55, r1);
  BED_EDGE.value = 1;
  draw();
  BED_EDGE.value = 0; scene.fog.density = fd;
}
// 確認用: 目の前に1匹出す
function demo(kind) {
  const def = ALL.find(d => !kind || d.kind === kind); if (!def) return null;
  camera.getWorldDirection(fwd);
  const dist = Math.max(2.2, sizeOf(def) * 3), x = S.x * 1000 + fwd.x * dist, z = S.z * 1000 + fwd.z * dist;
  const rec = newRec(def, x, z, Math.max(0, S.depth) - fwd.y * dist, Math.random);
  cells.set('demo', (cells.get('demo') || []).concat(rec));
  return rec;
}

// ---------- プレビュー中だけ: 表示する生き物を選ぶパネル ----------
if (PREVIEW && ALL.length) {
  setTimeout(() => UI.toast('プレビュー表示中: 公開前の生き物も表示されます（?preview=off で元に戻ります）'), 1200);
  const btn = document.createElement('button');
  btn.className = 'btn more'; btn.type = 'button'; btn.id = 'lifeBtn'; btn.textContent = '生き物の表示'; btn.setAttribute('aria-expanded', 'false');
  $('controls').appendChild(btn);
  const panel = document.createElement('section');
  panel.className = 'hud'; panel.id = 'lifeSel'; panel.hidden = true; panel.setAttribute('aria-label', '生き物の表示');
  const fmt = n => n.toLocaleString('ja-JP');
  panel.innerHTML = `<header><h3>生き物の表示（プレビュー）</h3><button class="btn" id="lifeClose" type="button" aria-label="閉じる">×</button></header>
    <p>オフにした生き物は出なくなります。この設定はこのブラウザだけのもので、ほかの人の表示は変わりません。公開する生き物が決まったら、その生き物の「公開前」の印を外します。</p>
    <div class="row"><button class="btn" id="lifeAll" type="button">すべて表示</button><button class="btn" id="lifeNone" type="button">すべて隠す</button></div>
    <ul>${ALL.map(d => `<li><label><input type="checkbox" id="life-${d.kind}" data-kind="${d.kind}"${enabled(d) ? ' checked' : ''}> <b>${d.name}</b> <span>${fmt(d.from)}–${fmt(d.to)} m</span></label></li>`).join('')}</ul>`;
  document.body.appendChild(panel);
  const save = () => { try { localStorage.setItem(OFF_KEY, JSON.stringify([...off])); } catch (_) {} };
  const sync = () => panel.querySelectorAll('input[data-kind]').forEach(cb => { cb.checked = !off.has(cb.dataset.kind); });
  panel.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.kind; if (!k) return; e.target.checked ? off.delete(k) : off.add(k); save(); });
  btn.onclick = () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', !panel.hidden); };
  $('lifeClose').onclick = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  $('lifeAll').onclick = () => { off.clear(); save(); sync(); };
  $('lifeNone').onclick = () => { ALL.forEach(d => off.add(d.kind)); save(); sync(); };
}

// サンゴ礁の生き物（reef.js）のための窓口。reef.js が rebuild / frame / hide を入れる
const REEF = { rebuild: null, frame: null, hide: null, subject: null, pelagic: null, renderAir: null, warm: null };
window.__LIFE = {
  reefApi: { spireH: (x, z) => spireH(x, z), coralGeos, CORAL_COLS, REEF, scene, withCaustics, fadeByDistance, BED_R, floorAt: (x, z) => floorAt(x, z), seabedY: (x, z) => seabedY(x, z), PREVIEW, get above() { return above; } },
  update, render, renderRefr, demo, dispose, subject, pool, species: ALL, bed, rocks, whale: nearestWhale, wanderers, sites,
  get silt() { return siltLevel; }, siltColor: siltCol, obstacleDepth, seabedY: (x, z) => seabedY(x, z),
  get live() { const a = []; cells.forEach(r => r.forEach(c => c.body && a.push(c))); wanderers.forEach(c => c.body && a.push(c)); return a; },
  get cells() { return cells; }
};
})();
