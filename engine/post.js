// 仕上げ（後処理）: 画面をいったん明るさの幅の広い画像（HDR）に描き、
//   1) まぶしい所（太陽・海面のきらめき・光る生き物・ライト）から光をにじませる（ブルーム）
//   2) 景色・生き物・海・空をまとめて、同じ明るさの変換（ACES トーンマッピング）で画面の色にする
//   3) 周辺をわずかに暗くする（レンズらしさ）。浅瀬の水中では、色を少し鮮やかに整える（美しさ優先）
// 画質「低」や、HDR の画像を描けない端末では使わず、これまでどおり直接画面に描く
(() => {
const T = window.__TRENCH, S = window.__DIVE, R = T.renderer;
const isGL2 = R.capabilities.isWebGL2;
const canHDR = isGL2 ? !!R.extensions.get('EXT_color_buffer_float') : !!(R.extensions.get('OES_texture_half_float') && R.extensions.get('EXT_color_buffer_half_float'));
const EXPOSURE = 0.8, STRENGTH = 0.55, LEVELS = 5;

// 画面いっぱいの三角形 1 枚で、各処理を描く
const VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const quad = new THREE.Mesh(tri); quad.frustumCulled = false;
const qScene = new THREE.Scene(); qScene.add(quad); const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mat = (frag, extra = {}) => new THREE.ShaderMaterial(Object.assign({ vertexShader: VS, fragmentShader: frag, depthTest: false, depthWrite: false, uniforms: { t: { value: null }, px: { value: new THREE.Vector2() } } }, extra));
// まぶしい所だけを取り出す（明るさ 1 を超えた分。半分の大きさで、4 点の平均）
const brightM = mat(`uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
  void main(){
    vec3 c = (texture2D(t, vUv + px * vec2(-0.5, -0.5)).rgb + texture2D(t, vUv + px * vec2(0.5, -0.5)).rgb + texture2D(t, vUv + px * vec2(-0.5, 0.5)).rgb + texture2D(t, vUv + px * vec2(0.5, 0.5)).rgb) * 0.25;
    c = clamp(c, 0.0, 60.0); if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);   // 壊れた値（NaN）がにじみに広がらないように
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(min(c * max(l - 1.0, 0.0) / max(l, 1e-4), vec3(40.0)), 1.0);
  }`);
// 縮めながらぼかす / 広げながら重ねる（段ごとに大きくにじむ）
const downM = mat(`uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
  void main(){ gl_FragColor = vec4((texture2D(t, vUv + px * vec2(-1.0, -1.0)).rgb + texture2D(t, vUv + px * vec2(1.0, -1.0)).rgb + texture2D(t, vUv + px * vec2(-1.0, 1.0)).rgb + texture2D(t, vUv + px * vec2(1.0, 1.0)).rgb) * 0.25, 1.0); }`);
const upM = mat(`uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
  void main(){
    vec3 c = texture2D(t, vUv).rgb * 4.0;
    c += (texture2D(t, vUv + vec2(px.x, 0.0)).rgb + texture2D(t, vUv - vec2(px.x, 0.0)).rgb + texture2D(t, vUv + vec2(0.0, px.y)).rgb + texture2D(t, vUv - vec2(0.0, px.y)).rgb) * 2.0;
    c += texture2D(t, vUv + px).rgb + texture2D(t, vUv - px).rgb + texture2D(t, vUv + vec2(px.x, -px.y)).rgb + texture2D(t, vUv + vec2(-px.x, px.y)).rgb;
    gl_FragColor = vec4(c / 16.0, 1.0);
  }`, { blending: THREE.AdditiveBlending, transparent: true });
// まとめ: 景色＋にじみ → 明るさの変換（ACES）→ 周辺を少し暗く
const compM = mat(`uniform sampler2D t, b; uniform float uExp, uStr, uBeau; uniform vec2 px; varying vec2 vUv;
  vec3 aces(vec3 c){ return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); }
  // 壊れた値（NaN・半精度で表せない明るさ）の画素は、黒い点になるので、まわりの画素の平均で埋める
  //（遠くの細い枝サンゴのように、画素より細い面で計算が壊れることがある）
  // 書き込むときに NaN が 0 になる GPU もあるので、ちょうど 0（真っ黒）も壊れた画素とみなす（暗い深海では、まわりも暗いので見た目は変わらない）
  bool ok(vec3 c){ return c.r == c.r && c.g == c.g && c.b == c.b && max(c.r, max(c.g, c.b)) < 6.0e4 && c.r + c.g + c.b > 0.0; }
  void main(){
    vec3 c = texture2D(t, vUv).rgb;
    if (!ok(c)) {
      vec3 s = vec3(0.0); float n = 0.0;
      for (int i = 0; i < 12; i++) {                                     // まわりの、壊れていない画素の平均
        float fi = float(i), r = 1.0 + floor(fi / 4.0), k = mod(fi, 4.0);   // 1〜3 画素先の、上下左右
        vec2 d = (k < 0.5 ? vec2(1.0, 0.0) : k < 1.5 ? vec2(-1.0, 0.0) : k < 2.5 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)) * r;
        vec3 q = texture2D(t, vUv + d * px).rgb;
        if (ok(q)) { s += q; n += 1.0; }
      }
      c = n > 0.0 ? s / n : vec3(0.0);
    }
    c += texture2D(b, vUv).rgb * uStr;
    c = aces(c * uExp);
    if (uBeau > 0.001) {                                                // 浅瀬の水中（美しさ優先）: 色を少し鮮やかに、明るい所を少し暖かく、暗い所を少し青緑に
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 g = mix(vec3(l), c, 1.0 + 0.2 * uBeau);
      g *= mix(vec3(1.0), mix(vec3(0.96, 1.0, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.15, 0.75, l)), uBeau);
      c = clamp(g, 0.0, 1.0);
    }
    vec2 q = vUv - 0.5; c *= 1.0 - (0.22 + 0.12 * uBeau) * dot(q, q) * 2.0;
    gl_FragColor = vec4(c, 1.0);
  }`);
compM.uniforms.b = { value: null }; compM.uniforms.uExp = { value: EXPOSURE }; compM.uniforms.uStr = { value: STRENGTH }; compM.uniforms.uBeau = { value: 0 };

let rt = null, mips = [], active = false;
const size = new THREE.Vector2();
function makeTargets() {
  [rt, ...mips].forEach(t => t && t.dispose()); mips = [];
  R.getDrawingBufferSize(size);
  // stencilBuffer: 奥行きの精度を 24bit にするため（無いと 16bit になり、1km 先では数 m の差を見分けられず、
  // 海面のすぐ下の礁が海面の上に四角く出る）
  const type = isGL2 ? THREE.HalfFloatType : THREE.HalfFloatType, opt = { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: true };
  rt = isGL2 && S.quality === 'high' && THREE.WebGLMultisampleRenderTarget ? new THREE.WebGLMultisampleRenderTarget(size.x, size.y, Object.assign({}, opt)) : new THREE.WebGLRenderTarget(size.x, size.y, opt);
  if (rt.samples !== undefined) rt.samples = 4;                        // 縁のギザギザを減らす（高画質）
  let w = size.x, h = size.y;
  for (let i = 0; i < LEVELS; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); mips.push(new THREE.WebGLRenderTarget(w, h, Object.assign({}, opt, { depthBuffer: false, stencilBuffer: false }))); }
}
function pass(m, src, dst, px) { quad.material = m; m.uniforms.t.value = src.texture || src; if (px) m.uniforms.px.value.copy(px); R.setRenderTarget(dst); R.render(qScene, qCam); }

// 画質に合わせて、使うかどうかを決める（ui.js の画質の切り替えから呼ぶ）
function apply() {
  active = canHDR && S.quality !== 'low';
  if (active) makeTargets(); else { [rt, ...mips].forEach(t => t && t.dispose()); rt = null; mips = []; }
  window.__SEA && window.__SEA.setToneMap(!active);                    // 後処理がないときは、海と空がそれぞれ明るさを変換する
}
addEventListener('resize', () => { if (active) makeTargets(); });
// 毎フレーム: begin() のあとに描いたものは HDR の画像に入る。end() で画面へ
function begin() { if (!active) return false; R.setRenderTarget(rt); return true; }
function end() {
  if (!active) return;
  const v = new THREE.Vector2();
  pass(brightM, rt, mips[0], v.set(1 / rt.width, 1 / rt.height));
  for (let i = 1; i < LEVELS; i++) pass(downM, mips[i - 1], mips[i], v.set(1 / mips[i - 1].width, 1 / mips[i - 1].height));
  for (let i = LEVELS - 1; i > 0; i--) { R.autoClear = false; pass(upM, mips[i], mips[i - 1], v.set(1 / mips[i].width, 1 / mips[i].height)); R.autoClear = true; }
  const beau = S.depth > 0.5 && T.beautyK ? T.beautyK(S.depth) : 0;   // 浅瀬の水中は、光のにじみを強め、色を整える
  compM.uniforms.uBeau.value = beau; compM.uniforms.uStr.value = STRENGTH * (1 + 0.5 * beau);
  quad.material = compM; compM.uniforms.t.value = rt.texture; compM.uniforms.b.value = mips[0].texture; compM.uniforms.px.value.set(1 / rt.width, 1 / rt.height);
  R.setRenderTarget(null); R.render(qScene, qCam);
}
window.__POST = { begin, end, apply, get active() { return active; }, canHDR };
apply();
})();
