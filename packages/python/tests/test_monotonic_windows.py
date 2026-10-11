# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Duration correctness against public API; a real QR reader exercises Camera.process."""

import io
import time

import pytest
from PIL import Image

from qrgen_sdk import Barcode, BatchTracker, DuplicateFilter, generate
from qrgen_sdk.camera import Camera

np = pytest.importorskip("numpy")
BASE = 1_800_000_000_000
PAYLOAD = "QRGEN-CLOCK-WINDOW"


@pytest.fixture
def clock(monkeypatch):
    values = {"elapsed": 0, "step": 0}
    monkeypatch.setattr(time, "time", lambda: (BASE + values["elapsed"] + values["step"]) / 1000)
    monkeypatch.setattr(time, "monotonic", lambda: 10_000 + values["elapsed"] / 1000)
    return values


@pytest.fixture
def frame():
    with Image.open(io.BytesIO(generate(PAYLOAD, format="png", scale=4))) as image:
        gray = np.asarray(image.convert("L"))
    return np.stack([gray] * 3, axis=-1)


def test_duplicate_filter_elapsed_window_survives_backward_clock_step(clock):
    duplicates = DuplicateFilter(1000)
    assert duplicates.accept(Barcode(PAYLOAD, "qr"))
    clock.update(elapsed=2000, step=-60_000)
    assert duplicates.accept(Barcode(PAYLOAD, "qr"))


def test_duplicate_filter_does_not_report_early_after_forward_clock_step(clock):
    duplicates = DuplicateFilter(1000)
    assert duplicates.accept(Barcode(PAYLOAD, "qr"))
    clock.update(elapsed=100, step=60_000)
    assert not duplicates.accept(Barcode(PAYLOAD, "qr"))


def test_tracker_expires_unseen_code_after_elapsed_timeout_despite_rollback(clock):
    tracker = BatchTracker(500)
    original = tracker.update([Barcode(PAYLOAD, "qr")])[0]
    clock.update(elapsed=2000, step=-60_000)
    assert tracker.update([]) == []
    assert tracker.removed == [original]


def test_tracker_keeps_live_code_during_forward_clock_step(clock):
    tracker = BatchTracker(500)
    original = tracker.update([Barcode(PAYLOAD, "qr")])[0]
    clock.update(elapsed=100, step=60_000)
    assert tracker.update([]) == [original]
    assert tracker.removed == []


@pytest.mark.parametrize("step,elapsed,should_expire,should_report", [
    (-60_000, 2000, True, True),
    (60_000, 100, False, False),
])
def test_camera_process_uses_elapsed_windows_with_epoch_metadata(clock, frame, step, elapsed,
                                                               should_expire, should_report):
    camera = Camera(mode="batch", symbologies=["qr"], duplicate_filter=1000,
                    track_timeout_ms=500)
    original = camera.process(frame)
    assert [b.data for b in original.new] == [PAYLOAD]
    assert original.tracked[0].first_seen == BASE
    clock.update(elapsed=elapsed, step=step)
    blank = camera.process(np.full_like(frame, 255))
    assert bool(blank.removed) is should_expire
    assert bool(blank.tracked) is not should_expire
    again = camera.process(frame)
    assert bool(again.new) is should_report
    assert again.barcodes[0].timestamp == BASE + elapsed + step
    assert again.tracked[0].last_seen == BASE + elapsed + step


def test_default_clock_normal_boundary_controls(clock):
    duplicates = DuplicateFilter(1000)
    tracker = BatchTracker(500)
    assert duplicates.accept(Barcode(PAYLOAD, "qr"))
    first = tracker.update([Barcode(PAYLOAD, "qr")])[0]
    clock.update(elapsed=500)
    assert tracker.update([]) == [first]
    assert not duplicates.accept(Barcode(PAYLOAD, "qr"))
    clock.update(elapsed=501)
    assert tracker.update([]) == []
    clock.update(elapsed=1000)
    assert duplicates.accept(Barcode(PAYLOAD, "qr"))


def test_injected_now_and_payload_symbology_controls():
    duplicates = DuplicateFilter(1000)
    tracker = BatchTracker(500)
    first = tracker.update([Barcode("a", "qr"), Barcode("b", "qr"), Barcode("a", "code128")], now_ms=0)
    assert len(first) == 3 and len({b.id for b in first}) == 3
    assert [b.data for b in duplicates.filter([Barcode("a", "qr"), Barcode("a", "code128")], now_ms=0)] == ["a", "a"]
    assert len(tracker.update([], now_ms=500)) == 3
    assert tracker.update([], now_ms=501) == []
    assert not duplicates.accept(Barcode("a", "qr"), now_ms=999)
    assert duplicates.accept(Barcode("a", "qr"), now_ms=1000)


