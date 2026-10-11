# Deployed retail state verification — 2026-10-11

Status: PASS for the actual public Pages release at 6d3728f569f1cd5031fa8ca40ec090c8ff6bdf5b.

Deployment run [38152103868](https://github.com/Rockyljewell/QR-GEN/actions/runs/38152103868) succeeded. GitHub Pages artifact id 11706946941 has artifact.tar SHA-256 5d9780d4074923417946e203212a3855762b894e5d7df00699a8b9aeecb76d6f. The separate GitHub-reported zip digest is retained in artifact-metadata.json and proof.json; it is not treated as the tar digest. The artifact archive is retained in the original evidence directory and omitted from this compact package. GitHub artifact expiration is recorded in its metadata.

The final public-demo run pins GitHub main at the exact release both before and after. Every captured compiled Astro script, explicitly imported standalone SDK module, and worker reader WASM response matches the successful CI Pages artifact. The original demo custom-element constructor remains registered when the standalone SDK is imported. Local Windows chunk names/builds are not used as deployment proof.

Three bounded scenarios exercised the real deployed demo DOM with a generated static QR/EAN-13 fake-camera fixture:

1. Exact QR and EAN-13 worker decoding; pause; narrowing to EAN-13 immediately removes QR from in-view tracks/count, retains the chosen QR as an out-of-view accessible row, and keyboard Enter deselects it. Resume waits for a newly decoded frame with a newer lastSeen and verifies only the enabled EAN. The surviving ID is preserved during pruning; after resume, the documented 500 ms wall-clock expiry can produce a fresh ID. Recorded timestamps distinguish those outcomes.
2. Actual bubbling/composed CustomEvent selection resets clear host selection state on mode change. Callback pause remains paused both from scanning and already paused; a cosmetic hint callback still permits intended preexisting-pause resume.
3. Source recreation emits one host reset; hint/accent/latest-camera changes within that callback do not prevent a new scanner. The old camera track ends and the new scanner decodes the exact QR through its worker.

Every case had zero page/console errors and ended with zero live camera tracks and zero attached element video streams. The browser closed. The local source file hashes used for fixture provenance were unchanged. #39 camera-failure retry/stop is covered by the separate local real-DOM package and was not repeated here. This is desktop integration evidence, not physical-phone validation, a latency benchmark, or Scandit parity evidence.

## Portable replay and artifact proof

This v2 package preserves `run-hosted.mjs`, `recorded-results.json`, `summary.json`, proof and deployment metadata byte-for-byte from the original package. `recorded-README.md` retains the original instructions. The original runner is archived audit code: it writes a generated Y4M beside itself. **Use the new derived `replay.mjs`**, which routes both camera fixture and fresh results to a new external directory. It rejects an existing destination, a destination inside this evidence package, or a destination inside the QR-GEN checkout before creating files; existing ancestor junctions/symlinks are resolved for these checks. `replay-path-guard-validation.json` records four rejection probes, including preservation of an existing result.

Use Node.js 22+, an already-built QR-GEN checkout with installed site Playwright, and installed Chromium. Set `QRGEN_COMPARISON_REPO` to that checkout and, if needed, `CHROMIUM_PATH` to the browser executable. Optionally set `QRGEN_DEPLOY_PROOF` to an independently reconstructed proof; otherwise the bundled immutable `proof.json` is used. Set `QRGEN_HOSTED_OUTPUT_DIR` to a **new directory outside this package and the checkout**, or let the runner choose a new system temporary directory. Do not use the original runner's `QRGEN_HOSTED_OUTPUT` file option. Run:

```text
node <package-directory>/replay.mjs
```

Optional `QRGEN_HOSTED_CASE` selects one exact case name. The runner does not build or edit repository files. It generates `retail-qr-ean.y4m` and writes `hosted-results.json` only in the external directory, validates the generated fixture against the frozen hash before browsing, checks main and the public standalone SDK, opens fresh pages for the real public demo, records actual loaded asset hashes, and closes cameras/browser. The historical pinned replay intentionally fails if main/deployed assets have advanced; refresh provenance explicitly for a newer release instead of attributing it to this artifact.

The derived runner was executed once for all three cases at 2026-10-11T16:04:48.004Z. All three passed against the same pinned main/Pages artifact and exact fixture, with zero page/console errors, zero live camera tracks/attached video streams after each case, and browser closed. `replay-validation-results.json` retains this fresh output separately, and `replay-validation.json` summarizes its hashes/cleanup. It is replay verification, not a larger combined scenario count or new phone/performance claim. The generated 30-frame Y4M remains outside this package and is not committed.

To reconstruct proof from the original GitHub artifact while available, download github-pages from exact run38152103868 with gh run download. Put artifact.tar, artifact-metadata.json, and a successful exact-run gh run view JSON named deployment-check-01.json in a **new external working directory**; run python make-proof.py DIRECTORY. The helper hashes tar members without extracting or executing them, and writes proof.json in that external directory. Binary fixture and archive are omitted here; fixture settings/hash and all observed output are retained.

## Preserved earlier observations

Earlier attempts remain separately in the original evidence directory. The first hosted run recorded only the batch event's first barcode, so its EAN assertion was a harness error. A corrected listener then exposed an overly strict same-ID-after-resume assertion: the valid paused prune had retained ID 2, but documented wall-clock expiry allowed a later ID 3. A targeted diagnostic retained those exact states. A passing intermediate run was then strengthened to await a strictly newer decoded lastSeen after resume. Only recorded-results.json is the final three-scenario result; earlier files are not combined into its count or overwritten.
