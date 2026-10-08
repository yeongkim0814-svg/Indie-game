#!/usr/bin/env python3
"""GPT 풍경 이미지 -> 도트 레이어 변환.

art-src/<layer>.(png|jpg|webp) -> public/art/vista-<layer>.png + manifest.json

처리 순서
 1. 높이 180px로 축소(Lanczos, 종횡비 유지). 폭이 540 미만이면 좌우를 거울 반사로
    이어 붙여 540으로 맞춘다(원본이 중앙, 양옆은 반사 -> 이음새가 눈에 띄지 않음).
 2. sky 외 레이어: 원본 해상도에서 마젠타 크로마키 -> 가장자리 despill -> 축소 ->
    알파 재이진화(0/255) -> 축소 후 가장자리 한 번 더 despill/제거.
 3. 모든 레이어가 공유하는 48색 팔레트(앵커 15색 + kmeans 33색)로 디더링 없이 매핑.
"""
import argparse
import colorsys
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

LAYERS = ["sky", "far", "mid", "near"]
EXTS = [".png", ".jpg", ".jpeg", ".webp"]
H, MIN_W = 180, 540
N_COLORS = 48
ANCHORS = ["#192925", "#273e2b", "#395330", "#537039", "#8a9f48", "#122027",
           "#1b2e39", "#263c47", "#3b4d56", "#567886", "#377cc7", "#a3cfe3",
           "#fcfbf6", "#4b82bd", "#84afd6"]


def pix(img):
    """픽셀 리스트 (Pillow 12~14 호환)."""
    f = getattr(img, "get_flattened_data", None)
    return list(f() if f else img.getdata())


def hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def is_magenta(r, g, b, dist=110):
    """배경 마젠타 판정: (255,0,255)에 가깝거나, 색상 ~300도 + 고채도 + R,B >> G."""
    if (255 - r) ** 2 + g * g + (255 - b) ** 2 < dist * dist:
        return True
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == 0 or (mx - mn) / mx < 0.45:
        return False
    if min(r, b) - g < 60:
        return False
    h = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360
    return 270 <= h <= 330


def spill(r, g, b):
    return min(r, b) - g


def key_and_despill(img, edge_px, drop_spill):
    """RGBA 이미지에서 마젠타를 투명화하고, 투명과 edge_px 이내인 픽셀은 despill/제거."""
    img = img.convert("RGBA")
    px = list(pix(img))
    alpha = Image.new("L", img.size)
    alpha.putdata([0 if (a < 128 or is_magenta(r, g, b)) else 255 for r, g, b, a in px])
    # 투명 영역을 edge_px 만큼 확장 -> 가장자리 밴드
    size = edge_px * 2 + 1
    grown = alpha.point(lambda v: 255 - v).filter(ImageFilter.MaxFilter(size))
    band = list(pix(grown))
    al = list(pix(alpha))
    out = []
    for (r, g, b, _), a, e in zip(px, al, band):
        if a and e:  # 가장자리 밴드
            s = spill(r, g, b)
            if s > drop_spill:
                a = 0
            elif s > 0:
                r, b = r - s, b - s  # R,B를 G 기준으로 끌어내림
        out.append((r, g, b, a))
    res = Image.new("RGBA", img.size)
    res.putdata(out)
    return res


def fill_transparent(img):
    """투명 픽셀 RGB를 가까운 불투명 색으로 채워 축소 시 색 번짐을 막는다(근사: 팽창 반복)."""
    rgb, a = img.convert("RGB"), img.getchannel("A")
    solid = Image.composite(rgb, Image.new("RGB", img.size, (0, 0, 0)), a)
    mask = a.copy()
    for _ in range(6):
        grown = solid.filter(ImageFilter.MaxFilter(3))
        solid = Image.composite(solid, grown, mask)
        mask = mask.filter(ImageFilter.MaxFilter(3))
    out = solid.convert("RGBA")
    out.putalpha(a)
    return out


def resize_layer(img, keyed):
    w, h = img.size
    nw = max(1, round(w * H / h))
    if keyed:
        img = fill_transparent(img)
    # Pillow는 RGBA를 premultiplied로 리샘플링한다
    small = img.resize((nw, H), Image.LANCZOS)
    if nw < MIN_W:
        small = mirror_pad(small, MIN_W)
    return small


