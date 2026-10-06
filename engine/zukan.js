// 生き物図鑑と実績。出会った生き物と、達成した実績をこのブラウザに記録する（海ごと）
(() => {
const T = window.__TRENCH, S = window.__DIVE, SEA = window.SEA, UI = window.__UI, LIFE = window.__LIFE;
const { renderer, CD } = T, nf = UI.nf;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 記録（このブラウザだけ） ----------
const KEY = `deepsea-${SEA.id}-`;
const load = k => { try { return JSON.parse(localStorage.getItem(KEY + k) || '{}') || {}; } catch (_) { return {}; } };
const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (_) {} };
const book = load('zukan');      // kind → { at: 日時, depth: 出会った水深 }
const done = load('achv');       // id → { at: 日時 }
const photos = load('photo');    // kind → { img: 写真（JPEG のデータ URL）, at, depth }
const SPECIES = ((LIFE && LIFE.species) || []).concat((window.__REEF && window.__REEF.species) || []);   // 深海の生き物と、サンゴ礁の生き物（reef.js）
const found = () => SPECIES.filter(d => book[d.kind]).length;
const shotN = () => SPECIES.filter(d => photos[d.kind]).length;
// 生き物がいない（公開前の）ときは、図鑑に関係する実績は出さない
const ACHV = (SEA.achievements || []).filter(a => ((a.when.zukan == null && a.when.photo == null) || SPECIES.length)
  && (!a.when.site || (LIFE && LIFE.sites.some(s => s.kind === a.when.site))));   // 公開前の見どころの実績は出さない
const fmtDate = at => new Date(at).toLocaleDateString('ja-JP');

// ---------- 知らせ（画面上部の帯） ----------
const banner = document.createElement('div'); banner.id = 'award'; banner.setAttribute('role', 'status'); document.body.appendChild(banner);
const queue = []; let busy = false;
function announce(kind, title, sub) {
  queue.push({ kind, title, sub });
  if (!busy) next();
}
function next() {
  const a = queue.shift(); if (!a) { busy = false; return; }
  busy = true;
  banner.className = a.kind === 'achv' ? 'achv' : 'zukan';
  banner.innerHTML = `<small>${a.kind === 'achv' ? '実績解除' : '図鑑に登録'}</small><b>${esc(a.title)}</b>${a.sub ? `<span>${esc(a.sub)}</span>` : ''}`;
  requestAnimationFrame(() => banner.classList.add('show'));
  window.__AUDIO?.chime?.(a.kind);
  setTimeout(() => { banner.classList.remove('show'); setTimeout(next, 450); }, 4200);
}

// ---------- 図鑑ボタンとパネル ----------
const btn = document.createElement('button');
btn.className = 'btn'; btn.type = 'button'; btn.id = 'zukanBtn'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'zukan');
document.getElementById('moreBtn').before(btn);
const panel = document.createElement('section');
panel.className = 'hud'; panel.id = 'zukan'; panel.hidden = true; panel.setAttribute('aria-label', '図鑑と実績');
panel.innerHTML = `<header><h3>深海図鑑</h3><span id="zkCount"></span><button class="btn" id="zkClose" type="button" aria-label="閉じる">×</button></header>
  <div class="tabs" role="tablist">
    <button class="btn" type="button" role="tab" id="zkTabLife" aria-selected="true">生き物</button>
    <button class="btn" type="button" role="tab" id="zkTabAchv" aria-selected="false">実績</button>
  </div>
  <div id="zkLife" role="tabpanel"></div>
  <div id="zkAchv" role="tabpanel" hidden></div>`;
