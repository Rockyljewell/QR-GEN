"""Live scanning from a webcam, USB camera or Raspberry Pi camera with OpenCV.

Install the optional dependencies first::

    pip install "qrgen-sdk[camera]"

``opencv-python-headless`` (installed by the extra) has no GUI support. For a
preview window install ``opencv-python`` instead; without it :class:`Camera`
keeps scanning and simply skips the window.

The frame-processing logic (:meth:`Camera.process`) works on any BGR/grayscale
numpy frame, so you can feed frames from picamera2, GStreamer or a video file.
"""

from __future__ import annotations

import os
import sys
import time
import warnings
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Iterator, List, Optional, Sequence, Tuple, Union

from .models import Barcode, Point, Quad, Size, TrackedBarcode, now_ms
from .symbologies import resolve_symbologies
from .tracking import BatchTracker, DuplicateFilter

__all__ = ["Camera", "FrameResult", "scan_camera", "draw_barcodes", "CameraError", "MODES"]

#: Scanner modes from SPEC section 4.
MODES = ("single", "continuous", "batch")

ScanCallback = Callable[[List[Barcode]], Optional[bool]]
TrackCallback = Callable[[List[TrackedBarcode]], Optional[bool]]


class CameraError(RuntimeError):
    """Raised when the camera cannot be opened or read.

    Attributes:
        code: A SPEC error code: ``camera-not-found``, ``camera-in-use``,
            ``engine-load-failed``, ``unsupported`` or ``unknown``.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _require_cv2() -> Any:
    try:
        import cv2  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise CameraError(
            "engine-load-failed",
            "Camera scanning needs OpenCV and numpy. Install them with:\n"
            '    pip install "qrgen-sdk[camera]"\n'
            "(or `pip install opencv-python numpy` for a preview window; on Raspberry Pi OS "
            "`sudo apt install python3-opencv` also works).",
        ) from exc
    return cv2


@dataclass
class FrameResult:
    """What :meth:`Camera.process` found in one frame.

    Attributes:
        barcodes: Every code decoded in the frame.
        new: Codes that passed the duplicate filter (the payload of a ``scan`` event).
        tracked: Tracked codes (``batch`` mode only).
        added: Codes that started being tracked in this frame (``batch`` mode only).
        removed: Codes that stopped being tracked in this frame (``batch`` mode only).
    """

    barcodes: List[Barcode] = field(default_factory=list)
    new: List[Barcode] = field(default_factory=list)
    tracked: List[TrackedBarcode] = field(default_factory=list)
    added: List[TrackedBarcode] = field(default_factory=list)
    removed: List[TrackedBarcode] = field(default_factory=list)


def draw_barcodes(
    frame: Any,
    barcodes: Iterable[Barcode],
    color: Tuple[int, int, int] = (0, 200, 0),
    thickness: int = 2,
    label: bool = True,
) -> Any:
    """Draw highlight quads and labels onto a BGR frame (in place) and return it."""
    cv2 = _require_cv2()
    import numpy as np

    for barcode in barcodes:
        points = np.array([[int(p.x), int(p.y)] for p in barcode.location], dtype=np.int32)
        if not points.any():
            continue
        cv2.polylines(frame, [points.reshape((-1, 1, 2))], True, color, thickness, cv2.LINE_AA)
        if label:
            text = "%s: %s" % (barcode.symbology, barcode.data.replace("\n", " "))
            if len(text) > 48:
                text = text[:45] + "..."
            x = int(min(p.x for p in barcode.location))
            y = int(min(p.y for p in barcode.location)) - 8
            y = max(y, 16)
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x, y - th - 6), (x + tw + 8, y + 4), color, -1)
            cv2.putText(frame, text, (x + 4, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return frame


class _Picamera2Source:
    """Minimal ``cv2.VideoCapture``-like wrapper around picamera2 (Raspberry Pi)."""

    def __init__(self, width: Optional[int], height: Optional[int]) -> None:
        try:
            from picamera2 import Picamera2  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - Raspberry Pi only
            raise CameraError(
                "engine-load-failed", "device='picamera2' needs picamera2: sudo apt install python3-picamera2"
            ) from exc
        self._cam = Picamera2()  # pragma: no cover
        config = self._cam.create_preview_configuration(  # pragma: no cover
            main={"format": "RGB888", "size": (width or 1280, height or 720)}
        )
        self._cam.configure(config)  # pragma: no cover
        self._cam.start()  # pragma: no cover

    def isOpened(self) -> bool:  # noqa: N802 - mirrors cv2.VideoCapture
        return True  # pragma: no cover

    def read(self) -> Tuple[bool, Any]:
        return True, self._cam.capture_array()  # pragma: no cover  (RGB888 is BGR ordered)

    def release(self) -> None:
        self._cam.stop()  # pragma: no cover


class Camera:
    """Continuously decode barcodes from a camera.

    Args:
        device: Camera index (``0``), a device path (``"/dev/video0"``), a video file,
            an RTSP/HTTP stream URL, a GStreamer pipeline, or ``"picamera2"`` to use the
            Raspberry Pi camera through picamera2.
        symbologies: Ids or groups to look for (default: all).
        mode: ``"single"`` stops after the first scan, ``"continuous"`` keeps
            reporting, ``"batch"`` tracks many codes at once.
        duplicate_filter: Milliseconds before the same code is reported again
            (``0`` every frame, ``-1`` once per session).
        max_results: Codes per frame (default 1, or 20 in batch mode).
        try_harder: Also search downscaled variants and a second binarizer (slower).
        width, height: Requested capture resolution.
        backend: OpenCV capture API, for example ``cv2.CAP_V4L2`` (default: auto).
        scan_area: Region of interest ``(x, y, width, height)`` normalized to 0..1.
        track_timeout_ms: Batch mode: drop a code after this long unseen.
        beep: Ring the terminal bell on each scan.
    """

    def __init__(
        self,
        device: Union[int, str] = 0,
        symbologies: Union[None, str, Iterable[str]] = None,
        mode: str = "continuous",
        duplicate_filter: int = 1000,
        max_results: Optional[int] = None,
        try_harder: bool = False,
        width: Optional[int] = None,
        height: Optional[int] = None,
        backend: Optional[int] = None,
        scan_area: Optional[Sequence[float]] = None,
        track_timeout_ms: int = 500,
        beep: bool = False,
    ) -> None:
        if mode not in MODES:
            raise ValueError("mode must be one of %s" % ", ".join(MODES))
        self.device = device
        self.symbologies = resolve_symbologies(symbologies)
        self.mode = mode
        self.max_results = max_results if max_results is not None else (20 if mode == "batch" else 1)
        self.try_harder = try_harder
        self.width = width
        self.height = height
        self.backend = backend
        self.scan_area = tuple(scan_area) if scan_area else None
        self.beep = beep
        self.duplicates = DuplicateFilter(duplicate_filter)
        self.tracker = BatchTracker(track_timeout_ms)
        self._capture: Any = None
        self._window_ok: Optional[bool] = None

    # ------------------------------------------------------------------ lifecycle

    def open(self) -> "Camera":
        """Open the capture device. Called automatically by :meth:`read` and :meth:`run`."""
        if self._capture is not None:
            return self
        if self.device == "picamera2":
            self._capture = _Picamera2Source(self.width, self.height)
            return self
        cv2 = _require_cv2()
        device: Union[int, str] = self.device
        if isinstance(device, str) and device.isdigit():
            device = int(device)
        backend = self.backend
        if backend is None and isinstance(device, str) and ("!" in device and "appsink" in device):
            backend = cv2.CAP_GSTREAMER
        capture = cv2.VideoCapture(device, backend) if backend is not None else cv2.VideoCapture(device)
        if not capture.isOpened():
            capture.release()
            if isinstance(device, int) or (isinstance(device, str) and device.startswith("/dev/")):
                exists = isinstance(device, int) or os.path.exists(device)
                if isinstance(device, int) and sys.platform.startswith("linux"):
                    exists = os.path.exists("/dev/video%d" % device)
                code = "camera-in-use" if exists else "camera-not-found"
            else:
                code = "camera-not-found"
            raise CameraError(code, "Cannot open camera %r (%s)" % (self.device, code))
        if self.width:
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        if self.height:
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._capture = capture
        return self

    def close(self) -> None:
        """Release the camera and close the preview window."""
        if self._capture is not None:
            self._capture.release()
            self._capture = None
        if self._window_ok:
            try:
                _require_cv2().destroyAllWindows()
            except Exception:  # pragma: no cover
                pass

    def __enter__(self) -> "Camera":
        return self.open()

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def read(self) -> Any:
        """Grab one BGR frame (numpy array), or ``None`` at the end of a stream."""
        self.open()
        ok, frame = self._capture.read()
        return frame if ok else None

    # ------------------------------------------------------------------ processing

    def process(self, frame: Any, now_ms: Optional[int] = None) -> FrameResult:
        """Decode one frame and apply the duplicate filter / tracker.

        Works without a camera: pass any grayscale, BGR or BGRA numpy array.
        """
        import zxingcpp

        from .scanner import _load_image, decode

        now = _now(now_ms)
        full_h, full_w = frame.shape[:2]
        offset_x = offset_y = 0
        region = frame
        if self.scan_area:
            x, y, w, h = self.scan_area
            offset_x, offset_y = int(x * full_w), int(y * full_h)
            region = frame[offset_y : offset_y + max(1, int(h * full_h)), offset_x : offset_x + max(1, int(w * full_w))]
        img, width, height = _load_image(region)
        binarizers = [zxingcpp.Binarizer.LocalAverage]
        if self.try_harder:
            binarizers.append(zxingcpp.Binarizer.GlobalHistogram)
        barcodes = decode(
            img,
            self.symbologies,
            width,
            height,
            try_rotate=True,
            try_downscale=self.try_harder or max(width, height) > 1280,
            try_invert=self.try_harder,
            binarizers=binarizers,
            max_results=self.max_results,
        )
        for barcode in barcodes:
            barcode.timestamp = now
            barcode.frame_size = Size(full_w, full_h)
            if offset_x or offset_y:
                barcode.location = Quad(*(Point(p.x + offset_x, p.y + offset_y) for p in barcode.location))

        result = FrameResult(barcodes=barcodes, new=self.duplicates.filter(barcodes, now))
        if self.mode == "batch":
            result.tracked = self.tracker.update(barcodes, now)
            result.added = list(self.tracker.added)
            result.removed = list(self.tracker.removed)
        return result

    def frames(self) -> Iterator[Tuple[Any, FrameResult]]:
        """Yield ``(frame, result)`` for every captured frame until the stream ends."""
        self.open()
        while True:
            frame = self.read()
            if frame is None:
                return
            yield frame, self.process(frame)

    # ------------------------------------------------------------------ loop

    def run(
        self,
        on_scan: Optional[ScanCallback] = None,
        on_track: Optional[TrackCallback] = None,
        show_window: bool = True,
        window_title: str = "QRGen scanner",
        timeout: Optional[float] = None,
    ) -> List[Barcode]:
        """Scan until ``q``/Esc is pressed, the stream ends, ``timeout`` seconds pass,
        a callback returns ``False``, or (``mode="single"``) the first code is found.

        Args:
            on_scan: Called with the new barcodes of each frame (``scan`` event).
            on_track: Batch mode: called with the tracked set of each frame (``track`` event).
            show_window: Show a preview window with highlight quads (needs an OpenCV
                build with GUI support; skipped with a warning otherwise).
            window_title: Preview window title.
            timeout: Stop after this many seconds.

        Returns:
            Every barcode that was reported (after duplicate filtering).
        """
        reported: List[Barcode] = []
        deadline = time.monotonic() + timeout if timeout else None
        cv2 = _require_cv2() if show_window else None
        try:
            for frame, result in self.frames():
                stop = False
                if result.new:
                    reported.extend(result.new)
                    if self.beep:
                        sys.stderr.write("\a")
                        sys.stderr.flush()
                    if on_scan is not None and on_scan(result.new) is False:
                        stop = True
                if self.mode == "batch" and on_track is not None and on_track(result.tracked) is False:
                    stop = True
                if cv2 is not None and self._show(cv2, frame, result, window_title):
                    stop = True
                if self.mode == "single" and result.new:
                    stop = True
                if deadline is not None and time.monotonic() >= deadline:
                    stop = True
                if stop:
                    break
        except KeyboardInterrupt:
            pass
        finally:
            self.close()
        return reported

    def _show(self, cv2: Any, frame: Any, result: FrameResult, title: str) -> bool:
        """Draw and show the frame; return ``True`` when the user asked to quit."""
        if self._window_ok is False:
            return False
        shown = result.tracked if self.mode == "batch" else result.barcodes
        draw_barcodes(frame, shown)
        if self.scan_area:
            h, w = frame.shape[:2]
            x, y, sw, sh = self.scan_area
            cv2.rectangle(frame, (int(x * w), int(y * h)), (int((x + sw) * w), int((y + sh) * h)), (255, 255, 255), 1)
        cv2.putText(frame, "QRGen - q to quit", (10, frame.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        try:
            cv2.imshow(title, frame)
            key = cv2.waitKey(1) & 0xFF
            self._window_ok = True
        except cv2.error:
            self._window_ok = False
            warnings.warn(
                "OpenCV was built without GUI support (opencv-python-headless); scanning continues "
                "without a preview window. Install opencv-python for a window.",
                RuntimeWarning,
                stacklevel=3,
            )
            return False
        return key in (ord("q"), 27)


def scan_camera(
    device: Union[int, str] = 0,
    symbologies: Union[None, str, Iterable[str]] = None,
    mode: str = "continuous",
    duplicate_filter: int = 1000,
    show_window: bool = True,
    on_scan: Optional[ScanCallback] = None,
    on_track: Optional[TrackCallback] = None,
    timeout: Optional[float] = None,
    **options: Any,
) -> List[Barcode]:
    """Open a camera, scan until stopped and return every reported barcode.

    Example::

        from qrgen_sdk.camera import scan_camera

        scan_camera(on_scan=lambda codes: print([c.data for c in codes]))

    See :class:`Camera` for ``device``, ``mode``, ``duplicate_filter`` and the extra
    keyword options (``max_results``, ``width``, ``height``, ``scan_area``, ``beep``...).
    """
    camera = Camera(device=device, symbologies=symbologies, mode=mode, duplicate_filter=duplicate_filter, **options)
    return camera.run(on_scan=on_scan, on_track=on_track, show_window=show_window, timeout=timeout)


def _now(value: Optional[int]) -> int:
    return now_ms() if value is None else int(value)
