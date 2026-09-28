# Copyright 2026 Rockyljewell
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


from qrgen_sdk import generate, scan_file
from qrgen_sdk.cli import main

SRC = str(Path(__file__).resolve().parents[1] / "src")


def test_generate_then_scan(tmp_path, capsys):
    out = tmp_path / "code.png"
    assert main(["generate", "https://example.com", "-o", str(out), "--scale", "3"]) == 0
    assert scan_file(out)[0].data == "https://example.com"
    capsys.readouterr()
    assert main(["scan", str(out)]) == 0
    assert capsys.readouterr().out == "qr\thttps://example.com\n"
    assert main(["scan", str(out), "--json", "--parse", "--symbologies", "qr,ean13"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload[0]["file"] == str(out)
    assert payload[0]["barcodes"][0]["parsed"]["type"] == "url"


def test_generate_gs1_svg_to_stdout(capsys):
    assert main(["generate", "(01)09501101530003(10)ABC", "--symbology", "code128", "--gs1", "--hrt"]) == 0
    assert "<svg" in capsys.readouterr().out


def test_scan_nothing_found_and_errors(tmp_path, capsys):
    blank = tmp_path / "blank.png"
    from PIL import Image

    Image.new("L", (50, 50), 255).save(blank)
    assert main(["scan", str(blank)]) == 1
    assert main(["scan", str(tmp_path / "missing.png")]) == 2
    assert main(["generate", "abc", "--symbology", "ean13"]) == 2


def test_parse_command(capsys, aamva_vector):
    assert main(["parse", "WIFI:T:WPA;S:Home;P:secret;;"]) == 0
    assert json.loads(capsys.readouterr().out)["ssid"] == "Home"
    escaped = aamva_vector.encode("unicode_escape").decode("ascii")
    assert main(["parse", escaped, "--unescape"]) == 0
    assert json.loads(capsys.readouterr().out)["aamva"]["lastName"] == "SAMPLE"
    assert main(["parse", "(01)09501101530003", "--type", "gs1"]) == 0
    assert json.loads(capsys.readouterr().out)["values"] == {"01": "09501101530003"}
    assert main(["parse", "nope", "--type", "aamva"]) == 1


def test_symbologies_command(capsys):
    assert main(["symbologies", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "qr" in payload["read"] and "retail" in payload["groups"]


def test_no_command_prints_help(capsys):
    assert main([]) == 2


def test_python_dash_m(tmp_path):
    png = tmp_path / "m.png"
    png.write_bytes(generate("dash-m", format="png"))
    env = {"PYTHONPATH": SRC, "PATH": ""}
    result = subprocess.run([sys.executable, "-m", "qrgen_sdk", "scan", str(png)], capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "qr\tdash-m"
    version = subprocess.run([sys.executable, "-m", "qrgen_sdk", "--version"], capture_output=True, text=True, env=env)
    assert "1.0.0" in version.stdout
