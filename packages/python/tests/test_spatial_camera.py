# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""Real generated-frame processing and fake capture lifecycle, without a camera."""
from __future__ import annotations

import copy
import io
from types import SimpleNamespace

import pytest
from PIL import Image

from qrgen_sdk import Barcode, generate
from qrgen_sdk.camera import Camera, CameraError, scan_camera

np = pytest.importorskip("numpy")


def frame(*payloads):
    images = [Image.open(io.BytesIO(generate(value, format="png", scale=4))).convert("L") for value in payloads]
    canvas = Image.new("L", (sum(image.width for image in images) + 20 * (len(images) + 1), max(image.height for image in images) + 40), 255)
    x = 20
    for image in images:
        canvas.paste(image, (x, 20))
        x += image.width + 20
    return np.stack([np.asarray(canvas)] * 3, axis=-1)


def test_real_identical_qr_observations_and_duplicate_notifications_are_independent():
    image = frame("same-product", "same-product")
    default = Camera(mode="batch")
    baseline = default.process(image, now_ms=0)
    assert len(baseline.barcodes) == 2  # Establish detector input before tracker assertions.
    assert len(baseline.tracked) == 1 and len(baseline.new) == 1
    camera = Camera(mode="batch", spatial_tracking=True)
    first = camera.process(image, now_ms=0)
    assert len(first.barcodes) == len(first.tracked) == len(first.added) == 2
    assert len(first.new) == 1
    again = camera.process(image, now_ms=100)
    assert [item.id for item in again.tracked] == [item.id for item in first.tracked]
    assert [item.count for item in again.tracked] == [2, 2]
    assert again.new == again.added == again.removed == []


def test_real_camera_blank_resize_resets_geometry_and_ids_before_return():
    camera = Camera(mode="batch", spatial_tracking=True)
    image = frame("resize")
    first = camera.process(image, now_ms=0).tracked[0]
    blank = np.full((image.shape[0] + 40, image.shape[1] + 40, 3), 255, dtype=np.uint8)
    result = camera.process(blank, now_ms=30)
    assert result.tracked == [] and result.removed == [first]
    assert camera.process(blank, now_ms=40).removed == []
    padded = blank.copy()
    padded[:image.shape[0], :image.shape[1]] = image
    returning = camera.process(padded, now_ms=50)
    assert returning.tracked[0].id != first.id and returning.tracked[0].count == 1
    assert returning.new == []  # Resizing spatial history does not reset payload reports.


def test_spatial_roi_is_associated_in_full_frame_coordinates():
    image = frame("left", "right")
    camera = Camera(mode="batch", spatial_tracking=True)
    initial = camera.process(image, now_ms=0)
    right = next(item for item in initial.tracked if item.data == "right")
    camera.scan_area = (.5, 0, .5, 1)
    later = camera.process(image, now_ms=30)
    same = next(item for item in later.tracked if item.data == "right")
    assert same.id == right.id and same.count == 2
    assert min(point.x for point in same.location) >= image.shape[1] // 2


class Capture:
    def __init__(self, opened=True):
        self.opened = opened
        self.released = False

    def isOpened(self):
        return self.opened

    def release(self):
        self.released = True


def test_same_size_reopen_preserves_queued_removals_until_a_successful_frame(monkeypatch):
    captures = []
    def create(*_):
        capture = Capture()
        captures.append(capture)
        return capture
    monkeypatch.setattr("qrgen_sdk.camera._require_cv2", lambda: SimpleNamespace(VideoCapture=create))
    camera = Camera(mode="batch", spatial_tracking=True)
    image = frame("source")
    camera.open()
    first = camera.process(image, now_ms=0).tracked[0]
    camera.open()  # Idempotent: no source change.
    assert len(captures) == 1 and camera.process(image, now_ms=10).tracked[0].id == first.id
    camera.close()
    camera.close()  # Must not queue the same removal twice.
    assert captures[0].released and camera.tracker.tracked == []
    camera.device = 1
    camera.open()
    with monkeypatch.context() as scoped:
        def failed_decode(*args, **kwargs):
            raise RuntimeError("frame decode failed")
        scoped.setattr("qrgen_sdk.scanner.decode", failed_decode)
        with pytest.raises(RuntimeError, match="frame decode failed"):
            camera.process(image, now_ms=20)
    result = camera.process(np.full_like(image, 255), now_ms=30)
    assert [item.id for item in result.removed] == [first.id] and result.tracked == []
    assert camera.process(np.full_like(image, 255), now_ms=40).removed == []
    returning = camera.process(image, now_ms=50)
    assert returning.tracked[0].id != first.id and returning.tracked[0].count == 1
    assert returning.new == []
    camera.close()


