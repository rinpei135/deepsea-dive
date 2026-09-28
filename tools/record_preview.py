"""プレビュー動画の録画スクリプト

ページの時計（performance.now / requestAnimationFrame / setTimeout）を仮想時計に差し替え、
1コマずつ時間を進めて撮影する。PCの速さに関係なく、なめらかな 30fps の動画になる。

使い方:
  1. リポジトリのルートで  python -m http.server 8740
  2. python tools/record_preview.py            （promo/preview.mp4 に出力）
"""
import base64, io, os, shutil, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
from selenium import webdriver
import imageio_ffmpeg, subprocess

URL = 'http://localhost:8740/seas/mariana/'
W, H, FPS = 1280, 720, 30
OUT = os.path.join(os.path.dirname(__file__), '..', 'promo', 'preview.mp4')

VIRTUAL_CLOCK = r"""
(() => {
  let now = 0, q = [], timers = [], tid = 1;
  const base = Date.now();
  performance.now = () => now;
  Date.now = () => base + now;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.setTimeout = (fn, ms = 0) => { const id = tid++; timers.push({ id, at: now + ms, fn }); return id; };
  window.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };
  // 音は仮想時計に合わせて OfflineAudioContext に予約し、最後にまとめて書き出す
  window.__vnow = () => now;
  window.__AUDIO_CLOCK = () => now / 1000;
  window.__AUDIO_CTX = () => (window.__offline = new OfflineAudioContext(2, 48000 * 60, 48000));
  window.__step = ms => {
    now += ms;
    const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now);
    due.forEach(t => { try { typeof t.fn === 'function' && t.fn(); } catch (e) {} });
    const cbs = q.splice(0); cbs.forEach(cb => cb(now));
  };
})();
"""

HIDE_UI = """
const st = document.createElement('style');
st.textContent = '#controls, #pad, #hint, #quest, #echo, #found, #soundAsk, #life, #zone p, #src, .back { display: none !important; }'
  + ' #toast { transition: none !important; }';
document.head.appendChild(st);
"""

WAV_EXPORT = r"""
const done = arguments[arguments.length - 1];
if (!window.__offline) { done('ERR 音の処理が起動していません'); return; }
window.__offline.startRendering().then(buf => {
  const ch = [buf.getChannelData(0), buf.getChannelData(1)], len = buf.length, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * 4));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * 4, true); str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, len * 4, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < 2; c++) {
    const v = Math.max(-1, Math.min(1, ch[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  const bytes = new Uint8Array(out.buffer); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  done(btoa(bin));
}).catch(e => done('ERR ' + e));
"""

