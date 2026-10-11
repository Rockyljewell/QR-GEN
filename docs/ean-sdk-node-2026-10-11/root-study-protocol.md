# Isolated SDK integration study — predeclared scope

Freeze this protocol before generating the staged candidate SDK. Production main, dependencies and site remain unchanged. This is an integration experiment, not a supported preview release or stable promotion.

Base SDK source: QR-GEN commit `6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b` (PR41 adds evidence only). Candidate matched ES graph and WASM come from successful run38152527079 / commit3cfe7298c1d92eb2d4ac56158a1bfcd51275f070. Baseline SDK is separately staged from the same source. The official writer stays3.1.5 in both.

Allowed experimental overlays:

1. Copy tracked SDK files to fresh external baseline/candidate staging directories; use existing locked dependencies without installation. Retain source/overlay/build/artifact hashes.
2. Candidate statically replaces the reader imports in decoder/inversion/worker with its matched private graph. Use the matching official reader's TS signatures only; do not mix executable loader graphs.
3. Candidate Node automatic local engine loading and postbuild copy the matching candidate reader WASM into the staged package. Retain the existing public reader asset export path for this diagnostic only. Both staged package versions carry explicit diagnostic suffixes and a nonproduction notice.
4. Every browser/worker experiment explicitly configures the appropriate binary, reader URL or self-hosted folder before scanning. This does not validate or approve the original upstream default CDN, capability build identity, arbitrary caller binaries, supported browser migration, or shipping a preview release. Do not expose this tarball as a normal release.

Gates:

- Both exact-base stages build public ESM/CJS/IIFE/worker and declarations without modifying the real checkout. Pack and verify shipped reader/writer asset hashes and license presence.
- Public Node18 and24 ESM/CJS entry smoke: generate/read clean QR/EAN/UPC, inspect configuration binary hash, reject accidental official candidate-reader loading.
- Public scanImage SDK matrix includes frozen photographic core, known wrong07/35, thin positives, generated inversion format matrix and no-code controls. Preserve full public SDK outputs. Compare candidate against baseline using SDK text/family/bytes/geometry representation, not raw HRI expectations. Any lost expected baseline target, new value or error blocks promotion and must be reported. Options are limited to the public API; do not pretend to test raw downscale/add-on choices that it does not expose.
- Actual Chromium public image/scanner integration uses main and real Blob workers, verifies asset selection and /07 suppression, retains /35/UPC-only residuals, exercises clean/mixed controls, binary/URL/base configuration and cleanup. Offline means local assets with external network denied; no population/phone/vendor stability claim. Broken/mismatched assets are diagnostic observations, not an assumed validation feature.
- Do not combine repeated profiles or repeated browser protocol runs into independent image/accuracy counts. Do not tune after seeing outcome; any revised protocol is a separate named version.

Outstanding production gates remain default asset/identity/migration design, held-out corpus, runtime compatibility claims beyond actual tested environments, native platforms and physical phones/Scandit. A successful experiment does not close issue32.
