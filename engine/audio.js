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
function noise() {
  if (!noiseBuf) {                               // ピンクノイズ 4秒
    const len = ac.sampleRate * 4; noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 0.9; }
  }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopStart = 0; s.start(now(), rand(0, 3.9)); return s;
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
  // 波（海面上）: 7秒ほどの周期でうねる
  amb.wave = gain(0); const wenv = gain(0.5);
  noise().connect(filt('lowpass', 700)).connect(wenv).connect(amb.wave).connect(worldBus);
  const swell = ac.createOscillator(); swell.frequency.value = 0.14; swell.connect(gain(0.45)).connect(wenv.gain); swell.start();
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
function ping() {
  if (!ac || !st.se) return;
  [[0, 0.16], [0.9, 0.045], [1.7, 0.02]].forEach(([dt, v]) => {       // 本音と反響
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
  const n = noise(); n.connect(filt('bandpass', rand(1200, 2000), 2)).connect(gain(0.6)).connect(gate);
  const g = gain(0); gate.connect(filt('highpass', 220)).connect(g).connect(seBus);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.5, t0 + 0.12);
  g.gain.setValueAtTime(0.5, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  [stick, o].forEach(x => { x.start(t0); x.stop(t0 + dur + 0.05); }); n.stop(t0 + dur + 0.05);
  // 余韻の「ピシッ」
  const ticks = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < ticks; i++) {
    const tk = t0 + dur + rand(0.1, 1.2), tn = noise(), tg = gain(0);
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
let nextWhale = 20, nextCreak = 10, nextBubble = 2, clock = 0, sinceSet = 0, wasWhale = false, wasCreak = false;
function update(dt, { dive, under, depth, motor }) {
  if (!ac) return;
  clock += dt;
  if ((sinceSet += dt) < 0.1) return;         // 音の調整は 0.1 秒ごとで十分
  sinceSet = 0;
  const d = Math.max(0, depth);
  st.zone = dive && under ? zoneIx(d) : 0;
  const above = !under;
  ramp(muffle.frequency, under ? 500 + 1200 * Math.exp(-d / 60) : 18000, 0.4);
  ramp(amb.wind.gain, above ? (dive ? 0.35 : 0.12) : 0, 1);
  ramp(amb.wave.gain, above ? (dive ? 0.6 : 0.15) : 0, 1);
  ramp(amb.hiss.gain, under ? 0.25 * Math.exp(-d / 400) : 0, 1);
  ramp(amb.drone.gain, under ? 0.06 * Math.min(1, d / 3000) : 0, 2);
  ramp(amb.motor.gain, under ? Math.min(0.12, motor / 400 * 0.12) : 0, 0.5);
  ramp(amb.motorOsc.frequency, 38 + Math.min(40, motor / 30), 0.5);
  ramp(amb.motorF.frequency, 140 + Math.min(500, motor / 3), 0.5);
  if (under && st.se) {
    if (d < 150 && clock > nextBubble) { bubble(now(), 0.03); nextBubble = clock + rand(0.8, 4); }
    // その深さに入ってから数秒で最初の1回が鳴り、以後は一定間隔
    const inWhale = d > 200 && d < 6000, inCreak = d > 6000;
    if (inWhale && !wasWhale) nextWhale = clock + rand(5, 12);
    if (inCreak && !wasCreak) nextCreak = clock + rand(4, 10);
    wasWhale = inWhale; wasCreak = inCreak;
    if (inWhale && clock > nextWhale) { whale(); nextWhale = clock + rand(40, 80); }
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

window.__AUDIO = { start, update, set, ping, splash, surface, found, get on() { return !!ac; } };
})();
