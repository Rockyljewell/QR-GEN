---
title: CLI
description: "Scan, generate and parse barcodes from the command line with the qrgen CLI, and start the REST API server. Commands, flags, JSON output, stdin and exit codes."
group: "Server & Linux"
order: 2
status: stable
---

The `qrgen` command ships with the `qrgen-sdk` npm package. It scans image files, generates barcode images, parses scanned text, lists symbologies and starts the [REST API](../rest-api/). It runs anywhere Node.js 18.17+ runs, including Raspberry Pi and CI runners.

## Install

Run it without installing:

```bash
npx qrgen-sdk --help
```

Or install it globally, which puts `qrgen` on your `PATH`:

```bash
npm install -g qrgen-sdk
qrgen --help
```

> **Note:** Until the first npm release is published, install the latest build with `npm install -g https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz`.

In a project that depends on `qrgen-sdk`, use `npx qrgen` (the bin is named `qrgen`) or call it from `package.json` scripts.

## Commands

| Command | Aliases | Description |
| --- | --- | --- |
| `qrgen scan <image...>` | `decode`, `read` | Decode barcodes in one or more image files (PNG, JPEG, GIF, BMP). `-` reads an image from stdin. |
| `qrgen generate <data>` | `encode`, `write` | Generate a barcode. Writes a file with `-o`, otherwise prints a text rendering to the terminal. |
| `qrgen parse <data>` | | Parse scanned text with [`parseContent()`](../parsers/) and print JSON. |
| `qrgen serve` | `server` | Start the [REST API](../rest-api/). |
| `qrgen symbologies` | | List symbologies and whether they can be read and written. |

Global flags: `-h`, `--help` prints usage; `-v`, `--version` prints the version.

## scan

```bash
qrgen scan label.jpg
```

```text
QR Code	https://example.com
```

Each code is printed as `symbology name<TAB>data`. With several files, results are grouped under each file name:

```bash
qrgen scan front.png back.png
```

```text
front.png:
  QR Code	https://example.com
back.png:
  (no barcode found)
```

| Flag | Short | Description |
| --- | --- | --- |
| `--symbologies <list>` | `-s` | Only look for these ids, aliases or groups: `-s qr,ean13`, `-s retail`. Default: all. |
| `--json` | | Print JSON instead of text. |
| `--no-parse` | | Leave out the `parsed` field in JSON output. |
| `--fast` | | Skip the thorough search (faster on large, clean images). |

Scanning uses the thorough mode (`tryHarder`) by default, which finds small, rotated and inverted codes. Pass `--fast` to turn it off.

### JSON output

