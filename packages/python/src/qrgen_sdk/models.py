"""Result types shared by the scanner, camera and REST server (SPEC section 2).

Python attributes use snake_case; :meth:`Barcode.to_dict` produces the camelCase
JSON shape every QRGen platform returns.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, Tuple

from .symbologies import symbology_name

__all__ = ["Point", "Quad", "Size", "Barcode", "TrackedBarcode", "now_ms"]


def now_ms() -> int:
    """Current time in milliseconds since the Unix epoch."""
    return int(time.time() * 1000)


@dataclass(frozen=True)
class Point:
    """A pixel coordinate in the source image or frame."""

    x: float
    y: float

    def to_dict(self) -> Dict[str, float]:
        """Return ``{"x": ..., "y": ...}``."""
        return {"x": self.x, "y": self.y}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Point":
        """Build a point from ``{"x": ..., "y": ...}``."""
        return cls(data.get("x", 0), data.get("y", 0))


@dataclass(frozen=True)
class Quad:
    """The four corners of a decoded symbol, clockwise from the top-left."""

    top_left: Point
    top_right: Point
    bottom_right: Point
    bottom_left: Point

    def __iter__(self) -> Iterator[Point]:
        """Iterate corners in drawing order (top-left, top-right, bottom-right, bottom-left)."""
        return iter((self.top_left, self.top_right, self.bottom_right, self.bottom_left))

    @property
    def center(self) -> Point:
        """Average of the four corners."""
        xs = [p.x for p in self]
        ys = [p.y for p in self]
        return Point(sum(xs) / 4.0, sum(ys) / 4.0)

    @property
    def bounds(self) -> Tuple[float, float, float, float]:
        """Axis-aligned bounding box as ``(x, y, width, height)``."""
        xs = [p.x for p in self]
        ys = [p.y for p in self]
        return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))

    def to_dict(self) -> Dict[str, Dict[str, float]]:
        """Return the SPEC ``location`` object."""
        return {
            "topLeft": self.top_left.to_dict(),
            "topRight": self.top_right.to_dict(),
            "bottomRight": self.bottom_right.to_dict(),
            "bottomLeft": self.bottom_left.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Quad":
        """Build a quad from the SPEC ``location`` object."""
        return cls(
            Point.from_dict(data.get("topLeft", {})),
            Point.from_dict(data.get("topRight", {})),
            Point.from_dict(data.get("bottomRight", {})),
            Point.from_dict(data.get("bottomLeft", {})),
        )


@dataclass(frozen=True)
class Size:
    """Width and height in pixels."""

    width: int
    height: int

    def to_dict(self) -> Dict[str, int]:
        """Return ``{"width": ..., "height": ...}``."""
        return {"width": self.width, "height": self.height}


_EMPTY_QUAD = Quad(Point(0, 0), Point(0, 0), Point(0, 0), Point(0, 0))


@dataclass
class Barcode:
    """One decoded barcode (SPEC section 2).

    Attributes:
        data: Decoded text. GS1 content uses the HRI form ``"(01)...(10)..."``.
        symbology: Id from SPEC section 1, for example ``"qr"``.
        symbology_name: Human readable symbology name.
        raw_bytes: Raw payload bytes (may be empty).
        content_type: ``text``, ``binary``, ``gs1``, ``iso15434``, ``mixed`` or ``unknown-eci``.
        is_gs1: ``True`` when the symbol carries GS1 element strings.
        location: Corner points in source pixel coordinates.
        frame_size: Size of the source image or frame.
        orientation: Symbol orientation in degrees.
        ec_level: Error correction level when known, else ``""``.
        symbology_identifier: AIM symbology identifier such as ``"]Q1"``.
        timestamp: Milliseconds since the epoch when the code was decoded.
    """

    data: str
    symbology: str
    symbology_name: str = ""
    raw_bytes: bytes = b""
    content_type: str = "text"
    is_gs1: bool = False
    location: Quad = field(default_factory=lambda: _EMPTY_QUAD)
    frame_size: Size = field(default_factory=lambda: Size(0, 0))
    orientation: int = 0
    ec_level: str = ""
    symbology_identifier: str = ""
    timestamp: int = field(default_factory=now_ms)

    def __post_init__(self) -> None:
        if not self.symbology_name:
            self.symbology_name = symbology_name(self.symbology)

    @property
    def key(self) -> str:
        """Identity used by duplicate filters and trackers: ``symbology + NUL + data``."""
        return f"{self.symbology}\x00{self.data}"

    def parsed(self) -> Dict[str, Any]:
        """Run :func:`qrgen_sdk.parse_content` on :attr:`data`."""
        from .parsers.content import parse_content

        return parse_content(self.data, symbology=self.symbology)

    def to_dict(self, *, include_parsed: bool = False) -> Dict[str, Any]:
        """Return the camelCase JSON object defined in SPEC section 2.

        Args:
            include_parsed: Also add a ``"parsed"`` key with :meth:`parsed` (as the
                REST API does).
        """
        result: Dict[str, Any] = {
            "data": self.data,
            "symbology": self.symbology,
            "symbologyName": self.symbology_name,
            "rawBytes": base64.b64encode(bytes(self.raw_bytes)).decode("ascii"),
            "contentType": self.content_type,
            "isGS1": self.is_gs1,
            "location": self.location.to_dict(),
            "frameSize": self.frame_size.to_dict(),
            "orientation": self.orientation,
            "ecLevel": self.ec_level,
            "symbologyIdentifier": self.symbology_identifier,
            "timestamp": self.timestamp,
        }
        if include_parsed:
            result["parsed"] = self.parsed()
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Barcode":
        """Build a :class:`Barcode` from the SPEC JSON object (unknown keys are ignored)."""
        frame = data.get("frameSize") or {}
        raw = data.get("rawBytes") or ""
        return cls(
            data=str(data.get("data", "")),
            symbology=str(data.get("symbology", "")),
            symbology_name=str(data.get("symbologyName", "")),
            raw_bytes=base64.b64decode(raw) if raw else b"",
            content_type=str(data.get("contentType", "text")),
            is_gs1=bool(data.get("isGS1", False)),
            location=Quad.from_dict(data.get("location") or {}),
            frame_size=Size(int(frame.get("width", 0)), int(frame.get("height", 0))),
            orientation=int(data.get("orientation", 0)),
            ec_level=str(data.get("ecLevel", "")),
            symbology_identifier=str(data.get("symbologyIdentifier", "")),
            timestamp=int(data.get("timestamp", 0) or now_ms()),
        )


@dataclass
class TrackedBarcode(Barcode):
    """A barcode followed across frames in ``batch`` mode.

    Attributes:
        id: Stable identifier derived from symbology and data.
        first_seen: Milliseconds since the epoch when the code first appeared.
        last_seen: Milliseconds since the epoch of the latest frame containing it.
        count: Number of frames the code was decoded in.
    """

    id: str = ""
    first_seen: int = 0
    last_seen: int = 0
    count: int = 0

    def to_dict(self, *, include_parsed: bool = False) -> Dict[str, Any]:
        """SPEC ``TrackedBarcode``: the barcode object plus ``id``, ``firstSeen``, ``lastSeen``, ``count``."""
        result = super().to_dict(include_parsed=include_parsed)
        result.update({"id": self.id, "firstSeen": self.first_seen, "lastSeen": self.last_seen, "count": self.count})
        return result

    @classmethod
    def from_barcode(
        cls, barcode: Barcode, *, id: str, first_seen: int, last_seen: int, count: int
    ) -> "TrackedBarcode":
        """Wrap a :class:`Barcode` with tracking information."""
        return cls(
            data=barcode.data,
            symbology=barcode.symbology,
            symbology_name=barcode.symbology_name,
            raw_bytes=barcode.raw_bytes,
            content_type=barcode.content_type,
            is_gs1=barcode.is_gs1,
            location=barcode.location,
            frame_size=barcode.frame_size,
            orientation=barcode.orientation,
            ec_level=barcode.ec_level,
            symbology_identifier=barcode.symbology_identifier,
            timestamp=barcode.timestamp,
            id=id,
            first_seen=first_seen,
            last_seen=last_seen,
            count=count,
        )
