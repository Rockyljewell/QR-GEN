"""Command line interface: ``qrgen-py`` (also ``qrgen-sdk`` and ``python -m qrgen_sdk``).

The Python CLI is called ``qrgen-py`` so it does not clash with the Node ``qrgen`` CLI.

Examples::

    qrgen-py scan photo.jpg --symbologies qr,ean13 --json
    qrgen-py generate "https://example.com" -o qr.svg
    qrgen-py generate "(01)09501101530003(10)ABC" --symbology code128 --gs1 -o label.png
    qrgen-py parse "WIFI:T:WPA;S:Home;P:secret;;"
    qrgen-py camera --mode batch
    qrgen-py serve --port 8080
"""

from __future__ import annotations

import argparse
import codecs
import json
import sys
from typing import Any, List, Optional, Sequence

from ._version import __version__

__all__ = ["main", "build_parser"]


def _print_json(value: Any) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def _read_data(value: str, unescape: bool) -> str:
    if value == "-":
        value = sys.stdin.read()
        if value.endswith("\n") and not unescape:
            value = value[:-1]
    if unescape:
        value = codecs.decode(value.encode("latin-1", "backslashreplace"), "unicode_escape")
    return value


def _cmd_scan(args: argparse.Namespace) -> int:
    from .scanner import ScanError, scan

    results = []
    found = False
    status = 0
    for path in args.images:
        try:
            if path == "-":
                barcodes = scan(sys.stdin.buffer.read(), symbologies=args.symbologies, try_harder=not args.fast)
            else:
                barcodes = scan(path, symbologies=args.symbologies, try_harder=not args.fast)
        except (OSError, ScanError, ValueError) as exc:
            sys.stderr.write("qrgen-py: %s: %s\n" % (path, exc))
            results.append({"file": path, "error": str(exc), "barcodes": []})
            status = 2
            continue
        found = found or bool(barcodes)
        results.append({"file": path, "barcodes": [b.to_dict(include_parsed=args.parse) for b in barcodes]})
        if not args.json:
            for barcode in barcodes:
                prefix = "%s\t" % path if len(args.images) > 1 else ""
                sys.stdout.write("%s%s\t%s\n" % (prefix, barcode.symbology, barcode.data))
    if args.json:
        _print_json(results)
    if status:
        return status
    return 0 if found else 1


def _cmd_generate(args: argparse.Namespace) -> int:
    from .generator import GenerateError, _EXTENSIONS, generate

    data = _read_data(args.data, args.unescape)
    fmt = args.format
    if fmt is None:
        if args.output and args.output != "-":
            import os

            fmt = _EXTENSIONS.get(os.path.splitext(args.output)[1].lower(), "svg")
        else:
            fmt = "svg"
    try:
        output = generate(
            data,
            symbology=args.symbology,
            format=fmt,
            scale=args.scale,
            ec_level=args.ec_level,
            gs1=args.gs1,
            hrt=args.hrt,
            margin=not args.no_margin,
            foreground=args.foreground,
            background=args.background,
        )
    except (GenerateError, ValueError) as exc:
        sys.stderr.write("qrgen-py: %s\n" % exc)
        return 2
    if not args.output or args.output == "-":
        if isinstance(output, str):
            sys.stdout.write(output)
        else:
            sys.stdout.buffer.write(output)
            sys.stdout.flush()
        return 0
    mode, payload = ("w", output) if isinstance(output, str) else ("wb", output)
    if mode == "w":
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(payload)  # type: ignore[arg-type]
    else:
        with open(args.output, "wb") as handle:
            handle.write(payload)  # type: ignore[arg-type]
    sys.stderr.write("wrote %s\n" % args.output)
    return 0


def _cmd_parse(args: argparse.Namespace) -> int:
    from .parsers import parse_aamva, parse_content, parse_gs1

    data = _read_data(args.data, args.unescape)
    if args.type == "gs1":
        result = parse_gs1(data)
    elif args.type == "aamva":
        result = parse_aamva(data)
    else:
        result = parse_content(data)
    _print_json(result)
    return 0 if result is not None else 1


def _cmd_camera(args: argparse.Namespace) -> int:
    from .camera import Camera, CameraError

    def on_scan(barcodes: List[Any]) -> None:
        for barcode in barcodes:
            if args.json:
                sys.stdout.write(json.dumps(barcode.to_dict(include_parsed=True), ensure_ascii=False) + "\n")
            else:
                sys.stdout.write("%s\t%s\n" % (barcode.symbology, barcode.data))
        sys.stdout.flush()

    scan_area = None
    if args.scan_area:
        try:
            scan_area = [float(v) for v in args.scan_area.split(",")]
            assert len(scan_area) == 4
        except (ValueError, AssertionError):
            sys.stderr.write("qrgen-py: --scan-area needs x,y,width,height (0..1)\n")
            return 2
    try:
        camera = Camera(
            device=args.device,
            symbologies=args.symbologies,
            mode=args.mode,
            duplicate_filter=args.duplicate_filter,
            width=args.width,
            height=args.height,
            scan_area=scan_area,
            beep=args.beep,
        )
        camera.run(on_scan=on_scan, show_window=not args.no_window, timeout=args.timeout)
    except CameraError as exc:
        sys.stderr.write("qrgen-py: %s: %s\n" % (exc.code, exc))
        return 2
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    from .server import serve

    serve(args.host, args.port, quiet=args.quiet)
    return 0


