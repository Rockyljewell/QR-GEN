# Independent derived-output review

`review.py` independently checks all derived inventory bytes and source/execution
pins, all 90 ordered public records/counts, and all 30 comparison references and
first differing schedules. It then spot-checks only the fast max1/max2/max255 trio
for the distinct-payload `two-aligned-gap16` control against three raw trace files.
No reader, WebAssembly, recognition, or full interpreter is executed.

```text
python -X utf8 review.py ARTIFACT_ROOT
```

It prints JSON and writes nothing. `review.json` retains the result. The separate
execution-gate audit is in `../ean-actual-row-trace-independent-review`.

The raw spotchecks support the observed budget behavior: max1 stops with one
supported group after four rows; max2 stops with two supported groups after ten
rows; max255 explores 38 rows across both orientations and returns two groups.
These are acquisition/aggregation differences, not truncation of one fixed read.
They are not an accuracy, timing, phone, or parity comparison.

Publication must qualify the frozen phrase “scanline-support envelope.” The
collector replaces its nearer quadrilateral side, including when the incoming
line falls inside the current span. Its returned quadrilateral need not contain
every historical contribution. Use “collector representative quadrilateral” or
“support-derived geometry” and preserve the individual contribution positions.
Whole-PNG placement membership includes padding and is not physical ink support.
Known examples/controls are not held-out accuracy evidence; IDs are call-local.
No safe default or decoder policy is established by this review. Another reviewer
owns the photographed /07, /35 and same-payload semantic findings.
