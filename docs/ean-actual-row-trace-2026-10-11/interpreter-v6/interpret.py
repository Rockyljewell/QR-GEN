"""Bounded file-only interpretation after the complete 90-profile public gate."""
from pathlib import Path
from collections import Counter
import gzip, hashlib, json, math, re, struct, sys

HERE = Path(__file__).resolve().parent
PREFIX = b'QRGEN_ROW_TRACE '
PREPARATION_MANIFEST = '136216bb38f48aff447ef6408496bde8f19b2edfdc58e03064be479563fc5cb9'
PASSED = 'public-output-conformance-passed-trace-interpretation-permitted'
sha = lambda b: hashlib.sha256(b).hexdigest()

def require(value, message):
    if not value:
        raise ValueError(message)

def read_json(path):
    return json.loads(Path(path).read_bytes().decode('utf8').lstrip('\ufeff'))

def check_file(root, entry):
    name = entry['path']
    require(not Path(name).is_absolute() and '..' not in Path(name).parts, 'Unsafe inventory path')
    p = root / name
    require(not p.is_symlink() and p.resolve().is_relative_to(root.resolve()), 'Inventory path escapes root')
    b = p.read_bytes()
    require(len(b) == entry['bytes'] and sha(b) == entry['sha256'], 'Changed inventory file: ' + name)

def plain(value):
    """Read the runner's lossless own-property encoding without importing its code."""
    if not isinstance(value, dict):
        return value
    if value.get('$kind') == 'Array':
        props = value['$properties']
        n = props['length']
        require(isinstance(n, int) and n >= 0, 'Unexpected encoded array length')
        return [plain(props[str(i)]) for i in range(n)]
    if value.get('$kind') == 'Object':
        return {k: plain(v) for k, v in value['$properties'].items()}
    # Typed-array/undefined records retain their exact recorded representation.
    return value

def position(p):
    require(isinstance(p, list) and len(p) == 4 and all(isinstance(q, list) and len(q) == 2
            and all(isinstance(x, int) for x in q) for q in p), 'Unexpected position shape')
    return p

def mapping(width, height, row, rotate, reverse):
    scan_width = height if rotate else width
    return ((row, 0 if reverse else scan_width - 1, 0, 1 if reverse else -1)
            if rotate else (scan_width - 1 if reverse else 0, row, -1 if reverse else 1, 0))

def mapped_line(raw, direction, row):
    raw = position(raw)
    require(all(q[1] == row for q in raw), 'Raw accepted line is not on its recorded scan row')
    a, b, dx, dy = [direction[k] for k in ['originX', 'originY', 'xStep', 'yStep']]
    return [[a + dx * q[0], b + dy * q[0]] for q in raw]

def placement_memberships(p, item):
    """Whole opaque PNG placement rectangles, never bar/ink identification."""
    places = item.get('placements', [])
    spec = item.get('controlSpec', {})
    rotate = spec.get('rotate', 0)
    require(rotate in [0, 90], 'Unplanned control rotation')
    # Saved 90-degree control transform is output[x,y] = input[y,H-1-x].
    # Thus (x,y) -> (H-1-y,x); postrotation width is original height.
    result = []
    for i, r in enumerate(places):
        x0, x1, y0, y1 = r['x'], r['x'] + r['width'] - 1, r['y'], r['y'] + r['height'] - 1
        if rotate:
            h = item['width']
            x0, x1, y0, y1 = h - 1 - y1, h - 1 - y0, x0, x1
        if all(x0 <= x <= x1 and y0 <= y <= y1 for x, y in position(p)):
            result.append({'placementIndex': i, 'sourceIndex': r['sourceIndex']})
    return result

