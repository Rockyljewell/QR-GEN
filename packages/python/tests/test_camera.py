"""Camera frame processing without a physical camera (OpenCV/numpy optional)."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from qrgen_sdk import generate

np = pytest.importorskip("numpy")

from qrgen_sdk.camera import Camera, CameraError  # noqa: E402


def _frame(*payloads, symbology="qr"):
    images = [Image.open(io.BytesIO(generate(p, symbology=symbology, format="png", scale=4))).convert("L") for p in payloads]
    width = sum(i.width for i in images) + 20 * (len(images) + 1)
    height = max(i.height for i in images) + 40
    canvas = Image.new("L", (width, height), 255)
    x = 20
    for image in images:
        canvas.paste(image, (x, 20))
        x += image.width + 20
    gray = np.array(canvas)
    return np.stack([gray] * 3, axis=-1)  # BGR like OpenCV


def test_process_continuous_with_duplicate_filter():
    camera = Camera(symbologies=["qr"], duplicate_filter=1000)
    frame = _frame("frame code")
    first = camera.process(frame, now_ms=0)
    assert [b.data for b in first.barcodes] == ["frame code"]
    assert [b.data for b in first.new] == ["frame code"]
    assert first.barcodes[0].frame_size.width == frame.shape[1]
    assert first.barcodes[0].timestamp == 0
    assert camera.process(frame, now_ms=500).new == []
    assert [b.data for b in camera.process(frame, now_ms=1000).new] == ["frame code"]


def test_process_every_frame_and_once_per_session():
    frame = _frame("x")
    every = Camera(duplicate_filter=0)
    assert all(every.process(frame, now_ms=t).new for t in range(3))
    once = Camera(duplicate_filter=-1)
    assert once.process(frame, now_ms=0).new
    assert not once.process(frame, now_ms=99_999).new


def test_batch_mode_tracks_multiple_codes():
    camera = Camera(mode="batch")
    frame = _frame("one", "two", "three")
    result = camera.process(frame, now_ms=0)
    assert camera.max_results == 20
    assert sorted(t.data for t in result.tracked) == ["one", "three", "two"]
    assert len(result.added) == 3
    later = camera.process(_frame("one"), now_ms=700)
    assert [t.data for t in later.tracked] == ["one"]
    assert sorted(t.data for t in later.removed) == ["three", "two"]
    assert later.tracked[0].count == 2


def test_scan_area_offsets_locations():
    frame = _frame("left", "right")
    camera = Camera(scan_area=(0.5, 0.0, 0.5, 1.0), max_results=5)
    result = camera.process(frame, now_ms=0)
    assert [b.data for b in result.barcodes] == ["right"]
    assert min(p.x for p in result.barcodes[0].location) >= frame.shape[1] // 2


def test_invalid_mode():
    with pytest.raises(ValueError):
        Camera(mode="sometimes")


def test_draw_barcodes_and_missing_device():
    pytest.importorskip("cv2")
    from qrgen_sdk.camera import draw_barcodes

    frame = _frame("draw")
    camera = Camera()
    codes = camera.process(frame, now_ms=0).barcodes
    before = frame.copy()
    draw_barcodes(frame, codes)
    assert (frame != before).any()
    with pytest.raises(CameraError) as info:
        Camera(device="/dev/video-does-not-exist").open()
    assert info.value.code == "camera-not-found"


def test_run_on_video_file(tmp_path):
    cv2 = pytest.importorskip("cv2")
    path = str(tmp_path / "clip.avi")
    frame = _frame("video")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 5, (frame.shape[1], frame.shape[0]))
    if not writer.isOpened():
        pytest.skip("OpenCV build cannot write MJPG video")
    for _ in range(5):
        writer.write(frame)
    writer.release()
    seen = []
    camera = Camera(device=path, mode="single")
    reported = camera.run(on_scan=seen.extend, show_window=False)
    assert [b.data for b in reported] == ["video"]
    assert [b.data for b in seen] == ["video"]
