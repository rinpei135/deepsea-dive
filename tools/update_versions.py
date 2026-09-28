"""各ページが読み込むローカルの JS・CSS に、ファイルの中身から計算した版番号 (?v=xxxxxxxx) を付ける。

ファイルを変更したときだけ番号が変わるので、更新後はブラウザが必ず新しいファイルを取りに行き、
変わっていないファイルはキャッシュがそのまま使われる。更新をプッシュする前に実行する:

  python tools/update_versions.py
"""
import hashlib, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REF = re.compile(r'''(?P<attr>(?:src|href))="(?P<path>[^"?#:]+\.(?:js|css))(?:\?v=[0-9a-f]*)?"''')


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()[:8]


def update(html_path):
    with open(html_path, encoding='utf-8') as f:
        text = f.read()
    base = os.path.dirname(html_path)
    missing = []

    def repl(m):
        target = os.path.normpath(os.path.join(base, m.group('path')))
        if not os.path.isfile(target):
            missing.append(m.group('path'))
            return m.group(0)
        return f'{m.group("attr")}="{m.group("path")}?v={digest(target)}"'

    new = REF.sub(repl, text)
    if new != text:
        with open(html_path, 'w', encoding='utf-8', newline='') as f:
            f.write(new)
    return new != text, missing


def main():
    changed, problems = 0, 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if not d.startswith('.') and d not in ('promo', 'tools')]
        for name in filenames:
            if name.endswith('.html'):
                p = os.path.join(dirpath, name)
                did, missing = update(p)
                rel = os.path.relpath(p, ROOT)
                if did:
                    changed += 1
                    print('updated', rel)
                for m in missing:
                    problems += 1
                    print(f'見つからないファイル: {m}（{rel}）', file=sys.stderr)
    print(f'{changed} 個のページを更新しました')
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()