class Schedule:
    def __init__(self, begin):
        self.width, self.height = begin['scanWidth'], begin['scanHeight']
        self.step, self.max_lines = begin['rowStep'], begin['maxLines']
        self.minimum, self.maximum = begin['minLineCount'], begin['maxSymbols']
        expected = max(1, self.height // ((256 if self.maximum == 1 else 512)
                       if begin['tryHarder'] and not begin['isPure'] else 32))
        require(self.step == expected, 'Row-step formula mismatch')
        require(self.max_lines == (self.height if begin['tryHarder'] else 15), 'Max-lines mismatch')
        self.i, self.stack, self.reason, self.row = 0, [], None, None

    def proposed(self):
        n = (self.i + 1) // 2
        return self.height // 2 + self.step * (n if self.i % 2 == 0 else -n)

    def select(self):
        require(self.reason is None and self.i < self.max_lines, 'Row after scheduling termination')
        proposed = self.proposed()
        require(0 <= proposed < self.height, 'Missing schedule-out-of-bounds event')
        check = bool(self.stack)
        row = self.stack.pop() if check else proposed
        iteration = self.i - 1 if check else self.i
        if not check:
            self.i += 1
        return row, iteration, check

    def attempted(self, e):
        row, iteration, check = self.select()
        require(0 <= row < self.height, 'Missing check-row-out-of-bounds event')
        require((e['rowNumber'], e['iteration'], e['checkRow']) == (row, iteration, check), 'Observed scheduled row mismatch')
        require(e['pendingCheckRows'] == self.stack and e['scanWidth'] == self.width, 'Check-row stack/width mismatch')
        self.row = e

    def out_of_bounds(self, e):
        if e['event'] == 'check-row-out-of-bounds':
            row, _, check = self.select()
            require(check and not 0 <= row < self.height and e['proposedRow'] == row, 'Unexpected rejected check row')
        else:
            require(self.i < self.max_lines, 'Bounds event after loop exhaustion')
            row = self.proposed()
            require(not 0 <= row < self.height and e['proposedRow'] == row and e['iteration'] == self.i,
                    'Unexpected scheduled bounds exit')
            require(e['pendingCheckRows'] == self.stack, 'Bounds-exit pending-stack mismatch')
            self.reason = 'schedule-out-of-bounds'

    def replace(self, e):
        require(self.row is not None and not self.row['checkRow'] and self.minimum > 1 and self.step > 1,
                'Unexpected check-row replacement')
        row = self.row['rowNumber']
        expected = [row - 1, row + 1] + ([row - 2, row + 2] if self.step > 2 else [])
        require(e['pendingCheckRows'] == expected, 'Replacement stack mismatch')
        self.stack = expected

    def end(self, e):
        require(e['pendingCheckRows'] == self.stack, 'Final pending-stack mismatch')
        if self.reason is None:
            require(self.i >= self.max_lines, 'Search ended without observed exit or exhausted loop')
            self.reason = 'max-lines-exhausted'

def verify_digit_bits(e):
    n = e['patternCount']
    require(n in [10, 20] and len(e['variances']) == 20 and len(e['varianceFloat32Bits']) == 20,
            'Unexpected digit score storage')
    for number, bits in zip(e['variances'][:n], e['varianceFloat32Bits'][:n]):
        actual = struct.unpack('<f', struct.pack('<I', bits))[0]
        if math.isfinite(actual):
            require(number == actual, 'Float32 score/recorded bits mismatch')
        else:
            expected = 'NaN' if math.isnan(actual) else ('-Infinity' if actual < 0 else '+Infinity')
            require(number == expected, 'Non-finite diagnostic encoding mismatch')

