# Staged SDK overlay addendum — before test/decode

No study decoding has run. Both initial exact source stages have built successfully after correcting the isolated dependency lookup layout; failed build logs are retained.

Before final verification/packing, candidate config's version-only import will use the same private reader graph as decoder/worker/inversion, removing the unnecessary executable official reader graph without changing the upstream version3.1.5/default URL. The single inversion-policy mock follows the private reader call boundary; all assertions remain unchanged. This tests the same policy in the new staging import layout. No production source is edited.

The candidate postbuild will verify matching source/destination reader SHA256. Both packages include wrapper MIT and C++ Apache license/NOTICE metadata and explicit nonproduction reader provenance. These are build/package safeguards, not SDK runtime authentication of user-supplied assets. The experiment explicitly configures all browser transports; stable distribution/default/capability identity gates remain unresolved.
