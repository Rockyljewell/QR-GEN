---
title: Credit and attribution
description: "How to credit QRGen when you use it: what the Apache License 2.0 requires, where the NOTICE goes on each platform, a Powered by QRGen badge and how to cite the project."
group: Reference
order: 7
label: Credit and attribution
---

QRGen was created by [Rockyljewell](https://github.com/Rockyljewell) and is free to use under the
[Apache License 2.0](https://github.com/Rockyljewell/QR-GEN/blob/main/LICENSE), including in commercial
and closed-source products. In return, the license asks you to keep the credit attached when you ship it.

> Tip: This page is a plain-language summary. The [LICENSE](https://github.com/Rockyljewell/QR-GEN/blob/main/LICENSE) text is what applies.

## What the license requires

When you distribute QRGen, or anything that includes it (an app, a website bundle, a Docker image, a fork):

1. **Include the license.** Ship a copy of the Apache License 2.0 with your product.
2. **Include the NOTICE.** Put the text of QRGen's [NOTICE](https://github.com/Rockyljewell/QR-GEN/blob/main/NOTICE)
   file wherever your product shows third-party notices: an "Acknowledgements" or "Open-source licenses"
   screen, a `THIRD_PARTY_NOTICES` file, your documentation, or your own NOTICE file.
3. **Keep the headers.** Every QRGen source file starts with a copyright and license header, and the built
   SDK files start with a `/*! QRGen … */` banner. Leave them in place.
4. **Mark your changes.** If you modify QRGen files, say so in the files you changed.

You don't need to show QRGen in your app's main UI, pay anything or ask permission.

## The NOTICE text

Copy this into your notices file or licenses screen:

```text
QRGen
Copyright 2026 Rockyljewell
Apache License 2.0
https://github.com/Rockyljewell/QR-GEN
```

## Where it goes on each platform

| Platform | Where to put the notice |
| --- | --- |
| Web (npm, CDN) | Your site's third-party notices or licenses page. Common bundlers keep `/*!` comments by default, or move them into a separate license file; don't configure them to drop legal comments. |
| iOS / macOS | An Acknowledgements screen or the Settings bundle. CocoaPods generates an acknowledgements file for you; with Swift Package Manager, add QRGenKit to it yourself. |
| Android | The open-source licenses screen, for example with Google's `oss-licenses-plugin`, which reads the Apache-2.0 license from the QRGen POM. |
| React Native | Your licenses screen or notices file, for example generated from your dependencies with `license-checker`. |
| Flutter | `showLicensePage()` lists QRGen automatically, because Flutter collects each package's LICENSE file. |
| .NET / MAUI | Your `THIRD-PARTY-NOTICES.txt` or About page. The NuGet package carries the Apache-2.0 license expression. |
| Python | Your notices file. The wheel includes QRGen's LICENSE and NOTICE. |
| Docker / REST API | The image contains the license and NOTICE; keep them if you build your own image from it. |

## Say thanks with a badge (optional)

A visible credit isn't required, but it helps other developers find the project.

<a href="https://github.com/Rockyljewell/QR-GEN"><img src="../../badges/powered-by-qrgen.svg" alt="Powered by QRGen" width="146" height="20"></a>

Markdown, for a README:

```md
[![Powered by QRGen](https://rockyljewell.github.io/QR-GEN/badges/powered-by-qrgen.svg)](https://github.com/Rockyljewell/QR-GEN)
```

HTML, for a website footer or an About page:

```html
<a href="https://github.com/Rockyljewell/QR-GEN"><img src="https://rockyljewell.github.io/QR-GEN/badges/powered-by-qrgen.svg" alt="Powered by QRGen" width="146" height="20"></a>
```

Plain text, for an app's About screen:

```text
Barcode scanning by QRGen (https://github.com/Rockyljewell/QR-GEN), created by Rockyljewell.
```

## Cite QRGen

For papers, articles and reports, use the **Cite this repository** button on
[GitHub](https://github.com/Rockyljewell/QR-GEN), which reads the project's `CITATION.cff`. Or:

```text
Rockyljewell. (2026). QRGen: open-source barcode, QR code and ID scanning SDK (Version 1.0.0) [Computer software]. https://github.com/Rockyljewell/QR-GEN
```

## Forks and the QRGen name

You can fork QRGen and publish your fork, as long as you follow the license. The license doesn't cover the
QRGen name or logo, so publish your fork under a different name and don't present it as the official
project. The [name and logo policy](https://github.com/Rockyljewell/QR-GEN/blob/main/TRADEMARKS.md) lists what's fine.

## Spread the word

Share this page with the share button at the top of every page, or
[star QRGen on GitHub](https://github.com/Rockyljewell/QR-GEN).