def test_invalid_decoded_geometry_preserves_queued_removals_and_payload_history(monkeypatch):
    camera = Camera(mode="batch", spatial_tracking=True)
    image = frame("previous")
    first = camera.process(image, now_ms=0).tracked[0]
    camera.close()
    def state(value):
        fields = vars(value).copy()
        fields["_clock"] = value._clock._explicit
        return copy.deepcopy(fields)
    before = state(camera.tracker), state(camera.duplicates)
    with monkeypatch.context() as scoped:
        scoped.setattr("qrgen_sdk.scanner.decode", lambda *args, **kwargs: [Barcode("unseen", "qr")])
        with pytest.raises(ValueError, match="extent"):
            camera.process(image, now_ms=20)
    assert (state(camera.tracker), state(camera.duplicates)) == before
    valid = frame("unseen")
    result = camera.process(valid, now_ms=30)
    assert [item.id for item in result.removed] == [first.id]
    assert [item.data for item in result.new] == ["unseen"]
    assert result.tracked[0].id != first.id and result.tracked[0].count == 1
    repeated = camera.process(valid, now_ms=40)
    assert repeated.new == repeated.removed == [] and repeated.tracked[0].count == 2


def test_failed_open_keeps_existing_spatial_state_and_default_close_keeps_payload_state(monkeypatch):
    image = frame("open-failure")
    capture = Capture(opened=False)
    monkeypatch.setattr("qrgen_sdk.camera._require_cv2", lambda: SimpleNamespace(VideoCapture=lambda *_: capture))
    camera = Camera(mode="batch", spatial_tracking=True)
    first = camera.process(image, now_ms=0).tracked[0]
    with pytest.raises(CameraError):
        camera.open()
    assert capture.released and camera.tracker.tracked == [first]
    assert camera.process(image, now_ms=30).tracked[0].id == first.id
    default = Camera(0, None, "batch", 1000, None, False, None, None, None, None, 500, False)
    baseline = default.process(image, now_ms=0)
    default.close()
    again = default.process(image, now_ms=30)
    assert again.tracked[0].id == baseline.tracked[0].id and again.tracked[0].count == 2
    assert again.new == [] and not default.tracker.spatial


def test_spatial_pause_uses_timeout_and_does_not_invent_a_quantity():
    image = frame("paused")
    camera = Camera(mode="batch", spatial_tracking=True)
    first = camera.process(image, now_ms=0).tracked[0]
    short = camera.process(image, now_ms=500)
    assert short.tracked[0].id == first.id and short.tracked[0].count == 2
    long = camera.process(image, now_ms=1001)
    assert long.removed[0].id == first.id and long.tracked[0].id != first.id
    assert long.tracked[0].count == 1


def test_scan_camera_forwards_spatial_options_without_changing_callback_contract(monkeypatch):
    captured = {}
    class FakeCamera:
        def __init__(self, **kwargs):
            captured.update(kwargs)
        def run(self, **kwargs):
            captured["run"] = kwargs
            return []
    monkeypatch.setattr("qrgen_sdk.camera.Camera", FakeCamera)
    callback = lambda records: None
    assert scan_camera(mode="batch", spatial_tracking=True, track_max_jump=2, track_max_association_work=1000,
                       on_track=callback, show_window=False) == []
    assert captured["spatial_tracking"] is True and captured["track_max_jump"] == 2
    assert captured["track_max_association_work"] == 1000
    assert captured["run"]["on_track"] is callback


def test_camera_budget_rejection_preserves_events_clocks_and_duplicate_history(monkeypatch):
    camera = Camera(mode="batch", spatial_tracking=True, track_max_association_work=15)
    image = frame("old")
    first = camera.process(image, now_ms=0).tracked[0]
    camera.close()
    valid = frame("same", "same")
    initial = camera.process(valid, now_ms=10)
    assert len(initial.tracked) == 2 and initial.removed == [first]
    assert camera.tracker.max_association_work == 15
    def state(value):
        fields = vars(value).copy()
        fields["_clock"] = value._clock._explicit
        return copy.deepcopy(fields)
    before = state(camera.tracker), state(camera.duplicates)
    decoded = initial.barcodes + [Barcode("unseen", "qr", location=initial.barcodes[0].location)]
    with monkeypatch.context() as scoped:
        scoped.setattr("qrgen_sdk.scanner.decode", lambda *args, **kwargs: decoded)
        # Implicit time would change both clocks; no timestamp age expiry in this probe.
        scoped.setattr("qrgen_sdk.tracking.now_ms", lambda: 100)
        with pytest.raises(ValueError, match="work 16 exceeds"):
            camera.process(valid)
    assert (state(camera.tracker), state(camera.duplicates)) == before
    # The unseen payload from the rejected frame has not consumed its report.
    with monkeypatch.context() as scoped:
        scoped.setattr("qrgen_sdk.scanner.decode", lambda *args, **kwargs:
                       [Barcode("unseen", "qr", location=initial.barcodes[0].location)])
        result = camera.process(valid, now_ms=20)
    assert [item.data for item in result.new] == ["unseen"]
    assert result.removed == [] and len(result.added) == 1


@pytest.mark.parametrize("limit", [0, -1, True, 1.5, "250000"])
def test_camera_validates_the_forwarded_association_budget(limit):
    with pytest.raises(ValueError, match="max_association_work"):
        Camera(spatial_tracking=True, track_max_association_work=limit)