def interpret_events(events, profile, item):
    counts, passes, rows, attempts, groups = Counter(), [], [], [], {}
    active, row, direction, attempt = None, None, None, None
    live, support_drops, phase, pending_merge = [], set(), None, None
    reader_outputs, global_candidates, global_inserts, orientation_gates = [], [], [], []

    def close_attempt():
        if attempt is None:
            return
        require('return' in attempt and 'collectorDecision' in attempt, 'Unfinished decode/collector attempt')
        require('cursorAdvanceSeq' in attempt or attempt.get('budgetExit'), 'Attempt missing cursor advance or explicit budget exit')

    def close_row():
        close_attempt()
        if row is not None:
            require(row.get('binarizer') is not None, 'Missing row histogram')
            if row.get('binarizerReject'):
                require(row['directions'] == [] and row['binarizer']['threshold'] <= 0, 'Unexpected rejected binarizer row')
            else:
                require('runsSeq' in row, 'Missing complete row runs')
                require([d['reverse'] for d in row['directions']] == [False, True]
                        or (active['exitReason'] == 'oned-budget-exit' and [d['reverse'] for d in row['directions']] in [[False], [False, True]]),
                        'Missing/reordered row directions')

    def support_prune():
        nonlocal live, phase
        if phase != 'support-prune':
            return
        expected = {gid for gid in live if groups[gid]['currentSupport'] < active['schedule'].minimum}
        require(support_drops == expected, 'Missing/extra support-prune events')
        for gid in expected:
            groups[gid]['terminalReason'] = 'insufficient-support'
        live = [gid for gid in live if gid not in expected]
        phase = 'overlap-prune'

    def overlap_prune():
        nonlocal live, phase
        support_prune()
        if phase == 'overlap-prune':
            live = [gid for gid in live if groups[gid]['currentFormat'] != 0]
            phase = 'outputs'

    def close_pass():
        nonlocal phase
        if active is None or phase == 'closed':
            return
        require(active.get('searchEndSeq') is not None, 'Pass lacks search-end')
        overlap_prune()
        require(active['outputGroups'] == live, 'Missing/reordered collector outputs')
        active['exitReason'] = active['schedule'].reason
        del active['schedule']
        phase = 'closed'

    for e in events:
        typ = e['event']; counts[typ] += 1
        if typ == 'options':
            opts = profile['options']
            for k in ['tryHarder', 'tryRotate', 'tryInvert', 'tryDownscale', 'isPure', 'returnErrors']:
                require(e[k] == opts[k], 'Measured reader option differs: ' + k)
            # Both named fixed enums are first (zero) in pinned ReaderOptions.h.
            require((e['maxSymbols'], e['minLineCount'], e['binarizer'], e['eanAddon']) ==
                    (opts['maxNumberOfSymbols'], opts['minLineCount'], 0, 0), 'Measured limit/binarizer/addon differs')
        elif typ == 'layer':
            require((e['width'], e['height'], e['originalWidth'], e['originalHeight']) ==
                    (item['width'], item['height'], item['width'], item['height']), 'Unplanned scale/layer')
        elif typ == 'bitmap-pass':
            require(e['close'] == e['invert'] == 0 and not e['bitmapInverted']
                    and e['remainingBudget'] == profile['options']['maxNumberOfSymbols'], 'Unplanned bitmap transform/budget')
        elif typ == 'reader-dispatch':
            require(e['readerOrdinal'] == 0 and not e['inverted'] and not e['supportsInversion']
                    and e['remainingBudget'] == profile['options']['maxNumberOfSymbols'], 'Unplanned top-level reader')
        elif typ == 'oned-pass-begin':
            close_pass(); row = direction = attempt = None
            require(e['pass'] == len(passes) + 1 and e['rotate'] == bool(passes), 'Unexpected 1D pass sequence')
            require(len(passes) < 2, 'Unplanned extra 1D pass')
            width, height = (item['height'], item['width']) if e['rotate'] else (item['width'], item['height'])
            require((e['scanWidth'], e['scanHeight']) == (width, height), 'Unexpected rotated dimensions')
            require(e['tryHarder'] == profile['options']['tryHarder'] and not e['isPure'], 'Pass options differ')
            if not passes:
                expected_max = profile['options']['maxNumberOfSymbols']
            else:
                require(orientation_gates and orientation_gates[-1]['willRotate'], 'Rotated pass without positive gate')
                expected_max = profile['options']['maxNumberOfSymbols'] - len(passes[0]['outputGroups'])
            require(e['maxSymbols'] == expected_max and e['minLineCount'] == min(2, height), 'Pass budget/support differs')
            active = {'pass': e['pass'], 'rotate': e['rotate'], 'beginSeq': e['seq'], 'schedule': Schedule(e),
                      'rows': [], 'outputGroups': [], 'exitReason': None, 'maxSymbols': e['maxSymbols']}
            passes.append(active); live = []; support_drops = set(); phase = 'search'
        elif typ in ['schedule-out-of-bounds', 'check-row-out-of-bounds']:
            active['schedule'].out_of_bounds(e)
        elif typ == 'row-attempt':
            close_row(); attempt = direction = None
            active['schedule'].attempted(e)
            require(e['rowId'] == len(rows) + 1, 'Nonsequential global row ID')
            row = {k: e[k] for k in ['seq', 'pass', 'rowId', 'rowNumber', 'iteration', 'checkRow', 'pendingCheckRows', 'rotate']}
            row['directions'] = []; rows.append(row); active['rows'].append(row['rowId'])
        elif typ == 'row-binarizer':
            require(row is not None and row.get('binarizer') is None, 'Duplicate/missing row context for histogram')
            require(e['rotation'] == (90 if e['rotate'] else 0), 'Unexpected binarizer rotation')
            require((e['luminanceWidth'], e['luminanceHeight']) == (active['schedule'].width, active['schedule'].height), 'Histogram dimensions differ')
            require(len(e['histogram']) == 32 and sum(e['histogram']) == active['schedule'].width, 'Histogram does not cover full row')
            row['binarizer'] = {'seq': e['seq'], 'threshold': e['threshold']}
        elif typ == 'row-binarizer-reject':
            row['binarizerReject'] = e['seq']
        elif typ == 'row-runs':
            require(all(isinstance(n, int) and n >= 0 for n in e['runs']) and sum(e['runs']) == active['schedule'].width, 'Run lengths do not span scan width')
            row['runsSeq'] = e['seq']; row['runCount'] = len(e['runs'])
        elif typ == 'row-direction':
            close_attempt(); attempt = None
            expected = mapping(item['width'], item['height'], row['rowNumber'], e['rotate'], e['reverse'])
            require(tuple(e[k] for k in ['originX', 'originY', 'xStep', 'yStep']) == expected, 'Full-resolution affine map differs')
            require((e['layerWidth'], e['layerHeight']) == (item['width'], item['height']), 'Unplanned resized layer')
            require(e['rowId'] == row['rowId'] and e['rowNumber'] == row['rowNumber'], 'Direction row mismatch')
            direction = {k: e[k] for k in ['seq', 'reverse', 'originX', 'originY', 'xStep', 'yStep']}
            direction['attempts'] = []; row['directions'].append(direction)
        elif typ == 'decode-attempt':
            close_attempt()
            require(direction is not None and e['attempt'] == len(attempts) + 1 and e['reader'] == 0, 'Unexpected attempt/reader')
            attempt = {k: e[k] for k in ['seq', 'pass', 'rowId', 'rowNumber', 'attempt', 'rotate', 'reverse']}
            attempt.update({'guardTests': 0, 'digitVarianceRefs': [], 'checksRejected': [], 'parserAcceptedRows': [], 'leftGuardCandidates': [], 'comparisons': []})
            attempts.append(attempt); direction['attempts'].append(e['attempt'])
        elif typ == 'ean-dispatch':
            require(e['readEAN13'] and not any(e[k] for k in ['readUPCA', 'readEAN8', 'readUPCE']), 'Unplanned parser format scope')
        elif typ == 'left-guard-found':
            attempt['leftGuardCandidates'].append({'candidate': e['candidate'], 'seq': e['seq']})
        elif typ == 'guard-test':
            attempt['guardTests'] += 1
        elif typ == 'digit-variances':
            verify_digit_bits(e)
            attempt['digitVarianceRefs'].append({'seq': e['seq'], 'selected': e['selected'], 'patternCount': e['patternCount']})
        elif typ == 'candidate-check-reject':
            attempt['checksRejected'].append({k: e[k] for k in ['seq', 'function', 'condition', 'exitSite', 'partialText']})
        elif typ == 'checksum':
            attempt['checksum'] = {k: e[k] for k in ['seq', 'text', 'valid', 'formatBeforeAlias']}
        elif typ == 'ean-accepted-row':
            attempt['parserAcceptedRows'].append({k: e[k] for k in ['seq', 'text', 'format', 'error', 'x0', 'x1', 'addon']})
        elif typ == 'decode-return':
            require('return' not in attempt, 'Duplicate decode return')
            attempt['return'] = {k: e[k] for k in ['seq', 'format', 'valid', 'error', 'rawPosition', 'bytes']}
            require(e['valid'] == bool(e['format'] and e['bytes'] and not e['error']), 'Raw validity formula differs')
        elif typ == 'collector-candidate':
            require(attempt['return']['valid'] and e['lineCount'] == 1, 'Unexpected collector eligibility')
            require(e['position'] == mapped_line(attempt['return']['rawPosition'], direction, row['rowNumber']), 'Mapped collector position differs')
            attempt['contribution'] = {k: attempt[k] for k in ['pass', 'rowId', 'rowNumber', 'attempt', 'rotate', 'reverse']}
            attempt['contribution'].update({'seq': e['seq'], 'position': position(e['position']),
                                             'wholePngPlacements': placement_memberships(e['position'], item)})
        elif typ == 'collector-compare':
            g = groups[e['group']]
            require(e['group'] in live and e['groupPosition'] == g['currentPosition']
                    and e['groupBytes'] == g['bytes'] and e['incomingPosition'] == attempt['contribution']['position'], 'Comparison group state differs')
            require(len(attempt['comparisons']) < len(live) and live[len(attempt['comparisons'])] == e['group']
                    and not any(c['result'] for c in attempt['comparisons']) and isinstance(e['decision'], bool), 'Comparison order/decision differs')
            attempt['comparisons'].append({'seq': e['seq'], 'group': e['group'], 'result': e['decision']})
        elif typ == 'collector-insert':
            require(e['group'] == len(groups) + 1 and e['index'] == len(live) and e['lineCount'] == 1, 'Unexpected inserted group ID/index/support')
            require(len(attempt['comparisons']) == len(live) and not any(c['result'] for c in attempt['comparisons']), 'Insert before exhausted unsuccessful comparisons')
            require(e['bytes'] == attempt['return']['bytes'] and e['format'] == attempt['return']['format']
                    and e['position'] == attempt['contribution']['position'], 'Inserted candidate differs')
            g = {'group': e['group'], 'pass': e['pass'], 'bytes': e['bytes'], 'format': e['format'], 'insertSeq': e['seq'],
                 'currentPosition': e['position'], 'currentSupport': 1, 'currentFormat': e['format'],
                 'contributions': [attempt['contribution']], 'transitions': [{'seq': e['seq'], 'event': typ}], 'terminalReason': None}
            groups[e['group']] = g; live.append(e['group']); attempt['collectorDecision'] = {'event': typ, 'group': e['group'], 'seq': e['seq']}
        elif typ == 'collector-merge':
            g = groups[e['group']]
            require(attempt['comparisons'] and attempt['comparisons'][-1]['group'] == e['group']
                    and attempt['comparisons'][-1]['result'], 'Merge lacks matching positive comparison')
            require(e['index'] < len(live) and live[e['index']] == e['group'] and e['supportBefore'] == g['currentSupport']
                    and e['positionBefore'] == g['currentPosition'] and e['incomingPosition'] == attempt['contribution']['position'], 'Premerge group state differs')
            pending_merge = e
        elif typ == 'collector-merged':
            require(pending_merge and pending_merge['group'] == e['group'], 'Unpaired merge completion')
            g = groups[e['group']]; incoming = attempt['contribution']['position']; before = g['currentPosition']
            require(e['supportAfter'] == g['currentSupport'] + 1, 'Merge support increment differs')
            require(e['positionAfter'] in [incoming[:2] + before[2:], before[:2] + incoming[2:]], 'Merge envelope contains unexpected points')
            g['currentSupport'] = e['supportAfter']; g['currentPosition'] = e['positionAfter']; g['contributions'].append(attempt['contribution'])
            g['transitions'].append({'seq': e['seq'], 'event': typ, 'support': e['supportAfter'], 'position': e['positionAfter']})
            attempt['collectorDecision'] = {'event': typ, 'group': e['group'], 'seq': e['seq']}; pending_merge = None
        elif typ == 'collector-reject-invalid':
            require(not attempt['return']['valid'] and e['format'] == attempt['return']['format'], 'Unexpected invalid-candidate rejection')
            attempt['collectorDecision'] = {'event': typ, 'seq': e['seq']}
        elif typ == 'cursor-advance':
            attempt['cursorAdvanceSeq'] = e['seq']
        elif typ == 'check-rows-replaced':
            require(attempt['collectorDecision']['event'] == 'collector-insert', 'Check rows without insert')
            active['schedule'].replace(e)
        elif typ == 'oned-budget-exit':
            require(e['maxSymbols'] == active['schedule'].maximum and e['groupsBeforePrune'] == len(live), 'Budget/group count differs')
            require(sum(groups[g]['currentSupport'] >= active['schedule'].minimum for g in live) == e['maxSymbols'], 'Early exit without reached support budget')
            require(e['pendingCheckRows'] == active['schedule'].stack and e['iteration'] == row['iteration'], 'Budget exit schedule differs')
            active['schedule'].reason = active['exitReason'] = typ; active['budgetExitSeq'] = e['seq']; attempt['budgetExit'] = e['seq']
        elif typ == 'oned-search-end':
            require(e['groupsBeforePrune'] == len(live) and pending_merge is None, 'Search-end group/merge mismatch')
            active['schedule'].end(e); active['exitReason'] = active['schedule'].reason
            close_row(); row = direction = attempt = None
            active['searchEndSeq'] = e['seq']; phase = 'support-prune'
        elif typ == 'collector-drop-support':
            require(phase == 'support-prune' and e['group'] in live and e['index'] == live.index(e['group']), 'Support-prune index differs')
            g = groups[e['group']]
            require(e['lineCount'] == g['currentSupport'] and e['required'] == active['schedule'].minimum, 'Support-prune data differs')
            support_drops.add(e['group']); g['transitions'].append({'seq': e['seq'], 'event': typ})
        elif typ == 'collector-drop-overlap':
            support_prune(); a, b = groups[e['aGroup']], groups[e['bGroup']]
            require(e['aGroup'] in live and e['bGroup'] in live, 'Unknown overlap group')
            require((e['aSupport'], e['bSupport'], e['aPosition'], e['bPosition']) ==
                    (a['currentSupport'], b['currentSupport'], a['currentPosition'], b['currentPosition']), 'Overlap group state differs')
            require(e['dropGroup'] == (e['aGroup'] if e['aSupport'] < e['bSupport'] else e['bGroup']), 'Overlap support/tie drop differs')
            g = groups[e['dropGroup']]; g['transitions'].append({'seq': e['seq'], 'event': typ, 'otherGroup': e['bGroup'] if e['dropGroup'] == e['aGroup'] else e['aGroup']})
            g['terminalReason'] = 'overlap-discard'; g['currentSupport'] = 0; g['currentFormat'] = 0; g['currentPosition'] = [[0, 0]] * 4
        elif typ == 'collector-output':
            overlap_prune(); require(e['index'] == len(active['outputGroups']) and live[e['index']] == e['group'], 'Collector output index differs')
            g = groups[e['group']]
            require((e['lineCount'], e['position'], e['bytes'], e['format']) ==
                    (g['currentSupport'], g['currentPosition'], g['bytes'], g['currentFormat']), 'Collector output state differs')
            g['output'] = {k: e[k] for k in ['seq', 'index', 'lineCount', 'position', 'bytes', 'format']}
            active['outputGroups'].append(e['group'])
        elif typ == 'orientation-gate':
            close_pass()
            require(not e['rotate'] and e['horizontalCount'] == len(passes[0]['outputGroups']), 'Orientation horizontal count differs')
            require(e['maxSymbols'] == profile['options']['maxNumberOfSymbols'] and e['tryRotate']
                    and e['willRotate'] == (e['horizontalCount'] < e['maxSymbols']), 'Orientation decision differs')
            orientation_gates.append(e)
        elif typ == 'reader-sorted-output':
            close_pass(); require(e['index'] == len(reader_outputs), 'Sorted output index differs'); reader_outputs.append(e)
        elif typ == 'reader-return':
            close_pass(); require(e['countBeforeErrorFilter'] == sum(len(p['outputGroups']) for p in passes), 'Raw reader return count differs')
        elif typ == 'reader-budget-exit':
            total = sum(len(p['outputGroups']) for p in passes)
            require(e['count'] == total and e['remainingBudget'] == profile['options']['maxNumberOfSymbols'] - total
                    and e['remainingBudget'] <= 0, 'Top-level reader budget exit differs')
        elif typ == 'bitmap-result':
            require(e['count'] == len(reader_outputs), 'Bitmap result multiplicity differs')
        elif typ == 'global-candidate':
            require(e['ordinal'] == len(global_candidates), 'Global candidate ordinal differs'); global_candidates.append(e)
            r = reader_outputs[e['ordinal']]
            require(all(e[k] == r[k] for k in ['position', 'format', 'lineCount']), 'Global candidate differs from reader output')
        elif typ == 'global-insert':
            require(e['index'] == len(global_inserts) and e['budgetBefore'] == profile['options']['maxNumberOfSymbols'] - len(global_inserts), 'Global insertion budget differs')
            global_inserts.append(e)
        elif typ == 'global-budget-exit':
            require(e['count'] == len(global_inserts) and e['remainingBudget'] == profile['options']['maxNumberOfSymbols'] - len(global_inserts)
                    and e['remainingBudget'] <= 0, 'Global budget exit differs')
        elif typ in ['pure-reader-skip', 'format-exclusion-reject', 'addon-required-reject', 'reader-discard-error']:
            raise ValueError('Unplanned policy event in fixed EAN13/no-errors/ignore-addon profile: ' + typ)
    close_pass()
    require(len(orientation_gates) == 1 and len(passes) == (2 if orientation_gates[0]['willRotate'] else 1), 'Orientation/pass count mismatch')
    expected = Counter((tuple(map(tuple, groups[g]['output']['position'])), groups[g]['format'], groups[g]['output']['lineCount'])
                       for p in passes for g in p['outputGroups'])
    observed = Counter((tuple(map(tuple, e['position'])), e['format'], e['lineCount']) for e in reader_outputs)
    require(expected == observed, 'Sorted reader outputs differ from all collector outputs')
    for g in groups.values():
        require(len(g['contributions']) >= 1 and (g['currentSupport'] == len(g['contributions']) or g['terminalReason'] == 'overlap-discard'), 'Group contribution/support mismatch')
        g['wholePngPlacementIndices'] = sorted({m['placementIndex'] for c in g['contributions'] for m in c['wholePngPlacements']})
    classification = {'attempts': len(attempts), 'collectorEligible': sum(a['return']['valid'] for a in attempts),
                      'collectorRejectedInvalid': sum(a['collectorDecision']['event'] == 'collector-reject-invalid' for a in attempts),
                      'parserReturnedRows': sum(len(a['parserAcceptedRows']) for a in attempts),
                      'parserReturnedChecksumErrors': sum(r['error'] for a in attempts for r in a['parserAcceptedRows']),
                      'checksumPasses': sum(a.get('checksum', {}).get('valid') is True for a in attempts),
                      'checksumFailures': sum(a.get('checksum', {}).get('valid') is False for a in attempts),
                      'binarizerRejectedRows': sum(bool(r.get('binarizerReject')) for r in rows)}
    return {'profile': profile['id'], 'inputKey': profile['inputKey'], 'options': profile['options'], 'counts': dict(counts),
            'passes': passes, 'rows': rows, 'attempts': attempts, 'groups': list(groups.values()),
            'classification': classification,
            'globalInsertCount': len(global_inserts), 'readerOutputCount': len(reader_outputs),
            'samePayloadControl': item['id'] == 'two-same-payload-aligned-gap16'}

