"""Duplicate filtering and multi-code tracking for live scanning (SPEC section 4).

Both classes are pure Python and clock-injectable (pass ``now_ms``), so they can be
used with any frame source: OpenCV, picamera2, GStreamer, a video file...
"""

from __future__ import annotations

import hashlib
from typing import Dict, Iterable, List, Optional, Union

from .models import Barcode, TrackedBarcode, now_ms

__all__ = ["DuplicateFilter", "BatchTracker", "tracking_id"]


def _key(item: Union[Barcode, str]) -> str:
    return item.key if isinstance(item, Barcode) else str(item)


def tracking_id(symbology: str, data: str) -> str:
    """Stable id for a code: the first 12 hex digits of ``sha1(symbology NUL data)``."""
    digest = hashlib.sha1(("%s\x00%s" % (symbology, data)).encode("utf-8")).hexdigest()
    return digest[:12]


class DuplicateFilter:
    """Suppress repeated reports of the same symbology + data.

    Args:
        window_ms: ``> 0`` ignores a code that was reported less than ``window_ms``
            milliseconds ago; ``0`` reports every frame; ``-1`` reports each code only
            once per session (until :meth:`reset`).

    Example:
        >>> f = DuplicateFilter(1000)
        >>> f.accept("qr\\x00hello", now_ms=0), f.accept("qr\\x00hello", now_ms=500), f.accept("qr\\x00hello", now_ms=1500)
        (True, False, True)
    """

    def __init__(self, window_ms: int = 1000) -> None:
        self.window_ms = int(window_ms)
        self._reported: Dict[str, int] = {}

    def accept(self, item: Union[Barcode, str], now_ms: Optional[int] = None) -> bool:
        """Return ``True`` when ``item`` should be reported now (and remember it)."""
        if self.window_ms == 0:
            return True
        now = _now(now_ms)
        key = _key(item)
        last = self._reported.get(key)
        if last is not None:
            if self.window_ms < 0 or now - last < self.window_ms:
                return False
        self._reported[key] = now
        if len(self._reported) > 4096 and self.window_ms > 0:
            self._evict(now)
        return True

    def filter(self, barcodes: Iterable[Barcode], now_ms: Optional[int] = None) -> List[Barcode]:
        """Return the barcodes that pass :meth:`accept`, keeping their order."""
        now = _now(now_ms)
        return [b for b in barcodes if self.accept(b, now)]

    def reset(self) -> None:
        """Forget every reported code."""
        self._reported.clear()

    def _evict(self, now: int) -> None:
        self._reported = {k: t for k, t in self._reported.items() if now - t < self.window_ms}


class BatchTracker:
    """Follow many codes across frames with stable ids (``batch`` mode).

    A code keeps its id (see :func:`tracking_id`) while it stays visible; it is
    dropped once it has not been seen for ``timeout_ms`` milliseconds.

    Args:
        timeout_ms: How long an unseen code stays tracked (default 500 ms).
    """

    def __init__(self, timeout_ms: int = 500) -> None:
        self.timeout_ms = int(timeout_ms)
        self._tracked: Dict[str, TrackedBarcode] = {}
        self.added: List[TrackedBarcode] = []
        self.removed: List[TrackedBarcode] = []

    @property
    def tracked(self) -> List[TrackedBarcode]:
        """Currently tracked codes, oldest first."""
        return sorted(self._tracked.values(), key=lambda t: t.first_seen)

    def update(self, barcodes: Iterable[Barcode], now_ms: Optional[int] = None) -> List[TrackedBarcode]:
        """Feed the codes decoded in one frame and return the tracked set.

        After the call :attr:`added` holds codes that appeared in this frame and
        :attr:`removed` holds codes that timed out.
        """
        now = _now(now_ms)
        self.added = []
        seen_this_frame = set()
        for barcode in barcodes:
            tid = tracking_id(barcode.symbology, barcode.data)
            if tid in seen_this_frame:
                continue
            seen_this_frame.add(tid)
            previous = self._tracked.get(tid)
            if previous is None:
                tracked = TrackedBarcode.from_barcode(barcode, id=tid, first_seen=now, last_seen=now, count=1)
                self.added.append(tracked)
            else:
                tracked = TrackedBarcode.from_barcode(
                    barcode, id=tid, first_seen=previous.first_seen, last_seen=now, count=previous.count + 1
                )
            self._tracked[tid] = tracked
        self.removed = [t for t in self._tracked.values() if now - t.last_seen > self.timeout_ms]
        for gone in self.removed:
            del self._tracked[gone.id]
        return self.tracked

    def clear(self) -> None:
        """Stop tracking every code."""
        self._tracked.clear()
        self.added = []
        self.removed = []


def _now(value: Optional[int]) -> int:
    return now_ms() if value is None else int(value)
