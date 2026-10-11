Bounded file-only review of actual accepted score records and derived histories, separate from every frozen preparation/execution/interpreter package. See `FINDINGS.md` for conclusions and limits, `results.json` for exact candidate/event references and source hashes, and `run-observation.json` for the successful case-checker invocation outcome.

The parent-owned recognition run and full interpreter already succeeded. This checker does not import or call either. It checks the pinned derived gzip, enumerates at most64 combinations from recorded exact-best digit patterns using the pinned source parity table and EAN13 checksum, inspects the two /07 terminal schedules, and summarizes historical support and representative-position contractions. It never changes decoder output or selects an alternative word.

To reproduce into a NEW result file with the separately retained original input packages:

```text
python -X utf8 -B review-actual-cases.py /absolute/ean-actual-row-trace-v5 /absolute/ean-actual-row-trace-analysis-output-v6-run-01 /absolute/ean-actual-row-trace-execution-v5-run-01 /absolute/new-case-review-results.json
```

Only the specified source/derived files and six raw instrumented traces are read; all read-file hashes are retained under `sourceInputs`. Paths there are relative to each identified input role. No raster fixture or binary build is required by this checker. This is a bounded semantic review, not a duplicate exhaustive provenance audit. The separate independent derived-output review covers full inventory/provenance/count checks.

No frozen evidence is overwritten. No reader calls, full interpreter reruns or production filters are added. The five-file inventory below binds this exact script, result, memo, README and run observation; the inventory is the sixth file.
