// 音: BGM（自動生成の環境音楽）・環境音・効果音。すべて Web Audio で合成し、音声ファイルは使わない
(() => {
let ac = null, master, bgmBus, worldBus, seBus, muffle, reverb;
const BGM_LEVEL = 0.6;           // BGM の大きさ（効果音とのバランス）
const st = { bgm: true, se: true, vol: 0.3, depth: 0, under: false, dive: false, zone: -1 };
// 録画スクリプトは __AUDIO_CLOCK（仮想時計の秒）と __AUDIO_CTX（書き出し用の OfflineAudioContext）を差し込める
const now = () => window.__AUDIO_CLOCK ? window.__AUDIO_CLOCK() : ac.currentTime;
const rand = (a, b) => a + Math.random() * (b - a);
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

// ---------- 起動（ユーザー操作の中で呼ぶ） ----------
function start() {
  if (ac) { ac.resume(); return true; }
  try { ac = window.__AUDIO_CTX ? window.__AUDIO_CTX() : new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
  master = ac.createGain(); master.gain.value = st.vol; master.connect(ac.destination);
  reverb = ac.createConvolver(); reverb.buffer = impulse(4.5); const rvGain = ac.createGain(); rvGain.gain.value = 0.55;
  reverb.connect(rvGain).connect(master);
  bgmBus = ac.createGain(); bgmBus.gain.value = st.bgm ? BGM_LEVEL : 0; bgmBus.connect(master); bgmBus.connect(reverb);
  // 海中では高い音がこもる（ローパス）
  muffle = ac.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 18000; muffle.Q.value = 0.4;
  worldBus = ac.createGain(); worldBus.gain.value = st.se ? 1 : 0;
  worldBus.connect(muffle).connect(master); muffle.connect(reverb);
  seBus = ac.createGain(); seBus.gain.value = st.se ? 0.8 : 0; seBus.connect(master); seBus.connect(reverb);
  buildAmbience();
  scheduleBgm();
  return true;
}
function impulse(sec) {
  const len = ac.sampleRate * sec, b = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  return b;
}
let noiseBuf = null;
// t0: 鳴り始める時刻（ここで start 済みにして返すので、呼び出し側でもう一度 start しないこと）
function noise(t0 = now()) {
  if (!noiseBuf) {                               // ピンクノイズ 4秒
    const len = ac.sampleRate * 4; noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 0.9; }
  }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopStart = 0; s.start(t0, rand(0, 3.9)); return s;
}
const filt = (type, f, q = 0.7) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const gain = v => { const g = ac.createGain(); g.gain.value = v; return g; };

// ---------- 環境音（常に鳴らして音量で出し入れする） ----------
const amb = {};
function buildAmbience() {
  // 風（海面上）
  amb.wind = gain(0); const wbp = filt('bandpass', 520, 0.6);
  noise().connect(wbp).connect(amb.wind).connect(worldBus);
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.08; lfo.connect(gain(260)).connect(wbp.frequency); lfo.start();   // 風の強弱
  // 波（海面上）: 画面のうねりと同じ、10 秒ほどの周期でうねる
  amb.wave = gain(0); const wenv = gain(0.5);
  noise().connect(filt('lowpass', 700)).connect(wenv).connect(amb.wave).connect(worldBus);
  const swell = ac.createOscillator(); swell.frequency.value = 0.1; swell.connect(gain(0.45)).connect(wenv.gain); swell.start();
  // 礁の縁や浜で砕ける波の、低くとどろく音（sea.js の砕け波に合わせて大きくなる）
  amb.surf = gain(0); noise().connect(filt('lowpass', 420, 0.8)).connect(amb.surf).connect(worldBus);
  amb.surfHi = gain(0); noise().connect(filt('bandpass', 1400, 0.5)).connect(amb.surfHi).connect(worldBus);   // 泡のはじけるザーッという音（海面上だけ）
  // テッポウエビのパチパチ（サンゴ礁の海の中で、一面に鳴る）。近くで鳴るので、水中でもこもらず高い音のまま聞こえる
  {
    const len = ac.sampleRate * 4, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for (let k = 0; k < 4 * 900; k++) {                                // 1 秒に約 900 回の、鋭く短い破裂音（大きさはまちまち）
      const at = Math.floor(Math.random() * (len - 200)), a = Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1);
      for (let i = 0; i < 120; i++) d[at + i] += a * Math.exp(-i / 12) * (i % 2 ? -1 : 1);
    }
    const s = ac.createBufferSource(); s.buffer = b; s.loop = true; s.start();
    amb.shrimp = gain(0); s.connect(filt('highpass', 2000, 0.7)).connect(amb.shrimp).connect(seBus);
  }
  // 水中のざわめき（浅い海）
  amb.hiss = gain(0); noise().connect(filt('lowpass', 900)).connect(amb.hiss).connect(worldBus);
  // 深海のうなり
  amb.drone = gain(0);
  [[43.65, 0], [65.4, 4], [43.9, -6]].forEach(([f, det]) => {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = det; o.connect(amb.drone); o.start();
  });
  noise().connect(filt('lowpass', 110)).connect(gain(1.4)).connect(amb.drone);
  amb.drone.connect(worldBus);
  // 潜水艇のモーター
  amb.motor = gain(0); amb.motorOsc = ac.createOscillator(); amb.motorOsc.type = 'sawtooth'; amb.motorOsc.frequency.value = 42;
  amb.motorF = filt('lowpass', 180, 2); amb.motorOsc.connect(amb.motorF).connect(amb.motor).connect(worldBus); amb.motorOsc.start();
}
const ramp = (param, v, t = 0.6) => param.setTargetAtTime(v, now(), t / 3);

// ---------- 単発の効果音 ----------
function env(node, peak, a, d, t0 = now()) {
  node.gain.setValueAtTime(0, t0); node.gain.linearRampToValueAtTime(peak, t0 + a); node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function splash() {
  if (!ac) return;
  const g = gain(0), n = noise(); n.connect(filt('highpass', 700)).connect(g).connect(seBus); env(g, 0.5, 0.01, 1.2); n.stop(now() + 1.4);
  for (let i = 0; i < 26; i++) bubble(now() + 0.2 + Math.pow(Math.random(), 1.5) * 2.2, rand(0.03, 0.12));
}
function surface() {                            // 浮上したときの小さな水音
  if (!ac || !st.se) return;
  const g = gain(0), n = noise(); n.connect(filt('bandpass', 1400, 0.8)).connect(g).connect(seBus); env(g, 0.18, 0.02, 0.6); n.stop(now() + 0.8);
  for (let i = 0; i < 6; i++) bubble(now() + rand(0, 0.5), 0.05);
}
function bubble(t0 = now(), vol = 0.08) {
  if (!ac) return;
  const o = ac.createOscillator(), g = gain(0), f = rand(380, 1400);
  o.type = 'sine'; o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * rand(1.6, 2.4), t0 + 0.06);
  o.connect(g).connect(worldBus); env(g, vol, 0.004, 0.07, t0); o.start(t0); o.stop(t0 + 0.1);
}
// echo: 海底からのこだまが返るまでの秒数（海底までの往復 ÷ 音速）。近いほど早く大きく返る。省略時は試し鳴らし用の固定の反響
function ping(echo) {
  if (!ac || !st.se) return;
  const list = echo == null ? [[0, 0.16], [0.9, 0.045], [1.7, 0.02]] : [[0, 0.16], ...(echo < 9 ? [[Math.max(0.05, echo), 0.012 + 0.07 * Math.exp(-echo / 1.5)]] : [])];
  list.forEach(([dt, v]) => {                                          // 本音と反響
    const o = ac.createOscillator(), g = gain(0), t0 = now() + dt;
    o.type = 'sine'; o.frequency.setValueAtTime(1180, t0); o.frequency.exponentialRampToValueAtTime(1040, t0 + 1.2);
    o.connect(g).connect(seBus); env(g, v, 0.01, 1.35, t0); o.start(t0); o.stop(t0 + 1.5);
  });
}
function whale() {                                // 遠くのクジラのような声
  const t0 = now(), o = ac.createOscillator(), g = gain(0), vib = ac.createOscillator(), vg = gain(6);
  const f = rand(140, 220);
  o.type = 'sine'; o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * 0.7, t0 + 1.6); o.frequency.linearRampToValueAtTime(f * 1.15, t0 + 3.2);
  vib.frequency.value = 5; vib.connect(vg).connect(o.frequency); vib.start(t0); vib.stop(t0 + 3.6);
  o.connect(filt('lowpass', 900)).connect(g).connect(worldBus); env(g, 0.22, 0.8, 2.8, t0); o.start(t0); o.stop(t0 + 3.8);
}
// 2015年、チャレンジャー海淵の底に置いた水中マイクには、地震の地鳴り・ヒゲクジラの声・台風・船のスクリュー音が
// 録音されていた（NOAA ほか）。深海も静かではないので、それらを遠くの出来事としてときどき鳴らす
function quake() {                                // 遠くの地震の地鳴り（ゴゴゴ…と低く長く響く）
  const t0 = now(), dur = rand(6, 10), n = noise(t0), lp = filt('lowpass', rand(60, 90), 0.8), g = gain(0);
  n.connect(lp).connect(g).connect(worldBus); n.stop(t0 + dur + 0.5);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.9, t0 + dur * 0.25); g.gain.linearRampToValueAtTime(0.5, t0 + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  const o = ac.createOscillator(), og = gain(0);                    // 体に響く低いうなり
  o.type = 'sine'; o.frequency.setValueAtTime(rand(24, 32), t0); o.frequency.linearRampToValueAtTime(rand(16, 22), t0 + dur);
  o.connect(og).connect(worldBus); env(og, 0.35, dur * 0.3, dur * 0.7, t0); o.start(t0); o.stop(t0 + dur + 0.2);
  for (let i = 0; i < 10; i++) {                                    // 岩がきしむような小さなはぜる音
    const tk = t0 + dur * (0.15 + Math.random() * 0.5), tn = noise(tk), tg = gain(0);
    tn.connect(filt('bandpass', rand(120, 300), 3)).connect(tg).connect(worldBus); env(tg, 0.25, 0.005, 0.15, tk); tn.stop(tk + 0.2);
  }
}
function ship() {                                 // 海面を遠くの船が通る（スクリューのうなりが近づいて遠ざかる）
  const t0 = now(), dur = rand(35, 50), n = noise(t0), lp = filt('lowpass', 260, 1.2), am = gain(0.5), g = gain(0);
  const lfo = ac.createOscillator(), lg = gain(0.5); lfo.frequency.value = rand(5, 8); lfo.connect(lg).connect(am.gain);   // 羽根が水を打つリズム
  n.connect(lp).connect(am).connect(g).connect(worldBus); n.stop(t0 + dur);
  const hum = ac.createOscillator(), hg = gain(0); hum.type = 'sawtooth'; hum.frequency.setValueAtTime(rand(55, 75), t0); hum.frequency.linearRampToValueAtTime(rand(48, 60), t0 + dur);   // 近づいて遠ざかると音程が下がる
  hum.connect(filt('lowpass', 180)).connect(hg).connect(worldBus);
  [g, hg].forEach((gg, k) => { const pk = k ? 0.05 : 0.22; gg.gain.setValueAtTime(0, t0); gg.gain.linearRampToValueAtTime(pk, t0 + dur * 0.45); gg.gain.linearRampToValueAtTime(pk, t0 + dur * 0.55); gg.gain.linearRampToValueAtTime(0, t0 + dur); });
  lfo.start(t0); lfo.stop(t0 + dur); hum.start(t0); hum.stop(t0 + dur);
}
const firstHeard = new Set();                     // 初めて聞こえたときだけ、何の音か知らせる
function tell(key, msg) { if (firstHeard.has(key)) return; firstHeard.add(key); setTimeout(() => window.__UI && window.__UI.toast(msg), 2500); }

