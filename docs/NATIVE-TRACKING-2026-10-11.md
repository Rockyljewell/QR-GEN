# Native overlap tracking correction

October 11, 2026. Reported as [issue #28](https://github.com/Rockyljewell/QR-GEN/issues/28).

Both native trackers could create a third live item from two detections despite
a valid two-track assignment under their existing fallback rules. Start with
different QR payloads A/B in 100×100 squares at x=0/100, then observe changed
payloads X/Y at x=52/150 after 30 ms. X has the strongest overlap with B, but Y
can only match B. Greedy X→B strands Y and retains A. X→A plus Y→B avoids an
extra ID. This reproduces in either detection order.

The correction preserves exact payload assignments and the existing geometric
preference. Only incomplete fallback assignments are repaired, using iterative
alternating paths to reach a free eligible track. Track data, counts and timestamps
are updated once after matching finishes. Eligibility still requires the existing
same-symbology overlap threshold. Expiry and increasing IDs retain their contracts.
Empty graphs and roots without eligible edges skip search allocations.

This maximizes the number of eligible fallback matches **after exact matches are
fixed**. It is not a global minimum-distance optimizer, a decoder correction, or
proof of physical identity across occlusion. Existing exact-key priority can
intentionally leave a fallback detection unmatched.

## Regression evidence

The reproduction-only commit `86394c70c5f1551b8160281057bdcd99c87ab703`
was executed before production changes in
[CI run 38146537397](https://github.com/Rockyljewell/QR-GEN/actions/runs/38146537397).
Android executed 130 tests with one failure: expected two tracks, received three.
Both Swift Linux and macOS failed the same two-track regression; the Linux run
executed 52 tests with 16 assertions failing within that single regression.
The other ten CI jobs passed.

Expanded native tests cover both input orders, a three-track reassignment chain,
exact-key priority, counts/timestamps, and 150 seeded small scenes per platform
checked against independent exhaustive assignment enumeration in both orders.
The Swift oracle also calculates square overlap independently. Existing expiry,
symbology isolation and positionless matching tests remain in place.

[PR #29](https://github.com/Rockyljewell/QR-GEN/pull/29) merged as
`c2ae04a8328ee70966691069a7c4f05008ef6176` after all 13 jobs passed on
integrated head `9909c8afc79a3b2c2a7a7ff5f7e073376675fe23` in
[PR CI](https://github.com/Rockyljewell/QR-GEN/actions/runs/38146910080)
and push CI. That head incorporated current main `337037e`, including the
other agent's PR #27. Swift Linux executed 54 tests and macOS 63, with zero
failures. Android core/camera tests and library/Compose/sample builds passed.

No physical phone is connected to the host, and no Swift/Android toolchain is
available locally. Desktop/CI evidence does not establish phone or Scandit
stability parity.
