# Isolated ZXing-WASM patch evaluation

Checked 2026-10-11. No repository dependency, lockfile, build, or source changes.

## Release evidence

| Package | Version | Published (UTC) | Bundled ZXing-C++ commit |
| --- | --- | --- | --- |
| Current QR-GEN dependency | zxing-wasm 3.1.4 | 2026-09-10 15:01:01.511 | `0b2d9a8fc81f420f369928c24331091ff0525976` |
| npm latest | zxing-wasm 3.1.5 | 2026-10-06 02:13:09.328 | `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4` |
| Latest tagged ZXing-C++ release | v3.1.1 | 2026-07-29 08:29:02 | `287c85d` release tag |

The npm registry is authoritative for package publication timestamps: <https://registry.npmjs.org/zxing-wasm>. Official release notes: <https://github.com/Sec-ant/zxing-wasm/releases/tag/v3.1.5> and <https://github.com/zxing-cpp/zxing-cpp/releases/tag/v3.1.1>.

The 3.1.5 release contains two wrapper repository commits. Its `src` tree identity is unchanged from 3.1.4 (`6188038029d59fea8709e279f154d6703db1160e`), so no wrapper source/API change was found. Its dependency refresh and new WASM still need ordinary SDK compatibility validation before adoption; this is not a complete compatibility certification.