function creak() {                                // 水圧で船体がきしむ音（ギギギ…と擦れる）
  const t0 = now(), dur = rand(1.1, 1.7), f = rand(200, 320);
  // 引っかかっては滑る「断続」: 1秒間に 20〜40 回、速さが揺らぐ
  const stick = ac.createOscillator(); stick.type = 'square';
  const rates = new Float32Array(8).map((_, i) => rand(18, 40) * (1 - 0.3 * i / 7));
  stick.frequency.setValueCurveAtTime(rates, t0, dur);
  const gate = gain(0.5); stick.connect(gain(0.5)).connect(gate.gain);
  // 金属の響き（中くらいの高さ）
  const o = ac.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t0); o.frequency.linearRampToValueAtTime(f * rand(0.8, 1.15), t0 + dur);
  const body = filt('bandpass', rand(450, 800), 4);
  o.connect(body).connect(gate);
  // ザラッとした摩擦
  const n = noise(t0); n.connect(filt('bandpass', rand(1200, 2000), 2)).connect(gain(0.6)).connect(gate);
  const g = gain(0); gate.connect(filt('highpass', 220)).connect(g).connect(seBus);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.12);
  g.gain.setValueAtTime(0.5, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  [stick, o].forEach(x => { x.start(t0); x.stop(t0 + dur + 0.05); }); n.stop(t0 + dur + 0.05);
  // 余韻の「ピシッ」
  const ticks = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < ticks; i++) {
    const tk = t0 + dur + rand(0.1, 1.2), tn = noise(tk), tg = gain(0);
    tn.connect(filt('bandpass', rand(2200, 3600), 8)).connect(tg).connect(seBus); env(tg, 0.6, 0.002, 0.06, tk); tn.stop(tk + 0.12);
  }
}
function found() {                                // 宝箱を見つけたとき
  if (!ac || !st.se) return;
  [76, 79, 83, 88, 91].forEach((n, i) => {
    const t0 = now() + i * 0.11, o = ac.createOscillator(), g = gain(0);
    o.type = 'triangle'; o.frequency.value = midi(n); o.connect(g).connect(seBus); env(g, 0.12, 0.01, 1.4, t0); o.start(t0); o.stop(t0 + 1.6);
  });
}

