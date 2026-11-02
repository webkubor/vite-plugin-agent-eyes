#!/usr/bin/env python3
"""从博客真实运行截图制作 README 的轻量演示动图。只读源截图。"""

from __future__ import annotations

import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

FONT = "/System/Library/Fonts/STHeiti Medium.ttc"
FRAMES = [
    ("01 · 真实网站", "在 webkubor 博客打开作品路由", "projects"),
    ("02 · 页面入口", "右下角 Agent Eyes，点开就有视野", "projects-badge"),
    ("03 · 爬虫体检", "robots · 54 条 sitemap · llms.txt", "crawler"),
    ("04 · 浏览器能力", "识别 Chrome / CDP，匹配当前路由", "browser"),
    ("05 · 路由截图", "带上项目、路由、时间；留下截图索引", "snapshot"),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size)


def fit(source: Path, canvas: tuple[int, int], crop: tuple[int, int, int, int] | None) -> Image.Image:
    image = Image.open(source).convert("RGB")
    if crop:
        image = image.crop(crop)
    return ImageOps.fit(image, canvas, method=Image.Resampling.LANCZOS, centering=(.5, .25))


def card(source: Path, title: str, subtitle: str, crop=None) -> Image.Image:
    width, height = 1000, 655
    bg = Image.new("RGB", (width, height), "#081424")
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((24, 20, width - 24, height - 22), radius=24, fill="#101e32", outline="#294359", width=2)
    d.text((52, 35), "AGENT EYES  /  WEBKUBOR BLOG", font=font(16), fill="#7dd3e9")
    d.text((52, 70), title, font=font(34), fill="#f4f7fb")
    d.text((52, 123), subtitle, font=font(19), fill="#a5b9ca")
    shot = fit(source, (896, 450), crop)
    bg.paste(shot, (52, 179))
    d.rounded_rectangle((51, 178, 949, 630), radius=10, outline="#638397", width=2)
    return bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    source = args.source
    mapping = {
        "projects": (source / "agent-eyes-demo-projects-stable.png", None),
        "projects-badge": (source / "agent-eyes-demo-projects-stable.png", (990, 385, 1713, 939)),
        "crawler": (source / "agent-eyes-demo-crawler-centered.png", (320, 65, 1400, 795)),
        "browser": (source / "agent-eyes-demo-04.png", (270, 130, 1450, 690)),
        "snapshot": (source / "agent-eyes-demo-05.png", (270, 130, 1450, 939)),
    }
    frames = [card(mapping[key][0], title, subtitle, mapping[key][1]) for title, subtitle, key in FRAMES]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # 固定有限色板，控制 GitHub README 加载成本。
    palette = frames[0].quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    encoded = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    encoded[0].save(args.output, save_all=True, append_images=encoded[1:], duration=[1500, 1500, 2000, 1900, 2300], loop=0, optimize=True, disposal=2)
    print(f"{args.output}: {args.output.stat().st_size / 1024 / 1024:.2f} MiB, {len(frames)} frames")


if __name__ == "__main__":
    main()