def main():
    opts = webdriver.ChromeOptions()
    opts.add_argument('--headless=new')
    opts.add_argument(f'--window-size={W},{H}')
    opts.add_argument('--use-angle=d3d11')
    opts.add_argument('--enable-gpu')
    opts.add_argument('--hide-scrollbars')
    drv = webdriver.Chrome(options=opts)
    drv.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {'width': W, 'height': H, 'deviceScaleFactor': 1, 'mobile': False})
    drv.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source': VIRTUAL_CLOCK})
    drv.get(URL)
    drv.execute_script(HIDE_UI)
    drv.set_script_timeout(600)
    drv.execute_script("document.getElementById('soundYes').click();")   # 音ありで始める
    js = drv.execute_script
    step = lambda: js('window.__step(arguments[0])', 1000 / FPS)
    for _ in range(10): step()                      # 読み込み直後の数コマは捨てる
    print('renderer:', js("const gl=document.createElement('canvas').getContext('webgl');const e=gl&&gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'?'"))

    frames = tempfile.mkdtemp(prefix='dive_frames_')
    n = 0
    t0 = js('return window.__vnow() / 1000')          # 動画の先頭にあたる音の時刻
    def shot():
        nonlocal n
        png = base64.b64decode(drv.execute_cdp_cmd('Page.captureScreenshot', {'format': 'png'})['data'])
        with open(os.path.join(frames, f'{n:05d}.png'), 'wb') as f: f.write(png)
        n += 1
        if n % 60 == 0: print('frame', n, flush=True)

    # 1) 俯瞰でゆっくり回り込む（4秒）
    js("""
      const T = window.__TRENCH; window.__orbit = { t: new THREE.Vector3(70, -20, -60) };
      const o = T.camera.position.clone().sub(window.__orbit.t);
      window.__orbit.r = Math.hypot(o.x, o.z); window.__orbit.h = o.y; window.__orbit.a = Math.atan2(o.x, o.z);
    """)
    for i in range(4 * FPS):
        js("""const T = window.__TRENCH, o = window.__orbit, a = o.a + 0.35 * arguments[0];
              T.camera.position.set(o.t.x + Math.sin(a) * o.r * (1 - 0.15 * arguments[0]), o.t.y + o.h * (1 - 0.25 * arguments[0]), o.t.z + Math.cos(a) * o.r * (1 - 0.15 * arguments[0]));""", i / (4 * FPS))
        step(); shot()

    # 2) 潜航開始: 上空から海面へ、入水（沈む部分は2倍速）
    js("const S = window.__DIVE; S.speed = 2500; window.__NAV.setMode('dive', 'go');")
    while js('return !!window.__DIVE.intro'):
        js("const I = window.__DIVE.intro; if (I && I.t > 4.5) I.t += 1 / 30;")
        step(); shot()

    # 3) 潜っていく（視線は少し下向き）
    # 入水直後: いったん止まって見渡す。途中で見上げて海面（スネルの窓）と光の筋を映す
    import math
    js("window.__DIVE.dir = 0;")
    N = int(5 * FPS)
    y0 = js("return window.__DIVE.yaw;")
    for i in range(N):
        x = i / (N - 1); e = x * x * (3 - 2 * x)
        js("window.__DIVE.yaw = arguments[0]; window.__DIVE.pitch = arguments[1];",
           y0 + 2 * math.pi * e, -0.1 + 0.75 * math.sin(x * math.pi) ** 2)
        step(); shot()

    # 暗闇を速く通り抜ける（音速 約1.5km/秒 より速く沈むので、この間は地形が見えない）
    js("window.__DIVE.pitch = -0.4; window.__DIVE.dir = 1;")
    k = 0
    while js('return window.__DIVE.dir') and k < 20 * FPS:
        # 次のコマで海底の150m上を越えるなら、そこで止める
        js("const S = window.__DIVE, f = window.__TRENCH.floorDepth(S.x, S.z) - 150;"
           "if (S.depth + S.speed / 30 >= f) { S.depth = f; S.dir = 0; window.__UI.syncGo(); }")
        step(); shot(); k += 1
    js("const S = window.__DIVE; S.depth = window.__TRENCH.floorDepth(S.x, S.z) - 150;"
       "window.__UI.toast(window.SEA.origin.arrival(window.__UI.nf(window.__TRENCH.CD.depth)));")

    # 4) 海溝の底: ゆっくり見回しながらソナー
    # 海溝の底: ソナーの波面が広がり、周りの壁が次々に浮かび上がる
    # ゆっくり動き出して止まる動きで約330°見渡し、途中で少し見上げて壁の高さを見せる
    N = int(9 * FPS)
    y0 = js("window.__NAV.ping(); return window.__DIVE.yaw;")
    for i in range(N):
        if i in (int(3 * FPS), int(6 * FPS)): js("window.__NAV.ping()")
        x = i / (N - 1)
        e = x * x * (3 - 2 * x)
        js("window.__DIVE.yaw = arguments[0]; window.__DIVE.pitch = arguments[1];",
           y0 + 5.76 * e, 0.08 + 0.14 * math.sin(x * math.pi))
        step(); shot()

    # 音を書き出す（16bit ステレオ WAV を Base64 で受け取る）
    wav_b64 = drv.execute_async_script(WAV_EXPORT)
    if wav_b64.startswith('ERR'):
        raise RuntimeError(wav_b64)
    wav = os.path.join(frames, 'audio.wav')
    with open(wav, 'wb') as f: f.write(base64.b64decode(wav_b64))
    drv.quit()

    # 5) タイトル（最後のコマから暗転して文字を出す）
    last = Image.open(os.path.join(frames, f'{n - 1:05d}.png')).convert('RGB')
    fdir = r'C:\Windows\Fonts'
    title_font = ImageFont.truetype(os.path.join(fdir, 'yumindb.ttf'), 96)
    sub_font = ImageFont.truetype(os.path.join(fdir, 'YuGothM.ttc'), 30)
    card = Image.new('RGB', (W, H), (3, 10, 18))
    d = ImageDraw.Draw(card)
    def center(text, font, y, fill):
        w = d.textlength(text, font=font); d.text(((W - w) / 2, y), text, font=font, fill=fill)
    center('深海ダイブ', title_font, 270, (217, 238, 242))
    center('実際の海底地形データで、マリアナ海溝の底へ', sub_font, 400, (140, 200, 214))
    for i in range(3 * FPS):
        a = min(1, i / 20)
        Image.blend(last, card, a).save(os.path.join(frames, f'{n:05d}.png')); n += 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    dur = n / FPS
    subprocess.run([ff, '-y', '-framerate', str(FPS), '-i', os.path.join(frames, '%05d.png'),
                    '-ss', f'{t0:.4f}', '-i', wav,
                    '-map', '0:v', '-map', '1:a',
                    # SNS 動画の一般的な大きさ（-16 LUFS）に揃え、最後はゆっくり消す
                    '-af', f'loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={dur - 2.8:.2f}:d=2.8', '-ar', '48000',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
                    '-c:a', 'aac', '-b:a', '192k', '-shortest',
                    '-movflags', '+faststart', os.path.abspath(OUT)], check=True)
    shutil.rmtree(frames)
    print('saved', os.path.abspath(OUT), n, 'frames')

if __name__ == '__main__':
    main()
