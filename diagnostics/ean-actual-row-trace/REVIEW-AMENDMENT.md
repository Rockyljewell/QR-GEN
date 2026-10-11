This is a separate v2 preparation package. Original v1 files and freeze remain unchanged. `v1-provenance.json` retains the exact original plan/manifest/file hashes.

Independent read-only review found one transport-validation gap after v1 froze: the runner retained `call-end.priorBytes` without comparing it to observed stderr bytes, and counted `call-begin` without binding its schema, input dimensions and caps. The review found no C++ policy or coordinate blocker.

V2 verifies schema 1 and an event type declared by the exact frozen C++ patch on every trace record, binds call-begin dimensions and limits to the exact frozen input/protocol, and compares call-end priorBytes to observed transport bytes minus the final line. A failure follows the same explicit `failed-stop-no-trace-interpretation` gate and stops further recognition. The C++ patch, all eight instrumented source copies, 15 input identities and 90 profiles are byte/content identical to v1. Only runner validation, synthetic transport checks and preparation documentation/provenance changed. No build, SDK/reader import or recognition call occurred while creating either preparation package.

Original v1 manifest SHA256: `3df625df825e9a37d9bfb0cdc72fecca63e3eba07e92e35c465902338263b167`.

Original v1 plan SHA256: `590151e42d9f1e1a1d97e2d604cadf3f6abea9b5e9a0942f9cf7e4679f383479`.

Unchanged C++ patch SHA256: `6156e3c8e8ba373e41c05c7610fa4b2fed08850c9d39bbc084d75d28ef954912`.