def load_events(path, plan, item, recorded):
    raw = path.read_bytes(); require(len(raw) <= 34 * 1024 * 1024 and raw.endswith(b'\n'), 'Trace cap/newline failure')
    lines = raw.splitlines(keepends=True); events = []
    patch = (plan['_root'] / 'actual-row-trace.patch').read_text(encoding='utf8')
    names = set(re.findall(r'\bQRT(?:_EAN|_BOOL)?\(\s*"([^"\n]+)"', patch)) | set(re.findall(r'\bEvent\s+\w+\(\s*"([^"\n]+)"', patch))
    require(len(lines) <= plan['bounds']['maxEventsPerCall'] + 1, 'Trace event cap failure')
    for i, line in enumerate(lines, 1):
        require(line.startswith(PREFIX) and len(line) < plan['bounds']['maxEventBytes'], 'Malformed/oversized trace line')
        e = json.loads(line[len(PREFIX):]); require(e['schema'] == 1 and e['seq'] == i and e['event'] in names, 'Trace schema/sequence/type failure'); events.append(e)
    first, last = events[0], events[-1]; counts = Counter(e['event'] for e in events)
    require(first['event'] == 'call-begin' and last['event'] == 'call-end' and counts['call-begin'] == counts['call-end'] == 1, 'Trace marker failure')
    require((first['width'], first['height'], first['maxEvents'], first['maxBytes'], first['maxLine']) ==
            (item['width'], item['height'], plan['bounds']['maxEventsPerCall'], plan['bounds']['maxBytesPerCall'], plan['bounds']['maxEventBytes']), 'Trace input/caps differ')
    require(last['dropped'] == last['oversized'] == 0 and last['priorBytes'] == len(raw) - len(lines[-1])
            and last['priorEvents'] == len(events) - 1 and last['priorBytes'] <= plan['bounds']['maxBytesPerCall'], 'Incomplete trace')
    for typ, key in [('row-attempt', 'rows'), ('decode-attempt', 'attempts'), ('left-guard-found', 'candidates'), ('collector-insert', 'groups'), ('oned-pass-begin', 'passes')]:
        require(counts[typ] == last[key], 'Trace counter mismatch: ' + key)
    require(recorded['bytes'] == len(raw) and recorded['events'] == len(events) and recorded['types'] == dict(counts), 'Recorded/raw trace differs')
    return events

