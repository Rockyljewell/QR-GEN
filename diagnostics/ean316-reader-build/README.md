# Isolated EAN 3.1.6 reader builds

This experimental pipeline builds matched baseline and candidate assets. It never imports a built reader, instantiates its WASM, decodes an image or runs a corpus. It does not change QR-GEN's SDK dependency or defaults, and publishes no package or release.

The workflow runs only on pushes to `codex/ean316-reader-rebuild`. Its matrix uses separate fresh temporary workspaces. `pins.json` fixes the upstream 3.1.6 commit, C++ and Zint gitlinks, an explicit STB revision, immutable Linux/amd64 EMSDK image, Node archive checksum, pnpm integrity and 23 selected source hashes. The full source graph comes from those immutable commits and the frozen lockfile; it does not contain only 23 files.

Node 22.14.0 and pnpm 12.14.0 are asserted before fetch and before/after compilation. The pnpm archive matches upstream 3.1.6's declared package-manager integrity; `pmOnFail=error` prevents automatic replacement. The runner verifies source identity, fetches pinned dependencies, and then uses a separate Docker container with network disabled for offline installation and compilation. It builds all three WASM targets and their matching ESM, CommonJS, IIFE and Mini Program outputs. It retains package scopes, complete package files, generated glue, compiler/dependency logs, source differences and output hashes. Every created container is removed by its exact returned ID, with absence checked. The artifact also retains upstream wrapper README/LICENSE and C++/Zint/STB LICENSE texts with hashes. A separate six-file manifest records those texts and the reviewed Mini Program build script; it does not change the 23 protected inputs.

The candidate changes the reviewed EAN-13 ambiguity code and private package identity only. It retains 3.1.6's vector cleanup and copied output buffers. Its custom prerelease is not an upstream release. The unchanged loader contains an upstream CDN self-name, so these diagnostic assets require explicit matching local WASM configuration; implicit loading is not approved. No runtime behavior is verified here.

Only a configuration check is safe before review:

```sh
python3 diagnostics/ean316-reader-build/run.py --check-config
```

Both successful and failed build evidence is uploaded for seven days. A successful build establishes compilation and packaging only. Published 3.1.6 byte identity, the partial /07 correctness change, remaining /35 and UPC-only errors, held-out recall, physical-phone behavior and Scandit comparison require separate validation.
