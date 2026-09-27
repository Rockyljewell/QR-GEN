---
title: "REST API & Docker"
description: "Scan, generate and parse barcodes from any language over HTTP with qrgen serve or the Docker image: endpoints, curl examples, errors, CORS, framework mounting and client code."
group: "Server & Linux"
order: 3
label: REST API
status: stable
---

QRGen includes a small HTTP server that exposes scanning, generation and parsing as a REST API. Run it with `qrgen serve`, with Docker, or mount it inside your own Node.js app. Any language that can send an HTTP request can then decode barcodes in images and create barcode images.

The server processes images on the machine it runs on and stores nothing.

## Run the server

### Docker

```bash
docker run --rm -p 8080:8080 ghcr.io/rockyljewell/qr-gen:latest
```

```bash
curl http://localhost:8080/health
```

```json
{ "ok": true, "name": "qrgen", "version": "1.0.0", "docs": "https://rockyljewell.github.io/QR-GEN/docs/rest-api/" }
```

The image is built from the repository's root `Dockerfile` and runs `qrgen serve` on port 8080. To build it yourself:

```bash
git clone https://github.com/Rockyljewell/QR-GEN.git
cd QR-GEN
docker build -t qrgen .
docker run --rm -p 8080:8080 qrgen
```

With Docker Compose:

```yaml
# compose.yaml
services:
  qrgen:
    image: ghcr.io/rockyljewell/qr-gen:latest
    ports:
      - "8080:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Other services in the same Compose project reach it at `http://qrgen:8080`.

### Node.js

```bash
npx qrgen-sdk serve --port 8080
```

> **Note:** Until the first npm release is published, install the latest build with `npm install https://rockyljewell.github.io/QR-GEN/downloads/qrgen-sdk.tgz` and run `npx qrgen serve`.

