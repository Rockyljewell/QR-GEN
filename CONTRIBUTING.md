# Contributing to QRGen

Thanks for helping. Issues, bug reports with sample images, docs fixes and pull requests are all welcome.

## Ground rules

- **Follow the spec.** [`docs/SPEC.md`](docs/SPEC.md) is the contract between platforms (symbology ids,
  result shape, options, parsers, embed bridge, REST API). If a change affects it, update the spec and
  every affected package in the same pull request, or open an issue first.
- **Tests with every change.** Parsers need test vectors; scanner changes need a generate→scan round trip
  or an end-to-end test.
- **Be honest about status.** A package is only "stable" once it runs in CI on real engines and has been
  verified on devices.
- **No telemetry, no network calls** in SDKs beyond loading their own assets.

## Setup

```bash
git clone https://github.com/Rockyljewell/QR-GEN.git
cd QR-GEN
npm ci
```

| Area | Commands |
| --- | --- |
| Web SDK (`packages/sdk`) | `npm test -w qrgen-sdk`, `npm run typecheck -w qrgen-sdk`, `npm run build -w qrgen-sdk` |
| Website (`site`) | `npm run dev`, `npm run build -w qrgen-site`, `node site/scripts/check-links.mjs site/dist`, `npm run test:e2e` |
| Agent Skills | `node scripts/validate-skills.mjs`, `npx skills add . --list`, `claude plugin validate . --strict` |
| Python | `cd packages/python && pip install -e ".[dev,camera]" && pytest` |
| .NET | `cd packages/dotnet && dotnet test QRGen.Net.sln` |
| Swift | `swift test` (repo root; platform-independent parts also run on Linux) |
| Android | `cd packages/android && ./gradlew :qrgen-core:test` (+ `assembleRelease` with an Android SDK) |
| React Native | `cd packages/react-native && npm ci && npm test && npx tsc --noEmit` |
| Flutter | `cd packages/flutter && flutter pub get && flutter analyze && flutter test` |
| Docker | `docker build -t qrgen . && docker run -p 8080:8080 qrgen` |

## Docs

- Guides live in `site/src/content/docs/*.md`.
- Platform pages (`ios`, `android`, `react-native`, `flutter`, `dotnet`, `python`) are generated from
  the package READMEs by `site/scripts/sync-readmes.mjs`, so edit the README instead.
- Agent Skills in `skills/` must stay in sync with the APIs they describe. When you change a public API,
  search `skills/` for it.

## Reporting scanning problems

Please include: platform and version, device or browser, the symbology, and an image of the code (or
generate an equivalent test code with `npx qrgen generate`). Never attach real IDs or personal data.

## Releases

Tag `vX.Y.Z` on `main`. The release workflow publishes to npm (needs `NPM_TOKEN`) and PyPI (trusted
publishing, enabled with the `PYPI_PUBLISH` repository variable), the Docker workflow publishes
`ghcr.io/rockyljewell/qr-gen`, and JitPack and Swift Package Manager pick up the tag automatically.

## License of contributions

QRGen is licensed under the [Apache License 2.0](LICENSE). By opening a pull request you agree that
your contribution is licensed under the same terms (section 5 of the license). You keep the copyright
on what you write.

Keep the existing header at the top of every file you edit. Start new source files with the same
header, and add your own copyright line above it if you'd like credit for the file:

```ts
// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0
```

Don't remove or edit the [NOTICE](NOTICE) file except to add a notice that a newly bundled
dependency requires.