def compare_trios(profiles):
    buckets = {}
    for p in profiles:
        key = (p['inputKey'], p['options']['tryHarder'])
        buckets.setdefault(key, {})[p['options']['maxNumberOfSymbols']] = p
    comparisons = []
    for (key, hard), by_max in buckets.items():
        require(set(by_max) == {1, 2, 255}, 'Incomplete max-symbol trio')
        schedules = {str(m): [[r[k] for k in ['pass', 'rowNumber', 'checkRow', 'rotate']] for r in p['rows']] for m, p in by_max.items()}
        diffs = []
        for a, b in [(1, 2), (1, 255), (2, 255)]:
            left, right = schedules[str(a)], schedules[str(b)]
            first = next((i for i, (x, y) in enumerate(zip(left, right)) if x != y), min(len(left), len(right)) if len(left) != len(right) else None)
            diffs.append({'leftMax': a, 'rightMax': b, 'firstDifferentScheduledRowIndex': first,
                          'leftRow': left[first] if first is not None and first < len(left) else None,
                          'rightRow': right[first] if first is not None and first < len(right) else None})
        comparisons.append({'inputKey': key, 'tryHarder': hard, 'schedules': schedules, 'firstDifferences': diffs,
                            'paths': {str(m): {'profile': p['profile'], 'passes': p['passes'], 'publicCount': p['publicCount'],
                                              'outputGroups': [g for g in p['groups'] if 'output' in g]} for m, p in by_max.items()}})
    require(len(comparisons) == 30, 'Expected exactly 30 input/effort trios')
    return comparisons