def _cmd_symbologies(args: argparse.Namespace) -> int:
    from .symbologies import GROUPS, SYMBOLOGIES, supported_symbologies

    readable = set(supported_symbologies("read"))
    writable = set(supported_symbologies("write"))
    if args.json:
        _print_json(
            {
                "read": [s for s in SYMBOLOGIES if s in readable],
                "write": [s for s in SYMBOLOGIES if s in writable],
                "groups": {k: list(v) for k, v in GROUPS.items()},
            }
        )
        return 0
    for sid, info in SYMBOLOGIES.items():
        flags = ("R" if sid in readable else "-") + ("W" if sid in writable else "-")
        aliases = ", ".join(info.aliases)
        sys.stdout.write("%-17s %s  %-30s %s\n" % (sid, flags, info.name, aliases))
    return 0


def build_parser() -> argparse.ArgumentParser:
    """Return the ``argparse`` parser used by :func:`main`."""
    parser = argparse.ArgumentParser(
        prog="qrgen-py",
        description="QRGen: scan, generate and parse barcodes, QR codes and ID documents.",
    )
    parser.add_argument("--version", action="version", version="qrgen-sdk %s" % __version__)
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    p = sub.add_parser("scan", help="decode barcodes in image files")
    p.add_argument("images", nargs="+", metavar="IMAGE", help="image files ('-' reads stdin)")
    p.add_argument("-s", "--symbologies", help="comma separated ids or groups, e.g. qr,ean13 or retail")
    p.add_argument("--json", action="store_true", help="print SPEC JSON results")
    p.add_argument("--parse", action="store_true", help="include parsed content in JSON output")
    p.add_argument("--fast", action="store_true", help="skip rotated/downscaled/inverted passes")
    p.set_defaults(func=_cmd_scan)

    p = sub.add_parser("generate", help="create a barcode image")
    p.add_argument("data", metavar="DATA", help="text to encode ('-' reads stdin)")
    p.add_argument("-o", "--output", help="output file (.svg, .png, .jpg...); default: stdout")
    p.add_argument("-s", "--symbology", default="qr", help="symbology id (default: qr)")
    p.add_argument("-f", "--format", choices=["svg", "png", "jpeg", "jpg", "webp", "bmp", "gif", "tiff"], help="output format")
    p.add_argument("--scale", type=int, default=4, help="pixels per module (default: 4)")
    p.add_argument("--ec-level", help="error correction: L/M/Q/H (QR) or 0-8 / percent (PDF417, Aztec)")
    p.add_argument("--gs1", action="store_true", help="encode GS1 data given in HRI form")
    p.add_argument("--hrt", action="store_true", help="add human readable text (linear codes)")
    p.add_argument("--no-margin", action="store_true", help="omit the quiet zone")
    p.add_argument("--foreground", "--fg", help="bar color, e.g. #000000")
    p.add_argument("--background", "--bg", help="background color, e.g. #ffffff or transparent")
    p.add_argument("--unescape", action="store_true", help="interpret backslash escapes such as \\n and \\x1d")
    p.set_defaults(func=_cmd_generate)

    p = sub.add_parser("parse", help="classify and parse decoded text (URL, Wi-Fi, GS1, AAMVA...)")
    p.add_argument("data", metavar="DATA", help="decoded text ('-' reads stdin)")
    p.add_argument("--type", choices=["content", "gs1", "aamva"], default="content", help="parser to run")
    p.add_argument("--unescape", action="store_true", help="interpret backslash escapes such as \\n and \\x1e")
    p.set_defaults(func=_cmd_parse)

    p = sub.add_parser("camera", help="scan from a webcam / Raspberry Pi camera (needs the [camera] extra)")
    p.add_argument("-d", "--device", default="0", help="camera index, /dev/videoN, stream URL or 'picamera2'")
    p.add_argument("-s", "--symbologies", help="comma separated ids or groups")
    p.add_argument("--mode", choices=["single", "continuous", "batch"], default="continuous")
    p.add_argument("--duplicate-filter", type=int, default=1000, help="ms (0 = every frame, -1 = once)")
    p.add_argument("--width", type=int, help="capture width")
    p.add_argument("--height", type=int, help="capture height")
    p.add_argument("--scan-area", help="region of interest x,y,width,height normalized to 0..1")
    p.add_argument("--no-window", action="store_true", help="do not open a preview window")
    p.add_argument("--timeout", type=float, help="stop after this many seconds")
    p.add_argument("--beep", action="store_true", help="ring the terminal bell on each scan")
    p.add_argument("--json", action="store_true", help="print one JSON object per scan")
    p.set_defaults(func=_cmd_camera)

    p = sub.add_parser("serve", help="run the REST API (SPEC section 6)")
    p.add_argument("--host", default="127.0.0.1", help="bind address (use 0.0.0.0 for remote access)")
    p.add_argument("-p", "--port", type=int, default=8080, help="port (default: 8080)")
    p.add_argument("-q", "--quiet", action="store_true", help="no request logging")
    p.set_defaults(func=_cmd_serve)

    p = sub.add_parser("symbologies", help="list symbology ids and what this installation supports")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_symbologies)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Run the CLI and return its exit code (0 ok, 1 nothing found, 2 error)."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        parser.print_help()
        return 2
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130
    except BrokenPipeError:  # pragma: no cover - e.g. piping into `head`
        return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
