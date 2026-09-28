# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Generate barcodes as SVG or PNG with zxing-cpp (SPEC section 7)."""

from __future__ import annotations

import io
import os
import re
from typing import Any, Optional, Tuple, Union

import zxingcpp

from .symbologies import SYMBOLOGIES, resolve_symbology, zxing_create_format

__all__ = ["GenerateError", "generate", "save", "IMAGE_FORMATS"]

#: Output formats accepted by :func:`generate` (``svg`` is text, the rest are raster).
IMAGE_FORMATS = ("svg", "png", "jpeg", "webp", "bmp", "gif", "tiff")

_EXTENSIONS = {
    ".svg": "svg",
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".webp": "webp",
    ".bmp": "bmp",
    ".gif": "gif",
    ".tif": "tiff",
    ".tiff": "tiff",
}

Color = Union[str, Tuple[int, int, int], Tuple[int, int, int, int]]


class GenerateError(ValueError):
    """Raised when the data cannot be encoded with the requested options."""


def _parse_color(color: Optional[Color], default: Tuple[int, int, int, int]) -> Tuple[int, int, int, int]:
    if color is None or color == "":
        return default
    if isinstance(color, (tuple, list)):
        values = [int(c) for c in color]
        if len(values) == 3:
            values.append(255)
        if len(values) != 4 or not all(0 <= v <= 255 for v in values):
            raise GenerateError(f"Invalid color {color!r}")
        return (values[0], values[1], values[2], values[3])
    text = str(color).strip().lower()
    if text == "transparent":
        return (255, 255, 255, 0)
    match = re.fullmatch(r"#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})", text)
    if not match:
        raise GenerateError(f"Invalid color {color!r}; use #rgb, #rrggbb or #rrggbbaa")
    hexpart = match.group(1)
    if len(hexpart) in (3, 4):
        hexpart = "".join(ch * 2 for ch in hexpart)
    if len(hexpart) == 6:
        hexpart += "ff"
    r, g, b, a = (int(hexpart[i : i + 2], 16) for i in range(0, 8, 2))
    return (r, g, b, a)


def _create(data: Union[str, bytes], symbology: str, ec_level: Optional[str], gs1: bool) -> Any:
    sid = resolve_symbology(symbology)
    try:
        fmt = zxing_create_format(sid)
    except ValueError as exc:
        raise GenerateError(str(exc)) from exc
    kwargs: dict = {}
    if ec_level not in (None, ""):
        kwargs["ec_level"] = str(ec_level)
    if gs1:
        kwargs["gs1"] = True
    try:
        return zxingcpp.create_barcode(data, fmt, **kwargs)
    except Exception as exc:  # zxing-cpp raises ValueError/RuntimeError subclasses
        raise GenerateError(f"Cannot encode {SYMBOLOGIES[sid].name}: {exc}") from exc


def _color_svg(svg: str, fg: Tuple[int, int, int, int], bg: Tuple[int, int, int, int]) -> str:
    def paint(rgba: Tuple[int, int, int, int]) -> str:
        attr = 'fill="#%02X%02X%02X"' % rgba[:3]
        if rgba[3] < 255:
            attr += ' fill-opacity="%s"' % round(rgba[3] / 255.0, 3)
        return attr

    svg = svg.replace('<g id="barcode" fill="#000000">', "<g id=\"barcode\" %s>" % paint(fg), 1)
    svg = re.sub(r'(<rect x="0" y="0" width="[\d.]+" height="[\d.]+") fill="#FFFFFF"', r"\1 " + paint(bg), svg, 1)
    return svg