The [official package delta](https://github.com/Sec-ant/zxing-wasm/compare/v3.1.4...v3.1.5) changes version, developer dependencies, and `type-fest` from `^5.9.0` to `^5.10.0`. Package exports (ESM and CJS full/reader/writer plus matching WASM paths), `typesVersions`, `main`, `module`, and `@types/emscripten` peer range are identical. Both package versions omit `engines`. All 46 shipped `.d.ts` files are byte-identical in the installed 3.1.4 and isolated 3.1.5 tarballs. Both type-fest 5.9.0 and 5.10.0 declare Node >=20, so the patch does not introduce that existing metadata constraint. The static runtime probe passes on both Node v22.14.0 and QR-GEN's minimum Node v18.17.0; ordinary full SDK validation remains separate. No breaking API change is documented in the patch release or found in this source/declaration/package comparison.

The bundled decoder delta has 41 commits: <https://github.com/zxing-cpp/zxing-cpp/compare/0b2d9a8fc81f420f369928c24331091ff0525976...2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4>. It includes MicroQR quiet-zone correction (#1162), MicroPDF417 changes (#1159), and [MaxiCode malformed/truncated-input bounds checks](https://github.com/zxing-cpp/zxing-cpp/commit/d33daa0fe937fdbd836a7c4ed13289163f214889). The EAN reader, shared one-dimensional reader, UPC/EAN common code, and ReaderOptions header are byte-identical at both bundled commits and upstream master `2c3dcfeffa7878950a58c1703c86774a428b0c91` observed during this check.

| File | Git blob SHA (same at all three revisions) |
| --- | --- |
| `core/src/oned/ODMultiUPCEANReader.cpp` | `f02749207adbb08a6d905b17cdd0de16844334f7` |
| `core/src/oned/ODReader.cpp` | `0b6061349528211a3f240986f4639f8b04847045` |
| `core/src/oned/ODUPCEANCommon.cpp` | `7a9b4a8daa507a9814fca56fcf72344fc5dbf7d2` |
| `core/src/ReaderOptions.h` | `b3849e4d50b757a8aca0649676508623121e9de3` |

Upstream master after the 3.1.5 bundled commit also has a [tryDenoise/tryDownscale bounds fix](https://github.com/zxing-cpp/zxing-cpp/commit/ca5314ea8dc19a1a9cbf892f08c0ea223e69fcb4). It is not included in 3.1.5. QR-GEN's probe effective default `tryDenoise` is false, so it does not explain this EAN result.

The included MaxiCode fix, committed 2026-09-28 11:48:49 UTC, replaces unchecked lookahead reads in `ParseECIValue` and numeric-set handling with checked access and catches out-of-range input to return `FormatError("Truncated bit stream")`. Its two regression tests cover terminal numeric-set and ECI escapes. This is concrete malformed-input decoder hardening independently of the EAN defect. [MultiFormatReader](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/MultiFormatReader.cpp) installs MaxiCode when that format is enabled, and [MCReader](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/maxicode/MCReader.cpp) calls Decode after pure-bit extraction; it does not gate this on the `isPure` option. The unit reproduction is at decoder level; no image-level exploit or impact beyond the upstream documented out-of-bounds behavior was demonstrated here. This supports evaluating a compatible security/quality patch separately, while leaving the EAN quality defect open.

## Controlled comparison

`compare.mjs` loads the installed 3.1.4 reader and the isolated official 3.1.5 tarball. It explicitly initializes each module with its matching local WASM binary. It reads the nine PNGs already frozen by `ean-static-diagnostic-node.json` and verifies each SHA-256 before decoding. It does not regenerate or rewrite those images. Inputs are tested both as encoded PNG bytes and as decoded RGBA pixmaps, with three identical repetitions per version/profile/input. It checks input bytes and RGBA buffers remain unchanged.

Four profiles match the earlier diagnostic: EAN13 fast/single/no inversion, EAN13 hard/single/no inversion, EAN13 hard/default capacity/inversion, and all formats hard/default capacity/inversion. Rotation and downscale remain enabled and text mode is HRI. Both versions report identical defaults, including LocalAverage binarization, minLineCount 2, returnErrors false, and tryDenoise false. Complete options, engine identifiers, WASM hashes, all results, locations, validity flags, errors, and line counts are in `comparison.json`.

**Result: 72 paired comparisons, 432 total reads, zero differences, all repetitions stable.** No improvement or regression was observed within these three frozen images and six derived pipelines. This result is a static decoder check, not live browser, phone, or Scandit parity evidence.

The complete comparison was then repeated on the already cached Node v18.17.0 executable: 72 paired comparisons, 432 reads, zero differences, all three repetitions stable. All case/output evidence is also identical across Node 18.17.0 and Node 22.14.0 (`runtime-comparison.json`). This executes dynamic import of the installed CJS 3.1.4 reader and isolated ESM 3.1.5 reader, both matching local WASM modules, encoded PNG inputs, and RGBA pixmap inputs. Node 18 evidence is saved separately as `comparison-node18.17.0.json` and `compare-node18.17.0.log`; original Node 22 evidence remains in `comparison.json`.

The cached runtime comes from npm `node@18.17.0` and its actual `node.exe` SHA-256 `da74bcc1606026f05523c33e7882cc0ca4e0786a532bb80f932873eca9bdb431` matches the official [Node.js v18.17.0 published checksums](https://nodejs.org/dist/v18.17.0/SHASUMS256.txt) for `win-x64/node.exe`. Provenance is saved in `node18.17.0-runtime-provenance.json`. No runtime was installed globally, and no repository dependencies or settings were changed for this check.

For `ean13-2-07` expanded RGB (PNG SHA-256 `a93905e88c63a7b8be3ab4e31e9ff145656d6a7f907bc426816eb179606e7dd6`), both versions return no code with tryHarder false. All three hard profiles return `0798884816632` as valid EAN13, empty error, lineCount 2, x188..424/y207..209. The frozen expected payload is `9780804816632`. Both encoded-file and RGBA paths reproduce this, three of three times each.

The official 3.1.5 tarball SHA-512 matches registry integrity: `sha512-jmxXvTCR/qZxMz2XwR6V+nL2BlDTD1aux7ZWSH9BV77TG9u4k0VyHba/NCCHBHJ60Wg6VV0QL/SMlJczKhJI4w==`. Download metadata is in `verified-download.json`; 3.1.5 WASM SHA-256 is `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`.

## Options and known reports

[ReaderOptions at the exact 3.1.5 decoder commit](https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/ReaderOptions.h) documents `minLineCount` as the minimum equal linear scan lines (default 2), and LocalAverage as GlobalHistogram for linear formats. `validateOptionalChecksum` concerns optional checksums such as Code39/ITF, so it is not an extra EAN safeguard. `tryDenoise` applies only to two-dimensional formats. `isPure` is intended for a single perfectly aligned generated symbol and is unsuitable as a general photographic workaround.

The closest primary wrong-read report found was [upstream #255](https://github.com/zxing-cpp/zxing-cpp/issues/255), a 2021 partial EAN image interpreted as a valid UPC-E at an angle. The maintainer recommends restricting formats or requiring more equal scan lines, while warning that more lines may exclude valid symbols. This report is related context, not the same defect: the current false result persists with formats restricted to EAN13 and already has two agreeing lines. No primary issue or commit found in this targeted search demonstrates a newer released EAN13 fix for this payload. A 3.1.5 upgrade must not be described as fixing it.
