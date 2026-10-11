# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

"""REST API tests against a real server on an ephemeral port."""

from __future__ import annotations

import base64
import http.client
import json
import socket
import threading
from urllib.parse import quote

import pytest

import qrgen_sdk
from qrgen_sdk import generate, scan
from qrgen_sdk.server import start_in_thread


@pytest.fixture(scope="module")
def server():
    srv, thread = start_in_thread("127.0.0.1", 0, quiet=True)
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=5)


def request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request(method, path, body=body, headers=headers or {})
    response = conn.getresponse()
    data = response.read()
    result = (response.status, dict((k.lower(), v) for k, v in response.getheaders()), data)
    conn.close()
    return result


def json_request(port, method, path, payload):
    return request(port, method, path, json.dumps(payload).encode(), {"Content-Type": "application/json"})


def test_health(server):
    status, headers, body = request(server, "GET", "/health")
    assert status == 200
    assert json.loads(body) == {"ok": True, "version": qrgen_sdk.__version__}
    assert headers["access-control-allow-origin"] == "*"
    assert headers["content-type"].startswith("application/json")


def test_cors_preflight(server):
    status, headers, _ = request(server, "OPTIONS", "/v1/scan", headers={"Origin": "https://example.com"})
    assert status == 204
    assert headers["access-control-allow-origin"] == "*"
    assert "POST" in headers["access-control-allow-methods"]


def test_symbologies(server):
    status, _, body = request(server, "GET", "/v1/symbologies")
    payload = json.loads(body)
    assert status == 200
    assert "qr" in payload["read"] and "ean13" in payload["write"]


def test_scan_raw_png(server):
    png = generate("https://example.com", format="png")
    status, _, body = request(server, "POST", "/v1/scan", png, {"Content-Type": "image/png"})
    assert status == 200
    barcodes = json.loads(body)["barcodes"]
    assert len(barcodes) == 1
    code = barcodes[0]
    assert code["data"] == "https://example.com"
    assert code["symbology"] == "qr"
    assert code["symbologyName"] == "QR Code"
    assert code["parsed"] == {"type": "url", "url": "https://example.com"}
    assert set(code) >= {"rawBytes", "contentType", "isGS1", "location", "frameSize", "orientation", "ecLevel", "symbologyIdentifier", "timestamp"}


def test_scan_json_base64_and_data_url(server):
    png = generate("(01)09501101530003(17)250101(10)ABC123", symbology="code128", gs1=True, format="png")
    b64 = base64.b64encode(png).decode()
    for image in (b64, "data:image/png;base64," + b64):
        status, _, body = json_request(server, "POST", "/v1/scan", {"image": image, "symbologies": ["code128"], "tryHarder": True})
        assert status == 200
        code = json.loads(body)["barcodes"][0]
        assert code["data"] == "(01)09501101530003(17)250101(10)ABC123"
        assert code["isGS1"] is True
        assert code["parsed"]["type"] == "gs1"
        assert code["parsed"]["gs1"]["values"]["17"] == "250101"


def test_scan_query_symbologies_filter(server):
    png = generate("hello", format="png")
    status, _, body = request(server, "POST", "/v1/scan?symbologies=ean13,code128", png, {"Content-Type": "image/png"})
    assert status == 200 and json.loads(body) == {"barcodes": []}
    status, _, body = request(server, "POST", "/v1/scan?symbologies=qr", png, {"Content-Type": "image/png"})
    assert [b["data"] for b in json.loads(body)["barcodes"]] == ["hello"]