With a single file, `--json` prints an array of [Barcode](../concepts/#the-barcode-result) objects, each with a `parsed` field from `parseContent()`:

```bash
qrgen scan qr.png --json
```

```json
[
  {
    "data": "https://example.com",
    "symbology": "qr",
    "symbologyName": "QR Code",
    "rawBytes": "aHR0cHM6Ly9leGFtcGxlLmNvbQ==",
    "contentType": "text",
    "isGS1": false,
    "location": {
      "topLeft": { "x": 16, "y": 16 },
      "topRight": { "x": 116, "y": 16 },
      "bottomRight": { "x": 116, "y": 116 },
      "bottomLeft": { "x": 16, "y": 116 }
    },
    "frameSize": { "width": 132, "height": 132 },
    "orientation": 0,
    "ecLevel": "Q",
    "symbologyIdentifier": "]Q1",
    "timestamp": 1790467200000,
    "parsed": { "type": "url", "url": "https://example.com" }
  }
]
```

With several files, it prints an array of `{ "file": "...", "barcodes": [...] }` objects instead. Combine with [jq](https://jqlang.github.io/jq/):

```bash
qrgen scan *.png --json | jq -r '.[] | "\(.file)\t\(.barcodes[0].data // "-")"'
```

### stdin

Use `-` as the file name to read an image from standard input:

```bash
curl -s https://example.com/label.png | qrgen scan -
convert page.tiff png:- | qrgen scan - --json   # ImageMagick, for formats the engine can't read
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. For `scan`: at least one code was found in at least one file. |
| `1` | Error: bad arguments, an unreadable file, or data that can't be encoded. The message goes to stderr, prefixed with `qrgen:`. |
| `2` | `scan` ran but found no code in any file. |

This makes `scan` easy to use in scripts:

```bash
if qrgen scan receipt.jpg -s qr > /dev/null; then
  echo "Receipt has a QR code"
fi
```

## generate

```bash
qrgen generate "https://example.com" -o qr.svg
qrgen generate "https://example.com" -o qr.png --scale 8 --ec H
qrgen generate "5901234123457" -t ean13 --hrt -o ean.png
qrgen generate "(01)09501101530003(17)250101(10)ABC123" -t data-matrix --gs1 -o dm.png
qrgen generate "Hello"   # prints the code to the terminal
```

All positional arguments after `generate` are joined with spaces, so quotes are only needed for shell special characters. On success with `-o`, it prints `wrote qr.svg (qr, 25x25 modules)`.

| Flag | Short | Description |
| --- | --- | --- |
| `--output <file>` | `-o` | Output file. The extension picks the format: `.png`, `.txt` (text rendering), anything else SVG. Without `-o`, a text rendering is printed. |
| `--symbology <id>` | `-t` | Symbology id or alias. Default `qr`. |
| `--scale <n>` | | Module size in pixels. Default `4`. |
| `--ec <level>` | | Error correction: `L`, `M`, `Q`, `H` for QR, or a percentage for Aztec and PDF417. |
| `--gs1` | | Encode as GS1. Pass the data in HRI form, `(01)...(10)...`. |
| `--hrt` | | Print the human-readable text under linear barcodes. |
| `--no-margin` | | Leave out the quiet zone. |
| `--fg <color>` | | Bar color. Default `#000000`. |
| `--bg <color>` | | Background color or `transparent`. Default `#ffffff`. |

`--fg` and `--bg` apply to SVG and PNG output alike. See [Barcode generation](../barcode-generation/) for what each symbology accepts.

## parse

```bash
qrgen parse "WIFI:T:WPA;S:Office;P:correct horse;;"
```

```json
{
  "type": "wifi",
  "ssid": "Office",
  "password": "correct horse",
  "security": "WPA",
  "hidden": false
}
```

Works for every [content type](../parsers/#parsecontent): URLs, contacts, GS1 element strings, product codes and more. Pass `--symbology` (`-t`) when you know where the text came from, for example `qrgen parse 01234565 -t upce` expands a UPC-E to its GTIN.

## serve

```bash
qrgen serve --port 8080 --host 0.0.0.0
```

```text
qrgen REST API listening on http://0.0.0.0:8080  (GET /health)
```

| Flag | Short | Default | Description |
| --- | --- | --- | --- |
| `--port <n>` | `-p` | `$PORT` or `8080` | Port to listen on. |
| `--host <addr>` | | `$HOST` or `0.0.0.0` | Interface to bind. Use `127.0.0.1` to accept local connections only. |

The server logs one line per request and shuts down cleanly on `SIGINT` and `SIGTERM`. Endpoints are documented in [REST API & Docker](../rest-api/).

## symbologies

```bash
qrgen symbologies
```

```text
qr                 QR Code                  read/write
micro-qr           Micro QR Code            read/write
rmqr               rMQR Code                read/write
data-matrix        Data Matrix              read/write
...
```

`qrgen symbologies --json` prints the full table, including zxing-cpp format names and aliases.

## Examples

Rename scanned documents by the QR code they carry:

```bash
for f in scans/*.jpg; do
  code=$(qrgen scan "$f" -s qr --json | jq -r '.[0].data // empty')
  [ -n "$code" ] && mv "$f" "scans/${code//[^A-Za-z0-9._-]/_}.jpg"
done
```

Generate a sheet of asset labels from a CSV (`id,name`):

```bash
tail -n +2 assets.csv | while IFS=, read -r id name; do
  qrgen generate "https://assets.example.com/$id" -o "labels/$id.svg" --ec M
done
```

Check in CI that a printed label still decodes to the expected value:

```bash
test "$(qrgen scan build/label.png --json | jq -r '.[0].data')" = "https://example.com/p/42"
```
