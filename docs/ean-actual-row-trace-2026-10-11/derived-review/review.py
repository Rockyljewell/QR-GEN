"""File-only derived provenance/count review plus one bounded control trio.

Usage: python -X utf8 review.py ARTIFACT_ROOT
No reader imports, recognition, or duplicate full interpreter execution.
Prints JSON only; reads all derived records and only three raw trace files.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path

sha = lambda b: hashlib.sha256(b).hexdigest()


def require(value, label):
    if not value:
        raise ValueError(label)


def load(path):
    return json.loads(path.read_bytes())


def encoded_equal(a, b):
    return json.dumps(a, sort_keys=True, separators=(',', ':')) == json.dumps(b, sort_keys=True, separators=(',', ':'))


def json_lines(path):
    return [json.loads(x) for x in gzip.decompress(path.read_bytes()).splitlines()]


def files(root, entries):
    for f in entries:
        p = root / f['path']
        require(not p.is_symlink() and p.resolve().is_relative_to(root.resolve()), 'Unsafe inventory path')
        b = p.read_bytes()
        require(len(b) == f['bytes'] and sha(b) == f['sha256'], 'Inventory bytes: ' + f['path'])


def audit(art):
    output = art / 'ean-actual-row-trace-analysis-output-v6-run-01'
    source = art / 'ean-actual-row-trace-analysis-v6'
    prep = art / 'ean-actual-row-trace-v5'
    execution = art / 'ean-actual-row-trace-execution-v5-run-01'
    source_pin = '43db13eb66cb48eb10b65719805aaba1ff16423372d53fbd02ed230a472a6de3'
    require(sha((source / 'freeze-manifest.json').read_bytes()) == source_pin, 'Frozen v6 analysis source')
    files(source, load(source / 'freeze-manifest.json')['files'])
    inventory_raw = (output / 'analysis-file-inventory.json').read_bytes()
    inventory = json.loads(inventory_raw)['files']
    files(output, inventory)
    require({f['path'] for f in inventory} == {'summary.json', 'comparisons.json', 'profile-analysis.jsonl.gz'},
            'Derived payload inventory')
    require({p.name for p in output.iterdir()} == {f['path'] for f in inventory} | {'analysis-file-inventory.json'},
            'Derived exact file set')
    summary = load(output / 'summary.json')
    plan = load(prep / 'frozen-plan.json')
    raw_paired = gzip.decompress((execution / 'paired-records.jsonl.gz').read_bytes())
    pairs = [json.loads(x) for x in raw_paired.splitlines()]
    profiles = json_lines(output / 'profile-analysis.jsonl.gz')
    comparisons = load(output / 'comparisons.json')
    pins = {
        'preparationManifestSha256': sha((prep / 'freeze-manifest.json').read_bytes()),
        'planSha256': sha((prep / 'frozen-plan.json').read_bytes()),
        'executionInventorySha256': sha((execution / 'execution-file-inventory.json').read_bytes()),
        'pairedRecordsDecompressedSha256': sha(raw_paired),
        'analysisCodeSha256': sha((source / 'interpret.py').read_bytes()),
        'analysisManifestSha256': source_pin,
    }
    require(summary['sourcePins'] == pins, 'Derived source/execution provenance')
    require(summary['status'] == 'all-90-transport-and-reconstruction-checks-passed'
            and summary['profiles'] == len(profiles) == len(pairs) == len(plan['profiles']) == 90,
            'Derived profile counts')
    require(summary['trios'] == len(comparisons) == 30 and summary['readerImports'] == summary['recognitionCalls'] == 0,
            'Derived trios/scope')
    counts, classification = Counter(), Counter()
    for frozen, paired, profile in zip(plan['profiles'], pairs, profiles):
        require((profile['profile'], profile['inputKey'], profile['options']) ==
                (frozen['id'], frozen['inputKey'], frozen['options']), 'Ordered derived profile')
        require(encoded_equal(profile['recordedPublicResults'], paired['results']['baseline']), 'Public output preservation')
        require(profile['counts'] == paired['trace']['instrumented']['types'], 'Derived/raw transport event counts')
        require(profile['publicCount'] == profile['globalInsertCount'] == profile['readerOutputCount']
                == profile['recordedPublicResults']['$properties']['length'], 'Public multiplicity')
        require(len(profile['rows']) == profile['counts'].get('row-attempt', 0)
                and len(profile['attempts']) == profile['counts'].get('decode-attempt', 0)
                and len(profile['groups']) == profile['counts'].get('collector-insert', 0), 'Derived object counts')
        require(sum(len(g['contributions']) for g in profile['groups']) == profile['counts'].get('collector-candidate', 0),
                'Contribution count')
        checks = {'attempts': 'decode-attempt', 'collectorEligible': 'collector-candidate',
                  'collectorRejectedInvalid': 'collector-reject-invalid', 'parserReturnedRows': 'ean-accepted-row',
                  'binarizerRejectedRows': 'row-binarizer-reject'}
        for key, event in checks.items():
            require(profile['classification'][key] == profile['counts'].get(event, 0), 'Classification count ' + key)
        require(profile['classification']['checksumPasses'] + profile['classification']['checksumFailures']
                == profile['counts'].get('checksum', 0), 'Checksum total')
        counts.update(profile['counts'])
        classification.update(profile['classification'])
    require(dict(counts) == summary['counts'] and dict(classification) == summary['classification'], 'Summary aggregation')
    require(sum(counts.values()) == 931395, 'Previously independently audited event total')
    by_id = {p['profile']: p for p in profiles}
    require(len(by_id) == 90, 'Unique derived IDs')
    seen = set()
    for comparison in comparisons:
        key = (comparison['inputKey'], comparison['tryHarder'])
        require(key not in seen, 'Duplicate trio')
        seen.add(key)
        require(set(comparison['paths']) == set(comparison['schedules']) == {'1', '2', '255'}, 'Trio budgets')
        for m in ['1', '2', '255']:
            path = comparison['paths'][m]
            p = by_id[path['profile']]
            require(p['inputKey'] == key[0] and p['options']['tryHarder'] == key[1]
                    and p['options']['maxNumberOfSymbols'] == int(m), 'Trio profile association')
            require(path['passes'] == p['passes'] and path['publicCount'] == p['publicCount']
                    and path['outputGroups'] == [g for g in p['groups'] if 'output' in g], 'Trio path preservation')
            require(comparison['schedules'][m] == [[r[k] for k in ['pass', 'rowNumber', 'checkRow', 'rotate']] for r in p['rows']],
                    'Trio schedule preservation')
        for diff in comparison['firstDifferences']:
            left = comparison['schedules'][str(diff['leftMax'])]
            right = comparison['schedules'][str(diff['rightMax'])]
            at = next((i for i, (a, b) in enumerate(zip(left, right)) if a != b),
                      min(len(left), len(right)) if len(left) != len(right) else None)
            require(diff['firstDifferentScheduledRowIndex'] == at
                    and diff['leftRow'] == (left[at] if at is not None and at < len(left) else None)
                    and diff['rightRow'] == (right[at] if at is not None and at < len(right) else None), 'First schedule difference')
    # Bounded raw spotcheck: a distinct-payload physical control, fast trio only.
    selected = ['physical-control/two-aligned-gap16/fast/max' + str(m) for m in [1, 2, 255]]
    spotchecks = []
    for profile_id in selected:
        p = by_id[profile_id]
        index = next(i for i, x in enumerate(plan['profiles']) if x['id'] == profile_id)
        trace_path = execution / 'traces' / f'{index:03d}-instrumented.stderr.jsonl'
        raw = trace_path.read_bytes()
        events = [json.loads(line[len(b'QRGEN_ROW_TRACE '):]) for line in raw.splitlines()]
        event_by_seq = {e['seq']: e for e in events}
        require([e['seq'] for e in events if e['event'] == 'row-attempt'] == [r['seq'] for r in p['rows']], 'Spot row ordering')
        for row in p['rows']:
            require(all(event_by_seq[row['seq']][key] == row[key] for key in
                        ['pass', 'rowId', 'rowNumber', 'iteration', 'checkRow', 'pendingCheckRows', 'rotate']), 'Spot row fields')
        for g in p['groups']:
            require(event_by_seq[g['insertSeq']]['event'] == 'collector-insert', 'Spot insert')
            for c in g['contributions']:
                e = event_by_seq[c['seq']]
                require(e['event'] == 'collector-candidate' and e['position'] == c['position']
                        and all(e[k] == c[k] for k in ['pass', 'rowId', 'rowNumber', 'attempt', 'rotate', 'reverse']),
                        'Spot contribution origin')
                decode = event_by_seq[e['seq'] - 1]
                require(decode['event'] == 'decode-return' and decode['valid'] is True, 'Spot accepted predecessor')
                scan_width = next(x['scanWidth'] for x in reversed(events[:e['seq']]) if x['event'] == 'oned-pass-begin')
                mapped = []
                for x, y in decode['rawPosition']:
                    if e['reverse']:
                        x = scan_width - x - 1
                    if e['rotate']:
                        x, y = y, scan_width - x - 1
                    mapped.append([x, y])
                require(mapped == c['position'], 'Spot exact C++ position transforms')
            for transition in g['transitions']:
                e = event_by_seq[transition['seq']]
                require(e['event'] == transition['event'] and e['group'] == g['group'], 'Spot transition origin')
                if e['event'] == 'collector-merged':
                    require(e['supportAfter'] == transition['support'] and e['positionAfter'] == transition['position'], 'Spot merge support')
            if 'output' in g:
                e = event_by_seq[g['output']['seq']]
                require(e['event'] == 'collector-output' and all(e[k] == v for k, v in g['output'].items()), 'Spot collector output')
        supports = {}
        budget_rows = []
        for e in events:
            if e['event'] == 'oned-pass-begin':
                supports = {}
            elif e['event'] == 'collector-insert':
                supports[e['group']] = e['lineCount']
            elif e['event'] == 'collector-merged':
                supports[e['group']] = e['supportAfter']
            elif e['event'] == 'oned-budget-exit':
                require(sum(n >= p['options']['minLineCount'] for n in supports.values()) == e['maxSymbols'],
                        'Spot source Reduce support budget')
                require(e['groupsBeforePrune'] == len(supports), 'Spot pre-prune budget count')
                require(e['seq'] in [x.get('budgetExitSeq') for x in p['passes']], 'Spot derived explicit exit')
                budget_rows.append({'seq': e['seq'], 'pass': e['pass'], 'row': e['rowNumber'],
                                    'groupsBeforePrune': e['groupsBeforePrune'], 'supportedGroups': dict(supports)})
        spotchecks.append({'profile': profile_id, 'tracePath': trace_path.relative_to(art).as_posix(),
                           'traceSha256': sha(raw), 'rows': len(p['rows']), 'attempts': len(p['attempts']),
                           'publicCount': p['publicCount'], 'outputSupports': [g['output']['lineCount'] for g in p['groups'] if 'output' in g],
                           'budgetExits': budget_rows, 'passExitReasons': [x['exitReason'] for x in p['passes']]})
    require(sha((output / 'analysis-file-inventory.json').read_bytes()) == sha(inventory_raw), 'End derived inventory')
    return {'status': 'passed-bounded-independent-derived-review', 'profiles': 90, 'trios': 30,
            'sourcePins': pins, 'derivedInventorySha256': sha(inventory_raw),
            'derivedPayloadBytes': sum(f['bytes'] for f in inventory), 'totalEvents': sum(counts.values()),
            'classification': dict(classification), 'boundedRawSpotchecks': spotchecks,
            'sourceBasis': {'path': 'ean-actual-row-trace-v5/instrumented-source/core/src/oned/ODReader.cpp',
                            'sha256': sha((prep / 'instrumented-source/core/src/oned/ODReader.cpp').read_bytes()),
                            'claims': ['Rows and contributions retain source event order/context.',
                                       'Reverse then rotate maps each accepted raw scanline into the recorded position.',
                                       'Budget exit is reached support-group count, before support pruning; it is not output truncation.']},
            'limitationsReviewed': summary['limitations'],
            'publicationCaveats': [
                'The frozen shorthand scanline-support envelope is not a guaranteed enclosing envelope of all historical support. ODReader replaces the nearer quadrilateral side; an interior incoming scanline can replace a previous edge. Use collector representative quadrilateral or support-derived geometry, and retain individual contribution positions.',
                'The three raw control spotchecks do not establish all semantic histories or a safe recognition policy; the photographed and same-payload cases have a separate reviewer.'
            ], 'blockers': [],
            'scope': 'All derived provenance, counts, public records and comparison references checked; semantic raw histories spotchecked for only three fast distinct-payload control profiles. Other semantic case findings are reviewed separately.',
            'readerImports': 0, 'recognitionCalls': 0, 'duplicateFullInterpreterExecutions': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact_root', type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.artifact_root.resolve()), indent=2))