// マッコウクジラの反響定位の音（カチッ、カチッと規則正しく続く）。level: 大きさ、pan: 左右（-1〜1）
function click(level, pan, t0) {
  if (!ac || !st.se) return;
  if (t0 == null) t0 = now();
  const n = noise(t0), bp = filt('bandpass', rand(2600, 3400), 6), g = gain(0), p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); n.connect(bp).connect(g).connect(p).connect(seBus); } else n.connect(bp).connect(g).connect(seBus);
  env(g, level, 0.0015, 0.05, t0); n.stop(t0 + 0.08);
  const g2 = gain(0), bp2 = filt('bandpass', 2200, 4); n.connect(bp2).connect(g2).connect(p || seBus); env(g2, level * 0.35, 0.002, 0.07, t0 + 0.004);   // 頭の中で響く 2 つ目の山
}

// ブダイがサンゴをかじる、カリッという短い音（近いほど大きい）。dist: 距離 (m)
function crunch(dist) {
  if (!ac || !st.se || !st.under) return;
  const t0 = now(), n = noise(t0), bp = filt('bandpass', rand(1800, 2600), 2.5), g = gain(0), lv = 0.12 * Math.max(0, 1 - dist / 12);
  n.connect(bp).connect(g).connect(seBus);
  for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(0, t0 + i * 0.06); g.gain.linearRampToValueAtTime(lv * (1 - i * 0.25), t0 + i * 0.06 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.06 + 0.05); }
  n.stop(t0 + 0.3);
}
// ザトウクジラの歌（雄だけが歌う）: 低いうなり・上がる声・高い叫び・短いうめきなどの「音の単位」を組み合わせたフレーズを、
// 同じ順でくり返す（同じ海域の雄たちは、同じ歌を歌う）。1 曲は十数分。音は 30〜4,000Hz ほどで、水中を何 km も届く
// 単位: [形, 始めの高さ Hz, 終わりの高さ Hz, 長さ 秒]。形 m: うなり（なめらか）、u: 上がる声、a: 山なり（上がって下がる）、g: うめき（ざらついた低い声）、c: 高い叫び（ふるえる）
const SONG = [
  [['m', 110, 85, 2.6], ['u', 180, 520, 1.3], ['u', 190, 560, 1.2], ['a', 320, 260, 0.9]],
  [['m', 110, 85, 2.6], ['u', 180, 520, 1.3], ['u', 190, 560, 1.2], ['a', 320, 260, 0.9]],
  [['c', 900, 1150, 1.6], ['c', 880, 1120, 1.5], ['m', 160, 115, 2.2], ['g', 70, 60, 0.6], ['g', 72, 58, 0.6]],
  [['c', 900, 1150, 1.6], ['c', 880, 1120, 1.5], ['m', 160, 115, 2.2], ['g', 70, 60, 0.6], ['g', 72, 58, 0.6]],
  [['a', 250, 210, 1.1], ['m', 95, 120, 3.0], ['u', 140, 420, 1.0]]
];
let songIx = 0, nextSong = 0;
const SONG_RANGE = 2500;                                               // 歌が聞こえる距離 (m)
function songUnit([shape, f0, f1, dur], lv, pan, t0) {
  const o = ac.createOscillator(), o2 = ac.createOscillator(), g = gain(0), g2 = gain(shape === 'g' ? 0.6 : 0.28), lp = filt('lowpass', shape === 'g' ? 500 : 2400, 0.7);
  o.type = shape === 'g' ? 'sawtooth' : 'sine'; o2.type = 'sine';
  const fq = (p, set) => {
    if (shape === 'a') { p.setValueAtTime(f0 * 0.75, t0); p.exponentialRampToValueAtTime(f0 * 1.25, t0 + dur * 0.45); p.exponentialRampToValueAtTime(f1, t0 + dur); }
    else { p.setValueAtTime(f0, t0); p.exponentialRampToValueAtTime(f1, t0 + dur); }
  };
  fq(o.frequency); fq(o2.frequency); o2.detune.value = 1200 + rand(-8, 8);   // 1 オクターブ上の倍音（声の厚み）
  if (shape === 'c' || shape === 'm') {                                // ふるえ（ビブラート）
    const v = ac.createOscillator(), vg = gain(shape === 'c' ? f0 * 0.03 : f0 * 0.012); v.frequency.value = shape === 'c' ? rand(6, 9) : rand(2, 4); v.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency); v.start(t0); v.stop(t0 + dur + 0.2);
  }
  if (shape === 'g') {                                                 // うめき: 細かく脈打つ
    const am = ac.createOscillator(), ag = gain(0.5); am.frequency.value = rand(18, 26); am.connect(ag).connect(g.gain); am.start(t0); am.stop(t0 + dur + 0.2);
  }
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null;
  o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g);
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(worldBus); } else g.connect(worldBus);
  const a = Math.min(0.35, dur * 0.3);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lv, t0 + a); g.gain.setValueAtTime(lv, t0 + dur - a); g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
}
// 1 フレーズを鳴らし、かかる秒数を返す
function humpbackPhrase(lv, pan) {
  let t = now() + 0.1;
  for (const u of SONG[songIx % SONG.length]) { songUnit(u, lv * rand(0.85, 1), pan, t); t += u[3] + rand(0.4, 1.1); }
  songIx++;
  return t - now();
}