def test_duplicate_filter_mixed_clock_transitions_preserve_history(clock):
    duplicates = DuplicateFilter(1000)
    assert duplicates.accept("a")
    clock.update(elapsed=500)
    assert not duplicates.accept("a", now_ms=BASE + 500)
    clock.update(elapsed=1000)
    assert duplicates.accept("a")
    # After rebasing, ordinary calls again ignore both kinds of wall-clock step.
    clock.update(elapsed=1100, step=-60_000)
    assert not duplicates.accept("a")
    clock.update(elapsed=2000, step=60_000)
    assert duplicates.accept("a")


def test_duplicate_filter_different_injected_origin_keeps_legacy_transition_age(clock):
    duplicates = DuplicateFilter(1000)
    assert duplicates.accept("a")
    assert not duplicates.accept("a", now_ms=0)  # negative age, as before
    assert duplicates.accept("a", now_ms=BASE + 1000)
    clock.update(elapsed=1100)
    assert not duplicates.accept("a")
    duplicates.reset()
    assert duplicates.accept("a", now_ms=0)
    assert duplicates.accept("a")  # epoch minus zero exceeds the window, as before
    clock.update(elapsed=1200, step=-60_000)
    assert not duplicates.accept("a")


def test_tracker_mixed_clocks_preserve_exact_timeout_and_epoch_metadata(clock):
    tracker = BatchTracker(500)
    first = tracker.update([Barcode("a", "qr")])[0]
    clock.update(elapsed=500)
    assert tracker.update([], now_ms=BASE + 500) == [first]
    clock.update(elapsed=501)
    assert tracker.update([]) == []
    assert tracker.removed == [first]
    tracker.clear()
    injected = tracker.update([Barcode("a", "qr")], now_ms=0)[0]
    assert (injected.first_seen, injected.last_seen) == (0, 0)
    # An intentional change from a zero-based clock keeps legacy epoch-age expiry.
    assert tracker.update([]) == []
    assert tracker.removed == [injected]
    current = tracker.update([Barcode("a", "qr")])[0]
    clock.update(elapsed=601, step=60_000)
    assert tracker.update([]) == [current]


def test_camera_process_mixed_clock_calls_preserve_history(clock, frame):
    camera = Camera(mode="batch", duplicate_filter=1000, symbologies=["qr"])
    first = camera.process(frame).tracked[0]
    clock.update(elapsed=500)
    middle = camera.process(frame, now_ms=BASE + 500)
    assert middle.new == [] and middle.tracked[0].count == 2
    clock.update(elapsed=1000)
    last = camera.process(frame)
    assert [b.data for b in last.new] == [PAYLOAD]
    assert (last.tracked[0].id, last.tracked[0].first_seen, last.tracked[0].count) == (first.id, BASE, 3)
    clock.update(elapsed=1100, step=60_000)
    stable = camera.process(frame)
    assert stable.new == [] and stable.tracked[0].count == 4
    assert stable.tracked[0].last_seen == BASE + 61_100


def test_reset_clear_and_expiry_release_duration_metadata(clock):
    duplicates = DuplicateFilter(1000)
    duplicates.filter([Barcode("old1", "qr"), Barcode("old2", "qr")])
    clock.update(elapsed=1001, step=-60_000)
    duplicates.filter([Barcode("new%d" % i, "qr") for i in range(4095)])
    assert len(duplicates._reported) == len(duplicates._reported_elapsed) == 4095
    assert set(duplicates._reported) == set(duplicates._reported_elapsed)
    assert "qr\0old1" not in duplicates._reported
    duplicates.reset()
    assert duplicates._reported == duplicates._reported_elapsed == {}
    assert duplicates.accept("a", now_ms=0)
    duplicates.reset()
    assert duplicates.accept("a")

    tracker = BatchTracker(500)
    tracker.update([Barcode("a", "qr")])
    clock.update(elapsed=1502)
    assert tracker.update([]) == []
    assert tracker._last_observed == {}
    tracker.update([Barcode("a", "qr")])
    tracker.clear()
    assert tracker._last_observed == {} and tracker.tracked == []
    assert tracker.update([Barcode("a", "qr")], now_ms=0)[0].first_seen == 0


@pytest.mark.parametrize("window", [0, -1])
def test_no_window_or_once_only_behavior_across_clock_sources(clock, window):
    duplicates = DuplicateFilter(window)
    assert duplicates.accept("a")
    expected = window == 0
    assert duplicates.accept("a", now_ms=0) is expected
    clock.update(elapsed=1_000_000, step=-60_000)
    assert duplicates.accept("a") is expected
    duplicates.reset()
    assert duplicates.accept("a", now_ms=0)
