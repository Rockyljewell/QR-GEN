"""File-only v4 provenance-verifier amendment checks; no C++ build or recognition."""
from pathlib import Path
import gzip, hashlib, json

HERE = Path(__file__).resolve().parent
ART = HERE.parent
V3 = ART / 'ean-actual-row-trace-v3'
sha = lambda b: hashlib.sha256(b).hexdigest()
checks = []
for name, pin in [('ean-actual-row-trace', '3df625df825e9a37d9bfb0cdc72fecca63e3eba07e92e35c465902338263b167'),
                  ('ean-actual-row-trace-v2', 'f85b909911989b1aa99e478277e5a5c051b6aa66fd7edbf10c5a36b45d806e07'),
                  ('ean-actual-row-trace-v3', 'f920f79e7b41cdcffd957ba88aded043b7f8ccd669a9cb8ff454e930e6bb3a1f')]:
    root = ART / name
    raw = (root / 'freeze-manifest.json').read_bytes()
    assert sha(raw) == pin, name
    old = json.loads(raw)
    for f in old['files']:
        b = (root / f['path']).read_bytes()
        assert sha(b) == f['sha256'] and len(b) == f['bytes'], (name, f['path'])
    checks.append({'name': 'original-frozen-package-unchanged-' + name, 'manifestEntries': len(old['files'])})

meta = json.loads((HERE / 'patch-metadata.json').read_text())
for x in meta['files'] + meta['newFiles']:
    p = Path('instrumented-source') / x['path']
    assert (V3 / p).read_bytes() == (HERE / p).read_bytes(), p
for p in ['actual-row-trace.patch', 'patch-metadata.json', 'prepare-instrumentation.py', 'run-paired.mjs',
          'PROTOCOL.md', 'QRGenRowTrace.h', 'diagnostic-build.yml', 'verify-build-inputs.py', 'snapshot-build-phase.py',
          'verify-validation-only.mjs', 'freeze-package.py']:
    assert (V3 / p).read_bytes() == (HERE / p).read_bytes(), p
checks.append({'name': 'cpp-patch-eight-sources-policy-runner-protocol-workflow-unchanged', 'passed': True})

before = (V3 / 'capture-build-evidence.mjs').read_bytes()
after = (HERE / 'capture-build-evidence.mjs').read_bytes()
prefix = b"for(const phase of ['reader','writer','full'])"
suffix = b'const evidence='
assert before[:before.index(prefix)] == after[:after.index(prefix)]
assert before[before.index(suffix):] == after[after.index(suffix):]
assert before != after
checks.append({'name': 'only-phase-verifier-block-changed-in-capture-code', 'beforeSha256': sha(before), 'afterSha256': sha(after)})

old_plan = json.loads((V3 / 'frozen-plan.json').read_text())
new_plan = json.loads((HERE / 'frozen-plan.json').read_text())
for key in ['inputs', 'profiles', 'count', 'cppCommit', 'wrapperCommit', 'bounds', 'parentPlans', 'gates']:
    assert old_plan[key] == new_plan[key], key
assert len(new_plan['inputs']) == 15 and len(new_plan['profiles']) == 90
checks.append({'name': 'exact-v3-input-profile-and-gate-identity', 'rasters': 15, 'profiles': 90})

failure = json.loads((HERE / 'v3-build-failure-provenance.json').read_text())
attempt = ART / 'row-trace-build-attempt-v3'
for f in failure['retainedRecords']:
    archive = (HERE / f['archivePath']).read_bytes()
    raw = gzip.decompress(archive)
    assert sha(archive) == f['archiveSha256'] and sha(raw) == f['originalSha256'] and len(raw) == f['originalBytes']
    assert raw == (attempt / f['originalPath']).read_bytes()
for a in failure['archives']:
    raw = (attempt / (a['variant'] + '.zip')).read_bytes()
    assert sha(raw) == a['zipSha256'] and len(raw) == a['zipBytes']
    assert sha((attempt / a['variant'] / 'zxing_reader.wasm').read_bytes()) == a['wasmSha256']
checks.append({'name': 'exact-unsuccessful-v3-workflow-records-and-archive-hashes-retained', 'records': 3, 'archives': 2})

print(json.dumps({'scope': 'File-only provenance-verifier amendment verification, not C++ compilation or recognition.',
                  'checks': checks, 'patchSha256': meta['patchSha256'],
                  'planSha256': sha((HERE / 'frozen-plan.json').read_bytes()),
                  'auditCodeSha256': sha(Path(__file__).read_bytes()), 'readerImports': 0, 'recognitionCalls': 0}))
