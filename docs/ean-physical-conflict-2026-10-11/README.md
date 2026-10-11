# Physical-symbol conflict feasibility: descriptive refutation

Returned scanline-support envelopes cannot establish physical barcode identity in these selected examples. A predeclared, deliberately broad relation groups the two conflicting `/1/35` outputs and also groups **five controls containing two legitimate symbols**. No threshold, majority winner, replacement payload, decoder patch or production filter was selected.

This package contains recorded evidence from the known development case, not a blinded or held-out accuracy study. Geometry functions receive only four returned corner points. Text, bytes, line counts and truth annotations enter afterwards. Pair/detection indices and counts are preserved, including repeated payloads.

## Evidence and observations

The original study reused 479 existing actual baseline profiles, all EAN-13, hard search, full resolution, native inversion off, max255, minimum line count2, Ignore addons, HRI and LocalAverage. It made nine original reader calls on generated controls with unmodified released zxing-wasm3.1.5, reader SHA256 `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`. Control file and pixel hashes were frozen before those calls. This packaging step performs **zero engine calls** and preserves the original nineteen-file snapshot unchanged.

The relation requires the same dominant image axis and positive projected span intersection. It is a descriptive refutation target, not a physical-symbol classifier. Returned geometry describes accepted-scanline support envelopes, not the full printed bars.

| Pair | Projected span IoU | Perpendicular envelope gap | Returned groups |
| --- | ---: | ---: | ---: |
| `/1/35` original | 98.54% | 36 px | 2 |
| `/1/35` derived | 98.54% | 31 px | 2 |
| Two aligned different EANs, PNG gap0 | 100% | 21 px | 2 |
| Two aligned different EANs, PNG gap16 | 100% | 37 px | 2 |
| Two aligned different EANs, PNG gap96 | 100% | 117 px | 2 |
| Two aligned different EANs, gap16, rotated90 | 100% | 37 px | 2 |
| Two different EANs, half-image-width offset | 25.29% | 37 px | 2 |

Those five legitimate two-code controls are projection-related. The side-by-side different-code control is not. All six different-payload two-code controls return both exact generated payloads. Control gaps separate complete opaque PNGs, including their existing quiet padding; PNG gap0 still produces a21px returned-envelope gap. The90-degree control is an exact pixel permutation of the complete composite. Current AABB separation, parallelism or chosen gaps do not certify physical identity or justify a new threshold.

The two separately placed same-payload symbols return one upstream envelope, lineCount400. Study code performs no text deduplication. Single symbols with central white bands4/16 rows also return one envelope spanning the interruption, lineCounts196/184. Returned envelopes therefore do not certify connected ink or physical-instance counts. These observations are not declared product bugs without an intended counting contract. Thresholded connected ink would also fail for disconnected bars and occlusion.

Across the479 reused profiles, the relation associates four cases: original/derived `/1/35` and original `/2/14` and `/2/20`. The latter two remain multiple-output observations, not newly adjudicated false results. Photographs and the original inspection page are omitted; their original identities/hashes remain recorded. This compact package supplies no image-segmentation conclusion from their appearance.

## Scheduling and trace limits

The supplement retains 24 already-recorded actual `/1/35` limit profiles: original/derived × fast/hard × downscale off/on × max1/2/255. These are reused observations, not24 new recognition trials. Under hard/full-resolution settings:

| Raster | max1 | max2 | max255 |
| --- | --- | --- | --- |
| Original `/1/35` | correct, support2 | wrong2 + correct7 | wrong3 + correct8 |
| Derived `/1/35` | correct, support2 | wrong2 + correct5 | wrong5 + correct6 |

Here correct means the pre-existing companion5030159003930 and wrong means7034759003930; these labels do not enter geometry. The max1 output is not a truncation of max255. Requested symbol budgets affect acquisition/aggregation and early-exit behavior. Returned outputs cannot expose the complete attempted-row schedule, rejected rows, collector transitions or early exits.

Accepted-row diagnostics come from the prior **diagnostic source port**, with selected bit rows checked through actual WASM BoolCast/isPure minLineCount1. The port enumerates full-resolution rows; its retained eligible aggregation observations are not a newly instrumented actual-engine execution trace. `derived-trace-source-provenance.json` preserves that header and exact original trace hash. No source-port max1/2 claim substitutes for actual scheduling evidence.

The original `results.json` contains three trace summaries because its extraction used the wrong Chrome case ID. The separate exact supplement explicitly requires all four focus IDs, including `ean13-2-07-chrome-full`, and is authoritative for that extraction. The479 geometry records and nine control results are unaffected. The correction does not overwrite the original results.

## Integrity and offline review

Original plan SHA256: `d50418f8906c4788fca6c8611916631b60fccdbab57dd5331fe6fb7bb9acdb1f`. Original nineteen-file inventory SHA256: `95a86fc29bdb2e0a7a18dd83a1dbfe729ae3ff13fcd2e9e99ceab8f23e6daa9a`.

- `records/results.json.gz` and `records/complete-trace-and-limit-evidence.json.gz` expand to exact original recorded bytes. Their original and compressed hashes are retained. These are the study's recorded geometry/control/trace-limit objects, not a claim to capture every field from the prior full raw-reader matrix.
- Nine control PNGs are copied byte-for-byte. `packaging-control-pixel-verification.json` independently rechecks their dimensions and RGBA hashes with Pillow12.3.0, with no SDK execution.
- `derived-portable-plan.json` tokenizes host paths. `derived-control-rasters.json` substitutes package-relative control paths. Both explicitly identify the original byte hash and are **derived documents**, not original frozen bytes. The embedded original plan hash refers to the original plan, not either derivative. All source/pixel identities and measurement rules remain retained.
- `archived-audit-code/` contains exact gzip archives of the original geometry/control runner and corrected trace extractor. They are audit code, not a portable recognition replay. The original runner depends on original inputs/SDK dependencies, refuses existing outputs and would make engine calls if deliberately reconstructed and executed. Do not execute it as an offline verification command. No photographic embeds or upstream implementation binary are distributed.
- `original-inventory.json` is the exact original inventory. `original-evidence-hashes.json` also identifies omitted originals, including the inspection HTML, without redistributing them. License/NOTICE attribution is retained under `licenses/`.

With a standard Node runtime, these commands read this package only and make no SDK/decoder calls:

```text
node verify-package.mjs
node audit-recorded-geometry.mjs
```

The first checks every retained file/gzip/control hash. The second recomputes geometry, pair measurements and connected components from recorded corner positions only, then checks the five-control refutation, per-detection counts and correction/scheduling scope. It is an offline arithmetic audit, not new recognition evidence. For projected interval IoU it uses true union length; this equals the original enclosing interval when overlap is positive, and both give zero IoU when intervals are disjoint.

## Supported next experiment

Freeze an instrumentation-only baseline experiment on four focus rasters, these nine controls and `/2/14` + `/2/20`:15 inputs × fast/hard × max1/2/255 at full resolution/native inversion off,90 profiles. First require unchanged public outputs against uninstrumented baseline. Bound trace storage and record attempted/rejected rows and passes, original-coordinate transforms, guards and normalized runs, digit candidates/variance/checksum decisions, collector group/merge/discard IDs, and scheduling/early-exit reasons.

That experiment could determine whether a payload-independent physical bar-support representation is feasible. It must not select a majority, substitute known truth or export a new production policy. Any future identity criterion requires frozen rules and separate unseen images/additional multi-code controls before truth review; reject false merges or recall losses. Current evidence establishes neither a safe filter nor complete issue32 resolution, physical-device stability, population accuracy or Scandit parity.