document.body.appendChild(panel);
let tab = SPECIES.length ? 'life' : 'achv';
const achieved = () => ACHV.filter(a => done[a.id]).length;
const progress = () => found() + achieved() * 100;               // 前に図鑑を開いたときから増えたかどうかの目印
function syncBtn() {
  btn.textContent = SPECIES.length ? `図鑑 ${found()}/${SPECIES.length}` : `実績 ${achieved()}/${ACHV.length}`;
  btn.classList.toggle('new', (load('seen').n || 0) !== progress());   // 新しい登録・実績があれば印を付ける
}
function markSeen() { save('seen', { n: progress() }); }
const where = d => d.where || `水深 ${nf(d.from)}〜${nf(d.to)} m の${d.habitat === 'onFloor' ? '海底' : d.habitat === 'nearFloor' ? '海底の近く' : '水中'}`;
function renderLife() {
  if (!SPECIES.length) { $('zkLife').innerHTML = '<p class="none">この海の生き物は準備中です。</p>'; return; }
  $('zkLife').innerHTML = `<p class="lead">潜って出会った生き物が登録されます。ライトが届く距離で、正面から見ると「出会い」になります。「撮影」（P キー）で写した写真は、ここに貼られます。</p><ul class="cards">${SPECIES.map(d => {
    const b = book[d.kind];
    return `<li class="${b ? 'got' : 'unk'}${photos[d.kind] ? ' shot' : ''}"><img alt="" data-kind="${d.kind}">${b
      ? `<b>${esc(d.name)}</b><i>${esc(d.sci || '')}</i><p>${esc(d.note)}</p><small>${fmtDate(b.at)} · 水深 ${nf(b.depth)} m で発見</small>`
      : `<b>？？？</b><p>${where(d)}${d.rare ? '。めったに出会えない' : ''}</p>`}</li>`;
  }).join('')}</ul>`;
  $('zkLife').querySelectorAll('img[data-kind]').forEach(img => photos[img.dataset.kind] ? (img.src = photos[img.dataset.kind].img) : thumb(img.dataset.kind, img));
}
function renderAchv() {
  $('zkAchv').innerHTML = `<ul class="achv">${ACHV.map(a => {
    const g = done[a.id];
    return `<li class="${g ? 'got' : ''}"><span class="mark" aria-hidden="true">${g ? '◆' : '◇'}</span><b>${esc(a.title)}</b><p>${esc(g || !a.hint ? a.note : a.hint)}</p>${g ? `<small>${fmtDate(g.at)}</small>` : ''}</li>`;
  }).join('')}</ul>`;
}
function show(which) {
  tab = which;
  $('zkTabLife').setAttribute('aria-selected', which === 'life'); $('zkTabAchv').setAttribute('aria-selected', which === 'achv');
  $('zkLife').hidden = which !== 'life'; $('zkAchv').hidden = which !== 'achv';
  which === 'life' ? renderLife() : renderAchv();
}
// 図鑑の下端は、操作ボタンの帯のすぐ上にする（帯は画面の幅で 1〜2 段に変わるので、開くたび・画面の大きさが変わるたびに測る）
function fitPanel() {
  const c = document.getElementById('controls'); if (!c) return;
  const top = c.getBoundingClientRect().top;
  if (top > 0) panel.style.setProperty('--zk-bottom', `${Math.max(12, innerHeight - top + 10)}px`);
}
addEventListener('resize', () => { if (!panel.hidden) fitPanel(); });
addEventListener('keydown', e => { if (e.code === 'Escape' && !panel.hidden) open(false); });   // Esc でも閉じる
function open(v) {
  panel.hidden = !v; btn.setAttribute('aria-expanded', v);
  if (v) {
    fitPanel();
    $('zkCount').textContent = `${SPECIES.length ? `生き物 ${found()}/${SPECIES.length} · 写真 ${shotN()}/${SPECIES.length} · ` : ''}実績 ${achieved()}/${ACHV.length}`;
    show(tab); markSeen(); syncBtn();
  }
}
btn.onclick = () => open(panel.hidden);
$('zkClose').onclick = () => open(false);
$('zkTabLife').onclick = () => show('life');
$('zkTabAchv').onclick = () => show('achv');
if (!SPECIES.length) $('zkTabLife').hidden = true;
syncBtn();

