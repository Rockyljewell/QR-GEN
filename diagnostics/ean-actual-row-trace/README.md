Diagnostic preparation for issue #32. Recognition policy is unchanged. This directory is a new study; earlier frozen source-port, raw reader, Node/browser and physical-feasibility evidence remain unchanged.

This is the v3 preparation package. See `REVIEW-AMENDMENT.md` for the single diagnostic accessor correction, retained failed-build log and exact v1/v2 provenance. The 15 input identities, 90 profiles, runner and recognition policy remain identical to v2. The preceding v2 instrumented build failed before any recognition; this v3 preparation has not been compiled.

The frozen matrix has 15 saved rasters and 90 profiles. Read `PROTOCOL.md` for exact inputs, options, coverage, gates and limitations. `frozen-plan.json` binds original photograph identities separately from exact PNG transports and decoded RGBA hashes. Preparation decodes PNG transport only; it never imports an SDK/reader or recognizes a barcode.

Build inputs to copy verbatim into a root-owned diagnostic branch:

- `actual-row-trace.patch`
- `patch-metadata.json`
- `frozen-plan.json`
- `freeze-manifest.json`
- `verify-build-inputs.py`
- `capture-build-evidence.mjs`
- Every other file listed by `freeze-manifest.json` (verification pins the complete diagnostic package).

Put these under `diagnostics/ean-actual-row-trace`; copy `diagnostic-build.yml` to `.github/workflows/ean-actual-row-trace.yml`. The template targets `codex/ean-actual-row-trace` and also allows workflow dispatch. Root owns publishing and dispatch. The workflow clones exact upstream wrapper/C++ commits, verifies all baseline bytes, applies only the trace patch to its instrumented copy, and builds the exact retained release recipe. It performs file-only WASM/graph provenance checks and zero recognition calls. Successful builds and downloaded artifact/archive hashes must be bound by the parent before the local paired runner may execute.

The parent creates a new JSON build binding with:

```json
{
  "status": "successful-compiled-builds-bound",
  "planSha256": "FROZEN-PLAN-SHA256",
  "patchSha256": "PATCH-SHA256",
  "cppCommit": "2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4",
  "wrapperCommit": "b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54",
  "workflowRun": { "id": "SUCCESSFUL-RUN-ID", "headSha": "EXACT-HEAD", "conclusion": "success" },
  "baseline": { "root": "EXACT-BASELINE-ARTIFACT-DIR", "wasmSha256": "WASM-SHA", "buildEvidenceSha256": "SHA-OF-build-evidence.json", "artifactId": "ID", "archiveSha256": "SHA" },
  "instrumented": { "root": "EXACT-INSTRUMENTED-ARTIFACT-DIR", "wasmSha256": "WASM-SHA", "buildEvidenceSha256": "SHA-OF-build-evidence.json", "artifactId": "ID", "archiveSha256": "SHA" }
}
```

After parent authorization and exact compiled-build binding:

```text
node run-paired.mjs /absolute/build-binding.json /absolute/fresh-output-directory
```

`QRGEN_TRACE_DEPENDENCY_ROOT` points to an existing SDK dependency installation containing pngjs (default is the original local QR-GEN SDK directory). Nothing is installed or built by the runner. Each engine uses its matching graph and exact WASM bytes. The output directory must be new and outside frozen packages, inputs, dependency/consumer trees. The entire retained ES graph, glue and WASM are verified before reader imports. Network access is denied; compilation/instantiation hashes are recorded. Baseline must reproduce the retained released WASM. Every own string result property is recorded recursively, with typed-array bytes and symbol rasters; no public field is intentionally omitted. The fixed no-error setting means diagnostic line drift is not expected; any returned field difference still fails the gate.

`paired-records.jsonl.gz` retains complete recorded ordered baseline/instrumented outputs, comparison outcomes, per-call timing and transport counters. Original stderr is retained separately for every profile/engine. A mismatch, reader failure, input mutation or incomplete trace stops recognition immediately and prohibits trace interpretation. If all 90 profiles pass, the trace may be reconstructed under the predeclared protocol. Timings describe instrumented execution only and are not performance evidence.

The C++ trace has fixed caps and a final completeness marker. It records scanline support and existing decode decisions. It supplies no physical support mask, additional digit search, confidence filter or truth correction. Same-payload controls retain detection/group multiplicity. Max1 is an acquisition/aggregation setting in this engine; it must not be described as truncating max255 output. Full attempted-row evidence is a question for this actual trace, not a claim inherited from the source port.

`instrumented-source/` contains the exact patched file copies for review. `prepare-instrumentation.py` verifies the retained pinned upstream bytes and deterministically regenerates those copies/patch. That preparer is original-host-only because it reads the earlier artifact snapshot; the patch and build workflow are portable. `freeze-plan.mjs` is also original-host-only and uses earlier frozen file paths. Do not run either preparer over a frozen directory. No compilation or output-equivalence result is claimed by this preparation package.

New trace code is Apache-2.0. Patched upstream files retain their original Apache-2.0 notices. Input photos and generated controls retain the licenses/notices of their existing source packages; this directory does not redistribute photograph bytes.
