# Isolated EAN 3.1.6 reader builds

This experimental pipeline builds matched baseline and candidate assets. It never imports a built reader, instantiates its WASM, decodes an image or runs a corpus. It does not change QR-GEN's SDK dependency or defaults, and publishes no package or release.

The workflow runs only on pushes to `codex/ean316-reader-rebuild`. Its matrix uses separate fresh temporary workspaces. `pins.json` fixes the upstream 3.1.6 commit, C++ and Zint gitlinks, an explicit STB revision, immutable Linux/amd64 EMSDK image, Node archive checksum, pnpm integrity and 23 selected source hashes. The full source graph comes from those immutable commits and the frozen lockfile; it does not contain only 23 files.

Node 22.14.0 and pnpm 12.14.0 are asserted before fetch and before/after compilation. The pnpm wrapper archive matches upstream 3.1.6's declared package-manager integrity. Its exact Linux x64/glibc native dependency is separately pinned and verified by archive integrity, package identity, ELF architecture and binary hash, then placed beside the wrapper payload as the official Unix installer does. The launcher executes that binary directly, without an automatic downloader; `pmOnFail=error` prevents version replacement. The runner verifies source identity, fetches pinned dependencies, and then uses a separate Docker container with network disabled for offline installation and compilation. It builds all three WASM targets and their matching ESM, CommonJS, IIFE and Mini Program outputs. It retains package scopes, complete package files, generated glue, compiler/dependency logs, source differences and output hashes. Every created container is removed by its exact returned ID, with absence checked. The artifact also retains upstream wrapper README/LICENSE and C++/Zint/STB LICENSE texts with hashes. A separate six-file manifest records those texts and the reviewed Mini Program build script; it does not change the 23 protected inputs.

The candidate changes the reviewed EAN-13 ambiguity code and private package identity only. It retains 3.1.6's vector cleanup and copied output buffers. Its custom prerelease is not an upstream release. The unchanged loader contains an upstream CDN self-name, so these diagnostic assets require explicit matching local WASM configuration; implicit loading is not approved. No runtime behavior is verified here.

Only a configuration check is safe before review:

```sh
python3 diagnostics/ean316-reader-build/run.py --check-config
```

Both successful and failed build evidence is uploaded for seven days. A successful build establishes compilation and packaging only. Published 3.1.6 byte identity, the partial /07 correctness change, remaining /35 and UPC-only errors, held-out recall, physical-phone behavior and Scandit comparison require separate validation.

The initial run stopped at an obsolete JavaScript pnpm entry path before dependency fetch, candidate patch application or compilation. Both failed artifacts are retained. The native bootstrap correction changes no source patch, build command, offline network boundary or validation claim.

The second run verified the native bootstrap and exact tool versions, then rejected a legacy fetch flag before package fetching. Pinned pnpm 12.14 implements fetch with a frozen lockfile already; only that unsupported flag is removed. Offline installation still requires `--frozen-lockfile`, and a full tracked-source check now precedes candidate patching.

The third run fetched 259 packages and passed 337 policy entries online in each variant; that bootstrap executed the pinned esbuild, @swc/core and simple-git-hooks dependency hooks. Its offline installation then lacked metadata from the removed container's default cache. Both phases now use `pnpm_config_cache_dir=/task/pnpm-cache` under the fresh variant workdir. Policy and integrity checks remain active, and target compilation remains in the container with network disabled. The failed run executed compiler version probes but no target CMake configure, object compilation or decoder.
