# Actual C++ EAN row and collector diagnostic record

All 90 frozen paired profiles returned identical ordered public results from the released baseline and its instrumentation-only build. The subsequent file-only interpreter reconstructed all 90 traces and 30 result-budget comparisons successfully. This package records that investigation; it installs no decoder change and selects no confidence filter. [Issue #32](https://github.com/Rockyljewell/QR-GEN/issues/32) remains open.

The matrix uses 15 saved rasters with fast/hard search and result budgets 1/2/255, for 180 completed reader calls. Every profile uses EAN-13, rotation enabled, native inversion/downscale/denoise disabled, `minLineCount:2`, ignored add-ons, `returnErrors:false`, LocalAverage binarization and HRI text. The known photographs and controls make this a diagnostic investigation, not a held-out accuracy benchmark.

## Provenance and verification

The [diagnostic build](https://github.com/Rockyljewell/QR-GEN/actions/runs/38159730178) compiled wrapper `b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54` and C++ `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4` at diagnostic branch head `efb439d218e4bb0859ec4a0abf9c61ca5019b0dc`. The baseline WASM SHA256 is `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`; the trace WASM is `b5e45bfbfda1bf29992c3e3c716a4c2afa50ac4172c00e80c07c21704f74b2cc`. The compiled v4 artifacts were explicitly rebound to the v5 local-file runner amendment without changing the C++ patch, build inputs, matrix, pixels or options. The [build records](build/compiled-build-binding-v5.json) retain exact artifact identifiers and archive hashes.

The paired gate compares every own string result property recursively, including typed bytes and symbol rasters, and checks input-buffer immutability. The [execution summary](execution/summary.json) records zero mismatches, input mutations, reader errors or transport failures, and 90 complete traces. The [original lossless public records](execution/paired-records.jsonl.gz) remain authoritative. Instrumented timings are diagnostic overhead and provide no performance comparison.

The [independent file-only gate audit](gate-review/README.md) verified 931,395 events and 355,725,654 trace bytes before semantic interpretation. Each call remained inside the frozen caps; maximum trace size was 56,157 events / 22,578,423 bytes and maximum line length was 1,090 bytes. The complete raw trace files were retained locally and are omitted from this compact publication.

The [v6 interpreter amendment](interpreter-v6/README.md) corrects one producer/consumer schema lookup: the pinned C++ boolean macro emits `collector-compare.decision`, which is normalized to the interpreter's existing internal comparison result. Previous preparation freezes and reported harness failures remain identified; those failures are not decoder failures. The successful [reconstruction summary](reconstruction/summary.json) binds the preparation, execution inventory and exact interpreter source. A [separate derived-output review](derived-review/README.md) checks the retained counts and bounded raw-history samples independently.

The reconstruction records 24,812 attempted scan rows, 60,872 decode attempts, 4,806 collector-eligible decode results, 459 parser-returned checksum errors and 286 binarizer-rejected rows. It retains actual row schedules, stable group histories and support contributions. Group identifiers belong to one profile; they do not establish persistent physical identities.

The separate [bounded actual-case review](case-review/FINDINGS.md) retains verified score, scheduler, representative-position and same-payload control observations, with exact profile/sequence/source references in its results. It reads existing records only and selects no alternative decoder output or production filter.

## Retained files

| Directory/file | Contents |
| --- | --- |
| `preparation-v5/` | Exact frozen small preparation package: protocol, plan, instrumentation patch/header/source, build recipe, paired runner, gates, amendment and failure provenance. The diagnostic workflow is a historical source file here, not an active production workflow. |
| `interpreter-v6/` | Exact frozen interpreter package, schema fixture, checks and prior freeze inventories. |
| `execution/` | Exact execution binding, summary, complete lossless public records and original full execution inventory. |
| `reconstruction/` | Exact 3,398,822-byte compressed histories, summary and original inventory; `comparisons.json.gz` losslessly compresses the original 9,739,461-byte comparison file to 365,300 bytes. |
| `gate-review/`, `derived-review/` | Retained independent audit source, results and inventories. |
| `case-review/` | Bounded actual-score and history checks, factual findings, results and inventory. |
| `build/` | Exact local build binders, action/artifact metadata, fingerprints, toolchain versions, CMake caches and compiler/link flags. |
| `input-references.json` | Source, PNG transport and RGBA identities; exact repository image copies when located. No images were copied or transformed for this package. |
| `source-copy-inventory.json` | Original paths, hashes and byte counts for every copied or compressed record. |
| `package-inventory.json` | Hashes and byte counts for this compact published package. |

Every copied file retains its original bytes. Only `comparisons.json` is newly compressed, using gzip level 9 with `mtime=0`; its decompressed bytes match the original source hash. Existing `.gz` files are unchanged. Original freeze/execution/reconstruction inventories describe their original complete directories, not this selected publication layout. In particular, the execution inventory names the omitted raw traces. The package inventory describes what is actually published.

## Scope and access limits

Returned positions are estimated scanline-based quadrilaterals; they are not complete physical bar masks or guaranteed min/max envelopes of every contribution. Whole-PNG control placement membership includes saved padding. Result budgets change acquisition and aggregation; max1 is not assumed to truncate max255 output. Support counts do not themselves select a correct payload or a safe production grouping rule.

This compact record omits all 180 raw stderr files, the original compiled artifact ZIPs, extracted ES graphs/glue/WASM and input raster copies. Retained review results describe checks performed against those original files. The complete raw transport gate and selected raw-score spotchecks cannot be rerun from this subset. The frozen scripts include original absolute paths and original directory assumptions; they are historical source, not portable runtime instructions. Another host would need the original missing bytes and a separately reviewed path relocation method before reproducing all checks. GitHub action artifacts may expire.

This study supplies no physical phone or native camera execution evidence. It makes no UPC-only, inversion/downscale, add-on, held-out accuracy, throughput or Scandit parity claim. Production continues using the official released reader. Earlier [public SDK evidence](../EAN-SDK-INTEGRATION-2026-10-11.md), [physical-conflict study](../ean-physical-conflict-2026-10-11/README.md) and [phone validation requirements](../PHONE-VALIDATION.md) remain separate.

The upstream source/patch retains Apache-2.0 attribution in [ZXING-LICENSE.txt](ZXING-LICENSE.txt) and [ZXING-NOTICE.txt](ZXING-NOTICE.txt). Existing image packages retain their own notices.
