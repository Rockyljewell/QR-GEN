# Independent file-only trace gate audit

This review checks the retained v5 paired execution before semantic interpretation.
It does not import a reader, execute WebAssembly, rerun recognition, or interpret
barcode histories. It makes no accuracy, performance, phone, or parity claim.

The initial audit was an inline standard-library Python check. `audit-facts.json`
retains its reported facts. `verify-gate.py` was retained afterward as a reusable
equivalent verifier; its separately recorded verification result is not another
recognition run. The execution and frozen packages remain untouched.

Run with Python 3.12+ against the retained artifact root:

```text
python -X utf8 verify-gate.py ARTIFACT_ROOT
```

Required sibling folders are `ean-actual-row-trace-v5`,
`ean-actual-row-trace-execution-v5-run-01`, `row-trace-build-v4-success`, and the
frozen source/transport raster locations. The verifier maps recorded Windows
artifact paths into the supplied artifact root. It prints JSON and writes nothing.
It hashes all execution inventory bytes, compares complete compiled ZIP/extracted
trees and reader graph fingerprints, checks the fixed binding and local retained
GitHub metadata, compares all ordered public output records, and independently
parses transport/schema/sequence/byte/cap/counter consistency for all 90 traces.
It does not make a fresh online GitHub authenticity check; root performed that
when binding the downloaded artifacts.

The frozen interpreter-v5 amendment was also reviewed: only its preparation pin,
CLI labels, and explicit compiled-v4 reuse preflight changed. Reconstruction and
comparison functions were unchanged. Root's later first interpretation attempt
found an existing producer/consumer schema mismatch (`collector-compare` emits
`decision`, while the interpreter expected `result`). The file-only execution
gate remains valid; it deliberately did not interpret event-specific decisions.
A separate bounded static review found this is the only QRT_BOOL call site and
the only missing field in direct/list event field reads across all 50 QRT-family
producer event schemas. Root/decode agent own the new interpreter amendment.