@pytest.mark.parametrize(
    "path,body,headers,code",
    [
        ("/v1/scan", b"garbage", {"Content-Type": "image/png"}, 400),
        ("/v1/scan", b"", {"Content-Type": "image/png"}, 400),
        ("/v1/scan", b"{not json", {"Content-Type": "application/json"}, 400),
        ("/v1/scan", json.dumps({"image": ""}).encode(), {"Content-Type": "application/json"}, 400),
        ("/v1/scan?symbologies=bogus", b"x", {"Content-Type": "image/png"}, 400),
        ("/v1/generate", json.dumps({"data": "123", "symbology": "ean8x"}).encode(), {"Content-Type": "application/json"}, 400),
        ("/v1/generate", json.dumps({"symbology": "qr"}).encode(), {"Content-Type": "application/json"}, 400),
    ],
)
def test_errors_are_json(server, path, body, headers, code):
    status, resp_headers, payload = request(server, "POST", path, body, headers)
    assert status == code
    error = json.loads(payload)["error"]
    assert error["code"] == "bad-request" and error["message"]
    assert resp_headers["access-control-allow-origin"] == "*"


def test_not_found_and_method_not_allowed(server):
    status, _, body = request(server, "GET", "/nope")
    assert status == 404 and json.loads(body)["error"]["code"] == "not-found"
    status, _, body = request(server, "GET", "/v1/scan")
    assert status == 405 and json.loads(body)["error"]["code"] == "method-not-allowed"


def test_generate_post_svg_and_png(server):
    status, headers, body = json_request(server, "POST", "/v1/generate", {"data": "hello", "symbology": "qr", "format": "svg", "scale": 4, "ecLevel": "M", "gs1": False, "hrt": False, "margin": True})
    assert status == 200
    assert headers["content-type"].startswith("image/svg+xml")
    assert b"<svg" in body
    status, headers, body = json_request(server, "POST", "/v1/generate", {"data": "hello", "format": "png"})
    assert status == 200 and headers["content-type"] == "image/png"
    assert [b.data for b in scan(body)] == ["hello"]


def test_generate_get_query(server):
    data = quote("(01)09501101530003(10)ABC")
    status, headers, body = request(server, "GET", "/v1/generate?data=%s&symbology=code128&format=png&gs1=1&scale=2&hrt=true" % data)
    assert status == 200 and headers["content-type"] == "image/png"
    code = scan(body)[0]
    assert code.data == "(01)09501101530003(10)ABC" and code.is_gs1
    status, headers, body = request(server, "GET", "/v1/generate?data=hi")
    assert status == 200 and headers["content-type"].startswith("image/svg+xml")


def test_parse(server, gs1_vector, aamva_vector):
    status, _, body = json_request(server, "POST", "/v1/parse", {"data": "WIFI:T:WPA;S:Home;P:secret;;"})
    assert status == 200
    assert json.loads(body) == {"type": "wifi", "ssid": "Home", "password": "secret", "security": "WPA", "hidden": False}
    status, _, body = json_request(server, "POST", "/v1/parse", {"data": gs1_vector})
    assert json.loads(body)["gs1"]["values"]["10"] == "ABC123"
    status, _, body = json_request(server, "POST", "/v1/parse", {"data": aamva_vector})
    assert json.loads(body)["aamva"]["firstName"] == "JANE"
    status, _, body = request(server, "POST", "/v1/parse", b"tel:+15550100", {"Content-Type": "text/plain"})
    assert json.loads(body) == {"type": "phone", "number": "+15550100"}
    status, _, body = json_request(server, "POST", "/v1/parse", {"nope": 1})
    assert status == 400