def mirror_pad(img, width):
    w, h = img.size
    need = width - w
    left = need // 2
    canvas = Image.new("RGBA", (width, h))
    x0 = left
    canvas.paste(img, (x0, 0))
    flip = img.transpose(Image.FLIP_LEFT_RIGHT)
    x = x0
    while x > 0:  # 왼쪽: 반사본을 번갈아 붙임
        x -= w
        canvas.paste(flip if ((x0 - x) // w) % 2 == 1 else img, (x, 0))
    x = x0 + w
    while x < width:
        canvas.paste(flip if ((x - x0) // w) % 2 == 1 else img, (x, 0))
        x += w
    return canvas


def binarize(img):
    a = img.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    img = img.copy()
    img.putalpha(a)
    return img


def load_source(src, layer):
    for ext in EXTS:
        for cand in (src / (layer + ext), src / (layer + ext.upper())):
            if cand.exists():
                try:
                    im = Image.open(cand)
                    im.load()
                    return im
                except Exception as e:  # noqa: BLE001
                    sys.exit(f"[오류] {cand} 읽기 실패: {e}")
    return None


def build_palette(layers):
    anchors = [hex2rgb(h) for h in ANCHORS]
    pixels = []
    for img in layers.values():
        pixels += [(r, g, b) for r, g, b, a in pix(img) if a]
    pal = list(anchors)
    k = N_COLORS - len(anchors)
    if pixels:
        comb = Image.new("RGB", (len(pixels), 1))
        comb.putdata(pixels)
        q = comb.quantize(colors=k, method=Image.MEDIANCUT, kmeans=3, dither=Image.NONE)
        flat = q.getpalette()[:3 * k]
        used = {i for i in pix(q)}
        for i in sorted(used):
            c = tuple(flat[3 * i:3 * i + 3])
            if c not in pal:
                pal.append(c)
    return pal[:N_COLORS]


def apply_palette(img, pal):
    cache = {}

    def nearest(c):
        if c not in cache:
            cache[c] = min(pal, key=lambda p: (p[0] - c[0]) ** 2 * 3 + (p[1] - c[1]) ** 2 * 4
                           + (p[2] - c[2]) ** 2 * 2)
        return cache[c]

    out = [nearest((r, g, b)) + (255,) if a else (0, 0, 0, 0) for r, g, b, a in pix(img)]
    res = Image.new("RGBA", img.size)
    res.putdata(out)
    return res


def main():
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description="art-src 이미지를 도트 레이어로 변환")
    ap.add_argument("--src", default=str(root / "art-src"))
    ap.add_argument("--out", default=str(root / "public" / "art"))
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    processed = {}
    for layer in LAYERS:
        im = load_source(src, layer)
        if im is None:
            continue
        keyed = layer != "sky"
        rgba = im.convert("RGBA")
        if keyed:
            rgba = key_and_despill(rgba, edge_px=3, drop_spill=70)
        small = binarize(resize_layer(rgba, keyed))
        if keyed:  # 축소 후 재점검: 남은 마젠타 기운 제거
            small = binarize(key_and_despill(small, edge_px=1, drop_spill=45))
        else:
            small.putalpha(255)
        processed[layer] = small

    pal = build_palette(processed)
    manifest = {"layers": {}, "palette": ["#%02x%02x%02x" % c for c in pal] if processed else []}
    for layer in LAYERS:
        f = out / f"vista-{layer}.png"
        if layer not in processed:
            if f.exists():
                f.unlink()  # 소스가 없는 레이어의 오래된 결과물 정리
            continue
        img = apply_palette(processed[layer], pal)
        img.save(f)
        manifest["layers"][layer] = f.name
        n = img.size[0] * img.size[1]
        opaque = sum(1 for p in pix(img) if p[3])
        colors = len({p[:3] for p in pix(img) if p[3]})
        print(f"{layer:5s} {img.size[0]}x{img.size[1]}  opaque {100 * opaque / n:5.1f}%  colors {colors}")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"레이어 {len(manifest['layers'])}개, 팔레트 {len(manifest['palette'])}색 -> {out}")


if __name__ == "__main__":
    main()
