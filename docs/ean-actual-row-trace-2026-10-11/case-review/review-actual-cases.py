"""Bounded file-only case review; imports no reader or full trace interpreter.
CLI: python -X utf8 -B review-actual-cases.py PREPARATION DERIVED EXECUTION NEW-RESULT
"""
from pathlib import Path
from collections import Counter, defaultdict
import gzip, hashlib, itertools, json, re, sys
sha=lambda b:hashlib.sha256(b).hexdigest()
PREP='136216bb38f48aff447ef6408496bde8f19b2edfdc58e03064be479563fc5cb9'
DERIVED='5cc9cca49ed05efed7c2a28085aa92dbe80ff6ba80a87926a20aedaa98ec0a6b'
CODE='18a5cc534254bd05c439d05d4cf9bfdfae60388811a578c15a70b23314f98e41'
inputs=[]
def read(root,name,role):
    p=root/name;b=p.read_bytes();inputs.append({'role':role,'path':name,'bytes':len(b),'sha256':sha(b)})
    return b
def text(g):return bytes(g['bytes']).decode('ascii')
def group_summary(g):
    return {'group':g['group'],'text':text(g),'support':len(g['contributions']),
            'contributions':g['contributions'],'returnedPosition':g.get('output',{}).get('position'),
            'terminalReason':g['terminalReason']}
def control_summary(p):
    groups=[]
    for g in p['groups']:
        support=Counter(str(m['placementIndex']) for c in g['contributions'] for m in c['wholePngPlacements'])
        rows=sorted({c['rowNumber'] for c in g['contributions']})
        gaps=[{'before':a,'after':b,'unobservedSupportRowsBetween':b-a-1} for a,b in zip(rows,rows[1:]) if b-a>1]
        groups.append({'group':g['group'],'text':text(g),'support':len(g['contributions']),
                       'supportByWholePngPlacement':dict(support),'distinctRows':len(rows),
                       'largestGapBetweenSupportingRows':max(gaps,key=lambda q:q['unobservedSupportRowsBetween']) if gaps else None,
                       'returnedPosition':g.get('output',{}).get('position'),'terminalReason':g['terminalReason']})
    return {'profile':p['profile'],'scheduledRows':len(p['rows']),'publicCount':p['publicCount'],'groups':groups}
