"""Read-only independent gate audit; stdlib only, no reader/interpreter imports.

Usage: python -X utf8 verify-gate.py ARTIFACT_ROOT
Prints facts to stdout. Does not write or interpret recognition histories.
This retained verifier reconstructs the checks of the earlier inline audit.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import stat
import zipfile

PINS = {
    'preparation': '136216bb38f48aff447ef6408496bde8f19b2edfdc58e03064be479563fc5cb9',
    'plan': 'a548442961019070d44787c174f31253b4dc65ecfacc70005b6f3f212b300d09',
    'runner': '9c9fc956a418120c922b2fb52fa1063b5b9245ae7b1f542a3e4f724caca13e34',
    'inventory': 'f1f892418a44f30915ae807039b7a7fc70866da131e4fa8943a916e550453206',
    'summary': '8c90ec1ae13ff0440495e7987f55ac3ef1268dc3782f6c271841522d9286f36d',
    'paired': 'acd67fea840d730ee91605b93aee95d189f2c1db7a1979b2242d46eb2a817aaa',
    'binding': '6831973add47709688a17744ea0090706c6783691202297d0b2984426d9b21d7',
    'originalBinding': '80d2e7b3e780f8aa854bbd0ce666c8b7d11f6e1c70077c8e1efbe2bffe3898f5',
}


def require(value, label):
    if not value:
        raise ValueError(label)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def reject_constant(value):
    raise ValueError('Non-JSON numeric constant: ' + value)


def parse(raw):
    return json.loads(raw, parse_constant=reject_constant)


def load(path):
    return parse(path.read_bytes())


def canonical(value):
    # Preserve ordered arrays and distinguish JSON booleans from numbers.
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False, separators=(',', ':'))


def safe_file(root, relative):
    rel = PurePosixPath(relative)
    require(not rel.is_absolute() and '..' not in rel.parts and '\\' not in relative,
            'Unsafe relative path: ' + relative)
    p = root.joinpath(*rel.parts)
    for q in [root, *p.parents, p]:
        if q == root or q.is_relative_to(root):
            require(not q.is_symlink() and not (hasattr(q, 'is_junction') and q.is_junction()),
                    'Link/junction: ' + str(q))
    require(p.resolve().is_relative_to(root.resolve()) and p.is_file(), 'Not a contained file: ' + str(p))
    return p


def check_entries(root, entries):
    require(len({e['path'] for e in entries}) == len(entries), 'Duplicate inventory path')
    for e in entries:
        raw = safe_file(root, e['path']).read_bytes()
        require(('bytes' not in e or len(raw) == e['bytes']) and sha(raw) == e['sha256'],
                'Changed entry: ' + e['path'])


def tree(root):
    require(not root.is_symlink() and not (hasattr(root, 'is_junction') and root.is_junction()), 'Linked root')
    files = set()
    for p in root.rglob('*'):
        require(not p.is_symlink() and not (hasattr(p, 'is_junction') and p.is_junction()), 'Linked tree member')
        if p.is_file():
            files.add(p.relative_to(root).as_posix())
    return files


def audit(art):
    prep = art / 'ean-actual-row-trace-v5'
    run = art / 'ean-actual-row-trace-execution-v5-run-01'
    builds = art / 'row-trace-build-v4-success'
    for name, path in [('preparation', prep / 'freeze-manifest.json'), ('plan', prep / 'frozen-plan.json'),
                       ('runner', prep / 'run-paired.mjs'), ('inventory', run / 'execution-file-inventory.json'),
                       ('summary', run / 'summary.json'), ('paired', run / 'paired-records.jsonl.gz'),
                       ('binding', builds / 'compiled-build-binding-v5.json'),
                       ('originalBinding', builds / 'compiled-build-binding.json')]:
        require(sha(path.read_bytes()) == PINS[name], 'Changed pinned ' + name)
    check_entries(prep, load(prep / 'freeze-manifest.json')['files'])
    plan = load(prep / 'frozen-plan.json')
    require(plan['count'] == {'rasters': 15, 'profiles': 90}, 'Frozen counts')
    require(len(plan['inputs']) == 15 and len(plan['profiles']) == 90
            and len({p['id'] for p in plan['profiles']}) == 90, 'Unique profile count')
    check_entries(prep, plan['files'])
    inventory = load(run / 'execution-file-inventory.json')['files']
    check_entries(run, inventory)
    require(tree(run) == {e['path'] for e in inventory} | {'execution-file-inventory.json'}, 'Execution file-set')
    require(len(inventory) == 183, 'Execution inventory count')
    summary = load(run / 'summary.json')
    require(summary['status'] == 'public-output-conformance-passed-trace-interpretation-permitted', 'Summary status')
    require(summary['plannedProfiles'] == summary['completedProfiles'] == summary['completeTraces'] == 90,
            'Completed profile counts')
    require(summary['readerCalls'] == 180 and summary['engineCalls'] == {'baseline': 90, 'instrumented': 90},
            'Call counts')
    for k in ['outputMismatches', 'inputMutations', 'readerErrors', 'transportFailures']:
        require(summary[k] == 0, 'Nonzero ' + k)
    require(summary['outOfCallErrors'] == [], 'Out-of-call errors')
    binding = load(run / 'execution-binding.json')
    saved_binding = load(builds / 'compiled-build-binding-v5.json')
    reuse = load(prep / 'compiled-build-reuse-amendment.json')
    original = load(builds / 'compiled-build-binding.json')
    require(binding['bindingFileSha256'] == PINS['binding'], 'Binding pin')
    require(binding['planSha256'] == PINS['plan'] and binding['runnerSha256'] == PINS['runner']
            and binding['preparationManifestSha256'] == PINS['preparation'], 'Execution source pins')
    for key in reuse['requiredV5BindingFields']:
        require(binding[key] == saved_binding[key] == reuse[key], 'Compiled-reuse field ' + key)
    require(binding['originalCompiledBuildBindingSha256'] == PINS['originalBinding'], 'Original binding pin')
    require(original['planSha256'] == binding['compiledPlanSha256']
            and original['preparationManifestSha256'] == binding['compiledPreparationManifestSha256'], 'V4 binding reuse')
    for key in ['status', 'patchSha256', 'cppCommit', 'wrapperCommit', 'workflowRun']:
        require(binding[key] == saved_binding[key] == original[key], 'Build identity: ' + key)
    require(binding['workflowRun'] == reuse['workflowRun'] and binding['workflowRun']['conclusion'] == 'success',
            'Successful compiled workflow')
    workflow = load(builds / 'workflow-run.json')
    require(workflow['headSha'] == binding['workflowRun']['headSha'] and workflow['conclusion'] == 'success'
            and all(j['conclusion'] == 'success' for j in workflow['jobs']), 'Retained workflow metadata')
    metadata = load(builds / 'artifact-metadata.json')['artifacts']
    old_art = PureWindowsPath(binding['baseline']['root']).parent.parent

    def recorded_path(value):
        rel = PureWindowsPath(value).relative_to(old_art)
        return safe_file(art, rel.as_posix())

    for item in plan['inputs']:
        for prefix in ['source', 'transport']:
            raw = recorded_path(item[prefix + 'Path']).read_bytes()
            require(sha(raw) == item[prefix + 'Sha256'] and len(raw) == item[prefix + 'Bytes'], 'Raster transport pin')
    instantiated = []
    for variant in ['baseline', 'instrumented']:
        b = binding[variant]
        for key, value in reuse['variants'][variant].items():
            require(b[key] == saved_binding[variant][key] == original[variant][key] == value, 'Variant identity')
        root = builds / variant
        require(PureWindowsPath(b['root']).relative_to(old_art).as_posix() == 'row-trace-build-v4-success/' + variant,
                'Bound root')
        require(recorded_path(b['modulePath']) == root / 'dist/es/reader/index.js'
                and recorded_path(b['wasmPath']) == root / 'zxing_reader.wasm', 'Module/WASM path')
        archive = builds / (variant + '.zip')
        require(sha(archive.read_bytes()) == b['archiveSha256'], 'Archive pin')
        m = next(m for m in metadata if str(m['id']) == b['artifactId'])
        require(m['digest'] == 'sha256:' + b['archiveSha256'] and m['size_in_bytes'] == archive.stat().st_size
                and str(m['workflow_run']['id']) == binding['workflowRun']['id']
                and m['workflow_run']['head_sha'] == binding['workflowRun']['headSha'], 'GitHub artifact metadata')
        with zipfile.ZipFile(archive) as z:
            members = [x for x in z.infolist() if not x.is_dir()]
            require(len({x.filename for x in members}) == len(members), 'Duplicate ZIP member')
            require({x.filename for x in members} == tree(root), 'Archive/extracted exact-set')
            for x in members:
                require(not stat.S_ISLNK(x.external_attr >> 16), 'ZIP link')
                require(z.read(x) == safe_file(root, x.filename).read_bytes(), 'ZIP/extracted byte inequality')
        evidence_raw = (root / 'build-evidence.json').read_bytes()
        evidence = parse(evidence_raw)
        require(sha(evidence_raw) == b['buildEvidenceSha256'] and evidence['variant'] == variant
                and evidence['cppCommit'] == binding['cppCommit']
                and evidence['wrapperCommit'] == binding['wrapperCommit'], 'Build evidence')
        check_entries(root / 'dist/es', evidence['esGraph'])
        require(tree(root / 'dist/es') == {e['path'] for e in evidence['esGraph']}, 'Entire ES graph')
        check_entries(root, evidence['compilerFiles'])
        wasm = (root / 'zxing_reader.wasm').read_bytes()
        require(sha(wasm) == b['wasmSha256'] == evidence['wasmSha256'] and len(wasm) == evidence['wasmBytes'], 'WASM')
        require(sha((root / 'matched-emscripten-glue.js').read_bytes()) == evidence['glueSha256'], 'Raw glue')
        require(evidence['compileDefinition'] == (None if variant == 'baseline' else 'ZXING_QRGEN_ROW_TRACE=1'),
                'Compile definition')
        require(evidence['patchSha256'] == (None if variant == 'baseline' else binding['patchSha256']), 'Compiled patch')
        instantiated.append({'api': 'instantiate', 'sha256': b['wasmSha256']})
    require(summary['instantiated'] == instantiated, 'Observed exact WASM identities')
    records = [parse(line) for line in gzip.decompress((run / 'paired-records.jsonl.gz').read_bytes()).splitlines()]
    require(len(records) == 90, 'Paired record count')
    items = {item['key']: item for item in plan['inputs']}
    patch = (prep / 'actual-row-trace.patch').read_text(encoding='utf8')
    known = set(re.findall(r'\bQRT(?:_EAN|_BOOL)?\(\s*"([^"\n]+)"', patch))
    known |= set(re.findall(r'\bEvent\s+\w+\(\s*"([^"\n]+)"', patch))
    totals = Counter()
    maximum = Counter()
    for index, (profile, record) in enumerate(zip(plan['profiles'], records)):
        require(record['profile'] == profile['id'] and record['inputKey'] == profile['inputKey']
                and canonical(record['options']) == canonical(profile['options']), 'Ordered profile/options')
        require(record['equal'] is True and record['traceComplete'] is True
                and canonical(record['results']['baseline']) == canonical(record['results']['instrumented']),
                'Ordered public-output conformance')
        require(not any(record.get(k + 'InputMutation') for k in ['baseline', 'instrumented']), 'Input mutation flag')
        require(not any('$readerError' in record['results'][k] for k in ['baseline', 'instrumented']), 'Reader error')
        baseline = record['trace']['baseline']
        require((run / 'traces' / f'{index:03d}-baseline.stderr.jsonl').read_bytes() == b'', 'Baseline stderr')
        require(baseline == {'bytes': 0, 'hostDropped': 0, 'nonTrace': 0, 'seq': 0, 'events': 0,
                             'sequenceGaps': 0, 'types': {}, 'transportErrors': []}, 'Baseline counters')
        raw = (run / 'traces' / f'{index:03d}-instrumented.stderr.jsonl').read_bytes()
        require(raw.endswith(b'\n') and len(raw) <= 34 * 1024 * 1024, 'Trace newline/host cap')
        lines = raw.splitlines(keepends=True)
        require(len(lines) <= plan['bounds']['maxEventsPerCall'] + 1, 'Trace event cap')
        types = Counter()
        first = last = None
        for seq, line in enumerate(lines, 1):
            require(line.startswith(b'QRGEN_ROW_TRACE ') and len(line) < plan['bounds']['maxEventBytes'],
                    'Trace prefix/line cap')
            event = parse(line[len(b'QRGEN_ROW_TRACE '):])
            require(event['schema'] == 1 and type(event['seq']) is int and event['seq'] == seq
                    and event['event'] in known, 'Trace schema/type/sequence')
            types[event['event']] += 1
            if first is None:
                first = event
            last = event
            maximum['lineBytes'] = max(maximum['lineBytes'], len(line))
        require(first['event'] == 'call-begin' and last['event'] == 'call-end'
                and types['call-begin'] == types['call-end'] == 1, 'Call markers')
        item = items[profile['inputKey']]
        require((first['width'], first['height'], first['maxEvents'], first['maxBytes'], first['maxLine']) ==
                (item['width'], item['height'], plan['bounds']['maxEventsPerCall'],
                 plan['bounds']['maxBytesPerCall'], plan['bounds']['maxEventBytes']), 'Begin dimensions/caps')
        require(last['dropped'] == last['oversized'] == 0 and last['priorBytes'] == len(raw) - len(lines[-1])
                and last['priorEvents'] == len(lines) - 1 and last['priorBytes'] <= plan['bounds']['maxBytesPerCall'],
                'End complete byte/event counters')
        for event_type, count_key in [('row-attempt', 'rows'), ('decode-attempt', 'attempts'),
                                      ('left-guard-found', 'candidates'), ('collector-insert', 'groups'),
                                      ('oned-pass-begin', 'passes')]:
            require(types[event_type] == last[count_key], 'End aggregate ' + count_key)
        retained = record['trace']['instrumented']
        expected = {'bytes': len(raw), 'hostDropped': 0, 'nonTrace': 0, 'seq': len(lines), 'events': len(lines),
                    'sequenceGaps': 0, 'types': dict(types), 'transportErrors': [],
                    'first': 'call-begin', 'last': 'call-end', 'begin': first, 'end': last, 'endLineBytes': len(lines[-1])}
        require(canonical(retained) == canonical(expected), 'Independent/raw retained counters')
        totals['events'] += len(lines)
        totals['bytes'] += len(raw)
        maximum['events'] = max(maximum['events'], len(lines))
        maximum['bytes'] = max(maximum['bytes'], len(raw))
    require(sha((run / 'execution-file-inventory.json').read_bytes()) == PINS['inventory'], 'End inventory pin')
    return {'status': 'passed-file-only-gate-audit', 'profiles': 90, 'pairedCalls': 180,
            'inventoryFiles': len(inventory), 'inventoryBytes': sum(e['bytes'] for e in inventory),
            'publicOutputMismatches': 0, 'readerErrors': 0, 'inputMutations': 0,
            'incompleteTraces': 0, 'traceTransportErrors': 0, 'traceEvents': totals['events'],
            'traceBytes': totals['bytes'], 'maximumPerTrace': dict(maximum),
            'executionInventorySha256': PINS['inventory'], 'summarySha256': PINS['summary'],
            'pairedRecordsGzipSha256': PINS['paired'], 'readerImports': 0,
            'engineCallsDuringAudit': 0, 'historyInterpretationPerformed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact_root', type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.artifact_root.resolve()), indent=2))
