# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Duplicate filtering and multi-code tracking for live scanning (SPEC section 4).

Both classes are pure Python and clock-injectable (pass ``now_ms``), so they can be
used with any frame source: OpenCV, picamera2, GStreamer, a video file...
"""

from __future__ import annotations

import hashlib
import time
from typing import Dict, Iterable, List, Optional, Set, Union

from .models import Barcode, TrackedBarcode, now_ms

__all__ = ["DuplicateFilter", "BatchTracker", "tracking_id"]


class _DurationClock:
    """Use monotonic durations by default, preserving per-call injected clocks."""

    def __init__(self) -> None:
        self._explicit: Optional[bool] = None

    def read(self, value: Optional[int]) -> tuple[int, int, bool]:
        explicit = value is not None
        timestamp = _now(value)
        elapsed = timestamp if explicit else int(time.monotonic() * 1000)
        changed = self._explicit is not None and self._explicit != explicit
        self._explicit = explicit
        return timestamp, elapsed, changed

    def reset(self) -> None:
        self._explicit = None


def _key(item: Union[Barcode, str]) -> str:
    return item.key if isinstance(item, Barcode) else str(item)


def tracking_id(symbology: str, data: str) -> str:
    """Deterministic base id for a code: the first 12 hex digits of ``sha1(symbology NUL data)``."""
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

    Positive windows use monotonic elapsed time by default. Explicit ``now_ms``
    values provide an injected clock. Switching between default and injected calls
    rebases retained history using its public timestamps, preserving timestamp-age
    behavior on the transition call. Use a consistent clock for elapsed-time safety.
    """

    def __init__(self, window_ms: int = 1000) -> None:
        self.window_ms = int(window_ms)
        self._reported: Dict[str, int] = {}
        self._reported_elapsed: Dict[str, int] = {}
        self._clock = _DurationClock()

    def accept(self, item: Union[Barcode, str], now_ms: Optional[int] = None) -> bool:
        """Return ``True`` when ``item`` should be reported now (and remember it)."""
        if self.window_ms == 0:
            return True
        now, elapsed = self._time(now_ms)
        return self._accept(item, now, elapsed)

    def _time(self, value: Optional[int]) -> tuple[int, int]:
        now, elapsed, changed = self._clock.read(value)
        if changed:
            self._reported_elapsed = {k: elapsed - (now - stamp) for k, stamp in self._reported.items()}
        return now, elapsed

    def _accept(self, item: Union[Barcode, str], now: int, elapsed: int) -> bool:
        key = _key(item)
        last = self._reported_elapsed.get(key)
        if last is not None:
            if self.window_ms < 0 or elapsed - last < self.window_ms:
                return False
        self._reported[key] = now
        self._reported_elapsed[key] = elapsed
        if len(self._reported) > 4096 and self.window_ms > 0:
            self._evict(elapsed)
        return True

    def filter(self, barcodes: Iterable[Barcode], now_ms: Optional[int] = None) -> List[Barcode]:
        """Return the barcodes that pass :meth:`accept`, keeping their order."""
        if self.window_ms == 0:
            return list(barcodes)
        now, elapsed = self._time(now_ms)
        return [b for b in barcodes if self._accept(b, now, elapsed)]

    def reset(self) -> None:
        """Forget every reported code."""
        self._reported.clear()
        self._reported_elapsed.clear()
        self._clock.reset()

    def _evict(self, now: int) -> None:
        self._reported_elapsed = {k: t for k, t in self._reported_elapsed.items() if now - t < self.window_ms}
        self._reported = {k: self._reported[k] for k in self._reported_elapsed}


class BatchTracker:
    """Follow many codes across frames with stable ids (``batch`` mode).

    A code keeps its opaque id while visible; hash collisions receive a suffix.
    The deterministic base comes from :func:`tracking_id`. A code is
    dropped once it has not been seen for ``timeout_ms`` milliseconds.

    Args:
        timeout_ms: How long an unseen code stays tracked (default 500 ms).

    Timeouts use monotonic elapsed time by default; result timestamps remain epoch
    milliseconds. Explicit ``now_ms`` values supply both timeouts and timestamps.
    Switching between them rebases retained observations using ``last_seen``,
    preserving timestamp-age behavior on the transition call. Use a consistent
    clock for elapsed-time safety.
    """

    def __init__(self, timeout_ms: int = 500) -> None:
        self.timeout_ms = int(timeout_ms)
        self._tracked: Dict[str, TrackedBarcode] = {}
        self._last_observed: Dict[str, int] = {}
        self._clock = _DurationClock()
        self._active_ids: Set[str] = set()
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
        now, elapsed, changed = self._clock.read(now_ms)
        if changed:
            self._last_observed = {key: elapsed - (now - t.last_seen) for key, t in self._tracked.items()}
        expired = [key for key in self._tracked if elapsed - self._last_observed[key] > self.timeout_ms]
        self.removed = [self._tracked[key] for key in expired]
        for key in expired:
            gone = self._tracked.pop(key)
            del self._last_observed[key]
            self._active_ids.discard(gone.id)
        self.added = []
        seen_this_frame = set()
        for barcode in barcodes:
            key = barcode.key
            if key in seen_this_frame:
                continue
            seen_this_frame.add(key)
            previous = self._tracked.get(key)
            if previous is None:
                tid = self._allocate_id(tracking_id(barcode.symbology, barcode.data))
                tracked = TrackedBarcode.from_barcode(barcode, id=tid, first_seen=now, last_seen=now, count=1)
                self.added.append(tracked)
            else:
                tracked = TrackedBarcode.from_barcode(
                    barcode, id=previous.id, first_seen=previous.first_seen, last_seen=now, count=previous.count + 1
                )
            self._tracked[key] = tracked
            self._last_observed[key] = elapsed
        return self.tracked

    def clear(self) -> None:
        """Stop tracking every code."""
        self._tracked.clear()
        self._last_observed.clear()
        self._clock.reset()
        self._active_ids.clear()
        self.added = []
        self.removed = []

    def _allocate_id(self, base: str) -> str:
        tid, suffix = base, 1
        while tid in self._active_ids:
            tid = "%s-%d" % (base, suffix)
            suffix += 1
        self._active_ids.add(tid)
        return tid


def _now(value: Optional[int]) -> int:
    return now_ms() if value is None else int(value)
