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

Use Node.js 22+, an already-built QR-GEN checkout with installed site Playwright, and installed Chromium. Set QRGEN_COMPARISON_REPO to that checkout and, if needed, CHROMIUM_PATH to the browser executable. Set QRGEN_DEPLOY_PROOF to proof.json and QRGEN_HOSTED_OUTPUT to a new JSON output path; then run node run-hosted.mjs. Optional QRGEN_HOSTED_CASE selects one exact case name. The runner does not build or edit repository source. It generates retail-qr-ean.y4m beside itself using the recorded helper/settings, checks main and the public standalone SDK, opens fresh pages for the real public demo, records actual loaded asset hashes, and closes cameras/browser. It refuses to overwrite an existing result. The historical pinned replay intentionally fails if main/deployed assets have advanced; refresh provenance explicitly for a newer release instead of attributing it to this artifact.

To reconstruct proof from the original GitHub artifact while available, download github-pages from exact run 38152103868 with gh run download. Put artifact.tar, artifact-metadata.json, and a successful exact-run gh run view JSON named deployment-check-01.json in one directory; run python make-proof.py DIRECTORY. The helper hashes tar members without extracting or executing them. Binary fixture and archive are omitted here; fixture settings/hash and all observed output are retained.

## Preserved earlier observations

Earlier attempts remain separately in the original evidence directory. The first hosted run recorded only the batch event's first barcode, so its EAN assertion was a harness error. A corrected listener then exposed an overly strict same-ID-after-resume assertion: the valid paused prune had retained ID 2, but documented wall-clock expiry allowed a later ID 3. A targeted diagnostic retained those exact states. A passing intermediate run was then strengthened to await a strictly newer decoded lastSeen after resume. Only recorded-results.json is the final three-scenario result; earlier files are not combined into its count or overwritten.
