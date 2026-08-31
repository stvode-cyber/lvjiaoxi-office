#!/usr/bin/env python3
"""从 app/icons/icon-512.png 生成 Android 自适应启动图标。

产物：
  - mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
  - mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_round.png
  - mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_foreground.png
  - mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_background.png
  - mipmap-anydpi-v26/ic_launcher.xml
  - mipmap-anydpi-v26/ic_launcher_round.xml
  - values/colors.xml（ic_launcher_background）

用法：
  python scripts/generate-android-icons.py
"""
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC_ICON = ROOT / "app" / "icons" / "icon-512.png"
RES_DIR = ROOT / "clients" / "android" / "app" / "src" / "main" / "res"

# Android 标准密度 (dp 到 px 的倍数)
DENSITIES = {
    "mdpi": 1.0,      # 基准
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}

# 图标尺寸（dp）
LEGACY_DP = 48       # mdpi 48x48
FOREGROUND_DP = 108  # 自适应图标前景/背景层 108x108

# 从源图标提取背景主色的采样区域（左上 1/4，避开文字）
BG_SAMPLE_BOX = (0, 0, 256, 256)


def _dist(c1: tuple[int, ...], c2: tuple[int, ...]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1, c2)))


def _iter_pixels(img: Image.Image):
    """用 load() 遍历像素，避免 Pillow 14 移除 getdata()。"""
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            yield px[x, y]


def extract_background_color(img: Image.Image) -> tuple[int, int, int]:
    """取采样区内最常见、且不是白/绿的像素颜色作为背景品牌色。"""
    region = img.crop(BG_SAMPLE_BOX).convert("RGBA")
    colors: dict[tuple[int, int, int], int] = {}
    for r, g, b, a in _iter_pixels(region):
        if a < 128:
            continue
        # 排除接近白色（文字）和明显绿色（犀牛角）
        if r > 240 and g > 240 and b > 240:
            continue
        if g > b + 40 and g > r + 20:
            continue
        colors[(r, g, b)] = colors.get((r, g, b), 0) + 1
    if colors:
        return max(colors.items(), key=lambda kv: kv[1])[0]
    return (0x2B, 0x6B, 0xED)


def make_foreground(img: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """把源图标中的背景品牌色抠成透明，得到自适应图标的前景层。"""
    rgba = img.convert("RGBA")
    bg_r, bg_g, bg_b = bg
    out = Image.new("RGBA", rgba.size)
    out_px = out.load()
    src_px = rgba.load()
    threshold = 36.0
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = src_px[x, y]
            d = _dist((r, g, b), bg)
            # 距离越近越透明
            alpha = max(0.0, min(1.0, d / threshold))
            if alpha < 0.001:
                out_px[x, y] = (0, 0, 0, 0)
                continue
            # 反乘以得到前景层原始颜色：C = alpha*F + (1-alpha)*B
            fr = int(max(0, min(255, (r - (1 - alpha) * bg_r) / alpha)))
            fg = int(max(0, min(255, (g - (1 - alpha) * bg_g) / alpha)))
            fb = int(max(0, min(255, (b - (1 - alpha) * bg_b) / alpha)))
            fa = int(max(0, min(255, a * alpha)))
            out_px[x, y] = (fr, fg, fb, fa)
    return out


def resize(img: Image.Image, px: int) -> Image.Image:
    return img.resize((px, px), Image.Resampling.LANCZOS)


def save_png(img: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG")


def main() -> int:
    if not SRC_ICON.exists():
        print(f"源图标不存在: {SRC_ICON}", file=sys.stderr)
        return 1

    src = Image.open(SRC_ICON)
    bg_color = extract_background_color(src)
    fg = make_foreground(src, bg_color)
    bg = Image.new("RGBA", src.size, bg_color + (255,))

    hex_color = "#{:02X}{:02X}{:02X}".format(*bg_color)
    print(f"检测到品牌背景色: {hex_color}")

    # 写入 values/colors.xml
    colors_dir = RES_DIR / "values"
    colors_dir.mkdir(parents=True, exist_ok=True)
    (colors_dir / "colors.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        f'    <color name="ic_launcher_background">{hex_color}</color>\n'
        '</resources>\n',
        encoding="utf-8",
    )

    # 按密度输出 PNG
    for name, scale in DENSITIES.items():
        mipmap = RES_DIR / f"mipmap-{name}"
        mipmap.mkdir(parents=True, exist_ok=True)

        legacy_px = int(LEGACY_DP * scale)
        layer_px = int(FOREGROUND_DP * scale)

        save_png(resize(src, legacy_px), mipmap / "ic_launcher.png")
        save_png(resize(src, legacy_px), mipmap / "ic_launcher_round.png")
        save_png(resize(fg, layer_px), mipmap / "ic_launcher_foreground.png")
        save_png(resize(bg, layer_px), mipmap / "ic_launcher_background.png")
        print(f"  mipmap-{name}: {legacy_px}px legacy / {layer_px}px layer")

    # anydpi-v26 自适应 XML
    anydpi = RES_DIR / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    adaptive_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n'
    )
    (anydpi / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")

    print(f"Android 启动图标已生成到: {RES_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