`--host` sets the interface (default `0.0.0.0`), and the `PORT` and `HOST` environment variables are used when the flags are absent. See [CLI](../cli/#serve).

> **Warning:** The API has no authentication or rate limiting. Keep it on a private network, or put it behind a reverse proxy or API gateway that adds them, before exposing it to the internet.

## Endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/health` (also `/`) | | `{ ok, name, version, docs }` |
| `GET` | `/v1/symbologies` | | `{ read: [...], write: [...], details: [{ id, name, kind, aliases }] }` |
| `POST` | `/v1/scan` | Raw image bytes, `multipart/form-data`, or JSON with base64 | `{ barcodes: [...] }` |
| `GET` | `/v1/generate` | Options in the query string | Image bytes |
| `POST` | `/v1/generate` | Options as a JSON body | Image bytes |
| `POST` | `/v1/parse` | JSON `{ "data": "..." }` or raw text | `ParsedContent` |

## Scan

`POST /v1/scan` accepts the image in three ways. The server reads PNG, JPEG, GIF and BMP.

**Raw bytes.** Send the file as the body with any image content type:

```bash
curl --data-binary @photo.jpg -H 'content-type: image/jpeg' http://localhost:8080/v1/scan
```

**Multipart.** The first file part is used (or a field named `image` or `file`). An optional `symbologies` field limits the search:

```bash
curl -F image=@photo.jpg http://localhost:8080/v1/scan
curl -F image=@photo.jpg -F symbologies=qr,ean13 http://localhost:8080/v1/scan
```

**JSON.** `image` is base64 or a data URL. Build the body in a file, because base64 images quickly exceed the shell's argument length limit:

```bash
printf '{"image":"%s","symbologies":["qr"]}' "$(base64 < photo.jpg | tr -d '\n')" > body.json
curl -H 'content-type: application/json' --data-binary @body.json http://localhost:8080/v1/scan
```

Options can go in the query string for every body type, or in the JSON body:

| Option | Default | Description |
| --- | --- | --- |
| `symbologies` | all | Comma-separated in the query (`?symbologies=qr,ean13`), an array or string in JSON. |
| `tryHarder` | `true` | `false` is faster on clean, high-contrast images. |
| `parse` | `true` | Add a `parsed` field (from [`parseContent()`](../parsers/)) to each result. |

Booleans in the query string accept `true`/`false`, `1`/`0`, `yes`/`no` and `on`/`off`.

Response:

```json
{
  "barcodes": [
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
}
```

Each entry is a [Barcode](../concepts/#the-barcode-result). An image without codes returns `200` with `{ "barcodes": [] }`.

## Generate

`GET /v1/generate` takes options in the query string, which makes it usable directly as an image URL:

```bash
curl -o qr.svg "http://localhost:8080/v1/generate?data=https%3A%2F%2Fexample.com&symbology=qr"
curl -o qr.png "http://localhost:8080/v1/generate?data=hello&format=png&scale=8&ecLevel=H"
```

```html
<img src="http://localhost:8080/v1/generate?data=5901234123457&symbology=ean13&hrt=1" alt="EAN-13 barcode" />
```

`POST /v1/generate` takes the same options as JSON, which is easier for long or binary-looking data:

```bash
curl -o label.png -H 'content-type: application/json' \
  -d '{"data": "(01)09501101530003(17)250101(10)ABC123", "symbology": "code128", "gs1": true, "hrt": true, "format": "png", "scale": 3}' \
  http://localhost:8080/v1/generate
```

| Option | Default | Description |
| --- | --- | --- |
| `data` | required | The text to encode (`text` and `value` are accepted as aliases). |
| `symbology` | `qr` | Any [writable symbology](../symbologies/). |
| `format` | `svg` | `svg` (`image/svg+xml`), `png` (`image/png`) or `txt` (`text/plain` text rendering). |
| `scale` | `4` | Module size in pixels. |
| `ecLevel` | encoder default | Error correction (`ec` is accepted too): `L`, `M`, `Q`, `H` for QR. |
| `gs1` | `false` | Encode as GS1; `data` in HRI form `(01)...`. |
| `hrt` | `false` | Human-readable text under linear barcodes. |
| `margin` | `true` | Quiet zone. |
| `foreground`, `background` | `#000000`, `#ffffff` | Colors for SVG and PNG output (`background` may be `transparent`). |
| `rotate` | `0` | `0`, `90`, `180` or `270`. |

Remember to URL-encode query values: `#` in colors becomes `%23`, `(` and `)` in GS1 data are safe.

## Parse

```bash
curl -H 'content-type: application/json' -d '{"data": "WIFI:T:WPA;S:Office;P:secret;;"}' http://localhost:8080/v1/parse
```

```json
{ "type": "wifi", "ssid": "Office", "password": "secret", "security": "WPA", "hidden": false }
```

A body that isn't JSON is parsed as raw text, so `curl --data-binary 'tel:+15551234567' http://localhost:8080/v1/parse` works too. The response is a [`ParsedContent`](../parsers/) object.

## Errors

Errors return a 4xx or 5xx status with a JSON body:

```json
{ "error": { "code": "bad-request", "message": "Cannot encode as EAN-13: Invalid character at position 1 in input (digits and \"+\" or space only)" } }
```

| Status | `code` | Cause |
| --- | --- | --- |
| 400 | `bad-request` | Invalid JSON, missing `data` or `image`, an empty image, an unknown symbology, or data the symbology can't encode. |
| 400 | `unsupported` | The requested operation isn't available for that symbology. |
| 404 | `not-found` | Unknown path or method. |
| 413 | `payload-too-large` | The body is larger than `maxBodyBytes` (15 MiB by default). |
| 500 | `engine-load-failed` | The engine couldn't be loaded (for example, the wasm files are missing from the deployment). |
| 500 | `unknown` | Anything else. |

## CORS

The server sends `Access-Control-Allow-Origin: *`, allows `GET`, `POST` and `OPTIONS` with a `Content-Type` header, and answers preflight `OPTIONS` requests with `204`. Browser apps on any origin can call it. To restrict or disable CORS, create the server in code (below) with the `cors` option.

## Mount in your own server

`qrgen-sdk/server` exports `createServer(options)`, which returns a Node `http.Server`, and `createHandler(options)`, which returns a `(req, res)` handler for any framework built on Node's HTTP module.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxBodyBytes` | `number` | `15728640` (15 MiB) | Largest accepted request body. |
| `cors` | `string \| false` | `"*"` | `Access-Control-Allow-Origin` value, or `false` to send no CORS headers. |
| `log` | `boolean` | `false` | Log one line per request to the console. |

### Plain Node.js

```js
import { createServer } from "qrgen-sdk/server";

createServer({ cors: "https://app.example.com", maxBodyBytes: 5 * 1024 * 1024, log: true }).listen(8080);
```

### Express

Mount the handler under a prefix. It reads the raw request body itself, and it also works after `express.json()` or `express.raw()` (it uses `req.body` when a parser already consumed the stream). Mount it before multipart parsers such as multer, which move the file out of the body.

```js
import express from "express";
import { createHandler } from "qrgen-sdk/server";

const app = express();

app.use("/qrgen", createHandler({ maxBodyBytes: 10 * 1024 * 1024 }));

app.use(express.json());
app.post("/api/orders", (req, res) => res.json({ ok: true }));

app.listen(3000); // POST http://localhost:3000/qrgen/v1/scan
```

### Fastify

Fastify parses bodies before handlers run. Register the handler in an encapsulated plugin that leaves bodies unread, then hand the raw request over:

```js
import Fastify from "fastify";
import { createHandler } from "qrgen-sdk/server";

const app = Fastify();
const qrgen = createHandler();

app.register(
  async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, _payload, done) => done(null));
    scope.all("/*", (request, reply) => {
      reply.hijack();
      request.raw.url = request.raw.url.slice("/qrgen".length) || "/";
      qrgen(request.raw, reply.raw);
    });
  },
  { prefix: "/qrgen" }
);

await app.listen({ port: 3000 });
```

The content-type parser change only applies inside the plugin, so the rest of your Fastify routes keep their normal body parsing.

### Hono on Node.js

With `@hono/node-server`, route the prefix to QRGen at the Node level and everything else to Hono:

```js
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createHandler } from "qrgen-sdk/server";

const app = new Hono();
app.get("/", (c) => c.text("Hello"));

const hono = getRequestListener(app.fetch);
const qrgen = createHandler();

createServer((req, res) => {
  if (req.url === "/qrgen" || req.url?.startsWith("/qrgen/")) {
    req.url = req.url.slice("/qrgen".length) || "/";
    return qrgen(req, res);
  }
  return hono(req, res);
}).listen(3000);
```

The handler needs Node's `IncomingMessage` and `ServerResponse`, so it doesn't run on edge runtimes such as Cloudflare Workers.

## Clients

Every example sends a JPEG as raw bytes to `/v1/scan` and prints each result.

### Python

With [requests](https://requests.readthedocs.io/):

```python
import requests

BASE = "http://localhost:8080"

with open("photo.jpg", "rb") as f:
    r = requests.post(f"{BASE}/v1/scan", params={"symbologies": "qr,ean13"}, data=f, headers={"Content-Type": "image/jpeg"})
r.raise_for_status()
for b in r.json()["barcodes"]:
    print(b["symbology"], b["data"])

png = requests.get(f"{BASE}/v1/generate", params={"data": "https://example.com", "format": "png", "scale": 8})
png.raise_for_status()
with open("qr.png", "wb") as out:
    out.write(png.content)
```

To decode locally in Python without a server, use the [Python SDK](../python/).

### Go

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
)

type Barcode struct {
	Data          string `json:"data"`
	Symbology     string `json:"symbology"`
	SymbologyName string `json:"symbologyName"`
}

func main() {
	f, err := os.Open("photo.jpg")
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()

	resp, err := http.Post("http://localhost:8080/v1/scan?symbologies=qr,ean13", "image/jpeg", f)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Fatalf("scan failed: %s", resp.Status)
	}

	var result struct {
		Barcodes []Barcode `json:"barcodes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Fatal(err)
	}
	for _, b := range result.Barcodes {
		fmt.Printf("%s: %s\n", b.SymbologyName, b.Data)
	}
}
```

### Java

With the built-in `java.net.http.HttpClient` (Java 11+). Parse the JSON with the library you already use, such as Jackson or Gson:

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;

public class ScanExample {
  public static void main(String[] args) throws Exception {
    HttpClient client = HttpClient.newHttpClient();

    HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:8080/v1/scan?symbologies=qr,ean13"))
        .header("Content-Type", "image/jpeg")
        .POST(HttpRequest.BodyPublishers.ofFile(Path.of("photo.jpg")))
        .build();

    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() != 200) throw new RuntimeException("Scan failed: " + response.body());
    System.out.println(response.body()); // {"barcodes":[...]}
  }
}
```

### C#

With `HttpClient` and `System.Net.Http.Json` (.NET 6+):

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;

using var http = new HttpClient { BaseAddress = new Uri("http://localhost:8080") };

using var content = new ByteArrayContent(await File.ReadAllBytesAsync("photo.jpg"));
content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");

using var response = await http.PostAsync("/v1/scan?symbologies=qr,ean13", content);
response.EnsureSuccessStatusCode();

var result = await response.Content.ReadFromJsonAsync<ScanResult>();
foreach (var b in result!.Barcodes)
    Console.WriteLine($"{b.SymbologyName}: {b.Data}");

record Barcode(string Data, string Symbology, string SymbologyName);
record ScanResult(List<Barcode> Barcodes);
```

For on-device scanning in .NET apps, see the [.NET SDK](../dotnet/).

### PHP

With the curl extension, as a multipart upload:

```php
<?php
$ch = curl_init("http://localhost:8080/v1/scan?symbologies=qr,ean13");
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => ["image" => new CURLFile("photo.jpg", "image/jpeg")],
    CURLOPT_RETURNTRANSFER => true,
]);
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($body === false || $status !== 200) {
    throw new RuntimeException("Scan failed ($status): $body");
}

foreach (json_decode($body, true)["barcodes"] as $b) {
    echo $b["symbologyName"], ": ", $b["data"], PHP_EOL;
}
```

### Ruby

With `Net::HTTP` from the standard library:

```ruby
require "json"
require "net/http"

uri = URI("http://localhost:8080/v1/scan?symbologies=qr,ean13")
request = Net::HTTP::Post.new(uri, "Content-Type" => "image/jpeg")
request.body = File.binread("photo.jpg")

response = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(request) }
raise "Scan failed (#{response.code}): #{response.body}" unless response.is_a?(Net::HTTPSuccess)

JSON.parse(response.body)["barcodes"].each do |b|
  puts "#{b["symbologyName"]}: #{b["data"]}"
end
```

## Deployment tips

- **Sizing.** Decoding is CPU-bound and single-threaded per process. For more throughput, run several containers (or processes) behind a load balancer rather than a bigger single instance.
- **Image size.** Phone photos decode faster when downscaled to about 2000 px on the long side before upload.
- **Timeouts.** Most scans complete in well under a second. Set client timeouts of a few seconds to cover large images with `tryHarder`.
- **Health checks.** Use `GET /health`.