def generate(
    data: Union[str, bytes],
    symbology: str = "qr",
    format: str = "svg",
    scale: int = 4,
    ec_level: Optional[str] = None,
    gs1: bool = False,
    hrt: bool = False,
    margin: bool = True,
    foreground: Optional[Color] = None,
    background: Optional[Color] = None,
) -> Union[str, bytes]:
    """Encode ``data`` as a barcode image.

    Args:
        data: Text to encode. ``bytes`` are encoded as binary data (2D codes only).
            With ``gs1=True`` pass the HRI form, for example
            ``"(01)09501101530003(17)250101(10)ABC123"``.
        symbology: Any writable id or alias from SPEC section 7 (default ``"qr"``).
        format: ``"svg"`` (returns ``str``) or ``"png"`` (returns ``bytes``); ``jpeg``,
            ``webp``, ``bmp``, ``gif`` and ``tiff`` are also accepted.
        scale: Pixels per module (bar or cell), at least 1.
        ec_level: Error correction. ``L``/``M``/``Q``/``H`` for QR, Micro QR and rMQR;
            ``0``-``8`` or a percentage for PDF417 and Aztec. ``None`` uses the engine default.
        gs1: Encode GS1 element strings (FNC1 mode) for Code 128, Data Matrix, QR...
        hrt: Add human readable text under linear barcodes.
        margin: Include the quiet zone.
        foreground: Bar color as ``#rrggbb``/``#rrggbbaa`` or an RGB(A) tuple (default black).
        background: Background color, or ``"transparent"`` (default white).

    Returns:
        The SVG document as ``str``, or encoded image bytes for raster formats.

    Raises:
        GenerateError: if the data is invalid for the symbology or an option is wrong.
        UnknownSymbologyError: if ``symbology`` is unknown.

    Example:
        >>> svg = generate("https://example.com")
        >>> svg.lstrip().startswith("<?xml")
        True
    """
    fmt = str(format or "svg").lower().lstrip(".")
    if fmt == "jpg":
        fmt = "jpeg"
    if fmt == "tif":
        fmt = "tiff"
    if fmt not in IMAGE_FORMATS:
        raise GenerateError(f"Unsupported format {format!r}; use one of {', '.join(IMAGE_FORMATS)}")
    try:
        scale = int(scale)
    except (TypeError, ValueError) as exc:
        raise GenerateError(f"scale must be an integer, got {scale!r}") from exc
    if scale < 1 or scale > 100:
        raise GenerateError("scale must be between 1 and 100")
    if isinstance(data, str) and data == "":
        raise GenerateError("data must not be empty")

    fg = _parse_color(foreground, (0, 0, 0, 255))
    bg = _parse_color(background, (255, 255, 255, 255))
    barcode = _create(data, symbology, ec_level, gs1)

    if fmt == "svg":
        svg = barcode.to_svg(scale=scale, add_hrt=bool(hrt), add_quiet_zones=bool(margin))
        if fg != (0, 0, 0, 255) or bg != (255, 255, 255, 255):
            svg = _color_svg(svg, fg, bg)
        return svg

    from PIL import Image, ImageOps

    gray = Image.fromarray(barcode.to_image(scale=scale, add_hrt=bool(hrt), add_quiet_zones=bool(margin)))
    if gray.mode != "L":
        gray = gray.convert("L")
    if fg == (0, 0, 0, 255) and bg == (255, 255, 255, 255):
        out = gray
    else:
        mask = ImageOps.invert(gray)
        out = Image.composite(Image.new("RGBA", gray.size, fg), Image.new("RGBA", gray.size, bg), mask)
        if fg[3] == 255 and bg[3] == 255:
            out = out.convert("RGB")
    if fmt in ("jpeg", "bmp") and out.mode == "RGBA":
        out = out.convert("RGB")
    buffer = io.BytesIO()
    out.save(buffer, format=fmt.upper())
    return buffer.getvalue()


def save(data: Union[str, bytes], path: Union[str, "os.PathLike[str]"], **options: Any) -> str:
    """Generate a barcode and write it to ``path``.

    The format is picked from the file extension (``.svg``, ``.png``, ``.jpg``,
    ``.webp``, ``.bmp``, ``.gif``, ``.tiff``) unless ``format=`` is given. Other
    keyword arguments are passed to :func:`generate`.

    Returns:
        The path written, as a string.
    """
    target = os.fspath(path)
    if "format" not in options:
        ext = os.path.splitext(target)[1].lower()
        if ext not in _EXTENSIONS:
            raise GenerateError(f"Cannot infer the image format from {target!r}; pass format='svg' or 'png'")
        options["format"] = _EXTENSIONS[ext]
    output = generate(data, **options)
    if isinstance(output, str):
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(output)
    else:
        with open(target, "wb") as handle:
            handle.write(output)
    return target
