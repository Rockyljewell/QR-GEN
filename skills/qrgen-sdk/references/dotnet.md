# .NET, MAUI and Xamarin: QRGen.Net

`QRGen.Net` (netstandard2.0 + net8.0): parsers, a REST client, local encode/decode with ZXing.Net, embed
helpers, and a .NET MAUI camera scanner page (in `packages/dotnet/src/QRGen.Maui`).

## Install

Until it is on NuGet, pack it from the repo:

```bash
git clone https://github.com/Rockyljewell/QR-GEN.git
cd QR-GEN/packages/dotnet
dotnet pack src/QRGen.Net -c Release -o ./nupkg
dotnet add <your project> package QRGen.Net --source ./nupkg
```

## Use

```csharp
using QRGen;

var gs1 = Gs1Parser.Parse("(01)09501101530003(17)250101(10)ABC123");   // gs1["01"], gs1.Elements[1].Date
var license = AamvaParser.Parse(pdf417Text, today: DateTime.Today);    // license?.IsUnder21
var content = ContentParser.Parse("WIFI:T:WPA;S:Home;P:secret;;");     // content.Type == "wifi"

string svg = QRGenLocal.Generate("https://example.com");
byte[] png = QRGenLocal.GeneratePng("hello", new GenerateOptions { Scale = 8 });
var found = QRGenLocal.Decode(bgraBytes, width, height, PixelFormat.Bgra32);

using var client = new QRGenClient("http://localhost:8080");           // REST: all 26 symbologies
var codes = await client.ScanAsync(File.ReadAllBytes("shelf.jpg"), new[] { "retail", "qr" });
```

Local decoding (ZXing.Net) covers qr, data-matrix, aztec, pdf417, maxicode, EAN/UPC, code128/39/93,
codabar, ITF, DataBar. For Micro QR, rMQR, GS1 Data Matrix output and the rest, use `QRGenClient`.

## .NET MAUI camera scanner

```csharp
// MauiProgram.cs
builder.UseMauiApp<App>().UseQRGen();

var barcode = await QRGenScannerPage.ScanOnceAsync(Navigation, new EmbedOptions { Symbologies = { "qr", "ean13" } });
```

It hosts the QRGen web scanner in a WebView (WebView2, WKWebView, Android WebView). Permissions:
Android `CAMERA`, iOS/Mac Catalyst `NSCameraUsageDescription` (+ camera entitlement), Windows
`<DeviceCapability Name="webcam" />`. Status: shared code compiles; platform handlers need a device test.

## Xamarin

Xamarin reached end of support in May 2024. Migrate to MAUI (`QRGenScannerPage`), or use `QRGen.Net`
(netstandard2.0) in the Xamarin app for parsing, local decode and the REST client.
