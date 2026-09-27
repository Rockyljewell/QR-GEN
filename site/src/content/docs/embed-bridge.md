---
title: Embed bridge
description: "Run the QRGen scanner in any WebView or iframe with the hosted embed page, its message bridge and host commands, or self-host it with qrgen-sdk/bridge."
group: Features
order: 7
---

The embed page is a full-screen QRGen scanner that any app with a WebView can load: React Native, Flutter, native iOS and Android, .NET MAUI and WinUI, Titanium, Unity, or an `<iframe>` on another website. The page scans; your app receives the results as JSON messages and can send commands back. No QRGen code runs in your app.

```text
https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single
```

The page is served over HTTPS, so it can use the camera in any WebView that supports `getUserMedia`, as long as your app grants camera permission (see the host examples below). It loads the decoder from the same origin, so the WebView only needs access to `rockyljewell.github.io`. The [React Native](../react-native/) and [Flutter](../flutter/) packages wrap this for you.

## Query options

The query string takes the [scanner options](../options-events/#scanner-options). Lists are comma-separated, and booleans accept `1`/`0` or `true`/`false`.

| Parameter | Example | Description |
| --- | --- | --- |
| `symbologies` | `qr,ean13` | Ids, aliases or groups. Default: all. |
| `mode` | `continuous` | `single`, `continuous` or `batch`. The hosted page defaults to `single`. |
| `duplicateFilter` | `2000` | Milliseconds; `0` every frame, `-1` once per session. |
| `beep`, `vibrate` | `0` | Feedback on scan. Default on. |
| `camera` | `front` | `back`, `front` or a device id. |
| `torch` | `1` | Turn the torch on when supported. |
| `viewfinder` | `line` | `frame`, `line` or `none`. |
| `scanArea` | `0.1,0.3,0.8,0.4` | Normalized `x,y,width,height`. |
| `maxResults` | `5` | Codes per frame. |
| `tryHarder` | `1` | More effort per frame. |
| `resolution` | `fhd` | `sd`, `hd`, `fhd` or `4k`. |
| `accent` | `%23ff6b35` | Accent color. URL-encode `#` as `%23`. |
| `hint` | `Scan%20your%20ticket` | Instruction text. Empty hides it. |
| `controls` | `none` | Hide the built-in buttons. |
| `autostart` | `0` | Wait for a `start` command instead of opening the camera immediately. |

Kebab-case names (`duplicate-filter`, `scan-area`, `max-results`, `try-harder`) work too. Add `debug=1` to show an on-screen log of the detected host channels and every event, which helps when wiring up a new host. Opened directly in a browser, with no host channel, the page also shows a short note explaining how to embed it.

## Message envelope

The page posts every event as a message with this envelope:

```json
{ "source": "qrgen", "version": 1, "type": "scan", "barcodes": [] }
```

| `type` | Extra fields | When |
| --- | --- | --- |
| `ready` | `engine` (`"worker"` or `"main"`) | The camera is open and scanning started. |
| `scan` | `barcodes`: [Barcode](../concepts/#the-barcode-result)[] | New codes passed the duplicate filter. |
| `track` | `tracked`: TrackedBarcode[] | Batch mode, after every decoded frame. |
| `select` | `barcode`, `selected`, `selection` | Batch mode tap-to-select. |
| `state` | `state` | `idle`, `starting`, `scanning`, `paused`, `stopped`, `error`. |
| `error` | `code`, `message` | Starting failed. See [error codes](../options-events/#error-codes). |

Always check `source === "qrgen"` before handling a message; other scripts in the page may post messages too. `parseBridgeMessage()` does this for you (see below).

## Host channels

The page posts each message to every channel it finds, so the same page works in every host:

| Host | Channel in the page | What the host receives |
| --- | --- | --- |
| React Native (`react-native-webview`) | `window.ReactNativeWebView.postMessage(json)` | `onMessage` event, `nativeEvent.data` is the JSON string |
| Flutter (`webview_flutter`) | `window.QRGenBridge.postMessage(json)` | A `JavaScriptChannel` named `QRGenBridge` |
| iOS / macOS `WKWebView` | `window.webkit.messageHandlers.qrgen.postMessage(json)` | A `WKScriptMessageHandler` registered as `qrgen` |
| Windows WebView2, .NET MAUI on Windows | `window.chrome.webview.postMessage(json)` | `WebMessageReceived`, `TryGetWebMessageAsString()` |
| Android `WebView` | `window.QRGenAndroid.postMessage(json)` | A `@JavascriptInterface` object added as `QRGenAndroid` |
| `<iframe>` | `window.parent.postMessage(object, "*")` | A `message` event on the parent window; `event.data` is an object |
| Popup | `window.opener.postMessage(object, "*")` | A `message` event on the opener |

Native channels receive the message as a JSON string; iframe and popup hosts receive an object.

## Host-to-page commands

Control the scanner by calling `window.qrgen.command(command)` through your WebView's JavaScript evaluation API (`evaluateJavaScript`, `evaluateJavascript`, `ExecuteScriptAsync`, `injectJavaScript`, `runJavaScript`), or by posting `{ source: "qrgen-host", ...command }` into the page (iframes, React Native `postMessage`, Android `postWebMessage`).

| Command | Effect |
| --- | --- |
| `{ "type": "start" }` | Start the camera (after `autostart=0` or `stop`). |
| `{ "type": "stop" }` | Stop and release the camera. |
| `{ "type": "pause" }` | Stop decoding, keep the preview. |
| `{ "type": "resume" }` | Continue, for example after a `single` mode scan. |
| `{ "type": "torch" }` | Toggle the torch. With `"value": true` or `false`, set it. |
| `{ "type": "switchCamera" }` | Switch between front and back cameras. |
| `{ "type": "zoom", "value": 2 }` | Set the zoom factor. |
| `{ "type": "options", "value": { "mode": "batch", "symbologies": "qr" } }` | Set element attributes (kebab-case names, string values) at runtime. |

```js
// From a WebView evaluation API:
window.qrgen.command({ type: "torch", value: true });

// From an iframe host:
iframe.contentWindow.postMessage({ source: "qrgen-host", type: "resume" }, "https://rockyljewell.github.io");
```

`window.qrgen.channels` lists the host channels the page detected, which helps when debugging.

## Host examples

### iframe

```html
<iframe
  id="scanner"
  src="https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single"
  allow="camera"
  style="width: 100%; height: 480px; border: 0"
></iframe>
<button id="again">Scan again</button>

<script>
  const ORIGIN = "https://rockyljewell.github.io";
  const frame = document.getElementById("scanner");

  window.addEventListener("message", (event) => {
    if (event.origin !== ORIGIN || event.data?.source !== "qrgen") return;
    if (event.data.type === "scan") console.log(event.data.barcodes[0].data);
    if (event.data.type === "error") console.warn(event.data.code, event.data.message);
  });

  document.getElementById("again").addEventListener("click", () => {
    frame.contentWindow.postMessage({ source: "qrgen-host", type: "resume" }, ORIGIN);
  });
</script>
```

`allow="camera"` is required for a cross-origin iframe to use the camera, and the parent page must itself be a secure context. On your own site, the [web components](../web-components/) are simpler than an iframe; the embed page is useful when you can't add scripts to the host page.

### iOS (WKWebView)

Add `NSCameraUsageDescription` to `Info.plist`, then:

```swift
import UIKit
import WebKit

final class ScannerViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate {
    private var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(self, name: "qrgen")

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.uiDelegate = self
        view.addSubview(webView)
        webView.load(URLRequest(url: URL(string: "https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single")!))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let json = message.body as? String,
              let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              object["source"] as? String == "qrgen" else { return }
        if object["type"] as? String == "scan",
           let barcode = (object["barcodes"] as? [[String: Any]])?.first,
           let data = barcode["data"] as? String {
            print("Scanned", data)
        }
    }

    // iOS 15+: grant the page's camera request for this origin without WebKit's extra prompt.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "rockyljewell.github.io" ? .grant : .prompt)
    }

    func send(_ commandJSON: String) {
        webView.evaluateJavaScript("window.qrgen && window.qrgen.command(\(commandJSON))")
    }
}
```

`WKUserContentController` retains its handlers; remove the `qrgen` handler when you dismiss the scanner. For a native scanner without a WebView, see the [iOS SDK](../ios/).

### Android (WebView)

Declare `<uses-permission android:name="android.permission.CAMERA" />` in the manifest, then:

```kotlin
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject

class ScannerActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val url = "https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.addJavascriptInterface(Bridge(), "QRGenAndroid")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsCamera = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                if (wantsCamera && hasCameraPermission()) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                else request.deny()
            }
        }

        if (hasCameraPermission()) webView.loadUrl(url)
        else requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        webView.loadUrl(url) // the page shows camera-permission-denied if the user refused
    }

    private fun hasCameraPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    fun command(json: String) = webView.evaluateJavascript("window.qrgen && window.qrgen.command($json)", null)

    inner class Bridge {
        @JavascriptInterface
        fun postMessage(json: String) {
            val message = JSONObject(json)
            if (message.optString("source") != "qrgen") return
            if (message.optString("type") == "scan") {
                val data = message.getJSONArray("barcodes").getJSONObject(0).getString("data")
                runOnUiThread { Toast.makeText(this@ScannerActivity, data, Toast.LENGTH_SHORT).show() }
            }
        }
    }
}
```

`@JavascriptInterface` methods run on a background thread; switch to the main thread before touching views. For a native scanner, see the [Android SDK](../android/).

### Windows (WebView2, WinUI and WPF)

```csharp
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

await webView.EnsureCoreWebView2Async();

webView.CoreWebView2.PermissionRequested += (_, e) =>
{
    if (e.PermissionKind == CoreWebView2PermissionKind.Camera && new Uri(e.Uri).Host == "rockyljewell.github.io")
        e.State = CoreWebView2PermissionState.Allow;
};

webView.CoreWebView2.WebMessageReceived += (_, e) =>
{
    using var doc = JsonDocument.Parse(e.TryGetWebMessageAsString());
    var root = doc.RootElement;
    if (root.GetProperty("source").GetString() != "qrgen") return;
    if (root.GetProperty("type").GetString() == "scan")
        Console.WriteLine(root.GetProperty("barcodes")[0].GetProperty("data").GetString());
};

webView.CoreWebView2.Navigate("https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single");

// Commands
await webView.CoreWebView2.ExecuteScriptAsync("window.qrgen && window.qrgen.command({ type: 'pause' })");
```

Send commands with `ExecuteScriptAsync`, or post them with `PostWebMessageAsJson("{\"source\":\"qrgen-host\",\"type\":\"pause\"}")`. The bridge listens on `window.chrome.webview` too. For .NET MAUI on every platform, see the [.NET SDK](../dotnet/).

### React Native and Flutter

The [React Native package](../react-native/) includes `QRGenWebScanner`, which wraps the embed page in `react-native-webview`, and the [Flutter package](../flutter/) covers `webview_flutter`. Their guides show the setup, including camera permissions.

## Self-host the embed page

Host your own copy to pin the SDK version, work offline inside an app bundle served over HTTPS, change the look, or avoid a third-party origin. The page is a `<qrgen-scanner>` element configured from the query string and connected to the bridge:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Scanner</title>
    <style>
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
      qrgen-scanner { position: fixed; inset: 0; height: 100%; }
    </style>
  </head>
  <body>
    <script type="module">
      import { attributesFromQuery, configure, connectBridge } from "./qrgen.js"; // dist/browser/qrgen.js

      configure({ wasmBaseUrl: "./wasm/" }); // zxing_reader.wasm next to the page

      const scanner = document.createElement("qrgen-scanner");
      for (const [name, value] of Object.entries(attributesFromQuery(location.search))) {
        scanner.setAttribute(name, value);
      }
      connectBridge(scanner); // forward events to the host, accept commands
      document.body.append(scanner);
    </script>
  </body>
</html>
```

Copy `node_modules/qrgen-sdk/dist/browser/qrgen.js` next to the page and the wasm files into `wasm/`. Serve it over HTTPS (or from `https://localhost` in app shells like Capacitor). Call `connectBridge()` before adding the element to the page so no early event is missed.

With a bundler, import from the npm entry points instead:

```js
import "qrgen-sdk/elements";
import { attributesFromQuery, connectBridge } from "qrgen-sdk/bridge";
```

## qrgen-sdk/bridge

| Export | Signature | Description |
| --- | --- | --- |
| `connectBridge` | `(element, window?) => () => void` | Forwards the element's `ready`, `scan`, `track`, `select`, `statechange` and `error` events to every host channel, defines `window.qrgen.command()` and listens for `{ source: "qrgen-host" }` messages on `window` and `document`. Returns a function that disconnects everything. |
| `parseBridgeMessage` | `(data: unknown) => BridgeMessage \| null` | Parses a message from the page (a JSON string or an object). Returns `null` unless it is a QRGen message. Use it in hosts. |
| `postToHost` | `(message: BridgeMessage, window?) => void` | Sends a message to every host channel in the window. |
| `detectChannels` | `(window?) => string[]` | Which host channels exist: `react-native`, `flutter`, `wkwebview`, `webview2`, `android`, `iframe`, `opener`. |
| `attributesFromQuery` | `(search: string) => Record<string, string>` | Maps an embed query string to `<qrgen-scanner>` attributes (camelCase and kebab-case names, `1`/`0` to `true`/`false`). Unknown parameters are ignored. |

`BridgeMessage` and `BridgeCommand` are exported as TypeScript types. A typed host handler for an iframe or a JavaScript-based WebView host:

```ts
import { parseBridgeMessage, type BridgeMessage } from "qrgen-sdk/bridge";

function onHostMessage(raw: unknown) {
  const message: BridgeMessage | null = parseBridgeMessage(raw);
  if (!message) return;
  switch (message.type) {
    case "scan":
      console.log(message.barcodes.map((b) => b.data));
      break;
    case "error":
      console.warn(message.code, message.message);
      break;
  }
}

window.addEventListener("message", (event) => onHostMessage(event.data));
```