def main(args):
    assert len(args)==4,'PREPARATION DERIVED EXECUTION NEW-RESULT'
    prep,derived,execution,out=map(lambda x:Path(x).resolve(),args)
    assert not out.exists(),'Use a new result file'
    assert sha(read(prep,'freeze-manifest.json','preparation'))==PREP
    summary=json.loads(read(derived,'summary.json','derived'))
    assert summary['status']=='all-90-transport-and-reconstruction-checks-passed'
    assert summary['profiles']==90 and summary['trios']==30 and summary['sourcePins']['analysisCodeSha256']==CODE
    raw=read(derived,'profile-analysis.jsonl.gz','derived');assert sha(raw)==DERIVED
    profiles=[json.loads(x) for x in gzip.decompress(raw).splitlines()];assert len(profiles)==90
    comparisons=json.loads(read(derived,'comparisons.json','derived'));assert len(comparisons)==30
    plan=json.loads(read(prep,'frozen-plan.json','preparation'));assert len(plan['inputs'])==15 and len(plan['profiles'])==90
    od=read(prep,'instrumented-source/core/src/oned/ODReader.cpp','source').decode('utf-8')
    upcean=read(prep,'instrumented-source/core/src/oned/ODMultiUPCEANReader.cpp','source').decode('utf-8')
    assert 'maxSymbols == 1 ? 256 : 512' in od and 'maxSymbols - Size(resH)' in od
    assert 'other.position[2] = result.position[2]' in od and 'other.position[0] = result.position[0]' in od
    parity=[int(x.strip(),16) for x in re.search(r'FIRST_DIGIT_ENCODINGS\[\] = \{([^}]+)',upcean).group(1).split(',')]
    assert len(parity)==10
    focus=[];contracts=[]
    for i,p in enumerate(profiles):
        if not any(k in p['inputKey'] for k in ['1-35','2-07']):continue
        assert p['profile']==plan['profiles'][i]['id']
        focus.append({'index':i,'profile':p['profile'],'scheduledRows':len(p['rows']),'attempts':len(p['attempts']),
            'passes':[{k:x[k] for k in ['pass','rotate','maxSymbols','exitReason','outputGroups']}|{'scheduledRows':len(x['rows'])} for x in p['passes']],
            'groups':[group_summary(g) for g in p['groups']]})
        for g in p['groups']:
            before=g['contributions'][0]['position'];axis=0 if g['contributions'][0]['rotate'] else 1
            span=lambda pos:[min(q[axis] for q in pos),max(q[axis] for q in pos)]
            for t in g['transitions']:
                if 'position' not in t:continue
                after=t['position']
                if span(after)[0]>span(before)[0] or span(after)[1]<span(before)[1]:
                    contracts.append({'index':i,'profile':p['profile'],'group':g['group'],'text':text(g),
                                      'seq':t['seq'],'before':before,'after':after,'axis':axis,
                                      'beforeSpan':span(before),'afterSpan':span(after),
                                      'allContributionRows':[c['rowNumber'] for c in g['contributions']]})
                before=after
    scores=[];scheduler=[]
    for i in [5,11,16,17,22,23]:
        p=profiles[i];wanted={c['attempt'] for g in p['groups'] for c in g['contributions']
                             if text(g) in ['7034759003930','0798884816632']}
        events=defaultdict(list);terminal=[]
        raw=read(execution,f'traces/{i:03d}-instrumented.stderr.jsonl','bounded-raw-spotcheck')
        for line in raw.splitlines():
            assert line.startswith(b'QRGEN_ROW_TRACE ')
            e=json.loads(line[len(b'QRGEN_ROW_TRACE '):])
            if i in [5,11,17,23] and e.get('attempt') in wanted:events[e['attempt']].append(e)
            if i in [16,22] and e['event'] in ['oned-pass-begin','schedule-out-of-bounds','oned-search-end']:
                terminal.append(e)
        if i in [16,22]:
            rotate=[e for e in terminal if e['event']=='oned-pass-begin' and e['rotate']];assert len(rotate)==1
            r=rotate[0];assert (r['scanHeight'],r['rowStep'],r['maxSymbols'])==(640,2,1)
            bounds=[e for e in terminal if e['event']=='schedule-out-of-bounds'];assert len(bounds)==1
            b=bounds[0];assert (b['iteration'],b['proposedRow'],b['pendingCheckRows'])==(320,640,[])
            rows=[r['rowNumber'] for r in p['rows'] if r['rotate']]
            assert len(rows)==320 and set(rows)==set(range(0,640,2)) and rows[-1]==0
            scheduler.append({'index':i,'profile':p['profile'],'totalRows':len(p['rows']),
                              'rotatedRows':len(rows),'coversEveryEvenRow':True,'lastRotatedRow':rows[-1],
                              'terminalEvents':terminal})
        for attempt,es in events.items():
            accepted=[e for e in es if e['event']=='ean-accepted-row'];assert accepted
            last=accepted[-1];candidate=last['candidate']
            ds=[e for e in es if e['event']=='digit-variances' and e['candidate']==candidate]
            assert len(ds)==12 and [d['patternCount'] for d in ds]==[20]*6+[10]*6
            choices=[];digit_evidence=[]
            for ordinal,d in enumerate(ds):
                vs=d['variances'][:d['patternCount']]
                numbers=[(j,v) for j,v in enumerate(vs) if type(v) in [int,float]]
                best=min(v for j,v in numbers);cs=[j for j,v in numbers if v==best]
                assert best<.48 and d['selected']==cs[0]
                choices.append(cs);digit_evidence.append({'ordinal':ordinal,'seq':d['seq'],'selected':d['selected'],
                                                         'bestVariance':best,'exactBestPatterns':cs})
            count=1
            for cs in choices:count*=len(cs)
            assert count<=64,'Bounded whole-word enumeration only'
            parity_words=set();valid=set()
            for digits in itertools.product(*choices):
                bits=sum((v>=10)<<(5-j) for j,v in enumerate(digits[:6]))
                if bits not in parity:continue
                word=str(parity.index(bits))+''.join(str(v%10) for v in digits);parity_words.add(word)
                if sum(int(x)*(1 if j%2==0 else 3) for j,x in enumerate(word))%10==0:valid.add(word)
            checks=[{k:e[k] for k in ['seq','text','valid','formatBeforeAlias']} for e in es
                    if e['event']=='checksum' and e['candidate']==candidate]
            assert checks and checks[-1]['valid'] and last['text'] in valid
            scores.append({'index':i,'profile':p['profile'],'attempt':attempt,'row':last['rowNumber'],
                           'rotate':last['rotate'],'candidate':candidate,
                           'accepted':{k:last[k] for k in ['seq','text','error','x0','x1','format']},
                           'checksumEvents':checks,'digits':digit_evidence,'equalBestCombinationCount':count,
                           'parityValidWords':sorted(parity_words),'checksumValidWords':sorted(valid)})
    assert len(scores)==12 and len(scheduler)==2 and len(contracts)==2
    controls=[control_summary(p) for p in profiles if p['samePayloadControl'] or 'single-with-white-band' in p['inputKey']]
    assert len(controls)==18
    result={'scope':'Bounded actual-record case review after previously successful full gates. Not another interpreter run, decoder call or policy test.',
            'status':'file-only-case-checks-passed','sourceInputs':inputs,'sourceScriptSha256':sha(Path(__file__).read_bytes()),
            'focusProfiles':focus,'scoreCases':scores,'scheduler07Max2':scheduler,'returnedQuadrilateralContractions':contracts,
            'samePayloadAndWhiteBandControls':controls,
            'focusComparisons':[c for c in comparisons if any(k in c['inputKey'] for k in ['1-35','2-07','two-same-payload'])],
            'limitations':['Known diagnostic examples only; no held-out accuracy or population false-positive claim.',
             'Whole-word enumeration uses recorded exact-best patterns, source parity and checksum; never substitutes an alternate decoded output.',
             'Support placement is a saved whole-PNG rectangle membership, not physical ink segmentation.',
             'Returned collector quadrilaterals need not enclose historical supporting scanlines.',
             'No production filter, threshold, majority rule, new search or recognition-policy change is selected.'],
            'readerImports':0,'recognitionCalls':0,'fullInterpreterRuns':0}
    # Comparisons include large path histories. Keep only measured schedules and first differences here.
    result['focusComparisons']=[{k:c[k] for k in ['inputKey','tryHarder','firstDifferences']}|
                               {'scheduleLengths':{k:len(v) for k,v in c['schedules'].items()}} for c in result['focusComparisons']]
    out.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':result['status'],'scoreCases':len(scores),'focusProfiles':len(focus),'controlProfiles':len(controls),
                      'readerImports':0,'recognitionCalls':0,'fullInterpreterRuns':0}))
if __name__=='__main__':main(sys.argv[1:])