def main(args):
    require(len(args) == 3, 'Usage: python -X utf8 interpret.py FROZEN-V5-PACKAGE SUCCESSFUL-EXECUTION NEW-OUTPUT')
    root, execution, output = [Path(x).resolve() for x in args]
    require(not output.exists(), 'Use a new nonexistent output')
    for p in [root, execution, HERE]:
        require(not output.is_relative_to(p) and not p.is_relative_to(output), 'Output overlaps protected input/code')
    source_manifest_raw = (HERE / 'freeze-manifest.json').read_bytes()
    source_manifest = json.loads(source_manifest_raw)
    for f in source_manifest['files']: check_file(HERE, f)
    manifest_raw = (root / 'freeze-manifest.json').read_bytes(); require(sha(manifest_raw) == PREPARATION_MANIFEST, 'Unexpected v5 package')
    manifest = json.loads(manifest_raw)
    for f in manifest['files']: check_file(root, f)
    plan_raw = (root / 'frozen-plan.json').read_bytes(); plan = json.loads(plan_raw); plan['_root'] = root
    require(sha(plan_raw) == manifest['planSha256'], 'Plan pin mismatch')
    inventory = read_json(execution / 'execution-file-inventory.json')
    for f in inventory['files']: check_file(execution, f)
    require(set(f['path'] for f in inventory['files']) == {p.relative_to(execution).as_posix() for p in execution.rglob('*') if p.is_file() and p.name != 'execution-file-inventory.json'}, 'Execution inventory incomplete')
    summary = read_json(execution / 'summary.json'); binding = read_json(execution / 'execution-binding.json')
    require(summary['status'] == PASSED and summary['completedProfiles'] == summary['completeTraces'] == summary['plannedProfiles'] == 90, 'Full 90-profile gate has not passed')
    require(summary['readerCalls'] == 180 and summary['engineCalls'] == {'baseline': 90, 'instrumented': 90}, 'Paired calls incomplete')
    require(all(summary[k] == 0 for k in ['outputMismatches', 'inputMutations', 'readerErrors', 'transportFailures']) and summary['outOfCallErrors'] == [], 'Execution failure')
    require(binding['planSha256'] == sha(plan_raw) and binding['runnerSha256'] == sha((root / 'run-paired.mjs').read_bytes())
            and binding['status'] == 'successful-compiled-builds-bound' and binding['workflowRun']['conclusion'] == 'success', 'Execution binding mismatch')
    require(binding['patchSha256'] == sha((root / 'actual-row-trace.patch').read_bytes()), 'Execution patch mismatch')
    reuse = read_json(root / 'compiled-build-reuse-amendment.json')
    require(binding['preparationManifestSha256'] == PREPARATION_MANIFEST and
            all(binding.get(k) == reuse[k] for k in reuse['requiredV5BindingFields']), 'Explicit v5-to-v4 compiled-build reuse mismatch')
    require(binding['workflowRun'] == reuse['workflowRun'] and
            all(binding[k].get(field) == value for k in ['baseline', 'instrumented'] for field, value in reuse['variants'][k].items()),
            'Reused successful workflow/artifact identity differs')
    allowed = {binding[k]['wasmSha256'] for k in ['baseline', 'instrumented']}
    require({r['sha256'] for r in summary['instantiated']} == allowed, 'Instantiated WASM mismatch')
    raw_records = gzip.decompress((execution / 'paired-records.jsonl.gz').read_bytes())
    records = [json.loads(line) for line in raw_records.splitlines()]
    require(len(records) == len(plan['profiles']) == 90 and len(plan['inputs']) == 15, 'Frozen matrix count mismatch')
    items = {x['key']: x for x in plan['inputs']}; analyses = []
    for item in items.values():
        require(sha(Path(item['sourcePath']).read_bytes()) == item['sourceSha256']
                and sha(Path(item['transportPath']).read_bytes()) == item['transportSha256'], 'Frozen input file changed: ' + item['key'])
    for i, (record, profile) in enumerate(zip(records, plan['profiles'])):
        require((record['profile'], record['inputKey'], record['options']) == (profile['id'], profile['inputKey'], profile['options']), 'Exact ordered profile mismatch')
        require(record['equal'] and record['traceComplete'] and record['results']['baseline'] == record['results']['instrumented'], 'Per-profile public gate failed')
        baseline = execution / 'traces' / f'{i:03d}-baseline.stderr.jsonl'
        require(baseline.read_bytes() == b'' and record['trace']['baseline']['bytes'] == 0, 'Baseline unexpectedly traced')
        events = load_events(execution / 'traces' / f'{i:03d}-instrumented.stderr.jsonl', plan, items[profile['inputKey']], record['trace']['instrumented'])
        analysis = interpret_events(events, profile, items[profile['inputKey']])
        require(all(analysis['counts'].get(k) == 1 for k in ['options', 'layer', 'bitmap-pass', 'reader-dispatch', 'reader-return', 'bitmap-result']), 'Unplanned reader/layer/bitmap count')
        public = plain(record['results']['baseline']); require(isinstance(public, list), 'Expected public result array')
        require(len(public) == analysis['globalInsertCount'], 'Public multiplicity differs from global inserts')
        analysis['publicCount'] = len(public); analysis['recordedPublicResults'] = record['results']['baseline']; analyses.append(analysis)
    comparisons = compare_trios(analyses)
    # No output directory or interpreted records exist until every reconstruction passes.
    output.mkdir(parents=True)
    def save(name, value): (output / name).write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
    result = {'scope': 'File-only actual trace reconstruction after all 90 unchanged-policy public conformance gates. No recognition.',
              'status': 'all-90-transport-and-reconstruction-checks-passed', 'profiles': 90, 'trios': 30,
              'counts': dict(sum((Counter(p['counts']) for p in analyses), Counter())),
              'classification': dict(sum((Counter(p['classification']) for p in analyses), Counter())),
              'samePayloadControlProfiles': [{'profile': p['profile'], 'publicCount': p['publicCount'],
                  'groups': [{'group': g['group'], 'supportContributions': len(g['contributions']), 'placementIndices': g['wholePngPlacementIndices'], 'terminalReason': g['terminalReason'], 'output': g.get('output')} for g in p['groups']]} for p in analyses if p['samePayloadControl']],
              'sourcePins': {'preparationManifestSha256': sha(manifest_raw), 'planSha256': sha(plan_raw),
                  'executionInventorySha256': sha((execution / 'execution-file-inventory.json').read_bytes()),
                  'pairedRecordsDecompressedSha256': sha(raw_records), 'analysisCodeSha256': sha(Path(__file__).read_bytes())},
              'readerImports': 0, 'recognitionCalls': 0,
              'limitations': ['Positions are scanline-support envelopes; no complete physical-support mask.',
                  'Whole-PNG placement membership is descriptive, including original quiet padding.',
                  'Known examples and controls are diagnostic, not held-out accuracy evidence.',
                  'Profile-local group IDs are not physical identities across calls.',
                  'Max1/max2/max255 alter observed acquisition/aggregation; no truncation assumption.',
                  'No threshold, filter, alternate digit search, majority or expected-truth correction selected.']}
    result['sourcePins']['analysisManifestSha256'] = sha(source_manifest_raw)
    (output / 'profile-analysis.jsonl.gz').write_bytes(gzip.compress(('\n'.join(json.dumps(p, separators=(',', ':')) for p in analyses) + '\n').encode(), compresslevel=9, mtime=0))
    save('comparisons.json', comparisons); save('summary.json', result)
    save('analysis-file-inventory.json', {'files': [{'path': p.name, 'bytes': len(p.read_bytes()), 'sha256': sha(p.read_bytes())} for p in sorted(output.iterdir()) if p.is_file()]})
    print(json.dumps({'status': result['status'], 'profiles': 90, 'trios': 30, 'output': str(output), 'recognitionCalls': 0}))

if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as exc:
        print(json.dumps({'status': 'file-only-reconstruction-failed-no-interpretation',
                          'failure': str(exc), 'readerImports': 0, 'recognitionCalls': 0}), file=sys.stderr)
        raise SystemExit(1)
