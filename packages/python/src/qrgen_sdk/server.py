"""QRGen REST API (SPEC section 6) using only the Python standard library.

Start it with ``qrgen-py serve --port 8080`` (or ``python -m qrgen_sdk serve``), or
embed it::

    from qrgen_sdk.server import create_server

    server = create_server(port=8080)
    server.serve_forever()

Endpoints: ``GET /health``, ``GET /v1/symbologies``, ``POST /v1/scan``,
``GET|POST /v1/generate`` and ``POST /v1/parse``. CORS is enabled for all origins.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

from ._version import __version__
from .generator import GenerateError, generate
from .parsers.aamva import parse_aamva
from .parsers.content import parse_content
from .parsers.gs1 import parse_gs1
from .scanner import ScanError, scan
from .symbologies import UnknownSymbologyError, supported_symbologies

__all__ = ["QRGenHandler", "ApiError", "create_server", "serve", "start_in_thread", "DEFAULT_MAX_BODY"]

#: Largest accepted request body (bytes).
DEFAULT_MAX_BODY = 25 * 1024 * 1024

logger = logging.getLogger("qrgen_sdk.server")

_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
}

_IMAGE_TYPES = {
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "gif": "image/gif",
    "tiff": "image/tiff",
}


class ApiError(Exception):
    """An error rendered as ``{"error": {"code", "message"}}``."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _truthy(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off", ""):
        return False
    return default


def _symbology_list(value: Any) -> Optional[List[str]]:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return [part for part in re.split(r"[,\s]+", value) if part]
    if isinstance(value, list):
        return [str(part) for part in value]
    raise ApiError(400, "bad-request", "symbologies must be a list or a comma separated string")


def _decode_image_field(value: Any) -> bytes:
    if not isinstance(value, str) or not value:
        raise ApiError(400, "bad-request", 'JSON body needs an "image" field with base64 data or a data URL')
    if value.startswith("data:"):
        _, _, value = value.partition(",")
    try:
        return base64.b64decode(re.sub(r"\s+", "", value) + "===", validate=False)
    except (binascii.Error, ValueError) as exc:
        raise ApiError(400, "bad-request", "image is not valid base64: %s" % exc) from exc


