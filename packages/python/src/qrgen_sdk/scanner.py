"""Decode barcodes from still images with zxing-cpp."""

from __future__ import annotations

import io
import os
from typing import Any, Iterable, List, Optional, Tuple, Union

import zxingcpp

from .models import Barcode, Point, Quad, Size, now_ms
from .symbologies import id_from_zxing, resolve_symbologies, symbology_name, to_zxing_formats

__all__ = ["ImageInput", "scan", "scan_file", "decode", "ScanError"]

#: Anything :func:`scan` accepts: a path, encoded image bytes, a binary file object,
#: a ``PIL.Image.Image`` or a numpy array (grayscale, BGR, or BGRA).
ImageInput = Union[str, "os.PathLike[str]", bytes, bytearray, memoryview, Any]

_CONTENT_TYPES = {
    "Text": "text",
    "Binary": "binary",
    "Mixed": "mixed",
    "GS1": "gs1",
    "ISO15434": "iso15434",
    "UnknownECI": "unknown-eci",
}


class ScanError(ValueError):
    """Raised when the input cannot be turned into an image."""


def _load_image(image: ImageInput) -> Tuple[Any, int, int]:
    """Return ``(zxing-compatible image, width, height)``."""
    from PIL import Image, UnidentifiedImageError

    if isinstance(image, (str, os.PathLike)):
        try:
            pil = Image.open(os.fspath(image))
            pil.load()
        except FileNotFoundError:
            raise
        except (UnidentifiedImageError, OSError) as exc:
            raise ScanError(f"Cannot read image {os.fspath(image)!r}: {exc}") from exc
        return _prepare_pil(pil)
    if isinstance(image, (bytes, bytearray, memoryview)):
        try:
            pil = Image.open(io.BytesIO(bytes(image)))
            pil.load()
        except (UnidentifiedImageError, OSError) as exc:
            raise ScanError(f"Cannot decode image bytes: {exc}") from exc
        return _prepare_pil(pil)
    if isinstance(image, Image.Image):
        return _prepare_pil(image)
    if hasattr(image, "read") and callable(image.read):
        return _load_image(image.read())
    shape = getattr(image, "shape", None)
    if shape is not None and hasattr(image, "__array_interface__"):
        return _prepare_array(image)
    raise ScanError(f"Unsupported image type: {type(image).__name__}")


def _prepare_pil(pil: Any) -> Tuple[Any, int, int]:
    from PIL import ImageOps

    try:
        pil = ImageOps.exif_transpose(pil)
    except Exception:  # pragma: no cover - broken EXIF data should not break scanning
        pass
    if pil.mode not in ("L", "RGB", "RGBA"):
        if pil.mode in ("1", "I", "I;16", "F"):
            pil = pil.convert("L")
        else:
            pil = pil.convert("RGBA" if "A" in pil.getbands() or "transparency" in pil.info else "RGB")
    if pil.mode == "RGBA":
        # Composite transparent pixels on white so dark-on-transparent codes decode.
        from PIL import Image

        background = Image.new("RGBA", pil.size, (255, 255, 255, 255))
        pil = Image.alpha_composite(background, pil).convert("RGB")
    width, height = pil.size
    return pil, width, height


def _prepare_array(array: Any) -> Tuple[Any, int, int]:
    import numpy as np

    arr = np.asarray(array)
    if arr.dtype != np.uint8:
        if arr.dtype.kind == "f" and arr.max(initial=0) <= 1.0:
            arr = (arr * 255).clip(0, 255)
        arr = arr.astype(np.uint8)
    if arr.ndim == 3 and arr.shape[2] == 1:
        arr = arr[:, :, 0]
    elif arr.ndim == 3 and arr.shape[2] == 4:
        arr = arr[:, :, :3]
    elif arr.ndim not in (2, 3):
        raise ScanError(f"Unsupported array shape {arr.shape}")
    arr = np.ascontiguousarray(arr)
    height, width = arr.shape[:2]
    return arr, width, height