// ハシナガイルカの声: 口笛のような声（ホイッスル。上がり下がりする高い音）と、獲物や仲間を探すクリック音（ジジジ…と速く続く）。
// 近くの群れの声なので、こもらずに高い音のまま聞こえる。lv: 大きさ、pan: 左右
function dolphin(lv, pan) {
  if (!ac || !st.se || !st.under) return;
  tell('dolphin', 'ピューイ、ピュルル…と高い声と、ジジジ…という音が聞こえる。イルカの群れが、口笛のような声で呼び合い、クリック音で獲物を探している。');
  const p = ac.createStereoPanner ? ac.createStereoPanner() : null; if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(seBus); }
  const out = p || seBus, t0 = now() + rand(0, 0.3);
  if (Math.random() < 0.6) {                                           // ホイッスル
    const o = ac.createOscillator(), g = gain(0), dur = rand(0.35, 1.1), f0 = rand(6000, 9000), f1 = rand(9000, 14000), kind = Math.random();
    o.type = 'sine';
    if (kind < 0.4) { o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur); }                                    // 上がる
    else if (kind < 0.7) { o.frequency.setValueAtTime(f1, t0); o.frequency.exponentialRampToValueAtTime(f0, t0 + dur); }                               // 下がる
    else { o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.5); o.frequency.exponentialRampToValueAtTime(f0 * 1.1, t0 + dur); }   // 山なり
    const v = ac.createOscillator(), vg = gain(rand(60, 220)); v.frequency.value = rand(3, 9); v.connect(vg).connect(o.frequency); v.start(t0); v.stop(t0 + dur + 0.1);   // ゆるいふるえ（強すぎると機械の音のように聞こえる）
    o.connect(g).connect(out); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lv * 0.5, t0 + 0.05); g.gain.setValueAtTime(lv * 0.5, t0 + dur - 0.08); g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } else {                                                             // クリック音の列（だんだん速くなる）
    const n = 12 + Math.floor(rand(0, 24)), src = noise(t0), bp = filt('bandpass', rand(5000, 8000), 3), g = gain(0);
    src.connect(bp).connect(g).connect(out);
    let t = t0, gap = rand(0.03, 0.06);
    for (let i = 0; i < n; i++) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lv * 0.6, t + 0.0008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006); t += gap; gap *= 0.94; }
    src.stop(t + 0.05);
  }
}
function chime(kind) {                            // 図鑑に登録・実績解除のときの小さな知らせ
  if (!ac || !st.se) return;
  (kind === 'achv' ? [79, 86, 91] : [84, 88]).forEach((n, i) => {
    const t0 = now() + i * 0.09, o = ac.createOscillator(), g = gain(0);
    o.type = 'sine'; o.frequency.value = midi(n); o.connect(g).connect(seBus); env(g, 0.07, 0.008, 1.1, t0); o.start(t0); o.stop(t0 + 1.3);
  });
}

