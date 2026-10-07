# 手元で確かめるための小さなサーバー（ブラウザに古いページを使い回させない）。
#
#   python tools/serve.py          （http://localhost:8740/ で開く。ポートは引数で変えられる）
#
# python -m http.server だと、ブラウザが index.html を覚えて使い回し、書き換えた engine/*.js が読み込まれないことがあるため、
# 毎回「保存しない」と伝える（GitHub Pages では使わない）
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8740))   # 引数がなければ環境変数 PORT（プレビュー用）
print(f'http://localhost:{port}/')
ThreadingHTTPServer(('127.0.0.1', port), partial(NoCache, directory=str(ROOT))).serve_forever()
