#!/usr/bin/env python3
"""
Сборка логотипа CYBERMOVE: три варианта знака (A, B, C), словесный знак «CYBER MOVE»
(Unbounded, в кривых), дескриптор «CONSULTING» (JetBrains Mono, разрядка), комплект favicon.

Запуск: python scripts/build-logo.py
Выход:  src/assets/logo/*.svg, public/favicon.svg, public/favicon-*.png, public/favicon.ico,
        public/apple-touch-icon.png, public/icon-*.png, public/site.webmanifest

Активный вариант сайта: B (см. docs/DECISIONS.md). Чтобы сменить на A или C:
    python scripts/build-logo.py --active a
"""
import argparse
import io
import math
import os
import struct
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import decompress
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / 'node_modules' / '@fontsource-variable'
OUT = ROOT / 'src' / 'assets' / 'logo'
PUBLIC = ROOT / 'public'

INK_DARK = '#F4F6FA'
ACCENT_DARK = '#4D7CFF'
INK_LIGHT = '#0E0F12'
ACCENT_LIGHT = '#0A24F5'


def load_instance(woff2_path: Path, axes: dict) -> TTFont:
    """WOFF2 → TTF в памяти → статический инстанс по осям."""
    buf = io.BytesIO()
    decompress(str(woff2_path), buf)
    buf.seek(0)
    font = TTFont(buf)
    if 'fvar' in font:
        font = instancer.instantiateVariableFont(font, axes, inplace=False, optimize=False)
    return font


class Face:
    def __init__(self, font: TTFont):
        self.font = font
        self.upm = font['head'].unitsPerEm
        self.cmap = font.getBestCmap()
        self.glyphs = font.getGlyphSet()
        self.hmtx = font['hmtx']
        os2 = font['OS/2']
        self.cap = getattr(os2, 'sCapHeight', None) or self.upm * 0.7

    def glyph_path(self, ch: str):
        name = self.cmap.get(ord(ch))
        if name is None:
            return None, 0
        g = self.glyphs[name]
        pen = SVGPathPen(self.glyphs)
        g.draw(pen)
        return pen.getCommands(), self.hmtx[name][0]

    def text_paths(self, text: str, cap_height: float, tracking_em: float = 0.0):
        """Список (path, dx) в единицах вывода. Масштаб: капитель = cap_height."""
        s = cap_height / self.cap
        x = 0.0
        out = []
        for ch in text:
            d, adv = self.glyph_path(ch)
            if d:
                out.append((d, x, s))
            x += adv * s + tracking_em * cap_height / 0.7 * 0.7 * (1 if ch != ' ' else 1)
            if ch == ' ':
                x -= tracking_em * cap_height  # пробел без лишней разрядки
        width = x - (tracking_em * cap_height if tracking_em else 0)
        return out, width


def text_group(face: Face, text: str, x: float, baseline: float, cap_height: float,
               fill: str, tracking_em: float = 0.0, attrs: str = ''):
    parts, width = face.text_paths(text, cap_height, tracking_em)
    g = [f'<g fill="{fill}" {attrs}>']
    for d, dx, s in parts:
        g.append(f'<path transform="translate({x + dx:.3f} {baseline:.3f}) scale({s:.5f} {-s:.5f})" d="{d}"/>')
    g.append('</g>')
    return '\n'.join(g), width


