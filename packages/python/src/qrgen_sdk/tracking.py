# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Duplicate filtering and multi-code tracking for live scanning (SPEC section 4).

Both classes are pure Python and clock-injectable (pass ``now_ms``), so they can be
used with any frame source: OpenCV, picamera2, GStreamer, a video file...
"""

from __future__ import annotations

import hashlib
import math
import time
from typing import Dict, Iterable, List, Optional, Set, Tuple, Union

from .models import Barcode, Quad, Size, TrackedBarcode, now_ms

__all__ = ["DuplicateFilter", "BatchTracker", "tracking_id"]


class _DurationClock:
    """Use monotonic durations by default, preserving per-call injected clocks."""

    def __init__(self) -> None:
        self._explicit: Optional[bool] = None

    def preview(self, value: Optional[int]) -> tuple[int, int, bool]:
        explicit = value is not None
        timestamp = _now(value)
        elapsed = timestamp if explicit else int(time.monotonic() * 1000)
        changed = self._explicit is not None and self._explicit != explicit
        return timestamp, elapsed, changed

    def commit(self, value: Optional[int]) -> None:
        self._explicit = value is not None

    def read(self, value: Optional[int]) -> tuple[int, int, bool]:
        result = self.preview(value)
        self.commit(value)
        return result

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


def _spatial_size(size: Size) -> Size:
    try:
        if not isinstance(size, Size) or any(
            isinstance(v, bool) or not math.isfinite(v) or v <= 0 or int(v) != v for v in (size.width, size.height)
        ):
            raise ValueError
    except (TypeError, OverflowError, ValueError):
        raise ValueError("spatial tracking requires a positive integer frame size") from None
    return size


def _spatial_geometry(barcode: Barcode, max_jump: float) -> Tuple[float, float, float]:
    try:
        if not isinstance(barcode, Barcode) or not isinstance(barcode.location, Quad):
            raise ValueError
        points = tuple(barcode.location)
        if any(isinstance(v, bool) or not math.isfinite(v) for p in points for v in (p.x, p.y)):
            raise ValueError
        _, _, width, height = barcode.location.bounds
        # Dividing before summation avoids overflowing an otherwise finite center.
        x, y = sum(p.x / 4 for p in points), sum(p.y / 4 for p in points)
        extent = max(width, height)
        limit = max(extent, 1) * max_jump
        if extent <= 0 or not all(math.isfinite(v) for v in (width, height, x, y, limit)):
            raise ValueError
    except (AttributeError, TypeError, OverflowError, ValueError):
        raise ValueError("spatial tracking requires finite coordinates and a nonzero barcode extent") from None
    return x, y, limit


def _association_work(detections: List[Barcode], tracks: List[TrackedBarcode]) -> int:
    """Conservative assignment units; new-only groups skip association entirely."""
    current: Dict[Tuple[str, str], int] = {}
    previous: Dict[Tuple[str, str], int] = {}
    for barcode in detections:
        key = (barcode.symbology, barcode.data)
        current[key] = current.get(key, 0) + 1
    for track in tracks:
        key = (track.symbology, track.data)
        previous[key] = previous.get(key, 0) + 1
    return sum(n * n * (previous[key] + n) for key, n in current.items() if key in previous)


def _associate(
    detections: List[Barcode], tracks: List[TrackedBarcode], max_jump: float
) -> Dict[int, TrackedBarcode]:
    """Web policy: maximize gated one-to-one matches, then minimize center movement."""
    groups: Dict[Tuple[str, str], List[int]] = {}
    old_groups: Dict[Tuple[str, str], List[TrackedBarcode]] = {}
    for index, barcode in enumerate(detections):
        groups.setdefault((barcode.symbology, barcode.data), []).append(index)
    # The caller supplies prior tracks in numeric creation order, not string-ID order.
    for track in tracks:
        old_groups.setdefault((track.symbology, track.data), []).append(track)
    matched: Dict[int, TrackedBarcode] = {}
    for key, indices in groups.items():
        previous = old_groups.get(key, [])
        if not previous:
            continue
        geometry = {index: _spatial_geometry(detections[index], max_jump) for index in indices}
        rows = sorted(indices, key=lambda i: (geometry[i][0], geometry[i][1], i))
        old_points = [_spatial_geometry(track, max_jump)[:2] for track in previous]
        distances = []
        for index in rows:
            x, y, limit = geometry[index]
            distances.append([
                movement if movement <= limit else math.inf
                for ox, oy in old_points for movement in [math.hypot(x - ox, y - oy)]
            ])
        usable = [column for column in range(len(previous)) if any(math.isfinite(row[column]) for row in distances)]
        if not usable:
            continue
        if len(rows) == 1:
            best = min(usable, key=lambda column: distances[0][column])
            matched[rows[0]] = previous[best]
            continue
        scale = max(1, max(row[column] for row in distances for column in usable if math.isfinite(row[column])))
        # Rectangular Hungarian assignment with one unmatched column per detection.
        # Normalized real costs are <= 1; the penalty makes cardinality dominate.
        columns = len(usable) + len(rows)
        unmatched = len(rows) + 1
        invalid = unmatched * unmatched
        costs = [
            [row[c] / scale if math.isfinite(row[c]) else invalid for c in usable] + [unmatched] * len(rows)
            for row in distances
        ]
        u, v = [0.0] * (len(rows) + 1), [0.0] * (columns + 1)
        p, way = [0] * (columns + 1), [0] * (columns + 1)
        for row in range(1, len(rows) + 1):
            p[0], column = row, 0
            minimum, used = [math.inf] * (columns + 1), [False] * (columns + 1)
            while True:
                used[column] = True
                active = p[column]
                delta, next_column = math.inf, 0
                for candidate in range(1, columns + 1):
                    if not used[candidate]:
                        reduced = costs[active - 1][candidate - 1] - u[active] - v[candidate]
                        if reduced < minimum[candidate]:
                            minimum[candidate], way[candidate] = reduced, column
                        if minimum[candidate] < delta:
                            delta, next_column = minimum[candidate], candidate
                for candidate in range(columns + 1):
                    if used[candidate]:
                        u[p[candidate]] += delta
                        v[candidate] -= delta
                    else:
                        minimum[candidate] -= delta
                column = next_column
                if p[column] == 0:
                    break
            while column:
                prior = way[column]
                p[column] = p[prior]
                column = prior
        for column in range(1, len(usable) + 1):
            row = p[column] - 1
            if row >= 0 and math.isfinite(distances[row][usable[column - 1]]):
                matched[rows[row]] = previous[usable[column - 1]]
    return matched


class BatchTracker:
    """Follow many codes across frames with stable ids (``batch`` mode).

    In default payload mode a code keeps its opaque id while visible; hash
    collisions receive a suffix. The base comes from :func:`tracking_id`. A code is
    dropped once it has not been seen for ``timeout_ms`` milliseconds.

    Args:
        timeout_ms: How long an unseen code stays tracked (default 500 ms).
        spatial: Opt in to separate observed tracks for equal payloads at different
            positions. Default ``False`` aggregates by symbology and data.
        max_jump: Spatial center-distance gate relative to the detection's size
            (default 3). Must be finite and nonnegative.
        max_association_work: Positive integer assignment-work limit (default
            250,000). Not a time guarantee. Raise it explicitly for large offline
            workloads; an over-budget frame raises before changing tracker state.

    Spatial tracks use whole-frame one-to-one association and fresh opaque string
    ids. They describe short-lived observations, not persistent physical identity
    or confirmed quantities. Each spatial record requires usable geometry and a
    positive source frame size. Clear when switching same-size frame sources.
    The work estimate sums ``n*n*(m+n)`` across groups with ``n`` new detections
    and ``m > 0`` surviving prior tracks, including out-of-gate prior columns.
    New-only, expired and coordinate-reset groups do not require association.

    Timeouts use monotonic elapsed time by default; result timestamps remain epoch
    milliseconds. Explicit ``now_ms`` values supply both timeouts and timestamps.
    Switching between them rebases retained observations using ``last_seen``,
    preserving timestamp-age behavior on the transition call. Use a consistent
    clock for elapsed-time safety.
    """

    def __init__(
        self, timeout_ms: int = 500, *, spatial: bool = False, max_jump: float = 3.0,
        max_association_work: int = 250_000,
    ) -> None:
        if not isinstance(spatial, bool):
            raise ValueError("spatial must be a boolean")
        try:
            if isinstance(max_jump, bool) or not math.isfinite(max_jump) or max_jump < 0:
                raise ValueError
        except (TypeError, OverflowError, ValueError):
            raise ValueError("max_jump must be finite and nonnegative") from None
        if isinstance(max_association_work, bool) or not isinstance(max_association_work, int) or max_association_work <= 0:
            raise ValueError("max_association_work must be a positive integer")
        self.timeout_ms = int(timeout_ms)
        self._spatial = spatial
        self._max_jump = float(max_jump)
        self._max_association_work = max_association_work
        self._tracked: Dict[str, TrackedBarcode] = {}
        self._last_observed: Dict[str, int] = {}
        self._clock = _DurationClock()
        self._active_ids: Set[str] = set()
        self.added: List[TrackedBarcode] = []
        self.removed: List[TrackedBarcode] = []
        self._frame_size: Optional[Size] = None
        self._next_instance = 1
        self._ordinals: Dict[str, int] = {}
        self._pending_removed: List[TrackedBarcode] = []

    @property
    def spatial(self) -> bool:
        return self._spatial

    @property
    def max_jump(self) -> float:
        return self._max_jump

    @property
    def max_association_work(self) -> int:
        return self._max_association_work

    @property
    def tracked(self) -> List[TrackedBarcode]:
        """Currently tracked codes, oldest first."""
        if self.spatial:
            return sorted(self._tracked.values(), key=lambda t: self._ordinals[t.id])
        return sorted(self._tracked.values(), key=lambda t: t.first_seen)

    def update(
        self, barcodes: Iterable[Barcode], now_ms: Optional[int] = None, *, frame_size: Optional[Size] = None
    ) -> List[TrackedBarcode]:
        """Feed the codes decoded in one frame and return the tracked set.

        After the call :attr:`added` holds codes that appeared in this frame and
        :attr:`removed` holds codes that timed out or left the coordinate space.
        Spatial mode accepts an explicit positive ``frame_size`` to detect a size
        change even on an empty frame. Each record must also carry that size.
        Invalid spatial input raises ``ValueError`` before changing tracker state.
        Over-budget association also raises without consuming clock/history/events.
        Default payload mode ignores ``frame_size``.
        """
        if self.spatial:
            return self._update_spatial(list(barcodes), now_ms, frame_size)
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

    def _update_spatial(self, barcodes: List[Barcode], value: Optional[int], size: Optional[Size]) -> List[TrackedBarcode]:
        # Validate the whole input (and any caller-mutated retained geometry) before
        # clock transitions, expiry, queued resets, ID allocation or public events.
        if size is not None:
            _spatial_size(size)
        for barcode in barcodes:
            _spatial_geometry(barcode, self.max_jump)
            record_size = _spatial_size(barcode.frame_size)
            if size is None:
                size = record_size
            elif size != record_size:
                raise ValueError("spatial records must share the source frame size")
            if not isinstance(barcode.symbology, str) or not isinstance(barcode.data, str):
                raise ValueError("spatial symbology and data must be strings")
        for track in self._tracked.values():
            _spatial_geometry(track, self.max_jump)
            _spatial_size(track.frame_size)
            if not isinstance(track.symbology, str) or not isinstance(track.data, str):
                raise ValueError("spatial symbology and data must be strings")
        now, elapsed, changed = self._clock.preview(value)
        observed = (
            {key: elapsed - (now - t.last_seen) for key, t in self._tracked.items()}
            if changed else self._last_observed
        )
        reset = size is not None and self._frame_size is not None and size != self._frame_size
        expired = {key for key in self._tracked if reset or elapsed - observed[key] > self.timeout_ms}
        previous = sorted(
            (track for key, track in self._tracked.items() if key not in expired),
            key=lambda track: self._ordinals[track.id],
        )
        work = _association_work(barcodes, previous)
        if work > self.max_association_work:
            raise ValueError(
                "spatial association work %d exceeds max_association_work=%d" % (work, self.max_association_work)
            )
        matched = _associate(barcodes, previous, self.max_jump)

        # Commit only after validation, pure clock preview, budget and association.
        self._clock.commit(value)
        self._last_observed = observed
        self.removed, self._pending_removed = self._pending_removed, []
        # Preserve creation order for expiry/removal notifications.
        expired = [key for key in self._tracked if key in expired]
        for key in expired:
            self.removed.append(self._tracked.pop(key))
            del self._last_observed[key]
            del self._ordinals[key]
        if size is not None:
            self._frame_size = size
        self.added = []
        for index, barcode in enumerate(barcodes):
            previous = matched.get(index)
            if previous is None:
                ordinal = self._next_instance
                self._next_instance += 1
                # Spatial identity is independent of payload encoding/hash collisions.
                tid = "spatial-%d" % ordinal
                self._ordinals[tid] = ordinal
                tracked = TrackedBarcode.from_barcode(barcode, id=tid, first_seen=now, last_seen=now, count=1)
                self.added.append(tracked)
            else:
                tracked = TrackedBarcode.from_barcode(
                    barcode, id=previous.id, first_seen=previous.first_seen, last_seen=now, count=previous.count + 1
                )
            self._tracked[tracked.id] = tracked
            self._last_observed[tracked.id] = elapsed
        return self.tracked

    def _reset_spatial(self) -> None:
        """Camera source boundary: remove now, deliver removals on the next update."""
        if self.spatial:
            self._pending_removed.extend(self.tracked)
            self._tracked.clear()
            self._last_observed.clear()
            self._ordinals.clear()
            self._frame_size = None
            self._clock.reset()
            self.added = []
            self.removed = []

    def clear(self) -> None:
        """Stop tracking every code."""
        self._tracked.clear()
        self._last_observed.clear()
        self._clock.reset()
        self._active_ids.clear()
        self.added = []
        self.removed = []
        self._frame_size = None
        self._ordinals.clear()
        self._pending_removed.clear()

    def _allocate_id(self, base: str) -> str:
        tid, suffix = base, 1
        while tid in self._active_ids:
            tid = "%s-%d" % (base, suffix)
            suffix += 1
        self._active_ids.add(tid)
        return tid


def _now(value: Optional[int]) -> int:
    return now_ms() if value is None else int(value)