// ---------- BGM（深さの区分ごとに調と音域が変わる環境音楽） ----------
// root: 基音(MIDI) / chords: 和音（root からの半音） / scale: 旋律に使う音 / rate: 旋律の頻度
const MOODS = [
  { root: 50, chords: [[0, 7, 14, 16], [5, 12, 16, 21], [-3, 7, 12, 16], [2, 9, 14, 17]], scale: [0, 2, 4, 7, 9, 12, 14, 16, 19], rate: 0.45, bright: 1400 },   // 海面・表層: 明るい
  { root: 50, chords: [[0, 7, 14, 15], [-4, 3, 10, 14], [-2, 5, 12, 14], [0, 7, 10, 15]], scale: [0, 2, 3, 7, 10, 12, 14, 15], rate: 0.32, bright: 900 },        // 中深層: 少し暗く
  { root: 45, chords: [[0, 7, 15], [-4, 3, 10], [-2, 5, 10], [0, 7, 12]], scale: [0, 3, 7, 10, 12, 15], rate: 0.2, bright: 650 },                              // 漸深層: 暗く低く
  { root: 40, chords: [[0, 7, 12], [1, 8, 13], [0, 7, 10]], scale: [0, 1, 7, 12, 13], rate: 0.12, bright: 450 },                                               // 深海層: まばら
  { root: 38, chords: [[0, 7], [1, 8], [0, 6]], scale: [0, 1, 6, 12], rate: 0.07, bright: 320 }                                                                 // 超深海: ほぼ静寂
];
let chordIx = 0, bgmTimer = null, melTimer = null;
const zoneIx = d => d < 200 ? 0 : d < 1000 ? 1 : d < 4000 ? 2 : d < 6000 ? 3 : 4;
function pad(freq, t0, dur, cutoff) {
  const g = gain(0), lp = filt('lowpass', cutoff, 0.5);
  [-7, 7].forEach(det => { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = freq; o.detune.value = det; o.connect(lp); o.start(t0); o.stop(t0 + dur + 0.1); });
  lp.connect(g).connect(bgmBus);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05, t0 + dur * 0.35); g.gain.setValueAtTime(0.05, t0 + dur * 0.6); g.gain.linearRampToValueAtTime(0, t0 + dur);
}
function scheduleBgm() {
  const m = MOODS[Math.max(0, st.zone)], t0 = now() + 0.05, dur = 14;
  const ch = m.chords[chordIx++ % m.chords.length];
  ch.forEach(iv => pad(midi(m.root + iv), t0, dur + 2, m.bright));
  bgmTimer = setTimeout(scheduleBgm, (dur - 2) * 1000);
}
function melody() {
  const m = MOODS[Math.max(0, st.zone)];
  if (ac && Math.random() < m.rate) {
    const n = m.root + 12 + m.scale[Math.floor(Math.random() * m.scale.length)];
    const t0 = now(), o = ac.createOscillator(), g = gain(0);
    o.type = 'sine'; o.frequency.value = midi(n); o.connect(g).connect(bgmBus); env(g, 0.06, 0.02, rand(2.5, 4.5), t0); o.start(t0); o.stop(t0 + 5);
  }
  melTimer = setTimeout(melody, rand(900, 2200));
}
setTimeout(melody, 1500);

