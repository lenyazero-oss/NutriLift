"""ホーム画面用のPNGアイコンを生成する(icons/icon.svg と同じ絵をPillowで描く)。

使い方(プロジェクト直下で):
    pip install pillow      # 初回のみ
    python tools/make_icons.py

icons/icon-180.png, icon-192.png, icon-512.png を作成(既存は上書き)。
icon.svg の見た目を変えたときは、このファイルの座標も合わせて直すこと。
SVGを読み込むのではなく同じ座標を直書きしているのは、Windowsでcairoなどの
追加ライブラリを入れずに済ませるため。
"""
from pathlib import Path

from PIL import Image, ImageDraw

BASE = 512          # icon.svg の viewBox
SCALE = 4           # 4倍で描いてから縮小し、縁をなめらかにする
GREEN = (0x1F, 0x8A, 0x4C)
WHITE = (255, 255, 255)
SIZES = (180, 192, 512)


def draw_master() -> Image.Image:
    s = SCALE
    img = Image.new("RGB", (BASE * s, BASE * s), GREEN)
    d = ImageDraw.Draw(img)

    def rrect(x, y, w, h, r):
        d.rounded_rectangle([x * s, y * s, (x + w) * s - 1, (y + h) * s - 1], radius=r * s, fill=WHITE)

    # ダンベル(icon.svg の <g> と同じ座標)
    rrect(96, 216, 64, 80, 12)
    rrect(352, 216, 64, 80, 12)
    rrect(60, 238, 36, 36, 8)
    rrect(416, 238, 36, 36, 8)
    d.rectangle([160 * s, 248 * s, 352 * s - 1, 264 * s - 1], fill=WHITE)

    # 「P」: フォントに依存しないよう、縦棒+輪(白)+穴(緑)で描く(icon.svg も同じ図形)
    d.rectangle([230 * s, 342 * s, 244 * s - 1, 402 * s - 1], fill=WHITE)
    rrect(230, 342, 52, 40, 20)
    d.rounded_rectangle([244 * s, 356 * s, 268 * s - 1, 368 * s - 1], radius=6 * s, fill=GREEN)
    return img


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "icons"
    out_dir.mkdir(exist_ok=True)
    master = draw_master()
    for size in SIZES:
        path = out_dir / f"icon-{size}.png"
        master.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print(f"作成: {path}")


if __name__ == "__main__":
    main()
