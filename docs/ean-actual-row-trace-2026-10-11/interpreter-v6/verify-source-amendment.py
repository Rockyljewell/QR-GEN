"""File-only narrow schema amendment audit; no actual trace or engine imports."""
from pathlib import Path
import ast, hashlib, json, re
HERE=Path(__file__).resolve().parent
ART=HERE.parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def verify_freeze(root,pin):
    raw=(root/'freeze-manifest.json').read_bytes()
    assert sha(raw)==pin
    for f in json.loads(raw)['files']:
        b=(root/f['path']).read_bytes()
        assert len(b)==f['bytes'] and sha(b)==f['sha256'],f['path']
    return raw
old=ART/'ean-actual-row-trace-analysis-v5'
old_raw=verify_freeze(old,'e57aff951d5de62da7c8695a86c7e794014973de045f578d951cc5783207568d')
assert old_raw==(HERE/'previous-v5-freeze-manifest.json').read_bytes()
original_raw=verify_freeze(ART/'ean-actual-row-trace-analysis','ac8b67b5abe8cd598c29496950bfa2c64fe1741714f3427f7907878450ed234b')
assert original_raw==(HERE/'previous-original-freeze-manifest.json').read_bytes()
prep=ART/'ean-actual-row-trace-v5'
verify_freeze(prep,'136216bb38f48aff447ef6408496bde8f19b2edfdc58e03064be479563fc5cb9')
before=(old/'interpret.py').read_bytes(); after=(HERE/'interpret.py').read_bytes()
changes=[(b"and isinstance(e['result'], bool)",b"and isinstance(e['decision'], bool)"),
         (b"attempt['comparisons'].append({k: e[k] for k in ['seq', 'group', 'result']})",
          b"attempt['comparisons'].append({'seq': e['seq'], 'group': e['group'], 'result': e['decision']})")]
expected=before
for a,b in changes:
    assert expected.count(a)==1
    expected=expected.replace(a,b)
assert expected==after,'Any source change beyond the two raw-field normalization lines is forbidden'
fixture=json.loads((HERE/'collector-compare-schema-fixture.json').read_bytes())
for f in fixture['producers']:
    assert sha((prep/f['path']).read_bytes())==f['sha256']
header=(prep/'QRGenRowTrace.h').read_text(encoding='utf-8')
lines=header.splitlines()
assert '#define QRT_BOOL(NAME, VALUE, BODY)' in lines[157]
assert 'qrt.boolean("decision", qrtDecision)' in lines[157]
assert lines[163]=='#define QRT_BOOL(NAME, VALUE, BODY) (VALUE)'
# Enumerate every call site across the exact retained instrumented source tree.
# Definitions in headers are excluded, not mistaken for invocations.
invocations=[]
for p in sorted((prep/'instrumented-source').rglob('*')):
    if not p.is_file():continue
    text=p.read_text(encoding='utf-8')
    for n,line in enumerate(text.splitlines(),1):
        if re.search(r'\bQRT_BOOL\s*\(',line) and not line.lstrip().startswith('#define'):
            invocations.append({'path':p.relative_to(prep).as_posix(),'line':n,'source':line.strip(),'sha256':sha(p.read_bytes())})
assert len(invocations)==1 and invocations[0]['line']==220
assert invocations[0]['path']=='instrumented-source/core/src/oned/ODReader.cpp'
assert 'QRT_BOOL("collector-compare", result == other,' in invocations[0]['source']
hook=(prep/invocations[0]['path']).read_text(encoding='utf-8').splitlines()
producer_body='\n'.join(hook[219:222])
fields={'decision'}|set(re.findall(r'qrt\.(?:number|position|array)\("([^"\n]+)"',producer_body))
# The fixed common prefix is supplied by Event(), independent of interpreter reads.
common={'schema','event'}|set(re.findall(r'(?:number|boolean)\("([^"\n]+)"','\n'.join(lines[56:62])))
assert fields==set(fixture['expectedHookKeys']) and common==set(fixture['expectedCommonKeys'])
for record in fixture['records'].values():
    assert set(record)==common|fields and 'result' not in record and type(record['decision']) is bool
# All raw event-field reads in the sole QRT_BOOL branch must come from its producer.
tree=ast.parse(after.decode('utf-8'))
func=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='interpret_events')
branch=next(n for n in ast.walk(func) if isinstance(n,ast.If) and ast.unparse(n.test)=="typ == 'collector-compare'")
raw_keys={n.slice.value for body in branch.body for n in ast.walk(body)
          if isinstance(n,ast.Subscript) and isinstance(n.value,ast.Name) and n.value.id=='e'
          and isinstance(n.slice,ast.Constant) and isinstance(n.slice.value,str)}
assert raw_keys<=common|fields and 'decision' in raw_keys and 'result' not in raw_keys
assert 'e.real("result", result)' in lines[131] # Legitimate numeric guard result is separate.
print(json.dumps({'scope':'Exact prior freezes, two-line raw decision to internal result normalization and every pinned QRT_BOOL consumer; file-only.',
 'checks':['original-analysis-freeze-unchanged','analysis-v5-nine-entry-freeze-unchanged','exact-v5-preparation-freeze-unchanged',
           'only-two-raw-schema-normalization-lines-differ','sole-QRT_BOOL-call-site-enumerated',
           'fixture-keys-extracted-from-actual-producers','all-QRT_BOOL-raw-consumer-fields-valid','numeric-guard-result-remains-distinct'],
 'invocations':invocations,'consumerRawKeys':sorted(raw_keys),'commonKeys':sorted(common),'hookKeys':sorted(fields),
 'previousAnalysisManifestSha256':sha(old_raw),'analysisCodeSha256':sha(after),
 'readerImports':0,'recognitionCalls':0,'actualTracePayloadReads':0}))