def pol(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def arc_path(cx, cy, r, a0, a1, stroke_w, fill):
    """Дуга постоянной толщины как stroke (углы в градусах, по часовой в SVG)."""
    x0, y0 = pol(cx, cy, r, a0)
    x1, y1 = pol(cx, cy, r, a1)
    sweep = (a1 - a0) % 360
    large = 1 if sweep > 180 else 0
    return (f'<path d="M{x0:.3f} {y0:.3f} A{r} {r} 0 {large} 1 {x1:.3f} {y1:.3f}" '
            f'fill="none" stroke="{fill}" stroke-width="{stroke_w}" stroke-linecap="round"/>')


def tapered_arc(cx, cy, r, a0, a1, w0, w1, fill, n=72):
    """Дуга с переменной толщиной от w0 (в начале) до w1 (в конце): замкнутая фигура."""
    outer, inner = [], []
    for i in range(n + 1):
        t = i / n
        a = a0 + (a1 - a0) * t
        # плавное нарастание толщины
        e = t * t * (3 - 2 * t)
        w = w0 + (w1 - w0) * e
        outer.append(pol(cx, cy, r + w / 2, a))
        inner.append(pol(cx, cy, r - w / 2, a))
    pts = outer + inner[::-1]
    d = 'M' + ' L'.join(f'{x:.3f} {y:.3f}' for x, y in pts) + ' Z'
    # скругляем толстый конец точкой
    ex, ey = pol(cx, cy, r, a1)
    return (f'<path d="{d}" fill="{fill}"/>'
            f'<circle cx="{ex:.3f}" cy="{ey:.3f}" r="{w1 / 2:.3f}" fill="{fill}"/>')


def mark(variant: str, ink: str, accent: str, cm_face: Face) -> str:
    """Знак в viewBox 0 0 100 100."""
    parts = []
    if variant == 'a':
        # A. Бережная перерисовка: CM гротеском в волосяном кольце, синяя черта вместо золотой.
        parts.append(f'<circle cx="50" cy="50" r="45" fill="none" stroke="{ink}" stroke-width="1.5"/>')
        cm, w = text_group(cm_face, 'CM', 0, 0, 30, ink, tracking_em=-0.02)
        parts.append(f'<g transform="translate({50 - w / 2:.3f} 58.5)">{cm}</g>')
        parts.append(f'<rect x="{50 - 11:.3f}" y="66.5" width="22" height="2" fill="{accent}"/>')
    elif variant == 'b':
        # B. Кольцо как орбита: разомкнутое кольцо, точка-электрон на нём, CM внутри.
        gap_start, gap_end = 296, 338  # разрыв справа сверху
        parts.append(arc_path(50, 50, 45, gap_end, gap_start, 1.6, ink))
        ex, ey = pol(50, 50, 45, gap_end + 2)
        parts.append(f'<circle cx="{ex:.3f}" cy="{ey:.3f}" r="4.6" fill="{accent}"/>')
        cm, w = text_group(cm_face, 'CM', 0, 0, 30, ink, tracking_em=-0.02)
        parts.append(f'<g transform="translate({50 - w / 2:.3f} 65)">{cm}</g>')
    elif variant == 'c':
        # C. Новый знак: ядро-точка и дуга орбиты в форме C, толщина нарастает по ходу движения.
        parts.append(tapered_arc(50, 50, 37, 42, 318, 1.4, 9.5, ink))
        parts.append(f'<circle cx="50" cy="50" r="7.5" fill="{accent}"/>')
    return '\n'.join(parts)


def svg(w, h, body, bg=None):
    bgrect = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="CYBERMOVE">\n{bgrect}{body}\n</svg>\n')


def lockup(variant, ink, accent, cm_face, wide_face, mono_face):
    """Горизонтальная версия: знак + CYBER MOVE + CONSULTING. Возвращает (svg, width)."""
    x0 = 122
    word, ww = text_group(wide_face, 'CYBER MOVE', x0, 55.5, 27, ink, tracking_em=0.0)
    desc, dw = text_group(mono_face, 'CONSULTING', x0 + 1.2, 78, 8.4, ink, tracking_em=0.42,
                          attrs='opacity="0.72"')
    width = math.ceil(x0 + ww + 6)
    body = f'<g>{mark(variant, ink, accent, cm_face)}</g>\n{word}\n{desc}'
    return svg(width, 100, body), width


def write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = 'wb' if isinstance(data, bytes) else 'w'
    with open(path, mode, **({} if mode == 'wb' else {'encoding': 'utf-8'})) as f:
        f.write(data)


def png_from_svg(svg_text: str, size: int) -> bytes:
    """Растр через sharp (node), чтобы не тянуть cairo в Python."""
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / 'in.svg'
        dst = Path(td) / 'out.png'
        src.write_text(svg_text, encoding='utf-8')
        code = (
            "const sharp=require('sharp');"
            f"sharp('{src.as_posix()}',{{density:384}}).resize({size},{size}).png().toFile('{dst.as_posix()}')"
            ".then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"
        )
        subprocess.run(['node', '-e', code], cwd=ROOT, check=True)
        return dst.read_bytes()


def ico_from_pngs(pngs):
    """ICO-контейнер с PNG-записями (16/32/48)."""
    header = struct.pack('<HHH', 0, 1, len(pngs))
    entries = b''
    data = b''
    offset = 6 + 16 * len(pngs)
    for size, png in pngs:
        s = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', s, s, 0, 0, 1, 32, len(png), offset)
        data += png
        offset += len(png)
    return header + entries + data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--active', default='b', choices=['a', 'b', 'c'])
    args = ap.parse_args()

    inter = Face(load_instance(FONTS / 'inter-tight' / 'files' / 'inter-tight-latin-wght-normal.woff2', {'wght': 640}))
    unbounded = Face(load_instance(FONTS / 'unbounded' / 'files' / 'unbounded-latin-wght-normal.woff2', {'wght': 600}))
    mono = Face(load_instance(FONTS / 'jetbrains-mono' / 'files' / 'jetbrains-mono-latin-wght-normal.woff2', {'wght': 520}))

    schemes = {
        'color-dark': (INK_DARK, ACCENT_DARK),
        'color-light': (INK_LIGHT, ACCENT_LIGHT),
        'mono-white': (INK_DARK, INK_DARK),
        'mono-black': (INK_LIGHT, INK_LIGHT),
    }

    for variant in 'abc':
        for scheme, (ink, accent) in schemes.items():
            s, _ = lockup(variant, ink, accent, inter, unbounded, mono)
            write(OUT / f'{variant}-horizontal-{scheme}.svg', s)
            write(OUT / f'{variant}-mark-{scheme}.svg', svg(100, 100, mark(variant, ink, accent, inter)))
        # Версия для инлайна в шапке: currentColor + CSS-переменная акцента
        s, _ = lockup(variant, 'currentColor', 'var(--logo-accent, #4D7CFF)', inter, unbounded, mono)
        write(OUT / f'{variant}-horizontal-current.svg', s)
        write(OUT / f'{variant}-mark-current.svg',
              svg(100, 100, mark(variant, 'currentColor', 'var(--logo-accent, #4D7CFF)', inter)))

    # Активный вариант: один файл logo.svg (шапка) + logo-mark.svg (компакт) + favicon
    a = args.active
    write(OUT / 'logo.svg', (OUT / f'{a}-horizontal-current.svg').read_text(encoding='utf-8'))
    write(OUT / 'logo-mark.svg', (OUT / f'{a}-mark-current.svg').read_text(encoding='utf-8'))

    # Favicon: знак на чёрной плашке со скруглением 20%
    fav_body = (f'<rect width="100" height="100" rx="20" fill="#050505"/>'
                f'<g transform="translate(9 9) scale(0.82)">{mark(a, INK_DARK, ACCENT_DARK, inter)}</g>')
    fav_svg = svg(100, 100, fav_body)
    write(PUBLIC / 'favicon.svg', fav_svg)
    pngs = []
    for size in (16, 32, 48, 180, 192, 512):
        png = png_from_svg(fav_svg, size)
        if size in (16, 32, 48):
            pngs.append((size, png))
        name = {180: 'apple-touch-icon.png', 192: 'icon-192.png', 512: 'icon-512.png'}.get(size, f'favicon-{size}.png')
        write(PUBLIC / name, png)
    write(PUBLIC / 'favicon.ico', ico_from_pngs(pngs))
    write(PUBLIC / 'site.webmanifest', (
        '{\n  "name": "CYBERMOVE",\n  "short_name": "CYBERMOVE",\n'
        '  "icons": [\n    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },\n'
        '    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }\n  ],\n'
        '  "theme_color": "#050505",\n  "background_color": "#050505",\n  "display": "browser"\n}\n'))
    print(f'Логотип собран. Активный вариант: {a.upper()}. Файлы: {OUT} и {PUBLIC}')


if __name__ == '__main__':
    main()