def test_payload_too_large():
    srv, thread = start_in_thread("127.0.0.1", 0, quiet=True, max_body=100)
    try:
        status, _, body = request(srv.server_address[1], "POST", "/v1/scan", b"x" * 200, {"Content-Type": "image/png"})
        assert status == 413 and json.loads(body)["error"]["code"] == "payload-too-large"
    finally:
        srv.shutdown()
        srv.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize(
    "method,path,body,headers,chunked,expected_status",
    [
        ("POST", "/v1/parse", b"x" * 200, {"Content-Type": "text/plain"}, False, 413),
        ("POST", "/nope", b"ignored", {"Content-Type": "text/plain"}, False, 404),
        ("POST", "/health", b"ignored", {"Content-Type": "text/plain"}, False, 405),
        ("POST", "/v1/parse", [b"ignored"], {"Content-Type": "text/plain", "Transfer-Encoding": "chunked"}, True, 411),
        ("PUT", "/v1/parse", b"ignored", {"Content-Type": "text/plain"}, False, 405),
    ],
    ids=["oversized", "unknown-route", "wrong-method", "unsupported-chunked", "put-method"],
)
def test_rejected_unread_body_closes_connection(method, path, body, headers, chunked, expected_status):
    srv, thread = start_in_thread("127.0.0.1", 0, quiet=True, max_body=100)
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers, encode_chunked=chunked)
        response = conn.getresponse()
        assert response.status == expected_status
        response.read()
        connection_header = response.getheader("Connection")
        will_close = response.will_close

        # http.client reconnects when the first response explicitly closes its socket.
        # Otherwise unread bytes from the rejected body corrupt this next method.
        conn.request("GET", "/health")
        follow_up = conn.getresponse()
        follow_up_body = follow_up.read()
        assert follow_up.status == 200, follow_up_body
        assert json.loads(follow_up_body)["ok"] is True
        assert connection_header == "close" and will_close
    finally:
        conn.close()
        srv.shutdown()
        srv.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize(
    "body,headers,expected_status",
    [
        (b"{not json", {"Content-Type": "application/json"}, 400),
        (b"hello", {"Content-Type": "text/plain"}, 200),
    ],
    ids=["consumed-error", "consumed-success"],
)
def test_consumed_body_preserves_keepalive(server, body, headers, expected_status):
    conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    try:
        conn.request("POST", "/v1/parse", body=body, headers=headers)
        socket = conn.sock
        response = conn.getresponse()
        assert response.status == expected_status
        response.read()
        assert response.getheader("Connection") is None
        assert not response.will_close and conn.sock is socket

        conn.request("GET", "/health")
        follow_up = conn.getresponse()
        assert follow_up.status == 200 and json.loads(follow_up.read())["ok"] is True
        assert conn.sock is socket
    finally:
        conn.close()


def test_oversized_upload_receives_json_before_sending_the_complete_body():
    srv, thread = start_in_thread("127.0.0.1", 0, quiet=True, max_body=100)
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    stop_upload = threading.Event()

    def continue_upload(upload_socket):
        try:
            for _ in range(32):
                if stop_upload.is_set():
                    break
                upload_socket.sendall(b"x" * 16_384)
        except OSError:
            pass  # A rejected uploader is allowed to lose its sending side.

    upload = None
    try:
        conn.putrequest("POST", "/v1/scan")
        conn.putheader("Content-Type", "image/png")
        conn.putheader("Content-Length", "1000000000")
        conn.endheaders(b"x" * 16_384)
        upload = threading.Thread(target=continue_upload, args=(conn.sock,))
        upload.start()
        response = conn.getresponse()
        assert response.status == 413 and response.getheader("Connection") == "close"
        assert json.loads(response.read())["error"]["code"] == "payload-too-large"
    finally:
        stop_upload.set()
        if upload is not None:
            upload.join(timeout=5)
            assert not upload.is_alive()
        conn.close()
        srv.shutdown()
        srv.server_close()
        thread.join(timeout=5)


def test_rejected_upload_close_grace_is_bounded_for_a_client_that_stays_open():
    srv, thread = start_in_thread("127.0.0.1", 0, quiet=True, max_body=100)
    finished = threading.Event()
    original_finish = srv.RequestHandlerClass.finish

    def observe_finish(handler):
        try:
            original_finish(handler)
        finally:
            finished.set()

    srv.RequestHandlerClass.finish = observe_finish
    client = socket.create_connection(("127.0.0.1", srv.server_address[1]), timeout=5)
    try:
        client.sendall(b"POST /v1/scan HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000000000\r\n\r\nx")
        response = http.client.HTTPResponse(client)
        response.begin()
        assert response.status == 413
        assert json.loads(response.read())["error"]["code"] == "payload-too-large"
        # The real handler must finish even though this client has not sent the
        # declared upload or closed its write side. The timeout is a watchdog.
        assert finished.wait(timeout=5)
    finally:
        client.close()
        srv.shutdown()
        srv.server_close()
        thread.join(timeout=5)