// ---------- 毎フレーム ----------
let nextWhale = 20, nextCreak = 10, nextBubble = 2, nextClick = 0, nextQuake = 90, nextShip = 150, clock = 0, sinceSet = 0, wasWhale = false, wasCreak = false;
function update(dt, { dive, under, depth, motor }) {
  if (!ac) return;
  clock += dt;
  if ((sinceSet += dt) < 0.1) return;         // 音の調整は 0.1 秒ごとで十分
  sinceSet = 0;
  const d = Math.max(0, depth);
  st.zone = dive && under ? zoneIx(d) : 0;
  const above = !under; st.under = !!(dive && under);
  // 水中の音がこもるのは、遠くから来る高い音ほど弱まるため（深さそのものではない）。近くの音は深海でも澄んで聞こえる
  ramp(muffle.frequency, under ? 2600 : 18000, 0.4);
  ramp(amb.wind.gain, above ? (dive ? 0.35 : 0.12) : 0, 1);
  ramp(amb.wave.gain, above ? (dive ? 0.6 : 0.15) : 0, 1);
  ramp(amb.hiss.gain, under ? 0.25 * Math.exp(-d / 400) : 0, 1);
  // 砕ける波の音: 近くで砕けるたびに大きくなる。水中では低い音だけが、こもって届く
  const surf = Math.min(1, (window.__SEA && window.__SEA.surfLevel ? window.__SEA.surfLevel() : 0)) * (dive ? 1 : 0);
  ramp(amb.surf.gain, surf * (under ? 0.5 : 0.7), 0.25);
  ramp(amb.surfHi.gain, above ? surf * 0.25 : 0, 0.25);
  // テッポウエビ: 水深 40m より浅い海の底近く（サンゴや岩のすき間にすむ）。海底から離れるほど小さい
  const T = window.__TRENCH, S = window.__DIVE, fl = T && S ? T.floorDepth(S.x, S.z) : 1e9;
  const reef = under && fl < 45 ? (1 - fl / 45) * Math.exp(-Math.max(0, fl - d) / 25) : 0;
  ramp(amb.shrimp.gain, reef * 0.09, 1.5);
  ramp(amb.drone.gain, under ? 0.06 * Math.min(1, d / 3000) : 0, 2);
  ramp(amb.motor.gain, under ? Math.min(0.12, motor / 400 * 0.12) : 0, 0.5);
  ramp(amb.motorOsc.frequency, 38 + Math.min(40, motor / 30), 0.5);
  ramp(amb.motorF.frequency, 140 + Math.min(500, motor / 3), 0.5);
  // 回遊するマッコウクジラが 12km 以内にいると、反響定位の音が聞こえる（近いほど大きく、来る方向から）
  const W = window.__LIFE && window.__LIFE.whale;
  // ザトウクジラが 2.5km 以内にいると、歌が聞こえる（近いほど大きく、来る方向から。遠くではかすか）。フレーズの間は少しあける
  // 本物の歌は何十 km も届くが、水中で姿が見えるのは数十 m 先まで。聞こえる範囲を広げすぎると、いつまでも会えない歌になるので、近くに絞る
  if (under && st.se && W && W.kind === 'humpback' && W.d < SONG_RANGE && clock > nextSong) {
    const lv = 0.015 + 0.5 * Math.pow(1 - W.d / SONG_RANGE, 2);
    nextSong = clock + humpbackPhrase(lv, W.pan) + rand(1.5, 4);
    tell('humpback', 'うなるような低い声と、高く伸びる声が、くり返し聞こえる。ザトウクジラの雄の歌だ。冬のマリアナの海で、繁殖のために歌う。歌は遠くまで届く。声が大きくなる方へ進めば、会えるかもしれない。');
  }
  if (under && st.se && W && W.kind !== 'humpback' && W.d < 12000 && clock > nextClick) {
    const lv = 0.03 + 0.5 * Math.pow(1 - W.d / 12000, 2.5);
    for (let i = 0; i < 6; i++) click(lv * rand(0.8, 1), W.pan, now() + i * rand(0.55, 0.75));
    nextClick = clock + rand(4.5, 7);
  }
  if (under && st.se) {
    if (d < 150 && clock > nextBubble) { bubble(now(), 0.03); nextBubble = clock + rand(0.8, 4); }
    // その深さに入ってから数秒で最初の1回が鳴り、以後は一定間隔
    const inWhale = d > 200 && d < 6000, inCreak = d > 6000;
    if (inWhale && !wasWhale) nextWhale = clock + rand(5, 12);
    if (inCreak && !wasCreak) nextCreak = clock + rand(4, 10);
    wasWhale = inWhale; wasCreak = inCreak;
    if (inWhale && clock > nextWhale) { whale(); nextWhale = clock + rand(40, 80); tell('whale', '遠くからクジラの声のような低い音が聞こえる。ヒゲクジラの声は、海溝の底の水中マイクでも録音されている。'); }
    if (d > 50 && clock > nextQuake) {                // 地鳴りはどの深さでも。深いほど体に響く
      quake(); nextQuake = clock + rand(150, 300);
      tell('quake', 'ゴゴゴ…と低い地鳴りが響いた。遠くの地震の音だ。プレートが沈み込むマリアナ海溝のまわりでは、地震がよく起きる。');
    }
    if (clock > nextShip) {                           // 船の音は海面から届く（深くても聞こえる）
      ship(); nextShip = clock + rand(240, 480);
      tell('ship', '遠くでうなるような音が近づいて、遠ざかっていく。海面を通る船のスクリューの音が、深海まで届いている。');
    }
    if (inCreak && clock > nextCreak) { creak(); nextCreak = clock + rand(20, 40); }
  }
}
function set(key, v) {
  st[key] = v;
  if (!ac) return;
  if (key === 'bgm') ramp(bgmBus.gain, v ? BGM_LEVEL : 0, 0.8);
  if (key === 'se') { ramp(worldBus.gain, v ? 1 : 0, 0.3); ramp(seBus.gain, v ? 0.8 : 0, 0.3); }
  if (key === 'vol') ramp(master.gain, v, 0.1);
}

window.__AUDIO = { crunch, dolphin, start, update, set, ping, splash, surface, found, chime, click, quake, ship, get on() { return !!ac; } };
})();
