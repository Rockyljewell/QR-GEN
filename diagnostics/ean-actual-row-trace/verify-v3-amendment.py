"""File-only v3 amendment checks; no build, reader import or recognition."""
from pathlib import Path
import hashlib, json, gzip

HERE = Path(__file__).resolve().parent
ART = HERE.parent
V2 = ART / 'ean-actual-row-trace-v2'
sha = lambda b: hashlib.sha256(b).hexdigest()
checks = []

for name, expected in [('ean-actual-row-trace', '3df625df825e9a37d9bfb0cdc72fecca63e3eba07e92e35c465902338263b167'),
                       ('ean-actual-row-trace-v2', 'f85b909911989b1aa99e478277e5a5c051b6aa66fd7edbf10c5a36b45d806e07')]:
    root = ART / name
    raw = (root / 'freeze-manifest.json').read_bytes()
    assert sha(raw) == expected, name
    old = json.loads(raw)
    for f in old['files']:
        b = (root / f['path']).read_bytes()
        assert sha(b) == f['sha256'] and len(b) == f['bytes'], (name, f['path'])
    checks.append({'name': 'unchanged-' + name, 'verifiedManifestEntries': len(old['files'])})

meta = json.loads((HERE / 'patch-metadata.json').read_text())
assert sha((HERE / 'actual-row-trace.patch').read_bytes()) == meta['patchSha256']
paths = [f['path'] for f in meta['files']] + [f['path'] for f in meta['newFiles']]
changed = []
for p in paths:
    before = (V2 / 'instrumented-source' / p).read_bytes()
    after = (HERE / 'instrumented-source' / p).read_bytes()
    if before != after:
        changed.append(p)
        assert p == 'core/src/MultiFormatReader.cpp'
        old = b'qrt.position("position", r[qi].position());'
        new = b'qrt.position("position", r[qi].position);'
        assert before.count(old) == 1 and before.replace(old, new, 1) == after
assert changed == ['core/src/MultiFormatReader.cpp']
checks.append({'name': 'exact-single-accessor-correction', 'comparedSourceFiles': len(paths), 'changedPaths': changed})

old_prep = (V2 / 'prepare-instrumentation.py').read_bytes()
new_prep = (HERE / 'prepare-instrumentation.py').read_bytes()
assert old_prep.replace(b'qrt.position("position", r[qi].position());',
                        b'qrt.position("position", r[qi].position);', 1) == new_prep
for p in ['run-paired.mjs', 'verify-validation-only.mjs', 'PROTOCOL.md', 'QRGenRowTrace.h',
          'diagnostic-build.yml', 'capture-build-evidence.mjs', 'verify-build-inputs.py', 'snapshot-build-phase.py']:
    assert (V2 / p).read_bytes() == (HERE / p).read_bytes(), p
checks.append({'name': 'runner-protocol-header-workflow-and-build-verifiers-unchanged', 'passed': True})

old_plan = json.loads((V2 / 'frozen-plan.json').read_text())
new_plan = json.loads((HERE / 'frozen-plan.json').read_text())
for key in ['inputs', 'profiles', 'count', 'cppCommit', 'wrapperCommit', 'bounds', 'parentPlans', 'gates']:
    assert old_plan[key] == new_plan[key], key
assert len(new_plan['inputs']) == 15 and len(new_plan['profiles']) == 90
checks.append({'name': 'exact-v2-input-profile-and-gate-identity', 'rasters': 15, 'profiles': 90})

failure = json.loads((HERE / 'build-failure-provenance.json').read_text())
archive = (HERE / failure['archivePath']).read_bytes()
log = gzip.decompress(archive)
assert sha(archive) == failure['archiveSha256']
assert sha(log) == failure['originalLogSha256'] and len(log) == failure['originalLogBytes']
assert log == (ART / 'row-trace-first-instrumented-build.log').read_bytes()
assert b'MultiFormatReader.cpp:95:82: error:' in log
assert b'error: type \'Position\'' in log
checks.append({'name': 'exact-failed-build-log-retained', 'originalSha256': sha(log), 'originalBytes': len(log)})

audit = json.loads((HERE / 'accessor-audit.json').read_text())
for f in audit['pinnedApiFiles']:
    b = (ART / 'ean-cpp-source-trace' / f['path']).read_bytes()
    assert sha(b) == f['sha256'] and len(b) == f['bytes'], f['path']
checks.append({'name': 'api-audit-pinned-header-bytes', 'fileCount': len(audit['pinnedApiFiles'])})
print(json.dumps({'scope': 'File-only amendment verification, not C++ compilation or recognition.',
                  'checks': checks, 'patchSha256': meta['patchSha256'],
                  'planSha256': sha((HERE / 'frozen-plan.json').read_bytes()),
                  'auditCodeSha256': sha(Path(__file__).read_bytes()),
                  'readerImports': 0, 'recognitionCalls': 0}))