class QRGenHandler(BaseHTTPRequestHandler):
    """Request handler implementing the QRGen REST API."""

    server_version = "QRGen/" + __version__
    protocol_version = "HTTP/1.1"
    max_body = DEFAULT_MAX_BODY
    quiet = False

    # ------------------------------------------------------------------ plumbing

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        if not self.quiet:
            logger.info("%s - %s", self.address_string(), format % args)

    def _send(self, status: int, body: bytes, content_type: str, extra: Optional[Dict[str, str]] = None) -> None:
        self.send_response(status)
        for key, value in _CORS_HEADERS.items():
            self.send_header(key, value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, {"error": {"code": code, "message": message}})

    def _body(self) -> bytes:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                raise ApiError(411, "length-required", "chunked uploads are not supported; send Content-Length")
            return b""
        try:
            length = int(length_header)
        except ValueError as exc:
            raise ApiError(400, "bad-request", "invalid Content-Length") from exc
        if length > self.max_body:
            raise ApiError(413, "payload-too-large", "request body exceeds %d bytes" % self.max_body)
        return self.rfile.read(length) if length > 0 else b""

    def _content_type(self) -> str:
        return (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()

    def _json_body(self, raw: bytes) -> Dict[str, Any]:
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, ValueError) as exc:
            raise ApiError(400, "bad-request", "invalid JSON body: %s" % exc) from exc
        if not isinstance(payload, dict):
            raise ApiError(400, "bad-request", "JSON body must be an object")
        return payload

    def _dispatch(self, method: str) -> None:
        url = urlsplit(self.path)
        path = url.path.rstrip("/") or "/"
        query = {k: v[-1] for k, v in parse_qs(url.query, keep_blank_values=True).items()}
        routes = {
            ("GET", "/"): self._index,
            ("GET", "/health"): self._health,
            ("GET", "/v1/health"): self._health,
            ("GET", "/v1/symbologies"): self._symbologies,
            ("POST", "/v1/scan"): self._scan,
            ("GET", "/v1/generate"): self._generate_get,
            ("POST", "/v1/generate"): self._generate_post,
            ("POST", "/v1/parse"): self._parse,
            ("GET", "/v1/parse"): self._parse_get,
        }
        handler = routes.get((method, path))
        try:
            if handler is None:
                if any(p == path for (_, p) in routes):
                    raise ApiError(405, "method-not-allowed", "%s is not allowed on %s" % (method, path))
                raise ApiError(404, "not-found", "no route for %s %s" % (method, path))
            handler(query)
        except ApiError as exc:
            self._error(exc.status, exc.code, exc.message)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("unhandled error")
            self._error(500, "internal", "%s: %s" % (type(exc).__name__, exc))

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        self._dispatch("GET")

    def do_HEAD(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"", "text/plain")

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch("PUT")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    # ------------------------------------------------------------------ routes

    def _index(self, query: Dict[str, str]) -> None:
        self._json(
            200,
            {
                "name": "qrgen",
                "version": __version__,
                "endpoints": ["GET /health", "GET /v1/symbologies", "POST /v1/scan", "GET|POST /v1/generate", "POST /v1/parse"],
                "docs": "https://github.com/Rockyljewell/QR-GEN/blob/main/docs/SPEC.md#6-rest-api-qrgen-serve-docker-image",
            },
        )

    def _health(self, query: Dict[str, str]) -> None:
        self._json(200, {"ok": True, "version": __version__})

    def _symbologies(self, query: Dict[str, str]) -> None:
        self._json(200, {"read": supported_symbologies("read"), "write": supported_symbologies("write")})

    def _scan(self, query: Dict[str, str]) -> None:
        raw = self._body()
        symbologies = _symbology_list(query.get("symbologies"))
        try_harder = _truthy(query.get("tryHarder"), True)
        max_results: Optional[int] = None
        if self._content_type() == "application/json" or raw[:1] == b"{":
            payload = self._json_body(raw)
            image = _decode_image_field(payload.get("image"))
            if "symbologies" in payload:
                symbologies = _symbology_list(payload.get("symbologies"))
            try_harder = _truthy(payload.get("tryHarder"), try_harder)
            if payload.get("maxResults") is not None:
                max_results = _int(payload.get("maxResults"), "maxResults")
        else:
            image = raw
        if query.get("maxResults"):
            max_results = _int(query["maxResults"], "maxResults")
        if not image:
            raise ApiError(400, "bad-request", "empty body; POST image bytes or JSON {\"image\": \"<base64>\"}")
        try:
            barcodes = scan(image, symbologies=symbologies, try_harder=try_harder, max_results=max_results)
        except UnknownSymbologyError as exc:
            raise ApiError(400, "bad-request", str(exc)) from exc
        except ScanError as exc:
            raise ApiError(400, "bad-request", str(exc)) from exc
        self._json(200, {"barcodes": [b.to_dict(include_parsed=True) for b in barcodes]})

    def _generate(self, fields: Dict[str, Any]) -> None:
        data = fields.get("data")
        if data is None or data == "":
            raise ApiError(400, "bad-request", 'missing "data"')
        fmt = str(fields.get("format") or "svg").lower()
        options: Dict[str, Any] = {
            "symbology": str(fields.get("symbology") or "qr"),
            "format": fmt,
            "scale": _int(fields.get("scale", 4), "scale"),
            "ec_level": fields.get("ecLevel") or None,
            "gs1": _truthy(fields.get("gs1"), False),
            "hrt": _truthy(fields.get("hrt"), False),
            "margin": _truthy(fields.get("margin"), True),
            "foreground": fields.get("foreground") or None,
            "background": fields.get("background") or None,
        }
        try:
            output = generate(str(data), **options)
        except (GenerateError, UnknownSymbologyError) as exc:
            raise ApiError(400, "bad-request", str(exc)) from exc
        if isinstance(output, str):
            self._send(200, output.encode("utf-8"), "image/svg+xml; charset=utf-8")
        else:
            normalized = "jpeg" if fmt == "jpg" else fmt
            self._send(200, output, _IMAGE_TYPES.get(normalized, "application/octet-stream"))

    def _generate_get(self, query: Dict[str, str]) -> None:
        self._generate(query)

    def _generate_post(self, query: Dict[str, str]) -> None:
        raw = self._body()
        fields: Dict[str, Any] = dict(query)
        if raw:
            if self._content_type() in ("application/json", "") or raw[:1] == b"{":
                fields.update(self._json_body(raw))
            else:
                fields["data"] = raw.decode("utf-8", "replace")
        self._generate(fields)

    def _parse_payload(self, data: Any, kind: str) -> None:
        if not isinstance(data, str):
            raise ApiError(400, "bad-request", 'missing "data" (string)')
        kind = (kind or "content").lower()
        if kind == "gs1":
            self._json(200, parse_gs1(data))
        elif kind == "aamva":
            self._json(200, parse_aamva(data))
        else:
            self._json(200, parse_content(data))

    def _parse(self, query: Dict[str, str]) -> None:
        raw = self._body()
        if self._content_type() == "application/json" or raw[:1] == b"{":
            payload = self._json_body(raw)
            self._parse_payload(payload.get("data"), str(payload.get("type") or query.get("type") or "content"))
        else:
            self._parse_payload(raw.decode("utf-8", "replace"), query.get("type", "content"))

    def _parse_get(self, query: Dict[str, str]) -> None:
        self._parse_payload(query.get("data"), query.get("type", "content"))


def _int(value: Any, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "bad-request", "%s must be an integer" % name) from exc


def create_server(
    host: str = "127.0.0.1",
    port: int = 8080,
    *,
    quiet: bool = False,
    max_body: int = DEFAULT_MAX_BODY,
) -> ThreadingHTTPServer:
    """Create (but do not start) a threaded HTTP server for the QRGen API.

    Args:
        host: Interface to bind; use ``"0.0.0.0"`` to accept remote connections.
        port: TCP port; ``0`` picks a free port (see ``server.server_address``).
        quiet: Suppress per-request logging.
        max_body: Largest accepted request body in bytes.
    """
    handler = type("BoundQRGenHandler", (QRGenHandler,), {"quiet": quiet, "max_body": max_body})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def serve(host: str = "127.0.0.1", port: int = 8080, *, quiet: bool = False) -> None:
    """Run the API server until interrupted (Ctrl+C)."""
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    server = create_server(host, port, quiet=quiet)
    bound_host, bound_port = server.server_address[:2]
    print("QRGen %s REST API listening on http://%s:%d" % (__version__, str(bound_host), int(bound_port)), file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def start_in_thread(host: str = "127.0.0.1", port: int = 0, **kwargs: Any) -> Tuple[ThreadingHTTPServer, threading.Thread]:
    """Start a server on a background thread (handy for tests). Returns ``(server, thread)``."""
    server = create_server(host, port, **kwargs)
    thread = threading.Thread(target=server.serve_forever, name="qrgen-server", daemon=True)
    thread.start()
    return server, thread
