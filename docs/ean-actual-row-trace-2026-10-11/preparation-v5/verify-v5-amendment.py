"""File-only runner amendment/compiled-input reuse verification; no reader calls."""
from pathlib import Path
import gzip, hashlib, json

HERE = Path(__file__).resolve().parent
ART = HERE.parent
V4 = ART / 'ean-actual-row-trace-v4'
sha = lambda b: hashlib.sha256(b).hexdigest()
load = lambda p: json.loads(Path(p).read_bytes())
checks = []
old_manifest = (V4 / 'freeze-manifest.json').read_bytes()
assert sha(old_manifest) == '895591898867b18c8541cdba6e58bc7d78f224267fbc490ca270df570ed6fc3d'
for f in json.loads(old_manifest)['files']:
    b = (V4 / f['path']).read_bytes()
    assert sha(b) == f['sha256'] and len(b) == f['bytes'], f['path']
checks.append({'name': 'original-frozen-v4-package-unchanged', 'manifestEntries': 43})
reuse = load(HERE / 'compiled-build-reuse-amendment.json')
for f in reuse['unchangedCompileInputs']:
    b = (HERE / f['path']).read_bytes()
    assert b == (V4 / f['path']).read_bytes()
    assert sha(b) == f['sha256'] and len(b) == f['bytes']
for p in ['PROTOCOL.md', 'verify-validation-only.mjs']:
    assert (HERE / p).read_bytes() == (V4 / p).read_bytes()
checks.append({'name': 'all-sixteen-compiled-inputs-and-protocol-unchanged', 'passed': True})

before = (V4 / 'run-paired.mjs').read_bytes()
after = (HERE / 'run-paired.mjs').read_bytes()
anchor = b'const outOfCallErrors=[];const engines={};'
helper = b"""function locatePinnedReaderWasm(name,prefix,wasmPath){
 if(name!=='zxing_reader.wasm'||prefix!==''||!isAbsolute(wasmPath))throw Error('Unexpected local reader WASM resolution');
 const url=pathToFileURL(wasmPath);if(url.protocol!=='file:'||url.hostname!=='')throw Error('Reader WASM must resolve to the exact local file');
 return url.href;
}
"""
gate_anchor = b"if(!binding.workflowRun?.id||"
reuse_gate = b"""const reuse=json(join(here,'compiled-build-reuse-amendment.json'));
for(const key of reuse.requiredV5BindingFields)if(binding[key]!==reuse[key])throw Error('Explicit v4 compiled-build reuse binding mismatch: '+key);
if(binding.preparationManifestSha256!==sha(readFileSync(join(here,'freeze-manifest.json')))||binding.workflowRun?.id!==reuse.workflowRun.id||binding.workflowRun?.headSha!==reuse.workflowRun.headSha)
 throw Error('V5 runner must bind its exact preparation to the retained successful v4 compiled workflow');
for(const k of ['baseline','instrumented'])for(const key of ['wasmSha256','buildEvidenceSha256','artifactId','archiveSha256'])
 if(binding[k]?.[key]!==reuse.variants[k][key])throw Error('Reused compiled artifact identity mismatch: '+k+'/'+key);
"""
assert before.count(anchor) == before.count(gate_anchor) == before.count(b'locateFile:denied') == 1
expected = before.replace(anchor, helper + anchor).replace(gate_anchor, reuse_gate + gate_anchor)
expected = expected.replace(b'locateFile:denied', b'locateFile:(name,prefix)=>locatePinnedReaderWasm(name,prefix,b.wasmPath)')
assert after == expected
checks.append({'name': 'exact-runner-only-resolver-and-explicit-reuse-gates', 'beforeSha256': sha(before), 'afterSha256': sha(after)})
old_plan, new_plan = load(V4 / 'frozen-plan.json'), load(HERE / 'frozen-plan.json')
for key in ['inputs', 'profiles', 'count', 'cppCommit', 'wrapperCommit', 'bounds', 'parentPlans', 'gates']:
    assert old_plan[key] == new_plan[key], key
checks.append({'name': 'exact-v4-fifteen-inputs-ninety-profiles-options-and-gates', 'passed': True})

failed = ART / 'ean-actual-row-trace-execution-v4-run-01'
failure = load(HERE / 'v4-execution-failure-provenance.json')
for f in failure['files']:
    b = (failed / f['path']).read_bytes()
    assert b == (HERE / 'failed-v4-execution' / f['path']).read_bytes()
    assert sha(b) == f['sha256'] and len(b) == f['bytes']
summary = load(failed / 'summary.json')
assert summary['status'] == 'failed-stop-no-trace-interpretation'
assert summary['engineCalls'] == {'baseline': 1, 'instrumented': 0} and summary['instantiated'] == [] and summary['completeTraces'] == 0
record = json.loads(gzip.decompress((failed / 'paired-records.jsonl.gz').read_bytes()))
assert record['results'] == {'baseline': {'$readerError': 'Error: Network forbidden in frozen local study'}}
checks.append({'name': 'all-six-failed-v4-execution-files-preserved-exactly', 'passed': True})

binding_raw = (ART / 'row-trace-build-v4-success' / 'compiled-build-binding.json').read_bytes()
binding = json.loads(binding_raw)
assert sha(binding_raw) == reuse['originalCompiledBuildBindingSha256']
assert binding['planSha256'] == reuse['compiledPlanSha256'] and binding['preparationManifestSha256'] == reuse['compiledPreparationManifestSha256']
assert binding['status'] == 'successful-compiled-builds-bound' and binding['workflowRun'] == reuse['workflowRun'] and binding['workflowRun']['conclusion'] == 'success'
for k in ['baseline', 'instrumented']:
    assert all(binding[k][key] == value for key, value in reuse['variants'][k].items())
    root = Path(binding[k]['root'])
    evidence_raw = (root / 'build-evidence.json').read_bytes()
    assert sha(evidence_raw) == binding[k]['buildEvidenceSha256']
    evidence = json.loads(evidence_raw)
    assert evidence['cppCommit'] == binding['cppCommit'] and evidence['wrapperCommit'] == binding['wrapperCommit'] and evidence['variant'] == k
    assert evidence['compileDefinition'] == ('ZXING_QRGEN_ROW_TRACE=1' if k == 'instrumented' else None)
    assert evidence['patchSha256'] == (reuse['patchSha256'] if k == 'instrumented' else None)
    assert sha((root / 'zxing_reader.wasm').read_bytes()) == binding[k]['wasmSha256'] == evidence['wasmSha256']
    assert sha((root / 'matched-emscripten-glue.js').read_bytes()) == evidence['glueSha256']
    for f in evidence['esGraph']:
        b = (root / 'dist/es' / f['path']).read_bytes()
        assert sha(b) == f['sha256'] and len(b) == f['bytes'], f['path']
    for f in evidence['compilerFiles']:
        assert sha((root / f['path']).read_bytes()) == f['sha256'], f['path']
checks.append({'name': 'successful-v4-binding-and-matched-wasm-glue-entire-es-graph-compiler-files-unchanged', 'passed': True})
print(json.dumps({'scope': 'File-only v5 runner amendment and v4 compiled-build reuse checks; no decoder import, build or recognition.',
                  'checks': checks, 'planSha256': sha((HERE / 'frozen-plan.json').read_bytes()),
                  'runnerSha256': sha(after), 'auditCodeSha256': sha(Path(__file__).read_bytes()),
                  'readerImports': 0, 'recognitionCalls': 0}))