// ---------- 図鑑の絵: その場で 3D の体を作って撮る（出会っていない生き物は影絵） ----------
const shots = {};                // kind → { color, shadow }（データ URL）
const TW = 240, TH = 180;
const rt = new THREE.WebGLRenderTarget(TW, TH);
const tScene = new THREE.Scene();
tScene.add(new THREE.HemisphereLight(0xdff2ff, 0x2a3640, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(2, 3, 2.5); tScene.add(key);
const rim = new THREE.DirectionalLight(0x9fd8ff, 0.5); rim.position.set(-3, 1, -2); tScene.add(rim);
const tCam = new THREE.PerspectiveCamera(30, TW / TH, 0.001, 2000);
const wait = [];                 // 撮る順番待ち（少しずつ間をあけて 1 枚ずつ）
function thumb(kind, img) {
  const def = SPECIES.find(d => d.kind === kind), s = shots[kind];
  if (s) { img.src = book[kind] ? s.color : s.shadow; return; }
  wait.push({ def, img });
  if (wait.length === 1) setTimeout(shootThumb, 30);
}
// （下の撮影の shoot と名前が同じだと、あとの方に置き換わり、図鑑を開くたびに写真を撮ってしまうので、別の名前に）
function shootThumb() {
  const job = wait.shift(); if (!job) return;
  if (!shots[job.def.kind]) shots[job.def.kind] = take(job.def);
  const s = shots[job.def.kind];
  if (s) job.img.src = book[job.def.kind] ? s.color : s.shadow;
  if (wait.length) setTimeout(shootThumb, 30);
}
function take(def) {
  const make = def.make || (window.SPECIES && window.SPECIES[def.kind]); if (!make) return null;
  const body = make(def.size || 0.3); body.animate(1.3, 0);
  tScene.add(body.group);
  const box = new THREE.Box3().setFromObject(body.group), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const dir = new THREE.Vector3(1, 0.35, 0.55).normalize(), dist = r / Math.sin(THREE.MathUtils.degToRad(tCam.fov / 2)) * 0.95;
  tCam.position.copy(c).addScaledVector(dir, dist); tCam.near = dist / 100; tCam.far = dist * 4; tCam.updateProjectionMatrix(); tCam.lookAt(c);
  const prevRT = renderer.getRenderTarget(), prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.autoClear = true; renderer.clear(); renderer.render(tScene, tCam);
  const px = new Uint8Array(TW * TH * 4); renderer.readRenderTargetPixels(rt, 0, 0, TW, TH, px);
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevC, prevA); renderer.autoClear = prevAuto;
  tScene.remove(body.group); LIFE.dispose(body);
  // 上下を反転して画像にする。影絵は色を消して、形だけを暗い青で塗る
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  const x = cv.getContext('2d'), im = x.createImageData(TW, TH), sh = x.createImageData(TW, TH);
  for (let yy = 0; yy < TH; yy++) for (let xx = 0; xx < TW; xx++) {
    const i = ((TH - 1 - yy) * TW + xx) * 4, o = (yy * TW + xx) * 4, a = px[i + 3];
    im.data[o] = px[i]; im.data[o + 1] = px[i + 1]; im.data[o + 2] = px[i + 2]; im.data[o + 3] = a;
    sh.data[o] = 30; sh.data[o + 1] = 70; sh.data[o + 2] = 90; sh.data[o + 3] = a ? 210 : 0;
  }
  x.putImageData(im, 0, 0); const color = cv.toDataURL();
  x.clearRect(0, 0, TW, TH); x.putImageData(sh, 0, 0); const shadow = cv.toDataURL();
  return { color, shadow };
}

// ---------- 出会い（creatures.js から呼ばれる）。初めてなら登録して true ----------
function meet(def, depth) {
  if (book[def.kind]) return false;
  book[def.kind] = { at: Date.now(), depth: Math.round(depth) };
  save('zukan', book);
  announce('zukan', def.name, `${found()}/${SPECIES.length} 種類目 · ${def.note}`);
  syncBtn(); if (!panel.hidden) open(true);
  return true;
}

// ---------- 実績 ----------
// 名前のついた場所の位置（km）。'origin' は潜航地点（チャレンジャー海淵）
const places = { origin: { x: 0, z: 0 } };
(SEA.features || []).forEach(f => {
  if (f.deepest) { const d = T.deepestIn(...f.deepest); places[f.name] = { x: T.toX(d.lon), z: T.toZ(d.lat) }; }
  else if (f.lat != null) places[f.name] = { x: T.toX(f.lon), z: T.toZ(f.lat) };
});
function reached(w, { under, depth, floorD }) {
  if (!under) return false;
  if (w.enter) return depth > 3;
  if (w.depth != null && depth < w.depth) return false;
  if (w.floor && floorD - depth > 8) return false;
  if (w.place) { const p = places[w.place]; if (!p || Math.hypot(S.x - p.x, S.z - p.z) > (w.km || 3)) return false; }
  if (w.site) { const st = LIFE && LIFE.sites.find(x => x.kind === w.site); if (!st || Math.hypot(S.x * 1000 - st.x, S.z * 1000 - st.z, depth - st.depth) > (w.m || 30)) return false; }
  if (w.zukan != null) return found() >= (w.zukan === 'all' ? SPECIES.length : w.zukan);
  if (w.photo != null) return shotN() >= (w.photo === 'all' ? SPECIES.length : w.photo);
  return true;
}
let tick = 0;
function update(dt, st) {
  if ((tick -= dt) > 0 || S.mode !== 'dive' || S.intro) return;
  tick = 0.25;
  ACHV.forEach(a => {
    if (done[a.id] || !reached(a.when, st)) return;
    done[a.id] = { at: Date.now() }; save('achv', done);
    announce('achv', a.title, a.note); syncBtn();
  });
}

// ---------- 撮影: 画面の中央に写っている生き物の写真を、図鑑に貼る ----------
const flashEl = document.createElement('div'); flashEl.id = 'flash'; document.body.appendChild(flashEl);
let wantShot = false;
function shoot() {
  if (S.mode !== 'dive' || S.intro || !(S.depth > 0)) { UI.toast('撮影は海の中でできます。'); return; }
  wantShot = true;                                                    // 次に画面を描いた直後に写す
}
function afterRender(canvas) {
  if (!wantShot) return;
  wantShot = false;
  flashEl.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => flashEl.classList.remove('on')));
  window.__AUDIO?.click?.(0.25, 0);                                   // シャッターの音
  const sub = LIFE && LIFE.subject && LIFE.subject();
  if (!sub) { UI.toast('生き物が写っていません。生き物を画面の中央に入れて、近くで撮りましょう。'); return; }
  const W = 320, H = 180, c = document.createElement('canvas'); c.width = W; c.height = H;
  const sw = canvas.width, sh = canvas.height; let cw = sw, ch = sw * H / W; if (ch > sh) { ch = sh; cw = sh * W / H; }
  c.getContext('2d').drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
  const first = !photos[sub.def.kind];
  photos[sub.def.kind] = { img: c.toDataURL('image/jpeg', 0.82), at: Date.now(), depth: Math.round(sub.depth) };
  save('photo', photos);
  if (!book[sub.def.kind]) meet(sub.def, sub.depth);
  UI.toast(first ? `${sub.def.name}を撮影しました。図鑑に写真を貼りました（写真 ${shotN()}/${SPECIES.length}）` : `${sub.def.name}を撮影しました。図鑑の写真を新しくしました。`);
  syncBtn(); if (!panel.hidden) open(true);
}
const shotBtn = $('shot');
if (shotBtn) { shotBtn.onclick = shoot; if (!SPECIES.length) shotBtn.remove(); }
addEventListener('keydown', e => { if (e.code === 'KeyP' && SPECIES.length && !e.target.closest?.('input, textarea')) shoot(); });

window.__ZUKAN = { meet, update, open, afterRender, book, done, photos };
})();