def _to_barcode(result: Any, requested: List[str], width: int, height: int, timestamp: int) -> Optional[Barcode]:
    fmt_name = result.format.name
    text = result.text
    symbology_identifier = result.symbology_identifier or ""
    sid = id_from_zxing(fmt_name, text, requested, symbology_identifier)
    if sid is None:
        return None

    # zxing-cpp v3 reports UPC-A/UPC-E as 13 digit EAN-13 strings; QRGen uses the
    # conventional 12 digit UPC-A and 8 digit UPC-E forms (as ML Kit and Vision do).
    if sid == "upca" and len(text) == 13 and text.startswith("0") and text.isdigit():
        text = text[1:]
    elif sid == "upce":
        extra = result.extra if isinstance(result.extra, dict) else {}
        short = extra.get("UPCE")
        if isinstance(short, str) and short.isdigit():
            text = short

    pos = result.position

    def point(p: Any) -> Point:
        # zxing-cpp can extrapolate corners a pixel or two outside the image.
        return Point(min(max(p.x, 0), width), min(max(p.y, 0), height))

    location = Quad(point(pos.top_left), point(pos.top_right), point(pos.bottom_right), point(pos.bottom_left))
    content_type = _CONTENT_TYPES.get(result.content_type.name, "text")
    return Barcode(
        data=text,
        symbology=sid,
        symbology_name=symbology_name(sid),
        raw_bytes=bytes(result.bytes or b""),
        content_type=content_type,
        is_gs1=content_type == "gs1",
        location=location,
        frame_size=Size(width, height),
        orientation=int(result.orientation or 0),
        ec_level=result.ec_level or "",
        symbology_identifier=symbology_identifier,
        timestamp=timestamp,
    )


def scan(
    image: ImageInput,
    symbologies: Union[None, str, Iterable[str]] = None,
    try_harder: bool = True,
    max_results: Optional[int] = None,
) -> List[Barcode]:
    """Decode every barcode in an image.

    Args:
        image: A file path, encoded image bytes (PNG, JPEG, GIF, BMP, TIFF, WebP...), a
            binary file object, a ``PIL.Image.Image`` or a numpy array (grayscale,
            BGR as returned by OpenCV, or BGRA).
        symbologies: Ids, aliases or groups (SPEC section 1). ``None`` means ``"all"``.
        try_harder: Also search rotated, downscaled and inverted variants, and retry
            with a second binarizer when nothing is found. Set ``False`` for speed
            (for example on live camera frames).
        max_results: Stop after this many codes. ``None`` returns all of them.

    Returns:
        Decoded barcodes in the order zxing-cpp found them. GS1 data is returned in
        HRI form, for example ``"(01)09501101530003(17)250101"``.

    Raises:
        ScanError: if the input is not a readable image.
        FileNotFoundError: if a path does not exist.
        UnknownSymbologyError: if a symbology name is unknown.

    Example:
        >>> from qrgen_sdk import generate, scan
        >>> png = generate("hello", format="png")
        >>> [b.data for b in scan(png, symbologies=["qr"])]
        ['hello']
    """
    requested = resolve_symbologies(symbologies)
    img, width, height = _load_image(image)
    binarizers = [zxingcpp.Binarizer.LocalAverage]
    if try_harder:
        binarizers.append(zxingcpp.Binarizer.GlobalHistogram)
    return decode(
        img,
        requested,
        width,
        height,
        try_rotate=try_harder,
        try_downscale=try_harder,
        try_invert=try_harder,
        binarizers=binarizers,
        max_results=max_results,
    )


def decode(
    img: Any,
    requested: List[str],
    width: int,
    height: int,
    *,
    try_rotate: bool = True,
    try_downscale: bool = True,
    try_invert: bool = True,
    binarizers: Optional[List[Any]] = None,
    max_results: Optional[int] = None,
) -> List[Barcode]:
    """Low-level decode of an already prepared image (PIL image or numpy array).

    ``requested`` must be resolved ids (see :func:`qrgen_sdk.resolve_symbologies`).
    Binarizers are tried in order until one of them finds a code. Most callers
    should use :func:`scan` instead.
    """
    formats = to_zxing_formats(requested)
    timestamp = now_ms()
    barcodes: List[Barcode] = []
    seen = set()
    for binarizer in binarizers or [zxingcpp.Binarizer.LocalAverage]:
        results = zxingcpp.read_barcodes(
            img,
            formats=formats,
            try_rotate=try_rotate,
            try_downscale=try_downscale,
            try_invert=try_invert,
            text_mode=zxingcpp.TextMode.HRI,
            binarizer=binarizer,
        )
        for result in results:
            barcode = _to_barcode(result, requested, width, height, timestamp)
            if barcode is None:
                continue
            key = (barcode.symbology, barcode.data, barcode.location.bounds)
            if key in seen:
                continue
            seen.add(key)
            barcodes.append(barcode)
            if max_results is not None and len(barcodes) >= max_results:
                return barcodes
        if barcodes:
            break
    return barcodes


def scan_file(
    path: Union[str, "os.PathLike[str]"],
    symbologies: Union[None, str, Iterable[str]] = None,
    try_harder: bool = True,
    max_results: Optional[int] = None,
) -> List[Barcode]:
    """Decode every barcode in the image file at ``path`` (see :func:`scan`)."""
    return scan(os.fspath(path), symbologies=symbologies, try_harder=try_harder, max_results=max_results)
