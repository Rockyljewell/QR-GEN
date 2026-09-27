# REST API (any language)

Run it:

```bash
docker run -p 8080:8080 ghcr.io/rockyljewell/qr-gen:latest
# or
npx qrgen serve --port 8080
```

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/health` | | `{ ok, version }` |
| GET | `/v1/symbologies` | | `{ read, write, details }` |
| POST | `/v1/scan` | image bytes (`Content-Type: image/*`), multipart (`-F image=@file`) or JSON `{ image: base64, symbologies?, tryHarder? }`; `?symbologies=qr,ean13` | `{ barcodes: [Barcode & { parsed }] }` |
| GET/POST | `/v1/generate` | `data`, `symbology`, `format` (`svg`/`png`/`txt`), `scale`, `ecLevel`, `gs1`, `hrt`, `margin`, `foreground`, `background` | image |
| POST | `/v1/parse` | `{ data }` | parsed content |

Errors: `{ "error": { "code": "bad-request", "message": "…" } }`. CORS is open (`*`).

```bash
curl -s -X POST --data-binary @label.jpg -H "content-type: image/jpeg" http://localhost:8080/v1/scan
curl -s -F image=@label.jpg http://localhost:8080/v1/scan
curl -s "http://localhost:8080/v1/generate?data=hello&symbology=qr&format=png" -o qr.png
```

Python:

```python
import requests
r = requests.post("http://localhost:8080/v1/scan", data=open("label.jpg", "rb"), headers={"content-type": "image/jpeg"})
print([b["data"] for b in r.json()["barcodes"]])
```

Go:

```go
f, _ := os.Open("label.jpg")
resp, _ := http.Post("http://localhost:8080/v1/scan", "image/jpeg", f)
```

Java (11+):

```java
var req = HttpRequest.newBuilder(URI.create("http://localhost:8080/v1/scan"))
    .header("content-type", "image/jpeg").POST(HttpRequest.BodyPublishers.ofFile(Path.of("label.jpg"))).build();
var body = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString()).body();
```

PHP:

```php
$ch = curl_init("http://localhost:8080/v1/scan");
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => file_get_contents("label.jpg"),
  CURLOPT_HTTPHEADER => ["content-type: image/jpeg"], CURLOPT_RETURNTRANSFER => true]);
$result = json_decode(curl_exec($ch), true);
```

C#: use `QRGen.Net`'s `QRGenClient` (see [dotnet.md](dotnet.md)) or `HttpClient.PostAsync` with a
`ByteArrayContent`.
