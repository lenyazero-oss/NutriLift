"""css/themes.css の各テーマについて、文字と背景などのコントラスト比(WCAG)を確認する。

使い方(プロジェクト直下で):
    python tools/check_contrast.py

- 文字の組み合わせは 4.5:1 以上、図形(バー・グラフ)は面に対して 3:1 以上を合格とする。
- 不合格が1つでもあれば、終了コード 1 で終わる。
- rgba() の色は、背景(--bg)に重ねた色として計算する。
"""
import re
import sys
from pathlib import Path

THEMES_CSS = Path(__file__).resolve().parent.parent / "css" / "themes.css"

# (前景, 背景, 最低比, 説明)
TEXT, GRAPHIC = 4.5, 3.0
PAIRS = [
    ("text", "bg", TEXT, "本文 / 背景"),
    ("text", "surface", TEXT, "本文 / カード"),
    ("text", "surface-button", TEXT, "本文 / ボタン・一覧"),
    ("text", "surface-input", TEXT, "本文 / 入力欄"),
    ("text-sub", "bg", TEXT, "補助文字 / 背景"),
    ("text-sub", "surface", TEXT, "補助文字 / カード"),
    ("text-sub", "surface-tabbar", TEXT, "非選択タブ / タブバー"),
    ("muted", "bg", TEXT, "注釈 / 背景"),
    ("muted", "surface", TEXT, "注釈 / カード"),
    ("accent-dark", "bg", TEXT, "アクセント文字 / 背景"),
    ("accent-dark", "surface", TEXT, "アクセント文字 / カード"),
    ("accent-dark", "surface-button", TEXT, "アクセント文字 / ボタン"),
    ("accent-dark", "surface-tabbar", TEXT, "選択タブ / タブバー"),
    ("on-accent", "accent", TEXT, "アクセント上の文字"),
    ("on-danger", "danger", TEXT, "エラー色の上の文字"),
    ("danger", "danger-bg", TEXT, "エラー文字 / エラー背景"),
    ("danger", "surface", TEXT, "削除ボタンの文字 / カード"),
    ("notice-text", "notice-bg", TEXT, "通知文字 / 通知背景"),
    ("warn-text", "bg", TEXT, "超過の文字 / 背景"),
    ("warn-text", "surface", TEXT, "超過の文字 / カード"),
    ("toast-text", "toast-bg", TEXT, "トースト文字 / トースト"),
    ("toast-action", "toast-bg", TEXT, "トーストの操作ボタン / トースト"),
    ("accent", "surface", GRAPHIC, "通常のバー・棒 / カード"),
    ("warn-bar", "surface", GRAPHIC, "超過のバー / カード"),
    ("warn-chart", "surface", GRAPHIC, "超過の棒(グラフ) / カード"),
]


def parse_color(value, over=None):
    value = value.strip()
    m = re.fullmatch(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", value)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", value)
    if m:
        r, g, b = (int(m.group(i)) for i in (1, 2, 3))
        a = float(m.group(4)) if m.group(4) is not None else 1.0
        if a < 1 and over is not None:
            return tuple(round(c * a + o * (1 - a)) for c, o in zip((r, g, b), over))
        return (r, g, b)
    raise ValueError(f"解釈できない色: {value}")


def luminance(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def load_themes(text):
    """{テーマID: {トークン名: 値}} を返す。ブロックの順序は保つ。"""
    themes = {}
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", re.sub(r"/\*.*?\*/", "", text, flags=re.S)):
        ids = re.findall(r'\[data-theme="([\w-]+)"\]', m.group(1))
        if not ids:
            continue
        tokens = dict(re.findall(r"--([\w-]+)\s*:\s*([^;]+);", m.group(2)))
        for theme_id in ids:
            themes.setdefault(theme_id, {}).update(tokens)
    return themes


def main():
    themes = load_themes(THEMES_CSS.read_text(encoding="utf-8"))
    if not themes:
        print("テーマが見つかりません:", THEMES_CSS)
        return 1
    failed = 0
    # 全テーマで同じトークンが定義されているか(定義漏れの検出)
    all_tokens = set().union(*(set(t) for t in themes.values()))
    for theme_id, tokens in themes.items():
        missing = sorted(all_tokens - set(tokens))
        if missing:
            print(f"NG  {theme_id}: 未定義のトークン: " + ", ".join("--" + m for m in missing))
            failed += len(missing)
    for theme_id, tokens in themes.items():
        if "bg" not in tokens:
            continue
        label = tokens.get("theme-label", theme_id).strip('"')
        print(f"\n== {label} ({theme_id}) ==")
        bg = parse_color(tokens["bg"])
        for fg_name, bg_name, minimum, desc in PAIRS:
            if fg_name not in tokens or bg_name not in tokens:
                print(f"  ?? 未定義のトークン: --{fg_name} / --{bg_name}")
                failed += 1
                continue
            back = parse_color(tokens[bg_name], over=bg)
            fore = parse_color(tokens[fg_name], over=back)
            r = ratio(fore, back)
            ok = r >= minimum
            failed += 0 if ok else 1
            print(f"  {'OK' if ok else 'NG'}  {r:5.2f} (>= {minimum})  {desc}  [--{fg_name} / --{bg_name}]")
    print("\n" + ("すべて合格です。" if not failed else f"不合格が {failed} 件あります。"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
